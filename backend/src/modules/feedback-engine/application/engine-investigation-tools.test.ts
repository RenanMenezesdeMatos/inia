import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { buildIndicatorBrief } from "../domain/indicator-brief.js"
import { compositionPayloadOf, verificationFactsOf } from "../domain/composition-prompt.js"
import { createInMemoryFeedbackMemoryStore } from "../infrastructure/in-memory-feedback-memory-store.js"
import { createOverlayFeedbackMemoryStore } from "../infrastructure/overlay-feedback-memory-store.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { anomaly, CALLS, catalogRunner, improved, investigationOf, ok, ORG, PERSON, AGENT, request, setup, strategyWith } from "../testing/investigation-world.js"
import { analyzeCall } from "./analyze-call.js"
import { EngineMeter, meteredModel } from "./engine-meter.js"
import { investigateIndicator } from "./investigate-indicator.js"
import type { EngineModelPort } from "./ports.js"

/**
 * INVESTIGAÇÃO COM FERRAMENTAS no motor (`INDICATOR_INVESTIGATION_V3`) — sem IA: o planejador, o analisador e a revisora são o
 * modelo FALSO; as ferramentas do catálogo são um executor FALSO (o real é coberto pelas provas de banco do catálogo). Prova
 * contrato, escolha condicionada às perguntas abertas, efeito do resultado no diagnóstico e na mensagem, permissões e orçamento —
 * nunca a qualidade de um planejador real.
 */
