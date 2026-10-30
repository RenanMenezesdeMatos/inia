import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { recordPersonalDataAccess } from "../../data-lifecycle/application/personal-data-access-log.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { visibleCards } from "../../leadership-analytics/application/leadership-context.js"
import type { LeadershipCard } from "../../leadership-analytics/domain/view-models.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { listMonitoredConversations, loadMonitoredMessages, MONITORING_ORIGIN_FILTERS, MONITORING_STATUS_FILTERS, requireMonitoredConversation, type MonitoringViewer, type ReaderCardFilter } from "../application/conversation-monitoring.js"
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
const messagesSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30), before: z.string().max(200).optional(), after: z.string().max(200).optional() })
const idParam = z.string().uuid()

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
  return router
}

/** Cartão de "meus resultados" do próprio dono da conversa (dado dele, que o leitor já pode ler na conversa). */
function isCardAbout(card: unknown, personId: string): boolean {
  const subject = (card as { structure?: { subject?: { kind?: unknown; employeeId?: unknown } } } | null)?.structure?.subject
  return subject?.kind === "EMPLOYEE" && subject.employeeId === personId
}
