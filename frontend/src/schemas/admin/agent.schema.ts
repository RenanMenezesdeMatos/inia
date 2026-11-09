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
  // Ciclo de vida (PEN-002, decidida em 03/11/2026): as colunas acima são a versão VIGENTE; o rascunho vem em `draft`.
  currentVersionId: z.string().nullable().catch(null),
  currentVersionNumber: z.number().nullable().catch(null),
  currentVersionPublishedAt: z.coerce.string().nullable().catch(null),
  /** Já teve alguma versão publicada (nunca publicado = só testes; nunca roda em produção — PEN-047). */
  published: z.boolean().catch(true),
  hasDraft: z.boolean().catch(false),
  draftRevision: z.number().catch(0),
  draftUpdatedAt: z.coerce.string().nullable().catch(null),
  draftUpdatedByName: z.string().nullable().catch(null),
  /** `restricted`: o rascunho é de um alcance que quem lê não alcança — vem sem a configuração (`config: null`), e o servidor recusa salvá-lo, publicá-lo, testá-lo ou descartá-lo. */
  draft: z
    .object({ config: z.lazy(() => agentConfigSchema).nullable(), revision: z.number(), updatedAt: z.coerce.string().nullable(), updatedByName: z.string().nullable(), restricted: z.boolean().catch(false) })
    .nullable()
    .optional()
    .catch(null),
})
export type Agent = z.infer<typeof agentSchema>

