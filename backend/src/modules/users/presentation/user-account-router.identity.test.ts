import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { legacyAccessRows } from "../../access/testing/legacy-admin-fixture.js"
import { createUserAccountRouter } from "./user-account-router.js"

/**
 * Pessoa duplicada entre o cadastro manual e a base do cliente:
 *  - com Colaboradores vigente na Central, o "Novo usuário" sem matrícula só aceita "Fora da hierarquia";
 *  - matrícula informada que já existe = 409 com a pessoa (para "Habilitar acesso" dela); nova = a pessoa nasce com ela;
 *  - "Vincular à pessoa da base" move a conta, derruba sessões, inativa a avulsa — só com custódia e nunca a própria conta.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const ACTOR = { person: "10000000-0000-4000-8000-000000000001", account: "20000000-0000-4000-8000-000000000001" }
const MANUAL = { person: "10000000-0000-4000-8000-000000000002", account: "20000000-0000-4000-8000-000000000002" }
const FROM_BASE = { person: "10000000-0000-4000-8000-000000000003", account: null as string | null }
const BASE_WITH_ACCOUNT = { person: "10000000-0000-4000-8000-000000000004", account: "20000000-0000-4000-8000-000000000004" }
const POWERFUL = { person: "10000000-0000-4000-8000-000000000005", account: "20000000-0000-4000-8000-000000000005" }
const LIVE_FEED = { source_name: "RH Corporativo", feed_name: "Colaboradores" }

type Person = { matricula: string | null; active: boolean; account: string | null }
type Options = { feeds?: (typeof LIVE_FEED)[]; actorRoles?: "GENERAL" | "GROUP" }

function fakeDatabase(options: Options = {}) {
  const people: Record<string, Person> = {
    [ACTOR.person]: { matricula: null, active: true, account: ACTOR.account },
    [MANUAL.person]: { matricula: null, active: true, account: MANUAL.account },
    [FROM_BASE.person]: { matricula: "OP-10234", active: true, account: null },
    [BASE_WITH_ACCOUNT.person]: { matricula: "OP-20000", active: true, account: BASE_WITH_ACCOUNT.account },
    [POWERFUL.person]: { matricula: null, active: true, account: POWERFUL.account },
  }
  const statements: { sql: string; params: unknown[] }[] = []
  const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length })
  const query = async (sql: string, params: unknown[] = []) => {
    statements.push({ sql, params })
    if (sql.includes("from access_role_assignments")) {
      const account = String(params[1])
      if (account === ACTOR.account) return rows(options.actorRoles === "GROUP" ? legacyAccessRows("ADMIN", [{ scope_type: "TEAM", team_id: TEAM_A, subteam_id: null }], account) : legacyAccessRows("ADMIN", [], account))
      if (account === POWERFUL.account) return rows(legacyAccessRows("ADMIN", [], account))
      return rows([])
    }
    if (sql.includes("select ua.id, ua.person_id from user_accounts ua")) return rows([{ id: params[1], person_id: ACTOR.person }])
    if (sql.includes("from subteams")) return rows([])
    if (sql.includes("from people p left join user_accounts ua")) {
      const id = String(params[1])
      const entry = people[id]
      return rows(entry ? [{ person_id: id, name: "x", person_active: entry.active, team_id: TEAM_A, subteam_id: null, account_id: entry.account, email: "x@inia.local", active: true, session_version: 0, password_change_required: false, led_placements: [] }] : [])
    }
    if (sql.includes("select team_id, subteam_id from people")) return rows([{ team_id: TEAM_A, subteam_id: null }])
    if (sql.includes("from data_feeds f join data_sources s")) return rows(options.feeds ?? [])
    if (sql.includes("select known.id from people known")) return rows(Object.entries(people).filter(([, entry]) => entry.matricula === params[1]).map(([id]) => ({ id })))
    // Transação do vínculo.
    if (sql.includes("for update")) return rows((params[1] as string[]).filter((id) => people[id]).map((id) => ({ id, matricula: people[id]!.matricula, active: people[id]!.active, account_id: people[id]!.account })))
    if (sql.trim().startsWith("update user_accounts set person_id")) return rows(people[String(params[1])]?.account ? [{ id: people[String(params[1])]!.account }] : [])
    if (sql.includes("insert into people")) return rows([{ id: "new-person" }])
    if (sql.includes("insert into user_accounts")) return rows([{ id: "new-account" }])
    return rows([])
  }
  return { database: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database, statements }
}

function app(options: Options = {}) {
  const { database, statements } = fakeDatabase(options)
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { sub: ACTOR.account, personId: ACTOR.person, organizationId: ORG, role: "ADMIN", email: "admin@inia.local" }
    next()
  })
  server.use(createUserAccountRouter(database))
  server.use(((error, _req, res, next) => {
    void next
    res.status(error instanceof DomainError ? error.statusCode : error?.name === "ZodError" ? 400 : 500).json({ error: { code: error instanceof DomainError ? error.code : String(error), message: error?.message, details: error instanceof DomainError ? error.details : undefined } })
  }) as ErrorRequestHandler)
  return { server, statements }
}

const newUser = (patch: Record<string, unknown> = {}) => ({ name: "Pessoa Nova", role: "OPERATOR", teamId: TEAM_A, email: "pessoa.nova@inia.local", ...patch })
const inserted = (statements: { sql: string; params: unknown[] }[]) => statements.find((entry) => entry.sql.includes("insert into people"))

describe("Novo usuário — uma porta só para a hierarquia", () => {
  it("com Colaboradores vigente, nível da hierarquia sem matrícula é recusado (422) e nada é criado", async () => {
    const { server, statements } = app({ feeds: [LIVE_FEED] })
    const response = await request(server).post("/").send(newUser())
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("PERSON_HIERARCHY_REQUIRES_SOURCE")
    expect(response.body.error.message).toContain("Habilitar acesso")
    expect(response.body.error.details.sources).toEqual([{ sourceName: "RH Corporativo", feedName: "Colaboradores" }])
    expect(inserted(statements)).toBeUndefined()
  })

  it("a senha provisória é gerada pelo servidor e mostrada uma vez; a escolhida por quem cadastra é ignorada (auditoria 17/10/2026, AUTH-6)", async () => {
    const { server, statements } = app()
    const response = await request(server).post("/").send(newUser({ password: "123456" }))
    expect(response.status).toBe(201)
    const issued = response.body.data.issued
    expect(issued).toMatchObject({ personId: "new-person", accountId: "new-account", email: "pessoa.nova@inia.local" })
    expect(issued.temporaryPassword).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/)
    expect(issued.temporaryPassword).not.toBe("123456")
    const account = statements.find((entry) => entry.sql.includes("insert into user_accounts"))!
    expect(JSON.stringify(account.params)).not.toContain("123456")
    expect(JSON.stringify(account.params)).not.toContain(issued.temporaryPassword)
    const another = await request(app().server).post("/").send(newUser())
    expect(another.body.data.issued.temporaryPassword).not.toBe(issued.temporaryPassword)
  })

  it("com Colaboradores vigente, \"Fora da hierarquia\" sem matrícula continua (TI, consultoria, QA)", async () => {
    const { server, statements } = app({ feeds: [LIVE_FEED] })
    expect((await request(server).post("/").send(newUser({ role: "ADMIN" }))).status).toBe(201)
    expect(inserted(statements)!.params[4]).toBeNull()
  })

  it("sem Colaboradores vigente (cliente sem Central), nada muda", async () => {
    const { server } = app()
    expect((await request(server).post("/").send(newUser())).status).toBe(201)
  })

  it("matrícula nova: a pessoa nasce com ela — e o nível da hierarquia é aceito porque a base vai assumir", async () => {
    const { server, statements } = app({ feeds: [LIVE_FEED] })
    expect((await request(server).post("/").send(newUser({ matricula: "  OP-99999 " }))).status).toBe(201)
    expect(inserted(statements)!.params).toEqual([ORG, TEAM_A, "Pessoa Nova", "OPERATOR", "OP-99999"])
  })

  it("matrícula que já existe: 409 com a pessoa, para a tela levar a \"Habilitar acesso\" dela", async () => {
    const { server, statements } = app({ feeds: [LIVE_FEED] })
    const response = await request(server).post("/").send(newUser({ matricula: "OP-10234" }))
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe("PERSON_MATRICULA_IN_USE")
    expect(response.body.error.details).toEqual({ personId: FROM_BASE.person })
    expect(inserted(statements)).toBeUndefined()
  })

  it("a política de cadastro diz se a hierarquia exige matrícula e de qual base ela vem", async () => {
    const live = await request(app({ feeds: [LIVE_FEED] }).server).get("/creation-policy")
    expect(live.body.data).toEqual({ hierarchyRequiresMatricula: true, sources: [{ sourceName: "RH Corporativo", feedName: "Colaboradores" }] })
    expect((await request(app().server).get("/creation-policy")).body.data).toEqual({ hierarchyRequiresMatricula: false, sources: [] })
  })
})

describe("Vincular à pessoa da base", () => {
  it("move a conta para a pessoa da base, sobe a versão de sessão, inativa a avulsa e audita", async () => {
    const { server, statements } = app()
    const response = await request(server).post(`/${MANUAL.person}/link`).send({ targetPersonId: FROM_BASE.person })
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({ fromPersonId: MANUAL.person, toPersonId: FROM_BASE.person, matricula: "OP-10234", accountId: MANUAL.account, sessionsRevoked: true })
    const move = statements.find((entry) => entry.sql.trim().startsWith("update user_accounts set person_id"))!
    expect(move.sql).toContain("session_version = session_version + 1")
    expect(move.params).toEqual([ORG, MANUAL.person, FROM_BASE.person])
    expect(statements.find((entry) => entry.sql.includes("update people set active = false"))!.params).toEqual([MANUAL.person, ORG])
    const audit = statements.find((entry) => entry.sql.includes("insert into audit_logs"))!
    expect(JSON.parse(String(audit.params[4]))).toMatchObject({ mode: "MANUAL", fromPersonId: MANUAL.person, toPersonId: FROM_BASE.person, accountId: MANUAL.account })
    expect(statements.some((entry) => entry.sql.trim() === "commit")).toBe(true)
  })

  it("destino que já tem conta: 409 — o admin decide qual conta fica", async () => {
    const { server, statements } = app()
    const response = await request(server).post(`/${MANUAL.person}/link`).send({ targetPersonId: BASE_WITH_ACCOUNT.person })
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe("PERSON_LINK_TARGET_HAS_ACCOUNT")
    expect(statements.some((entry) => entry.sql.trim().startsWith("update user_accounts set person_id"))).toBe(false)
    expect(statements.some((entry) => entry.sql.trim() === "rollback")).toBe(true)
  })

  it("sem custódia da credencial (conta com papel que o ator não concede): 403 e nada muda", async () => {
    const { server, statements } = app({ actorRoles: "GROUP" })
    const response = await request(server).post(`/${POWERFUL.person}/link`).send({ targetPersonId: FROM_BASE.person })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("ACCESS_TARGET_MORE_PRIVILEGED")
    expect(statements.some((entry) => entry.sql.includes("for update"))).toBe(false)
  })

  it("nunca a própria conta", async () => {
    const { server, statements } = app()
    const response = await request(server).post(`/${ACTOR.person}/link`).send({ targetPersonId: FROM_BASE.person })
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe("PEOPLE_SELF_CHANGE_FORBIDDEN")
    expect(statements.some((entry) => entry.sql.includes("for update"))).toBe(false)
  })
})
