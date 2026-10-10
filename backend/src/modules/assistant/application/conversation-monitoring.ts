import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { rolesWithPermission } from "../../access/domain/roles.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { decodeCursor } from "../domain/assistant-conversation.js"
import { CONVERSATION_LAST_MESSAGE_JOIN, CONVERSATION_SUMMARY_SELECT, loadConversationMessages, toSummary, type ConversationSummary, type ConversationSummaryRow } from "./assistant-conversations.js"
import { loadAssistantSupportMaterials } from "./assistant-support-materials.js"

/**
 * MONITORAMENTO das conversas com a INIA (somente leitura). Quem lê = a pessoa da sessão; o que ela alcança = UNIÃO das
 * atribuições ATIVAS de papéis com `assistant_conversations.view` (organização, Grupo, Subgrupo ou "Minha estrutura" por
 * reports_to), nunca o cargo. Toda consulta (lista, filtros, contagem, paginação, detalhe e mensagens) passa pelo MESMO
 * filtro SQL: conversa fora do alcance = 404, sem distinguir de inexistente.
 */
type Queryable = Pick<Database, "query">
export type MonitoringViewer = { organizationId: string; personId: string }

const SCOPE_CTE = `with recursive grants as (
  select a.scope_type, a.team_id, a.subteam_id from access_role_assignments a
  join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
  join people gp on gp.id = ua.person_id and gp.active
  where a.organization_id = $1 and ua.person_id = $2 and a.revoked_at is null and a.role_code = any($3::text[])
), subordinates as (
  select id from people where organization_id = $1 and reports_to_id = $2 and exists (select 1 from grants where scope_type = 'MY_STRUCTURE')
  union
  select p.id from people p join subordinates s on p.reports_to_id = s.id
)`
/** Filtro de alcance sobre a conversa `c` e o dono `owner`. */
const VISIBLE = `c.organization_id = $1 and (
    exists (select 1 from grants g where g.scope_type = 'ORGANIZATION')
    or exists (select 1 from grants g where g.scope_type = 'GROUP' and g.team_id = owner.team_id)
    or exists (select 1 from grants g where g.scope_type = 'SUBGROUP' and g.subteam_id = owner.subteam_id)
    or c.owner_person_id in (select id from subordinates)
  )`
const FROM = `from assistant_conversations c
  join people owner on owner.id = c.owner_person_id and owner.organization_id = c.organization_id
  left join teams t on t.id = owner.team_id
  left join subteams st on st.id = owner.subteam_id
  cross join lateral (select coalesce((select op.timezone from operations op where op.organization_id = c.organization_id order by op.created_at limit 1), '${DEFAULT_ORGANIZATION_TIMEZONE}') timezone) o`

const baseParams = (viewer: MonitoringViewer) => [viewer.organizationId, viewer.personId, rolesWithPermission("assistant_conversations.view")]

export const MONITORING_STATUS_FILTERS = ["ACTIVE", "CLOSED", "LEGACY"] as const
/** Tipo da conversa: livre (o colaborador abriu), sessão de um feedback (aplicação e dúvidas depois dela) ou recado de um Workflow. */
export const MONITORING_ORIGIN_FILTERS = ["USER", "FEEDBACK", "WORKFLOW"] as const
export type MonitoringFilters = {
  /** Nome do colaborador OU assunto (título) da conversa. */
  search?: string | undefined
  ownerPersonId?: string | undefined
  teamId?: string | undefined
  subteamId?: string | undefined
  status?: (typeof MONITORING_STATUS_FILTERS)[number] | undefined
  origin?: (typeof MONITORING_ORIGIN_FILTERS)[number] | undefined
  /** Datas LOCAIS da organização (YYYY-MM-DD), inclusivas, sobre a última atividade. */
  from?: string | undefined
  to?: string | undefined
  page: number
  pageSize: number
}

export type MonitoredOwner = { personId: string; name: string; jobTitle: string | null; avatarUrl: string | null; teamName: string | null; subteamName: string | null }
/** `voiceMessageCount` = mensagens da conversa trocadas por voz (só a contagem; o áudio nunca é guardado). */
export type MonitoredConversation = ConversationSummary & { owner: MonitoredOwner; voiceMessageCount: number }
type Row = ConversationSummaryRow & { voice_message_count: number; owner_id: string; owner_name: string; owner_job_title: string | null; owner_avatar_url: string | null; team_name: string | null; subteam_name: string | null }
const OWNER_SELECT = `(select count(*)::int from assistant_interactions m where m.conversation_id = c.id and m.channel = 'voice') voice_message_count,
  owner.id owner_id, owner.name owner_name, owner.job_title owner_job_title, owner.avatar_url owner_avatar_url, t.name team_name, st.name subteam_name`
const toMonitored = (row: Row): MonitoredConversation => ({
  ...toSummary(row),
  owner: { personId: row.owner_id, name: row.owner_name, jobTitle: row.owner_job_title, avatarUrl: row.owner_avatar_url, teamName: row.team_name, subteamName: row.subteam_name },
  voiceMessageCount: row.voice_message_count ?? 0,
})

