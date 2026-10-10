"use client"

import { ConfirmReadingControl } from "@/components/feedbacks/confirm-reading/confirm-reading-control"
import { FeedbackCard, FeedbackEntryHeader } from "@/components/feedbacks/feedback-entry-header"
import { RichContent } from "@/components/rich-content/rich-content"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import type { DeliveredFeedback } from "@/schemas/feedback-delivery/feedback-delivery.schema"

/**
 * Feedback de atendimento no Acompanhamento (V1.5.6). Para o colaborador é o feedback da INIA sobre um atendimento: tipo do
 * ponto, data, os textos (só os blocos que existem) e, quando há, trechos curtos já mascarados. Nada de QA, modelo, fallback
 * ou dado técnico — o backend nem os envia. Ciência = confirmação do próprio colaborador (entregue ≠ lido).
 */
export function DeliveredFeedbackEntry({ item, expanded, onExpandedChange, action }: { item: DeliveredFeedback; expanded?: boolean; onExpandedChange?: (open: boolean) => void; action?: React.ReactNode }) {
  const positive = item.section === "STRENGTH"
  const [preview, ...rest] = item.blocks
  return (
    <FeedbackCard
      usageEntity={{ type: "INTERACTION_FEEDBACK_DELIVERY", id: item.id }}
      header={
        // Feedback sobre UMA chamada = família Monitoria. A data do atendimento (rótulo pronto do backend) fica fora do cartão, na linha do autor.
        <FeedbackEntryHeader
          origin={{ family: "MONITORING", label: null, iconKey: null }}
          title={item.title}
          badges={<Badge variant="outline" className={positive ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-200" : "border-amber-300 text-amber-800 dark:border-amber-800 dark:text-amber-200"}>{item.sectionLabel}</Badge>}
          action={action}
        />
      }
    >
        {preview ? (
          <div>
            <p className="text-xs font-medium text-muted-foreground">{preview.label}</p>
            <div className="line-clamp-3"><RichContent text={preview.text} /></div>
          </div>
        ) : null}
        <Accordion type="single" collapsible {...(expanded === undefined ? {} : { value: expanded ? "detail" : "", onValueChange: (value: string) => onExpandedChange?.(value === "detail") })}>
          <AccordionItem value="detail" className="border-0">
            <AccordionTrigger className="justify-start gap-2 py-2 text-xs hover:no-underline" data-usage-element="feedback.open_detail">Ver feedback completo</AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 pt-1 text-sm leading-6" data-usage-screen="feedback.detail">
                {rest.map((block) => (
                  <section key={block.key}>
                    <h4 className="text-xs font-medium text-muted-foreground">{block.label}</h4>
                    <RichContent text={block.text} />
                  </section>
                ))}
                {item.evidence.length > 0 ? (
                  <section>
                    <h4 className="text-xs font-medium text-muted-foreground">Trechos do atendimento</h4>
                    <ul className="mt-1 space-y-2">
                      {item.evidence.map((entry, index) => (
                        <li key={index} className="rounded-lg bg-background/70 p-2">
                          <span className="text-xs text-muted-foreground">{entry.speakerLabel}</span>
                          {/* Citação literal (já mascarada) — nunca Markdown. */}
                          <p className="whitespace-pre-wrap break-words">“{entry.text}{entry.truncated ? "…" : ""}”</p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
                <div className="text-xs text-muted-foreground">
                  <ConfirmReadingControl source={{ kind: "INTERACTION_FEEDBACK_DELIVERY", id: item.id }} entryPoint="FOLLOW_UP_FEED" title={item.title} acknowledgedAt={item.acknowledgedAt} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
    </FeedbackCard>
  )
}
