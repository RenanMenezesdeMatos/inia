import { z } from "zod"
import { DomainError } from "../../../../shared/domain/domain-error.js"
import { USAGE_DEVICES } from "../../domain/ingestion-rules.js"
import { PERIOD_PRESETS } from "../../domain/usage-time.js"

/**
 * FILTROS GLOBAIS da Monitoria de usabilidade — o mesmo contrato na API, no painel (URL) e na exportação. Cada aba declara os
 * filtros que fazem sentido para ela; um filtro presente que a aba não suporta é RECUSADO (400 com a lista) — nunca ignorado
 * em silêncio, nunca devolvendo um conjunto diferente do pedido. Nenhum filtro carrega nome, e-mail ou texto livre: pessoa e
 * liderança vão por id (e só para quem pode ver pessoas identificadas).
 */
const uuid = z.string().uuid()
const flag = z.enum(["0", "1"]).transform((value) => value === "1")

export const usabilityFiltersSchema = z
  .object({
    period: z.enum(PERIOD_PRESETS).default("LAST_7_DAYS"),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    compare: flag.default(true),
    structureMode: z.enum(["AT_FACT", "CURRENT"]).default("AT_FACT"),
    teamId: uuid.optional(),
    subteamId: uuid.optional(),
    leaderId: uuid.optional(),
    personId: uuid.optional(),
    accessRole: z.string().regex(/^[A-Z][A-Z_]{2,59}$/).optional(),
    jobTitle: z.string().trim().min(1).max(120).optional(),
    personStatus: z.enum(["ACTIVE", "AWAY", "TERMINATED"]).optional(),
    accountStatus: z.enum(["ENABLED", "DISABLED", "NONE"]).optional(),
    screenKey: z.string().max(80).optional(),
    featureKey: z.string().max(60).optional(),
    device: z.enum(USAGE_DEVICES).optional(),
    appVersion: z.string().regex(/^[A-Za-z0-9._+-]{1,40}$/).optional(),
    environment: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/).optional(),
    feedbackSource: z.enum(["PUBLISHED_FEEDBACK", "INTERACTION_FEEDBACK_DELIVERY"]).optional(),
    feedbackKind: z.enum(["INDICATOR", "MONITORING"]).optional(),
    conversationOrigin: z.enum(["USER", "WORKFLOW", "FEEDBACK"]).optional(),
    channel: z.enum(["TEXT", "VOICE"]).optional(),
    workflowId: uuid.optional(),
    workflowVersionId: uuid.optional(),
    includeAdmin: flag.default(false),
    includeTest: flag.default(false),
    includeDemo: flag.default(false),
    includeQa: flag.default(false),
    cohortWindow: z.enum(["1", "7", "30"]).transform(Number).default(7),
    conversionMode: z.enum(["WINDOW", "CUTOFF"]).default("WINDOW"),
    referenceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    segment: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/).optional(),
    sort: z.string().regex(/^[a-zA-Z]{1,40}(:(asc|desc))?$/).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
export type UsabilityFilters = z.infer<typeof usabilityFiltersSchema>
export type UsabilityFilterKey = keyof UsabilityFilters

/** Sempre aceitos (recorte temporal, população, paginação e inclusões explícitas). */
const COMMON: readonly UsabilityFilterKey[] = ["period", "from", "to", "compare", "structureMode", "teamId", "subteamId", "leaderId", "personId", "accessRole", "jobTitle", "personStatus", "accountStatus", "includeTest", "includeDemo", "segment", "sort", "page", "pageSize"]

export const TAB_FILTERS = {
  overview: [...COMMON, "includeAdmin", "includeQa", "referenceDate"],
  people: [...COMMON, "includeAdmin", "includeQa", "device", "referenceDate"],
  person: ["period", "from", "to", "compare", "includeAdmin", "includeQa", "page", "pageSize"],
  screens: [...COMMON, "includeAdmin", "includeQa", "screenKey", "featureKey", "device", "appVersion", "environment"],
  feedbacks: [...COMMON, "feedbackSource", "feedbackKind", "workflowId", "cohortWindow", "conversionMode", "device"],
  conversations: [...COMMON, "conversationOrigin", "channel", "device"],
  workflows: [...COMMON, "workflowId", "workflowVersionId"],
  journeys: [...COMMON, "includeAdmin", "includeQa", "cohortWindow", "device", "screenKey"],
  quality: ["period", "from", "to", "compare", "includeTest", "includeDemo", "environment"],
} as const satisfies Record<string, readonly UsabilityFilterKey[]>
export type UsabilityTab = keyof typeof TAB_FILTERS

