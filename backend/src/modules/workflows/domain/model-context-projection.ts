import { TECHNICAL_KEYS } from "../../investigation/domain/handle-registry.js"

/**
 * PROJEÇÃO DE UM nodeOutput PARA O MODELO (V1.2). O Execution Context guarda tudo (AUDIT
 * context: ids, measurementIds, contextSnapshot, toolTrace, investigation…); o que entra num
 * prompt pós-JOIN é só o que tem valor semântico: o texto/estrutura da resposta, hipóteses,
 * limitações e a decisão humana. Nunca trace de Tools, nunca identificadores técnicos.
 */
const DROPPED_KEYS = new Set([...TECHNICAL_KEYS, "toolTrace", "investigation", "contextSnapshot", "evidenceSourceType", "supportMaterialsRejected", "knowledge", "supportMaterialCandidates", "measuredAt", "interactionOccurredAt", "structuredResultValidation", "orchestratorId", "agentId", "materialId", "documentId", "interactionId", "feedbackId", "caseId", "alertId"])

export function projectNodeOutputForModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectNodeOutputForModel)
  if (!value || typeof value !== "object") return value
  const record = value as Record<string, unknown>
  const projected: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (DROPPED_KEYS.has(key)) {
      // A síntese auditável (hipóteses/limitações) do Agent vale para o modelo; o resto do resumo não.
      if (key === "investigation" && raw && typeof raw === "object" && "synthesis" in (raw as object)) {
        const synthesis = (raw as { synthesis?: { supportedHypotheses?: string[]; unsupportedHypotheses?: string[]; limitations?: string[] } }).synthesis
        if (synthesis) projected.evidence = { supportedHypotheses: synthesis.supportedHypotheses ?? [], unsupportedHypotheses: synthesis.unsupportedHypotheses ?? [], limitations: synthesis.limitations ?? [] }
      }
      continue
    }
    projected[key] = projectNodeOutputForModel(raw)
  }
  return projected
}

/** Resultados de um colaborador num fan-in, já projetados (o JSON que o modelo lê). */
export function projectNodeOutputsForModel(nodeOutputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(nodeOutputs).map(([nodeId, output]) => [nodeId, projectNodeOutputForModel(output)]))
}
