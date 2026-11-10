"use client"

import { useState, type ReactNode } from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, CircleCheck, CircleDashed, FileText, Info, Users } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatIndicatorValue } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import type { Investigation } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { CONCLUSION_LABELS, FOCUS_LABELS, REFERENCE_BASIS_LABELS, shortDate } from "./memory-labels"
import { OUTCOME_CHART_CONFIG } from "./outcome-charts"

/** O que cada conclusão quer dizer para quem lê — a mesma regra do motor, em uma frase. */
export const CONCLUSION_DESCRIPTIONS: Record<string, string> = {
  PATTERN_SUPPORTED: "A variação foi localizada e as chamadas analisadas mostram uma conduta recorrente que acompanha o recorte que piorou.",
  STRENGTH_PATTERN: "As chamadas analisadas mostram uma prática consistente que vale preservar.",
  RESULT_RECOGNITION: "O resultado é bom e não há recorte pior a corrigir — é um resultado a reconhecer.",
  CHANGE_LOCATED_NO_CAUSE: "A investigação localizou onde o resultado mudou, mas as chamadas não sustentaram uma causa de conduta. É uma conclusão válida.",
  CHANGE_LOCATED_NOT_EXAMINED: "A investigação localizou onde o resultado mudou, mas as chamadas desse recorte não foram examinadas.",
  MIX_EFFECT: "A variação vem principalmente da mudança no mix de assuntos atendidos, não de uma mudança de conduta.",
  INSUFFICIENT_DATA: "Não há dados suficientes para localizar a mudança ou sustentar uma conclusão.",
}
const ADVERSE_CONCLUSIONS = new Set(["PATTERN_SUPPORTED", "CHANGE_LOCATED_NO_CAUSE", "CHANGE_LOCATED_NOT_EXAMINED"])
const POSITIVE_CONCLUSIONS = new Set(["STRENGTH_PATTERN", "RESULT_RECOGNITION"])

