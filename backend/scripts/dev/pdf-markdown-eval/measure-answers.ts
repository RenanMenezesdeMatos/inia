/**
 * Medição COM IA: mesmas perguntas, mesmos prompts e o mesmo modelo nos dois lados. Só muda o texto da base: extração anterior (texto corrido) × Markdown com páginas.
 * O serviço, o catálogo, a navegação e a validação são os de produção (`createKnowledgeClarification`). Só o envio é direto ao provedor, para haver limite de saída e, com ele, um teto
 * de gasto garantido (`call-budget.ts`): a rota do ambiente não envia limite. Corpus 100% sintético: nenhum manual real nem dado de operação vai para a IA.
 *
 *   # sem IA: confere o que chegaria ao modelo
 *   npx tsx scripts/dev/pdf-markdown-eval/measure-answers.ts <corpus> <saída>
 *   # com IA: exige a chave e a confirmação de que o custo foi autorizado
 *   INIA_PDF_EVAL_PAID=1 GEMINI_API_KEY=… npx tsx scripts/dev/pdf-markdown-eval/measure-answers.ts <corpus> <saída> --run --teto=1
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PDFParse } from "pdf-parse"
import { loadReadableKnowledge, type ReadableKnowledgePorts } from "../../../src/modules/knowledge/application/knowledge-catalog.js"
import { chunkKnowledgeDocument } from "../../../src/modules/knowledge/domain/knowledge-chunking.js"
import { withChunkPages } from "../../../src/modules/knowledge/domain/pdf-markdown/page-map.js"
import { pdfLayoutToMarkdown } from "../../../src/modules/knowledge/domain/pdf-markdown/pdf-markdown.js"
import { readPdfLayout } from "../../../src/modules/knowledge/infrastructure/pdf-layout-reader.js"
import { extractPlainPdfText } from "../../../src/modules/knowledge/infrastructure/text-extractor.js"
import type { ClarificationModel } from "../../../src/modules/knowledge-clarification/application/clarification-model.js"
import { createKnowledgeClarification, type ClarificationOutcome, type ClarificationRequest } from "../../../src/modules/knowledge-clarification/application/knowledge-clarification-service.js"
import { lowReasoningStages } from "../../../src/modules/knowledge-clarification/application/clarification-model.js"
import { createCallBudget, type CallUsage } from "./call-budget.js"
import { GOLD, type GoldQuestion } from "./gold.js"

const MODEL = "gemini-3.8-flash"
/** Preço da tabela `ai_model_pricing` vigente em 06/11/2026 (conferido antes da rodada). */
const PRICE = { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 3.75, reasoningPerMillion: 3.75, currency: "USD" }
const MAX_OUTPUT_TOKENS = 8_192
const TIMEOUT_MS = 90_000
const ORG = "org-avaliacao"
const AGENT = "agente-avaliacao"

const [corpus, outDir] = process.argv.slice(2)
if (!corpus || !outDir) throw new Error("Uso: measure-answers.ts <corpus> <saída> [--run --teto=<usd>]")
const paid = process.argv.includes("--run") && process.env.INIA_PDF_EVAL_PAID === "1"
const cap = Number(process.argv.find((value) => value.startsWith("--teto="))?.slice(7) ?? 0)
const samples = Number(process.argv.find((value) => value.startsWith("--amostras="))?.slice(11) ?? 2)
mkdirSync(outDir, { recursive: true })

/** Só o corpus sintético, uma base por conteúdo: dois PDFs com o mesmo texto fariam a IA perguntar qual dos dois. Os casos sem tags são o lado mais difícil, pela aparência. */
const POOL: Record<string, string> = {
  simples: "Segunda via de fatura",
  "manual-tabelas": "Manual de prazos de reparo",
  "duas-colunas-linha": "Boletim de regras de retenção",
  misto: "Guia de clientes corporativos",
  "manual-chrome-sem-tags": "Manual de cancelamento",
  escaneado: "Regulamento de devolução de equipamentos",
}
const DEFAULT_PICKED = ["S2", "S3", "T1", "T3", "T6", "W1", "W4", "C1", "C3", "H2", "M2", "E1"]
const PICKED = process.argv.find((value) => value.startsWith("--perguntas="))?.slice(12).split(",") ?? DEFAULT_PICKED
/** `--lados=depois` mede só um lado, para comparar com um lado já medido com o mesmo gabarito. */
const ARMS = (process.argv.find((value) => value.startsWith("--lados="))?.slice(8).split(",") ?? ["antes", "depois"]) as ("antes" | "depois")[]
const docOf = (question: GoldQuestion) => (question.doc === "manual-chrome-tags" ? "manual-chrome-sem-tags" : question.doc === "duas-colunas-coluna" ? "duas-colunas-linha" : question.doc)
const questions = PICKED.map((id) => GOLD.find((question) => question.id === id)!).map((question) => ({ ...question, doc: docOf(question) }))

type Arm = "antes" | "depois"
const fold = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()

async function plainPages(buffer: Buffer): Promise<string[]> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    return (await parser.getText({ pageJoiner: "" })).pages.map((page) => page.text)
  } finally {
    await parser.destroy()
  }
}

