import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { respondList, searchParam, SqlFilter, type PageResult } from "../../../shared/presentation/list-query.js"
import { canManageScope, coversOrganization, type ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { checkResponse, type ResponseCheckResult } from "../../governance/application/response-compliance.js"
import { loadUniverseAccess, universeForbidden } from "../../operating-universe/application/universe-access.js"
import type { OperatingUniverse } from "../../operating-universe/domain/operating-universe.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import {
  alignmentInputSchema,
  alignmentReferenceOf,
  audiencesOverlap,
  contentHashOf,
  daysBetween,
  isUnresolvableConflict,
  MAX_ALIGNMENT_DAYS,
  normalizedScope,
  periodsOverlap,
  scopeSpecificityOf,
  type AlignmentInput,
  type AlignmentRelation,
  type AlignmentScopeType,
  type AlignmentStatus,
} from "../domain/operational-alignment.js"
import { alignmentChangesOf, recordAlignmentEvent } from "./alignment-audit.js"

/**
 * CADASTRO DOS ALINHAMENTOS OPERACIONAIS (`/api/v1/admin/operational-alignments`, permissão `operational_alignments.manage` — papel
 * Gestor de alinhamentos, e também Administrador geral e Administrador — com o ESCOPO decidido aqui: universo inteiro só com alcance da
 * organização; Grupo/Subgrupo só nos administrados). Um alinhamento é sempre de um ou mais PROCESSOS (bases de procedimento) e pode
 * trazer orientação nova ou mudar um trecho. Rascunho → publicar (versão imutável, processos inclusos) → encerrar. Alterar um publicado
 * = nova versão em rascunho que, publicada, substitui a anterior a partir do início dela. Nada apaga o histórico; tudo vai para
 * `audit_logs`.
 */
export type AlignmentActor = { organizationId: string; personId: string | null; accountId: string }

/** Conferência de assunto proibido (injetável nos testes; produção usa a conferência da Governança). */
export type ProhibitedTopicCheck = (db: Pick<Database, "query">, input: { organizationId: string; text: string }) => Promise<ResponseCheckResult>
export const governanceProhibitedTopicCheck: ProhibitedTopicCheck = (db, input) => checkResponse(db, { organizationId: input.organizationId, text: input.text, agentId: null, source: "OPERATIONAL_ALIGNMENT" })

type Queryable = Pick<Database, "query">

const requirePerson = (actor: AlignmentActor): string => {
  if (!actor.personId) throw new DomainError("Sua conta não está vinculada a um colaborador: não é possível registrar quem publicou.", "OPERATIONAL_ALIGNMENT_ACTOR_REQUIRED", 403)
  return actor.personId
}