function filterSql(filters: MonitoringFilters, params: unknown[]): string {
  const clauses: string[] = []
  const add = (value: unknown) => {
    params.push(value)
    return `$${params.length}`
  }
  if (filters.search) {
    const pattern = add(`%${filters.search.replace(/[%_\\]/g, (char) => `\\${char}`)}%`)
    clauses.push(`(owner.name ilike ${pattern} or c.title ilike ${pattern})`)
  }
  if (filters.ownerPersonId) clauses.push(`c.owner_person_id = ${add(filters.ownerPersonId)}::uuid`)
  if (filters.teamId) clauses.push(`owner.team_id = ${add(filters.teamId)}::uuid`)
  if (filters.subteamId) clauses.push(`owner.subteam_id = ${add(filters.subteamId)}::uuid`)
  if (filters.status === "ACTIVE") clauses.push(`c.status = 'ACTIVE'`)
  if (filters.status === "CLOSED") clauses.push(`c.status = 'CLOSED' and c.kind = 'CONVERSATION'`)
  if (filters.status === "LEGACY") clauses.push(`c.kind = 'LEGACY_HISTORY'`)
  if (filters.origin) clauses.push(`c.origin = ${add(filters.origin)}`)
  if (filters.from) clauses.push(`(c.last_activity_at at time zone o.timezone)::date >= ${add(filters.from)}::date`)
  if (filters.to) clauses.push(`(c.last_activity_at at time zone o.timezone)::date <= ${add(filters.to)}::date`)
  return clauses.length > 0 ? ` and ${clauses.join(" and ")}` : ""
}

export async function listMonitoredConversations(db: Queryable, viewer: MonitoringViewer, filters: MonitoringFilters) {
  const params: unknown[] = baseParams(viewer)
  const extra = filterSql(filters, params)
  const countParams = [...params]
  params.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
  const optionParams = baseParams(viewer)
  const [rows, total, owners, teams] = await Promise.all([
    db.query<Row>(
      `${SCOPE_CTE} select ${CONVERSATION_SUMMARY_SELECT}, ${OWNER_SELECT} ${FROM} ${CONVERSATION_LAST_MESSAGE_JOIN}
       where ${VISIBLE}${extra}
       order by c.last_activity_at desc, c.id desc limit $${params.length - 1} offset $${params.length}`,
      params,
    ),
    db.query<{ n: number }>(`${SCOPE_CTE} select count(*)::int n ${FROM} where ${VISIBLE}${extra}`, countParams),
    // Opções de filtro derivadas do PRÓPRIO alcance (nunca listam quem está fora dele).
    db.query<{ id: string; name: string }>(`${SCOPE_CTE} select distinct owner.id, owner.name ${FROM} where ${VISIBLE} order by owner.name limit 500`, optionParams),
    db.query<{ team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null }>(
      `${SCOPE_CTE} select distinct owner.team_id, t.name team_name, owner.subteam_id, st.name subteam_name ${FROM} where ${VISIBLE}`,
      optionParams,
    ),
  ])
  const teamOptions = new Map<string, string>()
  const subteamOptions = new Map<string, { id: string; name: string; teamId: string | null }>()
  for (const row of teams.rows) {
    if (row.team_id && row.team_name) teamOptions.set(row.team_id, row.team_name)
    if (row.subteam_id && row.subteam_name) subteamOptions.set(row.subteam_id, { id: row.subteam_id, name: row.subteam_name, teamId: row.team_id })
  }
  return {
    items: rows.rows.map(toMonitored),
    total: total.rows[0]?.n ?? 0,
    filterOptions: {
      operators: owners.rows.map((row) => ({ id: row.id, name: row.name })),
      teams: [...teamOptions].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      subteams: [...subteamOptions.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    },
  }
}

/** Conversa no alcance do leitor — ou 404 (fora do alcance e inexistente são indistinguíveis). */
export async function requireMonitoredConversation(db: Queryable, viewer: MonitoringViewer, conversationId: string): Promise<MonitoredConversation> {
  const params = [...baseParams(viewer), conversationId]
  const result = await db.query<Row>(`${SCOPE_CTE} select ${CONVERSATION_SUMMARY_SELECT}, ${OWNER_SELECT} ${FROM} ${CONVERSATION_LAST_MESSAGE_JOIN} where ${VISIBLE} and c.id = $4::uuid`, params)
  const row = result.rows[0]
  if (!row) throw new DomainError("Conversa não encontrada.", "ASSISTANT_CONVERSATION_NOT_FOUND", 404)
  return toMonitored(row)
}

/** Mensagens da conversa (já autorizada aqui), com materiais de apoio resolvidos pelo acesso do LEITOR. */
export async function loadMonitoredMessages(db: Queryable, viewer: MonitoringViewer, conversationId: string, page: { limit: number; before?: string | undefined; after?: string | undefined }) {
  const conversation = await requireMonitoredConversation(db, viewer, conversationId)
  const result = await loadConversationMessages(db, { organizationId: viewer.organizationId, conversationId, limit: page.limit, before: decodeCursor(page.before), after: decodeCursor(page.after) })
  const materials = await loadAssistantSupportMaterials(db, { organizationId: viewer.organizationId, viewer: { personId: viewer.personId }, interactionIds: result.messages.filter((m) => m.role === "assistant").map((m) => m.id) })
  return { conversation, messages: result.messages.map((message) => ({ ...message, supportMaterials: materials.get(message.id) ?? [] })), hasMore: result.hasMore }
}
