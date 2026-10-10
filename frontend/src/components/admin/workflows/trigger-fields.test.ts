import { describe, expect, it } from "vitest"
import { analyzeTriggerKindChangeImpact } from "./trigger-fields"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

const position = { x: 0, y: 0 }

function graphWithConditions(...conditions: FlowGraph["nodes"]): FlowGraph {
  return { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position, config: {} }, ...conditions], edges: [] }
}

const legacyTriggerValueCondition: FlowGraph["nodes"][number] = {
  id: "cond-1",
  type: "condition",
  label: "Valor do gatilho",
  position,
  config: { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null },
}

const historicalCondition: FlowGraph["nodes"][number] = {
  id: "cond-2",
  type: "condition",
  label: "Histórico",
  position,
  config: {
    comparator: "LT",
    thresholdNumeric: 3.3,
    historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 7 } },
  },
}

describe("analyzeTriggerKindChangeImpact — troca de tipo de Gatilho (Parte 37-42)", () => {
  it("Agenda·Consolidado → Flag de canal: conflito de Estrutura Consolidada", () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "channel_flag", channelFlagId: "flag-1" },
      consolidatedStructure: { kind: "SUPERVISOR_TEAM" },
      populationFilter: null,
    })
    expect(impacts).toHaveLength(1)
    expect(impacts[0]!.message).toContain("Estrutura Consolidada")
  })

  it("Agenda·Consolidado → Agenda·Relativa: conflito específico (jornada é sempre individual)", () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "schedule", mode: "RELATIVE_TO_SHIFT", intervalDays: 1 },
      consolidatedStructure: { kind: "TEAM" },
      populationFilter: null,
    })
    expect(impacts).toHaveLength(1)
    expect(impacts[0]!.message).toContain("sempre individuais")
  })

  it("Agenda·Consolidado → Agenda·Calendário: sem conflito (Consolidado continua válido)", () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1 },
      consolidatedStructure: { kind: "TEAM" },
      populationFilter: null,
    })
    expect(impacts).toEqual([])
  })

  it("Filtro Populacional configurado → Indicador: conflito (Filtro só existe pra Agenda)", () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "indicator", indicatorCode: "NOTA_URA" },
      consolidatedStructure: null,
      populationFilter: { kind: "SUPERVISOR_TEAM" },
    })
    expect(impacts).toHaveLength(1)
    expect(impacts[0]!.message).toContain("Filtro Populacional")
  })

  it('Filtro Populacional "Todos" nunca conta como conflito, mesmo trocando pra Indicador', () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "indicator", indicatorCode: "NOTA_URA" },
      consolidatedStructure: null,
      populationFilter: { kind: "ALL" },
    })
    expect(impacts).toEqual([])
  })

  it('Condition em modo "Valor do gatilho" → Agenda: conflito (Agenda não fornece valor disparado)', () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(legacyTriggerValueCondition),
      newTrigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1 },
      consolidatedStructure: null,
      populationFilter: null,
    })
    expect(impacts).toHaveLength(1)
    expect(impacts[0]!.nodeId).toBe("cond-1")
    expect(impacts[0]!.message).toContain("Valor do gatilho")
  })

  it("Condition de Histórico nunca conta como conflito ao trocar pra Agenda (já não usa valor do gatilho)", () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1 },
      consolidatedStructure: null,
      populationFilter: null,
    })
    expect(impacts).toEqual([])
  })

  it("Flag → Indicador sem nenhuma Estrutura/Filtro/Condition problemática: nenhum conflito", () => {
    const impacts = analyzeTriggerKindChangeImpact({
      graph: graphWithConditions(historicalCondition),
      newTrigger: { kind: "indicator", indicatorCode: "NOTA_URA" },
      consolidatedStructure: null,
      populationFilter: null,
    })
    expect(impacts).toEqual([])
  })
})

describe("Gatilho Manual — formulário", async () => {
  const { isTriggerComplete, triggerToInput } = await import("./trigger-fields")

  it("só está completo com o indicador quando o contexto é medição", () => {
    expect(isTriggerComplete({ kind: "manual", context: "INTERACTION" })).toBe(true)
    expect(isTriggerComplete({ kind: "manual", context: "COLLABORATOR" })).toBe(true)
    expect(isTriggerComplete({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "" })).toBe(false)
    expect(isTriggerComplete({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" })).toBe(true)
  })

  it("converte o gatilho salvo de volta para o formulário sem o que não pertence ao contexto", () => {
    expect(triggerToInput({ kind: "manual", context: "INTERACTION" })).toEqual({ kind: "manual", context: "INTERACTION" })
    expect(triggerToInput({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS" })).toEqual({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" })
  })

  it("trocar para Manual sem medição avisa a Condition sobre o valor do gatilho; com medição, não", () => {
    const graph = graphWithConditions(legacyTriggerValueCondition, historicalCondition)
    expect(analyzeTriggerKindChangeImpact({ graph, newTrigger: { kind: "manual", context: "INTERACTION" }, consolidatedStructure: null, populationFilter: null }).map((impact) => impact.nodeId)).toEqual(["cond-1"])
    expect(analyzeTriggerKindChangeImpact({ graph, newTrigger: { kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: "TMA" }, consolidatedStructure: null, populationFilter: null })).toEqual([])
    expect(analyzeTriggerKindChangeImpact({ graph: graphWithConditions(), newTrigger: { kind: "manual", context: "COLLABORATOR" }, consolidatedStructure: { kind: "TEAM" }, populationFilter: null })[0]!.message).toMatch(/Manual executa para um colaborador/)
  })
})
