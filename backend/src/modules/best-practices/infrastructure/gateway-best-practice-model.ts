import { generateForRoute, type GatewayRequest, type GatewayResponse } from "../../../shared/application/model-routing/llm-gateway.js"
import type { ModelProfile } from "../../../shared/application/model-routing/model-profile.js"
import type { RouteDecision } from "../../../shared/application/model-routing/route-policy.js"
import { ModelOutputContractError } from "../../../shared/domain/model-output-contract-error.js"
import type { BestPracticeModelPort, BestPracticeStage } from "../application/ports.js"

/**
 * ADAPTER DE MODELO da base de boas práticas — o gateway único (uso, custo, orçamento, telemetria, policy da organização quando
 * existir), Use Case BEST_PRACTICE_ANALYSIS. Rota FIXA por etapa, sem fallback nem escalação; nenhuma nova tentativa aqui (quem
 * repete falha transitória é o orçamento da análise, que conta cada tentativa).
 *   DISCOVERY        → stage:BEST_PRACTICE_DISCOVERY  (hipóteses a partir das chamadas dos dois grupos)
 *   CODING           → stage:BEST_PRACTICE_CODING     (codificação cega, lote de até 4 chamadas)
 *   OBLIGATION_CHECK → stage:BEST_PRACTICE_OBLIGATION (candidato × fontes oficiais)
 */
export const BEST_PRACTICE_MODEL = "gemini-3.8-flash"
const PROFILE: ModelProfile = { id: "best-practices", provider: "GEMINI", model: BEST_PRACTICE_MODEL, tier: "STANDARD", contextWindow: 1_000_000, maxOutput: 65_536, supportsTools: false, supportsStructuredOutput: true, supportsReasoning: true, supportsPromptCache: false, enabled: true }

const ROUTES: Record<BestPracticeStage, { timeoutMs: number; maxOutputTokens: number; tag: string }> = {
  DISCOVERY: { timeoutMs: 180_000, maxOutputTokens: 16_384, tag: "stage:BEST_PRACTICE_DISCOVERY" },
  CODING: { timeoutMs: 120_000, maxOutputTokens: 16_384, tag: "stage:BEST_PRACTICE_CODING" },
  OBLIGATION_CHECK: { timeoutMs: 180_000, maxOutputTokens: 12_288, tag: "stage:BEST_PRACTICE_OBLIGATION" },
}

export function bestPracticeRoute(stage: BestPracticeStage): RouteDecision {
  return { profile: PROFILE, tier: "STANDARD", reason: `boas práticas · ${stage} — modelo fixo, sem roteamento, fallback ou escalação`, mode: "CURRENT", escalated: false, fallback: false, purpose: "BEST_PRACTICE_ANALYSIS" }
}

export function createGatewayBestPracticeModel(deps: { generate?: (request: GatewayRequest) => Promise<GatewayResponse> } = {}): BestPracticeModelPort {
  const generate = deps.generate ?? generateForRoute
  return {
    async generate(request) {
      const route = ROUTES[request.stage]
      const response = await generate({
        systemPrompt: request.systemPrompt,
        contents: [{ role: "user", text: request.userText }],
        tools: [],
        structuredOutput: true,
        route: bestPracticeRoute(request.stage),
        transport: { timeoutMs: route.timeoutMs, retries: 0 },
        responseSchema: request.responseSchema,
        maxOutputTokens: route.maxOutputTokens,
        classification: { phase: "SEMANTIC_ANALYSIS", purpose: "BEST_PRACTICE_ANALYSIS", source: "BEST_PRACTICES", semanticType: "BEST_PRACTICE_ANALYSIS", tags: [route.tag, ...(request.tag ? [`step:${request.tag}`] : [])] },
      })
      if (response.kind !== "text") throw new ModelOutputContractError("O modelo respondeu com chamada de ferramenta em vez de JSON.", "BEST_PRACTICE_UNEXPECTED_RESPONSE", { contract: request.stage })
      return {
        text: response.text,
        model: response.model ?? null,
        inputTokens: response.usage.promptTokens,
        outputTokens: response.usage.outputTokens,
        costUsd: response.cost.status === "ESTIMATED_PROVIDER_COST" ? response.cost.totalEstimatedCost : null,
        durationMs: response.durationMs ?? null,
      }
    },
  }
}
