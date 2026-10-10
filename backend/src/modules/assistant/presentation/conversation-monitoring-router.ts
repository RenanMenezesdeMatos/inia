import { Router } from "express"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { listMonitoredConversations, loadMonitoredMessages, MONITORING_ORIGIN_FILTERS, MONITORING_STATUS_FILTERS, requireMonitoredConversation, type MonitoringViewer } from "../application/conversation-monitoring.js"

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
export function createConversationMonitoringRouter(db: Database) {
  const router = Router()
  const viewerOf = (request: { user?: { organizationId: string; personId: string } }): MonitoringViewer => ({ organizationId: request.user!.organizationId, personId: request.user!.personId })

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
    response.json({ data: await loadMonitoredMessages(db, viewerOf(request), idParam.parse(request.params.conversationId), page) })
  })
  return router
}
