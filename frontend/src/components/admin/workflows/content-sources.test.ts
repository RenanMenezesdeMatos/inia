import { describe, expect, it } from "vitest"
import {
  decodeSourcePath,
  decodeStructuredFieldPath,
  describeWholeResultOrigin,
  encodeSourcePath,
  encodeStructuredFieldPath,
  encodeVariableSourcePath,
  mapOutputFieldTypeToVariableType,
  resolveDynamicValueSources,
  resolveStructuredFields,
} from "./content-sources"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"

describe("describeWholeResultOrigin", () => {
  it("não repete o prefixo do rótulo da lista na frase", () => {
    expect(describeWholeResultOrigin("Resultado de: Agente de Feedback")).toBe("de Agente de Feedback")
    expect(describeWholeResultOrigin("Feedback confiável: Gerar feedback")).toBe("de Feedback confiável: Gerar feedback")
    expect(describeWholeResultOrigin(undefined)).toBe("da origem selecionada")
  })
})

describe("encode/decodeSourcePath", () => {
  it("round-trips a node path with a field", () => {
    expect(decodeSourcePath(encodeSourcePath("orch", "structuredResult.diagnosis.severity"))).toEqual({
      kind: "node",
      nodeId: "orch",
      field: "structuredResult.diagnosis.severity",
    })
  })

  it("round-trips a node path without a field", () => {
    expect(decodeSourcePath(encodeSourcePath("agent-1", ""))).toEqual({ kind: "node", nodeId: "agent-1", field: "" })
  })

  it("round-trips a variable path, including the not-yet-selected state", () => {
    expect(decodeSourcePath(encodeVariableSourcePath("var-1"))).toEqual({ kind: "variable", variableId: "var-1" })
    expect(decodeSourcePath(encodeVariableSourcePath(""))).toEqual({ kind: "variable", variableId: "" })
  })

  it("returns null for a path matching neither convention", () => {
    expect(decodeSourcePath("")).toBeNull()
    expect(decodeSourcePath("somethingElse.foo")).toBeNull()
  })
})

describe("encode/decodeStructuredFieldPath", () => {
  it("round-trips a structured field's relative path", () => {
    const path = encodeStructuredFieldPath("orch", "diagnosis.severity")
    const decoded = decodeSourcePath(path)
    expect(decoded?.kind).toBe("node")
    if (decoded?.kind !== "node") throw new Error("expected node")
    expect(decodeStructuredFieldPath(decoded.field)).toBe("diagnosis.severity")
  })

  it("returns null for a field that isn't under structuredResult", () => {
    expect(decodeStructuredFieldPath("feedback.text")).toBeNull()
  })
})

describe("resolveStructuredFields", () => {
  const orchestrator: Orchestrator = {
    id: "orch-def",
    name: "Monitoria",
    active: true,
    recommendSupportMaterials: false,
    createdAt: "2026-01-01T00:00:00Z",
    scopeType: "ALL_TEAMS",
    teamId: null,
    teamName: null,
    subteamId: null,
    subteamName: null,
    orchestratorAgentId: "agent-orch",
    orchestratorAgentName: "Agente Orquestrador",
    specialists: [],
    invocationMode: "BOTH",
    policyKind: null,
    policyDomains: [],
    routingPolicy: null,
    routingDomains: [],
    businessDomains: [],
    structuredOutput: null,
    structuredOutputSource: "LEGACY_SCHEMA",
    structuredOutputReview: null,
    structuredOutputFields: null,
    outputInstructions: null,
    outputSchema: [{ key: "diagnosis", label: "Diagnóstico", fields: [{ key: "severity", label: "Severidade", type: "STRING", enumValues: ["LOW", "CRITICAL"] }] }],
  }
  const graph: FlowGraph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "orch", type: "orchestrator", label: "Orquestrador", position: { x: 0, y: 160 }, config: { orchestratorId: "orch-def", instruction: "Analise." } },
    ],
    edges: [],
  }

  it("flattens the orchestrator's output_schema when the node is an orchestrator with a known schema", () => {
    const fields = resolveStructuredFields(graph, "orch", new Map([["orch-def", orchestrator]]))
    expect(fields).toEqual([{ path: "diagnosis.severity", label: "Diagnóstico › Severidade", type: "STRING", enumValues: ["LOW", "CRITICAL"], description: undefined }])
  })

  it("returns undefined when the orchestrator has no output_schema configured (legacy fallback)", () => {
    const fields = resolveStructuredFields(graph, "orch", new Map([["orch-def", { ...orchestrator, outputSchema: null }]]))
    expect(fields).toBeUndefined()
  })

  it("returns undefined for a node that isn't an orchestrator", () => {
    expect(resolveStructuredFields(graph, "trigger", new Map())).toBeUndefined()
  })
})

