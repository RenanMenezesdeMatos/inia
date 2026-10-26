"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Ban, ChevronDown, CircleCheck, CircleDashed, CircleHelp, CircleMinus, CircleX, ExternalLink, MessageSquareQuote, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"
import { RelevantPracticesHint } from "@/components/best-practices/relevant-practices-hint"
import type { AssessmentDetail } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { EVIDENCE_KIND_LABELS, OUTCOME_LABELS, PATH_LABELS, SPEAKER_LABELS, STATUS_LABELS, shortDate } from "./memory-labels"
import { OUTCOME_CHART_CONFIG } from "./outcome-charts"

type Criterion = AssessmentDetail["criteria"][number]
type DetailTab = "points" | "scenario" | "transcript"

/** Ícone e cor de cada situação — desvio no vermelho de alerta, acerto no roxo da marca (as cores dos gráficos), o resto neutro. */
const STATUS_LOOK: Record<string, { icon: LucideIcon; color: string | null }> = {
  NOT_MET: { icon: CircleX, color: OUTCOME_CHART_CONFIG.deviations.color },
  PARTIAL: { icon: CircleMinus, color: OUTCOME_CHART_CONFIG.deviations.color },
  MET: { icon: CircleCheck, color: OUTCOME_CHART_CONFIG.met.color },
  NOT_OBSERVABLE: { icon: CircleDashed, color: null },
  NOT_ASSESSED: { icon: CircleDashed, color: null },
  NOT_APPLICABLE: { icon: Ban, color: null },
}
const lookOf = (status: string) => STATUS_LOOK[status] ?? { icon: CircleDashed, color: null }

/** `PRODUCT_APPLICABILITY_V1`: ponto que depende de um produto que a gravação não estabeleceu — nem falha, nem acerto, grupo próprio. */
const dependsOnProduct = (criterion: Criterion) => criterion.productApplicability?.effect === "SUSPENDED"
const GROUPS: { key: string; title: string; statuses: string[]; open: boolean; icon?: LucideIcon; belongs?: (criterion: Criterion) => boolean }[] = [
  { key: "deviations", title: "Desvios", statuses: ["NOT_MET", "PARTIAL"], open: true },
  { key: "met", title: "Acertos", statuses: ["MET"], open: true },
  { key: "productPending", title: "Sem avaliação — depende do produto", statuses: ["NOT_OBSERVABLE"], open: false, icon: CircleHelp, belongs: dependsOnProduct },
  { key: "inconclusive", title: "Sem conclusão", statuses: ["NOT_OBSERVABLE", "NOT_ASSESSED"], open: false, belongs: (criterion) => !dependsOnProduct(criterion) },
  { key: "notApplicable", title: "Não se aplicam neste cenário", statuses: ["NOT_APPLICABLE"], open: false },
]

/** Quem fala do lado do atendimento (à direita na transcrição), quem é o cliente (à esquerda) — o resto é evento, no centro. */
const AGENT_SPEAKERS = new Set(["OPERADOR", "ATENDENTE", "AGENTE", "SUPORTE", "SUPERVISOR"])
const sideOf = (speaker: string | null) => (speaker && AGENT_SPEAKERS.has(speaker) ? "agent" : speaker === "CLIENTE" ? "customer" : "event")
const speakerLabel = (speaker: string | null) => SPEAKER_LABELS[speaker ?? ""] ?? speaker ?? "Fala"

/**
 * A AVALIAÇÃO de UMA chamada — o fim do drill-down de qualquer agregado: o líder confere a conclusão na fonte.
 *   - topo: quem, quando, assunto, a leitura da chamada e a proporção desvios × acertos;
 *   - "Neste ponto": o critério que trouxe a pessoa até aqui (drill de um ponto), primeiro e em destaque;
 *   - abas: Pontos avaliados (por situação; sem conclusão e não aplicáveis recolhidos) · Cenário (necessidade, o que o procedimento
 *     pede × o que foi feito) · Transcrição (em formato de conversa, com as falas citadas marcadas).
 * Clicar numa fala citada leva à transcrição, já no trecho.
 */
