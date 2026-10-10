/**
 * MODEL ROUTING (V1.2) — abstração provider-agnostic. O domínio conhece PROVEDORES (enum),
 * TIERS (BASIC/STANDARD/DEEP) e PERFIS (um modelo concreto com suas capacidades); nunca um
 * `if (gemini…)` espalhado. Amanhã BASIC → modelo local, STANDARD → Gemini, DEEP → outro provedor
 * é configuração de perfis, não mudança em Agent/Workflow.
 */
export const MODEL_PROVIDERS = ["GEMINI", "OPENAI", "XAI", "ANTHROPIC", "LOCAL"] as const
export type ModelProvider = (typeof MODEL_PROVIDERS)[number]

export const MODEL_TIERS = ["BASIC", "STANDARD", "DEEP"] as const
export type ModelTier = (typeof MODEL_TIERS)[number]

export type ModelProfile = {
  id: string
  provider: ModelProvider
  model: string
  tier: ModelTier
  /** Janela de contexto (tokens) quando conhecida/configurada — null = não informada. */
  contextWindow: number | null
  maxOutput: number | null
  supportsTools: boolean
  supportsStructuredOutput: boolean
  supportsReasoning: boolean
  supportsPromptCache: boolean
  enabled: boolean
}

/** Requisitos de uma fase: o roteador nunca escolhe um perfil que não sustente o contrato. */
export type PhaseRequirements = { tools?: boolean; structuredOutput?: boolean; estimatedInputTokens?: number }

export function profileSupports(profile: ModelProfile, requirements: PhaseRequirements): { ok: true } | { ok: false; reason: string } {
  if (!profile.enabled) return { ok: false, reason: "perfil desabilitado" }
  if (requirements.tools && !profile.supportsTools) return { ok: false, reason: "não suporta function calling" }
  if (requirements.structuredOutput && !profile.supportsStructuredOutput) return { ok: false, reason: "não suporta saída estruturada" }
  if (requirements.estimatedInputTokens && profile.contextWindow !== null && requirements.estimatedInputTokens > profile.contextWindow) return { ok: false, reason: `contexto estimado (${requirements.estimatedInputTokens}) acima da janela (${profile.contextWindow})` }
  return { ok: true }
}

export function nextTier(tier: ModelTier): ModelTier | null {
  return tier === "BASIC" ? "STANDARD" : tier === "STANDARD" ? "DEEP" : null
}
