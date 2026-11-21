"use client"

import { useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import { KnowledgeImageViewer, viewerImageAlt, type ViewerImage } from "./knowledge-image-viewer"

/**
 * Uma imagem de PDF de base (print de instrução de trabalho). Abre ampliada num clique, porque print de tela no tamanho da coluna fica pequeno para
 * ler. `width` e `height` reservam o espaço antes de carregar: com muitas imagens, é o que mantém a página parada e o salto para uma página certo.
 *
 * Com `gallery`, a imagem ampliada é uma das imagens do conjunto (as de uma resposta, de um trecho, do material inteiro), e dali se vai à anterior
 * e à próxima (`KnowledgeImageViewer`). `description` é o texto da própria base junto da imagem, mostrado só na ampliada.
 */
export function KnowledgeDocumentImage({
  src,
  page,
  width,
  height,
  caption,
  description,
  thumbnail = false,
  footer,
  gallery,
  onUnavailable,
}: {
  src: string
  page: number
  width: number
  height: number
  caption: string
  description?: string | null | undefined
  /** Miniatura de altura fixa, para as imagens abaixo de uma resposta. */
  thumbnail?: boolean
  footer?: ReactNode
  /** O conjunto em que esta imagem está, na ordem do documento, e a posição dela nele. Sem conjunto, a ampliada mostra só esta. */
  gallery?: { images: readonly ViewerImage[]; index: number } | undefined
  onUnavailable?: () => void
}) {
  const [failed, setFailed] = useState(false)
  const [open, setOpen] = useState(false)
  const [shown, setShown] = useState(0)
  const alt = viewerImageAlt(page)
  if (failed) {
    if (onUnavailable) return null
    return <p className="my-4 text-xs italic text-muted-foreground">{`Não foi possível carregar a imagem da página ${page}.`}</p>
  }
  const images = gallery && gallery.images.length > 0 ? gallery.images : [{ key: src, src, page, width, height, caption, description, footer }]
  const own = gallery && gallery.images.length > 0 ? gallery.index : 0
  const total = images.length
  return (
    <figure className={cn("space-y-1.5", !thumbnail && "my-5")} data-testid="knowledge-document-image">
      <KnowledgeImageViewer
        images={images}
        index={shown}
        open={open}
        onOpenChange={setOpen}
        onIndexChange={setShown}
        trigger={
          <button
            type="button"
            aria-label={total > 1 ? `Ampliar a imagem da página ${page} (imagem ${own + 1} de ${total})` : `Ampliar a imagem da página ${page}`}
            className={cn("block max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-white outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring/50", thumbnail && "w-full")}
            onClick={() => setShown(own)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- imagem da API autenticada por cookie: fora do otimizador do Next. */}
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
          </button>
        }
      />
      <figcaption className="text-xs text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}
