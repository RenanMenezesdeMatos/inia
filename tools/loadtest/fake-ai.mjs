// IA FALSA do teste de carga — carregada ANTES do servidor: `node --import ./tools/loadtest/fake-ai.mjs backend/dist/main/server.js`.
//
// Troca só a RESPOSTA do provedor: gateway, limitador de vagas, registro de uso (ai_usage_events) e custo rodam como em produção.
//   - Toda chamada ao Google (generateContent, streamGenerateContent, auth_tokens, cachedContents, TTS) é respondida aqui, com
//     latência sorteada da distribuição REAL medida no banco de dev (ver LATENCY). Nenhuma chamada sai da máquina.
//   - Motor de feedback: o conteúdo vem do modelo falso dos testes (`feedback-engine/testing/fake-engine-model.ts`), que monta
//     respostas válidas para cada etapa a partir do próprio prompt. O pedido da etapa chega aqui pelo contexto assíncrono que
//     `fake-engine-gateway.mjs` abre em volta do adapter real.
//   - OpenAI, Anthropic e Ollama (11434) também são respondidos aqui — se algum fluxo chegar a eles, nada sai da máquina.
// Segurança extra: rode com GEMINI_API_KEY falsa (o roteiro de subida faz isso). Se algo escapar, o provedor recusa — sem custo.
import { register } from "node:module"
import { AsyncLocalStorage } from "node:async_hooks"

register("./fake-ai-hooks.mjs", import.meta.url)

const engineContext = (globalThis.__iniaLoadtestEngine ??= new AsyncLocalStorage())
const SCALE = Number(process.env.LT_AI_LATENCY_SCALE ?? "1")
const stats = (globalThis.__iniaLoadtestAiStats ??= { calls: 0, engine: 0, stream: 0, structured: 0, other: 0 })

// Latência real (banco de dev, 30 dias até 14/10/2026): mediana e p95 → lognormal (sigma = ln(p95/p50) / 1,645).
const LATENCY = {
  ENGINE_ANALYSIS: { p50: 26_000, p95: 97_000, cap: 200_000 }, // FEEDBACK_ANALYSIS (análise, revisão, confirmação, práticas)
  ENGINE_WRITER: { p50: 2_500, p95: 34_500, cap: 110_000 }, // FEEDBACK_WRITER (composição, verificação)
  STRUCTURED: { p50: 8_000, p95: 14_000, cap: 40_000 }, // roteamento do Orquestrador / especialista com resposta estruturada
  TEXT: { p50: 4_100, p95: 5_600, cap: 20_000 }, // AGENT_RESPONSE
  STREAM_FIRST: { p50: 1_200, p95: 2_500, cap: 10_000 }, // primeiro pedaço do chat em streaming
  TTS: { p50: 3_000, p95: 8_000, cap: 30_000 },
  TOKEN: { p50: 300, p95: 800, cap: 3_000 },
}
function gaussian() {
  let u = 0
  while (u === 0) u = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random())
}
function latency(kind) {
  const { p50, p95, cap } = LATENCY[kind]
  const sigma = Math.log(p95 / p50) / 1.645
  return Math.min(cap, p50 * Math.exp(sigma * gaussian())) * SCALE
}
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener?.("abort", () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
    }, { once: true })
  })

