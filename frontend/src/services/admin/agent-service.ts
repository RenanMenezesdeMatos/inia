import type { InvestigationCapability } from "@/schemas/admin/investigation.schema"
import type { AgentSpecialty, SpecialtyKind } from "@/schemas/admin/orchestrator-policy"
import { z } from "zod"

import { adminGet, adminSend } from "@/lib/admin/admin-api"
import { pageResultSchema, toQueryString, type DateRangeFilter, type ListParams, type OrgScopeFilter, type PageResult } from "@/lib/admin/list-query"
import {
  agentHistoryEntrySchema,
  agentRunSchema,
  agentSchema,
  agentTestResultSchema,
  type Agent,
  type AgentHistoryEntry,
  type AgentRun,
  type AgentTestResult,
  type AgentType,
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

export async function testAgent(id: string, input: string): Promise<AgentTestResult> {
  return agentTestResultSchema.parse(await adminSend(`/api/v1/admin/agents/${id}/test`, "POST", { input }))
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

export async function updateAgent(id: string, input: CreateAgentInput): Promise<Agent> {
  return agentSchema.parse(await adminSend(`/api/v1/admin/agents/${id}`, "PATCH", agentPayload(input)))
}

export async function deleteAgent(id: string): Promise<void> {
  await adminSend(`/api/v1/admin/agents/${id}`, "DELETE")
}

export async function fetchAgentPromptPreview(id: string): Promise<string> {
  const result = await adminGet<{ prompt: string }>(`/api/v1/admin/agents/${id}/preview-prompt`)
  return result.prompt
}
