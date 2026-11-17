/**
 * VALIDAÇÃO PAGA das respostas do chat com a busca em escala (16/11/2026, teto aprovado US$ 2,00). O serviço REAL do esclarecimento
 * (`createKnowledgeClarification`: catálogo, navegação, prompts, contrato, validação) com o modelo REAL da rota de sempre
 * (KNOWLEDGE_CLARIFICATION, Gemini pela configuração do ambiente), sobre as bases da cópia de medição + as distratoras sintéticas — o
 * pior caso da escala, todas no escopo. Dois caminhos por pergunta, alternando quem vai primeiro:
 *   - DESLIGADA: como a INIA era antes da busca (lista de bases por título, cortada em 120; a IA navega);
 *   - V2: a busca em escala (candidatas primeiro, seções pré-lidas), com o vetor do gemini-embedding-2 (do cache da avaliação de recall).
 * Nada é gravado em banco; guardrails e instruções de especialista ficam vazios nos dois caminhos (são iguais para os dois).
 *
 *   GEMINI_API_KEY=… DATABASE_URL=postgresql://localhost:5432/inia_chatbench KB_EVAL_CACHE=… npx tsx scripts/dev/kb-scale-eval/eval-chat.ts [ids]
 *
 * Gasto: calculado a cada chamada pelo uso devolvido pelo provedor, aos preços da tabela do piloto (gemini-3.8-flash US$ 0,75/M entrada,
 * 0,075/M em cache, 3,75/M saída + raciocínio). Antes de cada turno: gasto + reserva do turno (KB_EVAL_TURN_RESERVE, US$ 0,12) ≤ teto
 * (KB_EVAL_MAX_USD, US$ 1,90). Passou = para e grava o que já rodou.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { withLlmScope } from "../../../src/shared/application/llm-telemetry.js"
import { generateForRoute, routeFor, type GatewayRequest } from "../../../src/shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../src/shared/application/model-routing/token-estimate.js"
import { createGoogleGenAiAdapter } from "../../../src/modules/ai-management/infrastructure/adapters/google-genai-adapter.js"
import { embeddingText } from "../../../src/modules/ai-management/domain/ai-embedding.js"
import { lowReasoningStages, type ClarificationModel } from "../../../src/modules/knowledge-clarification/application/clarification-model.js"
import { createKnowledgeClarification, type ClarificationOutcome } from "../../../src/modules/knowledge-clarification/application/knowledge-clarification-service.js"
import type { ReadableKnowledge, ReadableKnowledgeSource } from "../../../src/modules/knowledge/application/knowledge-catalog.js"
import { createKnowledgeRecall } from "../../../src/modules/knowledge/application/knowledge-recall.js"
import { normalized } from "../../../src/modules/knowledge/domain/vector-math.js"
import { loadRealCorpus, readVectorCache, withDistractors } from "./corpus.js"

const here = path.dirname(fileURLToPath(import.meta.url))
const databaseUrl = process.env.DATABASE_URL ?? ""
const maxUsd = Number(process.env.KB_EVAL_MAX_USD ?? 1.9)
const turnReserve = Number(process.env.KB_EVAL_TURN_RESERVE ?? 0.12)
const cacheDir = process.env.KB_EVAL_CACHE ?? path.join(os.tmpdir(), "inia-kb-scale-eval")
// Fora do repositório: as respostas citam o texto das bases (que pode trazer nome de cliente).
const outFile = process.env.KB_EVAL_OUT ?? path.join(os.homedir(), "Developer/Works/inia-avaliacoes-locais/chat-escala.jsonl")
const EMBEDDING_MODEL = "gemini-embedding-2"
const PRICE = { input: 0.75, cached: 0.075, output: 3.75, embedding: 0.25 }
const ORDER = (process.argv[2] ?? "H01,H02,H03,H04,H05,H06,H07,H08,H09,H10,H11,H12,H13,H14,H15,H16,H17,H18,H19,H20,H21,G05,G07,G08,G09,G10,G14").split(",")

type Fact = { id: string; anyOf: string[] }
type Question = { id: string; text: string; facts?: Fact[] }
const questions = new Map<string, Question>(["gold.json", "gold-v2.json", "gold-v3.json"].flatMap((file) => (JSON.parse(readFileSync(path.join(here, file), "utf8")) as { questions: Question[] }).questions.map((question) => [question.id, question] as const)))

// ---------- gasto ----------
let spentUsd = 0
const usageOf = (usage: { promptTokens: number | null; cachedInputTokens: number | null; outputTokens: number | null; reasoningTokens: number | null }) => {
  const cached = usage.cachedInputTokens ?? 0
  const input = Math.max(0, (usage.promptTokens ?? 0) - cached)
  return ((input * PRICE.input + cached * PRICE.cached + ((usage.outputTokens ?? 0) + (usage.reasoningTokens ?? 0)) * PRICE.output) / 1_000_000)
}

// ---------- modelo (a mesma chamada de `gatewayClarificationModel`, contando o uso) ----------
let turn = { calls: 0, tokens: 0, usd: 0 }
const model: ClarificationModel = async (input) => {
  const route = routeFor({ purpose: "KNOWLEDGE_CLARIFICATION", phase: "KNOWLEDGE", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(input.system, input.user), ...(input.correction ? { previousParseFailure: true } : {}) })
  const lowReasoning = lowReasoningStages().has(input.stage)
  const request: GatewayRequest = {
    classification: { phase: "KNOWLEDGE", purpose: "KNOWLEDGE_CLARIFICATION", source: "CHAT", semanticType: "KNOWLEDGE_CLARIFICATION", tags: [`stage:${input.stage}`, "eval:kb-scale"] },
    systemPrompt: input.system,
    contents: [{ role: "user", text: input.user }],
    tools: [],
    structuredOutput: true,
    transport: { timeoutMs: 120_000 },
    route,
    ...(lowReasoning ? { reasoningEffort: "LOW" as const } : {}),
  }
  const reply = await withLlmScope({ role: "knowledge_clarification", agentId: null }, () => generateForRoute(request))
  const usd = usageOf(reply.usage)
  spentUsd += usd
  turn.calls += 1
  turn.tokens += reply.usage.totalTokens ?? 0
  turn.usd += usd
  return reply.kind === "text" ? reply.text : ""
}

// ---------- corpus e vetores (cache da avaliação de recall) ----------
const corpus = await loadRealCorpus(databaseUrl)
const sources = withDistractors(corpus.sources, 1000)
/** `withProducts`: cada base com o produto cadastrado (o que a lista do chat mostra à IA e o que entra no vetor). */
const knowledgeOf = (withProducts: boolean): ReadableKnowledge => ({ sources: new Map(sources.map((source) => [source.documentId, { ...source, agentIds: ["eval"], ...(withProducts && corpus.products.has(source.documentId) ? { products: corpus.products.get(source.documentId)! } : {}) } as ReadableKnowledgeSource])), excludedByAccess: 0, glossary: corpus.glossary })
const cacheFile = path.join(cacheDir, `${EMBEDDING_MODEL}.jsonl`)
if (!existsSync(cacheFile)) throw new Error(`Cache de vetores ausente (${cacheFile}): rode antes eval-recall.ts com KB_EVAL_EMBEDDING_MODEL=${EMBEDDING_MODEL}.`)
const vectors = await readVectorCache(cacheFile)
const embedder = createGoogleGenAiAdapter()
const connection = { id: "eval", name: "gemini", providerKey: "GOOGLE_GENAI", adapterType: "GOOGLE_GENAI" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiVersion: null, apiKey: process.env.GEMINI_API_KEY ?? null, headers: {}, timeoutMs: 60_000 }
const recall = createKnowledgeRecall({
  embeddingModel: async () => EMBEDDING_MODEL,
  embedQuery: async ({ text }) => {
    spentUsd += (text.length / 4 / 1_000_000) * PRICE.embedding
    return normalized((await embedder.embed!(connection, EMBEDDING_MODEL, { texts: [embeddingText(text)], purpose: "QUERY" }, 60_000)).vectors[0]!)
  },
  loadVectors: async (_organizationId, _modelKey, hashes) => new Map(hashes.flatMap((hash) => (vectors.has(hash) ? [[hash, vectors.get(hash)!] as const] : []))),
  timeoutMs: 30_000,
})

