import { readFileSync } from "node:fs"
import { ZodError } from "zod"
import { describe, expect, it } from "vitest"

import { DomainError } from "../../../shared/domain/domain-error.js"
import { parseCompleteGraph, parseDraftGraph } from "./draft-graph.js"
import { flowGraphSchema, type FlowGraph } from "./graph-schema.js"

const position = { x: 0, y: 0 }
const trigger = { id: "trigger", type: "trigger", label: "Início", position, config: {} }
const end = { id: "end", type: "end", label: "Fim", position, config: {} }
const graphWith = (...nodes: unknown[]) => ({ nodes: [trigger, ...nodes, end], edges: [] })
const node = (id: string, type: string, config: unknown, label = "Etapa") => ({ id, type, label, position, config })

const AGENT_ID = "a9289ac2-756c-4ecb-92c8-9c85964b8ae4"
const blankHistorical = { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 0, period: { kind: "ROLLING_DAYS", days: 7 } }

/** Como o editor cria cada etapa (workflow-editor-page.tsx › defaultConfigFor e os formulários que trocam de modo). */
const AS_THE_EDITOR_CREATES: [string, string, unknown][] = [
  ["Chamar agente", "action", { actionType: "CALL_AGENT", agentId: "" }],
  ["Gerar feedback", "action", { actionType: "GENERATE_FEEDBACK", sourceNodeId: "", feedbackDomain: "AUTO" }],
  ["Definir variável", "action", { actionType: "SET_VARIABLE", variableId: "", value: true }],
  ["Definir variável dinâmica", "action", { actionType: "SET_VARIABLE", variableId: AGENT_ID, sourcePath: "" }],
  ["Escalonar sem pessoa nem destino", "action", { actionType: "ESCALATE", target: { type: "SPECIFIC_USER", userId: "" }, surfaces: [] }],
  ["Orquestrador", "orchestrator", { orchestratorId: "", instruction: "" }],
  ["Orquestrador por domínios", "orchestrator", { orchestratorId: AGENT_ID, instruction: "Analise.", routing: { mode: "DOMAINS", businessDomainIds: [] } }],
  ["Revisão de pessoa específica", "human_review", { reviewTarget: { type: "SPECIFIC_USER", userId: "" } }],
  ["Revisão relativa à anterior", "human_review", { reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "" } }],
  ["Output", "output", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "" }],
  ["Output para pessoa, sem destino", "output", { target: { type: "USER", userId: "" }, surfaces: [], source: "nodeOutputs.trigger" }],
  ["Política", "intervention_policy", { policyId: "", mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [] }],
  ["Condição em Agenda", "condition", { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null, historicalQuery: blankHistorical }],
  ["Condição sobre nó anterior", "condition", { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, sourcePath: "" }],
  ["Condição em grupo", "condition", { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, group: { operator: "ALL", rules: [{ comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, sourcePath: "" }] } }],
  ["Selecionar colaboradores", "select_employees", { criterion: { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null, historicalQuery: blankHistorical } }],
  ["Selecionar por ranking", "select_employees", { selectionMode: "RANKING", ranking: { indicatorCode: "" } }],
]

describe("parseDraftGraph — o rascunho aceita o que ainda vai ser preenchido", () => {
  it.each(AS_THE_EDITOR_CREATES)("%s: salva, e os brancos continuam em branco", (_name, type, config) => {
    const raw = graphWith(node("n", type, config))
    expect(flowGraphSchema.safeParse(raw).success).toBe(false)
    const parsed = parseDraftGraph(raw)
    expect(parsed.nodes[1]?.config).toEqual(config)
    expect(JSON.stringify(parsed)).not.toContain("00000000-0000-4000-8000-000000000000")
    expect(JSON.stringify(parsed)).not.toContain("preenchido")
    expect(JSON.stringify(parsed)).not.toContain("PREENCHIDO")
  })

  it("espaços em branco contam como vazio e ficam gravados como vazio", () => {
    const parsed = parseDraftGraph(graphWith(node("n", "output", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "   " })))
    expect((parsed.nodes[1]?.config as { source: string }).source).toBe("")
  })

  it("só o branco é tolerado: valor inválido, campo ausente e tipo desconhecido continuam recusados", () => {
    expect(() => parseDraftGraph(graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: "nao-e-uuid" })))).toThrow(ZodError)
    expect(() => parseDraftGraph(graphWith(node("n", "action", { actionType: "CALL_AGENT" })))).toThrow(ZodError)
    expect(() => parseDraftGraph(graphWith(node("n", "output", { target: { type: "USER", userId: "" }, surfaces: ["NAO_EXISTE"], source: "" })))).toThrow(ZodError)
    expect(() => parseDraftGraph(graphWith(node("n", "tipo_inexistente", {})))).toThrow(ZodError)
    expect(() => parseDraftGraph({ nodes: "nada", edges: [] })).toThrow(ZodError)
  })

  it("continua normalizando como o schema completo: remove campo desconhecido e apara texto", () => {
    const parsed = parseDraftGraph(graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: "", campoNovo: 1, instruction: "  Missão  " })))
    expect(parsed.nodes[1]?.config).toEqual({ actionType: "CALL_AGENT", agentId: "", instruction: "Missão" })
  })

  it("grafo completo passa igual ao schema completo", () => {
    const raw = graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: AGENT_ID }))
    expect(parseDraftGraph(raw)).toEqual(flowGraphSchema.parse(raw))
  })

  it("campo desconhecido com nome de campo tolerado é removido, sem erro, em qualquer profundidade", () => {
    const nested = graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: "", extra: { source: "", itens: [{ agentId: "" }] } }))
    expect(parseDraftGraph(nested).nodes[1]?.config).toEqual({ actionType: "CALL_AGENT", agentId: "" })
    const onTrigger = { nodes: [{ ...trigger, config: { source: "", surfaces: [] } }, end], edges: [] }
    expect(parseDraftGraph(onTrigger).nodes[0]?.config).toEqual({})
  })

  it("não altera o objeto recebido", () => {
    const raw = graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: "" }))
    const copy = structuredClone(raw)
    parseDraftGraph(raw)
    expect(raw).toEqual(copy)
  })

  it("os 22 modelos oficiais continuam idênticos ao schema completo", () => {
    const models = JSON.parse(readFileSync(new URL("../testing/official-model-workflows.json", import.meta.url), "utf8")) as { graph: unknown }[]
    expect(models.length).toBe(22)
    for (const model of models) expect(parseDraftGraph(model.graph)).toEqual(flowGraphSchema.parse(model.graph))
  })
})

