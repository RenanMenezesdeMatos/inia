import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import type { QaRunRecord } from "./qa-run-repository.js"

vi.mock("../../../config/env.js", () => ({
  env: { NODE_ENV: "test", GEMINI_API_KEY: "test-key", JWT_SECRET: "s", JWT_EXPIRES_IN: "1h", CORS_ORIGIN: "*", activeDatabaseUrl: "" },
}))

const { startWorkflowSimulation, resumeWorkflowSimulation, submitSimulatedDecision, snapshotOfRun } = await import("./workflow-simulation-service.js")
const { runScheduleCheck } = await import("../../workflows/application/schedule-check.js")
const { isReadOnlySql } = await import("./read-only-database.js")

/** Organização da sessão de quem testa no QA Lab. */
const QA_ORGANIZATION = "00000000-0000-4000-8000-000000000001"

/**
 * Hardening "testar em RASCUNHO" (Parte 1-35 do pedido): o QA Lab executa o rascunho atual sem
 * publicar; o que foi executado fica congelado num snapshot; o scheduler real (runScheduleCheck)
 * e a ingestão continuam enxergando só `active and active_version_id is not null`. O banco fake
 * abaixo mantém uma "tabela" workflows em memória compartilhada entre o QA Lab e o scheduler —
 * é assim que os testes provam a separação QA ≠ Publicação com o MESMO dado.
 */
const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const VERSION_ID = "77777777-7777-4777-8777-777777777777"
const AGENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const OPERATOR_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
const SUPERVISOR_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"
const MANAGER_ID = "99999999-9999-4999-8999-999999999999"
const TEAM_ID = "11111111-1111-4111-8111-111111111111"
const ADMIN_ID = "22222222-2222-4222-8222-222222222222"
const NOW = "2026-10-04T12:00:00.000Z"

type Row = Record<string, unknown>

/** Grafo de agenda com Condition determinística → Fim (rascunho típico "antes de publicar"). */
function conditionGraph(label = "Nota URA < 3"): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "condition", type: "condition", label, position: { x: 0, y: 1 }, config: { comparator: "LT", thresholdNumeric: 3, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } } } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
      { id: "e2", source: "condition", sourceHandle: "true", target: "end" },
      { id: "e3", source: "condition", sourceHandle: "false", target: "end" },
      { id: "e4", source: "condition", sourceHandle: "no_data", target: "end" },
    ],
  }
}

