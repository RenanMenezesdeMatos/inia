import { generateForRoute, type GatewayRequest, type GatewayResponse } from "../../../shared/application/model-routing/llm-gateway.js"
import type { ModelProfile } from "../../../shared/application/model-routing/model-profile.js"
import type { RouteDecision } from "../../../shared/application/model-routing/route-policy.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import { STAGE_MAX_OUTPUT_TOKENS } from "../application/engine-meter.js"
import type { EngineModelPort, EngineModelRequest } from "../application/ports.js"

/**
 * ADAPTER DE MODELO do motor de feedback — nenhuma infraestrutura própria: o gateway único (uso, custo, orçamento, telemetria,
 * policy da organização quando existir). Rotas FIXAS por etapa, sem fallback nem escalação; nova tentativa só para falha
 * TRANSITÓRIA de transporte (nunca para "tentar outra resposta"). Os modelos abaixo valem SEM policy da organização; com policy
 * ativa para FEEDBACK_ANALYSIS/FEEDBACK_WRITER, o modelo é o da policy e o schema, o teto de saída e o tempo da etapa seguem junto.
 *   CALL_ANALYSIS           → Use Case FEEDBACK_ANALYSIS (gemini-3.8-flash; lê transcrição + procedimento inteiro)
 *   CALL_REVIEW             → Use Case FEEDBACK_ANALYSIS (gemini-3.8-flash; stage:ENGINE_CALL_REVIEW — revisão independente)
 *   CALL_CONFIRMATION       → Use Case FEEDBACK_ANALYSIS (gemini-3.8-flash; stage:ENGINE_CALL_CONFIRMATION — confirmação focal)
 *   INVESTIGATION_PLANNING  → Use Case FEEDBACK_ANALYSIS (gemini-3.8-flash; stage:ENGINE_INVESTIGATION_PLANNING)
 *   PRACTICE_IDENTITY       → Use Case FEEDBACK_ANALYSIS (gemini-3.8-flash; stage:ENGINE_PRACTICE_IDENTITY — regras → práticas)
 *   PRACTICE_THEMES         → Use Case FEEDBACK_ANALYSIS (gemini-3.8-flash; stage:ENGINE_PRACTICE_THEMES — práticas → temas + nome curto)
 *   COMPOSITION             → Use Case FEEDBACK_WRITER  (gemini-3.8-flash; stage:ENGINE_COMPOSITION)
 *   VERIFICATION            → Use Case FEEDBACK_WRITER  (gemini-3.8-flash; stage:ENGINE_VERIFICATION)
 * Nenhuma nova tentativa aqui (retries = 0): quem repete falha transitória é o medidor da execução (engine-meter.ts), que conta
 * cada tentativa no orçamento compartilhado.
 */
export const ENGINE_MODEL = "gemini-3.8-flash"
const PROFILE: ModelProfile = { id: "feedback-engine", provider: "GEMINI", model: ENGINE_MODEL, tier: "STANDARD", contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: false, supportsStructuredOutput: true, supportsReasoning: true, supportsPromptCache: false, enabled: true }

/**
 * `maxOutputTokens` (saída + raciocínio): folga sobre o maior uso normal medido na bateria de avaliação (análise ≈ 5–17 mil;
 * redação/verificação ≈ 2–3 mil). Protege contra resposta degenerada — o modelo repetindo uma frase até o limite de 65 mil
 * tokens (observado com gemini-3.8-flash: 160–190 s perdidos). Resposta cortada = JSON inválido = a nova tentativa de formato.
 */
