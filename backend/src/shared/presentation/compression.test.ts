import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { createResponseCompression } from "./compression.js"

function appWithRoutes() {
  const app = express()
  app.use(createResponseCompression())
  const items = Array.from({ length: 200 }, (_, index) => ({ id: index, title: `Feedback ${index}`, text: "Comportamento observado e recomendação." }))
  app.get("/big", (_request, response) => {
    response.json({ items })
  })
  app.get("/small", (_request, response) => {
    response.json({ ok: true })
  })
  app.get("/image", (_request, response) => {
    response.type("image/png").send(Buffer.alloc(4096, 7))
  })
  app.get("/stream", (_request, response) => {
    response.setHeader("Content-Type", "text/event-stream")
    response.setHeader("Cache-Control", "no-cache")
    response.flushHeaders()
    response.write(`event: chunk\ndata: ${JSON.stringify({ text: "x".repeat(2048) })}\n\n`)
    response.end()
  })
  return app
}

describe("compressão das respostas da API", () => {
  it("JSON grande sai comprimido para quem aceita (gzip ou brotli) e chega igual", async () => {
    const gzip = await request(appWithRoutes()).get("/big").set("Accept-Encoding", "gzip")
    expect(gzip.headers["content-encoding"]).toBe("gzip")
    expect(gzip.body.items).toHaveLength(200)
    const brotli = await request(appWithRoutes()).get("/big").set("Accept-Encoding", "br, gzip")
    expect(brotli.headers["content-encoding"]).toBe("br")
  })

  it("resposta pequena, imagem e quem não aceita compressão saem como estão", async () => {
    expect((await request(appWithRoutes()).get("/small").set("Accept-Encoding", "gzip")).headers["content-encoding"]).toBeUndefined()
    expect((await request(appWithRoutes()).get("/image").set("Accept-Encoding", "gzip")).headers["content-encoding"]).toBeUndefined()
    expect((await request(appWithRoutes()).get("/big").set("Accept-Encoding", "identity")).headers["content-encoding"]).toBeUndefined()
  })

  it("o SSE do chat nunca é comprimido (cada pedaço sai na hora)", async () => {
    const response = await request(appWithRoutes()).get("/stream").set("Accept-Encoding", "gzip, br")
    expect(response.headers["content-type"]).toContain("text/event-stream")
    expect(response.headers["content-encoding"]).toBeUndefined()
    expect(response.text).toContain("event: chunk")
  })
})