/** Configuração completa de uma versão ou do rascunho — espelho de `backend/src/modules/agents/domain/agent-config.ts`. */
export const agentConfigSchema = z.object({
  name: z.string(),
  agentType: agentTypeSchema,
  objective: z.string(),
  description: z.string(),
  contextPrompt: z.string(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().nullable(),
  subteamId: z.string().nullable(),
  specialty: z.string().nullable(),
  specialtyKind: specialtyKindSchema.nullable().catch(null),
  domain: z.string().nullable(),
  capability: z.string().nullable(),
  consolidatedInput: z.boolean(),
  businessDomainId: z.string().nullable(),
  recommendSupportMaterials: z.boolean(),
  investigationCapabilities: z.array(investigationCapabilitySchema).catch([]),
  actionLimitsEnabled: z.boolean(),
  actionLimits: z.string().nullable(),
  knowledgeDocumentIds: z.array(z.string()),
})
export type AgentConfig = z.infer<typeof agentConfigSchema>

/**
 * O que o formulário edita: o rascunho (quando há) sobre a versão vigente. Bases do rascunho sem título conhecido aparecem pelo
 * título da lista de bases do formulário (aqui só os ids importam). Rascunho de outro alcance (sem configuração): a versão vigente.
 */
export function editableAgentOf(agent: Agent): Agent {
  const config = agent.draft?.config
  if (!config) return agent
  const titles = new Map(agent.knowledgeDocuments.map((document) => [document.id, document.title]))
  return {
    ...agent,
    name: config.name,
    agentType: config.agentType,
    objective: config.objective,
    description: config.description,
    contextPrompt: config.contextPrompt,
    scopeType: config.scopeType,
    teamId: config.teamId,
    subteamId: config.subteamId,
    specialty: agentSpecialtySchema.nullable().catch(null).parse(config.specialty),
    specialtyKind: config.specialtyKind,
    domain: config.domain,
    businessDomainId: config.businessDomainId,
    businessDomain: config.businessDomainId === agent.businessDomainId ? agent.businessDomain : config.businessDomainId ? { id: config.businessDomainId, code: config.domain ?? "", name: config.domain ?? "", active: true } : null,
    capability: config.capability,
    consolidatedInput: config.consolidatedInput,
    recommendSupportMaterials: config.recommendSupportMaterials,
    investigationCapabilities: config.investigationCapabilities,
    actionLimitsEnabled: config.actionLimitsEnabled,
    actionLimits: config.actionLimits,
    knowledgeDocuments: config.knowledgeDocumentIds.map((id) => ({ id, title: titles.get(id) ?? "" })),
  }
}

/** Selo de publicação nos seletores e na lista (PEN-047: não publicado não entra em uso de produção). */
export function agentPublicationLabel(agent: Pick<Agent, "published" | "currentVersionNumber">): string {
  return agent.published && agent.currentVersionNumber ? `Versão ${agent.currentVersionNumber}` : "Não publicado"
}

const agentHistoryChangeSchema = z.object({
  field: z.string(),
  label: z.string(),
  from: z.string(),
  to: z.string(),
})

export const agentHistoryEntrySchema = z.object({
  id: z.string(),
  action: z.enum(["CREATED", "UPDATED", "DUPLICATED", "PUBLISHED", "REVERTED", "DRAFT_DISCARDED"]),
  changedByName: z.string(),
  changes: z.array(agentHistoryChangeSchema),
  createdAt: z.coerce.string(),
  /** Alteração feita numa configuração de outro alcance: os campos vêm sem os valores (`from`/`to` vazios). */
  restricted: z.boolean().catch(false),
})
export type AgentHistoryEntry = z.infer<typeof agentHistoryEntrySchema>

export const AGENT_HISTORY_ACTION_LABELS: Record<AgentHistoryEntry["action"], string> = {
  CREATED: "Criou o agente",
  UPDATED: "Atualizou o agente",
  DUPLICATED: "Duplicou o agente",
  PUBLISHED: "Publicou uma versão",
  REVERTED: "Reverteu para uma versão anterior",
  DRAFT_DISCARDED: "Descartou o rascunho",
}

export const agentRunSchema = z.object({
  id: z.string(),
  source: z.enum(["MANUAL_TEST", "TRIGGER", "WORKFLOW", "QA_SIMULATION"]).catch("TRIGGER"),
  inputContext: z.string().nullable(),
  outputText: z.string().nullable(),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  errorMessage: z.string().nullable(),
  model: z.string().nullable(),
  caseId: z.string().nullable(),
  createdAt: z.coerce.string(),
  completedAt: z.coerce.string().nullable(),
  /** Versão usada (PEN-002) — null + `runTarget = DRAFT` = teste do rascunho; null sem alvo = execução anterior ao versionamento. */
  agentVersionId: z.string().nullable().catch(null),
  agentVersionNumber: z.number().nullable().catch(null),
  runTarget: z.enum(["VERSION", "DRAFT"]).nullable().catch(null),
  hasTestedConfig: z.boolean().catch(false),
  /** Execução de uma configuração de outro alcance: sem entrada, resposta, erro, caso e conteúdo testado. */
  restricted: z.boolean().catch(false),
})
export type AgentRun = z.infer<typeof agentRunSchema>

export const AGENT_RUN_SOURCE_LABELS: Record<AgentRun["source"], string> = {
  MANUAL_TEST: "Teste manual",
  TRIGGER: "Gatilho",
  WORKFLOW: "Workflow de automação",
  QA_SIMULATION: "QA Lab",
}

/** "Versão 3", "Teste do rascunho" ou "Antes do versionamento". */
export function describeRunVersion(run: Pick<AgentRun, "runTarget" | "agentVersionNumber">): string {
  if (run.runTarget === "DRAFT") return "Teste do rascunho"
  return run.agentVersionNumber ? `Versão ${run.agentVersionNumber}` : "Antes do versionamento"
}

export const agentRunDetailSchema = z.object({
  id: z.string(),
  runTarget: z.enum(["VERSION", "DRAFT"]).nullable().catch(null),
  agentVersionNumber: z.number().nullable().catch(null),
  testedConfig: agentConfigSchema.nullable().catch(null),
  createdAt: z.coerce.string(),
  restricted: z.boolean().catch(false),
})
export type AgentRunDetail = z.infer<typeof agentRunDetailSchema>

export const agentVersionSchema = z.object({
  id: z.string(),
  number: z.number(),
  origin: z.enum(["MIGRATION", "PUBLISH", "REVERT"]),
  revertedFromNumber: z.number().nullable().catch(null),
  publishedAt: z.coerce.string(),
  publishedByName: z.string(),
  current: z.boolean(),
  /** Versão de um alcance que quem lê não alcança: abre sem a configuração, e o servidor recusa testá-la, revertê-la ou prever a reversão. */
  restricted: z.boolean().catch(false),
})
export type AgentVersion = z.infer<typeof agentVersionSchema>

export const AGENT_VERSION_ORIGIN_LABELS: Record<AgentVersion["origin"], string> = {
  MIGRATION: "Configuração em uso antes do versionamento",
  PUBLISH: "Publicada",
  REVERT: "Reversão",
}

export const agentVersionDetailSchema = agentVersionSchema.extend({ config: agentConfigSchema.nullable() })
export type AgentVersionDetail = z.infer<typeof agentVersionDetailSchema>

/** Explicação da exclusão (PEN-065/066): uso, referências que a pessoa pode consultar e o aviso das que não pode. */
export const agentReferenceSchema = z.object({
  kind: z.enum(["WORKFLOW", "ORCHESTRATOR"]),
  id: z.string(),
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE", "DRAFT"]),
  usages: z.array(z.string()),
  link: z.string(),
})
export type AgentReference = z.infer<typeof agentReferenceSchema>

export const agentDeletionCheckSchema = z.object({
  deletable: z.boolean(),
  hasUsage: z.boolean(),
  usage: z.object({ runs: z.number(), runningRuns: z.number().catch(0), conversations: z.number(), feedbackAnalyses: z.number() }),
  references: z.array(agentReferenceSchema),
  hasRestrictedReferences: z.boolean(),
  active: z.boolean(),
  canDeactivate: z.boolean(),
})
export type AgentDeletionCheck = z.infer<typeof agentDeletionCheckSchema>

export const AGENT_REFERENCE_KIND_LABELS: Record<AgentReference["kind"], string> = { WORKFLOW: "Workflow de automação", ORCHESTRATOR: "Orquestrador" }
export const AGENT_REFERENCE_STATUS_LABELS: Record<AgentReference["status"], string> = { ACTIVE: "Ativo", INACTIVE: "Inativo", DRAFT: "Rascunho" }

/**
 * Prévia da publicação (revisão aprovada da PEN-002/PEN-076, 03/11/2026) — espelho de `GET /admin/agents/:id/publish-impact`
 * (backend agents/application/agent-publish-impact.ts). Publicar torna a versão nova a VIGENTE para as próximas execuções de todos
 * os consumidores; antes, a pessoa vê os consumidores que pode consultar e as mudanças sensíveis. `losesAccess` = o alcance novo
 * não cobre aquele consumidor: as execuções dele passam a ser bloqueadas (publicar nunca amplia acesso).
 */
const publishImpactKnowledgeSchema = z.object({ id: z.string(), title: z.string() })
const publishImpactTransitionSchema = z.object({ from: z.string(), to: z.string() })

export const agentPublishImpactSchema = z.object({
  nextVersionNumber: z.number(),
  currentVersionNumber: z.number().nullable(),
  consumers: z.array(agentReferenceSchema.extend({ losesAccess: z.boolean().catch(false) })),
  hasRestrictedConsumers: z.boolean(),
  changes: z.object({
    knowledge: z.object({ added: z.array(publishImpactKnowledgeSchema), removed: z.array(publishImpactKnowledgeSchema) }),
    tools: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
    scope: publishImpactTransitionSchema.nullable(),
    limits: publishImpactTransitionSchema.nullable(),
    otherFields: z.array(z.string()),
  }),
})
export type AgentPublishImpact = z.infer<typeof agentPublishImpactSchema>
export type AgentPublishConsumer = AgentPublishImpact["consumers"][number]

/** Referência mínima de um agente citado por Workflow/orquestrador — inclusive inativo, sem o cadastro (PEN-068). */
export const agentReferenceSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  agentType: agentTypeSchema.catch("CUSTOM"),
  active: z.boolean(),
  published: z.boolean(),
  currentVersionId: z.string().nullable(),
  currentVersionNumber: z.number().nullable(),
  versions: z.array(z.object({ id: z.string(), number: z.number(), publishedAt: z.coerce.string() })),
})
export type AgentReferenceSummary = z.infer<typeof agentReferenceSummarySchema>

export const agentTestResultSchema = z.object({
  id: z.string(),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  outputText: z.string().nullable(),
  errorMessage: z.string().nullable(),
})
export type AgentTestResult = z.infer<typeof agentTestResultSchema>
