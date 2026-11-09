import { z } from "zod"

/**
 * Configuração completa de um agente — o MESMO formato em `agent_versions.config` (versão publicada, imutável) e em
 * `agents.draft_config` (rascunho). As colunas de `agents` espelham a versão vigente (migration 164; PEN-002).
 */
export const agentConfigSchema = z.object({
  name: z.string(),
  agentType: z.string(),
  objective: z.string(),
  description: z.string(),
  contextPrompt: z.string(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]),
  teamId: z.string().uuid().nullable(),
  subteamId: z.string().uuid().nullable(),
  specialty: z.string().nullable(),
  specialtyKind: z.string().nullable(),
  domain: z.string().nullable(),
  capability: z.string().nullable(),
  consolidatedInput: z.boolean(),
  businessDomainId: z.string().uuid().nullable(),
  recommendSupportMaterials: z.boolean(),
  investigationCapabilities: z.array(z.string()),
  actionLimitsEnabled: z.boolean(),
  actionLimits: z.string().nullable(),
  knowledgeDocumentIds: z.array(z.string().uuid()),
})
export type AgentConfig = z.infer<typeof agentConfigSchema>

export function parseAgentConfig(value: unknown): AgentConfig {
  return agentConfigSchema.parse(value)
}

/** Colunas vivas de `agents` (versão vigente) — nomes do banco. */
export type AgentLiveRow = {
  name: string
  agent_type: string
  objective: string
  description: string
  context_prompt: string
  scope_type: "ALL_TEAMS" | "TEAM" | "SUBTEAM"
  team_id: string | null
  subteam_id: string | null
  specialty: string | null
  specialty_kind: string | null
  domain: string | null
  capability: string | null
  consolidated_input: boolean
  business_domain_id: string | null
  recommend_support_materials: boolean
  investigation_capabilities: string[] | null
  action_limits_enabled: boolean
  action_limits: string | null
}

export const AGENT_LIVE_COLUMNS = `name, agent_type, objective, description, context_prompt, scope_type, team_id, subteam_id, specialty, specialty_kind, domain, capability,
  consolidated_input, business_domain_id, recommend_support_materials, investigation_capabilities, action_limits_enabled, action_limits`

export function configFromLiveRow(row: AgentLiveRow, knowledgeDocumentIds: string[]): AgentConfig {
  return {
    name: row.name,
    agentType: row.agent_type,
    objective: row.objective,
    description: row.description,
    contextPrompt: row.context_prompt,
    scopeType: row.scope_type,
    teamId: row.team_id,
    subteamId: row.subteam_id,
    specialty: row.specialty,
    specialtyKind: row.specialty_kind,
    domain: row.domain,
    capability: row.capability,
    consolidatedInput: row.consolidated_input,
    businessDomainId: row.business_domain_id,
    recommendSupportMaterials: row.recommend_support_materials,
    investigationCapabilities: [...(row.investigation_capabilities ?? [])],
    actionLimitsEnabled: row.action_limits_enabled,
    actionLimits: row.action_limits,
    knowledgeDocumentIds: [...new Set(knowledgeDocumentIds)].sort(),
  }
}

/** Duas configurações são iguais? (decide se há rascunho com alterações não publicadas.) */
export function sameAgentConfig(a: AgentConfig, b: AgentConfig): boolean {
  const normalize = (config: AgentConfig) => JSON.stringify({ ...config, investigationCapabilities: [...config.investigationCapabilities].sort(), knowledgeDocumentIds: [...config.knowledgeDocumentIds].sort() })
  return normalize(a) === normalize(b)
}

/** O que o motor precisa de uma versão para executar o agente (prompt, bases, limites, ferramentas). */
export type AgentRuntimeSnapshot = {
  agentId: string
  organizationId: string
  /** Versão publicada usada; null = rascunho (só em teste manual). */
  versionId: string | null
  versionNumber: number | null
  config: AgentConfig
}
