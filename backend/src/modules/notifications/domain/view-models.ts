/**
 * Contrato do SINO ("algo novo aconteceu") — separado de Pendências (ação) e de Acompanhamento
 * (conteúdo). Cada notificação é um alerta real endereçado ao viewer, com um DESTINO decidido
 * pelo backend; o frontend só traduz o destino em rota. Ler ≠ resolver: marcar como lida
 * altera só `readAt`; decidir uma revisão é outra operação (pending-actions).
 */
export type NotificationKind = "HUMAN_REVIEW" | "WORKFLOW_OUTPUT" | "INIA_MESSAGE" | "ESCALATION" | "WORKDAY_RECONCILIATION" | "CALENDAR_NOTICE" | "INTERVENTION" | "FEEDBACK_CONTESTATION" | "OTHER"

export type NotificationTarget =
  | { type: "PENDING_ACTION"; actionId: string }
  | { type: "FOLLOW_UP"; itemId: string; operatorId: string | null }
  /** Avisos do calendário operacional (divergência plano × realidade, inconsistência de situação, classificação superada por dado tardio). */
  | { type: "TEAM_CALENDAR"; operatorId: string | null; date: string | null }
  | { type: "ADMIN_CALENDAR" }
  /** Fonte de dados atrasada em relação ao SLA de disponibilidade (D-1/D-2) — Central de Dados. */
  | { type: "ADMIN_DATA_HUB" }
  /** Orçamento de IA atingiu um limiar (70/90/100%) — Administração › IA / Modelos. */
  | { type: "ADMIN_AI_USAGE" }
  /** Aviso de execução bloqueada a quem publicou: abre a aba Execuções do workflow. */
  | { type: "ADMIN_WORKFLOW_EXECUTIONS"; workflowId: string }
  /** Workflow Outputs V1 — conversa nova da INIA (Output → Chat): abre a conversa no painel da INIA. */
  | { type: "INIA_CONVERSATION"; conversationId: string }
  /** Workflow Outputs V1 — recado de voz (Output → Avatar): destaca o convite no painel da INIA (nunca toca sozinho). */
  | { type: "INIA_AVATAR_DELIVERY"; deliveryId: string }
  /** Intervenção (atribuição, aprovação, decisão, novo sinal): abre a intervenção DENTRO do caso de supervisão. */
  | { type: "INTERVENTION"; caseId: string; interventionId: string }
  /** Contestação de feedback recebida — abre a contestação na Administração (quem revisa). */
  | { type: "ADMIN_FEEDBACK_CONTESTATION"; contestationId: string }
  | { type: "NONE" }

export type NotificationItem = {
  id: string
  kind: NotificationKind
  title: string
  description: string
  severity: "INFO" | "MEDIUM" | "HIGH" | "CRITICAL"
  createdAt: string
  readAt: string | null
  /** Alerta já resolvido no domínio (ex.: revisão decidida) — continua listado como histórico. */
  resolved: boolean
  operator: { personId: string; name: string } | null
  /** Só para revisões: continua exigindo decisão? (decidida/indisponível → false) */
  actionable: boolean
  target: NotificationTarget
}

export type NotificationSummary = {
  unreadCount: number
  pendingActionCount: number
  items: NotificationItem[]
}
