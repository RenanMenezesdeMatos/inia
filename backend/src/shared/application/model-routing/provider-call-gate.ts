import { AsyncLocalStorage } from "node:async_hooks"
import { currentAiCallLimiterRecord, retrySignalOf, type AiCallPriority, type AiRetrySignal } from "./ai-call-limiter.js"
import { currentAiAbortSignal } from "./ai-runtime.js"

/**
 * PORTÃO POR CONEXÃO DE IA — o que vale para TODAS as instâncias (N APIs + M workers) no ponto em que a chamada sai para um
 * ACESSO concreto ao provedor. Quem tem cota é o acesso (a conexão de Administração › IA › Provedores, com a própria chave),
 * não cada processo; nada aqui conhece provedor específico.
 *
 *  - VAGAS: `maxConcurrent` = chamadas simultâneas da conexão somando todas as instâncias (configurado na conexão; null = sem
 *    teto próprio). Interativa (chat, voz, telas) tem uma reserva que o lote nunca ocupa; interativa espera no máximo
 *    `interactiveWaitMs` e falha com AI_CAPACITY_BUSY; lote espera o quanto precisar (ou até ser cancelado).
 *  - PAUSA: um 429/503 de uma conexão (em qualquer instância) pausa o início de LOTES naquela conexão, pelo Retry-After ou um
 *    padrão curto. A interativa nunca é pausada — a pausa existe para sobrar cota a quem está na tela. O CHAT TEM PRIORIDADE
 *    (decisão do usuário, 21/10): o 429 de uma chamada interativa pausa os lotes por mais tempo (`INTERACTIVE_RATE_LIMIT_PAUSE_MS`),
 *    enquanto ela tenta de novo. O runtime da policy pula para o próximo modelo da cadeia quando a conexão dele está em pausa.
 *
 *  - VAZÃO DO LOTE (21/10): o lote de cada processo tem um teto de tokens de entrada por minuto na conexão, com partida lenta; cada
 *    429/503 dela — visto aqui ou publicado por outra instância — corta o teto para metade do que o lote usou no último minuto (um
 *    quarto, e parado por um minuto, quando quem levou foi o chat); sem novos sinais, sobe aos poucos até sumir
 *    (`adaptive-batch-window.ts`). Pausar e voltar todos de uma vez levava a conexão ao limite de novo, com o chat junto.
 *
 * O limitador de cada processo (ai-call-limiter.ts) continua por fora: fila, prioridade e vagas locais. Sem portão registrado
 * (testes, scripts), a chamada sai direto, como antes.
 */
export type ProviderGateCall = {
  /** `connection:<id>` (conexão cadastrada) ou `legacy:<provedor>` (rota do ambiente). */
  key: string
  /** Vagas da conexão em todas as instâncias; null = sem teto compartilhado (só a pausa vale). */
  maxConcurrent: number | null
  priority: AiCallPriority
  signal?: AbortSignal | undefined
  /** Tokens de entrada estimados da chamada (a mesma estimativa do gateway) — o que a vazão adaptativa do lote conta. */
  estimatedTokens?: number | null | undefined
}

export type ProviderGateStats = {
  /** Vagas que ESTE processo segura agora, por chave. */
  held: Record<string, number>
  /** Chamadas deste processo esperando vaga ou fim de pausa, por chave. */
  waiting: Record<string, number>
  /** Pausas em vigor (de qualquer instância), por chave — fim em ISO. */
  cooldowns: Record<string, string>
  /** Vazão adaptativa do lote deste processo, por chave: teto em tokens/min (null = sem teto), uso no último minuto e quem espera. */
  batchWindows?: Record<string, { tokensPerMinute: number | null; usedLastMinute: number; waiting: number }>
}

export interface ProviderCallGate {
  run<T>(call: ProviderGateCall, fn: () => Promise<T>): Promise<T>
  /** Quanto falta da pausa da chave (ms; 0 = sem pausa). */
  cooldownRemainingMs(key: string): number
  stats(): ProviderGateStats
}

export const connectionGateKey = (connectionId: string) => `connection:${connectionId}`
export const legacyGateKey = (providerKey: string) => `legacy:${providerKey}`

/** Vagas que o lote pode ocupar: um quarto do teto fica para a interativa (pelo menos 1 quando o teto é 2 ou mais). */
export function batchShareOf(maxConcurrent: number): number {
  const reserved = maxConcurrent >= 4 ? Math.ceil(maxConcurrent / 4) : maxConcurrent >= 2 ? 1 : 0
  return maxConcurrent - reserved
}

/** Pausa dos lotes quando quem levou o 429 foi uma chamada INTERATIVA: cota do minuto para o chat, enquanto ele tenta de novo. */
export const INTERACTIVE_RATE_LIMIT_PAUSE_MS = 15_000

/**
 * Pausa pedida por um erro do provedor: 429 = Retry-After ou 5 s (de uma chamada INTERATIVA, pelo menos 15 s); 503 = Retry-After
 * ou 2 s; sempre ≤ 60 s. Outro erro = 0.
 */
export function cooldownMsOf(signal: AiRetrySignal | null, priority: AiCallPriority = "BATCH"): number {
  if (!signal) return 0
  const fallback = signal.kind === "RATE_LIMIT" ? 5_000 : 2_000
  const requested = Math.max(0, signal.retryAfterMs ?? fallback)
  const pause = signal.kind === "RATE_LIMIT" && priority === "INTERACTIVE" ? Math.max(requested, INTERACTIVE_RATE_LIMIT_PAUSE_MS) : requested
  return Math.min(60_000, pause)
}

/** Sinal de pausa de um erro qualquer (a mesma leitura do limitador: 429 sempre; 503 também). */
export const gateSignalOf = (error: unknown) => retrySignalOf(error)

let processGate: ProviderCallGate | null = null

export function providerCallGate(): ProviderCallGate | null {
  return processGate
}

/** server.ts (e a prova de dois processos) registram o portão do PostgreSQL; null = sem portão. */
export function setProviderCallGate(next: ProviderCallGate | null): void {
  processGate = next
}

/**
 * Passa `fn` pelo portão da chave, se houver um registrado. Classe e cancelamento vêm do contexto da chamada (o limitador do
 * processo já classificou; o SSE do chat já ligou o cancelamento).
 */
export function runThroughProviderGate<T>(key: string, maxConcurrent: number | null, fn: () => Promise<T>): Promise<T> {
  const gate = processGate
  if (!gate) return fn()
  return gate.run({ key, maxConcurrent, priority: currentAiCallLimiterRecord()?.priority ?? "BATCH", signal: currentAiAbortSignal() ?? undefined, estimatedTokens: callTokens.getStore() ?? null }, fn)
}

const callTokens = new AsyncLocalStorage<number>()

/** Tokens de entrada estimados das chamadas feitas dentro de `fn` (o gateway marca cada chamada; o portão lê). */
export function runWithEstimatedTokens<T>(tokens: number, fn: () => T): T {
  return callTokens.run(tokens, fn)
}
