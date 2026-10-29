import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { executeEscalation } from "./escalate-executor.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

// Efeitos passam pelo sink (effect-sink.ts) — os testes espiam `effects.dispatchAlert`/
// `effects.dispatchWorkflowOutputRows` em vez de mockar módulos.
const effects = createFakeEffects({ findRecentCaseId: vi.fn(async () => "case-1") })
const dispatchAlert = effects.dispatchAlert
const dispatchWorkflowOutputRows = effects.dispatchWorkflowOutputRows

type EscalateActionConfig = Parameters<typeof executeEscalation>[0]

function baseContext(db: Database, overrides: Partial<Parameters<typeof executeEscalation>[1]> = {}) {
  return {
    db,
    organizationId: "org-1",
    enrollmentId: "enrollment-1",
    nodeId: "escalate-1",
    nodeOutputs: {},
    enrollment: { interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null },
    effects,
    ...overrides,
  }
}

/** Cadeia de gestão real: operador-1 → supervisor-1 (a busca por cargo começa no GESTOR do operador). */
function chainRow(params?: unknown[]) {
  return params?.[0] === "operator-1" ? { rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: "supervisor-1" }], rowCount: 1 } : { rows: [{ id: "supervisor-1", role: "SUPERVISOR", reports_to_id: null }], rowCount: 1 }
}

function fakeDb(overrides: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined): Database {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const result = overrides(sql, params)
      if (result) return result
      if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
      if (sql.includes("select name from people")) return { rows: [{ name: "Ana Operadora" }], rowCount: 1 }
      if (sql.includes("from workflow_enrollment_events")) return { rows: [{ case_id: "case-1" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const baseConfig: EscalateActionConfig = {
  actionType: "ESCALATE",
  target: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" },
  surfaces: ["NOTIFICATION"],
}

describe("executeEscalation — Target (reaproveita o mesmo resolvedor hierárquico do Human Review)", () => {
  it("ROLE_OF_OPERATOR sobe reports_to_id a partir do OPERADOR da ocorrência", async () => {
    dispatchAlert.mockClear()
    let call = 0
    const db = fakeDb((sql) => {
      if (sql.includes("select id, role, reports_to_id from people where id")) {
        call += 1
        if (call === 1) return { rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: "supervisor-1" }], rowCount: 1 }
        return { rows: [{ id: "supervisor-1", role: "SUPERVISOR", reports_to_id: null }], rowCount: 1 }
      }
      return undefined
    })
    await executeEscalation(baseConfig, baseContext(db))
    expect(dispatchAlert).toHaveBeenCalledTimes(1)
    expect(dispatchAlert.mock.calls[0]![1]).toMatchObject({ recipientId: "supervisor-1", alertType: "WORKFLOW_ESCALATION" })
  })

  it("ROLE_OF_PREVIOUS_REVIEWER sobe a partir de QUEM DECIDIU o Human Review anterior, não do operador", async () => {
    dispatchAlert.mockClear()
    let call = 0
    const db = fakeDb((sql) => {
      if (sql.includes("select id, role, reports_to_id from people where id")) {
        call += 1
        if (call === 1) return { rows: [{ id: "reviewer-1", role: "SUPERVISOR", reports_to_id: "manager-1" }], rowCount: 1 }
        return { rows: [{ id: "manager-1", role: "MANAGER", reports_to_id: null }], rowCount: 1 }
      }
      return undefined
    })
    const config: EscalateActionConfig = { ...baseConfig, target: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "review-1" } }
    await executeEscalation(config, baseContext(db, { nodeOutputs: { "review-1": { decision: "approved", reviewerId: "reviewer-1" } } }))
    expect(dispatchAlert.mock.calls[0]![1]).toMatchObject({ recipientId: "manager-1" })
  })

  it("SPECIFIC_USER notifica diretamente o id configurado, sem andar hierarquia", async () => {
    dispatchAlert.mockClear()
    const db = fakeDb(() => undefined)
    const config: EscalateActionConfig = { ...baseConfig, target: { type: "SPECIFIC_USER", userId: "person-42" } }
    await executeEscalation(config, baseContext(db))
    expect(dispatchAlert.mock.calls[0]![1]).toMatchObject({ recipientId: "person-42" })
  })

  it("nunca falha silenciosamente: target sem nenhum destinatário resolvido lança erro controlado (Parte 25)", async () => {
    dispatchAlert.mockClear()
    const db = fakeDb((sql) => {
      if (sql.includes("select id, role, reports_to_id from people where id")) {
        return { rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: null }], rowCount: 1 }
      }
      return undefined
    })
    await expect(executeEscalation(baseConfig, baseContext(db))).rejects.toThrow(/destinatário/)
    expect(dispatchAlert).not.toHaveBeenCalled()
  })
})

describe("executeEscalation — Conteúdo e Motivo", () => {
  it("resolve o conteúdo via contentSource (mesmo resolveSource do Output) e inclui o Motivo na descrição do alerta", async () => {
    dispatchAlert.mockClear()
    const db = fakeDb((sql, params) => {
      if (sql.includes("select id, role, reports_to_id from people where id")) return chainRow(params)
      return undefined
    })
    const config: EscalateActionConfig = {
      ...baseConfig,
      contentSource: "nodeOutputs.orch.structuredResult.diagnosis.cause",
      reason: "Reincidência crítica de qualidade",
    }
    await executeEscalation(config, baseContext(db, { nodeOutputs: { orch: { structuredResult: { diagnosis: { cause: "Não seguiu o script." } } } } }))
    const description = (dispatchAlert.mock.calls[0]![1] as { description: string }).description
    expect(description).toContain("Reincidência crítica de qualidade")
  })
})

describe("executeEscalation — múltiplas Surfaces, sem duplicar domínio", () => {
  it("uma Surface de alerta (NOTIFICATION) e uma de registro genérico (INBOX) despacham cada uma pelo seu próprio mecanismo, sem duplicar", async () => {
    dispatchAlert.mockClear()
    dispatchWorkflowOutputRows.mockClear()
    const db = fakeDb((sql, params) => {
      if (sql.includes("select id, role, reports_to_id from people where id")) return chainRow(params)
      return undefined
    })
    const config: EscalateActionConfig = { ...baseConfig, surfaces: ["NOTIFICATION", "INBOX"] }
    await executeEscalation(config, baseContext(db))
    expect(dispatchAlert).toHaveBeenCalledTimes(1)
    expect(dispatchWorkflowOutputRows).toHaveBeenCalledTimes(1)
    expect(dispatchWorkflowOutputRows.mock.calls[0]![3]).toBe("INBOX")
  })

  it("o nodeOutput devolvido carrega target/surfaces/motivo pra auditoria — sem tabela nova (reaproveita o mesmo padrão do SET_VARIABLE)", async () => {
    const db = fakeDb((sql, params) => {
      if (sql.includes("select id, role, reports_to_id from people where id")) return chainRow(params)
      return undefined
    })
    const config: EscalateActionConfig = { ...baseConfig, reason: "Conduta confirmada" }
    const result = await executeEscalation(config, baseContext(db))
    expect(result.nodeOutput).toMatchObject({ recipientCount: 1, surfaces: ["NOTIFICATION"], reason: "Conduta confirmada", caseId: "case-1" })
  })
})
