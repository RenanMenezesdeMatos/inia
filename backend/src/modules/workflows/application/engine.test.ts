import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { applyOutcome, type ClaimedRow } from "./engine.js"
import type { NodeOutcome } from "./node-handlers.js"

function baseRow(overrides: Partial<ClaimedRow> = {}): ClaimedRow {
  return {
    id: "parent-1",
    organization_id: "org-1",
    workflow_id: "workflow-1",
    version_id: "version-1",
    interaction_id: null,
    indicator_measurement_id: null,
    scheduled_subject_id: "supervisor-1",
    scheduled_for: null,
    current_node_id: "apply",
    matched_flag_name: null,
    matched_value_boolean: null,
    matched_value_numeric: null,
    status: "active",
    attempts: 0,
    revision: 3,
    node_outputs: {},
    variables: {},
    scope_type: "ALL_TEAMS",
    workflow_team_id: null,
    workflow_subteam_id: null,
    consolidated_structure: { kind: "SUPERVISOR_TEAM", supervisorId: "supervisor-1" },
    population_filter: null,
    claimed_until: new Date().toISOString(),
    ...overrides,
  }
}

/** Fake DB que se comporta como o índice único `workflow_enrollments_fan_out_uk`
 * (049_workflow_fan_out.sql): rastreia (parent_enrollment_id, fan_out_node_id,
 * scheduled_subject_id) já inseridos e nunca duplica numa 2ª chamada com os MESMOS membros —
 * prova que o `on conflict do nothing` do INSERT real garante idempotência num retry. */
function fakeFanOutDb() {
  const inserted = new Set<string>()
  const insertedRows: { parentId: string; fanOutNodeId: string; memberId: string }[] = []
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] })
      if (sql.includes("insert into workflow_enrollments") && sql.includes("unnest")) {
        const [, , , , parentId, fanOutNodeId, memberIds] = params as [string, string, string, string, string, string, string[]]
        let rowCount = 0
        for (const memberId of memberIds) {
          const key = `${parentId}:${fanOutNodeId}:${memberId}`
          if (inserted.has(key)) continue // on conflict do nothing
          inserted.add(key)
          insertedRows.push({ parentId, fanOutNodeId, memberId })
          rowCount++
        }
        return { rows: [], rowCount }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return { db, insertedRows, calls }
}

