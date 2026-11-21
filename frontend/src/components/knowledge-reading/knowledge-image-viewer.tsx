"use client"

import { useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react"
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/** Uma imagem que o visualizador ampliado sabe mostrar. `description` é texto LITERAL da base junto da imagem (`imageStepText`), nunca da IA. */
export type ViewerImage = {
  key: string
  src: string
  page: number
  width: number
  height: number
  caption: string
  description?: string | null | undefined
  footer?: ReactNode
}

/** Deslocamento horizontal mínimo, em px, para um toque contar como "passar" a imagem (e não como toque parado ou rolagem). */
const SWIPE_MIN = 48

export const viewerImageAlt = (page: number) => `Imagem da página ${page} do documento`

/**
 * As imagens de um material ampliadas, uma de cada vez, com o caminho para a anterior e a próxima: setas na tela, ← → no teclado e o gesto de
 * passar no toque. Esc fecha (o Radix cuida, e também prende o foco no modal). Embaixo de cada imagem vai o texto da própria base junto dela;
 * sem texto, nada (nunca uma descrição inventada). As setas ficam desligadas por `aria-disabled` nas pontas, e não por `disabled`, para o foco
 * de quem está no teclado não cair fora do modal quando chega na última imagem.
 */
export function KnowledgeImageViewer({
  images,
  index,
  open,
  onOpenChange,
  onIndexChange,
  trigger,
}: {
  images: readonly ViewerImage[]
  index: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onIndexChange: (index: number) => void
  /** O que abre o visualizador (a miniatura): ao fechar, o foco volta para ele. */
  trigger?: ReactNode
}) {
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const total = images.length
  const current = images[Math.min(Math.max(index, 0), total - 1)]
  if (!current) return null
  const position = images.indexOf(current)
  const hasPrevious = position > 0
  const hasNext = position < total - 1
  const go = (step: -1 | 1) => {
    const target = position + step
    if (target >= 0 && target < total) onIndexChange(target)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      go(-1)
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      go(1)
    }
  }
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0]
    touchStart.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current
    const touch = event.changedTouches[0]
    touchStart.current = null
    if (!start || !touch) return
    const dx = touch.clientX - start.x
    const dy = touch.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) < Math.abs(dy) * 1.5) return
    go(dx < 0 ? 1 : -1)
  }
  const widest = Math.max(...images.map((image) => image.width), 480)
  const counter = `Imagem ${position + 1} de ${total}`
  const title = total > 1 ? `${counter} · Página ${current.page}` : `Página ${current.page}`
  const arrow = "absolute top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-background/95 shadow-sm aria-disabled:pointer-events-none aria-disabled:opacity-0"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      {/* Largura explícita: centralizada pela esquerda em 50%, a caixa com largura automática não passaria da metade da tela. Fica a da maior
          imagem do conjunto, para a caixa não pular de tamanho a cada seta. */}
      <DialogContent
        showCloseButton={false}
        className="max-h-[96vh] max-w-none gap-3 overflow-auto p-3 sm:max-w-none sm:p-4"
        style={{ width: `min(96vw, ${widest + 34}px)` }}
        onKeyDown={onKeyDown}
        data-testid="knowledge-image-viewer"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <DialogTitle className="text-sm font-medium">{title}</DialogTitle>
            <DialogDescription className="text-xs">{current.caption}</DialogDescription>
          </div>
          <DialogClose asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar a imagem ampliada">
              <XIcon aria-hidden />
            </Button>
          </DialogClose>
        </div>
        {total > 1 ? (
          <p className="sr-only" aria-live="polite" aria-atomic>
            {counter}
          </p>
        ) : null}
        <div className="relative flex min-h-24 items-center justify-center rounded-md border border-border bg-white" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-testid="knowledge-image-viewer-stage">
          {failed.has(current.key) ? (
            <p className="p-6 text-xs italic text-muted-foreground">{`Não foi possível carregar a imagem da página ${current.page}.`}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- imagem da API autenticada por cookie: fora do otimizador do Next.
            <img
              key={current.key}
              src={current.src}
              alt={viewerImageAlt(current.page)}
              width={current.width}
              height={current.height}
              draggable={false}
              className="h-auto max-h-[64vh] w-auto max-w-full select-none rounded-md object-contain"
              onError={() => setFailed((known) => new Set(known).add(current.key))}
            />
          )}
          {total > 1 ? (
            <>
              <Button type="button" variant="outline" size="icon" className={cn(arrow, "left-2")} aria-label="Imagem anterior" aria-disabled={!hasPrevious} tabIndex={hasPrevious ? 0 : -1} onClick={() => go(-1)}>
                <ChevronLeft aria-hidden />
              </Button>
              <Button type="button" variant="outline" size="icon" className={cn(arrow, "right-2")} aria-label="Próxima imagem" aria-disabled={!hasNext} tabIndex={hasNext ? 0 : -1} onClick={() => go(1)}>
                <ChevronRight aria-hidden />
              </Button>
            </>
          ) : null}
        </div>
        {current.description ? (
          <div className="space-y-1 rounded-md bg-muted/60 px-3 py-2" data-testid="knowledge-image-viewer-description">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">No material, junto desta imagem</p>
            <p className="text-sm leading-6 break-words whitespace-pre-line text-foreground">{current.description}</p>
          </div>
        ) : null}
        {total > 1 ? (
          <p className="text-center text-[11px] text-muted-foreground" aria-hidden>
            <span className="sm:hidden">Deslize para o lado para ver a próxima imagem.</span>
            <span className="hidden sm:inline">Use as setas ← → do teclado para trocar de imagem e Esc para fechar.</span>
          </p>
        ) : null}
        {current.footer}
      </DialogContent>
    </Dialog>
  )
}
