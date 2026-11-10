import { describe, expect, it } from "vitest"
import { KNOWLEDGE_CLARIFICATION_VERSION } from "../../knowledge-clarification/domain/clarification-state.js"
import { buildSupportContext, withoutSourceMarkers } from "./support-context.js"

/**
 * Cópia da troca para o pedido de apoio (seção 7): pergunta (a original do esclarecimento, a anterior do operador ou a própria
 * pergunta sem resposta), resposta sempre (D10) sem marcadores de fonte, motivo só da descurtida com "ainda preciso de ajuda".
 */
const ORG = "org-1"
const JOANA = "person-joana"
const at = new Date("2026-11-09T12:00:05.000Z")

type Message = { id: string; role: "user" | "assistant"; content: string; tool_calls?: unknown; signals?: string[] | null }
function fakeDb(input: { message?: Message; previous?: string | null; rating?: { value: string; reason: string | null; comment: string | null; still_needs_help: boolean | null } | null }) {
  const calls: { sql: string; params: unknown[] }[] = []
  const db = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      if (sql.includes("left join assistant_reply_signals")) return { rows: input.message ? [{ tool_calls: null, signals: null, occurred_at: at, seq: "7", conversation_id: "conv-1", ...input.message }] : [] }
      if (sql.includes("role = 'user' and (occurred_at, seq)")) return { rows: input.previous ? [{ content: input.previous }] : [] }
      if (sql.includes("from assistant_interaction_ratings r")) return { rows: input.rating ? [input.rating] : [] }
      throw new Error(`consulta inesperada: ${sql}`)
    },
  }
  return { db: db as never, calls }
}
const clarificationState = (overrides: Record<string, unknown> = {}) => ({
  version: KNOWLEDGE_CLARIFICATION_VERSION, id: "11111111-1111-4111-8111-111111111111", originalQuestion: "Como cancelo a linha pós-paga?", status: "ANSWERED", steps: [], questionFacts: [],
  coverage: { consideredDocuments: 2, matchedDocuments: 2, presentedDocuments: 2, omittedDocuments: 0, complete: true },
  sources: [{ documentId: "kb-1", documentTitle: "Cancelamento", versionId: "kb-1-v1", heading: "1. Pós-pago", chunkIndex: 0 }, { documentId: "kb-2", documentTitle: "Multa", versionId: "kb-2-v1", heading: "2. Multa", chunkIndex: 0 }],
  conflicts: [], notice: null, updatedAt: "2026-11-09T12:00:00.000Z", ...overrides,
})

