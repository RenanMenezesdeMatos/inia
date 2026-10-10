import { isScreenKey, resolveRoute, routeHasUrlTabs, screenKindOf, unroutedTabScreen, type UsageEntity, type UsageEntityType } from "./usage-catalog"
import { newId, type UsageCollector } from "./usage-collector"

/**
 * TELAS apresentadas — rota (URL normalizada + aba da URL), aba Radix sem URL (pelo valor do gatilho ativo) e painéis/diálogos
 * declarados com `data-usage-screen` (+ `data-usage-entity-type`/`data-usage-entity-id`). Regras:
 *   - visualização só com a aba do navegador VISÍVEL (escondida = fica pendente até aparecer);
 *   - remontagem técnica (React Strict Mode, hidratação, re-render) da MESMA tela em < 1,5 s reaproveita a instância — retorno
 *     real a uma tela (depois de outra) é visualização nova;
 *   - saída explícita (`screen.left`) ao trocar de tela, fechar o painel ou descarregar a página; sem ela, a saída é inferida.
 */
export const REMOUNT_WINDOW_MS = 1_500

export type ScreenInstance = { screenKey: string; instanceId: string; routeTemplate: string | null; entity: UsageEntity | null; openedAt: number; kind: string }

const ENTITY_TYPES = new Set<UsageEntityType>(["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY", "ALERT", "KNOWLEDGE_MATERIAL", "CONVERSATION", "WORKFLOW", "PERSON", "CASE", "WORKFLOW_OUTPUT"])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Entidade declarada no elemento (ou num ancestral próximo) — só tipos do catálogo e ids UUID. */
export function entityOf(element: Element | null): UsageEntity | null {
  const holder = element?.closest("[data-usage-entity-type]")
  const type = holder?.getAttribute("data-usage-entity-type") as UsageEntityType | null
  const id = holder?.getAttribute("data-usage-entity-id")
  return type && id && ENTITY_TYPES.has(type) && UUID.test(id) ? { type, id } : null
}
const sameEntity = (a: UsageEntity | null, b: UsageEntity | null) => a?.type === b?.type && a?.id === b?.id

export class ScreensRuntime {
  route: (ScreenInstance & { routeScreenKey: string }) | null = null
  tab: ScreenInstance | null = null
  readonly overlays = new Map<Element, ScreenInstance>()
  private readonly closing = new Map<string, { instance: ScreenInstance; timer: ReturnType<typeof setTimeout> }>()
  private lastRouteLeft: { screenKey: string; entity: UsageEntity | null; at: number; instance: ScreenInstance & { routeScreenKey: string } } | null = null
  private pendingRoute: { pathname: string; search: URLSearchParams | null } | null = null
  private viewsInTab = 0
  private previousScreenKey: string | null = null

  constructor(private readonly collector: UsageCollector, private readonly doc: Document, private readonly now: () => number = () => Date.now()) {}

  private visible() {
    return this.doc.visibilityState === "visible"
  }

  private emitView(instance: ScreenInstance, navigation: string) {
    this.collector.track({ name: "screen.viewed", screenKey: instance.screenKey, screenInstanceId: instance.instanceId, routeTemplate: instance.routeTemplate, entity: instance.entity, properties: { kind: instance.kind, navigation, previousScreenKey: this.previousScreenKey, entry: this.viewsInTab === 0 } }, { qualifies: true })
    this.viewsInTab += 1
    this.previousScreenKey = instance.screenKey
  }

  private emitLeft(instance: ScreenInstance, reason: string) {
    this.collector.track({ name: "screen.left", screenKey: instance.screenKey, screenInstanceId: instance.instanceId, routeTemplate: instance.routeTemplate, properties: { reason, visibleMs: Math.max(0, Math.min(86_400_000, this.now() - instance.openedAt)) } })
  }

  /** Rota mudou (pathname/query). Mesma tela + mesma entidade = mesma instância (re-render não conta). */
  routeChanged(pathname: string, search: URLSearchParams | null) {
    if (!this.visible()) {
      this.pendingRoute = { pathname, search }
      return
    }
    const resolved = resolveRoute(pathname, search)
    if (!resolved) {
      if (this.route) this.leaveRoute("NAVIGATION")
      return
    }
    if (this.route && this.route.screenKey === resolved.screenKey && sameEntity(this.route.entity, resolved.entity)) return
    // Remontagem técnica: a mesma tela volta em < 1,5 s sem outra tela no meio → mesma instância.
    const remount = this.lastRouteLeft && this.lastRouteLeft.screenKey === resolved.screenKey && sameEntity(this.lastRouteLeft.entity, resolved.entity) && this.now() - this.lastRouteLeft.at < REMOUNT_WINDOW_MS
    if (this.route) this.leaveRoute("NAVIGATION")
    if (remount && this.lastRouteLeft) {
      this.route = this.lastRouteLeft.instance
      this.lastRouteLeft = null
      return
    }
    const navigation = this.viewsInTab === 0 ? (isReload(this.doc) ? "RELOAD" : "INITIAL") : resolved.kind === "TAB" && this.route?.routeScreenKey === resolved.routeScreenKey ? "TAB_SWITCH" : "NAVIGATION"
    this.tab = null
    this.route = { screenKey: resolved.screenKey, routeScreenKey: resolved.routeScreenKey, instanceId: newId(), routeTemplate: resolved.routeTemplate, entity: resolved.entity, openedAt: this.now(), kind: resolved.kind }
    this.emitView(this.route, navigation)
  }

