import { AsyncLocalStorage } from "node:async_hooks"
import type { AgentConfig, AgentRuntimeSnapshot } from "../domain/agent-config.js"

/**
 * Versão do agente em execução (PEN-002). Quem inicia a execução resolve a versão (fixada pelo Workflow ou pelo orquestrador,
 * vigente no chat, rascunho no teste manual) e roda dentro deste contexto; os leitores que montam o prompt, as bases, os limites
 * e as ferramentas consultam a versão daqui em vez das colunas vivas de `agents` — que espelham só a VIGENTE. Fora do contexto
 * (caminhos que sempre usam a vigente) vale a leitura de sempre.
 */
const storage = new AsyncLocalStorage<ReadonlyMap<string, AgentRuntimeSnapshot>>()

export function withAgentSnapshots<T>(snapshots: AgentRuntimeSnapshot[], run: () => Promise<T>): Promise<T> {
  const next = new Map(storage.getStore() ?? [])
  for (const snapshot of snapshots) next.set(snapshot.agentId, snapshot)
  return storage.run(next, run)
}

export function agentSnapshotFor(agentId: string | null | undefined): AgentRuntimeSnapshot | null {
  if (!agentId) return null
  return storage.getStore()?.get(agentId) ?? null
}

/** Chave de cache por versão: a mesma `agentId` pode rodar em versões diferentes no mesmo processo. */
export function agentCacheKey(agentId: string): string {
  const snapshot = agentSnapshotFor(agentId)
  if (!snapshot) return agentId
  return snapshot.versionId ? `${agentId}@${snapshot.versionId}` : `${agentId}@draft:${JSON.stringify(snapshot.config.knowledgeDocumentIds)}|${snapshot.config.scopeType}|${snapshot.config.teamId}|${snapshot.config.subteamId}`
}

/** Grupo efetivo do alcance de uma configuração (Subgrupo → o Grupo dele), para as regras de base e de público. */
export type AgentScopeOfConfig = Pick<AgentConfig, "scopeType" | "teamId" | "subteamId">
