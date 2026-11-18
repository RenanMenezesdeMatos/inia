import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { civilDateOf, myAlignmentStateOf, myAudienceLabelOf, MY_ALIGNMENTS_HISTORY_MONTHS, MY_ALIGNMENTS_LIMIT, pickMyAlignmentVersions, type MyAlignmentState } from "../domain/my-alignments.js"
import { audienceReasonOf, type AlignmentLink, type AlignmentSubject } from "../domain/operational-alignment.js"
import { alignmentLinksSql, loadAlignmentSubject } from "../infrastructure/operational-alignment-loaders.js"
import { isOperatingUniverse } from "../../operating-universe/domain/operating-universe.js"

type Queryable = Pick<Database, "query">

/** Um alinhamento no Acompanhamento do operador (`MY_OPERATIONAL_ALIGNMENTS_V1`). */
export type MyAlignment = {
  alignmentId: string
  versionId: string
  version: number
  title: string
  guidance: string
  justification: string
  /** Motivo da alteração desta versão (só a partir da 2ª): "O que mudou nesta versão". */
  changeReason: string | null
  affectedTopic: string | null
  processes: string[]
  productName: string | null
  /** Para quem, do ponto de vista de quem lê ("Ouvidoria", "Todo o B2C"). */
  audienceLabel: string
  /** Vigência em datas civis (fuso da organização) e os instantes que a delimitam. */
  startsOn: string
  endsOn: string
  timeZone: string
  effectiveFrom: string
  effectiveUntil: string
  /** Decidido no servidor pelo relógio: antes de valer, em vigor ou não vale mais. */
  state: MyAlignmentState
  /** Dia civil em que deixou de valer (encerrado antes, substituído ou fim do prazo) — só quando `state = ENDED`. */
  noLongerValidSince: string | null
  /** Encerrado antes do prazo (e não pelo fim da vigência). */
  endedEarly: boolean
  publishedAt: string
  definedBy: { name: string; jobTitle: string | null } | null
  /** Quando a pessoa marcou "Li o alinhamento" NESTA versão (null = não leu esta versão). */
  readAt: string | null
}

type Row = {
  alignment_id: string
  version_id: string
  version: number
  title: string
  guidance: string
  justification: string
  change_reason: string | null
  affected_topic: string | null
  processes: string[] | null
  product_name: string | null
  operating_universe: string
  scope_type: "UNIVERSE" | "GROUPS"
  links: AlignmentLink[] | null
  starts_on: string
  ends_on: string
  time_zone: string
  effective_from: Date
  effective_until: Date
  ended_at: Date | null
  published_at: Date
  responsible_name: string | null
  responsible_job_title: string | null
  published_by_name: string | null
  published_by_job_title: string | null
  read_at: Date | null
}

/**
 * Versões publicadas (vigentes, futuras ou substituídas) de alinhamentos NÃO excluídos, que ainda valem, vão valer ou deixaram de
 * valer há no máximo 12 meses. Cancelada (encerrada antes de começar) e rascunho nunca entram. O público é aplicado depois, pela
 * mesma regra do chat (`audienceReasonOf`).
 */
const SELECT_VERSIONS = `
  select v.alignment_id, v.id version_id, v.version, v.title, v.guidance, v.justification, v.change_reason, v.affected_topic,
         (select array_agg(kd.title order by kd.title) from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = v.id) processes,
         pn.name product_name, v.operating_universe, v.scope_type, ${alignmentLinksSql("v")} links,
         v.starts_on::text starts_on, v.ends_on::text ends_on, v.time_zone, v.effective_from, v.effective_until, v.ended_at, v.published_at,
         pr.name responsible_name, v.responsible_job_title, pp.name published_by_name, pp.job_title published_by_job_title,
         r.read_at
  from operational_alignment_versions v
  join operational_alignments a on a.id = v.alignment_id and a.deleted_at is null
  left join product_catalog_nodes_all pn on pn.id = v.product_id
  left join people pr on pr.id = v.responsible_person_id
  left join people pp on pp.id = v.published_by
  left join operational_alignment_reads r on r.version_id = v.id and r.person_id = $3
  where v.organization_id = $1 and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_until > v.effective_from
    and v.effective_until > $2::timestamptz - make_interval(months => ${MY_ALIGNMENTS_HISTORY_MONTHS})
  order by v.published_at desc
  limit 1000`

