import type { InvestigationCapability } from "@/schemas/admin/investigation.schema"
import type { AgentSpecialty, SpecialtyKind } from "@/schemas/admin/orchestrator-policy"
import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult } from "@/lib/admin/list-query"
import {
  agentDeletionCheckSchema,
  agentHistoryEntrySchema,
  agentPublishImpactSchema,
  agentReferenceSummarySchema,
  agentRunDetailSchema,
  agentRunSchema,
  agentSchema,
  agentTestResultSchema,
  agentVersionDetailSchema,
  agentVersionSchema,
  type Agent,
  type AgentDeletionCheck,
  type AgentHistoryEntry,
  type AgentPublishImpact,
  type AgentReferenceSummary,
  type AgentRun,
  type AgentRunDetail,
  type AgentTestResult,
  type AgentType,
  type AgentVersion,
  type AgentVersionDetail,
} from "@/schemas/admin/agent.schema"
import type { OrgScopeValue } from "@/components/admin/shared/org-scope-select"

export async function fetchAgents(): Promise<Agent[]> {
  return z.array(agentSchema).parse(await adminGet("/api/v1/admin/agents"))
}

export type AgentListParams = ListParams &
  OrgScopeFilter & {
    agentType: AgentType[]
    active?: boolean
    knowledgeDocumentId?: string
    createdAt: DateRangeFilter
  }

export async function fetchAgentsPage(params: AgentListParams): Promise<PageResult<Agent>> {
  const { createdAt, ...rest } = params
  return pageResultSchema(agentSchema).parse(await adminGet(`/api/v1/admin/agents${toQueryString({ ...rest, createdFrom: createdAt.from, createdTo: createdAt.to })}`))
}

export async function fetchAgent(id: string): Promise<Agent> {
  return agentSchema.parse(await adminGet(`/api/v1/admin/agents/${id}`))
}

export async function fetchAgentHistory(id: string): Promise<AgentHistoryEntry[]> {
  return z.array(agentHistoryEntrySchema).parse(await adminGet(`/api/v1/admin/agents/${id}/history`))
}

export async function fetchAgentRuns(id: string): Promise<AgentRun[]> {
  return z.array(agentRunSchema).parse(await adminGet(`/api/v1/admin/agents/${id}/runs`))
}

export async function fetchAgentRun(id: string, runId: string): Promise<AgentRunDetail> {
  return agentRunDetailSchema.parse(await adminGet(`/api/v1/admin/agents/${id}/runs/${runId}`))
}

/** PEN-049: o teste usa o rascunho SALVO ou uma versão publicada (nunca alterações não salvas). */
export type AgentTestTarget = { target: "DRAFT" } | { target: "VERSION"; versionId: string }

export async function testAgent(id: string, input: string, target?: AgentTestTarget): Promise<AgentTestResult> {
  return agentTestResultSchema.parse(await adminSend(`/api/v1/admin/agents/${id}/test`, "POST", { input, ...(target ?? {}) }))
}

export async function fetchAgentVersions(id: string): Promise<AgentVersion[]> {
  return z.array(agentVersionSchema).parse(await adminGet(`/api/v1/admin/agents/${id}/versions`))
}

export async function fetchAgentVersion(id: string, versionId: string): Promise<AgentVersionDetail> {
  return agentVersionDetailSchema.parse(await adminGet(`/api/v1/admin/agents/${id}/versions/${versionId}`))
}

const versionResultSchema = z.object({ version: z.object({ id: z.string(), number: z.number() }), agent: agentSchema })

/** Prévia da publicação: consumidores afetados que a pessoa pode consultar e mudanças sensíveis em relação à vigente. */
/** Prévia da publicação; com `versionId`, da reversão para essa versão (reverter também publica). */
export async function fetchAgentPublishImpact(id: string, versionId?: string): Promise<AgentPublishImpact> {
  const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : ""
  return agentPublishImpactSchema.parse(await adminGet(`/api/v1/admin/agents/${id}/publish-impact${query}`))
}

export async function publishAgent(id: string, expectedDraftRevision?: number) {
  return versionResultSchema.parse(await adminSend(`/api/v1/admin/agents/${id}/publish`, "POST", { expectedDraftRevision }))
}

export async function discardAgentDraft(id: string, expectedDraftRevision?: number): Promise<Agent> {
  return agentSchema.parse(await adminSend(`/api/v1/admin/agents/${id}/draft/discard`, "POST", { expectedDraftRevision }))
}

