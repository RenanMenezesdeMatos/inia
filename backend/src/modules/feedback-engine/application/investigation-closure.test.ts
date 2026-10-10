import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { buildIndicatorBrief } from "../domain/indicator-brief.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { fakeEngineModel, plannerPayloadOf, type PlannerPayload } from "../testing/fake-engine-model.js"
import { AGENT, anomaly, catalogRunner, DAILY_WITH_PEAK, DAY_CALLS, improved, investigationOf, ok, ORG, PEAK_DAY, PERSON, request, setup, strategyWith, type ToolScript } from "../testing/investigation-world.js"
import { analyzeCall } from "./analyze-call.js"
import { generateFeedback } from "./generate-feedback.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * O QUE ENCERRA UMA PERGUNTA DE RECORTE (`INDICATOR_INVESTIGATION_V5` / `INVESTIGATION_CLOSURE_V1`) — modelo e ferramentas FALSOS,
 * zero IA. Prova contrato e fluxo; não prova a qualidade de um planejador real.
 *
 * DEFEITOS REPRODUZIDOS (antes desta versão):
 *   A) TMA 380 → 450 (meta 400); `detect_anomalies` acha 820 s em 14/08; a comparação do MÊS mostra a pessoa melhor que o grupo
 *      (450 × 500); há 3 chamadas com transcrição no dia. A pergunta das chamadas de 14/08 virava NOT_MATERIAL ("grupo igual ou
 *      melhor") e a investigação terminava com NO_OPEN_QUESTION sem nenhuma chamada examinada.
 *   B) TMA 357, dentro da meta de 400 e melhor que o anterior; a própria medição diária mostra 820 s em 14/08. O recorte do dia nem
 *      abria ("o resultado oficial não piorou") e a conclusão era só RESULT_RECOGNITION.
 * Princípio: o resultado do mês e a comparação do mês com o grupo são CONTEXTO — não provam que um problema localizado deixou de
 * existir. O planejador recebe o achado e decide aprofundar ou parar; parar com a pergunta aberta exige "resolvida pela evidência do
 * MESMO recorte" (conferida pelo código) ou "não aprofundar" com justificativa — nunca vira "respondida".
 */
const scenarioA: ToolScript = {
  detect_anomalies: () => ok({ pattern: "ISOLATED_SPIKES", baseline: 410, pointsAnalyzed: 22, anomalies: [anomaly(PEAK_DAY, 820)] }),
  compare_population: () => ok({ reference: "SUBGROUP", targetValue: 450, referenceValue: 500, referencePopulation: 12, difference: -50, differencePercent: -10, performance: "BETTER_THAN_REFERENCE" }, "pares do Subgrupo (n=12)"),
  get_interaction_flags: () => ok({ interactionsInSet: 3, flags: [{ flag: "transferencia", count: 3, sharePercent: 100 }] }, "chamadas informadas"),
}
type Investigation = Awaited<ReturnType<typeof investigationOf>>
const question = (investigation: Investigation, id: string) => investigation.tools!.openQuestions.find((entry) => entry.id === id)
const afterRound = (investigation: Investigation, round: number, id: string) => investigation.tools!.questionHistory!.find((entry) => entry.round === round)?.questions.find((entry) => entry.id === id)
const refOf = (payload: PlannerPayload, tool: string) => payload.evidence.find((line) => line.includes(`(${tool}`))!.split(" ")[0]!
/** Rodada 1 do planejador nos cenários: onde (dias) e contexto (grupo) — as decisões das rodadas seguintes variam por teste. */
const firstRound = { calls: [{ tool: "detect_anomalies", args: {}, question: "WHERE" }, { tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }] }

