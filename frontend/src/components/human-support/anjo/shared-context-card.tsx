"use client"

import type { ReactNode } from "react"
import { ChevronDown, MessageCircleQuestion, PanelLeftClose, PanelLeftOpen, Sparkles, StickyNote, ThumbsDown, type LucideIcon } from "lucide-react"

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
 * comprime nem estica o chat); em telas menores fica acima da conversa, com altura limitada. Recolher NÃO muda o cartão de lugar:
 *  - em telas grandes ele vira uma faixa estreita no mesmo lugar (botão de abrir + o título na vertical) e a COLUNA encolhe com
 *    transição (`attendance-pane.tsx`), a conversa ganhando a largura; o conteúdo tem largura mínima própria e é só recortado durante
 *    a transição (não se reorganiza aos pedaços);
 *  - em telas menores ele continua acima da conversa: o corpo fecha deslizando (linhas da grade de 1fr para 0fr) e o cabeçalho mostra
 *    a pergunta numa linha com "Mostrar".
 * Com movimento reduzido, sem transição. Um botão só alterna (o mesmo nome acessível em qualquer largura). Recolher só esconde: nada
 * do que foi compartilhado muda (vem pronto do servidor).
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

  return (
    <section aria-label="O que o operador compartilhou" data-state={open ? "open" : "closed"} className={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-muted/50", className)}>
      {/* Cabeçalho. Recolhido em tela grande, vira a faixa: botão no alto e o título na vertical. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 px-4 py-2.5",
          open ? "border-b border-border" : "lg:h-full lg:flex-col-reverse lg:items-center lg:justify-end lg:gap-4 lg:px-0 lg:py-3",
        )}
      >
        <div className={cn("min-w-0 flex-1 space-y-0.5", !open && "lg:flex-none")}>
          <SectionLabel as="h3" className={cn(!open && "lg:rotate-180 lg:whitespace-nowrap lg:[writing-mode:vertical-rl]")}>
            O que o operador compartilhou
          </SectionLabel>
          {!open ? <p className="truncate text-sm text-muted-foreground lg:hidden">{summary}</p> : null}
        </div>
        <Button
          type="button"
          variant={open ? "ghost" : "outline"}
          size="sm"
          className={cn("shrink-0", open ? "text-primary dark:text-chart-4" : "lg:size-8 lg:px-0")}
          aria-expanded={open}
          aria-label={open ? "Recolher o que o operador compartilhou" : "Mostrar o que o operador compartilhou"}
          onClick={() => onOpenChange(!open)}
        >
          {open ? <PanelLeftClose className="hidden lg:block" aria-hidden /> : <PanelLeftOpen className="hidden lg:block" aria-hidden />}
          <ChevronDown className={cn("transition-transform duration-300 motion-reduce:transition-none lg:hidden", open && "rotate-180")} aria-hidden />
          <span className={cn(!open && "lg:sr-only")}>{open ? "Recolher" : "Mostrar"}</span>
        </Button>
      </div>
      {/* Corpo: abre e fecha deslizando em telas menores; em telas grandes fica no lugar (a coluna é que encolhe) e, recolhido,
          sai de cena pela faixa que ocupa o cartão inteiro. Recolhido, não recebe foco nem leitura. */}
      <div
        className={cn(
          "grid min-h-0 transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
          open ? "flex-1 grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        aria-hidden={!open}
        inert={!open}
        data-testid="shared-context-body"
      >
        <div className="min-h-0 overflow-y-auto px-4 lg:min-w-[17rem]">
          <div className="py-3 max-lg:max-h-72">
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
        </div>
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
