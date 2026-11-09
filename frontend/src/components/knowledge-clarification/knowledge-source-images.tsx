"use client"

import { useState } from "react"
import Link from "next/link"

import { KnowledgeDocumentImage } from "@/components/knowledge-reading/knowledge-document-image"
import { Button } from "@/components/ui/button"
import { knowledgeMaterialImageSrc } from "@/lib/knowledge/knowledge-image-src"
import { buildKnowledgeMaterialPageHref } from "@/lib/knowledge/material-href"
import type { ClarificationSource } from "@/schemas/knowledge-clarification/clarification.schema"

/** Quantas aparecem antes do "Ver mais": uma seção longa pode ter muitas, e a resposta continua sendo o texto. */
const VISIBLE_IMAGES = 4

type SourceImage = { source: ClarificationSource; image: NonNullable<ClarificationSource["images"]>[number] }

function imagesOf(sources: readonly ClarificationSource[]): SourceImage[] {
  const seen = new Set<string>()
  return sources.flatMap((source) =>
    source.available
      ? (source.images ?? []).flatMap((image) => {
          const key = `${source.documentId}:${image.id}`
          if (seen.has(key)) return []
          seen.add(key)
          return [{ source, image }]
        })
      : [],
  )
}

/**
 * Os prints das seções usadas como fonte, abaixo da resposta, para a pessoa ver a tela sem abrir o PDF. A seleção vem do sistema, pela posição das
 * imagens no documento: a IA não as recebe nem escolhe. Imagem que não está mais no material em vigor (resposta antiga) simplesmente não aparece.
 */
export function KnowledgeSourceImages({ sources }: { sources: readonly ClarificationSource[] }) {
  const [expanded, setExpanded] = useState(false)
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(new Set())
  const images = imagesOf(sources).filter(({ image }) => !unavailable.has(image.id))
  if (images.length === 0) return null
  const shown = expanded ? images : images.slice(0, VISIBLE_IMAGES)
  const hidden = images.length - shown.length
  return (
    <section aria-label="Imagens do material" className="space-y-1.5" data-testid="knowledge-source-images">
      <div className="grid grid-cols-2 gap-2">
        {shown.map(({ source, image }) => (
          <KnowledgeDocumentImage
            key={`${source.documentId}-${image.id}`}
            thumbnail
            src={knowledgeMaterialImageSrc(source.documentId, image.id)}
            page={image.page}
            width={image.width}
            height={image.height}
            caption={`${source.documentTitle} · p. ${image.page}`}
            onUnavailable={() => setUnavailable((current) => new Set(current).add(image.id))}
            footer={
              <Link href={buildKnowledgeMaterialPageHref(source.documentId, { page: image.page, versionId: source.versionId })} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-2 hover:underline">
                Abrir o material nesta página
              </Link>
            }
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-[11px] text-muted-foreground">Imagens do material, para consulta. A INIA não lê imagens: a resposta vem do texto.</p>
        {hidden > 0 ? (
          <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => setExpanded(true)}>
            {`Ver mais ${hidden}`}
          </Button>
        ) : expanded && images.length > VISIBLE_IMAGES ? (
          <Button type="button" variant="link" size="xs" className="h-auto p-0" onClick={() => setExpanded(false)}>
            Ver menos
          </Button>
        ) : null}
      </div>
    </section>
  )
}
