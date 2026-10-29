import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { submitHumanReviewDecision } from "./submit-human-review-decision.js"

/**
 * Único ponto que grava a decisão de uma Revisão humana (rotas de Pendências e de administração): ninguém decide a revisão do
 * resultado sobre si mesmo (achado C16 da 4ª auditoria).
 */
function fakeDb(enrollment: Record<string, unknown>) {
  const writes: string[] = []
  const db = {
    query: async (sql: string) => {
      if (sql.includes("from workflow_enrollments")) return { rows: [enrollment], rowCount: 1 }
      if (sql.includes("from interactions")) return { rows: [{ operator_id: "operador-da-chamada" }], rowCount: 1 }
      writes.push(sql.trim().split(/\s+/).slice(0, 2).join(" "))
      return { rows: [], rowCount: 1 }
    },
  } as unknown as Database
  return { db, writes }
}

const waiting = { id: "enr-1", status: "waiting", current_node_id: "review", revision: 3, interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: "bruno" }

describe("submitHumanReviewDecision", () => {
  it("o próprio colaborador da execução não decide a revisão — 403 e nada gravado", async () => {
    const { db, writes } = fakeDb(waiting)
    await expect(submitHumanReviewDecision(db, { enrollmentId: "enr-1", nodeId: "review", decision: "rejected", reviewerId: "bruno" })).rejects.toMatchObject({ code: "HUMAN_REVIEW_SELF_DECISION", statusCode: 403 })
    expect(writes).toEqual([])
  })

  it("execução de uma chamada: o operador da chamada também não decide", async () => {
    const { db } = fakeDb({ ...waiting, interaction_id: "int-1", scheduled_subject_id: null })
    await expect(submitHumanReviewDecision(db, { enrollmentId: "enr-1", nodeId: "review", decision: "approved", reviewerId: "operador-da-chamada" })).rejects.toMatchObject({ code: "HUMAN_REVIEW_SELF_DECISION" })
  })

  it("outra pessoa decide normalmente", async () => {
    const { db, writes } = fakeDb(waiting)
    const result = await submitHumanReviewDecision(db, { enrollmentId: "enr-1", nodeId: "review", decision: "approved", reviewerId: "sara" })
    expect(result).toMatchObject({ enrollmentId: "enr-1", nodeId: "review", decision: "approved" })
    expect(writes).toEqual(["update workflow_enrollments", "insert into"])
  })
})
