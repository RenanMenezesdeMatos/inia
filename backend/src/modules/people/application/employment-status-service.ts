import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { addDaysToDate, employmentStatusOn, evidenceRank, findOverlap, isLegacyEmploymentStatus, normalizeEmploymentStatus, planStatusPeriodCancellation, resolveStatusBasis, toCanonicalEmploymentStatus, type EmploymentStatus, type LegacyEmploymentStatus, type ResolvedStatus, type StatusPeriod } from "../domain/employment-status.js"

/**
 * Serviço CANÔNICO de situação funcional — o único caminho que escreve em
 * `employee_status_periods` e sincroniza `people.current_employment_status`. Quem alimenta:
 * seed demo, ajuste manual do admin e a Central de Dados (snapshot EMPLOYEES e dataset
 * EMPLOYEE_ABSENCES, que também cancela pelo "Vigente? = não") — todos pelas MESMAS funções,
 * nunca dois cálculos de elegibilidade.
 *
 * Política de datas (Parte F do hardening):
 *  - `effectiveFrom` explícito da fonte → usado tal qual (`effectiveFromInferred = false`);
 *  - sem data efetiva → data LOCAL (fuso da organização) da observação (`observedAt`), marcada
 *    como inferida: "situação conhecida a partir desta carga". Nunca retroage por suposição —
 *    a sexta anterior a um snapshot de segunda continua elegível.
 *  - `effectiveTo` explícito (fonte de períodos, ex.: férias 09–20) fecha o período; depois dele
 *    a situação volta a ser a próxima registrada ou ATIVO presumido.
 */
export type EmploymentStatusSnapshot = {
  organizationId: string
  personId: string
  /** Status já normalizado (real ou legado — canonizado aqui) OU texto bruto da fonte (normalizado aqui; desconhecido = erro de domínio). */
  status?: EmploymentStatus | LegacyEmploymentStatus
  rawStatus?: string | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
  observedAt?: Date
  sourceUpdatedAt?: Date | string | null
  source: string
  sourceReference?: string | null
  timeZone?: string
  /** O snapshot vem de um feed autoritativo da Central (desempate entre evidências do mesmo nível). */
  authoritative?: boolean
}

/**
 * Conflito de evidência entre o que já existe e o que chegou — NUNCA resolvido em silêncio:
 * o resultado diz quem venceu e por quê, e quem chamou (writer da Central, admin) registra.
 *  - EXPLICIT_PERIOD_WINS: ausência explícita e limitada (04–20) vence snapshot sem intervalo;
 *  - AUTHORITATIVE_SOURCE_WINS: mesmo nível de evidência, o feed autoritativo vence;
 *  - NEWER_EVIDENCE_WINS: mesmo nível e mesma autoridade, a evidência mais nova vence.
 */
export type StatusConflict = {
  kept: "EXISTING" | "INCOMING"
  reason: "EXPLICIT_PERIOD_WINS" | "AUTHORITATIVE_SOURCE_WINS" | "NEWER_EVIDENCE_WINS"
  existing: { status: EmploymentStatus; effectiveFrom: string; effectiveTo: string | null; source: string; sourceReference: string | null }
  incoming: { status: EmploymentStatus; effectiveFrom: string; effectiveTo: string | null; inferred: boolean; source: string }
}

export type SnapshotOutcome = { action: "CREATED" | "REFRESHED" | "ADJUSTED" | "CONFLICT"; period: StatusPeriod; currentStatus: EmploymentStatus; conflict?: StatusConflict }

type Row = {
  id: string
  person_id: string
  status: string
  raw_status: string | null
  legacy_status: string | null
  effective_from: string
  effective_to: string | null
  effective_from_inferred: boolean
  effective_to_explicit: boolean
  authoritative: boolean
  observed_at: string
  source_updated_at: string | null
  source: string
  source_reference: string | null
}

function toPeriod(row: Row): StatusPeriod {
  return {
    id: row.id,
    personId: row.person_id,
    // Dual-read: um registro anterior à 062 que ainda carregue código legado é canonizado na leitura.
    status: toCanonicalEmploymentStatus(row.status) ?? "EM_PRODUCAO",
    rawStatus: row.raw_status,
    legacyStatus: isLegacyEmploymentStatus(row.legacy_status) ? row.legacy_status : null,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    effectiveFromInferred: row.effective_from_inferred,
    effectiveToExplicit: row.effective_to_explicit,
    authoritative: row.authoritative,
    observedAt: row.observed_at,
    sourceUpdatedAt: row.source_updated_at,
    source: row.source,
    sourceReference: row.source_reference,
  }
}

