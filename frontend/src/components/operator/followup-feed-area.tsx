"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"

/** Onde a área do feed para ao rolar a página: barra global 56 + abas 48 + margem 16, com folga para arredondamento e zoom. */
const DOCK_LINE_PX = 124

/**
 * Feed do Acompanhamento na altura da janela: a área para logo embaixo das abas e ocupa o resto da tela.
 *
 * "Um scroll só": enquanto o cabeçalho do perfil está à vista, o gesto sobre o feed leva a página, em vez de ficar preso numa lista com a base
 * da tela fora da janela. Com a área parada embaixo das abas (ou a página no fim), ele volta a rolar, e chegar ao topo devolve o gesto à
 * página. É um atributo, não estado: nada renderiza de novo. Sem JavaScript, a lista simplesmente rola.
 */
export function FollowupFeedArea({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      const atPageEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      element.toggleAttribute("data-page-first", element.getBoundingClientRect().top > DOCK_LINE_PX && !atPageEnd)
    }
    update()
    window.addEventListener("scroll", update, { passive: true })
    window.addEventListener("resize", update)
    // O cabeçalho do perfil muda de altura depois de montado (dados, foto): a posição da área muda sem rolagem nem redimensionamento.
    const observer = new ResizeObserver(update)
    observer.observe(element)
    observer.observe(document.body)
    return () => {
      window.removeEventListener("scroll", update)
      window.removeEventListener("resize", update)
      observer.disconnect()
    }
  }, [])
  // Janela − barra global 56 − abas 48 − margem 16 − respiro do fim 20. O piso vale para janelas muito baixas.
  return (
    <div ref={ref} className="h-[calc(100dvh-8.75rem)] min-h-[16rem] data-page-first:[&_[data-slot=scroll-area-viewport]]:overflow-y-hidden!" data-testid="followup-feed-area">
      <div className="h-full overflow-hidden rounded-xl bg-card" data-workspace-feed="">{children}</div>
    </div>
  )
}
