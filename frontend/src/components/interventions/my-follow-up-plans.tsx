"use client"

import { CheckCircle2, Circle } from "lucide-react"

import { formatCivilDate } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { useMarkMyStepMutation, useMyFollowUpsQuery } from "@/queries/interventions/use-intervention-queries"
import type { MyFollowUp } from "@/schemas/interventions/intervention.schema"

/**
 * O ACOMPANHAMENTO DO COLABORADOR COM QUEM O LIDERA — o que foi combinado e os passos, com os dele para marcar como feitos.
 * Só aparece quando existe algum em execução de um formato marcado como visível ao colaborador; sem isso, nada é mostrado.
 * O que vem do servidor já é só o que ele pode ver (nunca o motivo, a análise ou as anotações de quem conduz).
 */
function Plan({ plan }: { plan: MyFollowUp }) {
  const mark = useMarkMyStepMutation()
  const done = plan.steps.filter((step) => step.done).length
  return (
    <section aria-label={`Acompanhamento: ${plan.typeName}`} className="rounded-2xl border border-border bg-card p-4 shadow-xs" data-testid="my-follow-up-plan">
      <p className="text-xs font-semibold tracking-wide text-primary uppercase">Acompanhamento com {plan.responsibleName}</p>
      <h3 className="mt-1 text-base font-semibold">{plan.typeName}</h3>
      <p className="text-xs text-muted-foreground">
        Até {formatCivilDate(plan.dueAt)} · {done} de {plan.steps.length} passos feitos
      </p>
      {plan.objective ? <p className="mt-2 text-sm">{plan.objective}</p> : null}
      <ul className="mt-3 space-y-2">
        {plan.steps.map((step) => {
          const Icon = step.done ? CheckCircle2 : Circle
          const canMark = step.mine && step.kind !== "CHECKPOINT"
          const label = (
            <span className="min-w-0">
              <span className={cn("block text-sm", step.done && "text-muted-foreground line-through")}>{step.title}</span>
              {step.description ? <span className="block text-xs text-muted-foreground">{step.description}</span> : null}
              <span className="block text-xs text-muted-foreground">
                {step.mine ? "Com você" : `Com ${step.ownerName ?? plan.responsibleName}`}
                {step.dueAt ? ` · até ${formatCivilDate(step.dueAt)}` : ""}
                {step.overdue ? " · vencido" : ""}
              </span>
            </span>
          )
          return (
            <li key={step.id}>
              {canMark ? (
                <button
                  type="button"
                  className="flex w-full items-start gap-2 rounded-lg p-1 text-left hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                  aria-pressed={step.done}
                  aria-label={step.done ? `Desmarcar: ${step.title}` : `Marcar como feito: ${step.title}`}
                  disabled={mark.isPending}
                  onClick={() => mark.mutate({ interventionId: plan.id, stepId: step.id, done: !step.done })}
                >
                  <Icon className={cn("mt-0.5 size-4 shrink-0", step.done ? "text-emerald-600" : "text-primary")} aria-hidden />
                  {label}
                </button>
              ) : (
                <div className="flex items-start gap-2 p-1">
                  <Icon className={cn("mt-0.5 size-4 shrink-0", step.done ? "text-emerald-600" : "text-muted-foreground")} aria-hidden />
                  {label}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

export function MyFollowUpPlans() {
  const query = useMyFollowUpsQuery()
  if (!query.data || query.data.length === 0) return null
  return (
    <div className="space-y-3 py-4" data-testid="my-follow-up-plans">
      {query.data.map((plan) => (
        <Plan key={plan.id} plan={plan} />
      ))}
    </div>
  )
}
