import catalog from "./usage-catalog.generated.json"

/**
 * Catálogo de uso no navegador — cópia GERADA do backend (fonte única; `backend/scripts/usage-analytics/export-catalog.ts`).
 * Resolve a URL atual na tela do catálogo (rota normalizada + aba da URL) e diz quais chaves existem; nada fora do catálogo é
 * enviado (o servidor recusaria de qualquer forma).
 */
export type UsageEntityType = "PUBLISHED_FEEDBACK" | "INTERACTION_FEEDBACK_DELIVERY" | "ALERT" | "KNOWLEDGE_MATERIAL" | "CONVERSATION" | "WORKFLOW" | "PERSON" | "CASE" | "WORKFLOW_OUTPUT"
export type UsageEntity = { type: UsageEntityType; id: string }
export type ScreenKind = "ROUTE" | "TAB" | "PANEL" | "MODAL"
type CatalogScreen = { key: string; kind: ScreenKind; area: string; routeTemplate: string | null; parent: string | null }

export const USAGE_CATALOG_VERSION: string = catalog.version
const SCREENS = catalog.screens as CatalogScreen[]
const SCREEN_KEYS = new Set(SCREENS.map((screen) => screen.key))
const ELEMENT_KEYS = new Set<string>(catalog.elements)
const CONTENT_KEYS = new Set<string>(catalog.contents)
const URL_TABS = catalog.urlTabs as Record<string, { param: string; default: string; values: string[] }>
const UNROUTED_TABS = catalog.unroutedTabs as Record<string, string[]>

export const isScreenKey = (key: string) => SCREEN_KEYS.has(key)
export const isElementKey = (key: string) => ELEMENT_KEYS.has(key)
export const isContentKey = (key: string) => CONTENT_KEYS.has(key)
export const screenKindOf = (key: string): ScreenKind | null => SCREENS.find((screen) => screen.key === key)?.kind ?? null
export const isUsabilityPanel = (key: string | null) => key !== null && SCREENS.find((screen) => screen.key === key)?.area === "USABILITY_PANEL"

/** Parâmetro de rota que identifica uma entidade autorizável (o resto — id de agente, fonte… — é metadado, não entidade). */
const ENTITY_PARAMS: Record<string, UsageEntityType> = { operatorId: "PERSON", personId: "PERSON", caseId: "CASE", materialId: "KNOWLEDGE_MATERIAL", workflowId: "WORKFLOW" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type CompiledRoute = { screen: CatalogScreen; regex: RegExp; params: string[]; literalSegments: number }
const ROUTES: CompiledRoute[] = SCREENS.filter((screen) => screen.kind === "ROUTE" && screen.routeTemplate)
  .map((screen) => {
    const template = screen.routeTemplate!
    const params: string[] = []
    const prefix = template.endsWith("/*")
    const base = prefix ? template.slice(0, -2) : template
    const pattern = base
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          params.push(segment.slice(1))
          return "([^/]+)"
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      })
      .join("/")
    const regex = new RegExp(`^${pattern === "" ? "/" : pattern}${prefix ? "(?:/.*)?" : ""}/?$`)
    return { screen, regex, params, literalSegments: base.split("/").filter((segment) => segment && !segment.startsWith(":")).length }
  })
  .sort((a, b) => b.literalSegments - a.literalSegments || a.params.length - b.params.length)

export type ResolvedRoute = { routeScreenKey: string; routeTemplate: string; screenKey: string; kind: ScreenKind; entity: UsageEntity | null }

/** URL atual → tela do catálogo (aba da URL incluída) ou null quando a rota não é instrumentada. */
export function resolveRoute(pathname: string, search: URLSearchParams | null): ResolvedRoute | null {
  for (const route of ROUTES) {
    const match = route.regex.exec(pathname)
    if (!match) continue
    let entity: UsageEntity | null = null
    route.params.forEach((param, index) => {
      const value = match[index + 1]
      const type = ENTITY_PARAMS[param]
      if (type && value && UUID.test(value)) entity = { type, id: value }
    })
    const tabs = URL_TABS[route.screen.key]
    if (tabs) {
      const requested = search?.get(tabs.param) ?? null
      const value = requested && tabs.values.includes(requested) ? requested : tabs.default
      return { routeScreenKey: route.screen.key, routeTemplate: route.screen.routeTemplate!, screenKey: `${route.screen.key}.${value}`, kind: "TAB", entity }
    }
    return { routeScreenKey: route.screen.key, routeTemplate: route.screen.routeTemplate!, screenKey: route.screen.key, kind: "ROUTE", entity }
  }
  return null
}

/** Aba Radix (sem URL) reconhecida pelo valor do gatilho, dentro da rota. */
export function unroutedTabScreen(routeScreenKey: string, value: string): string | null {
  const values = UNROUTED_TABS[routeScreenKey]
  if (!values?.includes(value)) return null
  const key = `${routeScreenKey}.${value}`
  return SCREEN_KEYS.has(key) ? key : null
}

/** A aba é controlada pela URL nesta rota? (então a URL já gera a visualização — o gatilho não duplica). */
export const routeHasUrlTabs = (routeScreenKey: string) => Boolean(URL_TABS[routeScreenKey])
