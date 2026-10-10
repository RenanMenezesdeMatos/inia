import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { acknowledgeFeedback } from "./acknowledge-feedback.js"

type Row = { id: string; operator_id: string; status: string; acknowledged_at: string | null }

function fakeDb(row: Row | null) {
  const updates: unknown[][] = []
  const db = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("select id, operator_id, status, acknowledged_at")) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
      if (sql.trim().startsWith("update feedbacks set acknowledged_at")) {
        updates.push(params ?? [])
        if (row && !row.acknowledged_at) {
          row.acknowledged_at = "2026-09-15T12:00:00.000Z"
          return { rows: [{ acknowledged_at: row.acknowledged_at }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }
      throw new Error(`SQL inesperado: ${sql}`)
    },
  } as unknown as Database
  return { db, updates }
}

describe("acknowledgeFeedback — ciência do colaborador", () => {
  it("o próprio colaborador dá ciência num feedback publicado (grava acknowledged_at, status intacto)", async () => {
    const { db, updates } = fakeDb({ id: "f1", operator_id: "op1", status: "PUBLISHED", acknowledged_at: null })
    const result = await acknowledgeFeedback(db, { feedbackId: "f1", personId: "op1" })
    expect(result).toEqual({ id: "f1", acknowledgedAt: "2026-09-15T12:00:00.000Z", alreadyAcknowledged: false })
    expect(updates).toHaveLength(1)
  })

  it("repetir a ciência é idempotente (mesma data, nenhum update)", async () => {
    const { db, updates } = fakeDb({ id: "f1", operator_id: "op1", status: "PUBLISHED", acknowledged_at: "2026-09-10T10:00:00.000Z" })
    const result = await acknowledgeFeedback(db, { feedbackId: "f1", personId: "op1" })
    expect(result.alreadyAcknowledged).toBe(true)
    expect(result.acknowledgedAt).toBe("2026-09-10T10:00:00.000Z")
    expect(updates).toHaveLength(0)
  })

  it("outra pessoa (inclusive o supervisor) não dá ciência pelo colaborador → 403", async () => {
    const { db } = fakeDb({ id: "f1", operator_id: "op1", status: "PUBLISHED", acknowledged_at: null })
    await expect(acknowledgeFeedback(db, { feedbackId: "f1", personId: "sup1" })).rejects.toMatchObject({ code: "FEEDBACK_ACK_FORBIDDEN", statusCode: 403 })
  })

  it("feedback não publicado não recebe ciência → 409; inexistente → 404", async () => {
    const draft = fakeDb({ id: "f1", operator_id: "op1", status: "DRAFT", acknowledged_at: null })
    await expect(acknowledgeFeedback(draft.db, { feedbackId: "f1", personId: "op1" })).rejects.toMatchObject({ code: "FEEDBACK_NOT_PUBLISHED", statusCode: 409 })
    const missing = fakeDb(null)
    await expect(acknowledgeFeedback(missing.db, { feedbackId: "x", personId: "op1" })).rejects.toBeInstanceOf(DomainError)
  })
})
