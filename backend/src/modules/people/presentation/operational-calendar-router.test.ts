import express, { type NextFunction, type Request, type Response } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createOperationalCalendarRouter } from "./operational-calendar-router.js"

/**
 * PATCH parcial de feriado da organização: o que não veio no corpo fica como está. O Zod 4 aplica `.default` mesmo dentro de
 * `.partial()`, então um esquema com padrões usado no PATCH devolvia `scope = "ORGANIZATION"` e `active = true` como se tivessem
 * sido enviados, e o `coalesce` do SQL gravava esses valores: o interruptor da tela (que envia só `active`) trocava a abrangência.
 *
 * Zero banco: o dublê guarda uma linha e aplica `valor enviado ?? valor atual`, o mesmo efeito do `coalesce` da rota.
 */
const ORGANIZATION_ID = "org-1"
const HOLIDAY_ID = "holiday-1"

type HolidayRow = { id: string; date: string; name: string; scope: string; active: boolean }

function app(initial: Partial<HolidayRow> = {}) {
  const row: HolidayRow = { id: HOLIDAY_ID, date: "2026-12-24", name: "Recesso da operação", scope: "STATE", active: false, ...initial }
  const writes: string[] = []
  const db = {
    query: async (sql: string, params: unknown[]) => {
      writes.push(sql)
      if (sql.startsWith("update organization_holidays")) {
        const [organizationId, id, date, name, scope, active] = params as [string, string, string | null, string | null, string | null, boolean | null]
        if (organizationId !== ORGANIZATION_ID || id !== row.id) return { rows: [] }
        Object.assign(row, { date: date ?? row.date, name: name ?? row.name, scope: scope ?? row.scope, active: active ?? row.active })
        return { rows: [row] }
      }
      if (sql.startsWith("insert into organization_holidays")) {
        const [, date, name, scope, active] = params as [string, string, string, string, boolean]
        return { rows: [{ id: "holiday-new", date, name, scope, active }] }
      }
      throw new Error(`Consulta inesperada no teste: ${sql}`)
    },
  } as unknown as Database
  const server = express()
  server.use(express.json())
  server.use((req, _res, next) => { req.user = { sub: "account-1", personId: "admin-1", organizationId: ORGANIZATION_ID, role: "ADMIN", name: "Admin", email: "admin@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
  server.use("/calendar", createOperationalCalendarRouter(db))
  // Em produção quem traduz o ZodError é o tratador de erros de main/app.ts.
  server.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ZodError)) return next(error)
    res.status(400).end()
  })
  return { server, row, writes }
}

const patch = (server: express.Express, body: object, id = HOLIDAY_ID) => request(server).patch(`/calendar/holidays/${id}`).send(body)

describe("PATCH /holidays/:id — o que não foi enviado fica como está", () => {
  it("só `name`: feriado desativado continua desativado e a abrangência não muda", async () => {
    const { server } = app({ scope: "CITY", active: false })
    const response = await patch(server, { name: "Recesso de fim de ano" })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ name: "Recesso de fim de ano", scope: "CITY", active: false, date: "2026-12-24" })
  })

  it("só `date`: mantém abrangência e situação", async () => {
    const { server } = app({ scope: "NATIONAL", active: false })
    const response = await patch(server, { date: "2026-12-26" })
    expect(response.body.data).toMatchObject({ date: "2026-12-26", scope: "NATIONAL", active: false })
  })

  it("só `active` (o que o interruptor da tela envia): desligar e religar não troca a abrangência", async () => {
    const { server } = app({ scope: "STATE", active: true })
    const off = await patch(server, { active: false })
    expect(off.body.data).toMatchObject({ scope: "STATE", active: false, name: "Recesso da operação" })
    const on = await patch(server, { active: true })
    expect(on.body.data).toMatchObject({ scope: "STATE", active: true, name: "Recesso da operação" })
  })

  it("só `scope`: troca a abrangência e mantém o feriado desativado", async () => {
    const { server } = app({ scope: "STATE", active: false })
    const response = await patch(server, { scope: "ORGANIZATION" })
    expect(response.body.data).toMatchObject({ scope: "ORGANIZATION", active: false })
  })

  it("corpo vazio: nada muda", async () => {
    const { server } = app({ scope: "CITY", active: false })
    const response = await patch(server, {})
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ date: "2026-12-24", name: "Recesso da operação", scope: "CITY", active: false })
  })
})

describe("PATCH /holidays/:id — o que foi enviado continua valendo", () => {
  it("todos os campos enviados são gravados", async () => {
    const { server } = app({ scope: "STATE", active: false })
    const response = await patch(server, { date: "2027-01-02", name: "Recesso de ano novo", scope: "NATIONAL", active: true })
    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({ date: "2027-01-02", name: "Recesso de ano novo", scope: "NATIONAL", active: true })
  })

  it("valores inválidos continuam recusados, sem gravar nada", async () => {
    for (const body of [{ scope: "PLANETARY" }, { active: "sim" }, { date: "24/12/2026" }, { name: "x" }, { scope: null }, { active: null }]) {
      const { server, row, writes } = app({ scope: "STATE", active: false })
      const response = await patch(server, body)
      expect(response.status, JSON.stringify(body)).toBe(400)
      expect(writes).toEqual([])
      expect(row).toMatchObject({ scope: "STATE", active: false })
    }
  })

  it("feriado de outra organização ou inexistente: 404", async () => {
    const { server } = app()
    const response = await patch(server, { name: "Recesso de fim de ano" }, "outro-feriado")
    expect(response.status).toBe(404)
    expect(response.body.error.code).toBe("HOLIDAY_NOT_FOUND")
  })
})

describe("POST /holidays — os padrões continuam valendo no cadastro", () => {
  it("sem `scope` e `active`: nasce ativo e da organização", async () => {
    const { server } = app()
    const response = await request(server).post("/calendar/holidays").send({ date: "2026-12-31", name: "Véspera de ano novo" })
    expect(response.status).toBe(201)
    expect(response.body.data).toMatchObject({ scope: "ORGANIZATION", active: true })
  })

  it("`scope` e `active` enviados valem", async () => {
    const { server } = app()
    const response = await request(server).post("/calendar/holidays").send({ date: "2026-12-31", name: "Véspera de ano novo", scope: "CITY", active: false })
    expect(response.body.data).toMatchObject({ scope: "CITY", active: false })
  })
})
