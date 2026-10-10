"use client"

import Link from "next/link"
import { BookOpen, ExternalLink, FileSearch, Info } from "lucide-react"

import { FeedbackNarrativeView } from "@/components/feedbacks/feedback-narrative-view"
import { RichContent } from "@/components/rich-content/rich-content"
import { Skeleton } from "@/components/ui/skeleton"
import type { FeedbackApplicationContent, FeedbackApplicationDetail } from "@/schemas/feedback-applications/feedback-application.schema"

/**
 * CONTEÚDO do feedback na sessão — o registro aplicado, nunca dado atual. Com a apresentação publicada (feedback V2/motor),
 * o MESMO componente do Acompanhamento (narrativa primeiro; "Entenda este feedback" e materiais por expansão). Sem ela, o
 * texto publicado e as seções registradas (indicadores do período, evidências, orientações, pontos fortes e materiais),
 * recolhidas. As limitações do registro ficam acessíveis no fim — é o que a INIA também diz quando perguntam.
 */
export function FeedbackSessionContent({ application, hideMaterials = false }: { application: FeedbackApplicationDetail | null; hideMaterials?: boolean }) {
  if (!application) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Carregando o feedback">
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="mt-5 h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    )
  }
  const content = application.content
  return (
    <div className="min-w-0 space-y-4" data-testid="feedback-session-content">
      {content?.view ? <FeedbackNarrativeView view={content.view} hideMaterials={hideMaterials} /> : content ? <RegisteredFeedback content={content} hideMaterials={hideMaterials} /> : <p className="text-sm text-muted-foreground">O conteúdo deste feedback não está disponível agora. A conversa continua com o registro guardado pela INIA.</p>}
      {application.sourceCorrected ? (
        <p className="flex gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-5 text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />Este feedback recebeu uma correção publicada depois desta conversa. A conversa continua sobre a versão apresentada aqui.</p>
      ) : null}
      {application.limitations.length > 0 ? (
        <details className="group text-xs leading-5" data-testid="feedback-session-limitations">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <Info className="size-3.5" aria-hidden />Sobre este registro ({application.limitations.length})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{application.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </details>
      ) : null}
    </div>
  )
}

/** Feedback sem a apresentação detalhada (anterior a ela, ou de atendimento): o texto publicado e as seções registradas. */
function RegisteredFeedback({ content, hideMaterials }: { content: FeedbackApplicationContent; hideMaterials: boolean }) {
  const sections = [
    { key: "evidence", title: "O que foi observado", items: content.evidence },
    { key: "guidance", title: "Orientações registradas", items: content.guidance },
    { key: "strengths", title: "Pontos fortes registrados", items: content.strengths },
  ].filter((section) => section.items.length > 0)
  const hasDetails = sections.length > 0 || content.indicators.length > 0
  return (
    <article className="min-w-0 space-y-4" aria-label="Feedback">
      <div className="text-[15px] leading-7 text-foreground"><RichContent text={content.text} /></div>
      {hasDetails ? (
        <details className="group rounded-xl border bg-card" data-slot="feedback-panel">
          <summary className="flex cursor-pointer list-none items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4 [&::-webkit-details-marker]:hidden">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden><FileSearch className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5">Entenda este feedback</span>
              <span className="block text-xs leading-5 text-muted-foreground">Indicadores, observações e orientações como foram registrados.</span>
            </span>
          </summary>
          <div className="space-y-4 border-t px-3 py-3 text-sm leading-6 sm:px-4">
            {content.indicators.length > 0 ? (
              <section>
                <h5 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Indicadores do período avaliado</h5>
                <ul className="space-y-2">
                  {content.indicators.map((indicator) => (
                    <li key={indicator.name}>
                      <p className="font-medium">{indicator.name}</p>
                      <dl className="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 text-muted-foreground">
                        {indicator.lines.map((line) => <div key={line.label} className="contents"><dt>{line.label}</dt><dd className="font-medium text-foreground tabular-nums">{line.value}</dd></div>)}
                      </dl>
                      {indicator.notes.map((note) => <p key={note} className="mt-1 text-xs text-muted-foreground">{note}</p>)}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {sections.map((section) => (
              <section key={section.key}>
                <h5 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</h5>
                <ul className="list-disc space-y-1 pl-5">{section.items.map((item) => <li key={item} className="break-words">{item}</li>)}</ul>
              </section>
            ))}
          </div>
        </details>
      ) : null}
      {content.materials.length > 0 && !hideMaterials ? (
        <section className="rounded-xl border bg-card px-3 py-3 sm:px-4" aria-label="Materiais utilizados">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><BookOpen className="size-4 text-primary" aria-hidden />Materiais utilizados</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {content.materials.map((material) => (
              <li key={material.documentId}>
                {material.href ? (
                  <Link href={material.href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline dark:text-chart-4">{material.title}<ExternalLink className="size-3" aria-hidden /><span className="sr-only">(abre em nova aba)</span></Link>
                ) : (
                  <span className="font-medium">{material.title} <span className="text-xs font-normal text-muted-foreground">· Material indisponível para este perfil</span></span>
                )}
                {material.sections.length > 0 ? <p className="text-xs text-muted-foreground">Seções: {material.sections.join(", ")}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

/** Materiais do feedback (os documentos do procedimento usados nele) — os mesmos do Acompanhamento, com link só para quem tem acesso. */
function materialsOf(application: FeedbackApplicationDetail | null): { documentId: string; title: string; href: string | null; detail: string | null }[] {
  const content = application?.content
  if (!content) return []
  if (content.view) return content.view.materials.map((material) => ({ documentId: material.documentId, title: material.title, href: material.accessible === false ? null : material.href, detail: material.sections?.join(" · ") || material.usedIn.join(" · ") || null }))
  return content.materials.map((material) => ({ documentId: material.documentId, title: material.title, href: material.href, detail: material.sections.join(" · ") || material.reason }))
}

/** Faixa de MATERIAIS da sessão de feedback (entre o conteúdo e o campo de mensagem). Sem material = nada. */
export function FeedbackSessionMaterials({ application }: { application: FeedbackApplicationDetail | null }) {
  const materials = materialsOf(application)
  if (materials.length === 0) return null
  return (
    <section aria-label="Materiais utilizados" data-testid="feedback-session-materials" className="flex items-center gap-2 overflow-x-auto px-4 py-2.5 [scrollbar-width:thin] sm:px-5">
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-muted-foreground"><BookOpen className="size-3.5 text-primary dark:text-chart-4" aria-hidden />Materiais</span>
      {materials.map((material) => material.href ? (
        <Link key={material.documentId} href={material.href} target="_blank" rel="noopener noreferrer" title={material.detail ?? undefined} className="inline-flex max-w-80 shrink-0 items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          <span className="truncate">{material.title}</span><ExternalLink className="size-3 shrink-0 text-muted-foreground" aria-hidden /><span className="sr-only">(abre em nova aba)</span>
        </Link>
      ) : (
        <span key={material.documentId} title={material.detail ?? undefined} className="inline-flex max-w-80 shrink-0 items-center gap-1 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground"><span className="truncate">{material.title}</span> · indisponível para este perfil</span>
      ))}
    </section>
  )
}
