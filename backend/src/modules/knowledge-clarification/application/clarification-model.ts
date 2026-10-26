import { withLlmScope } from "../../../shared/application/llm-telemetry.js"
import { currentAiOrganizationId, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor, streamForRoute, type GatewayRequest } from "../../../shared/application/model-routing/llm-gateway.js"
import { estimateTokens } from "../../../shared/application/model-routing/token-estimate.js"

/**
 * Uma chamada da IA no esclarecimento: PLANNER = decidir (esclarecer, responder, faltar); ANSWER = redigir a resposta com fontes.
 * `onText`: o JSON da resposta entregue em pedaços enquanto chega (o texto inteiro continua sendo o retorno).
 */
export type ClarificationModel = (input: { organizationId: string; stage: "PLANNER" | "ANSWER"; system: string; user: string; correction: boolean; onText?: (text: string) => void }) => Promise<string>

/** Prazo de cada chamada: a decisão com a lista das bases (~20 mil caracteres, às vezes com seções lidas) passou dos 30 s padrão da
 * saída estruturada no teste ao vivo de 20/10/2026 — falhar custa mais que esperar (a escolha pelo formulário viraria erro). */
export const CLARIFICATION_MODEL_TIMEOUT_MS = 60_000

/** Padrão (avaliação ao vivo de 22/10/2026, mesmas perguntas): a REDAÇÃO com raciocínio menor manteve as mesmas seções citadas e
 * caiu de ~11,8 para ~4,7 s; o PLANEJADOR com raciocínio menor ficou ~3× mais rápido, mas escolheu menos seções (a resposta perdeu
 * condições, ex.: a taxa da mudança de endereço) — fica fora do padrão, disponível pelo interruptor. */
const DEFAULT_LOW_REASONING_STAGES: ReadonlySet<"PLANNER" | "ANSWER"> = new Set(["ANSWER"])

/**
 * Etapas que pedem MENOS RACIOCÍNIO ao modelo (`reasoningEffort: "LOW"`): o raciocínio vem antes do primeiro pedaço e é a maior parte
 * do tempo de cada chamada (~55% em 22/10/2026). `INIA_CLARIFICATION_LOW_REASONING` = lista de etapas (`PLANNER`, `ANSWER`), `off` =
 * nenhuma; lido a cada chamada — vale sem reiniciar o processo.
 */
export function lowReasoningStages(): ReadonlySet<"PLANNER" | "ANSWER"> {
  const value = process.env.INIA_CLARIFICATION_LOW_REASONING?.trim().toUpperCase()
  if (value === undefined || value === "") return DEFAULT_LOW_REASONING_STAGES
  if (value === "OFF" || value === "NONE") return new Set()
  return new Set(value.split(/[\s,]+/).filter((stage): stage is "PLANNER" | "ANSWER" => stage === "PLANNER" || stage === "ANSWER"))
}

/** Produção: o gateway único (uso/custo registrados, policy de IA da organização quando houver), Use Case KNOWLEDGE_CLARIFICATION. */
export const gatewayClarificationModel: ClarificationModel = async (input) => {
  const call = async () => {
    const route = routeFor({ purpose: "KNOWLEDGE_CLARIFICATION", phase: "KNOWLEDGE", structuredOutputComplexity: "SIMPLE", estimatedInputTokens: estimateTokens(input.system, input.user), ...(input.correction ? { previousParseFailure: true } : {}) })
    const lowReasoning = lowReasoningStages().has(input.stage)
    const request: GatewayRequest = {
      // A correção única fica no MESMO Use Case (a policy da organização vale para as duas), marcada pela tag.
      classification: { phase: "KNOWLEDGE", purpose: "KNOWLEDGE_CLARIFICATION", source: "CHAT", semanticType: "KNOWLEDGE_CLARIFICATION", tags: [`stage:${input.stage}`, ...(input.correction ? ["retry:CONTRACT_CORRECTION"] : []), ...(lowReasoning ? ["reasoning:LOW"] : [])] },
      systemPrompt: input.system,
      contents: [{ role: "user", text: input.user }],
      tools: [],
      structuredOutput: true,
      transport: { timeoutMs: CLARIFICATION_MODEL_TIMEOUT_MS },
      route,
      ...(lowReasoning ? { reasoningEffort: "LOW" as const } : {}),
    }
    const reply = await withLlmScope({ role: "knowledge_clarification", agentId: null }, () => (input.onText ? streamForRoute(request, input.onText) : generateForRoute(request)))
    return reply.kind === "text" ? reply.text : ""
  }
  return currentAiOrganizationId() === input.organizationId ? call() : runWithAiOrganization(input.organizationId, call)
}
