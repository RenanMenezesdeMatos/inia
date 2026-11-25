import { describe, expect, it } from "vitest"

import type { AgentConfig } from "../domain/agent-config.js"
import { draftHasOtherChanges, knowledgeIdsAfter, matchesKnowledgeLinkFilter, pageKnowledgeLinkCandidates, type KnowledgeLinkCandidate } from "./agent-knowledge-links.js"

/** Regras puras da associação a partir da base, na suíte normal (run-8, QA-08/ARQ-04; a prova de banco cobre as rotas). */

const config = (overrides: Partial<AgentConfig> = {}): AgentConfig => ({
  name: "Agente", agentType: "CUSTOM", objective: "o", description: "d", contextPrompt: "c", scopeType: "ALL_TEAMS", teamId: null, subteamId: null, scopeLinks: [],
  specialty: null, specialtyKind: null, domain: null, capability: null, consolidatedInput: false, businessDomainId: null, recommendSupportMaterials: false,
  investigationCapabilities: [], actionLimitsEnabled: false, actionLimits: null, knowledgeDocumentIds: [], ...overrides,
})

const candidate = (id: string, name: string, overrides: Partial<KnowledgeLinkCandidate> = {}): KnowledgeLinkCandidate => ({
  id, name, agentType: "CALL_FEEDBACK", active: true, operatingUniverse: null, scopeType: "ALL_TEAMS", scopeLinks: [],
  linkedInUse: false, linkedInDraft: false, published: true, currentVersionNumber: 1,
  draft: { revision: 1, pending: false, otherChanges: false, updatedAt: null, updatedByName: null }, block: null, blockMessage: null, ...overrides,
})

describe("draftHasOtherChanges e knowledgeIdsAfter", () => {
  it("só as bases mudaram = sem outras alterações; qualquer outro campo = outras alterações; sem rascunho = não", () => {
    expect(draftHasOtherChanges(config(), config({ knowledgeDocumentIds: ["b"] }))).toBe(false)
    expect(draftHasOtherChanges(config(), config({ objective: "novo" }))).toBe(true)
    expect(draftHasOtherChanges(config(), null)).toBe(false)
    expect(draftHasOtherChanges(null, config())).toBe(false)
  })

  it("liga e desliga sem repetir, em ordem", () => {
    expect(knowledgeIdsAfter(["c", "a"], "b", true)).toEqual(["a", "b", "c"])
    expect(knowledgeIdsAfter(["a", "b"], "b", true)).toEqual(["a", "b"])
    expect(knowledgeIdsAfter(["a", "b"], "b", false)).toEqual(["a"])
  })
})

describe("matchesKnowledgeLinkFilter", () => {
  const teamA = "11111111-1111-4111-8111-111111111111"
  const sub = "22222222-2222-4222-8222-222222222222"
  const teamB = "33333333-3333-4333-8333-333333333333"
  const subB1 = "44444444-4444-4444-8444-444444444444"
  it("busca sem acento, tipo, universo (PENDING = sem universo), Grupo com Subgrupos, só globais e situação", () => {
    const groupAgent = candidate("1", "Agente Cobrança", { scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, teamName: "A", subteamId: null, subteamName: null }], operatingUniverse: "B2C" })
    const subAgent = candidate("2", "Agente Faturas", { scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, teamName: "A", subteamId: sub, subteamName: "a1" }], published: false })
    expect(matchesKnowledgeLinkFilter(groupAgent, { search: "cobranca" })).toBe(true)
    expect(matchesKnowledgeLinkFilter(groupAgent, { agentType: "DIAGNOSTICS" })).toBe(false)
    expect(matchesKnowledgeLinkFilter(groupAgent, { universe: "B2C" })).toBe(true)
    expect(matchesKnowledgeLinkFilter(groupAgent, { universe: "PENDING" })).toBe(false)
    expect(matchesKnowledgeLinkFilter(subAgent, { universe: "PENDING" })).toBe(true)
    expect(matchesKnowledgeLinkFilter(subAgent, { teamId: [teamA] })).toBe(true)
    expect(matchesKnowledgeLinkFilter(groupAgent, { subteamId: [sub] })).toBe(false)
    expect(matchesKnowledgeLinkFilter(groupAgent, { scopeType: "ALL_TEAMS" })).toBe(false)
    expect(matchesKnowledgeLinkFilter(subAgent, { state: "NOT_PUBLISHED" })).toBe(true)
    expect(matchesKnowledgeLinkFilter(groupAgent, { state: "INACTIVE" })).toBe(false)
  })

  it("vários vínculos (249): o filtro de Grupo acha o agente por QUALQUER vínculo; o de Subgrupo, só pelo vínculo daquele Subgrupo", () => {
    const multi = candidate("3", "Agente Multi", { scopeType: "GROUPS", scopeLinks: [{ teamId: teamA, teamName: "A", subteamId: null, subteamName: null }, { teamId: teamB, teamName: "B", subteamId: subB1, subteamName: "b1" }] })
    expect(matchesKnowledgeLinkFilter(multi, { teamId: [teamA] })).toBe(true)
    expect(matchesKnowledgeLinkFilter(multi, { teamId: [teamB] })).toBe(true)
    expect(matchesKnowledgeLinkFilter(multi, { subteamId: [subB1] })).toBe(true)
    expect(matchesKnowledgeLinkFilter(multi, { subteamId: [sub] })).toBe(false)
    expect(matchesKnowledgeLinkFilter(multi, { scopeType: "ALL_TEAMS" })).toBe(false)
    expect(matchesKnowledgeLinkFilter(multi, { teamId: ["55555555-5555-4555-8555-555555555555"], subteamId: [subB1] })).toBe(true)
    expect(matchesKnowledgeLinkFilter(multi, { teamId: ["55555555-5555-4555-8555-555555555555", teamA], subteamId: [sub] })).toBe(true)
  })
})

describe("pageKnowledgeLinkCandidates", () => {
  const linked = candidate("a", "A ligado", { linkedInUse: true, linkedInDraft: true })
  const draftOnly = candidate("b", "B só no rascunho", { linkedInDraft: true, draft: { revision: 2, pending: true, otherChanges: false, updatedAt: null, updatedByName: null } })
  const draftOnlyOther = candidate("c", "C só no rascunho com outras", { linkedInDraft: true, draft: { revision: 2, pending: true, otherChanges: true, updatedAt: null, updatedByName: null } })
  const neverPublished = candidate("d", "D novo", { linkedInDraft: true, published: false })
  const available = [1, 2, 3].map((index) => candidate(`x${index}`, `X${index}`))
  const all = [linked, draftOnly, draftOnlyOther, neverPublished, ...available]

  it("abas, contagem e página (a última página é corrigida para a que existe)", () => {
    const page = pageKnowledgeLinkCandidates(all, { tab: "AVAILABLE" }, 2, 2)
    expect(page).toMatchObject({ total: 3, page: 2, pageSize: 2, counts: { linked: 4, available: 3 } })
    expect(page.items.map((item) => item.id)).toEqual(["x3"])
    expect(pageKnowledgeLinkCandidates(all, { tab: "AVAILABLE" }, 99, 2).page).toBe(2)
  })

  it("pendentes de publicar: só os publicados, sem bloqueio e SEM outras alterações (QA-02); nunca publicado não entra", () => {
    expect(pageKnowledgeLinkCandidates(all, { tab: "LINKED" }, 1, 20).pendingPublish.map((item) => item.id)).toEqual(["b"])
  })
})
