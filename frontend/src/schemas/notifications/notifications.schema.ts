import { z } from "zod"

/** Espelho de backend/src/modules/notifications/domain/view-models.ts. */
export const notificationKindSchema = z.enum(["HUMAN_REVIEW", "WORKFLOW_OUTPUT", "INIA_MESSAGE", "ESCALATION", "WORKDAY_RECONCILIATION", "CALENDAR_NOTICE", "OTHER"])
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const notificationTargetSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("PENDING_ACTION"), actionId: z.string() }),
  z.object({ type: z.literal("FOLLOW_UP"), itemId: z.string(), operatorId: z.string().nullable() }),
  z.object({ type: z.literal("TEAM_CALENDAR"), operatorId: z.string().nullable(), date: z.string().nullable() }),
  z.object({ type: z.literal("ADMIN_CALENDAR") }),
  z.object({ type: z.literal("ADMIN_DATA_HUB") }),
  z.object({ type: z.literal("ADMIN_AI_USAGE") }),
  z.object({ type: z.literal("INIA_CONVERSATION"), conversationId: z.string() }),
  z.object({ type: z.literal("INIA_AVATAR_DELIVERY"), deliveryId: z.string() }),
  z.object({ type: z.literal("NONE") }),
])
export type NotificationTarget = z.infer<typeof notificationTargetSchema>

export const notificationItemSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  title: z.string(),
  description: z.string(),
  severity: z.enum(["INFO", "MEDIUM", "HIGH", "CRITICAL"]),
  createdAt: z.string(),
  readAt: z.string().nullable(),
  resolved: z.boolean(),
  operator: z.object({ personId: z.string(), name: z.string() }).nullable(),
  actionable: z.boolean(),
  target: notificationTargetSchema,
})
export type NotificationItem = z.infer<typeof notificationItemSchema>

export const notificationSummarySchema = z.object({
  unreadCount: z.number(),
  pendingActionCount: z.number(),
  items: z.array(notificationItemSchema),
})
export type NotificationSummary = z.infer<typeof notificationSummarySchema>

export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  HUMAN_REVIEW: "Revisão pendente",
  WORKFLOW_OUTPUT: "Novo acompanhamento",
  INIA_MESSAGE: "Recado da INIA",
  ESCALATION: "Escalonamento",
  WORKDAY_RECONCILIATION: "Produção não identificada",
  CALENDAR_NOTICE: "Calendário operacional",
  OTHER: "Aviso",
}
