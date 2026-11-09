import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs"
import { dirname } from "node:path"

/**
 * TETO GARANTIDO DA VALIDAÇÃO, neutro de provedor: nada sai sem caber no saldo, e nenhuma configuração do modelo muda para caber.
 *
 * Antes de cada chamada, reserva o custo máximo possível: entrada limitada pelo tamanho do pedido, saída limitada pelo teto configurado no modelo e todas as tentativas que a aplicação pode fazer.
 * A reserva vai para o livro-caixa em arquivo ANTES do envio e sem nenhuma espera entre conferir e reservar, o que vale também para chamadas concorrentes. Um processo por livro-caixa, por trava de arquivo.
 *
 * - Sem preço confiável ou sem limite calculável, o orçamento nem é criado.
 * - Só o uso confirmado pela telemetria devolve a reserva. Tentativa sem uso confirmado (falha, queda, corte) fica cobrada pelo pior caso, e reserva sem fechamento, de um processo que morreu, também.
 * - Envio fora de uma chamada reservada, corpo sem tamanho calculável, pedido maior que o reservado ou tentativas além do limite: bloqueados antes de sair.
 * - Uso acima da reserva quer dizer que o limite não foi respeitado: tudo para, porque a garantia deixou de valer.
 *
 * Premissa: raciocínio cobrado à parte fica no máximo no mesmo teto de saída, por isso a reserva conta os dois.
 */
export type CallPrice = { inputPerMillion: number; cachedInputPerMillion: number | null; outputPerMillion: number; reasoningPerMillion: number | null; currency: string }
export type CallUsage = { inputTokens: number; cachedTokens: number; reasoningTokens: number; outputTokens: number }
export type CallLimits = { price: CallPrice | null; maxOutputTokens: number | null; maxAttemptsPerCall: number }
export type BudgetCaps = { maxAttempts: number; maxTokens: number; maxMoney: number }

export class BudgetExceeded extends Error {}
export class BudgetConfigurationError extends Error {}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"])
/** O corpo tem a mesma informação do texto, mais o envelope JSON e os escapes. Um token nunca ocupa menos de um byte. */
const BODY_EXPANSION = 1.25
const BODY_OVERHEAD_BYTES = 16_384

const validPrice = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) && value > 0

/** Por que um teste pago não pode rodar com estes limites. Vazio = pode ser calculado. */
export function budgetBlockers(limits: CallLimits): string[] {
  const blockers: string[] = []
  if (!limits.price) blockers.push("Sem preço na tabela da aplicação.")
  else {
    if (!validPrice(limits.price.inputPerMillion) || !validPrice(limits.price.outputPerMillion)) blockers.push("Preço de entrada ou de saída ausente ou zerado.")
    if (limits.price.cachedInputPerMillion !== null && !(limits.price.cachedInputPerMillion >= 0)) blockers.push("Preço de entrada em cache inválido.")
    if (limits.price.reasoningPerMillion !== null && !validPrice(limits.price.reasoningPerMillion)) blockers.push("Preço de raciocínio inválido.")
  }
  if (!limits.maxOutputTokens || !Number.isInteger(limits.maxOutputTokens) || limits.maxOutputTokens <= 0) blockers.push("Sem limite de saída configurado no modelo: o gasto de uma chamada não tem teto calculável.")
  if (!Number.isInteger(limits.maxAttemptsPerCall) || limits.maxAttemptsPerCall < 1) blockers.push("Número de tentativas por chamada não calculável.")
  return blockers
}

/** Custo de um uso real pela tabela. Raciocínio sem preço próprio é cobrado como saída; entrada em cache sem preço próprio, como entrada. */
export function moneyOf(usage: CallUsage, price: CallPrice): number {
  const perMillion = (tokens: number, value: number) => (tokens / 1_000_000) * value
  return perMillion(usage.inputTokens - usage.cachedTokens, price.inputPerMillion) + perMillion(usage.cachedTokens, price.cachedInputPerMillion ?? price.inputPerMillion) + perMillion(usage.outputTokens, price.outputPerMillion) + perMillion(usage.reasoningTokens, price.reasoningPerMillion ?? price.outputPerMillion)
}

