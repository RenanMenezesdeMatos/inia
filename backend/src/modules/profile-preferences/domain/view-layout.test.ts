import { describe, expect, it } from "vitest"
import { viewLayoutKeySchema, viewLayoutSchema } from "./view-layout.js"

const valid = { version: 1, sections: [{ id: "abandonos", hidden: false, cards: [{ id: "espera", hidden: false, w: 6, h: null }, { id: "grafico-hora", w: 12, h: 5 }] }] }

describe("disposição personalizada", () => {
  it("aceita a forma válida e completa os padrões", () => {
    const parsed = viewLayoutSchema.parse(valid)
    expect(parsed.sections[0]!.cards[1]).toEqual({ id: "grafico-hora", hidden: false, w: 12, h: 5 })
  })
  it("recusa largura fora dos blocos, id inválido, repetição, campo extra e visão desconhecida", () => {
    expect(viewLayoutSchema.safeParse({ ...valid, sections: [{ id: "a", cards: [{ id: "b", w: 5 }] }] }).success).toBe(false)
    expect(viewLayoutSchema.safeParse({ ...valid, sections: [{ id: "A b", cards: [] }] }).success).toBe(false)
    expect(viewLayoutSchema.safeParse({ ...valid, sections: [{ id: "a", cards: [] }, { id: "a", cards: [] }] }).success).toBe(false)
    expect(viewLayoutSchema.safeParse({ ...valid, sections: [{ id: "a", cards: [{ id: "b", w: 6 }, { id: "b", w: 6 }] }] }).success).toBe(false)
    expect(viewLayoutSchema.safeParse({ ...valid, extra: true }).success).toBe(false)
    expect(viewLayoutKeySchema.safeParse("outra.tela").success).toBe(false)
    expect(viewLayoutSchema.safeParse({ ...valid, sections: [{ id: "a", cards: [{ id: "b", w: 6, h: 9 }] }] }).success).toBe(false)
    expect(viewLayoutSchema.safeParse({ ...valid, sections: [{ id: "a", cards: [{ id: "b", w: 6, h: "L" }] }] }).success).toBe(false)
  })
})
