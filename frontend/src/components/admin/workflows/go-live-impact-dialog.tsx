"use client"

import { useState } from "react"
import { AlertTriangle, CalendarClock, Users } from "lucide-react"

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { GoLiveImpact } from "@/schemas/admin/workflow.schema"

import type { ConfigurationChangeSummary } from "./workflow-configuration-summary"
import type { WorkflowSummary } from "./workflow-summary"
import { WorkflowSummaryView } from "./workflow-summary-view"

function formatDateTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleString("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" })
}

function formatTime(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" })
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("pt-BR")} ${count === 1 ? one : many}`
}

/** O que acontece no runtime quando a configuração entra no ar — números calculados pelo backend (go-live-impact.ts). */
function ImpactSummary({ impact }: { impact: GoLiveImpact }) {
  const schedule = impact.schedule
  const action = impact.reason === "PUBLISH" ? "publicar" : "ativar"
  if (!schedule) {
    // Desativado, nenhum gatilho põe nada para rodar: dizer que "as próximas interações passam a usar" seria falso.
    if (!impact.goesLive) {
      return (
        <p className="text-sm text-muted-foreground" data-testid="go-live-impact-inactive">
          O workflow está desativado: nada roda ao {action}. A nova versão só passa a valer quando ele for ativado{impact.triggerKind === "schedule" ? ", e aí o impacto da agenda é calculado e mostrado de novo" : ""}.
        </p>
      )
    }
    if (impact.triggerKind === "schedule") {
      return <p className="text-sm text-muted-foreground">O workflow está desativado: nada roda ao {action}. Ao ativar, o impacto da agenda é calculado e mostrado de novo.</p>
    }
    if (impact.triggerKind === "manual") {
      return <p className="text-sm text-muted-foreground">Nada é executado ao {action}: o workflow só roda quando alguém clica em Executar agora.</p>
    }
    return (
      <p className="text-sm text-muted-foreground">
        Nada é executado ao {action}: as próximas {impact.triggerKind === "channel_flag" ? "interações" : "medições"} que chegarem passam a usar esta configuração.
      </p>
    )
  }
  const tz = schedule.timezone
  return (
    <div className="space-y-2 text-sm" data-testid="go-live-impact-schedule">
      <p className="flex items-start gap-2">
        <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span>
          {schedule.evaluation === "CONSOLIDATED" ? (
            <>
              Estrutura com <strong>{plural(schedule.population, "colaborador", "colaboradores")}</strong> — uma execução por ocorrência.
            </>
          ) : (
            <>
              <strong>{plural(schedule.population, "colaborador elegível", "colaboradores elegíveis")}</strong> — cada ocorrência cria{" "}
              {plural(schedule.enrollmentsPerOccurrence, "execução", "execuções")} (uma por pessoa).
            </>
          )}
        </span>
      </p>
      {schedule.firesImmediately ? (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive" data-testid="go-live-impact-immediate">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong>Dispara agora:</strong> {plural(schedule.immediate.enrollments, "execução começa", "execuções começam")} em até 1 minuto. O horário de hoje (
            {schedule.immediate.scheduledFor.map((iso) => formatTime(iso, tz)).join(", ")}) já passou e o agendador recupera o dia corrente.
            {schedule.immediate.alreadyEnrolled > 0 ? ` ${plural(schedule.immediate.alreadyEnrolled, "pessoa já tinha", "pessoas já tinham")} execução nesse horário e não entra de novo.` : ""}
          </span>
        </p>
      ) : (
        <p className="flex items-start gap-2" data-testid="go-live-impact-first-fire">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span>
            {schedule.firstFireAt ? (
              <>
                Primeira execução: <strong>{formatDateTime(schedule.firstFireAt, tz)}</strong> ({tz}).
              </>
            ) : (
              "Nenhuma execução prevista nos próximos dias."
            )}
          </span>
        </p>
      )}
    </div>
  )
}

/**
 * Confirmação de pôr uma configuração no ar — Publicar (o rascunho passa a valer) ou Ativar (a publicada volta a
 * valer). Mostra o que muda na configuração e, para Agenda, a população e o primeiro disparo. Quando o backend exige
 * confirmação (catch-up de hoje ou população grande), o botão só libera com o "entendi" marcado, e o pedido leva o
 * `fingerprint` do impacto mostrado — se o impacto mudar até o clique, o backend recusa e o diálogo mostra o novo.
 */
export function GoLiveImpactDialog({
  open,
  onOpenChange,
  impact,
  changes = [],
  summary = null,
  pending,
  impactChanged = false,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  impact: GoLiveImpact | null
  changes?: ConfigurationChangeSummary[]
  /** Como o fluxo vai funcionar (quando começa, para quem, quem recebe) — o que a pessoa precisa conferir antes de pôr no ar. */
  summary?: WorkflowSummary | null
  pending: boolean
  /** O backend recusou porque o impacto mudou desde a prévia — avisa que os números foram atualizados. */
  impactChanged?: boolean
  onConfirm: (fingerprint: string) => void
}) {
  // A ciência vale só para o impacto que estava na tela: impacto novo (outro fingerprint) pede de novo.
  const [acknowledged, setAcknowledged] = useState<string | null>(null)
  const isPublish = impact?.reason !== "ACTIVATE"
  const verb = isPublish ? "Publicar" : "Ativar"
  const needsAck = Boolean(impact?.requiresConfirmation)
  const canConfirm = Boolean(impact) && !pending && (!needsAck || acknowledged === impact?.fingerprint)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{verb} workflow</AlertDialogTitle>
          <AlertDialogDescription>
            {isPublish
              ? "O rascunho — fluxo e configuração — passa a valer para as próximas execuções. Execuções em andamento continuam na versão em que começaram."
              : "A configuração publicada volta a valer agora."}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {impact ? (
          <div className="space-y-4">
            {impactChanged ? <p className="text-sm font-medium text-amber-700 dark:text-amber-300">O impacto mudou desde a prévia — os números abaixo foram atualizados.</p> : null}
            {changes.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Mudanças de configuração que passam a valer</p>
                <ul className="space-y-1 text-sm" data-testid="go-live-impact-changes">
                  {changes.map((item) => (
                    <li key={item.change} className="rounded-md bg-muted/50 px-2 py-1">
                      <span className="font-medium">{item.label}:</span> <span className="text-muted-foreground line-through decoration-muted-foreground/50">{item.published}</span> → {item.draft}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {summary ? (
              <div className="space-y-1.5 rounded-md border p-3">
                <p className="text-sm font-medium">Confira como o fluxo vai funcionar</p>
                <WorkflowSummaryView summary={summary} />
              </div>
            ) : null}
            <div className="space-y-1.5">
              <p className="text-sm font-medium">O que acontece ao {verb.toLowerCase()}</p>
              <ImpactSummary impact={impact} />
            </div>
            {needsAck ? (
              <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-primary"
                  checked={acknowledged === impact.fingerprint}
                  onChange={(event) => setAcknowledged(event.target.checked ? impact.fingerprint : null)}
                />
                <span>
                  Entendi o impacto e quero {verb.toLowerCase()} mesmo assim
                  {impact.schedule?.firesImmediately ? ` — ${plural(impact.schedule.immediate.enrollments, "execução começa", "execuções começam")} agora` : ""}.
                </span>
              </label>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Calculando o impacto…</p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button disabled={!canConfirm} onClick={() => impact && onConfirm(impact.fingerprint)}>
            {pending ? (isPublish ? "Publicando..." : "Ativando...") : verb}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
