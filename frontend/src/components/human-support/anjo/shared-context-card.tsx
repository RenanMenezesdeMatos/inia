"use client"

import type { ReactNode } from "react"
import { ChevronDown, ChevronUp, MessageCircleQuestion, PanelLeftClose, PanelLeftOpen, Sparkles, StickyNote, ThumbsDown, type LucideIcon } from "lucide-react"

import { RichContent } from "@/components/rich-content/rich-content"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SharedContext } from "@/schemas/human-support/state.schema"
import { SectionLabel } from "@/components/ui/surface"

/**
 * CÓPIA DA TROCA que o operador compartilhou (design_draft.md seção 7): pergunta, resposta da INIA, motivo e comentário da descurtida
 * e a nota — cada campo com rótulo e ícone próprios, na ordem em que aconteceram, com quebra de textos longos (palavras e endereços
 * sem espaço quebram em qualquer ponto). O que a pessoa escreveu é texto puro (quebras de linha preservadas, nunca HTML); só a
 * resposta da INIA — texto gerado por IA para leitura humana — passa pelo `RichContent` (regra do projeto).
 *
 * Aberto, é um painel: em telas grandes ocupa a coluna da esquerda da altura da conversa e rola por dentro (texto longo nunca
 * comprime nem estica o chat); em telas menores fica acima da conversa, com altura limitada. Recolhido, vira uma linha com a pergunta
 * e o botão "Mostrar" — a conversa ganha o espaço. Recolher só esconde: nada do que foi compartilhado muda (vem pronto do servidor).
 */
export type SharedContextCardProps = {
  context: SharedContext
  open: boolean
  onOpenChange: (open: boolean) => void
  className?: string
}

export function SharedContextCard({ context, open, onOpenChange, className }: SharedContextCardProps) {
  const empty = !context.question && !context.answer && !context.dislike && !context.note
  const summary = empty ? "Sem conversa com a INIA nem nota." : (context.question ?? context.note ?? context.dislike?.reasonLabel ?? "Resposta da INIA")

  if (!open) {
    return (
      <section aria-label="O que o operador compartilhou" data-state="closed" className={cn("flex items-center gap-3 rounded-2xl border border-border bg-muted/50 px-4 py-2.5", className)}>
        <div className="min-w-0 flex-1 space-y-0.5">
          <SectionLabel as="h3">O que o operador compartilhou</SectionLabel>
          <p className="truncate text-sm text-muted-foreground">{summary}</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="shrink-0" aria-expanded={false} aria-label="Mostrar o que o operador compartilhou" onClick={() => onOpenChange(true)}>
          <PanelLeftOpen className="hidden lg:block" aria-hidden />
          <ChevronDown className="lg:hidden" aria-hidden />
          Mostrar
        </Button>
      </section>
    )
  }

  return (
    <section aria-label="O que o operador compartilhou" data-state="open" className={cn("flex min-h-0 flex-col rounded-2xl border border-border bg-muted/50", className)}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <SectionLabel as="h3" className="min-w-0 flex-1">
          O que o operador compartilhou
        </SectionLabel>
        <Button type="button" variant="ghost" size="sm" className="shrink-0 text-primary dark:text-chart-4" aria-expanded aria-label="Recolher o que o operador compartilhou" onClick={() => onOpenChange(false)}>
          <PanelLeftClose className="hidden lg:block" aria-hidden />
          <ChevronUp className="lg:hidden" aria-hidden />
          Recolher
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 max-lg:max-h-72">
        {empty ? (
          <p className="text-sm text-muted-foreground">O operador pediu ajuda sem compartilhar a conversa com a INIA nem escrever uma nota.</p>
        ) : (
          <dl className="flex flex-col gap-4 text-sm">
            {context.question ? (
              <ContextField icon={MessageCircleQuestion} label="Pergunta à INIA">
                <span className="whitespace-pre-wrap">{context.question}</span>
              </ContextField>
            ) : null}
            {context.answer ? (
              <ContextField icon={Sparkles} label="Resposta da INIA">
                <div className="rounded-xl border border-border bg-card px-3 py-2">
                  <RichContent text={context.answer} />
                </div>
              </ContextField>
            ) : null}
            {context.dislike ? (
              <ContextField icon={ThumbsDown} label="Motivo da descurtida">
                <span className="font-medium">{context.dislike.reasonLabel}</span>
                {context.dislike.comment ? <span className="mt-1 block whitespace-pre-wrap text-muted-foreground">{context.dislike.comment}</span> : null}
              </ContextField>
            ) : null}
            <ContextField icon={StickyNote} label="Nota do operador">
              {context.note ? <span className="whitespace-pre-wrap">{context.note}</span> : <span className="text-muted-foreground">Sem nota.</span>}
            </ContextField>
          </dl>
        )}
      </div>
    </section>
  )
}

function ContextField({ icon: Icon, label, children }: { icon: LucideIcon; label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5 shrink-0" aria-hidden />
        {label}
      </dt>
      <dd className="min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}