describe("A) mês pior, mas melhor que o grupo: o pico do dia continua sendo pergunta", () => {
  it("o achado chega ao planejador como pergunta ABERTA, com a comparação do mês como contexto — e ele pode aprofundar", async () => {
    const tools = catalogRunner(scenarioA)
    const { investigate, fake, memory } = setup({ tools: tools.runner, subjects: "STABLE" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)

    expect(investigation.signals!.attribution).toBe("NO_INDIVIDUAL_GAP")
    expect(investigation.slices![0]).toMatchObject({ ref: "R1", label: "dia 14/08", origin: { kind: "TOOL", tool: "detect_anomalies" } })
    // Antes: NOT_MATERIAL logo depois da comparação. Agora: aberta, com o contexto do mês declarado como contexto.
    expect(afterRound(investigation, 1, "CALLS:R1")).toMatchObject({ status: "OPEN", material: true })
    const round2 = plannerPayloadOf(fake.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")[1]!)
    const asked = round2.openQuestions.find((entry) => entry.id === "CALLS:R1")!
    expect(asked.context!.join(" ")).toMatch(/igual ou melhor que o grupo comparável — não há evidência de lacuna individual no MÊS; não diz o que aconteceu/)
    // O planejador (padrão) escolheu aprofundar: as 3 chamadas DO DIA foram analisadas pela mesma análise da monitoria.
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(3)
    expect((memory as ReturnType<typeof createInMemoryFeedbackMemoryStore>).assessments.map((entry) => entry.snapshot.interactionId).sort()).toEqual([...DAY_CALLS].sort())
    expect(question(investigation, "CALLS:R1")).toMatchObject({ status: "ANSWERED", resolution: { by: "MEMORY" } })
    expect(investigation.conclusion).not.toBe("CHANGE_LOCATED_NOT_EXAMINED")
    // "Sem evidência para responsabilizar no mês" continua dito — separado de "o que se viu no dia".
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(brief.limitations.join(" ")).toMatch(/não pode ser tratada como deficiência individual/)
    for (const finding of brief.developments) expect(finding.observed).toMatch(/^Nas chamadas do recorte dia 14\/08/)
  })

  it("o planejador pode PARAR: decisão de não aprofundar fica DECLINED com a justificativa (nunca 'respondida') e a conclusão diz que o recorte não foi examinado", async () => {
    const justification = "O mês ficou melhor que o grupo e o pico é um único dia com 3 chamadas; o custo de analisar não muda a orientação."
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? firstRound : { calls: [], stop: { reason: "SUFFICIENT", note: "Basta.", declined: [{ question: "CALLS:R1", why: justification }] } }) })
    const { investigate, memory } = setup({ model: model.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(question(investigation, "CALLS:R1")).toMatchObject({ status: "DECLINED", material: false, answered: false, resolution: { by: "PLANNER_DECLINED", justified: true } })
    expect(question(investigation, "CALLS:R1")!.reason).toContain(justification)
    expect(investigation.tools!.dispositions).toEqual([expect.objectContaining({ question: "CALLS:R1", decision: "DECLINED", accepted: true, why: justification })])
    expect(investigation.tools!.stopReason).toBe("PLANNER_SUFFICIENT")
    expect(investigation.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
    // A limitação é do SISTEMA (a justificativa do modelo fica só no registro).
    expect(investigation.limitations.join(" ")).toMatch(/As chamadas do recorte dia 14\/08 não foram examinadas nesta investigação \(o planejamento da investigação decidiu não aprofundar/)
    expect(investigation.limitations.join(" ")).not.toContain(justification)
  })

  it("parar sem decidir sobre a pergunta aberta: DECLINED sem justificativa + violação registrada", async () => {
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? firstRound : { calls: [], stop: { reason: "SUFFICIENT", note: "Os fatos bastam." } }) })
    const { investigate, memory } = setup({ model: model.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(question(investigation, "CALLS:R1")).toMatchObject({ status: "DECLINED", resolution: { justified: false } })
    expect(investigation.tools!.planner.proposals[1]!.violations).toContain("STOP_WITHOUT_DECISION:CALLS:R1")
    expect(investigation.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
  })

  it("DEFEITO REPRODUZIDO (V2): flags de UMA das 3 chamadas do dia, 'sem flags', declarada como resposta — recusada; a pergunta fica não aprofundada e a conclusão não vira 'sem causa'", async () => {
    const oneCallNoFlags = fakeEngineModel({
      planner: (payload, round) =>
        round === 1 ? firstRound
        : round === 2 ? { calls: [{ tool: "get_interaction_flags", args: { interactions: payload.slices![0]!.interactions.slice(0, 1) }, question: "CALLS:R1" }] }
        : { calls: [], stop: { reason: "SUFFICIENT", note: "Sem sinais.", resolved: [{ question: "CALLS:R1", evidence: [refOf(payload, "get_interaction_flags")] }] } },
    })
    const tools = catalogRunner({ ...scenarioA, get_interaction_flags: () => ok({ interactionsInSet: 1, flags: [] }, "chamadas informadas") })
    const { investigate, memory } = setup({ model: oneCallNoFlags.model, tools: tools.runner, subjects: "STABLE" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(oneCallNoFlags.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    const refused = investigation.tools!.dispositions!.find((entry) => entry.decision === "RESOLVED")!
    expect(refused).toMatchObject({ accepted: false })
    expect(refused.reason).toMatch(/cobre 1 de 3 chamada\(s\) do recorte; nenhum sinal encontrado — ausência de sinal não demonstra ausência de falha/)
    expect(question(investigation, "CALLS:R1")).toMatchObject({ status: "DECLINED", answered: false, resolution: { justified: false } })
    expect(investigation.tools!.planner.proposals.at(-1)!.violations).toContain("RESOLVED_INSUFFICIENT:CALLS:R1")
    expect(investigation.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
  })

  it("sinais de TODAS as chamadas do recorte só JUSTIFICAM não aprofundar (contexto) — nunca viram resposta; evidência do PERÍODO é recusada", async () => {
    const allCalls = fakeEngineModel({
      planner: (payload, round) =>
        round === 1 ? firstRound
        : round === 2 ? { calls: [{ tool: "get_interaction_flags", args: { interactions: payload.slices![0]!.interactions }, question: "CALLS:R1" }] }
        : { calls: [], stop: { reason: "SUFFICIENT", note: "As três chamadas do dia foram transferências.", resolved: [{ question: "CALLS:R1", evidence: [refOf(payload, "get_interaction_flags")] }] } },
    })
    const context = setup({ model: allCalls.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const explained = await investigationOf(context.memory, (await investigateIndicator(context.investigate, request())).investigations[0]!.runId)
    expect(allCalls.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    const flags = explained.tools!.ledger.find((entry) => entry.tool === "get_interaction_flags")!
    expect(flags.scope).toMatchObject({ kind: "INTERACTIONS" })
    expect(question(explained, "CALLS:R1")).toMatchObject({ status: "DECLINED", resolution: { by: "PLANNER_DECLINED", justified: true, evidence: [flags.ref] } })
    expect(explained.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")

    const periodAsAnswer = fakeEngineModel({ planner: (payload, round) => (round === 1 ? firstRound : { calls: [], stop: { reason: "SUFFICIENT", note: "O grupo explica.", resolved: [{ question: "CALLS:R1", evidence: [refOf(payload, "compare_population")] }] } }) })
    const period = setup({ model: periodAsAnswer.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const refused = await investigationOf(period.memory, (await investigateIndicator(period.investigate, request())).investigations[0]!.runId)
    expect(refused.tools!.dispositions!.find((entry) => entry.decision === "RESOLVED")!.reason).toMatch(/não é sobre as chamadas deste recorte/)
    expect(question(refused, "CALLS:R1")).toMatchObject({ status: "DECLINED", resolution: { justified: false } })
    expect(refused.tools!.planner.proposals[1]!.violations).toContain("RESOLVED_INSUFFICIENT:CALLS:R1")
    expect(refused.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
  })

  it("análise de PARTE das chamadas declarada como resposta não basta; a análise na cobertura que a pergunta pede responde sem nada a mais", async () => {
    const partial = fakeEngineModel({
      planner: (payload, round) =>
        round === 1 ? firstRound
        : round === 2 ? { calls: [{ tool: "analyze_calls", args: { interactions: payload.slices![0]!.interactions.slice(0, 1) }, question: "CALLS:R1" }] }
        : { calls: [], stop: { reason: "SUFFICIENT", note: "Uma chamada basta.", resolved: [{ question: "CALLS:R1", evidence: [refOf(payload, "analyze_calls")] }] } },
    })
    const one = setup({ model: partial.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const oneAnalyzed = await investigationOf(one.memory, (await investigateIndicator(one.investigate, request())).investigations[0]!.runId)
    expect(partial.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(1)
    expect(oneAnalyzed.tools!.dispositions!.find((entry) => entry.decision === "RESOLVED")!.reason).toMatch(/só 1 de 3 chamada\(s\) do recorte têm conclusão confirmada \(a pergunta pede 3\)/)
    expect(question(oneAnalyzed, "CALLS:R1")).toMatchObject({ status: "DECLINED" })
    expect(oneAnalyzed.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")

    const full = fakeEngineModel({
      planner: (payload, round) =>
        round === 1 ? firstRound
        : round === 2 ? { calls: [{ tool: "analyze_calls", args: { interactions: payload.slices![0]!.interactions }, question: "CALLS:R1" }] }
        : { calls: [], stop: { reason: "SUFFICIENT", note: "Analisadas.", resolved: [{ question: "CALLS:R1", evidence: [refOf(payload, "analyze_calls")] }] } },
    })
    const all = setup({ model: full.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const answered = await investigationOf(all.memory, (await investigateIndicator(all.investigate, request())).investigations[0]!.runId)
    expect(question(answered, "CALLS:R1")).toMatchObject({ status: "ANSWERED" })
    expect(answered.conclusion).not.toBe("CHANGE_LOCATED_NOT_EXAMINED")
  })

  it("memória suficiente do recorte responde sem custo; dado do período incerto é contexto CONTRA aprofundar, não encerramento", async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const seeded = setup({ memory })
    for (const id of DAY_CALLS) await analyzeCall(seeded.analyze, { organizationId: ORG, interactionId: id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    const fresh = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? firstRound : { calls: [], stop: { reason: "SUFFICIENT", note: "Basta." } }) })
    const reused = setup({ memory, model: fresh.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const fromMemory = await investigationOf(memory, (await investigateIndicator(reused.investigate, request())).investigations[0]!.runId)
    expect(fresh.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(question(fromMemory, "CALLS:R1")).toMatchObject({ status: "ANSWERED", resolution: { by: "MEMORY" } })

    const uncertain = fakeEngineModel({ planner: (payload, round) => (round === 1 ? { calls: [...firstRound.calls, { tool: "validate_data_quality", args: {}, question: "WHERE" }] } : { calls: [], stop: { reason: "INSUFFICIENT_DATA", note: "Dado incerto.", declined: [{ question: "CALLS:R1", why: `contexto: ${payload.openQuestions[0]!.context!.find((line) => /dado operacional/.test(line))}` }] } }) })
    const data = setup({ model: uncertain.model, tools: catalogRunner({ ...scenarioA, validate_data_quality: () => ({ ...ok({ status: "INSUFFICIENT" }), quality: { status: "INSUFFICIENT_SAMPLE", sampleCount: 4, coverage: 0.3, freshness: "STALE", note: "cobertura baixa" } }) }).runner, subjects: "STABLE" })
    const withBadData = await investigationOf(data.memory, (await investigateIndicator(data.investigate, request())).investigations[0]!.runId)
    expect(afterRound(withBadData, 1, "CALLS:R1")).toMatchObject({ status: "OPEN" })
    expect(question(withBadData, "CALLS:R1")!.reason).toMatch(/o desvio do recorte pode refletir o dado/)
    expect(withBadData.conclusion).toBe("INSUFFICIENT_DATA")
  })

  it("sem ferramenta de análise: SEM FERRAMENTA; sem análise NOVA possível (V4): a pergunta segue aberta para o que não chama modelo e fecha com a decisão justificada do planejador", async () => {
    const noTool = setup({ tools: catalogRunner(scenarioA).runner, subjects: "STABLE", agentCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON"] })
    const restricted = await investigationOf(noTool.memory, (await investigateIndicator(noTool.investigate, request())).investigations[0]!.runId)
    expect(question(restricted, "CALLS:R1")).toMatchObject({ status: "NO_TOOL" })
    expect(restricted.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")

    // DEFEITO DA V11 (roteiro com zero análises novas): a pergunta fechava como "orçamento" antes de o planejador ver o recorte. Agora
    // a rodada 2 oferece memória/sinais/contexto das chamadas do dia (sem a análise nova); o planejador consulta os sinais e, na rodada
    // 3, decide não aprofundar dizendo por quê.
    const seen: PlannerPayload[] = []
    const decider = fakeEngineModel({
      planner: (payload, round) => {
        seen.push(payload)
        return round === 1 ? firstRound
          : round === 2 ? { calls: [{ tool: "get_interaction_flags", args: { interactions: payload.slices![0]!.interactions }, question: "CALLS:R1" }] }
          : { calls: [], stop: { reason: "SUFFICIENT", note: "Sem análise nova possível nesta execução.", declined: [{ question: "CALLS:R1", why: "As três chamadas do dia foram transferências; com uma análise nova indisponível agora, aprofundar não muda a conclusão do mês." }] } }
      },
    })
    const limited = setup({ model: decider.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE", maxCallAnalyses: 0 })
    const decided = await investigationOf(limited.memory, (await investigateIndicator(limited.investigate, request())).investigations[0]!.runId)
    expect(seen[1]!.tools.map((tool) => tool.tool)).not.toContain("analyze_calls")
    const offered = seen[1]!.openQuestions.find((entry) => entry.id === "CALLS:R1")!
    expect(offered).toMatchObject({ status: "OPEN", reason: expect.stringMatching(/nenhuma análise nova de chamada cabe nesta execução: ainda dá para consultar, sem IA/) })
    expect(offered.candidateTools).toEqual(expect.arrayContaining(["read_call_memory", "get_interaction_flags", "get_interaction_context"]))
    expect(offered.candidateTools).not.toContain("analyze_calls")
    // Rodada 3: os sinais já estão nas evidências; o que ainda não foi consultado sem IA continua oferecido.
    expect(seen[2]!.openQuestions.find((entry) => entry.id === "CALLS:R1")!.candidateTools).toEqual(["read_call_memory", "get_interaction_context"])
    expect(decider.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(question(decided, "CALLS:R1")).toMatchObject({ status: "DECLINED", resolution: { by: "PLANNER_DECLINED", justified: true } })
    expect(decided.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
    expect(decided.limitations.join(" ")).toMatch(/o planejamento da investigação decidiu não aprofundar este recorte/)

    // Todas as consultas sem IA feitas e sem rodada para decidir (2 rodadas: a segunda só consultou): a pergunta termina aberta,
    // esperando a decisão — dito como tal, nunca "orçamento".
    const short = fakeEngineModel({ planner: (payload, round) => (round === 1 ? firstRound : { calls: [{ tool: "get_interaction_flags", args: { interactions: payload.slices![0]!.interactions }, question: "CALLS:R1" }, { tool: "read_call_memory", args: { slice: "R1" }, question: "CALLS:R1" }, { tool: "get_interaction_context", args: { interaction: payload.slices![0]!.interactions[0] }, question: "CALLS:R1" }] }) })
    const twoRounds = setup({ model: short.model, tools: catalogRunner({ ...scenarioA, get_interaction_context: () => ok({ subject: "Troca de plano", durationSeconds: 520, flags: [] }, "chamada informada") }).runner, subjects: "STABLE", maxCallAnalyses: 0 })
    ;(twoRounds.investigate as { maxPlanningRounds?: number }).maxPlanningRounds = 2
    const ended = await investigationOf(twoRounds.memory, (await investigateIndicator(twoRounds.investigate, request())).investigations[0]!.runId)
    expect(question(ended, "CALLS:R1")).toMatchObject({ status: "OPEN", needsDecision: true })
    expect(ended.limitations.join(" ")).toMatch(/não cabia análise nova nesta execução e a investigação terminou antes de decidir sobre o recorte/)
  })
})

describe("B) mês bom, mas um dia fora do padrão da medição diária", () => {
  it("o dia abre recorte mesmo com o mês dentro da meta; o planejador recebe o resultado do mês como contexto e pode aprofundar", async () => {
    const { investigate, fake, memory } = setup({ official: improved, subjects: "STABLE", daily: DAILY_WITH_PEAK, tools: catalogRunner({}).runner })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.slices![0]).toMatchObject({ ref: "R1", label: "dia 14/08", reason: "ATYPICAL_DAY", origin: { kind: "DAILY_PROFILE" } })
    expect(investigation.slices![0]!.observation).toMatch(/fora do padrão da própria medição diária: .*820.* contra a mediana de/)
    expect(afterRound(investigation, 0, "CALLS:R1")).toMatchObject({ status: "OPEN", material: true })
    const round1 = plannerPayloadOf(fake.calls.find((call) => call.stage === "INVESTIGATION_PLANNING")!)
    expect(round1.openQuestions.find((entry) => entry.id === "CALLS:R1")!.context!.join(" ")).toMatch(/dentro da meta ou melhorou — contexto do mês: não mostra que o recorte deixou de ter problema/)
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(3)
    // Antes: só RESULT_RECOGNITION. Agora o dia faz parte do diagnóstico — e o reconhecimento do mês continua disponível.
    expect(investigation.conclusion).not.toBe("RESULT_RECOGNITION")
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(brief.strengths.some((finding) => finding.origin === "INDICATOR_RESULT")).toBe(true)
    expect([...brief.context, ...brief.developments.map((finding) => finding.observed)].join(" ")).toMatch(/14\/08/)
  })

  it("configuração SEM ferramentas (lista vazia — a do agente da Larissa) + estratégia publicada: o contrato não cobre o dia — fica SEM FERRAMENTA, dito como não examinado", async () => {
    const { investigate, fake, memory } = setup({ official: improved, subjects: "STABLE", daily: DAILY_WITH_PEAK, agentCapabilities: [], strategy: strategyWith({ segmentation: true, sample: true }) })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools).toMatchObject({ plan: "CONTRACT", planReason: "NO_INVESTIGATION_CAPABILITIES" })
    expect(question(investigation, "CALLS:R1")).toMatchObject({ status: "NO_TOOL", reason: "o plano do contrato da estratégia só analisa os assuntos localizados e nenhuma ferramenta de investigação está configurada para aprofundar este recorte" })
    expect(fake.calls).toHaveLength(0)
    expect(investigation.conclusion).toBe("CHANGE_LOCATED_NOT_EXAMINED")
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    expect(brief.strengths.some((finding) => finding.origin === "INDICATOR_RESULT")).toBe(true)
    expect(brief.limitations.join(" ")).toMatch(/As chamadas do recorte dia 14\/08 não foram examinadas/)
  })
})

describe("o que chega à mensagem", () => {
  it("mês pior + recorte NÃO examinado: sem achado sustentado, a geração se abstém com o motivo (nunca 'nada material')", async () => {
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? firstRound : { calls: [], stop: { reason: "NO_USEFUL_TOOL", note: "x", declined: [{ question: "CALLS:R1", why: "teste" }] } }) })
    const { investigate, analyze, memory } = setup({ model: model.model, tools: catalogRunner(scenarioA).runner, subjects: "STABLE" })
    const stores = memory as ReturnType<typeof createInMemoryFeedbackMemoryStore>
    const deps = { memory: stores, messages: stores, model: analyze.model, analyze, investigate, loadDocumentTitles: async () => new Map<string, string>(), loadAgentConfiguredAt: async () => "2026-09-01T00:00:00.000Z", now: analyze.now }
    const result = await generateFeedback(deps, { organizationId: ORG, enrollmentId: "enr-c", workflowId: "wf", workflowVersionId: "v", nodeId: "fb", sourceNodeId: "agent", domain: "INDICATOR", sourceNodeOutput: { indicatorCode: "TMA" }, collaboratorId: PERSON, interactionId: null, indicatorMeasurementId: null, configuredAgentId: AGENT, selectionReason: "agenda", now: new Date("2026-09-30T12:00:00Z") })
    expect(result).toMatchObject({ kind: "ABSTAINED", reason: "NO_ACTIONABLE_DIAGNOSIS:CHANGE_LOCATED_NOT_EXAMINED" })
  })
})
