import type { Database } from "../../../infrastructure/database/pool.js"
import { isUniverseEnforced } from "../../operating-universe/application/universe-access.js"
import { isHierarchyRole } from "../../performance-analytics/domain/hierarchy-levels.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { JOB_POSITION_LEVEL_LABELS, jobPositionInputSchema, jobPositionPatchSchema, reservedLevelOf, termsOf, UNKNOWN_JOB_POSITION_PATTERN, type JobPositionCatalog, type JobPositionLevel } from "../domain/job-position.js"

/**
 * Cadastro de CARGOS (migration 252): leitura para a carga e para as telas, e as regras de mudança. Cargo não é excluído — é desativado:
 * quem já tem o cargo continua com ele e a carga manda o termo dele para a quarentena.
 */
type Queryable = { query: Database["query"] }
export type JobPositionActor = { organizationId: string; personId: string | null }

/** Catálogo inteiro da organização por termo (inclusive desativados: a carga precisa dizer "desativado" em vez de "não existe"). */
export async function loadJobPositionCatalog(db: Queryable, organizationId: string): Promise<JobPositionCatalog> {
  const result = await db.query<{ key: string; id: string; name: string; level: JobPositionLevel; active: boolean }>(
    `select t.term_key "key", jp.id, jp.name, jp.level, jp.active
       from job_position_terms t join job_positions jp on jp.id = t.job_position_id and jp.organization_id = t.organization_id
      where t.organization_id = $1`,
    [organizationId],
  )
  return new Map(result.rows.map(({ key, ...row }) => [key, row]))
}

export type JobPositionRecord = { id: string; name: string; level: JobPositionLevel; levelLabel: string; terms: string[]; active: boolean; peopleCount: number; peopleTotal: number; createdAt: string; updatedAt: string }

const SELECT_POSITIONS = `
  select jp.id, jp.name, jp.level, jp.active, jp.created_at "createdAt", jp.updated_at "updatedAt",
         (select coalesce(array_agg(t.term order by t.term), '{}') from job_position_terms t where t.job_position_id = jp.id) terms,
         (select count(*) from people p where p.organization_id = jp.organization_id and p.job_position_id = jp.id and p.active)::int "peopleCount",
         (select count(*) from people p where p.organization_id = jp.organization_id and p.job_position_id = jp.id)::int "peopleTotal"
    from job_positions jp
   where jp.organization_id = $1`

type PositionRow = Omit<JobPositionRecord, "levelLabel" | "createdAt" | "updatedAt"> & { createdAt: Date; updatedAt: Date }
const toRecord = (row: PositionRow): JobPositionRecord => ({ ...row, levelLabel: JOB_POSITION_LEVEL_LABELS[row.level], createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString() })

export async function listJobPositions(db: Queryable, organizationId: string): Promise<JobPositionRecord[]> {
  return (await db.query<PositionRow>(`${SELECT_POSITIONS} order by jp.name, jp.id`, [organizationId])).rows.map(toRecord)
}

async function findJobPosition(db: Queryable, organizationId: string, id: string, lock = false): Promise<JobPositionRecord> {
  if (lock) await db.query(`select id from job_positions where organization_id = $1 and id = $2 for no key update`, [organizationId, id])
  const row = (await db.query<PositionRow>(`${SELECT_POSITIONS} and jp.id = $2`, [organizationId, id])).rows[0]
  if (!row) throw new DomainError("Cargo não encontrado.", "JOB_POSITION_NOT_FOUND", 404)
  return toRecord(row)
}

/** Cargo escolhido no cadastro manual de pessoa: precisa existir e estar ativo na organização da sessão. */
export async function requireActiveJobPosition(db: Queryable, organizationId: string, id: string): Promise<{ id: string; name: string; level: JobPositionLevel }> {
  const row = (await db.query<{ id: string; name: string; level: JobPositionLevel; active: boolean }>(`select id, name, level, active from job_positions where organization_id = $1 and id = $2`, [organizationId, id])).rows[0]
  if (!row) throw new DomainError("Cargo não encontrado.", "JOB_POSITION_NOT_FOUND", 422)
  if (!row.active) throw new DomainError(`O cargo "${row.name}" está desativado.`, "JOB_POSITION_INACTIVE", 422)
  return row
}

