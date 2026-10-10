import { z } from "zod"

/**
 * CAPACIDADES DE INVESTIGAÇÃO — o que o admin liga no Agent ("Ferramentas de investigação").
 *
 * A UI nunca mostra as Tools técnicas: mostra estas 7 capacidades amigáveis; cada uma libera um
 * conjunto de Tools internas (ver tool-catalog.ts). O Agent é o DONO das capacidades; o Workflow
 * só pode RESTRINGIR (interseção) para uma execução; Chat/Avatar usam as do Agent como estão.
 */
export const INVESTIGATION_CAPABILITIES = [
  "INDICATOR_ANALYSIS",
  "SEGMENTATION",
  "OPERATIONAL_COMPARISON",
  "INTERACTION_ANALYSIS",
  "WORK_CONTEXT",
  "KNOWLEDGE",
  "SUPPORT_MATERIALS",
] as const
export type InvestigationCapability = (typeof INVESTIGATION_CAPABILITIES)[number]
export const investigationCapabilitySchema = z.enum(INVESTIGATION_CAPABILITIES)

export const INVESTIGATION_CAPABILITY_LABELS: Record<InvestigationCapability, string> = {
  INDICATOR_ANALYSIS: "Indicadores e tendências",
  SEGMENTATION: "Segmentação operacional",
  OPERATIONAL_COMPARISON: "Comparação operacional",
  INTERACTION_ANALYSIS: "Interações e transcrições",
  WORK_CONTEXT: "Jornada operacional",
  KNOWLEDGE: "Base de Conhecimento",
  SUPPORT_MATERIALS: "Materiais de apoio",
}

/** Normaliza uma lista vinda do banco/UI: só valores do catálogo, sem duplicata, na ordem canônica. */
export function normalizeCapabilities(values: readonly unknown[] | null | undefined): InvestigationCapability[] {
  const set = new Set<InvestigationCapability>()
  for (const value of values ?? []) {
    const parsed = investigationCapabilitySchema.safeParse(value)
    if (parsed.success) set.add(parsed.data)
  }
  return INVESTIGATION_CAPABILITIES.filter((capability) => set.has(capability))
}

/**
 * effectiveCapabilities = agentCapabilities ∩ workflowAllowedCapabilities.
 * `allowed` ausente (node antigo sem override, chat, teste manual) = as do Agent. O Workflow
 * NUNCA concede capacidade ausente no Agent.
 */
export function effectiveCapabilities(agentCapabilities: readonly InvestigationCapability[], allowed?: readonly InvestigationCapability[] | null): InvestigationCapability[] {
  const own = normalizeCapabilities(agentCapabilities)
  if (allowed === undefined || allowed === null) return own
  const permitted = new Set(normalizeCapabilities(allowed))
  return own.filter((capability) => permitted.has(capability))
}
