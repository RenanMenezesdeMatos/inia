/**
 * REPLAY SEM CUSTO da rodada real V8 (02/10): as respostas GRAVADAS da análise e da revisão (cenários A e B) passam de novo pela
 * verificação/decisão e pelo brief do código ATUAL, com o MESMO pedido de cobertura que foi enviado à revisora (lido do pedido
 * gravado). Mostra o efeito das correções feitas DEPOIS da rodada (`REVIEW_FOCUS_AS_SENT_V1`) sobre as mesmas leituras pagas.
 * NÃO é validação com modelo: nenhuma requisição sai (fetch bloqueado) e o texto da mensagem não é regenerado.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-round-v8.ts --artifact results/round-v8-paid-<ts>.json
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-round-v8.ts --artifact results/round-v9-paid-<ts>.json --contract V7
 * (V9: respostas da revisão no contrato V7 — o replay mostra o efeito das correções feitas DEPOIS da rodada V9.)
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { projectTranscript } from "../../../../src/modules/investigation/domain/transcript-projection.js"
import { TRANSCRIPT_MAX_CHARS } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { mergeReviewedLines, parseCallAnalysisResponse, verifyCallAnalysis } from "../../../../src/modules/feedback-engine/domain/call-analysis.js"
import { parseCallReview } from "../../../../src/modules/feedback-engine/domain/call-review.js"
import { selectDocumentsForCall } from "../../../../src/modules/feedback-engine/domain/document-selection.js"
import { buildMonitoringBrief } from "../../../../src/modules/feedback-engine/domain/feedback-brief.js"
import { buildProcedureContext, listContextOf, transcriptStatusOf } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { CALL_ANALYSIS_LOGIC_VERSION } from "../../../../src/modules/feedback-engine/domain/versions.js"
import { loadAgentDocumentsAt, loadInteractionForAnalysis } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import { attachmentArgumentScripts } from "./attachment-argument-scripts.js"

const isDeterminateLike = (status: string) => status === "MET" || status === "NOT_MET" || status === "PARTIAL"
const here = dirname(fileURLToPath(import.meta.url))
const argIndex = process.argv.indexOf("--artifact")
if (argIndex < 0 || !process.argv[argIndex + 1]) throw new Error("--artifact results/round-v8-paid-<ts>.json é obrigatório.")
const contractIndex = process.argv.indexOf("--contract")
const contract = (contractIndex >= 0 ? process.argv[contractIndex + 1] : "LEGACY") as "LEGACY" | "V7"
const artifactPath = join(here, process.argv[argIndex + 1]!)
globalThis.fetch = (async () => {
  throw new Error("REPLAY: nenhuma requisição externa.")
}) as typeof fetch

type Artifact = { sources: { person: { id: string }; agent: { id: string }; calls: Record<"A" | "B", { interactionId: string }> }; responses: { phase: string; stage: string; text: string | null }[] }
const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as Artifact
const prompts = JSON.parse(readFileSync(artifactPath.replace(/\.json$/, ".prompts.json"), "utf8")) as { phase: string; stage: string; text: string }[]
const ORG = "00000000-0000-4000-8000-000000000001"
const readDb = createReadOnlyDatabase(pool)
const out: Record<string, unknown> = { kind: "ZERO_COST_REPLAY_NOT_A_MODEL_VALIDATION", logic: CALL_ANALYSIS_LOGIC_VERSION, artifact: process.argv[argIndex + 1], reviewContract: contract }
try {
  for (const key of ["A", "B"] as const) {
    const interaction = await loadInteractionForAnalysis(readDb, ORG, artifact.sources.calls[key].interactionId)
    if (!interaction?.transcript) throw new Error(`${key}: chamada sem transcrição.`)
    const candidates = await loadAgentDocumentsAt(readDb, ORG, artifact.sources.agent.id, interaction.startedAt)
    const subject = interaction.subjectCanonical?.name ?? interaction.reason
    const selection = selectDocumentsForCall(candidates, { subject, transcript: interaction.transcript.content })
    const context = buildProcedureContext(selection.selected, attachmentArgumentScripts())
    const projection = projectTranscript(interaction.transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
    const transcriptStatus = transcriptStatusOf(projection)
    const analysisText = artifact.responses.find((entry) => entry.phase === key && entry.stage === "CALL_ANALYSIS")?.text
    const reviewText = artifact.responses.find((entry) => entry.phase === key && entry.stage === "CALL_REVIEW")?.text
    const reviewPrompt = prompts.find((entry) => entry.phase === key && entry.stage === "CALL_REVIEW")?.text
    if (!analysisText || !reviewText || !reviewPrompt) throw new Error(`${key}: respostas gravadas ausentes.`)
    const parsed = parseCallAnalysisResponse(analysisText)
    // Resposta gravada sob o prompt de revisão V4: contrato LEGACY (sem leitura da evidência) — o replay mostra só o que o CÓDIGO muda.
    const review = parseCallReview(reviewText, { contract })
    if (!parsed.ok || !review.ok) throw new Error(`${key}: resposta gravada ilegível.`)
    // O MESMO pedido de cobertura enviado à revisora (lido do pedido gravado) — não o que o código atual pediria.
    const sent = JSON.parse(reviewPrompt.split("PROPOSTAS DA ANÁLISE A REVISAR (JSON):")[1]!) as { linesToAssess?: { id: string }[]; exclusions?: { id: string }[]; claims?: { id: string; proposedStatus: "MET" | "NOT_MET" | "PARTIAL"; attention: string[]; rule: Record<string, unknown> }[] }
    const requested = { linesToAssess: (sent.linesToAssess ?? []).map((line) => line.id), linesWithheld: 0, exclusions: (sent.exclusions ?? []).map((entry) => entry.id) }
    // As propostas EXATAMENTE como enviadas (foco e regra do pedido gravado) — `REVIEW_FOCUS_AS_SENT_V2`.
    const sentClaims = (sent.claims ?? []).map((claim) => ({ id: claim.id, status: claim.proposedStatus, focus: claim.attention as never, rule: { conditional: false, sameList: [], section: null, leadIn: null, text: "", ...claim.rule } as never }))
    const merged = mergeReviewedLines(parsed.value, review.review.lines, requested.linesToAssess)
    const result = verifyCallAnalysis({ model: merged, context, projection, transcriptStatus, interactionId: interaction.id, subjectAnchoredDocumentIds: selection.anchoredDocumentIds, repairAttempted: true, review: { attempted: true, review: review.review, error: null, requested, sentClaims } })
    const titles = new Map(context.documents.map((document) => [document.documentId, document.title]))
    const brief = buildMonitoringBrief({ analysis: result, listContext: listContextOf(context), interactionId: interaction.id, label: subject ?? "Atendimento", dateLabel: "—", selectionReason: "replay", criterionKeys: new Map(result.criteria.map((criterion) => [criterion.lineKey, criterion.lineKey])), documentTitles: titles, documentVersions: new Map(), history: new Map(), delivered: new Set() })
    out[key] = {
      path: { proposed: result.scenario.proposedPathAssessment, final: result.scenario.pathAssessment, completeness: result.scenario.pathCompleteness ?? null },
      outsideConversation: result.criteria.filter((criterion) => criterion.observability === "OUTSIDE_CONVERSATION" && isDeterminateLike(criterion.declaredStatus)).map((criterion) => `${criterion.lineHandle} análise ${criterion.declaredStatus} → ${criterion.status} · ${criterion.executionClaim ?? "—"} · ${criterion.downgrades.join("+")} — ${criterion.text.slice(0, 80)}`),
      conditionAsConduct: result.criteria.filter((criterion) => criterion.downgrades.includes("CONDITION_IS_NOT_CONDUCT")).map((criterion) => `${criterion.lineHandle} análise ${criterion.declaredStatus} → ${criterion.status} — ${criterion.text.slice(0, 90)}`),
      decided: result.criteria.filter((criterion) => ["MET", "NOT_MET", "PARTIAL"].includes(criterion.status)).map((criterion) => `${criterion.lineHandle} ${criterion.status} ${criterion.confirmation} — ${criterion.text.slice(0, 90)}`),
      dropped: result.criteria.filter((criterion) => ["NOT_MET", "PARTIAL"].includes(criterion.proposedStatus) && criterion.status === "NOT_OBSERVABLE").map((criterion) => `${criterion.lineHandle} ${criterion.proposedStatus}→${criterion.status} ${criterion.confirmationReasons.join("+")} — ${criterion.text.slice(0, 90)}`),
      // Achados SÓ da revisão: antes descartados por origem (`SINGLE_PASS_REPAIR`); agora pendentes de confirmação focal (o replay não
      // tem resposta paga de confirmação — fica PENDING_CONFIRMATION, nunca aceito nem descartado).
      reviewDiscoveries: { summary: result.checks.review.discoveries ?? null, pending: result.criteria.filter((criterion) => criterion.confirmationReasons.includes("PENDING_CONFIRMATION")).map((criterion) => `${criterion.lineHandle} ${criterion.proposedStatus} [${criterion.materiality}] — ${criterion.text.slice(0, 90)}`), notPrioritized: result.criteria.filter((criterion) => criterion.confirmationReasons.includes("REVIEW_DISCOVERY_NOT_PRIORITIZED")).length },
      brief: { tone: brief.tone, developments: brief.developments.map((finding) => `${finding.ref} ${finding.title} [${finding.status}${finding.ruleBasis ? ` · ${finding.ruleBasis}` : ""}] ${finding.quotes.map((quote) => quote.text).join(" / ").slice(0, 160)}`), strengths: brief.strengths.map((finding) => `${finding.ref} ${finding.title}`), openPoints: (brief.openPoints ?? []).map((point) => point.title) },
    }
  }
} finally {
  await pool.end()
}
const round = /round-(v\d+)-paid/.exec(process.argv[argIndex + 1]!)?.[1] ?? "v8"
const target = join(here, "results", `replay-round-${round}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(target, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
console.log(`\nArtefato: ${target}`)
