import { describe, expect, it } from "vitest"

import { broadcastImageSchema, communicationSchema, editorialFormSchema, publishBlockers, receivedCommunicationsSchema, type EditorialForm } from "./communication.schema"

const form = (overrides: Partial<EditorialForm> = {}): EditorialForm => ({
  title: "Nova campanha", contentHtml: "<p>Conteúdo</p>", plainText: "Conteúdo", tags: ["Aviso", "Campanha"], summary: "", featured: false, audience: "TEAM",
  segment: { universe: null, scope: { global: false, groups: [] } }, productNodeId: null, publishAt: null, displayUntil: null, ...overrides,
})

describe("editorialFormSchema + publishBlockers", () => {
  it("aceita publicação válida; rascunho só precisa do título", () => {
    expect(editorialFormSchema.safeParse(form()).success).toBe(true)
    expect(publishBlockers(form())).toEqual([])
    const draft = form({ contentHtml: "", plainText: "", tags: [] })
    expect(editorialFormSchema.safeParse(draft).success).toBe(true)
    expect(publishBlockers(draft)).toEqual(["Escreva o conteúdo da publicação.", "Escolha ao menos uma categoria."])
    expect(editorialFormSchema.safeParse(form({ title: "x" })).success).toBe(false)
  })

  it("aceita uma imagem de 1,4 MB em base64 e recusa a publicação acima de 2 MB", () => {
    expect(editorialFormSchema.safeParse(form({ contentHtml: `<p>Imagem</p><img src="data:image/png;base64,${"a".repeat(1_870_000)}">` })).success).toBe(true)
    expect(editorialFormSchema.safeParse(form({ contentHtml: `<img src="data:image/png;base64,${"a".repeat(2_000_001)}">` })).success).toBe(false)
  })

  it("só imagem vale; no máximo 6 imagens, como o servidor (B11)", () => {
    const image = `<img src="data:image/png;base64,aGVsbG8=">`
    expect(publishBlockers(form({ contentHtml: `<p>${image}</p>`, plainText: "" }))).toEqual([])
    expect(publishBlockers(form({ contentHtml: image.repeat(7), plainText: "" }))).toEqual(["A publicação pode ter no máximo 6 imagens."])
  })

  it("recorte sem critério e fim antes do início travam a publicação", () => {
    expect(publishBlockers(form({ audience: "SEGMENT" }))).toEqual(["Escolha o universo, um Grupo ou um Subgrupo para o público."])
    expect(publishBlockers(form({ audience: "SEGMENT", segment: { universe: "B2C", scope: { global: false, groups: [] } } }))).toEqual([])
    // Vários Grupos: Grupo inteiro + recorte por Subgrupo; recorte sem Subgrupo marcado trava.
    const twoGroups = { global: false, groups: [{ teamId: "t1", subteamIds: [], mode: "WHOLE" as const }, { teamId: "t2", subteamIds: ["s21"], mode: "SUBTEAMS" as const }] }
    expect(publishBlockers(form({ audience: "SEGMENT", segment: { universe: null, scope: twoGroups } }))).toEqual([])
    expect(publishBlockers(form({ audience: "SEGMENT", segment: { universe: null, scope: { global: false, groups: [{ teamId: "t2", subteamIds: [], mode: "SUBTEAMS" }] } } }))).toHaveLength(1)
    expect(publishBlockers(form({ publishAt: "2026-11-20T12:00:00.000Z", displayUntil: "2026-11-19T12:00:00.000Z" }))).toEqual(["O fim da exibição precisa ser depois do início."])
  })

  it("GIF é recusado ao escolher a imagem (U4-03)", () => {
    const gif = broadcastImageSchema.safeParse(new File(["GIF89a"], "a.gif", { type: "image/gif" }))
    expect(gif.success).toBe(false)
    expect(gif.error?.issues[0]?.message).toBe("Use uma imagem JPG, PNG ou WebP.")
    expect(broadcastImageSchema.safeParse(new File(["x"], "a.png", { type: "image/png" })).success).toBe(true)
  })
})

describe("receivedCommunicationsSchema", () => {
  it("lê a lista leve (sem conteúdo) com trecho e imagens", () => {
    const parsed = receivedCommunicationsSchema.parse({ items: [{ id: "c1", title: "Aviso", excerpt: "x", hasImages: false, tags: ["Aviso"], audience: "TEAM", author: { personId: "p", name: "Ana" }, recipientCount: null, authoredByViewer: false, publishedAt: "2026-11-16T12:00:00.000Z", editedAt: null }] })
    expect(parsed.items[0]).not.toHaveProperty("contentHtml")
    expect(parsed.items[0]?.excerpt).toBe("x")
  })
})

describe("communicationSchema", () => {
  it("lê o comunicado como o servidor devolve", () => {
    const parsed = communicationSchema.parse({ id: "c1", title: "Aviso", contentHtml: "<p>x</p>", plainText: "x", tags: ["Aviso"], audience: "TEAM", author: { personId: "p", name: "Ana" }, recipientCount: null, authoredByViewer: false, publishedAt: "2026-11-16T12:00:00.000Z" })
    expect(parsed.author.name).toBe("Ana")
  })
})
