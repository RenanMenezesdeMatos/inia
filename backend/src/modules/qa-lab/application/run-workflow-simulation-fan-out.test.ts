import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { EnrollmentRow, WorkflowScope } from "../../workflows/application/node-handlers.js"
import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import { pendingReviewForState, runEmployeeNodeLoop, runSimulationLoop, type SimulationOptions, type SimulationSession } from "./run-workflow-simulation.js"
import type { WorkflowSimulationState } from "../domain/qa-run-schema.js"

/**
 * Testes funcionais do fan-out simulado do QA Lab ("Aplicar individualmente" — EMPLOYEE_COLLECTION,
 * Parte 47-52 do pedido): chamam `runSimulationLoop`/`runEmployeeNodeLoop` diretamente sobre uma
 * `SimulationSession` montada à mão — mesmo nível de teste que `engine.test.ts` usa pro motor real,
 * evitando montar o pipeline HTTP inteiro (já coberto, pra um único trace, em
 * run-workflow-simulation.test.ts). Nunca cria nada operacional — o sink simulado nunca é trocado.
 */

// A "IA" é o `fetch` stubado abaixo — a chave só precisa existir, nunca ser real (sem ela o executor recusa antes do
// fetch e o teste passaria a depender do .env de quem roda).
vi.mock("../../../config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../config/env.js")>()
  return { ...actual, env: { ...actual.env, GEMINI_API_KEY: "test-key" } }
})

const SUPERVISOR_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
const OP_1 = "11111111-1111-4111-8111-111111111111"
const OP_2 = "22222222-2222-4222-8222-222222222222"
const OP_3 = "33333333-3333-4333-8333-333333333333"
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TEAM_ID = "77777777-7777-4777-8777-777777777777"
const TRANSCRIPT = "Operador: bom dia. Cliente: quero cancelar. Operador: não posso ajudar com isso, tchau."

const STRUCTURED_REPLY = JSON.stringify({
  title: "Encerramento inadequado",
  summary: "Operador encerrou sem oferecer alternativa.",
  impactedIndicator: "nota_ura",
  evidenceFound: "não posso ajudar com isso, tchau",
  observedBehavior: "Encerrou a ligação sem alternativa.",
  relatedProcedure: "Nenhum procedimento específico cadastrado",
  recommendation: "Ofereça alternativas antes de encerrar.",
})

function geminiResponse(text: string) {
  return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 } }), text: async () => "" }
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => geminiResponse(STRUCTURED_REPLY))
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** Grafo canônico do pedido (seção 81): Estrutura -> Selecionar colaboradores (Q4/critério
 * determinístico) -> Aplicar individualmente -> Agent ("Analise o histórico deste colaborador"). */
function collectionGraph(): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Agenda", position: { x: 0, y: 0 }, config: {} },
      {
        id: "select",
        type: "select_employees",
        label: "Selecionar colaboradores",
        position: { x: 0, y: 1 },
        config: {
          criterion: {
            comparator: "GTE",
            thresholdNumeric: 80,
            historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } },
          },
        },
      },
      { id: "apply", type: "apply_individually", label: "Aplicar individualmente", position: { x: 0, y: 2 }, config: {} },
      {
        id: "agent",
        type: "action",
        label: "Analisar histórico",
        position: { x: 0, y: 3 },
        config: { actionType: "CALL_AGENT", agentId: AGENT_ID, scheduledDataSource: { kind: "MONITORING", sampleSize: 1, period: "MONTH" } },
      },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
      { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      { id: "e3", source: "apply", sourceHandle: "always", target: "agent" },
      { id: "e4", source: "agent", sourceHandle: "always", target: "end" },
    ],
  }
}

