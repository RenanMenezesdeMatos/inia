import { describe, expect, it } from "vitest"

import { MEDIUM_PANEL_PX, panelHeightOf, SHORT_PANEL_PX } from "./use-panel-height"

describe("altura do painel da INIA", () => {
  it("painel baixo reduz a INIA; médio deixa a imagem um pouco mais baixa; alto mostra inteira", () => {
    expect(panelHeightOf(SHORT_PANEL_PX - 1)).toBe("short")
    expect(panelHeightOf(SHORT_PANEL_PX)).toBe("medium")
    expect(panelHeightOf(MEDIUM_PANEL_PX - 1)).toBe("medium")
    expect(panelHeightOf(MEDIUM_PANEL_PX)).toBe("tall")
  })
})