export function CallAssessmentDetail({ detail, focusId = null }: { detail: AssessmentDetail; focusId?: string | null }) {
  const [tab, setTab] = useState<DetailTab>("points")
  const [highlightTurn, setHighlightTurn] = useState<string | null>(null)
  const focused = focusId ? detail.criteria.find((criterion) => criterion.id === focusId) ?? null : null
  const others = detail.criteria.filter((criterion) => criterion !== focused)
  const counts = useMemo(() => countStatuses(detail.criteria), [detail.criteria])
  const showTurn = (turn: string) => {
    setHighlightTurn(turn)
    setTab("transcript")
  }

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div>
          <p className="text-base font-semibold">{detail.personName}</p>
          <p className="text-sm text-muted-foreground">
            {shortDate(detail.date)}{detail.subject ? ` · ${detail.subject}` : ""}
            <span className="ml-1.5 font-mono text-xs text-muted-foreground/80" title="Identificador da chamada na fonte">#{detail.externalId}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={detail.pathAssessment === "INCORRECT" ? "destructive" : "outline"}>{PATH_LABELS[detail.pathAssessment] ?? detail.pathAssessment}</Badge>
          <Badge variant="outline">{OUTCOME_LABELS[detail.outcome] ?? detail.outcome}</Badge>
          {detail.transcriptStatus !== "COMPLETE" ? <Badge variant="outline">Transcrição incompleta</Badge> : null}
          {!detail.isCurrent ? <Badge variant="outline">Leitura substituída por uma mais nova</Badge> : null}
          {(detail.productIdentification?.requests ?? []).map((request) => <Badge key={request.ref} variant="outline" title={request.summary}>{request.label}</Badge>)}
        </div>
        <StatusSummary counts={counts} />
      </header>

      <RelevantPracticesHint interactionId={detail.interactionId} />

      {focused ? (
        <section className="space-y-2" aria-label="O ponto que trouxe você até aqui">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Neste ponto</h3>
          <CriterionCard criterion={focused} focused onShowTurn={showTurn} />
        </section>
      ) : null}

      <Tabs value={tab} onValueChange={(value) => setTab(value as DetailTab)}>
        <TabsList>
          <TabsTrigger value="points">{focused ? "Outros pontos" : "Pontos avaliados"} <span className="tabular-nums text-muted-foreground">{others.length}</span></TabsTrigger>
          <TabsTrigger value="scenario">Cenário</TabsTrigger>
          <TabsTrigger value="transcript">Transcrição <span className="tabular-nums text-muted-foreground">{detail.transcript.length}</span></TabsTrigger>
        </TabsList>

        <TabsContent value="points" className="mt-4 space-y-3">
          {others.length === 0 ? <p className="text-sm text-muted-foreground">Nenhum outro ponto avaliado nesta chamada.</p> : null}
          {GROUPS.map((group) => {
            const criteria = others.filter((criterion) => group.statuses.includes(criterion.status) && (group.belongs ? group.belongs(criterion) : true))
            if (criteria.length === 0) return null
            return <CriteriaGroup key={group.key} title={group.title} statuses={group.statuses} icon={group.icon} criteria={criteria} defaultOpen={group.open} onShowTurn={showTurn} />
          })}
        </TabsContent>

        <TabsContent value="scenario" className="mt-4">
          <ScenarioView detail={detail} />
        </TabsContent>

        <TabsContent value="transcript" className="mt-4">
          <TranscriptView detail={detail} highlightTurn={highlightTurn} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

type StatusCounts = { deviations: number; met: number; inconclusive: number; notApplicable: number; productPending: number }
function countStatuses(criteria: Criterion[]): StatusCounts {
  const counts: StatusCounts = { deviations: 0, met: 0, inconclusive: 0, notApplicable: 0, productPending: 0 }
  for (const criterion of criteria) {
    if (dependsOnProduct(criterion)) counts.productPending += 1
    else if (criterion.status === "NOT_MET" || criterion.status === "PARTIAL") counts.deviations += 1
    else if (criterion.status === "MET") counts.met += 1
    else if (criterion.status === "NOT_APPLICABLE") counts.notApplicable += 1
    else counts.inconclusive += 1
  }
  return counts
}

/** Desvios × acertos da chamada numa barra (número sempre escrito ao lado); sem conclusão e não aplicáveis só contados. */
function StatusSummary({ counts }: { counts: StatusCounts }) {
  const assessed = counts.deviations + counts.met
  return (
    <div className="space-y-1.5">
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <Legend color={OUTCOME_CHART_CONFIG.deviations.color} label={`${counts.deviations} ${counts.deviations === 1 ? "desvio" : "desvios"}`} />
        <Legend color={OUTCOME_CHART_CONFIG.met.color} label={`${counts.met} ${counts.met === 1 ? "acerto" : "acertos"}`} />
        {counts.inconclusive > 0 ? <span>{counts.inconclusive} sem conclusão</span> : null}
        {counts.productPending > 0 ? <span>{counts.productPending} dependem do produto</span> : null}
        {counts.notApplicable > 0 ? <span>{counts.notApplicable} não se aplicam</span> : null}
      </p>
      {assessed > 0 ? (
        <div className="flex h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted" aria-hidden>
          <span style={{ width: `${(counts.deviations / assessed) * 100}%`, background: OUTCOME_CHART_CONFIG.deviations.color }} />
          <span className="border-l-2 border-background" style={{ width: `${(counts.met / assessed) * 100}%`, background: OUTCOME_CHART_CONFIG.met.color }} />
        </div>
      ) : null}
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return <span className="inline-flex items-center gap-1.5 font-medium text-foreground"><span className="size-2 rounded-full" style={{ background: color }} aria-hidden />{label}</span>
}

function CriteriaGroup({ title, statuses, icon, criteria, defaultOpen, onShowTurn }: { title: string; statuses: string[]; icon?: LucideIcon; criteria: Criterion[]; defaultOpen: boolean; onShowTurn: (turn: string) => void }) {
  const [open, setOpen] = useState(defaultOpen)
  const Icon = icon ?? lookOf(statuses[0]!).icon
  const color = lookOf(statuses[0]!).color
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-2">
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-1 text-left text-sm font-semibold hover:text-foreground/80">
        <Icon className="size-4 shrink-0" style={color ? { color } : undefined} aria-hidden />
        <span className="flex-1">{title} <span className="font-normal text-muted-foreground tabular-nums">({criteria.length})</span></span>
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="space-y-2">{criteria.map((criterion) => <li key={criterion.id}><CriterionCard criterion={criterion} onShowTurn={onShowTurn} /></li>)}</ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Um critério, na ordem em que a liderança lê: o que aconteceu, a fala, a orientação — e, por último, a regra e a fonte. */
function CriterionCard({ criterion, focused = false, onShowTurn }: { criterion: Criterion; focused?: boolean; onShowTurn: (turn: string) => void }) {
  const [ruleOpen, setRuleOpen] = useState(false)
  const longRule = criterion.text.length > 140 || criterion.text.includes("\n")
  const look = lookOf(criterion.status)
  const showKind = criterion.evidenceKind && criterion.evidenceKind !== "CONDUCT_OBSERVED" && criterion.evidenceKind !== "NONE"
  return (
    <article
      className={cn("space-y-2.5 rounded-lg border border-l-4 bg-card p-3 text-sm", focused && "ring-2 ring-primary/20")}
      style={{ borderLeftColor: look.color ?? "var(--border)" }}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 text-xs font-semibold" style={look.color ? { color: look.color } : undefined}>
          <look.icon className="size-3.5" aria-hidden />{STATUS_LABELS[criterion.status] ?? criterion.status}
        </span>
        {criterion.materiality === "HIGH" ? <Badge variant="outline" className="text-[11px]">Material</Badge> : null}
        {criterion.ruleConflict ? <Badge variant="outline" className="text-[11px]">Regra em conflito entre fontes</Badge> : null}
        {showKind ? (
          <span className="text-xs text-muted-foreground">
            {EVIDENCE_KIND_LABELS[criterion.evidenceKind!] ?? criterion.evidenceKind}
            {criterion.opportunityTurn ? <> · oportunidade em <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => onShowTurn(criterion.opportunityTurn!)} title="Ver na transcrição">{criterion.opportunityTurn}</button></> : null}
          </span>
        ) : null}
      </div>

      {criterion.productApplicability && criterion.productApplicability.effect !== "INDEPENDENT" ? <ProductNote applicability={criterion.productApplicability} /> : null}
      {criterion.rationale ? <p className="leading-relaxed">{criterion.rationale}</p> : null}

      {criterion.evidence.length > 0 ? (
        <ul className="space-y-1.5">
          {criterion.evidence.map((quote) => (
            <li key={`${quote.turn}-${quote.quote}`}>
              <button type="button" onClick={() => onShowTurn(quote.turn)} className="group w-full rounded-md border-l-2 border-primary/40 py-1 pr-2 pl-3 text-left transition-colors hover:bg-muted/60" title="Ver na transcrição">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {speakerLabel(quote.speaker)} · {quote.turn}
                  <span className="text-primary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">ver na transcrição</span>
                </span>
                <span className="block italic">“{quote.quote}”</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {criterion.guidance ? (
        <p className="rounded-md bg-muted/70 px-3 py-2 text-xs leading-relaxed">
          <span className="font-semibold">Como fazer:</span> {criterion.guidance.moment}{criterion.guidance.condition ? ` (${criterion.guidance.condition})` : ""}: {criterion.guidance.action}
        </p>
      ) : null}
      {criterion.whyItMatters ? <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Por que importa:</span> {criterion.whyItMatters}</p> : null}
      {criterion.occurrence && criterion.occurrence.sameConductAs.length > 0 ? (
        <p className="text-xs text-muted-foreground">Mesma conduta avaliada também por: {criterion.occurrence.sameConductAs.map((other) => `${other.text}${other.documentTitle ? ` (${other.documentTitle})` : ""}`).join(" · ")} — conta como uma ocorrência.</p>
      ) : null}

      <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground">
        <p className={cn("whitespace-pre-line", longRule && !ruleOpen && "line-clamp-2")}><span className="font-medium text-foreground/80">Regra avaliada:</span> {criterion.text}</p>
        {longRule ? <button type="button" onClick={() => setRuleOpen((value) => !value)} className="font-medium text-primary hover:underline" aria-expanded={ruleOpen}>{ruleOpen ? "Mostrar menos" : "Ver regra completa"}</button> : null}
        <p>
          {criterion.href ? <a className="inline-flex items-center gap-1 font-medium text-foreground/80 underline-offset-2 hover:underline" href={criterion.href} target="_blank" rel="noopener noreferrer">{criterion.documentTitle} <ExternalLink className="size-3" aria-hidden /></a> : criterion.documentTitle}
          {criterion.section ? ` · ${criterion.section}` : ""} · versão {criterion.documentVersion}
        </p>
      </div>
    </article>
  )
}

/** O efeito do produto no ponto, em linguagem simples (montado pelo sistema a partir da fotografia da análise). */
function ProductNote({ applicability }: { applicability: NonNullable<Criterion["productApplicability"]> }) {
  const products = applicability.products.length > 0 ? applicability.products.join(", ") : null
  const text = applicability.effect === "SUSPENDED"
    ? `Regra ${products ? `de ${products}` : "que depende do produto"}: sem avaliação — ${applicability.reason ?? "o produto do pedido não ficou estabelecido"}. Não conta como falha nem como acerto.`
    : applicability.effect === "OTHER_PRODUCT"
      ? `Regra ${products ? `de ${products}` : "de outro produto"}: não se aplica ao produto deste pedido.`
      : `Vale para ${products ?? "o produto"} — produto do pedido estabelecido pela gravação.`
  return <p className="rounded-md border border-dashed px-3 py-1.5 text-xs text-muted-foreground" data-testid="criterion-product-note">{text}</p>
}

/** Texto longo do sistema (o caminho e o porquê) recolhido em algumas linhas, com "mostrar tudo". */
function ClampedText({ text, lines = 4 }: { text: string; lines?: number }) {
  const [open, setOpen] = useState(false)
  const long = text.length > 280
  return (
    <div className="space-y-1">
      <p className={cn("leading-relaxed whitespace-pre-line", long && !open && (lines === 3 ? "line-clamp-3" : "line-clamp-4"))}>{text}</p>
      {long ? <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setOpen((value) => !value)}>{open ? "Mostrar menos" : "Mostrar tudo"}</Button> : null}
    </div>
  )
}

/**
 * O caminho seguido, como o sistema o registrou ("Etapas verificadas na conversa, em ordem: “X” — cumprida; “Y” — não cumprida.")
 * vira uma lista na ordem da conversa — só leitura do texto montado pelo próprio sistema; fora desse formato, o texto como veio.
 */
const PATH_PREFIX = "Etapas verificadas na conversa, em ordem: "
function pathStepsOf(text: string): { title: string; outcome: string; tone: "deviation" | "met" | "neutral" }[] | null {
  if (!text.startsWith(PATH_PREFIX)) return null
  const steps = text.slice(PATH_PREFIX.length).replace(/\.$/, "").split(/; (?=“)/)
  const parsed = steps.map((step) => /^“([\s\S]+?)” — ([\s\S]+)$/.exec(step))
  if (parsed.some((match) => !match)) return null
  return parsed.map((match) => {
    const outcome = match![2]!
    const tone = outcome.startsWith("não cumprida") || outcome.startsWith("cumprida em parte") ? "deviation" : outcome.startsWith("cumprida") ? "met" : "neutral"
    return { title: match![1]!, outcome, tone }
  })
}

function PathTaken({ text }: { text: string }) {
  const steps = pathStepsOf(text)
  if (!steps) return <ClampedText text={text} />
  return (
    <ol className="space-y-1.5">
      {steps.map((step, index) => (
        <li key={`${index}-${step.title}`} className="flex gap-2">
          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: step.tone === "deviation" ? OUTCOME_CHART_CONFIG.deviations.color : step.tone === "met" ? OUTCOME_CHART_CONFIG.met.color : "var(--muted-foreground)" }} aria-hidden />
          <span className="min-w-0"><span className="font-medium">{step.title}</span> <span className="text-muted-foreground">— {step.outcome}</span></span>
        </li>
      ))}
    </ol>
  )
}

function ScenarioView({ detail }: { detail: AssessmentDetail }) {
  const { scenario } = detail
  const both = Boolean(scenario.correctPath && scenario.pathTaken)
  return (
    <div className="@container space-y-4 text-sm">
      {detail.productIdentification ? <ProductIdentificationView identification={detail.productIdentification} /> : null}
      <section className="space-y-1 rounded-lg bg-muted/50 p-3">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Necessidade do cliente</h3>
        <p className="leading-relaxed">{scenario.customerNeed}</p>
      </section>
      <div className={cn("grid gap-3", both && "@2xl:grid-cols-2")}>
        {scenario.correctPath ? (
          <section className="space-y-1 rounded-lg border p-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">O que o procedimento pede</h3>
            <ClampedText text={scenario.correctPath} />
          </section>
        ) : null}
        {scenario.pathTaken ? (
          <section className="space-y-2 rounded-lg border p-3">
            <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">O que foi feito, na ordem da conversa</h3>
            <PathTaken text={scenario.pathTaken} />
          </section>
        ) : null}
      </div>
      {scenario.pathRationale ? (
        <section className="space-y-1">
          <h3 className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Leitura do caminho
            <Badge variant={detail.pathAssessment === "INCORRECT" ? "destructive" : "outline"} className="normal-case tracking-normal">{PATH_LABELS[detail.pathAssessment] ?? detail.pathAssessment}</Badge>
          </h3>
          <ClampedText text={scenario.pathRationale} lines={3} />
        </section>
      ) : null}
      {detail.procedure ? (
        <p className="text-xs text-muted-foreground">
          Procedimento aplicado: <span className="font-medium text-foreground/80">{detail.procedure.title}</span> (versão {detail.procedure.version}{detail.procedure.perspective === "CURRENT_RULE_REEVALUATION" ? " — regra atual; não havia versão vigente na data da chamada" : ""})
        </p>
      ) : null}
      {detail.limitations.length > 0 ? (
        <section className="space-y-1">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Limites desta análise</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">{detail.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </section>
      ) : null}
    </div>
  )
}

/**
 * `PRODUCT_APPLICABILITY_V1` — o que foi identificado em cada pedido da chamada, com o que sustentou (ou não) a identificação, e os
 * pontos que ficaram sem avaliação por depender de um produto não estabelecido. Tudo vem do registro gravado na análise.
 */
function ProductIdentificationView({ identification }: { identification: NonNullable<AssessmentDetail["productIdentification"]> }) {
  const suspended = identification.rules.filter((rule) => rule.effect === "SUSPENDED")
  const otherProduct = identification.rules.filter((rule) => rule.effect === "OTHER_PRODUCT")
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="Produto do atendimento" data-testid="product-identification">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Produto do atendimento</h3>
      {identification.requests.map((request) => (
        <div key={request.ref} className="space-y-1.5">
          <p className="font-medium">{request.label}</p>
          <p className="text-xs text-muted-foreground">Pedido: {request.summary}{request.object.description ? ` · ${request.object.description}` : ""}{request.reviewConfirmed === false ? " · a segunda leitura não confirmou" : ""}</p>
          {request.evidence.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {request.evidence.map((entry, index) => (
                <li key={`${entry.reader}-${entry.turn ?? entry.metadata}-${index}`} className="text-muted-foreground">
                  <span className="font-medium text-foreground/80">{entry.kind}</span>
                  {entry.turn ? ` · ${speakerLabel(entry.speaker)} · ${entry.turn}` : ""}
                  {entry.metadata ? ` · ${entry.metadata}` : ""}
                  {entry.quote ? <>: <span className="italic">“{entry.quote}”</span></> : null}
                  {entry.criterion ? ` · indício “${entry.criterion.title}” (versão ${entry.criterion.version}${entry.criterion.conclusive ? ", confirma o produto sob condição" : ", apenas sugere"})` : ""}
                  {` — ${entry.roleLabel}`}
                  {entry.reason ? ` (${entry.reason})` : ""}
                  {entry.reader === "REVIEW" ? " · segunda leitura" : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {request.limitations.length > 0 ? <ul className="list-disc pl-5 text-xs text-muted-foreground">{request.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul> : null}
        </div>
      ))}
      {suspended.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Ficaram sem avaliação por depender do produto ({suspended.length})</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">{suspended.map((rule) => <li key={rule.lineHandle}>{rule.title}{rule.products.length > 0 ? ` — vale para ${rule.products.join(", ")}` : ""}{rule.reason ? `: ${rule.reason}` : ""}</li>)}</ul>
        </div>
      ) : null}
      {otherProduct.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs font-medium">Regras de outro produto, que não se aplicam ({otherProduct.length})</p>
          <ul className="list-disc pl-5 text-xs text-muted-foreground">{otherProduct.map((rule) => <li key={rule.lineHandle}>{rule.title}{rule.products.length > 0 ? ` — ${rule.products.join(", ")}` : ""}</li>)}</ul>
        </div>
      ) : null}
    </section>
  )
}

/**
 * Transcrição como uma conversa: cliente à esquerda, atendimento à direita, eventos no centro. As falas citadas em algum ponto
 * levam a marca da situação do ponto; a fala pedida (clique numa citação) vem centralizada e destacada.
 */
function TranscriptView({ detail, highlightTurn }: { detail: AssessmentDetail; highlightTurn: string | null }) {
  const turnRefs = useRef(new Map<string, HTMLLIElement>())
  const citations = useMemo(() => {
    const byTurn = new Map<string, Criterion[]>()
    for (const criterion of detail.criteria) {
      for (const quote of criterion.evidence) byTurn.set(quote.turn, [...(byTurn.get(quote.turn) ?? []), criterion])
    }
    return byTurn
  }, [detail.criteria])

  useEffect(() => {
    if (!highlightTurn) return
    const frame = requestAnimationFrame(() => turnRefs.current.get(highlightTurn)?.scrollIntoView({ block: "center", behavior: "smooth" }))
    return () => cancelAnimationFrame(frame)
  }, [highlightTurn])

  if (detail.transcript.length === 0) return <p className="text-sm text-muted-foreground">Transcrição indisponível.</p>
  return (
    <div className="space-y-3">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><MessageSquareQuote className="size-3.5" aria-hidden />Falas marcadas foram citadas como evidência em algum ponto.</p>
      <ol className="space-y-2.5 rounded-lg bg-muted/30 p-3" aria-label="Transcrição da chamada">
        {detail.transcript.map((turn) => {
          const side = sideOf(turn.speaker)
          const cited = citations.get(turn.turn) ?? []
          const highlighted = turn.turn === highlightTurn
          const ref = (element: HTMLLIElement | null) => {
            if (element) turnRefs.current.set(turn.turn, element)
            else turnRefs.current.delete(turn.turn)
          }
          if (side === "event") {
            return (
              <li key={turn.turn} ref={ref} className={cn("text-center text-xs text-muted-foreground italic", highlighted && "rounded-md bg-primary/10 py-1")}>
                {turn.text} <span className="not-italic">· {turn.turn}</span>
              </li>
            )
          }
          return (
            <li key={turn.turn} ref={ref} className={cn("flex flex-col gap-1", side === "agent" ? "items-end" : "items-start")}>
              <span className="px-1 text-[11px] text-muted-foreground">{speakerLabel(turn.speaker)} · {turn.turn}{turn.timestamp ? ` · ${turn.timestamp}` : ""}</span>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                  side === "agent" ? "rounded-tr-sm bg-primary/10" : "rounded-tl-sm border bg-background",
                  cited.length > 0 && "ring-1 ring-primary/30",
                  highlighted && "ring-2 ring-primary",
                )}
              >
                {turn.text}
              </div>
              {cited.length > 0 ? (
                <span className={cn("flex max-w-[85%] flex-wrap gap-1", side === "agent" ? "justify-end" : "justify-start")}>
                  {cited.map((criterion) => {
                    const look = lookOf(criterion.status)
                    return (
                      <span key={criterion.id} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-[11px]" title={criterion.text}>
                        <look.icon className="size-3 shrink-0" style={look.color ? { color: look.color } : undefined} aria-hidden />
                        <span className="truncate">{STATUS_LABELS[criterion.status] ?? criterion.status}: {criterion.section ?? criterion.text}</span>
                      </span>
                    )
                  })}
                </span>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
