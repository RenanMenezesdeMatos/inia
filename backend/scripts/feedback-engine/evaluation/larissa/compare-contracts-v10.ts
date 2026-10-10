/**
 * COMPARAÇÃO FOCAL DE CONTRATOS (rodada V10, 02/10/2026) — mesmo modelo, mesmos parâmetros efetivos, MESMA ENTRADA.
 *
 *   Referência (contrato atual, `CALL_ANALYSIS_PROMPT_V7`): as respostas JÁ PAGAS da rodada V9 (C07 e DEMO-INT-0001-08) — não é
 *   comparação estatística: uma resposta de cada lado, por chamada.
 *   Alternativa (`CALL_ANALYSIS_PROMPT_V8`, contrato `OBLIGATIONS_V1`): a MESMA mensagem do usuário da V9, byte a byte (transcrição,
 *   fontes congeladas, argumentários em reavaliação, orientação da operação) — só as instruções e o schema mudam.
 *   Mais o CASO SINTÉTICO de paráfrases (outro serviço, outras palavras), no contrato alternativo.
 *
 * O gabarito (V9 revisado e o sintético) nunca entra no pedido. Orçamento: o livro-razão GLOBAL da tarefa (`round-v10-budget.ts`).
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/compare-contracts-v10.ts                                → ENSAIO (zero requisição)
 *   npx tsx scripts/feedback-engine/evaluation/larissa/compare-contracts-v10.ts --execute --authorized-by-user → PAGO (3 requisições)
 */
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { generateForRoute } from "../../../../src/shared/application/model-routing/llm-gateway.js"
import { projectTranscript, type ProjectedInteraction } from "../../../../src/modules/investigation/domain/transcript-projection.js"
import { analysisKeysOf, TRANSCRIPT_MAX_CHARS } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { verifyQuotes } from "../../../../src/modules/feedback-engine/domain/call-analysis.js"
import { CALL_ANALYSIS_SYSTEM_PROMPT, renderCallAnalysisUserTurn } from "../../../../src/modules/feedback-engine/domain/call-analysis-prompt.js"
import { selectDocumentsForCall } from "../../../../src/modules/feedback-engine/domain/document-selection.js"
import { OBLIGATION_ANALYSIS_PROMPT_VERSION, OBLIGATION_ANALYSIS_RESPONSE_SCHEMA, OBLIGATION_ANALYSIS_SYSTEM_PROMPT } from "../../../../src/modules/feedback-engine/domain/obligation-analysis-prompt.js"
import { parseObligationAnalysisResponse } from "../../../../src/modules/feedback-engine/domain/obligation-analysis.js"
import { buildProcedureContext, transcriptStatusOf, type ProcedureContext } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { loadAgentDocumentsAt, loadInteractionForAnalysis } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import type { EngineModelRequest } from "../../../../src/modules/feedback-engine/application/ports.js"
import { attachmentArgumentScripts } from "./attachment-argument-scripts.js"
import { loadFrozenSources } from "./frozen-call.js"
import { openRoundV10Budget } from "./round-v10-budget.js"
import { SYNTHETIC_DOCUMENT_ID, SYNTHETIC_PROCEDURE, SYNTHETIC_SUBJECT, SYNTHETIC_TRANSCRIPT } from "./synthetic-paraphrase-case.js"

const here = dirname(fileURLToPath(import.meta.url))
const execute = process.argv.includes("--execute")
if (execute && !process.argv.includes("--authorized-by-user")) throw new Error("Comparação paga só com autorização explícita do usuário (--authorized-by-user).")
if (execute && readdirSync(join(here, "results")).some((name) => name.startsWith("round-v10-comparison-paid-"))) throw new Error("Comparação V10 já executada: não repita para escolher outra resposta.")
const V9 = "results/round-v9-paid-2026-10-02T13-39-47-453Z"
const sha = (value: string) => createHash("sha256").update(value).digest("hex")
const realFetch = globalThis.fetch
if (!execute) globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
  if (/generativelanguage|anthropic|openai|x\.ai/.test(url)) throw new Error(`ENSAIO: requisição a ${new URL(url).host} bloqueada.`)
  return realFetch(input, init)
}) as typeof fetch

