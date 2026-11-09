"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"

import { describeClarificationAnswer, describeSource, openStepOf, type ClarificationAnswer, type ClarificationView } from "@/schemas/knowledge-clarification/clarification.schema"
import { ClarificationForm, type ClarificationFormAnswer } from "./clarification-form"
import { KnowledgeSourceImages } from "./knowledge-source-images"
import { KnowledgeSources } from "./knowledge-sources"
import { ScenarioSummary } from "./scenario-summary"

type KnowledgeClarificationBlockProps = {
  view: ClarificationView
  /** Só o esclarecimento mais recente da conversa aceita escolha/correção (e nunca numa conversa somente leitura). */
  interactive: boolean
  busy?: boolean
  /** Envia a escolha (ou a correção): o texto legível vira a mensagem de quem pergunta na conversa. */
  onAnswer?: (answer: ClarificationAnswer, displayText: string) => void
}

/**
 * O que acompanha uma resposta da INIA que veio do esclarecimento pelas bases: o cenário considerado (com "Alterar"), o
 * formulário da etapa aberta, as fontes da resposta e o aviso de fontes divergentes. Componentes da aplicação a partir do estado
 * validado — nada do modelo é renderizado como HTML.
 */
export function KnowledgeClarificationBlock({ view, interactive, busy = false, onAnswer }: KnowledgeClarificationBlockProps) {
  const [revisingStepId, setRevisingStepId] = useState<string | null>(null)
  const open = openStepOf(view)
  const canAnswer = interactive && Boolean(onAnswer)
  const revising = canAnswer && revisingStepId ? (view.steps.find((step) => step.id === revisingStepId && step.answer) ?? null) : null
  const send = (stepId: string, answer: ClarificationFormAnswer, revise: boolean) => {
    const step = view.steps.find((item) => item.id === stepId)
    if (!step || !onAnswer) return
    onAnswer({ clarificationId: view.id, stepId, optionIds: answer.optionIds, noneMatched: answer.noneMatched, revise, ...(answer.freeText ? { freeText: answer.freeText } : {}) }, describeClarificationAnswer(step, { optionIds: answer.optionIds, freeText: answer.freeText, noneMatched: answer.noneMatched }))
  }

  return (
    <div className="mt-2 space-y-3" data-testid="knowledge-clarification" data-status={view.status}>
      <ScenarioSummary facts={view.scenario} onRevise={canAnswer ? (stepId) => setRevisingStepId(stepId) : undefined} disabled={busy} />
      {revising ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">Alterar: {revising.question}</p>
          <ClarificationForm
            key={`revise-${revising.id}`}
            step={revising}
            initial={revising.answer}
            disabled={busy}
            submitLabel="Refazer a partir daqui"
            onCancel={() => setRevisingStepId(null)}
            onSubmit={(answer) => {
              setRevisingStepId(null)
              send(revising.id, answer, true)
            }}
          />
        </div>
      ) : null}
      {open && !revising ? (
        canAnswer ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground" data-testid="clarification-coverage">
              Encontrei estes cenários nas bases consultadas.
              {view.coverage.complete ? "" : " A análise não cobriu todo o conteúdo encontrado — se o seu caso não estiver aqui, descreva-o."}
            </p>
            <ClarificationForm key={open.id} step={open} disabled={busy} onSubmit={(answer) => send(open.id, answer, false)} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Opções apresentadas: {open.options.map((option) => option.label).join(" · ")}</p>
        )
      ) : null}
      {view.conflicts.length > 0 ? (
        <div className="flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs" role="note">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">As bases consultadas divergem</p>
            {view.conflicts.map((conflict, index) => (
              <p key={index} className="text-muted-foreground">
                {conflict.description} ({conflict.sources.map(describeSource).join("; ")})
              </p>
            ))}
          </div>
        </div>
      ) : null}
      {view.status === "ANSWERED" ? <KnowledgeSourceImages sources={view.sources} /> : null}
      {view.status === "ANSWERED" ? <KnowledgeSources sources={view.sources} /> : null}
    </div>
  )
}
