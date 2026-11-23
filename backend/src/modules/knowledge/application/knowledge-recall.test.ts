import { describe, expect, it } from "vitest"
import { embeddingTextsOf } from "../domain/embedding-texts.js"
import { chunkKnowledgeDocument } from "../domain/knowledge-chunking.js"
import { createKnowledgeRecall, knowledgeScaleRetrievalEnabled } from "./knowledge-recall.js"
import { knowledgeGlossaryJargonEnabled } from "./knowledge-glossary-jargon.js"
import { jargonRulesOf } from "../domain/glossary-jargon.js"

/** Busca com provider e índice FALSOS: o "significado" é escolhido pelo teste (nenhuma lista de palavras existe no código da INIA). */
const BASES = [
  { id: "contestacao", title: "Contestação de cobrança", content: "## 1. Prazo da análise\nA análise da contestação termina em 5 dias úteis.\n\n## 2. Registro\nAnote o protocolo no sistema." },
  { id: "segunda-via", title: "Segunda via de fatura", content: "## 1. Envio\nA segunda via sai por e-mail em até 2 horas.\n\n## 2. Titular\nConfirme a data de nascimento." },
]
const sources = BASES.map((base) => ({ documentId: base.id, documentTitle: base.title, versionId: `${base.id}-v1`, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: base.id, title: base.title, content: base.content }) }))
const meaning = (text: string) => new Float32Array([/contesta|reclama|cobrad/i.test(text) ? 1 : 0, /prazo|tempo|termina/i.test(text) ? 1 : 0, 0.05])
const vectorsFor = () => new Map(sources.flatMap((source) => embeddingTextsOf(source)).map((text) => [text.hash, meaning(text.text)]))
const QUESTION = "Em quanto tempo sai o resultado quando o cliente reclama de um valor cobrado?"

function recallWith(overrides: Partial<Parameters<typeof createKnowledgeRecall>[0]> = {}) {
  const embedded: string[] = []
  const recall = createKnowledgeRecall({
    embeddingModel: async () => "fake-embed",
    embedQuery: async ({ text }) => (embedded.push(text), meaning(text)),
    loadVectors: async (_organizationId, _modelKey, hashes) => {
      const all = vectorsFor()
      return new Map(hashes.filter((hash) => all.has(hash)).map((hash) => [hash, all.get(hash)!]))
    },
    timeoutMs: 200,
    ...overrides,
  })
  return { recall, embedded }
}

describe("busca nas bases em escala (camada 2 e 4)", () => {
  it("o vetor traz a paráfrase que o BM25 não acha; o trecho certo vem primeiro", async () => {
    const { recall } = recallWith()
    const lexical = await recall.recall({ organizationId: "org", question: QUESTION, sources, query: null })
    expect(lexical.recalled.find((item) => item.documentId === "contestacao" && item.chunkIndex === 0)).toBeUndefined()
    const hybrid = await recall.recall({ organizationId: "org", question: QUESTION, sources, query: recall.startQuery("org", QUESTION) })
    expect(hybrid.trace).toMatchObject({ mode: "HYBRID", modelKey: "fake-embed", scopeChunks: 4, indexedChunks: 4 })
    expect(hybrid.recalled[0]).toMatchObject({ documentId: "contestacao", chunkIndex: 0 })
  })

  it("o vetor da mesma pergunta é reaproveitado (uma chamada só)", async () => {
    const { recall, embedded } = recallWith()
    await recall.startQuery("org", QUESTION)
    await recall.startQuery("org", QUESTION)
    expect(embedded).toHaveLength(1)
  })

  it("embedding lento ou com falha: a pergunta segue pelo BM25 sem esperar além do teto", async () => {
    const slow = recallWith({ embedQuery: () => new Promise((resolve) => setTimeout(() => resolve(new Float32Array([1, 0, 0])), 5_000)), timeoutMs: 20 })
    const started = Date.now()
    const result = await slow.recall.recall({ organizationId: "org", question: QUESTION, sources, query: slow.recall.startQuery("org", QUESTION) })
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(result.trace).toMatchObject({ mode: "LEXICAL", vectorSkipped: "QUERY_UNAVAILABLE" })
    const failing = recallWith({ embedQuery: async () => { throw new Error("503") } })
    expect((await failing.recall.recall({ organizationId: "org", question: QUESTION, sources, query: failing.recall.startQuery("org", QUESTION) })).trace.vectorSkipped).toBe("QUERY_UNAVAILABLE")
    const brokenIndex = recallWith({ loadVectors: async () => { throw new Error("banco") } })
    expect((await brokenIndex.recall.recall({ organizationId: "org", question: QUESTION, sources, query: brokenIndex.recall.startQuery("org", QUESTION) })).trace).toMatchObject({ mode: "LEXICAL", vectorSkipped: "FAILED" })
  })

  it("camada 4: ordem dos documentos pelo cartão; sem policy ou sem cartão indexado = null (o motor segue com a ordem de sempre)", async () => {
    const { recall } = recallWith()
    expect((await recall.rankDocuments({ organizationId: "org", query: QUESTION, sources }))?.order).toEqual(["contestacao", "segunda-via"])
    expect(await recallWith({ embeddingModel: async () => null }).recall.rankDocuments({ organizationId: "org", query: QUESTION, sources })).toBeNull()
    expect(await recallWith({ loadVectors: async () => new Map() }).recall.rankDocuments({ organizationId: "org", query: QUESTION, sources })).toBeNull()
  })

  it("caches por processo limitados por BYTES (RAG-03): versões e índices grandes saem por LRU, o resultado não muda", async () => {
    const big = Array.from({ length: 30 }, (_, index) => {
      const content = `## 1. Prazo\nA análise da contestação termina em 5 dias úteis. ${"Detalhe do procedimento. ".repeat(400)}`
      return { documentId: `base-${index}`, documentTitle: `Base ${index}`, versionId: `base-${index}-v1`, documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: `base-${index}`, title: `Base ${index}`, content }) }
    })
    const limits = { textBytes: 200_000, indexBytes: 400_000 }
    const { recall } = recallWith({ cacheLimits: limits })
    const unbounded = recallWith().recall
    for (const source of big) {
      const query = recall.startQuery("org", QUESTION)
      const bounded = await recall.recall({ organizationId: "org", question: QUESTION, sources: [source], query })
      const reference = await unbounded.recall({ organizationId: "org", question: QUESTION, sources: [source], query: unbounded.startQuery("org", QUESTION) })
      expect(bounded.recalled).toEqual(reference.recalled)
    }
    const stats = recall.cacheStats()
    expect(stats.textBytes).toBeLessThanOrEqual(limits.textBytes)
    expect(stats.indexBytes).toBeLessThanOrEqual(limits.indexBytes)
    expect(stats.versions).toBeGreaterThan(0)
    expect(stats.versions).toBeLessThan(big.length)
    expect(stats.indexes).toBeLessThan(big.length)
  })

  it("interruptor: ligado por padrão; off/false/0 desliga", () => {
    expect(knowledgeScaleRetrievalEnabled({})).toBe(true)
    expect(knowledgeScaleRetrievalEnabled({ INIA_KB_SCALE_RETRIEVAL: "off" })).toBe(false)
    expect(knowledgeScaleRetrievalEnabled({ INIA_KB_SCALE_RETRIEVAL: "0" })).toBe(false)
  })
})

