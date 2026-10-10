import { COMPARATOR_LABELS, NODE_TYPE_LABELS, OUTPUT_SURFACE_LABELS, type Comparator, type FlowNodeType, type HumanReviewDecision, type OutputSurface } from "@/schemas/admin/workflow-graph.schema"
import { formatNumber } from "../qa-lab-format"

export const DECISION_LABELS: Record<HumanReviewDecision, string> = { approved: "Aprovar", rejected: "Reprovar", escalated: "Escalar" }

export const BRANCH_LABELS: Record<string, string> = { true: "TRUE", false: "FALSE", no_data: "SEM DADOS", approved: "Aprovado", rejected: "Reprovado", escalated: "Escalar" }

export function surfaceLabel(surface: string): string {
  return (OUTPUT_SURFACE_LABELS as Record<string, string>)[surface as OutputSurface] ?? surface
}

export function comparatorLabel(comparator: unknown): string {
  return typeof comparator === "string" ? ((COMPARATOR_LABELS as Record<string, string>)[comparator as Comparator] ?? comparator) : "?"
}

export function nodeTypeLabel(type: string): string {
  return (NODE_TYPE_LABELS as Record<string, string>)[type as FlowNodeType] ?? type
}

export function scalar(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") return formatNumber(value, 2)
  if (typeof value === "boolean") return value ? "Verdadeiro" : "Falso"
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

export const AGGREGATION_LABELS: Record<string, string> = { AVERAGE: "Média simples", WEIGHTED_AVERAGE: "Média ponderada", SUM: "Soma", LATEST: "Último valor", MINIMUM: "Mínimo", MAXIMUM: "Máximo", COUNT: "Contagem" }
