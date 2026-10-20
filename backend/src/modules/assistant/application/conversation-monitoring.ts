import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { rolesWithPermission } from "../../access/domain/roles.js"
import { loadAvatarPresenter, personAvatarLoader } from "../../profile-preferences/application/person-presentation-loader.js"
import { DEFAULT_ORGANIZATION_TIMEZONE } from "../../workflows/application/organization-timezone.js"
import { decodeCursor } from "../domain/assistant-conversation.js"
import { CONVERSATION_SUMMARY_SELECT, loadConversationMessages, toSummary, type ConversationSummary, type ConversationSummaryRow } from "./assistant-conversations.js"
import { loadAssistantSupportMaterials } from "./assistant-support-materials.js"
import { resolveAccessibleKnowledgeMaterials } from "../../knowledge/application/knowledge-material-access.js"
import { parseClarificationState } from "../../knowledge-clarification/domain/clarification-state.js"
import { referencedDocumentIds, toClarificationView } from "../../knowledge-clarification/domain/clarification-view.js"

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
/** O alcance depende só do DONO da conversa (`owner`): Grupo, Subgrupo ou estrutura dele. */
const OWNER_VISIBLE = `(
    exists (select 1 from grants g where g.scope_type = 'ORGANIZATION')
    or exists (select 1 from grants g where g.scope_type = 'GROUP' and g.team_id = owner.team_id)
    or exists (select 1 from grants g where g.scope_type = 'SUBGROUP' and g.subteam_id = owner.subteam_id)
    or owner.id in (select id from subordinates)
  )`
/** Filtro de alcance sobre a conversa `c` e o dono `owner`. */
const VISIBLE = `c.organization_id = $1 and ${OWNER_VISIBLE}`
/** Fuso da organização calculado UMA vez por consulta (antes era uma subconsulta por conversa). */
const ORGANIZATION_TIMEZONE = `cross join (select coalesce((select op.timezone from operations op where op.organization_id = $1 order by op.created_at limit 1), '${DEFAULT_ORGANIZATION_TIMEZONE}') timezone) o`
const FROM = `from assistant_conversations c
  join people owner on owner.id = c.owner_person_id and owner.organization_id = c.organization_id
  left join teams t on t.id = owner.team_id
  left join subteams st on st.id = owner.subteam_id
  ${ORGANIZATION_TIMEZONE}`

/** Prévia (última mensagem) de quem monitora: resposta com cartão de dados nunca aparece na lista — só aberta, com o filtro do leitor. */
export const MONITORING_DATA_PREVIEW = "Resposta com dados de pessoas — abra a conversa para ver o que está no seu escopo."
const MONITORING_LAST_MESSAGE_JOIN = `left join lateral (
    select m.role, case when m.role = 'assistant' and jsonb_typeof(m.tool_calls) = 'array' and jsonb_path_exists(m.tool_calls, '$[*].analytics') then '${MONITORING_DATA_PREVIEW}' else m.content end content, m.channel
    from assistant_interactions m where m.conversation_id = c.id order by m.occurred_at desc, m.seq desc limit 1
  ) last_message on true`

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
/** Foto do dono pela apresentação (personalizada > corporativa > iniciais): UMA leitura em lote para as conversas da resposta. */
async function presentOwners(db: Queryable, organizationId: string, rows: Row[]): Promise<MonitoredConversation[]> {
  const present = await loadAvatarPresenter(personAvatarLoader(db), organizationId, rows.map((row) => row.owner_id))
  return rows.map(toMonitored).map((conversation) => ({ ...conversation, owner: present(conversation.owner) }))
}

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
  // Datas locais viram instantes (início do dia `from`, início do dia seguinte a `to`, no fuso da organização): a mesma regra
  // de antes, mas comparando a coluna como está — o índice de última atividade serve.
  if (filters.from) clauses.push(`c.last_activity_at >= (${add(filters.from)}::date)::timestamp at time zone o.timezone`)
  if (filters.to) clauses.push(`c.last_activity_at < (${add(filters.to)}::date + 1)::timestamp at time zone o.timezone`)
  return clauses.length > 0 ? ` and ${clauses.join(" and ")}` : ""
}

