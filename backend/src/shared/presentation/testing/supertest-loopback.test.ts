import net from "node:net"
import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"

/** Tenta abrir 127.0.0.1 na porta do servidor do teste, como faria um encaminhador de porta; devolve o resultado do bind. */
function bindSameLoopbackPort(port: number): Promise<string> {
  const other = net.createServer()
  return new Promise((resolve) => {
    other.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? "erro"))
    other.listen(port, "127.0.0.1", () => other.close(() => resolve("ACEITO")))
  })
}

function appReportingSocket() {
  const app = express()
  app.get("/socket", async (req, res) => {
    res.json({ localAddress: req.socket.localAddress, otherBind: await bindSameLoopbackPort(req.socket.localPort!) })
  })
  app.get("/cookie", (_req, res) => res.cookie("sessao", "abc").json({ ok: true }))
  app.get("/eco-cookie", (req, res) => res.json({ cookie: req.headers.cookie ?? null, localAddress: req.socket.localAddress }))
  return app
}

describe("supertest dos testes do backend (alias → supertest-loopback.ts)", () => {
  it("127.0.0.1 na porta do servidor do teste fica reservado: outro programa não consegue abrir a mesma porta e sequestrar a conexão", async () => {
    const response = await request(appReportingSocket()).get("/socket")
    expect(response.status).toBe(200)
    // Sem a reserva, no macOS o outro bind seria ACEITO e passaria a atender 127.0.0.1 (no Linux o kernel já recusa).
    expect(response.body.otherBind).toBe("EADDRINUSE")
  })

  it("request.agent: mesma reserva a cada requisição, com os cookies mantidos entre elas", async () => {
    const agent = request.agent(appReportingSocket())
    expect((await agent.get("/cookie")).status).toBe(200)
    const echoed = await agent.get("/eco-cookie")
    expect(echoed.body.cookie).toBe("sessao=abc")
  })

  it("servidor que já está escutando passa direto (o teste decide onde ele escuta)", async () => {
    const server = appReportingSocket().listen(0, "127.0.0.1")
    await new Promise((resolve) => server.once("listening", resolve))
    try {
      expect((await request(server).get("/eco-cookie")).body.localAddress).toBe("127.0.0.1")
      expect(server.listening).toBe(true)
    } finally {
      server.close()
    }
  })
})
