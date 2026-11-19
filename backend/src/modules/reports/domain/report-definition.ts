import { createHash } from "node:crypto"
import { z } from "zod"
import { TEXT_FIELDS } from "../../leadership-analytics/application/data-domains.js"
import { parseStringList } from "../../leadership-analytics/application/fact-query.js"
import { WORKFORCE_STATUS_FILTERS } from "../../leadership-analytics/application/workforce.js"

/**
 * DEFINIÇÃO de um report recorrente — o que reproduz a consulta a cada execução, sem depender de texto de chat nem de resposta
 * antiga da IA. Contrato versionado (`REPORT_DEFINITION_VERSION`): ferramenta da liderança + parâmetros válidos (indicadores por
 * CÓDIGO) + estrutura (FIXA ou "de quem recebe") + período (relativo ou fixo). A execução converte em argumentos da MESMA
 * ferramenta do chat (`toToolCall`) — mesmo cálculo, mesmo escopo.
 */
export const REPORT_DEFINITION_VERSION = 1

/**
 * Ferramentas sobre REGISTROS (motor `FACT_QUERY_V1` da liderança: atendimentos, monitoria, feedbacks, casos, escala, jornada,
 * comunicados, uso da INIA e Apoio com Anjo). Os parâmetros delas (agrupamento, medidas, estatísticas, filtros por campo do
 * registro) ficam em `queryArgs`, exatamente como a ferramenta do chat os recebeu; o PERÍODO nunca fica lá — é a regra de
 * período do report, reescrita em `competencia` ou `data_inicio`/`data_fim` a cada execução (`resolveRecordPeriod`).
 */
export const RECORD_REPORT_TOOLS = ["INTERACTIONS", "MONITORING", "FEEDBACKS", "CASES", "SCHEDULE", "WORKDAY", "COMMUNICATIONS", "INIA_USAGE", "SUPPORT"] as const
export type RecordReportTool = (typeof RECORD_REPORT_TOOLS)[number]

/** `SPAN` = span de controle pelo organograma vigente (sem período: o organograma na data da execução). */
export const REPORT_TOOLS = ["INDICATOR_QUERY", "WORKFORCE", "INDICATOR_DIAGNOSIS", "SPAN", ...RECORD_REPORT_TOOLS] as const
export type ReportTool = (typeof REPORT_TOOLS)[number]

export const TOOL_NAME_BY_REPORT_TOOL: Record<ReportTool, string> = {
  INDICATOR_QUERY: "leadership_indicator_query",
  WORKFORCE: "leadership_workforce",
  INDICATOR_DIAGNOSIS: "leadership_indicator_diagnosis",
  SPAN: "leadership_span",
  INTERACTIONS: "leadership_interactions",
  MONITORING: "leadership_monitoring",
  FEEDBACKS: "leadership_feedbacks",
  CASES: "leadership_cases",
  SCHEDULE: "leadership_schedule",
  WORKDAY: "leadership_workday",
  COMMUNICATIONS: "leadership_communications",
  INIA_USAGE: "leadership_inia_usage",
  SUPPORT: "leadership_support",
}

export const REPORT_TOOL_BY_TOOL_NAME: Record<string, ReportTool> = Object.fromEntries(Object.entries(TOOL_NAME_BY_REPORT_TOOL).map(([tool, name]) => [name, tool as ReportTool]))

export function isRecordTool(tool: ReportTool): tool is RecordReportTool {
  return (RECORD_REPORT_TOOLS as readonly string[]).includes(tool)
}

/** Argumentos que NUNCA entram em `queryArgs`: estrutura e período são da definição (relativos), nunca do texto do chat. */
export const RESERVED_QUERY_ARGS = ["estrutura", "subject_kind", "subject_id", "competencia", "data_inicio", "data_fim", "ultimas_competencias"] as const
const queryArgValueSchema = z.union([z.string().min(1).max(200), z.number().finite(), z.boolean(), z.array(z.string().min(1).max(200)).max(30)])
const queryArgsSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), queryArgValueSchema)
  .refine((args) => Object.keys(args).length <= 20, { message: "Parâmetros demais na consulta." })
  .refine((args) => !Object.keys(args).some((key) => (RESERVED_QUERY_ARGS as readonly string[]).includes(key)), { message: "Estrutura e período não ficam nos parâmetros da consulta." })