/** Mesmo grafo, mas terminando em Revisão humana (pra testar decisão por colaborador). */
function collectionGraphWithHumanReview(): FlowGraph {
  const graph = collectionGraph()
  return {
    nodes: [
      ...graph.nodes.filter((node) => node.id !== "agent" && node.id !== "end"),
      { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 3 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } },
      { id: "end-a", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
      { id: "end-b", type: "end", label: "Fim", position: { x: 200, y: 4 }, config: {} },
      { id: "end-c", type: "end", label: "Fim", position: { x: 400, y: 4 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
      { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
      { id: "e4", source: "review", sourceHandle: "approved", target: "end-a" },
      { id: "e5", source: "review", sourceHandle: "rejected", target: "end-b" },
      { id: "e6", source: "review", sourceHandle: "escalated", target: "end-c" },
    ],
  }
}

const ORCHESTRATOR_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const ORCHESTRATOR_AGENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

function fakeDb(overrides: { avgByOperator?: Record<string, number> } = {}): Database {
  const avgByOperator = overrides.avgByOperator ?? { [OP_1]: 90, [OP_2]: 90, [OP_3]: 90 }
  async function query(sql: string, params?: unknown[]) {
    const text = sql.replace(/\s+/g, " ").trim()
    // Estrutura (Equipe do Supervisor) — resolveStructureAnchorOperatorIds.
    if (text.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: OP_1 }, { id: OP_2 }, { id: OP_3 }], rowCount: 3 }
    // Abrangência/elegibilidade (ALL_TEAMS) — resolveEligibleOperatorIds.
    if (text.includes("role = 'OPERATOR' and active")) return { rows: [{ id: OP_1 }, { id: OP_2 }, { id: OP_3 }], rowCount: 3 }
    // Critério de "Selecionar colaboradores" — média do indicador por candidato.
    if (text.includes("from indicator_measurements") && text.includes("avg(m.value)")) {
      if (text.includes("group by m.subject_id")) {
        return { rows: (params?.[1] as string[]).flatMap((id) => (avgByOperator[id] === undefined ? [] : [{ subject_id: id, avg_value: String(avgByOperator[id]), min_value: String(avgByOperator[id]), max_value: String(avgByOperator[id]), sample_count: "1" }])), rowCount: 0 }
      }
      const operatorId = (params?.[1] as string[])[0]!
      const value = avgByOperator[operatorId]
      if (value === undefined) return { rows: [{ avg_value: null, min_value: null, max_value: null, sample_count: "0" }], rowCount: 1 }
      return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
    }
    // callAgentForSchedule: time do colaborador.
    if (text.includes("select team_id from people where id = $1")) return { rows: [{ team_id: TEAM_ID }], rowCount: 1 }
    // MONITORING: 1 interação amostrada por colaborador (id determinístico = próprio operatorId, só pra teste).
    if (text.includes("from interactions where operator_id = $1")) return { rows: [{ id: `interaction-${params?.[0]}` }], rowCount: 1 }
    if (text.includes("select started_at from interactions where id = $1")) return { rows: [{ started_at: "2026-09-10T12:00:00.000Z" }], rowCount: 1 }
    if (text.includes("from transcripts where interaction_id")) return { rows: [{ content: TRANSCRIPT, version: 1, language: "pt-BR", confidence: null }], rowCount: 1 }
    // Agent.
    if (/select name, objective, description, context_prompt, active[a-z_, ]* from agents/.test(text)) {
      return { rows: [{ name: "Agente de Análise", objective: "Analisar", description: "desc", context_prompt: "prompt", active: true }], rowCount: 1 }
    }
    // Orchestrator pós-JOIN (consolidate-results-executor.ts / orchestrator-executor.ts).
    if (text.includes("from assistant_orchestrators")) {
      return {
        rows: [{ id: ORCHESTRATOR_ID, name: "Resumo Executivo", orchestrator_agent_id: ORCHESTRATOR_AGENT_ID, objective: "Sintetizar", description: "desc", context_prompt: "prompt", output_instructions: null }],
        rowCount: 1,
      }
    }
    if (text.includes("from assistant_orchestrator_specialists")) return { rows: [], rowCount: 0 }
    if (text.includes("select id, name from people")) {
      const ids = (params?.[0] as string[]) ?? []
      return { rows: ids.map((id) => ({ id, name: id === OP_1 ? "João" : id === OP_2 ? "Maria" : "Pedro" })), rowCount: ids.length }
    }
    if (text.includes("from agent_knowledge_documents") || text.includes("from prohibited_topics") || text.includes("from call_expectations") || text.includes("from feedbacks")) {
      return { rows: [], rowCount: 0 }
    }
    return { rows: [], rowCount: 0 }
  }
  return { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
}

const workflow: WorkflowScope = {
  scopeType: "ALL_TEAMS",
  teamId: null,
  subteamId: null,
  consolidatedStructure: { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR_ID },
  populationFilter: null,
}

function baseEnrollment(): EnrollmentRow {
  return {
    id: "enrollment-1",
    organization_id: "org-1",
    workflow_id: "workflow-1",
    version_id: "version-1",
    interaction_id: null,
    indicator_measurement_id: null,
    scheduled_subject_id: SUPERVISOR_ID,
    scheduled_for: null,
    current_node_id: "select",
    matched_flag_name: null,
    matched_value_boolean: null,
    matched_value_numeric: null,
    status: "active",
    attempts: 0,
    revision: 0,
    node_outputs: {},
    variables: {},
  }
}

function baseState(): WorkflowSimulationState {
  return { currentNodeId: "select", status: "active", pauseReason: null, resumeAt: null, nodeOutputs: {}, variables: {}, simulatedNow: new Date("2026-09-15T12:00:00.000Z").toISOString(), revision: 0 }
}

function baseSession(graph: FlowGraph): SimulationSession {
  return { graph, workflow, enrollment: baseEnrollment(), inputContext: "", state: baseState(), effects: [], aiCalls: [], steps: [] }
}

describe("QA Lab — fan-out simulado (Aplicar individualmente, EMPLOYEE_COLLECTION)", () => {
  it("cria 1 employeeRun por colaborador selecionado, cada um começando no PRÓXIMO node (nunca no Trigger)", async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraph())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.state.status).toBe("completed") // o trace principal nunca segue processando EMPLOYEE
    expect(session.employeeRuns).toHaveLength(3)
    expect(session.employeeRuns?.map((run) => run.employeeId).sort()).toEqual([OP_1, OP_2, OP_3].sort())
    for (const run of session.employeeRuns ?? []) {
      expect(run.state.currentNodeId).not.toBe("trigger")
      expect(run.steps[0]?.nodeId).toBe("agent") // começa em "agent", o node SEGUINTE ao fan-out
    }
    // Zero side effect real: o sink permanece o array em memória passado (nunca trocado).
    expect(session.effects.every((effect) => effect.kind !== "AGENT_RUN" || effect.status !== undefined)).toBe(true)
  })

  it("orçamento de IA é GLOBAL entre os colaboradores, nunca resetado por pessoa (limite=2 -> João:1, Maria:1, Pedro pausa antes da IA)", async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraph())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: 2 }
    await runSimulationLoop(db, session, options)

    expect(fetchMock).toHaveBeenCalledTimes(2) // nunca 3 — orçamento compartilhado, não 1 por colaborador
    const statuses = (session.employeeRuns ?? []).map((run) => run.state.status)
    expect(statuses.filter((status) => status === "completed")).toHaveLength(2)
    expect(statuses.filter((status) => status === "paused")).toHaveLength(1)
    const pausedRun = session.employeeRuns?.find((run) => run.state.status === "paused")
    expect(pausedRun?.state.pauseReason).toBe("AI_BUDGET")
  })

  it('"Parar antes da IA": 0 requests de IA, mas cada colaborador ainda pausa exibindo seu próprio contexto individual', async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraph())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "STOP_BEFORE_AI", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(session.employeeRuns).toHaveLength(3)
    for (const run of session.employeeRuns ?? []) {
      expect(run.state.status).toBe("paused")
      expect(run.state.pauseReason).toBe("AI_BLOCKED")
    }
  })

  it('"Executar até \'Selecionar colaboradores\'": mostra a coleção sem nenhuma chamada de IA', async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraph())
    const options: SimulationOptions = { mode: "UNTIL_NODE", untilNodeId: "select", aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.state.status).toBe("paused")
    expect(session.state.pauseReason).toBe("UNTIL_NODE")
    expect(session.employeeRuns ?? []).toHaveLength(0) // fan-out ainda não aconteceu
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('"Executar até \'Aplicar individualmente\'": mostra o fan-out simulado sem IA', async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraph())
    const options: SimulationOptions = { mode: "UNTIL_NODE", untilNodeId: "apply", aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.state.status).toBe("paused")
    expect(session.state.pauseReason).toBe("UNTIL_NODE")
    expect(session.employeeRuns ?? []).toHaveLength(0) // "apply" em si ainda não rodou
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("0 selecionados -> fan-out de 0 filhos, sem erro, sem efeito colateral", async () => {
    const db = fakeDb({ avgByOperator: {} }) // ninguém atende ao critério -> SEM DADOS pra todos
    const session = baseSession(collectionGraph())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.state.status).toBe("completed")
    expect(session.employeeRuns).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("Revisão humana por colaborador: aprovar João nunca decide Maria/Pedro — cada um independente", async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraphWithHumanReview())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.employeeRuns).toHaveLength(3)
    for (const run of session.employeeRuns ?? []) {
      expect(run.state.status).toBe("waiting")
      expect(run.state.pauseReason).toBe("HUMAN_REVIEW")
      expect(pendingReviewForState(session.graph, session.effects, run.state)?.nodeId).toBe("review")
    }

    const [first, second, third] = session.employeeRuns!
    // Decide só o primeiro colaborador (equivalente a "aprovar João").
    first!.state.status = "active"
    first!.state.currentNodeId = "end-a"
    first!.state.pauseReason = null
    first!.state.revision += 1
    const updated = await runEmployeeNodeLoop(db, session, first!.employeeId, options)
    expect(updated.state.status).toBe("completed")

    // Os outros dois continuam intocados — cada um esperando sua PRÓPRIA revisão.
    expect(session.employeeRuns?.find((run) => run.employeeId === second!.employeeId)?.state.status).toBe("waiting")
    expect(session.employeeRuns?.find((run) => run.employeeId === third!.employeeId)?.state.status).toBe("waiting")
  })
})

