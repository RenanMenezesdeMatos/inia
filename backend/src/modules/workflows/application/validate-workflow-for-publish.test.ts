import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { FlowGraph } from "../domain/graph-schema.js"
import { inMemoryHierarchyReader } from "../testing/in-memory-hierarchy-reader.js"
import { findIndividualOnlyConflict, validateFanOutConvergence, validateWorkflowForPublish, type PublishValidationRow } from "./validate-workflow-for-publish.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const AGENT_ID = "11111111-1111-4111-8111-111111111111"
const ORCHESTRATOR_ID = "22222222-2222-4222-8222-222222222222"

type Row = Record<string, unknown>

/** Banco falso mínimo — só o que a validação de publicação consulta (agentes, orquestradores,
 * variáveis, indicadores). Cada teste sobrescreve o que precisa. */
function fakeDb(overrides: Partial<{ agents: Row[]; orchestrators: Row[]; indicators: Row[]; domains: Row[] }> = {}): Database {
  const agents = overrides.agents ?? [{ id: AGENT_ID, name: "Especialista", active: true, agent_type: "CALL_FEEDBACK" }]
  const orchestrators = overrides.orchestrators ?? [
    { id: ORCHESTRATOR_ID, output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Gerencial", active: true, invocation_mode: "WORKFLOW" },
  ]
  const indicators = overrides.indicators ?? [{ id: "ind-1", desired_direction: "HIGHER" }]
  async function query(sql: string): Promise<{ rows: Row[]; rowCount: number }> {
    if (sql.includes("from agents where id = any")) return { rows: agents, rowCount: agents.length }
    if (sql.includes("from assistant_orchestrators where id = any")) return { rows: orchestrators, rowCount: orchestrators.length }
    if (sql.includes("from indicator_definitions")) return { rows: indicators, rowCount: indicators.length }
    if (sql.includes("from workflow_variables")) return { rows: [], rowCount: 0 }
    if (sql.includes("from channel_flags")) return { rows: [{ value_type: "BOOLEAN" }], rowCount: 1 }
    if (sql.includes("from subteams")) return { rows: [], rowCount: 0 }
    // Destinatário fixo (Output "Usuário específico"): pessoa ativa da organização.
    if (sql.includes("from people where id = any")) return { rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }], rowCount: 1 }
    if (sql.includes("from business_domains bd where bd.id = any")) return { rows: overrides.domains ?? [], rowCount: (overrides.domains ?? []).length }
    return { rows: [], rowCount: 0 }
  }
  return { query } as unknown as Database
}

const SCHEDULE_TRIGGER = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" } as const
const SUPERVISOR_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
const SUPERVISOR_STRUCTURE = { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR_ID } as const
const TEAM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

/** Hierarquia em memória: Diretor → Gerente → Supervisora (âncora) → 2 operadores (Grupo TEAM_ID);
 * um segundo Supervisor no MESMO Grupo torna "Supervisor" ambíguo pra estrutura de Grupo. */
const HIERARCHY = inMemoryHierarchyReader([
  { id: "director", name: "Diretora", role: "DIRECTOR", reportsToId: null },
  { id: "manager", name: "Gerente", role: "MANAGER", reportsToId: "director" },
  { id: SUPERVISOR_ID, name: "Supervisora", role: "SUPERVISOR", reportsToId: "manager" },
  { id: "supervisor-2", name: "Supervisor 2", role: "SUPERVISOR", reportsToId: "manager" },
  { id: "op-1", name: "Op 1", role: "OPERATOR", reportsToId: SUPERVISOR_ID, teamId: TEAM_ID },
  { id: "op-2", name: "Op 2", role: "OPERATOR", reportsToId: "supervisor-2", teamId: TEAM_ID },
])

