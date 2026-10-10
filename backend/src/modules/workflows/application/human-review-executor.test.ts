import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { HumanReviewNodeConfig } from "../domain/graph-schema.js"
import { notifyHumanReviewPending } from "./human-review-executor.js"
import { createFakeEffects } from "../testing/fake-effect-sink.js"

// Efeitos passam pelo sink (effect-sink.ts) — o teste espia `effects.dispatchAlert`.
const effects = createFakeEffects()
const dispatchAlert = effects.dispatchAlert

function baseContext(db: Database, overrides: Partial<Parameters<typeof notifyHumanReviewPending>[1]> = {}) {
  return {
    db,
    organizationId: "org-1",
    enrollmentId: "enrollment-1",
    nodeId: "review-2",
    nodeOutputs: {},
    enrollment: { interactionId: "interaction-1", indicatorMeasurementId: null, scheduledSubjectId: null },
    effects,
    ...overrides,
  }
}

function fakeDb(overrides: (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined): Database {
  return {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const result = overrides(sql, params)
      if (result) return result
      if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
      if (sql.includes("select name from people")) return { rows: [{ name: "Ana Operadora" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

describe("notifyHumanReviewPending", () => {
  it("ROLE_OF_OPERATOR sobe reports_to_id a partir do OPERADOR da ocorrência", async () => {
    dispatchAlert.mockClear()
    // A cadeia começa no próprio operador (que não tem o cargo pedido) e sobe até achar o
    // supervisor — mesma navegação de sempre (resolveByRoleChain), sem mudança de comportamento.
    let call = 0
    const db: Database = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("select name from people where id")) return { rows: [{ name: "Ana Operadora" }], rowCount: 1 }
        if (sql.includes("select id, role, reports_to_id from people where id")) {
          call += 1
          if (call === 1) return { rows: [{ id: "operator-1", role: "OPERATOR", reports_to_id: "supervisor-1" }], rowCount: 1 }
          return { rows: [{ id: "supervisor-1", role: "SUPERVISOR", reports_to_id: null }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const config: HumanReviewNodeConfig = { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } }
    await notifyHumanReviewPending(config, baseContext(db))
    expect(dispatchAlert).toHaveBeenCalledTimes(1)
    expect(dispatchAlert.mock.calls[0]![1]).toMatchObject({ recipientId: "supervisor-1", alertType: "WORKFLOW_HUMAN_REVIEW" })
  })

  it("ROLE_OF_PREVIOUS_REVIEWER lê reviewerId gravado em node_outputs[previousReviewNodeId] e sobe a partir DELE, não do operador", async () => {
    dispatchAlert.mockClear()
    let call = 0
    const db: Database = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("from interactions")) return { rows: [{ operator_id: "operator-1" }], rowCount: 1 }
        if (sql.includes("select name from people where id")) return { rows: [{ name: "Ana Operadora" }], rowCount: 1 }
        if (sql.includes("select id, role, reports_to_id from people where id")) {
          call += 1
          // primeira chamada da cadeia parte do REVISOR anterior (reviewer-1), nunca do operador.
          if (call === 1) return { rows: [{ id: "reviewer-1", role: "SUPERVISOR", reports_to_id: "manager-1" }], rowCount: 1 }
          return { rows: [{ id: "manager-1", role: "MANAGER", reports_to_id: null }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    const config: HumanReviewNodeConfig = {
      reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "review-1" },
    }
    await notifyHumanReviewPending(
      config,
      baseContext(db, { nodeOutputs: { "review-1": { decision: "approved", reviewerId: "reviewer-1", decidedAt: "2026-01-01T00:00:00Z" } } }),
    )
    expect(dispatchAlert).toHaveBeenCalledTimes(1)
    expect(dispatchAlert.mock.calls[0]![1]).toMatchObject({ recipientId: "manager-1" })
  })

  it("ROLE_OF_PREVIOUS_REVIEWER sem decisão anterior ainda registrada não notifica ninguém (best-effort)", async () => {
    dispatchAlert.mockClear()
    const db = fakeDb(() => undefined)
    const config: HumanReviewNodeConfig = {
      reviewTarget: { type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: "review-1" },
    }
    await notifyHumanReviewPending(config, baseContext(db, { nodeOutputs: {} }))
    expect(dispatchAlert).not.toHaveBeenCalled()
  })

  it("SPECIFIC_USER notifica diretamente o id configurado, sem andar hierarquia nenhuma", async () => {
    dispatchAlert.mockClear()
    const db = fakeDb(() => undefined)
    const config: HumanReviewNodeConfig = { reviewTarget: { type: "SPECIFIC_USER", userId: "person-42" } }
    await notifyHumanReviewPending(config, baseContext(db))
    expect(dispatchAlert).toHaveBeenCalledTimes(1)
    expect(dispatchAlert.mock.calls[0]![1]).toMatchObject({ recipientId: "person-42" })
  })

  it("instrução e conteúdo resolvido (contentSource) entram na descrição do alerta", async () => {
    dispatchAlert.mockClear()
    const db = fakeDb(() => undefined)
    const config: HumanReviewNodeConfig = {
      reviewTarget: { type: "SPECIFIC_USER", userId: "person-42" },
      instruction: "Valide se a conduta foi realmente inadequada.",
      contentSource: "nodeOutputs.orch.structuredResult.diagnosis.cause",
    }
    await notifyHumanReviewPending(
      config,
      baseContext(db, { nodeOutputs: { orch: { structuredResult: { diagnosis: { cause: "Não seguiu o script." } } } } }),
    )
    const description = (dispatchAlert.mock.calls[0]![1] as { description: string }).description
    expect(description).toContain("Valide se a conduta foi realmente inadequada.")
    expect(description).toContain("Não seguiu o script.")
  })
})
