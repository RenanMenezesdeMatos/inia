import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { classifyExecutionError } from "../../../shared/domain/execution-failure.js"
import { decideNodeRetry } from "../../workflows/domain/node-retry-policy.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { parseCallAnalysisResponse } from "../domain/call-analysis.js"
import { buildProcedureContext, transcriptStatusOf } from "../domain/procedure.js"
import { checkpointOf, LEGACY_REVIEW_UNAVAILABLE } from "../domain/analysis-recovery.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import type { InteractionForAnalysis } from "../infrastructure/postgres-engine-loaders.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { CHECKLIST_ID, CHECKLIST_V1, DOC_ID, INTERACTION_ID, PROCEDURE_V1, sourceDocuments, TRANSCRIPT } from "../testing/fixtures.js"
import { catalogRunner, investigationOf, ok, request as investigationRequest, setup as investigationSetup, CALLS } from "../testing/investigation-world.js"
import { AnalysisInProgressError, analyzeCall, CallReviewPendingError, legacyAnalysisKeyOf, reviewAnalysis, TRANSCRIPT_MAX_CHARS, type AnalyzeCallDeps, type AnalyzeCallRequest } from "./analyze-call.js"
import { EngineMeter, meteredModel } from "./engine-meter.js"
import { generateFeedback, type GenerateFeedbackDeps, type GenerateFeedbackRequest } from "./generate-feedback.js"
import { investigateIndicator, InvestigationAnalysisPendingError } from "./investigate-indicator.js"
import type { EngineModelPort, EngineModelRequest } from "./ports.js"

/**
 * RECUPERAÇÃO DE FALHA TEMPORÁRIA DA REVISÃO — modelo FALSO, zero IA.
 *
 * DEFEITO REPRODUZIDO (antes desta versão): análise ok → revisão com timeout (inclusive a nova tentativa) → execução CONCLUÍDA
 * como INSUFFICIENT_EVIDENCE/REVIEW_UNAVAILABLE → na execução seguinte, com o provedor recuperado, o motor REUTILIZAVA o resultado
 * inconclusivo e nenhuma revisão nova era tentada.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "00000000-0000-4000-8000-0000000000aa"
const AGENT = "00000000-0000-4000-8000-00000000a001"
const timeout = () => new DomainError("tempo esgotado", "AI_PROVIDER_TIMEOUT", 504, { category: "TIMEOUT" })

/** Modelo cujo PROVEDOR está fora para a revisão nas primeiras `reviewFailures` tentativas (as outras etapas respondem). */
function flaky(reviewFailures: number, options: Parameters<typeof fakeEngineModel>[0] = {}) {
  const fake = fakeEngineModel(options)
  const attempts: EngineModelRequest[] = []
  let reviews = 0
  let down = reviewFailures
  const model: EngineModelPort = {
    async generate(request) {
      attempts.push(request)
      if (request.stage === "CALL_REVIEW") {
        reviews += 1
        if (reviews <= down) throw timeout()
      }
      return fake.model.generate(request)
    },
  }
  return { model, attempts, stages: () => attempts.map((request) => request.stage), recover: () => (down = 0), fail: (count: number) => (down = reviews + count) }
}

