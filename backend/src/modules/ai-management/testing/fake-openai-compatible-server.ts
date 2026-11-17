import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

/**
 * SERVIDOR FALSO compatível com OpenAI (/v1/models, /v1/chat/completions) — usado pela prova de
 * banco e pelo QA no navegador (scripts/dev/fake-ai-provider.ts). Nenhuma API real/paga é chamada.
 * O comportamento é escolhido pelo NOME DO MODELO pedido:
 *
 *   fake-ok              → texto + uso completo (entrada 1.200, cache 200, saída 300, raciocínio 50)
 *   fake-json            → '{"ok":true}'
 *   fake-rate-limited    → 429       fake-down → 503        fake-unauthorized → 401
 *   fake-bad-request     → 400       fake-no-usage → texto sem bloco `usage`
 *   fake-slow            → responde depois de 3 s (para timeout)
 *
 * Com `apiKey` configurada, qualquer request sem `Authorization: Bearer <apiKey>` recebe 401 — e o
 * corpo do 401 ECOA a chave recebida (como alguns providers fazem), para provar a redação.
 *
 * Capacidade (limitador de chamadas de IA): `latencyMs` atrasa as respostas de texto/stream e `capacity` simula a COTA do
 * provider — com `maxConcurrent` requests de geração em andamento, a próxima recebe 429 na hora, com `Retry-After`. `stats`
 * conta atendidas, recusadas e o pico de concorrência. Sem essas opções, nada muda.
 *
 * Roteiro (prova do Feedback Writer pela policy): `respond(body)` recebe o corpo do POST de /chat/completions e devolve o
 * `content` da resposta (com o uso de sempre e `finish_reason: "stop"`) — `null` deixa o comportamento pelo nome do modelo.
 * Cada request guarda o corpo recebido (`requests[].body`) para a prova conferir o que saiu (schema, teto de saída…).
 *
 * Custo informado (gateway compatível com OpenAI/LiteLLM): com `responseCost` (ou `setResponseCost`), toda resposta 200 de
 * geração e de voz — com e sem streaming — leva o cabeçalho `x-litellm-response-cost` com o valor EXATO dado (string crua,
 * inclusive inválida, para provar o retorno à estimativa). `null` = sem o cabeçalho (o padrão).
 *
 * Voz (`POST /v1/audio/speech`): devolve `FAKE_SPEECH_PCM` (1 s de PCM16 mono 24 kHz, padrão fixo) como o `response_format:
 * "pcm"` da OpenAI; `fake-down` → 503.
 *
 * Embedding (`POST /v1/embeddings`): um vetor por texto de `input`, pela função `embed` das opções (a prova escolhe o "significado") ou,
 * sem ela, um vetor determinístico de 32 posições pelas palavras do texto; uso = 1 token por palavra. `fake-down` → 503,
 * `fake-bad-request` → 400.
 */
export const FAKE_SPEECH_PCM = Buffer.from(Array.from({ length: 48_000 }, (_, index) => (index * 7) % 256))
export const FAKE_MODELS = ["fake-ok", "fake-json", "fake-rate-limited", "fake-down", "fake-unauthorized", "fake-bad-request", "fake-no-usage", "fake-slow"] as const

export type FakeServerStats = { served: number; rateLimited: number; inFlight: number; peakInFlight: number }
export type FakeServer = { url: string; port: number; requests: { path: string; model: string | null; body: Record<string, unknown> }[]; stats: FakeServerStats; setResponseCost: (value: string | null) => void; close: () => Promise<void> }
export type FakeServerOptions = { apiKey?: string | null; port?: number; host?: string; latencyMs?: number; capacity?: { maxConcurrent: number; retryAfterSeconds?: number }; respond?: (body: Record<string, unknown>) => string | null; responseCost?: string | null; embed?: (text: string, model: string | null) => number[] }

/** Vetor determinístico pelas palavras (sem significado nenhum): só para o servidor responder quando a prova não escolhe o `embed`. */
export function fakeWordVector(text: string, dimensions = 32): number[] {
  const vector: number[] = Array.from({ length: dimensions }, () => 0)
  for (const word of text.toLowerCase().split(/\s+/).filter(Boolean)) {
    let hash = 0
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
    vector[hash % dimensions]! += 1
  }
  if (Math.max(...vector) === 0) vector[0] = 1
  return vector
}

export const FAKE_RESPONSE_COST_HEADER = "x-litellm-response-cost"

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { "content-type": "application/json", ...headers })
  response.end(JSON.stringify(body))
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>
  } catch {
    return {}
  }
}