async function audit(db: Queryable, actor: AlignmentActor, action: string, entityId: string, payload: Record<string, unknown>) {
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'operational_alignment', $4, $5)`, [actor.organizationId, actor.personId, action, entityId, JSON.stringify(payload)])
}

type ProcessRef = { id: string; title: string; documentType: string | null; operatingUniverse: string | null }

type VersionRow = {
  id: string
  alignment_id: string
  version: number
  status: AlignmentStatus
  title: string
  guidance: string
  documents: ProcessRef[] | null
  reason_id: string | null
  reason_name: string | null
  request_subjects: { id: string; name: string }[] | null
  affected_topic: string | null
  justification: string
  operating_universe: OperatingUniverse
  scope_type: AlignmentScopeType
  team_id: string | null
  team_name: string | null
  subteam_id: string | null
  subteam_name: string | null
  product_id: string | null
  product_name: string | null
  starts_on: string
  ends_on: string
  time_zone: string
  effective_from: Date
  effective_until: Date
  content_hash: string
  change_reason: string | null
  created_by_name: string | null
  responsible_person_id: string | null
  responsible_name: string | null
  responsible_job_title: string | null
  created_at: Date
  updated_by_name: string | null
  updated_at: Date | null
  published_by_name: string | null
  published_at: Date | null
  superseded_at: Date | null
  ended_by_name: string | null
  ended_at: Date | null
  end_reason: string | null
}

const DOCUMENTS_OF_VERSION = (alias: string) =>
  `(select json_agg(json_build_object('id', kd.id, 'title', kd.title, 'documentType', kd.document_type, 'operatingUniverse', kd.operating_universe) order by kd.title) from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = ${alias}.id)`

const VERSION_SELECT = `
  select v.id, v.alignment_id, v.version, v.status, v.title, v.guidance, ${DOCUMENTS_OF_VERSION("v")} documents, v.reason_id, rr.name reason_name,
         (select json_agg(json_build_object('id', sd.id, 'name', sd.name) order by sd.name) from operational_alignment_version_subjects vs join interaction_subject_definitions sd on sd.id = vs.subject_id where vs.version_id = v.id) request_subjects,
         v.affected_topic, v.justification,
         v.operating_universe, v.scope_type, v.team_id, t.name team_name, v.subteam_id, st.name subteam_name, v.product_id, pn.name product_name,
         v.starts_on::text starts_on, v.ends_on::text ends_on, v.time_zone, v.effective_from, v.effective_until, v.content_hash, v.change_reason,
         pc.name created_by_name, v.responsible_person_id, pr.name responsible_name, v.responsible_job_title, v.created_at, pu.name updated_by_name, v.updated_at, pp.name published_by_name, v.published_at, v.superseded_at,
         pe.name ended_by_name, v.ended_at, v.end_reason
  from operational_alignment_versions v
  left join operational_alignment_reasons rr on rr.id = v.reason_id
  left join teams t on t.id = v.team_id
  left join subteams st on st.id = v.subteam_id
  left join product_catalog_nodes_all pn on pn.id = v.product_id
  left join people pc on pc.id = v.created_by
  left join people pr on pr.id = v.responsible_person_id
  left join people pu on pu.id = v.updated_by
  left join people pp on pp.id = v.published_by
  left join people pe on pe.id = v.ended_by`

/** Situação do alinhamento para a tela (calculada, nunca gravada). */
export type AlignmentState = "DRAFT" | "SCHEDULED" | "IN_FORCE" | "ENDED" | "CANCELLED"
function stateOf(current: VersionRow | null, draft: VersionRow | null, now: Date): AlignmentState {
  if (!current) return draft ? "DRAFT" : "CANCELLED"
  if (current.status === "CANCELLED") return "CANCELLED"
  if (now.getTime() < new Date(current.effective_from).getTime()) return "SCHEDULED"
  if (now.getTime() < new Date(current.effective_until).getTime()) return "IN_FORCE"
  return "ENDED"
}

const versionView = (row: VersionRow) => ({
  id: row.id,
  version: row.version,
  reference: alignmentReferenceOf(row.alignment_id, row.version),
  status: row.status,
  title: row.title,
  guidance: row.guidance,
  processes: row.documents ?? [],
  reason: row.reason_id ? { id: row.reason_id, name: row.reason_name ?? "" } : null,
  requestReasons: row.request_subjects ?? [],
  affectedTopic: row.affected_topic,
  justification: row.justification,
  operatingUniverse: row.operating_universe,
  scopeType: row.scope_type,
  team: row.team_id ? { id: row.team_id, name: row.team_name ?? "" } : null,
  subteam: row.subteam_id ? { id: row.subteam_id, name: row.subteam_name ?? "" } : null,
  product: row.product_id ? { id: row.product_id, name: row.product_name ?? "" } : null,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  timeZone: row.time_zone,
  effectiveFrom: new Date(row.effective_from).toISOString(),
  effectiveUntil: new Date(row.effective_until).toISOString(),
  contentHash: row.content_hash,
  changeReason: row.change_reason,
  createdBy: row.created_by_name,
  // Quem definiu (221); null nas versões anteriores — a tela e o chat mostram quem publicou.
  responsible: row.responsible_person_id ? { id: row.responsible_person_id, name: row.responsible_name ?? "", jobTitle: row.responsible_job_title } : null,
  createdAt: new Date(row.created_at).toISOString(),
  updatedBy: row.updated_by_name,
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  publishedBy: row.published_by_name,
  publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
  supersededAt: row.superseded_at ? new Date(row.superseded_at).toISOString() : null,
  endedBy: row.ended_by_name,
  endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
  endReason: row.end_reason,
})
export type AlignmentVersionView = ReturnType<typeof versionView>

/**
 * Alcance de quem administra alinhamentos: os Grupos/Subgrupos de `operational_alignments.manage` e, com o universo ativado na
 * organização, os universos da pessoa (`operating_universes.all` = todos). `universes` ausente/null = sem filtro de universo.
 */
export type AlignmentScopes = ManageableScopes & { universes?: readonly OperatingUniverse[] | null }

const canSee = (scopes: AlignmentScopes, row: Pick<VersionRow, "scope_type" | "team_id" | "subteam_id" | "operating_universe">) =>
  (!scopes.universes || scopes.universes.includes(row.operating_universe)) &&
  canManageScope(scopes, { scopeType: row.scope_type === "UNIVERSE" ? "ALL_TEAMS" : row.scope_type, teamId: row.team_id, subteamId: row.subteam_id })

/** Versões que DECIDEM o alinhamento hoje: a publicada/cancelada e o rascunho (as substituídas ficam só no histórico). */
const governingVersions = (versions: readonly VersionRow[]) => versions.filter((version) => version.status !== "SUPERSEDED")

/** Universos de quem administra (null = organização sem a exigência ativada: nada filtrado por universo). */
export async function alignmentUniversesOf(db: Queryable, user: { organizationId: string; sub: string; personId: string | null }): Promise<readonly OperatingUniverse[] | null> {
  const access = await loadUniverseAccess(db, { organizationId: user.organizationId, sub: user.sub, personId: user.personId ?? "00000000-0000-0000-0000-000000000000" })
  return access.enforced ? access.universes : null
}

async function loadVersions(db: Queryable, organizationId: string, alignmentIds: readonly string[]): Promise<Map<string, VersionRow[]>> {
  if (alignmentIds.length === 0) return new Map()
  const rows = (await db.query<VersionRow>(`${VERSION_SELECT} where v.organization_id = $1 and v.alignment_id = any($2::uuid[]) order by v.version desc`, [organizationId, [...alignmentIds]])).rows
  const map = new Map<string, VersionRow[]>()
  for (const row of rows) map.set(row.alignment_id, [...(map.get(row.alignment_id) ?? []), row])
  return map
}

function summaryOf(alignmentId: string, versions: readonly VersionRow[], now: Date) {
  const draft = versions.find((version) => version.status === "DRAFT") ?? null
  const current = versions.find((version) => version.status === "PUBLISHED" || version.status === "CANCELLED") ?? null
  const shown = current ?? draft ?? versions[0]!
  return { id: alignmentId, state: stateOf(current, draft, now), hasDraft: draft !== null, current: current ? versionView(current) : null, draft: draft ? versionView(draft) : null, shown: versionView(shown) }
}

// ---------------------------------------------------------------------------------------------
// LISTA (paginada no servidor, como as demais telas da Administração)
// ---------------------------------------------------------------------------------------------

const ALIGNMENT_STATES = ["DRAFT", "SCHEDULED", "IN_FORCE", "ENDED", "CANCELLED"] as const
const listQuerySchema = z
  .object({
    search: searchParam,
    state: z.enum(ALIGNMENT_STATES).optional(),
    operatingUniverse: z.enum(["B2B", "B2C", "B2X"]).optional(),
    documentId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    subteamId: z.string().uuid().optional(),
    // "Todo o universo" do filtro de Grupo (mesmo valor que o filtro compartilhado manda para "globais").
    scopeType: z.enum(["ALL_TEAMS"]).optional(),
    hasDraft: z.preprocess((value) => (value === "true" ? true : value === "false" ? false : undefined), z.boolean().optional()),
  })
  .passthrough()

/**
 * Uma linha por alinhamento: a versão MOSTRADA (a publicada/cancelada; sem ela, o rascunho), a situação calculada no banco e os
 * processos dela (contagem + os primeiros títulos para a tabela). A busca cobre título, processos, Grupo/Subgrupo e produto.
 */
const LIST_SELECT = `
  select a.id, s.id "versionId", s.version, s.title, s.operating_universe "operatingUniverse", s.scope_type "scopeType", s.team_id "teamId", t.name "teamName",
         s.subteam_id "subteamId", st.name "subteamName", pn.name "productName", rr.name "reasonName", s.starts_on::text "startsOn", s.ends_on::text "endsOn", s.affected_topic "affectedTopic",
         exists (select 1 from operational_alignment_versions d where d.alignment_id = a.id and d.status = 'DRAFT') "hasDraft",
         case when s.status = 'DRAFT' then 'DRAFT' when s.status = 'CANCELLED' then 'CANCELLED' when now() < s.effective_from then 'SCHEDULED' when now() < s.effective_until then 'IN_FORCE' else 'ENDED' end state,
         (select count(*)::int from operational_alignment_version_documents vd where vd.version_id = s.id) "processCount",
         (select coalesce(json_agg(x.title order by x.title), '[]'::json) from (select kd.title from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = s.id order by kd.title limit 3) x) "processTitles",
         (select string_agg(kd.title, ' ') from operational_alignment_version_documents vd join knowledge_documents kd on kd.id = vd.document_id where vd.version_id = s.id) "searchProcesses",
         (select array_agg(vd.document_id) from operational_alignment_version_documents vd where vd.version_id = s.id) "documentIds",
         coalesce(s.published_at, s.updated_at, s.created_at) "updatedAt"
  from operational_alignments a
  join lateral (
    select v.* from operational_alignment_versions v where v.alignment_id = a.id
    order by case v.status when 'PUBLISHED' then 0 when 'CANCELLED' then 1 when 'DRAFT' then 2 else 3 end, v.version desc limit 1
  ) s on true
  left join teams t on t.id = s.team_id
  left join subteams st on st.id = s.subteam_id
  left join product_catalog_nodes_all pn on pn.id = s.product_id
  left join operational_alignment_reasons rr on rr.id = s.reason_id
  where a.organization_id = $1 and a.deleted_at is null`

type ListRow = { id: string; versionId: string; version: number; title: string; reasonName: string | null; operatingUniverse: OperatingUniverse; scopeType: AlignmentScopeType; teamId: string | null; teamName: string | null; subteamId: string | null; subteamName: string | null; productName: string | null; startsOn: string; endsOn: string; affectedTopic: string | null; hasDraft: boolean; state: AlignmentState; processCount: number; processTitles: string[]; searchProcesses: string | null; documentIds: string[] | null; updatedAt: Date }

export async function listAlignments(db: Database, organizationId: string, scopes: AlignmentScopes, query: Record<string, unknown>) {
  const input = listQuerySchema.parse(query ?? {})
  const filter = new SqlFilter([organizationId])
    .search(input.search, ["q.title", 'q."searchProcesses"', 'q."teamName"', 'q."subteamName"', 'q."productName"', 'q."affectedTopic"', 'q."reasonName"'])
    .equals("q.state", input.state)
    .equals('q."operatingUniverse"', input.operatingUniverse)
  if (input.hasDraft !== undefined) filter.add(input.hasDraft ? `q."hasDraft"` : `not q."hasDraft"`)
  if (input.documentId) filter.add(`${filter.param(input.documentId)}::uuid = any(q."documentIds")`)
  if (input.subteamId) filter.add(`q."subteamId" = ${filter.param(input.subteamId)}::uuid`)
  else if (input.teamId) filter.add(`q."teamId" = ${filter.param(input.teamId)}::uuid`)
  else if (input.scopeType === "ALL_TEAMS") filter.add(`q."scopeType" = 'UNIVERSE'`)
  // Visibilidade = o que a pessoa administra (o mesmo de `canManageScope`): universo inteiro só com alcance da organização.
  // A mesma regra do detalhe (`loadAlignmentOrThrow`): toda versão que decide o alinhamento (publicada/cancelada e rascunho) no alcance.
  const outside: string[] = []
  if (!scopes.unrestricted && !scopes.allTeams) {
    outside.push(`not ((g.scope_type = 'TEAM' and g.team_id = any(${filter.param([...scopes.teamIds])}::uuid[])) or (g.scope_type = 'SUBTEAM' and g.subteam_id = any(${filter.param([...scopes.subteamIds])}::uuid[])))`)
  }
  if (scopes.universes) outside.push(`not (g.operating_universe = any(${filter.param([...scopes.universes])}::text[]))`)
  if (outside.length > 0) {
    filter.add(`not exists (select 1 from operational_alignment_versions g where g.alignment_id = q.id and g.status <> 'SUPERSEDED' and (${outside.join(" or ")}))`)
  }
  const data = await respondList<ListRow>(db, query, { select: LIST_SELECT, filter, orderBy: `case q.state when 'IN_FORCE' then 0 when 'SCHEDULED' then 1 when 'DRAFT' then 2 else 3 end, q."updatedAt" desc, q.id` })
  // Colunas só de filtro (busca pelos títulos, ids dos processos) não saem na resposta.
  const decorate = (row: ListRow) => {
    const { searchProcesses, documentIds, ...visible } = row
    void searchProcesses
    void documentIds
    return { ...visible, reference: alignmentReferenceOf(row.id, row.version), updatedAt: new Date(row.updatedAt).toISOString() }
  }
  return Array.isArray(data) ? data.map(decorate) : ({ ...data, items: data.items.map(decorate) } satisfies PageResult<ReturnType<typeof decorate>>)
}

// ---------------------------------------------------------------------------------------------
// PROCESSOS (bases de procedimento) para o seletor — mais de mil: busca e páginas no servidor
// ---------------------------------------------------------------------------------------------

const processQuerySchema = z
  .object({
    search: searchParam,
    documentType: z.enum(["PROCEDURE", "MANUAL", "FAQ", "RULE", "FLOW", "WORK_INSTRUCTION"]).optional(),
    operatingUniverse: z.enum(["B2B", "B2C", "B2X"]).optional(),
    ids: z.preprocess((value) => (typeof value === "string" && value ? value.split(",") : Array.isArray(value) ? value : undefined), z.array(z.string().uuid()).max(300).optional()),
  })
  .passthrough()

/**
 * Processos que podem receber um alinhamento: bases da organização, não excluídas, com versão publicada (é o que o chat e a monitoria
 * leem). Com `operatingUniverse`, só as do universo ou ainda sem universo. `ids` = buscar estes (títulos dos já incluídos). Somente
 * leitura de título, tipo, universo e atualização — nunca o conteúdo.
 */
export async function listProcessOptions(db: Database, organizationId: string, query: Record<string, unknown>, universes: readonly OperatingUniverse[] | null = null) {
  const input = processQuerySchema.parse(query ?? {})
  const select = `
    select kd.id, kd.title, kd.document_type "documentType", kd.operating_universe "operatingUniverse",
           (select max(v.published_at) from knowledge_versions v where v.document_id = kd.id and v.status = 'PUBLISHED') "publishedAt"
    from knowledge_documents kd
    where kd.organization_id = $1 and kd.deleted_at is null
      and exists (select 1 from knowledge_versions v where v.document_id = kd.id and v.status = 'PUBLISHED')`
  const filter = new SqlFilter([organizationId]).search(input.search, ["q.title"]).equals('q."documentType"', input.documentType)
  if (input.operatingUniverse) filter.add(`(q."operatingUniverse" is null or q."operatingUniverse" = ${filter.param(input.operatingUniverse)})`)
  // Universo ativado: só processos dos universos da pessoa (ou ainda sem universo).
  if (universes) filter.add(`(q."operatingUniverse" is null or q."operatingUniverse" = any(${filter.param([...universes])}::text[]))`)
  if (input.ids) filter.add(`q.id = any(${filter.param(input.ids)}::uuid[])`)
  return respondList<{ id: string; title: string; documentType: string; operatingUniverse: string | null; publishedAt: Date | null }>(db, input.ids ? query : { pageSize: 20, ...query }, { select, filter, orderBy: "q.title, q.id" })
}

// ---------------------------------------------------------------------------------------------
// DETALHE
// ---------------------------------------------------------------------------------------------

async function loadAlignmentOrThrow(db: Queryable, organizationId: string, scopes: AlignmentScopes, id: string): Promise<VersionRow[]> {
  if (!z.string().uuid().safeParse(id).success) throw new DomainError("Alinhamento não encontrado.", "OPERATIONAL_ALIGNMENT_NOT_FOUND", 404)
  const exists = (await db.query(`select 1 from operational_alignments where id = $1 and organization_id = $2 and deleted_at is null`, [id, organizationId])).rowCount
  const versions = exists ? (await loadVersions(db, organizationId, [id])).get(id) ?? [] : []
  // Fora do escopo = inexistente (não revela que o alinhamento existe em outro Grupo).
  // TODAS as versões que decidem o alinhamento (publicada/cancelada e rascunho) precisam estar no alcance — Grupo/Subgrupo e universo.
  // Uma versão antiga do próprio Grupo não dá acesso a um alinhamento que hoje vale para outro público (PUB-01/PUB-02, run-5).
  const governing = governingVersions(versions)
  if (governing.length === 0 || !governing.every((version) => canSee(scopes, version))) throw new DomainError("Alinhamento não encontrado.", "OPERATIONAL_ALIGNMENT_NOT_FOUND", 404)
  return versions
}

export async function getAlignment(db: Queryable, organizationId: string, scopes: AlignmentScopes, id: string, now = new Date()) {
  const versions = await loadAlignmentOrThrow(db, organizationId, scopes, id)
  const relations = (await db.query<{ version_id: string; other_alignment_id: string; other_title: string | null; relation: AlignmentRelation; decided_by: string | null; decided_at: Date }>(
    `select r.version_id, r.other_alignment_id, (select v.title from operational_alignment_versions v where v.alignment_id = r.other_alignment_id order by v.version desc limit 1) other_title, r.relation, p.name decided_by, r.decided_at
     from operational_alignment_relations r left join people p on p.id = r.decided_by where r.version_id = any($1::uuid[])`,
    [versions.map((version) => version.id)],
  )).rows
  return {
    ...summaryOf(id, versions, now),
    versions: versions.map((version) => ({ ...versionView(version), relations: relations.filter((relation) => relation.version_id === version.id).map((relation) => ({ otherAlignmentId: relation.other_alignment_id, otherReference: alignmentReferenceOf(relation.other_alignment_id, 1).replace(/ v1$/, ""), otherTitle: relation.other_title, relation: relation.relation, decidedBy: relation.decided_by, decidedAt: new Date(relation.decided_at).toISOString() })) })),
  }
}

// ---------------------------------------------------------------------------------------------
// ESCRITA
// ---------------------------------------------------------------------------------------------

/** Escopo + universo + processos: tudo conferido no backend, com os dados do banco (nunca o que a tela diz). */
async function assertInputAllowed(db: Queryable, actor: AlignmentActor & { sub: string }, scopes: AlignmentScopes, input: AlignmentInput): Promise<AlignmentInput & { responsibleJobTitle: string | null }> {
  const scope = normalizedScope(input)
  if (scope.scopeType === "UNIVERSE" && !coversOrganization(scopes)) throw new DomainError("Só quem administra a organização inteira publica um alinhamento para todo o universo. Escolha um Grupo ou Subgrupo.", "OPERATIONAL_ALIGNMENT_SCOPE_FORBIDDEN", 403)
  let teamId = scope.teamId
  let groupUniverse: string | null = null
  if (scope.scopeType === "SUBTEAM") {
    const subteam = (await db.query<{ team_id: string; universe: string | null }>(`select st.team_id, coalesce(st.operating_universe, t.operating_universe) universe from subteams st join teams t on t.id = st.team_id where st.id = $1 and st.organization_id = $2`, [scope.subteamId, actor.organizationId])).rows[0]
    if (!subteam || (scope.teamId !== null && scope.teamId !== subteam.team_id)) throw new DomainError("Subgrupo não encontrado nesta organização.", "OPERATIONAL_ALIGNMENT_SCOPE_INVALID", 422)
    teamId = subteam.team_id
    groupUniverse = subteam.universe
  } else if (scope.scopeType === "TEAM") {
    const team = (await db.query<{ universe: string | null }>(`select operating_universe universe from teams where id = $1 and organization_id = $2`, [scope.teamId, actor.organizationId])).rows[0]
    if (!team) throw new DomainError("Grupo não encontrado nesta organização.", "OPERATIONAL_ALIGNMENT_SCOPE_INVALID", 422)
    groupUniverse = team.universe
  }
  if (!canManageScope(scopes, { scopeType: scope.scopeType === "UNIVERSE" ? "ALL_TEAMS" : scope.scopeType, teamId, subteamId: scope.subteamId })) throw new DomainError("Você não administra este Grupo/Subgrupo.", "OPERATIONAL_ALIGNMENT_SCOPE_FORBIDDEN", 403)
  // Público por Grupo/Subgrupo exige o universo classificado: sem ele, os operadores podem ficar sem universo e o filtro da tela não
  // consegue garantir que o Grupo é do universo escolhido.
  if (scope.scopeType !== "UNIVERSE" && !groupUniverse) throw new DomainError("Este Grupo/Subgrupo ainda não tem universo de atuação. Classifique-o em Administração › Universo de atuação antes de publicar um alinhamento para ele.", "OPERATIONAL_ALIGNMENT_GROUP_UNCLASSIFIED", 422)
  if (groupUniverse && groupUniverse !== input.operatingUniverse) throw new DomainError(`O público escolhido é do universo ${groupUniverse}; o alinhamento está marcado como ${input.operatingUniverse}. Universos são separados.`, "OPERATIONAL_ALIGNMENT_UNIVERSE_CONFLICT", 409)
  const access = await loadUniverseAccess(db, { organizationId: actor.organizationId, sub: actor.sub, personId: actor.personId ?? "00000000-0000-0000-0000-000000000000" })
  if (access.enforced && !access.universes.includes(input.operatingUniverse)) throw universeForbidden()
  const documents = (await db.query<{ id: string; title: string; operating_universe: string | null }>(`select id, title, operating_universe from knowledge_documents where id = any($1::uuid[]) and organization_id = $2 and deleted_at is null`, [input.affectedDocumentIds, actor.organizationId])).rows
  if (documents.length !== input.affectedDocumentIds.length) throw new DomainError("Algum processo escolhido não foi encontrado nas bases desta organização.", "OPERATIONAL_ALIGNMENT_DOCUMENT_NOT_FOUND", 422, { missing: input.affectedDocumentIds.filter((id) => !documents.some((document) => document.id === id)) })
  const otherUniverse = documents.filter((document) => document.operating_universe && document.operating_universe !== input.operatingUniverse)
  if (otherUniverse.length > 0) throw new DomainError(`Processo de outro universo: ${otherUniverse.map((document) => `"${document.title}" (${document.operating_universe})`).join(", ")}. O alinhamento está marcado como ${input.operatingUniverse}.`, "OPERATIONAL_ALIGNMENT_UNIVERSE_CONFLICT", 409, { documents: otherUniverse.map((document) => document.id) })
  if (input.productId) {
    const product = (await db.query<{ kind: string; active: boolean; operating_universe: string | null }>(`select kind, active, operating_universe from product_catalog_nodes where id = $1 and organization_id = $2`, [input.productId, actor.organizationId])).rows[0]
    if (!product || product.kind !== "PRODUCT" || !product.active) throw new DomainError("Produto não encontrado ou inativo.", "OPERATIONAL_ALIGNMENT_PRODUCT_NOT_FOUND", 422)
    if (product.operating_universe && product.operating_universe !== input.operatingUniverse) throw new DomainError(`O produto é do universo ${product.operating_universe}; o alinhamento está marcado como ${input.operatingUniverse}.`, "OPERATIONAL_ALIGNMENT_UNIVERSE_CONFLICT", 409)
  }
  const reason = (await db.query<{ active: boolean }>(`select active from operational_alignment_reasons where id = $1 and organization_id = $2`, [input.reasonId, actor.organizationId])).rows[0]
  if (!reason || !reason.active) throw new DomainError("Motivo do alinhamento não encontrado ou desativado. Escolha outro.", "OPERATIONAL_ALIGNMENT_REASON_NOT_FOUND", 422)
  if (input.requestSubjectIds.length > 0) {
    const subjects = (await db.query<{ id: string }>(`select id from interaction_subject_definitions where id = any($1::uuid[]) and organization_id = $2 and active`, [input.requestSubjectIds, actor.organizationId])).rows
    if (subjects.length !== input.requestSubjectIds.length) throw new DomainError("Algum motivo do pedido do cliente não foi encontrado ou está desativado.", "OPERATIONAL_ALIGNMENT_REQUEST_REASON_NOT_FOUND", 422)
  }
  if (daysBetween(input.startsOn, input.endsOn) > MAX_ALIGNMENT_DAYS) throw new DomainError(`Um alinhamento é temporário: a vigência vai até ${MAX_ALIGNMENT_DAYS} dias. Para uma mudança permanente, atualize a base oficial.`, "OPERATIONAL_ALIGNMENT_PERIOD_TOO_LONG", 422)
  const responsible = await responsibleOf(db, actor, input.responsiblePersonId)
  return { ...input, ...scope, teamId, responsiblePersonId: responsible.id, responsibleJobTitle: responsible.jobTitle }
}

/**
 * Responsável pela orientação (221): pessoa ATIVA da organização que lidera alguém (quem decide uma orientação de equipe) ou quem está
 * cadastrando. Sem escolha = quem cadastra. O cargo é o do cadastro (`people.job_title`, o da ficha), copiado agora.
 */
async function responsibleOf(db: Queryable, actor: AlignmentActor, personId: string | null): Promise<{ id: string; jobTitle: string | null }> {
  const id = personId ?? actor.personId!
  const row = (await db.query<{ job_title: string | null; eligible: boolean }>(
    `select p.job_title, (p.id = $3 or exists (select 1 from people r where r.organization_id = p.organization_id and r.reports_to_id = p.id and r.active)) eligible
     from people p where p.id = $1 and p.organization_id = $2 and p.active`,
    [id, actor.organizationId, actor.personId],
  )).rows[0]
  if (!row || !row.eligible) throw new DomainError("Responsável inválido: escolha uma liderança ativa da organização (ou deixe você mesmo).", "OPERATIONAL_ALIGNMENT_RESPONSIBLE_INVALID", 422)
  return { id, jobTitle: row.job_title?.trim() ? row.job_title.trim().slice(0, 200) : null }
}

/** Opções de responsável: lideranças ativas (com alguém abaixo) da organização, pelo nome — e quem está cadastrando. */
export async function responsibleOptions(db: Queryable, actor: AlignmentActor, query: Record<string, unknown>) {
  const search = typeof query.search === "string" ? query.search.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().slice(0, 80) : ""
  const rows = (await db.query<{ id: string; name: string; job_title: string | null }>(
    `select p.id::text id, p.name, p.job_title from people p
     where p.organization_id = $1 and p.active
       and (p.id = $2 or exists (select 1 from people r where r.organization_id = p.organization_id and r.reports_to_id = p.id and r.active))
       and ($3 = '' or translate(lower(p.name), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') like '%' || $3 || '%')
     order by (p.id = $2) desc, p.name limit 20`,
    [actor.organizationId, actor.personId, search],
  )).rows
  return rows.map((row) => ({ id: row.id, name: row.name, jobTitle: row.job_title }))
}

/** Datas civis → instantes no fuso da organização (início 00:00 inclusivo; término inclusivo = 00:00 do dia seguinte, exclusivo). */
async function intervalOf(db: Queryable, organizationId: string, startsOn: string, endsOn: string) {
  const timeZone = await resolveOrganizationTimezone(db, organizationId)
  const row = (await db.query<{ effective_from: Date; effective_until: Date }>(`select ($1::date::timestamp at time zone $3) effective_from, (($2::date + 1)::timestamp at time zone $3) effective_until`, [startsOn, endsOn, timeZone])).rows[0]!
  return { timeZone, effectiveFrom: new Date(row.effective_from), effectiveUntil: new Date(row.effective_until) }
}

/** Imagem comparável de um rascunho/versão (para o rastro: o que mudou e quais processos entraram/saíram). */
const imageOfInput = (input: AlignmentInput) => {
  const scope = normalizedScope(input)
  return { fields: { title: input.title, guidance: input.guidance, responsiblePersonId: input.responsiblePersonId, reasonId: input.reasonId, requestSubjectIds: [...input.requestSubjectIds].sort(), affectedTopic: input.affectedTopic, justification: input.justification, operatingUniverse: input.operatingUniverse, scopeType: scope.scopeType, teamId: scope.teamId, subteamId: scope.subteamId, productId: input.productId, startsOn: input.startsOn, endsOn: input.endsOn, changeReason: input.changeReason }, processes: [...input.affectedDocumentIds].sort() }
}
const imageOfRow = (row: VersionRow) => ({ fields: { title: row.title, guidance: row.guidance, responsiblePersonId: row.responsible_person_id, reasonId: row.reason_id, requestSubjectIds: (row.request_subjects ?? []).map((subject) => subject.id).sort(), affectedTopic: row.affected_topic, justification: row.justification, operatingUniverse: row.operating_universe, scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id, productId: row.product_id, startsOn: row.starts_on, endsOn: row.ends_on, changeReason: row.change_reason }, processes: (row.documents ?? []).map((document) => document.id).sort() })

async function replaceDocuments(db: Queryable, organizationId: string, versionId: string, documentIds: readonly string[]) {
  await db.query(`delete from operational_alignment_version_documents where version_id = $1`, [versionId])
  await db.query(`insert into operational_alignment_version_documents (version_id, document_id, organization_id) select $1, unnest($2::uuid[]), $3`, [versionId, [...documentIds], organizationId])
}

async function replaceSubjects(db: Queryable, organizationId: string, versionId: string, subjectIds: readonly string[]) {
  await db.query(`delete from operational_alignment_version_subjects where version_id = $1`, [versionId])
  if (subjectIds.length > 0) await db.query(`insert into operational_alignment_version_subjects (version_id, subject_id, organization_id) select $1, unnest($2::uuid[]), $3`, [versionId, [...subjectIds], organizationId])
}

type CheckedInput = AlignmentInput & { responsibleJobTitle?: string | null }

async function insertDraft(db: Queryable, actor: AlignmentActor, alignmentId: string, version: number, input: CheckedInput) {
  const interval = await intervalOf(db, actor.organizationId, input.startsOn, input.endsOn)
  const scope = normalizedScope(input)
  const row = (await db.query<{ id: string }>(
    `insert into operational_alignment_versions (organization_id, alignment_id, version, status, title, guidance, affected_topic, justification, operating_universe, scope_type, team_id, subteam_id, product_id, starts_on, ends_on, time_zone, effective_from, effective_until, content_hash, change_reason, created_by, reason_id, responsible_person_id, responsible_job_title)
     values ($1,$2,$3,'DRAFT',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) returning id`,
    [actor.organizationId, alignmentId, version, input.title, input.guidance, input.affectedTopic, input.justification, input.operatingUniverse, scope.scopeType, scope.teamId, scope.subteamId, input.productId, input.startsOn, input.endsOn, interval.timeZone, interval.effectiveFrom, interval.effectiveUntil, contentHashOf(input), input.changeReason, requirePerson(actor), input.reasonId, input.responsiblePersonId ?? actor.personId, input.responsibleJobTitle ?? null],
  )).rows[0]!
  await replaceDocuments(db, actor.organizationId, row.id, input.affectedDocumentIds)
  await replaceSubjects(db, actor.organizationId, row.id, input.requestSubjectIds)
  return row.id
}

export async function createAlignment(db: Database, actor: AlignmentActor & { sub: string }, scopes: AlignmentScopes, body: unknown) {
  requirePerson(actor)
  const input = await assertInputAllowed(db, actor, scopes, alignmentInputSchema.parse(body))
  const id = await inTransaction(db, async (client) => {
    const alignment = (await client.query<{ id: string }>(`insert into operational_alignments (organization_id, created_by) values ($1, $2) returning id`, [actor.organizationId, actor.personId])).rows[0]!
    const versionId = await insertDraft(client, actor, alignment.id, 1, { ...input, changeReason: null })
    await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: alignment.id, versionId, version: 1, type: "CREATED", actorPersonId: actor.personId, details: alignmentChangesOf(null, imageOfInput({ ...input, changeReason: null })) })
    await audit(client, actor, "OPERATIONAL_ALIGNMENT_CREATED", alignment.id, { title: input.title, processes: input.affectedDocumentIds, scopeType: input.scopeType, teamId: input.teamId, subteamId: input.subteamId, operatingUniverse: input.operatingUniverse, startsOn: input.startsOn, endsOn: input.endsOn })
    return alignment.id
  })
  return getAlignment(db, actor.organizationId, scopes, id)
}

/** Editar: altera o rascunho; sem rascunho, abre a próxima versão (a publicada continua valendo até a nova ser publicada). */
export async function updateAlignment(db: Database, actor: AlignmentActor & { sub: string }, scopes: AlignmentScopes, id: string, body: unknown) {
  requirePerson(actor)
  const versions = await loadAlignmentOrThrow(db, actor.organizationId, scopes, id)
  const input = await assertInputAllowed(db, actor, scopes, alignmentInputSchema.parse(body))
  const published = versions.find((version) => version.status === "PUBLISHED")
  if (published && !input.changeReason) throw new DomainError("Informe o motivo da alteração: o alinhamento já foi publicado e a nova versão fica no histórico.", "OPERATIONAL_ALIGNMENT_CHANGE_REASON_REQUIRED", 422)
  await inTransaction(db, async (client) => {
    await client.query(`select id from operational_alignments where id = $1 for update`, [id])
    const draft = (await client.query<{ id: string; version: number }>(`select id, version from operational_alignment_versions where alignment_id = $1 and status = 'DRAFT'`, [id])).rows[0]
    // Base da comparação do rastro: o rascunho atual; sem ele, a versão mais recente (a nova versão parte dela).
    const before = versions.find((version) => version.status === "DRAFT") ?? versions[0]!
    let savedVersionId: string
    let savedVersion: number
    if (draft) {
      savedVersionId = draft.id
      savedVersion = draft.version
      const interval = await intervalOf(client, actor.organizationId, input.startsOn, input.endsOn)
      const scope = normalizedScope(input)
      await client.query(
        `update operational_alignment_versions set title = $2, guidance = $3, affected_topic = $4, justification = $5, operating_universe = $6, scope_type = $7, team_id = $8, subteam_id = $9, product_id = $10,
                starts_on = $11, ends_on = $12, time_zone = $13, effective_from = $14, effective_until = $15, content_hash = $16, change_reason = $17, updated_by = $18, updated_at = now(), reason_id = $19,
                responsible_person_id = $20, responsible_job_title = $21
         where id = $1`,
        [draft.id, input.title, input.guidance, input.affectedTopic, input.justification, input.operatingUniverse, scope.scopeType, scope.teamId, scope.subteamId, input.productId, input.startsOn, input.endsOn, interval.timeZone, interval.effectiveFrom, interval.effectiveUntil, contentHashOf(input), input.changeReason, actor.personId, input.reasonId, input.responsiblePersonId ?? actor.personId, input.responsibleJobTitle ?? null],
      )
      await replaceDocuments(client, actor.organizationId, draft.id, input.affectedDocumentIds)
      await replaceSubjects(client, actor.organizationId, draft.id, input.requestSubjectIds)
    } else {
      const next = (await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 next from operational_alignment_versions where alignment_id = $1`, [id])).rows[0]!.next
      savedVersionId = await insertDraft(client, actor, id, next, input)
      savedVersion = next
    }
    await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: id, versionId: savedVersionId, version: savedVersion, type: "DRAFT_SAVED", actorPersonId: actor.personId, details: { newVersion: !draft, basedOnVersion: before.version, ...alignmentChangesOf(imageOfRow(before), imageOfInput(input)) } })
    await audit(client, actor, "OPERATIONAL_ALIGNMENT_DRAFT_SAVED", id, { title: input.title, processes: input.affectedDocumentIds, changeReason: input.changeReason, startsOn: input.startsOn, endsOn: input.endsOn })
  })
  return getAlignment(db, actor.organizationId, scopes, id)
}