  private leaveRoute(reason: string) {
    if (!this.route) return
    if (this.tab) this.emitLeft(this.tab, reason)
    this.emitLeft(this.route, reason)
    this.lastRouteLeft = { screenKey: this.route.screenKey, entity: this.route.entity, at: this.now(), instance: this.route }
    this.route = null
    this.tab = null
  }

  /** Aba Radix ativada (sem URL): vira tela própria se estiver no catálogo da rota; abas controladas pela URL já contam pela rota. */
  tabActivated(value: string) {
    if (!this.route || routeHasUrlTabs(this.route.routeScreenKey)) return
    const screenKey = unroutedTabScreen(this.route.routeScreenKey, value)
    if (!screenKey || this.tab?.screenKey === screenKey) return
    if (this.tab) this.emitLeft(this.tab, "NAVIGATION")
    this.tab = { screenKey, instanceId: newId(), routeTemplate: this.route.routeTemplate, entity: null, openedAt: this.now(), kind: "TAB" }
    this.emitView(this.tab, "TAB_SWITCH")
  }

  /** Painel/diálogo declarado apareceu. Reaparecer em < 1,5 s (remontagem) reaproveita a instância. */
  overlayAdded(element: Element) {
    if (this.overlays.has(element)) return
    const screenKey = element.getAttribute("data-usage-screen")
    if (!screenKey || !isScreenKey(screenKey)) return
    const entity = entityOf(element)
    const closingKey = `${screenKey}|${entity?.type ?? ""}|${entity?.id ?? ""}`
    const closing = this.closing.get(closingKey)
    if (closing) {
      clearTimeout(closing.timer)
      this.closing.delete(closingKey)
      this.overlays.set(element, closing.instance)
      return
    }
    const instance: ScreenInstance = { screenKey, instanceId: newId(), routeTemplate: this.route?.routeTemplate ?? null, entity, openedAt: this.now(), kind: screenKindOf(screenKey) ?? "PANEL" }
    this.overlays.set(element, instance)
    if (this.visible()) this.emitView(instance, "OPEN")
  }

  overlayRemoved(element: Element) {
    const instance = this.overlays.get(element)
    if (!instance) return
    this.overlays.delete(element)
    const closingKey = `${instance.screenKey}|${instance.entity?.type ?? ""}|${instance.entity?.id ?? ""}`
    const timer = setTimeout(() => {
      this.closing.delete(closingKey)
      this.emitLeft(instance, "CLOSED")
    }, REMOUNT_WINDOW_MS)
    this.closing.set(closingKey, { instance, timer })
  }

  /** Página voltou a ficar visível: rota pendente vira visualização agora. */
  becameVisible() {
    if (this.pendingRoute) {
      const pending = this.pendingRoute
      this.pendingRoute = null
      this.routeChanged(pending.pathname, pending.search)
    }
  }

  pageHidden(reason: "HIDDEN" | "PAGEHIDE" | "LOGOUT") {
    if (reason === "HIDDEN") return
    for (const instance of this.overlays.values()) this.emitLeft(instance, reason)
    this.leaveRoute(reason)
  }

  /** Tela à qual um elemento pertence: o painel/diálogo declarado mais próximo; senão a aba; senão a rota. */
  screenFor(target: Element | null): ScreenInstance | null {
    let node: Element | null = target
    while (node) {
      const overlay = this.overlays.get(node)
      if (overlay) return overlay
      node = node.parentElement
    }
    return this.tab ?? this.route
  }

  /** Tela em primeiro plano para o tempo ativo: o painel/diálogo aberto mais recente; senão a aba/rota. */
  foreground(): ScreenInstance | null {
    let latest: ScreenInstance | null = null
    for (const instance of this.overlays.values()) if (!latest || instance.openedAt > latest.openedAt) latest = instance
    return latest ?? this.tab ?? this.route
  }
}

function isReload(doc: Document): boolean {
  try {
    const entry = doc.defaultView?.performance?.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined
    return entry?.type === "reload"
  } catch {
    return false
  }
}
