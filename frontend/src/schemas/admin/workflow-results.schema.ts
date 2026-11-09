import { z } from "zod"
import { executionFailureSchema } from "@/schemas/admin/execution-failure.schema"
import { workflowEnrollmentStatusSchema } from "@/schemas/admin/workflow.schema"

/**
 * V1.5.13 — aba "Resultados" do Workflow (read model do backend: workflows/application/workflow-results-reader.ts).
 * DISPARO = matrícula raiz (fan-out = 1 disparo, N pessoas). Tokens/custo são os REGISTRADOS pelo provider; null = N/D.
 */
export const DISPATCH_STATUSES = ["RUNNING", "COMPLETED", "PARTIAL", "FAILED", "BLOCKED"] as const
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number]
export const DISPATCH_STATUS_LABELS: Record<DispatchStatus, string> = { RUNNING: "Em andamento", COMPLETED: "Concluído", PARTIAL: "Concluído com falhas", FAILED: "Falhou", BLOCKED: "Bloqueada" }

export const RESULT_TRIGGER_KINDS = ["FLAG", "INDICATOR", "SCHEDULE", "MANUAL"] as const
export type ResultTriggerKind = (typeof RESULT_TRIGGER_KINDS)[number]
export const RESULT_TRIGGER_KIND_LABELS: Record<ResultTriggerKind, string> = { FLAG: "Flag", INDICATOR: "Indicador", SCHEDULE: "Agenda", MANUAL: "Manual" }