/** Instância mínima VÁLIDA de um schema (formato Gemini ou JSON Schema): todas as propriedades, primeiro valor de enum. */
function sample(schema, depth = 0) {
  if (!schema || depth > 12) return "ok"
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  if (schema.const !== undefined) return schema.const
  const union = schema.anyOf ?? schema.oneOf
  if (Array.isArray(union) && union.length > 0) return sample(union.find((option) => String(option.type ?? "").toLowerCase() !== "null") ?? union[0], depth + 1)
  const type = String((Array.isArray(schema.type) ? schema.type.find((entry) => entry !== "null") : schema.type) ?? (schema.properties ? "object" : "string")).toLowerCase()
  if (type === "object") {
    const out = {}
    for (const [key, value] of Object.entries(schema.properties ?? {})) out[key] = sample(value, depth + 1)
    return out
  }
  if (type === "array") return Array.from({ length: Math.max(0, Number(schema.minItems ?? 0)) }, () => sample(schema.items, depth + 1))
  if (type === "integer" || type === "number") return Number(schema.minimum ?? 0)
  if (type === "boolean") return false
  if (type === "null") return null
  if (schema.format === "date-time") return new Date().toISOString()
  return "Resposta simulada do teste de carga."
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const usage = (input, output) => ({ promptTokenCount: input, candidatesTokenCount: output, totalTokenCount: input + output })
const textResponse = (text, input = 1500, output = 200) => json({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP", index: 0 }], usageMetadata: usage(input, output), modelVersion: "fake-loadtest" })

function sseStream(text, signal) {
  const encoder = new TextEncoder()
  const words = text.split(" ")
  return new ReadableStream({
    async start(controller) {
      try {
        await sleep(latency("STREAM_FIRST"), signal)
        for (let index = 0; index < words.length; index += 6) {
          const chunk = { candidates: [{ content: { role: "model", parts: [{ text: `${words.slice(index, index + 6).join(" ")} ` }] }, index: 0 }] }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\r\n\r\n`))
          await sleep(120 * SCALE, signal)
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "" }] }, finishReason: "STOP", index: 0 }], usageMetadata: usage(1800, 160) })}\r\n\r\n`))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })
}

const CHAT_TEXT = "Claro! Pelo procedimento, confirme primeiro os dados do titular, depois registre o protocolo e informe o prazo de retorno ao cliente. Se ainda tiver dúvida, me chama que eu te ajudo com o passo a passo."

async function fakeGoogle(url, init) {
  const signal = init?.signal
  const body = typeof init?.body === "string" ? safeJson(init.body) : null
  stats.calls += 1
  if (url.includes("/auth_tokens")) {
    await sleep(latency("TOKEN"), signal)
    return json({ name: `auth_tokens/fake-${Date.now()}`, expireTime: new Date(Date.now() + 1_800_000).toISOString() })
  }
  if (url.includes("/cachedContents")) return json({ name: `cachedContents/fake-${Date.now()}`, expireTime: new Date(Date.now() + 1_800_000).toISOString(), usageMetadata: { totalTokenCount: 2000 } })
  if (url.includes(":streamGenerateContent")) {
    stats.stream += 1
    return new Response(sseStream(CHAT_TEXT, signal), { status: 200, headers: { "content-type": "text/event-stream" } })
  }
  const engine = engineContext.getStore()
  if (engine) {
    stats.engine += 1
    const stage = engine.request.stage
    await sleep(latency(stage === "COMPOSITION" || stage === "VERIFICATION" ? "ENGINE_WRITER" : "ENGINE_ANALYSIS"), signal)
    const result = await engine.fake.generate(engine.request)
    engine.reset()
    const heavy = stage === "CALL_ANALYSIS" || stage.startsWith("PRACTICE")
    return textResponse(result.text, heavy ? 33_000 : 6_000, heavy ? 4_000 : 800)
  }
  const config = body?.generationConfig ?? {}
  if (Array.isArray(config.responseModalities) && config.responseModalities.includes("AUDIO")) {
    await sleep(latency("TTS"), signal)
    const silence = Buffer.alloc(24_000 * 2).toString("base64") // 1 s de silêncio PCM 16 bits, 24 kHz
    return json({ candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: silence } }] }, finishReason: "STOP" }], usageMetadata: usage(300, 50) })
  }
  const schema = config.responseJsonSchema ?? config.responseSchema ?? config.response_json_schema
  if (schema || config.responseMimeType === "application/json") {
    stats.structured += 1
    await sleep(latency("STRUCTURED"), signal)
    return textResponse(JSON.stringify(schema ? sample(schema) : {}), 7_000, 300)
  }
  stats.other += 1
  await sleep(latency("TEXT"), signal)
  return textResponse(CHAT_TEXT, 7_000, 250)
}

function safeJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const AI_HOSTS = /^(https?:\/\/)?([a-z0-9.-]*\.)?(generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com)\b|:11434\b/i
const realFetch = globalThis.fetch
globalThis.fetch = async function loadtestFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  if (!AI_HOSTS.test(url)) return realFetch(input, init)
  if (/generativelanguage\.googleapis\.com/i.test(url)) return fakeGoogle(url, init)
  // OpenAI/Anthropic/Ollama: resposta mínima no formato chat completions (nenhum fluxo do teste deve chegar aqui).
  await sleep(latency("TEXT"), init?.signal)
  return json({ id: "fake", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: CHAT_TEXT }, finish_reason: "stop" }], usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } })
}

process.stdout.write(`[loadtest] IA falsa ativa (escala de latência ${SCALE}); nenhuma chamada de IA sai da máquina.\n`)