describe("resolveDynamicValueSources (evolução de Variáveis do Workflow — Parte 6/7)", () => {
  const graph: FlowGraph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", type: "action", label: "Agente", position: { x: 0, y: 160 }, config: { actionType: "CALL_AGENT", agentId: "agent-def" } },
      { id: "action", type: "action", label: "Definir variável", position: { x: 0, y: 320 }, config: { actionType: "SET_VARIABLE", variableId: "var-1", value: true } },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "agent" },
      { id: "e2", source: "agent", sourceHandle: "always", target: "action" },
    ],
  }
  const agent = { id: "agent-def", name: "Agente de Feedback" } as Agent

  it("sempre inclui 'Valor do gatilho' no topo, mesmo sem nenhum agente/orquestrador ancestral", () => {
    const sources = resolveDynamicValueSources(graph, "action", new Map(), new Map())
    expect(sources[0]).toEqual({ nodeId: "trigger", label: "Valor do gatilho" })
  })

  it("soma as mesmas fontes de resolveContentSources depois do gatilho", () => {
    const sources = resolveDynamicValueSources(graph, "action", new Map([["agent-def", agent]]), new Map())
    expect(sources).toEqual([{ nodeId: "trigger", label: "Valor do gatilho" }, { nodeId: "agent", label: "Resultado de: Agente de Feedback" }])
  })
})

describe("mapOutputFieldTypeToVariableType (Parte 10 — compatibilidade de tipo)", () => {
  it("mapeia STRING/NUMBER/BOOLEAN pros tipos de Workflow Variable correspondentes", () => {
    expect(mapOutputFieldTypeToVariableType("STRING")).toBe("TEXT")
    expect(mapOutputFieldTypeToVariableType("NUMBER")).toBe("NUMERIC")
    expect(mapOutputFieldTypeToVariableType("BOOLEAN")).toBe("BOOLEAN")
  })

  it("ARRAY nunca tem tipo de variável compatível", () => {
    expect(mapOutputFieldTypeToVariableType("ARRAY")).toBeUndefined()
  })
})

