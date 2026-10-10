import request from "supertest"
import { beforeAll, describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../../access/testing/legacy-admin-fixture.js"

const ACCOUNT = {
  id: "11111111-1111-4111-8111-111111111111",
  organization_id: "00000000-0000-4000-8000-000000000001",
  person_id: "00000000-0000-4000-8000-000000000032",
  name: "Carla Nunes",
  role: "ADMIN",
  email: "carla.nunes@inia.com",
}

describe("auth-router", () => {
  let passwordHash: string

  beforeAll(async () => {
    passwordHash = await hashPassword("Inia@123")
  })

  function fakeDatabase(): Database {
    return {
      query: async (sql: string) => {
        const access = legacyAccessQuery(sql, ACCOUNT.role, [])
        if (access) return access
        if (sql.includes("from user_accounts ua")) {
          return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      },
      connect: async () => {
        throw new Error("not needed")
      },
    } as unknown as Database
  }

  it("logs in with valid credentials and sets a session cookie", async () => {
    const response = await request(createApp(fakeDatabase())).post("/api/v1/auth/login").send({
      email: ACCOUNT.email,
      password: "Inia@123",
    })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ email: ACCOUNT.email, role: "ADMIN" })
    expect(response.headers["set-cookie"]?.[0]).toContain("inia_session=")
  })

  it("rejects an invalid password", async () => {
    const response = await request(createApp(fakeDatabase())).post("/api/v1/auth/login").send({
      email: ACCOUNT.email,
      password: "wrong-password",
    })
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe("INVALID_CREDENTIALS")
  })

  it("blocks admin routes without a session", async () => {
    const response = await request(createApp(fakeDatabase())).get("/api/v1/admin/agents")
    expect(response.status).toBe(401)
  })

  it("allows an ADMIN session to reach an admin route", async () => {
    const agent = request.agent(createApp(fakeDatabase()))
    await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })
    const response = await agent.get("/api/v1/admin/agents")
    expect(response.status).toBe(200)
  })
})
