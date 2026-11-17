import express, { type NextFunction, type Request, type Response } from "express"
import request from "supertest"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"

const buildMyJourney = vi.fn()
vi.mock("../application/my-journey.js", () => ({ buildMyJourney: (...args: unknown[]) => buildMyJourney(...args) }))

const { createMyJourneyRouter } = await import("./my-journey-router.js")

/**
 * "Minha jornada" é da PRÓPRIA pessoa: a rota não aceita identificador de pessoa. Trocar matrícula, id ou parâmetros da rota
 * nunca leva a outro colaborador — a pessoa consultada é sempre a da sessão.
 */
const SELF = { sub: "account-op1", personId: "11111111-1111-4111-8111-111111111111", organizationId: "org-1", role: "OPERATOR" as const, name: "Operador 1", email: "op1@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
const OTHER_PERSON = "22222222-2222-4222-8222-222222222222"

function app() {
  const server = express()
  server.use((req, _res, next) => {
    req.user = SELF
    next()
  })
  server.use("/my-journey", createMyJourneyRouter({} as Database, () => new Date("2026-11-17T12:00:00Z")))
  server.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (!(error instanceof ZodError)) return next(error)
    res.status(400).end()
  })
  return server
}

beforeEach(() => {
  buildMyJourney.mockReset()
  buildMyJourney.mockResolvedValue({ days: [] })
})

describe("GET /my-journey — só a própria jornada", () => {
  it("resolve a pessoa pela sessão e responde sem cache", async () => {
    const response = await request(app()).get("/my-journey")
    expect(response.status).toBe(200)
    expect(response.headers["cache-control"]).toBe("no-store")
    expect(buildMyJourney).toHaveBeenCalledTimes(1)
    expect(buildMyJourney.mock.calls[0]![1]).toMatchObject({ personId: SELF.personId, organizationId: SELF.organizationId })
    expect(buildMyJourney.mock.calls[0]![2]).toMatchObject({ weekOf: undefined })
  })

  it("personId, matrícula, id ou âncora na query são ignorados: continua a pessoa da sessão", async () => {
    const response = await request(app()).get(`/my-journey?personId=${OTHER_PERSON}&externalEmployeeId=OP-999&matricula=OP-999&id=${OTHER_PERSON}&anchorId=${OTHER_PERSON}&week=2026-11-20`)
    expect(response.status).toBe(200)
    const [, user, input] = buildMyJourney.mock.calls[0]!
    expect(user).toMatchObject({ personId: SELF.personId })
    expect(input).toEqual({ weekOf: "2026-11-20", now: new Date("2026-11-17T12:00:00Z") })
    expect(JSON.stringify(buildMyJourney.mock.calls)).not.toContain(OTHER_PERSON)
  })

  it("identificador no caminho não existe como rota (404) e não consulta nada", async () => {
    expect((await request(app()).get(`/my-journey/${OTHER_PERSON}`)).status).toBe(404)
    expect((await request(app()).get(`/my-journey/people/${OTHER_PERSON}`)).status).toBe(404)
    expect(buildMyJourney).not.toHaveBeenCalled()
  })

  it("semana inválida → 400", async () => {
    expect((await request(app()).get("/my-journey?week=2026-02-30")).status).toBe(400)
    expect((await request(app()).get("/my-journey?week=amanha")).status).toBe(400)
    expect((await request(app()).get("/my-journey?week=9999-12-31")).status).toBe(400) // run-6 JA-03: era 500 no SQL
    expect(buildMyJourney).not.toHaveBeenCalled()
  })

  it("só leitura: POST/PUT/DELETE não existem", async () => {
    expect((await request(app()).post("/my-journey").send({ personId: OTHER_PERSON })).status).toBe(404)
    expect((await request(app()).delete("/my-journey")).status).toBe(404)
  })
})