export async function discardDraft(db: Database, actor: AlignmentActor, scopes: AlignmentScopes, id: string) {
  const versions = await loadAlignmentOrThrow(db, actor.organizationId, scopes, id)
  const draft = versions.find((version) => version.status === "DRAFT")
  if (!draft) throw new DomainError("Não há rascunho para descartar.", "OPERATIONAL_ALIGNMENT_NO_DRAFT", 409)
  await inTransaction(db, async (client) => {
    await audit(client, actor, "OPERATIONAL_ALIGNMENT_DRAFT_DISCARDED", id, { version: draft.version, title: draft.title, guidance: draft.guidance, justification: draft.justification, processes: (draft.documents ?? []).map((document) => document.id) })
    // O rastro guarda o rascunho inteiro antes de a linha sair (o evento perde só o vínculo com a versão apagada).
    await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: id, versionId: null, version: draft.version, type: "DRAFT_DISCARDED", actorPersonId: actor.personId, details: { discardedVersionId: draft.id, ...imageOfRow(draft) } })
    await client.query(`delete from operational_alignment_version_documents where version_id = $1`, [draft.id])
    await client.query(`delete from operational_alignment_version_subjects where version_id = $1`, [draft.id])
    await client.query(`delete from operational_alignment_versions where id = $1 and status = 'DRAFT'`, [draft.id])
    // Alinhamento que nunca foi publicado: sai da lista (exclusão lógica — o conteúdo ficou no audit_logs acima).
    if (versions.length === 1) await client.query(`update operational_alignments set deleted_at = now(), deleted_by_person_id = $2 where id = $1`, [id, actor.personId])
  })
  return { id, discarded: draft.version }
}

