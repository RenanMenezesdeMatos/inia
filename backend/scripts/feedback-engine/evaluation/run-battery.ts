/**
 * BATERIA DE AVALIAÇÃO — execução com o MODELO REAL do motor (mesmo gateway e rota da produção), memória em RAM: nada é gravado
 * em banco nenhum. As bases vêm do banco dev em transação SOMENTE-LEITURA (versão publicada atual, pelo título); a chamada é
 * sintética (`cases.ts`). O gabarito não é lido aqui.
 *
 *   npx tsx scripts/feedback-engine/evaluation/run-battery.ts [--only SV1,ND2]   → results/<data>.json
 *   npx tsx scripts/feedback-engine/evaluation/score-battery.ts results/<data>.json
 */
import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../src/modules/qa-lab/application/read-only-database.js"
import { generateFeedback, type GenerateFeedbackDeps } from "../../../src/modules/feedback-engine/application/generate-feedback.js"
import type { AnalyzeCallDeps } from "../../../src/modules/feedback-engine/application/analyze-call.js"
import type { EngineModelPort, EngineModelRequest } from "../../../src/modules/feedback-engine/application/ports.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../../../src/modules/feedback-engine/infrastructure/gateway-engine-model.js"
import { createInMemoryFeedbackMemoryStore } from "../../../src/modules/feedback-engine/infrastructure/in-memory-feedback-memory-store.js"
import type { CandidateDocument } from "../../../src/modules/feedback-engine/domain/document-selection.js"
import { CASES } from "./cases.js"

const here = dirname(fileURLToPath(import.meta.url))
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000e0a01"
const AGENT = "00000000-0000-4000-8000-0000000e0a02"
// Preço cadastrado para o modelo do motor (USD por milhão; raciocínio tarifado como saída) — só para estimar custo.
const PRICE = { input: 0.75, output: 3.75 }
const only = (() => { const index = process.argv.indexOf("--only"); return index >= 0 ? process.argv[index + 1]!.split(",") : null })()

/** Resposta bruta guardada SÓ no artefato da avaliação (diagnóstico de contrato); a produção nunca guarda resposta de modelo. */
type CallRecord = { stage: EngineModelRequest["stage"]; tag: string | null; inputTokens: number | null; outputTokens: number | null; totalTokens: number | null; durationMs: number | null; finishReason: string | null; ok: boolean; error: string | null; response?: string }

