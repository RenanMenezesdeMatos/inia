"use client"

import { ChevronDown, ClipboardList } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import type { PrvSupervisorView } from "@/schemas/feedbacks/prv-supervisor-view.schema"

/**
 * Indicator Diagnosis V1 — DIAGNÓSTICO TÉCNICO do fechamento, para quem LIDERA (Acompanhamento da estrutura). É a mesma verdade
 * diagnóstica do feedback do colaborador, projetada com os números: população, mix, amostra e reuso, padrões com denominadores,
 * dias, agregado do Subgrupo (padrão do grupo ≠ do colaborador), evidências e limitações. Fechado por padrão; nada é calculado aqui.
 */
const SECTION_TITLE = "text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
const seconds = (value: number | null) => (value === null ? "—" : `${value} s`)
const percent = (value: number | null) => (value === null ? "—" : `${String(value).replace(".", ",")}%`)

export function PrvSupervisorDiagnosis({ view, className }: { view: PrvSupervisorView; className?: string }) {
  return (
    <Collapsible className={cn("group/technical min-w-0 rounded-xl border bg-card", className)} data-slot="prv-supervisor-diagnosis">
      <h4 className="m-0">
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="flex h-auto w-full min-w-0 items-center gap-3 rounded-xl px-3 py-3 text-left whitespace-normal hover:bg-muted/40 group-data-[state=open]/technical:rounded-b-none sm:px-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden><ClipboardList className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5">Diagnóstico técnico (gestão)</span>
              <span className="block text-xs font-normal leading-5 text-muted-foreground">{view.source?.kind === "DIRECT_INDICATOR" ? `Estratégia, passos investigados, população, denominadores e limitações de ${view.cycle}.` : `População, mix, padrões, Subgrupo e limitações do fechamento de ${view.cycle}.`}</span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/technical:rotate-180" aria-hidden />
          </Button>
        </CollapsibleTrigger>
      </h4>
      <CollapsibleContent className="space-y-5 border-t px-3 py-4 text-sm sm:px-4">
        {view.interpretation.length > 0 ? (
          <section className="space-y-1.5" aria-label="Interpretação">
            <p className={SECTION_TITLE}>Interpretação</p>
            {view.interpretation.map((note, index) => <p key={index} className="leading-6 break-words">{note}</p>)}
          </section>
        ) : null}
        <section className="space-y-1.5" aria-label="Triagem do fechamento">
          <p className={SECTION_TITLE}>{view.source?.kind === "DIRECT_INDICATOR" ? "Triagem da estratégia" : "Triagem do fechamento"}</p>
          {view.source ? <p className="text-xs text-muted-foreground">Origem: {view.source.label}</p> : null}
          {view.prv ? <p className="leading-6">PRV oficial: {percent(view.prv.achievementPercent)} · quartil {view.prv.quartile}{view.prv.previous ? ` (anterior: ${percent(view.prv.previous.achievementPercent)} · ${view.prv.previous.quartile})` : ""}</p> : null}
          <ul className="space-y-1">
            {view.triage.map((entry) => <li key={entry.indicator} className="leading-6 break-words"><span className="font-medium">{entry.indicator}</span>: {entry.decision}{entry.reasons.length > 0 ? ` — ${entry.reasons.join("; ")}` : ""}</li>)}
          </ul>
        </section>
        {view.indicators.map((indicator) => (
          <section key={indicator.name} className="space-y-4 rounded-lg border p-3" aria-label={indicator.name}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{indicator.name}</p>
              <span className="rounded bg-muted px-2 py-0.5 text-xs">{indicator.conclusion}</span>
            </div>
            <ul className="space-y-0.5 text-xs text-muted-foreground">{indicator.official.map((line) => <li key={line}>{line}</li>)}</ul>
            {indicator.steps ? (
              <div className="space-y-1.5" aria-label="Investigação">
                <p className={SECTION_TITLE}>Investigação{indicator.strategy?.version ? ` · estratégia v${indicator.strategy.version}` : ""}</p>
                <p className="text-xs text-muted-foreground">{indicator.steps.mode} — {indicator.steps.planner}</p>
                {indicator.steps.selected.length > 0 ? <ul className="space-y-0.5 text-xs">{indicator.steps.selected.map((step) => <li key={step.label}><span className="font-medium">{step.label}</span>{step.purpose ? ` — ${step.purpose}` : ""}</li>)}</ul> : <p className="text-xs">Nenhum passo além do resultado oficial.</p>}
                {indicator.steps.notSelected.length > 0 ? <p className="text-xs text-muted-foreground">Não escolhidos: {indicator.steps.notSelected.join("; ")}</p> : null}
                {indicator.steps.unavailable.length > 0 ? <ul className="space-y-0.5 text-xs text-muted-foreground">{indicator.steps.unavailable.map((step) => <li key={step.label}>Indisponível: {step.label} — {step.reason}</li>)}</ul> : null}
                {indicator.steps.rejected.length > 0 ? <ul className="space-y-0.5 text-xs text-muted-foreground">{indicator.steps.rejected.map((step, index) => <li key={index}>Recusado: {step.step} ({step.reason})</li>)}</ul> : null}
              </div>
            ) : null}
            {indicator.signal ? (
              <div className="space-y-1.5" aria-label="Interações sinalizadas">
                <p className={SECTION_TITLE}>Interações marcadas como {indicator.signal.label}</p>
                <p className="leading-6">{indicator.signal.signaled} de {indicator.signal.interactions} interações atendidas ({percent(indicator.signal.signalRatePercent)}) · {indicator.signal.status}</p>
                {indicator.signal.concentration ? <p className="leading-6 break-words">{indicator.signal.concentration}</p> : null}
                {indicator.signal.evolution ? <p className="text-xs text-muted-foreground">Período anterior ({indicator.signal.evolution.status}): {indicator.signal.evolution.previous.signaled} de {indicator.signal.evolution.previous.interactions} ({percent(indicator.signal.evolution.previous.signalRatePercent)}){indicator.signal.evolution.shifted ? ` · ${indicator.signal.evolution.shifted}` : ""}</p> : null}
                {indicator.signal.reasons.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[26rem] text-xs">
                      <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">Motivo</th><th className="py-1 pr-2 font-medium">Atend.</th><th className="py-1 pr-2 font-medium">Marcadas</th><th className="py-1 pr-2 font-medium">Taxa no motivo</th><th className="py-1 font-medium">Parte das marcadas</th></tr></thead>
                      <tbody>{indicator.signal.reasons.map((reason) => <tr key={reason.label} className="border-t"><td className="py-1 pr-2 break-words">{reason.label}</td><td className="py-1 pr-2">{reason.interactions}</td><td className="py-1 pr-2">{reason.signaled}</td><td className="py-1 pr-2">{percent(reason.signalRatePercent)}</td><td className="py-1">{percent(reason.shareOfSignalPercent)}</td></tr>)}</tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
            {indicator.evidenceGap ? <p className="rounded-md bg-muted/60 px-2 py-1.5 text-xs leading-5">Evidência comportamental indisponível: {indicator.evidenceGap}.</p> : null}
            <div className="space-y-1.5">
              <p className={SECTION_TITLE}>População e amostra</p>
              <p className="leading-6">{indicator.population.interactionsInPeriod} atendimentos no fechamento{indicator.population.selectedSegment ? ` · motivo investigado: ${indicator.population.selectedSegment} (${indicator.population.selectionReason})` : ""}.</p>
              <p className="leading-6">Elegíveis: {indicator.sample.eligible} · analisadas: {indicator.sample.analyzed} · reaproveitadas: {indicator.sample.reused} ({indicator.sample.reusedObservations} observações) · avaliadas agora: {indicator.sample.reanalyzed} ({indicator.sample.newObservations} observações novas)</p>
              {indicator.coverage ? (
                <p className="leading-6 break-words" aria-label="Cobertura da avaliação">
                  Cobertura da avaliação ({indicator.coverage.status}): {indicator.coverage.mustAssessPlanned} etapas centrais planejadas em {indicator.coverage.interactionCount} chamadas · faltando na 1ª resposta: {indicator.coverage.missingInitial} · inconsistentes: {indicator.coverage.inconsistentInitial} · revisadas: {indicator.coverage.repairInteractions} chamada(s) ({indicator.coverage.repairTargets} etapas) · ainda faltando: {indicator.coverage.missingAfterRepair} · ainda inconsistentes: {indicator.coverage.inconsistentAfterRepair}{indicator.coverage.budgetSkipped > 0 ? ` · ${indicator.coverage.budgetSkipped} sem revisão (limite do diagnóstico)` : ""}
                </p>
              ) : null}
              {indicator.population.segments.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[22rem] text-xs">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">Motivo</th><th className="py-1 pr-2 font-medium">Atend.</th><th className="py-1 pr-2 font-medium">Part.</th><th className="py-1 font-medium">Duração média registrada</th></tr></thead>
                    <tbody>{indicator.population.segments.map((segment) => <tr key={segment.label} className="border-t"><td className="py-1 pr-2 break-words">{segment.label}</td><td className="py-1 pr-2">{segment.interactions}</td><td className="py-1 pr-2">{percent(segment.sharePercent)}</td><td className="py-1">{seconds(segment.averageDurationSeconds)}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : null}
            </div>
            {indicator.mix && indicator.mix.rows.length > 0 ? (
              <div className="space-y-1.5">
                <p className={SECTION_TITLE}>Mix de motivos (mês anterior → fechamento)</p>
                {indicator.mix.statement ? <p className="leading-6 break-words">{indicator.mix.statement}</p> : <p className="text-xs text-muted-foreground">{indicator.mix.status === "INSUFFICIENT_DATA" ? "Volume insuficiente para comparar o mix." : "Sem mudança relevante de mix."}</p>}
                <ul className="space-y-0.5 text-xs">{indicator.mix.rows.map((row) => <li key={row.label}>{row.label}: {percent(row.previousSharePercent)} → {percent(row.currentSharePercent)}</li>)}</ul>
              </div>
            ) : null}
            {indicator.patterns.length > 0 ? (
              <div className="space-y-1.5">
                <p className={SECTION_TITLE}>Padrões operacionais (contagens do sistema)</p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-xs">
                    <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2 font-medium">Comportamento</th><th className="py-1 pr-2 font-medium">Leitura</th><th className="py-1 pr-2 font-medium">Não seguido</th><th className="py-1 pr-2 font-medium">Seguido</th><th className="py-1 pr-2 font-medium">Parcial</th><th className="py-1 pr-2 font-medium">Não obs.</th><th className="py-1 font-medium">Não aplic.</th></tr></thead>
                    <tbody>
                      {indicator.patterns.map((pattern) => (
                        <tr key={pattern.title} className="border-t align-top">
                          <td className="py-1 pr-2 break-words"><span className="font-medium">{pattern.title}</span><span className="block text-muted-foreground">{pattern.attribution}</span>{pattern.concentration ? <span className="block text-muted-foreground">{pattern.concentration}</span> : null}</td>
                          <td className="py-1 pr-2">{pattern.classification}</td>
                          <td className="py-1 pr-2">{pattern.notFollowed} de {pattern.eligible}{pattern.notFollowedRatePercent !== null ? ` (${percent(pattern.notFollowedRatePercent)})` : ""}</td>
                          <td className="py-1 pr-2">{pattern.followed}</td>
                          <td className="py-1 pr-2">{pattern.partial}</td>
                          <td className="py-1 pr-2">{pattern.notObservable}</td>
                          <td className="py-1">{pattern.notApplicable}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <p className={SECTION_TITLE}>Subgrupo (agregado, sem pessoas)</p>
              <p className="text-xs text-muted-foreground">{indicator.team.status}{indicator.team.contributors > 0 ? ` · ${indicator.team.contributors} pessoas contribuindo` : ""}</p>
              {indicator.team.behaviors.length > 0 ? <ul className="space-y-0.5 text-xs">{indicator.team.behaviors.map((behavior) => <li key={behavior.title}>{behavior.title}: {behavior.classification} ({behavior.notFollowed} de {behavior.eligible} não seguidas)</li>)}</ul> : null}
            </div>
            {indicator.evidence.length > 0 ? (
              <div className="space-y-1.5">
                <p className={SECTION_TITLE}>Evidências representativas</p>
                {indicator.evidence.map((entry, index) => (
                  <blockquote key={index} className="border-l-2 border-primary/40 pl-3 text-xs leading-5 break-words"><span className="text-muted-foreground">{entry.title} · {entry.date}: </span><q className="italic">{entry.text}</q></blockquote>
                ))}
              </div>
            ) : null}
            {indicator.unsupportedHypotheses.length > 0 ? (
              <div className="space-y-1">
                <p className={SECTION_TITLE}>O que não pode ser concluído</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs">{indicator.unsupportedHypotheses.map((text) => <li key={text}>{text}</li>)}</ul>
              </div>
            ) : null}
            {indicator.limitations.length > 0 ? (
              <div className="space-y-1">
                <p className={SECTION_TITLE}>Limitações</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{indicator.limitations.map((text) => <li key={text}>{text}</li>)}</ul>
              </div>
            ) : null}
          </section>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
