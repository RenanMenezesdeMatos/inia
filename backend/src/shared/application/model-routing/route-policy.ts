import type { LlmPhase } from "../llm-telemetry.js"
import { nextTier, profileSupports, type ModelProfile, type ModelTier, type PhaseRequirements } from "./model-profile.js"
import { profilesForTier } from "./model-registry.js"

/**
 * POLÍTICA DE ROTA — determinística, a partir de sinais do runtime (nunca um LLM decide qual
 * LLM usar). Dois modos: CURRENT (espelha o que a V1.1 já faz: planejamento no STANDARD,
 * análise semântica/síntese no BASIC) e EFFICIENCY (planejamento no BASIC; análise semântica e
 * sínteses no STANDARD; DEEP quando os sinais indicam complexidade). O modo é configuração
 * (`INIA_MODEL_ROUTING`), o padrão continua CURRENT até o A/B provar ganho.
 */
export type RoutingMode = "CURRENT" | "EFFICIENCY"

export type RoutePurpose = "PLANNING" | "INVESTIGATION_NOTES" | "TOOL_ARGUMENT_GENERATION" | "ANALYZE_INTERACTIONS" | "ANALYZE_PEER_PATTERNS" | "AGENT_SYNTHESIS" | "SPECIALIST_SYNTHESIS" | "ORCHESTRATOR_ROUTING" | "ORCHESTRATOR_SYNTHESIS" | "POST_JOIN_SYNTHESIS" | "GATING_CORRECTION" | "FEEDBACK_WRITING" | "FEEDBACK_ANALYSIS" | "INTERVENTION_WRITING"

export type RouteSignals = {
  purpose: RoutePurpose
  phase: LlmPhase
  estimatedInputTokens?: number
  numberOfTranscripts?: number
  transcriptChars?: number
  specialistCount?: number
  toolSchemaCount?: number
  structuredOutputComplexity?: "NONE" | "SIMPLE" | "COMPLEX"
  knowledgeChunkCount?: number
  crossDomain?: boolean
  evidenceConflict?: boolean
  gatingRetry?: boolean
  previousParseFailure?: boolean
}

export type RouteDecision = {
  profile: ModelProfile
  tier: ModelTier
  /** Razão legível e curta (telemetria do QA Lab). */
  reason: string
  mode: RoutingMode
  escalated: boolean
  fallback: boolean
  /** Propósito que originou a rota — base do Use Case da policy da organização (AI Providers V1). Ausente em rotas montadas à mão (testes antigos). */
  purpose?: RoutePurpose
}

const DEEP_TRANSCRIPTS = 6
const DEEP_TRANSCRIPT_CHARS = 24_000

/** Tier alvo por propósito e sinais — sem fallback/escalação (isso vem depois). */
export function targetTier(signals: RouteSignals, mode: RoutingMode): { tier: ModelTier; why: string[] } {
  const why: string[] = [signals.purpose.toLowerCase()]
  if (mode === "CURRENT") {
    // Espelho da V1.1: function calling no STANDARD, o resto no BASIC.
    const tier: ModelTier = ["PLANNING", "INVESTIGATION_NOTES", "TOOL_ARGUMENT_GENERATION", "ORCHESTRATOR_ROUTING", "ORCHESTRATOR_SYNTHESIS", "SPECIALIST_SYNTHESIS"].includes(signals.purpose) ? "STANDARD" : "BASIC"
    why.push("modo CURRENT (rotas da V1.1)")
    return { tier, why }
  }
  let tier: ModelTier
  switch (signals.purpose) {
    case "PLANNING":
    case "TOOL_ARGUMENT_GENERATION":
    case "ORCHESTRATOR_ROUTING":
      tier = "BASIC"
      if (signals.toolSchemaCount !== undefined) why.push(`${signals.toolSchemaCount} tool schemas`)
      break
    case "ANALYZE_INTERACTIONS": {
      const complex = (signals.numberOfTranscripts ?? 0) >= DEEP_TRANSCRIPTS || (signals.transcriptChars ?? 0) >= DEEP_TRANSCRIPT_CHARS
      tier = complex ? "DEEP" : "STANDARD"
      why.push(`${signals.numberOfTranscripts ?? 0} transcrições · ${signals.transcriptChars ?? 0} chars`)
      break
    }
    case "ANALYZE_PEER_PATTERNS":
      tier = (signals.numberOfTranscripts ?? 0) >= DEEP_TRANSCRIPTS ? "DEEP" : "STANDARD"
      why.push(`${signals.numberOfTranscripts ?? 0} transcrições de pares`)
      break
    case "ORCHESTRATOR_SYNTHESIS":
      tier = signals.crossDomain || signals.evidenceConflict || (signals.specialistCount ?? 0) >= 3 ? "DEEP" : "STANDARD"
      why.push(`${signals.specialistCount ?? 0} especialistas${signals.crossDomain ? " · multidomínio" : ""}${signals.evidenceConflict ? " · evidência conflitante" : ""}`)
      break
    case "FEEDBACK_WRITING":
      // V1.5.1: o Feedback Writer do piloto usa rota FIXA (adapter Gemini do módulo de feedback por interação);
      // este ramo só existe para a política ser total — nunca é o caminho do Writer.
      tier = "BASIC"
      break
    case "FEEDBACK_ANALYSIS":
      // Motor de feedback: rota FIXA (feedback-engine/infrastructure/gateway-engine-model.ts); ramo só para a política ser total.
      tier = "STANDARD"
      break
    case "INTERVENTION_WRITING":
      // Narrativa do relatório de intervenção e rascunho de treinamento/plano: redação sobre fatos prontos (sem investigação).
      tier = "STANDARD"
      break
    case "INVESTIGATION_NOTES":
    case "AGENT_SYNTHESIS":
    case "SPECIALIST_SYNTHESIS":
    case "POST_JOIN_SYNTHESIS":
    case "GATING_CORRECTION":
      tier = "STANDARD"
      if (signals.structuredOutputComplexity === "COMPLEX") {
        tier = "DEEP"
        why.push("saída estruturada complexa")
      }
      break
  }
  if (signals.gatingRetry || signals.previousParseFailure) {
    const escalated = nextTier(tier)
    if (escalated) {
      tier = escalated
      why.push(signals.gatingRetry ? "retry de gating" : "falha de parse anterior")
    }
  }
  why.push("modo EFFICIENCY")
  return { tier, why }
}

