import { createKnowledgeClarification } from "../application/knowledge-clarification-service.js"
import { fixtureKnowledge, scriptedModel, type ScriptedCall } from "./clarification-fixtures.js"

/**
 * O serviço REAL do esclarecimento (bases, navegação, contrato, estado) sobre as bases fictícias de `clarification-fixtures.ts`, com a
 * IA roteirizada — para testar quem o usa (voz de quem atende, consulta de processo de quem lidera) só pelo `handle`, sem regra
 * nenhuma de conteúdo no código. Único ponto desses testes que conhece as dependências do serviço.
 */
export function fixtureClarificationService(script: (call: ScriptedCall, index: number) => unknown, options: Parameters<typeof fixtureKnowledge>[0] & { now?: () => Date } = {}) {
  const knowledge = fixtureKnowledge(options)
  const { model, calls } = scriptedModel(script)
  let sequence = 0
  const service = createKnowledgeClarification({
    knowledge: knowledge.knowledge,
    model,
    guardrails: async () => "",
    specialistInstructions: async () => "",
    ...(options.now ? { now: options.now } : {}),
    newId: () => `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`,
  })
  return { service, calls, knowledge }
}
