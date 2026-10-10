import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { compositionPayloadOf, verificationFactsOf } from "../domain/composition-prompt.js"
import { buildIndicatorBrief } from "../domain/indicator-brief.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { fakeEngineModel, plannerPayloadOf, reviewPayloadOf } from "../testing/fake-engine-model.js"
import { AGENT, anomaly, catalogRunner, DAY_CALLS, EMPTY_DAY, investigationOf, ok, ORG, PEAK_DAY, PERSON, request, setup, type ToolScript } from "../testing/investigation-world.js"
import { analyzeCall } from "./analyze-call.js"
import { generateFeedback } from "./generate-feedback.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * DESCOBERTAS DAS FERRAMENTAS ATUALIZAM A INVESTIGAÇÃO (`INDICATOR_INVESTIGATION_V4`) — modelo e ferramentas FALSOS, zero IA.
 *
 * DEFEITO REPRODUZIDO (antes desta versão): TMA piorou; a comparação por assunto não achou concentração; `detect_anomalies` achou
 * um pico em 14/08; `compare_population` mostrou resultado pior que o grupo. O motor parava com `NO_OPEN_QUESTION` — a pergunta
 * das chamadas aparecia como RESPONDIDA (o foco era só por assunto) sem nenhuma chamada daquele dia examinada.
 */
const stableButPeak: ToolScript = {
  detect_anomalies: () => ok({ pattern: "ISOLATED_SPIKES", baseline: 410, pointsAnalyzed: 22, anomalies: [anomaly(PEAK_DAY)] }),
  compare_population: () => ok({ reference: "SUBGROUP", targetValue: 450, referenceValue: 390, referencePopulation: 12, difference: 60, differencePercent: 15.4, performance: "WORSE_THAN_REFERENCE" }, "pares do Subgrupo (n=12)"),
}
const historyOf = (investigation: Awaited<ReturnType<typeof investigationOf>>, round: number, id: string) => investigation.tools!.questionHistory!.find((entry) => entry.round === round)?.questions.find((question) => question.id === id)