const readDb = createReadOnlyDatabase(pool)
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const v9Prompts = JSON.parse(readFileSync(join(here, `${V9}.prompts.json`), "utf8")) as { phase: string; stage: string; text: string }[]
const v9Report = JSON.parse(readFileSync(join(here, `${V9}.json`), "utf8")) as { responses: { phase: string; stage: string; text: string | null; usage: unknown }[]; budget: { ledger: { label: string; spentUsd: number; promptTokens: number; outputTokens: number; thoughtsTokens: number }[] } }
const report: Record<string, unknown> = { kind: execute ? "PAID_CONTRACT_COMPARISON_V10" : "DRY_RUN_CONTRACT_COMPARISON_V10", ranAt: new Date().toISOString(), model: ENGINE_MODEL, reference: { contract: "CALL_ANALYSIS_PROMPT_V7", source: `${V9}.json (respostas pagas da rodada V9 — reaproveitadas, não refeitas)` }, alternative: { contract: OBLIGATION_ANALYSIS_PROMPT_VERSION, systemPromptSha256: sha(OBLIGATION_ANALYSIS_SYSTEM_PROMPT), systemPromptChars: OBLIGATION_ANALYSIS_SYSTEM_PROMPT.length, schemaSha256: sha(JSON.stringify(OBLIGATION_ANALYSIS_RESPONSE_SCHEMA)), schemaChars: JSON.stringify(OBLIGATION_ANALYSIS_RESPONSE_SCHEMA).length }, groundTruth: { real: { file: "round-v9-ground-truth.md", sha256: sha(readFileSync(join(here, "round-v9-ground-truth.md"), "utf8")) }, synthetic: { file: "round-v10-synthetic-ground-truth.md", sha256: sha(readFileSync(join(here, "round-v10-synthetic-ground-truth.md"), "utf8")) }, sentToModel: false } }
const prompts: { key: string; chars: number; text: string }[] = []
const opened = execute ? openRoundV10Budget("compare-contracts-v10", realFetch) : null
if (opened) globalThis.fetch = opened.budget.fetch

/** Integridade (código, sem interpretar sentido): fontes apresentadas e citações literais por turno/falante. */
function integrityOf(text: string, context: ProcedureContext, projection: ReturnType<typeof projectTranscript>) {
  const parsed = parseObligationAnalysisResponse(text)
  if (!parsed.ok) return { parse: parsed.error }
  const interactions = new Map<string, ProjectedInteraction>([["I1", { interactionRef: "I1", interactionId: "x", projection }]])
  const unknownSources = parsed.value.obligations.flatMap((obligation) => obligation.sources.filter((handle) => !context.lines.has(handle)).map((handle) => `${obligation.id}:${handle}`))
  const quotes = parsed.value.obligations.flatMap((obligation) => obligation.evidence.map((quote) => ({ obligation: obligation.id, quote })))
  const verified = verifyQuotes(quotes.map((entry) => entry.quote), interactions, projection)
  return {
    parse: "OK",
    obligations: parsed.value.obligations.length,
    findings: Object.fromEntries(["MET", "NOT_MET", "PARTIAL", "NOT_VERIFIABLE", "NOT_APPLICABLE"].map((finding) => [finding, parsed.value.obligations.filter((obligation) => obligation.finding === finding).length])),
    notAssessed: parsed.value.notAssessed.length,
    unknownSources,
    quotes: { total: quotes.length, verified: verified.verified.length, rejected: verified.rejected },
    contractViolations: parsed.value.contractViolations,
  }
}