const ROUTES: Record<EngineModelRequest["stage"], { purpose: "FEEDBACK_ANALYSIS" | "FEEDBACK_WRITING"; timeoutMs: number; maxOutputTokens: number; tag: string; phase: "SEMANTIC_ANALYSIS" | "SYNTHESIS"; semanticType: "PROCESS_AUDIT" | "FEEDBACK" }> = {
  CALL_ANALYSIS: { purpose: "FEEDBACK_ANALYSIS", timeoutMs: 240_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.CALL_ANALYSIS, tag: "stage:ENGINE_CALL_ANALYSIS", phase: "SEMANTIC_ANALYSIS", semanticType: "PROCESS_AUDIT" },
  CALL_REVIEW: { purpose: "FEEDBACK_ANALYSIS", timeoutMs: 120_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.CALL_REVIEW, tag: "stage:ENGINE_CALL_REVIEW", phase: "SEMANTIC_ANALYSIS", semanticType: "PROCESS_AUDIT" },
  CALL_CONFIRMATION: { purpose: "FEEDBACK_ANALYSIS", timeoutMs: 90_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.CALL_CONFIRMATION, tag: "stage:ENGINE_CALL_CONFIRMATION", phase: "SEMANTIC_ANALYSIS", semanticType: "PROCESS_AUDIT" },
  INVESTIGATION_PLANNING: { purpose: "FEEDBACK_ANALYSIS", timeoutMs: 60_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.INVESTIGATION_PLANNING, tag: "stage:ENGINE_INVESTIGATION_PLANNING", phase: "SEMANTIC_ANALYSIS", semanticType: "PROCESS_AUDIT" },
  // Organização das práticas: até 32 mil tokens de saída (o raciocínio consome boa parte) — com 120 s a etapa estourava o tempo em
  // metade das análises reais de 06/10/2026 (cada estouro = reserva cheia no orçamento da execução e 2 min perdidos). Mesmo teto da análise.
  PRACTICE_IDENTITY: { purpose: "FEEDBACK_ANALYSIS", timeoutMs: 240_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.PRACTICE_IDENTITY, tag: "stage:ENGINE_PRACTICE_IDENTITY", phase: "SEMANTIC_ANALYSIS", semanticType: "PROCESS_AUDIT" },
  PRACTICE_THEMES: { purpose: "FEEDBACK_ANALYSIS", timeoutMs: 240_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.PRACTICE_THEMES, tag: "stage:ENGINE_PRACTICE_THEMES", phase: "SEMANTIC_ANALYSIS", semanticType: "PROCESS_AUDIT" },
  // 120 s (06/10/2026): retornos com todos os pontos, formatação e exemplos passaram de 60 s com o provedor lento (portabilidade, 6 pontos).
  COMPOSITION: { purpose: "FEEDBACK_WRITING", timeoutMs: 120_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.COMPOSITION, tag: "stage:ENGINE_COMPOSITION", phase: "SYNTHESIS", semanticType: "FEEDBACK" },
  VERIFICATION: { purpose: "FEEDBACK_WRITING", timeoutMs: 120_000, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.VERIFICATION, tag: "stage:ENGINE_VERIFICATION", phase: "SYNTHESIS", semanticType: "FEEDBACK" },
}

export function engineRoute(stage: EngineModelRequest["stage"]): RouteDecision {
  return { profile: PROFILE, tier: "STANDARD", reason: `motor de feedback · ${stage} — modelo fixo, sem roteamento, fallback ou escalação`, mode: "CURRENT", escalated: false, fallback: false, purpose: ROUTES[stage].purpose }
}

export function createGatewayEngineModel(deps: { generate?: (request: GatewayRequest) => Promise<GatewayResponse> } = {}): EngineModelPort {
  const generate = deps.generate ?? generateForRoute
  return {
    async generate(request) {
      const route = ROUTES[request.stage]
      const response = await generate({
        systemPrompt: request.systemPrompt,
        contents: request.contents,
        tools: [],
        structuredOutput: true,
        route: engineRoute(request.stage),
        transport: { timeoutMs: route.timeoutMs, retries: 0 },
        responseSchema: request.responseSchema,
        maxOutputTokens: route.maxOutputTokens,
        classification: { phase: route.phase, purpose: route.purpose, source: "FEEDBACK_WRITER", semanticType: route.semanticType, tags: [route.tag, ...(request.tag ? [`step:${request.tag}`] : [])] },
      })
      if (response.kind !== "text") throw new ModelOutputContractError("O modelo respondeu com chamada de ferramenta em vez de JSON.", "FEEDBACK_ENGINE_UNEXPECTED_RESPONSE", { contract: request.stage })
      const cost = response.cost.status === "ESTIMATED_PROVIDER_COST" ? response.cost.totalEstimatedCost : null
      return {
        text: response.text,
        model: response.model ?? null,
        usage: { inputTokens: response.usage.promptTokens, outputTokens: response.usage.outputTokens, totalTokens: response.usage.totalTokens },
        durationMs: response.durationMs ?? null,
        costUsd: cost,
        finishReason: response.finishReason ?? null,
      }
    },
  }
}
