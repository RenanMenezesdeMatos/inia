import { USAGE_CATALOG_VERSION, type UsageEntity } from "./usage-catalog"

/**
 * COLETOR de uso do navegador — fila em lotes (até 50 eventos ou 5 s), reenvio com backoff + jitter preservando os ids (o
 * servidor deduplica), fila limitada (500) e com validade (24 h), envio final best effort ao esconder/fechar a página
 * (`fetch keepalive` em text/plain — sem preflight). Nunca trava a interface: tudo é assíncrono e falha silenciosa.
 *
 * Isolamento por CONTA: sessão analítica e fila ficam em chaves do navegador com o id da conta; o lote declara a conta e o
 * servidor recusa (409) lote de outra conta — no logout/troca de conta a fila é enviada e descartada, nunca retransmitida
 * com a identidade nova. Nada aqui é fingerprint: o id da sessão é aleatório e fica só no navegador.
 */
export const SESSION_TIMEOUT_MS = 30 * 60_000
export const FLUSH_INTERVAL_MS = 5_000
export const MAX_BATCH = 50
const MAX_QUEUE = 500
const MAX_AGE_MS = 24 * 3_600_000
const MAX_BACKOFF_MS = 60_000
const ORPHAN_QUEUE_MS = 30_000
const SCHEMA_VERSION = 1

export type UsageEventInput = {
  name: string
  screenKey?: string | null
  screenInstanceId?: string | null
  routeTemplate?: string | null
  elementKey?: string | null
  entity?: UsageEntity | null
  correlationId?: string | null
  properties?: Record<string, unknown>
  occurredAt?: Date
}

type QueuedEvent = {
  eventId: string
  name: string
  schemaVersion: number
  occurredAt: string
  usageSessionId: string
  tabId: string
  screenInstanceId: string | null
  screenKey: string | null
  elementKey: string | null
  routeTemplate: string | null
  entity: UsageEntity | null
  correlationId: string | null
  properties: Record<string, unknown>
}

export type CollectorDeps = {
  apiUrl: string
  accountId: string
  appVersion: string | null
  device: "DESKTOP" | "MOBILE" | "TABLET"
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length"> | null
  tabStorage?: Pick<Storage, "getItem" | "setItem"> | null
  fetch?: typeof fetch
  now?: () => Date
  randomId?: () => string
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const safe = <T>(read: () => T, fallback: T): T => {
  try {
    return read()
  } catch {
    return fallback
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) => (Number(char) ^ (Math.random() * 16) >> (Number(char) / 4)).toString(16))
}

export class UsageCollector {
  private readonly deps: Required<Omit<CollectorDeps, "storage" | "tabStorage">> & Pick<CollectorDeps, "storage" | "tabStorage">
  private queue: QueuedEvent[] = []
  private timer: unknown = null
  private sending = false
  private failures = 0
  private disabled = false
  readonly tabId: string

  constructor(deps: CollectorDeps) {
    this.deps = {
      fetch: (...args) => fetch(...args),
      now: () => new Date(),
      randomId: newId,
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...deps,
    }
    this.tabId = this.resolveTabId()
    this.queue = this.loadQueue()
    if (this.queue.length > 0) this.schedule(FLUSH_INTERVAL_MS)
  }

  get accountId() {
    return this.deps.accountId
  }

  get isDisabled() {
    return this.disabled
  }

  /** Sessão analítica COMPARTILHADA entre as abas do navegador desta conta; nova após 30 min sem atividade. */
  sessionId(touch = false): string {
    const key = `inia.usage.session.${this.deps.accountId}`
    const now = this.deps.now().getTime()
    const stored = safe(() => JSON.parse(this.deps.storage?.getItem(key) ?? "null") as { id: string; lastActivity: number } | null, null)
    const valid = stored && now - stored.lastActivity <= SESSION_TIMEOUT_MS ? stored : null
    const session = valid ?? { id: this.deps.randomId(), lastActivity: now }
    if (touch || !valid) safe(() => this.deps.storage?.setItem(key, JSON.stringify({ id: session.id, lastActivity: touch ? now : session.lastActivity })), undefined)
    return session.id
  }

  /** Atividade humana qualificada: mantém a sessão analítica viva (a do servidor é recalculada pelos eventos). */
  touchActivity() {
    this.sessionId(true)
  }

