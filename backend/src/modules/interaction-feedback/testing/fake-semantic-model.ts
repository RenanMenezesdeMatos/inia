import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import type { FeedbackWriterPort } from "../application/ports.js"

/**
 * SÓ TESTES (V1.5.10) — modelo falso para o caminho semântico DIRETO e redator falso. Zero chamada real: o gateway é
 * substituído por `fakeSemanticReply`, que responde pela CLASSIFICAÇÃO da request (fase/estágio), exatamente como o
 * gateway real recebe. Cenários:
 *   CLEAR   — força clara do operador (prazo informado) → AUTO_DELIVER sob a política autônoma;
 *   BLOCKED — a única evidência tem número longo (retida pela projeção de display) → BLOCKED (sem redator).
 */
export type SemanticScenario = "CLEAR" | "BLOCKED"

export const SCENARIO_TRANSCRIPTS: Record<SemanticScenario, string> = {
  CLEAR: ["CLIENTE: Oi, quero saber o prazo da segunda via da fatura.", "OPERADOR: Claro, vou verificar para você agora mesmo.", "OPERADOR: O prazo de entrega é de até cinco dias úteis a partir de hoje.", "CLIENTE: Perfeito, obrigado."].join("\n"),
  BLOCKED: ["CLIENTE: Oi, quero confirmar meu cadastro.", "OPERADOR: Confirmei aqui, o número 9876543210 está cadastrado na sua conta.", "CLIENTE: Certo, obrigado."].join("\n"),
}
const QUOTES: Record<SemanticScenario, { turnRef: string; quote: string }> = {
  CLEAR: { turnRef: "T3", quote: "O prazo de entrega é de até cinco dias úteis a partir de hoje." },
  BLOCKED: { turnRef: "T2", quote: "Confirmei aqui, o número 9876543210 está cadastrado na sua conta." },
}

type GatewayRequest = { classification?: { phase?: string; purpose?: string; tags?: string[] } }
export const reply = (payload: unknown) => ({ kind: "text", text: JSON.stringify(payload), usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "fake-semantic", provider: "GEMINI", cache: { mode: "NONE" }, cost: { status: "NOT_CONFIGURED" } })

/** Resposta do gateway por estágio: Fase A = um frame com uma força do operador; Fase B = nada a promover. */
export function fakeSemanticReply(request: GatewayRequest, scenarioOf: () => SemanticScenario) {
  const stage = request.classification?.tags?.find((tag) => tag.startsWith("stage:"))?.slice("stage:".length)
  if (request.classification?.phase !== "SEMANTIC_ANALYSIS") throw new Error(`request inesperada no caminho direto: ${request.classification?.phase}`)
  if (stage === "EXTRACTION") {
    const { turnRef, quote } = QUOTES[scenarioOf()]
    return reply({
      frames: [{
        interactionRef: "I1", customerNeeds: [], questions: [], answers: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [],
        agentActions: [{ id: "A1", kind: "INFORMED_DEADLINE", summary: "operador informou o dado pedido", evidence: [{ interactionRef: "I1", turnRef, speaker: "OPERADOR", quote }] }],
        findings: [{ id: "F1", kind: "STRENGTH", summary: "informação clara ao cliente", observationRefs: ["A1"] }],
      }],
    })
  }
  if (stage === "SYNTHESIS") return reply({ findings: [], patterns: [] })
  return reply({})
}

/** Redator falso: texto que passa em todos os validadores (efeito só potencial, ação só declarada). `fail` = erro de transporte. */
export function fakeWriter(options: { fail?: (() => boolean) | undefined } = {}): FeedbackWriterPort & { calls: FeedbackWriterInputV1[] } {
  const calls: FeedbackWriterInputV1[] = []
  return {
    calls,
    async write(input) {
      calls.push(input)
      if (options.fail?.()) {
        const error = new Error("falha simulada do redator")
        error.name = "WRITER_TRANSPORT_ERROR"
        throw error
      }
      return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "Nesta conversa você informou o prazo ao cliente.", whyItMatters: "Isso pode ajudar o cliente a se organizar.", whatYouCanDo: "Você pode manter essa prática em conversas parecidas." })) } }
    },
  }
}
