"use client"

import { useEffect, useMemo } from "react"
import { FileWarning, ScanText } from "lucide-react"

import { KnowledgeArticleContent, type ArticleInsert } from "@/components/admin/knowledge/knowledge-article-content"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { documentInserts } from "@/lib/knowledge/document-inserts"
import type { PdfExtraction } from "@/schemas/admin/knowledge.schema"

import { KnowledgeDocumentImage } from "./knowledge-document-image"

export const pageAnchorId = (page: number) => `pagina-${page}`

export type ReadingMode = "content" | "pdf"

/** Conteúdo ou arquivo original, nas telas de leitura de um PDF convertido. */
export function ReadingModeSwitch({ mode, onChange }: { mode: ReadingMode; onChange: (mode: ReadingMode) => void }) {
  return (
    <ToggleGroup type="single" value={mode} onValueChange={(value) => (value ? onChange(value as ReadingMode) : undefined)} aria-label="Como ler este material" data-testid="reading-mode">
      <ToggleGroupItem value="content">Conteúdo</ToggleGroupItem>
      <ToggleGroupItem value="pdf">PDF original</ToggleGroupItem>
    </ToggleGroup>
  )
}

export const READING_VIEW_NOTE = "Texto e imagens extraídos do arquivo. A INIA lê o texto; as imagens são para você consultar. Gráficos e desenhos que não são imagem só aparecem no PDF original."

/**
 * Um PDF convertido lido como qualquer conteúdo cadastrado: o mesmo texto que a IA usa, com cada imagem no lugar dela e o mesmo renderizador das bases
 * de texto. Página sem nada que dê para mostrar aparece como aviso no ponto certo, com o caminho até ela no PDF original.
 */
export function KnowledgeReadingView({
  content,
  extraction,
  title,
  imageSrc,
  targetPage,
  onOpenPage,
}: {
  content: string
  extraction: PdfExtraction
  title: string
  imageSrc: (imageId: string) => string
  /** Página citada: a leitura abre nela. */
  targetPage?: number | undefined
  onOpenPage: (page: number) => void
}) {
  useEffect(() => {
    if (targetPage === undefined) return
    window.document.getElementById(pageAnchorId(targetPage))?.scrollIntoView?.({ block: "start" })
  }, [targetPage])

  const inserts = useMemo<ArticleInsert[]>(
    () =>
      documentInserts(content, extraction).map((insert, index) => {
        if (insert.kind === "page") return { at: insert.at, key: `page-${insert.page}`, node: <span id={pageAnchorId(insert.page)} data-testid={pageAnchorId(insert.page)} className="block scroll-mt-20" aria-hidden /> }
        if (insert.kind === "image") {
          const { image } = insert
          return { at: insert.at, key: `image-${image.id}-${index}`, node: <KnowledgeDocumentImage src={imageSrc(image.id)} page={image.page} width={image.width} height={image.height} caption={`Imagem da página ${image.page}. A INIA não lê imagens.`} /> }
        }
        return {
          at: insert.at,
          key: `missing-${insert.page}`,
          node: (
            <div className="my-5 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground" data-testid="reading-missing-page">
              <FileWarning aria-hidden className="size-4 shrink-0" />
              <span>{`A página ${insert.page} não tem texto para mostrar aqui.`}</span>
              <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => onOpenPage(insert.page)}>
                Ver no PDF
              </Button>
            </div>
          ),
        }
      }),
    [content, extraction, imageSrc, onOpenPage],
  )

  return (
    <article className="mx-auto max-w-3xl space-y-4 px-1 py-2 sm:px-4" data-testid="knowledge-reading-view">
      {extraction.imagesOmitted ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="reading-images-omitted">
          <FileWarning aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {extraction.imagesOmitted === 1 ? "Uma imagem deste documento só aparece no PDF original." : `${extraction.imagesOmitted} imagens deste documento só aparecem no PDF original.`}
        </p>
      ) : null}
      {extraction.ocr?.pages.length ? (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground" data-testid="reading-ocr">
          <ScanText aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {extraction.ocr.pages.length === extraction.pageCount
            ? "Este documento é digitalizado: o texto foi lido da imagem das páginas e pode ter erros de leitura. Na dúvida sobre um número ou prazo, veja o PDF original."
            : "Parte deste documento é digitalizada: o texto dessas páginas foi lido da imagem e pode ter erros de leitura. Na dúvida sobre um número ou prazo, veja o PDF original."}
        </p>
      ) : null}
      <KnowledgeArticleContent text={content} omitLeadingHeading={title} inserts={inserts} />
    </article>
  )
}