export const usageTotalsSchema = z.object({
  calls: z.number(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  incomplete: z.boolean(),
  costs: z.array(z.object({ currency: z.string(), amount: z.string() })),
  costUnknownCalls: z.number(),
})
export type UsageTotals = z.infer<typeof usageTotalsSchema>

export const dispatchRowSchema = z.object({
  rootEnrollmentId: z.string(),
  createdAt: z.string(),
  status: z.enum(DISPATCH_STATUSES),
  trigger: z.object({ kind: z.enum(RESULT_TRIGGER_KINDS), label: z.string() }),
  version: z.object({ id: z.string(), number: z.number(), active: z.boolean() }),
  consolidated: z.boolean(),
  persons: z.number(),
  feedbacksProduced: z.number(),
  feedbacksSent: z.number(),
  awaitingQa: z.number(),
  blocked: z.number(),
  usage: usageTotalsSchema,
  durationMs: z.number().nullable(),
})
export type DispatchRow = z.infer<typeof dispatchRowSchema>

export const resultsSummarySchema = z.object({
  period: z.object({ from: z.string(), to: z.string() }),
  dispatches: z.number(),
  persons: z.number(),
  feedbacksProduced: z.number(),
  feedbacksSent: z.number(),
  awaitingQa: z.number(),
  blocked: z.number(),
  usage: usageTotalsSchema,
})
export type ResultsSummary = z.infer<typeof resultsSummarySchema>

const wordingSchema = z.object({ observed: z.string(), whyItMatters: z.string(), whatYouCanDo: z.string(), suggestedResponse: z.string().optional() })
/** V1.7.1a — análise completa × feedback (null no legado, em artefato pendente e em respostas anteriores). */
const findingsSchema = z.object({ detected: z.number(), reliable: z.number(), inFeedback: z.number(), blocked: z.number(), heldForQa: z.number(), rejected: z.number(), collapsedDuplicates: z.number(), notObservable: z.number(), notApplicable: z.number(), outsideContract: z.number().optional(), notCheckpoint: z.number().optional() })
export type ResultFindings = z.infer<typeof findingsSchema>
export const resultFeedbackSchema = z.object({
  /** ENGINE = motor de feedback (diagnóstico → mensagem, sem QA); RELIABLE/LEGACY = caminhos anteriores (leitura). */
  kind: z.enum(["RELIABLE", "LEGACY", "ENGINE"]),
  nodeId: z.string(),
  nodeLabel: z.string(),
  domain: z.enum(["MONITORING", "INDICATOR"]).nullable(),
  label: z.string().nullable(),
  disposition: z.enum(["READY", "HOLD_FOR_QA", "BLOCKED", "REJECTED", "PENDING", "FAILED", "PUBLISHED", "ABSTAINED"]),
  reasons: z.array(z.string()),
  items: z.array(
    z.object({
      /** V1.7.1b: ATTENTION = "Vale confirmar o produto" (incerteza de aplicabilidade — nunca erro). */
      section: z.enum(["STRENGTH", "OPPORTUNITY", "ATTENTION"]),
      sectionLabel: z.string(),
      wording: wordingSchema,
      wordingSource: z.enum(["PROPOSED", "HUMAN_EDITED"]),
      qaStatus: z.enum(["NOT_SELECTED_FOR_QA", "PENDING_REVIEW", "APPROVED_UNCHANGED", "APPROVED_EDITED", "REJECTED"]),
      facts: z.array(z.object({ role: z.string(), text: z.string(), truncated: z.boolean() })),
      stepTitle: z.string().nullable().optional(),
      priorityRank: z.number().nullable().optional(),
    }),
  ),
  findings: findingsSchema.nullable().optional(),
  /** V1.7.1b — saudação/abertura/fechamento do que saiu (SYSTEM = versão do sistema; WRITER = do redator, validada). */
  presentation: z.object({ greeting: z.string(), introduction: z.string(), closing: z.string(), source: z.enum(["WRITER", "SYSTEM"]) }).nullable().optional(),
  legacy: z.object({ impactedIndicator: z.string(), observedBehavior: z.string(), recommendation: z.string(), evidenceFound: z.string(), status: z.string() }).nullable(),
  engine: z.object({ card: z.string().nullable(), narrative: z.array(z.string()), tone: z.string().nullable(), developments: z.number(), strengths: z.number(), abstainDetail: z.string().nullable() }).nullable().optional(),
  sent: z.boolean(),
  emittedAt: z.string().nullable(),
  error: z.string().nullable(),
})
export type ResultFeedback = z.infer<typeof resultFeedbackSchema>

const aiCallSchema = z.object({
  nodeId: z.string().nullable(),
  nodeLabel: z.string().nullable(),
  actor: z.string().nullable(),
  useCase: z.string(),
  useCaseLabel: z.string(),
  providerKey: z.string(),
  modelName: z.string(),
  usage: usageTotalsSchema,
})
export type ResultAiCall = z.infer<typeof aiCallSchema>

export const personResultSchema = z.object({
  enrollmentId: z.string(),
  person: z.object({ id: z.string(), name: z.string(), teamName: z.string().nullable(), subteamName: z.string().nullable() }),
  status: workflowEnrollmentStatusSchema,
  waitingForQa: z.boolean(),
  agents: z.array(z.object({ nodeId: z.string(), name: z.string() })),
  /** V1.7.1 — roteamento DETERMINISTIC|MODEL e síntese PASSTHROUGH|MODEL|NONE (null = não informado, execuções anteriores). */
  orchestrators: z.array(z.object({ nodeId: z.string(), name: z.string(), routing: z.enum(["DETERMINISTIC", "MODEL"]).nullable().catch(null), synthesis: z.enum(["PASSTHROUGH", "MODEL", "NONE"]).nullable().catch(null) })),
  feedbacks: z.array(resultFeedbackSchema),
  outputs: z.array(z.object({ nodeId: z.string(), nodeLabel: z.string(), surface: z.string(), recipientName: z.string(), status: z.enum(["SENT", "RECORDED_NOT_DELIVERED", "NOT_EMITTED"]), emittedAt: z.string().nullable() })),
  usage: usageTotalsSchema,
  aiCalls: z.array(aiCallSchema),
  durationMs: z.number().nullable(),
  error: z.string().nullable(),
  /** V1.7.1c — detalhe técnico da falha atual (categoria, código, tentativa, campos, decisão de retry). */
  failure: executionFailureSchema.nullable().optional(),
})
export type PersonResult = z.infer<typeof personResultSchema>

export const dispatchDetailSchema = z.object({
  dispatch: dispatchRowSchema,
  persons: z.object({ items: z.array(personResultSchema), total: z.number(), page: z.number(), pageSize: z.number() }),
  rootUsage: z.object({ usage: usageTotalsSchema, aiCalls: z.array(aiCallSchema) }).nullable(),
})
export type DispatchDetail = z.infer<typeof dispatchDetailSchema>
