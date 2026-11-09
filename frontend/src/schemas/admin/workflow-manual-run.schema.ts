import { z } from "zod"

import { manualTriggerContextSchema } from "./workflow.schema"

/**
 * Gatilho MANUAL — espelho do contrato de `/admin/workflows/:id/manual-run*` (backend manual-run.ts). O disparo só cria a
 * execução normal do motor; estas telas acompanham o estado REAL dela e as entregas persistidas — "solicitado" nunca é
 * "entregue".
 */

export const manualRunBlockerSchema = z.object({ code: z.string(), message: z.string() })
export type ManualRunBlocker = z.infer<typeof manualRunBlockerSchema>

export const manualRunSummarySchema = z.object({
  id: z.string(),
  requestedAt: z.coerce.string(),
  requestedByName: z.string(),
  collaboratorName: z.string(),
  status: z.string().nullable(),
  enrollmentId: z.string().nullable(),
})
export type ManualRunSummary = z.infer<typeof manualRunSummarySchema>

export const manualRunInfoSchema = z.object({
  workflowId: z.string(),
  workflowName: z.string(),
  context: manualTriggerContextSchema.nullable(),
  indicator: z.object({ code: z.string(), name: z.string().nullable(), unit: z.string().nullable() }).nullable(),
  published: z.boolean(),
  active: z.boolean(),
  blockers: z.array(manualRunBlockerSchema),
  recentRuns: z.array(manualRunSummarySchema),
})
export type ManualRunInfo = z.infer<typeof manualRunInfoSchema>

export const manualRunCollaboratorSchema = z.object({
  id: z.string(),
  name: z.string(),
  matricula: z.string().nullable(),
  jobTitle: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamName: z.string().nullable(),
})
export type ManualRunCollaborator = z.infer<typeof manualRunCollaboratorSchema>

export const manualRunCollaboratorsSchema = z.object({ items: z.array(manualRunCollaboratorSchema), total: z.number() })

export const manualRunInteractionSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  /** Motivo da interação. */
  subject: z.string(),
  /** Submotivo; null = a fonte não informou. */
  subReason: z.string().nullable().optional(),
  channel: z.string(),
  startedAt: z.coerce.string(),
  endedAt: z.coerce.string(),
  durationSeconds: z.number(),
  flags: z.array(z.object({ name: z.string(), value: z.string().nullable() })),
})
export type ManualRunInteraction = z.infer<typeof manualRunInteractionSchema>

export const manualRunMeasurementSchema = z.object({ id: z.string(), periodStart: z.coerce.string(), periodEnd: z.coerce.string(), value: z.number(), source: z.string() })
export type ManualRunMeasurement = z.infer<typeof manualRunMeasurementSchema>

/** BLOCKED = parou numa etapa, por agente (PEN-070/073) ou por revisão sem revisor ou sem conteúdo (P5c) — terminal até alguém pedir nova tentativa. */
export const manualRunStageSchema = z.enum(["QUEUED", "PROCESSING", "RETRYING", "WAITING", "COMPLETED", "FAILED", "BLOCKED"])
export type ManualRunStage = z.infer<typeof manualRunStageSchema>

export const manualRunDeliverySchema = z.object({
  surface: z.string(),
  status: z.string(),
  recipientName: z.string().nullable(),
  createdAt: z.coerce.string(),
  deliveredAt: z.coerce.string().nullable(),
  title: z.string().nullable(),
})
export type ManualRunDelivery = z.infer<typeof manualRunDeliverySchema>

