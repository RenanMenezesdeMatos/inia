import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { legacyAccessQuery } from "../testing/legacy-admin-fixture.js"

const ACCOUNT = { id: "acc-1", organization_id: "00000000-0000-4000-8000-000000000001", person_id: "person-1", name: "Admin de Contas", role: "ADMIN", email: "admin@inia.local", avatar_url: null, job_title: null, team_id: null, team_name: null }

describe("Acessos — teto por conta (CFA-06 da run-12)", () => {
  it("prévia e aplicação do CSV e conferir matrícula dividem o teto das ações caras (a 31ª no minuto é 429); o resto da área não conta", async () => {
    const passwordHash = await hashPassword("Inia@123")
    const database = {
      query: async (sql: string) => {
        if (sql.includes("from user_accounts ua")) return { rows: [{ ...ACCOUNT, password_hash: passwordHash, active: true }], rowCount: 1 }
        return legacyAccessQuery(sql, ACCOUNT.role, []) ?? { rows: [], rowCount: 0 }
      },
    } as unknown as Database
    const agent = request.agent(createApp(database))
    expect((await agent.post("/api/v1/auth/login").send({ email: ACCOUNT.email, password: "Inia@123" })).status).toBe(200)
    const base = "/api/v1/admin/access"
    const file = { contentBase64: Buffer.from("matricula\nG0000001\n").toString("base64") }
    const calls = [() => agent.post(`${base}/users/network-enable/preview`).send(file), () => agent.post(`${base}/users/network-enable`).send(file), () => agent.post(`${base}/network-login-check`).send({ matricula: "G0000001" })]
    for (let index = 0; index < 30; index += 1) expect((await calls[index % 3]!()).status).not.toBe(429)
    for (const call of calls) expect((await call()).status).toBe(429)
    expect((await agent.post(`${base}/USERS/network-enable/Preview/`).send(file)).status).toBe(429)
    expect((await agent.get(`${base}/users/network-enable/template`)).status).not.toBe(429)
    expect((await agent.get(`${base}/roles`)).status).not.toBe(429)
  })
})
