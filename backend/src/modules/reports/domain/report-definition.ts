import { createHash } from "node:crypto"
import { z } from "zod"
import { WORKFORCE_STATUS_FILTERS } from "../../leadership-analytics/application/workforce.js"

/**
 * DEFINIÇÃO de um report recorrente — o que reproduz a consulta a cada execução, sem depender de texto de chat nem de resposta
 * antiga da IA. Contrato versionado (`REPORT_DEFINITION_VERSION`): ferramenta da liderança + parâmetros válidos (indicadores por
 * CÓDIGO) + estrutura (FIXA ou "de quem recebe") + período (relativo ou fixo). A execução converte em argumentos da MESMA
 * ferramenta do chat (`toToolCall`) — mesmo cálculo, mesmo escopo.
 */
export const REPORT_DEFINITION_VERSION = 1

export const REPORT_TOOLS = ["INDICATOR_QUERY", "WORKFORCE", "INDICATOR_DIAGNOSIS"] as const
export type ReportTool = (typeof REPORT_TOOLS)[number]

export const TOOL_NAME_BY_REPORT_TOOL: Record<ReportTool, string> = {
  INDICATOR_QUERY: "leadership_indicator_query",
  WORKFORCE: "leadership_workforce",
  INDICATOR_DIAGNOSIS: "leadership_indicator_diagnosis",
}

const structureSchema = z.discriminatedUnion("mode", [
  // "Minha equipe": a estrutura de QUEM RECEBE, resolvida a cada execução (muda com a equipe atual da pessoa).
  z.object({ mode: z.literal("RECIPIENT") }),
  // Uma estrutura específica (liderado, Grupo, Subgrupo) — validada contra o escopo de cada destinatário a cada execução.
  z.object({ mode: z.literal("FIXED"), subjectKind: z.string().min(1).max(60), subjectId: z.string().uuid(), label: z.string().min(1).max(200) }),
])

export const PERIOD_DISPLAYS = ["ULTIMA", "MEDIA", "POR_MES", "RECORRENCIA"] as const
export const CURRENT_WINDOWS = ["MES_CORRENTE", "SEMANA_CORRENTE", "ULTIMOS_7_DIAS"] as const

const periodSchema = z.discriminatedUnion("mode", [
  // Última competência fechada e coberta — recalculada a cada execução.
  z.object({ mode: z.literal("LAST_CLOSED") }),
  // Últimas N competências fechadas, lidas como a última (com variação), a média, mês a mês ou recorrência.
  z.object({ mode: z.literal("LAST_N_CLOSED"), months: z.number().int().min(2).max(6), display: z.enum(PERIOD_DISPLAYS) }),
  // Competência fixa.
  z.object({ mode: z.literal("FIXED_MONTH"), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  // Período em curso pela medição diária (parcial, sem meta oficial).
  z.object({ mode: z.literal("CURRENT"), window: z.enum(CURRENT_WINDOWS) }),
  // Situação funcional na data da execução.
  z.object({ mode: z.literal("TODAY") }),
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
  })
  .superRefine((definition, context) => {
    const issue = (message: string, path: string) => context.addIssue({ code: "custom", message, path: [path] })
    if (definition.tool === "WORKFORCE" && definition.period.mode !== "TODAY") issue("Força de trabalho usa a situação funcional da data da execução.", "period")
    if (definition.tool !== "WORKFORCE" && definition.period.mode === "TODAY") issue("Este período só vale para força de trabalho.", "period")
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

/** Argumentos da ferramenta do chat para uma definição. `periodOverride` = consulta de referência da comparação. */
export function toToolCall(definition: ReportDefinition, periodOverride?: { month?: string; months?: number }): { name: string; args: Record<string, unknown> } {
  const args: Record<string, unknown> = {}
  if (definition.structure.mode === "FIXED") {
    args.subject_kind = definition.structure.subjectKind
    args.subject_id = definition.structure.subjectId
  }
  const period = definition.period
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

/** Fontes de dados que a definição usa (para a regra de atualização). */
export type ReportSource = "OFFICIAL_INDICATOR_PERFORMANCE" | "PRV_PERFORMANCE" | "INDICATOR_MEASUREMENTS" | "EMPLOYMENT_STATUS" | "INTERACTIONS"

export function requiredSources(definition: ReportDefinition): ReportSource[] {
  if (definition.tool === "WORKFORCE") return ["EMPLOYMENT_STATUS"]
  if (definition.tool === "INDICATOR_DIAGNOSIS") return ["OFFICIAL_INDICATOR_PERFORMANCE", "INTERACTIONS"]
  if (definition.period.mode === "CURRENT") return ["INDICATOR_MEASUREMENTS"]
  const usesPrv = definition.indicators.some((code) => code.toUpperCase() === "PRV") || definition.view === "CONSOLIDADO" || (definition.view === "QUARTIS" && definition.indicators.length === 0)
  const usesIndicators = definition.indicators.some((code) => code.toUpperCase() !== "PRV") || definition.indicators.length === 0
  return [...(usesIndicators ? (["OFFICIAL_INDICATOR_PERFORMANCE"] as const) : []), ...(usesPrv ? (["PRV_PERFORMANCE"] as const) : [])]
}

/** Assinatura da consulta (dedupe da oferta no chat e de reports iguais): só o que muda o resultado. */
export function definitionSignature(definition: ReportDefinition): string {
  const normalized = { ...definition, indicators: [...definition.indicators].map((code) => code.toUpperCase()).sort(), quartiles: definition.quartiles ? [...definition.quartiles].sort() : undefined, statuses: definition.statuses ? [...definition.statuses].sort() : undefined }
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
  }
}