/** O máximo que uma tentativa e uma chamada inteira podem custar, para um texto deste tamanho. */
export function worstCaseOf(textBytes: number, limits: { price: CallPrice; maxOutputTokens: number; maxAttemptsPerCall: number }) {
  const maxBodyBytes = Math.ceil(textBytes * BODY_EXPANSION) + BODY_OVERHEAD_BYTES
  const attemptUsage = { inputTokens: maxBodyBytes, cachedTokens: 0, outputTokens: limits.maxOutputTokens, reasoningTokens: limits.maxOutputTokens }
  const attempt = { money: moneyOf(attemptUsage, limits.price), tokens: maxBodyBytes + 2 * limits.maxOutputTokens }
  return { maxBodyBytes, attempt, call: { money: attempt.money * limits.maxAttemptsPerCall, tokens: attempt.tokens * limits.maxAttemptsPerCall, attempts: limits.maxAttemptsPerCall } }
}

type Hold = { money: number; tokens: number; attempts: number }
type LedgerEntry = { at: string; scenario: string; id: string } & (
  | ({ kind: "RESERVE" } & Hold)
  | { kind: "ATTEMPT"; status: number; ms: number }
  | { kind: "SETTLE"; attempts: number; chargedMoney: number; chargedTokens: number; usage: CallUsage | null; confirmedMoney: number; confirmedTokens: number }
)
type CallScope = { id: string; scenario: string; attempts: number; maxBodyBytes: number }

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Um processo por livro-caixa. Trava de processo morto é assumida: as reservas dele continuam cobradas. */
function acquireLock(lockPath: string): void {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = openSync(lockPath, "wx")
      writeSync(handle, String(process.pid))
      closeSync(handle)
      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      const owner = Number(readFileSync(lockPath, "utf8"))
      if (Number.isInteger(owner) && owner > 0 && processIsAlive(owner)) throw new BudgetConfigurationError(`Outro processo (${owner}) está usando este livro-caixa: duas execuções somadas poderiam passar do teto.`)
      rmSync(lockPath, { force: true })
    }
  }
  throw new BudgetConfigurationError("Não foi possível travar o livro-caixa.")
}