/** Rascunho "completo": Trigger → Condition → Agent → Wait → Human Review → Output → Escalonar → Fim. */
function fullDraftGraph(): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "condition", type: "condition", label: "Nota URA < 3", position: { x: 0, y: 1 }, config: { comparator: "LT", thresholdNumeric: 3, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "ROLLING_DAYS", days: 30 } } } },
      { id: "agent", type: "action", label: "Agente", position: { x: 0, y: 2 }, config: { actionType: "CALL_AGENT", agentId: AGENT_ID, scheduledDataSource: { kind: "INDICATOR", indicatorCode: "NOTA_URA", period: "MONTH" } } },
      { id: "wait", type: "wait", label: "Aguardar 1 dia", position: { x: 0, y: 3 }, config: { durationMs: 24 * 60 * 60 * 1000 } },
      { id: "review", type: "human_review", label: "Revisão", position: { x: 0, y: 4 }, config: { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" }, contentSource: "nodeOutputs.agent" } },
      { id: "output", type: "output", label: "Publicar", position: { x: 0, y: 5 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP", "NOTIFICATION"], source: "nodeOutputs.agent" } },
      { id: "escalate", type: "action", label: "Escalonar", position: { x: 0, y: 6 }, config: { actionType: "ESCALATE", target: { type: "ROLE_OF_OPERATOR", role: "MANAGER" }, surfaces: ["NOTIFICATION", "INBOX"], reason: "Teste" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 7 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
      { id: "e2", source: "condition", sourceHandle: "true", target: "agent" },
      { id: "e3", source: "condition", sourceHandle: "false", target: "end" },
      { id: "e4", source: "condition", sourceHandle: "no_data", target: "end" },
      { id: "e5", source: "agent", sourceHandle: "always", target: "wait" },
      { id: "e6", source: "wait", sourceHandle: "always", target: "review" },
      { id: "e7", source: "review", sourceHandle: "approved", target: "output" },
      { id: "e8", source: "review", sourceHandle: "rejected", target: "end" },
      { id: "e9", source: "review", sourceHandle: "escalated", target: "escalate" },
      { id: "e10", source: "output", sourceHandle: "always", target: "escalate" },
      { id: "e11", source: "escalate", sourceHandle: "always", target: "end" },
    ],
  }
}

type WorkflowTable = {
  id: string
  name: string
  active: boolean
  active_version_id: string | null
  draft_graph: FlowGraph
  published_graph: FlowGraph | null
  trigger_config: Row
}

function qaRunRecordFrom(params: unknown[], id: string): QaRunRecord {
  const [, executedBy, resourceType, resourceId, resourceName, status, input, context, state, trace, aiCalls, inputTokens, outputTokens, totalTokens, durationMs, errorMessage] = params
  return {
    id,
    executedBy: executedBy as string,
    executedByName: "Admin Global",
    resourceType: resourceType as QaRunRecord["resourceType"],
    resourceId: resourceId as string,
    resourceName: resourceName as string,
    status: status as QaRunRecord["status"],
    input: JSON.parse(input as string),
    context: JSON.parse(context as string),
    state: state ? JSON.parse(state as string) : null,
    trace: JSON.parse(trace as string),
    aiCalls: aiCalls as number,
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number,
    durationMs: durationMs as number,
    errorMessage: errorMessage as string | null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

/**
 * Banco fake com uma "tabela" workflows mutável (`table`), a mesma pra QA Lab e pra
 * runScheduleCheck. Registra TODAS as escritas — a lista `writes` é a prova de zero side effect.
 */
function fakeDatabase(table: WorkflowTable) {
  const writes: string[] = []
  const runs = new Map<string, QaRunRecord>()
  const enrollments: unknown[][] = []
  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim()
    if (!isReadOnlySql(text)) writes.push(text)

    if (text.startsWith("insert into qa_runs")) {
      const id = `run-${runs.size + 1}`
      runs.set(id, qaRunRecordFrom(params, id))
      return { rows: [{ id }], rowCount: 1 }
    }
    if (text.startsWith("update qa_runs")) {
      const [id, status, state, trace, aiCalls, inputTokens, outputTokens, totalTokens, durationMs, errorMessage] = params
      const current = runs.get(id as string)!
      runs.set(id as string, { ...current, status: status as QaRunRecord["status"], state: state ? JSON.parse(state as string) : null, trace: JSON.parse(trace as string), aiCalls: aiCalls as number, inputTokens: inputTokens as number, outputTokens: outputTokens as number, totalTokens: totalTokens as number, durationMs: current.durationMs + (durationMs as number), errorMessage: errorMessage as string | null })
      return { rows: [], rowCount: 1 }
    }
    if (text.includes("from qa_runs r")) {
      const run = runs.get(params[1] as string)
      return { rows: run ? [run] : [], rowCount: run ? 1 : 0 }
    }

    // ---- workflows: QA Lab lê tudo; o scheduler filtra `active and active_version_id is not null` ----
    if (text.includes("from workflows w where w.id = $1")) {
      return { rows: [{ id: table.id, name: table.name, scope_type: "ALL_TEAMS", team_id: null, subteam_id: null, trigger_config: table.trigger_config, consolidated_structure: null, population_filter: null, active_version_id: table.active_version_id, draft_graph: table.draft_graph, published_graph: table.published_graph }], rowCount: 1 }
    }
    if (text.includes("from workflows w") && text.includes("trigger_config ->> 'kind' = 'schedule'")) {
      expect(text).toContain("w.active and w.active_version_id is not null")
      const eligible = table.active && table.active_version_id !== null && table.trigger_config.kind === "schedule"
      return eligible
        ? { rows: [{ id: table.id, version_id: table.active_version_id, scope_type: "ALL_TEAMS", team_id: null, mode: table.trigger_config.mode ?? null, times: table.trigger_config.times, interval_days: 1, anchor_date: null, frequency: table.trigger_config.frequency ?? null, relative: null, consolidated_structure: null, population_filter: null }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (text.includes("from workflow_versions")) return { rows: [{ graph: table.published_graph }], rowCount: 1 }
    if (text.startsWith("insert into workflow_enrollments")) {
      enrollments.push(params)
      return { rows: [{ id: "enrollment-x" }], rowCount: 1 }
    }
    if (text.includes("from operations where organization_id")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }

    // ---- dados reais lidos pela simulação ----
    const people: Record<string, Row> = {
      [OPERATOR_ID]: { id: OPERATOR_ID, name: "João Silva", role: "OPERATOR", team_id: TEAM_ID, team_name: "FATURAS", subteam_name: null, reports_to_id: SUPERVISOR_ID },
      [SUPERVISOR_ID]: { id: SUPERVISOR_ID, name: "Carlos", role: "SUPERVISOR", team_id: TEAM_ID, team_name: "FATURAS", subteam_name: null, reports_to_id: MANAGER_ID },
      [MANAGER_ID]: { id: MANAGER_ID, name: "Gerente X", role: "MANAGER", team_id: TEAM_ID, team_name: "FATURAS", subteam_name: null, reports_to_id: null },
    }
    if (text.startsWith("select id from people where organization_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: OPERATOR_ID }], rowCount: 1 }
    if (text.includes("from people p left join teams t on t.id = p.team_id where p.id = any")) {
      const ids = params[0] as string[]
      return { rows: ids.filter((id) => people[id]).map((id) => people[id]), rowCount: ids.length }
    }
    if (text.includes("from people p left join teams t on t.id = p.team_id left join subteams st") && text.includes("where p.id = $1")) {
      const person = people[params[0] as string]
      return { rows: person ? [person] : [], rowCount: person ? 1 : 0 }
    }
    if (text.includes("select id, role, reports_to_id from people where id = $1")) {
      const person = people[params[0] as string]
      return { rows: person ? [person] : [], rowCount: person ? 1 : 0 }
    }
    if (text.includes("select name from people where id = $1")) return { rows: [{ name: (people[params[0] as string]?.name as string) ?? "?" }], rowCount: 1 }
    if (text.includes("select team_id from people where id = $1")) return { rows: [{ team_id: TEAM_ID }], rowCount: 1 }
    if (text.includes("select avg(m.value) filter (where m.eligible)::numeric avg_value")) return { rows: [{ avg_value: "2.5", min_value: "2", max_value: "3", sample_count: "4" }], rowCount: 1 }
    if (text.includes("hired_at::text hired_at, operational_capital_code from people")) return { rows: (params[0] as string[]).map((id) => ({ id, organization_id: "org", hired_at: null, operational_capital_code: null })), rowCount: 0 }
    if (text.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
    if (text.includes("from employee_work_shifts") || text.includes("from employee_indicator_performance") || text.includes("from employee_prv_performance")) return { rows: [], rowCount: 0 }
    if (text.includes("select id, name, unit, desired_direction from indicator_definitions")) return { rows: [{ id: "idef", name: "Nota URA", unit: "pts", desired_direction: "HIGHER" }], rowCount: 1 }
    if (text.includes("select avg(m.value)::numeric avg_value, array_agg(m.id) ids")) return { rows: [{ avg_value: "2.5", ids: ["m1"] }], rowCount: 1 }
    if (text.includes("select target_value from goals")) return { rows: [{ target_value: "4" }], rowCount: 1 }
    if (/select name, objective, description, context_prompt, active[a-z_, ]* from agents/.test(text)) return { rows: [{ name: "Agente URA", objective: "obj", description: "d", context_prompt: "p", active: true }], rowCount: 1 }
    if (text.includes("select id, name from agents where id = any")) return { rows: [{ id: AGENT_ID, name: "Agente URA" }], rowCount: 1 }
    if (text.includes("from agent_knowledge_documents") || text.includes("from prohibited_topics") || text.includes("from call_expectations")) return { rows: [], rowCount: 0 }
    return { rows: [], rowCount: 0 }
  }
  const db = { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database
  return { db, writes, runs, enrollments, table }
}

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const schedule = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 4 } }
const baseInput = { workflowId: WORKFLOW_ID, subject: { kind: "operator" as const, operatorId: OPERATOR_ID }, mode: "RUN_ALL" as const, aiPolicy: "STOP_BEFORE_AI" as const, simulatedNow: NOW, scheduledFor: NOW }

function draftOnly(graph = conditionGraph()): WorkflowTable {
  return { id: WORKFLOW_ID, name: "Fixture rascunho", active: true, active_version_id: null, draft_graph: graph, published_graph: null, trigger_config: schedule }
}

describe("QA Lab — testar Workflow em RASCUNHO (sem publicar)", () => {
  it("executa o rascunho de um workflow nunca publicado, com Agenda de calendário no relógio simulado", async () => {
    const { db, writes, enrollments } = fakeDatabase(draftOnly())
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")
    expect(run.context.workflow).toMatchObject({ workflowState: "DRAFT", versionId: null, graphSource: "DRAFT", rerunOfSnapshot: false })
    expect(run.trace.steps.map((step) => `${step.nodeId}:${step.outcome?.branch ?? "-"}`)).toEqual(["trigger:-", "condition:true", "end:-"])
    expect(run.context.trigger).toMatchObject({ kind: "schedule", scheduledFor: NOW })
    expect(snapshotOfRun(run)).toMatchObject({ workflowId: WORKFLOW_ID, workflowState: "DRAFT", graphChecksum: expect.stringMatching(/^[0-9a-f]{12}$/) })
    // Zero enrollment operacional, zero escrita além de qa_runs.
    expect(enrollments).toEqual([])
    expect(writes.map((sql) => sql.slice(0, 19))).toEqual(["insert into qa_runs"])
  })

  it("rascunho é o padrão quando graphSource não é informado; PUBLISHED sem versão publicada é erro claro", async () => {
    const { db } = fakeDatabase(draftOnly())
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, graphSource: undefined }, ADMIN_ID)
    expect(run.context.workflow).toMatchObject({ workflowState: "DRAFT" })
    await expect(startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, graphSource: "PUBLISHED" }, ADMIN_ID)).rejects.toMatchObject({ code: "QA_WORKFLOW_NOT_PUBLISHED" })
  })

  it("Published + Draft diferente: QA Draft usa o draft, QA Published usa a versão publicada (nunca mistura)", async () => {
    const table: WorkflowTable = { ...draftOnly(conditionGraph("Condição do RASCUNHO")), active_version_id: VERSION_ID, published_graph: conditionGraph("Condição PUBLICADA") }
    const { db } = fakeDatabase(table)
    const draft = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, graphSource: "DRAFT" }, ADMIN_ID)
    const published = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, graphSource: "PUBLISHED" }, ADMIN_ID)
    expect(draft.trace.steps[1]!.label).toBe("Condição do RASCUNHO")
    expect(published.trace.steps[1]!.label).toBe("Condição PUBLICADA")
    expect(draft.context.workflow).toMatchObject({ workflowState: "DRAFT", versionId: null })
    expect(published.context.workflow).toMatchObject({ workflowState: "PUBLISHED", versionId: VERSION_ID })
    expect(snapshotOfRun(draft)!.graphChecksum).not.toBe(snapshotOfRun(published)!.graphChecksum)
  })

  it("alterar o draft DEPOIS de iniciar: passo a passo, Human Review e Wait retomam o snapshot inicial", async () => {
    const graph = fullDraftGraph()
    const { db, table } = fakeDatabase(draftOnly(graph))
    // Passo a passo: só o Trigger roda; em seguida o admin "edita" o rascunho no editor.
    const started = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, mode: "STEP" }, ADMIN_ID)
    expect(started.state).toMatchObject({ currentNodeId: "condition", pauseReason: "STEP" })
    table.draft_graph = conditionGraph("Condição EDITADA depois")
    const step2 = await resumeWorkflowSimulation(db, QA_ORGANIZATION, started.id, { mode: "STEP" })
    expect(step2.trace.steps[1]!.label).toBe("Nota URA < 3") // rótulo do snapshot, não "EDITADA"
    expect(step2.state).toMatchObject({ currentNodeId: "agent", pauseReason: "STEP" })
    // Continua com IA real "ligada" no mock → agente responde JSON de indicador → Wait → pausa.
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Nota URA abaixo da meta", summary: "Média 2,5 contra meta 4.", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Revise a abordagem inicial." }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }), text: async () => "" }))
    const waiting = await resumeWorkflowSimulation(db, QA_ORGANIZATION, step2.id, { mode: "RUN_ALL", aiPolicy: "REAL" })
    expect(waiting.state).toMatchObject({ currentNodeId: "wait", pauseReason: "WAIT" })
    table.draft_graph = conditionGraph("Outra edição")
    const review = await resumeWorkflowSimulation(db, QA_ORGANIZATION, waiting.id, {})
    expect(review.state).toMatchObject({ currentNodeId: "review", pauseReason: "HUMAN_REVIEW" })
    expect(review.trace.pendingReview).toMatchObject({ reviewerIds: [SUPERVISOR_ID] })
    table.draft_graph = conditionGraph("Terceira edição")
    const done = await submitSimulatedDecision(db, QA_ORGANIZATION, review.id, "approved", ADMIN_ID)
    expect(done.status).toBe("COMPLETED")
    expect(done.trace.steps.map((step) => step.nodeId)).toEqual(["trigger", "condition", "agent", "wait", "wait", "review", "review", "output", "escalate", "end"])
    // O snapshot persistido continua sendo o grafo ORIGINAL de 8 nodes.
    expect((snapshotOfRun(done)!.graph as FlowGraph).nodes).toHaveLength(8)
    expect(done.aiCalls).toBe(1)
  })

  it("rerun histórico reexecuta o snapshot original mesmo com o draft alterado; 'testar rascunho atual' usa o draft novo", async () => {
    const { db, table } = fakeDatabase(draftOnly(conditionGraph("Versão A")))
    const first = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    table.draft_graph = conditionGraph("Versão B")
    table.name = "Fixture renomeado"
    const rerun = await startWorkflowSimulation(db, QA_ORGANIZATION, first.input as typeof baseInput, ADMIN_ID, { snapshot: snapshotOfRun(first)! })
    expect(rerun.id).not.toBe(first.id)
    expect(rerun.trace.steps[1]!.label).toBe("Versão A")
    expect(rerun.resourceName).toBe("Fixture rascunho")
    expect(rerun.context.workflow).toMatchObject({ rerunOfSnapshot: true, graphChecksum: snapshotOfRun(first)!.graphChecksum })
    const current = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...(first.input as typeof baseInput), graphSource: "DRAFT" }, ADMIN_ID)
    expect(current.trace.steps[1]!.label).toBe("Versão B")
    expect(current.resourceName).toBe("Fixture renomeado")
    expect(snapshotOfRun(current)!.graphChecksum).not.toBe(snapshotOfRun(first)!.graphChecksum)
  })

  it("rerun do snapshot continua possível mesmo depois de o Workflow ser excluído", async () => {
    const { db, table } = fakeDatabase(draftOnly(conditionGraph("Versão A")))
    const first = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    ;(table as { id: string }).id = "deleted" // o SELECT do workflow atual passa a não bater mais
    const rerun = await startWorkflowSimulation(db, QA_ORGANIZATION, first.input as typeof baseInput, ADMIN_ID, { snapshot: snapshotOfRun(first)! })
    expect(rerun.status).toBe("COMPLETED")
    expect(rerun.trace.steps[1]!.label).toBe("Versão A")
  })

  it("zero side effects num rascunho completo (Trigger, Condition, Action, Wait, Human Review, Output, Escalonar) — só qa_runs é escrito", async () => {
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ title: "Nota URA abaixo da meta", summary: "Média 2,5 contra meta 4.", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Revise a abordagem inicial." }) }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }), text: async () => "" }))
    const { db, writes, enrollments } = fakeDatabase(draftOnly(fullDraftGraph()))
    const started = await startWorkflowSimulation(db, QA_ORGANIZATION, { ...baseInput, aiPolicy: "REAL" }, ADMIN_ID)
    const afterWait = await resumeWorkflowSimulation(db, QA_ORGANIZATION, started.id, {})
    const done = await submitSimulatedDecision(db, QA_ORGANIZATION, afterWait.id, "approved", ADMIN_ID)
    expect(done.status).toBe("COMPLETED")
    expect(done.trace.effects.map((effect) => `${effect.kind}@${effect.nodeId}`)).toEqual([
      "AGENT_RUN@agent",
      "ALERT@review",
      "FEEDBACK@output",
      "ALERT@output",
      "ALERT@escalate",
      "WORKFLOW_OUTPUT@escalate",
    ])
    expect(enrollments).toEqual([])
    expect(writes.every((sql) => sql.startsWith("insert into qa_runs") || sql.startsWith("update qa_runs"))).toBe(true)
    expect(writes.some((sql) => /interactions|workflow_enrollments|outbox_events|into alerts|workflow_outputs|feedbacks|agent_runs|org_config_values/.test(sql))).toBe(false)
  })

  it("scheduler real: um rascunho testado no QA Lab NUNCA é matriculado; só depois de publicar explicitamente", async () => {
    const { db, table, enrollments } = fakeDatabase(draftOnly())
    const run = await startWorkflowSimulation(db, QA_ORGANIZATION, baseInput, ADMIN_ID)
    expect(run.status).toBe("COMPLETED")
    // Dia 4 às 09:00 local (12:00Z) — o horário está vencido, mas o workflow não tem versão publicada.
    await runScheduleCheck(db, new Date(NOW))
    expect(enrollments).toEqual([])
    expect(table.active_version_id).toBeNull() // o QA Lab não publicou nada por conta própria
    // Publicação explícita (o que o botão Publicar faz: active_version_id apontando pra versão).
    table.active_version_id = VERSION_ID
    table.published_graph = table.draft_graph
    const { enrolled } = await runScheduleCheck(db, new Date(NOW))
    expect(enrolled).toBe(1)
    expect(enrollments).toHaveLength(1)
  })
})
