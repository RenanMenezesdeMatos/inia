"use client"

import { AudioLines, MessagesSquare, Volume2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useFeedbackApplicationsQuery } from "@/queries/feedback-applications/use-feedback-applications"
import { feedbackApplicationActionOf, feedbackSourceKey, type FeedbackApplicationAction, type FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"
import { useFeedbackWorkspace } from "./feedback-workspace-context"

const ACTION: Record<FeedbackApplicationAction, { label: string; icon: typeof Volume2 }> = {
  listen: { label: "Ouvir com a INIA", icon: Volume2 },
  continue: { label: "Continuar feedback", icon: AudioLines },
  view: { label: "Ver feedback e conversa", icon: MessagesSquare },
}

/**
 * Ação principal de um feedback no Acompanhamento, no canto direito do cabeçalho do item, pelo estado da SUA aplicação:
 * Ouvir com a INIA (não iniciada) · Continuar feedback (em andamento) · Ver feedback e conversa (concluída).
 * Discreta: só o ícone; ao passar o mouse (ou focar pelo teclado) o rótulo desliza para fora. O rótulo é sempre o nome
 * acessível do botão. O backend é a autoridade: se a lista estiver desatualizada (outra aba começou), o clique recupera a
 * MESMA aplicação e o painel abre no estado real — nunca reaplica.
 */
export function FeedbackApplicationButton({ source, title, periodLabel }: { source: FeedbackSourceRef; title: string; periodLabel: string | null }) {
  const workspace = useFeedbackWorkspace()
  const applications = useFeedbackApplicationsQuery(Boolean(workspace))
  if (!workspace) return null
  const key = feedbackSourceKey(source)
  // Sem o estado ainda (primeira carga), nenhum ícone provisório: "Ouvir" piscaria num feedback já concluído.
  if (applications.isPending) return <div className="size-8 animate-pulse rounded-full bg-muted motion-reduce:animate-none" aria-hidden />
  const application = applications.data?.find((item) => feedbackSourceKey(item.source) === key)
  const action = feedbackApplicationActionOf(application?.status)
  const { label, icon: Icon } = ACTION[action]
  const active = workspace.activeSourceKey === key
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "group/listen h-8 gap-0 rounded-full px-2 transition-colors",
        action === "view"
          ? "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted"
          : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground dark:text-chart-4 dark:hover:text-primary-foreground",
        active && "ring-2 ring-primary/40",
      )}
      data-feedback-action={key}
      data-usage-element="feedback.listen"
      data-usage-entity-type={source.kind}
      data-usage-entity-id={source.id}
      data-active={active || undefined}
      aria-describedby={active ? `${key}-active` : undefined}
      onClick={() => workspace.openFeedback({ source, mode: action, title, periodLabel, origin: "feed" })}
    >
      <Icon aria-hidden className="size-4" />
      <span className="grid grid-cols-[0fr] transition-[grid-template-columns] duration-200 ease-out group-hover/listen:grid-cols-[1fr] group-focus-visible/listen:grid-cols-[1fr] motion-reduce:transition-none">
        <span className="overflow-hidden whitespace-nowrap">
          <span className="pr-1 pl-1.5">{label}</span>
        </span>
      </span>
      {active ? <span id={`${key}-active`} className="sr-only">Aberto no painel da INIA</span> : null}
    </Button>
  )
}