function setup(model: EngineModelPort, overrides: { transcript?: string | null; checksum?: string } = {}) {
  const stores = createInMemoryFeedbackMemoryStore()
  const interaction = (): InteractionForAnalysis => ({ id: INTERACTION_ID, organizationId: ORG, operatorId: OPERATOR, operatorName: "Ana", startedAt: new Date("2026-09-20T13:00:00Z"), endedAt: new Date("2026-09-20T13:06:00Z"), reason: "Segunda via", channel: "VOICE", subjectCanonical: null, flags: [], transcript: overrides.transcript === null ? null : { content: overrides.transcript ?? TRANSCRIPT, checksum: overrides.checksum ?? "abc" }, teamId: "t1", subteamId: null, supervisorId: null, timeZone: "America/Fortaleza" })
  const analyze: AnalyzeCallDeps = {
    memory: stores,
    model,
    loadInteraction: async () => interaction(),
    loadAgent: async () => ({ id: AGENT, name: "Especialista de 2ª via", objective: null, contextPrompt: null, updatedAt: new Date("2026-09-01T00:00:00Z"), businessDomainId: null }),
    loadDocuments: async () => [
      { documentId: DOC_ID, title: "Procedimento — Segunda via de conta", version: 1, content: PROCEDURE_V1, contentHash: "h1", perspective: "RULE_IN_FORCE_AT_CALL" as const },
      { documentId: CHECKLIST_ID, title: "Checklist de Encerramento de Chamada", version: 1, content: CHECKLIST_V1, contentHash: "h2", perspective: "RULE_IN_FORCE_AT_CALL" as const },
    ],
    loadPreviousVersion: async () => null,
    now: () => new Date("2026-09-30T12:00:00Z"),
  }
  const deps: GenerateFeedbackDeps = { memory: stores, messages: stores, model, analyze, investigate: {} as never, loadDocumentTitles: async () => new Map([[DOC_ID, "Procedimento — Segunda via de conta"]]), loadAgentConfiguredAt: async () => null, now: analyze.now }
  return { stores, analyze, deps }
}
const analysisRequest = (selectionReason = "Sinal: nota_ura = 2"): AnalyzeCallRequest => ({ organizationId: ORG, interactionId: INTERACTION_ID, collaboratorId: OPERATOR, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason } })
const messageRequest = (overrides: Partial<GenerateFeedbackRequest> = {}): GenerateFeedbackRequest => ({ organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf-1", workflowVersionId: "v-1", nodeId: "feedback", sourceNodeId: "agent", domain: "MONITORING", sourceNodeOutput: { kind: "monitoring" }, collaboratorId: OPERATOR, interactionId: INTERACTION_ID, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "Sinal: nota_ura = 2", now: new Date("2026-09-30T12:00:00Z"), ...overrides })

describe("DEFEITO REPRODUZIDO: revisão com timeout não vira resultado definitivo; a recuperação refaz SÓ a revisão", () => {
  it("análise ok → revisão com timeout (e a nova tentativa) → SUSPENSA, nada na memória → provedor recuperado → só a revisão é refeita", async () => {
    const provider = flaky(2)
    const meter = new EngineMeter({ maxModelCalls: 20, maxInputTokens: 10_000_000, maxOutputTokens: 10_000_000, maxCostUsd: null, maxDurationMs: 600_000, transientRetries: 1 })
    const { stores, analyze } = setup(meteredModel(provider.model, meter))

    // 1–3. A análise produziu propostas; a revisão sofreu timeout, inclusive a nova tentativa do medidor.
    await expect(analyzeCall(analyze, analysisRequest())).rejects.toBeInstanceOf(CallReviewPendingError)
    expect(provider.stages()).toEqual(["CALL_ANALYSIS", "CALL_REVIEW", "CALL_REVIEW"])
    const run = [...stores.runs.values()][0]!
    expect(run.status).toBe("FAILED")
    expect(checkpointOf(run.result)).toMatchObject({ stage: "REVIEW_PENDING", reason: "TECHNICAL", error: "AI_PROVIDER_TIMEOUT", reviewAttempts: 1 })
    // A proveniência e a resposta da análise ficam guardadas; NADA vai para a memória da investigação e da liderança.
    expect((run.provenance as { modelResponses: { analysis: { text: string } } }).modelResponses.analysis.text.length).toBeGreaterThan(100)
    expect(stores.assessments).toHaveLength(0)
    expect(await stores.findCompletedByReuseKey(ORG, "CALL_ANALYSIS", run.analysisKey)).toBeNull()
    expect(await stores.pendingReviewInteractions(ORG, [INTERACTION_ID])).toEqual(new Set([INTERACTION_ID]))

    // 4–5. Execução seguinte, provedor recuperado: NÃO reutiliza um inconclusivo — retoma a MESMA execução e paga só a revisão.
    provider.recover()
    const recovered = await analyzeCall(analyze, analysisRequest())
    expect(provider.stages().slice(3)).toEqual(["CALL_REVIEW"])
    expect(recovered).toMatchObject({ runId: run.id, reused: false, outcome: "USABLE" })
    expect(stores.assessments).toHaveLength(1)
    expect((stores.runs.get(run.id)!.provenance as { stageReuse: unknown }).stageReuse).toMatchObject({ analysis: { reused: true, fromRunId: run.id }, review: { reused: false } })
    expect(await stores.pendingReviewInteractions(ORG, [INTERACTION_ID])).toEqual(new Set())
    // Concluída de verdade: a próxima execução reaproveita sem modelo.
    await analyzeCall(analyze, analysisRequest("outro gatilho"))
    expect(provider.stages()).toHaveLength(4)
  })

  it("falha temporária segue a política do motor (nova tentativa com intervalo, com limite) — e a mensagem NÃO fica presa numa abstenção", async () => {
    const provider = flaky(1)
    const { stores, deps } = setup(provider.model)
    const pending = await generateFeedback(deps, messageRequest()).catch((error: unknown) => error)
    expect(pending).toBeInstanceOf(CallReviewPendingError)
    const classified = classifyExecutionError(pending)
    expect(classified.category).toBe("TRANSIENT_PROVIDER_ERROR")
    expect(decideNodeRetry(classified.category, 0, new Date("2026-09-30T12:00:00Z"))).toMatchObject({ willRetry: true, retryReason: "TRANSIENT_PROVIDER_ERROR" })
    expect(decideNodeRetry(classified.category, 4, new Date("2026-09-30T12:00:00Z"))).toMatchObject({ willRetry: false, retryReason: "MAX_ATTEMPTS_REACHED" })
    expect([...stores.messages.values()].map((message) => message.status)).toEqual(["FAILED"])
    // A nova tentativa do MESMO nó (mesma matrícula): a mensagem é retomada e publicada — só revisão + composição foram pagas.
    const before = provider.attempts.length
    const published = await generateFeedback(deps, messageRequest())
    expect(published.kind).toBe("PUBLISHABLE")
    expect(provider.stages().slice(before)).toEqual(["CALL_REVIEW", "COMPOSITION", "VERIFICATION"])
    expect(stores.messages.size).toBe(1)
  })

  it("execução gravada ANTES desta correção como 'concluída' com REVIEW_UNAVAILABLE: as propostas são reaproveitadas, só a revisão é feita, e a abstenção antiga não prende a mensagem", async () => {
    // Estado legado reconstruído: uma execução com a chave antiga, concluída sem revisão (como a V4 pré-correção gravava).
    const provider = flaky(1)
    const first = setup(provider.model)
    await analyzeCall(first.analyze, analysisRequest()).catch(() => undefined)
    const rawAnalysis = (([...first.stores.runs.values()][0]!.provenance as { modelResponses: { analysis: { requestSha256: string; text: string } } }).modelResponses.analysis)
    const { stores, analyze, deps } = setup(provider.model)
    const interaction = (await analyze.loadInteraction(ORG, INTERACTION_ID))!
    const agent = (await analyze.loadAgent(ORG, AGENT))!
    const legacyKey = legacyAnalysisKeyOf(interaction, agent, await analyze.loadDocuments(ORG, AGENT, interaction.startedAt))
    const claim = await stores.claimAnalysis({ organizationId: ORG, kind: "CALL_ANALYSIS", analysisKey: legacyKey, personId: OPERATOR, interactionId: INTERACTION_ID, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "legado" }, logicVersion: "CALL_ANALYSIS_LOGIC_V4", asOf: new Date("2026-09-29T12:00:00Z") }, new Date("2026-09-29T12:00:00Z"), 300)
    const context = buildProcedureContext(sourceDocuments())
    const projection = projectTranscript(TRANSCRIPT, { maxChars: TRANSCRIPT_MAX_CHARS })
    const parsed = parseCallAnalysisResponse(rawAnalysis.text)
    if (!parsed.ok) throw new Error("fixture")
    const unreviewed = await reviewAnalysis({ model: { async generate() { throw timeout() } } }, { model: parsed.value, context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subject: "Segunda via", anchored: [] }, [])
    expect(unreviewed.analysis.outcomeReasons).toEqual([LEGACY_REVIEW_UNAVAILABLE])
    if (claim.kind !== "CLAIMED") throw new Error("fixture")
    await stores.completeCallAnalysis(ORG, claim.runId, { snapshot: { interactionId: INTERACTION_ID, personId: OPERATOR, occurredAt: interaction.startedAt, timeZone: interaction.timeZone, subjectRaw: "Segunda via", subjectCanonical: null, channel: "VOICE", teamId: "t1", subteamId: null, supervisorId: null, transcriptChecksum: "abc", selectionReason: "legado" }, analysis: unreviewed.analysis, identities: new Map(), documentVersions: new Map(), provenance: { modelResponses: { analysis: rawAnalysis, review: null } }, metrics: {} }, new Date("2026-09-29T12:05:00Z"))
    await stores.claimMessage({ organizationId: ORG, messageKey: "WORKFLOW_NODE:enr-1:feedback:agent", enrollmentId: "enr-1", workflowId: "wf-1", workflowVersionId: "v-1", nodeId: "feedback", sourceNodeId: "agent", personId: OPERATOR, domain: "MONITORING" }, new Date("2026-09-29T12:05:00Z"), 600)
    const legacyMessage = [...stores.messages.values()][0]!
    await stores.completeMessage(ORG, legacyMessage.id, { status: "ABSTAINED", analysisRunIds: [claim.runId], abstainReason: `INSUFFICIENT_EVIDENCE:${LEGACY_REVIEW_UNAVAILABLE}`, findingKeys: [], brief: null, message: null, composition: null, suppressed: [], metrics: {}, materials: [] }, new Date("2026-09-29T12:05:00Z"))
    expect(await stores.pendingReviewInteractions(ORG, [INTERACTION_ID])).toEqual(new Set([INTERACTION_ID]))

    // Provedor recuperado; a mensagem da matrícula é refeita (a abstenção antiga não era decisão) — sem pagar a análise.
    provider.recover()
    const before = provider.attempts.length
    const result = await generateFeedback(deps, messageRequest({ sourceNodeOutput: { kind: "FEEDBACK_ENGINE_CALL_ANALYSIS", analysisRunId: claim.runId, callAssessmentId: null, interactionId: INTERACTION_ID, personId: OPERATOR } }))
    expect(result.kind).toBe("PUBLISHABLE")
    expect(provider.stages().slice(before).filter((stage) => stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(provider.stages().slice(before)[0]).toBe("CALL_REVIEW")
    expect(stores.assessments.filter((entry) => entry.isCurrent)).toHaveLength(1)
    expect(stores.assessments.find((entry) => entry.isCurrent)!.analysis.outcome).toBe("USABLE")
    expect(await stores.pendingReviewInteractions(ORG, [INTERACTION_ID])).toEqual(new Set())
    expect(stores.messages.size).toBe(1)
  })
})

describe("insuficiência REAL é resposta: nenhuma retentativa", () => {
  it("sem transcrição: concluída como insuficiente, reutilizada sem modelo, nunca pendente", async () => {
    const provider = flaky(0)
    const { stores, analyze } = setup(provider.model, { transcript: null })
    expect(await analyzeCall(analyze, analysisRequest())).toMatchObject({ outcome: "INSUFFICIENT_EVIDENCE", outcomeReasons: ["TRANSCRIPT_UNAVAILABLE"], reused: false })
    expect(await analyzeCall(analyze, analysisRequest())).toMatchObject({ reused: true })
    expect(provider.attempts).toHaveLength(0)
    expect(await stores.pendingReviewInteractions(ORG, [INTERACTION_ID])).toEqual(new Set())
  })

  it("revisão FEITA que não confirma nada: inconclusiva após revisão = resultado definitivo (reutilizado, sem nova revisão)", async () => {
    const provider = flaky(0, { review: (payload) => ({ claims: payload.claims.map((claim) => ({ id: claim.id, verdict: "UNCERTAIN", issues: ["INSUFFICIENT_TRANSCRIPT"] })), path: payload.path ? { verdict: "UNCERTAIN", issues: [] } : null, linesToAssess: [] }) })
    const { analyze } = setup(provider.model)
    expect(await analyzeCall(analyze, analysisRequest())).toMatchObject({ outcome: "INSUFFICIENT_EVIDENCE", outcomeReasons: ["NO_CONFIRMED_FINDING"] })
    const paid = provider.attempts.length
    expect(await analyzeCall(analyze, analysisRequest())).toMatchObject({ reused: true })
    expect(provider.attempts).toHaveLength(paid)
  })

  it("falha técnica repetida: cada execução tenta a revisão UMA vez (sem laço); resposta fora do contrato encerra a execução sem nova tentativa automática", async () => {
    const provider = flaky(99)
    const { stores, analyze } = setup(provider.model)
    for (let attempt = 0; attempt < 3; attempt++) await expect(analyzeCall(analyze, analysisRequest())).rejects.toBeInstanceOf(CallReviewPendingError)
    expect(provider.stages()).toEqual(["CALL_ANALYSIS", "CALL_REVIEW", "CALL_REVIEW", "CALL_REVIEW"])
    expect(checkpointOf([...stores.runs.values()][0]!.result)).toMatchObject({ reviewAttempts: 3 })

    const garbled = flaky(0, { review: () => ({ nothing: true }) })
    const other = setup(garbled.model)
    const error = await analyzeCall(other.analyze, analysisRequest()).catch((caught: unknown) => caught)
    expect(classifyExecutionError(error).category).toBe("MODEL_OUTPUT_CONTRACT_INVALID")
    expect(decideNodeRetry("MODEL_OUTPUT_CONTRACT_INVALID", 0, new Date()).willRetry).toBe(false)
    expect(checkpointOf([...other.stores.runs.values()][0]!.result)).toMatchObject({ reason: "CONTRACT" })
    expect(other.stores.assessments).toHaveLength(0)
  })
})

describe("mudança de fontes invalida só a etapa que ficou incompatível", () => {
  it("transcrição corrigida durante a pendência: as propostas antigas NÃO valem — análise e revisão novas", async () => {
    const provider = flaky(1)
    const first = setup(provider.model)
    await expect(analyzeCall(first.analyze, analysisRequest())).rejects.toBeInstanceOf(CallReviewPendingError)
    provider.recover()
    const corrected = setup(provider.model, { checksum: "abc-corrigida", transcript: TRANSCRIPT.replace("Bom dia", "Boa tarde") })
    // Mesmo armazenamento (a pendência antiga existe lá).
    const shared = { ...corrected.analyze, memory: first.stores }
    const before = provider.attempts.length
    await analyzeCall(shared, analysisRequest())
    expect(provider.stages().slice(before)).toEqual(["CALL_ANALYSIS", "CALL_REVIEW"])
    expect(first.stores.assessments).toHaveLength(1)
    // A pendência antiga ficou no histórico, resolvida por uma leitura mais nova da mesma chamada.
    expect(await first.stores.pendingReviewInteractions(ORG, [INTERACTION_ID])).toEqual(new Set())
  })

  it("só o motivo de seleção mudou (outro gatilho): mesma análise, nada é pago de novo", async () => {
    const provider = flaky(0)
    const { analyze } = setup(provider.model)
    await analyzeCall(analyze, analysisRequest("Sinal: nota_ura = 2"))
    const paid = provider.attempts.length
    expect(await analyzeCall(analyze, analysisRequest("Investigação do TMA"))).toMatchObject({ reused: true })
    expect(provider.attempts).toHaveLength(paid)
  })

  it("revisão já paga com o MESMO pedido é reaproveitada; pedido diferente (lógica/regra mudou) refaz só a revisão", async () => {
    const provider = flaky(0)
    const context = buildProcedureContext(sourceDocuments())
    const projection = projectTranscript(TRANSCRIPT, { maxChars: TRANSCRIPT_MAX_CHARS })
    const analysisText = (await provider.model.generate({ stage: "CALL_ANALYSIS", systemPrompt: "", contents: [{ role: "user", text: context.documents.flatMap((document) => document.sections.flatMap((section) => section.lines.map((line) => `[${line.handle}] ${line.text}`))).join("\n") + "\n" + [...context.sections.values()].map((section) => `[${section.handle}] ${section.heading}`).join("\n") }], responseSchema: {} })).text
    const parsed = parseCallAnalysisResponse(analysisText)
    if (!parsed.ok) throw new Error("fixture")
    const input = { model: parsed.value, context, projection, transcriptStatus: transcriptStatusOf(projection), interactionId: INTERACTION_ID, subject: "Segunda via", anchored: [] }
    const paid = await reviewAnalysis({ model: provider.model }, input, [])
    expect(paid.reviewReused).toBe(false)
    const calls = provider.attempts.length
    const reused = await reviewAnalysis({ model: provider.model }, { ...input, storedReviews: [paid.raw!] }, [])
    expect(reused).toMatchObject({ reviewReused: true, pending: null })
    expect(provider.attempts).toHaveLength(calls)
    const stale = await reviewAnalysis({ model: provider.model }, { ...input, storedReviews: [{ ...paid.raw!, requestSha256: "outro-pedido" }] }, [])
    expect(stale.reviewReused).toBe(false)
    expect(provider.attempts).toHaveLength(calls + 1)
  })
})

describe("concorrência e dependentes", () => {
  it("duas retomadas simultâneas da MESMA revisão pendente: uma paga, a outra espera (sem revisão nem memória em dobro)", async () => {
    const provider = flaky(1)
    const { stores, analyze } = setup(provider.model)
    await expect(analyzeCall(analyze, analysisRequest())).rejects.toBeInstanceOf(CallReviewPendingError)
    provider.recover()
    const before = provider.attempts.length
    const [a, b] = await Promise.allSettled([analyzeCall(analyze, analysisRequest()), analyzeCall(analyze, analysisRequest())])
    const outcomes = [a, b].map((entry) => (entry.status === "fulfilled" ? "OK" : entry.reason instanceof AnalysisInProgressError ? "IN_PROGRESS" : "OTHER")).sort()
    expect(outcomes).toEqual(["IN_PROGRESS", "OK"])
    expect(provider.stages().slice(before)).toEqual(["CALL_REVIEW"])
    expect(stores.assessments).toHaveLength(1)
  })

  it("investigação que dependia de uma revisão pendente NÃO fecha com a lacuna; recuperada, retoma só aquela revisão e reconhece o resultado", async () => {
    let failOnce = true
    const fake = fakeEngineModel()
    const model: EngineModelPort = {
      async generate(request) {
        // A revisão da 2ª chamada do recorte cai uma vez (timeout); o resto responde.
        if (request.stage === "CALL_REVIEW" && failOnce && request.contents[0]!.text.includes("Contestação") && fake.calls.filter((call) => call.stage === "CALL_REVIEW").length === 1) {
          failOnce = false
          throw timeout()
        }
        return fake.model.generate(request)
      },
    }
    const tools = catalogRunner({ compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) })
    const { investigate, memory } = investigationSetup({ model, tools: tools.runner })
    const error = await investigateIndicator(investigate, investigationRequest()).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(InvestigationAnalysisPendingError)
    expect(classifyExecutionError(error).category).toBe("TRANSIENT_PROVIDER_ERROR")
    const stores = memory as ReturnType<typeof createInMemoryFeedbackMemoryStore>
    expect(stores.investigations).toHaveLength(0)
    expect(stores.assessments).toHaveLength(2)
    const analysesBefore = fake.calls.filter((call) => call.stage === "CALL_ANALYSIS").length

    // Nova tentativa (política do motor): as duas análises prontas vêm da memória; a pendente retoma SÓ a revisão.
    const result = (await investigateIndicator(investigate, investigationRequest())).investigations[0]!
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(analysesBefore)
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.evidence.find((entry) => entry.sliceRef === "R1")).toMatchObject({ analyzedCalls: 3, pendingReview: 0 })
    expect(stores.assessments.map((entry) => entry.snapshot.interactionId).sort()).toEqual([...CALLS].sort())
  })
})