const services = {
  DESLIGADA: createKnowledgeClarification({ knowledge: async () => knowledgeOf(false), model, guardrails: async () => "", specialistInstructions: async () => "" }),
  V2: createKnowledgeClarification({ knowledge: async () => knowledgeOf(false), model, guardrails: async () => "", specialistInstructions: async () => "", recall }),
  V2_PRODUTO: createKnowledgeClarification({ knowledge: async () => knowledgeOf(true), model, guardrails: async () => "", specialistInstructions: async () => "", recall }),
}
/** Os dois caminhos comparados (padrão: desligada × V2). */
const [ARM_A, ARM_B] = (process.env.KB_EVAL_ARMS ?? "DESLIGADA,V2").split(",") as [keyof typeof services, keyof typeof services]

const normalize = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
function summarize(outcome: ClarificationOutcome) {
  if (outcome.kind === "PASS") return { kind: "PASS", reason: outcome.reason, decision: null, content: null, sources: [] as string[] }
  return { kind: "REPLY", reason: null, decision: outcome.state.status, content: outcome.content, sources: [...new Set(outcome.state.sources.map((source) => `${source.documentTitle} · ${source.heading}`))], steps: outcome.state.steps.map((step) => ({ question: step.question, options: step.options.map((option) => option.label) })) }
}

