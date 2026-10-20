import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"

/** Uma chamada da IA no esclarecimento: PLANNER = decidir (esclarecer, responder, faltar); ANSWER = redigir a resposta com fontes. */
export type ClarificationModel = (input: { organizationId: string; stage: "PLANNER" | "ANSWER"; system: string; user: string; correction: boolean }) => Promise<string>

/** Prazo de cada chamada: a decisão com a lista das bases (~20 mil caracteres, às vezes com seções lidas) passou dos 30 s padrão da
 * saída estruturada no teste ao vivo de 20/10/2026 — falhar custa mais que esperar (a escolha pelo formulário viraria erro). */
export const CLARIFICATION_MODEL_TIMEOUT_MS = 60_000

/** Produção: o gateway único (uso/custo registrados, policy de IA da organização quando houver), Use Case KNOWLEDGE_CLARIFICATION. */
export const gatewayClarificationModel: ClarificationModel = async (input) => {
  const call = async () => {
    const route = routeFor({ purpose: "KNOWLEDGE_CLARIFICATION", phase: "KNOWLEDGE", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(input.system, input.user), ...(input.correction ? { previousParseFailure: true } : {}) })
    const reply = await withLlmScope({ role: "knowledge_clarification", agentId: null }, () =>
      generateForRoute({
        // A correção única fica no MESMO Use Case (a policy da organização vale para as duas), marcada pela tag.
        classification: { phase: "KNOWLEDGE", purpose: "KNOWLEDGE_CLARIFICATION", source: "CHAT", semanticType: "KNOWLEDGE_CLARIFICATION", tags: [`stage:${input.stage}`, ...(input.correction ? ["retry:CONTRACT_CORRECTION"] : [])] },
        systemPrompt: input.system,
        contents: [{ role: "user", text: input.user }],
        tools: [],
        structuredOutput: true,
        transport: { timeoutMs: CLARIFICATION_MODEL_TIMEOUT_MS },
        route,
      }),
    )
    return reply.kind === "text" ? reply.text : ""
  }
  return currentAiOrganizationId() === input.organizationId ? call() : runWithAiOrganization(input.organizationId, call)
}
