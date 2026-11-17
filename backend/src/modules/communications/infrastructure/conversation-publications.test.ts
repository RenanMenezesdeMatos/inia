import { afterEach, describe, expect, it, vi } from "vitest"

import type { Database } from "../../../infrastructure/database/pool.js"
import { fakePublicationRelevanceModel } from "../testing/fake-publication-relevance-model.js"
import { conversationPublicationsFor } from "./conversation-publications.js"

const NATAL = { id: "c-natal", title: "Festa de Natal 2026", summary: "Confraternização dia 23/11", plainText: "Detalhes", tags: ["Aviso"], authorName: "Diretoria", authorJobTitle: null, publishedAt: new Date("2026-11-17T17:31:00Z"), displayUntil: null, productName: null, featured: false }

function fakeDb(communications: unknown[]) {
  return {
    query: async (sql: string) => {
      if (sql.includes("from communications")) return { rows: communications }
      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Sao_Paulo" }] }
      return { rows: [] }
    },
  } as unknown as Database
}

afterEach(() => vi.restoreAllMocks())

describe("comunicados e alinhamentos da conversa (PUBLICATION_RELEVANCE_V1)", () => {
  it("sem comunicado no ar nem alinhamento em vigor: a IA não é chamada", async () => {
    const model = fakePublicationRelevanceModel([{ whenQuestionIncludes: "natal", titleIncludes: "natal" }])
    const result = await conversationPublicationsFor(fakeDb([]), { organizationId: "org", personId: "p", question: "tem algum comunicado de natal?", model })
    expect(model.calls).toHaveLength(0)
    expect(result).toMatchObject({ communications: [], alignments: [], consulted: false })
  })

  it("com comunicado no ar: a IA decide; escolhido entra, não escolhido fica de fora", async () => {
    const model = fakePublicationRelevanceModel([{ whenQuestionIncludes: "natal", titleIncludes: "natal" }])
    const picked = await conversationPublicationsFor(fakeDb([NATAL]), { organizationId: "org", personId: "p", question: "E sobre o comunicado de natal?", model })
    expect(picked.communications.map((item) => item.id)).toEqual(["c-natal"])
    const none = await conversationPublicationsFor(fakeDb([NATAL]), { organizationId: "org", personId: "p", question: "e aí?", model })
    expect(none).toMatchObject({ communications: [], consulted: true })
    expect(model.calls).toHaveLength(2)
  })

  it("falha do modelo = nada escolhido (nunca um comunicado aleatório)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const failing = Object.assign(async () => {
      throw new Error("timeout")
    }, { calls: [] })
    const result = await conversationPublicationsFor(fakeDb([NATAL]), { organizationId: "org", personId: "p", question: "quais os comunicados?", model: failing })
    expect(result).toMatchObject({ communications: [], alignments: [], consulted: true })
  })

  it("desligado (INIA_PUBLICATION_RELEVANCE=off, padrão dos testes): sem chamada e sem escolha", async () => {
    const result = await conversationPublicationsFor(fakeDb([NATAL]), { organizationId: "org", personId: "p", question: "quais os comunicados?" })
    expect(result).toMatchObject({ communications: [], consulted: false })
  })
})