export async function listMonitoredConversations(db: Queryable, viewer: MonitoringViewer, filters: MonitoringFilters) {
  const params: unknown[] = baseParams(viewer)
  const extra = filterSql(filters, params)
  const countParams = [...params]
  params.push(filters.pageSize, (filters.page - 1) * filters.pageSize)
  const optionParams = baseParams(viewer)
  const [rows, total, owners] = await Promise.all([
    db.query<Row>(
      `${SCOPE_CTE} select ${CONVERSATION_SUMMARY_SELECT}, ${OWNER_SELECT} ${FROM} ${MONITORING_LAST_MESSAGE_JOIN}
       where ${VISIBLE}${extra}
       order by c.last_activity_at desc, c.id desc limit $${params.length - 1} offset $${params.length}`,
      params,
    ),
    db.query<{ n: number }>(`${SCOPE_CTE} select count(*)::int n ${FROM} where ${VISIBLE}${extra}`, countParams),
    // Opções de filtro derivadas do PRÓPRIO alcance (nunca listam quem está fora dele): as PESSOAS no alcance que têm ao menos
    // uma conversa — uma consulta pelo índice de dono por pessoa, em vez de um distinct sobre todas as conversas a cada
    // atualização da tela (20 s). Grupos e Subgrupos saem dessas mesmas pessoas.
    db.query<{ id: string; name: string; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null }>(
      `${SCOPE_CTE} select owner.id, owner.name, owner.team_id, t.name team_name, owner.subteam_id, st.name subteam_name
         from people owner
         left join teams t on t.id = owner.team_id
         left join subteams st on st.id = owner.subteam_id
        where owner.organization_id = $1 and ${OWNER_VISIBLE}
          and exists (select 1 from assistant_conversations c where c.organization_id = $1 and c.owner_person_id = owner.id)
        order by owner.name`,
      optionParams,
    ),
  ])
  const teamOptions = new Map<string, string>()
  const subteamOptions = new Map<string, { id: string; name: string; teamId: string | null }>()
  for (const row of owners.rows) {
    if (row.team_id && row.team_name) teamOptions.set(row.team_id, row.team_name)
    if (row.subteam_id && row.subteam_name) subteamOptions.set(row.subteam_id, { id: row.subteam_id, name: row.subteam_name, teamId: row.team_id })
  }
  return {
    items: await presentOwners(db, viewer.organizationId, rows.rows),
    total: total.rows[0]?.n ?? 0,
    filterOptions: {
      operators: owners.rows.slice(0, 500).map((row) => ({ id: row.id, name: row.name })),
      teams: [...teamOptions].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
      subteams: [...subteamOptions.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    },
  }
}

/** Conversa no alcance do leitor — ou 404 (fora do alcance e inexistente são indistinguíveis). */
export async function requireMonitoredConversation(db: Queryable, viewer: MonitoringViewer, conversationId: string): Promise<MonitoredConversation> {
  const params = [...baseParams(viewer), conversationId]
  const result = await db.query<Row>(`${SCOPE_CTE} select ${CONVERSATION_SUMMARY_SELECT}, ${OWNER_SELECT} ${FROM} ${MONITORING_LAST_MESSAGE_JOIN} where ${VISIBLE} and c.id = $4::uuid`, params)
  const row = result.rows[0]
  if (!row) throw new DomainError("Conversa não encontrada.", "ASSISTANT_CONVERSATION_NOT_FOUND", 404)
  return (await presentOwners(db, viewer.organizationId, [row]))[0]!
}

/** Texto no lugar de uma resposta com dados de pessoas que o LEITOR não alcança. */
export const OUT_OF_READER_SCOPE_NOTICE = "Resposta com dados de pessoas fora do seu escopo de leitura (a estrutura de quem perguntou é maior que a sua). O conteúdo não é exibido aqui."

/**
 * Cartões que o LEITOR pode ver: os que falam do próprio dono da conversa ou de estruturas que o escopo de dados do leitor
 * alcança. Quem chama resolve o escopo (o mesmo `visibleCards` do dono, com o escopo de quem lê).
 */
export type ReaderCardFilter = (input: { ownerPersonId: string; cards: unknown[] }) => Promise<unknown[]>

/**
 * Mensagens da conversa (já autorizada aqui), com materiais de apoio resolvidos pelo acesso do LEITOR. Ler a conversa de alguém
 * não amplia o acesso a DADOS (achado SCOPE-01/AI-03 da auditoria de 17/10/2026): a conversa de um líder traz tabelas da
 * estrutura dele (nomes, resultados, situação funcional), que pode ser maior que a do leitor. Resposta com algum cartão que o
 * leitor não alcança sai sem o texto e sem os cartões — o texto repete os mesmos dados.
 */
export async function loadMonitoredMessages(db: Queryable, viewer: MonitoringViewer, conversationId: string, page: { limit: number; before?: string | undefined; after?: string | undefined }, readerCards?: ReaderCardFilter) {
  const conversation = await requireMonitoredConversation(db, viewer, conversationId)
  const result = await loadConversationMessages(db, { organizationId: viewer.organizationId, conversationId, limit: page.limit, before: decodeCursor(page.before), after: decodeCursor(page.after) })
  const materials = await loadAssistantSupportMaterials(db, { organizationId: viewer.organizationId, viewer: { personId: viewer.personId }, interactionIds: result.messages.filter((m) => m.role === "assistant").map((m) => m.id) })
  const withCards = result.messages.filter((message) => message.analytics.length > 0)
  // Sem filtro informado, nenhuma resposta com cartão de dados aparece (falha fechada).
  const visible = new Set(withCards.length > 0 && readerCards ? await readerCards({ ownerPersonId: conversation.owner.personId, cards: withCards.flatMap((message) => message.analytics) }) : [])
  // ESCLARECIMENTO PELAS BASES — a trilha de auditoria (opções com a fonte de cada uma, fontes da resposta), com as bases resolvidas
  // pelo acesso do LEITOR: base que quem lê não pode abrir aparece sem título (a referência gravada não concede acesso).
  const clarifications = result.messages.flatMap((message) => {
    const state = message.role === "assistant" ? parseClarificationState(message.clarification) : null
    return state ? [{ id: message.id, state }] : []
  })
  const documentIds = [...new Set(clarifications.flatMap((item) => referencedDocumentIds(item.state)))]
  const readable = documentIds.length > 0 ? new Set((await resolveAccessibleKnowledgeMaterials(db, { organizationId: viewer.organizationId, viewer: { personId: viewer.personId }, materialIds: documentIds })).keys()) : new Set<string>()
  const clarificationViews = new Map(clarifications.map((item) => [item.id, toClarificationView(item.state, readable)]))
  return {
    conversation,
    // `clarificationScope` (onde o esclarecimento foi feito) é uso interno do servidor: nunca vai à tela.
    messages: result.messages.map(({ clarificationScope, ...message }) => {
      void clarificationScope
      const hidden = message.analytics.some((card) => !visible.has(card))
      return { ...message, ...(hidden ? { content: OUT_OF_READER_SCOPE_NOTICE, analytics: [], outOfReaderScope: true } : {}), supportMaterials: materials.get(message.id) ?? [], clarification: hidden ? null : (clarificationViews.get(message.id) ?? null) }
    }),
    hasMore: result.hasMore,
  }
}