/** Outros alinhamentos publicados que alcançam o mesmo público, algum processo em comum e o mesmo período do rascunho. */
export async function overlappingAlignments(db: Queryable, organizationId: string, draft: VersionRow) {
  const draftDocuments = (draft.documents ?? []).map((document) => document.id)
  const rows = (await db.query<VersionRow>(
    `${VERSION_SELECT} where v.organization_id = $1 and v.alignment_id <> $2 and v.status in ('PUBLISHED', 'SUPERSEDED')
       and v.effective_until > v.effective_from and v.effective_until > $4 and v.effective_from < $5
       and exists (select 1 from operational_alignment_version_documents vd where vd.version_id = v.id and vd.document_id = any($3::uuid[]))
       and exists (select 1 from operational_alignments a where a.id = v.alignment_id and a.deleted_at is null)`,
    [organizationId, draft.alignment_id, draftDocuments, draft.effective_from, draft.effective_until],
  )).rows
  const draftAudience = { operatingUniverse: draft.operating_universe, scopeType: draft.scope_type, teamId: draft.team_id, subteamId: draft.subteam_id, productId: draft.product_id }
  // Uma linha por alinhamento (a versão mais recente que cruza o período).
  const byAlignment = new Map<string, VersionRow>()
  for (const row of rows) {
    if (!audiencesOverlap(draftAudience, { operatingUniverse: row.operating_universe, scopeType: row.scope_type, teamId: row.team_id, subteamId: row.subteam_id, productId: row.product_id })) continue
    if (!periodsOverlap({ startsOn: draft.starts_on, endsOn: draft.ends_on }, { startsOn: row.starts_on, endsOn: row.ends_on })) continue
    const kept = byAlignment.get(row.alignment_id)
    if (!kept || kept.version < row.version) byAlignment.set(row.alignment_id, row)
  }
  return [...byAlignment.values()].map((row) => ({
    alignmentId: row.alignment_id,
    version: versionView(row),
    sharedProcesses: (row.documents ?? []).filter((document) => draftDocuments.includes(document.id)),
    sameScopeLevel: scopeSpecificityOf(row.scope_type) === scopeSpecificityOf(draft.scope_type) && row.product_id === draft.product_id,
    moreSpecific: scopeSpecificityOf(draft.scope_type) > scopeSpecificityOf(row.scope_type) ? "THIS" as const : scopeSpecificityOf(draft.scope_type) < scopeSpecificityOf(row.scope_type) ? "OTHER" as const : null,
  }))
}

