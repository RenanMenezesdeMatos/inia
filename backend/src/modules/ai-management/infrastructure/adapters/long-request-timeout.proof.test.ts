import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createOpenAiChatAdapter } from "./openai-chat-adapter.js"
import type { ResolvedConnection } from "../../application/provider-adapter-port.js"

/**
 * LOCAL_PROVIDER_LONG_REQUEST_TIMEOUT (V1.4.6.3 — prova reproduzível, lenta: ~5 min, só com INIA_SLOW_TRANSPORT_PROOF=1).
 *
 * O adapter OpenAI-compatível do runtime usa o `fetch` GLOBAL do Node. Numa resposta NÃO-streaming o servidor só
 * manda os headers quando termina de gerar; o undici do Node desiste de esperar headers aos 300 s
 * (`headersTimeout`), mesmo com um timeout lógico maior no AbortSignal. Um servidor local que segura os headers por
 * 305 s reproduz o que o Ollama fez na V1.4.6.2 (tentativa 1: `fetch failed` aos 300,8 s).
 *
 *   INIA_SLOW_TRANSPORT_PROOF=1 npx vitest run long-request-timeout.proof
 */
const ENABLED = process.env.INIA_SLOW_TRANSPORT_PROOF === "1"
const HOLD_HEADERS_MS = 305_000

describe.skipIf(!ENABLED)("transporte do adapter local — respostas não-streaming > 300 s", () => {
  let server: Server
  let baseUrl = ""
  beforeAll(async () => {
    server = createServer((_request, response) => {
      const timer = setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ model: "fake", choices: [{ message: { content: "{}" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }))
      }, HOLD_HEADERS_MS)
      response.on("close", () => clearTimeout(timer))
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  })
  afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it("mesmo com timeout lógico de 900 s, o fetch global falha perto dos 300 s (NETWORK) — o runtime não recebe respostas mais lentas", async () => {
    const adapter = createOpenAiChatAdapter()
    const connection = { id: "proof", name: "proof", providerKey: "OLLAMA", baseUrl, apiVersion: null, isLocal: true, timeoutMs: 900_000, apiKey: null, headers: {} } as unknown as ResolvedConnection
    const started = Date.now()
    const error = await adapter.execute(connection, "fake", { systemPrompt: "s", contents: [{ role: "user", text: "u" }], tools: [], structuredOutput: true, maxOutputTokens: null }, 900_000).then(() => null, (caught: unknown) => caught)
    const elapsedMs = Date.now() - started
    expect(error).toMatchObject({ category: "NETWORK" })
    expect(elapsedMs).toBeGreaterThan(295_000)
    expect(elapsedMs).toBeLessThan(HOLD_HEADERS_MS)
  }, 330_000)
})
