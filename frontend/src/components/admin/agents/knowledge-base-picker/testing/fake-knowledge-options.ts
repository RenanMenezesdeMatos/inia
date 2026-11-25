import type { AgentKnowledgeScope, KnowledgeOption, KnowledgeOptionFacets, KnowledgeOptionIds, KnowledgeOptionsFilter, KnowledgeOptionsPage } from "@/schemas/admin/agent-knowledge-options.schema"

import { fitsAgentScope, foldText } from "../picker-rules"

/**
 * Servidor de mentira do seletor de bases do Agent (só para testes): aplica as mesmas regras da rota (universo do agente com pendente,
 * alcance do agente, busca sem acento em título/assunto/produto, Grupo, situação, exclusão das escolhidas, posição numérica).
 */
export function option(id: string, title: string, overrides: Partial<KnowledgeOption> = {}): KnowledgeOption {
  return { id, title, operatingUniverse: "B2C", state: "IN_USE", inUseVersion: 1, orgScopes: [{ scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null }], allSubjects: false, subjects: [], products: [], ...overrides }
}

export function createFakeKnowledgeOptions(all: KnowledgeOption[], groupDefaults: (scope: AgentKnowledgeScope) => string[] = () => []) {
  const matches = (filter: KnowledgeOptionsFilter) =>
    [...all]
      .sort((a, b) => foldText(a.title).localeCompare(foldText(b.title)))
      .filter((item) => !filter.agentUniverse || !item.operatingUniverse || item.operatingUniverse === filter.agentUniverse)
      .filter((item) => !filter.universe || (filter.universe === "PENDING" ? item.operatingUniverse === null : item.operatingUniverse === filter.universe))
      .filter((item) => fitsAgentScope(item, filter.agentScope, undefined))
      .filter((item) => !filter.teamId || item.orgScopes.some((scope) => scope.teamId !== null && filter.teamId!.includes(scope.teamId)))
      .filter((item) => !filter.state || item.state === filter.state)
      .filter((item) => !filter.excludeIds?.includes(item.id))
      .filter((item) => !filter.search || foldText([item.title, ...item.subjects, ...item.products].join(" ")).includes(foldText(filter.search)))
  const fake = {
    calls: { search: [] as (KnowledgeOptionsFilter & { cursor?: string; limit: number })[], ids: [] as KnowledgeOptionsFilter[] },
    searchKnowledgeOptions(filter: KnowledgeOptionsFilter & { cursor?: string; limit: number }): Promise<KnowledgeOptionsPage> {
      fake.calls.search.push(filter)
      const found = matches(filter)
      const start = filter.cursor ? Number(filter.cursor) : 0
      const items = found.slice(start, start + filter.limit)
      return Promise.resolve({ items, nextCursor: start + filter.limit < found.length ? String(start + filter.limit) : null, total: filter.cursor ? null : found.length })
    },
    fetchKnowledgeOptionIds(filter: KnowledgeOptionsFilter): Promise<KnowledgeOptionIds> {
      fake.calls.ids.push(filter)
      const found = matches(filter)
      return Promise.resolve({ ids: found.map((item) => item.id), total: found.length, truncated: false })
    },
    fetchGroupDefaultKnowledgeIds(scope: AgentKnowledgeScope): Promise<KnowledgeOptionIds> {
      const ids = groupDefaults(scope)
      return Promise.resolve({ ids, total: ids.length, truncated: false })
    },
    lookupKnowledgeOptions(ids: string[]): Promise<KnowledgeOption[]> {
      return Promise.resolve(all.filter((item) => ids.includes(item.id)))
    },
    fetchKnowledgeOptionFacets(): Promise<KnowledgeOptionFacets> {
      return Promise.resolve({ products: [], subjects: [] })
    },
  }
  return fake
}