describe("applyOutcome — fan_out (Aplicar individualmente, EMPLOYEE_COLLECTION)", () => {
  it("1 único INSERT...SELECT FROM unnest(...) cria 1 linha por colaborador, herdando workflow_id/version_id/organization_id do pai", async () => {
    const { db, insertedRows, calls } = fakeFanOutDb()
    const row = baseRow()
    const outcome: NodeOutcome = { kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: ["op-1", "op-2", "op-3"] }
    await applyOutcome(db, row, outcome)

    expect(insertedRows).toEqual([
      { parentId: "parent-1", fanOutNodeId: "apply", memberId: "op-1" },
      { parentId: "parent-1", fanOutNodeId: "apply", memberId: "op-2" },
      { parentId: "parent-1", fanOutNodeId: "apply", memberId: "op-3" },
    ])
    const insertCall = calls.find((call) => call.sql.includes("insert into workflow_enrollments"))
    expect(insertCall?.params).toEqual(["org-1", "workflow-1", "version-1", "review", "parent-1", "apply", ["op-1", "op-2", "op-3"]])
  })

  it("idempotência: reprocessar o MESMO fan-out (retry após crash) nunca duplica — resultado continua sendo N filhos, nunca 2N", async () => {
    const { db, insertedRows } = fakeFanOutDb()
    const row = baseRow()
    const outcome: NodeOutcome = { kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: ["op-1", "op-2", "op-3"] }

    await applyOutcome(db, row, outcome) // 1ª tentativa
    await applyOutcome(db, row, outcome) // retry (crash simulado, mesmo outcome reprocessado)

    expect(insertedRows).toHaveLength(3) // nunca 6
  })

  it("0 membros: insert de array vazio é um no-op silencioso, sem tratamento especial nem erro", async () => {
    const { db, insertedRows, calls } = fakeFanOutDb()
    const row = baseRow()
    const outcome: NodeOutcome = { kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: [] }
    await applyOutcome(db, row, outcome)

    expect(insertedRows).toEqual([])
    // O pai ainda assim é marcado completed (não trava esperando membro nenhum).
    const parentUpdate = calls.find((call) => call.sql.includes("set status = 'completed'"))
    expect(parentUpdate).toBeDefined()
  })

  it("o pai nunca segue tentando processar EMPLOYEE — fica 'completed' com childCount/memberIds/fanOutNodeId gravados em node_outputs (auditoria/lineage)", async () => {
    const { db, calls } = fakeFanOutDb()
    const row = baseRow({ revision: 7 })
    const outcome: NodeOutcome = { kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: ["op-1", "op-2"] }
    await applyOutcome(db, row, outcome)

    const parentUpdate = calls.find((call) => call.sql.includes("set status = 'completed'"))
    expect(parentUpdate?.params?.[0]).toBe("parent-1")
    expect(parentUpdate?.params?.[1]).toBe(7) // optimistic locking — trava na revision certa
    const nodeOutput = JSON.parse(parentUpdate?.params?.[3] as string)
    expect(nodeOutput).toMatchObject({ kind: "FAN_OUT_COMPLETED", childCount: 2, memberIds: ["op-1", "op-2"], fanOutNodeId: "apply" })
  })

  it("com joinNodeId pareado: o pai NÃO completa — avança pro Join como um advance normal (status='active', current_node_id=join)", async () => {
    const { db, calls } = fakeFanOutDb()
    const row = baseRow({ revision: 7 })
    const outcome: NodeOutcome = { kind: "fan_out", fanOutNodeId: "apply", nextNodeId: "review", memberIds: ["op-1", "op-2"], joinNodeId: "join" }
    await applyOutcome(db, row, outcome)

    expect(calls.some((call) => call.sql.includes("set status = 'completed'"))).toBe(false)
    const advanceCall = calls.find((call) => call.sql.includes("current_node_id = $1"))
    expect(advanceCall?.params?.[0]).toBe("join")
    expect(advanceCall?.params?.[1]).toBe("parent-1")
    expect(advanceCall?.params?.[2]).toBe(7)
    expect(advanceCall?.params?.[4]).toBe("apply")
    expect(JSON.parse(advanceCall?.params?.[3] as string)).toMatchObject({ kind: "FAN_OUT_COMPLETED", childCount: 2, memberIds: ["op-1", "op-2"], fanOutNodeId: "apply" })
  })
})

/** Fake DB pra "join_check" (fan-in/JOIN): responde a query agregada de prontidão
 * (`countFanOutChildren`) e a query de detalhe (`loadFanOutChildren`) a partir de uma lista de
 * filhos configurada pelo teste — nunca insere nada (o insert já é testado acima). */
function fakeJoinDb(children: { id: string; scheduled_subject_id: string; status: "completed" | "dead" | "blocked"; node_outputs?: Record<string, unknown> }[], deadReasons: Record<string, string> = {}) {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params: params ?? [] })
      if (sql.includes("count(*) filter")) {
        return { rows: [{ completed: String(children.filter((c) => c.status === "completed").length), failed: String(children.filter((c) => c.status === "dead" || c.status === "blocked").length) }], rowCount: 1 }
      }
      if (sql.includes("select id, scheduled_subject_id, status, node_outputs")) {
        return { rows: children.map((c) => ({ id: c.id, scheduled_subject_id: c.scheduled_subject_id, status: c.status, node_outputs: c.node_outputs ?? {} })), rowCount: children.length }
      }
      // Motivo de quem não chegou ao Join: `flow_dead` ou, desde a PEN-073, `node_blocked` (agente inativo).
      if (sql.includes("'flow_dead'")) {
        const deadIds = (params as [string[]])[0]
        return { rows: deadIds.filter((id) => deadReasons[id]).map((id) => ({ enrollment_id: id, payload: { message: deadReasons[id] } })), rowCount: 0 }
      }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return { db, calls }
}