export async function startFakeOpenAiServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const requests: FakeServer["requests"] = []
  const stats: FakeServerStats = { served: 0, rateLimited: 0, inFlight: 0, peakInFlight: 0 }
  let responseCost = options.responseCost ?? null
  const costHeaders = (): Record<string, string> => (responseCost === null ? {} : { [FAKE_RESPONSE_COST_HEADER]: responseCost })
  const server: Server = createServer(async (request, response) => {
    const path = (request.url ?? "").split("?")[0] ?? ""
    const body = request.method === "POST" ? await readBody(request) : {}
    const model = typeof body.model === "string" ? body.model : null
    requests.push({ path, model, body })
    const auth = request.headers.authorization
    if (options.apiKey && auth !== `Bearer ${options.apiKey}`) return send(response, 401, { error: { message: `Incorrect API key provided: ${auth ?? "(none)"}` } })
    if (request.method === "GET" && path.endsWith("/models")) return send(response, 200, { object: "list", data: FAKE_MODELS.map((id) => ({ id, object: "model", owned_by: "inia-fake" })) })
    if (request.method === "POST" && path.endsWith("/audio/speech")) {
      if (model === "fake-down") return send(response, 503, { error: { message: "Service unavailable" } })
      response.writeHead(200, { "content-type": "audio/pcm", ...costHeaders() })
      response.end(FAKE_SPEECH_PCM)
      return
    }
    if (request.method === "POST" && path.endsWith("/embeddings")) {
      if (model === "fake-down") return send(response, 503, { error: { message: "Service unavailable" } })
      if (model === "fake-bad-request") return send(response, 400, { error: { message: "Invalid input" } })
      const inputs = Array.isArray(body.input) ? body.input.map(String) : [String(body.input ?? "")]
      const tokens = inputs.reduce((sum, text) => sum + text.split(/\s+/).filter(Boolean).length, 0)
      return send(response, 200, { object: "list", model, data: inputs.map((text, index) => ({ object: "embedding", index, embedding: options.embed ? options.embed(text, model) : fakeWordVector(text) })), usage: { prompt_tokens: tokens, total_tokens: tokens } }, costHeaders())
    }
    if (request.method !== "POST" || !path.endsWith("/chat/completions")) return send(response, 404, { error: { message: "not found" } })
    const usage = { prompt_tokens: 1200, completion_tokens: 300, total_tokens: 1500, prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 50 } }
    if (options.capacity && stats.inFlight >= options.capacity.maxConcurrent) {
      stats.rateLimited++
      response.writeHead(429, { "content-type": "application/json", "retry-after": String(options.capacity.retryAfterSeconds ?? 1) })
      response.end(JSON.stringify({ error: { message: "Rate limit reached (cota simulada)" } }))
      return
    }
    stats.inFlight++
    stats.peakInFlight = Math.max(stats.peakInFlight, stats.inFlight)
    response.on("close", () => {
      stats.inFlight--
      stats.served++
    })
    if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs))
    const scripted = options.respond?.(body) ?? null
    if (scripted !== null) return send(response, 200, { model, choices: [{ message: { content: scripted }, finish_reason: "stop" }], usage }, costHeaders())
    switch (model) {
      case "fake-rate-limited":
        return send(response, 429, { error: { message: "Rate limit reached" } })
      case "fake-down":
        return send(response, 503, { error: { message: "Service unavailable" } })
      case "fake-unauthorized":
        return send(response, 401, { error: { message: "Invalid API key for this model" } })
      case "fake-bad-request":
        return send(response, 400, { error: { message: "Invalid parameter" } })
      case "fake-slow":
        await new Promise((resolve) => setTimeout(resolve, 3_000))
        return send(response, 200, { model, choices: [{ message: { content: "lento" } }], usage }, costHeaders())
      case "fake-no-usage":
        return send(response, 200, { model, choices: [{ message: { content: "sem uso informado" } }] }, costHeaders())
      case "fake-json":
        return send(response, 200, { model, choices: [{ message: { content: '{"ok":true}' } }], usage }, costHeaders())
      default:
        if (body.stream) {
          response.writeHead(200, { "content-type": "text/event-stream", ...costHeaders() })
          response.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content: "Olá do " } }] })}\n\n`)
          response.write(`data: ${JSON.stringify({ model, choices: [{ delta: { content: "provider falso." } }] })}\n\n`)
          response.write(`data: ${JSON.stringify({ model, choices: [], usage })}\n\n`)
          response.end("data: [DONE]\n\n")
          return
        }
        return send(response, 200, { model, choices: [{ message: { content: "Resposta do provider falso (nenhuma API real foi chamada)." } }], usage }, costHeaders())
    }
  })
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, options.host ?? "127.0.0.1", resolve))
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  return { url: `http://${options.host ?? "127.0.0.1"}:${port}/v1`, port, requests, stats, setResponseCost: (value) => void (responseCost = value), close: () => new Promise((resolve) => server.close(() => resolve())) }
}
