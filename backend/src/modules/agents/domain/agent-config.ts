import { z } from "zod"
import { resourceScopeJson, resourceScopeOf, type ResourceScope } from "../../../shared/domain/scope-links/resource-scope.js"
import type { ScopeLink } from "../../../shared/domain/scope-links/scope-links.js"

/**
 * Configuração completa de um agente — o MESMO formato em `agent_versions.config` (versão publicada, imutável) e em
 * `agents.draft_config` (rascunho). As colunas de `agents` espelham a versão vigente (migration 164; PEN-002).
 */
const storedScopeLinkSchema = z.object({ teamId: z.string().uuid(), subteamId: z.string().uuid().nullable().default(null) })

/**
 * Alcance guardado na configuração (migration 249): `ALL_TEAMS` ou `GROUPS` + `scopeLinks` (Grupo inteiro ou um Subgrupo daquele Grupo).
 * Rascunhos e versões anteriores à 249 guardam o formato antigo (`TEAM`/`SUBTEAM` + `teamId`/`subteamId`, sempre com o Grupo-pai real):
 * a leitura o converte com o MESMO alcance (`resourceScopeOf`) — o resto do módulo só vê o formato novo.
 */
const agentConfigObjectSchema = z.object({
  name: z.string(),
  agentType: z.string(),
  objective: z.string(),
  description: z.string(),
  contextPrompt: z.string(),
  scopeType: z.enum(["ALL_TEAMS", "GROUPS", "TEAM", "SUBTEAM"]),
  teamId: z.string().uuid().nullable(),
  subteamId: z.string().uuid().nullable(),
  scopeLinks: z.array(storedScopeLinkSchema).optional(),
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

export const agentConfigSchema = agentConfigObjectSchema.transform((config) => ({ ...config, ...agentScopeFields(agentScopeOf(config)) }))

/** Campos de alcance no formato novo, prontos para a configuração. */
export function agentScopeFields(scope: ResourceScope): { scopeType: "ALL_TEAMS" | "GROUPS"; teamId: null; subteamId: null; scopeLinks: ScopeLink[] } {
  const json = resourceScopeJson(scope)
  return { scopeType: scope.scopeType, teamId: null, subteamId: null, scopeLinks: json.scopeLinks }
}

export type AgentConfig = Omit<z.output<typeof agentConfigObjectSchema>, "scopeType" | "teamId" | "subteamId" | "scopeLinks"> & ReturnType<typeof agentScopeFields>

/** Alcance de uma configuração (de qualquer formato: novo, legado, ou só o alcance guardado em JSON). */
type StoredLink = { teamId?: string | null | undefined; subteamId?: string | null | undefined }
export type AgentScopeInput = { scopeType?: string | null | undefined; teamId?: string | null | undefined; subteamId?: string | null | undefined; scopeLinks?: readonly StoredLink[] | null | undefined; links?: readonly StoredLink[] | null | undefined }

export function agentScopeOf(config: AgentScopeInput | null | undefined): ResourceScope {
  // Sem alcance conhecido nunca vira "todos": falha fechado (nenhum vínculo).
  if (!config) return { scopeType: "GROUPS", links: [] }
  const links = (config.scopeLinks ?? config.links ?? []).map((link) => ({ teamId: link.teamId ?? null, subteamId: link.subteamId ?? null }))
  return resourceScopeOf({ scopeType: config.scopeType ?? null, teamId: config.teamId ?? null, subteamId: config.subteamId ?? null, scopeLinks: links })
}

export function parseAgentConfig(value: unknown): AgentConfig {
  return agentConfigSchema.parse(value) as AgentConfig
}

/** Colunas vivas de `agents` (versão vigente) — nomes do banco. */
export type AgentLiveRow = {
  name: string
  agent_type: string
  objective: string
  description: string
  context_prompt: string
  /** Depois da 249: ALL_TEAMS ou GROUPS (os vínculos ficam em `agent_scope_links`; `team_id`/`subteam_id` sempre nulos). */
  scope_type: string
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

export const AGENT_LIVE_COLUMNS = `name, agent_type, objective, description, context_prompt, scope_type, specialty, specialty_kind, domain, capability,
  consolidated_input, business_domain_id, recommend_support_materials, investigation_capabilities, action_limits_enabled, action_limits`

/** `scopeLinks`: os vínculos gravados em `agent_scope_links` (ignorados quando a linha é ALL_TEAMS). */
export function configFromLiveRow(row: AgentLiveRow, knowledgeDocumentIds: string[], scopeLinks: readonly ScopeLink[]): AgentConfig {
  return {
    name: row.name,
    agentType: row.agent_type,
    objective: row.objective,
    description: row.description,
    contextPrompt: row.context_prompt,
    ...agentScopeFields(resourceScopeOf({ scopeType: row.scope_type === "ALL_TEAMS" ? "ALL_TEAMS" : "GROUPS", scopeLinks })),
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
  // Chaves em ordem fixa: o rascunho antigo (lido do formato legado) e a configuração nova não diferem só pela ordem dos campos.
  const normalize = (config: AgentConfig) => {
    const canonical: Record<string, unknown> = { ...config, investigationCapabilities: [...config.investigationCapabilities].sort(), knowledgeDocumentIds: [...config.knowledgeDocumentIds].sort(), scopeLinks: agentScopeOf(config).links }
    return JSON.stringify(Object.keys(canonical).sort().map((key) => [key, canonical[key]]))
  }
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
