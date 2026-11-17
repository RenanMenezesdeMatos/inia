/**
 * AVALIAÇÃO DE RECALL da busca nas bases em escala (camadas 1–3), sem geração e sem nenhuma chamada paga: o embedding é o do Ollama local
 * (bge-m3) pelo MESMO adapter OpenAI-compatível que a INIA usa com o gateway da VM. Mede se o trecho necessário chega à IA — a métrica que
 * decide o desenho ("qualidade não pode cair") — no fluxo atual e no novo, em duas escalas:
 *   - REAL: as bases do corpus de medição (`inia_chatbench`, só leitura, as mesmas 16 perguntas do piloto de 06/11/2026, gabarito em
 *     `gold.json` definido antes de qualquer comparação);
 *   - ESCALA: as mesmas + N bases sintéticas de distração (padrão 1000), geradas de forma determinística, com vocabulário operacional
 *     parecido (prazo, dias úteis, titular, protocolo…) e assuntos diferentes dos do gabarito. É o pior caso da camada 1: todas no escopo.
 *
 *   KB_EVAL_DATABASE_URL=postgresql://localhost:5432/inia_chatbench npx tsx scripts/dev/kb-scale-eval/eval-recall.ts [distratoras=1000]
 *
 * Variáveis: KB_EVAL_EMBEDDING_URL (padrão http://127.0.0.1:11434/v1), KB_EVAL_EMBEDDING_MODEL (padrão bge-m3), KB_EVAL_CACHE (pasta do
 * cache de vetores, padrão no diretório temporário), KB_EVAL_OUT (relatório JSON; padrão docs/dev/busca-em-escala/resultados/recall.json).
 *
 * O que cada coluna significa:
 *   - "Fluxo atual · base listada": a base do trecho está entre as `maxListedBases` (120) que o esclarecimento mostra à IA — a lista é em
 *     ordem de título; o que passa disso a IA nunca vê (nem pode pedir para ler).
 *   - "BM25 atual · top 40": o trecho está entre os 40 primeiros do índice de texto de sempre (`lexical-retrieval.ts`).
 *   - "Novo · top 40": o trecho está entre os 40 candidatos BM25 ∪ vetor (`knowledge-recall.ts`).
 *   - "Novo · base listada": a base está nas 120 primeiras depois de pôr as bases com candidatos na frente (`candidatesFirst`).
 *   - "Novo · já lido": a seção chega lida à primeira decisão (`planSectionPrefill`, V3).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createOpenAiChatAdapter } from "../../../src/modules/ai-management/infrastructure/adapters/openai-chat-adapter.js"
import { createGoogleGenAiAdapter } from "../../../src/modules/ai-management/infrastructure/adapters/google-genai-adapter.js"
import type { FusionOptions } from "../../../src/modules/knowledge/domain/hybrid-recall.js"
import { EMBEDDING_BATCH_SIZE, embeddingText } from "../../../src/modules/ai-management/domain/ai-embedding.js"
import { candidatesFirst } from "../../../src/modules/knowledge-clarification/application/knowledge-clarification-service.js"
import { DEFAULT_NAVIGATION_BUDGET } from "../../../src/modules/knowledge-clarification/domain/knowledge-workspace.js"
import { createKnowledgeRecall } from "../../../src/modules/knowledge/application/knowledge-recall.js"
import { embeddingTextsOf } from "../../../src/modules/knowledge/domain/embedding-texts.js"
import { sectionOf, type CatalogSource } from "../../../src/modules/knowledge/domain/knowledge-catalog.js"
import { planSectionPrefill } from "../../../src/modules/knowledge/domain/section-prefill.js"
import { normalized } from "../../../src/modules/knowledge/domain/vector-math.js"
import { loadRealCorpus, readVectorCache, withDistractors } from "./corpus.js"
import { expandAcronyms } from "../../../src/modules/knowledge/domain/query-acronyms.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const distractorCount = Number(process.argv[2] ?? 1000)
const databaseUrl = process.env.KB_EVAL_DATABASE_URL ?? "postgresql://localhost:5432/inia_chatbench"
if (/\/inia(\?|$)/.test(databaseUrl)) throw new Error("Recusado: a avaliação lê só a cópia de medição (inia_chatbench), nunca o banco de desenvolvimento compartilhado.")
const provider = (process.env.KB_EVAL_PROVIDER ?? "ollama") as "ollama" | "gemini"
const embeddingUrl = process.env.KB_EVAL_EMBEDDING_URL ?? (provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta" : "http://127.0.0.1:11434/v1")
const embeddingModel = process.env.KB_EVAL_EMBEDDING_MODEL ?? (provider === "gemini" ? "gemini-embedding-001" : "bge-m3")
/** Teto de gasto da rodada paga (estimado por caracteres ÷ 4 × preço por milhão de tokens de entrada). */
const maxUsd = Number(process.env.KB_EVAL_MAX_USD ?? 1)
const pricePerMillion = Number(process.env.KB_EVAL_PRICE_PER_MILLION ?? (provider === "gemini" ? 0.15 : 0))
let spentUsd = 0
const cacheDir = process.env.KB_EVAL_CACHE ?? path.join(os.tmpdir(), "inia-kb-scale-eval")
const outFile = process.env.KB_EVAL_OUT ?? path.join(here, `../../../../docs/dev/busca-em-escala/resultados/recall-${embeddingModel.replace(/[^a-z0-9.-]/gi, "_")}.json`)
const LIST_LIMIT = DEFAULT_NAVIGATION_BUDGET.maxListedBases
const TOP = 40

