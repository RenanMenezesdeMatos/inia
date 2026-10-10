/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest"

import { resolveRoute } from "./usage-catalog"
import { SESSION_TIMEOUT_MS, UsageCollector, type CollectorDeps } from "./usage-collector"
import { REMOUNT_WINDOW_MS, ScreensRuntime } from "./usage-screens-runtime"
import { HEARTBEAT_MS, UsageTracker } from "./usage-tracker"

/** Armazenamento em memória com a mesma interface do localStorage (o jsdom compartilharia entre testes). */
function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  }
}

type Sent = { url: string; body: { accountId: string; events: { eventId: string; name: string; usageSessionId: string; properties: Record<string, unknown> }[] } }

function collector(overrides: Partial<CollectorDeps> = {}) {
  let now = new Date("2026-10-06T12:00:00Z").getTime()
  let ids = 0
  const sent: Sent[] = []
  const statuses: number[] = []
  const storage = memoryStorage()
  const tabStorage = memoryStorage()
  const timers: (() => void)[] = []
  const deps: CollectorDeps = {
    apiUrl: "http://api",
    accountId: "account-a",
    appVersion: "test",
    device: "DESKTOP",
    storage,
    tabStorage,
    now: () => new Date(now),
    randomId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`,
    setTimer: (callback) => timers.push(callback),
    clearTimer: () => undefined,
    fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      const status = statuses.shift() ?? 202
      return new Response(JSON.stringify({ data: { collectionEnabled: true } }), { status })
    }) as unknown as typeof fetch,
    ...overrides,
  }
  return { instance: new UsageCollector(deps), deps, sent, statuses, storage, tabStorage, advance: (ms: number) => (now += ms) }
}

describe("coletor de uso", () => {
  it("sessão analítica: a mesma enquanto houver atividade; nova depois de 30 min parado", () => {
    const { instance, advance } = collector()
    const first = instance.sessionId(true)
    advance(10 * 60_000)
    expect(instance.sessionId(true)).toBe(first)
    advance(SESSION_TIMEOUT_MS + 1_000)
    expect(instance.sessionId(true)).not.toBe(first)
  })

  it("abas do mesmo navegador compartilham a sessão; outra conta nunca a reaproveita", () => {
    const a = collector()
    const sessionA = a.instance.sessionId(true)
    const otherTab = new UsageCollector({ ...a.deps, tabStorage: memoryStorage() })
    expect(otherTab.sessionId(true)).toBe(sessionA)
    const otherAccount = new UsageCollector({ ...a.deps, accountId: "account-b", tabStorage: memoryStorage() })
    expect(otherAccount.sessionId(true)).not.toBe(sessionA)
  })

  it("falha de rede mantém a fila e reenvia com os MESMOS ids (o servidor deduplica)", async () => {
    const attempted: string[] = []
    const failing = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      attempted.push(JSON.parse(String(init?.body)).events[0].eventId)
      throw new Error("offline")
    }) as unknown as typeof fetch
    const { instance, deps, sent } = collector({ fetch: failing })
    instance.track({ name: "screen.viewed", properties: {} })
    await instance.flush()
    expect(instance.pending()).toBe(1)
    const okFetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: "", body: JSON.parse(String(init?.body)) })
      return new Response("{}", { status: 202 })
    }) as unknown as typeof fetch
    const retry = new UsageCollector({ ...deps, fetch: okFetch })
    await retry.flush()
    expect(sent).toHaveLength(1)
    expect(attempted).toHaveLength(1)
    expect(sent[0]!.body.events[0]!.eventId).toBe(attempted[0])
    expect(retry.pending()).toBe(0)
  })

  it("lote recusado como de outra conta (409) é descartado, nunca reenviado", async () => {
    const { instance, statuses, sent } = collector()
    statuses.push(409)
    instance.track({ name: "screen.viewed" })
    await instance.flush()
    expect(sent).toHaveLength(1)
    expect(instance.pending()).toBe(0)
  })

  it("logout envia o que há e apaga fila e sessão desta conta", async () => {
    const { instance, storage } = collector()
    instance.track({ name: "screen.viewed" })
    await instance.shutdownForLogout(10)
    expect([...storage.map.keys()].some((key) => key.startsWith("inia.usage.session.account-a"))).toBe(false)
    expect([...storage.map.keys()].some((key) => key.startsWith("inia.usage.queue.account-a"))).toBe(false)
    instance.track({ name: "screen.viewed" })
    expect(instance.pending()).toBe(0)
  })

  it("coleta desligada no servidor (404) para de coletar sem quebrar o fluxo", async () => {
    const { instance, statuses } = collector()
    statuses.push(404)
    instance.track({ name: "screen.viewed" })
    await instance.flush()
    expect(instance.isDisabled).toBe(true)
    expect(() => instance.track({ name: "screen.viewed" })).not.toThrow()
  })
})

describe("rotas → telas do catálogo", () => {
  it("normaliza a URL: aba da URL vira tela própria e o id vira entidade (nunca parte da chave)", () => {
    const resolved = resolveRoute("/supervisor/operators/de00ae6a-c8c9-490a-816b-e3cc8cf18986", new URLSearchParams("tab=indicators&foo=1"))
    expect(resolved).toMatchObject({ screenKey: "employee_profile.indicators", routeTemplate: "/supervisor/operators/:operatorId", entity: { type: "PERSON", id: "de00ae6a-c8c9-490a-816b-e3cc8cf18986" } })
    expect(resolveRoute("/operator", new URLSearchParams())?.screenKey).toBe("my_profile.operator.followup")
    expect(resolveRoute("/admin/usability", null)?.screenKey).toBe("admin.usability")
  })
})

describe("telas apresentadas", () => {
  afterEach(() => vi.useRealTimers())

  it("remontagem do Strict Mode (sai e volta em < 1,5 s) não cria segunda visualização; voltar depois de outra tela cria", () => {
    vi.useFakeTimers()
    const tracked: { name: string; screenKey?: string | null }[] = []
    const fake = { track: (event: { name: string; screenKey?: string | null }) => tracked.push(event) } as unknown as UsageCollector
    let now = 0
    const runtime = new ScreensRuntime(fake, document, () => now)
    runtime.routeChanged("/operator", new URLSearchParams())
    now += 50
    runtime.routeChanged("/supervisor", new URLSearchParams())
    now += 50
    runtime.routeChanged("/operator", new URLSearchParams())
    const views = () => tracked.filter((event) => event.name === "screen.viewed").map((event) => event.screenKey)
    expect(views()).toEqual(["my_profile.operator.followup", "my_profile.manager.followup"])
    now += REMOUNT_WINDOW_MS + 100
    runtime.routeChanged("/supervisor", new URLSearchParams())
    runtime.routeChanged("/operator", new URLSearchParams())
    expect(views().filter((key) => key === "my_profile.operator.followup")).toHaveLength(2)
  })

  it("painel declarado que desmonta e remonta logo em seguida conta uma vez", () => {
    vi.useFakeTimers()
    const tracked: { name: string; screenKey?: string | null }[] = []
    const fake = { track: (event: { name: string; screenKey?: string | null }) => tracked.push(event) } as unknown as UsageCollector
    const runtime = new ScreensRuntime(fake, document, () => 0)
    runtime.routeChanged("/operator", new URLSearchParams())
    const first = document.createElement("div")
    first.setAttribute("data-usage-screen", "notifications.panel")
    runtime.overlayAdded(first)
    runtime.overlayRemoved(first)
    const second = document.createElement("div")
    second.setAttribute("data-usage-screen", "notifications.panel")
    runtime.overlayAdded(second)
    vi.advanceTimersByTime(REMOUNT_WINDOW_MS + 10)
    expect(tracked.filter((event) => event.name === "screen.viewed" && event.screenKey === "notifications.panel")).toHaveLength(1)
    expect(tracked.filter((event) => event.name === "screen.left")).toHaveLength(0)
  })
})

describe("tempo ativo (heartbeat)", () => {
  afterEach(() => vi.useRealTimers())

  it("com interação recente, o heartbeat atesta o intervalo; parado por mais de 60 s, não conta", () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") })
    const tracked: { name: string; properties?: Record<string, unknown> }[] = []
    const fake = { track: (event: { name: string; properties?: Record<string, unknown> }) => tracked.push(event), touchActivity: () => undefined, flushOnHide: () => undefined, dispose: () => undefined } as unknown as UsageCollector
    const tracker = new UsageTracker(fake, document, () => Date.now())
    tracker.start()
    tracker.routeChanged("/operator", new URLSearchParams())
    document.dispatchEvent(new Event("pointerdown"))
    vi.advanceTimersByTime(HEARTBEAT_MS)
    const beats = () => tracked.filter((event) => event.name === "activity.heartbeat")
    expect(beats()).toHaveLength(1)
    vi.advanceTimersByTime(90_000)
    const afterIdle = beats().length
    vi.advanceTimersByTime(HEARTBEAT_MS * 2)
    expect(beats().length).toBe(afterIdle)
    tracker.stop()
  })

  it("aba em segundo plano não acumula tempo, mesmo com interação recente", () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") })
    const tracked: { name: string }[] = []
    const fake = { track: (event: { name: string }) => tracked.push(event), touchActivity: () => undefined, flushOnHide: () => undefined, dispose: () => undefined } as unknown as UsageCollector
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible")
    const tracker = new UsageTracker(fake, document, () => Date.now())
    tracker.start()
    tracker.routeChanged("/operator", new URLSearchParams())
    document.dispatchEvent(new Event("pointerdown"))
    visibility.mockReturnValue("hidden")
    document.dispatchEvent(new Event("visibilitychange"))
    vi.advanceTimersByTime(HEARTBEAT_MS * 4)
    expect(tracked.filter((event) => event.name === "activity.heartbeat")).toHaveLength(0)
    tracker.stop()
    visibility.mockRestore()
  })
})
