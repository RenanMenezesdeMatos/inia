import type { AgentConfig } from "../domain/agent-config.js"

/**
 * Bancos simulados dos testes de unidade: respostas às consultas de VERSÃO do agente (migration 164; PEN-002) a partir da
 * linha simulada de `agents` que cada teste já tem. Assim o teste continua dizendo só "o agente é este" e o runtime executa a
 * versão vigente dele (v1), como em produção. `null` = a consulta não é de versão; o fake segue com as respostas dele.
 */

/** Nos fakes, a versão vigente de um agente tem o MESMO id do agente — a consulta da versão acha o agente por ele. */
export const fakeAgentVersionIdOf = (agentId: string) => agentId

type FakeAgentRow = Record<string, unknown> & { id?: string }

/** Configuração completa a partir de uma linha simulada (colunas do banco ou nomes do domínio), com padrões neutros. */
export function fakeAgentConfig(row: FakeAgentRow = {}): AgentConfig {
  const pick = <T>(...keys: string[]): T | undefined => {
    for (const key of keys) if (row[key] !== undefined) return row[key] as T
    return undefined
  }
  return {
    name: pick<string>("name") ?? "Agente",
    agentType: pick<string>("agent_type", "agentType") ?? "CUSTOM",
    objective: pick<string>("objective") ?? "",
    description: pick<string>("description") ?? "",
    contextPrompt: pick<string>("context_prompt", "contextPrompt") ?? "",
    scopeType: pick<AgentConfig["scopeType"]>("scope_type", "scopeType") ?? "ALL_TEAMS",
    teamId: pick<string | null>("team_id", "teamId") ?? null,
    subteamId: pick<string | null>("subteam_id", "subteamId") ?? null,
    specialty: pick<string | null>("specialty") ?? null,
    specialtyKind: pick<string | null>("specialty_kind", "specialtyKind") ?? null,
    domain: pick<string | null>("domain") ?? null,
    capability: pick<string | null>("capability") ?? null,
    consolidatedInput: pick<boolean>("consolidated_input", "consolidatedInput") ?? false,
    businessDomainId: pick<string | null>("business_domain_id", "businessDomainId") ?? null,
    recommendSupportMaterials: pick<boolean>("recommend_support_materials", "recommendSupportMaterials") ?? false,
    investigationCapabilities: pick<string[] | null>("investigation_capabilities", "investigationCapabilities") ?? [],
    actionLimitsEnabled: pick<boolean>("action_limits_enabled", "actionLimitsEnabled") ?? false,
    actionLimits: pick<string | null>("action_limits", "actionLimits") ?? null,
    knowledgeDocumentIds: pick<string[]>("knowledgeDocumentIds") ?? [],
  }
}

const result = (rows: unknown[]) => ({ rows, rowCount: rows.length })

/**
 * Responde às consultas de versão do runtime. `agentOf(agentId)` devolve a linha simulada do agente (ou undefined = não existe).
 * Cobre: `resolveAgentVersionForRun` (agente + versão vigente/fixada/de migração), a conferência de ativo na hora da execução
 * (`run-agent.ts`, `run-orchestrated-reply.ts`) e a lista de especialistas do Orquestrador sem versão (chat/voz).
 */
export function answerAgentVersionQuery(text: string, params: readonly unknown[] = [], agentOf: (agentId: string) => FakeAgentRow | undefined): { rows: unknown[]; rowCount: number } | null {
  const sql = text.replace(/\s+/g, " ")
  if (sql.includes("select active, current_version_id from agents where id = $1")) {
    const agent = agentOf(String(params[0]))
    return result(agent ? [{ active: agent.active ?? true, current_version_id: fakeAgentVersionIdOf(String(params[0])) }] : [])
  }
  if (sql.startsWith("select active from agents where id = $1")) {
    const agent = agentOf(String(params[0]))
    return result(agent ? [{ active: agent.active ?? true }] : [])
  }
  if (sql.includes("select id, version_number, config from agent_versions")) {
    // id = $1 (vigente: o id do agente), id = $1 and agent_id = $2 (fixada) ou agent_id = $1 (origem MIGRATION).
    const agentId = sql.includes("where agent_id = $1") ? String(params[0]) : params[1] !== undefined ? String(params[1]) : String(params[0])
    const agent = agentOf(agentId)
    if (!agent) return result([])
    return result([{ id: sql.includes("where agent_id = $1") ? fakeAgentVersionIdOf(agentId) : String(params[0]), version_number: 1, config: fakeAgentConfig(agent) }])
  }
  return null
}