type Section = { doc: string; chunk: number; literal: string }
type Question = { id: string; category: string; text: string; sections: Section[] }
const goldFiles = (process.env.KB_EVAL_GOLD ?? "gold.json,gold-v2.json,gold-v3.json").split(",")
const gold = { questions: goldFiles.flatMap((file) => (JSON.parse(readFileSync(path.join(here, file), "utf8")) as { questions: Question[] }).questions) }

// ---------- corpus ----------
const corpus = await loadRealCorpus(databaseUrl)
const realSources = corpus.sources
const scaleSources = withDistractors(realSources, distractorCount)

// ---------- gabarito: seção obrigatória (por literal, conferido antes de medir) ----------
const sectionKey = (sources: Map<string, CatalogSource>, documentId: string, chunkIndex: number) => {
  const source = sources.get(documentId)
  const section = source ? sectionOf(source, chunkIndex) : null
  return `${documentId}#${section?.chunkIndexes[0] ?? chunkIndex}`
}
const realById = new Map(realSources.map((source) => [source.documentId, source]))
const questions = gold.questions.filter((question) => question.sections.length > 0).map((question) => ({
  ...question,
  required: question.sections.map((section) => {
    const document = realSources.find((source) => source.documentTitle.includes(section.doc) && source.chunks.some((chunk) => chunk.text.includes(section.literal)))
    if (!document) throw new Error(`${question.id}: o trecho obrigatório "${section.literal}" não existe em "${section.doc}".`)
    const chunk = document.chunks.find((item) => item.index === section.chunk && item.text.includes(section.literal)) ?? document.chunks.find((item) => item.text.includes(section.literal))!
    return { documentId: document.documentId, key: sectionKey(realById, document.documentId, chunk.index), label: `${section.doc} · ${section.literal}` }
  }),
}))