try {
  const readDb = createReadOnlyDatabase(pool)
  const loadDocuments = async (titles: string[]): Promise<CandidateDocument[]> => {
    const rows = (await readDb.query<{ id: string; title: string; version: number; content: string; content_hash: string }>(
      `select d.id, d.title, v.version, v.content, v.content_hash from knowledge_documents d
       join lateral (select version, content, content_hash from knowledge_versions where document_id = d.id and status = 'PUBLISHED' order by version desc limit 1) v on true
       where d.organization_id = $1 and d.deleted_at is null and d.title = any($2::text[])`,
      [ORG, titles],
    )).rows
    return rows.map((row) => ({ documentId: row.id, title: row.title, version: row.version, content: row.content, contentHash: row.content_hash, perspective: "RULE_IN_FORCE_AT_CALL" as const }))
  }
  const real = createGatewayEngineModel()
  const results = []
  for (const evaluationCase of CASES.filter((entry) => !only || only.some((prefix) => entry.id.startsWith(prefix)))) {
    const calls: CallRecord[] = []
    const model: EngineModelPort = {
      async generate(request) {
        const started = Date.now()
        try {
          const response = await real.generate(request)
          calls.push({ stage: request.stage, tag: request.tag ?? null, inputTokens: response.usage?.inputTokens ?? null, outputTokens: response.usage?.outputTokens ?? null, totalTokens: response.usage?.totalTokens ?? null, durationMs: response.durationMs ?? Date.now() - started, finishReason: response.finishReason, ok: true, error: null, ...(process.argv.includes("--raw") ? { response: response.text } : {}) })
          return response
        } catch (error) {
          calls.push({ stage: request.stage, tag: request.tag ?? null, inputTokens: null, outputTokens: null, totalTokens: null, durationMs: Date.now() - started, finishReason: null, ok: false, error: (error as Error).message })
          throw error
        }
      },
    }
    const documents = await loadDocuments(evaluationCase.documents)
    const interactionId = createHash("sha256").update(evaluationCase.id).digest("hex").replace(/^(.{8})(.{4})(.{3})(.{3})(.{12}).*$/, "$1-$2-4$3-8$4-$5")
    const transcript = evaluationCase.transcript.join("\n")
    const stores = createInMemoryFeedbackMemoryStore()
    const now = () => new Date()
    const analyze: AnalyzeCallDeps = {
      memory: stores,
      model,
      loadInteraction: async (_org, id) => (id === interactionId ? { id, organizationId: ORG, operatorId: OPERATOR, operatorName: "Operador(a)", startedAt: new Date("2026-09-29T14:00:00Z"), endedAt: new Date("2026-09-29T14:08:00Z"), reason: evaluationCase.reason, channel: "VOICE", subjectCanonical: null, flags: evaluationCase.flags, transcript: { content: transcript, checksum: createHash("sha256").update(transcript).digest("hex").slice(0, 16) }, teamId: null, subteamId: null, supervisorId: null, timeZone: "America/Sao_Paulo" } : null),
      loadAgent: async () => ({ id: AGENT, name: "Especialista de atendimento (avaliação)", objective: "Avaliar o atendimento pelo procedimento da base.", contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
      loadDocuments: async () => documents,
      loadPreviousVersion: async () => null,
      now,
    }
    const deps: GenerateFeedbackDeps = {
      memory: stores, messages: stores, model, analyze,
      investigate: { memory: stores, data: {} as never, analyze, strategy: async () => { throw new Error("não usado na bateria de monitoria") }, now },
      loadDocumentTitles: async () => new Map(documents.map((document) => [document.documentId, document.title])),
      loadAgentConfiguredAt: async () => null,
      now,
    }
    const started = Date.now()
    let error: string | null = null
    let generated: Awaited<ReturnType<typeof generateFeedback>> | null = null
    try {
      generated = await generateFeedback(deps, { organizationId: ORG, enrollmentId: null, workflowId: null, workflowVersionId: null, nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: {}, collaboratorId: OPERATOR, interactionId, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: `Sinal da chamada: ${evaluationCase.flags.map((flag) => `${flag.name} = ${flag.value}`).join(", ")}`, now: new Date() })
    } catch (caught) {
      error = (caught as Error).message
    }
    const assessment = stores.assessments[0] ?? null
    const message = generated ? stores.messages.get(generated.messageId) ?? null : null
    const inputTokens = calls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0)
    const billedOutput = calls.reduce((sum, call) => sum + Math.max(0, (call.totalTokens ?? 0) - (call.inputTokens ?? 0)), 0)
    const result = {
      id: evaluationCase.id,
      error,
      latencyMs: Date.now() - started,
      calls,
      cost: { inputTokens, outputAndReasoningTokens: billedOutput, estimatedUsd: Number(((inputTokens * PRICE.input + billedOutput * PRICE.output) / 1_000_000).toFixed(5)) },
      analysis: assessment ? {
        outcome: assessment.analysis.outcome,
        outcomeReasons: assessment.analysis.outcomeReasons,
        procedure: assessment.analysis.scenario.procedureTitle,
        procedureSelection: assessment.analysis.checks.procedureSelection,
        pathAssessment: assessment.analysis.scenario.pathAssessment,
        declaredPathAssessment: assessment.analysis.scenario.declaredPathAssessment,
        scenario: { customerNeed: assessment.analysis.scenario.customerNeed, correctPath: assessment.analysis.scenario.correctPath, pathTaken: assessment.analysis.scenario.pathTaken, pathRationale: assessment.analysis.scenario.pathRationale },
        coverage: { status: assessment.analysis.coverage.status, missing: assessment.analysis.coverage.missing.length, repairAttempted: assessment.analysis.coverage.repairAttempted },
        criteria: assessment.analysis.criteria.map((criterion) => ({ text: criterion.text, heading: criterion.heading, status: criterion.status, declaredStatus: criterion.declaredStatus, downgrades: criterion.downgrades, evidenceKind: criterion.evidenceKind, evidence: criterion.evidence.map((quote) => `${quote.turn} ${quote.speaker}: ${quote.quote}`), rationale: criterion.rationale, materiality: criterion.materiality, guidance: criterion.guidance, ruleConflict: criterion.ruleConflict, rejectedEvidence: criterion.rejectedEvidence.length })),
        limitations: assessment.analysis.limitations,
      } : null,
      message: generated ? {
        kind: generated.kind,
        reason: generated.kind === "ABSTAINED" ? generated.reason : null,
        tone: message?.brief?.tone ?? null,
        source: message?.message?.source ?? null,
        card: message?.message?.card ?? null,
        paragraphs: message?.message?.paragraphs ?? [],
        developments: message?.brief?.developments.map((finding) => finding.title) ?? [],
        strengths: message?.brief?.strengths.map((finding) => finding.title) ?? [],
        materials: message?.brief?.materials.map((material) => material.title) ?? [],
        composition: message?.composition ?? null,
      } : null,
    }
    results.push(result)
    console.log(`${evaluationCase.id}: ${error ? `ERRO ${error}` : `${result.analysis?.outcome} · caminho ${result.analysis?.pathAssessment} · ${result.message?.kind} (${result.message?.tone ?? result.message?.reason}) · ${calls.length} chamada(s) · ${result.latencyMs} ms · ~US$ ${result.cost.estimatedUsd}`}`)
  }
  mkdirSync(join(here, "results"), { recursive: true })
  const file = join(here, "results", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify({ model: ENGINE_MODEL, ranAt: new Date().toISOString(), cases: results }, null, 2))
  console.log(`\nResultados: ${file}`)
} finally {
  await pool.end()
}