  track(input: UsageEventInput, options: { qualifies?: boolean } = {}) {
    if (this.disabled) return
    const event: QueuedEvent = {
      eventId: this.deps.randomId(),
      name: input.name,
      schemaVersion: SCHEMA_VERSION,
      occurredAt: (input.occurredAt ?? this.deps.now()).toISOString(),
      usageSessionId: this.sessionId(options.qualifies ?? false),
      tabId: this.tabId,
      screenInstanceId: input.screenInstanceId ?? null,
      screenKey: input.screenKey ?? null,
      elementKey: input.elementKey ?? null,
      routeTemplate: input.routeTemplate ?? null,
      entity: input.entity ?? null,
      correlationId: input.correlationId ?? null,
      properties: input.properties ?? {},
    }
    this.queue.push(event)
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE)
    this.persist()
    if (this.queue.length >= MAX_BATCH) void this.flush()
    else this.schedule(FLUSH_INTERVAL_MS)
  }

  /** Envia até 100 eventos; sucesso remove, falha mantém (com backoff), 409 descarta (lote de outra conta). */
  async flush(): Promise<void> {
    if (this.sending || this.disabled || this.queue.length === 0) return
    this.sending = true
    const batch = this.queue.slice(0, 100)
    try {
      const response = await this.deps.fetch(`${this.deps.apiUrl}/api/v1/usage/events/batch`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(this.body(batch)),
      })
      if (response.status === 202) {
        this.remove(batch)
        this.failures = 0
        const payload = (await response.json().catch(() => null)) as { data?: { collectionEnabled?: boolean } } | null
        if (payload?.data?.collectionEnabled === false) this.disable()
      } else if (response.status === 409 || response.status === 400) {
        // Lote de outra conta (troca de identidade) ou inválido: nunca reenviar.
        this.remove(batch)
      } else if (response.status === 401 || response.status === 404) {
        // Sem sessão ou coleta desligada no servidor: para de coletar nesta página.
        this.disable()
      } else {
        this.failures += 1
      }
    } catch {
      this.failures += 1
    } finally {
      this.sending = false
    }
    if (this.queue.length > 0 && !this.disabled) {
      const backoff = this.failures === 0 ? 0 : Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** this.failures) * (0.5 + Math.random() / 2)
      this.schedule(Math.max(backoff, this.queue.length >= MAX_BATCH ? 0 : FLUSH_INTERVAL_MS))
    }
  }

  /** Envio final best effort (página escondida/fechando) — sem preflight; a fila fica guardada até o servidor confirmar. */
  flushOnHide() {
    if (this.disabled || this.queue.length === 0) return
    const body = JSON.stringify(this.body(this.queue.slice(0, 100)))
    if (body.length > 60_000) return
    try {
      void this.deps.fetch(`${this.deps.apiUrl}/api/v1/usage/events/batch`, { method: "POST", credentials: "include", keepalive: true, headers: { "content-type": "text/plain" }, body }).catch(() => undefined)
    } catch {
      // melhor esforço: o próximo carregamento reenvia (o servidor deduplica pelo id)
    }
  }

  /** Logout/troca de conta: envia o que há (best effort, curto) e apaga fila e sessão desta conta do navegador. */
  async shutdownForLogout(timeoutMs = 1_500) {
    await Promise.race([this.flush(), new Promise((resolve) => setTimeout(resolve, timeoutMs))])
    this.disable()
    safe(() => this.deps.storage?.removeItem(`inia.usage.session.${this.deps.accountId}`), undefined)
  }

  disable() {
    this.disabled = true
    this.queue = []
    if (this.timer) this.deps.clearTimer(this.timer)
    this.timer = null
    safe(() => this.deps.storage?.removeItem(this.queueKey()), undefined)
  }

  dispose() {
    if (this.timer) this.deps.clearTimer(this.timer)
    this.timer = null
  }

  pending() {
    return this.queue.length
  }

  private body(events: QueuedEvent[]) {
    return { accountId: this.deps.accountId, sentAt: this.deps.now().toISOString(), appVersion: this.deps.appVersion, device: this.deps.device, catalog: undefined, events }
  }

  private schedule(ms: number) {
    if (this.timer) return
    this.timer = this.deps.setTimer(() => {
      this.timer = null
      void this.flush()
    }, ms)
  }

  private remove(batch: QueuedEvent[]) {
    const sent = new Set(batch.map((event) => event.eventId))
    this.queue = this.queue.filter((event) => !sent.has(event.eventId))
    this.persist()
  }

  private queueKey() {
    return `inia.usage.queue.${this.deps.accountId}.${this.tabId}`
  }

  private persist() {
    safe(() => this.deps.storage?.setItem(this.queueKey(), JSON.stringify({ savedAt: this.deps.now().getTime(), catalog: USAGE_CATALOG_VERSION, events: this.queue })), undefined)
  }

  /** Fila própria + filas órfãs da MESMA conta (abas fechadas); eventos de mais de 24 h expiram; outra conta nunca é lida. */
  private loadQueue(): QueuedEvent[] {
    const storage = this.deps.storage
    if (!storage) return []
    const now = this.deps.now().getTime()
    const prefix = `inia.usage.queue.${this.deps.accountId}.`
    const adopted: QueuedEvent[] = []
    const keys = safe(() => Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith(prefix))), [])
    for (const key of keys) {
      const stored = safe(() => JSON.parse(storage.getItem(key) ?? "null") as { savedAt: number; events: QueuedEvent[] } | null, null)
      if (!stored) continue
      const own = key === this.queueKey()
      if (!own && now - stored.savedAt < ORPHAN_QUEUE_MS) continue
      adopted.push(...stored.events.filter((event) => now - Date.parse(event.occurredAt) < MAX_AGE_MS))
      if (!own) safe(() => storage.removeItem(key), undefined)
    }
    return adopted.slice(-MAX_QUEUE)
  }

  private resolveTabId(): string {
    const stored = safe(() => this.deps.tabStorage?.getItem("inia.usage.tab") ?? null, null)
    if (stored) return stored
    const id = this.deps.randomId()
    safe(() => this.deps.tabStorage?.setItem("inia.usage.tab", id), undefined)
    return id
  }
}

/** Tipo de tela pela largura e pelo ponteiro (nunca fingerprint). */
export function detectDevice(): "DESKTOP" | "MOBILE" | "TABLET" {
  if (typeof window === "undefined") return "DESKTOP"
  const width = window.innerWidth
  const coarse = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches
  if (width < 768) return "MOBILE"
  if (coarse && width < 1100) return "TABLET"
  return "DESKTOP"
}