const RETURNING = `id, person_id, status, raw_status, legacy_status, effective_from::text effective_from, effective_to::text effective_to, effective_from_inferred, effective_to_explicit, authoritative,
                   observed_at::text observed_at, source_updated_at::text source_updated_at, source, source_reference`
const SELECT = `select ${RETURNING} from employee_status_periods`

export async function loadEmploymentStatusHistory(db: Database, personId: string): Promise<StatusPeriod[]> {
  const result = await db.query<Row>(`${SELECT} where person_id = $1 order by effective_from`, [personId])
  return result.rows.map(toPeriod)
}

function toDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}

/** Aplica UM snapshot de situação. Idempotente: o mesmo snapshot duas vezes não cria período novo. */
export async function applyEmployeeStatusSnapshot(db: Database, snapshot: EmploymentStatusSnapshot): Promise<SnapshotOutcome> {
  const status = snapshot.status ? toCanonicalEmploymentStatus(snapshot.status) : normalizeEmploymentStatus(snapshot.rawStatus)
  if (!status) throw new DomainError(`Situação funcional não reconhecida: "${snapshot.rawStatus ?? ""}".`, "EMPLOYMENT_STATUS_UNKNOWN", 422)
  const timeZone = snapshot.timeZone ?? DEFAULT_ORGANIZATION_TIMEZONE
  const observedAt = snapshot.observedAt ?? new Date()
  const inferred = !snapshot.effectiveFrom
  const effectiveFrom = snapshot.effectiveFrom ?? localDateOf(observedAt, timeZone)
  const effectiveTo = snapshot.effectiveTo ?? null
  if (effectiveTo !== null && effectiveTo < effectiveFrom) throw new DomainError("Fim da situação anterior ao início.", "EMPLOYMENT_STATUS_INVALID_RANGE", 422)
  const sourceUpdatedAt = snapshot.sourceUpdatedAt ? toDateString(snapshot.sourceUpdatedAt) : null

  const periods = await loadEmploymentStatusHistory(db, snapshot.personId)
  const covering = periods.find((period) => period.effectiveFrom <= effectiveFrom && (period.effectiveTo === null || period.effectiveTo >= effectiveFrom))

  // 1. Mesma situação já vigente na data → idempotente: só atualiza freshness (e o fim, se a
  //    fonte agora informa um `effectiveTo` diferente — correção controlada).
  if (covering && covering.status === status) {
    // Datas explícitas da fonte corrigem os limites do período (ex.: férias 09–20 → 10–20);
    // snapshot sem data só renova a freshness — nunca move o início por suposição.
    const nextFrom = inferred ? covering.effectiveFrom : effectiveFrom
    const nextTo = inferred || snapshot.effectiveTo === undefined ? covering.effectiveTo : effectiveTo
    const changed = nextTo !== covering.effectiveTo || nextFrom !== covering.effectiveFrom
    const applyTarget = () =>
      db.query<Row>(
        `update employee_status_periods
            set observed_at = greatest(observed_at, $2::timestamptz),
                source_updated_at = coalesce($3::timestamptz, source_updated_at),
                effective_from = $4::date, effective_to = $5::date,
                effective_from_inferred = case when $4::date <> effective_from then false else effective_from_inferred end,
                effective_to_explicit = case when $7 then true else effective_to_explicit end,
                authoritative = authoritative or $8,
                raw_status = coalesce($6, raw_status), updated_at = now()
          where id = $1
          returning ${RETURNING}`,
        [covering.id, observedAt.toISOString(), sourceUpdatedAt, nextFrom, nextTo, snapshot.rawStatus ?? null, !inferred && snapshot.effectiveTo !== undefined && snapshot.effectiveTo !== null, snapshot.authoritative === true],
      )
    const updated = changed ? await reshapeWithNeighbors(db, periods, covering, nextFrom, nextTo, applyTarget) : await applyTarget()
    const currentStatus = await syncCurrentStatus(db, snapshot.personId, timeZone)
    return { action: changed ? "ADJUSTED" : "REFRESHED", period: toPeriod(updated.rows[0]!), currentStatus }
  }

  // 2. Mudança de situação (ou período novo). ANTES de escrever: precedência de evidência contra
  //    cada período de status DIFERENTE que o intervalo novo sobrepõe. Ausência explícita e
  //    limitada (04–20) vence snapshot sem intervalo; empate → feed autoritativo → evidência mais
  //    nova. Quando o existente vence, nada é escrito e o resultado é CONFLICT (quem chamou audita).
  const rangeEnd = effectiveTo ?? "9999-12-31"
  const incomingEvidence = { effectiveTo, effectiveToExplicit: snapshot.effectiveTo !== undefined && snapshot.effectiveTo !== null, authoritative: snapshot.authoritative === true, evidenceAt: sourceUpdatedAt ?? observedAt.toISOString() }
  let conflict: StatusConflict | undefined
  for (const period of periods) {
    const periodEnd = period.effectiveTo ?? "9999-12-31"
    if (period.status === status || !(period.effectiveFrom <= rangeEnd && periodEnd >= effectiveFrom)) continue
    const verdict = compareEvidence(period, incomingEvidence)
    const conflictDetail: StatusConflict = {
      kept: verdict.kept,
      reason: verdict.reason,
      existing: { status: period.status, effectiveFrom: period.effectiveFrom, effectiveTo: period.effectiveTo, source: period.source, sourceReference: period.sourceReference },
      incoming: { status, effectiveFrom, effectiveTo, inferred, source: snapshot.source },
    }
    if (verdict.kept === "EXISTING") {
      const currentStatus = await syncCurrentStatus(db, snapshot.personId, timeZone)
      return { action: "CONFLICT", period, currentStatus, conflict: conflictDetail }
    }
    // O novo vence, mas só é "conflito" (e não simples mudança de situação) quando o existente tinha
    // evidência explícita (datas da fonte): ausência explícita sobre snapshot inferido e snapshot
    // substituindo snapshot são a rotina do dia a dia — corrigir um período explícito é rastreável.
    if (evidenceRank(period) === 2 || !period.effectiveFromInferred) conflict = conflictDetail
  }
  for (const period of periods) {
    const periodEnd = period.effectiveTo ?? "9999-12-31"
    const overlaps = period.effectiveFrom <= rangeEnd && periodEnd >= effectiveFrom
    if (!overlaps) continue
    const startsBefore = period.effectiveFrom < effectiveFrom
    const endsAfter = periodEnd > rangeEnd
    if (startsBefore && endsAfter) {
      await db.query(`update employee_status_periods set effective_to = $2::date, updated_at = now() where id = $1`, [period.id, addDaysToDate(effectiveFrom, -1)])
      await insertPeriod(db, { ...snapshot, status: period.status, rawStatus: period.rawStatus, effectiveFrom: addDaysToDate(rangeEnd, 1), effectiveTo: period.effectiveTo, observedAt: new Date(period.observedAt), sourceUpdatedAt: period.sourceUpdatedAt, source: period.source, sourceReference: period.sourceReference, effectiveToExplicit: period.effectiveToExplicit, authoritative: period.authoritative }, false)
    } else if (startsBefore) {
      await db.query(`update employee_status_periods set effective_to = $2::date, updated_at = now() where id = $1`, [period.id, addDaysToDate(effectiveFrom, -1)])
    } else if (endsAfter) {
      await db.query(`update employee_status_periods set effective_from = $2::date, updated_at = now() where id = $1`, [period.id, addDaysToDate(rangeEnd, 1)])
    } else {
      await db.query(`delete from employee_status_periods where id = $1`, [period.id])
    }
  }
  const created = await insertPeriod(db, { ...snapshot, status, effectiveFrom, effectiveTo, observedAt, sourceUpdatedAt, effectiveToExplicit: incomingEvidence.effectiveToExplicit, authoritative: incomingEvidence.authoritative }, inferred)
  const currentStatus = await syncCurrentStatus(db, snapshot.personId, timeZone)
  return { action: "CREATED", period: created, currentStatus, ...(conflict ? { conflict } : {}) }
}

