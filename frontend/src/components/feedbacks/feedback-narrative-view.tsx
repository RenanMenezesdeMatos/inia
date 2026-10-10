"use client"

import { useId } from "react"
import Link from "next/link"
import { BookOpen, ChevronDown, ExternalLink, FileSearch, Lightbulb, Minus, TrendingDown, TrendingUp } from "lucide-react"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { RichContent } from "@/components/rich-content/rich-content"
import { cn } from "@/lib/utils"
import type { FeedbackView, FeedbackViewDevelopment, FeedbackViewQuote, FeedbackViewSubjects } from "@/schemas/feedbacks/feedback-view.schema"

/**
 * Feedback por Flag V2 — o feedback como um supervisor escreveria (camada 1) e, logo abaixo, dois blocos IRMÃOS (mesma caixa,
 * mesmo cabeçalho): "Entenda este feedback" (progressive disclosure, fechado por padrão) e "Materiais utilizados" (sempre
 * visível). Cada ajuste mostra só o essencial — o que aconteceu, na chamada, o que o processo orienta e como melhorar; "por que
 * importa" e o exemplo aparecem só quando existem.
 *
 * Tudo aqui é texto puro vindo do view model (o sistema já decidiu e validou o conteúdo); só o ponto de "confirmar o produto"
 * chega em Markdown do sistema. Nenhum termo técnico (status, códigos, QA) é exibido. Hierarquia de títulos: o item é h3 (no
 * feed), os blocos são h4, as seções dos detalhes h5 e cada ajuste h6.
 */
/** O conteúdo do Accordion do design system tem altura fixa (animação); aqui o conteúdo é dinâmico (accordions aninhados,
 * "Ver evidências"), então a altura acompanha o conteúdo e os parágrafos usam o espaçamento do próprio layout. */
const DYNAMIC_CONTENT = "h-auto [&_p:not(:last-child)]:mb-0"
/** Linguagem visual COMUM de "Entenda este feedback" e "Materiais utilizados" (componentes irmãos). */
const PANEL = "min-w-0 rounded-xl border bg-card"
const PANEL_HEADER = "flex w-full min-w-0 items-center gap-3 px-3 py-3 text-left sm:px-4"
const PANEL_ICON = "flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
const PANEL_TITLE = "block text-sm font-semibold leading-5"
const PANEL_HINT = "block text-xs font-normal leading-5 text-muted-foreground"
const PANEL_BODY = "border-t px-2.5 py-3 sm:px-4"

type Phase = NonNullable<NonNullable<FeedbackView["maintain"]>["evidence"][number]["phase"]>
const PHASE_LABEL: Record<Phase, string> = { INVESTIGATION: "Investigação", TREATMENT: "Tratativa", CLOSING: "Encerramento", OTHER: "Outros pontos" }
const PHASE_ORDER: Phase[] = ["INVESTIGATION", "TREATMENT", "CLOSING", "OTHER"]