const structureSchema = z.discriminatedUnion("mode", [
  // "Minha equipe": a estrutura de QUEM RECEBE, resolvida a cada execução (muda com a equipe atual da pessoa).
  z.object({ mode: z.literal("RECIPIENT") }),
  // Uma estrutura específica (liderado, Grupo, Subgrupo) — validada contra o escopo de cada destinatário a cada execução.
  z.object({ mode: z.literal("FIXED"), subjectKind: z.string().min(1).max(60), subjectId: z.string().uuid(), label: z.string().min(1).max(200) }),
])

/** Data civil que existe no calendário (AAAA-MM-DD): `2026-02-31` tem o formato certo e não é uma data. */
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
const civilDateSchema = z.string().refine(isCivilDate, { message: "Data inválida: use AAAA-MM-DD com um dia que exista no calendário." })
/** Teto de um período por datas (fixas ou relativas): 12 meses. */
export const MAX_RECORD_PERIOD_DAYS = 366

/**
 * Atendimentos por trecho (`termo`): a definição guarda TAMBÉM onde procurar (`termo_em`: motivo, submotivo, ocorrência). Sem o
 * campo, a ferramenta decide pelos dados do período (um campo, outro, ou um cartão de escolha que ninguém responde numa execução
 * agendada) — a "mesma consulta" deixaria de ser a mesma. Achado DL-08 da 10ª auditoria.
 */
export const TERM_FIELD_REQUIRED_MESSAGE = "A busca por trecho precisa dizer onde procurar (motivo, submotivo ou ocorrência). Refaça a consulta escolhendo a leitura antes de criar o report."
export function termFieldIssue(tool: string, queryArgs: Record<string, unknown> | undefined): string | null {
  if (tool !== "INTERACTIONS" || typeof queryArgs?.termo !== "string" || !queryArgs.termo.trim()) return null
  const fields = parseStringList(queryArgs.termo_em).map((value) => value.toUpperCase())
  return fields.length > 0 && fields.every((field) => (TEXT_FIELDS as readonly string[]).includes(field)) ? null : TERM_FIELD_REQUIRED_MESSAGE
}

export const PERIOD_DISPLAYS = ["ULTIMA", "MEDIA", "POR_MES", "RECORRENCIA"] as const
export const CURRENT_WINDOWS = ["MES_CORRENTE", "SEMANA_CORRENTE", "ULTIMOS_7_DIAS"] as const

const periodSchema = z.discriminatedUnion("mode", [
  // Última competência fechada e coberta — recalculada a cada execução.
  z.object({ mode: z.literal("LAST_CLOSED") }),
  // Últimas N competências fechadas, lidas como a última (com variação), a média, mês a mês ou recorrência.
  z.object({ mode: z.literal("LAST_N_CLOSED"), months: z.number().int().min(2).max(6), display: z.enum(PERIOD_DISPLAYS) }),
  // Competência fixa.
  z.object({ mode: z.literal("FIXED_MONTH"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { message: "Competência inválida: use AAAA-MM, com o mês de 01 a 12." }) }),
  // Período em curso pela medição diária (parcial, sem meta oficial).
  z.object({ mode: z.literal("CURRENT"), window: z.enum(CURRENT_WINDOWS) }),
  // Situação funcional (ou organograma, no span) na data da execução.
  z.object({ mode: z.literal("TODAY") }),
  // Registros: semana/mês do calendário relativo à data da execução (0 = em curso, -1 = anterior, 1 = próximo). Semana de segunda a
  // domingo. `toDate` = do início da semana/mês até a data da execução (só com offset 0).
  z.object({ mode: z.literal("CALENDAR"), unit: z.enum(["WEEK", "MONTH"]), offset: z.number().int().min(-12).max(12), toDate: z.boolean().optional() }),
  // Registros: dias relativos à data da execução, inclusive nas duas pontas (ex.: últimos 7 dias até ontem = -7..-1; hoje = 0..0;
  // próximos 7 dias = 1..7).
  z.object({ mode: z.literal("RELATIVE_DAYS"), fromOffset: z.number().int().min(-366).max(366), toOffset: z.number().int().min(-366).max(366) }),
  // Registros: datas fixas (AAAA-MM-DD, inclusive).
  z.object({ mode: z.literal("FIXED_DATES"), from: civilDateSchema, to: civilDateSchema }),
])

