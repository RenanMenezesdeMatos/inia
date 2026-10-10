import { isContentKey, isElementKey, resolveRoute, type UsageEntity } from "./usage-catalog"
import { newId, type UsageCollector } from "./usage-collector"
import { entityOf, ScreensRuntime } from "./usage-screens-runtime"

/**
 * RASTREADOR de uso — tela, atenção (tempo ativo), acionamentos, exposição e rolagem, a partir de metadados DECLARATIVOS nos
 * componentes (`data-usage-element`, `data-usage-expose`, `data-usage-scroll`, `data-usage-screen`, `data-usage-ignore`).
 * Nunca lê texto da tela, HTML, conteúdo de campos, teclas digitadas nem query string livre. Não liga microfone, não mexe no
 * avatar, não abre conversa nem dispara workflow — só observa.
 *
 * Tempo ativo: um heartbeat a cada ≤ 15 s confirma o intervalo em primeiro plano enquanto houve interação nos últimos 60 s (ou
 * voz/áudio comprovadamente em andamento). O heartbeat atesta a interação; ele mesmo nunca renova a atividade.
 */
export const HEARTBEAT_MS = 15_000
export const ATTENTION_IDLE_MS = 60_000
export const EXPOSURE_MS = 1_000
const SCROLL_MILESTONES = [25, 50, 75, 100] as const

export type ActionHandle = { correlationId: string; succeed: (durationMs?: number) => void; fail: (errorCode?: string | null) => void; cancel: () => void }

export class UsageTracker {
  readonly screens: ScreensRuntime
  private readonly cleanups: (() => void)[] = []
  private lastInteraction = 0
  private attentionStart = 0
  private lastBeatEnd = 0
  private mediaActive = 0
  private lastTouch = 0
  private readonly exposed = new Set<string>()
  private readonly scrolled = new Set<string>()
  private readonly exposureTimers = new Map<Element, ReturnType<typeof setTimeout>>()
  private observer: IntersectionObserver | null = null

  constructor(readonly collector: UsageCollector, private readonly doc: Document = document, private readonly now: () => number = () => Date.now()) {
    this.screens = new ScreensRuntime(collector, doc, now)
  }

  start() {
    const win = this.doc.defaultView
    if (!win) return
    const start = this.now()
    this.lastInteraction = start
    this.attentionStart = start
    this.lastBeatEnd = start
    const interaction = () => this.interacted()
    for (const type of ["pointerdown", "keydown", "wheel", "touchstart"] as const) this.listen(this.doc, type, interaction)
    this.listen(this.doc, "scroll", () => {
      interaction()
      this.checkScroll()
    }, true)
    this.listen(this.doc, "click", (event) => this.clicked(event as MouseEvent), true)
    this.listen(this.doc, "visibilitychange", () => {
      if (this.doc.visibilityState === "hidden") {
        this.beat()
        this.screens.pageHidden("HIDDEN")
        this.collector.flushOnHide()
      } else {
        const now = this.now()
        this.attentionStart = now
        this.lastBeatEnd = now
        this.lastInteraction = now
        this.screens.becameVisible()
      }
    })
    this.listen(win, "pagehide", () => {
      this.beat()
      this.screens.pageHidden("PAGEHIDE")
      this.collector.flushOnHide()
    })
    const interval = win.setInterval(() => this.beat(), HEARTBEAT_MS)
    this.cleanups.push(() => win.clearInterval(interval))
    this.watchDom()
  }

  stop() {
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    for (const timer of this.exposureTimers.values()) clearTimeout(timer)
    this.observer?.disconnect()
    this.collector.dispose()
  }

  routeChanged(pathname: string, search: URLSearchParams | null) {
    this.screens.routeChanged(pathname, search)
    this.checkScroll()
  }

  /** Voz/áudio em andamento conta como atenção (contador: várias fontes podem estar ativas). */
  setMediaActive(active: boolean) {
    this.mediaActive = Math.max(0, this.mediaActive + (active ? 1 : -1))
    if (active) this.interacted()
  }