export const manualRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  workflowName: z.string(),
  versionId: z.string(),
  versionNumber: z.number(),
  requestedAt: z.coerce.string(),
  requestedBy: z.object({ id: z.string(), name: z.string() }),
  context: manualTriggerContextSchema,
  collaborator: z.object({ id: z.string(), name: z.string(), matricula: z.string().nullable() }),
  interaction: z.object({ id: z.string(), subject: z.string(), subReason: z.string().nullable().optional(), startedAt: z.coerce.string() }).nullable(),
  measurement: z.object({ id: z.string(), periodStart: z.coerce.string(), periodEnd: z.coerce.string(), value: z.number(), indicatorName: z.string().nullable() }).nullable(),
  execution: z.object({
    enrollmentId: z.string(),
    status: z.string(),
    stage: manualRunStageSchema,
    /** Motivo de "blocked" (agente inativo, acesso não autorizado, revisão sem revisor ou sem conteúdo); null nos demais estados. */
    blockedReason: z.string().nullable().catch(null).default(null),
    /** Só nos bloqueios de Revisão humana: por que não há revisor ou conteúdo. */
    blockedCause: z.string().nullable().catch(null).default(null),
    currentNodeId: z.string(),
    currentNodeLabel: z.string().nullable(),
    waitingFor: z.enum(["HUMAN_REVIEW", "FEEDBACK_QA", "WAIT"]).nullable(),
    lastError: z.string().nullable(),
    nextRetryAt: z.coerce.string().nullable(),
    updatedAt: z.coerce.string(),
    events: z.array(z.object({ nodeId: z.string(), nodeLabel: z.string().nullable(), eventType: z.string(), createdAt: z.coerce.string() })),
  }),
  deliveries: z.array(manualRunDeliverySchema),
  interventions: z.array(z.object({ id: z.string(), caseId: z.string(), typeName: z.string(), status: z.string(), responsibleName: z.string(), dueAt: z.string() })).default([]),
})
export type ManualRun = z.infer<typeof manualRunSchema>

export const manualRunRequestResultSchema = z.object({ created: z.boolean(), run: manualRunSchema.nullable() })

export const MANUAL_RUN_STAGE_LABELS: Record<ManualRunStage, string> = {
  QUEUED: "Execução iniciada — na fila do motor",
  PROCESSING: "Em processamento",
  RETRYING: "Falhou nesta tentativa — o motor vai tentar de novo",
  WAITING: "Aguardando",
  COMPLETED: "Concluída",
  FAILED: "Falhou",
  // O motivo aparece logo abaixo, no diálogo.
  BLOCKED: "Bloqueada",
}

export const MANUAL_RUN_WAITING_LABELS: Record<NonNullable<ManualRun["execution"]["waitingFor"]>, string> = {
  FEEDBACK_QA: "Feedback retido para o QA de feedback — nada é entregue até a avaliação",
  HUMAN_REVIEW: "Aguardando a Revisão humana",
  WAIT: "No nó Espera",
}

const SURFACE_LABELS: Record<string, string> = { AVATAR: "Avatar", CHAT: "Chat da INIA", FOLLOW_UP: "Acompanhamento", NOTIFICATION: "Notificação" }

/** Frase de uma entrega PERSISTIDA — no Avatar, "disponível" (convite) ≠ "ouvido" (a fala terminou). */
export function describeManualRunDelivery(delivery: ManualRunDelivery): string {
  const surface = SURFACE_LABELS[delivery.surface] ?? delivery.surface
  const who = delivery.recipientName ?? "o destinatário"
  if (delivery.surface === "AVATAR") {
    if (delivery.status === "DELIVERED") return `${surface}: ${who} ouviu o recado.`
    if (delivery.status === "FAILED" || delivery.status === "INTERRUPTED") return `${surface}: a fala não foi concluída (${delivery.status === "FAILED" ? "falhou" : "interrompida"}) — o recado continua disponível para ${who}.`
    if (delivery.status === "ACCEPTED" || delivery.status === "PLAYING") return `${surface}: ${who} aceitou e o recado está tocando.`
    return `${surface}: recado disponível para ${who} (convite no painel da INIA — ainda não ouvido).`
  }
  if (delivery.surface === "CHAT") return `${surface}: conversa nova criada para ${who}.`
  if (delivery.surface === "FOLLOW_UP") return `${surface}: feedback publicado para ${who}.`
  return `${surface}: entregue para ${who}.`
}