/** `hideMaterials`: a superfície mostra os materiais em outro lugar (a sessão de feedback tem uma faixa própria para eles). */
export function FeedbackNarrativeView({ view, className, hideMaterials = false }: { view: FeedbackView; className?: string; hideMaterials?: boolean }) {
  const materialsId = useId()
  const hasDetails = view.developments.length > 0 || view.maintain !== null || view.attention.length > 0 || (view.cycle?.indicators.length ?? 0) > 0 || (view.subjects?.rows.length ?? 0) > 0
  // Indicator Diagnosis V1 — o feedback de INDICADOR usa os MESMOS blocos, com rótulos próprios vindos do backend.
  const labels = { developments: view.sectionLabels?.developments ?? "O que precisa ser ajustado", maintain: view.sectionLabels?.maintain ?? "O que manter", call: view.sectionLabels?.call ?? "Na chamada", hint: view.sectionLabels?.detailsHint ?? "A fala da chamada, o que o processo orienta e como melhorar em cada ponto." }
  return (
    <article className={cn("min-w-0 space-y-4", className)} aria-label="Feedback">
      <div className="space-y-3 text-[15px] leading-7 text-foreground">
        {view.greeting ? <p className="font-medium">{view.greeting}</p> : null}
        {/* Cada parágrafo pode trazer markdown seguro montado pelo motor (lista, **negrito**); texto puro vira o mesmo parágrafo. */}
        {view.narrative.map((paragraph, index) => (
          <RichContent key={index} text={paragraph} className="space-y-2 text-[15px] leading-7 [&_li]:pl-0.5 [&_strong]:font-semibold" />
        ))}
      </div>
      {hasDetails ? (
        <Collapsible className={cn(PANEL, "group/details")} data-slot="feedback-panel">
          <h4 className="m-0">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className={cn(PANEL_HEADER, "h-auto rounded-xl whitespace-normal hover:bg-muted/40 group-data-[state=open]/details:rounded-b-none")} data-usage-element="feedback.open_detail">
                <span className={PANEL_ICON} aria-hidden><FileSearch className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className={PANEL_TITLE}>Entenda este feedback</span>
                  <span className={PANEL_HINT}>{labels.hint}</span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]/details:rotate-180" aria-hidden />
              </Button>
            </CollapsibleTrigger>
          </h4>
          <CollapsibleContent className={cn(PANEL_BODY, "space-y-3")} data-usage-screen="feedback.detail">
            {view.context ? <p className="text-xs text-muted-foreground">{view.context}</p> : null}
            <Accordion type="multiple">
              {view.cycle && view.cycle.indicators.length > 0 ? (
                <AccordionItem value="ciclo">
                  <AccordionTrigger headingLevel={5}>{view.cycle.title}</AccordionTrigger>
                  <AccordionContent className={DYNAMIC_CONTENT}>
                    <CycleDetail cycle={view.cycle} />
                  </AccordionContent>
                </AccordionItem>
              ) : null}
              {view.subjects && view.subjects.rows.length > 0 ? (
                <AccordionItem value="assuntos">
                  <AccordionTrigger headingLevel={5}>{view.subjects.title}</AccordionTrigger>
                  <AccordionContent className={DYNAMIC_CONTENT}>
                    <SubjectsDetail subjects={view.subjects} />
                  </AccordionContent>
                </AccordionItem>
              ) : null}
              {view.developments.length > 0 ? (
                <AccordionItem value="ajustes">
                  <AccordionTrigger headingLevel={5}>{labels.developments}</AccordionTrigger>
                  <AccordionContent className={DYNAMIC_CONTENT}>
                    <Accordion type="multiple" className="rounded-lg border px-2 sm:px-3">
                      {view.developments.map((detail) => (
                        <AccordionItem key={detail.key} value={detail.key}>
                          <AccordionTrigger headingLevel={6} className="text-[13px]">{detail.title}</AccordionTrigger>
                          <AccordionContent className={DYNAMIC_CONTENT}>
                            <DevelopmentDetail detail={detail} callLabel={labels.call} />
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </AccordionContent>
                </AccordionItem>
              ) : null}
              {view.maintain ? (
                <AccordionItem value="manter">
                  <AccordionTrigger headingLevel={5}>{labels.maintain}</AccordionTrigger>
                  <AccordionContent className={DYNAMIC_CONTENT}>
                    <MaintainDetail maintain={view.maintain} />
                  </AccordionContent>
                </AccordionItem>
              ) : null}
              {view.attention.length > 0 ? (
                <AccordionItem value="confirmar">
                  <AccordionTrigger headingLevel={5}>Vale confirmar</AccordionTrigger>
                  <AccordionContent className={DYNAMIC_CONTENT}>
                    <div className="space-y-4">{view.attention.map((entry) => <RichContent key={entry.itemIndex} text={entry.markdown} density="detail" />)}</div>
                  </AccordionContent>
                </AccordionItem>
              ) : null}
            </Accordion>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      {/* Materiais utilizados: bloco PRÓPRIO (irmão visual de "Entenda este feedback"), fora dele e sempre visível — vêm só do
          diagnóstico deste feedback. */}
      {view.materials.length > 0 && !hideMaterials ? (
        <section aria-labelledby={`${materialsId}-title`} className={PANEL} data-slot="feedback-panel">
          <div className={PANEL_HEADER}>
            <span className={PANEL_ICON} aria-hidden><BookOpen className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <h4 id={`${materialsId}-title`} className={PANEL_TITLE}>Materiais utilizados</h4>
              <span className={PANEL_HINT}>Documentos do procedimento usados neste feedback.</span>
            </span>
          </div>
          <ul className={cn(PANEL_BODY, "space-y-3")}>
            {view.materials.map((material) => (
              <li key={material.documentId} className="min-w-0 space-y-1">
                <p className="text-sm font-medium leading-snug break-words">{material.title}</p>
                {(material.sections?.length ?? 0) > 0 ? <p className="text-xs leading-5 text-muted-foreground break-words">{material.sections!.join(" · ")}</p> : null}
                <MaterialLink href={material.href} title={material.title} label="Abrir material" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

/** Só exibição: a caixa de checklist da base ("[ ]") aparece como caixa, não como colchetes (o texto oficial não muda). */
const checklistMarks = (text: string) => text.replace(/\[\s?\]/g, "☐").replace(/\[[xX]\]/g, "☑")

/** Rótulo de seção dentro de um ajuste (não é título: o ajuste já é o h6 da árvore). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5" aria-label={title}>
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase" aria-hidden>{title}</p>
      {children}
    </section>
  )
}

function CallQuote({ quote }: { quote: FeedbackViewQuote }) {
  return (
    <blockquote className="border-l-2 border-primary/40 pl-2 text-sm leading-6 break-words sm:pl-3">
      <span className="text-muted-foreground">{quote.intro}: </span>
      <q className="italic">{quote.text}{quote.truncated ? "…" : ""}</q>
    </blockquote>
  )
}

function MaterialLink({ href, title, label }: { href: string | null; title: string; label: string }) {
  if (!href) return <p className="text-xs text-muted-foreground">Material indisponível para este perfil</p>
  return (
    <Link href={href} target="_blank" rel="noopener noreferrer" data-usage-element="feedback.material.open" className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline" aria-label={`${label}: ${title} (abre em nova aba)`}>
      {label}
      <ExternalLink className="size-3" aria-hidden />
    </Link>
  )
}

/** Um ajuste: o que aconteceu → na chamada → o processo orienta (+ fonte e exemplo oficial) → [por que importa] → como melhorar [+ exemplo]. */
function DevelopmentDetail({ detail, callLabel = "Na chamada" }: { detail: FeedbackViewDevelopment; callLabel?: string }) {
  const call = detail.call
  // Feedback Experience V2 — "O que aconteceu" só quando não há fala a mostrar (a narrativa já disse; os detalhes não repetem).
  const happened = (detail.adjustment.length > 0 ? detail.adjustment : [detail.whatHappened]).filter((text) => text.trim().length > 0)
  return (
    <div className="space-y-4">
      {detail.consolidates && detail.consolidates.length > 1 ? <p className="text-xs text-muted-foreground">Reúne: {detail.consolidates.join(" · ")}</p> : null}
      {happened.length > 0 ? (
        <Section title="O que aconteceu">
          {happened.map((text, index) => <p key={index} className="leading-6 break-words">{text}</p>)}
        </Section>
      ) : null}
      {call.kind !== "NONE" ? (
        <Section title={callLabel}>
          {call.kind === "QUOTES" ? (
            <div className="space-y-2">{call.quotes.map((quote, index) => <CallQuote key={index} quote={quote} />)}</div>
          ) : (
            <div className="space-y-2">
              <p className="rounded-md bg-muted/50 px-3 py-2 leading-6 break-words">{call.statement}</p>
              {call.context ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Momento em que caberia:</p>
                  <CallQuote quote={call.context} />
                </div>
              ) : null}
            </div>
          )}
        </Section>
      ) : null}
      {detail.guidance.rules.length > 0 || detail.guidance.avoid.length > 0 || detail.sources.length > 0 ? (
        <Section title="O processo orienta">
          {detail.guidance.rules.map((rule, index) => (
            <blockquote key={index} className="rounded-md border-l-2 border-emerald-500/50 bg-muted/40 px-3 py-2 text-sm leading-6 whitespace-pre-line break-words">
              {rule.label || rule.section ? <span className="mb-1 block text-xs text-muted-foreground">{rule.label ?? `Seção “${rule.section}”`}</span> : null}
              {checklistMarks(rule.text)}
            </blockquote>
          ))}
          {detail.guidance.avoid.length > 0 ? (
            <p className="text-sm leading-6 break-words"><span className="text-muted-foreground">O procedimento pede evitar: </span>{detail.guidance.avoid.map((phrase) => `“${phrase}”`).join(" · ")}</p>
          ) : null}
          {/* Exemplo OFICIAL da base: só ilustração do procedimento (nunca regra, nunca dado desta chamada). */}
          {detail.guidance.examples.map((example, index) => (
            <p key={index} className="text-sm leading-6 break-words"><span className="mr-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground not-italic">Exemplo do procedimento</span><span className="italic">“{example}”</span></p>
          ))}
          <ul className="space-y-1.5 pt-1">
            {detail.sources.map((source) => (
              <li key={`${source.documentId}-${source.section ?? ""}`} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                <span className="min-w-0 break-words text-muted-foreground"><span className="font-medium text-foreground">{source.documentTitle}</span>{source.section ? ` · ${source.section}` : ""}</span>
                <MaterialLink href={source.href} title={source.documentTitle} label="Abrir processo" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {detail.whyItMatters.length > 0 ? (
        <Section title="Por que importa">
          {detail.whyItMatters.map((text, index) => <p key={index} className="leading-6 break-words">{text}</p>)}
        </Section>
      ) : null}
      {detail.howToApply || detail.suggestedResponse ? (
        <Section title="Como melhorar">
          {detail.howToApply ? (
            <p className="flex gap-2 rounded-md bg-primary/5 px-3 py-2 leading-6 break-words"><Lightbulb className="mt-1 size-4 shrink-0 text-primary" aria-hidden /><span className="min-w-0">{detail.howToApply}</span></p>
          ) : null}
          {/* Sugestão do redator (só quando passou nas validações) ou a fraseologia OFICIAL do argumentário — nunca fala desta chamada. */}
          {detail.suggestedResponse ? (
            <div className="space-y-1 pt-1">
              <p className="text-xs text-muted-foreground">{detail.suggestedResponseSource ? `Como o argumentário “${detail.suggestedResponseSource.name}” orienta dizer — não é fala desta chamada.` : "Sugestão de como dizer — não é fala desta chamada."}</p>
              <p className="leading-6 italic break-words">“{detail.suggestedResponse}”</p>
            </div>
          ) : null}
        </Section>
      ) : null}
    </div>
  )
}

const TREND = {
  WORSE: { icon: TrendingUp, className: "text-destructive" },
  BETTER: { icon: TrendingDown, className: "text-primary" },
  STABLE: { icon: Minus, className: "text-muted-foreground" },
  NOT_COMPARED: { icon: null, className: "text-muted-foreground" },
} as const

/**
 * `INDICATOR_SUBJECTS_V1` — os assuntos da pessoa nos dois períodos, em lista (cabe no celular; nunca uma tabela larga). A leitura
 * ("Piorou", "Poucas chamadas para comparar") vem escrita do backend; o ícone só reforça — a cor nunca carrega a informação sozinha.
 */
function SubjectsDetail({ subjects }: { subjects: FeedbackViewSubjects }) {
  return (
    <div className="space-y-3">
      <p className="text-xs leading-5 text-muted-foreground">{subjects.note}</p>
      <ul className="space-y-2" aria-label="Assuntos">
        {subjects.rows.map((row) => {
          const trend = TREND[row.trend]
          const Icon = trend.icon
          return (
            <li key={row.label} className={cn("min-w-0 space-y-2 rounded-lg border px-3 py-2.5", row.focus && "border-primary/40 bg-primary/5")}>
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-sm font-medium leading-snug break-words">{row.label}</p>
                <span className={cn("inline-flex shrink-0 items-center gap-1 text-xs font-medium", trend.className)}>
                  {Icon ? <Icon className="size-3.5" aria-hidden /> : null}
                  {row.reading}
                </span>
              </div>
              {row.focus ? <Badge variant="secondary" className="text-[11px]">Assunto investigado nas chamadas</Badge> : null}
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs leading-5">
                <dt className="text-muted-foreground">{subjects.periods.previous}</dt>
                <dd className="min-w-0 break-words tabular-nums">{row.previous ?? "—"}</dd>
                <dt className="text-muted-foreground">{subjects.periods.current}</dt>
                <dd className="min-w-0 break-words tabular-nums">{row.current ?? "—"}</dd>
                {row.change ? (
                  <>
                    <dt className="text-muted-foreground">Variação</dt>
                    <dd className="min-w-0 break-words tabular-nums">{row.change}</dd>
                  </>
                ) : null}
                {row.analyzed ? (
                  <>
                    <dt className="text-muted-foreground">Analisadas</dt>
                    <dd className="min-w-0 break-words tabular-nums">{row.analyzed}</dd>
                  </>
                ) : null}
              </dl>
            </li>
          )
        })}
      </ul>
      {subjects.hidden > 0 ? <p className="text-xs text-muted-foreground">E mais {subjects.hidden} {subjects.hidden === 1 ? "assunto" : "assuntos"} com menos chamadas.</p> : null}
    </div>
  )
}

/** Indicator Diagnosis V1 — resultado OFICIAL do ciclo (linhas prontas do sistema; nada calculado aqui) + notas de contexto. */
function CycleDetail({ cycle }: { cycle: NonNullable<FeedbackView["cycle"]> }) {
  return (
    <div className="space-y-4">
      {cycle.indicators.map((indicator) => (
        <section key={indicator.name} className="space-y-2" aria-label={indicator.name}>
          {cycle.indicators.length > 1 ? <p className="text-sm font-medium">{indicator.name}</p> : null}
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
            {indicator.lines.map((line) => (
              <div key={line.label} className="contents">
                <dt className="text-muted-foreground">{line.label}</dt>
                <dd className="font-medium break-words">{line.value}</dd>
              </div>
            ))}
          </dl>
          {indicator.notes.map((note, index) => <p key={index} className="text-xs leading-5 text-muted-foreground break-words">{note}</p>)}
        </section>
      ))}
    </div>
  )
}

type EvidenceEntry = NonNullable<FeedbackView["maintain"]>["evidence"][number]
/** Evidências dos pontos que vale manter: o assunto, a frase da conduta (quando existe) e as falas. */
function EvidenceGroups({ groups }: { groups: { label: string | null; entries: EvidenceEntry[] }[] }) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.label ?? "all"} className="space-y-2">
          {group.label ? <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</p> : null}
          <ul className="space-y-3">
            {group.entries.map((entry) => (
              <li key={entry.itemIndex} className="space-y-1.5">
                <p className="leading-6 break-words"><span className="font-medium">{entry.title}{entry.statement ? ":" : ""}</span>{entry.statement ? ` ${entry.statement}` : null}</p>
                {entry.quotes.map((quote, index) => <CallQuote key={index} quote={quote} />)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** O que manter: o resumo natural; as evidências só sob demanda, agrupadas pela fase do atendimento quando isso ajuda. */
function MaintainDetail({ maintain }: { maintain: NonNullable<FeedbackView["maintain"]> }) {
  const phased = maintain.evidence.every((entry) => entry.phase)
  const groups = phased ? PHASE_ORDER.map((phase) => ({ label: PHASE_LABEL[phase], entries: maintain.evidence.filter((entry) => entry.phase === phase) })).filter((group) => group.entries.length > 0) : []
  const grouped = groups.length > 1 ? groups : [{ label: null as string | null, entries: maintain.evidence }]
  // Feedback Experience V2 — sem resumo (a narrativa já reconheceu), as evidências aparecem direto.
  if (!maintain.summary) return <EvidenceGroups groups={grouped} />
  return (
    <div className="space-y-3">
      <p className="leading-6 break-words">{maintain.summary}</p>
      {maintain.evidence.length > 0 ? (
        <Collapsible className="group/evidence">
          <CollapsibleTrigger asChild>
            <Button variant="link" size="sm" className="h-auto px-0 text-xs">
              Ver evidências
              <ChevronDown className="size-3.5 transition-transform group-data-[state=open]/evidence:rotate-180" aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <EvidenceGroups groups={grouped} />
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
