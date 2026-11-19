import { ApiError } from "@/lib/api/api-client"
import { REPORT_ERROR_MESSAGES } from "../report-labels"
import { isRecordTool, type ReportConfig, type ReportDefinition, type VisualizationType } from "@/schemas/reports/reports.schema"

/** Padrões e regras de tela do formulário de report (o backend revalida tudo). */
export function defaultConfig(input: { canCreateForSelf: boolean }): ReportConfig {
  return {
    name: "",
    description: null,
    definition: { tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: [], groupBy: "PESSOA", limit: 10 },
    visualization: { type: "TABLE" },
    schedule: { frequency: "WEEKLY", times: ["08:00"], weekdays: ["MON"] },
    audience: input.canCreateForSelf ? { mode: "SELF" } : { mode: "DISTRIBUTION", everyone: false, levels: ["SUPERVISOR"], jobTitles: [], teamIds: [], subteamIds: [], personIds: [] },
    analysis: { enabled: true, comparison: true },
  }
}

/** Mesma regra do backend (`staticCompatibility`): evolução só com dimensão temporal; distribuição com faixas; resumo com uma linha. */
export function staticCompatibility(definition: ReportDefinition): VisualizationType[] {
  const types: VisualizationType[] = ["TABLE", "BAR"]
  if (definition.tool === "SPAN" || isRecordTool(definition.tool)) {
    const groupBy = definition.queryArgs?.agrupar_por
    if (groupBy === "DIA" || groupBy === "SEMANA" || groupBy === "MES") types.push("LINE", "AREA")
    if (definition.tool !== "SPAN" && (groupBy === undefined || groupBy === "ESTRUTURA")) types.push("KPI")
    return types
  }
  if (definition.period.mode === "LAST_N_CLOSED" && (definition.period.display === "POR_MES" || definition.groupBy === "COMPETENCIA")) types.push("LINE", "AREA")
  if (definition.view === "QUARTIS" || (definition.tool === "WORKFORCE" && !definition.listPeople)) types.push("DISTRIBUTION")
  const wholeStructure = definition.groupBy === undefined || definition.groupBy === "ESTRUTURA"
  if (definition.groupBy === "ESTRUTURA" || (definition.tool === "WORKFORCE" && wholeStructure && !definition.listPeople)) types.push("KPI")
  return types
}

/** Ajusta a definição ao trocar o tipo de consulta (período e campos que deixam de valer). */
export function switchTool(definition: ReportDefinition, tool: ReportDefinition["tool"]): ReportDefinition {
  const base = { structure: definition.structure, limit: definition.limit, indicators: [] as string[] }
  if (tool === "SPAN") return { ...base, tool, period: { mode: "TODAY" }, queryArgs: {} }
  if (isRecordTool(tool)) return { ...base, tool, period: { mode: "LAST_CLOSED" }, queryArgs: {} }
  if (tool === "WORKFORCE") return { ...base, tool, period: { mode: "TODAY" }, groupBy: "UNIDADE" }
  if (tool === "INDICATOR_DIAGNOSIS") return { ...base, tool, period: { mode: "LAST_CLOSED" }, indicators: definition.indicators.slice(0, 1) }
  return { ...base, tool, period: { mode: "LAST_CLOSED" }, indicators: definition.indicators, groupBy: "PESSOA" }
}

/** Remove os campos opcionais sem valor antes de enviar. */
export function cleanDefinition(definition: ReportDefinition): ReportDefinition {
  return Object.fromEntries(Object.entries(definition).filter(([, value]) => value !== undefined)) as ReportDefinition
}

/** Mensagem de erro do salvar e da prévia: a própria da tela para os códigos conhecidos, senão a do servidor. */
export function reportErrorMessage(cause: unknown): string {
  if (!(cause instanceof ApiError)) return "Não foi possível concluir. Tente de novo."
  return (cause.code && REPORT_ERROR_MESSAGES[cause.code]) || cause.message
}
