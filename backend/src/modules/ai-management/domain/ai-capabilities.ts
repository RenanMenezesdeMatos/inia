/**
 * CAPACIDADES de modelo (§20, §67, §72–74, §76). Vocabulário único usado por Use Case (requisito),
 * Modelo (o que suporta, com ORIGEM da afirmação) e Provider (o que o protocolo do adapter consegue
 * transportar). Nunca "certeza fingida": capacidade ausente no mapa = desconhecida = NÃO elegível
 * para um Use Case que a exige.
 */
export const AI_CAPABILITIES = ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING", "REASONING", "VISION", "AUDIO", "PROMPT_CACHE"] as const
export type AiCapability = (typeof AI_CAPABILITIES)[number]

/** DISCOVERED = informado pela API do provider; MANUAL = declarado pelo admin; INFERRED = deduzido pela INIA (ex.: família conhecida). */
export const CAPABILITY_SOURCES = ["DISCOVERED", "MANUAL", "INFERRED"] as const
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number]

export type CapabilityClaim = { supported: boolean; source: CapabilitySource }
export type ModelCapabilities = Partial<Record<AiCapability, CapabilityClaim>>

/**
 * Natureza do modelo (§76). V1 só roteia GENERATIVE; EMBEDDING/CLASSIFICATION/DECISION existem no
 * vocabulário para um provider especializado futuro (ex.: um "decision provider") sem abstração
 * prematura — nenhum runtime os usa hoje.
 */
export const AI_MODEL_KINDS = ["GENERATIVE", "EMBEDDING", "CLASSIFICATION", "DECISION"] as const
export type AiModelKind = (typeof AI_MODEL_KINDS)[number]
export const ROUTABLE_MODEL_KINDS: readonly AiModelKind[] = ["GENERATIVE"]

/** Tier declarado pelo ADMIN (§27): única base de QUALITY_FIRST enquanto não há benchmark medido. */
export const AI_QUALITY_TIERS = ["BASIC", "STANDARD", "DEEP"] as const
export type AiQualityTier = (typeof AI_QUALITY_TIERS)[number]
export const QUALITY_TIER_RANK: Record<AiQualityTier, number> = { BASIC: 0, STANDARD: 1, DEEP: 2 }

export function supportsCapability(capabilities: ModelCapabilities, capability: AiCapability): boolean {
  return capabilities[capability]?.supported === true
}

export function missingCapabilities(capabilities: ModelCapabilities, required: readonly AiCapability[]): AiCapability[] {
  return required.filter((capability) => !supportsCapability(capabilities, capability))
}

/** Mescla descoberta com o que já existe: declaração MANUAL do admin nunca é sobrescrita por descoberta/inferência. */
export function mergeCapabilities(current: ModelCapabilities, discovered: ModelCapabilities): ModelCapabilities {
  const merged: ModelCapabilities = { ...current }
  for (const capability of AI_CAPABILITIES) {
    const incoming = discovered[capability]
    if (!incoming) continue
    if (current[capability]?.source === "MANUAL") continue
    merged[capability] = incoming
  }
  return merged
}
