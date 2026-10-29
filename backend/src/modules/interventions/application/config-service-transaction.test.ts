import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { setCompetencyActive } from "./config-service.js"

const COMPETENCY_ID = "4f1c2a8e-9b3d-4c5e-8f7a-1b2c3d4e5f60"

/** A conexão cai depois do erro de negócio: o `rollback` também falha. */
function databaseWhoseRollbackFails() {
  const release = vi.fn()
  const client = {
    query: vi.fn(async (sql: string) => {
      if (sql === "rollback") throw new Error("Connection terminated unexpectedly")
      return { rows: [], rowCount: 0 }
    }),
    release,
  }
  return { db: { connect: async () => client, query: vi.fn() } as unknown as Database, release }
}

describe("transação das intervenções", () => {
  it("o erro de negócio chega a quem chamou mesmo quando o rollback falha (antes virava o erro da conexão, 500)", async () => {
    const { db, release } = databaseWhoseRollbackFails()

    const outcome = setCompetencyActive(db, "org-1", { userAccountId: "u1", personId: "p1" }, COMPETENCY_ID, false)

    await expect(outcome).rejects.toBeInstanceOf(DomainError)
    await expect(outcome).rejects.toMatchObject({ code: "COMPETENCY_NOT_FOUND", statusCode: 404 })
    expect(release).toHaveBeenCalledTimes(1)
  })
})
