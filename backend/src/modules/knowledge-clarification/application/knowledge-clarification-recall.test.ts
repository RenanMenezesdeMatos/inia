import { describe, expect, it } from "vitest"
import { createKnowledgeRecall } from "../../knowledge/application/knowledge-recall.js"
import { DEFAULT_NAVIGATION_BUDGET, type NavigationBudget } from "../domain/knowledge-workspace.js"
import { TEST_ORCHESTRATOR_AGENT, TEST_ORG, TEST_PERSON, TEST_SPECIALIST_AGENT, fixtureKnowledge, scriptedModel } from "../testing/clarification-fixtures.js"
import { candidatesFirst, createKnowledgeClarification, type ClarificationRequest } from "./knowledge-clarification-service.js"

/**
 * Busca nas bases em escala no esclarecimento: o catálogo e a navegação REAIS sobre as bases fictícias, a IA roteirizada e a busca com
 * provider falso (vetor escolhido pelo teste) ou sem policy (só BM25). Nada aqui vira regra de produção.
 */
const LEXICAL_ONLY = { embeddingModel: async () => null, embedQuery: async () => null, loadVectors: async () => new Map() }

function setup(options: { recall?: Parameters<typeof createKnowledgeRecall>[0] | "THROWS" | null; budget?: Partial<NavigationBudget> } = {}) {
  const fixture = fixtureKnowledge()
  const { model, calls } = scriptedModel(() => ({ decision: "NOT_APPLICABLE" }))
  const recall = options.recall === "THROWS"
    ? { startQuery: async () => null, recall: async () => { throw new Error("índice indisponível") } }
    : options.recall === null ? null : createKnowledgeRecall(options.recall ?? LEXICAL_ONLY)
  const service = createKnowledgeClarification({ knowledge: fixture.knowledge, model, guardrails: async () => "", specialistInstructions: async () => "", budget: { ...DEFAULT_NAVIGATION_BUDGET, ...options.budget }, recall })
  const request = (text: string): ClarificationRequest => ({ organizationId: TEST_ORG, personId: TEST_PERSON, orchestratorAgentId: TEST_ORCHESTRATOR_AGENT, specialistAgentIds: [TEST_SPECIALIST_AGENT], text, answer: null, previous: null, recentTurns: [] })
  return { ask: (text: string) => service.handle(request(text)), calls }
}

describe("esclarecimento com a busca em escala", () => {
  it("pergunta nova: as seções candidatas chegam LIDAS à primeira decisão (a IA continua decidindo e podendo ler outras)", async () => {
    const { ask, calls } = setup({ budget: { fullOutlineChars: 0, sampleSectionsPerBase: 1 } })
    const outcome = await ask("Qual o prazo da mudança de endereço da linha FWT?")
    expect(outcome.trace.recall).toMatchObject({ version: "HYBRID_RECALL_V2", mode: "LEXICAL", vectorSkipped: "NO_POLICY", reordered: false })
    expect(outcome.trace.recall!.prefilled).toBeGreaterThan(0)
    expect(calls[0]!.user).toContain("O prazo da mudança de endereço da linha FWT é imediato após a validação da cobertura.")
  })

  it("sem a busca (interruptor desligado): a primeira decisão não recebe seção lida nenhuma — exatamente como antes", async () => {
    const { ask, calls } = setup({ recall: null, budget: { fullOutlineChars: 0, sampleSectionsPerBase: 1 } })
    const outcome = await ask("Qual o prazo da mudança de endereço da linha FWT?")
    expect(outcome.trace.recall).toBeUndefined()
    expect(calls[0]!.user).not.toContain("é imediato após a validação da cobertura")
  })

  it("lista acima do limite: as bases com candidatos vêm primeiro (antes o corte era por título e a base certa podia ficar de fora)", async () => {
    const { ask, calls } = setup({ budget: { maxListedBases: 2, fullOutlineChars: 0, sampleSectionsPerBase: 1 } })
    const outcome = await ask("Férias: com quantos dias de antecedência peço no portal?")
    expect(outcome.trace.recall).toMatchObject({ reordered: true })
    expect(calls[0]!.user).toContain("Política de férias (fictícia)")
    const titleOrdered = setup({ recall: null, budget: { maxListedBases: 2, fullOutlineChars: 0, sampleSectionsPerBase: 1 } })
    await titleOrdered.ask("Férias: com quantos dias de antecedência peço no portal?")
    expect(titleOrdered.calls[0]!.user).not.toContain("Política de férias (fictícia)")
  })

  it("com policy mas versões ainda não indexadas: a pergunta segue pelo BM25 e o rastro diz por quê", async () => {
    const meaning = (text: string) => new Float32Array([/antecedência|antecipação|portal|férias|descanso/i.test(text) ? 1 : 0, 0.01])
    const { ask, calls } = setup({
      recall: { embeddingModel: async () => "fake-embed", embedQuery: async ({ text }) => meaning(text), loadVectors: async () => new Map(), timeoutMs: 1_000 },
      budget: { fullOutlineChars: 0, sampleSectionsPerBase: 1 },
    })
    const outcome = await ask("Preciso pedir descanso remunerado, com quanto tempo de antecipação?")
    expect(outcome.trace.recall).toMatchObject({ mode: "LEXICAL", modelKey: "fake-embed", vectorSkipped: "NOT_INDEXED" })
    expect(calls).toHaveLength(1)
  })

  it("falha da busca nunca derruba a pergunta: a navegação de sempre segue e o rastro registra a falha", async () => {
    const { ask } = setup({ recall: "THROWS" })
    const outcome = await ask("Qual o prazo da mudança de endereço da linha FWT?")
    expect(outcome).toMatchObject({ kind: "PASS", reason: "NOT_APPLICABLE" })
    expect(outcome.trace.recall).toMatchObject({ failed: "Error", prefilled: 0 })
  })

  it("candidatesFirst: candidatas na ordem da busca, as demais na ordem de sempre", () => {
    const source = (documentId: string) => ({ documentId, documentTitle: documentId, versionId: "v", documentType: null, chunks: [] })
    expect(candidatesFirst([source("a"), source("b"), source("c"), source("d")], ["c", "a"]).map((item) => item.documentId)).toEqual(["c", "a", "b", "d"])
  })
})
