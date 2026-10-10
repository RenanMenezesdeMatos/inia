import { USAGE_CONTENTS, USAGE_ELEMENTS, USAGE_SEARCH_SURFACES } from "./usage-elements.js"
import { USAGE_ACTIONS } from "./usage-events.js"
import { UNROUTED_TABS, URL_TABS, USAGE_SCREENS } from "./usage-screens.js"

/**
 * Cópia do catálogo que o NAVEGADOR precisa (chaves, rotas e abas) — gerada em `frontend/src/lib/usage/usage-catalog.generated.json`
 * por `npx tsx scripts/usage-analytics/export-catalog.ts` e conferida por teste (o backend é a fonte; nunca editar o JSON à mão).
 */
export const CLIENT_CATALOG_VERSION = "USAGE_CATALOG_V1"

export function clientCatalog() {
  return {
    version: CLIENT_CATALOG_VERSION,
    screens: USAGE_SCREENS.map((screen) => ({ key: screen.key, kind: screen.kind, area: screen.area, routeTemplate: screen.routeTemplate, parent: screen.parent ?? null })),
    urlTabs: URL_TABS,
    unroutedTabs: UNROUTED_TABS,
    elements: USAGE_ELEMENTS.map((element) => element.key),
    contents: USAGE_CONTENTS.map((content) => content.key),
    searchSurfaces: USAGE_SEARCH_SURFACES.map((surface) => surface.key),
    actions: [...USAGE_ACTIONS],
  }
}