function row(graph: FlowGraph, consolidated: boolean | PublishValidationRow["consolidatedStructure"] = true): PublishValidationRow {
  return {
    scopeType: "ALL_TEAMS",
    teamId: null,
    subteamId: null,
    draftGraph: graph,
    triggerConfig: SCHEDULE_TRIGGER as unknown as PublishValidationRow["triggerConfig"],
    consolidatedStructure: consolidated === true ? SUPERVISOR_STRUCTURE : consolidated === false ? null : consolidated,
  }
}

const trigger = { id: "trigger", type: "trigger", label: "Agenda", position: { x: 0, y: 0 }, config: {} } as const
const select = {
  id: "select",
  type: "select_employees",
  label: "PRV abaixo de 80%",
  position: { x: 0, y: 1 },
  config: { selectionMode: "CONDITION", criterion: { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } } },
} as const
const apply = { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 2 }, config: {} } as const
const agent = {
  id: "agent",
  type: "action",
  label: "Especialista",
  position: { x: 0, y: 3 },
  config: { actionType: "CALL_AGENT", agentId: AGENT_ID, scheduledDataSource: { kind: "PERFORMANCE", closures: 1 } },
} as const
const review = {
  id: "review",
  type: "human_review",
  label: "Revisão do supervisor",
  position: { x: 0, y: 4 },
  config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agent" },
} as const
const outputOperator = {
  id: "out-op",
  type: "output",
  label: "Feedback ao operador",
  position: { x: 0, y: 5 },
  config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.agent" },
} as const
const join = { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 6 }, config: {} } as const
const orchestrator = {
  id: "orq",
  type: "orchestrator",
  label: "Orquestrador · Gerencial",
  position: { x: 0, y: 7 },
  config: { orchestratorId: ORCHESTRATOR_ID, instruction: "Sintetize." },
} as const
function outputManager(target: Record<string, unknown>) {
  return { id: "out-mgr", type: "output", label: "Resumo ao supervisor", position: { x: 0, y: 8 }, config: { target, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.orq" } } as const
}
const end = { id: "end", type: "end", label: "Fim", position: { x: 0, y: 9 }, config: {} } as const

function edge(source: string, handle: string, target: string) {
  return { id: `e-${source}-${handle}-${target}`, source, sourceHandle: handle, target }
}

/** Modelo multinível canônico: Output individual DENTRO do caminho individual (antes do Join),
 * todas as decisões da Revisão convergindo no MESMO Join, Output de gestão depois do Orquestrador. */
function multilevelGraph(managerTarget: Record<string, unknown>): FlowGraph {
  return {
    nodes: [trigger, select, apply, agent, review, outputOperator, join, orchestrator, outputManager(managerTarget), end],
    edges: [
      edge("trigger", "always", "select"),
      edge("select", "always", "apply"),
      edge("apply", "always", "agent"),
      edge("agent", "always", "review"),
      edge("review", "approved", "out-op"),
      edge("review", "rejected", "join"),
      edge("review", "escalated", "join"),
      edge("out-op", "always", "join"),
      edge("join", "always", "orq"),
      edge("orq", "always", "out-mgr"),
      edge("out-mgr", "always", "end"),
    ],
  } as unknown as FlowGraph
}

async function firstError(db: Database, graph: FlowGraph, consolidated: boolean | PublishValidationRow["consolidatedStructure"] = true): Promise<DomainError | null> {
  try {
    await validateWorkflowForPublish(db, ORG, "wf-1", row(graph, consolidated), { hierarchy: HIERARCHY })
    return null
  } catch (error) {
    if (error instanceof DomainError) return error
    throw error
  }
}

describe("validateWorkflowForPublish — destinatário × contexto (matriz real, nunca interpretação visual)", () => {
  it("EMPLOYEE + O próprio operador → válido (Output individual antes do Join)", async () => {
    expect(await firstError(fakeDb(), multilevelGraph({ type: "ROLE", role: "SUPERVISOR" }))).toBeNull()
  })

  it("CONSOLIDATED_RESULT + O próprio operador → inválido, com o nó responsável em details.nodeId", async () => {
    const error = await firstError(fakeDb(), multilevelGraph({ type: "CURRENT_OPERATOR" }))
    expect(error?.code).toBe("WORKFLOW_OUTPUT_TARGET_INVALID_MODE")
    expect(error?.details).toEqual({ nodeId: "out-mgr" })
    expect(error?.message).toContain("fluxo consolidado")
  })

  it.each([
    [{ type: "ROLE", role: "SUPERVISOR" }],
    [{ type: "ROLE", role: "MANAGER" }],
    [{ type: "ROLE", role: "DIRECTOR" }],
    [{ type: "SUPERVISOR_OF_OPERATOR" }],
    [{ type: "MANAGER_OF_OPERATOR" }],
    [{ type: "USER", userId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }],
  ])("CONSOLIDATED_RESULT + destinatário de gestão %j → válido", async (target) => {
    expect(await firstError(fakeDb(), multilevelGraph(target as Record<string, unknown>))).toBeNull()
  })

  it("findIndividualOnlyConflict aponta o Output pós-Join, nunca o Output individual do caminho filho", () => {
    const conflict = findIndividualOnlyConflict(multilevelGraph({ type: "CURRENT_OPERATOR" }))
    expect(conflict?.nodeId).toBe("out-mgr")
  })
})

describe("validateWorkflowForPublish — destinatário de gestão resolvido pela ESTRUTURA (nunca por 'um membro qualquer')", () => {
  it("Grupo com 2 Supervisores + Output 'Supervisor' pós-Join → não publicável (AMBIGUOUS), apontando o nó", async () => {
    const error = await firstError(fakeDb(), multilevelGraph({ type: "ROLE", role: "SUPERVISOR" }), { kind: "TEAM", teamId: TEAM_ID })
    expect(error?.code).toBe("WORKFLOW_OUTPUT_RECIPIENT_AMBIGUOUS")
    expect(error?.details).toEqual({ nodeId: "out-mgr" })
    expect(error?.message).toContain("mais de um Supervisor possível (2: Supervisor 2, Supervisora)")
  })

  it("o mesmo Grupo com Output 'Gerente' → publicável (um único Gerente pela hierarquia real de todos os membros)", async () => {
    expect(await firstError(fakeDb(), multilevelGraph({ type: "ROLE", role: "MANAGER" }), { kind: "TEAM", teamId: TEAM_ID })).toBeNull()
    expect(await firstError(fakeDb(), multilevelGraph({ type: "MANAGER_OF_OPERATOR" }), { kind: "TEAM", teamId: TEAM_ID })).toBeNull()
  })

  it("estrutura sem ninguém no cargo → NOT_FOUND com mensagem de negócio", async () => {
    const error = await firstError(fakeDb(), multilevelGraph({ type: "ROLE", role: "COORDINATOR" }))
    expect(error?.code).toBe("WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND")
    expect(error?.message).toBe("Não foi possível determinar um Coordenador responsável por esta estrutura.")
    const missingTeam = await firstError(fakeDb(), multilevelGraph({ type: "ROLE", role: "MANAGER" }), { kind: "TEAM", teamId: "00000000-0000-4000-8000-00000000dead" })
    expect(missingTeam?.code).toBe("WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND")
  })

  it("Output individual (antes do Join) nunca passa pela resolução por estrutura — cargo é da cadeia do operador", async () => {
    const graph = multilevelGraph({ type: "ROLE", role: "MANAGER" })
    const individualToSupervisor = { ...graph, nodes: graph.nodes.map((node) => (node.id === "out-op" ? { ...node, config: { ...node.config, target: { type: "ROLE", role: "SUPERVISOR" } } } : node)) } as FlowGraph
    expect(await firstError(fakeDb(), individualToSupervisor, { kind: "TEAM", teamId: TEAM_ID })).toBeNull()
  })
})

describe("validateWorkflowForPublish — fan-out/fan-in", () => {
  it("todas as decisões da Revisão humana precisam chegar ao MESMO Join — branch reprovado indo para Fim escapa do fan-in", async () => {
    const graph = multilevelGraph({ type: "ROLE", role: "SUPERVISOR" })
    const escaped = { ...graph, edges: graph.edges.map((item) => (item.sourceHandle === "rejected" ? { ...item, target: "end" } : item)) }
    const error = await firstError(fakeDb(), escaped)
    expect(error?.code).toBe("WORKFLOW_FAN_OUT_PATH_ESCAPES_JOIN")
    expect(error?.details).toEqual({ nodeId: "apply" })
    expect(validateFanOutConvergence(escaped)?.nodeId).toBe("apply")
  })

  it("Join sem Apply de origem é bloqueado", async () => {
    const graph = multilevelGraph({ type: "ROLE", role: "SUPERVISOR" })
    const noApply = { nodes: graph.nodes.filter((node) => node.id !== "apply"), edges: graph.edges.filter((item) => item.source !== "apply" && item.target !== "apply") } as FlowGraph
    const error = await firstError(fakeDb(), noApply)
    expect(["WORKFLOW_CONSOLIDATE_RESULTS_MISSING_ORIGIN", "WORKFLOW_CONSOLIDATE_RESULTS_INVALID_MODE", "WORKFLOW_ACTION_INVALID_MODE"]).toContain(error?.code)
  })
})

describe("validateWorkflowForPublish — referências de Agent/Orquestrador", () => {
  const valid = multilevelGraph({ type: "ROLE", role: "SUPERVISOR" })

  it("agente inexistente bloqueia, com o nó responsável", async () => {
    const error = await firstError(fakeDb({ agents: [] }), valid)
    expect(error?.code).toBe("WORKFLOW_AGENT_NOT_FOUND")
    expect(error?.details).toEqual({ nodeId: "agent" })
  })

  it("agente inativo bloqueia", async () => {
    const error = await firstError(fakeDb({ agents: [{ id: AGENT_ID, name: "X", active: false, agent_type: "CALL_FEEDBACK" }] }), valid)
    expect(error?.code).toBe("WORKFLOW_AGENT_INACTIVE")
  })

  it("agente-coordenador (tipo ORCHESTRATOR) nunca é chamado direto por 'Chamar agente'", async () => {
    const error = await firstError(fakeDb({ agents: [{ id: AGENT_ID, name: "Coordenação", active: true, agent_type: "ORCHESTRATOR" }] }), valid)
    expect(error?.code).toBe("WORKFLOW_AGENT_INVALID_TYPE")
  })

  it("orquestrador inexistente bloqueia, com o nó responsável", async () => {
    const error = await firstError(fakeDb({ orchestrators: [] }), valid)
    expect(error?.code).toBe("WORKFLOW_ORCHESTRATOR_NOT_FOUND")
    expect(error?.details).toEqual({ nodeId: "orq" })
  })

  it("orquestrador só de chat/voz (INTERACTIVE) não pode ser usado num Workflow", async () => {
    const error = await firstError(
      fakeDb({ orchestrators: [{ id: ORCHESTRATOR_ID, output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Chat", active: true, invocation_mode: "INTERACTIVE" }] }),
      valid,
    )
    expect(error?.code).toBe("WORKFLOW_ORCHESTRATOR_INVALID_INVOCATION")
  })

  it("V1.7.1 — roteamento declarado: domínio com exatamente um especialista publica; zero/dois/inexistente bloqueiam com o nó", async () => {
    const DOMAIN = "d0000000-0000-4000-8000-00000000000f"
    const withRouting = { ...valid, nodes: valid.nodes.map((node) => (node.type === "orchestrator" ? { ...node, config: { ...node.config, routing: { mode: "DOMAINS" as const, businessDomainIds: [DOMAIN] } } } : node)) } as FlowGraph
    expect(await firstError(fakeDb({ domains: [{ id: DOMAIN, name: "Faturamento", active: true, specialists: 1 }] }), withRouting)).toBeNull()
    for (const domains of [[{ id: DOMAIN, name: "Faturamento", active: true, specialists: 0 }], [{ id: DOMAIN, name: "Faturamento", active: true, specialists: 2 }], [{ id: DOMAIN, name: "Faturamento", active: false, specialists: 1 }], []]) {
      const error = await firstError(fakeDb({ domains }), withRouting)
      expect(error?.code).toBe("WORKFLOW_ORCHESTRATOR_ROUTING_DOMAIN_INVALID")
      expect(error?.details).toEqual({ nodeId: "orq" })
    }
  })

  it("orquestrador inativo bloqueia", async () => {
    const error = await firstError(
      fakeDb({ orchestrators: [{ id: ORCHESTRATOR_ID, output_schema: null, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, name: "Antigo", active: false, invocation_mode: "WORKFLOW" }] }),
      valid,
    )
    expect(error?.code).toBe("WORKFLOW_ORCHESTRATOR_INACTIVE")
  })

  it("problema estrutural vem ANTES de problema de referência (nunca mascara topologia)", async () => {
    const error = await firstError(fakeDb({ agents: [] }), multilevelGraph({ type: "CURRENT_OPERATOR" }))
    expect(error?.code).toBe("WORKFLOW_OUTPUT_TARGET_INVALID_MODE")
  })

  describe("pós-JOIN com Agent de síntese (evolução 2026-09-16) — Orquestrador legado continua válido", () => {
    const SYNTHESIS_ID = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb"
    const synthesisNode = { id: "orq", type: "action", label: "Síntese gerencial", position: { x: 0, y: 7 }, config: { actionType: "CALL_AGENT", agentId: SYNTHESIS_ID, instruction: "Sintetize." } } as const
    function synthesisGraph(): FlowGraph {
      const base = multilevelGraph({ type: "ROLE", role: "SUPERVISOR" })
      return { ...base, nodes: base.nodes.map((node) => (node.id === "orq" ? synthesisNode : node)) } as unknown as FlowGraph
    }
    const specialist = { id: AGENT_ID, name: "Especialista", active: true, agent_type: "CALL_FEEDBACK", specialty: "PERFORMANCE", specialty_kind: "PERFORMANCE", domain: null, consolidated_input: false }
    const synthesis = { id: SYNTHESIS_ID, name: "Síntese Gerencial", active: true, agent_type: "CUSTOM", specialty: "SYNTHESIS", specialty_kind: "SYNTHESIS", domain: null, consolidated_input: true }

    it("Join → Chamar agente com um Agent SYNTHESIS (aceita consolidado) → válido", async () => {
      expect(await firstError(fakeDb({ agents: [specialist, synthesis] }), synthesisGraph())).toBeNull()
    })

    it("Join → Chamar agente com um Agent que analisa um colaborador por vez → WORKFLOW_AGENT_NOT_CONSOLIDATED, com o nó", async () => {
      const error = await firstError(fakeDb({ agents: [specialist, { ...synthesis, specialty: "PERFORMANCE", specialty_kind: "PERFORMANCE", consolidated_input: false }] }), synthesisGraph())
      expect(error?.code).toBe("WORKFLOW_AGENT_NOT_CONSOLIDATED")
      expect(error?.details).toEqual({ nodeId: "orq" })
    })

    it("legado sem forma nova: só `consolidated_input = true` (dual-read) também vale pós-JOIN", async () => {
      expect(await firstError(fakeDb({ agents: [specialist, { ...synthesis, specialty: null, specialty_kind: null, consolidated_input: true }] }), synthesisGraph())).toBeNull()
    })

    it("Agent SYNTHESIS no caminho individual (antes do Join) → WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN", async () => {
      const error = await firstError(fakeDb({ agents: [{ ...synthesis, id: AGENT_ID }] }), valid)
      expect(error?.code).toBe("WORKFLOW_AGENT_SYNTHESIS_REQUIRES_JOIN")
    })

    it("Join → Orquestrador (caminho legado) continua válido durante a transição", async () => {
      expect(await firstError(fakeDb(), multilevelGraph({ type: "ROLE", role: "SUPERVISOR" }))).toBeNull()
    })
  })
})