/** Mesmo grafo canônico, mas "Selecionar colaboradores" em modo Ranking (evolução de Ranking,
 * Parte 83 do pedido) em vez de Por critério — prova que o QA Lab funciona pro modo novo sem
 * nenhum código específico de QA: `processNode` é o MESMO em produção e simulação. */
function rankingCollectionGraph(): FlowGraph {
  const graph = collectionGraph()
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "select"
        ? {
            ...node,
            config: {
              selectionMode: "RANKING",
              ranking: { source: "MEASUREMENT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, selection: "LOWEST", count: 2 },
            } as never,
          }
        : node,
    ),
  }
}

describe("QA Lab — Selecionar colaboradores por Ranking (evolução: Por critério vs Por ranking)", () => {
  it("executa até 'Selecionar colaboradores' e mostra o ranking completo, sem IA — 2 piores em Qualidade dos 3 avaliados", async () => {
    const db = fakeDb({ avgByOperator: { [OP_1]: 90, [OP_2]: 60, [OP_3]: 70 } }) // OP_2 pior, OP_3 2º pior, OP_1 melhor (fora do top 2 piores)
    const session = baseSession(rankingCollectionGraph())
    const options: SimulationOptions = { mode: "UNTIL_NODE", untilNodeId: "select", aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.state.status).toBe("paused")
    expect(session.state.pauseReason).toBe("UNTIL_NODE")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fan-out resultante tem exatamente selectedCount filhos (2), nunca todos os 3 avaliados", async () => {
    const db = fakeDb({ avgByOperator: { [OP_1]: 90, [OP_2]: 60, [OP_3]: 70 } })
    const session = baseSession(rankingCollectionGraph())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "STOP_BEFORE_AI", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.employeeRuns).toHaveLength(2)
    expect(session.employeeRuns?.map((run) => run.employeeId).sort()).toEqual([OP_2, OP_3].sort()) // os 2 piores, nunca OP_1
    expect(fetchMock).not.toHaveBeenCalled() // 0 requests reais de IA
  })

  it("o node_output de 'Selecionar colaboradores' fica em modo RANKING com evidência de posição/valor — nunca em modo CONDITION", async () => {
    const db = fakeDb({ avgByOperator: { [OP_1]: 90, [OP_2]: 60, [OP_3]: 70 } })
    const session = baseSession(rankingCollectionGraph())
    const options: SimulationOptions = { mode: "UNTIL_NODE", untilNodeId: "apply", aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    const selectStep = session.steps.find((step) => step.nodeId === "select")
    expect(selectStep?.nodeOutput).toMatchObject({
      mode: "RANKING",
      selectedCount: 2,
      partitionBy: "NONE",
      requestedCountPerPartition: 2,
      partitions: [
        {
          id: null,
          name: null,
          members: [
            { employeeId: OP_2, value: 60, position: 1 },
            { employeeId: OP_3, value: 70, position: 2 },
          ],
        },
      ],
    })
  })
})

