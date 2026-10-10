import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { legacyAccessRows } from "../../access/testing/legacy-admin-fixture.js"
import { createUserAccountRouter } from "./user-account-router.js"

/**
 * Achados U-F2, U-F3 e U-F4 da auditoria de segurança — cadastro de pessoas (`/admin/users`) por um ADMINISTRADOR de Grupo:
 * não promove ninguém (nem a si) a nível de liderança, não mexe na própria conta, não troca e-mail/inativa quem tem mais
 * privilégio (custódia) nem quem lidera gente fora do escopo dele, não move pessoas para fora do escopo.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const TEAM_B = "b0000000-0000-4000-8000-00000000000b"
const ACTOR = { person: "10000000-0000-4000-8000-000000000001", account: "20000000-0000-4000-8000-000000000001" }
const OPERATOR = { person: "10000000-0000-4000-8000-000000000002", account: "20000000-0000-4000-8000-000000000002" }
const GENERAL_ADMIN = { person: "10000000-0000-4000-8000-000000000003", account: "20000000-0000-4000-8000-000000000003" }
const CROSS_LEADER = { person: "10000000-0000-4000-8000-000000000004", account: "20000000-0000-4000-8000-000000000004" }

const people: Record<string, { team: string; role: string; account: string | null; led: { teamId: string; subteamId: null }[] }> = {
  [ACTOR.person]: { team: TEAM_A, role: "SUPERVISOR", account: ACTOR.account, led: [] },
  [OPERATOR.person]: { team: TEAM_A, role: "OPERATOR", account: OPERATOR.account, led: [] },
  [GENERAL_ADMIN.person]: { team: TEAM_A, role: "MANAGER", account: GENERAL_ADMIN.account, led: [] },
  // Supervisor do Grupo A cuja equipe tem gente no Grupo B: assumir a conta dele abriria a estrutura no Grupo B.
  [CROSS_LEADER.person]: { team: TEAM_A, role: "SUPERVISOR", account: CROSS_LEADER.account, led: [{ teamId: TEAM_A, subteamId: null }, { teamId: TEAM_B, subteamId: null }] },
}
const personOfAccount = (account: string) => Object.entries(people).find(([, entry]) => entry.account === account)?.[0]

function fakeDatabase(): Database {
  const query = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from access_role_assignments")) {
      const account = String(params[1])
      const rows = account === ACTOR.account ? legacyAccessRows("ADMIN", [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], account) : account === GENERAL_ADMIN.account ? legacyAccessRows("ADMIN", [], account) : []
      return { rows, rowCount: rows.length }
    }
    if (sql.includes("select ua.id, ua.person_id from user_accounts ua")) return { rows: [{ id: params[1], person_id: personOfAccount(String(params[1])) }], rowCount: 1 }
    if (sql.includes("from subteams")) return { rows: [], rowCount: 0 }
    if (sql.includes("from people p left join user_accounts ua")) {
      const id = String(params[1])
      const entry = people[id]
      return { rows: entry ? [{ person_id: id, name: "x", person_active: true, team_id: entry.team, subteam_id: null, account_id: entry.account, email: "x@inia.local", active: true, session_version: 0, password_change_required: false, led_placements: entry.led }] : [], rowCount: entry ? 1 : 0 }
    }
    if (sql.includes("select team_id, subteam_id from people")) {
      const entry = people[String(params[0])]
      return { rows: entry ? [{ team_id: entry.team, subteam_id: null }] : [], rowCount: entry ? 1 : 0 }
    }
    if (sql.includes("select role from people")) return { rows: [{ role: people[String(params[0])]?.role }], rowCount: 1 }
    if (sql.trim().startsWith("update people")) return { rows: [{ id: params[5], name: params[0] ?? "x", role: "OPERATOR", active: true }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }
  return { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database
}

function app() {
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { sub: ACTOR.account, personId: ACTOR.person, organizationId: ORG, role: "SUPERVISOR", email: "admin.grupo@inia.local" }
    next()
  })
  server.use(createUserAccountRouter(fakeDatabase()))
  server.use(((error, _req, res, next) => {
    void next
    res.status(error instanceof DomainError ? error.statusCode : error?.name === "ZodError" ? 400 : 500).json({ error: { code: error instanceof DomainError ? error.code : String(error) } })
  }) as ErrorRequestHandler)
  return server
}

describe("cadastro de pessoas — administrador de Grupo", () => {
  it("não promove ninguém a nível de liderança (escalada vertical pelo nível hierárquico)", async () => {
    const promote = await request(app()).patch(`/${OPERATOR.person}`).send({ role: "DIRECTOR" })
    expect(promote.status).toBe(403)
    expect(promote.body.error.code).toBe("PEOPLE_ROLE_REQUIRES_ORGANIZATION_SCOPE")
    const create = await request(app()).post("/").send({ name: "Fantoche", role: "SUPERVISOR", teamId: TEAM_A, email: "fantoche@inia.local", password: "Provisoria-2026" })
    expect(create.status).toBe(403)
  })

  it("não altera o próprio nível, Grupo, e-mail ou situação", async () => {
    for (const body of [{ role: "OPERATOR" }, { email: "outro@inia.local" }, { active: false }, { teamId: TEAM_A }]) {
      const response = await request(app()).patch(`/${ACTOR.person}`).send(body)
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe("PEOPLE_SELF_CHANGE_FORBIDDEN")
    }
  })

  it("custódia: não troca e-mail nem inativa quem tem papel que ele não concede (ex.: Administrador geral do Grupo dele)", async () => {
    for (const body of [{ email: "atacante@inia.local" }, { active: false }]) {
      const response = await request(app()).patch(`/${GENERAL_ADMIN.person}`).send(body)
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe("ACCESS_TARGET_MORE_PRIVILEGED")
    }
  })

  it("custódia: não troca o e-mail de quem lidera colaboradores fora do escopo dele", async () => {
    const response = await request(app()).patch(`/${CROSS_LEADER.person}`).send({ email: "atacante@inia.local" })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("ACCESS_TARGET_LEADS_OUTSIDE_SCOPE")
  })

  it("não move pessoas para Grupo fora do escopo; senha provisória fraca é recusada", async () => {
    expect((await request(app()).patch(`/${OPERATOR.person}`).send({ teamId: TEAM_B })).status).toBe(403)
    const weak = await request(app()).post("/").send({ name: "Pessoa", role: "OPERATOR", teamId: TEAM_A, email: "pessoa@inia.local", password: "123456" })
    expect(weak.status).toBe(422)
    expect(weak.body.error.code).toBe("PASSWORD_POLICY_VIOLATION")
  })

  it("uso legítimo continua: editar nome e e-mail de um operador do próprio Grupo", async () => {
    expect((await request(app()).patch(`/${OPERATOR.person}`).send({ name: "Nome Corrigido" })).status).toBe(200)
    expect((await request(app()).patch(`/${OPERATOR.person}`).send({ email: "operador.novo@inia.local" })).status).toBe(200)
  })
})
