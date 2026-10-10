import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { resolveEngineCapabilities } from "../domain/investigation-toolbox.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { catalogRunner, FULL_CAPABILITIES, investigationOf, ok, request, setup, strategyWith } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * CAPACIDADES EXPLICITAMENTE DESLIGADAS (`ENGINE_INVESTIGATION_TOOLS_V2`) — sem IA.
 *
 * DEFEITO REPRODUZIDO (antes desta versão): `agentCapabilities: []`, nenhuma estratégia, nenhuma restrição do Workflow → cinco
 * capacidades habilitadas automaticamente (`LEGACY_DEFAULT_NO_STRATEGY`). Regra final: lista vazia = nenhuma ferramenta (contrato
 * da coluna desde a migration 074); Workflow e estratégia só restringem; o plano do CONTRATO da estratégia não é ferramenta.
 */
const everything = { compare_population: () => ok({ performance: "WORSE_THAN_REFERENCE" }), detect_anomalies: () => ok({ anomalies: [] }), segment_indicator: () => ok({ dimension: "DAY", buckets: [] }), query_knowledge: () => ok({ excerpts: [] }) }

describe("lista vazia é desligamento, nunca fallback", () => {
  it("DEFEITO REPRODUZIDO: [] + sem estratégia + sem restrição → nenhuma capacidade, nenhuma ferramenta, nenhum planejador, nenhuma análise", async () => {
    expect(resolveEngineCapabilities({ agentCapabilities: [], workflowAllowed: null })).toMatchObject({ capabilities: [], source: "NONE_CONFIGURED" })
    const tools = catalogRunner(everything)
    const { investigate, memory, fake } = setup({ tools: tools.runner, agentCapabilities: [], subjects: "STABLE" })
    const result = (await investigateIndicator(investigate, request())).investigations[0]!
    const investigation = await investigationOf(memory, result.runId)
    expect(investigation.tools!.capabilities).toMatchObject({ capabilities: [], source: "NONE_CONFIGURED" })
    expect(investigation.tools!.availability.filter((entry) => entry.available)).toEqual([])
    expect(investigation.tools!).toMatchObject({ plan: "CONTRACT", planReason: "NO_INVESTIGATION_CAPABILITIES" })
    // Sem estratégia publicada, o contrato também não analisa chamadas (custa IA e não foi autorizado por ninguém).
    expect(investigation.tools!.contract).toMatchObject({ source: "NO_STRATEGY", callAnalysis: { allowed: false } })
    expect(tools.invoked).toHaveLength(0)
    expect(fake.calls).toHaveLength(0)
  })

  it("configuração LEGADA (perfil sem o campo) segue a compatibilidade documentada: igual à lista vazia", async () => {
    const tools = catalogRunner(everything)
    const { investigate, memory, fake } = setup({ tools: tools.runner, agentCapabilities: "MISSING_FIELD" })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.capabilities).toMatchObject({ capabilities: [], source: "NONE_CONFIGURED" })
    expect(tools.invoked).toHaveLength(0)
    expect(fake.calls.filter((call) => call.stage === "INVESTIGATION_PLANNING")).toHaveLength(0)
  })
})

describe("o Workflow só restringe", () => {
  it("restrição VAZIA do Workflow impede ferramentas — e também os passos do contrato que dependem de capacidade", async () => {
    const tools = catalogRunner(everything)
    const { investigate, memory, fake } = setup({ tools: tools.runner, strategy: strategyWith({ segmentation: true, sample: true, peers: true }) })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request({ allowedCapabilities: [] }))).investigations[0]!.runId)
    expect(investigation.tools!.capabilities.capabilities).toEqual([])
    expect([...investigation.tools!.capabilities.removedByWorkflow].sort()).toEqual([...FULL_CAPABILITIES].sort())
    expect(investigation.tools!.contract).toMatchObject({ localization: { allowed: false }, callAnalysis: { allowed: false, reason: "o Workflow restringiu a análise de chamadas nesta execução" }, reference: { allowed: false } })
    expect(tools.invoked).toHaveLength(0)
    expect(fake.calls).toHaveLength(0)
  })

  it("restrição PARCIAL funciona por interseção (e nunca concede o que o Agent não tem)", async () => {
    const { investigate, memory } = setup({ tools: catalogRunner(everything).runner })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request({ allowedCapabilities: ["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS", "WORK_CONTEXT"] }))).investigations[0]!.runId)
    expect(investigation.tools!.capabilities.capabilities).toEqual(["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"])
    const available = investigation.tools!.availability.filter((entry) => entry.available).map((entry) => entry.tool)
    expect(available).toContain("analyze_calls")
    expect(available).not.toContain("compare_population")
    expect(available).not.toContain("inspect_work_context")
  })
})

