import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * AUDITORIA DE CALL SITES DE IA (AI Management V1 — fechamento operacional). Prova ESTRUTURAL de que
 * nenhum código consegue falar com um provider remoto sem passar pelo gateway (`llm-gateway.ts`), que
 * grava um evento de uso por chamada (ver ai-runtime-gateway.test.ts, "zero spend sem uso"):
 *
 *  1. só os arquivos abaixo conhecem o endereço de um provider;
 *  2. os clientes crus só são importados (como VALOR — `import type` não chama nada) por quem os embrulha:
 *     o adapter legado registrado no gateway, e o `app.ts`, que os entrega ao router de realtime já
 *     embrulhados por `createChatStreamer`/`createVoiceSessionStarter`;
 *  3. os adapters do AI Management só são executados pelo runtime da organização (que persiste o uso)
 *     e pelas ações administrativas (teste de conexão/listagem — sem geração — e "Testar modelo", que
 *     grava MODEL_TEST).
 *
 * Um arquivo novo aqui é uma decisão consciente, nunca um atalho.
 */
const SRC = join(__dirname, "..", "..", "..")

const PROVIDER_HOST = /generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|api\.x\.ai/

const FILES_THAT_KNOW_PROVIDER_HOSTS = new Set([
  "modules/agents/infrastructure/gemini-agent-client.ts",
  "modules/assistant/infrastructure/gemini-function-calling-client.ts",
  "modules/assistant/infrastructure/gemini-prompt-cache.ts",
  "modules/realtime/infrastructure/gemini-text-client.ts",
  "modules/realtime/infrastructure/gemini-realtime-client.ts",
  // Voz do recado do avatar (TTS): só o app.ts o importa, embrulhado por createSpeechSynthesizer.
  "modules/conversational-delivery/infrastructure/gemini-tts-client.ts",
  // Voz do recado pelo modelo da conversa (Live no servidor): só o app.ts o importa, embrulhado por createSpeechSynthesizer.
  "modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts",
  // Catálogo: só a URL padrão exibida/usada pelas conexões — quem chama são os adapters abaixo.
  "modules/ai-management/domain/ai-provider-catalog.ts",
])

/** Cliente cru → quem pode importá-lo como valor. */
const RAW_CLIENT_IMPORTERS: Record<string, string[]> = {
  "gemini-agent-client": ["modules/assistant/infrastructure/gemini-provider-adapter.ts", "modules/workflows/application/effect-sink.ts" /* só a constante AGENT_LLM_MODEL */],
  "gemini-function-calling-client": ["modules/assistant/infrastructure/gemini-provider-adapter.ts"],
  "gemini-prompt-cache": ["modules/assistant/infrastructure/gemini-provider-adapter.ts"],
  "gemini-provider-adapter": ["shared/application/model-routing/llm-gateway.ts"],
  "gemini-text-client": ["main/app.ts", "shared/application/model-routing/llm-gateway.ts" /* só o tipo do uso */, "modules/assistant/infrastructure/gemini-function-calling-client.ts", "modules/agents/infrastructure/gemini-agent-client.ts"],
  "gemini-realtime-client": ["main/app.ts"],
  "gemini-tts-client": ["main/app.ts"],
  "gemini-live-speech-client": ["main/app.ts"],
  // app.ts cria UM registro e o entrega ao runtime e às ações administrativas (via contexto).
  "adapter-registry": ["modules/ai-management/application/ai-runtime-service.ts", "main/app.ts"],
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(path)
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : []
  })
}

const files = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }))

/** Imports de VALOR (ignora `import type` e `export type`). */
function valueImportsOf(text: string): string[] {
  return [...text.matchAll(/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map((match) => match[2]!)
}

describe("call sites de IA — nenhum caminho remoto fora do gateway", () => {
  it("só os clientes/adapters conhecidos conhecem o endereço de um provider", () => {
    const offenders = files.filter((file) => PROVIDER_HOST.test(file.text) && !FILES_THAT_KNOW_PROVIDER_HOSTS.has(file.path))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it("clientes crus e adapters só são importados (como valor) por quem os embrulha no gateway/runtime", () => {
    const violations: string[] = []
    for (const file of files) {
      for (const specifier of valueImportsOf(file.text)) {
        const module = Object.keys(RAW_CLIENT_IMPORTERS).find((name) => specifier.endsWith(`/${name}.js`))
        if (module && !RAW_CLIENT_IMPORTERS[module]!.includes(file.path)) violations.push(`${file.path} → ${module}`)
      }
    }
    expect(violations).toEqual([])
  })

  it("o app entrega ao realtime os clientes crus SEMPRE embrulhados pelo gateway (chat e voz)", () => {
    const app = files.find((file) => file.path === "main/app.ts")!.text
    expect(app).toMatch(/createVoiceSessionStarter\(createEphemeralRealtimeSession\)/)
    expect(app).toMatch(/createChatStreamer\(streamTextReply\)/)
    const uses = (name: string) => [...app.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length
    // import + a única chamada embrulhada
    expect(uses("streamTextReply")).toBe(2)
    expect(uses("createEphemeralRealtimeSession")).toBe(2)
    // Voz do recado do avatar: TTS sempre embrulhado (orçamento + uso).
    expect(app).toMatch(/createSpeechSynthesizer\(synthesizeSpeechWithGemini\)/)
    expect(uses("synthesizeSpeechWithGemini")).toBe(2)
    expect(app).toMatch(/createSpeechSynthesizer\(speakWithGeminiLive\)/)
    expect(uses("speakWithGeminiLive")).toBe(2)
  })

  it("nenhum `fetch` direto a provider fora dos clientes conhecidos (a Central de Dados usa o próprio cliente HTTP, não IA)", () => {
    const fetchers = files.filter((file) => /\bfetch\(/.test(file.text)).map((file) => file.path).sort()
    expect(fetchers).toEqual([
      "modules/agents/infrastructure/gemini-agent-client.ts",
      // Transporte dos adapters do PRÓPRIO gateway (AI Providers V1): o `fetch` com a política de destinos de saída.
      "modules/ai-management/infrastructure/adapters/http.ts",
      "modules/assistant/infrastructure/gemini-function-calling-client.ts",
      "modules/assistant/infrastructure/gemini-prompt-cache.ts",
      "modules/conversational-delivery/infrastructure/gemini-tts-client.ts",
      "modules/data-hub/infrastructure/fetch-http-client.ts",
      "modules/realtime/infrastructure/gemini-realtime-client.ts",
      "modules/realtime/infrastructure/gemini-text-client.ts",
    ])
    // WebSocket de servidor a provider: só a voz do recado (Live). A conversa por voz abre o socket no NAVEGADOR.
    expect(files.filter((file) => /new WebSocket\(/.test(file.text)).map((file) => file.path)).toEqual(["modules/conversational-delivery/infrastructure/gemini-live-speech-client.ts"])
  })
})
