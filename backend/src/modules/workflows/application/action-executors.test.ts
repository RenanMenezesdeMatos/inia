import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { ActionConfig, FlowGraph } from "../domain/graph-schema.js"
import { actionExecutors, resolvePeriodWindow, resolvePreviousPeriodWindow, type ActionExecutionContext } from "./action-executors.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

function fakeContext(
  query: Database["query"],
  executionContext?: { nodeOutputs?: Record<string, unknown>; variables?: Record<string, unknown> },
): ActionExecutionContext {
  return {
    db: { query } as unknown as Database,
    organizationId: "org-1",
    workflowId: "workflow-1",
    workflowVersionId: null,
    nodeId: "action-1",
    graph: { nodes: [], edges: [] } as FlowGraph,
    enrollment: {
      id: "enrollment-1",
      interactionId: null,
      indicatorMeasurementId: null,
      scheduledSubjectId: null,
      matchedFlagName: null,
      matchedValueBoolean: null,
      matchedValueNumeric: null,
      nodeOutputs: executionContext?.nodeOutputs ?? {},
      variables: executionContext?.variables ?? {},
    },
    scopeType: "ALL_TEAMS",
    teamId: null,
    subteamId: null,
    inputContext: "",
    now: new Date(),
    effects: createFakeEffects(),
  }
}

describe("actionExecutors.SET_VARIABLE — valor fixo (legado)", () => {
  it("returns a variableUpdate when the value matches the variable's declared type", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "BOOLEAN" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", value: true }
    const result = await actionExecutors.SET_VARIABLE(config, fakeContext(query as unknown as Database["query"]))
    expect(result).toEqual({
      variableUpdate: { variableId: "var-1", value: true },
      nodeOutput: { variableId: "var-1", value: true, source: "FIXED" },
    })
  })

  it("rejects a value whose type doesn't match the variable's declared type", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "NUMERIC" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", value: "not a number" }
    await expect(actionExecutors.SET_VARIABLE(config, fakeContext(query as unknown as Database["query"]))).rejects.toThrow(/compatível/)
  })

  it("rejects when the variable no longer exists in this workflow", async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "gone", value: 1 }
    await expect(actionExecutors.SET_VARIABLE(config, fakeContext(query as unknown as Database["query"]))).rejects.toThrow(/não existe/)
  })

  it("rejects a SET_VARIABLE with neither value nor sourcePath", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "NUMERIC" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1" }
    await expect(actionExecutors.SET_VARIABLE(config, fakeContext(query as unknown as Database["query"]))).rejects.toThrow(/[Nn]enhum valor fixo/)
  })
})

describe("actionExecutors.SET_VARIABLE — valor dinâmico (Parte 5/6/7/8 da evolução de variáveis)", () => {
  it("resolve a partir do valor do gatilho (nodeOutputs.trigger)", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "NUMERIC" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.trigger" }
    const context = fakeContext(query as unknown as Database["query"], { nodeOutputs: { trigger: 2.5 } })
    const result = await actionExecutors.SET_VARIABLE(config, context)
    expect(result).toEqual({
      variableUpdate: { variableId: "var-1", value: 2.5 },
      nodeOutput: { variableId: "var-1", value: 2.5, source: "DYNAMIC", sourcePath: "nodeOutputs.trigger" },
    })
  })

  it("resolve a partir de um campo de Structured Output de um node anterior", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "TEXT" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.orch.structuredResult.diagnosis.severity" }
    const context = fakeContext(query as unknown as Database["query"], {
      nodeOutputs: { orch: { structuredResult: { diagnosis: { severity: "CRITICAL" } } } },
    })
    const result = await actionExecutors.SET_VARIABLE(config, context)
    expect(result.variableUpdate).toEqual({ variableId: "var-1", value: "CRITICAL" })
  })

  it("resolve a partir de outra variável do workflow", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "NUMERIC" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-b", sourcePath: "variables.var-a" }
    const context = fakeContext(query as unknown as Database["query"], { variables: { "var-a": 87 } })
    const result = await actionExecutors.SET_VARIABLE(config, context)
    expect(result.variableUpdate).toEqual({ variableId: "var-b", value: 87 })
  })

  it("rejects quando a origem dinâmica ainda não produziu nenhum valor nesta execução", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "NUMERIC" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.orch" }
    await expect(actionExecutors.SET_VARIABLE(config, fakeContext(query as unknown as Database["query"]))).rejects.toThrow(/resolver o valor din/)
  })

  it("rejects quando a origem dinâmica resolve pra um objeto/lista (não é um tipo simples)", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "TEXT" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.orch" }
    const context = fakeContext(query as unknown as Database["query"], { nodeOutputs: { orch: { feedback: "texto" } } })
    await expect(actionExecutors.SET_VARIABLE(config, context)).rejects.toThrow(/tipo simples/)
  })

  it("rejects quando o valor dinâmico resolvido é incompatível com o tipo declarado da variável", async () => {
    const query = vi.fn(async () => ({ rows: [{ type: "NUMERIC" }], rowCount: 1 }))
    const config: ActionConfig = { actionType: "SET_VARIABLE", variableId: "var-1", sourcePath: "nodeOutputs.trigger" }
    const context = fakeContext(query as unknown as Database["query"], { nodeOutputs: { trigger: "não é número" } })
    await expect(actionExecutors.SET_VARIABLE(config, context)).rejects.toThrow(/compatível/)
  })
})