describe("pedido fora da permissão nunca executa", () => {
  it("o planejador pede ferramentas não permitidas: todas recusadas ANTES de consultar dado ou consumir IA", async () => {
    const tools = catalogRunner(everything)
    const model = fakeEngineModel({ planner: (payload, round) => (round === 1 ? { calls: [{ tool: "compare_population", args: { reference: "SUBGROUP" }, question: "CONTEXT" }, { tool: "analyze_calls", args: { interactions: ["I1", "I2"] }, question: "WHERE" }, { tool: "query_knowledge", args: { query: "prazo" }, question: "WHERE" }] } : { calls: [], stop: { reason: "NO_USEFUL_TOOL", note: `ofertas: ${payload.tools.map((tool) => tool.tool).join(",")}` } }) })
    const { investigate, memory } = setup({ model: model.model, tools: tools.runner, subjects: "STABLE", agentCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION"] })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.planner.proposals[0]!.calls.map((call) => `${call.tool}:${call.accepted}:${call.reason}`)).toEqual([
      "compare_population:false:capacidade OPERATIONAL_COMPARISON não permitida nesta execução",
      "analyze_calls:false:capacidade INTERACTION_ANALYSIS não permitida nesta execução",
      "query_knowledge:false:capacidade KNOWLEDGE não permitida nesta execução",
    ])
    expect(tools.invoked).toHaveLength(0)
    expect(model.calls.filter((call) => call.stage === "CALL_ANALYSIS")).toHaveLength(0)
  })

  it("nenhuma concessão indireta: estratégia com todas as seções não dá ferramenta; ferramenta semântica não abre outras", async () => {
    const tools = catalogRunner(everything)
    const { investigate, memory } = setup({ tools: tools.runner, agentCapabilities: ["INTERACTION_ANALYSIS"], strategy: strategyWith({ segmentation: true, sample: true, peers: true }) })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.tools!.capabilities.capabilities).toEqual(["INTERACTION_ANALYSIS"])
    const availability = new Map(investigation.tools!.availability.map((entry) => [entry.tool, entry]))
    expect(availability.get("analyze_calls")!.available).toBe(true)
    for (const tool of ["segment_indicator", "compare_population", "query_knowledge", "detect_anomalies", "reference_practices"] as const) expect(availability.get(tool)).toMatchObject({ available: false })
    expect(tools.invoked.map((entry) => entry.tool)).not.toContain("segment_indicator")
  })
})

describe("segmentação sem dimensão (rodada real V9 — corrigido depois, não revalidado com modelo)", () => {
  it("dimensão AUSENTE com uma só permitida pela estratégia vem da configuração; dimensão errada continua recusada", async () => {
    const plannerCalls = (dimension: string | null) => fakeEngineModel({ planner: (_payload, round) => (round === 1 ? { calls: [{ tool: "segment_indicator", args: dimension ? { dimension } : {}, question: "WHERE" }] } : { calls: [], stop: { reason: "SUFFICIENT", note: "Os fatos bastam." } }) })
    const missing = catalogRunner(everything)
    const first = setup({ model: plannerCalls(null).model, tools: missing.runner, strategy: strategyWith({ segmentation: true }), subjects: "STABLE" })
    await investigateIndicator(first.investigate, request())
    expect(missing.invoked.find((call) => call.tool === "segment_indicator")?.args).toMatchObject({ dimension: "SUBJECT" })
    const wrong = catalogRunner(everything)
    const second = setup({ model: plannerCalls("DAY").model, tools: wrong.runner, strategy: strategyWith({ segmentation: true }), subjects: "STABLE" })
    const investigation = await investigationOf(second.memory, (await investigateIndicator(second.investigate, request())).investigations[0]!.runId)
    expect(wrong.invoked.some((call) => call.tool === "segment_indicator")).toBe(false)
    expect(investigation.tools!.ledger.find((entry) => entry.tool === "segment_indicator")).toMatchObject({ status: "REJECTED" })
  })
})
