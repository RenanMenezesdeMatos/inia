import { describe, expect, it } from "vitest"

import { broadcastSchema } from "./broadcast.schema"

describe("broadcastSchema", () => {
  it("aceita comunicado válido com múltiplas categorias", () => {
    const result = broadcastSchema.safeParse({ title: "Nova campanha", contentHtml: "<p>Conteúdo</p>", plainText: "Conteúdo", audience: "team", tags: ["Aviso", "Campanha"] })
    expect(result.success).toBe(true)
  })

  it("rejeita comunicado vazio ou sem categoria", () => {
    const result = broadcastSchema.safeParse({ title: "", contentHtml: "", plainText: "", audience: "team", tags: [] })
    expect(result.success).toBe(false)
  })

  it("aceita o tamanho Base64 de uma imagem válida de até 2 MB", () => {
    const contentHtml = `<p>Imagem</p><img src="data:image/png;base64,${"a".repeat(2_800_000)}">`
    const result = broadcastSchema.safeParse({ title: "Comunicado com imagem", contentHtml, plainText: "Imagem", audience: "team", tags: ["Aviso"] })
    expect(result.success).toBe(true)
  })
})