  /** Evento livre do catálogo (voz, latência…), atribuído à tela em primeiro plano quando pedido. */
  track(name: string, properties: Record<string, unknown> = {}, options: { entity?: UsageEntity | null; correlationId?: string | null; withScreen?: boolean; qualifies?: boolean } = {}) {
    const screen = options.withScreen ? this.screens.foreground() : null
    this.collector.track({ name, properties, entity: options.entity ?? null, correlationId: options.correlationId ?? null, screenKey: screen?.screenKey ?? null, screenInstanceId: screen?.instanceId ?? null, routeTemplate: screen?.routeTemplate ?? null }, { qualifies: options.qualifies ?? false })
  }

  /** Ação com contrato: iniciada → concluída | falhou | cancelada (um desfecho por correlação). */
  action(actionKey: string, correlationId: string = newId()): ActionHandle {
    const screen = this.screens.foreground()
    const startedAt = this.now()
    let settled = false
    const emit = (name: string, properties: Record<string, unknown>, qualifies = false) => this.collector.track({ name, properties: { actionKey, ...properties }, correlationId, screenKey: screen?.screenKey ?? null, screenInstanceId: screen?.instanceId ?? null, routeTemplate: screen?.routeTemplate ?? null }, { qualifies })
    if (screen) emit("action.started", {}, true)
    const settle = (name: string, properties: Record<string, unknown>) => {
      if (settled || !screen) return
      settled = true
      emit(name, properties, name === "action.cancelled")
    }
    return {
      correlationId,
      succeed: (durationMs) => settle("action.succeeded", { durationMs: durationMs ?? this.now() - startedAt }),
      fail: (errorCode) => settle("action.failed", { errorCode: normalizeErrorCode(errorCode), durationMs: this.now() - startedAt }),
      cancel: () => settle("action.cancelled", {}),
    }
  }

  /** Busca: só a FAIXA do tamanho da consulta e do resultado — nunca a consulta. */
  search(surface: string, queryLength: number, resultCount: number | null) {
    if (queryLength <= 0) return
    const queryBucket = queryLength <= 2 ? "1-2" : queryLength <= 5 ? "3-5" : queryLength <= 10 ? "6-10" : "11+"
    const resultBucket = resultCount === null ? null : resultCount === 0 ? "0" : resultCount <= 5 ? "1-5" : resultCount <= 20 ? "6-20" : "21+"
    this.track("search.performed", { surface, queryLength: queryBucket, resultCount: resultBucket, empty: resultCount === null ? null : resultCount === 0 }, { withScreen: true, qualifies: true })
  }

  filterApplied(surface: string, filterKey: string) {
    this.track("filter.applied", { surface, filterKey }, { withScreen: true, qualifies: true })
  }

  /** Logout/troca de conta: fecha a tela e descarta fila e sessão desta conta. */
  async logout() {
    this.screens.pageHidden("LOGOUT")
    this.stop()
    await this.collector.shutdownForLogout()
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, capture = false) {
    target.addEventListener(type, handler, { capture, passive: true })
    this.cleanups.push(() => target.removeEventListener(type, handler, { capture }))
  }

  private interacted() {
    const now = this.now()
    if (now - this.lastInteraction > ATTENTION_IDLE_MS && this.mediaActive === 0) {
      this.attentionStart = now
      this.lastBeatEnd = now
    }
    this.lastInteraction = now
    if (now - this.lastTouch > 10_000) {
      this.lastTouch = now
      this.collector.touchActivity()
    }
  }