const toVersion = (row: Row) => ({
  ...row,
  alignmentId: row.alignment_id,
  versionId: row.version_id,
  effectiveFrom: new Date(row.effective_from),
  effectiveUntil: new Date(row.effective_until),
  publishedAt: new Date(row.published_at),
  operatingUniverse: row.operating_universe,
  scopeType: row.scope_type,
  links: row.links ?? [],
})

function toMyAlignment(row: ReturnType<typeof toVersion>, subject: AlignmentSubject, now: Date): MyAlignment {
  const state = myAlignmentStateOf(row, now)
  // Quem DEFINIU (221); sem responsável, quem publicou — a mesma atribuição do chat.
  const definedBy = row.responsible_name ? { name: row.responsible_name, jobTitle: row.responsible_job_title } : row.published_by_name ? { name: row.published_by_name, jobTitle: row.published_by_job_title } : null
  return {
    alignmentId: row.alignment_id,
    versionId: row.version_id,
    version: row.version,
    title: row.title,
    guidance: row.guidance,
    justification: row.justification,
    changeReason: row.version > 1 ? row.change_reason : null,
    affectedTopic: row.affected_topic,
    processes: row.processes ?? [],
    productName: row.product_name,
    audienceLabel: myAudienceLabelOf(row, subject),
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    timeZone: row.time_zone,
    effectiveFrom: row.effectiveFrom.toISOString(),
    effectiveUntil: row.effectiveUntil.toISOString(),
    state,
    noLongerValidSince: state === "ENDED" ? civilDateOf(row.effectiveUntil, row.time_zone) : null,
    endedEarly: row.ended_at !== null,
    publishedAt: row.publishedAt.toISOString(),
    definedBy,
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  }
}

/** Os alinhamentos da pessoa DA SESSÃO para o Acompanhamento (um por alinhamento). */
export async function listMyAlignments(db: Queryable, input: { organizationId: string; personId: string; now?: Date }): Promise<MyAlignment[]> {
  const now = input.now ?? new Date()
  const subject = await loadAlignmentSubject(db, input.organizationId, input.personId, now)
  if (!subject) return []
  const rows = (await db.query<Row>(SELECT_VERSIONS, [input.organizationId, now, input.personId])).rows.map(toVersion)
  return pickMyAlignmentVersions(rows, subject, now).slice(0, MY_ALIGNMENTS_LIMIT).map((row) => toMyAlignment(row, subject, now))
}

/**
 * "Li o alinhamento": só a versão que a pessoa VÊ agora e que ainda não deixou de valer (antes de valer ou em vigor). Idempotente —
 * a segunda leitura devolve a primeira. Fora do público, excluído, encerrado ou outra versão = 404 (não revela).
 */
export async function markMyAlignmentRead(db: Queryable, input: { organizationId: string; personId: string; alignmentId: string; versionId: string; now?: Date }): Promise<{ readAt: string }> {
  const visible = (await listMyAlignments(db, input)).find((item) => item.alignmentId === input.alignmentId && item.versionId === input.versionId)
  if (!visible || visible.state === "ENDED") throw new DomainError("Alinhamento não encontrado.", "OPERATIONAL_ALIGNMENT_NOT_FOUND", 404)
  const row = (await db.query<{ read_at: Date }>(
    `with inserted as (
       insert into operational_alignment_reads (organization_id, person_id, alignment_id, version_id) values ($1, $2, $3, $4)
       on conflict (person_id, version_id) do nothing returning read_at
     )
     select read_at from inserted union all select read_at from operational_alignment_reads where person_id = $2 and version_id = $4 limit 1`,
    [input.organizationId, input.personId, input.alignmentId, input.versionId],
  )).rows[0]
  return { readAt: new Date(row!.read_at).toISOString() }
}

