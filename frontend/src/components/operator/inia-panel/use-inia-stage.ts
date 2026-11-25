"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { fitWindow, type WindowLimits, type WindowPlace } from "./floating-window"
import { useIniaPanel } from "./inia-panel-context"
import { animateFrom, PANEL_EASING, PANEL_MOTION_MS, prefersReducedMotion } from "./motion"

/** Onde a INIA está: encaixada no painel (inteira ou reduzida), na janela pequena, na maior, ou só na aba da borda. */
export type StageMode = "docked" | "reduced" | "mini" | "large" | "stowed"
export type DragState = "none" | "far" | "over"

/** Altura da janela pela largura. A pequena é um pouco mais alta, para a legenda não encostar no queixo. */
export const miniHeight = (w: number) => Math.round(w * 0.64)
export const largeHeight = (w: number) => Math.round(w * 0.5625)
export const MINI_WINDOW: WindowLimits = { min: 260, max: 420, height: miniHeight }
export const LARGE_WINDOW: WindowLimits = { min: 300, max: 1_100, height: largeHeight }
const UNSET = 9_999

/**
 * UMA imagem da INIA, vários lugares: o nó dela é estável e MUDA de pai (painel × janela que flutua), com a transição saindo de onde estava.
 * O Canvas do avatar (dentro dele, pelo `AvatarHostManager`) nunca remonta. Fora do painel ela flutua por cima da página, a pessoa a põe onde
 * quiser, e nada da página muda de lugar.
 */
