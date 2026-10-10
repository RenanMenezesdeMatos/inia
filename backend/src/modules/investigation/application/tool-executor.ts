import { DomainError } from "../../../shared/domain/domain-error.js"
import type { ToolDefinition } from "../domain/tool-catalog.js"
import type { ToolResult } from "../domain/tool-output.js"
import type { ToolContext } from "./tool-context.js"
import { comparePeriods, comparePopulation, detectIndicatorAnomalies, getAvailableDimensions, getEmployeeHistory, getIndicatorSnapshot, inspectIndicatorComposition, segmentIndicator, validateDataQuality } from "./tools/indicator-tools.js"
import { analyzeInteractions, analyzePeerPatterns, findComparableInteractions, findInteractions, getInteractionContext, getInteractionFlags } from "./tools/interaction-tools.js"
import { inspectWorkContext, queryKnowledge, recommendSupportMaterials, synthesizeEvidence } from "./tools/context-tools.js"

/** Argumentos inválidos = REJEIÇÃO devolvida ao modelo (nunca uma execução "aproximada"). */
export class ToolArgumentError extends DomainError {
  constructor(message: string) {
    super(message, "TOOL_INVALID_ARGUMENTS", 422)
  }
}

/** Valida pelos schemas do catálogo e despacha — TODAS as Tools são somente leitura. */
export async function executeTool(context: ToolContext, tool: ToolDefinition, rawArgs: unknown): Promise<ToolResult> {
  const parsed = tool.inputSchema.safeParse(rawArgs ?? {})
  if (!parsed.success) throw new ToolArgumentError(`Argumentos inválidos para ${tool.key}: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`).join("; ")}`)
  const args = parsed.data as never
  switch (tool.key) {
    case "get_indicator_snapshot":
      return getIndicatorSnapshot(context, args)
    case "compare_periods":
      return comparePeriods(context, args)
    case "get_available_dimensions":
      return getAvailableDimensions(context, args)
    case "segment_indicator":
      return segmentIndicator(context, args)
    case "compare_population":
      return comparePopulation(context, args)
    case "inspect_indicator_composition":
      return inspectIndicatorComposition(context, args)
    case "validate_data_quality":
      return validateDataQuality(context, args)
    case "detect_anomalies":
      return detectIndicatorAnomalies(context, args)
    case "get_employee_history":
      return getEmployeeHistory(context, args)
    case "find_interactions":
      return findInteractions(context, args)
    case "get_interaction_context":
      return getInteractionContext(context, args)
    case "get_interaction_flags":
      return getInteractionFlags(context, args)
    case "find_comparable_interactions":
      return findComparableInteractions(context, args)
    case "analyze_interactions":
      return analyzeInteractions(context, args)
    case "analyze_peer_patterns":
      return analyzePeerPatterns(context, args)
    case "inspect_work_context":
      return inspectWorkContext(context, args)
    case "query_knowledge":
      return queryKnowledge(context, args)
    case "recommend_support_materials":
      return recommendSupportMaterials(context, args)
    case "synthesize_evidence":
      return synthesizeEvidence(context, args)
  }
}