/** Tipo do aviso no sino quando uma versão COMEÇA a valer. */
export const ALIGNMENT_STARTED_ALERT_TYPE = "OPERATIONAL_ALIGNMENT_STARTED"
/** `operational_alignment_started:<alinhamento>:<versão>:<pessoa>` — o sino abre o item do alinhamento no Acompanhamento. */
export const alignmentStartedDedupeKey = (alignmentId: string, versionId: string, personId: string) => `operational_alignment_started:${alignmentId}:${versionId}:${personId}`
/** Versão que começou há mais que isto não avisa (backfill, job parado por dias): o aviso é de novidade, não de histórico. */
const STARTED_NOTICE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

/**
 * Sino ao COMEÇAR a valer (decisão do usuário, 18/11): um aviso por versão × OPERADOR ativo do público naquele momento (a mesma regra
 * do chat), inserido em lote. Versão > 1 = "Alinhamento atualizado". Idempotente pela chave; versão que já não vale ou começou há
 * mais de 2 dias não avisa.
 */
export async function notifyAlignmentVersionsStarted(db: Queryable, versionIds: readonly string[], now: Date = new Date()): Promise<number> {
  if (versionIds.length === 0) return 0
  const versions = (await db.query<{ organization_id: string; alignment_id: string; version_id: string; version: number; title: string; operating_universe: string; scope_type: "UNIVERSE" | "GROUPS"; links: AlignmentLink[] | null; effective_from: Date; effective_until: Date; enforced: boolean }>(
    `select v.organization_id, v.alignment_id, v.id version_id, v.version, v.title, v.operating_universe, v.scope_type, ${alignmentLinksSql("v")} links,
            v.effective_from, v.effective_until, (o.operating_universe_enforced_at is not null) enforced
     from operational_alignment_versions v
     join operational_alignments a on a.id = v.alignment_id and a.deleted_at is null
     join organizations o on o.id = v.organization_id
     where v.id = any($1::uuid[]) and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_from <= $2 and v.effective_until > $2`,
    [[...versionIds], now],
  )).rows.filter((version) => now.getTime() - new Date(version.effective_from).getTime() <= STARTED_NOTICE_WINDOW_MS)
  let inserted = 0
  for (const version of versions) {
    const links = version.links ?? []
    // Candidatos pelo índice: operadores ativos do universo ou dos Grupos vinculados; a regra pura decide (pendente de universo etc.).
    const people = (await db.query<{ id: string; team_id: string | null; subteam_id: string | null; universe: string | null }>(
      `select p.id, p.team_id, p.subteam_id, p.operating_universe universe from people p
       where p.organization_id = $1 and p.active and p.role = 'OPERATOR'
         and (p.operating_universe = $2 or p.team_id = any($3::uuid[]))`,
      [version.organization_id, version.operating_universe, links.map((link) => link.teamId)],
    )).rows
    const recipients = people.filter((person) => {
      const subject: AlignmentSubject = { teamId: person.team_id, subteamId: person.subteam_id, operatingUniverse: isOperatingUniverse(person.universe) ? person.universe : null, universeEnforced: version.enforced }
      return audienceReasonOf({ operatingUniverse: version.operating_universe as never, scopeType: version.scope_type, links }, subject) === null
    })
    if (recipients.length === 0) continue
    const updated = version.version > 1
    const result = await db.query(
      `insert into alerts (organization_id, recipient_id, title, description, severity, alert_type, dedupe_key)
       select $1, person_id, $2, $3, 'INFO', $4, 'operational_alignment_started:' || $5 || ':' || $6 || ':' || person_id
       from unnest($7::uuid[]) person_id
       on conflict do nothing`,
      [version.organization_id, updated ? "Alinhamento atualizado" : "Novo alinhamento em vigor", version.title.length > 160 ? `${version.title.slice(0, 157).trimEnd()}…` : version.title, ALIGNMENT_STARTED_ALERT_TYPE, version.alignment_id, version.version_id, recipients.map((person) => person.id)],
    )
    inserted += result.rowCount ?? 0
  }
  return inserted
}