/** Motivo exibido quando um filtro não se aplica à aba (o painel desabilita com esta explicação). */
const NOT_BY_STRUCTURE = "Esta aba não é recortada por estrutura nem por pessoa (vale para a organização inteira, ou já é o detalhe de uma pessoa)."
export const FILTER_NOT_APPLICABLE_REASON: Partial<Record<UsabilityFilterKey, string>> = {
  structureMode: NOT_BY_STRUCTURE,
  teamId: NOT_BY_STRUCTURE,
  subteamId: NOT_BY_STRUCTURE,
  leaderId: NOT_BY_STRUCTURE,
  personId: NOT_BY_STRUCTURE,
  accessRole: NOT_BY_STRUCTURE,
  jobTitle: NOT_BY_STRUCTURE,
  personStatus: NOT_BY_STRUCTURE,
  accountStatus: NOT_BY_STRUCTURE,
  referenceDate: "Data de referência só se aplica à Visão geral e a Pessoas e acessos (DAU/WAU/MAU).",
  screenKey: "Tela só se aplica a Telas e cliques e a Jornadas.",
  featureKey: "Funcionalidade só se aplica a Telas e cliques.",
  appVersion: "Versão da aplicação só existe nos eventos do navegador (Telas e cliques).",
  environment: "Ambiente só existe nos eventos brutos (Telas e cliques, Qualidade).",
  feedbackSource: "Fonte de feedback só se aplica a Feedbacks e ciência.",
  feedbackKind: "Tipo de feedback só se aplica a Feedbacks e ciência.",
  conversationOrigin: "Origem da conversa só se aplica a INIA: voz e texto.",
  channel: "Canal só se aplica a INIA: voz e texto.",
  workflowId: "Workflow só se aplica a Workflows e a Feedbacks gerados por workflow.",
  workflowVersionId: "Versão de workflow só se aplica a Workflows.",
  includeAdmin: "Uso da Administração não se aplica a esta aba (fontes oficiais de negócio).",
  includeQa: "Uso do QA não se aplica a esta aba.",
  device: "Dispositivo só existe nos eventos do navegador.",
  cohortWindow: "Janela de coorte só se aplica a Feedbacks e Jornadas.",
  conversionMode: "Modo de conversão só se aplica a Feedbacks.",
}

/** Lê a query: chaves desconhecidas = 400; chaves conhecidas fora da aba = 400 USABILITY_FILTER_NOT_SUPPORTED. */
export function parseUsabilityFilters(tab: UsabilityTab, query: Record<string, unknown>): UsabilityFilters {
  const allowed = new Set<string>(TAB_FILTERS[tab])
  const unsupported = Object.keys(query).filter((key) => key in usabilityFiltersSchema.shape && !allowed.has(key))
  if (unsupported.length > 0) {
    throw new DomainError(`Filtro não se aplica a esta aba: ${unsupported.join(", ")}.`, "USABILITY_FILTER_NOT_SUPPORTED", 400, unsupported.map((key) => ({ filter: key, reason: FILTER_NOT_APPLICABLE_REASON[key as UsabilityFilterKey] ?? "Não se aplica a esta aba." })))
  }
  const parsed = usabilityFiltersSchema.safeParse(query)
  if (!parsed.success) throw new DomainError("Filtro inválido.", "USABILITY_FILTER_INVALID", 400, parsed.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })))
  if (parsed.data.period === "CUSTOM" && (!parsed.data.from || !parsed.data.to)) throw new DomainError("Intervalo personalizado exige data inicial e final.", "USABILITY_FILTER_INVALID", 400)
  return parsed.data
}

/** Filtros explicitamente aplicados (para o cabeçalho do CSV e a resposta). */
export function describeAppliedFilters(filters: UsabilityFilters): Record<string, string | number | boolean> {
  const skip = new Set(["page", "pageSize", "sort"])
  return Object.fromEntries(Object.entries(filters).filter(([key, value]) => !skip.has(key) && value !== undefined && value !== null)) as Record<string, string | number | boolean>
}