const CHANGE_LABELS: Record<string, string> = { WORSE: "Piorou", BETTER: "Melhorou", STABLE: "Estável", UNKNOWN: "Sem base de comparação" }
const MOVEMENT_LABELS: Record<string, string> = { WORSENED: "Piorou", IMPROVED: "Melhorou", UNCHANGED: "Estável" }
const CONTRAST_LABELS: Record<string, string> = {
  REFERENCE_FOLLOWS_PERSON_MISSES: "Os colegas cumprem; a pessoa, não",
  REFERENCE_ONLY: "Avaliada só nos colegas",
  BOTH_FOLLOW: "A pessoa faz como os colegas",
  REFERENCE_ALSO_MISSES: "Os colegas também quase não cumprem",
}
const proxyValue = (value: number, kind: string | null) => (kind === "DURATION_SECONDS" ? formatIndicatorValue(value, "SECONDS") : kind === "SIGNAL_RATE" ? `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : value.toLocaleString("pt-BR", { maximumFractionDigits: 1 }))

type Official = {
  name?: string
  periodLabel?: string
  value?: number
  target?: number | null
  withinTarget?: boolean | null
  previous?: { value: number; periodLabel: string; withinTarget?: boolean | null } | null
  unit?: string
  direction?: string
  movement?: string | null
  quartile?: string | null
  previousQuartile?: string | null
}
type Pattern = Investigation["evidence"][number]["patterns"][number] & { practiceTitle?: string; documentTitle?: string; heading?: string }
type ReferencePractice = NonNullable<Investigation["reference"]>["practices"][number] & { practiceTitle?: string; documentTitle?: string; heading?: string }
export type InvestigationCall = { callAssessmentId: string; interactionId: string; localDate: string; criterionKey: string; rationale: string | null }

/** Título de um padrão/prática: o nome curto da prática quando existe; senão a primeira linha da regra. */
const titleOf = (entry: { practiceTitle?: string; text: string }) => entry.practiceTitle ?? entry.text.split("\n")[0]!.replace(/\*\*/g, "")
const sourceOf = (entry: { documentTitle?: string; heading?: string }) => [entry.documentTitle, entry.heading].filter(Boolean).join(" · ")

/**
 * O RELATÓRIO de uma investigação de indicador, na ordem em que a liderança decide: o fato oficial e a conclusão; onde o resultado
 * mudou; o que as chamadas desse recorte mostram (desvios recorrentes e práticas consistentes primeiro, isolados recolhidos); o que
 * fazem os colegas comparáveis; as perguntas que a investigação respondeu; e os limites. Usado na memória da liderança (com as
 * chamadas abrindo ao lado) e no "Testar diagnóstico" da estratégia do indicador (sem chamadas).
 */
export function InvestigationReport({ investigation: detail, callAssessments = {}, onOpenCall, activeInteractionId = null }: {
  investigation: Investigation
  callAssessments?: Record<string, string>
  onOpenCall?: (call: InvestigationCall) => void
  activeInteractionId?: string | null
}) {
  const official = detail.official as Official
  const limitations = [...new Set([...detail.localization.limitations, ...(detail.reference?.limitations ?? []), ...detail.limitations])]
  const evidence = detail.evidence.filter((entry) => entry.patterns.some((pattern) => pattern.classification !== "NONE") || entry.sampleNote)
  return (
    <div className="@container space-y-7">
      <OfficialResult official={official} />
      <ConclusionCallout conclusion={detail.conclusion} focus={detail.localization.focus} />

      <ReportSection title="Onde o resultado mudou" description={detail.localization.proxy.kind ? `Métrica por assunto: ${detail.localization.proxy.label} — ${detail.localization.proxy.description}` : undefined}>
        <Localization localization={detail.localization} />
      </ReportSection>

      {evidence.map((entry) => (
        <ReportSection key={entry.segmentLabel} title={`O que as chamadas de ${entry.segmentLabel} mostram`} description={entry.sampleNote}>
          <Patterns patterns={entry.patterns as Pattern[]} callAssessments={callAssessments} onOpenCall={onOpenCall} activeInteractionId={activeInteractionId} />
        </ReportSection>
      ))}

      <ReportSection title="Comparação com colegas" description={detail.reference ? `${REFERENCE_BASIS_LABELS[detail.reference.basis] ?? detail.reference.basis} · ${detail.reference.members} colega(s) de ${detail.reference.population} comparáveis${detail.reference.segmentLabel ? ` · assunto ${detail.reference.segmentLabel}` : ""}. Só números agregados.` : undefined}>
        {detail.reference && detail.reference.practices.length > 0 ? <ReferencePractices practices={detail.reference.practices as ReferencePractice[]} /> : <p className="text-sm text-muted-foreground">{detail.reference ? "Nenhuma prática comparável registrada." : "O grupo de referência não foi consultado nesta investigação."}</p>}
      </ReportSection>

      {detail.questions.length > 0 ? (
        <ReportSection title="Perguntas da investigação">
          <ul className="divide-y rounded-lg border">
            {detail.questions.map((question) => (
              <li key={question.id} className="flex gap-3 p-3 text-sm">
                {question.answered ? <CircleCheck className="mt-0.5 size-4 shrink-0" style={{ color: OUTCOME_CHART_CONFIG.met.color }} aria-label="Respondida" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Sem suporte" />}
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">{question.question}</p>
                  <p className="text-muted-foreground">{question.summary}</p>
                </div>
              </li>
            ))}
          </ul>
        </ReportSection>
      ) : null}

      {limitations.length > 0 ? (
        <Collapsible className="rounded-lg border bg-muted/30">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 p-3 text-left text-sm font-medium">
            <Info className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">Limites desta investigação ({limitations.length})</span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="list-disc space-y-1 px-3 pb-3 pl-8 text-xs leading-relaxed text-muted-foreground">{limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

function ReportSection({ title, description, children }: { title: string; description?: string | undefined; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** O fato oficial como veio da fonte: resultado, meta, período anterior e quartil — nada recalculado. */
function OfficialResult({ official }: { official: Official }) {
  const unit = official.unit ?? ""
  const format = (value: number) => formatIndicatorValue(value, unit)
  const hasTarget = official.target !== null && official.target !== undefined
  const movement = official.movement ? MOVEMENT_LABELS[official.movement] : null
  // A seta mostra para onde o VALOR foi (subiu/desceu); a cor e o texto dizem se isso é melhora ou piora.
  const delta = official.previous && official.value !== undefined ? official.value - official.previous.value : 0
  const MovementIcon = delta > 0 ? ArrowUpRight : delta < 0 ? ArrowDownRight : ArrowRight
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border @3xl:grid-cols-4">
      <Tile label="Resultado oficial" emphasis>
        <span className="text-2xl font-semibold tabular-nums">{official.value !== undefined ? format(official.value) : "—"}</span>
        {official.withinTarget === true || official.withinTarget === false ? (
          <Badge variant={official.withinTarget ? "secondary" : "destructive"} className="mt-1">{official.withinTarget ? "Dentro da meta" : "Fora da meta"}</Badge>
        ) : null}
      </Tile>
      <Tile label="Meta">
        <span className="text-xl font-semibold tabular-nums">{hasTarget ? format(official.target!) : "Sem meta"}</span>
        {official.direction ? <span className="text-xs text-muted-foreground">{official.direction === "LOWER" ? "Quanto menor, melhor" : official.direction === "HIGHER" ? "Quanto maior, melhor" : "Valor-alvo"}</span> : null}
      </Tile>
      <Tile label={official.previous ? `Anterior · ${official.previous.periodLabel}` : "Período anterior"}>
        <span className="text-xl font-semibold tabular-nums">{official.previous ? format(official.previous.value) : "—"}</span>
        {movement ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium" style={official.movement === "WORSENED" ? { color: OUTCOME_CHART_CONFIG.deviations.color } : undefined}>
            <MovementIcon className="size-3.5" aria-hidden />{movement}
          </span>
        ) : null}
      </Tile>
      <Tile label="Quartil">
        <span className="text-xl font-semibold">{official.quartile ?? "—"}</span>
        {official.previousQuartile ? <span className="text-xs text-muted-foreground">antes {official.previousQuartile}</span> : null}
      </Tile>
    </div>
  )
}

function Tile({ label, emphasis = false, children }: { label: string; emphasis?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1 bg-card p-4", emphasis && "bg-primary/5")}>
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

function ConclusionCallout({ conclusion, focus }: { conclusion: string; focus: Investigation["localization"]["focus"] }) {
  const adverse = ADVERSE_CONCLUSIONS.has(conclusion)
  const positive = POSITIVE_CONCLUSIONS.has(conclusion)
  return (
    <div className={cn("space-y-2 rounded-xl border-l-4 bg-muted/40 p-4", adverse ? "border-l-destructive" : positive ? "border-l-primary" : "border-l-muted-foreground/40")}>
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Conclusão</p>
      <p className="text-base font-semibold">{CONCLUSION_LABELS[conclusion] ?? conclusion}</p>
      {CONCLUSION_DESCRIPTIONS[conclusion] ? <p className="text-sm text-muted-foreground">{CONCLUSION_DESCRIPTIONS[conclusion]}</p> : null}
      {focus.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground">Foco:</span>
          {focus.map((entry) => <Badge key={`${entry.key}-${entry.reason}`} variant="outline">{entry.label} · {FOCUS_LABELS[entry.reason] ?? entry.reason}</Badge>)}
        </div>
      ) : null}
    </div>
  )
}

function Localization({ localization }: { localization: Investigation["localization"] }) {
  const [showAll, setShowAll] = useState(false)
  const focusKeys = new Set(localization.focus.map((entry) => entry.key))
  const relevant = localization.segments.filter((segment) => segment.sufficient || focusKeys.has(segment.key)).sort((a, b) => Number(focusKeys.has(b.key)) - Number(focusKeys.has(a.key)))
  // Assuntos com pouco volume ficam recolhidos só quando há outros para ler; se todos são de pouco volume, aparecem todos.
  const sufficient = relevant.length > 0 ? relevant : localization.segments
  const insufficient = relevant.length > 0 ? localization.segments.filter((segment) => !segment.sufficient && !focusKeys.has(segment.key)) : []
  const rows = showAll ? [...sufficient, ...insufficient] : sufficient
  const value = (point: { n: number; value: number } | null) => (point ? <>{proxyValue(point.value, localization.proxy.kind)} <span className="text-xs text-muted-foreground">({point.n} {point.n === 1 ? "chamada" : "chamadas"})</span></> : <span className="text-muted-foreground">—</span>)
  return (
    <div className="space-y-3">
      {localization.decomposition ? (
        <p className="text-sm">Composição da variação: <span className="font-medium">{localization.decomposition.dominant === "MIX" ? "principalmente mudança no mix de assuntos" : localization.decomposition.dominant === "WITHIN" ? "principalmente mudança dentro dos assuntos" : "mix e mudança dentro dos assuntos"}</span>.</p>
      ) : null}
      {localization.segments.length > 0 ? (
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>Assunto</TableHead>
                <TableHead className="text-right">{localization.windows.previous.label}</TableHead>
                <TableHead className="text-right">{localization.windows.current.label}</TableHead>
                <TableHead>Mudança</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((segment) => {
                const focus = localization.focus.find((entry) => entry.key === segment.key)
                return (
                  <TableRow key={segment.key} className={cn(focus && "bg-primary/5 hover:bg-primary/10")}>
                    <TableCell className="max-w-xs whitespace-normal">
                      <span className={cn(focus && "font-medium")}>{segment.label}</span>
                      {focus ? <Badge className="ml-2" variant="outline">foco · {FOCUS_LABELS[focus.reason] ?? focus.reason}</Badge> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{value(segment.previous)}</TableCell>
                    <TableCell className="text-right tabular-nums">{value(segment.current)}</TableCell>
                    <TableCell>
                      {segment.sufficient
                        ? <span className="text-sm font-medium" style={segment.changeDirection === "WORSE" ? { color: OUTCOME_CHART_CONFIG.deviations.color } : undefined}>{CHANGE_LABELS[segment.changeDirection] ?? segment.changeDirection}</span>
                        : <span className="text-xs text-muted-foreground">Volume insuficiente</span>}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {insufficient.length > 0 ? (
            <div className="border-t px-3 py-1.5">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setShowAll((current) => !current)}>
                {showAll ? "Mostrar só os assuntos com volume" : `Mostrar mais ${insufficient.length} ${insufficient.length === 1 ? "assunto" : "assuntos"} com volume insuficiente`}
              </Button>
            </div>
          ) : null}
        </div>
      ) : <p className="text-sm text-muted-foreground">Nenhum assunto com dados para comparar.</p>}
      {localization.daily.available && localization.daily.outliers.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Dias fora do padrão:</span>
          {localization.daily.outliers.map((day) => <Badge key={day.date} variant="outline" className="tabular-nums">{shortDate(day.date)} · {day.value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</Badge>)}
        </div>
      ) : null}
    </div>
  )
}

const PATTERN_GROUPS: { classification: string; title: string; description: string }[] = [
  { classification: "DEVELOPMENT_PATTERN", title: "Desvios recorrentes", description: "A mesma etapa falhou na maioria das chamadas em que ela valia." },
  { classification: "STRENGTH_PATTERN", title: "Práticas consistentes", description: "A etapa foi cumprida de forma consistente." },
]

function Patterns({ patterns, callAssessments, onOpenCall, activeInteractionId }: { patterns: Pattern[]; callAssessments: Record<string, string>; onOpenCall: ((call: InvestigationCall) => void) | undefined; activeInteractionId: string | null }) {
  const isolated = patterns.filter((pattern) => pattern.classification === "ISOLATED_DEVIATION")
  const shown = PATTERN_GROUPS.map((group) => ({ ...group, items: patterns.filter((pattern) => pattern.classification === group.classification) })).filter((group) => group.items.length > 0)
  if (shown.length === 0 && isolated.length === 0) return <p className="text-sm text-muted-foreground">Nenhum desvio nas chamadas analisadas.</p>
  const card = (pattern: Pattern) => <PatternCard key={pattern.criterionKey} pattern={pattern} callAssessments={callAssessments} onOpenCall={onOpenCall} activeInteractionId={activeInteractionId} />
  return (
    <div className="space-y-5">
      {shown.map((group) => (
        <div key={group.classification} className="space-y-2">
          <p className="text-sm font-medium">{group.title} <span className="font-normal text-muted-foreground">· {group.description}</span></p>
          <div className="space-y-2">{group.items.map(card)}</div>
        </div>
      ))}
      {isolated.length > 0 ? (
        <Collapsible className="space-y-2">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md text-left text-sm font-medium">
            <span className="flex-1">Desvios isolados ({isolated.length}) <span className="font-normal text-muted-foreground">· aconteceram em poucas chamadas; não formam padrão</span></span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2">{isolated.map(card)}</CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

function PatternCard({ pattern, callAssessments, onOpenCall, activeInteractionId }: { pattern: Pattern; callAssessments: Record<string, string>; onOpenCall: ((call: InvestigationCall) => void) | undefined; activeInteractionId: string | null }) {
  const [ruleOpen, setRuleOpen] = useState(false)
  const deviations = pattern.notMet + pattern.partial
  const strength = pattern.classification === "STRENGTH_PATTERN"
  const accent = strength ? OUTCOME_CHART_CONFIG.met.color : OUTCOME_CHART_CONFIG.deviations.color
  const total = Math.max(pattern.eligible + pattern.inconclusive, 1)
  const source = sourceOf(pattern)
  return (
    <article className="space-y-3 rounded-lg border border-l-4 bg-card p-4" style={{ borderLeftColor: accent }}>
      <div className="space-y-1">
        <p className="font-semibold leading-snug">{titleOf(pattern)}</p>
        {source ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><FileText className="size-3 shrink-0" aria-hidden />{source}</p> : null}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm">
          <span className="font-semibold tabular-nums" style={{ color: deviations > 0 ? OUTCOME_CHART_CONFIG.deviations.color : undefined }}>{deviations} de {pattern.eligible}</span> {pattern.eligible === 1 ? "chamada" : "chamadas"} com desvio
          <span className="text-muted-foreground"> · {pattern.met} cumprida(s){pattern.inconclusive > 0 ? ` · ${pattern.inconclusive} sem conclusão` : ""}</span>
        </p>
        <div className="flex h-1.5 max-w-xs overflow-hidden rounded-full bg-muted" aria-hidden>
          <span style={{ width: `${(deviations / total) * 100}%`, background: OUTCOME_CHART_CONFIG.deviations.color }} />
          <span style={{ width: `${(pattern.met / total) * 100}%`, background: OUTCOME_CHART_CONFIG.met.color }} />
        </div>
      </div>
      {pattern.examples.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Chamadas que sustentam</p>
          <ul className="space-y-1.5">
            {pattern.examples.map((example) => {
              const callAssessmentId = callAssessments[example.interactionId]
              const active = activeInteractionId === example.interactionId
              const content = (
                <>
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium tabular-nums">Chamada de {shortDate(example.localDate)}</span>
                    {callAssessmentId && onOpenCall ? <span className="text-xs text-primary">{active ? "Aberta ao lado" : "Ver chamada"}</span> : null}
                  </span>
                  {example.rationale ? <span className="line-clamp-2 block text-sm text-muted-foreground">{example.rationale}</span> : null}
                </>
              )
              return (
                <li key={example.interactionId}>
                  {callAssessmentId && onOpenCall ? (
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => onOpenCall({ callAssessmentId, interactionId: example.interactionId, localDate: example.localDate, criterionKey: pattern.criterionKey, rationale: example.rationale })}
                      className={cn("w-full space-y-0.5 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/60", active && "border-primary/40 bg-primary/5 ring-1 ring-primary/20")}
                    >
                      {content}
                    </button>
                  ) : <div className="space-y-0.5 rounded-md border border-dashed px-3 py-2">{content}</div>}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <div className="border-t pt-2">
        <button type="button" onClick={() => setRuleOpen((value) => !value)} className="text-xs font-medium text-muted-foreground hover:text-foreground" aria-expanded={ruleOpen}>
          {ruleOpen ? "Ocultar a regra" : "Ver a regra avaliada"}
        </button>
        {ruleOpen ? <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-line text-muted-foreground">{pattern.text.replace(/\*\*/g, "")}</p> : null}
      </div>
    </article>
  )
}

function ReferencePractices({ practices }: { practices: ReferencePractice[] }) {
  const ratio = (met: number, eligible: number) => (eligible > 0 ? <><span className="font-semibold tabular-nums">{met}</span><span className="text-muted-foreground tabular-nums"> de {eligible}</span></> : <span className="text-xs text-muted-foreground">não avaliada</span>)
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead>Prática</TableHead>
            <TableHead className="text-right">A pessoa cumpriu</TableHead>
            <TableHead className="text-right"><span className="inline-flex items-center gap-1"><Users className="size-3.5" aria-hidden />Colegas cumpriram</span></TableHead>
            <TableHead>Leitura</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {practices.map((practice) => (
            <TableRow key={practice.criterionKey}>
              <TableCell className="max-w-sm whitespace-normal">
                <p className="font-medium">{titleOf(practice)}</p>
                {sourceOf(practice) ? <p className="text-xs text-muted-foreground">{sourceOf(practice)}</p> : null}
              </TableCell>
              <TableCell className="text-right">{ratio(practice.person.met, practice.person.eligible)}</TableCell>
              <TableCell className="text-right">{ratio(practice.reference.met, practice.reference.eligible)}<p className="text-xs text-muted-foreground">{practice.reference.contributors} colega(s)</p></TableCell>
              <TableCell className="whitespace-normal">
                <span className={cn("text-sm", practice.contrast === "REFERENCE_FOLLOWS_PERSON_MISSES" && "font-medium")} style={practice.contrast === "REFERENCE_FOLLOWS_PERSON_MISSES" ? { color: OUTCOME_CHART_CONFIG.deviations.color } : undefined}>
                  {CONTRAST_LABELS[practice.contrast] ?? practice.contrast}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
