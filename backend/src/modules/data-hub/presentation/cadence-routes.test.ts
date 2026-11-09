import express from "express"
import request from "supertest"
import { beforeEach, describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import cases from "../testing/cadence-cases.json" with { type: "json" }
import { createDataHubRouter } from "./data-hub-router.js"

const ORG = "00000000-0000-4000-8000-0000000000aa"
const SOURCE_ID = "00000000-0000-4000-8000-0000000000bb"
const FEED_ID = "00000000-0000-4000-8000-0000000000cc"
const FRIDAY_NOON = "2026-11-06T15:00:00.000Z" // sexta, 12:00 em Fortaleza

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
const connectorConfig = { connector: "API_PULL", api: { endpoint: "/colaboradores", extractPath: "data" } }
const feedBody = (cadence: unknown) => ({ feedKey: "colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig, cadence })
const WEEKLY = { kind: "CALENDAR", times: ["18:00", "06:00"], frequency: { type: "WEEKLY", weekdays: ["FRI", "MON", "TUE", "WED", "THU"] } }

type StoredFeed = Record<string, unknown>
let writes: { sql: string; params: unknown[] }[]
let audits: { action: string; payload: Record<string, unknown> | null }[]
let feed: StoredFeed

function storedFeed(cadence: unknown, status = "ACTIVE"): StoredFeed {
  return {
    id: FEED_ID,
    organizationId: ORG,
    sourceId: SOURCE_ID,
    feedKey: "colaboradores",
    name: "Colaboradores",
    contractKey: "EMPLOYEES",
    contractVersion: 1,
    connectorConfig: { connector: "API_PULL", api: { endpoint: "/colaboradores", format: "JSON", method: "GET", queryParams: {}, headers: {}, extractPath: "data", pagination: { kind: "NONE" }, checkpoint: { kind: "NONE" }, maxPages: 500 } },
    mapping: { fields: [] },
    loadMode: "DELTA",
    cadence,
    expectedIntervalMinutes: null,
    status,
    authoritative: false,
    failOnAnyRejection: false,
    sourceNamespace: null,
    availabilityPolicy: null,
  }
}

/** Banco roteirizado: responde as leituras da rota e guarda as escritas, sem PostgreSQL. A transação usa o mesmo roteiro. */
function fakeDb(): Database {
  const db = {
    connect: async () => ({ query: db.query, release: () => undefined }),
    query: async (sql: string, params: unknown[] = []) => {
      if (/select timezone from operations/.test(sql)) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
      if (/from data_sources s/.test(sql)) return { rows: [{ id: SOURCE_ID, organizationId: ORG, kind: "API_PULL", name: "RH", publicId: "rh", status: "ACTIVE", config: { kind: "API_PULL", api: { auth: { kind: "NONE" } } } }], rowCount: 1 }
      if (/from data_feeds f/.test(sql)) return { rows: [feed], rowCount: 1 }
      if (/insert into data_feeds/.test(sql)) {
        writes.push({ sql, params })
        feed = storedFeed(JSON.parse(String(params[9])), "DRAFT")
        return { rows: [{ id: FEED_ID }], rowCount: 1 }
      }
      if (/update data_feeds/.test(sql)) {
        writes.push({ sql, params })
        return { rows: [], rowCount: 1 }
      }
      if (/insert into audit_logs/.test(sql)) {
        audits.push({ action: String(params[2]), payload: params[5] ? (JSON.parse(String(params[5])) as Record<string, unknown>) : null })
        return { rows: [], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    },
  }
  return db as unknown as Database
}

function app() {
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    ;(req as unknown as { user: unknown }).user = { organizationId: ORG, personId: null }
    next()
  })
  instance.use("/data-hub", createDataHubRouter(fakeDb(), { clock: fixedClock(FRIDAY_NOON), logger: silent }))
  instance.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next
    if (error instanceof ZodError) return void res.status(400).json({ error: { code: "VALIDATION_ERROR", details: error.issues } })
    if (error instanceof DomainError) return void res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
  })
  return instance
}

beforeEach(() => {
  writes = []
  audits = []
  feed = storedFeed({ kind: "MANUAL" })
})

describe("POST /cadence/preview", () => {
  it("devolve a frase e as próximas execuções no fuso da operação, pulando o fim de semana", async () => {
    const response = await request(app()).post("/data-hub/cadence/preview").send({ cadence: WEEKLY })
    expect(response.status).toBe(200)
    expect(response.body.data).toEqual({
      label: "Seg a sex às 06:00 e 18:00",
      timeZone: "America/Fortaleza",
      nextRuns: ["2026-11-06T21:00:00.000Z", "2026-11-09T09:00:00.000Z", "2026-11-09T21:00:00.000Z"],
    })
  })

  it("manual não tem próxima execução", async () => {
    const response = await request(app()).post("/data-hub/cadence/preview").send({ cadence: { kind: "MANUAL" } })
    expect(response.body.data).toMatchObject({ label: "Manual", nextRuns: [] })
  })

  it("periodicidade inválida é recusada com o motivo, sem nada gravado", async () => {
    const response = await request(app()).post("/data-hub/cadence/preview").send({ cadence: { kind: "CALENDAR", times: ["06:00", "06:00"], frequency: { type: "DAILY" } } })
    expect(response.status).toBe(400)
    expect(response.body.error.details[0].message).toBe("Há horários repetidos.")
    expect(writes).toEqual([])
  })

  it("não aceita expressão cron nem forma desconhecida", async () => {
    const response = await request(app()).post("/data-hub/cadence/preview").send({ cadence: { kind: "CRON", expression: "0 6 * * 1-5" } })
    expect(response.status).toBe(400)
  })
})

describe("POST /sources/:id/feeds", () => {
  it("cria o feed com a agenda normalizada e sem intervalo fixo", async () => {
    const response = await request(app()).post(`/data-hub/sources/${SOURCE_ID}/feeds`).send(feedBody(WEEKLY))
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    const insert = writes.find((write) => /insert into data_feeds/.test(write.sql))!
    expect(JSON.parse(String(insert.params[9]))).toEqual({ kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } })
    expect(insert.params[10]).toBeNull()
  })

  it("as formas atuais continuam sendo criadas como antes", async () => {
    for (const [cadence, expected] of [
      [{ kind: "MANUAL" }, null],
      [{ kind: "INTERVAL", minutes: 15 }, 15],
      [{ kind: "INTERVAL", minutes: 360 }, 360],
      [{ kind: "DAILY", time: "06:00" }, 1440],
    ] as const) {
      writes = []
      const response = await request(app()).post(`/data-hub/sources/${SOURCE_ID}/feeds`).send(feedBody(cadence))
      expect(response.status, JSON.stringify(response.body)).toBe(201)
      expect(JSON.parse(String(writes[0]!.params[9]))).toEqual(cadence)
      expect(writes[0]!.params[10]).toBe(expected)
    }
  })

  it.each(cases.invalid)("recusa no backend: $message", async ({ cadence, message }) => {
    const response = await request(app()).post(`/data-hub/sources/${SOURCE_ID}/feeds`).send(feedBody(cadence))
    expect(writes).toEqual([])
    if (response.status === 422) {
      expect(response.body.error).toEqual({ code: "DATA_CADENCE_TOO_FREQUENT", message })
    } else {
      expect(response.status).toBe(400)
      expect(response.body.error.details[0].message).toBe(message)
    }
  })
})