export async function previewPublication(db: Database, organizationId: string, scopes: AlignmentScopes, id: string) {
  const versions = await loadAlignmentOrThrow(db, organizationId, scopes, id)
  const draft = versions.find((version) => version.status === "DRAFT")
  if (!draft) throw new DomainError("Não há rascunho para publicar.", "OPERATIONAL_ALIGNMENT_NO_DRAFT", 409)
  return { draft: versionView(draft), overlaps: await overlappingAlignments(db, organizationId, draft) }
}

const publishSchema = z.object({ relations: z.array(z.object({ alignmentId: z.string().uuid(), relation: z.enum(["SAME_TOPIC", "INDEPENDENT"]) })).max(200).default([]) }).strict()

const inputOfDraft = (draft: VersionRow) => alignmentInputSchema.parse({ title: draft.title, guidance: draft.guidance, responsiblePersonId: draft.responsible_person_id, affectedDocumentIds: (draft.documents ?? []).map((document) => document.id), reasonId: draft.reason_id, requestSubjectIds: (draft.request_subjects ?? []).map((subject) => subject.id), affectedTopic: draft.affected_topic, justification: draft.justification, operatingUniverse: draft.operating_universe, scopeType: draft.scope_type, teamId: draft.team_id, subteamId: draft.subteam_id, productId: draft.product_id, startsOn: draft.starts_on, endsOn: draft.ends_on, changeReason: draft.change_reason })