export function createCallBudget(options: { caps: BudgetCaps; limits: CallLimits; ledgerPath: string; fetchImpl?: typeof fetch; now?: () => Date }) {
  const blockers = budgetBlockers(options.limits)
  if (blockers.length > 0) throw new BudgetConfigurationError(`Teste pago não pode executar. ${blockers.join(" ")}`)
  const capsValid = Number.isInteger(options.caps.maxAttempts) && options.caps.maxAttempts > 0 && Number.isInteger(options.caps.maxTokens) && options.caps.maxTokens > 0 && Number.isFinite(options.caps.maxMoney) && options.caps.maxMoney > 0
  if (!capsValid) throw new BudgetConfigurationError("Tetos de tentativas, tokens e dinheiro precisam ser informados.")
  const limits = { price: options.limits.price!, maxOutputTokens: options.limits.maxOutputTokens!, maxAttemptsPerCall: options.limits.maxAttemptsPerCall }
  const realFetch = options.fetchImpl ?? globalThis.fetch
  const now = options.now ?? (() => new Date())
  mkdirSync(dirname(options.ledgerPath), { recursive: true })
  const lockPath = `${options.ledgerPath}.lock`
  acquireLock(lockPath)

  const open = new Map<string, Hold>()
  let attempts = 0
  let chargedMoney = 0
  let chargedTokens = 0
  let confirmedMoney = 0
  let confirmedTokens = 0
  const apply = (entry: LedgerEntry) => {
    if (entry.kind === "RESERVE") open.set(entry.id, { money: entry.money, tokens: entry.tokens, attempts: entry.attempts })
    if (entry.kind === "ATTEMPT") attempts += 1
    if (entry.kind === "SETTLE") {
      open.delete(entry.id)
      chargedMoney += entry.chargedMoney
      chargedTokens += entry.chargedTokens
      confirmedMoney += entry.confirmedMoney
      confirmedTokens += entry.confirmedTokens
    }
  }
  if (existsSync(options.ledgerPath)) {
    for (const line of readFileSync(options.ledgerPath, "utf8").split("\n").filter(Boolean)) apply(JSON.parse(line) as LedgerEntry)
  }
  const append = (entry: LedgerEntry) => {
    appendFileSync(options.ledgerPath, `${JSON.stringify(entry)}\n`)
    apply(entry)
  }

  const storage = new AsyncLocalStorage<CallScope>()
  let stopped: string | null = null
  const stop = (reason: string) => {
    stopped ??= reason
  }
  const refuse = (reason: string): never => {
    stop(reason)
    throw new BudgetExceeded(reason)
  }
  const sum = (field: "money" | "tokens" | "attempts") => [...open.values()].reduce((total, hold) => total + hold[field], 0)

  const guardedFetch: typeof fetch = async (input, init) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase()
    if (SAFE_METHODS.has(method)) return realFetch(input, init)
    if (stopped) refuse(stopped)
    const scope = storage.getStore()
    if (!scope) return refuse("Envio fora de uma chamada reservada.")
    if (typeof init?.body !== "string") return refuse("Corpo do pedido sem tamanho calculável.")
    const bodyBytes = Buffer.byteLength(init.body)
    if (bodyBytes > scope.maxBodyBytes) refuse(`Pedido de ${bodyBytes} bytes, acima dos ${scope.maxBodyBytes} reservados.`)
    if (scope.attempts + 1 > limits.maxAttemptsPerCall) refuse(`Mais de ${limits.maxAttemptsPerCall} tentativas em uma chamada.`)
    scope.attempts += 1
    const startedAt = Date.now()
    let status = 0
    try {
      const response = await realFetch(input, init)
      status = response.status
      return response
    } finally {
      append({ kind: "ATTEMPT", at: now().toISOString(), scenario: scope.scenario, id: scope.id, status, ms: Date.now() - startedAt })
    }
  }

  /** Reserva, executa e acerta. `usageOf` devolve o uso confirmado pela telemetria desta chamada, ou null. */
  async function runCall<T>(request: { scenario: string; textBytes: number }, fn: () => Promise<T>, usageOf: () => CallUsage | null): Promise<T> {
    if (stopped) refuse(stopped)
    const worst = worstCaseOf(request.textBytes, limits)
    // Sem `await` daqui até a reserva estar no livro-caixa: outra chamada concorrente já a enxerga.
    if (attempts + sum("attempts") + worst.call.attempts > options.caps.maxAttempts) refuse(`Teto de ${options.caps.maxAttempts} tentativas: ${attempts} feitas, ${sum("attempts")} reservadas e ${worst.call.attempts} desta chamada.`)
    if (chargedTokens + sum("tokens") + worst.call.tokens > options.caps.maxTokens) refuse(`Teto de ${options.caps.maxTokens} tokens: ${chargedTokens} cobrados, ${sum("tokens")} reservados e ${worst.call.tokens} desta chamada.`)
    if (chargedMoney + sum("money") + worst.call.money > options.caps.maxMoney) refuse(`Teto de ${options.caps.maxMoney} ${limits.price.currency}: ${chargedMoney.toFixed(4)} cobrados, ${sum("money").toFixed(4)} reservados e ${worst.call.money.toFixed(4)} desta chamada.`)
    const scope: CallScope = { id: randomUUID(), scenario: request.scenario, attempts: 0, maxBodyBytes: worst.maxBodyBytes }
    append({ kind: "RESERVE", at: now().toISOString(), scenario: scope.scenario, id: scope.id, money: worst.call.money, tokens: worst.call.tokens, attempts: worst.call.attempts })
    try {
      return await storage.run(scope, fn)
    } finally {
      const usage = usageOf()
      if (usage && scope.attempts === 0) stop("Uso registrado sem passar pelo orçamento: o envio escapou do controle.")
      const realMoney = usage ? moneyOf(usage, limits.price) : 0
      const realTokens = usage ? usage.inputTokens + usage.reasoningTokens + usage.outputTokens : 0
      if (realMoney > worst.attempt.money || realTokens > worst.attempt.tokens) stop(`Uso real acima da reserva: o limite configurado não foi respeitado (${realTokens} tokens × ${worst.attempt.tokens} reservados).`)
      const unconfirmed = Math.max(0, scope.attempts - (usage ? 1 : 0))
      append({
        kind: "SETTLE",
        at: now().toISOString(),
        scenario: scope.scenario,
        id: scope.id,
        attempts: scope.attempts,
        usage,
        confirmedMoney: realMoney,
        confirmedTokens: realTokens,
        chargedMoney: realMoney + unconfirmed * worst.attempt.money,
        chargedTokens: realTokens + unconfirmed * worst.attempt.tokens,
      })
    }
  }

  return {
    fetch: guardedFetch,
    runCall,
    stop,
    stopped: () => stopped,
    release: () => rmSync(lockPath, { force: true }),
    summary: () => ({
      attempts,
      confirmedTokens,
      confirmedMoney: Math.round(confirmedMoney * 10_000) / 10_000,
      chargedTokens,
      chargedMoney: Math.round(chargedMoney * 10_000) / 10_000,
      reservedMoney: Math.round(sum("money") * 10_000) / 10_000,
      currency: limits.price.currency,
      caps: options.caps,
    }),
  }
}
