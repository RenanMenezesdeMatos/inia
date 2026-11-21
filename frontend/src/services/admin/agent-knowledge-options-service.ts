import { adminGet, adminSend } from "@/lib/admin/admin-api"
import {
  knowledgeOptionFacetsSchema,
  knowledgeOptionIdsSchema,
  knowledgeOptionSchema,
  knowledgeOptionsPageSchema,
  type AgentKnowledgeScope,
  type KnowledgeOption,
  type KnowledgeOptionFacets,
  type KnowledgeOptionIds,
  type KnowledgeOptionsFilter,
  type KnowledgeOptionsPage,
} from "@/schemas/admin/agent-knowledge-options.schema"

// Leituras por POST: levam listas de ids (as escolhidas). Nada é gravado; o vínculo é validado no salvar do agente.
const BASE_PATH = "/api/v1/admin/agents/knowledge-options"

export async function searchKnowledgeOptions(filter: KnowledgeOptionsFilter & { cursor?: string; limit: number }): Promise<KnowledgeOptionsPage> {
  return knowledgeOptionsPageSchema.parse(await adminSend(`${BASE_PATH}/search`, "POST", filter))
}

export async function fetchKnowledgeOptionIds(filter: KnowledgeOptionsFilter): Promise<KnowledgeOptionIds> {
  return knowledgeOptionIdsSchema.parse(await adminSend(`${BASE_PATH}/ids`, "POST", filter))
}

export async function fetchGroupDefaultKnowledgeIds(agentScope: AgentKnowledgeScope, agentUniverse: string | undefined): Promise<KnowledgeOptionIds> {
  return knowledgeOptionIdsSchema.parse(await adminSend(`${BASE_PATH}/group-defaults`, "POST", { agentScope, ...(agentUniverse ? { agentUniverse } : {}) }))
}

export async function lookupKnowledgeOptions(ids: string[]): Promise<KnowledgeOption[]> {
  return knowledgeOptionSchema.array().parse(await adminSend(`${BASE_PATH}/lookup`, "POST", { ids }))
}

export async function fetchKnowledgeOptionFacets(agentUniverse: string | undefined): Promise<KnowledgeOptionFacets> {
  return knowledgeOptionFacetsSchema.parse(await adminGet(`${BASE_PATH}/facets${agentUniverse ? `?agentUniverse=${encodeURIComponent(agentUniverse)}` : ""}`))
}