export function useIniaStage({ short, inCall }: { short: boolean; inCall: boolean }) {
  const panel = useIniaPanel()
  const open = panel?.open ?? true
  const wide = panel?.wide ?? true
  const [floating, setFloating] = useState<"none" | "mini" | "large" | "stowed">(open ? "none" : "stowed")
  const [reduced, setReduced] = useState(false)
  const [mini, setMini] = useState<WindowPlace>({ x: UNSET, y: UNSET, w: 300 })
  const [large, setLarge] = useState<WindowPlace>({ x: UNSET, y: 120, w: 680 })
  const [drag, setDrag] = useState<DragState>("none")
  // Numa chamada ela nunca fica só na aba: os controles precisam estar à mão.
  const mode: StageMode = floating === "large" ? "large" : !open ? (floating === "stowed" && !inCall ? "stowed" : "mini") : short || reduced ? "reduced" : "docked"
  const inPanel = mode === "docked" || mode === "reduced"

  const [node] = useState(() => (typeof document === "undefined" ? null : Object.assign(document.createElement("div"), { className: "absolute inset-0" })))
  // Lugares por estado (não por ref): quem os monta recebe só o setter.
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [edgeTab, setEdgeTab] = useState<HTMLElement | null>(null)
  const [layer, setLayer] = useState<HTMLElement | null>(null)
  const beforeRef = useRef<{ rect: DOMRect; mode: StageMode; inPanel: boolean; sameMode: boolean } | null>(null)
  /** Mudou de lugar por um botão que sai de cena com a mudança: o foco vai para o equivalente no lugar novo (o modo de onde saiu). */
  const focusFromRef = useRef<StageMode | null>(null)
  useLayoutEffect(() => {
    if (!node) return
    // Guardada na aba: fora do documento (o avatar para de desenhar sozinho — ninguém o vê).
    const target = inPanel ? slot : mode === "stowed" ? null : layer
    if (!target) return
    if (node.parentElement !== target) target.appendChild(node)
    if (focusFromRef.current !== null && focusFromRef.current !== mode) {
      focusFromRef.current = null
      const control = node.querySelector<HTMLElement>(`[data-inia-action="${mode === "large" ? "back" : "enlarge"}"]`)
      // Reduzida ou na janela estreita, a imagem no painel não tem esse botão: fica o de recolher, no cabeçalho.
      ;(control ?? panel?.panelElement()?.querySelector<HTMLElement>("[data-chat-collapse]"))?.focus({ preventScroll: true })
    }
    const before = beforeRef.current
    // Espera a imagem já estar no arranjo novo (a camada flutuante nasce um passo depois).
    if (!before || !target.isConnected || (before.mode === mode && !before.sameMode)) return
    beforeRef.current = null
    const image = node.querySelector<HTMLElement>("[data-inia-image]")
    if (image) animateFrom(inPanel && before.inPanel ? image : inPanel ? node : (node.closest<HTMLElement>("[data-inia-window]") ?? node), image, before.rect)
  })
  /** De onde ela vai sair: medido no clique, antes de a tela mudar. */
  const mark = (sameMode = false) => {
    const image = node?.isConnected ? node.querySelector<HTMLElement>("[data-inia-image]") : null
    const rect = image?.getBoundingClientRect()
    beforeRef.current = rect && rect.width > 0 ? { rect, mode, inPanel, sameMode } : null
  }

  /** Até onde dá para flutuar sem entrar no painel (aberto) ou na aba da borda (recolhido). */
  const freeUntil = (withPanel: boolean) => {
    const element = panel?.panelElement()
    if (wide) return withPanel && element ? element.offsetLeft : window.innerWidth - 72
    return window.innerWidth - (window.innerWidth > window.innerHeight ? 52 : 0)
  }
  const miniPlace = (): WindowPlace => {
    if (mini.x !== UNSET) return fitWindow(mini, MINI_WINDOW)
    const w = Math.round(Math.min(wide ? 300 : 260, (window.innerHeight - 100) / 0.64))
    return fitWindow({ w, x: Math.max(12, window.innerWidth - w - (wide ? 88 : 64)), y: window.innerHeight - miniHeight(w) - 24 }, MINI_WINDOW)
  }
  const expand = () => {
    mark(floating === "large")
    panel?.setOpen(true)
    // O painel que volta não passa por baixo da janela maior: ela se afasta para o lado.
    if (floating === "large") setLarge((current) => ({ ...current, x: Math.max(12, Math.min(current.x, freeUntil(true) - current.w - 24)) }))
    else setFloating("none")
  }
  const collapse = (quiet = false) => {
    mark()
    setMini(miniPlace())
    panel?.setOpen(false)
    setFloating((current) => (current === "large" ? "large" : quiet && !inCall ? "stowed" : "mini"))
  }
  const enlarge = () => {
    mark()
    focusFromRef.current = mode
    // Nasce encostada no painel, por cima da página; depois fica onde a pessoa deixar.
    if (large.x === UNSET) {
      // Perto do dobro da área do painel e embaixo, à direita: o cabeçalho, o menu e o começo dos textos continuam à vista.
      const free = freeUntil(open)
      // No celular usa a largura quase toda; em tela deitada, o limite é a altura.
      const freeHeight = (window.innerHeight - 60 - 24) / 0.5625
      const w = Math.round(wide ? Math.max(320, Math.min(640, Math.max(420, free * 0.54), freeHeight)) : Math.min(window.innerWidth - 24, freeHeight))
      setLarge(fitWindow({ w, x: Math.max(12, free - w - 24), y: Math.max(72, window.innerHeight - largeHeight(w) - 24) }, LARGE_WINDOW))
    } else setLarge((current) => fitWindow(current, LARGE_WINDOW))
    setFloating("large")
  }
  const shrink = () => {
    mark()
    focusFromRef.current = mode
    setMini(miniPlace())
    setFloating(open ? "none" : "mini")
  }
  const toggleReduced = () => {
    mark()
    setReduced((value) => !value)
  }
  /** Soltar encaixa quando o ponteiro está no painel (ou na aba), ou quando metade da janela já está por cima dele. */
  const overDock = (x: number, y: number, rect: DOMRect) => {
    const target = (open ? panel?.panelElement() : edgeTab)?.getBoundingClientRect()
    if (!target) return false
    const slack = open ? 0 : 28
    const pointer = x >= target.left - slack && x <= target.right + slack && y >= target.top - slack && y <= target.bottom + slack
    const covered = open && (Math.min(rect.right, target.right) - Math.max(rect.left, target.left)) / rect.width > 0.5
    return pointer || covered
  }
  const onDrag = (x: number, y: number, rect: DOMRect) => setDrag(overDock(x, y, rect) ? "over" : "far")
  const onDrop = (x: number, y: number, rect: DOMRect) => {
    setDrag("none")
    if (!overDock(x, y, rect)) return
    mark()
    // Com o painel recolhido, quem leva o foco é a abertura dele.
    if (open) focusFromRef.current = mode
    else panel?.setOpen(true)
    setFloating("none")
    // Onde ela foi solta é o encaixe, não um lugar escolhido: da próxima vez nasce no lugar padrão, sem cobrir o painel nem a aba.
    if (mode === "large") setLarge((current) => ({ ...current, x: UNSET }))
    else setMini((current) => ({ ...current, x: UNSET }))
  }
  /** A janela pequena voa para a aba da borda e some nela. */
  const stow = () => {
    const win = node?.closest<HTMLElement>("[data-inia-window]")
    const away = () => {
      // O botão some com a janela. Quem já foi para outro lugar durante o voo fica onde está.
      if (win?.contains(document.activeElement) || document.activeElement === document.body) edgeTab?.focus({ preventScroll: true })
      setFloating("stowed")
    }
    if (!win || typeof win.animate !== "function" || prefersReducedMotion()) return away()
    const rect = win.getBoundingClientRect()
    const flight = win.animate(
      [{ transformOrigin: "0 0", transform: "none", opacity: 1 }, { transformOrigin: "0 0", transform: `translate(${window.innerWidth - 40 - rect.left}px, ${window.innerHeight * 0.44 - rect.top}px) scale(0.1)`, opacity: 0.2 }],
      { duration: PANEL_MOTION_MS, easing: PANEL_EASING, fill: "forwards" },
    )
    flight.onfinish = away
  }

  // Pedidos de fora (aviso do Apoio, "Ler feedback") usam sempre a ação mais recente.
  const actionsRef = useRef({ expand, collapse })
  useEffect(() => {
    actionsRef.current = { expand, collapse }
  })
  const registerActions = panel?.registerActions
  useEffect(() => {
    if (!registerActions) return
    registerActions({ expand: () => actionsRef.current.expand(), collapse: () => actionsRef.current.collapse(true) })
    return () => registerActions(null)
  }, [registerActions])

  return {
    panel, open, wide, mode, inPanel, reduced, node, setSlot, setEdgeTab, setLayer, drag,
    place: mode === "large" ? large : mini,
    setPlace: mode === "large" ? setLarge : setMini,
    expand, collapse, enlarge, shrink, toggleReduced, stow, onDrag, onDrop,
  }
}

export type IniaStageState = ReturnType<typeof useIniaStage>
