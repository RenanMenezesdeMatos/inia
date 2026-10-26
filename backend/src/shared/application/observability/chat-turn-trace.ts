import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

/**
 * RASTREAMENTO DE UM TURNO DO CHAT — quanto tempo cada etapa de UMA resposta levou, do request ao fim do stream, sem conteúdo:
 * nenhum texto, prompt, nome de pessoa ou argumento de ferramenta entra aqui (só nomes de etapa, propósitos, ferramentas e tempos).
 *
 *  - `firstContentMs` = o primeiro pedaço de TEXTO DA RESPOSTA enviado à tela (o indicador de progresso não conta);
 *  - etapas (`span`): conversa, contexto, esclarecimento, roteamento, ferramentas, síntese… — o tempo de cada uma;
 *  - chamadas ao modelo: propósito, espera na fila do limitador, duração, primeiro pedaço (quando em fluxo) e resultado —
 *    registradas pelo gateway (`llm-gateway.ts`) pelo contexto assíncrono, sem o router precisar saber quantas foram;
 *  - ferramentas: especialista ou ferramenta do backend, duração e se deu certo.
 *
 * No fim: uma linha `chat_turn_timing` no log e a amostra nas métricas do processo (`/internal/metrics` → `chat`: p50/p95/p99
 * do primeiro conteúdo e do total por caminho).
 */
export type ChatTurnOutcome = "OK" | "ERROR" | "CANCELLED"

export type ChatTurnLlmCall = { purpose: string; startMs: number; ms: number; queueMs: number; firstTokenMs: number | null; streamed: boolean; status: "OK" | "ERROR" | "CANCELLED" }
export type ChatTurnTool = { name: string; kind: "SPECIALIST" | "DIRECT"; startMs: number; ms: number; ok: boolean }

export type ChatTurnSummary = {
  traceId: string
  channel: string
  path: string
  outcome: ChatTurnOutcome
  firstContentMs: number | null
  totalMs: number
  stages: Record<string, number>
  llm: ChatTurnLlmCall[]
  tools: ChatTurnTool[]
  notes: Record<string, number | string | boolean>
}

export type ChatTurnTrace = {
  readonly traceId: string
  /** Milissegundos desde o início do turno. */
  elapsed(): number
  /** Caminho percorrido (ORCHESTRATED, LEADERSHIP, CLARIFICATION…) — o último que for definido vale. */
  setPath(path: string): void
  /** Mede uma etapa; etapas com o mesmo nome somam. */
  span<T>(stage: string, fn: () => Promise<T>): Promise<T>
  /** O primeiro pedaço de texto da resposta foi enviado (só a primeira chamada conta). */
  firstContent(): void
  llmCall(call: ChatTurnLlmCall): void
  tool(tool: ChatTurnTool): void
  /** Número ou rótulo sem conteúdo (ex.: tamanho do prompt em caracteres, se o stream foi retirado). */
  note(key: string, value: number | string | boolean): void
  finish(outcome: ChatTurnOutcome): ChatTurnSummary
}

export function createChatTurnTrace(input: { channel: string; now?: () => number; traceId?: string }): ChatTurnTrace {
  const now = input.now ?? (() => performance.now())
  const startedAt = now()
  const elapsed = () => Math.round(now() - startedAt)
  const stages: Record<string, number> = {}
  const llm: ChatTurnLlmCall[] = []
  const tools: ChatTurnTool[] = []
  const notes: Record<string, number | string | boolean> = {}
  let path = "UNKNOWN"
  let firstContentMs: number | null = null
  let summary: ChatTurnSummary | null = null
  return {
    traceId: input.traceId ?? randomUUID(),
    elapsed,
    setPath(next) {
      path = next
    },
    async span(stage, fn) {
      const started = now()
      try {
        return await fn()
      } finally {
        stages[stage] = (stages[stage] ?? 0) + Math.round(now() - started)
      }
    },
    firstContent() {
      firstContentMs ??= elapsed()
    },
    llmCall(call) {
      if (llm.length < 40) llm.push(call)
    },
    tool(entry) {
      if (tools.length < 40) tools.push(entry)
    },
    note(key, value) {
      notes[key] = value
    },
    finish(outcome) {
      summary ??= { traceId: this.traceId, channel: input.channel, path, outcome, firstContentMs, totalMs: elapsed(), stages: { ...stages }, llm: [...llm], tools: [...tools], notes: { ...notes } }
      return summary
    },
  }
}