describe("dois cenários, duas investigações diferentes — a escolha segue as perguntas abertas", () => {
  it("A) piora localizada num assunto: a IA pede comparação com o grupo e ANÁLISE das chamadas do recorte (mesma análise da monitoria)", async () => {
    const tools = catalogRunner({ compare_population: () => ok({ reference: "SUBGROUP", targetValue: 450, referenceValue: 390, referencePopulation: 12, difference: 60, differencePercent: 15.4, performance: "WORSE_THAN_REFERENCE" }, "pares do Subgrupo (n=12)") })
    const { investigate, fake, memory } = setup({ tools: tools.runner })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.localization.focus).toEqual([{ key: "CONTESTACAO", label: "Contestação de cobrança", reason: "DETERIORATED" }])
    expect(investigation.tools!.ledger.filter((entry) => entry.status === "OK").map((entry) => entry.tool)).toEqual(["analyze_calls", "compare_population"])
    // As análises disparadas pela ferramenta são as do motor (análise + revisão) e ficam na memória compartilhada.
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(3)
    expect(fake.calls.filter((call) => call.stage === "CALL_REVIEW")).toHaveLength(3)
    expect(investigation.evidence[0]!.analyzedCalls).toBe(3)
    expect(investigation.signals!.attribution).toBe("INDIVIDUAL_GAP")
    expect(investigation.tools!.planner.status).toBe("USED")
    expect(investigation.tools!.stopReason).toBe("NO_OPEN_QUESTION")
    // O executor do catálogo sempre recebe o sujeito/indicador/organização da EXECUÇÃO.
    expect(tools.invoked[0]!.scope).toMatchObject({ organizationId: ORG, personId: PERSON, indicatorCode: "TMA" })
    expect(tools.invoked[0]!.args).toMatchObject({ indicatorCode: "TMA", reference: "SUBGROUP" })
  })

  it("B) piora sem localização por assunto e grupo comparável no mesmo nível: a comparação do MÊS é contexto — o dia que a ferramenta revelou continua sendo pergunta; o diagnóstico não atribui a variação do mês à pessoa", async () => {
    const tools = catalogRunner({
      compare_population: () => ok({ reference: "SUBGROUP", targetValue: 450, referenceValue: 455, referencePopulation: 12, difference: -5, differencePercent: -1.1, performance: "EQUAL_TO_REFERENCE" }, "pares do Subgrupo (n=12)"),
      detect_anomalies: () => ok({ pattern: "ISOLATED_SPIKES", baseline: 410, pointsAnalyzed: 21, anomalySharePercent: 9.5, anomalies: [anomaly("2026-08-14"), anomaly("2026-08-15", 790)] }),
    })
    const { investigate, fake, memory } = setup({ tools: tools.runner, subjects: "UNLOCATED" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.localization.focus).toEqual([])
    // O resultado da ferramenta MUDA o diagnóstico do MÊS (sem lacuna individual)…
    expect(investigation.signals!.attribution).toBe("NO_INDIVIDUAL_GAP")
    expect(investigation.limitations.join(" ")).toMatch(/não pode ser tratada como deficiência individual/)
    // …mas não encerra a pergunta do DIA: depois da rodada 1, "o que houve nas chamadas de 14/08" segue aberta, com a comparação
    // como contexto (antes desta correção: NOT_MATERIAL e nenhuma chamada examinada).
    expect(investigation.slices!.map((slice) => `${slice.ref}:${slice.label}:${slice.origin.tool}`)).toEqual(["R1:dia 14/08:detect_anomalies", "R2:dia 15/08:detect_anomalies"])
    const afterRound1 = investigation.tools!.questionHistory!.find((entry) => entry.round === 1)!.questions.find((question) => question.id === "CALLS:R1")
    expect(afterRound1).toMatchObject({ status: "OPEN", material: true })
    expect(investigation.tools!.ledger.filter((entry) => entry.status === "OK").map((entry) => entry.tool)).toEqual(["compare_population", "detect_anomalies", "analyze_calls"])
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(3)
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "ANSWERED", resolution: { by: "MEMORY" } })
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R2")).toMatchObject({ status: "NO_DATA" })
    // …e chega à composição como FATO (com a origem), para o redator e para o verificador — com o limite de atribuição.
    const brief = buildIndicatorBrief(investigation, { documentVersions: new Map(), delivered: new Set(), factualWhenInconclusive: false })
    const facts = JSON.stringify(verificationFactsOf(brief))
    expect(facts).toMatch(/medição operacional.*EQUAL_TO_REFERENCE/i)
    expect(facts).toMatch(/ISOLATED_SPIKES/)
    expect(JSON.stringify(compositionPayloadOf(brief).facts)).toMatch(/deficiência individual/)
  })

  it("C) resultado bom com a memória já sustentando a prática: resolvido SEM nenhuma chamada de modelo (nem planejamento, nem análise)", async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const seeded = setup({ memory })
    for (const id of CALLS) await analyzeCall(seeded.analyze, { organizationId: ORG, interactionId: id, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    const fresh = fakeEngineModel()
    const { investigate } = setup({ memory, model: fresh.model, official: improved, subjects: "IMPROVED", tools: catalogRunner({}).runner })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(fresh.calls).toHaveLength(0)
    expect(investigation.tools!.stopReason).toBe("NO_OPEN_QUESTION")
    expect(investigation.tools!.planner.status).toBe("NOT_USED")
    expect(investigation.conclusion).toBe("STRENGTH_PATTERN")
  })
})

describe("ferramentas sem dado, indisponíveis ou recusadas = limitação, nunca conclusão", () => {
  it("falha de ferramenta, amostra insuficiente e pedido fora da lista ficam no registro e nas limitações; nada é concluído a partir deles", async () => {
    const tools = catalogRunner({
      compare_population: () => ({ data: { reference: "SUBGROUP", status: "POPULATION_TOO_SMALL" }, quality: { status: "INSUFFICIENT_SAMPLE", sampleCount: 2, coverage: null, freshness: null, note: "população abaixo do mínimo de privacidade" }, provenance: { population: "pares (n=2)", filters: [], dataSource: "MEASUREMENT" } }),
      detect_anomalies: () => {
        throw new Error("fonte indisponível")
      },
    })
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? { calls: [{ tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }, { tool: "detect_anomalies", args: {}, question: "WHERE" }, { tool: "analyze_interactions", args: {}, question: "CALLS" }] } : { calls: [], stop: { reason: "INSUFFICIENT_DATA", note: "Sem dados suficientes." } }) })
    const { investigate, memory } = setup({ model: model.model, tools: tools.runner, subjects: "UNLOCATED" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    const statuses = investigation.tools!.ledger.map((entry) => `${entry.tool}:${entry.status}`)
    expect(statuses).toEqual(expect.arrayContaining(["compare_population:OK", "detect_anomalies:FAILED"]))
    expect(investigation.tools!.planner.proposals[0]!.calls.find((call) => call.tool === "analyze_interactions")).toMatchObject({ accepted: false, reason: "ferramenta desconhecida: analyze_interactions" })
    expect(investigation.signals!.attribution).toBe("UNKNOWN")
    expect(investigation.limitations.join(" ")).toMatch(/compare_population: dado insuficiente/)
    expect(investigation.limitations.join(" ")).toMatch(/"detect_anomalies" não pôde ser feita/)
    expect(investigation.tools!.stopReason).toBe("PLANNER_INSUFFICIENT_DATA")
    expect(["INSUFFICIENT_DATA", "CHANGE_LOCATED_NO_CAUSE"]).toContain(investigation.conclusion)
  })
})