/** Nos fakes, a versão publicada de um Orquestrador tem o MESMO id do Orquestrador. */
export const fakeOrchestratorVersionIdOf = (orchestratorId: string) => orchestratorId

export type FakeOrchestratorVersionOptions = {
  /** Linha simulada do agente (ou undefined = não existe). `current_version_id: null` = agente nunca publicado. */
  agentOf: (agentId: string) => FakeAgentRow | undefined
  /** Agente orquestrador gravado no Orquestrador (ou undefined = Orquestrador não existe). */
  orchestratorAgentOf: (orchestratorId: string) => string | undefined
  /** Especialistas já fixados no Orquestrador antes desta gravação (padrão: nenhum). */
  pinnedSpecialistsOf?: (orchestratorId: string) => { agentId: string; agentVersionId: string | null }[]
}

/**
 * Responde às consultas da GRAVAÇÃO do Orquestrador (PEN-076; orchestrator-versions.ts): versão fixada de cada agente
 * (`syncPinnedSpecialists`, `pinOrchestratorAgent`), publicação da versão nova (`publishOrchestratorVersion`) e a conferência
 * de concorrência (`assertOrchestratorVersion`). `null` = a consulta não é dessas; o fake segue com as respostas dele.
 */
export function answerOrchestratorVersionQuery(text: string, params: readonly unknown[] = [], options: FakeOrchestratorVersionOptions): { rows: unknown[]; rowCount: number } | null {
  const sql = text.replace(/\s+/g, " ").trim()
  const publishedVersionOf = (agentId: string, agent: FakeAgentRow) => ("current_version_id" in agent ? (agent.current_version_id as string | null) : fakeAgentVersionIdOf(agentId))
  if (sql.startsWith("select id, name, current_version_id from agents where id = any($1::uuid[])")) {
    const ids = (params[0] as string[] | undefined) ?? []
    return result(ids.flatMap((id) => {
      const agent = options.agentOf(id)
      return agent ? [{ id, name: (agent.name as string | undefined) ?? "Agente", current_version_id: publishedVersionOf(id, agent) }] : []
    }))
  }
  if (sql.startsWith("select id, agent_id from agent_versions where agent_id = any($1::uuid[])")) {
    const ids = (params[0] as string[] | undefined) ?? []
    return result(ids.flatMap((id) => {
      const agent = options.agentOf(id)
      const versionId = agent ? publishedVersionOf(id, agent) : null
      return versionId ? [{ id: versionId, agent_id: id }] : []
    }))
  }
  if (sql.startsWith("select agent_id, agent_version_id from assistant_orchestrator_specialists where orchestrator_id = $1")) {
    return result((options.pinnedSpecialistsOf?.(String(params[0])) ?? []).map((pin) => ({ agent_id: pin.agentId, agent_version_id: pin.agentVersionId })))
  }
  if (sql.startsWith("delete from assistant_orchestrator_specialists where orchestrator_id = $1")) return result([])
  if (sql.startsWith("insert into assistant_orchestrator_specialists(")) return { rows: [], rowCount: 1 }
  if (sql.startsWith("select orchestrator_agent_id, orchestrator_agent_version_id from assistant_orchestrators where id = $1")) {
    const agentId = options.orchestratorAgentOf(String(params[0]))
    return result(agentId ? [{ orchestrator_agent_id: agentId, orchestrator_agent_version_id: null }] : [])
  }
  if (sql.startsWith("update assistant_orchestrators set orchestrator_agent_version_id = $2 where id = $1")) return { rows: [], rowCount: 1 }
  if (sql.startsWith("insert into assistant_orchestrator_versions")) {
    const orchestratorId = String(params[0])
    return result(options.orchestratorAgentOf(orchestratorId) ? [{ id: fakeOrchestratorVersionIdOf(orchestratorId), number: 1 }] : [])
  }
  if (sql.startsWith("update assistant_orchestrators set current_version_id = $2 where id = $1")) return { rows: [], rowCount: 1 }
  if (sql.startsWith("select o.current_version_id, v.published_by_name name from assistant_orchestrators o")) {
    const orchestratorId = String(params[0])
    return result(options.orchestratorAgentOf(orchestratorId) ? [{ current_version_id: fakeOrchestratorVersionIdOf(orchestratorId), name: "Admin" }] : [])
  }
  return null
}