/**
 * PUBLICAR o rascunho. Ordem: escopo e vínculos de novo (podem ter mudado desde o rascunho) → assunto proibido (falha da conferência =
 * não publica: a restrição é absoluta) → sobreposições declaradas uma a uma (sem declaração = 409 com a lista) → conflito sem
 * precedência recusado → transação: a versão anterior é substituída a partir do início da nova.
 */
export async function publishAlignment(db: Database, actor: AlignmentActor & { sub: string }, scopes: AlignmentScopes, id: string, body: unknown, deps: { prohibitedTopicCheck?: ProhibitedTopicCheck } = {}) {
  requirePerson(actor)
  const { relations } = publishSchema.parse(body ?? {})
  const versions = await loadAlignmentOrThrow(db, actor.organizationId, scopes, id)
  const draft = versions.find((version) => version.status === "DRAFT")
  if (!draft) throw new DomainError("Não há rascunho para publicar.", "OPERATIONAL_ALIGNMENT_NO_DRAFT", 409)
  const input = await assertInputAllowed(db, actor, scopes, inputOfDraft(draft))
  const previous = versions.find((version) => version.status === "PUBLISHED") ?? null
  if (previous && input.startsOn < previous.starts_on) throw new DomainError(`A nova versão não pode começar antes da versão publicada (${previous.starts_on}): o que já valia não é reescrito.`, "OPERATIONAL_ALIGNMENT_RETROACTIVE_VERSION", 422)
  if (previous && !input.changeReason) throw new DomainError("Informe o motivo da alteração.", "OPERATIONAL_ALIGNMENT_CHANGE_REASON_REQUIRED", 422)

  const check = await (deps.prohibitedTopicCheck ?? governanceProhibitedTopicCheck)(db, { organizationId: actor.organizationId, text: [input.title, input.guidance, input.affectedTopic, input.justification, ...(draft.documents ?? []).map((document) => document.title)].filter((part): part is string => Boolean(part && part.trim())).join("\n\n") })
  if (check.outcome === "VIOLATION") throw new DomainError(`A orientação trata de assunto proibido pela Governança e não pode ser publicada: ${check.reason}`, "OPERATIONAL_ALIGNMENT_PROHIBITED_TOPIC", 422, { rules: check.hits.map((hit) => hit.name) })
  if (check.outcome === "CHECK_FAILED") throw new DomainError("Não foi possível conferir a orientação contra os assuntos proibidos agora. Tente publicar de novo em instantes.", "OPERATIONAL_ALIGNMENT_CHECK_UNAVAILABLE", 503)

  const overlaps = await overlappingAlignments(db, actor.organizationId, draft)
  const declared = new Map(relations.map((entry) => [entry.alignmentId, entry.relation]))
  const missing = overlaps.filter((overlap) => !declared.has(overlap.alignmentId))
  if (missing.length > 0) throw new DomainError("Outros alinhamentos alcançam o mesmo público, algum processo em comum e o mesmo período. Diga, para cada um, se tratam do mesmo ponto ou de pontos diferentes.", "OPERATIONAL_ALIGNMENT_RELATION_REQUIRED", 409, { overlaps: missing })
  const conflicts = overlaps.filter((overlap) => isUnresolvableConflict({ scopeType: draft.scope_type, productId: draft.product_id }, { scopeType: overlap.version.scopeType, productId: overlap.version.product?.id ?? null }, declared.get(overlap.alignmentId)!))
  if (conflicts.length > 0) throw new DomainError("Há alinhamento do MESMO ponto com o MESMO público no mesmo período, sem precedência entre eles. Encerre o outro, ajuste o período ou use um recorte mais específico.", "OPERATIONAL_ALIGNMENT_CONFLICT", 409, { conflicts })

  await inTransaction(db, async (client) => {
    await client.query(`select id from operational_alignments where id = $1 for update`, [id])
    const stillDraft = (await client.query(`select 1 from operational_alignment_versions where id = $1 and status = 'DRAFT' and content_hash = $2`, [draft.id, draft.content_hash])).rowCount
    if (!stillDraft) throw new DomainError("O rascunho mudou enquanto você publicava. Confira e publique de novo.", "OPERATIONAL_ALIGNMENT_DRAFT_CHANGED", 409)
    if (previous) {
      // A anterior vale até o início da nova (ou não chega a valer, se a nova começa junto) — o intervalo que já passou é preservado.
      await client.query(
        `update operational_alignment_versions set status = 'SUPERSEDED', superseded_at = now(), superseded_by_version_id = $2,
                effective_until = greatest(effective_from, least(effective_until, $3::timestamptz))
         where id = $1`,
        [previous.id, draft.id, draft.effective_from],
      )
    }
    // O cargo do responsável é copiado de novo na publicação (o da data em que passou a valer); sem responsável (rascunho antigo), quem publica.
    await client.query(
      `update operational_alignment_versions set status = 'PUBLISHED', published_by = $2, published_at = now(),
         responsible_person_id = coalesce(responsible_person_id, $2),
         responsible_job_title = (select nullif(left(btrim(p.job_title), 200), '') from people p where p.id = coalesce(operational_alignment_versions.responsible_person_id, $2))
       where id = $1`,
      [draft.id, actor.personId],
    )
    if (previous) await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: id, versionId: previous.id, version: previous.version, type: "SUPERSEDED", actorPersonId: actor.personId, details: { byVersionId: draft.id, byVersion: draft.version, validUntil: new Date(draft.effective_from).toISOString() } })
    await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: id, versionId: draft.id, version: draft.version, type: "PUBLISHED", actorPersonId: actor.personId, details: { contentHash: draft.content_hash, processes: input.affectedDocumentIds, startsOn: draft.starts_on, endsOn: draft.ends_on, timeZone: draft.time_zone, relations: [...declared.entries()], prohibitedTopicCheck: check.outcome } })
    for (const [otherAlignmentId, relation] of declared) {
      if (!overlaps.some((overlap) => overlap.alignmentId === otherAlignmentId)) continue
      await client.query(`insert into operational_alignment_relations (version_id, other_alignment_id, organization_id, relation, decided_by) values ($1, $2, $3, $4, $5)`, [draft.id, otherAlignmentId, actor.organizationId, relation, actor.personId])
    }
    await audit(client, actor, "OPERATIONAL_ALIGNMENT_PUBLISHED", id, { versionId: draft.id, version: draft.version, contentHash: draft.content_hash, processes: input.affectedDocumentIds, supersededVersionId: previous?.id ?? null, startsOn: draft.starts_on, endsOn: draft.ends_on, timeZone: draft.time_zone, relations: [...declared.entries()], prohibitedTopicCheck: check.outcome })
  })
  return getAlignment(db, actor.organizationId, scopes, id)
}