const WORKFORCE_STATUSES = Object.keys(WORKFORCE_STATUS_FILTERS) as [string, ...string[]]

export const reportDefinitionSchema = z
  .object({
    tool: z.enum(REPORT_TOOLS),
    structure: structureSchema,
    period: periodSchema,
    indicators: z.array(z.string().min(1).max(60)).max(10).default([]),
    view: z.enum(["INDICADOR", "CONSOLIDADO", "QUARTIS"]).optional(),
    groupBy: z.enum(["ESTRUTURA", "UNIDADE", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "TEAM", "SUBTEAM", "PESSOA", "COMPETENCIA"]).optional(),
    situation: z.enum(["FORA", "DENTRO", "SEM_DADO"]).optional(),
    quartiles: z.array(z.enum(["Q1", "Q2", "Q3", "Q4"])).max(4).optional(),
    minBelowIndicators: z.number().int().min(1).max(20).optional(),
    sortBy: z.enum(["PCT_FORA", "FORA", "ATINGIMENTO", "VARIACAO", "Q4", "DISPERSAO", "NOME"]).optional(),
    order: z.enum(["ASC", "DESC"]).optional(),
    limit: z.number().int().min(1).max(50).default(20),
    statuses: z.array(z.enum(WORKFORCE_STATUSES)).max(10).optional(),
    listPeople: z.boolean().optional(),
    includeLeaders: z.boolean().optional(),
    compare: z.enum(["FORA_X_DENTRO", "Q4_X_Q1"]).optional(),
    level: z.enum(["SUBMOTIVO", "MOTIVO"]).optional(),
    interactionMonths: z.number().int().min(1).max(6).optional(),
    /** Parâmetros da ferramenta de registros ou do span, como o chat os usou (sem estrutura nem período). */
    queryArgs: queryArgsSchema.optional(),
  })
  .superRefine((definition, context) => {
    const issue = (message: string, path: string) => context.addIssue({ code: "custom", message, path: [path] })
    const period = definition.period
    const recordTool = isRecordTool(definition.tool)
    if (definition.tool === "WORKFORCE" && period.mode !== "TODAY") issue("Força de trabalho usa a situação funcional da data da execução.", "period")
    if (definition.tool === "SPAN" && period.mode !== "TODAY") issue("O span de controle usa o organograma da data da execução.", "period")
    if (definition.tool !== "WORKFORCE" && definition.tool !== "SPAN" && period.mode === "TODAY") issue("Este período só vale para força de trabalho e span de controle.", "period")
    if (recordTool && period.mode !== "LAST_CLOSED" && period.mode !== "FIXED_MONTH" && period.mode !== "CALENDAR" && period.mode !== "RELATIVE_DAYS" && period.mode !== "FIXED_DATES") issue("Consultas de registros usam um mês (último fechado ou fixo) ou um período de datas.", "period")
    if (!recordTool && (period.mode === "CALENDAR" || period.mode === "RELATIVE_DAYS" || period.mode === "FIXED_DATES")) issue("Período por datas vale para consultas de registros.", "period")
    if (period.mode === "CALENDAR" && period.toDate && period.offset !== 0) issue("\"Até a data da execução\" só vale para a semana ou o mês em curso.", "period")
    if (period.mode === "RELATIVE_DAYS" && period.fromOffset > period.toOffset) issue("O início do período vem depois do fim.", "period")
    if (period.mode === "RELATIVE_DAYS" && period.toOffset - period.fromOffset + 1 > MAX_RECORD_PERIOD_DAYS) issue("Período de datas maior que 12 meses.", "period")
    if (period.mode === "FIXED_DATES" && period.from > period.to) issue("A data inicial vem depois da final.", "period")
    if (period.mode === "FIXED_DATES" && period.from <= period.to && dayDiff(period.from, period.to) + 1 > MAX_RECORD_PERIOD_DAYS) issue("Período de datas maior que 12 meses.", "period")
    const termIssue = termFieldIssue(definition.tool, definition.queryArgs)
    if (termIssue) issue(termIssue, "queryArgs")
    if (definition.queryArgs && !recordTool && definition.tool !== "SPAN") issue("Parâmetros livres só valem para consultas de registros e span.", "queryArgs")
    if (definition.tool === "INDICATOR_DIAGNOSIS") {
      if (definition.indicators.length !== 1) issue("O diagnóstico analisa um indicador.", "indicators")
      if (definition.period.mode !== "LAST_CLOSED" && definition.period.mode !== "FIXED_MONTH") issue("O diagnóstico usa uma competência fechada.", "period")
    }
    if (definition.period.mode === "CURRENT" && definition.tool !== "INDICATOR_QUERY") issue("O período em curso vale para a consulta de indicadores.", "period")
    if (definition.groupBy === "COMPETENCIA" && definition.period.mode !== "LAST_N_CLOSED") issue("Evolução mês a mês precisa de várias competências.", "groupBy")
  })

