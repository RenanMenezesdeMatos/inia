"use client"

import { useLayoutEffect, useRef } from "react"

import { cn } from "@/lib/utils"

/**
 * UM avatar, vários lugares. O `<Canvas>` do avatar é renderizado UMA vez (por portal) dentro de um elemento estável — o "host"
 * — e esse elemento é MOVIDO no DOM para o lugar que o exibe agora: o painel da INIA ou o card central da sessão de feedback.
 * Mover um nó do DOM não desmonta nada no React: o contexto WebGL, o modelo carregado, a animação e o lip-sync continuam os
 * mesmos (nada de recarregar o avatar ao abrir/fechar a sessão, nada de dois Canvas). Também por isso o Canvas nunca sai da
 * árvore no ciclo adiado do Radix Presence ao fechar o diálogo — quem sai é só o lugar vazio (ver inia-humanoid-avatar-3d.tsx).
 *
 * Cada lugar (`AvatarSlot`) se registra com uma prioridade; o host fica no lugar montado de MAIOR prioridade (empate: o mais
 * recente). Sem lugar, o host fica fora do documento (o avatar para de desenhar sozinho — ninguém o vê).
 *
 * Lugar com `flyIn`: ao receber o avatar, ele "voa" de onde estava (o painel) até ali, crescendo — transição de elemento
 * compartilhado (FLIP) feita só com transform, sem tocar no Canvas. Sem origem visível (painel recolhido), entra crescendo do
 * centro. Movimento reduzido: aparece direto.
 */
const FLY_MS = 700
const REVEAL_FALLBACK_MS = 300
const FLY_EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
const visible = (rect: DOMRect) => rect.width > 1 && rect.height > 1

export class AvatarHostManager {
  readonly host: HTMLDivElement
  private slots: { element: HTMLElement; priority: number; seq: number; flyIn: boolean }[] = []
  private seq = 0

  constructor() {
    this.host = document.createElement("div")
    this.host.dataset.avatarHost = ""
    this.host.style.width = "100%"
    this.host.style.height = "100%"
  }

  claim(element: HTMLElement, priority: number, options: { flyIn?: boolean } = {}): () => void {
    this.seq += 1
    const entry = { element, priority, seq: this.seq, flyIn: options.flyIn ?? false }
    this.slots.push(entry)
    this.place()
    return () => {
      this.slots = this.slots.filter((slot) => slot !== entry)
      this.place()
    }
  }

  private place() {
    const target = [...this.slots].sort((a, b) => b.priority - a.priority || b.seq - a.seq)[0]
    if (!target) {
      this.host.remove()
      return
    }
    if (this.host.parentElement === target.element) return
    const from = this.host.isConnected ? this.host.getBoundingClientRect() : null
    target.element.appendChild(this.host)
    if (target.flyIn) this.flyIn(from)
  }

  private flyIn(from: DOMRect | null) {
    if (typeof this.host.animate !== "function") return
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const to = this.host.getBoundingClientRect()
    if (!visible(to)) return
    // O R3F mede o Canvas com getBoundingClientRect, que INCLUI transforms: medido no meio da animação, o Canvas ficaria preso no
    // tamanho reduzido. Por isso: esconde por dois quadros (o Canvas mede o tamanho FINAL), só então anima, e no fim pede uma
    // nova medida (evento de resize da janela, que o R3F escuta).
    const host = this.host
    host.style.opacity = "0"
    const fromVisible = from !== null && visible(from)
    // Escala UNIFORME (o avatar nunca achata) e centros alinhados: parece o mesmo avatar crescendo de onde estava.
    const start = fromVisible
      ? `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${Math.min(from.width / to.width, from.height / to.height)})`
      : "translateY(24px) scale(0.6)"
    const remeasure = () => window.dispatchEvent(new Event("resize"))
    let revealed = false
    const reveal = (animate: boolean) => {
      if (revealed) return
      revealed = true
      host.style.opacity = ""
      if (!host.isConnected || !animate) return remeasure()
      const animation = host.animate([{ transform: start, opacity: fromVisible ? 1 : 0 }, { transform: "none", opacity: 1 }], { duration: FLY_MS, easing: FLY_EASING })
      animation.addEventListener("finish", remeasure)
      animation.addEventListener("cancel", remeasure)
    }
    requestAnimationFrame(() => requestAnimationFrame(() => reveal(true)))
    // Garantia: sem quadros (aba em segundo plano, máquina lenta), o avatar aparece mesmo assim — nunca fica escondido.
    window.setTimeout(() => reveal(false), REVEAL_FALLBACK_MS)
  }
}

/** Lugar onde o avatar aparece (o tamanho é do lugar; o avatar ocupa 100%). */
export function AvatarSlot({ manager, priority, className, flyIn = false }: { manager: AvatarHostManager | null; priority: number; className?: string; flyIn?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!manager || !element) return
    return manager.claim(element, priority, { flyIn })
  }, [manager, priority, flyIn])
  return <div ref={ref} className={cn("relative min-h-0", className)} data-avatar-slot={priority} />
}