const endSchema = z.object({ reason: z.string().trim().min(3, "Informe o motivo do encerramento.").max(1000) }).strict()

/** ENCERRAR antes do previsto: o intervalo termina agora (o que já passou continua coberto). Ainda não começou = cancelado. */
export async function endAlignment(db: Database, actor: AlignmentActor, scopes: AlignmentScopes, id: string, body: unknown) {
  requirePerson(actor)
  const { reason } = endSchema.parse(body ?? {})
  const versions = await loadAlignmentOrThrow(db, actor.organizationId, scopes, id)
  const current = versions.find((version) => version.status === "PUBLISHED")
  if (!current) throw new DomainError("Não há versão publicada para encerrar.", "OPERATIONAL_ALIGNMENT_NOT_PUBLISHED", 409)
  if (!canSee(scopes, current)) throw new DomainError("Você não administra o público deste alinhamento.", "OPERATIONAL_ALIGNMENT_SCOPE_FORBIDDEN", 403)
  await inTransaction(db, async (client) => {
    await client.query(`select id from operational_alignments where id = $1 for update`, [id])
    const updated = (await client.query<{ status: string; effective_until: Date }>(
      `update operational_alignment_versions
          set status = case when now() <= effective_from then 'CANCELLED' else status end,
              effective_until = greatest(effective_from, least(effective_until, now())), ended_by = $2, ended_at = now(), end_reason = $3
        where id = $1 and status = 'PUBLISHED' returning status, effective_until`,
      [current.id, actor.personId, reason],
    )).rows[0]
    if (!updated) throw new DomainError("O alinhamento mudou enquanto você encerrava. Confira de novo.", "OPERATIONAL_ALIGNMENT_DRAFT_CHANGED", 409)
    await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: id, versionId: current.id, version: current.version, type: updated.status === "CANCELLED" ? "CANCELLED" : "ENDED", actorPersonId: actor.personId, details: { reason, previousEffectiveUntil: new Date(current.effective_until).toISOString(), effectiveUntil: new Date(updated.effective_until).toISOString() } })
    await audit(client, actor, "OPERATIONAL_ALIGNMENT_ENDED", id, { versionId: current.id, version: current.version, reason, previousEffectiveUntil: new Date(current.effective_until).toISOString(), effectiveUntil: new Date(updated.effective_until).toISOString(), cancelled: updated.status === "CANCELLED" })
  })
  return getAlignment(db, actor.organizationId, scopes, id)
}

const deleteSchema = z.object({ reason: z.string().trim().min(3, "Informe o motivo da exclusão.").max(1000) }).strict()

/**
 * EXCLUIR (lógico): o alinhamento deixa de valer A PARTIR DE AGORA (a versão publicada termina agora; se ainda não começou, fica
 * cancelada), sai da lista e passa a aparecer em "Consultar dados › Itens excluídos", de onde volta encerrado. O que já passou continua
 * coberto: avaliação ou reprocessamento de chamada da vigência anterior à exclusão ainda o aplicam (a regra lê os intervalos, nunca a
 * exclusão). Rastro: evento DELETED com o motivo + audit_logs.
 */
export async function deleteAlignment(db: Database, actor: AlignmentActor, scopes: AlignmentScopes, id: string, body: unknown) {
  requirePerson(actor)
  const { reason } = deleteSchema.parse(body ?? {})
  const versions = await loadAlignmentOrThrow(db, actor.organizationId, scopes, id)
  if (!versions.every((version) => canSee(scopes, version))) throw new DomainError("Você não administra o público de todas as versões deste alinhamento.", "OPERATIONAL_ALIGNMENT_SCOPE_FORBIDDEN", 403)
  const current = versions.find((version) => version.status === "PUBLISHED") ?? null
  await inTransaction(db, async (client) => {
    await client.query(`select id from operational_alignments where id = $1 for update`, [id])
    let truncated: { status: string; effective_until: Date } | null = null
    if (current) {
      truncated = (await client.query<{ status: string; effective_until: Date }>(
        `update operational_alignment_versions
            set status = case when now() <= effective_from then 'CANCELLED' else status end,
                effective_until = greatest(effective_from, least(effective_until, now())),
                ended_by = coalesce(ended_by, $2), ended_at = coalesce(ended_at, now()), end_reason = coalesce(end_reason, $3)
          where id = $1 and status = 'PUBLISHED' returning status, effective_until`,
        [current.id, actor.personId, `Excluído: ${reason}`],
      )).rows[0] ?? null
    }
    const deleted = (await client.query(`update operational_alignments set deleted_at = now(), deleted_by_person_id = $2 where id = $1 and deleted_at is null`, [id, actor.personId])).rowCount
    if (!deleted) throw new DomainError("Alinhamento não encontrado.", "OPERATIONAL_ALIGNMENT_NOT_FOUND", 404)
    await recordAlignmentEvent(client, { organizationId: actor.organizationId, alignmentId: id, versionId: current?.id ?? null, version: current?.version ?? null, type: "DELETED", actorPersonId: actor.personId, details: { reason, versionStatus: truncated?.status ?? null, effectiveUntil: truncated ? new Date(truncated.effective_until).toISOString() : null, previousEffectiveUntil: current ? new Date(current.effective_until).toISOString() : null } })
    await audit(client, actor, "OPERATIONAL_ALIGNMENT_DELETED", id, { reason, versionId: current?.id ?? null })
  })
  return { id, deleted: true }
}

/**
 * Universo de cada Grupo/Subgrupo que a pessoa administra — os filtros e o formulário encadeiam por ele (universo → Grupo → Subgrupo).
 * Subgrupo sem universo próprio herda o do Grupo; nulo = ainda não classificado (aparece em qualquer universo, marcado na tela).
 */
export async function scopeOptions(db: Queryable, organizationId: string, scopes: AlignmentScopes) {
  const rows = (await db.query<{ team_id: string; team_name: string; team_universe: string | null; subteam_id: string | null; subteam_name: string | null; subteam_universe: string | null }>(
    `select t.id team_id, t.name team_name, t.operating_universe team_universe, st.id subteam_id, st.name subteam_name, coalesce(st.operating_universe, t.operating_universe) subteam_universe
     from teams t left join subteams st on st.team_id = t.id
     where t.organization_id = $1 order by t.name, st.name`,
    [organizationId],
  )).rows
  const all = scopes.unrestricted || scopes.allTeams
  const teams = new Map<string, { id: string; name: string; operatingUniverse: string | null; manageable: boolean; subteams: { id: string; name: string; operatingUniverse: string | null }[] }>()
  for (const row of rows) {
    const teamManaged = all || (!scopes.unrestricted && scopes.teamIds.has(row.team_id))
    const subteamManaged = row.subteam_id !== null && (all || (!scopes.unrestricted && scopes.subteamIds.has(row.subteam_id)))
    if (!teamManaged && !subteamManaged) continue
    const team = teams.get(row.team_id) ?? { id: row.team_id, name: row.team_name, operatingUniverse: row.team_universe, manageable: teamManaged, subteams: [] }
    if (row.subteam_id && (teamManaged || subteamManaged)) team.subteams.push({ id: row.subteam_id, name: row.subteam_name ?? "", operatingUniverse: row.subteam_universe })
    teams.set(row.team_id, team)
  }
  return { universe: coversOrganization(scopes), teams: [...teams.values()] }
}

/**
 * MONITORIAS POSSIVELMENTE AFETADAS (reprocessamento rastreável): avaliações VIGENTES de chamadas que aconteceram dentro do intervalo de
 * alguma versão publicada, de colaboradores do público NA DATA DA CHAMADA (Grupo/Subgrupo gravados na avaliação; universo pela vigência
 * da pessoa), com critério de algum processo do alinhamento e SEM este alinhamento na fotografia (`call_assessments.operational_alignments`).
 * `withDeviation` = há desvio (não cumprido/parcial) num critério desses processos — os primeiros a reprocessar.
 */
