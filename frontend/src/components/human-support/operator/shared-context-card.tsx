"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { RichContent } from "@/components/rich-content/rich-content"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { SharedContext } from "@/schemas/human-support/state.schema"
import { cn } from "@/lib/utils"
import { SectionLabel } from "@/components/ui/surface"

/**
 * A CÓPIA DA TROCA que o Anjo recebe (design_draft.md seção 7): a pergunta, a resposta da INIA (sempre, D10), o motivo e o
 * comentário da descurtida e a nota. Pergunta, nota e comentário são texto do operador (puro); a resposta da INIA passa pelo
 * `RichContent`, como todo texto gerado pela IA. Na sala (`collapsible`) começa recolhida: o operador já sabe o que escreveu, e o
 * espaço vai para a conversa — principalmente no celular.
 */
export function SharedContextCard({ context, title, className, collapsible = false }: { context: SharedContext; title: string; className?: string; collapsible?: boolean }) {
  const [open, setOpen] = useState(false)
  const body = <SharedContextFields context={context} />
  if (!collapsible) {
    return (
      <section className={cn("space-y-3 rounded-2xl border border-border bg-muted/50 p-4 text-sm", className)} aria-label={title}>
        <SectionLabel as="p">{title}</SectionLabel>
        {body}
      </section>
    )
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-2xl border border-border bg-muted/50 text-sm", className)}>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-2xl px-4 py-2.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
        <SectionLabel as="p">{title}</SectionLabel>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4">{body}</CollapsibleContent>
    </Collapsible>
  )
}

function SharedContextFields({ context }: { context: SharedContext }) {
  const empty = !context.question && !context.answer && !context.dislike && !context.note
  if (empty) return <p className="text-muted-foreground">Nada da conversa com a INIA — só o que for escrito aqui.</p>
  return (
    <dl className="divide-y divide-border">
      {context.question ? <Field label="Pergunta"><p className="whitespace-pre-wrap">{context.question}</p></Field> : null}
      {context.answer ? <Field label="Resposta da INIA"><div className="max-h-48 overflow-y-auto"><RichContent text={context.answer} /></div></Field> : null}
      {context.dislike ? (
        <Field label="Motivo da descurtida">
          <p>{context.dislike.reasonLabel}</p>
          {context.dislike.comment ? <p className="whitespace-pre-wrap text-muted-foreground">{context.dislike.comment}</p> : null}
        </Field>
      ) : null}
      {context.note ? <Field label="Nota"><p className="whitespace-pre-wrap">{context.note}</p></Field> : null}
    </dl>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5 py-2 first:pt-0 last:pb-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  )
}

/** "O Anjo verá: sua pergunta, a resposta da INIA, o motivo e o que você escrever" — só o que existe nesta cópia. */
export function sharedContextSummary(context: SharedContext): string {
  const parts = [context.question ? "sua pergunta" : null, context.answer ? "a resposta da INIA" : null, context.dislike ? "o motivo" : null, context.dislike?.comment ? "seu comentário" : null, "o que você escrever"].filter((part): part is string => part !== null)
  if (parts.length === 1) return `O Anjo verá ${parts[0]}.`
  return `O Anjo verá: ${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}.`
}
