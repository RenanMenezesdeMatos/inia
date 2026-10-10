import { formatCivilDate } from "@/lib/format/date"
import type { MetricValue } from "@/schemas/admin/usability.schema"

/**
 * Formatação da Monitoria de usabilidade. "Sem dados" e "não aplicável" NUNCA viram zero: o valor nulo vem acompanhado do
 * motivo, e taxas mostram a base ("2 de 6").
 */
export const NO_DATA = "Sem dados"
export const NOT_APPLICABLE = "Não aplicável"

const integer = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 })
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 })

export const formatCount = (value: number | null | undefined) => (value === null || value === undefined ? NO_DATA : integer.format(value))
export const formatDecimal = (value: number | null | undefined) => (value === null || value === undefined ? NO_DATA : decimal.format(value))
export const formatPercent = (value: number | null | undefined) => (value === null || value === undefined ? NOT_APPLICABLE : `${decimal.format(value)}%`)

/** Duração legível: 45 s · 3 min 5 s · 2 h 10 min · 3 d 4 h. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return NO_DATA
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total} s`
  if (total < 3_600) {
    const minutes = Math.floor(total / 60)
    const rest = total % 60
    return rest ? `${minutes} min ${rest} s` : `${minutes} min`
  }
  if (total < 86_400) {
    const hours = Math.floor(total / 3_600)
    const minutes = Math.floor((total % 3_600) / 60)
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`
  }
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  return hours ? `${days} d ${hours} h` : `${days} d`
}

export const formatMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? NO_DATA : ms < 1_000 ? `${integer.format(ms)} ms` : `${decimal.format(ms / 1_000)} s`)

/** Instante no fuso da organização (o mesmo do backend); nunca o fuso do navegador. */
export function formatInstant(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—"
  return new Intl.DateTimeFormat("pt-BR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

/** Data civil (YYYY-MM-DD) → dd/mm/aaaa, sem conversão de fuso. */
export function formatLocalDate(date: string | null | undefined): string {
  return date ? formatCivilDate(date) : "—"
}

export const formatShortDate = (date: string) => {
  const [, month, day] = date.slice(0, 10).split("-")
  return `${day}/${month}`
}

/** Valor de uma métrica pela unidade do dicionário. */
export function formatMetricValue(metric: MetricValue, unit: string | undefined): string {
  if (metric.status === "NO_DATA") return NO_DATA
  if (metric.status === "NOT_APPLICABLE" || metric.value === null) return metric.status === "NOT_APPLICABLE" ? NOT_APPLICABLE : NO_DATA
  if (unit === "PERCENT") return formatPercent(metric.value)
  if (unit === "SECONDS") return formatDuration(metric.value)
  if (unit === "MILLISECONDS") return formatMs(metric.value)
  if (unit === "RATIO") return formatDecimal(metric.value)
  return Number.isInteger(metric.value) ? formatCount(metric.value) : formatDecimal(metric.value)
}

/** Taxa com base explícita: "50% (2 de 4)"; sem base = "Não aplicável (sem base)". */
export function formatRate(rate: { numerator: number; denominator: number; value: number | null } | null | undefined): string {
  if (!rate) return NO_DATA
  if (!rate.denominator) return `${NOT_APPLICABLE} (sem base)`
  return `${formatPercent(rate.value)} (${formatCount(rate.numerator)} de ${formatCount(rate.denominator)})`
}

export const DEVICE_LABELS: Record<string, string> = { DESKTOP: "Computador", MOBILE: "Celular", TABLET: "Tablet" }
export const PERSON_STATUS_LABELS: Record<string, string> = { ACTIVE: "Ativas", AWAY: "Afastadas", TERMINATED: "Desligadas" }
export const ACCOUNT_STATUS_LABELS: Record<string, string> = { ENABLED: "Conta habilitada", DISABLED: "Conta desativada", NONE: "Sem conta" }
export const FEEDBACK_SOURCE_LABELS: Record<string, string> = { PUBLISHED_FEEDBACK: "Feedback publicado", INTERACTION_FEEDBACK_DELIVERY: "Feedback de atendimento" }
export const FEEDBACK_KIND_LABELS: Record<string, string> = { INDICATOR: "Indicador", MONITORING: "Monitoria" }
export const CONVERSATION_ORIGIN_LABELS: Record<string, string> = { USER: "Iniciada pela pessoa", WORKFLOW: "Recado de workflow", FEEDBACK: "Aplicação de feedback" }
export const CHANNEL_LABELS: Record<string, string> = { TEXT: "Texto", VOICE: "Voz" }
export const STRUCTURE_MODE_LABELS: Record<string, string> = { AT_FACT: "Estrutura na data do uso", CURRENT: "Estrutura atual" }
export const CONVERSION_MODE_LABELS: Record<string, string> = { WINDOW: "Janela após a entrega", CUTOFF: "Até o fim do período" }
export const WORKFLOW_STATUS_LABELS: Record<string, string> = { active: "Em execução", waiting: "Aguardando", completed: "Concluído", failed: "Falhou", dead: "Encerrado com falha" }
export const ACCOUNT_BADGE: Record<string, string> = { ENABLED: "Habilitada", DISABLED: "Desativada", NONE: "Sem conta" }
export const ELIGIBILITY_BASIS_LABELS: Record<string, string> = { COLLECTION_START: "Desde o início da coleta", ACCOUNT_CREATED: "Conta criada", STATE_CHANGE_OBSERVED: "Mudança observada" }
/** Dia da semana ISO (1 = segunda … 7 = domingo), o mesmo do backend. */
export const ISO_WEEKDAY_LABELS: Record<number, string> = { 1: "Seg", 2: "Ter", 3: "Qua", 4: "Qui", 5: "Sex", 6: "Sáb", 7: "Dom" }

/** Rótulo legível de um filtro aplicado (chips). */
export const FILTER_LABELS: Record<string, string> = {
  structureMode: "Estrutura",
  teamId: "Grupo",
  subteamId: "Subgrupo",
  leaderId: "Liderança",
  personId: "Pessoa",
  accessRole: "Papel de acesso",
  jobTitle: "Cargo",
  personStatus: "Situação",
  accountStatus: "Conta",
  screenKey: "Tela",
  featureKey: "Funcionalidade",
  device: "Dispositivo",
  appVersion: "Versão",
  environment: "Ambiente",
  feedbackSource: "Fonte do feedback",
  feedbackKind: "Tipo de feedback",
  conversationOrigin: "Origem da conversa",
  channel: "Canal",
  workflowId: "Workflow",
  workflowVersionId: "Versão do workflow",
  includeAdmin: "Inclui Administração",
  includeTest: "Inclui contas de teste",
  includeDemo: "Inclui demonstração",
  includeQa: "Inclui QA",
  cohortWindow: "Janela da coorte",
  conversionMode: "Conversão",
  referenceDate: "Data de referência",
}
