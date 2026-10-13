import { z } from "zod"

import { businessDomainRefSchema } from "./business-domain.schema"
import { agentSpecialtySchema, specialtyKindSchema } from "./orchestrator-policy"
import { investigationCapabilitySchema } from "./investigation.schema"

export const agentTypeSchema = z.enum(["CALL_FEEDBACK", "INDICATOR_FEEDBACK", "DIAGNOSTICS", "ORCHESTRATOR", "HR", "CUSTOM"])
export type AgentType = z.infer<typeof agentTypeSchema>

export const AGENT_TYPE_LABELS: Record<AgentType, string> = {
  CALL_FEEDBACK: "Feedback de chamadas",
  INDICATOR_FEEDBACK: "Feedback de indicadores",
  DIAGNOSTICS: "Diagnóstico",
  ORCHESTRATOR: "Orquestrador",
  HR: "Temas de RH",
  CUSTOM: "Personalizado",
}

export const AGENT_TYPE_COLORS: Record<AgentType, { icon: string; iconBg: string }> = {
  CALL_FEEDBACK: { icon: "text-sky-600 dark:text-sky-300", iconBg: "bg-sky-100 dark:bg-sky-950" },
  INDICATOR_FEEDBACK: { icon: "text-emerald-600 dark:text-emerald-300", iconBg: "bg-emerald-100 dark:bg-emerald-950" },
  DIAGNOSTICS: { icon: "text-violet-600 dark:text-violet-300", iconBg: "bg-violet-100 dark:bg-violet-950" },
  ORCHESTRATOR: { icon: "text-rose-600 dark:text-rose-300", iconBg: "bg-rose-100 dark:bg-rose-950" },
  HR: { icon: "text-teal-600 dark:text-teal-300", iconBg: "bg-teal-100 dark:bg-teal-950" },
  CUSTOM: { icon: "text-amber-600 dark:text-amber-300", iconBg: "bg-amber-100 dark:bg-amber-950" },
}

/**
 * Tamanho dos campos de texto do Agent — espelho de `backend/src/modules/agents/domain/agent-field-limits.ts`
 * (o backend recusa fora disso; teste de sincronia lá). A tela mostra a contagem e quanto falta.
 */
export const AGENT_TEXT_LIMITS = {
  name: { label: "Nome", min: 2, max: 120 },
  objective: { label: "Objetivo", min: 5, max: 1_000 },
  description: { label: "Descrição", min: 5, max: 2_000 },
  contextPrompt: { label: "Contexto (prompt)", min: 10, max: 12_000 },
  capability: { label: "Competência", min: 0, max: 80 },
  actionLimits: { label: "Limites de atuação", min: 0, max: 1_000 },
} as const
export type AgentTextField = keyof typeof AGENT_TEXT_LIMITS

const agentKnowledgeDocumentSchema = z.object({ id: z.string(), title: z.string() })

export const agentSchema = z.object({
  id: z.string(),
  name: z.string(),
  agentType: agentTypeSchema,
  objective: z.string(),
  description: z.string(),
  contextPrompt: z.string(),
  active: z.boolean(),
  createdAt: z.coerce.string(),
  createdByName: z.string().nullable().catch(null),
  usageCount: z.number().catch(0),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().nullable(),
  teamName: z.string().nullable(),
  subteamId: z.string().nullable(),
  subteamName: z.string().nullable(),
  knowledgeDocuments: z.array(agentKnowledgeDocumentSchema),
  /** Limites de atuação: interruptor + "até onde este agente vai" (desligado, o texto fica guardado e não vale). */
  actionLimitsEnabled: z.boolean().default(false),
  actionLimits: z.string().nullable().default(null),
  /** Legado (053): domínio de processo, transversal, performance, síntese ou sem classificação — dual-write mantém igual à forma nova. */
  specialty: agentSpecialtySchema.nullable().catch(null),
  /** Forma alvo (057/060): tipo de especialidade + domínio de negócio (só DOMAIN — `businessDomain` do catálogo; `domain` = código legado dual-write) + competência (só CROSS_CUTTING) + aceita resultado consolidado. */
  specialtyKind: specialtyKindSchema.nullable().catch(null),
  domain: z.string().nullable().catch(null),
  businessDomainId: z.string().nullable().catch(null),
  businessDomain: businessDomainRefSchema.nullable().catch(null),
  capability: z.string().nullable().catch(null),
  consolidatedInput: z.boolean().catch(false),
  /** "Quando este Agente responder diretamente, pode recomendar materiais das bases que consultar?" — padrão false. */
  recommendSupportMaterials: z.boolean().catch(false),
  /** Capacidades de investigação habilitadas ("Ferramentas de investigação") — o Agent é dono; vazio = sem ferramentas. */
  investigationCapabilities: z.array(investigationCapabilitySchema).catch([]),
})
export type Agent = z.infer<typeof agentSchema>

const agentHistoryChangeSchema = z.object({
  field: z.string(),
  label: z.string(),
  from: z.string(),
  to: z.string(),
})

export const agentHistoryEntrySchema = z.object({
  id: z.string(),
  action: z.enum(["CREATED", "UPDATED", "DUPLICATED"]),
  changedByName: z.string(),
  changes: z.array(agentHistoryChangeSchema),
  createdAt: z.coerce.string(),
})
export type AgentHistoryEntry = z.infer<typeof agentHistoryEntrySchema>

export const AGENT_HISTORY_ACTION_LABELS: Record<AgentHistoryEntry["action"], string> = {
  CREATED: "Criou o agente",
  UPDATED: "Atualizou o agente",
  DUPLICATED: "Duplicou o agente",
}

export const agentRunSchema = z.object({
  id: z.string(),
  source: z.enum(["MANUAL_TEST", "TRIGGER"]),
  inputContext: z.string(),
  outputText: z.string().nullable(),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  errorMessage: z.string().nullable(),
  model: z.string().nullable(),
  caseId: z.string().nullable(),
  createdAt: z.coerce.string(),
  completedAt: z.coerce.string().nullable(),
})
export type AgentRun = z.infer<typeof agentRunSchema>

export const AGENT_RUN_SOURCE_LABELS: Record<AgentRun["source"], string> = {
  MANUAL_TEST: "Teste manual",
  TRIGGER: "Gatilho",
}

export const agentTestResultSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  outputText: z.string().nullable(),
  errorMessage: z.string().nullable(),
})
export type AgentTestResult = z.infer<typeof agentTestResultSchema>