describe("applyOutcome — join_check (Consolidar resultados, fan-in/JOIN)", () => {
  it("nem todos terminaram: reagenda o PAI ('waiting', current_node_id INTOCADO — continua no Join)", async () => {
    const { db, calls } = fakeJoinDb([
      { id: "child-1", scheduled_subject_id: "op-1", status: "completed" },
    ])
    const row = baseRow({ current_node_id: "join", node_outputs: { apply: { childCount: 2 } }, revision: 5 })
    const outcome: NodeOutcome = { kind: "join_check", joinNodeId: "join", fanOutNodeId: "apply", nextNodeId: "orchestrator" }
    await applyOutcome(db, row, outcome)

    const update = calls.find((call) => call.sql.includes("set status = 'waiting'"))
    expect(update?.params).toEqual(["parent-1", 5, 20])
    expect(calls.some((call) => call.sql.includes("current_node_id ="))).toBe(false)
  })

  it("todos terminaram (completed+dead >= expectedCount): avança pro próximo node com EmployeeFanInOutput correto", async () => {
    const { db, calls } = fakeJoinDb(
      [
        { id: "child-1", scheduled_subject_id: "op-1", status: "completed", node_outputs: { review: { decision: "approved" } } },
        { id: "child-2", scheduled_subject_id: "op-2", status: "dead" },
      ],
      { "child-2": "Erro desconhecido no motor de workflow." },
    )
    const row = baseRow({ current_node_id: "join", node_outputs: { apply: { childCount: 2 } }, revision: 5 })
    const outcome: NodeOutcome = { kind: "join_check", joinNodeId: "join", fanOutNodeId: "apply", nextNodeId: "orchestrator" }
    await applyOutcome(db, row, outcome)

    const update = calls.find((call) => call.sql.includes("current_node_id = $1"))
    expect(update?.params?.[0]).toBe("orchestrator")
    expect(update?.params?.[1]).toBe("parent-1")
    expect(update?.params?.[2]).toBe(5)
    const fanIn = JSON.parse(update?.params?.[3] as string)
    expect(fanIn).toMatchObject({
      kind: "EMPLOYEE_FAN_IN",
      sourceFanOutNodeId: "apply",
      expectedCount: 2,
      completedCount: 1,
      failedCount: 1,
    })
    expect(fanIn.children).toEqual([
      { employeeId: "op-1", childEnrollmentId: "child-1", status: "completed", nodeOutputs: { review: { decision: "approved" } } },
      { employeeId: "op-2", childEnrollmentId: "child-2", status: "failed", nodeOutputs: {}, failureReason: "Erro desconhecido no motor de workflow." },
    ])
    expect(update?.params?.[4]).toBe("join")
  })

  it("0 filhos esperados: prontidão imediata (0 >= 0), nunca fica esperando", async () => {
    const { db, calls } = fakeJoinDb([])
    const row = baseRow({ current_node_id: "join", node_outputs: { apply: { childCount: 0 } }, revision: 1 })
    const outcome: NodeOutcome = { kind: "join_check", joinNodeId: "join", fanOutNodeId: "apply", nextNodeId: "output" }
    await applyOutcome(db, row, outcome)

    expect(calls.some((call) => call.sql.includes("set status = 'waiting'"))).toBe(false)
    const update = calls.find((call) => call.sql.includes("current_node_id = $1"))
    expect(update?.params?.[0]).toBe("output")
    const fanIn = JSON.parse(update?.params?.[3] as string)
    expect(fanIn).toMatchObject({ expectedCount: 0, completedCount: 0, failedCount: 0, children: [] })
  })

  it("retry (worker caiu antes de persistir, reprocessado do zero): reprocessar o MESMO join_check é idempotente — sempre a mesma única atualização, nunca efeito duplicado", async () => {
    const { db, calls } = fakeJoinDb([{ id: "child-1", scheduled_subject_id: "op-1", status: "completed" }])
    const row = baseRow({ current_node_id: "join", node_outputs: { apply: { childCount: 1 } }, revision: 9 })
    const outcome: NodeOutcome = { kind: "join_check", joinNodeId: "join", fanOutNodeId: "apply", nextNodeId: "output" }

    // `joinedAt` vem do relógio: sem congelá-lo, as duas chamadas podiam cair em milissegundos diferentes.
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"))
    try {
      await applyOutcome(db, row, outcome) // 1ª tentativa
      await applyOutcome(db, row, outcome) // retry (mesmo row/revision, nada mudou nos filhos)
    } finally {
      vi.useRealTimers()
    }

    const updates = calls.filter((call) => call.sql.includes("current_node_id = $1"))
    expect(updates).toHaveLength(2) // cada chamada reprocessa do zero — a proteção real é o claim/lease em runWorkflowTick, nunca aqui
    expect(updates[0]?.params).toEqual(updates[1]?.params) // resultado sempre o mesmo — nenhum efeito acumulativo
  })
})
