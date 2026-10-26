import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph, FlowNode } from "../domain/graph-schema.js"
import { DomainError } from "../../../shared/domain/domain-error.js"

const flags = vi.hoisted(() => ({ pipeline: "ON" as "ON" | "OFF" }))
vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: new Proxy(original.env, { get: (target, key) => (key === "INIA_INTERACTION_FEEDBACK_PIPELINE" ? flags.pipeline : Reflect.get(target, key)) }) }
})

const { triggerConfigSchema, triggerDataOriginOf, triggerIndicatorCodeOf } = await import("../domain/trigger-config-schema.js")
const { normalizeManualTrigger, validateManualTrigger, validateReliableFeedbackFlow, validateWorkflowForPublish } = await import("./validate-workflow-for-publish.js")
const { manualRunBlockers, manualRunStageOf } = await import("./manual-run.js")

const AGENT_ID = "11111111-1111-4111-8111-111111111111"
const pos = { x: 0, y: 0 }
const node = (id: string, type: string, config: Record<string, unknown> = {}, label = id) => ({ id, type, label, position: pos, config }) as unknown as FlowNode
const edge = (source: string, target: string, sourceHandle = "always") => ({ id: `${source}-${sourceHandle}-${target}`, source, target, sourceHandle })

/** Gatilho → Chamar agente (avaliação de processo) → Gerar feedback → Output AVATAR → Fim — o caso da demonstração. */
function avatarFeedbackGraph(options: { withReliability?: boolean; outputContract?: string } = {}): FlowGraph {
  const withReliability = options.withReliability ?? true
  const nodes = [
    node("trigger", "trigger"),
    node("agent", "action", { actionType: "CALL_AGENT", agentId: AGENT_ID, outputContract: options.outputContract ?? "PROCESS_ASSESSMENT" }, "Monitoria"),
    ...(withReliability ? [node("feedback", "action", { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" }, "Gerar feedback")] : []),
    node("output", "output", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["AVATAR"], interactionMode: "PROMPT", source: withReliability ? "nodeOutputs.feedback" : "nodeOutputs.agent" }, "Recado no Avatar"),
    node("end", "end"),
  ]
  const edges = withReliability
    ? [edge("trigger", "agent"), edge("agent", "feedback"), edge("feedback", "output"), edge("output", "end")]
    : [edge("trigger", "agent"), edge("agent", "output"), edge("output", "end")]
  return { nodes, edges } as FlowGraph
}

function fakeDb(): Database {
  const query = async (sql: string) => {
    if (sql.includes("from agents where id = any")) return { rows: [{ id: AGENT_ID, name: "Monitoria", active: true, agent_type: "CALL_FEEDBACK" }], rowCount: 1 }
    if (sql.includes("from indicator_definitions")) return { rows: [{ id: "ind-1", code: "TMA", name: "TMA", active: true, daily_supported: true, official_closure_supported: true, desired_direction: "LOWER" }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { query } as unknown as Database
}

const manual = (context: "COLLABORATOR" | "INTERACTION" | "INDICATOR_MEASUREMENT", indicatorCode?: string) =>
  triggerConfigSchema.parse({ kind: "manual", context, ...(indicatorCode ? { indicatorCode } : {}) })

function row(graph: FlowGraph, trigger: ReturnType<typeof manual>, consolidated = false) {
  return { scopeType: "ALL_TEAMS", teamId: null, subteamId: null, draftGraph: graph, triggerConfig: trigger, consolidatedStructure: consolidated ? ({ kind: "TEAM", teamId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } as never) : null }
}

async function publishError(graph: FlowGraph, trigger: ReturnType<typeof manual>, consolidated = false): Promise<string | null> {
  try {
    await validateWorkflowForPublish(fakeDb(), "org", "wf", row(graph, trigger, consolidated))
    return null
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
}

beforeEach(() => {
  flags.pipeline = "ON"
})

describe("Gatilho Manual — contrato", () => {
  it("é um tipo nativo de gatilho: o schema aceita os três contextos e os gatilhos existentes continuam iguais", () => {
    expect(triggerConfigSchema.parse({ kind: "manual", context: "INTERACTION" })).toEqual({ kind: "manual", context: "INTERACTION" })
    expect(() => triggerConfigSchema.parse({ kind: "manual" })).toThrow()
    expect(() => triggerConfigSchema.parse({ kind: "manual", context: "EVERYONE" })).toThrow()
    expect(triggerConfigSchema.parse({ kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000001" }).kind).toBe("channel_flag")
    expect(triggerConfigSchema.parse({ kind: "indicator", indicatorCode: "TMA" }).kind).toBe("indicator")
    expect(triggerConfigSchema.parse({ kind: "schedule", times: ["09:00"] }).kind).toBe("schedule")
  })

  it("origem de dados: interação ≈ Flag, medição ≈ Indicador, colaborador ≈ Agenda individual; os gatilhos antigos são a própria origem", () => {
    expect(triggerDataOriginOf(manual("INTERACTION"))).toBe("channel_flag")
    expect(triggerDataOriginOf(manual("INDICATOR_MEASUREMENT", "TMA"))).toBe("indicator")
    expect(triggerDataOriginOf(manual("COLLABORATOR"))).toBe("schedule")
    expect(triggerDataOriginOf({ kind: "indicator", indicatorCode: "TMA" })).toBe("indicator")
    expect(triggerIndicatorCodeOf(manual("INDICATOR_MEASUREMENT", "TMA"))).toBe("TMA")
    expect(triggerIndicatorCodeOf(manual("INTERACTION"))).toBeNull()
  })

  it("medição exige o indicador; os outros contextos não guardam indicador (nada de configuração morta)", () => {
    expect(() => validateManualTrigger(manual("INDICATOR_MEASUREMENT"))).toThrow(/indicador/)
    expect(() => validateManualTrigger(manual("INDICATOR_MEASUREMENT", "TMA"))).not.toThrow()
    expect(normalizeManualTrigger(triggerConfigSchema.parse({ kind: "manual", context: "INTERACTION", indicatorCode: "TMA" }))).toEqual({ kind: "manual", context: "INTERACTION" })
  })
})

describe("Gatilho Manual — publicação (mesmas regras, pela origem de dados)", () => {
  it("Manual com interação + avaliação de processo + Gerar feedback + Avatar do próprio operador publica", async () => {
    expect(await publishError(avatarFeedbackGraph(), manual("INTERACTION"))).toBeNull()
  })

  it("avaliação de processo sem interação (Manual por colaborador) é recusada como sem Flag — nada fabricado", async () => {
    // Com "Gerar feedback", já cai antes: não dá para saber que é monitoria sem interação.
    expect(await publishError(avatarFeedbackGraph(), manual("COLLABORATOR"))).toBe("WORKFLOW_FEEDBACK_DOMAIN_AMBIGUOUS")
    // Sem ele, a própria avaliação de processo recusa (não existe transcrição).
    expect(await publishError(avatarFeedbackGraph({ withReliability: false }), manual("COLLABORATOR"))).toBe("WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG")
  })

  it("resultado investigativo direto no Avatar do operador exige a camada de confiabilidade (como Flag/Indicador)", () => {
    expect(() => validateReliableFeedbackFlow(avatarFeedbackGraph({ withReliability: false, outputContract: "FEEDBACK" }), manual("INTERACTION"), false)).toThrow(
      expect.objectContaining({ code: "WORKFLOW_FEEDBACK_REQUIRES_RELIABILITY" }),
    )
  })

  it("feedback de monitoria explícito sem interação é recusado; com interação passa", () => {
    const graph = avatarFeedbackGraph({ outputContract: "FEEDBACK" })
    const feedback = graph.nodes.find((candidate) => candidate.id === "feedback")!
    ;(feedback.config as { feedbackDomain: string }).feedbackDomain = "MONITORING"
    expect(() => validateReliableFeedbackFlow(graph, manual("COLLABORATOR"), false)).toThrow(expect.objectContaining({ code: "WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION" }))
    expect(() => validateReliableFeedbackFlow(graph, manual("INTERACTION"), false)).not.toThrow()
  })

  it("Condition sobre o valor do gatilho: Manual com interação não carrega valor de flag; com medição carrega o valor da medição", async () => {
    const graph = {
      nodes: [node("trigger", "trigger"), node("cond", "condition", { comparator: "LTE", thresholdNumeric: 3 }, "Nota ≤ 3?"), node("end", "end")],
      edges: [edge("trigger", "cond"), edge("cond", "end", "true"), edge("cond", "end", "false")],
    } as FlowGraph
    expect(await publishError(graph, manual("INTERACTION"))).toBe("WORKFLOW_INVALID_CONDITION")
    expect(await publishError(graph, manual("COLLABORATOR"))).toBe("WORKFLOW_INVALID_CONDITION")
    expect(await publishError(graph, manual("INDICATOR_MEASUREMENT", "TMA"))).toBeNull()
  })

  it("Manual nunca é Consolidado (a pessoa é escolhida a cada disparo)", async () => {
    const graph = { nodes: [node("trigger", "trigger"), node("end", "end")], edges: [edge("trigger", "end")] } as FlowGraph
    expect(await publishError(graph, manual("COLLABORATOR"), true)).toBe("WORKFLOW_MANUAL_TRIGGER_CONSOLIDATED")
    expect(await publishError(graph, manual("COLLABORATOR"))).toBeNull()
  })

  it("Manual por colaborador pede a fonte de dados do \"Chamar agente\" (como a Agenda)", async () => {
    const graph = avatarFeedbackGraph({ outputContract: "FEEDBACK" })
    graph.nodes = graph.nodes.filter((candidate) => candidate.id !== "feedback")
    graph.edges = [edge("trigger", "agent"), edge("agent", "output"), edge("output", "end")]
    ;(graph.nodes.find((candidate) => candidate.id === "output")!.config as { source: string; surfaces: string[] }).source = "nodeOutputs.agent"
    expect(await publishError(graph, manual("COLLABORATOR"))).toBe("WORKFLOW_INVALID_ACTION")
  })
})

describe("Gatilho Manual — impedimentos e estágio da execução", () => {
  const base = { id: "wf", name: "WF", active: true, versionId: "v1", scopeType: "ALL_TEAMS", teamId: null, subteamId: null, populationFilter: null, consolidated: false, indicatorName: null, indicatorUnit: null }

  it("lista os impedimentos na ordem: não é manual → nada mais; não publicado; inativo", () => {
    expect(manualRunBlockers({ ...base, trigger: null }).map((blocker) => blocker.code)).toEqual(["WORKFLOW_MANUAL_RUN_NOT_MANUAL"])
    expect(manualRunBlockers({ ...base, trigger: manual("INTERACTION") as never, versionId: null, active: false }).map((blocker) => blocker.code)).toEqual([
      "WORKFLOW_MANUAL_RUN_NOT_PUBLISHED",
      "WORKFLOW_MANUAL_RUN_INACTIVE",
    ])
    expect(manualRunBlockers({ ...base, trigger: manual("INTERACTION") as never })).toEqual([])
  })

  it("D10: Agent/Orquestrador da versão publicada que não pode rodar agora impede o disparo (depois dos impedimentos do Workflow)", () => {
    const unavailableReferences = [{ code: "WORKFLOW_AGENT_INACTIVE", message: "O nó \"Agente\" usa o agente \"X\", que está inativo." }]
    expect(manualRunBlockers({ ...base, trigger: manual("INTERACTION") as never, unavailableReferences }).map((blocker) => blocker.code)).toEqual(["WORKFLOW_AGENT_INACTIVE"])
    expect(manualRunBlockers({ ...base, trigger: manual("INTERACTION") as never, active: false, unavailableReferences }).map((blocker) => blocker.code)).toEqual(["WORKFLOW_MANUAL_RUN_INACTIVE", "WORKFLOW_AGENT_INACTIVE"])
  })

  it("solicitado ≠ processando ≠ concluído ≠ falha", () => {
    expect(manualRunStageOf("active", true, "manual_run_requested")).toBe("QUEUED")
    expect(manualRunStageOf("active", false, "node_advanced")).toBe("PROCESSING")
    expect(manualRunStageOf("active", false, "node_failed")).toBe("RETRYING")
    expect(manualRunStageOf("waiting", false, "reliable_feedback_held_for_qa")).toBe("WAITING")
    expect(manualRunStageOf("completed", false, "flow_completed")).toBe("COMPLETED")
    expect(manualRunStageOf("dead", false, "flow_dead")).toBe("FAILED")
  })
})