describe("PATCH /feeds/:id", () => {
  const patch = (body: object) => request(app()).patch(`/data-hub/feeds/${FEED_ID}`).send(body)
  const update = () => writes.find((write) => /update data_feeds set feed_key/.test(write.sql))!

  it("trocar para a agenda calcula a próxima execução pelo fuso da operação e zera o intervalo fixo", async () => {
    feed = storedFeed({ kind: "DAILY", time: "06:00" })
    const response = await patch({ cadence: WEEKLY })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(JSON.parse(String(update().params[8]))).toEqual({ kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } })
    expect(update().params[9]).toBeNull()
    expect((update().params[13] as Date).toISOString()).toBe("2026-11-06T21:00:00.000Z")
    expect(audits.at(-1)?.payload).toMatchObject({ cadenceChanged: true, cadence: "Seg a sex às 06:00 e 18:00", previousCadence: "Diário às 06:00" })
  })

  it("feed gravado com intervalo abaixo do mínimo salva outras mudanças sem reconfigurar", async () => {
    feed = storedFeed({ kind: "INTERVAL", minutes: 5 })
    expect((await patch({ name: "Colaboradores RH" })).status).toBe(200)
    expect(JSON.parse(String(update().params[8]))).toEqual({ kind: "INTERVAL", minutes: 5 })
    writes = []
    // A tela sempre reenvia a periodicidade: o mesmo valor continua aceito, e a auditoria não acusa mudança.
    expect((await patch({ cadence: { kind: "INTERVAL", minutes: 5 } })).status).toBe(200)
    expect(audits.at(-1)?.payload).toMatchObject({ cadenceChanged: false })
  })

  it("reenviar a mesma agenda não conta como mudança, mesmo com o jsonb devolvendo as chaves em outra ordem", async () => {
    feed = storedFeed({ kind: "CALENDAR", times: ["06:00"], frequency: { days: 3, type: "EVERY_N_DAYS", startDate: "2026-11-02" } })
    expect((await patch({ cadence: { kind: "CALENDAR", times: ["06:00"], frequency: { type: "EVERY_N_DAYS", days: 3, startDate: "2026-11-02" } } })).status).toBe(200)
    expect(audits.at(-1)?.payload).toMatchObject({ cadenceChanged: false })
  })

  it("um valor novo abaixo do mínimo é recusado mesmo em feed antigo", async () => {
    feed = storedFeed({ kind: "INTERVAL", minutes: 5 })
    const response = await patch({ cadence: { kind: "INTERVAL", minutes: 10 } })
    expect(response.status).toBe(422)
    expect(response.body.error.code).toBe("DATA_CADENCE_TOO_FREQUENT")
    expect(writes).toEqual([])
  })

  it("PATCH parcial não apaga o que não foi enviado (o Zod 4 aplica .default dentro de .partial())", async () => {
    feed = { ...storedFeed({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } }), mapping: { fields: [{ target: "name", source: "nome", transforms: [] }] }, loadMode: "SNAPSHOT", authoritative: true, failOnAnyRejection: true, availabilityPolicy: { lagDays: 1, availableByLocalTime: "11:00" } }
    expect((await patch({ name: "Colaboradores RH" })).status).toBe(200)
    const params = update().params
    expect(JSON.parse(String(params[8]))).toEqual({ kind: "CALENDAR", times: ["06:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } })
    expect(JSON.parse(String(params[6]))).toMatchObject({ fields: [{ target: "name", source: "nome" }] })
    expect(params[7]).toBe("SNAPSHOT")
    expect(params[10]).toBe(true)
    expect(params[11]).toBe(true)
    expect(JSON.parse(String(params[15]))).toEqual({ lagDays: 1, availableByLocalTime: "11:00" })
    expect(audits.at(-1)?.payload).toMatchObject({ mappingChanged: false, cadenceChanged: false, availabilityPolicyChanged: false })
  })

  it("DAILY gravado passa por salvar sem mudar de forma", async () => {
    feed = storedFeed({ kind: "DAILY", time: "06:00" })
    expect((await patch({ name: "Colaboradores RH" })).status).toBe(200)
    expect(JSON.parse(String(update().params[8]))).toEqual({ kind: "DAILY", time: "06:00" })
    expect(update().params[9]).toBe(1440)
  })
})
