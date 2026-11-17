import { describe, expect, it } from "vitest"

import { broadcastImageSchema, broadcastSchema, communicationSchema, receivedCommunicationsSchema } from "./communication.schema"

describe("broadcastSchema", () => {
  it("aceita comunicado válido com múltiplas categorias", () => {
    const result = broadcastSchema.safeParse({ title: "Nova campanha", contentHtml: "<p>Conteúdo</p>", plainText: "Conteúdo", audience: "TEAM", tags: ["Aviso", "Campanha"] })
    expect(result.success).toBe(true)
  })

  it("rejeita comunicado vazio, sem categoria ou com público desconhecido", () => {
    expect(broadcastSchema.safeParse({ title: "", contentHtml: "", plainText: "", audience: "TEAM", tags: [] }).success).toBe(false)
    expect(broadcastSchema.safeParse({ title: "Título", contentHtml: "<p>x</p>", plainText: "x", audience: "team", tags: ["Aviso"] }).success).toBe(false)
  })

  it("aceita uma imagem de 1,4 MB em base64 e recusa o comunicado acima de 2 MB", () => {
    const fits = `<p>Imagem</p><img src="data:image/png;base64,${"a".repeat(1_870_000)}">`
    expect(broadcastSchema.safeParse({ title: "Comunicado com imagem", contentHtml: fits, plainText: "Imagem", audience: "TEAM", tags: ["Aviso"] }).success).toBe(true)
    const tooBig = `<img src="data:image/png;base64,${"a".repeat(2_000_001)}">`
    expect(broadcastSchema.safeParse({ title: "Comunicado grande", contentHtml: tooBig, plainText: "x", audience: "TEAM", tags: ["Aviso"] }).success).toBe(false)
  })
})

describe("broadcastSchema — a mesma regra do servidor", () => {
  const base = { title: "Comunicado", audience: "TEAM", tags: ["Aviso"] } as const
  const image = `<img src="data:image/png;base64,aGVsbG8=">`

  it("só imagem, sem texto, é aceito; sem texto e sem imagem, não (B11)", () => {
    expect(broadcastSchema.safeParse({ ...base, contentHtml: `<p>${image}</p>`, plainText: "" }).success).toBe(true)
    const empty = broadcastSchema.safeParse({ ...base, contentHtml: "<p><br></p>", plainText: "  " })
    expect(empty.success).toBe(false)
    expect(empty.error?.issues[0]?.message).toBe("Digite o conteúdo do comunicado.")
  })

  it("no máximo 6 imagens, como o servidor", () => {
    expect(broadcastSchema.safeParse({ ...base, contentHtml: image.repeat(6), plainText: "" }).success).toBe(true)
    expect(broadcastSchema.safeParse({ ...base, contentHtml: image.repeat(7), plainText: "" }).error?.issues[0]?.message).toBe("O comunicado pode ter no máximo 6 imagens.")
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
