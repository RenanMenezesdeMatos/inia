import { describe, expect, it } from "vitest"

import { chartHeightPx, defaultLayout, mergeLayout, moveCard, moveSection, nearestRows, nearestWidth, rowsMinHeight, setSectionHidden, updateCard, type GridSection, type ViewLayout } from "./layout"

const render = () => null
const CATALOG: GridSection[] = [
  { id: "resumo", title: "Resumo", cards: [{ id: "a", title: "A", defaultWidth: 3, render }, { id: "b", title: "B", defaultWidth: 6, widths: [6, 12], render }] },
  { id: "graficos", title: "Gráficos", cards: [{ id: "g", title: "G", defaultWidth: 12, defaultRows: 4, render }] },
]

describe("disposição personalizada", () => {
  it("padrão = ordem e tamanhos do catálogo; gráfico começa com 4 blocos; os outros, altura automática", () => {
    expect(defaultLayout(CATALOG)).toEqual({
      version: 1,
      sections: [
        { id: "resumo", hidden: false, cards: [{ id: "a", hidden: false, w: 3, h: null }, { id: "b", hidden: false, w: 6, h: null }] },
        { id: "graficos", hidden: false, cards: [{ id: "g", hidden: false, w: 12, h: 4 }] },
      ],
    })
  })

  it("junta o salvo com o catálogo: ordem salva vale; sumido sai; novo entra no fim; largura não permitida volta ao padrão", () => {
    const merged = mergeLayout(CATALOG, {
      version: 1,
      sections: [
        { id: "graficos", hidden: false, cards: [{ id: "g", hidden: false, w: 8, h: 6 }] },
        { id: "velha", hidden: false, cards: [] },
        { id: "resumo", hidden: true, cards: [{ id: "b", hidden: true, w: 3, h: null }, { id: "sumiu", hidden: false, w: 3, h: null }] },
      ],
    })
    expect(merged.sections.map((section) => section.id)).toEqual(["graficos", "resumo"])
    expect(merged.sections[0]!.cards[0]).toEqual({ id: "g", hidden: false, w: 8, h: 6 })
    expect(merged.sections[1]).toEqual({ id: "resumo", hidden: true, cards: [{ id: "b", hidden: true, w: 6, h: null }, { id: "a", hidden: false, w: 3, h: null }] })
  })

  it("mover área e card, mudar tamanho, esconder; largura arrastada encaixa no bloco mais próximo", () => {
    let layout = defaultLayout(CATALOG)
    layout = moveSection(layout, "graficos", "resumo")
    expect(layout.sections.map((section) => section.id)).toEqual(["graficos", "resumo"])
    layout = moveCard(layout, "resumo", "b", "a")
    expect(layout.sections[1]!.cards.map((card) => card.id)).toEqual(["b", "a"])
    layout = updateCard(layout, "graficos", "g", { w: 6, h: 2 })
    expect(layout.sections[0]!.cards[0]).toMatchObject({ w: 6, h: 2 })
    layout = setSectionHidden(layout, "resumo", true)
    expect(layout.sections[1]!.hidden).toBe(true)
    expect(nearestWidth(7)).toBe(6)
    expect(nearestWidth(10.4)).toBe(9)
    expect(nearestWidth(11, [6, 12])).toBe(12)
  })

  it("altura em blocos: arrastar encaixa no bloco mais próximo (pouco = automática, no máximo 8); salvo inválido volta ao padrão do card", () => {
    expect(rowsMinHeight(1)).toBe(72)
    expect(rowsMinHeight(3)).toBe(3 * 72 + 2 * 12)
    expect(nearestRows(20)).toBeNull()
    expect(nearestRows(80)).toBe(1)
    expect(nearestRows(160)).toBe(2)
    expect(nearestRows(5000)).toBe(8)
    expect(chartHeightPx(null)).toBe(rowsMinHeight(4) - 76)
    expect(chartHeightPx(1)).toBe(120)
    const saved = { version: 1, sections: [{ id: "graficos", hidden: false, cards: [{ id: "g", hidden: false, w: 12, h: "L" }] }, { id: "resumo", hidden: false, cards: [{ id: "a", hidden: false, w: 3, h: 3 }] }] } as unknown as ViewLayout
    const merged = mergeLayout(CATALOG, saved)
    expect(merged.sections[0]!.cards[0]!.h).toBe(4)
    expect(merged.sections[1]!.cards[0]!.h).toBe(3)
  })
})
