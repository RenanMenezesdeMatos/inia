"use client"

import { Separator } from "@/components/ui/separator"
import { RichContent } from "@/components/rich-content/rich-content"
import { SupportMaterialsSection } from "@/components/feedbacks/support-materials-section"
import { FeedbackNarrativeView } from "@/components/feedbacks/feedback-narrative-view"
import { ConfirmReadingControl } from "@/components/feedbacks/confirm-reading/confirm-reading-control"
import type { OperatorIndicatorHistory } from "@/schemas/operator"
import type { FeedbackSourceRef } from "@/schemas/feedback-applications/feedback-application.schema"

/**
 * Corpo de um feedback aberto no feed. `acknowledgement` só existe no feed do PRÓPRIO colaborador:
 * ciência é a confirmação formal, feita por ele com o login e a senha da sua conta, de que leu o
 * feedback publicado — o gestor enxerga o estado ("aguardando ciência") mas nunca confirma no lugar dele.
 */
export type FeedbackAcknowledgement = { source: FeedbackSourceRef; title: string | null; acknowledgedAt: string | null }

export function OperatorFeedbackDetail({ item, acknowledgement }: { item: OperatorIndicatorHistory; acknowledgement?: FeedbackAcknowledgement }) {
  const narrative = item.feedback?.recommendation || item.feedback?.evidenceFound || item.message
  // Feedback por Flag V2: narrativa de supervisor + "Entenda este feedback" (os materiais usados já estão nos detalhes).
  const view = item.feedback?.view ?? null
  // O cartão (FeedbackCard) dá o fundo e o respiro; aqui só o conteúdo.
  return <div className="space-y-4 text-sm leading-6">
    {view ? <FeedbackNarrativeView view={view} /> : <>
      <RichContent text={narrative} />
      {/* Apoio secundário ao conteúdo: material real da Base de Conhecimento recomendado pela IA
          (título/link do sistema, motivo da IA). Abrir o material não confirma ciência. */}
      <SupportMaterialsSection materials={item.feedback?.supportMaterials} />
    </>}
    {/* Sem ciência possível (ex.: "Leitura do dia") não sobra linha vazia — a avaliação "foi útil?" fica no rodapé do item. */}
    {acknowledgement ? <><Separator/>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="min-w-0 text-xs text-muted-foreground">
        <ConfirmReadingControl source={acknowledgement.source} entryPoint="FOLLOW_UP_FEED" title={acknowledgement.title} acknowledgedAt={acknowledgement.acknowledgedAt} />
      </div>
    </div></> : null}
  </div>
}