export async function affectedAssessments(db: Queryable, organizationId: string, scopes: AlignmentScopes, id: string, limit = 200) {
  const versions = await loadAlignmentOrThrow(db, organizationId, scopes, id)
  const published = versions.filter((version) => (version.status === "PUBLISHED" || version.status === "SUPERSEDED") && canSee(scopes, version) && new Date(version.effective_until).getTime() > new Date(version.effective_from).getTime())
  if (published.length === 0) return { alignmentId: id, items: [], truncated: false }
  const rows = (await db.query<{ call_assessment_id: string; analysis_run_id: string; agent_id: string | null; interaction_id: string; person_id: string; person_name: string; occurred_at: Date; version_id: string; version: number; deviations: number; criteria: number }>(
    `select a.id call_assessment_id, a.analysis_run_id, r.agent_id, a.interaction_id, a.person_id, p.name person_name, a.occurred_at, v.id version_id, v.version,
            count(*) filter (where c.status in ('NOT_MET', 'PARTIAL'))::int deviations, count(*)::int criteria
     from operational_alignment_versions v
     join call_assessments a on a.organization_id = v.organization_id and a.is_current and a.occurred_at >= v.effective_from and a.occurred_at < v.effective_until
     join feedback_analysis_runs r on r.id = a.analysis_run_id
     join people p on p.id = a.person_id
     join call_criterion_assessments c on c.call_assessment_id = a.id and c.is_current
     join operational_alignment_version_documents vd on vd.version_id = v.id and vd.document_id = c.document_id
     where v.id = any($2::uuid[]) and v.organization_id = $1
       and (v.scope_type = 'UNIVERSE' or (v.scope_type = 'TEAM' and a.team_id = v.team_id) or (v.scope_type = 'SUBTEAM' and a.subteam_id = v.subteam_id))
       and coalesce((select h.operating_universe from person_operating_universe_history h where h.person_id = a.person_id and h.valid_from <= a.occurred_at and (h.valid_until is null or h.valid_until > a.occurred_at) order by h.valid_from desc limit 1), p.operating_universe, case when v.scope_type = 'UNIVERSE' then null else v.operating_universe end) = v.operating_universe
       and not exists (select 1 from jsonb_array_elements(a.operational_alignments) used where used->>'versionId' = v.id::text)
     group by a.id, r.agent_id, p.name, v.id
     order by count(*) filter (where c.status in ('NOT_MET', 'PARTIAL')) desc, a.occurred_at
     limit $3`,
    [organizationId, published.map((version) => version.id), limit + 1],
  )).rows
  return {
    alignmentId: id,
    truncated: rows.length > limit,
    items: rows.slice(0, limit).map((row) => ({ callAssessmentId: row.call_assessment_id, analysisRunId: row.analysis_run_id, agentId: row.agent_id, interactionId: row.interaction_id, personId: row.person_id, personName: row.person_name, occurredAt: new Date(row.occurred_at).toISOString(), versionId: row.version_id, version: row.version, deviations: row.deviations, criteria: row.criteria, withDeviation: row.deviations > 0 })),
  }
}

// ---------------------------------------------------------------------------------------------
// MOTIVOS (213): do alinhamento (catálogo próprio) e do pedido do cliente (assuntos canônicos da organização)
// ---------------------------------------------------------------------------------------------

/** Lista inicial para a organização que ainda não tem nenhum motivo (a 213 já cria para as que existiam). */
const DEFAULT_REASONS = ["Processo em alteração", "Processo desatualizado", "Contingência", "Falha de sistema", "Mudança regulatória", "Ação comercial ou campanha", "Outro"] as const

export async function listReasons(db: Queryable, organizationId: string) {
  const load = () => db.query<{ id: string; name: string; active: boolean; position: number; uses: number }>(
    `select r.id, r.name, r.active, r.position, (select count(distinct v.alignment_id)::int from operational_alignment_versions v where v.reason_id = r.id) uses
     from operational_alignment_reasons r where r.organization_id = $1 order by r.active desc, r.position, r.name`,
    [organizationId],
  )
  let rows = (await load()).rows
  if (rows.length === 0) {
    await db.query(`insert into operational_alignment_reasons (organization_id, name, position) select $1, name, ordinality from unnest($2::text[]) with ordinality as r(name, ordinality) on conflict do nothing`, [organizationId, [...DEFAULT_REASONS]])
    rows = (await load()).rows
  }
  return rows
}

const reasonSchema = z.object({ name: z.string().trim().min(2, "Mínimo de 2 caracteres.").max(80), active: z.boolean().optional() }).strict()
const requireOrganizationWide = (scopes: AlignmentScopes) => {
  if (!coversOrganization(scopes)) throw new DomainError("Só quem administra alinhamentos na organização inteira mantém as listas de motivos.", "OPERATIONAL_ALIGNMENT_SCOPE_FORBIDDEN", 403)
}

export async function createReason(db: Database, actor: AlignmentActor, scopes: AlignmentScopes, body: unknown) {
  requireOrganizationWide(scopes)
  const { name } = reasonSchema.parse(body)
  const row = (await db.query<{ id: string }>(
    `insert into operational_alignment_reasons (organization_id, name, position, created_by) values ($1, $2, (select coalesce(max(position), 0) + 1 from operational_alignment_reasons where organization_id = $1 and position < 99), $3)
     on conflict (organization_id, lower(btrim(name))) do nothing returning id`,
    [actor.organizationId, name, actor.personId],
  )).rows[0]
  if (!row) throw new DomainError(`Já existe o motivo "${name}".`, "OPERATIONAL_ALIGNMENT_REASON_DUPLICATED", 409)
  await audit(db, actor, "OPERATIONAL_ALIGNMENT_REASON_CREATED", row.id, { name })
  return { id: row.id, name }
}

export async function updateReason(db: Database, actor: AlignmentActor, scopes: AlignmentScopes, id: string, body: unknown) {
  requireOrganizationWide(scopes)
  const input = reasonSchema.partial({ name: true }).parse(body)
  const before = (await db.query<{ name: string; active: boolean }>(`select name, active from operational_alignment_reasons where id = $1 and organization_id = $2`, [id, actor.organizationId])).rows[0]
  if (!before) throw new DomainError("Motivo não encontrado.", "OPERATIONAL_ALIGNMENT_REASON_NOT_FOUND", 404)
  try {
    await db.query(`update operational_alignment_reasons set name = coalesce($3, name), active = coalesce($4, active), updated_by = $5, updated_at = now() where id = $1 and organization_id = $2`, [id, actor.organizationId, input.name ?? null, input.active ?? null, actor.personId])
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new DomainError(`Já existe o motivo "${input.name}".`, "OPERATIONAL_ALIGNMENT_REASON_DUPLICATED", 409)
    throw error
  }
  await audit(db, actor, "OPERATIONAL_ALIGNMENT_REASON_UPDATED", id, { before, after: input })
  return { id }
}

/** Motivos do pedido do cliente = assuntos canônicos ativos da organização (o mesmo catálogo das chamadas). */
export async function listRequestReasons(db: Queryable, organizationId: string) {
  return (await db.query<{ id: string; code: string; name: string }>(`select id, code, name from interaction_subject_definitions where organization_id = $1 and active order by name`, [organizationId])).rows
}

/** Código do assunto a partir do nome (sem acento, minúsculo, com `_`) — o formato dos códigos que o catálogo já usa. */
export const subjectCodeOf = (name: string) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)

/**
 * Inclui um assunto novo no catálogo canônico (ex.: "Mudança de endereço"). Sem apelidos: nenhuma chamada passa a ser classificada nele
 * até a carga de assuntos trazer o de-para — aqui ele serve de motivo do pedido do cliente nos alinhamentos.
 */
export async function createRequestReason(db: Database, actor: AlignmentActor, scopes: AlignmentScopes, body: unknown) {
  requireOrganizationWide(scopes)
  const { name } = reasonSchema.parse(body)
  const code = subjectCodeOf(name)
  if (code.length < 2) throw new DomainError("Nome inválido para um motivo do pedido.", "OPERATIONAL_ALIGNMENT_REQUEST_REASON_INVALID", 422)
  const existing = (await db.query<{ id: string; name: string; active: boolean }>(`select id, name, active from interaction_subject_definitions where organization_id = $1 and (code = $2 or lower(btrim(name)) = lower(btrim($3)))`, [actor.organizationId, code, name])).rows[0]
  if (existing) throw new DomainError(`Já existe o motivo do pedido "${existing.name}"${existing.active ? "" : " (desativado)"}.`, "OPERATIONAL_ALIGNMENT_REQUEST_REASON_DUPLICATED", 409)
  const row = (await db.query<{ id: string }>(`insert into interaction_subject_definitions (organization_id, code, name, description) values ($1, $2, $3, 'Incluído pela tela de Alinhamentos operacionais.') returning id`, [actor.organizationId, code, name])).rows[0]!
  await audit(db, actor, "OPERATIONAL_ALIGNMENT_REQUEST_REASON_CREATED", row.id, { name, code })
  return { id: row.id, code, name }
}