export type ReportDefinition = z.infer<typeof reportDefinitionSchema>

export const VISUALIZATION_TYPES = ["TABLE", "KPI", "BAR", "LINE", "AREA", "DISTRIBUTION"] as const
export type VisualizationType = (typeof VISUALIZATION_TYPES)[number]
export const reportVisualizationSchema = z.object({
  type: z.enum(VISUALIZATION_TYPES),
  /** Coluna (chave do cartão) usada como métrica do gráfico; ausente = a sugerida pelo formato dos dados. */
  metric: z.string().min(1).max(60).optional(),
})
export type ReportVisualization = z.infer<typeof reportVisualizationSchema>

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const
export const reportScheduleSchema = z
  .object({
    frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
    times: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(4),
    weekdays: z.array(z.enum(WEEKDAYS)).max(7).optional(),
    /** Dia do mês (1–31) ou "LAST" (último dia). */
    dayOfMonth: z.union([z.number().int().min(1).max(31), z.literal("LAST")]).optional(),
    /** Mês sem o dia escolhido (ex.: 31 em abril): pular aquele mês ou usar o último dia — escolha explícita. */
    onMissingDay: z.enum(["SKIP", "LAST_DAY"]).optional(),
  })
  .superRefine((schedule, context) => {
    if (schedule.frequency === "WEEKLY" && (!schedule.weekdays || schedule.weekdays.length === 0)) context.addIssue({ code: "custom", message: "Escolha ao menos um dia da semana.", path: ["weekdays"] })
    if (schedule.frequency === "MONTHLY" && schedule.dayOfMonth === undefined) context.addIssue({ code: "custom", message: "Escolha o dia do mês.", path: ["dayOfMonth"] })
    if (schedule.frequency === "MONTHLY" && typeof schedule.dayOfMonth === "number" && schedule.dayOfMonth > 28 && !schedule.onMissingDay) context.addIssue({ code: "custom", message: "Diga o que fazer nos meses sem esse dia.", path: ["onMissingDay"] })
  })
export type ReportSchedule = z.infer<typeof reportScheduleSchema>

export const PLATFORM_LEVELS = ["OPERATOR", "SUPERVISOR", "COORDINATOR", "MANAGER", "SENIOR_MANAGER", "DIRECTOR"] as const
export const reportAudienceSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("SELF") }),
  z
    .object({
      mode: z.literal("DISTRIBUTION"),
      everyone: z.boolean().default(false),
      levels: z.array(z.enum(PLATFORM_LEVELS)).max(6).default([]),
      jobTitles: z.array(z.string().min(1).max(120)).max(50).default([]),
      teamIds: z.array(z.string().uuid()).max(100).default([]),
      subteamIds: z.array(z.string().uuid()).max(200).default([]),
      personIds: z.array(z.string().uuid()).max(500).default([]),
    })
    .refine((audience) => audience.everyone || audience.levels.length + audience.jobTitles.length + audience.teamIds.length + audience.subteamIds.length + audience.personIds.length > 0, { message: "Escolha ao menos um público." }),
])
export type ReportAudience = z.infer<typeof reportAudienceSchema>

export const reportAnalysisSchema = z.object({ enabled: z.boolean().default(true), comparison: z.boolean().default(true) })
export type ReportAnalysisConfig = z.infer<typeof reportAnalysisSchema>

/**
 * Argumentos da ferramenta do chat para uma definição. `periodOverride` = período já resolvido: o mês ou as datas da execução
 * (registros, ver `resolveRecordPeriod`) ou a consulta de referência da comparação.
 */
