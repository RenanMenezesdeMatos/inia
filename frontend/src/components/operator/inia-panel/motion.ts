"use client"

/** Uma curva e uma duração para tudo que se move junto com a INIA: o painel, a aba da borda e a janela dela. */
export const PANEL_MOTION_MS = 420
export const PANEL_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
export const PANEL_TRANSITION = { transitionDuration: `${PANEL_MOTION_MS}ms`, transitionTimingFunction: PANEL_EASING } as const
export const prefersReducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Transição de lugar e tamanho (FLIP): tudo já está no lugar novo; só PARECE sair do antigo e crescer até ali. `image` é o que precisa casar
 * com o retângulo de antes (a imagem dela); `moving` é o que se move junto (a janela inteira, ou só a imagem dentro do painel). Só transform:
 * o Canvas do avatar mede pelo layout, então não é redimensionado a cada quadro.
 */
export function animateFrom(moving: HTMLElement, image: HTMLElement, before: DOMRect) {
  if (typeof moving.animate !== "function" || prefersReducedMotion() || before.width === 0) return
  const m = moving.getBoundingClientRect()
  const i = image.getBoundingClientRect()
  if (i.width === 0) return
  const scale = before.width / i.width
  const x = before.left - m.left - scale * (i.left - m.left)
  const y = before.top - m.top - scale * (i.top - m.top)
  moving.animate(
    [{ transformOrigin: "0 0", transform: `translate(${x}px, ${y}px) scale(${scale})` }, { transformOrigin: "0 0", transform: "none" }],
    { duration: PANEL_MOTION_MS, easing: PANEL_EASING },
  )
}