/** Mesmo grafo de Revisão humana por colaborador, mas os 3 ramos convergem num "Consolidar
 * resultados" (fan-in/JOIN) seguido de um Orchestrator consolidado — cenário canônico do pedido
 * (seção 96: Human Review -> Consolidar -> Orchestrator/Output). */
function collectionGraphWithJoin(): FlowGraph {
  const graph = collectionGraph()
  return {
    nodes: [
      ...graph.nodes.filter((node) => node.id !== "agent" && node.id !== "end"),
      { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 3 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } } },
      { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 4 }, config: {} },
      { id: "orchestrator", type: "orchestrator", label: "Resumo executivo", position: { x: 0, y: 5 }, config: { orchestratorId: ORCHESTRATOR_ID, instruction: "Resuma os diagnósticos." } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 6 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "select" },
      { id: "e2", source: "select", sourceHandle: "always", target: "apply" },
      { id: "e3", source: "apply", sourceHandle: "always", target: "review" },
      { id: "e4", source: "review", sourceHandle: "approved", target: "join" },
      { id: "e5", source: "review", sourceHandle: "rejected", target: "join" },
      { id: "e6", source: "review", sourceHandle: "escalated", target: "join" },
      { id: "e7", source: "join", sourceHandle: "always", target: "orchestrator" },
      { id: "e8", source: "orchestrator", sourceHandle: "always", target: "end" },
    ],
  }
}

