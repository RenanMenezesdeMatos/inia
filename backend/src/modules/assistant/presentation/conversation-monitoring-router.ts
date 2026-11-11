import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { visibleCards } from "../../leadership-analytics/application/leadership-context.js"
import type { LeadershipCard } from "../../leadership-analytics/domain/view-models.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { listMonitoredConversations, loadMonitoredMessages, monitoredResponseTimes, MONITORING_ORIGIN_FILTERS, MONITORING_STATUS_FILTERS, requireMonitoredConversation, type MonitoringViewer, type ReaderCardFilter } from "../application/conversation-monitoring.js"
import { sessionUser } from "../../auth/presentation/session-user.js"

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const listSchema = z.object({
  search: z.string().trim().max(100).optional(),
  ownerPersonId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  status: z.enum(MONITORING_STATUS_FILTERS).optional(),
  origin: z.enum(MONITORING_ORIGIN_FILTERS).optional(),
  from: localDate.optional(),
  to: localDate.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
const MAX_RESPONSE_TIME_DAYS = 366
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000
/** Tempo de resposta: os filtros da lista (sem página) e um período obrigatório de 1 a 366 dias, sobre a data da resposta. */
const responseTimesSchema = listSchema
  .omit({ page: true, pageSize: true, from: true, to: true })
  .extend({ from: localDate, to: localDate })
  .refine((query) => dayNumber(query.to) >= dayNumber(query.from), { message: "A data inicial precisa ser antes da final.", path: ["from"] })
  .refine((query) => dayNumber(query.to) - dayNumber(query.from) + 1 <= MAX_RESPONSE_TIME_DAYS, { message: `Escolha um período de até ${MAX_RESPONSE_TIME_DAYS} dias.`, path: ["to"] })
const messagesSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().max(200).optional(), after: z.string().max(200).optional() })
const idParam = z.string().uuid()

/** Orientação de cada chamada impedida — para quem lê a conversa; o colaborador só leu que a parte estava indisponível. */
const OUTCOME_GUIDANCE: Record<string, string> = {
  BLOCKED_INACTIVE: "Agente inativo: a parte da resposta que dependia dele ficou indisponível. Reative ou substitua o agente no orquestrador.",
  BLOCKED_UNAUTHORIZED: "Acesso não autorizado neste contexto: a versão vigente do agente não está autorizada para o alcance do orquestrador (alcance ou bases). A parte da resposta ficou indisponível; revise a versão vigente do agente.",
}

/**
 * Conversas com a INIA — `/api/v1/admin/assistant-conversations`. Montado atrás de `assistant_conversations.view` (em
 * qualquer escopo); o recorte concreto (quem aparece) é aplicado em CADA consulta pelo escopo das atribuições. Somente
 * leitura: não existe rota de envio, edição ou exclusão.
 */
export function createConversationMonitoringRouter(db: Database, deps: { readerCards?: (reader: AuthTokenPayload) => ReaderCardFilter } = {}) {
  const router = Router()
  const viewerOf = (request: { user?: { organizationId: string; personId: string } }): MonitoringViewer => ({ organizationId: sessionUser(request).organizationId, personId: sessionUser(request).personId })
  // Cartões de dados que o LEITOR alcança: os do próprio dono ("meus resultados" dele) e as estruturas do escopo de dados de quem lê.
  const readerCards = deps.readerCards ?? ((reader: AuthTokenPayload): ReaderCardFilter => async ({ ownerPersonId, cards }) => {
    const scope = await loadViewerScope(new PgAnalyticsReadRepository(db), reader, "indicators.view").catch(() => null)
    const allowed = new Set<unknown>(visibleCards(scope, cards as LeadershipCard[]))
    for (const card of cards) if (isCardAbout(card, ownerPersonId)) allowed.add(card)
    return [...allowed]
  })

  router.get("/", async (request, response) => {
    const filters = listSchema.parse(request.query)
    const result = await listMonitoredConversations(db, viewerOf(request), filters)
    response.json({ data: { ...result, page: filters.page, pageSize: filters.pageSize } })
  })
  // Antes de "/:conversationId": "response-times" não é id de conversa.
  router.get("/response-times", async (request, response) => {
    response.json({ data: await monitoredResponseTimes(db, viewerOf(request), responseTimesSchema.parse(request.query)) })
  })
  router.get("/:conversationId", async (request, response) => {
    response.json({ data: await requireMonitoredConversation(db, viewerOf(request), idParam.parse(request.params.conversationId)) })
  })
  router.get("/:conversationId/messages", async (request, response) => {
    const page = messagesSchema.parse(request.query)
    const viewer = viewerOf(request)
    const result = await loadMonitoredMessages(db, viewer, idParam.parse(request.params.conversationId), page, readerCards(sessionUser(request)))
    // LGPD: quem leu a conversa de outra pessoa (migration 151).
    await recordPersonalDataAccess(db, { organizationId: viewer.organizationId, viewerPersonId: viewer.personId, subjectPersonId: result.conversation.owner.personId, dataKind: "ASSISTANT_CONVERSATION", resourceId: result.conversation.id })
    response.json({ data: result })
  })
  /**
   * "Ver histórico desta conversa" (PEN-071; aviso do chat confirmado em 03/11/2026): os agentes que atuaram NESTA conversa, com a
   * versão usada e, quando a chamada foi impedida, "Agente inativo" e a orientação de reativar ou substituir — só para quem lê a
   * conversa no alcance dele (a mesma autorização das mensagens). Nunca o cadastro nem outras conversas do agente; a dona da
   * conversa não recebe este motivo (o chat dela só mostra a explicação da resposta).
   */
  router.get("/:conversationId/agent-records", async (request, response) => {
    const viewer = viewerOf(request)
    const conversation = await requireMonitoredConversation(db, viewer, idParam.parse(request.params.conversationId))
    const rows = await db.query(
      `select ia.interaction_id "interactionId", i.occurred_at "occurredAt", ia.role, ia.outcome, ia.agent_id "agentId", a.name "agentName", a.active "agentActive",
              av.version_number "agentVersionNumber", o.name "orchestratorName", ov.version_number "orchestratorVersionNumber"
         from assistant_interaction_agents ia
         join assistant_interactions i on i.id = ia.interaction_id
         join agents_all a on a.id = ia.agent_id
         left join agent_versions av on av.id = ia.agent_version_id
         left join assistant_orchestrators_all o on o.id = ia.orchestrator_id
         left join assistant_orchestrator_versions ov on ov.id = ia.orchestrator_version_id
        where i.conversation_id = $1 and ia.organization_id = $2
        order by i.occurred_at, ia.role desc`,
      [conversation.id, viewer.organizationId],
    )
    response.json({ data: rows.rows.map((row: { outcome: string }) => ({ ...row, guidance: OUTCOME_GUIDANCE[row.outcome] ?? null })) })
  })

  return router
}

/** Cartão de "meus resultados" do próprio dono da conversa (dado dele, que o leitor já pode ler na conversa). */
function isCardAbout(card: unknown, personId: string): boolean {
  const subject = (card as { structure?: { subject?: { kind?: unknown; employeeId?: unknown } } } | null)?.structure?.subject
  return subject?.kind === "EMPLOYEE" && subject.employeeId === personId
}
