import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { currentRequestId } from "../application/observability/request-context.js"
import { REQUEST_ID_HEADER, requestIdMiddleware } from "./request-id.js"

function appEchoingRequestId() {
  const app = express()
  app.use(requestIdMiddleware())
  app.get("/eco", async (_request, response) => {
    // Depois de um `await` o contexto continua o da requisição.
    await new Promise((resolve) => setTimeout(resolve, 5))
    response.json({ requestId: currentRequestId() })
  })
  return app
}

describe("id da requisição", () => {
  it("sem cabeçalho: gera um UUID, devolve no cabeçalho e o mesmo valor chega a quem estiver na cadeia (inclusive depois de await)", async () => {
    const response = await request(appEchoingRequestId()).get("/eco")
    expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.body.requestId).toBe(response.headers[REQUEST_ID_HEADER])
  })

  it("aceita o id que vem do proxy/cliente quando é um identificador simples", async () => {
    const response = await request(appEchoingRequestId()).get("/eco").set(REQUEST_ID_HEADER, "iis-req-0001.ab:cd")
    expect(response.headers[REQUEST_ID_HEADER]).toBe("iis-req-0001.ab:cd")
    expect(response.body.requestId).toBe("iis-req-0001.ab:cd")
  })

  it("texto livre, curto ou longo demais nunca vai para o log: troca por um id novo", async () => {
    for (const unsafe of ["curto", "a".repeat(65), "id com espaço e {json}", "../../etc/passwd"]) {
      const response = await request(appEchoingRequestId()).get("/eco").set(REQUEST_ID_HEADER, unsafe)
      expect(response.headers[REQUEST_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/)
    }
  })

  it("requisições simultâneas não misturam os ids", async () => {
    const app = appEchoingRequestId()
    const responses = await Promise.all(Array.from({ length: 10 }, (_, index) => request(app).get("/eco").set(REQUEST_ID_HEADER, `simultanea-${index}-xyz`)))
    responses.forEach((response, index) => expect(response.body.requestId).toBe(`simultanea-${index}-xyz`))
  })

  it("fora de uma requisição não há id", () => {
    expect(currentRequestId()).toBeNull()
  })
})