describe("buildSupportContext", () => {
  it("mensagem inexistente, de outra pessoa ou fora do chat livre = null (a busca exige dona, organização e origin USER)", async () => {
    const { db, calls } = fakeDb({})
    expect(await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "a1", ratingId: null })).toBeNull()
    expect(calls[0]!.params).toEqual(["a1", ORG, JOANA])
    expect(calls[0]!.sql).toContain("c.origin = 'USER'")
    expect(calls[0]!.sql).toContain("c.owner_person_id = $3")
  })

  it("resposta comum: pergunta = mensagem do operador imediatamente anterior; resposta inteira; sinais da linha; sem motivo sem ratingId", async () => {
    const { db, calls } = fakeDb({ message: { id: "a1", role: "assistant", content: "Não encontrei isso nas bases.", signals: ["KNOWLEDGE_NOT_FOUND"] }, previous: "Qual a multa do cancelamento?" })
    expect(await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "a1" })).toEqual({
      conversationId: "conv-1",
      facts: { dislikeNeedsHelp: false, signals: ["KNOWLEDGE_NOT_FOUND"] },
      sharedContext: { question: "Qual a multa do cancelamento?", answer: "Não encontrei isso nas bases.", dislike: null },
    })
    expect(calls[1]!.params).toEqual(["conv-1", at, "7"])
    expect(calls).toHaveLength(2)
  })

  it("resposta de um esclarecimento: pergunta = a original guardada no estado; os marcadores de fonte saem da resposta", async () => {
    const { db } = fakeDb({ message: { id: "a2", role: "assistant", content: "O cancelamento é pelo app [1]. Há multa [2] e veja [7].", tool_calls: [{ toolName: "knowledge_clarification", state: clarificationState() }], signals: [] }, previous: "Pós-pago" })
    const context = await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "a2" })
    expect(context!.sharedContext).toEqual({ question: "Como cancelo a linha pós-paga?", answer: "O cancelamento é pelo app. Há multa e veja [7].", dislike: null })
    expect(context!.facts.signals).toEqual([])
  })

  it("descurtida com \"ainda preciso de ajuda\" na versão informada: motivo e comentário entram e o fato DISLIKE vale", async () => {
    const { db, calls } = fakeDb({ message: { id: "a1", role: "assistant", content: "Resposta." }, previous: "Pergunta?", rating: { value: "DOWN", reason: "INCOMPLETE", comment: "Faltou o prazo.", still_needs_help: true } })
    const context = await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "a1", ratingId: "r1" })
    expect(context).toEqual({ conversationId: "conv-1", facts: { dislikeNeedsHelp: true, signals: [] }, sharedContext: { question: "Pergunta?", answer: "Resposta.", dislike: { reason: "INCOMPLETE", reasonLabel: "Resposta incompleta", comment: "Faltou o prazo." } } })
    // A versão precisa ser desta resposta e da própria pessoa.
    expect(calls[2]!.params).toEqual(["r1", "a1", JOANA, ORG])
  })

  it("descurtida sem necessidade de ajuda, sem motivo, curtida ou versão que não é desta resposta: nenhum motivo e nenhum fato DISLIKE", async () => {
    for (const rating of [{ value: "DOWN", reason: "INCOMPLETE", comment: null, still_needs_help: false }, { value: "DOWN", reason: null, comment: null, still_needs_help: null }, { value: "UP", reason: null, comment: null, still_needs_help: null }, null]) {
      const { db } = fakeDb({ message: { id: "a1", role: "assistant", content: "Resposta.", signals: ["CONSULTATION_FAILED"] }, previous: "Pergunta?", rating })
      const context = await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "a1", ratingId: "r1" })
      expect(context!.facts).toEqual({ dislikeNeedsHelp: false, signals: ["CONSULTATION_FAILED"] })
      expect(context!.sharedContext.dislike).toBeNull()
    }
  })

  it("pergunta que ficou sem resposta (NO_REPLY): a cópia é ela mesma, sem resposta", async () => {
    const { db, calls } = fakeDb({ message: { id: "u1", role: "user", content: "Como faço a portabilidade?", signals: ["NO_REPLY"] } })
    expect(await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "u1", ratingId: "r1" })).toEqual({
      conversationId: "conv-1",
      facts: { dislikeNeedsHelp: false, signals: ["NO_REPLY"] },
      sharedContext: { question: "Como faço a portabilidade?", answer: null, dislike: null },
    })
    expect(calls).toHaveLength(1)
  })

  it("sem mensagem anterior do operador: pergunta vazia (null), resposta mantida; códigos desconhecidos na linha são ignorados", async () => {
    const { db } = fakeDb({ message: { id: "a1", role: "assistant", content: "Olá!", signals: ["PHRASE_MATCH", "KNOWLEDGE_NOT_FOUND"] }, previous: null })
    const context = await buildSupportContext(db, { organizationId: ORG, ownerPersonId: JOANA, interactionId: "a1" })
    expect(context).toEqual({ conversationId: "conv-1", facts: { dislikeNeedsHelp: false, signals: ["KNOWLEDGE_NOT_FOUND"] }, sharedContext: { question: null, answer: "Olá!", dislike: null } })
  })
})

describe("withoutSourceMarkers", () => {
  it("tira só os marcadores que correspondem a uma fonte, com o espaço antes deles", () => {
    expect(withoutSourceMarkers("A [1] B [2] C [3]", 2)).toBe("A B C [3]")
    expect(withoutSourceMarkers("Sem fontes [1]", 0)).toBe("Sem fontes [1]")
  })
})
