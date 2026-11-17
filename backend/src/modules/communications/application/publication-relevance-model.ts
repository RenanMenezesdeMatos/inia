import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor, type GatewayRequest } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"
import { PUBLICATION_RELEVANCE_VERSION } from "../domain/publication-relevance.js"

/** Uma chamada: o catálogo curto de comunicados/alinhamentos + a pergunta → JSON com os marcadores escolhidos. */
export type PublicationRelevanceModel = (input: { organizationId: string; system: string; user: string }) => Promise<string>

/** Prazo curto: corre junto do esclarecimento pelas bases (~7 s na mediana) e nunca pode segurar a resposta além dele. */
export const PUBLICATION_RELEVANCE_TIMEOUT_MS = 20_000

/**
 * Produção: o gateway único (uso/custo registrados, policy da organização), no Use Case do esclarecimento pelas bases
 * (`KNOWLEDGE_CLARIFICATION`, etapa `stage:PUBLICATIONS`) — é a mesma decisão de "de onde vem a resposta", na mesma fase.
 */
export const gatewayPublicationRelevanceModel: PublicationRelevanceModel = async (input) => {
  const call = async () => {
    const route = routeFor({ purpose: "KNOWLEDGE_CLARIFICATION", phase: "KNOWLEDGE", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(input.system, input.user) })
    const request: GatewayRequest = {
      classification: { phase: "KNOWLEDGE", purpose: "KNOWLEDGE_CLARIFICATION", source: "CHAT", semanticType: "KNOWLEDGE_CLARIFICATION", tags: ["stage:PUBLICATIONS", `contract:${PUBLICATION_RELEVANCE_VERSION}`] },
      systemPrompt: input.system,
      contents: [{ role: "user", text: input.user }],
      tools: [],
      structuredOutput: true,
      transport: { timeoutMs: PUBLICATION_RELEVANCE_TIMEOUT_MS },
      route,
    }
    const reply = await withLlmScope({ role: "knowledge_clarification", agentId: null }, () => generateForRoute(request))
    return reply.kind === "text" ? reply.text : ""
  }
  return currentAiOrganizationId() === input.organizationId ? call() : runWithAiOrganization(input.organizationId, call)
}
