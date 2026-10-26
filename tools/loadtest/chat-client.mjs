// Cliente do chat de texto da INIA para medições: login com a senha demo e uma pergunta pelo SSE de `/realtime/messages`, medindo
// o que a pessoa vê — tempo até o PRIMEIRO TEXTO da resposta (evento `chunk` não vazio; progresso `status` não conta), até o
// primeiro progresso e até o fim (`done`/fechamento). Nenhum conteúdo é gravado nos resultados, só tempos e nomes de evento.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export function demoPassword(envFile = path.join(ROOT, "backend/.env")) {
  const password = /^INIA_DEMO_PASSWORD=(.*)$/m.exec(readFileSync(envFile, "utf8"))?.[1]?.trim()
  if (!password) throw new Error(`INIA_DEMO_PASSWORD ausente em ${envFile}`)
  return password
}

export class ChatSession {
  constructor({ api, origin, email }) {
    this.api = api
    this.origin = origin
    this.email = email
    this.cookies = new Map()
  }
  headers(extra = {}) {
    return { cookie: [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; "), origin: this.origin, ...extra }
  }
  absorb(response) {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";")
      const index = pair.indexOf("=")
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }
  async login(password) {
    const response = await fetch(`${this.api}/api/v1/auth/login`, { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify({ email: this.email, password }) })
    this.absorb(response)
    await response.text()
    return response.status === 200
  }
  async newConversation() {
    const response = await fetch(`${this.api}/api/v1/realtime/conversations/new`, { method: "POST", headers: this.headers() })
    this.absorb(response)
    await response.text()
  }
  /** Uma pergunta; devolve só tempos (ms a partir do envio), eventos e o id do rastreamento do servidor. */
  async ask(text, { conversationId = null, timeoutMs = 150_000 } = {}) {
    const started = performance.now()
    const at = () => Math.round(performance.now() - started)
    const result = { ok: false, status: 0, traceId: null, firstStatusMs: null, firstTextMs: null, totalMs: null, chunks: 0, retracts: 0, events: [], error: null, chars: 0 }
    try {
      const response = await fetch(`${this.api}/api/v1/realtime/messages`, { method: "POST", headers: this.headers({ "content-type": "application/json" }), body: JSON.stringify({ conversationId, text, clientMessageId: crypto.randomUUID() }), signal: AbortSignal.timeout(timeoutMs) })
      this.absorb(response)
      result.status = response.status
      result.traceId = response.headers.get("x-inia-trace-id")
      if (!response.ok || !response.body) {
        result.error = `HTTP ${response.status}`
        result.totalMs = at()
        return result
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split("\n\n")
        buffer = blocks.pop() ?? ""
        for (const block of blocks) {
          const name = /^event: (.+)$/m.exec(block)?.[1]
          const data = /^data: (.+)$/m.exec(block)?.[1]
          if (!name || !data) continue
          if (result.events.at(-1) !== name) result.events.push(name)
          if (name === "status") result.firstStatusMs ??= at()
          if (name === "retract") result.retracts += 1
          if (name === "chunk") {
            const chunk = JSON.parse(data).text ?? ""
            result.chunks += 1
            result.chars += chunk.length
            if (chunk.trim()) result.firstTextMs ??= at()
          }
          if (name === "conversation") result.conversationId = JSON.parse(data).conversationId
          if (name === "error") result.error = "evento de erro no SSE"
        }
      }
      result.totalMs = at()
      result.ok = !result.error && result.firstTextMs !== null
      return result
    } catch (error) {
      result.error = String(error?.name ?? error).slice(0, 80)
      result.totalMs = at()
      return result
    }
  }
}

export function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}
