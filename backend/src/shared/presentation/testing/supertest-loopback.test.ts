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

/**
 * Faz o papel de um programa que já escuta em 127.0.0.1 (Notion, limactl): ocupa as próximas portas que o kernel vai distribuir.
 * No macOS elas saem em sequência; com o `listen(0)` no curinga, a próxima requisição cairia aqui. Fica aberto o mínimo possível,
 * porque a sequência é da máquina inteira.
 */
async function occupyNextLoopbackPorts(count: number) {
  const probe = net.createServer()
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve))
  const current = (probe.address() as net.AddressInfo).port
  await new Promise((resolve) => probe.close(resolve))

  let connections = 0
  const ports = Array.from({ length: count }, (_, index) => current + 1 + index).filter((port) => port <= 65535)
  const servers = await Promise.all(ports.map((port) => new Promise<net.Server | null>((resolve) => {
    const server = net.createServer((socket) => {
      connections += 1
      // Fecha dos dois lados: se o teste falhar, `release` não pode ficar esperando a conexão e esconder o erro num timeout.
      socket.on("error", () => undefined)
      socket.end("isto nao e HTTP\n", () => socket.destroy())
    })
    server.once("error", () => resolve(null))
    server.listen(port, "127.0.0.1", () => resolve(server))
  })))
  return {
    connections: () => connections,
    release: () => Promise.all(servers.map((server) => new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined))))),
  }
}

/** O servidor que o supertest abriu para esta requisição. */
const serverOf = (test: unknown) => (test as { app: net.Server }).app

describe("supertest dos testes do backend (alias → supertest-loopback.ts)", () => {
  it("a porta que outro programa já escuta em 127.0.0.1 nunca é usada: a requisição chega ao app do teste", async () => {
    const otherProgram = await occupyNextLoopbackPorts(16)
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await request(appReportingSocket()).get("/eco-cookie")).status).toBe(200)
      }
      expect(otherProgram.connections()).toBe(0)
    } finally {
      await otherProgram.release()
    }
  })

  it("o servidor do teste escuta só em 127.0.0.1, nunca em todas as interfaces, com request e com request.agent", async () => {
    for (const test of [request(appReportingSocket()).get("/eco-cookie"), request.agent(appReportingSocket()).get("/eco-cookie")]) {
      expect((serverOf(test).address() as net.AddressInfo).address).toBe("127.0.0.1")
      expect((await test).status).toBe(200)
      expect(serverOf(test).listening).toBe(false)
    }
  })

  it("com o servidor do teste escutando, outro programa não consegue abrir a mesma porta em 127.0.0.1", async () => {
    const response = await request(appReportingSocket()).get("/socket")
    expect(response.status).toBe(200)
    expect(response.body.localAddress).toBe("127.0.0.1")
    expect(response.body.otherBind).toBe("EADDRINUSE")
  })

  it("request.agent: cada requisição abre e fecha o servidor em 127.0.0.1, com os cookies mantidos entre elas", async () => {
    const agent = request.agent(appReportingSocket())
    expect((await agent.get("/cookie")).status).toBe(200)
    const echoed = await agent.get("/eco-cookie")
    expect(echoed.body.cookie).toBe("sessao=abc")
    expect(echoed.body.localAddress).toBe("127.0.0.1")
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