async function main() {
  const documents = await Promise.all(Object.keys(POOL).map(async (doc) => {
    const buffer = readFileSync(join(corpus!, `${doc}.pdf`))
    const converted = pdfLayoutToMarkdown(await readPdfLayout(buffer))
    return { doc, title: POOL[doc]!, before: await extractPlainPdfText(buffer), after: converted.markdown, extraction: converted.extraction, pages: await plainPages(buffer) }
  }))
  const portsFor = (arm: Arm): ReadableKnowledgePorts => ({
    // Um PDF sem texto não vira base em nenhum dos lados: o upload é recusado.
    snapshot: async () => {
      const usable = documents.filter((document) => (arm === "antes" ? document.before : document.after).trim())
      return {
        documents: usable.map((document) => ({ id: document.doc, title: document.title, versionId: `${document.doc}-${arm}`, documentType: "MANUAL", organizationId: ORG })),
        chunks: usable.flatMap((document) => {
          const content = arm === "antes" ? document.before : document.after
          const chunks = chunkKnowledgeDocument({ id: document.doc, title: document.title, content })
          return arm === "depois" ? withChunkPages(chunks, content, document.extraction) : chunks
        }),
      }
    },
    accessible: async (_organizationId, _viewer, documentIds) => new Set(documentIds),
    glossary: async () => [],
  })

  const budget = paid
    ? createCallBudget({ caps: { maxAttempts: 200, maxTokens: 4_000_000, maxMoney: cap }, limits: { price: PRICE, maxOutputTokens: MAX_OUTPUT_TOKENS, maxAttemptsPerCall: 1 }, ledgerPath: join(outDir!, "livro-caixa.jsonl") })
    : null
  if (paid && (!process.env.GEMINI_API_KEY || !(cap > 0))) throw new Error("Rodada paga exige GEMINI_API_KEY e --teto.")

  type CallLog = { stage: string; correction: boolean; ms: number; usage: CallUsage | null; bytes: number }
  const modelFor = (scenario: string, log: CallLog[], prompts: { system: string; user: string }[]): ClarificationModel => async (input) => {
    prompts.push({ system: input.system, user: input.user })
    if (!budget) return JSON.stringify({ contract: "KNOWLEDGE_CLARIFICATION_PLANNER_V1", decision: "INSUFFICIENT", read: null, pendingReply: null, questionFacts: [], clarification: null, answerEvidence: null, conflicts: [], insufficient: { reason: "ensaio", ask: null } })
    const textBytes = Buffer.byteLength(input.system) + Buffer.byteLength(input.user)
    let usage: CallUsage | null = null
    const started = Date.now()
    try {
      return await budget.runCall({ scenario: `${scenario}:${input.stage}`, textBytes }, async () => {
        const body = JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.user }] }],
          // O mesmo raciocínio por etapa que a produção usa; o limite de saída só existe para o teto ser garantido.
          generationConfig: { responseMimeType: "application/json", maxOutputTokens: MAX_OUTPUT_TOKENS, ...(lowReasoningStages().has(input.stage) ? { thinkingConfig: { thinkingLevel: "low" } } : {}) },
        })
        const response = await budget.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY! }, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
        const json = (await response.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number; candidatesTokenCount?: number }; error?: { message?: string } }
        if (json.usageMetadata) usage = { inputTokens: json.usageMetadata.promptTokenCount ?? 0, cachedTokens: json.usageMetadata.cachedContentTokenCount ?? 0, reasoningTokens: json.usageMetadata.thoughtsTokenCount ?? 0, outputTokens: json.usageMetadata.candidatesTokenCount ?? 0 }
        if (!response.ok) throw new Error(`Provedor respondeu ${response.status}: ${json.error?.message ?? ""}`)
        return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? ""
      }, () => usage)
    } finally {
      log.push({ stage: input.stage, correction: input.correction, ms: Date.now() - started, usage, bytes: textBytes })
    }
  }

  type RunResult = { id: string; arm: Arm; sample: number; kind: string; status: string; outcome: string; answer: string; factsFound: string[]; factsExpected: string[]; correct: boolean; abstained: boolean; sources: { documentId: string; heading: string; pages: { from: number; to: number } | null }[]; rightDocument: boolean; pageCited: boolean; pageVerified: boolean; goldPage: number; steps: number; calls: CallLog[]; ms: number; firstPromptBytes: number; error: string | null }
  const results: RunResult[] = []
  const documentById = new Map(documents.map((document) => [document.doc, document]))
  const outPath = join(outDir!, "respostas.json")

  async function runOne(question: (typeof questions)[number], arm: Arm, sample: number) {
    const log: CallLog[] = []
    const prompts: { system: string; user: string }[] = []
    const ports = portsFor(arm)
    const service = createKnowledgeClarification({ knowledge: (request) => loadReadableKnowledge(request, ports), model: modelFor(`${question.id}:${arm}:${sample}`, log, prompts), guardrails: async () => "", specialistInstructions: async () => "" })
    const base: Omit<ClarificationRequest, "text" | "answer" | "previous"> = { organizationId: ORG, personId: "pessoa-avaliacao", orchestratorAgentId: AGENT, specialistAgentIds: [AGENT], recentTurns: [] }
    const started = Date.now()
    let outcome: ClarificationOutcome | null = null
    let error: string | null = null
    let steps = 0
    try {
      outcome = await service.handle({ ...base, text: question.question, answer: null, previous: null })
      // Se a IA perguntar algo antes de responder, escolhe a opção que aponta para a base certa, como faria quem sabe o que procura. Sem opção assim, para.
      while (outcome.kind === "REPLY" && outcome.state.status === "OPEN" && steps < 2) {
        const step = outcome.state.steps[outcome.state.steps.length - 1]!
        const option = step.options.find((candidate) => candidate.evidence.some((source) => source.documentId === question.doc))
        if (!option) break
        steps += 1
        outcome = await service.handle({ ...base, text: option.label, answer: { clarificationId: outcome.state.id, stepId: step.id, optionIds: [option.id], noneMatched: false, revise: false }, previous: { state: outcome.state, isLatestAssistantMessage: true } })
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure)
    }
    const state = outcome?.kind === "REPLY" ? outcome.state : null
    const answer = outcome?.kind === "REPLY" ? outcome.content : ""
    const haystack = fold(answer)
    const factsFound = question.answerFacts.filter((fact) => haystack.includes(fold(fact)))
    const sources = (state?.sources ?? []).map((source) => ({ documentId: source.documentId, heading: source.heading, pages: source.pages ?? null }))
    const rightDocument = sources.some((source) => source.documentId === question.doc)
    const goldPages = [question.page, ...(question.alsoOnPages ?? [])]
    const pageCited = sources.some((source) => source.documentId === question.doc && source.pages !== null && goldPages.some((page) => page >= source.pages!.from && page <= source.pages!.to))
    // Conferência independente do conversor: o dado está mesmo, no texto daquela página do PDF, em alguma das páginas citadas?
    const pdfPages = documentById.get(question.doc)?.pages ?? []
    const pageVerified = sources.some((source) => {
      if (source.documentId !== question.doc || !source.pages) return false
      for (let page = source.pages.from; page <= source.pages.to; page += 1) {
        const text = fold((pdfPages[page - 1] ?? "").replace(/-\n/g, ""))
        if (question.answerFacts.length > 0 && question.answerFacts.some((fact) => text.includes(fold(fact)))) return true
      }
      return false
    })
    const abstained = state?.status === "INSUFFICIENT" || outcome?.kind === "PASS"
    const correct = question.unanswerable ? !haystack.includes("210") : question.answerFacts.every((fact) => haystack.includes(fold(fact)))
    results.push({ id: question.id, arm, sample, kind: question.kind, status: state?.status ?? outcome?.kind ?? "ERRO", outcome: outcome?.kind ?? "ERRO", answer, factsFound, factsExpected: question.answerFacts, correct, abstained, sources, rightDocument, pageCited, pageVerified, goldPage: question.page, steps, calls: log, ms: Date.now() - started, firstPromptBytes: prompts[0] ? Buffer.byteLength(prompts[0].system) + Buffer.byteLength(prompts[0].user) : 0, error })
    writeFileSync(outPath, JSON.stringify({ model: MODEL, price: PRICE, maxOutputTokens: MAX_OUTPUT_TOKENS, results, budget: budget?.summary() ?? null }, null, 2))
    console.log(`${question.id} ${arm} #${sample}: ${state?.status ?? outcome?.kind ?? "ERRO"} certo=${correct} página=${pageVerified} chamadas=${log.length} ${Math.round((Date.now() - started) / 1000)}s ${budget ? `gasto ${budget.summary().chargedMoney}` : ""}${error ? ` ERRO ${error.slice(0, 120)}` : ""}`)
    return prompts
  }

  if (!paid) {
    for (const arm of ["antes", "depois"] as const) {
      const prompts = await runOne(questions[0]!, arm, 0)
      console.log(`\n=== ${arm}: primeiro prompt ${prompts[0]?.user.length} caracteres no usuário, ${prompts[0]?.system.length} no sistema`)
      console.log(prompts[0]?.system.slice(prompts[0].system.indexOf("[B1]"), prompts[0].system.indexOf("[B1]") + 900))
    }
    console.log("\nNenhuma chamada de IA feita.")
    return
  }

  // A cada pergunta, os dois lados em ordem alternada: o cache do provedor e a variação do dia não favorecem sempre o mesmo.
  outer: for (let sample = 1; sample <= samples; sample += 1) {
    for (const [index, question] of questions.entries()) {
      const order: Arm[] = ((index + sample) % 2 === 0 ? ["antes", "depois"] : ["depois", "antes"]).filter((arm) => ARMS.includes(arm as Arm)) as Arm[]
      for (const arm of order) {
        if (budget!.stopped()) break outer
        await runOne(question, arm, sample)
        if (budget!.stopped()) break outer
      }
    }
  }
  console.log(JSON.stringify(budget!.summary()))
  budget!.release()
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
