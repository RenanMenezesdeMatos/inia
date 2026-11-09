import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { DataRunError } from "../domain/error-codes.js"
import { FetchHttpClient } from "./fetch-http-client.js"

/** Só o status: a prova de uma credencial não pode baixar a carga inteira do cliente nem cair no teto de tamanho. */
describe("cliente HTTP — pedido só de status", () => {
  let server: Server
  let url: string
  let bodiesFinished = 0
  const client = new FetchHttpClient({ mode: "OPEN", allowLoopback: true, allow: [], deniedEndpoints: [] }, 10)

  beforeAll(async () => {
    server = createServer((_request, response) => {
      response.writeHead(401, { "content-type": "application/json" })
      response.write("x".repeat(1_000))
      // A resposta nunca termina: quem tentar ler o corpo inteiro fica preso ou estoura o teto.
      response.on("finish", () => (bodiesFinished += 1))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/dados`
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  })

  it("devolve o status sem ler o corpo, mesmo acima do teto e sem a resposta terminar", async () => {
    const response = await client.send({ url, method: "GET", headers: {}, timeoutMs: 5_000, statusOnly: true })
    expect(response).toMatchObject({ status: 401, body: "" })
    expect(bodiesFinished).toBe(0)
  })

  it("sem a opção, continua lendo o corpo e respeitando o teto", async () => {
    const error = await client.send({ url, method: "GET", headers: {}, timeoutMs: 5_000 }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(DataRunError)
    expect((error as DataRunError).code).toBe("DATA_SOURCE_VOLUME_LIMIT")
  })
})
