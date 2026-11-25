"use client"

import { useLayoutEffect, useState, type RefObject } from "react"

/** Painel baixo (janela baixa, zoom, celular deitado): a INIA fica reduzida e o campo mais enxuto, para sobrar conversa. */
export const SHORT_PANEL_PX = 560
/** Abaixo disto a imagem dela fica um pouco mais baixa. */
export const MEDIUM_PANEL_PX = 780

export type PanelHeight = "short" | "medium" | "tall"
export const panelHeightOf = (height: number): PanelHeight => (height < SHORT_PANEL_PX ? "short" : height < MEDIUM_PANEL_PX ? "medium" : "tall")

/** Pela altura REAL do painel (px de CSS: zoom já está na conta). Painel sem medida (0 px) não conta. Só renderiza quando a faixa muda. */
export function usePanelHeight(ref: RefObject<HTMLElement | null>): PanelHeight {
  const [height, setHeight] = useState<PanelHeight>("tall")
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const measured = element.getBoundingClientRect().height
      if (measured > 0) setHeight(panelHeightOf(measured))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return height
}