const storage = new AsyncLocalStorage<ChatTurnTrace>()

/** Chamadas ao modelo e ferramentas feitas dentro de `fn` entram no rastreamento do turno. */
export function runWithChatTurnTrace<T>(trace: ChatTurnTrace, fn: () => T): T {
  return storage.run(trace, fn)
}

export function currentChatTurnTrace(): ChatTurnTrace | null {
  return storage.getStore() ?? null
}

/** Mede `fn` como uma ferramenta do turno em andamento (fora de um turno do chat, só executa). */
export async function traceChatTool<T>(name: string, kind: ChatTurnTool["kind"], fn: () => Promise<T>): Promise<T> {
  const trace = currentChatTurnTrace()
  if (!trace) return fn()
  const startMs = trace.elapsed()
  let ok = false
  try {
    const result = await fn()
    ok = true
    return result
  } finally {
    trace.tool({ name, kind, startMs, ms: trace.elapsed() - startMs, ok })
  }
}

// ---------------------------------------------------------------------------------------------
// Agregado do processo: amostra das últimas respostas por caminho (memória fixa) → p50/p95/p99.
// ---------------------------------------------------------------------------------------------

type PathStats = { count: number; errors: number; cancelled: number; firstContent: number[]; total: number[]; llmCalls: number[]; next: { firstContent: number; total: number; llmCalls: number } }

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!
}

function push(samples: number[], value: number, cursor: number, size: number): number {
  if (samples.length < size) samples.push(value)
  else samples[cursor] = value
  return (cursor + 1) % size
}

function distribution(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return { p50Ms: percentile(sorted, 50), p95Ms: percentile(sorted, 95), p99Ms: percentile(sorted, 99), sampled: sorted.length }
}

export type ChatTurnMetrics = {
  record(summary: ChatTurnSummary): void
  snapshot(): Record<string, unknown>
}

export function createChatTurnMetrics(sampleSize = 256): ChatTurnMetrics {
  const paths = new Map<string, PathStats>()
  return {
    record(summary) {
      const key = `${summary.channel}:${summary.path}`
      let stats = paths.get(key)
      if (!stats) {
        if (paths.size >= 40) return
        stats = { count: 0, errors: 0, cancelled: 0, firstContent: [], total: [], llmCalls: [], next: { firstContent: 0, total: 0, llmCalls: 0 } }
        paths.set(key, stats)
      }
      stats.count += 1
      if (summary.outcome === "ERROR") stats.errors += 1
      if (summary.outcome === "CANCELLED") stats.cancelled += 1
      if (summary.outcome !== "OK") return
      if (summary.firstContentMs !== null) stats.next.firstContent = push(stats.firstContent, summary.firstContentMs, stats.next.firstContent, sampleSize)
      stats.next.total = push(stats.total, summary.totalMs, stats.next.total, sampleSize)
      stats.next.llmCalls = push(stats.llmCalls, summary.llm.length, stats.next.llmCalls, sampleSize)
    },
    snapshot() {
      return Object.fromEntries(
        [...paths.entries()].map(([key, stats]) => [
          key,
          { count: stats.count, errors: stats.errors, cancelled: stats.cancelled, firstContent: distribution(stats.firstContent), total: distribution(stats.total), llmCalls: distribution(stats.llmCalls) },
        ]),
      )
    },
  }
}

let processMetrics: ChatTurnMetrics = createChatTurnMetrics()

export function chatTurnMetrics(): ChatTurnMetrics {
  return processMetrics
}

/** Testes trocam o agregado do processo. */
export function setChatTurnMetrics(next: ChatTurnMetrics): void {
  processMetrics = next
}

/** Fecha o turno: linha `chat_turn_timing` no log e amostra nas métricas. Nunca lança. */
export function finishChatTurn(trace: ChatTurnTrace, outcome: ChatTurnOutcome, extra: Record<string, unknown> = {}): ChatTurnSummary {
  const summary = trace.finish(outcome)
  try {
    chatTurnMetrics().record(summary)
    console.info(JSON.stringify({ event: "chat_turn_timing", ...extra, ...summary }))
  } catch {
    // Observabilidade nunca derruba a resposta.
  }
  return summary
}