mkdirSync(path.dirname(outFile), { recursive: true })
console.log(`${sources.length} bases; ${ORDER.length} perguntas; teto US$ ${maxUsd}`)
for (const [index, id] of ORDER.entries()) {
  const question = questions.get(id)
  if (!question) throw new Error(`Pergunta ${id} não existe no gabarito.`)
  const arms = index % 2 === 0 ? [ARM_A, ARM_B] : [ARM_B, ARM_A]
  for (const arm of arms) {
    if (spentUsd + turnReserve > maxUsd) {
      console.log(`PARADO antes de ${id}/${arm}: gasto US$ ${spentUsd.toFixed(4)} + reserva ${turnReserve} > teto ${maxUsd}`)
      process.exit(0)
    }
    turn = { calls: 0, tokens: 0, usd: 0 }
    const started = performance.now()
    let outcome: ReturnType<typeof summarize> | { kind: "ERROR"; reason: string }
    let trace: ClarificationOutcome["trace"] | null = null
    try {
      const result = await services[arm].handle({ organizationId: corpus.organizationId, personId: "eval", orchestratorAgentId: "eval", specialistAgentIds: [], text: question.text, answer: null, previous: null, recentTurns: [] })
      outcome = summarize(result)
      trace = result.trace
    } catch (error) {
      outcome = { kind: "ERROR", reason: (error as Error).message.slice(0, 300) }
    }
    const content = "content" in outcome && outcome.content ? normalize(outcome.content) : ""
    const facts = (question.facts ?? []).map((fact) => ({ id: fact.id, found: fact.anyOf.some((option) => content.includes(normalize(option))) }))
    const row = { question: id, arm, text: question.text, ms: Math.round(performance.now() - started), calls: turn.calls, tokens: turn.tokens, usd: Number(turn.usd.toFixed(5)), facts, factsOk: facts.filter((fact) => fact.found).length, factsTotal: facts.length, outcome, trace: trace ? { decision: trace.decision, navigation: trace.navigation, recall: trace.recall ?? null, calls: trace.calls ?? [], issues: trace.issues } : null }
    appendFileSync(outFile, `${JSON.stringify(row)}\n`)
    console.log(`${id} ${arm.padEnd(9)} ${row.factsOk}/${row.factsTotal} ${outcome.kind}${"decision" in outcome && outcome.decision ? `:${outcome.decision}` : ""} ${row.ms} ms US$ ${row.usd} (total ${spentUsd.toFixed(4)})`)
  }
}
console.log(`gasto estimado: US$ ${spentUsd.toFixed(4)}`)