export function toToolCall(definition: ReportDefinition, periodOverride?: { month?: string; months?: number; dates?: { from: string; to: string } }): { name: string; args: Record<string, unknown> } {
  const args: Record<string, unknown> = {}
  const period = definition.period
  if (definition.tool === "SPAN" || isRecordTool(definition.tool)) {
    for (const [key, value] of Object.entries(definition.queryArgs ?? {})) if (!(RESERVED_QUERY_ARGS as readonly string[]).includes(key)) args[key] = value
    if (definition.structure.mode === "FIXED") {
      args.subject_kind = definition.structure.subjectKind
      args.subject_id = definition.structure.subjectId
    }
    if (isRecordTool(definition.tool)) {
      const dates = periodOverride?.dates ?? (period.mode === "FIXED_DATES" ? { from: period.from, to: period.to } : undefined)
      const month = periodOverride?.month ?? (period.mode === "FIXED_MONTH" ? period.month : undefined)
      if (dates) {
        args.data_inicio = dates.from
        args.data_fim = dates.to
      } else if (month) {
        args.competencia = month
      }
    }
    return { name: TOOL_NAME_BY_REPORT_TOOL[definition.tool], args }
  }
  if (definition.structure.mode === "FIXED") {
    args.subject_kind = definition.structure.subjectKind
    args.subject_id = definition.structure.subjectId
  }
  if (definition.tool === "INDICATOR_QUERY") {
    if (definition.indicators.length > 0) args.indicadores = definition.indicators
    if (definition.view) args.visao = definition.view
    if (definition.groupBy) args.agrupar_por = definition.groupBy
    if (definition.situation) args.situacao = definition.situation
    if (definition.quartiles && definition.quartiles.length > 0) args.quartis = definition.quartiles
    if (definition.minBelowIndicators) args.minimo_indicadores_fora = definition.minBelowIndicators
    if (definition.sortBy) args.ordenar_por = definition.sortBy
    if (definition.order) args.ordem = definition.order
    args.limite = definition.limit
    if (period.mode === "CURRENT") {
      args.fonte = "OPERACIONAL"
      args.janela = period.window
    } else if (period.mode === "LAST_N_CLOSED") {
      args.ultimas_competencias = periodOverride?.months ?? period.months
      args.periodos_como = period.display
    }
  } else if (definition.tool === "WORKFORCE") {
    if (definition.groupBy && definition.groupBy !== "PESSOA" && definition.groupBy !== "COMPETENCIA") args.agrupar_por = definition.groupBy
    if (definition.statuses && definition.statuses.length > 0) args.situacoes = definition.statuses
    if (definition.listPeople) args.listar_pessoas = true
    if (definition.includeLeaders) args.incluir_lideres = true
    args.limite = definition.limit
  } else {
    args.indicador = definition.indicators[0]
    if (definition.compare) args.comparar = definition.compare
    if (definition.level) args.nivel = definition.level
    if (definition.interactionMonths) args.meses_de_interacoes = definition.interactionMonths
  }
  const month = periodOverride?.month ?? (period.mode === "FIXED_MONTH" ? period.month : undefined)
  if (month && period.mode !== "CURRENT" && period.mode !== "TODAY") args.competencia = month
  return { name: TOOL_NAME_BY_REPORT_TOOL[definition.tool], args }
}

/**
 * Fontes de dados que a definição usa (para a regra de atualização). `PLATFORM_RECORDS` = registros gravados pela própria
 * plataforma (organograma, monitoria, feedbacks, casos, escala, comunicados, uso da INIA, Anjo), sem carga nem marca d'água
 * própria: são consultados a cada execução e a decisão de "mudou ou não" fica com a impressão digital do resultado.
 */
export type ReportSource = "OFFICIAL_INDICATOR_PERFORMANCE" | "PRV_PERFORMANCE" | "INDICATOR_MEASUREMENTS" | "EMPLOYMENT_STATUS" | "INTERACTIONS" | "PLATFORM_RECORDS"