// ---------- vetores: Ollama local pelo adapter OpenAI-compatível da INIA, com cache em disco por hash ----------
mkdirSync(cacheDir, { recursive: true })
const cacheFile = path.join(cacheDir, `${embeddingModel.replace(/[^a-z0-9.-]/gi, "_")}.jsonl`)
const vectors = await readVectorCache(cacheFile)
const adapter = provider === "gemini" ? createGoogleGenAiAdapter() : createOpenAiChatAdapter()
const connection = { id: "eval", name: provider, providerKey: provider === "gemini" ? "GOOGLE_GENAI" : "OLLAMA", adapterType: provider === "gemini" ? ("GOOGLE_GENAI" as const) : ("OPENAI_CHAT_COMPLETIONS" as const), baseUrl: embeddingUrl, apiVersion: null, apiKey: provider === "gemini" ? (process.env.GEMINI_API_KEY ?? null) : null, headers: {}, timeoutMs: 300_000 }
if (provider === "gemini" && !connection.apiKey) throw new Error("GEMINI_API_KEY ausente.")
/** Toda chamada passa por aqui: soma o custo estimado e para antes de passar do teto. */
async function embedTexts(texts: string[], purpose: "DOCUMENT" | "QUERY") {
  const cost = (texts.reduce((sum, text) => sum + text.length, 0) / 4 / 1_000_000) * pricePerMillion
  if (spentUsd + cost > maxUsd) throw new Error(`Teto de US$ ${maxUsd} atingido (gasto estimado US$ ${spentUsd.toFixed(4)}).`)
  spentUsd += cost
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await adapter.embed!(connection, embeddingModel, { texts, purpose }, 300_000)
    } catch (error) {
      if (attempt >= 5 || !/RATE_LIMIT|PROVIDER_ERROR|TIMEOUT|NETWORK/.test(String((error as { category?: string }).category))) throw error
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt))
    }
  }
}
async function embedAll(sources: readonly CatalogSource[]) {
  // Os dois textos de cada base com produto cadastrado: sem e com a linha "Produto:" (as variantes comparam os dois).
  const pending = [...new Map(sources.flatMap((source) => [...embeddingTextsOf(source), ...(corpus.products.has(source.documentId) ? embeddingTextsOf(source, { products: corpus.products.get(source.documentId)! }) : [])]).filter((text) => !vectors.has(text.hash)).map((text) => [text.hash, text])).values()]
  const started = performance.now()
  for (let start = 0; start < pending.length; start += EMBEDDING_BATCH_SIZE) {
    const batch = pending.slice(start, start + EMBEDDING_BATCH_SIZE)
    const result = await embedTexts(batch.map((text) => embeddingText(text.text)), "DOCUMENT")
    const lines: string[] = []
    batch.forEach((text, index) => {
      const vector = normalized(result.vectors[index]!)!
      vectors.set(text.hash, vector)
      lines.push(JSON.stringify({ h: text.hash, v: [...vector] }))
    })
    writeFileSync(cacheFile, `${lines.join("\n")}\n`, { flag: "a" })
    if ((start / EMBEDDING_BATCH_SIZE) % 20 === 0) console.log(`  vetores ${Math.min(start + EMBEDDING_BATCH_SIZE, pending.length)}/${pending.length}`)
  }
  return { generated: pending.length, ms: Math.round(performance.now() - started) }
}

