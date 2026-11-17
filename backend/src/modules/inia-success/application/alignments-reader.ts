import type { Database } from "../../../infrastructure/database/pool.js"
import { getManageableScopes, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { alignmentReferenceOf } from "../../operational-alignments/domain/operational-alignment.js"
import type { Queryable, SuccessQuery, SuccessViewer } from "./success-query.js"

/**
 * 7. ALINHAMENTOS OPERACIONAIS na tela de Indicadores de sucesso (17/11/2026). Permissão e alcance = os da tela de Alinhamentos
 * (`operational_alignments.manage`, Grupos/Subgrupos administrados; universo inteiro só com alcance da organização). Filtros da página:
 * período (datas civis no fuso da organização) e Grupo/Subgrupo do PÚBLICO do alinhamento. Excluídos não entram.
 *  - "vigentes no período" = versão publicada cujo intervalo cruza o período (a mais recente de cada alinhamento);
 *  - por área = Grupo do público (universo inteiro aparece como tal); quem mais faz = Grupo de quem CRIOU, entre os criados no período;
 *  - motivo do alinhamento, motivo do pedido do cliente (um alinhamento conta em cada assunto dele) e processos (bases) mais associados;
 *  - mais antigo ativo = o que está valendo HOJE há mais tempo (independe do período).
 */
export type Ranked = { key: string; label: string; count: number; share: number | null }
export type AlignmentsSummary = {
  inPeriod: number
  createdInPeriod: number
  activeNow: number
  oldestActive: { reference: string; title: string; audience: string; startsOn: string; endsOn: string; daysActive: number } | null
  byArea: Ranked[]
  byAuthorArea: Ranked[]
  byReason: Ranked[]
  byRequestReason: Ranked[]
  topProcesses: Ranked[]
  withoutReason: number
  withoutRequestReason: number
}

type Row = { alignment_id: string; version: number; title: string; operating_universe: string; scope_type: string; team_id: string | null; team_name: string | null; subteam_name: string | null; reason_name: string | null; subjects: string[] | null; processes: { id: string; title: string }[] | null; starts_on: string; ends_on: string; effective_from: Date; in_force_now: boolean }

const TOP = 10
const ranked = (counts: Map<string, { label: string; count: number }>, base: number): Ranked[] =>
  [...counts.entries()].map(([key, value]) => ({ key, label: value.label, count: value.count, share: base > 0 ? value.count / base : null })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")).slice(0, TOP)
const bump = (counts: Map<string, { label: string; count: number }>, key: string, label: string) => {
  const entry = counts.get(key) ?? { label, count: 0 }
  entry.count += 1
  counts.set(key, entry)
}

/** Visibilidade pelo alcance da permissão (o mesmo da lista de alinhamentos). `$` = próximo parâmetro. */
function visibility(scopes: ManageableScopes, alias: string, params: unknown[]): string {
  if (scopes.unrestricted || scopes.allTeams) return "true"
  params.push([...scopes.teamIds], [...scopes.subteamIds])
  return `((${alias}.scope_type = 'TEAM' and ${alias}.team_id = any($${params.length - 1}::uuid[])) or (${alias}.scope_type = 'SUBTEAM' and ${alias}.subteam_id = any($${params.length}::uuid[])))`
}

function audienceFilter(query: SuccessQuery, alias: string, params: unknown[]): string {
  if (query.subteamId) {
    params.push(query.subteamId)
    return `${alias}.subteam_id = $${params.length}::uuid`
  }
  if (query.teamId) {
    params.push(query.teamId)
    return `${alias}.team_id = $${params.length}::uuid`
  }
  return "true"
}

const audienceLabel = (row: Pick<Row, "scope_type" | "team_name" | "subteam_name" | "operating_universe">) =>
  row.scope_type === "UNIVERSE" ? `Todo o universo ${row.operating_universe}` : row.scope_type === "SUBTEAM" ? `${row.team_name ?? "—"} › ${row.subteam_name ?? "—"}` : (row.team_name ?? "—")

export async function alignmentsSummary(db: Queryable, viewer: SuccessViewer, query: SuccessQuery): Promise<AlignmentsSummary> {
  const scopes = await getManageableScopes(db as Database, { organizationId: viewer.organizationId, sub: viewer.accountId ?? "" }, "operational_alignments.manage")
  const params: unknown[] = [viewer.organizationId, query.from, query.to]
  const vis = visibility(scopes, "v", params)
  const audience = audienceFilter(query, "v", params)
  const rows = (await db.query<Row>(
    `with bounds as (
       select ($2::date)::timestamp at time zone analytics_org_timezone($1) starts, ($3::date + 1)::timestamp at time zone analytics_org_timezone($1) ends
     ), latest as (
       select distinct on (v.alignment_id) v.*
       from operational_alignment_versions v
       join operational_alignments a on a.id = v.alignment_id and a.deleted_at is null
       cross join bounds b
       where v.organization_id = $1 and v.status in ('PUBLISHED', 'SUPERSEDED') and v.effective_until > v.effective_from
         and ((v.effective_from < b.ends and v.effective_until > b.starts) or (v.effective_from <= now() and v.effective_until > now()))
         and ${vis} and ${audience}
       order by v.alignment_id, v.version desc
     )
     select v.alignment_id, v.version, v.title, v.operating_universe, v.scope_type, v.team_id, t.name team_name, st.name subteam_name, r.name reason_name,
            (select array_agg(sd.name order by sd.name) from operational_alignment_version_subjects vs join interaction_subject_definitions sd on sd.id = vs.subject_id where vs.version_id = v.id) subjects,
            (select json_agg(json_build_object('id', kd.id, 'title', kd.title)) from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = v.id) processes,
            v.starts_on::text starts_on, v.ends_on::text ends_on, v.effective_from,
            (v.effective_from <= now() and v.effective_until > now()) in_force_now,
            (v.effective_from < b.ends and v.effective_until > b.starts) in_period
     from latest v cross join bounds b
     left join teams t on t.id = v.team_id
     left join subteams st on st.id = v.subteam_id
     left join operational_alignment_reasons r on r.id = v.reason_id`,
    params,
  )).rows as (Row & { in_period: boolean })[]
  const inPeriod = rows.filter((row) => row.in_period)
  const byArea = new Map<string, { label: string; count: number }>()
  const byReason = new Map<string, { label: string; count: number }>()
  const byRequest = new Map<string, { label: string; count: number }>()
  const byProcess = new Map<string, { label: string; count: number }>()
  let withoutReason = 0
  let withoutRequestReason = 0
  for (const row of inPeriod) {
    bump(byArea, row.scope_type === "UNIVERSE" ? `UNIVERSE:${row.operating_universe}` : row.team_id ?? "—", row.scope_type === "UNIVERSE" ? `Todo o universo ${row.operating_universe}` : row.team_name ?? "—")
    if (row.reason_name) bump(byReason, row.reason_name, row.reason_name)
    else withoutReason += 1
    if ((row.subjects ?? []).length === 0) withoutRequestReason += 1
    for (const subject of row.subjects ?? []) bump(byRequest, subject, subject)
    for (const process of row.processes ?? []) bump(byProcess, process.id, process.title)
  }
  const active = rows.filter((row) => row.in_force_now).sort((a, b) => new Date(a.effective_from).getTime() - new Date(b.effective_from).getTime())
  const oldest = active[0] ?? null

  // Quem mais faz: Grupo de quem CRIOU (o da pessoa; sem Grupo, o do Subgrupo dela), entre os criados no período e no alcance.
  const authorParams: unknown[] = [viewer.organizationId, query.from, query.to]
  const authorVis = visibility(scopes, "v", authorParams)
  const authorAudience = audienceFilter(query, "v", authorParams)
  const authors = (await db.query<{ key: string | null; label: string | null; count: number }>(
    `with bounds as (
       select ($2::date)::timestamp at time zone analytics_org_timezone($1) starts, ($3::date + 1)::timestamp at time zone analytics_org_timezone($1) ends
     ), created as (
       select distinct on (a.id) a.id, a.created_by
       from operational_alignments a
       join operational_alignment_versions v on v.alignment_id = a.id
       cross join bounds b
       where a.organization_id = $1 and a.deleted_at is null and a.created_at >= b.starts and a.created_at < b.ends and ${authorVis} and ${authorAudience}
       order by a.id, v.version
     )
     select coalesce(p.team_id, st.team_id)::text key, t.name label, count(*)::int count
     from created c
     left join people p on p.id = c.created_by
     left join subteams st on st.id = p.subteam_id
     left join teams t on t.id = coalesce(p.team_id, st.team_id)
     group by 1, 2`,
    authorParams,
  )).rows
  const createdInPeriod = authors.reduce((sum, row) => sum + row.count, 0)
  const byAuthorArea = new Map(authors.map((row) => [row.key ?? "—", { label: row.label ?? "Sem Grupo no cadastro (liderança)", count: row.count }]))

  return {
    inPeriod: inPeriod.length,
    createdInPeriod,
    activeNow: active.length,
    oldestActive: oldest ? { reference: alignmentReferenceOf(oldest.alignment_id, oldest.version), title: oldest.title, audience: audienceLabel(oldest), startsOn: oldest.starts_on, endsOn: oldest.ends_on, daysActive: Math.max(0, Math.floor((Date.now() - new Date(oldest.effective_from).getTime()) / 86_400_000)) } : null,
    byArea: ranked(byArea, inPeriod.length),
    byAuthorArea: ranked(byAuthorArea, createdInPeriod),
    byReason: ranked(byReason, inPeriod.length),
    byRequestReason: ranked(byRequest, inPeriod.length),
    topProcesses: ranked(byProcess, inPeriod.length),
    withoutReason,
    withoutRequestReason,
  }
}
