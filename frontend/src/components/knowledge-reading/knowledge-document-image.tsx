"use client"

import { useState, type ReactNode } from "react"

import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * Uma imagem de PDF de base (print de instrução de trabalho). Abre ampliada num clique, porque print de tela no tamanho da coluna fica pequeno para
 * ler. `width` e `height` reservam o espaço antes de carregar: com muitas imagens, é o que mantém a página parada e o salto para uma página certo.
 */
export function KnowledgeDocumentImage({
  src,
  page,
  width,
  height,
  caption,
  thumbnail = false,
  footer,
  onUnavailable,
}: {
  src: string
  page: number
  width: number
  height: number
  caption: string
  /** Miniatura de altura fixa, para as imagens abaixo de uma resposta. */
  thumbnail?: boolean
  footer?: ReactNode
  onUnavailable?: () => void
}) {
  const [failed, setFailed] = useState(false)
  const alt = `Imagem da página ${page} do documento`
  if (failed) {
    if (onUnavailable) return null
    return <p className="my-4 text-xs italic text-muted-foreground">{`Não foi possível carregar a imagem da página ${page}.`}</p>
  }
  const image = (
    // eslint-disable-next-line @next/next/no-img-element -- imagem da API autenticada por cookie: fora do otimizador do Next.
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading="lazy"
      decoding="async"
      className={cn(thumbnail ? "h-28 w-full object-contain" : "h-auto max-w-full")}
      onError={() => {
        setFailed(true)
        onUnavailable?.()
      }}
    />
  )
  return (
    <figure className={cn("space-y-1.5", !thumbnail && "my-5")} data-testid="knowledge-document-image">
      <Dialog>
        <DialogTrigger asChild>
          <button type="button" aria-label={`Ampliar a imagem da página ${page}`} className={cn("block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50", thumbnail && "w-full")}>
            {image}
          </button>
        </DialogTrigger>
        {/* Largura explícita: centralizada pela esquerda em 50%, a caixa com largura automática não passaria da metade da tela. */}
        <DialogContent className="max-h-[94vh] max-w-none gap-2 overflow-auto p-3 sm:max-w-none" style={{ width: `min(96vw, ${Math.max(width, 480) + 26}px)` }}>
          <DialogTitle className="pr-8 text-sm font-medium">{`Página ${page}`}</DialogTitle>
          <DialogDescription>{caption}</DialogDescription>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem da API autenticada por cookie: fora do otimizador do Next. */}
          <img src={src} alt={alt} width={width} height={height} className="h-auto max-w-full rounded-md border border-border bg-white" />
          {footer}
        </DialogContent>
      </Dialog>
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}