async function audit(db: Queryable, actor: JobPositionActor, action: string, id: string, payload: Record<string, unknown>): Promise<void> {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'job_position', $4, $5)`, [actor.organizationId, actor.personId, action, id, JSON.stringify(payload)])
}

async function writeTerms(db: Queryable, organizationId: string, positionId: string, level: JobPositionLevel, terms: { key: string; term: string }[]): Promise<void> {
  const reserved = terms.find((entry) => (reservedLevelOf(entry.key) ?? level) !== level)
  if (reserved) throw new DomainError(`"${reserved.term}" é o código do nível ${JOB_POSITION_LEVEL_LABELS[reservedLevelOf(reserved.key)!]} e só pode ser de um cargo com esse perfil.`, "JOB_POSITION_TERM_RESERVED", 422)
  const keys = terms.map((entry) => entry.key)
  const taken = await db.query<{ term: string; name: string }>(
    `select t.term, jp.name from job_position_terms t join job_positions jp on jp.id = t.job_position_id
      where t.organization_id = $1 and t.term_key = any($2::text[]) and t.job_position_id <> $3 order by t.term limit 1`,
    [organizationId, keys, positionId],
  )
  if (taken.rows[0]) throw new DomainError(`"${taken.rows[0].term}" já pertence ao cargo "${taken.rows[0].name}".`, "JOB_POSITION_TERM_TAKEN", 409)
  await db.query(`delete from job_position_terms where organization_id = $1 and job_position_id = $2 and not (term_key = any($3::text[]))`, [organizationId, positionId, keys])
  await db.query(
    `insert into job_position_terms (organization_id, term_key, term, job_position_id)
     select $1, key, term, $2 from unnest($3::text[], $4::text[]) as t(key, term)
     on conflict (organization_id, term_key) do update set term = excluded.term where job_position_terms.job_position_id = excluded.job_position_id`,
    [organizationId, positionId, keys, terms.map((entry) => entry.term)],
  )
}

/** Uma mudança de cargo por vez na organização, e nenhuma no meio da gravação de uma carga (que segura a mesma trava compartilhada). */
const serialize = (db: Queryable, organizationId: string) => db.query(`select pg_advisory_xact_lock(hashtextextended('job_positions:' || $1::text, 0))`, [organizationId])

/**
 * Cargos como estão AGORA, para gravar pessoas: o catálogo lido na validação da carga pode ter mudado. A trava compartilhada vai até o fim
 * da transação; o perfil e o nome lidos aqui são os que ficam com a pessoa.
 */
export async function lockJobPositionsForWrite(client: Queryable, organizationId: string, ids: readonly (string | null)[]): Promise<Map<string, { name: string; level: JobPositionLevel }>> {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))]
  if (wanted.length === 0) return new Map()
  await client.query(`select pg_advisory_xact_lock_shared(hashtextextended('job_positions:' || $1::text, 0))`, [organizationId])
  const result = await client.query<{ id: string; name: string; level: JobPositionLevel }>(`select id, name, level from job_positions where organization_id = $1 and id = any($2::uuid[])`, [organizationId, wanted])
  return new Map(result.rows.map(({ id, ...row }) => [id, row]))
}

export async function createJobPosition(db: Database, actor: JobPositionActor, rawInput: unknown): Promise<JobPositionRecord> {
  const input = jobPositionInputSchema.parse(rawInput)
  return inTransaction(db, async (client) => {
    await serialize(client, actor.organizationId)
    const id = (await client.query<{ id: string }>(`insert into job_positions (organization_id, name, level, active) values ($1, $2, $3, $4) returning id`, [actor.organizationId, input.name, input.level, input.active])).rows[0]!.id
    const terms = termsOf(input.name, input.terms)
    await writeTerms(client, actor.organizationId, id, input.level, terms)
    await audit(client, actor, "DATA_HUB_JOB_POSITION_CREATED", id, { name: input.name, level: input.level, terms: terms.map((entry) => entry.term), active: input.active })
    return findJobPosition(client, actor.organizationId, id)
  })
}

export async function updateJobPosition(db: Database, actor: JobPositionActor, id: string, rawPatch: unknown): Promise<JobPositionRecord> {
  const patch = jobPositionPatchSchema.parse(rawPatch)
  return inTransaction(db, async (client) => {
    await serialize(client, actor.organizationId)
    const current = await findJobPosition(client, actor.organizationId, id, true)
    const next = { name: patch.name ?? current.name, level: patch.level ?? current.level, active: patch.active ?? current.active }
    const levelChanged = next.level !== current.level
    if (levelChanged) await assertLevelChange(client, actor.organizationId, current, next.level)
    await client.query(`update job_positions set name = $3, level = $4, active = $5, updated_at = now() where organization_id = $1 and id = $2`, [actor.organizationId, id, next.name, next.level, next.active])
    // Depois do cargo: o banco tira da pessoa o cargo que não combina com o nível dela (migration 253).
    if (levelChanged) await client.query(`update people set role = $3 where organization_id = $1 and job_position_id = $2`, [actor.organizationId, id, next.level])
    // Renomear não apaga o nome antigo: é como a base continua escrevendo. Quem quiser tirá-lo edita a lista depois.
    const renamedFrom = next.name !== current.name ? [current.name] : []
    if (patch.name !== undefined || patch.terms !== undefined || levelChanged) await writeTerms(client, actor.organizationId, id, next.level, termsOf(next.name, [...(patch.terms ?? current.terms), ...renamedFrom]))
    // O cargo exibido de quem não tem cargo próprio na base é o nome do cadastro: renomear acompanha.
    if (next.name !== current.name) await client.query(`update people set job_title = $3 where organization_id = $1 and job_position_id = $2 and job_title = $4`, [actor.organizationId, id, next.name, current.name])
    const updated = await findJobPosition(client, actor.organizationId, id)
    await audit(client, actor, "DATA_HUB_JOB_POSITION_UPDATED", id, {
      name: updated.name,
      before: { name: current.name, level: current.level, terms: current.terms, active: current.active },
      after: { name: updated.name, level: updated.level, terms: updated.terms, active: updated.active },
      ...(levelChanged ? { peopleChanged: current.peopleTotal } : {}),
    })
    return updated
  })
}

/**
 * Mudar o PERFIL de um cargo em uso muda o nível das pessoas na hora (uma carga incremental não reenviaria quem não mudou). Só entre
 * Operador e Apoio: nível de liderança muda a hierarquia e a custódia de credencial, que só a carga da pessoa confere.
 */
async function assertLevelChange(db: Queryable, organizationId: string, current: JobPositionRecord, level: JobPositionLevel): Promise<void> {
  const inUse = current.peopleTotal
  if (inUse === 0) return
  if (isHierarchyRole(current.level) || isHierarchyRole(level)) {
    throw new DomainError(`${inUse === 1 ? "1 pessoa tem" : `${inUse} pessoas têm`} este cargo. Perfil de liderança não muda em cargo em uso: crie outro cargo e mude na base.`, "JOB_POSITION_LEVEL_LOCKED", 409, { people: inUse })
  }
  if (level === "OPERATOR" && (await isUniverseEnforced(db as Database, organizationId))) {
    const pending = (await db.query<{ count: number }>(`select count(*)::int count from people where organization_id = $1 and job_position_id = $2 and active and operating_universe is null`, [organizationId, current.id])).rows[0]?.count ?? 0
    if (pending > 0) throw new DomainError(`${pending === 1 ? "1 pessoa deste cargo está" : `${pending} pessoas deste cargo estão`} sem universo de atuação. Informe o universo do Grupo antes de mudar o perfil para Operador.`, "JOB_POSITION_UNIVERSE_REQUIRED", 409, { people: pending })
  }
}

/** `inactivePositionId`: o cargo existe e está desativado — a saída é ativar, não cadastrar outro. */
export type UnknownJobPosition = { term: string; records: number; lastSeenAt: string; inactivePositionId: string | null }

/** Teto de recusas lidas (as mais recentes) e de termos mostrados: a tela não pode custar uma varredura de 30 dias de quarentena. */
const RECENT_REJECTIONS = 20_000
const MAX_UNKNOWN_TERMS = 50

/** Cargos que chegaram nas últimas cargas e foram para a quarentena — só os que ainda não têm cadastro ativo. */
export async function listUnknownJobPositions(db: Queryable, organizationId: string, catalog: JobPositionCatalog, keyOf: (term: string) => string): Promise<UnknownJobPosition[]> {
  const result = await db.query<{ term: string | null; records: number; last_seen: Date }>(
    `select substring(j.message from $2) term, count(distinct j.source_record_key)::int records, max(j.created_at) last_seen
       from (select message, source_record_key, created_at from data_ingestion_rejections
              where organization_id = $1 and error_code = 'DATA_JOB_POSITION_UNKNOWN' and created_at > now() - interval '30 days'
              order by created_at desc limit $3) j
      group by 1 order by 2 desc, 1`,
    [organizationId, UNKNOWN_JOB_POSITION_PATTERN, RECENT_REJECTIONS],
  )
  return result.rows
    .flatMap((row) => {
      if (row.term === null) return []
      const entry = catalog.get(keyOf(row.term))
      return entry?.active ? [] : [{ term: row.term, records: row.records, lastSeenAt: new Date(row.last_seen).toISOString(), inactivePositionId: entry?.id ?? null }]
    })
    .slice(0, MAX_UNKNOWN_TERMS)
}