describe("resolvePeriodWindow — quadrimestre e semestre (Parte 2/10)", () => {
  it("FOUR_MONTHS resolve o quadrimestre civil ANTERIOR completo (não o corrente, nunca parcial)", () => {
    // 2026-06-10 -03:00 está no quadrimestre corrente (Mai-Ago) -> anterior é Jan-Abr/2026.
    const now = new Date("2026-06-10T12:00:00Z")
    const window = resolvePeriodWindow("FOUR_MONTHS", now)
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-01-01")
    expect(window.end.toISOString().slice(0, 10)).toBe("2026-05-01")
  })

  it("SEMESTER resolve o semestre civil ANTERIOR completo", () => {
    // 2026-08-20 -03:00 está no 2º semestre (Jul-Dez) -> anterior é Jan-Jun/2026.
    const now = new Date("2026-08-20T12:00:00Z")
    const window = resolvePeriodWindow("SEMESTER", now)
    expect(window.start.toISOString().slice(0, 10)).toBe("2026-01-01")
    expect(window.end.toISOString().slice(0, 10)).toBe("2026-07-01")
  })

  it("SEMESTER vira a virada de ano corretamente (2º semestre anterior = ano passado)", () => {
    // 2026-02-05 -03:00 está no 1º semestre -> anterior é Jul-Dez/2025.
    const now = new Date("2026-02-05T12:00:00Z")
    const window = resolvePeriodWindow("SEMESTER", now)
    expect(window.start.toISOString().slice(0, 10)).toBe("2025-07-01")
    expect(window.end.toISOString().slice(0, 10)).toBe("2026-01-01")
  })
})

describe("resolvePreviousPeriodWindow — 'período anterior ao anterior' nunca pula uma competência", () => {
  const now = new Date("2026-09-15T12:00:00.000Z")

  it("MONTH/PREVIOUS: o anterior de agosto é julho inteiro (não junho)", () => {
    const current = resolvePeriodWindow("MONTH", now, "PREVIOUS")
    const previous = resolvePreviousPeriodWindow("MONTH", now, "PREVIOUS")
    expect(previous.end.toISOString()).toBe(current.start.toISOString())
    expect(previous.start.toISOString()).toBe("2026-07-01T03:00:00.000Z")
    expect(previous.end.toISOString()).toBe("2026-08-01T03:00:00.000Z")
  })

  it("MONTH/CURRENT: o anterior de 'este mês' é o mês passado completo", () => {
    const previous = resolvePreviousPeriodWindow("MONTH", now, "CURRENT")
    expect(previous.start.toISOString()).toBe("2026-08-01T03:00:00.000Z")
    expect(previous.end.toISOString()).toBe("2026-09-01T03:00:00.000Z")
  })

  it("WEEK/PREVIOUS e DAY/PREVIOUS: janelas contíguas, sem lacuna", () => {
    for (const unit of ["WEEK", "DAY", "QUARTER"]) {
      const current = resolvePeriodWindow(unit, now, "PREVIOUS")
      const previous = resolvePreviousPeriodWindow(unit, now, "PREVIOUS")
      expect(previous.end.getTime(), unit).toBe(current.start.getTime())
      expect(previous.start.getTime(), unit).toBeLessThan(previous.end.getTime())
    }
  })
})
