"use client"

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

export type WindowPlace = { x: number; y: number; w: number }
const EDGE_PX = 12
/** Altura da barra do app: a janela nunca passa por cima dela. */
const TOP_BAR_PX = 56

/** O que limita a janela (a pequena e a maior têm os seus). */
export type WindowLimits = {
  min: number
  max: number
  /** Altura a partir da largura. */
  height(width: number): number
}

/** Cabe inteira na tela de AGORA, abaixo da barra do app: a altura limita tanto quanto a largura, e o mínimo cede numa tela menor que ele. */
export function fitWindow(place: WindowPlace, { min, max, height }: WindowLimits): WindowPlace {
  const top = TOP_BAR_PX + 4
  const widthByHeight = Math.floor(Math.max(0, window.innerHeight - top - EDGE_PX) / (height(1_000) / 1_000))
  const w = Math.min(window.innerWidth - EDGE_PX * 2, widthByHeight, Math.max(min, Math.min(max, place.w)))
  return { w, x: Math.max(EDGE_PX, Math.min(window.innerWidth - w - EDGE_PX, place.x)), y: Math.max(top, Math.min(window.innerHeight - height(w) - EDGE_PX, place.y)) }
}

/** Elevação de coisa que flutua, discreta: contato leve + sombra curta e difusa, neutra. */
export const FLOATING_SHADOW = "shadow-[0_1px_3px_rgba(28,10,45,0.06),0_10px_30px_-8px_rgba(28,10,45,0.16)] dark:ring-1 dark:ring-white/15"

type FloatingWindowProps = WindowLimits & {
  name: string
  place: WindowPlace
  onPlace(place: WindowPlace): void
  hidden?: boolean
  /** O que acontece se soltar aqui. */
  notice?: string | null
  /** Onde está o ponteiro durante o arraste (para acender onde dá para soltar) e onde ele soltou. */
  onDrag?(x: number, y: number, rect: DOMRect): void
  onDrop?(x: number, y: number, rect: DOMRect): void
  children: ReactNode
}

/**
 * Janela que flutua sobre a página: arrasta por qualquer ponto livre dela (ou pelas setas do teclado, na alça) e muda de tamanho pelo canto.
 * Nunca sai da tela. A página continua viva embaixo: nada é coberto por um véu nem perde o lugar.
 */
export function FloatingWindow({ name, place, onPlace, min, max, height, hidden = false, notice = null, onDrag, onDrop, children }: FloatingWindowProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [outline, setOutline] = useState<number | null>(null)
  const inside = (next: WindowPlace): WindowPlace => fitWindow(next, { min, max, height })
  // Janela do navegador menor, zoom, ou a troca pequena ↔ maior (é a mesma janela, com outro lugar): a INIA volta para dentro da tela.
  const latest = useRef({ place, onPlace, inside })
  useLayoutEffect(() => {
    latest.current = { place, onPlace, inside }
  })
  useLayoutEffect(() => {
    const fit = () => latest.current.onPlace(latest.current.inside(latest.current.place))
    fit()
    window.addEventListener("resize", fit)
    return () => window.removeEventListener("resize", fit)
  }, [min, max, height])

  const track = (event: { clientX: number; clientY: number }, move: (dx: number, dy: number, x: number, y: number) => void, end?: (x: number, y: number) => void) => {
    const start = { x: event.clientX, y: event.clientY }
    const onMove = (e: globalThis.PointerEvent) => move(e.clientX - start.x, e.clientY - start.y, e.clientX, e.clientY)
    const release = (e: globalThis.PointerEvent) => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", release)
      window.removeEventListener("pointercancel", release)
      setDragging(false)
      end?.(e.clientX, e.clientY)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", release)
    window.addEventListener("pointercancel", release)
  }
  const drag = (event: globalThis.PointerEvent) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, textarea, [data-no-drag]")) return
    event.preventDefault()
    setDragging(true)
    const base = place
    track(
      event,
      (dx, dy, x, y) => {
        onPlace(inside({ ...base, x: base.x + dx, y: base.y + dy }))
        if (ref.current) onDrag?.(x, y, ref.current.getBoundingClientRect())
      },
      (x, y) => {
        if (ref.current) onDrop?.(x, y, ref.current.getBoundingClientRect())
      },
    )
  }
  // Ouvinte do DOM, não do React: a imagem dela chega por portal e o evento do React não passaria por esta janela.
  const dragRef = useRef(drag)
  useEffect(() => {
    dragRef.current = drag
  })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const listen = (event: globalThis.PointerEvent) => dragRef.current(event)
    element.addEventListener("pointerdown", listen)
    return () => element.removeEventListener("pointerdown", listen)
  }, [])
  const resize = (event: PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const base = place
    let w = base.w
    // O tamanho novo aparece como contorno e só vale ao soltar: o 3D não é refeito a cada pixel.
    track(
      event,
      (dx) => {
        w = inside({ ...base, w: base.w + dx }).w
        setOutline(w)
      },
      () => {
        setOutline(null)
        onPlace(inside({ ...base, w }))
      },
    )
  }
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 64 : 16
    const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key]
    if (!delta) return
    event.preventDefault()
    onPlace(inside({ ...place, x: place.x + delta[0]!, y: place.y + delta[1]! }))
  }
  return (
    <div
      ref={ref}
      data-inia-window
      role="dialog"
      aria-modal="false"
      aria-label={name}
      className={cn("fixed z-40 touch-none rounded-xl select-none", FLOATING_SHADOW, dragging ? "scale-[1.01] cursor-grabbing transition-transform" : "cursor-grab", hidden && "invisible")}
      style={{ left: place.x, top: place.y, width: place.w, height: height(place.w) }}
    >
      <div className="size-full overflow-hidden rounded-xl">{children}</div>
      {notice ? <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="rounded-full bg-black/60 px-3.5 py-1.5 text-xs font-medium text-white backdrop-blur-md">{notice}</span></p> : null}
      {/* Alça: diz que dá para mover e recebe o foco do teclado. */}
      <div tabIndex={0} role="button" aria-label={`Mover ${name}. Use as setas do teclado.`} onKeyDown={onKeyDown} className="absolute top-1.5 left-1/2 flex h-4 w-14 -translate-x-1/2 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-white"><span className="h-1 w-10 rounded-full bg-white/70 shadow" /></div>
      <div onPointerDown={resize} data-no-drag aria-hidden className="absolute -right-1 -bottom-1 flex size-6 cursor-nwse-resize items-end justify-end p-1.5"><span className="size-3 rounded-br-xl border-r-2 border-b-2 border-white/80 drop-shadow" /></div>
      {outline ? <div aria-hidden className="pointer-events-none absolute top-0 left-0 rounded-xl border-2 border-dashed border-primary bg-primary/10" style={{ width: outline, height: height(outline) }} /> : null}
    </div>
  )
}
