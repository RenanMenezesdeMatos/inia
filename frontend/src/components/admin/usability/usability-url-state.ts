import { USABILITY_TABS, type UsabilityQuery, type UsabilityTab } from "@/services/admin/usability-service"

/**
 * ESTADO DA MONITORIA NA URL — aba + filtros com os MESMOS nomes do contrato da API (`period`, `teamId`, `device`…), para que
 * link copiado, CSV e tela mostrem o mesmo recorte. Nenhum nome/e-mail entra na URL: pessoa e liderança vão por id.
 *
 * Os filtros PERSISTEM ao trocar de aba; o que a aba atual não suporta NÃO é enviado e aparece desabilitado com o motivo
 * (nunca ignorado em silêncio). Parâmetros desconhecidos são listados num aviso. Segmento, página e ordenação são da aba e
 * zeram ao trocar.
 */
export const USABILITY_TAB_LABELS: Record<UsabilityTab, string> = {
  overview: "Visão geral",
  people: "Pessoas e acessos",
  screens: "Telas e cliques",
  feedbacks: "Feedbacks e ciência",
  conversations: "INIA: voz e texto",
  workflows: "Workflows",
  journeys: "Jornadas e dificuldades",
  quality: "Qualidade da medição",
}

export const FILTER_KEYS = [
  "period", "from", "to", "compare", "structureMode", "teamId", "subteamId", "leaderId", "personId", "accessRole", "jobTitle", "personStatus", "accountStatus",
  "screenKey", "featureKey", "device", "appVersion", "environment", "feedbackSource", "feedbackKind", "conversationOrigin", "channel", "workflowId", "workflowVersionId",
  "includeAdmin", "includeTest", "includeDemo", "includeQa", "cohortWindow", "conversionMode", "referenceDate", "segment", "sort", "page", "pageSize",
] as const
export type FilterKey = (typeof FILTER_KEYS)[number]
const FILTER_SET = new Set<string>(FILTER_KEYS)

/** Parâmetros que só valem dentro de uma aba (zerados ao trocar de aba). */
const TAB_SCOPED: readonly FilterKey[] = ["segment", "sort", "page", "pageSize"]
/** Parâmetros que não são "filtros" para o usuário (não viram chip nem contam em "Limpar filtros"). */
const NON_FILTER: readonly FilterKey[] = ["period", "from", "to", "compare", "segment", "sort", "page", "pageSize"]

export type UsabilityUrlState = { tab: UsabilityTab; values: Partial<Record<FilterKey, string>>; unknownKeys: string[] }

export function readUsabilityUrl(search: URLSearchParams): UsabilityUrlState {
  const requested = search.get("tab")
  const tab = (USABILITY_TABS as readonly string[]).includes(requested ?? "") ? (requested as UsabilityTab) : "overview"
  const values: Partial<Record<FilterKey, string>> = {}
  const unknownKeys: string[] = []
  for (const [key, value] of search.entries()) {
    if (key === "tab") continue
    if (!FILTER_SET.has(key)) {
      unknownKeys.push(key)
      continue
    }
    if (value !== "") values[key as FilterKey] = value
  }
  return { tab, values, unknownKeys }
}

/** O que vai para a API desta aba: só o que ela suporta. O resto volta como "não se aplica" para a tela explicar. */
export function queryForTab(values: UsabilityUrlState["values"], supported: readonly string[]): { query: UsabilityQuery; inapplicable: FilterKey[] } {
  const allowed = new Set(supported)
  const query: UsabilityQuery = {}
  const inapplicable: FilterKey[] = []
  for (const [key, value] of Object.entries(values) as [FilterKey, string][]) {
    if (allowed.has(key)) query[key] = value
    else inapplicable.push(key)
  }
  if (query.period === "CUSTOM" && (!query.from || !query.to)) {
    // Intervalo incompleto: não consulta um período que o usuário ainda não terminou de escolher.
    delete query.period
    delete query.from
    delete query.to
  }
  if (query.period !== "CUSTOM") {
    delete query.from
    delete query.to
  }
  return { query, inapplicable }
}

/** Troca um filtro (vazio/undefined remove) e volta para a página 1 — mudar o recorte nunca deixa a lista numa página vazia. */
export function withFilter(search: URLSearchParams, key: FilterKey, value: string | undefined): URLSearchParams {
  const next = new URLSearchParams(search)
  if (value === undefined || value === "") next.delete(key)
  else next.set(key, value)
  if (key !== "page" && key !== "pageSize") next.delete("page")
  if (key === "period" && value !== "CUSTOM") {
    next.delete("from")
    next.delete("to")
  }
  if (key === "teamId") next.delete("subteamId")
  return next
}

export function withFilters(search: URLSearchParams, changes: Partial<Record<FilterKey, string | undefined>>): URLSearchParams {
  let next = new URLSearchParams(search)
  for (const [key, value] of Object.entries(changes) as [FilterKey, string | undefined][]) next = withFilter(next, key, value)
  return next
}

export function withTab(search: URLSearchParams, tab: UsabilityTab): URLSearchParams {
  const next = new URLSearchParams(search)
  for (const key of TAB_SCOPED) next.delete(key)
  if (tab === "overview") next.delete("tab")
  else next.set("tab", tab)
  return next
}

/** Limpa os filtros de recorte (mantém aba e período). */
export function withoutFilters(search: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams()
  const tab = search.get("tab")
  if (tab) next.set("tab", tab)
  for (const key of ["period", "from", "to", "compare"] as const) {
    const value = search.get(key)
    if (value) next.set(key, value)
  }
  return next
}

export function activeFilterKeys(values: UsabilityUrlState["values"]): FilterKey[] {
  return (Object.keys(values) as FilterKey[]).filter((key) => !NON_FILTER.includes(key))
}

export const toHref = (pathname: string, search: URLSearchParams) => {
  const query = search.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** A consulta sem página/tamanho (detalhe individual e exportação não paginam). */
export function withoutPaging(query: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(query).filter(([key]) => key !== "page" && key !== "pageSize"))
}