/**
 * CANCELAMENTO de um período pela fonte que o informou (ausência desfeita no RH). Identidade =
 * pessoa + situação + início. O período sai e os vizinhos seguem `planStatusPeriodCancellation`:
 * a situação volta a ser calculada pelas outras evidências, nunca por uma situação inventada.
 * Autoridade por origem: só a mesma fonte (`source`) cancela; período de outra fonte, do ajuste
 * manual do admin ou da demo continua e volta como CONFLICT para quem chamou registrar. Identidade
 * sem período = NOT_FOUND (cancelar 2× ou cancelar o que nunca chegou não muda nada).
 * Quem chama audita: depois daqui, o período removido só existe no audit trail.
 */
export type StatusPeriodCancellation = { personId: string; status: EmploymentStatus; effectiveFrom: string; source: string; timeZone?: string }

export type CancellationOutcome =
  | { action: "CANCELLED"; removed: StatusPeriod; restored: StatusPeriod | null; mergedWith: StatusPeriod | null; currentStatus: EmploymentStatus }
  | { action: "CONFLICT"; period: StatusPeriod }
  | { action: "NOT_FOUND" }

export async function cancelEmployeeStatusPeriod(db: Database, input: StatusPeriodCancellation): Promise<CancellationOutcome> {
  const periods = await loadEmploymentStatusHistory(db, input.personId)
  const target = periods.find((period) => period.status === input.status && period.effectiveFrom === input.effectiveFrom)
  if (!target) return { action: "NOT_FOUND" }
  if (target.source !== input.source) return { action: "CONFLICT", period: target }
  const plan = planStatusPeriodCancellation(periods, target)
  // Exclusion constraint: primeiro sai quem libera os dias, depois cresce o período restaurado.
  for (const period of plan.remove) await db.query(`delete from employee_status_periods where id = $1`, [period.id])
  let restored: StatusPeriod | null = null
  if (plan.restore) {
    const { period, effectiveTo, mergedWith } = plan.restore
    const result = await db.query<Row>(
      `update employee_status_periods
          set effective_to = $2::date, effective_to_explicit = $3,
              observed_at = greatest(observed_at, $4::timestamptz), source_updated_at = greatest(source_updated_at, $5::timestamptz),
              authoritative = authoritative or $6, updated_at = now()
        where id = $1
        returning ${RETURNING}`,
      [period.id, effectiveTo, (mergedWith ?? period).effectiveToExplicit, mergedWith?.observedAt ?? null, mergedWith?.sourceUpdatedAt ?? null, mergedWith?.authoritative ?? false],
    )
    restored = toPeriod(result.rows[0]!)
  }
  const currentStatus = await syncCurrentStatus(db, input.personId, input.timeZone ?? DEFAULT_ORGANIZATION_TIMEZONE)
  return { action: "CANCELLED", removed: target, restored, mergedWith: plan.restore?.mergedWith ?? null, currentStatus }
}