describe("permissões: capacidades do Agent, restrição do Workflow, estratégia, pessoa", () => {
  it("Agent com capacidades configuradas manda; o Workflow só RESTRINGE; sem ferramenta para o que está aberto, a investigação para com o MOTIVO", async () => {
    const tools = catalogRunner({ compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) })
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? { calls: [{ tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }] } : { calls: [], stop: { reason: "NO_USEFUL_TOOL", note: "x" } }) })
    const { investigate, memory } = setup({ model: model.model, tools: tools.runner, agentCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION", "OPERATIONAL_COMPARISON"] })
    const result = (await investigateIndicator(investigate, request({ allowedCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION"] }))).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.capabilities).toMatchObject({ source: "AGENT", capabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION"], removedByWorkflow: ["OPERATIONAL_COMPARISON"] })
    expect(investigation.tools!.availability.find((entry) => entry.tool === "compare_population")).toMatchObject({ available: false })
    expect(investigation.tools!.availability.find((entry) => entry.tool === "analyze_calls")).toMatchObject({ available: false })
    expect(tools.invoked).toHaveLength(0)
    expect(investigation.limitations.join(" ")).toMatch(/O Workflow restringiu/)
    // O que continua aberto (comparar com o grupo, olhar as chamadas do assunto) não tem ferramenta permitida: o planejador nem é
    // chamado, e o motivo fica registrado — nada é investigado "por fora".
    expect(model.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")).toHaveLength(0)
    expect(investigation.tools!.stopReason).toBe("NO_AVAILABLE_TOOL_FOR_OPEN_QUESTIONS")
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "NO_TOOL", reason: "análise de chamadas não permitida nesta execução" })
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CONTEXT")).toMatchObject({ status: "NO_TOOL" })
    // Workflow pedindo uma capacidade que o Agent não tem não a concede.
    const again = setup({ model: fakeEngineModel().model, tools: tools.runner, agentCapabilities: ["INDICATOR_ANALYSIS"] })
    const second = (await investigateIndicator(again.investigate, request({ allowedCapabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"] }))).investigations[0]!
    expect((await investigationOf(again.memory, second.runId)).tools!.capabilities.capabilities).toEqual(["INDICATOR_ANALYSIS"])
  })

  it("especialista SEM capacidades: nenhuma ferramenta — a estratégia publicada segue como PLANO DO CONTRATO (sem planejador), nunca como capacidade", async () => {
    const tools = catalogRunner({ compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) })
    const { investigate, memory, fake } = setup({ tools: tools.runner, agentCapabilities: [], strategy: strategyWith({ segmentation: true, sample: true, peers: true }) })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.capabilities).toMatchObject({ source: "NONE_CONFIGURED", capabilities: [] })
    expect(investigation.tools!.availability.every((entry) => !entry.available)).toBe(true)
    expect(investigation.tools!).toMatchObject({ plan: "CONTRACT", planReason: "NO_INVESTIGATION_CAPABILITIES", stopReason: "CONTRACT_PLAN_DONE" })
    expect(fake.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")).toHaveLength(0)
    expect(tools.invoked).toHaveLength(0)
    // O contrato da estratégia (assunto localizado + amostra pela MESMA análise da monitoria) continua: 3 análises, sem ferramenta.
    expect(investigation.tools!.ledger.map((entry) => `${entry.tool}:${entry.via}`)).toEqual(["analyze_calls:CONTRACT", "reference_practices:CONTRACT"])
    expect(fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(3)
    expect(investigation.tools!.mode).toBe("AUTONOMOUS")
  })

  it("estratégia em modo FIXO (escolha do admin): nenhuma chamada de planejamento — os passos das chaves pelo MESMO executor", async () => {
    const { investigate, memory, fake } = setup({ tools: catalogRunner({}).runner, strategy: strategyWith({ segmentation: true, sample: true, fixed: true }) })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(fake.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")).toHaveLength(0)
    expect(investigation.tools!).toMatchObject({ mode: "FIXED", plan: "CONTRACT", planReason: "STRATEGY_FIXED", stopReason: "FIXED_PLAN_DONE" })
    expect(investigation.tools!.ledger.map((entry) => entry.tool)).toEqual(["analyze_calls"])
  })

  it("pessoa: referência desconhecida é recusada antes de qualquer acesso; trava de colaborador barra análise mesmo pedida por ferramenta", async () => {
    const model = fakeEngineModel({ planner: (_payload, round) => (round === 1 ? { calls: [{ tool: "analyze_calls", args: { interactions: ["I99"], question: "x" }, question: "CALLS" }] } : { calls: [], stop: { reason: "NO_USEFUL_TOOL", note: "x" } }) })
    const { investigate, memory } = setup({ model: model.model, tools: catalogRunner({ compare_population: () => ok({}) }).runner })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.ledger[0]).toMatchObject({ tool: "analyze_calls", status: "REJECTED" })
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    const blocked = setup({ tools: catalogRunner({ compare_population: () => ok({}) }).runner, allowCollaborator: () => false })
    const run = (await investigateIndicator(blocked.investigate, request())).investigations[0]!
    const after = await investigationOf(blocked.memory, run.runId)
    expect(blocked.fake.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
    expect(after.limitations.join(" ")).toMatch(/não puderam ser analisadas/)
  })
})

describe("orçamento compartilhado: nenhuma chamada indireta de IA depois do limite", () => {
  it("teto de 3 chamadas: planejamento + análise + revisão gastam o mesmo orçamento; a segunda chamada analisada pela ferramenta é recusada sem tocar o modelo", async () => {
    const fake = fakeEngineModel()
    const meter = new EngineMeter({ maxModelCalls: 3, maxInputTokens: 10_000_000, maxOutputTokens: 10_000_000, maxCostUsd: null, maxDurationMs: 600_000, transientRetries: 1 })
    const { investigate, memory } = setup({ model: meteredModel(fake.model, meter), tools: catalogRunner({ compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) }).runner })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(fake.calls.map((call) => call.stage)).toEqual(["INVESTIGATION_PLANNING", "CALL_ANALYSIS", "CALL_REVIEW"])
    const summary = meter.summary()
    expect(summary).toMatchObject({ calls: 3, exhausted: "maxModelCalls" })
    expect(summary.refused).toBeGreaterThanOrEqual(1)
    expect(investigation.budget.stoppedBy).toBe("MODEL_BUDGET")
    expect(investigation.limitations.join(" ")).toMatch(/orçamento de IA da execução acabou/)
    // Interrompida pelo orçamento: fica registrada (e serve à mensagem desta execução), mas NÃO é reutilizada — a próxima
    // execução autorizada investiga de novo (e reaproveita a análise já paga).
    expect(investigation.completeness).toMatchObject({ status: "INTERRUPTED_BY_BUDGET" })
    expect(investigation.tools!.openQuestions.find((question) => question.id === "CALLS:R1")).toMatchObject({ status: "BUDGET" })
    const next = (await investigateIndicator({ ...investigate, analyze: { ...investigate.analyze, model: fakeEngineModel().model } }, request())).investigations[0]!
    expect(next.reused).toBe(false)
    expect(next.runId).not.toBe(result.runId)
  })
  it("falha transitória do provedor: a nova tentativa é uma chamada CONTADA; consumo desconhecido conta a reserva, nunca zero", async () => {
    let attempts = 0
    const flaky: EngineModelPort = { async generate() {
      attempts += 1
      if (attempts === 1) throw Object.assign(new Error("503"), { name: "DomainError", code: "AI_PROVIDER_ERROR", details: { category: "PROVIDER_ERROR" } })
      return { text: "{}", model: "fake", usage: null, durationMs: 1, costUsd: null, finishReason: "STOP" }
    } }
    const { DomainError } = await import("../../../shared/domain/domain-error.js")
    const transient: EngineModelPort = { async generate(request) {
      attempts += 1
      if (attempts === 1) throw new DomainError("503", "AI_PROVIDER_ERROR", 503, { category: "PROVIDER_ERROR" })
      return flaky.generate(request)
    } }
    const meter = new EngineMeter({ maxModelCalls: 5, maxInputTokens: 1_000_000, maxOutputTokens: 1_000_000, maxCostUsd: null, maxDurationMs: 60_000, transientRetries: 1 })
    await meteredModel(transient, meter).generate({ stage: "COMPOSITION", systemPrompt: "x".repeat(300), contents: [{ role: "user", text: "y" }], responseSchema: {} })
    const summary = meter.summary()
    expect(summary.calls).toBe(2)
    expect(summary.retries).toBe(1)
    expect(summary.unknownUsage).toBe(2)
    expect(summary.outputTokens).toBeGreaterThan(0)
  })
})

describe("mesma análise entre monitoria e indicador; produção × sobreposição", () => {
  it("chamada já analisada pela MONITORIA é reaproveitada pela investigação (nenhuma análise nova dela, nenhuma contagem dobrada)", async () => {
    const memory = createInMemoryFeedbackMemoryStore()
    const monitoring = setup({ memory })
    await analyzeCall(monitoring.analyze, { organizationId: ORG, interactionId: CALLS[0]!, collaboratorId: PERSON, agentId: AGENT, trigger: { kind: "EVALUATION", selectionReason: "monitoria" } })
    const fresh = fakeEngineModel()
    const { investigate } = setup({ memory, model: fresh.model, tools: catalogRunner({ compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) }).runner })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(fresh.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(2)
    expect(memory.assessments.filter((entry) => entry.snapshot.interactionId === CALLS[0])).toHaveLength(1)
    expect(investigation.budget).toMatchObject({ callAnalyses: 2, reusedCalls: 1 })
  })
  it("produção (memória direta) e simulação (memória sobreposta) chegam à mesma investigação com as mesmas ferramentas", async () => {
    const script = { compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }) }
    const direct = setup({ tools: catalogRunner(script).runner })
    const directRun = (await investigateIndicator(direct.investigate, request())).investigations[0]!
    const base = createInMemoryFeedbackMemoryStore()
    const overlay = createOverlayFeedbackMemoryStore(base, createInMemoryFeedbackMemoryStore())
    const simulated = setup({ memory: overlay, tools: catalogRunner(script).runner })
    const simulatedRun = (await investigateIndicator(simulated.investigate, request())).investigations[0]!
    const a = await investigationOf(direct.memory, directRun.runId)
    const b = await investigationOf(overlay, simulatedRun.runId)
    expect(b.conclusion).toBe(a.conclusion)
    expect(b.tools!.ledger.map((entry) => `${entry.tool}:${entry.status}`)).toEqual(a.tools!.ledger.map((entry) => `${entry.tool}:${entry.status}`))
    expect(b.evidence.map((entry) => entry.analyzedCalls)).toEqual(a.evidence.map((entry) => entry.analyzedCalls))
    expect(base.assessments).toHaveLength(0)
  })
})