try {
  const real = createGatewayEngineModel({ generate: (request) => generateForRoute({ ...request, transport: { ...request.transport, retries: 0 } }) })
  const frozen = await loadFrozenSources(readDb, "C07")
  const org = frozen.org
  const scripts = attachmentArgumentScripts()
  const bRow = (await readDb.query<{ id: string }>(`select id from interactions where organization_id = $1 and operator_id = $2 and external_id = $3`, [org, frozen.person.id, "DEMO-INT-0001-08"])).rows
  if (bRow.length !== 1) throw new Error("DEMO-INT-0001-08: chamada da Larissa ausente ou ambígua.")
  const cases: { key: "A" | "B"; interactionId: string; v9Index: number; selectionReason: string }[] = [
    { key: "A", interactionId: frozen.interaction.id, v9Index: v9Prompts.findIndex((entry) => entry.phase === "A" && entry.stage === "CALL_ANALYSIS"), selectionReason: "Avaliação real V9 (cenário A): contestação de cobrança após cancelamento." },
    { key: "B", interactionId: bRow[0]!.id, v9Index: v9Prompts.findIndex((entry) => entry.phase === "B" && entry.stage === "CALL_ANALYSIS"), selectionReason: "Avaliação real V9 (cenário B): segunda via com argumentário aplicável." },
  ]
  const requests: { key: string; request: EngineModelRequest; context: ProcedureContext; projection: ReturnType<typeof projectTranscript> }[] = []
  const reproduction: Record<string, unknown> = {}
  for (const entry of cases) {
    const interaction = await loadInteractionForAnalysis(readDb, org, entry.interactionId)
    if (!interaction?.transcript || interaction.operatorId !== frozen.person.id) throw new Error(`${entry.key}: chamada sem transcrição ou de outra pessoa.`)
    const candidates = await loadAgentDocumentsAt(readDb, org, frozen.agent.id, interaction.startedAt)
    for (const known of frozen.selection.knowledge) if (!candidates.some((document) => document.documentId === known.documentId && document.contentHash === known.contentHash)) throw new Error(`Base ${known.documentId} difere da congelada — nada executado.`)
    const subject = interaction.subjectCanonical?.name ?? interaction.reason
    const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript.content })
    const context = buildProcedureContext(selection.selected, scripts)
    const projection = projectTranscript(interaction.transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
    const transcriptStatus = transcriptStatusOf(projection)
    // A MESMA mensagem do usuário da V9 (lida do pedido pago gravado) — e a conferência de que o motor atual a reproduz.
    const v9Text = v9Prompts[entry.v9Index]!.text
    const splitAt = v9Text.indexOf("ESPECIALISTA CONFIGURADO:")
    const v9System = v9Text.slice(0, splitAt).replace(/\n\n$/, "")
    const v9UserTurn = v9Text.slice(splitAt)
    const keys = analysisKeysOf({ interaction, agent: frozen.agent, documents: selection.selected, context, projection, transcriptStatus, subject })
    const rendered = renderCallAnalysisUserTurn({ specialist: keys.specialist, interaction: keys.interactionView(entry.selectionReason), projection, transcriptStatus, context })
    reproduction[entry.key] = { v9SystemIsCurrentV7: v9System === CALL_ANALYSIS_SYSTEM_PROMPT, userTurnReproducedByCurrentEngine: rendered === v9UserTurn, userTurnSha256: sha(v9UserTurn), userTurnChars: v9UserTurn.length, transcriptStatus }
    requests.push({ key: `ALT-${entry.key}`, context, projection, request: { stage: "CALL_ANALYSIS", systemPrompt: OBLIGATION_ANALYSIS_SYSTEM_PROMPT, contents: [{ role: "user", text: v9UserTurn }], responseSchema: OBLIGATION_ANALYSIS_RESPONSE_SCHEMA, tag: "analysis:obligations" } })
  }
  // Caso sintético: mesmo renderizador do motor, sem especialista (outro serviço), sem argumentários.
  const synContext = buildProcedureContext([{ documentId: SYNTHETIC_DOCUMENT_ID, title: "Procedimento — Reagendamento de visita técnica", version: 1, content: SYNTHETIC_PROCEDURE, contentHash: sha(SYNTHETIC_PROCEDURE), perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 1 }])
  const synProjection = projectTranscript(SYNTHETIC_TRANSCRIPT)
  const synTurn = renderCallAnalysisUserTurn({ specialist: null, interaction: { dateLabel: "15/09/2026 às 10:00", channel: "VOICE", subject: SYNTHETIC_SUBJECT, durationSeconds: 240, signals: [], selectionReason: "Monitoria de rotina." }, projection: synProjection, transcriptStatus: transcriptStatusOf(synProjection), context: synContext })
  requests.push({ key: "SYN-ALT", context: synContext, projection: synProjection, request: { stage: "CALL_ANALYSIS", systemPrompt: OBLIGATION_ANALYSIS_SYSTEM_PROMPT, contents: [{ role: "user", text: synTurn }], responseSchema: OBLIGATION_ANALYSIS_RESPONSE_SCHEMA, tag: "analysis:obligations:synthetic" } })
  report.reproduction = reproduction

  const results: Record<string, unknown> = {}
  for (const { key, request, context, projection } of requests) {
    const text = `${request.systemPrompt}\n\n${request.contents[0]!.text}`
    prompts.push({ key, chars: text.length, text })
    if (!execute) {
      results[key] = { chars: text.length, estimatedInputTokens: Math.ceil(text.length / 3) }
      continue
    }
    opened!.budget.setLabel(`V10 comparação · ${key}`)
    try {
      const response = await real.generate(request)
      results[key] = { text: response.text, usage: response.usage, finishReason: response.finishReason, model: response.model, durationMs: response.durationMs, integrity: integrityOf(response.text, context, projection) }
    } catch (error) {
      results[key] = { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }
    }
  }
  report.results = results
  // Referência V9 (já paga): tamanho, uso e custo das análises do contrato atual.
  report.referenceUsage = v9Report.budget.ledger.filter((entry) => entry.label.includes("CALL_ANALYSIS")).map((entry) => ({ label: entry.label, spentUsd: entry.spentUsd, promptTokens: entry.promptTokens, outputTokens: entry.outputTokens, thoughtsTokens: entry.thoughtsTokens }))
} catch (error) {
  report.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
} finally {
  if (opened) report.budget = { ledger: opened.budget.ledger, globalAfter: opened.persist() }
  await pool.end()
}
const out = join(here, "results", `round-v10-comparison-${execute ? "paid" : "dry-run"}-${stamp}.json`)
writeFileSync(out, JSON.stringify(report, null, 2))
writeFileSync(out.replace(/\.json$/, ".prompts.json"), JSON.stringify(prompts, null, 2))
console.log(JSON.stringify({ kind: report.kind, error: report.error ?? null, reproduction: report.reproduction, results: Object.fromEntries(Object.entries((report.results ?? {}) as Record<string, Record<string, unknown>>).map(([key, value]) => [key, { chars: value.chars, error: value.error, finishReason: value.finishReason, usage: value.usage, integrity: value.integrity }])), budget: (report.budget as { globalAfter?: unknown } | undefined)?.globalAfter ?? null }, null, 2))
console.log(`\nArtefato: ${out}`)