/** Quem vence entre um período existente e a evidência que chegou (regra única, determinística). */
function compareEvidence(existing: StatusPeriod, incoming: { effectiveTo: string | null; effectiveToExplicit: boolean; authoritative: boolean; evidenceAt: string }): { kept: StatusConflict["kept"]; reason: StatusConflict["reason"] } {
  const existingRank = evidenceRank(existing)
  const incomingRank = evidenceRank(incoming)
  if (existingRank !== incomingRank) return { kept: existingRank > incomingRank ? "EXISTING" : "INCOMING", reason: "EXPLICIT_PERIOD_WINS" }
  if (existing.authoritative !== incoming.authoritative) return { kept: existing.authoritative ? "EXISTING" : "INCOMING", reason: "AUTHORITATIVE_SOURCE_WINS" }
  const existingAt = existing.sourceUpdatedAt ?? existing.observedAt
  return { kept: incoming.evidenceAt >= existingAt ? "INCOMING" : "EXISTING", reason: "NEWER_EVIDENCE_WINS" }
}

async function insertPeriod(
  db: Database,
  input: { organizationId: string; personId: string; status: EmploymentStatus; rawStatus?: string | null; effectiveFrom: string; effectiveTo: string | null; observedAt: Date; sourceUpdatedAt: string | null; source: string; sourceReference?: string | null; effectiveToExplicit: boolean; authoritative: boolean },
  inferred: boolean,
): Promise<StatusPeriod> {
  const result = await db.query<Row>(
    `insert into employee_status_periods (organization_id, person_id, status, raw_status, effective_from, effective_to, effective_from_inferred, observed_at, source_updated_at, source, source_reference, effective_to_explicit, authoritative)
     values ($1, $2, $3, $4, $5::date, $6::date, $7, $8::timestamptz, $9::timestamptz, $10, $11, $12, $13)
     returning ${RETURNING}`,
    [input.organizationId, input.personId, input.status, input.rawStatus ?? null, input.effectiveFrom, input.effectiveTo, inferred, input.observedAt.toISOString(), input.sourceUpdatedAt, input.source, input.sourceReference ?? null, input.effectiveToExplicit, input.authoritative],
  )
  return toPeriod(result.rows[0]!)
}