// ---------- medição ----------
/** Variantes da junção (a 1ª é o padrão atual). Vetor puro e BM25 puro entram como referência. */
const VARIANTS: { name: string; fusion: FusionOptions; only?: "LEXICAL" | "VECTOR"; products?: boolean; acronyms?: boolean }[] = [
  { name: "V1 (trecho, RRF, 40)", fusion: { unit: "CHUNK" } },
  { name: "V2 (seção, intercalado, 60)", fusion: { unit: "SECTION", method: "INTERLEAVE", limit: 60 } },
  { name: "V2 + produto cadastrado", fusion: { unit: "SECTION", method: "INTERLEAVE", limit: 60 }, products: true },
  { name: "V2 + siglas do glossário", fusion: { unit: "SECTION", method: "INTERLEAVE", limit: 60 }, acronyms: true },
  { name: "V2 + produto + siglas", fusion: { unit: "SECTION", method: "INTERLEAVE", limit: 60 }, products: true, acronyms: true },
  { name: "só BM25 (referência)", fusion: { unit: "SECTION" }, only: "LEXICAL" },
]
const DISCOVERY_TOP = 10
type Row = { variant: string; question: string; required: string; currentListed: boolean; top: boolean; rank: number | null; discovered: boolean; newListed: boolean; prefilled: boolean }
const queryVectors = new Map<string, Float32Array>()
async function queryVector(text: string): Promise<Float32Array> {
  const cached = queryVectors.get(text)
  if (cached) return cached
  const vector = normalized((await embedTexts([embeddingText(text)], "QUERY")).vectors[0]!)!
  queryVectors.set(text, vector)
  return vector
}
async function measure(label: string, sources: CatalogSource[]) {
  const indexing = await embedAll(sources)
  const byId = new Map(sources.map((source) => [source.documentId, source]))
  const titleOrdered = [...sources].sort((left, right) => left.documentTitle.localeCompare(right.documentTitle, "pt-BR"))
  const currentlyListed = new Set(titleOrdered.slice(0, LIST_LIMIT).map((source) => source.documentId))
  const rowsOut: Row[] = []
  const searchMs: number[] = []
  for (const question of questions) {
    await queryVector(question.text)
    const expanded = expandAcronyms(question.text, corpus.acronyms).searchQuery
    if (expanded !== question.text) await queryVector(expanded)
  }
  for (const variant of VARIANTS) {
    const recall = createKnowledgeRecall({
      embeddingModel: async () => (variant.only === "LEXICAL" ? null : embeddingModel),
      embedQuery: async ({ text }) => queryVector(text),
      loadVectors: async (_organizationId, _modelKey, hashes) => new Map(hashes.flatMap((hash) => (vectors.has(hash) ? [[hash, vectors.get(hash)!] as const] : []))),
      timeoutMs: 120_000,
      fusion: variant.fusion,
      ...(variant.products ? { products: async (_organizationId: string, ids: readonly string[]) => new Map(ids.flatMap((id) => (corpus.products.has(id) ? [[id, corpus.products.get(id)!] as const] : []))) } : {}),
      ...(variant.acronyms ? { acronyms: async () => corpus.acronyms } : {}),
    })
    for (const question of questions) {
      const result = await recall.recall({ organizationId: "eval", question: variant.only === "VECTOR" ? "\u0000" : question.text, sources: titleOrdered, query: recall.startQuery("eval", question.text) })
      if (variant === VARIANTS[0]) searchMs.push(result.trace.searchMs)
      const fused = result.recalled.map((chunk) => sectionKey(byId, chunk.documentId, chunk.chunkIndex))
      const discovered = new Set(result.documentOrder.slice(0, DISCOVERY_TOP))
      const newListed = new Set(candidatesFirst(titleOrdered, result.documentOrder).slice(0, LIST_LIMIT).map((source) => source.documentId))
      const prefilled = new Set(planSectionPrefill(result.recalled, byId).map((section) => sectionKey(byId, section.documentId, section.chunkIndex)))
      for (const required of question.required) {
        const rank = fused.indexOf(required.key)
        rowsOut.push({ variant: variant.name, question: question.id, required: required.label, currentListed: currentlyListed.has(required.documentId), top: rank >= 0, rank: rank >= 0 ? rank + 1 : null, discovered: discovered.has(required.documentId), newListed: newListed.has(required.documentId), prefilled: prefilled.has(required.key) })
      }
    }
  }
  const total = questions.reduce((sum, question) => sum + question.required.length, 0)
  const variants = VARIANTS.map((variant) => {
    const rows = rowsOut.filter((row) => row.variant === variant.name)
    const count = (key: keyof Row, set?: string) => rows.filter((row) => row[key] === true && (!set || row.question.startsWith(set))).length
    return { variant: variant.name, top: count("top"), topV1: count("top", "G"), topV2: count("top", "H"), topTaxonomy: count("top", "T"), topAcronyms: count("top", "A"), discoveredTop10: count("discovered"), listed: count("newListed"), prefilled: count("prefilled"), prefilledV2: count("prefilled", "H"), prefilledTaxonomy: count("prefilled", "T"), prefilledAcronyms: count("prefilled", "A") }
  })
  const summary = { scale: label, bases: sources.length, chunks: sources.reduce((sum, source) => sum + source.chunks.length, 0), requiredSections: total, v1: questions.filter((question) => question.id.startsWith("G")).reduce((sum, question) => sum + question.required.length, 0), currentListed: rowsOut.filter((row) => row.variant === VARIANTS[0]!.name && row.currentListed).length, variants, indexing, searchMsMedian: median(searchMs), searchMsMax: Math.max(...searchMs) }
  console.log(JSON.stringify(summary, null, 1))
  return { summary, rows: rowsOut }
}
const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)]!
}

console.log(`corpus real: ${realSources.length} bases; distratoras: ${distractorCount}; modelo ${embeddingModel} em ${embeddingUrl}`)
const real = await measure("REAL", realSources)
const scale = await measure(`ESCALA (+${distractorCount} sintéticas)`, scaleSources)
mkdirSync(path.dirname(outFile), { recursive: true })
console.log(`gasto estimado: US$ ${spentUsd.toFixed(4)}`)
writeFileSync(outFile, `${JSON.stringify({ ranAt: new Date().toISOString(), embeddingModel, estimatedUsd: Number(spentUsd.toFixed(4)), topK: TOP, listLimit: LIST_LIMIT, questions: questions.map((question) => ({ id: question.id, category: question.category, text: question.text })), results: [real, scale] }, null, 2)}\n`)
console.log(`relatório: ${outFile}`)
