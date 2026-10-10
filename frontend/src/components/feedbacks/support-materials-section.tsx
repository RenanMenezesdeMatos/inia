"use client"

import Link from "next/link"
import { ArrowRight, BookOpen } from "lucide-react"

import { Button } from "@/components/ui/button"
import { buildKnowledgeMaterialHref } from "@/lib/knowledge/material-href"
import { cn } from "@/lib/utils"
import type { FeedbackSupportMaterial } from "@/schemas/feedbacks/support-material.schema"

/**
 * Seção explícita "Material de apoio recomendado" de um Feedback — apoio secundário ao conteúdo
 * principal, nunca escondido no texto. Reaproveitada pelo Acompanhamento do operador e pelo detalhe
 * do feed da estrutura (mesmo objeto, mesma regra):
 *   - título e link vêm do MATERIAL REAL (o backend resolveu o id contra a Base de Conhecimento com
 *     o acesso de quem está lendo); a URL é montada aqui por `buildKnowledgeMaterialHref`, nunca
 *     pelo modelo;
 *   - o motivo é o único texto produzido pela IA;
 *   - material que deixou de estar disponível (despublicado, removido, fora do alcance) aparece
 *     como aviso neutro, sem título e sem link — a referência não concede acesso;
 *   - abrir o material NÃO é ciência do Feedback (ciência continua sendo o botão próprio).
 * Sem materiais → não renderiza nada (nenhuma seção vazia).
 */
export function SupportMaterialsSection({ materials, className }: { materials: FeedbackSupportMaterial[] | undefined; className?: string }) {
  if (!materials || materials.length === 0) return null
  const available = materials.filter((material) => material.available)
  const unavailableCount = materials.length - available.length
  const heading = materials.length === 1 ? "Material de apoio recomendado" : "Materiais de apoio recomendados"

  return (
    <section aria-label={heading} className={cn("space-y-3", className)}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{heading}</h3>
      {available.length > 0 ? (
        <ul className="space-y-2">
          {available.map((material) =>
            material.available ? (
              <li key={material.materialId} className="rounded-lg border border-border bg-card p-3 sm:p-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden>
                    <BookOpen className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="font-medium leading-snug break-words">{material.title}</p>
                    <p className="text-sm leading-6 text-muted-foreground break-words">{material.reason}</p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end">
                  <Button size="sm" variant="outline" asChild>
                    {/* V1.6.0 — material abre em nova aba (o feedback continua aberto); o link nasce do id real do documento. */}
                    <Link href={buildKnowledgeMaterialHref(material.materialId)} target="_blank" rel="noopener noreferrer" data-usage-element="feedback.material.open" aria-label={`Acessar material: ${material.title} (abre em nova aba)`}>
                      Acessar material
                      <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              </li>
            ) : null,
          )}
        </ul>
      ) : null}
      {unavailableCount > 0 ? (
        <p className="text-sm text-muted-foreground" role="note">
          {unavailableCount === 1 ? "Um material de apoio recomendado não está mais disponível." : `${unavailableCount} materiais de apoio recomendados não estão mais disponíveis.`}
        </p>
      ) : null}
    </section>
  )
}
