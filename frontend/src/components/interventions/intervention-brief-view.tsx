import type { ReactNode } from "react"
import { CheckCircle2, Clock3 } from "lucide-react"

import { formatDate } from "@/lib/format/date"
import { INTERVENTION_STATUS_LABELS, OPERATIONAL_RESULT_LABELS, type BriefFeedback, type InterventionBriefView as Brief } from "@/schemas/interventions/intervention.schema"

/**
 * RESUMO DA INIA para a liderança — o que o líder lê quando uma política abre ou sugere um acompanhamento: a fala da INIA, a
 * situação, o que JÁ foi feito (feedbacks publicados e acompanhamentos anteriores), a evolução medida desde então, o que ela
 * ainda não sabe e o próximo passo. Tudo vem pronto do servidor (retrato da avaliação); aqui só se apresenta.
 *
 * O texto dos feedbacks é histórico do que já foi dito ao colaborador — por isso aparece como citação, com a data e a ciência.
 */
const FEEDBACK_KIND_LABEL: Record<string, string> = { INDICATOR: "Feedback de indicador", MONITORING: "Feedback de monitoria" }

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h5 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h5>
      {children}
    </section>
  )
}

/** O texto do que foi dito aparece nos mais recentes; os demais ficam só com data, tipo e ciência (o cartão não vira uma parede de texto). */
const FEEDBACKS_WITH_TEXT = 3

function FeedbackLine({ feedback, withText }: { feedback: BriefFeedback; withText: boolean }) {
  return (
    <li className="space-y-1">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium">{formatDate(feedback.publishedAt)}</span>
        <span>
          {feedback.kind ? FEEDBACK_KIND_LABEL[feedback.kind] : "Feedback"}
          {feedback.title ? ` · ${feedback.title}` : ""}
        </span>
        {feedback.acknowledgedAt ? (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
            Ciência em {formatDate(feedback.acknowledgedAt)}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300">
            <Clock3 className="size-3.5 shrink-0" aria-hidden />
            Aguardando ciência do colaborador
          </span>
        )}
      </p>
      {withText && feedback.recommendation ? <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{feedback.recommendation}</blockquote> : null}
    </li>
  )
}

export function InterventionBriefView({ brief }: { brief: Brief }) {
  const { feedbacks, feedbackCount, interventions, windowDays } = brief.alreadyDone
  const olderFeedbacks = feedbackCount - feedbacks.length
  return (
    <div className="space-y-4 text-sm leading-6" data-testid="intervention-brief">
      <p>{brief.lead}</p>

      {brief.situation.length > 0 ? (
        <Part title="Situação">
          <ul className="space-y-0.5">
            {brief.situation.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        </Part>
      ) : null}

      <Part title="O que já foi feito">
        {feedbacks.length === 0 && interventions.length === 0 ? (
          <p className="text-muted-foreground">Nenhum feedback publicado sobre este assunto e nenhum acompanhamento anterior nos últimos {windowDays} dias.</p>
        ) : (
          <ul className="space-y-2.5">
            {feedbacks.map((feedback, index) => (
              <FeedbackLine key={feedback.id} feedback={feedback} withText={index < FEEDBACKS_WITH_TEXT} />
            ))}
            {olderFeedbacks > 0 ? <li className="text-xs text-muted-foreground">Mais {olderFeedbacks} feedback(s) anteriores no período.</li> : null}
            {interventions.map((item) => (
              <li key={item.id}>
                <span className="font-medium">{formatDate(item.openedAt)}</span> {item.typeName} · {INTERVENTION_STATUS_LABELS[item.status] ?? item.status}
                {item.closedAt ? ` em ${formatDate(item.closedAt)}` : ""}
                {item.operationalResult ? ` · resultado registrado: ${OPERATIONAL_RESULT_LABELS[item.operationalResult] ?? item.operationalResult}` : ""}
              </li>
            ))}
          </ul>
        )}
      </Part>

      {brief.evolution ? (
        <Part title="Evolução medida">
          <p>{brief.evolution.statement}</p>
        </Part>
      ) : null}

      {brief.unknowns.length > 0 ? (
        <Part title="O que ainda não sei">
          <ul className="space-y-0.5 text-muted-foreground">
            {brief.unknowns.map((statement) => (
              <li key={statement}>{statement}</li>
            ))}
          </ul>
        </Part>
      ) : null}

      {brief.nextSteps.length > 0 ? (
        <Part title="Próximo passo">
          <ul className="space-y-0.5">
            {brief.nextSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </Part>
      ) : null}
    </div>
  )
}