export function requiredSources(definition: ReportDefinition): ReportSource[] {
  if (definition.tool === "WORKFORCE") return ["EMPLOYMENT_STATUS"]
  if (definition.tool === "SPAN") return ["PLATFORM_RECORDS"]
  if (definition.tool === "INTERACTIONS") return ["INTERACTIONS"]
  if (definition.tool === "WORKDAY") return ["INTERACTIONS", "PLATFORM_RECORDS"]
  if (isRecordTool(definition.tool)) return ["PLATFORM_RECORDS"]
  if (definition.tool === "INDICATOR_DIAGNOSIS") return ["OFFICIAL_INDICATOR_PERFORMANCE", "INTERACTIONS"]
  if (definition.period.mode === "CURRENT") return ["INDICATOR_MEASUREMENTS"]
  const usesPrv = definition.indicators.some((code) => code.toUpperCase() === "PRV") || definition.view === "CONSOLIDADO" || (definition.view === "QUARTIS" && definition.indicators.length === 0)
  const usesIndicators = definition.indicators.some((code) => code.toUpperCase() !== "PRV") || definition.indicators.length === 0
  return [...(usesIndicators ? (["OFFICIAL_INDICATOR_PERFORMANCE"] as const) : []), ...(usesPrv ? (["PRV_PERFORMANCE"] as const) : [])]
}

/** Assinatura da consulta (dedupe da oferta no chat e de reports iguais): só o que muda o resultado. */
export function definitionSignature(definition: ReportDefinition): string {
  const normalized = { ...definition, indicators: [...definition.indicators].map((code) => code.toUpperCase()).sort(), quartiles: definition.quartiles ? [...definition.quartiles].sort() : undefined, statuses: definition.statuses ? [...definition.statuses].sort() : undefined, queryArgs: definition.queryArgs ? Object.fromEntries(Object.entries(definition.queryArgs).sort(([a], [b]) => a.localeCompare(b))) : undefined }
  const structure = normalized.structure.mode === "FIXED" ? { mode: "FIXED", subjectKind: normalized.structure.subjectKind, subjectId: normalized.structure.subjectId } : normalized.structure
  return createHash("sha256").update(JSON.stringify({ ...normalized, structure })).digest("hex").slice(0, 32)
}

/** Texto de leitura humana do período (formulário, cartão, análise). */
export function describePeriod(period: ReportDefinition["period"]): string {
  switch (period.mode) {
    case "LAST_CLOSED":
      return "Última competência fechada (recalculada a cada execução)"
    case "LAST_N_CLOSED":
      return `Últimas ${period.months} competências fechadas — ${{ ULTIMA: "a última, com a variação", MEDIA: "média do período", POR_MES: "mês a mês", RECORRENCIA: "recorrência" }[period.display]}`
    case "FIXED_MONTH":
      return `Competência fixa ${period.month.slice(5, 7)}/${period.month.slice(0, 4)}`
    case "CURRENT":
      return { MES_CORRENTE: "Mês em curso até a data da execução (medição diária, parcial)", SEMANA_CORRENTE: "Semana em curso (medição diária, parcial)", ULTIMOS_7_DIAS: "Últimos 7 dias (medição diária)" }[period.window]
    case "TODAY":
      return "Situação na data da execução"
    case "CALENDAR":
      return describeCalendar(period.unit, period.offset, period.toDate === true)
    case "RELATIVE_DAYS":
      return describeRelativeDays(period.fromOffset, period.toOffset)
    case "FIXED_DATES":
      return period.from === period.to ? `Data fixa ${civil(period.from)}` : `Datas fixas ${civil(period.from)} a ${civil(period.to)}`
  }
}

const civil = (day: string) => day.split("-").reverse().join("/")

function describeCalendar(unit: "WEEK" | "MONTH", offset: number, toDate: boolean): string {
  const noun = unit === "WEEK" ? "semana" : "mês"
  if (offset === 0) return toDate ? (unit === "WEEK" ? "Semana em curso até a data da execução" : "Mês em curso até a data da execução") : unit === "WEEK" ? "Semana em curso (segunda a domingo)" : "Mês em curso (inteiro)"
  if (offset === -1) return unit === "WEEK" ? "Semana passada (segunda a domingo)" : "Mês passado (calendário)"
  if (offset === 1) return unit === "WEEK" ? "Próxima semana (segunda a domingo)" : "Próximo mês (calendário)"
  const plural = unit === "WEEK" ? "semanas" : "meses"
  return offset < 0 ? `A ${noun} de ${-offset} ${plural} atrás` : `A ${noun} daqui a ${offset} ${plural}`
}