describe("resolveStructuredFields — fonte única (structuredOutputFields do backend)", () => {
  it("prefere o catálogo achatado do backend (com ENUM rotulado e Sim/Não) ao formato legado", () => {
    const graph: FlowGraph = {
      nodes: [{ id: "orch", type: "orchestrator", label: "Orquestrador", position: { x: 0, y: 0 }, config: { orchestratorId: "orch-def", instruction: "Analise." } }],
      edges: [],
    }
    const orchestrator = {
      id: "orch-def",
      name: "Atendimento multidomínio",
      active: true,
      recommendSupportMaterials: false,
      createdAt: "2026-01-01T00:00:00Z",
      scopeType: "ALL_TEAMS" as const,
      teamId: null,
      teamName: null,
      subteamId: null,
      subteamName: null,
      orchestratorAgentId: "agent-orch",
      orchestratorAgentName: "Coordenador",
      specialists: [],
      invocationMode: "WORKFLOW" as const,
      outputInstructions: "gerado",
      outputSchema: [{ key: "legado", label: "Legado", fields: [{ key: "x", label: "X", type: "STRING" as const }] }],
      policyKind: null,
      policyDomains: [],
      routingPolicy: "OPEN" as const,
      routingDomains: [],
      businessDomains: [],
      structuredOutput: null,
      structuredOutputSource: "DEFINITION" as const,
      structuredOutputReview: null,
      structuredOutputFields: [
        { path: "analise.severidade", label: "Análise › Severidade", type: "STRING" as const, fieldType: "ENUM" as const, required: false, enumValues: ["BAIXA", "ALTA"], enumOptions: [{ value: "BAIXA", label: "Baixa" }, { value: "ALTA", label: "Alta" }] },
        { path: "analise.requerAcompanhamento", label: "Análise › Requer acompanhamento", type: "BOOLEAN" as const, fieldType: "BOOLEAN" as const, required: false },
        { path: "analise.nota", label: "Análise › Nota", type: "NUMBER" as const, fieldType: "NUMBER" as const, required: false },
      ],
    }
    const fields = resolveStructuredFields(graph, "orch", new Map([["orch-def", orchestrator]]))
    expect(fields?.map((field) => field.label)).toEqual(["Análise › Severidade", "Análise › Requer acompanhamento", "Análise › Nota"])
    expect(fields?.[0]?.enumOptions).toEqual([{ value: "BAIXA", label: "Baixa" }, { value: "ALTA", label: "Alta" }])
    expect(fields?.[1]?.fieldType).toBe("BOOLEAN")
  })
})

describe("resolveStructuredFields — nó Avaliar política de acompanhamento", () => {
  const graph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "policy", type: "intervention_policy", label: "Avaliar política", position: { x: 0, y: 100 }, config: { policyId: "pol-1", mode: "APPLY_POLICY", analysisSourceNodeIds: [] } },
    ],
    edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "policy" }],
  } as unknown as FlowGraph
  const policy = {
    rules: [
      { key: "R1", name: "Regra 1", priority: 1, actions: [{ typeKey: "PLANO_DE_ACAO", effect: "RECOMMEND" as const }], inconclusiveActions: [{ typeKey: "INVESTIGAR", effect: "OPEN" as const }] },
      { key: "R2", name: "Regra 2", priority: 2, actions: [{ typeKey: "PLANO_DE_ACAO", effect: "OPEN" as const }], inconclusiveActions: [] },
    ],
    types: [
      { key: "PLANO_DE_ACAO", name: "Plano de ação", responsibleRole: "DIRECT_LEADER" as const, approval: { required: false as const }, sensitive: false, active: true },
      { key: "INVESTIGAR", name: "Investigar causa", responsibleRole: "SUPERVISOR" as const, approval: { required: false as const }, sensitive: false, active: true },
    ],
  }

  it("oferece um campo por tipo de intervenção da política, com valores de negócio — sem digitar caminho", () => {
    const fields = resolveStructuredFields(graph, "policy", new Map(), new Map([["pol-1", policy]]))!
    const perType = fields.filter((field) => field.path.startsWith("decisionsByType."))
    expect(perType.map((field) => [field.path, field.label])).toEqual([
      ["decisionsByType.INVESTIGAR", "Decisão — Investigar causa"],
      ["decisionsByType.PLANO_DE_ACAO", "Decisão — Plano de ação"],
    ])
    expect(perType[0]!.fieldType).toBe("ENUM")
    expect(perType[0]!.enumOptions?.find((option) => option.value === "RECOMMENDED")?.label).toBe("Recomendada ao responsável")
    expect(fields.some((field) => field.path === "createdTypeKeys")).toBe(false)
  })

  it("sem a política carregada, ficam os campos gerais", () => {
    const fields = resolveStructuredFields(graph, "policy", new Map())!
    expect(fields[0]!.path).toBe("outcome")
    expect(fields.some((field) => field.path.startsWith("decisionsByType."))).toBe(false)
  })
})
