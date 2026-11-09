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
  flaggedContent: z.string().nullable(),
  conversationId: z.string().nullable(),
  agentId: z.string().nullable(),
  agentName: z.string().nullable(),
  createdAt: z.coerce.string(),
})
export type ResponseCheckEvent = z.infer<typeof responseCheckEventSchema>

export const responseCheckSummarySchema = z.object({ days: z.number(), mode: z.enum(["ENFORCE", "AUDIT", "OFF"]), checked: z.number(), delivered: z.number(), blocked: z.number(), detected: z.number(), failed: z.number() })
export type ResponseCheckSummary = z.infer<typeof responseCheckSummarySchema>

export const glossaryTermSchema = z.object({
  id: z.string(),
  term: z.string(),
  definition: z.string(),
  feedbackApplication: z.string(),
  active: z.boolean(),
})
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>