describe("DEFEITO REPRODUZIDO: o pico achado por uma ferramenta abre o recorte e a pergunta das chamadas DELE", () => {
  it("assuntos estáveis → detect_anomalies acha 14/08 → grupo mostra lacuna individual → o estado permite aprofundar AQUELE dia, e o achado chega ao diagnóstico e à mensagem", async () => {
    const tools = catalogRunner(stableButPeak)
    const { investigate, fake, memory, sliceQueries } = setup({ tools: tools.runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)

    // A localização por assunto não achou nada (o foco antigo ficava vazio)…
    expect(investigation.localization.focus).toEqual([])
    // …mas o resultado da ferramenta criou o recorte, com a origem e o observado.
    expect(investigation.slices).toHaveLength(1)
    expect(investigation.slices![0]).toMatchObject({ ref: "R1", label: "dia 14/08", reason: "ATYPICAL_DAY", adverse: true, origin: { kind: "TOOL", tool: "detect_anomalies" } })
    expect(sliceQueries).toContainEqual([{ dimension: "DAY", value: PEAK_DAY, label: "14/08" }])
    // Rodada 1 (ferramentas executaram): ONDE respondido; "o que houve nas chamadas do dia" ABERTO — não "respondido".
    expect(historyOf(investigation, 1, "WHERE")).toMatchObject({ status: "ANSWERED" })
    expect(historyOf(investigation, 1, "CONTEXT")).toMatchObject({ status: "ANSWERED" })
    expect(historyOf(investigation, 1, "CALLS:R1")).toMatchObject({ status: "OPEN", material: true })
    // O planejador recebeu o estado ATUALIZADO (recorte + chamadas dele) e decidiu aprofundar.
    const second = plannerPayloadOf(fake.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")[1]!)
    expect(second.openQuestions.map((question) => question.id)).toEqual(["CALLS:R1"])
    expect(second.slices![0]).toMatchObject({ ref: "R1", universe: 3, confirmedAnalyzed: 0 })
    // As chamadas analisadas são as DO DIA 14/08 (mesma análise da monitoria, gravada na memória compartilhada).
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(3)
    expect((memory as ReturnType<typeof createInMemoryFeedbackMemoryStore>).assessments.map((entry) => entry.snapshot.interactionId).sort()).toEqual([...DAY_CALLS].sort())
    expect(historyOf(investigation, 2, "CALLS:R1")).toMatchObject({ status: "ANSWERED" })
    expect(investigation.tools!.stopReason).toBe("NO_OPEN_QUESTION")

    // O achado do recorte descoberto chega ao DIAGNÓSTICO persistido…
    const evidence = investigation.evidence.find((entry) => entry.sliceRef === "R1")!
    expect(evidence).toMatchObject({ focusReason: "ATYPICAL_DAY", universe: 3, analyzedCalls: 3, newlyAnalyzed: 3, scope: "Nas chamadas do recorte dia 14/08", filters: [{ dimension: "DAY", value: PEAK_DAY }] })
    expect(investigation.conclusion).toBe("PATTERN_SUPPORTED")
    // …e ao contexto da mensagem (fato com escopo e origem), para o redator e para o verificador.
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(brief.developments[0]!.observed).toMatch(/^Nas chamadas do recorte dia 14\/08, em 3 de 3 chamadas analisadas/)
    expect(brief.context.join(" ")).toMatch(/Dia 14\/08 fora do padrão na medição diária/)
    expect(JSON.stringify(verificationFactsOf(brief))).toMatch(/dia 14\/08/)
    expect(JSON.stringify(compositionPayloadOf(brief).facts)).toMatch(/dia 14\/08/)
  })

  it("de ponta a ponta: a mensagem gerada usa o recorte descoberto (sem frase pronta do sistema)", async () => {
    const tools = catalogRunner(stableButPeak)
    // O redator (falso) escreve só sobre o ponto que existe; organização e palavras são dele — o sistema não acrescenta frase.
    const writer = fakeEngineModel({ composition: { sentences: [{ text: "Nas chamadas de 14/08, a data de nascimento não foi confirmada antes de enviar os dados.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }, { text: "Peça a data de nascimento logo depois de confirmar o nome, antes de enviar qualquer dado.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Confirme a data de nascimento antes de enviar.", refs: ["A1"] } } })
    const { investigate, analyze, memory } = setup({ model: writer.model, tools: tools.runner, subjects: "STABLE" })
    const stores = memory as ReturnType<typeof createInMemoryFeedbackMemoryStore>
    const deps = { memory: stores, messages: stores, model: analyze.model, analyze, investigate, loadDocumentTitles: async () => new Map<string, string>(), loadAgentConfiguredAt: async () => "2026-09-01T00:00:00.000Z", now: analyze.now }
    const result = await generateFeedback(deps, { organizationId: ORG, enrollmentId: "enr-d", workflowId: "wf", workflowVersionId: "v", nodeId: "fb", sourceNodeId: "agent", domain: "INDICATOR", sourceNodeOutput: { indicatorCode: "TMA" }, collaboratorId: PERSON, interactionId: null, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "agenda", now: new Date("2026-09-30T12:00:00Z") })
    expect(result.kind).toBe("PUBLISHABLE")
    const message = stores.messages.get(result.messageId)!
    expect(message.brief!.developments[0]!.observed).toMatch(/dia 14\/08/)
    expect(message.brief!.context.join(" ")).toMatch(/Dia 14\/08/)
    expect(message.message!.text).not.toMatch(/Ponto principal|O procedimento orienta|não aparece a etapa/)
  })
})

describe("descoberta × memória × dados × resultado da ferramenta", () => {
  it("descoberta JÁ explicada pela memória: nenhuma análise nova — o recorte é respondido pelo que a memória tem", async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const seeded = setup({ memory })
    for (const id of DAY_CALLS) await analyzeCall(seeded.analyze, { organizationId: ORG, interactionId: id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    const fresh = fakeEngineModel()
    const { investigate } = setup({ memory, model: fresh.model, tools: catalogRunner(stableButPeak).runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(fresh.calls.map((call) => call.stage)).toEqual(["INVESTIGATION_PLANNING"])
    expect(historyOf(investigation, 1, "CALLS:R1")).toMatchObject({ status: "ANSWERED" })
    expect(investigation.evidence.find((entry) => entry.sliceRef === "R1")).toMatchObject({ analyzedCalls: 3, newlyAnalyzed: 0, reusedCalls: 3 })
  })

  it("descoberta SEM dados (dia sem chamadas com transcrição): fica limitada — nada é analisado e nenhuma causa é inventada", async () => {
    const tools = catalogRunner({ ...stableButPeak, detect_anomalies: () => ok({ pattern: "ISOLATED_SPIKES", baseline: 410, pointsAnalyzed: 22, anomalies: [anomaly(EMPTY_DAY)] }) })
    const { investigate, fake, memory } = setup({ tools: tools.runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.slices![0]).toMatchObject({ label: "dia 20/08" })
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "NO_DATA", material: false })
    expect(investigation.tools!.stopReason).toBe("NO_DATA_FOR_OPEN_QUESTIONS")
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(investigation.limitations.join(" ")).toMatch(/O recorte dia 20\/08 não tem chamadas com transcrição/)
    expect(investigation.conclusion).toBe("INSUFFICIENT_DATA")
    expect(buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false }).developments).toHaveLength(0)
  })

  it("ferramenta que RODOU com sucesso não encerra a pergunta que ela não respondeu (nenhum pico, comparação sem conclusão, análises sem nada confirmado)", async () => {
    const tools = catalogRunner({
      detect_anomalies: () => ok({ pattern: "STABLE", baseline: 450, pointsAnalyzed: 22, anomalies: [] }),
      compare_population: () => ok({ reference: "SUBGROUP", status: "OK", targetValue: 450, referenceValue: null, performance: null }, "pares do Subgrupo (n=12)"),
    })
    const model = fakeEngineModel({ planner: (payload, round) => (round === 1 ? { calls: [{ tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }, { tool: "detect_anomalies", args: {}, question: "WHERE" }] } : { calls: [], stop: { reason: "INSUFFICIENT_DATA", note: `abertas: ${payload.openQuestions.map((question) => question.id).join(",")}` } }) })
    const { investigate, memory } = setup({ model: model.model, tools: tools.runner, subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.ledger.map((entry) => `${entry.tool}:${entry.status}`)).toEqual(["compare_population:OK", "detect_anomalies:OK"])
    // As duas executaram, mas nenhuma esclareceu: ONDE continua aberto (há dimensões não consultadas), CONTEXTO não está respondido.
    expect(historyOf(investigation, 1, "WHERE")!.status).not.toBe("ANSWERED")
    expect(historyOf(investigation, 1, "CONTEXT")!.status).toBe("PARTIAL")
    expect(investigation.slices).toEqual([])
    expect(investigation.conclusion).not.toBe("PATTERN_SUPPORTED")

    // Análise de chamadas que roda mas não confirma nada (a revisão refuta tudo) também não "responde" a pergunta das chamadas.
    const refuting = fakeEngineModel({ review: (payload) => ({ claims: payload.claims.map((claim) => ({ id: claim.id, verdict: "UNCERTAIN", issues: ["INSUFFICIENT_TRANSCRIPT"] })), path: payload.path ? { verdict: "UNCERTAIN", issues: [] } : null, linesToAssess: [] }), planner: (payload, round) => (round === 1 ? { calls: [{ tool: "analyze_calls", args: { interactions: payload.slices![0]!.interactions }, question: "CALLS:R1" }] } : { calls: [], stop: { reason: "INSUFFICIENT_DATA", note: "x" } }) })
    const located = setup({ model: refuting.model, tools: catalogRunner({ compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) }).runner })
    const run = (await investigateIndicator(located.investigate, request())).investigations[0]!
    const after = await investigationOf(located.memory, run.runId)
    expect(after.tools!.ledger.find((entry) => entry.tool === "analyze_calls")).toMatchObject({ status: "OK" })
    expect(historyOf(after, 1, "CALLS:R1")).toMatchObject({ status: "OPEN", material: true })
    void reviewPayloadOf
  })
})

describe("limites e permissões impedem o aprofundamento — com o motivo certo", () => {
  it("sem permissão de analisar chamadas: o recorte é descoberto, mas a pergunta dele fica SEM FERRAMENTA (nada é analisado por fora)", async () => {
    const tools = catalogRunner(stableButPeak)
    const { investigate, fake, memory } = setup({ tools: tools.runner, subjects: "STABLE", agentCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON"] })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.slices![0]).toMatchObject({ label: "dia 14/08" })
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "NO_TOOL" })
    expect(investigation.tools!.stopReason).toBe("NO_AVAILABLE_TOOL_FOR_OPEN_QUESTIONS")
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
  })

  it("limite de análises NOVAS zerado (V4): nenhuma análise é pedida; a pergunta do recorte continua para o que não chama modelo e o planejador para justificando", async () => {
    const tools = catalogRunner({ ...stableButPeak, get_interaction_flags: () => ok({ interactionsInSet: 3, flags: [] }, "chamadas informadas") })
    const planner = fakeEngineModel({ planner: (payload, round) => (round === 1 ? { calls: [{ tool: "detect_anomalies", args: {}, question: "WHERE" }, { tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }] } : { calls: [], stop: { reason: "SUFFICIENT", note: "Sem análise nova.", declined: [{ question: "CALLS:R1", why: "Um dia isolado e sem análise nova disponível: aprofundar fica para quando houver análise." }] } }) })
    const { investigate, memory } = setup({ model: planner.model, tools: tools.runner, subjects: "STABLE", maxCallAnalyses: 0 })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(historyOf(investigation, 1, "CALLS:R1")).toMatchObject({ status: "OPEN", material: true })
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "DECLINED", resolution: { justified: true } })
    expect(planner.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(investigation.completeness).toMatchObject({ status: "COMPLETE" })
  })

  it("orçamento de IA esgotado (≠ limite de análises): a pergunta fecha como ORÇAMENTO, com o motivo certo", async () => {
    const { openQuestionsOf } = await import("../domain/investigation-toolbox.js")
    const state = { officialAdverse: true, adverse: true, good: false, measurementBased: false, localized: true, whereTools: { available: [], tried: [] }, attribution: "UNKNOWN" as const, contextTools: { available: [], tried: [] }, workContextChecked: false, dataQuality: null, dataQualityTool: { available: false, tried: false }, slices: [{ ref: "R1", label: "dia 14/08", adverse: true, reason: "ATYPICAL_DAY", universe: 3, confirmedAnalyzed: 0, pendingReview: 0, strengthPattern: false }], minimumAnalyzed: 3, analyzeAvailable: true, callAnalysesLeft: 2, freeCallTools: ["read_call_memory" as const], modelBudgetExhausted: true, strengthEvidence: false, plan: "PLANNER" as const }
    expect(openQuestionsOf(state).find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "BUDGET", reason: "o orçamento de IA da execução acabou", material: false })
    // Sem análise nova E sem consulta sem IA permitida: não há o que fazer nesta execução — fica registrado com o motivo.
    expect(openQuestionsOf({ ...state, modelBudgetExhausted: false, callAnalysesLeft: 0, freeCallTools: [] }).find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "BUDGET", reason: "nenhuma análise nova de chamada cabe nesta execução" })
  })
})