describe("gíria do Glossário no vetor (INIA_KB_GLOSSARY_JARGON_VECTORS)", () => {
  const RULES = jargonRulesOf([{ term: "conta gêmea", definition: "Duplicidade de cobrança: a mesma cobrança duas vezes." }])
  const base = { documentId: "contas", documentTitle: "Contestação de contas", versionId: "contas-v1", documentType: "PROCEDURE", chunks: chunkKnowledgeDocument({ id: "contas", title: "Contestação de contas", content: "## 1. Roaming\nVerificar o país.\n\n## 2. Duplicidade de cobrança\nVerificar se há duas contas iguais." }) }
  // O "significado" falso só reconhece a gíria: o vetor do trecho sem a linha "Também chamado" não se parece com a pergunta.
  const meaning = (text: string) => new Float32Array([/gêmea/i.test(text) ? 1 : 0, /roaming/i.test(text) ? 1 : 0, 0.05])
  const plain = embeddingTextsOf(base)
  const enriched = embeddingTextsOf(base, { jargon: RULES })
  const run = async (stored: readonly { hash: string; text: string }[], jargon: boolean) => {
    const vectors = new Map(stored.map((text) => [text.hash, meaning(text.text)]))
    const recall = createKnowledgeRecall({
      embeddingModel: async () => "fake-embed",
      embedQuery: async ({ text }) => meaning(text),
      loadVectors: async (_organizationId, _modelKey, hashes) => new Map(hashes.filter((hash) => vectors.has(hash)).map((hash) => [hash, vectors.get(hash)!])),
      timeoutMs: 200,
      ...(jargon ? { jargon: async () => RULES } : {}),
    })
    const question = "Cliente com conta gêmea, como resolvo?"
    return recall.recall({ organizationId: "org", question, sources: [base], query: recall.startQuery("org", question) })
  }

  it("ligada: o trecho é achado pelo vetor com a gíria", async () => {
    const result = await run(enriched, true)
    expect(result.trace.indexedChunks).toBe(base.chunks.length)
    expect(result.recalled[0]).toMatchObject({ documentId: "contas", chunkIndex: base.chunks.find((chunk) => chunk.heading.includes("Duplicidade"))!.index })
  })

  it("ligada antes da indexação: usa o vetor sem gíria como reserva (nenhum trecho some)", async () => {
    const result = await run(plain, true)
    expect(result.trace.indexedChunks).toBe(base.chunks.length)
  })

  it("desligada: procura só os hashes de sempre", async () => {
    expect((await run(enriched, false)).trace.indexedChunks).toBe(base.chunks.length - 1)
    expect((await run(plain, false)).trace.indexedChunks).toBe(base.chunks.length)
  })

  it("interruptor: desligado por padrão; só on/true/1 liga", () => {
    expect(knowledgeGlossaryJargonEnabled({})).toBe(false)
    expect(knowledgeGlossaryJargonEnabled({ INIA_KB_GLOSSARY_JARGON_VECTORS: "off" })).toBe(false)
    expect(knowledgeGlossaryJargonEnabled({ INIA_KB_GLOSSARY_JARGON_VECTORS: "on" })).toBe(true)
  })
})
