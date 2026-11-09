import express, { Router } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { classifiedRoutes, sealUnclassifiedRoutes } from "./config-access-guard.js"
import { createDataHubRouter } from "./data-hub-router.js"

/**
 * Toda rota da Central é classificada: ou é livre (lista fechada), ou leva a guarda da senha da fonte. Este teste percorre o
 * `router.stack` de verdade: uma rota nova sem classificação faz o teste falhar, e em execução ela responde 403.
 */
const PROTECTED_ROUTES = [
  "GET /sources/:id/database/objects",
  "GET /sources/:id/database/columns",
  "POST /sources/:id/sample",
  "POST /sources/:id/preview",
  "POST /sources/:id/sftp-files",
  "POST /sources/:id/feeds",
  "PATCH /sources/:id",
  "POST /sources/:id/status",
  "PATCH /feeds/:id",
  "POST /feeds/:id/status",
  "POST /feeds/:id/checkpoint/reset",
  "POST /feeds/:id/sample",
  "POST /feeds/:id/preview",
].sort()

const router = createDataHubRouter({ query: async () => ({ rows: [], rowCount: 0 }) } as unknown as Database)

describe("classificação das rotas da Central de Dados", () => {
  const routes = classifiedRoutes(router)

  it("nenhuma rota fica sem classificação nem nas duas listas", () => {
    expect(routes.length).toBeGreaterThan(40)
    expect(routes.filter((route) => route.classification === "UNCLASSIFIED" || route.classification === "BOTH")).toEqual([])
  })

  it("as rotas que usam a senha guardada para configurar são exatamente as protegidas", () => {
    expect(routes.filter((route) => route.classification === "PROTECTED").map((route) => route.key).sort()).toEqual(PROTECTED_ROUTES)
  })

  it("rota sem classificação nasce bloqueada, sem executar o que foi escrito nela", async () => {
    const fresh = Router()
    let ran = false
    fresh.get("/rota-nova", (_request, response) => {
      ran = true
      response.json({ data: "conteúdo" })
    })
    fresh.get("/rota-livre", (_request, response) => {
      response.json({ data: "ok" })
    })
    sealUnclassifiedRoutes(fresh, ["GET /rota-livre"])
    const app = express().use(fresh)
    const blocked = await request(app).get("/rota-nova")
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
    expect(ran).toBe(false)
    expect((await request(app).get("/rota-livre")).status).toBe(200)
    expect(classifiedRoutes(fresh, ["GET /rota-livre"])).toContainEqual({ key: "GET /rota-nova", classification: "UNCLASSIFIED" })
  })
})