/**
 * Correção de limites de um período existente: os vizinhos ADJACENTES acompanham (nunca sobrepõem,
 * nunca deixam buraco onde antes havia continuidade). A ordem das escritas respeita a exclusion
 * constraint: quem ENCOLHE escreve primeiro, quem CRESCE escreve depois.
 */
async function reshapeWithNeighbors(db: Database, periods: StatusPeriod[], target: StatusPeriod, nextFrom: string, nextTo: string | null, applyTarget: () => Promise<pg.QueryResult<Row>>): Promise<pg.QueryResult<Row>> {
  const simulated = periods.map((period) => (period.id === target.id ? { ...period, effectiveFrom: nextFrom, effectiveTo: nextTo } : period))
  const previous = periods.find((period) => period.id !== target.id && period.effectiveTo !== null && period.effectiveTo === addDaysToDate(target.effectiveFrom, -1))
  const next = target.effectiveTo === null ? undefined : periods.find((period) => period.id !== target.id && period.effectiveFrom === addDaysToDate(target.effectiveTo!, 1))
  const previousChange = previous && nextFrom !== target.effectiveFrom ? { id: previous.id, newTo: addDaysToDate(nextFrom, -1), remove: addDaysToDate(nextFrom, -1) < previous.effectiveFrom } : null
  const nextChange = next && nextTo !== target.effectiveTo ? { id: next.id, newFrom: nextTo === null ? null : addDaysToDate(nextTo, 1), remove: nextTo === null || (next.effectiveTo !== null && addDaysToDate(nextTo, 1) > next.effectiveTo) } : null
  const withNeighbors = simulated
    .filter((period) => !(previousChange?.remove && period.id === previousChange.id) && !(nextChange?.remove && period.id === nextChange.id))
    .map((period) => (previousChange && period.id === previousChange.id ? { ...period, effectiveTo: previousChange.newTo } : nextChange && period.id === nextChange.id && nextChange.newFrom ? { ...period, effectiveFrom: nextChange.newFrom } : period))
  if (findOverlap(withNeighbors)) throw new DomainError("A correção sobreporia períodos de situação da mesma pessoa.", "EMPLOYMENT_STATUS_OVERLAP", 422)

  const targetShrinksStart = nextFrom > target.effectiveFrom
  const targetShrinksEnd = nextTo !== null && (target.effectiveTo === null || nextTo < target.effectiveTo)
  const applyPrevious = async () => {
    if (!previousChange) return
    if (previousChange.remove) await db.query(`delete from employee_status_periods where id = $1`, [previousChange.id])
    else await db.query(`update employee_status_periods set effective_to = $2::date, updated_at = now() where id = $1`, [previousChange.id, previousChange.newTo])
  }
  const applyNext = async () => {
    if (!nextChange) return
    if (nextChange.remove) await db.query(`delete from employee_status_periods where id = $1`, [nextChange.id])
    else await db.query(`update employee_status_periods set effective_from = $2::date, updated_at = now() where id = $1`, [nextChange.id, nextChange.newFrom])
  }
  // Vizinho que encolhe primeiro; alvo; vizinho que cresce por último.
  if (!targetShrinksStart) await applyPrevious()
  if (!targetShrinksEnd) await applyNext()
  const result = await applyTarget()
  if (targetShrinksStart) await applyPrevious()
  if (targetShrinksEnd) await applyNext()
  return result
}

/** people.current_employment_status = situação vigente HOJE (fuso da organização) pelos períodos. */
async function syncCurrentStatus(db: Database, personId: string, timeZone: string): Promise<EmploymentStatus> {
  const periods = await loadEmploymentStatusHistory(db, personId)
  const today = localDateOf(new Date(), timeZone)
  const current = employmentStatusOn(periods, today)
  await db.query(`update people set current_employment_status = $2 where id = $1 and current_employment_status is distinct from $2`, [personId, current])
  return current
}

