import type { Database } from "../../../infrastructure/database/pool.js"
import { audienceSummaryOf, civilDateOf, myAlignmentStateOf, MY_ALIGNMENTS_HISTORY_MONTHS, MY_ALIGNMENTS_LIMIT, pickDisplayVersions } from "../domain/my-alignments.js"
import type { AlignmentLink } from "../domain/operational-alignment.js"
import { alignmentLinksSql } from "../infrastructure/operational-alignment-loaders.js"
import type { MyAlignment } from "./my-alignments.js"

type Queryable = Pick<Database, "query">

/**
 * ALINHAMENTOS DA ESTRUTURA DE QUEM LIDERA (fase 2, 18/11/2026, `STRUCTURE_OPERATIONAL_ALIGNMENTS_V1`): os alinhamentos cujo público alcança
 * alguém da estrutura (os liderados que o feed e as ferramentas da liderança já resolvem), um por alinhamento na versão que importa agora
 * (a mesma escolha do Acompanhamento do operador), com QUANTAS pessoas da estrutura ele alcança e QUANTAS leram esta versão
 * ("Li o alinhamento", migration 227). Mesma regra de público da conversa (`audienceReasonOf`), aqui em SQL para contar em lote.
 */
export type StructureAlignment = Omit<MyAlignment, "readAt"> & {
  /** Pessoas ativas da estrutura alcançadas por esta versão e quantas delas marcaram "Li o alinhamento" nela. */
  reach: { people: number; read: number }
}

/**
 * A pessoa `p` (people, com `o` = organizations) está no público da versão `v` — o mesmo que `audienceReasonOf`: universo do cadastro igual ao
 * do alinhamento (pendente de universo só por Grupo/Subgrupo e só antes da exigência) e, por Grupos, algum vínculo que a alcance (Grupo
 * inteiro ou o Subgrupo dela).
 */
export const alignmentReachesPersonSql = (v: string, p: string, o: string) => `(
  (case when ${p}.operating_universe is not null then ${p}.operating_universe = ${v}.operating_universe else (${o}.operating_universe_enforced_at is null and ${v}.scope_type = 'GROUPS') end)
  and (${v}.scope_type = 'UNIVERSE' or exists (select 1 from operational_alignment_version_scopes rs where rs.version_id = ${v}.id and rs.team_id = ${p}.team_id and (rs.subteam_id is null or rs.subteam_id = ${p}.subteam_id)))
)`

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
}

/**
 * Alinhamentos da estrutura (`memberIds` = os liderados já resolvidos pelo escopo de quem lê). `includeEnded = false` (chat: "quais os
 * alinhamentos do time?") devolve só os em vigor e os que vão começar.
 */
export async function listStructureAlignments(db: Queryable, input: { organizationId: string; memberIds: readonly string[]; now?: Date; includeEnded?: boolean }): Promise<StructureAlignment[]> {
  if (input.memberIds.length === 0) return []
  const now = input.now ?? new Date()
  const rows = (await db.query<Row>(
    `select v.alignment_id, v.id version_id, v.version, v.title, v.guidance, v.justification, v.change_reason, v.affected_topic,
            (select array_agg(kd.title order by kd.title) from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = v.id) processes,
            pn.name product_name, v.operating_universe, v.scope_type, ${alignmentLinksSql("v")} links,
            v.starts_on::text starts_on, v.ends_on::text ends_on, v.time_zone, v.effective_from, v.effective_until, v.ended_at, v.published_at,
            pr.name responsible_name, v.responsible_job_title, pp.name published_by_name, pp.job_title published_by_job_title
     from operational_alignment_versions v
     join operational_alignments a on a.id = v.alignment_id and a.deleted_at is null
     join organizations o on o.id = v.organization_id
     left join product_catalog_nodes_all pn on pn.id = v.product_id
     left join people pr on pr.id = v.responsible_person_id
     left join people pp on pp.id = v.published_by
     where v.organization_id = $1 and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_until > v.effective_from
       and v.effective_until > $2::timestamptz - make_interval(months => ${MY_ALIGNMENTS_HISTORY_MONTHS})
       and exists (select 1 from people p where p.id = any($3::uuid[]) and p.organization_id = $1 and p.active and ${alignmentReachesPersonSql("v", "p", "o")})
     order by v.published_at desc
     limit 1000`,
    [input.organizationId, now, [...input.memberIds]],
  )).rows
  const versions = rows.map((row) => ({ ...row, alignmentId: row.alignment_id, versionId: row.version_id, effectiveFrom: new Date(row.effective_from), effectiveUntil: new Date(row.effective_until), publishedAt: new Date(row.published_at), operatingUniverse: row.operating_universe, scopeType: row.scope_type, links: row.links ?? [] }))
  const picked = pickDisplayVersions(versions, now).filter((row) => input.includeEnded !== false || myAlignmentStateOf(row, now) !== "ENDED").slice(0, MY_ALIGNMENTS_LIMIT)
  if (picked.length === 0) return []
  // Alcance e leituras da versão mostrada, só entre as pessoas da estrutura: uma consulta para todos.
  const counts = new Map((await db.query<{ version_id: string; people: number; read: number }>(
    `select v.id version_id, count(distinct p.id)::int people, count(distinct r.person_id)::int read
     from operational_alignment_versions v
     join organizations o on o.id = v.organization_id
     join people p on p.id = any($2::uuid[]) and p.organization_id = v.organization_id and p.active and ${alignmentReachesPersonSql("v", "p", "o")}
     left join operational_alignment_reads r on r.version_id = v.id and r.person_id = p.id
     where v.id = any($1::uuid[])
     group by v.id`,
    [picked.map((row) => row.versionId), [...input.memberIds]],
  )).rows.map((row) => [row.version_id, { people: row.people, read: row.read }]))
  return picked.map((row) => {
    const state = myAlignmentStateOf(row, now)
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
      audienceLabel: audienceSummaryOf(row),
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      timeZone: row.time_zone,
      effectiveFrom: row.effectiveFrom.toISOString(),
      effectiveUntil: row.effectiveUntil.toISOString(),
      state,
      noLongerValidSince: state === "ENDED" ? civilDateOf(row.effectiveUntil, row.time_zone) : null,
      endedEarly: row.ended_at !== null,
      publishedAt: row.publishedAt.toISOString(),
      definedBy: row.responsible_name ? { name: row.responsible_name, jobTitle: row.responsible_job_title } : row.published_by_name ? { name: row.published_by_name, jobTitle: row.published_by_job_title } : null,
      reach: counts.get(row.version_id) ?? { people: 0, read: 0 },
    }
  })
}
