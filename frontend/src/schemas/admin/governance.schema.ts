import { z } from "zod"

export const prohibitedTopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  requiredBehavior: z.string(),
  active: z.boolean(),
})
export type ProhibitedTopic = z.infer<typeof prohibitedTopicSchema>

export const RESPONSE_CHECK_SURFACE_LABELS: Record<string, string> = {
  CHAT: "Chat",
  VOICE_TOOL: "Voz, antes de falar",
  VOICE_SPOKEN: "Voz, depois de falada",
  AGENT_RUN: "Execução de agente",
  SPECIALIST: "Especialista",
  WORKFLOW_ORCHESTRATOR: "Orquestrador em Workflow",
  FEEDBACK_MESSAGE: "Mensagem de feedback",
  REPORT_ANALYSIS: "Análise de report",
  INTERVENTION_NARRATIVE: "Narrativa de intervenção",
  INTERVENTION_DRAFT: "Rascunho de intervenção",
  BEST_PRACTICE: "Boa prática",
  INTERACTION_FEEDBACK: "Feedback de atendimento (caminho antigo)",
}

export const responseCheckEventSchema = z.object({
  id: z.string(),
  surface: z.string(),
  control: z.string(),
  outcome: z.string(),
  action: z.string(),
  rules: z.array(z.object({ kind: z.string(), name: z.string() })),
  reason: z.string().nullable(),
  errorCode: z.string().nullable(),
  /** Onde está o conteúdo, nos fluxos em que o registro não copia o texto. */
  sourceRef: z.string().nullable(),
  flaggedContent: z.string().nullable(),
  conversationId: z.string().nullable(),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  createdAt: z.coerce.string(),
})
export type ResponseCheckEvent = z.infer<typeof responseCheckEventSchema>

const responseCheckModeSchema = z.enum(["ENFORCE", "AUDIT", "OFF"])
export const responseCheckSummarySchema = z.object({ days: z.number(), mode: responseCheckModeSchema, modes: z.object({ conversation: responseCheckModeSchema, content: responseCheckModeSchema, feedback: responseCheckModeSchema }), checked: z.number(), delivered: z.number(), blocked: z.number(), detected: z.number(), failed: z.number() })
export type ResponseCheckSummary = z.infer<typeof responseCheckSummarySchema>

export const glossaryTermSchema = z.object({
  id: z.string(),
  term: z.string(),
  definition: z.string(),
  feedbackApplication: z.string(),
  active: z.boolean(),
})
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>

/** Regra geral de chamada curta (`QUALITY_CALL_MIN_DURATION_V1`, migration 246). */
export const qualityCallRuleSchema = z.object({
  minimumQualityCallSeconds: z.number().int(),
  ruleVersion: z.string(),
  description: z.string(),
  limits: z.object({ min: z.number().int(), max: z.number().int() }),
  /** Quem pode trocar a regra (organização inteira) — o servidor decide; ausente (servidor anterior) = o PUT é quem confere. */
  canEdit: z.boolean().default(true),
})
export type QualityCallRule = z.infer<typeof qualityCallRuleSchema>