describe("parseCompleteGraph — publicar e simular exigem tudo preenchido", () => {
  const refusal = (raw: unknown) => {
    try {
      parseCompleteGraph(raw)
    } catch (error) {
      return error as DomainError
    }
    throw new Error("deveria ter recusado")
  }

  it.each(AS_THE_EDITOR_CREATES)("%s: recusa apontando a etapa e o que falta", (_name, type, config) => {
    const error = refusal(graphWith(node("n", type, config, "Minha etapa")))
    expect(error).toBeInstanceOf(DomainError)
    expect(error.code).toBe("VALIDATION_ERROR")
    expect(error.statusCode).toBe(422)
    expect(error.details).toEqual({ nodeId: "n" })
    expect(error.message).toMatch(/^Em "Minha etapa", (escolha|preencha) .+\.$/)
  })

  it("etapa sem nome nunca vira aspas vazias", () => {
    const error = refusal(graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: "" }, "")))
    expect(error.message).toBe("Em uma etapa ainda sem nome, escolha o agente.")
    expect(error.details).toEqual({ nodeId: "n" })
  })

  it("aponta a primeira etapa incompleta na ordem do fluxo salvo", () => {
    const error = refusal(graphWith(node("primeira", "output", { target: { type: "CURRENT_OPERATOR" }, surfaces: [], source: "x" }), node("segunda", "action", { actionType: "CALL_AGENT", agentId: "" })))
    expect(error.details).toEqual({ nodeId: "primeira" })
    expect(error.message).toContain("escolha onde entregar")
  })

  it("dado inválido sem ser branco também recusa como erro de domínio, apontando a etapa", () => {
    const error = refusal(graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: "nao-e-uuid" })))
    expect(error).toBeInstanceOf(DomainError)
    expect(error.details).toEqual({ nodeId: "n" })
    expect(error.message).toContain("revise a configuração")
  })

  it("grafo completo devolve o mesmo resultado do schema completo", () => {
    const raw = graphWith(node("n", "action", { actionType: "CALL_AGENT", agentId: AGENT_ID }))
    const graph: FlowGraph = parseCompleteGraph(raw)
    expect(graph).toEqual(flowGraphSchema.parse(raw))
  })

  it("o que parseDraftGraph gravou, parseCompleteGraph recusa: rascunho incompleto nunca chega a uma versão", () => {
    const stored = parseDraftGraph(graphWith(node("n", "intervention_policy", { policyId: "", mode: "RECOMMEND_ONLY", analysisSourceNodeIds: [] })))
    expect(() => parseCompleteGraph(JSON.parse(JSON.stringify(stored)))).toThrow(DomainError)
  })
})

describe("parseDraftGraph — chave __proto__ no corpo do rascunho", () => {
  it("nunca alcança Object.prototype: o branco só volta em campo próprio do resultado", () => {
    // JSON.parse cria `__proto__` como chave própria, como o corpo de uma requisição. O schema a remove; devolver o branco por
    // esse caminho escreveria em Object.prototype.
    const config = JSON.parse('{"actionType":"CALL_AGENT","agentId":"","__proto__":{"toString":"","hasOwnProperty":""}}') as unknown
    const before = { toString: Object.prototype.toString, hasOwnProperty: Object.prototype.hasOwnProperty }
    try {
      const parsed = parseDraftGraph(graphWith(node("agent", "action", config)))
      expect(Object.prototype.toString).toBe(before.toString)
      expect(Object.prototype.hasOwnProperty).toBe(before.hasOwnProperty)
      expect(parsed.nodes.find((item) => item.id === "agent")?.config).toMatchObject({ actionType: "CALL_AGENT", agentId: "" })
    } finally {
      Object.prototype.toString = before.toString
      Object.prototype.hasOwnProperty = before.hasOwnProperty
    }
  })
})