export async function revertAgent(id: string, versionId: string, input: { discardDraft: boolean; expectedDraftRevision?: number }) {
  return versionResultSchema.parse(await adminSend(`/api/v1/admin/agents/${id}/versions/${versionId}/revert`, "POST", input))
}

export async function fetchAgentDeletionCheck(id: string): Promise<AgentDeletionCheck> {
  return agentDeletionCheckSchema.parse(await adminGet(`/api/v1/admin/agents/${id}/deletion-check`))
}

/** Referências mínimas (inclusive inativos, sem o cadastro) — editor de Workflow e de orquestrador. */
export async function fetchAgentReferences(ids: string[]): Promise<AgentReferenceSummary[]> {
  if (ids.length === 0) return []
  return z.array(agentReferenceSummarySchema).parse(await adminGet(`/api/v1/admin/agents/references${toQueryString({ ids: [...new Set(ids)].sort().join(",") })}`))
}

export type CreateAgentInput = {
  name: string
  agentType: string
  objective: string
  description: string
  contextPrompt: string
  orgScope: OrgScopeValue
  knowledgeDocumentIds: string[]
  /** Limites de atuação: ligado exige texto (o backend recusa sem). */
  actionLimitsEnabled: boolean
  actionLimits: string | null
  /** Legado (053) — mantido para chamadas antigas; a forma nova abaixo prevalece no backend. */
  specialty?: AgentSpecialty | null
  /** Forma alvo (057/060): tipo + domínio de negócio por id do catálogo (só DOMAIN) + competência (só CROSS_CUTTING) + aceita consolidado. */
  specialtyKind?: SpecialtyKind | null
  businessDomainId?: string | null
  capability?: string | null
  consolidatedInput?: boolean
  recommendSupportMaterials?: boolean
  investigationCapabilities?: InvestigationCapability[]
}

function specialtyPayload(input: CreateAgentInput) {
  if (input.specialtyKind === undefined) return { specialty: input.specialty ?? null }
  return {
    specialtyKind: input.specialtyKind,
    businessDomainId: input.specialtyKind === "DOMAIN" ? (input.businessDomainId ?? null) : null,
    capability: input.specialtyKind === "CROSS_CUTTING" ? (input.capability ?? null) : null,
    consolidatedInput: input.specialtyKind === "SYNTHESIS" ? true : (input.consolidatedInput ?? false),
  }
}

/** Corpo do agente — o mesmo na criação (POST) e na edição (PATCH). */
function agentPayload(input: CreateAgentInput) {
  return {
    name: input.name,
    agentType: input.agentType,
    objective: input.objective,
    description: input.description,
    contextPrompt: input.contextPrompt,
    scopeType: input.orgScope.scopeType,
    teamId: input.orgScope.teamId,
    subteamId: input.orgScope.subteamId,
    knowledgeDocumentIds: input.knowledgeDocumentIds,
    actionLimitsEnabled: input.actionLimitsEnabled,
    actionLimits: input.actionLimits,
    recommendSupportMaterials: input.recommendSupportMaterials ?? false,
    investigationCapabilities: input.investigationCapabilities ?? [],
    ...specialtyPayload(input),
  }
}

export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  return agentSchema.parse(await adminSend("/api/v1/admin/agents", "POST", agentPayload(input)))
}

export async function updateAgentActive(id: string, active: boolean): Promise<Agent> {
  return agentSchema.parse(await adminSend(`/api/v1/admin/agents/${id}`, "PATCH", { active }))
}

/** Salva o RASCUNHO (PEN-002). `expectedDraftRevision`: a revisão em que a edição se baseou (PEN-050 — 409 se outra pessoa gravou). */
export async function updateAgent(id: string, input: CreateAgentInput, expectedDraftRevision?: number): Promise<Agent> {
  return agentSchema.parse(await adminSend(`/api/v1/admin/agents/${id}`, "PATCH", { ...agentPayload(input), expectedDraftRevision }))
}

export async function deleteAgent(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/agents/${id}`, "DELETE")
}

export async function fetchAgentPromptPreview(id: string, versionId?: string): Promise<string> {
  const result = await adminGet<{ prompt: string }>(`/api/v1/admin/agents/${id}/preview-prompt${toQueryString({ versionId })}`)
  return result.prompt
}
