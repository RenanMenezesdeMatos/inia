// COTA COMPARTILHADA DO PROVEDOR FALSO — um processo só, consultado pela IA falsa (fake-ai.mjs) de TODOS os processos da INIA
// (API e worker), como acontece com um provedor de verdade: a cota é do ACESSO (chave/projeto), não de cada processo.
//
//   node tools/loadtest/fake-quota.mjs            (127.0.0.1:3480; LT_QUOTA_TPM, LT_QUOTA_RPM)
//
// POST /admit {"tokens": n, "priorityHint": "chat"|"batch"}  → 200 ou 429 {"retryAfterMs"} (janela deslizante de 60 s, como o
//   limite por minuto do Gemini/OpenAI: tokens de ENTRADA contados quando a chamada começa — a dica nunca entra na decisão).
// GET /stats → admitidos/recusados por dica e por minuto, para o relatório.
import { createServer } from "node:http"

const TPM = Number(process.env.LT_QUOTA_TPM ?? 600_000)
const RPM = Number(process.env.LT_QUOTA_RPM ?? 400)
const PORT = Number(process.env.LT_QUOTA_PORT ?? 3480)
const WINDOW_MS = 60_000

/** Chamadas admitidas na janela: [instante, tokens]. */
let admitted = []
const totals = { admitted: { chat: 0, batch: 0, other: 0 }, rejected: { chat: 0, batch: 0, other: 0 }, tokens: 0 }
const perMinute = new Map()

function prune(now) {
  while (admitted.length > 0 && admitted[0][0] <= now - WINDOW_MS) admitted.shift()
}

function admit(tokens, hint, now = Date.now()) {
  prune(now)
  const used = admitted.reduce((sum, [, n]) => sum + n, 0)
  const minute = Math.floor(now / 60_000)
  const slot = perMinute.get(minute) ?? { admitted: 0, rejected: 0, tokens: 0 }
  perMinute.set(minute, slot)
  const key = hint === "chat" || hint === "batch" ? hint : "other"
  if (used + tokens > TPM || admitted.length + 1 > RPM) {
    // Quando a janela libera o suficiente: o mais antigo que precisa sair.
    let freed = 0
    let retryAfterMs = 1_000
    for (const [at, n] of admitted) {
      freed += n
      retryAfterMs = Math.max(1_000, at + WINDOW_MS - now)
      if (used - freed + tokens <= TPM && admitted.length - 1 < RPM) break
    }
    totals.rejected[key] += 1
    slot.rejected += 1
    return { ok: false, retryAfterMs: Math.min(retryAfterMs, 30_000) }
  }
  admitted.push([now, tokens])
  totals.admitted[key] += 1
  totals.tokens += tokens
  slot.admitted += 1
  slot.tokens += tokens
  return { ok: true }
}

createServer((request, response) => {
  if (request.method === "GET" && request.url === "/stats") {
    prune(Date.now())
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ tpm: TPM, rpm: RPM, windowTokens: admitted.reduce((sum, [, n]) => sum + n, 0), totals, perMinute: [...perMinute].map(([minute, value]) => ({ minute, ...value })) }))
    return
  }
  if (request.method === "POST" && request.url === "/reset") {
    admitted = []
    for (const kind of ["admitted", "rejected"]) for (const key of Object.keys(totals[kind])) totals[kind][key] = 0
    totals.tokens = 0
    perMinute.clear()
    response.writeHead(204).end()
    return
  }
  if (request.method !== "POST" || request.url !== "/admit") {
    response.writeHead(404).end()
    return
  }
  let body = ""
  request.on("data", (chunk) => (body += chunk))
  request.on("end", () => {
    let input = {}
    try {
      input = JSON.parse(body)
    } catch {
      input = {}
    }
    const result = admit(Math.max(1, Number(input.tokens) || 1), input.priorityHint)
    response.writeHead(result.ok ? 200 : 429, { "content-type": "application/json" })
    response.end(JSON.stringify(result))
  })
}).listen(PORT, "127.0.0.1", () => process.stdout.write(`[fake-quota] 127.0.0.1:${PORT} — ${TPM} tokens/min, ${RPM} chamadas/min (janela de 60 s)\n`))