  /** Confirma o intervalo de atenção desde o último heartbeat (≤ 15 s), só em primeiro plano e com interação/voz recente. */
  beat() {
    const now = this.now()
    const screen = this.screens.foreground()
    const recent = now - this.lastInteraction <= ATTENTION_IDLE_MS
    if (!screen || this.doc.visibilityState !== "visible" || (!recent && this.mediaActive === 0)) {
      this.lastBeatEnd = now
      return
    }
    const start = Math.max(this.lastBeatEnd, this.attentionStart, now - HEARTBEAT_MS)
    this.lastBeatEnd = now
    if (now - start < 1_000) return
    const reason = this.mediaActive > 0 && !recent ? "MEDIA" : this.lastInteraction === this.attentionStart && now - this.lastInteraction < HEARTBEAT_MS ? "INITIAL_NAVIGATION" : "INTERACTION"
    this.collector.track({ name: "activity.heartbeat", screenKey: screen.screenKey, screenInstanceId: screen.instanceId, routeTemplate: screen.routeTemplate, properties: { spanStart: new Date(start).toISOString(), spanEnd: new Date(now).toISOString(), reason, lastInteractionAt: recent ? new Date(this.lastInteraction).toISOString() : null } })
  }

  private clicked(event: MouseEvent) {
    const target = event.target instanceof Element ? event.target : null
    if (!target || target.closest("[data-usage-ignore]")) return
    const declared = target.closest("[data-usage-element]")
    let elementKey: string | null = declared?.getAttribute("data-usage-element") ?? null
    const properties: Record<string, unknown> = { interaction: event.detail === 0 ? "KEYBOARD" : (event as PointerEvent).pointerType === "touch" ? "TAP" : "CLICK" }
    let anchor: Element | null = declared
    if (!elementKey) {
      const tab = target.closest('[role="tab"]')
      const link = target.closest("a[href]") as HTMLAnchorElement | null
      if (tab) {
        const value = tab.getAttribute("data-usage-tab") ?? /-trigger-([a-z0-9_-]+)$/i.exec(tab.id)?.[1] ?? null
        elementKey = "nav.tab"
        anchor = tab
        if (value && /^[a-z][a-z0-9_-]{0,39}$/.test(value)) properties.tabValue = value
      } else if (link && link.origin === this.doc.defaultView?.location.origin) {
        const resolved = resolveRoute(link.pathname, new URLSearchParams(link.search))
        elementKey = "nav.link"
        anchor = link
        properties.targetScreenKey = resolved?.screenKey ?? null
      }
    }
    if (!elementKey || !isElementKey(elementKey)) return
    const screen = this.screens.screenFor(anchor)
    if (!screen) return
    this.interacted()
    this.collector.track({ name: "element.activated", screenKey: screen.screenKey, screenInstanceId: screen.instanceId, routeTemplate: screen.routeTemplate, elementKey, entity: entityOf(anchor), correlationId: anchor?.getAttribute("data-usage-correlation") ?? null, properties }, { qualifies: true })
  }

