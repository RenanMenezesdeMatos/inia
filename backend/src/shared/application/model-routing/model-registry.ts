import { env } from "../../../config/env.js"
import type { ModelProfile, ModelTier } from "./model-profile.js"

/**
 * REGISTRY DE PERFIS — hoje só o provedor configurado (Gemini). Os perfis padrão espelham o que
 * já roda em produção; `INIA_MODEL_PROFILES` (JSON) pode sobrescrever/acrescentar sem código.
 * DEEP não tem modelo mais forte configurado neste ambiente: aponta para o mesmo modelo do
 * STANDARD e é marcado como tal na razão da rota (nunca fingimos um modelo que não existe).
 */
const DEFAULT_PROFILES: ModelProfile[] = [
  { id: "gemini-flash-lite", provider: "GEMINI", model: "gemini-3.1-flash-lite", tier: "BASIC", contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: false, supportsPromptCache: true, enabled: true },
  { id: "gemini-flash", provider: "GEMINI", model: "gemini-3.8-flash", tier: "STANDARD", contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsPromptCache: true, enabled: true },
  { id: "gemini-flash-deep", provider: "GEMINI", model: "gemini-3.8-flash", tier: "DEEP", contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: true, supportsStructuredOutput: true, supportsReasoning: true, supportsPromptCache: true, enabled: true },
]

let cached: ModelProfile[] | null = null

export function listModelProfiles(): ModelProfile[] {
  if (cached) return cached
  cached = DEFAULT_PROFILES
  const raw = env.INIA_MODEL_PROFILES
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ModelProfile>[]
      const overrides = parsed.filter((item): item is ModelProfile => typeof item.id === "string" && typeof item.model === "string" && typeof item.provider === "string" && typeof item.tier === "string")
      const byId = new Map(DEFAULT_PROFILES.map((profile) => [profile.id, profile]))
      for (const override of overrides) byId.set(override.id, { ...(byId.get(override.id) ?? DEFAULT_PROFILES[0]!), ...override })
      cached = [...byId.values()]
    } catch {
      console.warn(JSON.stringify({ event: "model_profiles_invalid", message: "INIA_MODEL_PROFILES não é JSON válido — usando perfis padrão" }))
    }
  }
  return cached
}

/** Só para testes: substitui os perfis em memória. */
export function setModelProfilesForTests(profiles: ModelProfile[] | null): void {
  cached = profiles
}

export function profilesForTier(tier: ModelTier): ModelProfile[] {
  return listModelProfiles().filter((profile) => profile.tier === tier && profile.enabled)
}