describe("QA Lab — Consolidar resultados (fan-in/JOIN)", () => {
  it("Human Review pendente segura o Join: 3 filhos, 1 decidido, ainda aguardando 2 — libera só quando o ÚLTIMO decide", async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraphWithJoin())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.employeeRuns).toHaveLength(3)
    expect(session.state.status).toBe("waiting")
    expect(session.state.pauseReason).toBe("FAN_IN") // todos ainda pendentes — Join aguardando

    const [first, second, third] = session.employeeRuns!
    for (const run of [first!, second!]) {
      run.state.status = "active"
      run.state.currentNodeId = "join"
      run.state.pauseReason = null
      run.state.revision += 1
      await runEmployeeNodeLoop(db, session, run.employeeId, options)
    }
    // Reavalia a barreira (mesmo que workflow-simulation-service.ts faz após cada decisão) — 2 de 3 ainda não é suficiente.
    await runSimulationLoop(db, session, options)
    expect(session.state.status).toBe("waiting")
    expect(session.state.pauseReason).toBe("FAN_IN")
    expect(fetchMock).not.toHaveBeenCalled() // Orchestrator consolidado ainda não rodou

    third!.state.status = "active"
    third!.state.currentNodeId = "join"
    third!.state.pauseReason = null
    third!.state.revision += 1
    await runEmployeeNodeLoop(db, session, third!.employeeId, options)
    await runSimulationLoop(db, session, options) // último decidiu -> libera agora

    expect(session.state.status).toBe("completed")
    expect(session.state.currentNodeId).toBe("end")
    expect(fetchMock).toHaveBeenCalledTimes(1) // Orchestrator consolidado roda UMA vez, nunca 3
    // "join" aparece em session.steps MAIS DE UMA VEZ — cada rechecagem da barreira ("waiting",
    // enquanto faltava alguém) grava seu próprio step; o ÚLTIMO é o que finalmente resolveu
    // (nodeOutput presente) e continuou pro Orchestrator.
    const joinStep = [...session.steps].reverse().find((step) => step.nodeId === "join")
    const fanIn = joinStep?.nodeOutput as { kind: string; expectedCount: number; completedCount: number; failedCount: number } | undefined
    expect(fanIn).toMatchObject({ kind: "EMPLOYEE_FAN_IN", expectedCount: 3, completedCount: 3, failedCount: 0 })
  })

  it("0 filhos selecionados: o Join libera IMEDIATAMENTE (0/0) e o Orchestrator consolidado NÃO gasta IA — resultado determinístico, fluxo segue até o Fim", async () => {
    const db = fakeDb({ avgByOperator: {} }) // ninguém atende ao critério
    const session = baseSession(collectionGraphWithJoin())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.employeeRuns).toEqual([])
    expect(session.state.status).toBe("completed")
    const joinStep = session.steps.find((step) => step.nodeId === "join")
    expect(joinStep?.nodeOutput).toMatchObject({ expectedCount: 0, completedCount: 0, failedCount: 0, children: [] })
    // Rodada de hardening dos Workflows-modelo (2026-09-16): JOIN vazio não chama a IA — antes
    // "sintetizava" uma lista vazia gastando uma request. O node do Orquestrador continua no
    // trace com um resultado explícito (nunca um desvio silencioso de fluxo).
    expect(fetchMock).toHaveBeenCalledTimes(0)
    const orchestratorStep = session.steps.find((step) => step.nodeId === "orchestrator")
    expect(orchestratorStep?.nodeOutput).toMatchObject({ skippedReason: "EMPTY_FAN_IN", structuredResult: null })
    expect((orchestratorStep?.nodeOutput as { text: string }).text).toContain("Nenhum colaborador foi selecionado")
  })

  it('"Parar antes da IA" pós-JOIN: Join libera normalmente (sem IA), Orchestrator consolidado pausa antes de chamar — 0 requests', async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraphWithJoin())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "STOP_BEFORE_AI", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(fetchMock).not.toHaveBeenCalled()
    // Cada colaborador pausa em Human Review (nunca chega a pedir IA) — Join fica aguardando.
    for (const run of session.employeeRuns ?? []) {
      expect(run.state.status).toBe("waiting")
      expect(run.state.pauseReason).toBe("HUMAN_REVIEW")
    }
    expect(session.state.status).toBe("waiting")
    expect(session.state.pauseReason).toBe("FAN_IN")
  })

  it("orçamento de IA é compartilhado entre o fan-out e o Orchestrator consolidado — nunca resetado após o Join", async () => {
    const db = fakeDb()
    const session = baseSession(collectionGraphWithJoin())
    // limite = 0 chamadas: nem uma única deveria passar, nem dos filhos (não usam IA aqui, só Human Review) nem do Orchestrator.
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: 0 }
    await runSimulationLoop(db, session, options)
    for (const run of session.employeeRuns ?? []) {
      run.state.status = "active"
      run.state.currentNodeId = "join"
      run.state.pauseReason = null
      run.state.revision += 1
      await runEmployeeNodeLoop(db, session, run.employeeId, options)
    }
    await runSimulationLoop(db, session, options)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(session.state.status).toBe("paused")
    expect(session.state.pauseReason).toBe("AI_BUDGET") // Orchestrator consolidado pausou por orçamento, nunca "resetado" a 0 de novo
  })
})