/**
 * Situação de UMA pessoa numa data local — a resposta temporal canônica (períodos), não a coluna
 * denormalizada. Diz também a BASE (período explícito, em aberto, presumido após um período
 * terminar, presumido sem histórico): quem decide sabe se está diante de certeza ou de presunção.
 */
export async function resolveEmployeeStatusAt(db: Database, personId: string, localDate: string): Promise<ResolvedStatus> {
  return resolveStatusBasis(await loadEmploymentStatusHistory(db, personId), localDate)
}

/** Idem para N pessoas com UMA consulta (job diário, estrutura, ranking) — nunca N+1. */
export async function resolveEmployeeStatusesAt(db: Database, personIds: string[], localDate: string): Promise<Map<string, ResolvedStatus>> {
  if (personIds.length === 0) return new Map()
  const result = await db.query<Row>(`${SELECT} where person_id = any($1::uuid[]) order by person_id, effective_from`, [personIds])
  const byPerson = new Map<string, StatusPeriod[]>()
  for (const row of result.rows) {
    const list = byPerson.get(row.person_id) ?? []
    list.push(toPeriod(row))
    byPerson.set(row.person_id, list)
  }
  return new Map(personIds.map((personId) => [personId, resolveStatusBasis(byPerson.get(personId) ?? [], localDate)]))
}

/**
 * Fragmento SQL da situação vigente de `<alias>` numa data local (parâmetro `$n::date`): o período
 * que cobre a data, ou NULL (= EM PRODUÇÃO presumido). É a MESMA regra de `employmentStatusOn`/
 * `resolveStatusBasis`, escrita uma vez para todo leitor em SQL (projeção diária, métricas da
 * estrutura) — nunca uma segunda leitura "paralela" de `people.current_employment_status`.
 */
export function coveringStatusPeriodSql(personAlias: string, dateParam: string): string {
  return `(select sp.status from employee_status_periods sp where sp.person_id = ${personAlias}.id and sp.effective_from <= ${dateParam}::date and (sp.effective_to is null or sp.effective_to >= ${dateParam}::date) limit 1)`
}

/** Recalcula a situação atual de todas as pessoas com período (ex.: virada do dia sem nova carga). Idempotente. */
export async function syncAllCurrentStatuses(db: Database, organizationId: string, timeZone: string, now: Date = new Date()): Promise<number> {
  const today = localDateOf(now, timeZone)
  const result = await db.query(
    `with current as (
       select p.id, coalesce(${coveringStatusPeriodSql("p", "$2")}, 'EM_PRODUCAO') status
       from people p where p.organization_id = $1
     )
     update people p set current_employment_status = c.status from current c where c.id = p.id and p.current_employment_status is distinct from c.status`,
    [organizationId, today],
  )
  return result.rowCount ?? 0
}

/**
 * PROJEÇÃO DIÁRIA da situação vigente: `people.current_employment_status` continua útil para a
 * UI, mas não depende de chegar uma carga nova para perceber que uma ausência 04–20 terminou.
 * Roda no tick do servidor; só recalcula quando o DIA LOCAL da organização mudou desde a última
 * projeção (memória por processo; na subida do processo roda uma vez). 2× no mesmo dia = mesmo
 * resultado (UPDATE só do que difere). Zero IA, uma consulta por organização.
 */
const lastProjectedDate = new Map<string, string>()

export async function runEmploymentStatusProjection(db: Database, now: Date = new Date()): Promise<{ organizations: number; updated: number }> {
  const organizations = await db.query<{ id: string; timezone: string | null }>(
    `select o.id, (select op.timezone from operations op where op.organization_id = o.id order by op.created_at limit 1) timezone from organizations o`,
  )
  let updated = 0
  let projected = 0
  for (const organization of organizations.rows) {
    const timeZone = organization.timezone ?? DEFAULT_ORGANIZATION_TIMEZONE
    const today = localDateOf(now, timeZone)
    if (lastProjectedDate.get(organization.id) === today) continue
    updated += await syncAllCurrentStatuses(db, organization.id, timeZone, now)
    lastProjectedDate.set(organization.id, today)
    projected += 1
  }
  return { organizations: projected, updated }
}

/** Só para testes: esquece o último dia projetado. */
export function resetEmploymentStatusProjection(): void {
  lastProjectedDate.clear()
}
