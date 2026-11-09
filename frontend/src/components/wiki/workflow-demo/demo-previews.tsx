"use client"

import { Ban, Bell } from "lucide-react"

import { FeedbackCard, FeedbackEntryHeader, FeedbackEntryWhen } from "@/components/feedbacks/feedback-entry-header"
import { FeedbackNarrativeView } from "@/components/feedbacks/feedback-narrative-view"
import { IniaFeedItem } from "@/components/operator/inia-feed"
import { Button } from "@/components/ui/button"

import type { DemoPreview } from "./demo-types"

/**
 * A prévia do que a pessoa veria. Usa os MESMOS componentes visuais do Acompanhamento, alimentados com texto fictício: nenhum deles
 * busca dado, e nada aqui grava, envia ou confirma coisa alguma. Os botões da revisão só trocam de cena.
 */
function PreviewFrame({ audience, children }: { audience: string; children: React.ReactNode }) {
  return (
    <figure className="space-y-2" data-slot="demo-preview">
      <figcaption className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{audience}</figcaption>
      <div className="rounded-xl border border-dashed border-border bg-background p-3 sm:p-4">{children}</div>
    </figure>
  )
}

export function DemoPreviewCard({ preview, onDecision }: { preview: DemoPreview; onDecision?: (decision: string) => void }) {
  if (preview.kind === "nothing") {
    return (
      <div className="flex gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-4" data-slot="demo-preview-nothing">
        <Ban className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium text-foreground">{preview.title}</p>
          <p className="text-muted-foreground">{preview.text}</p>
          {preview.adminNote ? <p className="pt-1 text-xs text-muted-foreground">{preview.adminNote}</p> : null}
        </div>
      </div>
    )
  }

  if (preview.kind === "feedback") {
    return (
      <PreviewFrame audience={preview.audience}>
        <IniaFeedItem timestamp={preview.timestamp ?? "Hoje"} meta={<FeedbackEntryWhen text={preview.when} />}>
          <FeedbackCard header={<FeedbackEntryHeader origin={{ family: preview.view.kind === "INDICATOR" ? "INDICATOR" : "MONITORING", label: preview.originLabel, iconKey: null }} title={preview.title} />}>
            <FeedbackNarrativeView view={preview.view} />
          </FeedbackCard>
        </IniaFeedItem>
      </PreviewFrame>
    )
  }

  if (preview.kind === "agent-feedback") {
    const sections = [
      { title: "Evidência encontrada", text: preview.evidence },
      { title: "Comportamento observado", text: preview.behavior },
      { title: "Procedimento relacionado", text: preview.procedure },
      { title: "Recomendação", text: preview.recommendation },
    ]
    return (
      <PreviewFrame audience={preview.audience}>
        <IniaFeedItem timestamp={preview.timestamp ?? "Hoje"} meta={<FeedbackEntryWhen text={preview.when} />}>
          <FeedbackCard header={<FeedbackEntryHeader origin={{ family: preview.originLabel === "Monitoria" ? "MONITORING" : "INDICATOR", label: null, iconKey: null }} title={preview.title} />}>
            <div className="space-y-3 text-sm leading-6">
              {sections.map((section) => (
                <section key={section.title}>
                  <h4 className="text-xs font-medium text-muted-foreground">{section.title}</h4>
                  <p className="text-foreground">{section.text}</p>
                </section>
              ))}
            </div>
          </FeedbackCard>
        </IniaFeedItem>
      </PreviewFrame>
    )
  }

  if (preview.kind === "notice") {
    return (
      <PreviewFrame audience={preview.audience}>
        <FeedbackCard header={<FeedbackEntryHeader origin={{ family: preview.family, label: preview.originLabel, iconKey: null }} title={preview.title} />}>
          <p className="text-sm leading-6 text-foreground">{preview.text}</p>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Bell className="size-3.5" aria-hidden /> Onde aparece: {preview.surface}
          </p>
        </FeedbackCard>
      </PreviewFrame>
    )
  }

  return (
    <PreviewFrame audience={preview.audience}>
      <FeedbackCard header={<FeedbackEntryHeader origin={{ family: "HUMAN_REVIEW", label: null, iconKey: null }} title={preview.title} />}>
        <div className="space-y-3 text-sm leading-6">
          <p className="text-foreground">{preview.content}</p>
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Instrução:</span> {preview.instruction}
          </p>
          <div role="group" aria-label="Decisões de demonstração" className="flex flex-wrap gap-2">
            {preview.decisions.map((decision) => (
              <Button key={decision} type="button" size="sm" variant={decision === "Aprovar" ? "default" : "outline"} onClick={() => onDecision?.(decision)}>
                {decision}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Demonstração: escolher uma decisão só mostra a cena seguinte. Nenhuma revisão existe de verdade aqui.</p>
        </div>
      </FeedbackCard>
    </PreviewFrame>
  )
}
