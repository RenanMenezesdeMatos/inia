import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { legacyAccessRows } from "../../access/testing/legacy-admin-fixture.js"
import { createUserAccountRouter } from "./user-account-router.js"

/**
 * Campo da pessoa que vem da base do cliente (feed da Central de Dados que mapeia o campo e já aplicou a pessoa) é só
 * leitura na INIA: o PATCH recusa com 422 PERSON_FIELD_MANAGED_BY_SOURCE e não grava nada. Campo que a base não manda e
 * pessoa sem feed continuam editáveis. A lista e o detalhe dizem, por campo, quem manda nele.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const TEAM_A = "a0000000-0000-4000-8000-00000000000a"
const TEAM_B = "b0000000-0000-4000-8000-00000000000b"
const ACTOR = { person: "10000000-0000-4000-8000-000000000001", account: "20000000-0000-4000-8000-000000000001" }
const FROM_SOURCE = { person: "10000000-0000-4000-8000-000000000002", account: "20000000-0000-4000-8000-000000000002" }
const MANUAL = { person: "10000000-0000-4000-8000-000000000003", account: null }
const MANAGER = "10000000-0000-4000-8000-000000000009"

type PersonRow = { name: string; role: string; team_id: string | null; active: boolean; operational_capital_code: string | null; email: string | null; account: string | null }
const feedMapping = { fields: ["externalEmployeeId", "name", "role", "groupExternalCode", "reportsToExternalId", "active"].map((target) => ({ target, source: target, transforms: [] })) }

function fakeDatabase() {
  const people: Record<string, PersonRow> = {
    [ACTOR.person]: { name: "Admin Geral", role: "MANAGER", team_id: TEAM_A, active: true, operational_capital_code: null, email: "admin@inia.local", account: ACTOR.account },
    [FROM_SOURCE.person]: { name: "Mariana Alves", role: "OPERATOR", team_id: TEAM_A, active: true, operational_capital_code: null, email: "mariana@inia.local", account: FROM_SOURCE.account },
    [MANUAL.person]: { name: "Pessoa Manual", role: "OPERATOR", team_id: TEAM_A, active: true, operational_capital_code: null, email: null, account: null },
  }
  // Só a Mariana foi aplicada por um feed ativo de Colaboradores (linhagem `people`).
  const lineage: Record<string, unknown[]> = {
    [FROM_SOURCE.person]: [{ feed_id: "feed-1", feed_name: "Colaboradores", source_name: "RH Corporativo", contract_key: "EMPLOYEES", authoritative: true, mapping: feedMapping, last_applied_at: new Date("2026-10-14T09:00:00Z") }],
  }
  const updates: unknown[][] = []
  const listRow = (id: string) => ({ id, name: people[id]!.name, role: people[id]!.role, jobTitle: null, active: people[id]!.active, teamId: people[id]!.team_id, teamName: "Atendimento", subteamId: null, employmentStatus: "EM_PRODUCAO", operationalCapitalCode: null, accountId: people[id]!.account, email: people[id]!.email, lastLoginAt: null })
  const query = async (sql: string, params: unknown[] = []) => {
    const rows = (list: unknown[]) => ({ rows: list, rowCount: list.length })
    if (sql.includes("from access_role_assignments")) return rows(String(params[1]) === ACTOR.account ? legacyAccessRows("ADMIN", [], ACTOR.account) : [])
    if (sql.includes("select ua.id, ua.person_id from user_accounts ua")) return rows([{ id: params[1], person_id: ACTOR.person }])
    if (sql.includes("from people p left join user_accounts ua")) {
      const id = String(params[1])
      const entry = people[id]
      return rows(entry ? [{ person_id: id, name: entry.name, person_active: entry.active, team_id: entry.team_id, subteam_id: null, account_id: entry.account, email: entry.email, active: true, session_version: 0, password_change_required: false, led_placements: [] }] : [])
    }
    if (sql.includes("from data_lineage")) return rows((params[1] as string[]).flatMap((id) => (lineage[id] ?? []).map((row) => ({ person_id: id, ...(row as object) }))))
    if (sql.includes("from people person left join user_accounts account")) {
      const entry = people[String(params[0])]
      return rows(entry ? [entry] : [])
    }
    if (sql.includes("left join people m on m.id = p.reports_to_id")) {
      const id = String(params[0])
      const entry = people[id]
      return rows(entry ? [{ id, name: entry.name, role: entry.role, jobTitle: "Analista", matricula: "OP-1", hiredAt: "2024-03-11", active: entry.active, employmentStatus: "EM_PRODUCAO", operationalCapitalCode: null, team_id: TEAM_A, team_name: "Atendimento", subteam_id: null, subteam_name: null, manager_id: MANAGER, manager_name: "Carlos Menezes", accountId: entry.account, email: entry.email, lastLoginAt: null }] : [])
    }
    if (sql.includes("ua.last_login_at \"lastLoginAt\"")) return rows([FROM_SOURCE.person, MANUAL.person].map(listRow))
    if (sql.includes("select role from people")) return rows([{ role: people[String(params[0])]?.role }])
    if (sql.trim().startsWith("update people")) {
      updates.push(params)
      return rows([{ id: params[5], name: params[0] ?? people[String(params[5])]?.name, role: params[1] ?? "OPERATOR", active: true }])
    }
    return rows([])
  }
  return { database: { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Database, updates }
}

function app() {
  const { database, updates } = fakeDatabase()
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { sub: ACTOR.account, personId: ACTOR.person, organizationId: ORG, role: "MANAGER", email: "admin@inia.local" }
    next()
  })
  server.use(createUserAccountRouter(database))
  server.use(((error, _req, res, next) => {
    void next
    res.status(error instanceof DomainError ? error.statusCode : error?.name === "ZodError" ? 400 : 500).json({ error: { code: error instanceof DomainError ? error.code : String(error), message: error?.message, details: error instanceof DomainError ? error.details : undefined } })
  }) as ErrorRequestHandler)
  return { server, updates }
}

describe("campos de colaborador controlados pela base do cliente", () => {
  it("campo controlado é recusado com 422, a lista de campos e de fontes — e nada é gravado", async () => {
    const { server, updates } = app()
    const response = await request(server).patch(`/${FROM_SOURCE.person}`).send({ name: "Outro Nome", teamId: TEAM_B })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("PERSON_FIELD_MANAGED_BY_SOURCE")
    expect(response.body.error.message).toBe("Nome e Grupo vêm da base RH Corporativo · Colaboradores — altere na origem.")
    expect(response.body.error.details.fields).toEqual([
      { field: "name", label: "Nome", sourceName: "RH Corporativo", feedName: "Colaboradores" },
      { field: "teamId", label: "Grupo", sourceName: "RH Corporativo", feedName: "Colaboradores" },
    ])
    expect(response.body.error.details.sources).toEqual([{ sourceName: "RH Corporativo", feedName: "Colaboradores" }])
    expect(updates).toHaveLength(0)
  })

  it("nível hierárquico e situação ativo/inativo da base também são recusados; junto com um campo livre, nada passa", async () => {
    const { server, updates } = app()
    for (const body of [{ role: "SUPERVISOR" }, { active: false }, { name: "Outro Nome", operationalCapitalCode: "FORTALEZA" }]) {
      const response = await request(server).patch(`/${FROM_SOURCE.person}`).send(body)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("PERSON_FIELD_MANAGED_BY_SOURCE")
    }
    expect(updates).toHaveLength(0)
  })

  it("reenviar o mesmo valor de um campo da base não é alteração (formulário que manda tudo de novo passa)", async () => {
    const { server, updates } = app()
    const response = await request(server).patch(`/${FROM_SOURCE.person}`).send({ name: "Mariana Alves", role: "OPERATOR", teamId: TEAM_A, email: "MARIANA@inia.local" })
    expect(response.status).toBe(200)
    expect(updates).toHaveLength(1)
  })

  it("campo que a base não mapeia continua editável: capital operacional e e-mail", async () => {
    const { server, updates } = app()
    expect((await request(server).patch(`/${FROM_SOURCE.person}`).send({ operationalCapitalCode: "FORTALEZA" })).status).toBe(200)
    expect((await request(server).patch(`/${FROM_SOURCE.person}`).send({ email: "mariana.alves@inia.local" })).status).toBe(200)
    expect(updates).toHaveLength(2)
  })

  it("pessoa sem feed (cadastro manual) continua editável em tudo", async () => {
    const { server, updates } = app()
    const response = await request(server).patch(`/${MANUAL.person}`).send({ name: "Nome Corrigido", teamId: TEAM_B, operationalCapitalCode: "RECIFE" })
    expect(response.status).toBe(200)
    expect(updates).toHaveLength(1)
  })

  it("a lista diz, por campo, quem manda nele (null = editável na INIA)", async () => {
    const { server } = app()
    const response = await request(server).get("/")
    expect(response.status).toBe(200)
    const [fromSource, manual] = response.body.data as { id: string; managedBy: Record<string, unknown> }[]
    expect(fromSource!.managedBy).toMatchObject({ name: { sourceName: "RH Corporativo", feedName: "Colaboradores" }, role: { feedName: "Colaboradores" }, teamId: { feedName: "Colaboradores" }, managerId: { feedName: "Colaboradores" }, active: { feedName: "Colaboradores" }, email: null, operationalCapitalCode: null })
    expect(Object.values(manual!.managedBy).every((value) => value === null)).toBe(true)
  })

  it("o detalhe traz a que a pessoa pertence (Grupo, Subgrupo, gestor) e quem controla cada campo", async () => {
    const { server } = app()
    const response = await request(server).get(`/${FROM_SOURCE.person}`)
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ name: "Mariana Alves", team: { id: TEAM_A, name: "Atendimento" }, subteam: null, manager: { id: MANAGER, name: "Carlos Menezes" }, hiredAt: "2024-03-11" })
    expect(response.body.data.managedBy.name).toEqual({ sourceName: "RH Corporativo", feedName: "Colaboradores" })
    expect(response.body.data.managedBy.operationalCapitalCode).toBeNull()
  })
})