  private watchDom() {
    const win = this.doc.defaultView
    if (!win) return
    if (typeof win.IntersectionObserver === "function") {
      this.observer = new win.IntersectionObserver((entries) => this.exposure(entries), { threshold: [0, 0.5, 1] })
    }
    const scan = (root: ParentNode) => {
      if (root instanceof Element) this.register(root)
      root.querySelectorAll?.("[data-usage-screen], [data-usage-expose], [role='tab'][data-state='active']").forEach((element) => this.register(element))
    }
    scan(this.doc.body)
    const mutations = new win.MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target instanceof Element) {
          if (record.attributeName === "data-usage-screen") {
            // Painel que existe montado mas escondido (ex.: chat recolhido) declara a tela só quando visível.
            if (record.target.hasAttribute("data-usage-screen")) this.screens.overlayAdded(record.target)
            else this.screens.overlayRemoved(record.target)
            continue
          }
          if (record.target.getAttribute("role") === "tab" && record.target.getAttribute("data-state") === "active") this.tabActivated(record.target)
          continue
        }
        record.addedNodes.forEach((node) => node instanceof Element && scan(node))
        record.removedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          const removed = [node, ...Array.from(node.querySelectorAll("[data-usage-screen], [data-usage-expose]"))]
          for (const element of removed) {
            if (element.hasAttribute("data-usage-screen")) this.screens.overlayRemoved(element)
            if (element.hasAttribute("data-usage-expose")) {
              this.observer?.unobserve(element)
              const timer = this.exposureTimers.get(element)
              if (timer) clearTimeout(timer)
              this.exposureTimers.delete(element)
            }
          }
        })
      }
      this.checkScroll()
    })
    mutations.observe(this.doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-state", "data-usage-screen"] })
    this.cleanups.push(() => mutations.disconnect())
  }

  private register(element: Element) {
    if (element.hasAttribute("data-usage-screen")) this.screens.overlayAdded(element)
    if (element.hasAttribute("data-usage-expose")) this.observer?.observe(element)
    if (element.getAttribute("role") === "tab" && element.getAttribute("data-state") === "active") this.tabActivated(element)
  }

  private tabActivated(element: Element) {
    const value = element.getAttribute("data-usage-tab") ?? /-trigger-([a-z0-9_-]+)$/i.exec(element.id)?.[1]
    if (value) this.screens.tabActivated(value)
  }

  /** ≥ 50 % visível por 1 s contínuo em primeiro plano → uma exposição por (tela, elemento, entidade). */
  private exposure(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const element = entry.target
      const existing = this.exposureTimers.get(element)
      if (entry.intersectionRatio >= 0.5) {
        if (existing) continue
        this.exposureTimers.set(element, setTimeout(() => {
          this.exposureTimers.delete(element)
          if (this.doc.visibilityState !== "visible" || !element.isConnected) return
          const elementKey = element.getAttribute("data-usage-expose")
          const screen = this.screens.screenFor(element)
          if (!elementKey || !isElementKey(elementKey) || !screen) return
          const entity = entityOf(element)
          const key = `${screen.instanceId}|${elementKey}|${entity?.id ?? ""}`
          if (this.exposed.has(key)) return
          this.exposed.add(key)
          this.collector.track({ name: "element.exposed", screenKey: screen.screenKey, screenInstanceId: screen.instanceId, routeTemplate: screen.routeTemplate, elementKey, entity })
        }, EXPOSURE_MS))
      } else if (existing) {
        clearTimeout(existing)
        this.exposureTimers.delete(element)
      }
    }
  }

  /** Marcos de rolagem (25/50/75/100) por conteúdo declarado; conteúdo que já cabe na tela = um marco 100 "cabe na tela". */
  private checkScroll() {
    const win = this.doc.defaultView
    if (!win || this.doc.visibilityState !== "visible") return
    this.doc.querySelectorAll("[data-usage-scroll]").forEach((element) => {
      const contentKey = element.getAttribute("data-usage-scroll")
      const screen = this.screens.screenFor(element)
      if (!contentKey || !isContentKey(contentKey) || !screen) return
      const html = element as HTMLElement
      const scrollable = html.scrollHeight > html.clientHeight + 4 && /(auto|scroll)/.test(win.getComputedStyle(html).overflowY)
      let depth: number
      let fits = false
      if (scrollable) depth = ((html.scrollTop + html.clientHeight) / html.scrollHeight) * 100
      else {
        const rect = html.getBoundingClientRect()
        if (rect.height <= 0) return
        fits = rect.height <= win.innerHeight && rect.top >= 0 && rect.bottom <= win.innerHeight
        depth = ((Math.min(rect.bottom, win.innerHeight) - rect.top) / rect.height) * 100
      }
      const entity = entityOf(element)
      for (const milestone of SCROLL_MILESTONES) {
        if (depth + 0.5 < milestone && !fits) continue
        if (fits && milestone !== 100) continue
        const key = `${screen.instanceId}|${contentKey}|${entity?.type ?? ""}:${entity?.id ?? ""}|${milestone}`
        if (this.scrolled.has(key)) continue
        this.scrolled.add(key)
        this.collector.track({ name: "content.scrolled", screenKey: screen.screenKey, screenInstanceId: screen.instanceId, routeTemplate: screen.routeTemplate, entity, properties: { contentKey, depth: milestone, fitsViewport: fits } }, { qualifies: !fits })
      }
    })
  }
}

function normalizeErrorCode(code: string | null | undefined): string | null {
  if (!code) return null
  const normalized = code.toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 60)
  return /^[A-Z][A-Z0-9_]{1,59}$/.test(normalized) ? normalized : "UNKNOWN_ERROR"
}