function describeRelativeDays(fromOffset: number, toOffset: number): string {
  const day = (offset: number) => (offset === 0 ? "hoje" : offset === -1 ? "ontem" : offset === 1 ? "amanhã" : offset < 0 ? `${-offset} dias atrás` : `daqui a ${offset} dias`)
  const length = toOffset - fromOffset + 1
  if (fromOffset === toOffset) return `Um dia: ${day(fromOffset)} (relativo à data da execução)`
  if (toOffset === 0) return `Últimos ${length} dias, até hoje (relativo à data da execução)`
  if (toOffset === -1) return `Últimos ${length} dias completos, até ontem (relativo à data da execução)`
  if (fromOffset === 1) return `Próximos ${length} dias, a partir de amanhã (relativo à data da execução)`
  if (fromOffset === 0) return `Próximos ${length} dias, a partir de hoje (relativo à data da execução)`
  return `De ${day(fromOffset)} a ${day(toOffset)} (relativo à data da execução)`
}

/** Dia civil deslocado (AAAA-MM-DD ± dias), sem fuso: a data da execução já é a local da organização. */
export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const dayDiff = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000)
const mondayOf = (day: string) => shiftDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7))
const shiftMonth = (month: string, months: number) => {
  const [year, number] = month.split("-").map(Number) as [number, number]
  const index = year * 12 + (number - 1) + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`
}
export const lastDayOf = (month: string) => shiftDay(`${shiftMonth(month, 1)}-01`, -1)
const longMonth = (month: string) => {
  const names = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"]
  return `${names[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
}

/** Um período concreto de registros: um mês (competência) ou datas (inclusive). */
export type ConcretePeriod = { month: string } | { dates: { from: string; to: string } }
export type ResolvedRecordPeriod = ConcretePeriod & { key: string; label: string; reference: (ConcretePeriod & { label: string }) | null }

const labelOf = (period: ConcretePeriod) => ("month" in period ? longMonth(period.month) : period.dates.from === period.dates.to ? civil(period.dates.from) : `${civil(period.dates.from)} a ${civil(period.dates.to)}`)
const keyOf = (period: ConcretePeriod) => ("month" in period ? period.month : `${period.dates.from}..${period.dates.to}`)
const withLabel = (period: ConcretePeriod) => ({ ...period, label: labelOf(period) })

/**
 * PERÍODO DE REGISTROS a cada execução: a regra guardada na definição vira o mês ou as datas concretas da data da execução (no
 * fuso da organização) — e a referência equivalente da comparação (o mês anterior; a semana/mês anterior, até o mesmo dia quando
 * "até a data"; ou o mesmo número de dias logo antes). `lastClosedPeriod` = competência fechada mais recente da organização.
 */
export function resolveRecordPeriod(period: ReportDefinition["period"], input: { today: string; lastClosedPeriod: string }): ResolvedRecordPeriod | null {
  const build = (current: ConcretePeriod, reference: ConcretePeriod | null): ResolvedRecordPeriod => ({ ...current, key: keyOf(current), label: labelOf(current), reference: reference ? withLabel(reference) : null })
  const daysBefore = (from: string, to: string): ConcretePeriod => {
    const length = dayDiff(from, to) + 1
    return { dates: { from: shiftDay(from, -length), to: shiftDay(to, -length) } }
  }
  switch (period.mode) {
    case "LAST_CLOSED":
      return build({ month: input.lastClosedPeriod }, { month: shiftMonth(input.lastClosedPeriod, -1) })
    case "FIXED_MONTH":
      return build({ month: period.month }, { month: shiftMonth(period.month, -1) })
    case "FIXED_DATES":
      return build({ dates: { from: period.from, to: period.to } }, daysBefore(period.from, period.to))
    case "RELATIVE_DAYS": {
      const from = shiftDay(input.today, period.fromOffset)
      const to = shiftDay(input.today, period.toOffset)
      return build({ dates: { from, to } }, daysBefore(from, to))
    }
    case "CALENDAR": {
      if (period.unit === "MONTH") {
        const month = shiftMonth(input.today.slice(0, 7), period.offset)
        if (!period.toDate) return build({ month }, { month: shiftMonth(month, -1) })
        const previous = shiftMonth(month, -1)
        const sameDay = `${previous}-${input.today.slice(8, 10)}`
        return build({ dates: { from: `${month}-01`, to: input.today } }, { dates: { from: `${previous}-01`, to: sameDay > lastDayOf(previous) ? lastDayOf(previous) : sameDay } })
      }
      const monday = shiftDay(mondayOf(input.today), period.offset * 7)
      if (period.toDate) return build({ dates: { from: monday, to: input.today } }, { dates: { from: shiftDay(monday, -7), to: shiftDay(input.today, -7) } })
      return build({ dates: { from: monday, to: shiftDay(monday, 6) } }, { dates: { from: shiftDay(monday, -7), to: shiftDay(monday, -1) } })
    }
    default:
      return null
  }
}

/**
 * O caminho inverso, na proposta do chat: o período que a ferramenta de registros EXECUTOU vira a regra relativa equivalente.
 * Competência padrão/recente → última fechada; mês em curso ou próximo → mês do calendário; semana segunda–domingo ou mês inteiro
 * por datas → calendário; datas que terminam hoje/ontem ou começam hoje/amanhã → dias relativos; o resto (datas antigas
 * explícitas, mês antigo) fica FIXO.
 */
export function recordPeriodFromArgs(args: { competencia?: unknown; data_inicio?: unknown; data_fim?: unknown }, input: { today: string; lastClosedPeriod: string }): ReportDefinition["period"] | null {
  const isDate = isCivilDate
  // Data com formato de data que não existe no calendário (ex.: 2026-02-31): não é reproduzível — sem proposta.
  const looksLikeDate = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
  if ((looksLikeDate(args.data_inicio) && !isDate(args.data_inicio)) || (looksLikeDate(args.data_fim) && !isDate(args.data_fim))) return null
  if (isDate(args.data_inicio) || isDate(args.data_fim)) {
    if (!isDate(args.data_inicio) || !isDate(args.data_fim) || args.data_fim < args.data_inicio) return null
    const from = args.data_inicio
    const to = args.data_fim
    const currentMonth = input.today.slice(0, 7)
    // Mês ou semana do calendário (inteiros ou "até hoje").
    if (from.endsWith("-01") && to === lastDayOf(from.slice(0, 7))) {
      const offset = monthsBetween(currentMonth, from.slice(0, 7))
      if (Math.abs(offset) <= 12 && offset >= -1) return { mode: "CALENDAR", unit: "MONTH", offset }
    }
    if (from === `${currentMonth}-01` && to === input.today && from !== to) return { mode: "CALENDAR", unit: "MONTH", offset: 0, toDate: true }
    const monday = mondayOf(input.today)
    if (mondayOf(from) === from && to === shiftDay(from, 6)) {
      const offset = dayDiff(monday, from) / 7
      if (offset >= -1 && offset <= 1) return { mode: "CALENDAR", unit: "WEEK", offset }
    }
    if (from === monday && to === input.today && from !== to) return { mode: "CALENDAR", unit: "WEEK", offset: 0, toDate: true }
    const fromOffset = dayDiff(input.today, from)
    const toOffset = dayDiff(input.today, to)
    if ((toOffset === 0 || toOffset === -1 || fromOffset === 0 || fromOffset === 1) && toOffset - fromOffset + 1 <= MAX_RECORD_PERIOD_DAYS) return { mode: "RELATIVE_DAYS", fromOffset, toOffset }
    if (dayDiff(from, to) + 1 > MAX_RECORD_PERIOD_DAYS) return null
    return { mode: "FIXED_DATES", from, to }
  }
  const month = typeof args.competencia === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(args.competencia) ? args.competencia : null
  if (!month) return { mode: "LAST_CLOSED" }
  const recent = new Set([input.lastClosedPeriod, shiftMonth(input.lastClosedPeriod, -1), shiftMonth(input.lastClosedPeriod, -2)])
  if (recent.has(month)) return { mode: "LAST_CLOSED" }
  const offset = monthsBetween(input.today.slice(0, 7), month)
  if (month > input.lastClosedPeriod && offset >= -1 && offset <= 12) return { mode: "CALENDAR", unit: "MONTH", offset }
  return { mode: "FIXED_MONTH", month }
}

function monthsBetween(from: string, to: string): number {
  const index = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
  return index(to) - index(from)
}