/** Requisitos que cada propósito impõe ao perfil. */
export function requirementsFor(signals: RouteSignals): PhaseRequirements {
  const tools = ["PLANNING", "TOOL_ARGUMENT_GENERATION", "ORCHESTRATOR_ROUTING"].includes(signals.purpose)
  const structuredOutput = ["ANALYZE_INTERACTIONS", "ANALYZE_PEER_PATTERNS", "AGENT_SYNTHESIS", "POST_JOIN_SYNTHESIS", "GATING_CORRECTION", "FEEDBACK_WRITING", "FEEDBACK_ANALYSIS", "INTERVENTION_WRITING"].includes(signals.purpose)
  return { tools, structuredOutput, ...(signals.estimatedInputTokens ? { estimatedInputTokens: signals.estimatedInputTokens } : {}) }
}

/**
 * Escolhe o perfil: tier alvo → primeiro perfil habilitado que suporta o contrato; se nenhum
 * suporta, sobe de tier (nunca desce para um modelo que não sustenta a fase) e registra `fallback`.
 */
export function resolveRoute(signals: RouteSignals, mode: RoutingMode): RouteDecision {
  const target = targetTier(signals, mode)
  const requirements = requirementsFor(signals)
  let tier: ModelTier | null = target.tier
  let fallback = false
  const rejected: string[] = []
  while (tier) {
    for (const profile of profilesForTier(tier)) {
      const check = profileSupports(profile, requirements)
      if (check.ok) {
        const reason = [...target.why, ...rejected, ...(profile.tier === "DEEP" && profile.model === profilesForTier("STANDARD")[0]?.model ? ["DEEP sem modelo próprio configurado (mesmo modelo do STANDARD)"] : [])].join(" · ")
        return { profile, tier: profile.tier, reason, mode, escalated: Boolean(signals.gatingRetry || signals.previousParseFailure), fallback, purpose: signals.purpose }
      }
      rejected.push(`${profile.id}: ${check.reason}`)
    }
    fallback = true
    tier = nextTier(tier)
  }
  throw new Error(`Nenhum perfil de modelo suporta a fase ${signals.purpose} (${rejected.join("; ")}).`)
}

/** Escalação de MODELO (não é retry de rede): sobe um tier a partir da decisão anterior por causa explícita. */
export function escalateRoute(previous: RouteDecision, cause: "PARSE_FAILURE" | "GATING_CORRECTION" | "CAPABILITY_INCOMPATIBLE"): RouteDecision {
  // Modo CURRENT (baseline da V1.1): o retry fica no MESMO tier — a escalação é política do modo EFFICIENCY
  // (medido no A/B: uma correção escalada para o modelo com raciocínio custou ~10k tokens de reasoning).
  if (previous.mode === "CURRENT" && cause !== "CAPABILITY_INCOMPATIBLE") return { ...previous, reason: `${previous.reason} · ${cause.toLowerCase()} (retry no mesmo tier — modo CURRENT)` }
  const target = nextTier(previous.tier)
  if (!target) return { ...previous, reason: `${previous.reason} · ${cause.toLowerCase()} (já no tier máximo)` }
  const requirements: PhaseRequirements = {}
  const candidates = profilesForTier(target).filter((profile) => profileSupports(profile, requirements).ok)
  const profile = candidates[0]
  if (!profile) return { ...previous, reason: `${previous.reason} · ${cause.toLowerCase()} (sem perfil ${target})` }
  return { profile, tier: profile.tier, reason: `${previous.reason} → escalado por ${cause.toLowerCase()}`, mode: previous.mode, escalated: true, fallback: previous.fallback, ...(previous.purpose ? { purpose: previous.purpose } : {}) }
}