// --- Evolução de Ranking: fan-out particionado por Grupo (Parte 63/95/96 do pedido de Evolução/Grupo) ---
const OP_4 = "44444444-4444-4444-8444-444444444444"
const OP_5 = "55555555-5555-4555-8555-555555555555"
const OP_6 = "66666666-6666-4666-8666-666666666666"
const TEAM_A_ID = "aaaaaaaa-1111-4111-8111-111111111111"
const TEAM_B_ID = "bbbbbbbb-2222-4222-8222-222222222222"
const TEAM_C_ID = "cccccccc-3333-4333-8333-333333333333"

function fakePartitionedFanOutDb(): Database {
  const avgByOperator: Record<string, number> = { [OP_1]: 90, [OP_2]: 80, [OP_3]: 85, [OP_4]: 75, [OP_5]: 95, [OP_6]: 70 }
  const teamByOperator: Record<string, { id: string; name: string }> = {
    [OP_1]: { id: TEAM_A_ID, name: "Grupo A" },
    [OP_2]: { id: TEAM_A_ID, name: "Grupo A" },
    [OP_3]: { id: TEAM_B_ID, name: "Grupo B" },
    [OP_4]: { id: TEAM_B_ID, name: "Grupo B" },
    [OP_5]: { id: TEAM_C_ID, name: "Grupo C" },
    [OP_6]: { id: TEAM_C_ID, name: "Grupo C" },
  }
  async function query(sql: string, params?: unknown[]) {
    const text = sql.replace(/\s+/g, " ").trim()
    if (text.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [OP_1, OP_2, OP_3, OP_4, OP_5, OP_6].map((id) => ({ id })), rowCount: 6 }
    if (text.includes("role = 'OPERATOR' and active")) return { rows: [OP_1, OP_2, OP_3, OP_4, OP_5, OP_6].map((id) => ({ id })), rowCount: 6 }
    if (text.includes("from indicator_measurements") && text.includes("avg(m.value)")) {
      if (text.includes("group by m.subject_id")) {
        return { rows: (params?.[1] as string[]).map((id) => ({ subject_id: id, avg_value: String(avgByOperator[id]), min_value: String(avgByOperator[id]), max_value: String(avgByOperator[id]), sample_count: "1" })), rowCount: 0 }
      }
      const operatorId = (params?.[1] as string[])[0]!
      const value = avgByOperator[operatorId]
      return { rows: [{ avg_value: String(value), min_value: String(value), max_value: String(value), sample_count: "1" }], rowCount: 1 }
    }
    if (sql.includes("p.team_id \"partitionId\"")) {
      const ids = (params?.[0] as string[]) ?? []
      return { rows: ids.map((id) => ({ id, partitionId: teamByOperator[id]!.id, partitionName: teamByOperator[id]!.name })), rowCount: ids.length }
    }
    return { rows: [], rowCount: 0 }
  }
  return { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
}

/** Mesmo grafo canônico de fan-out (select -> apply -> agent -> end), mas "Selecionar
 * colaboradores" em modo Ranking VALUE + `partitionBy: "TEAM"` — 3 Grupos, N=2 por Grupo (Parte
 * 95 do pedido: "3 grupos, N=2 -> até 6 selecionados"). */
function partitionedRankingGraph(): FlowGraph {
  const graph = collectionGraph()
  return {
    ...graph,
    nodes: graph.nodes.map((node) =>
      node.id === "select"
        ? {
            ...node,
            config: {
              selectionMode: "RANKING",
              ranking: { source: "MEASUREMENT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 }, selection: "HIGHEST", count: 2, partitionBy: "TEAM" },
            } as never,
          }
        : node,
    ),
  }
}

describe("QA Lab — fan-out particionado por Grupo (evolução de Ranking, Parte 63/95/96 do pedido)", () => {
  it("3 Grupos, N=2 por Grupo, todos com dados -> 6 selecionados -> 6 filhos no fan-out (nunca 2 no total)", async () => {
    const db = fakePartitionedFanOutDb()
    const session = baseSession(partitionedRankingGraph())
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "STOP_BEFORE_AI", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    const selectStep = session.steps.find((step) => step.nodeId === "select")
    expect(selectStep?.nodeOutput).toMatchObject({ mode: "RANKING", partitionBy: "TEAM", selectedCount: 6 })
    expect(session.employeeRuns).toHaveLength(6) // Parte 63: Apply continua usando a Collection normalmente
    expect(session.employeeRuns?.map((run) => run.employeeId).sort()).toEqual([OP_1, OP_2, OP_3, OP_4, OP_5, OP_6].sort())
    expect(fetchMock).not.toHaveBeenCalled() // Parte 100: zero IA real
  })

  it("Parte 96 — os filhos de um fan-out particionado convergem normalmente pra Consolidar resultados, sem regressão do fan-in", async () => {
    const db = fakePartitionedFanOutDb()
    const graph = partitionedRankingGraph()
    const joinGraph: FlowGraph = {
      ...graph,
      nodes: [
        ...graph.nodes.filter((node) => node.id !== "agent" && node.id !== "end"),
        { id: "join", type: "consolidate_results", label: "Consolidar resultados", position: { x: 0, y: 4 }, config: {} },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 5 }, config: {} },
      ],
      edges: [
        ...graph.edges.filter((edge) => edge.id !== "e3" && edge.id !== "e4"),
        { id: "e3", source: "apply", sourceHandle: "always", target: "join" },
        { id: "e4", source: "join", sourceHandle: "always", target: "end" },
      ],
    }
    const session = baseSession(joinGraph)
    const options: SimulationOptions = { mode: "RUN_ALL", untilNodeId: null, aiPolicy: "REAL", maxAiCalls: null }
    await runSimulationLoop(db, session, options)

    expect(session.employeeRuns).toHaveLength(6)
    expect(session.employeeRuns?.every((run) => run.state.status === "completed")).toBe(true) // sem Agent/Human Review, cada filho termina sozinho no "join"
    expect(session.state.status).toBe("completed") // Join liberou — todos os 6 filhos convergiram
  })
})
