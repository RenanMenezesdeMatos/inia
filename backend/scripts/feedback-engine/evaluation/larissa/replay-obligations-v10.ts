/**
 * REPLAY SEM CUSTO (rodada V10): as respostas PAGAS da comparação de contratos (`OBLIGATIONS_V1`) passam pela verificação do código
 * ATUAL (`verifyObligationAnalysis`, passagem preliminar — sem revisão) e pelo brief. Mostra o que o CÓDIGO faz com as leituras do
 * modelo (papel dos trechos, partes, onde o cumprimento acontece, cobertura). NÃO é validação com modelo: nenhuma requisição sai.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-obligations-v10.ts --artifact results/round-v10-comparison-paid-<ts>.json
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { projectTranscript } from "../../../../src/modules/investigation/domain/transcript-projection.js"
import { TRANSCRIPT_MAX_CHARS } from "../../../../src/modules/feedback-engine/application/analyze-call.js"
import { selectDocumentsForCall } from "../../../../src/modules/feedback-engine/domain/document-selection.js"
import { parseObligationAnalysisResponse } from "../../../../src/modules/feedback-engine/domain/obligation-analysis.js"
import { verifyObligationAnalysis } from "../../../../src/modules/feedback-engine/domain/obligation-verification.js"
import { buildProcedureContext, transcriptStatusOf } from "../../../../src/modules/feedback-engine/domain/procedure.js"
import { loadAgentDocumentsAt, loadInteractionForAnalysis } from "../../../../src/modules/feedback-engine/infrastructure/postgres-engine-loaders.js"
import { attachmentArgumentScripts } from "./attachment-argument-scripts.js"
import { loadFrozenSources } from "./frozen-call.js"
import { SYNTHETIC_DOCUMENT_ID, SYNTHETIC_PROCEDURE, SYNTHETIC_TRANSCRIPT } from "./synthetic-paraphrase-case.js"

const here = dirname(fileURLToPath(import.meta.url))
const argIndex = process.argv.indexOf("--artifact")
if (argIndex < 0 || !process.argv[argIndex + 1]) throw new Error("--artifact results/round-v10-comparison-paid-<ts>.json é obrigatório.")
globalThis.fetch = (async () => {
  throw new Error("REPLAY: nenhuma requisição externa.")
}) as typeof fetch
const artifact = JSON.parse(readFileSync(join(here, process.argv[argIndex + 1]!), "utf8")) as { results: Record<string, { text?: string }> }
const readDb = createReadOnlyDatabase(pool)
const out: Record<string, unknown> = { kind: "ZERO_COST_REPLAY_NOT_A_MODEL_VALIDATION", stage: "PRELIMINARY_VERIFICATION_WITHOUT_REVIEW", artifact: process.argv[argIndex + 1] }
try {
  const frozen = await loadFrozenSources(readDb, "C07")
  const bRow = (await readDb.query<{ id: string }>(`select id from interactions where organization_id = $1 and operator_id = $2 and external_id = $3`, [frozen.org, frozen.person.id, "DEMO-INT-0001-08"])).rows[0]!
  const cases = [{ key: "ALT-A", interactionId: frozen.interaction.id }, { key: "ALT-B", interactionId: bRow.id }]
  const views: Record<string, unknown> = {}
  const describe = (result: ReturnType<typeof verifyObligationAnalysis>) => ({
    outcome: `${result.outcome} ${result.outcomeReasons.join("+")}`,
    path: `${result.scenario.declaredPathAssessment} → ${result.scenario.proposedPathAssessment}`,
    coverage: result.coverage.byStatus,
    violations: result.checks.contractViolations,
    criteria: result.criteria.map((criterion) => `${criterion.lineHandle} [${criterion.origin}] ${criterion.declaredStatus}→${criterion.proposedStatus}${criterion.downgrades.length > 0 ? ` (${criterion.downgrades.join("+")})` : ""} · ${criterion.observability ?? "—"} · ${criterion.materiality}/${criterion.scenarioRole ?? "—"} — ${criterion.titleText ?? criterion.text.slice(0, 80)} [${(criterion.sources ?? []).map((source) => source.handle).join(",")}]`),
  })
  for (const entry of cases) {
    const interaction = await loadInteractionForAnalysis(readDb, frozen.org, entry.interactionId)
    if (!interaction?.transcript) throw new Error(`${entry.key}: sem transcrição.`)
    const candidates = await loadAgentDocumentsAt(readDb, frozen.org, frozen.agent.id, interaction.startedAt)
    const selection = selectDocumentsForCall(candidates, { subject: interaction.subjectCanonical?.name ?? interaction.reason, transcript: interaction.transcript.content })
    const context = buildProcedureContext(selection.selected, attachmentArgumentScripts())
    const projection = projectTranscript(interaction.transcript.content, { maxChars: TRANSCRIPT_MAX_CHARS })
    const parsed = parseObligationAnalysisResponse(artifact.results[entry.key]!.text!)
    if (!parsed.ok) throw new Error(`${entry.key}: ${parsed.error}`)
    views[entry.key] = describe(verifyObligationAnalysis({ model: parsed.value, context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: interaction.id, subjectAnchoredDocumentIds: selection.anchoredDocumentIds }))
  }
  const synContext = buildProcedureContext([{ documentId: SYNTHETIC_DOCUMENT_ID, title: "Procedimento — Reagendamento de visita técnica", version: 1, content: SYNTHETIC_PROCEDURE, contentHash: "syn", perspective: "RULE_IN_FORCE_AT_CALL", selection: "INCLUDED_ALL", relevance: 1 }])
  const synProjection = projectTranscript(SYNTHETIC_TRANSCRIPT)
  const synParsed = parseObligationAnalysisResponse(artifact.results["SYN-ALT"]!.text!)
  if (synParsed.ok) views["SYN-ALT"] = describe(verifyObligationAnalysis({ model: synParsed.value, context: synContext, projection: synProjection, transcriptStatus: transcriptStatusOf(synProjection), interactionId: "synthetic", subjectAnchoredDocumentIds: [] }))
  out.views = views
} finally {
  await pool.end()
}
const target = join(here, "results", `replay-obligations-v10-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(target, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2))
console.log(`\nArtefato: ${target}`)
