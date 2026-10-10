"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, Check, ChevronLeft, ChevronRight, FileText, Headset, Phone, Search, User, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "@/lib/utils"
import { useQaCompatibleInteractionsQuery, useQaInteractionDetailQuery } from "@/queries/admin/use-qa-lab-queries"
import type { QaInteraction, QaInteractionEvidence, QaPersonOption } from "@/schemas/admin/qa-lab.schema"
import { COMPARATOR_LABELS, type Comparator } from "@/schemas/admin/workflow-graph.schema"

import { formatDateTime, formatNumber } from "./qa-lab-format"
import { PersonPicker, type ThresholdHint } from "./test-data-pickers"

/** "07m18s" — duração de uma ligação (segundos), nunca confundida com a duração de uma request. */
export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return "—"
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  const pad = (n: number) => String(n).padStart(2, "0")
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h${pad(minutes % 60)}m${pad(rest)}s`
  return `${pad(minutes)}m${pad(rest)}s`
}

function flagValueText(value: boolean | number | null | undefined): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "boolean") return value ? "Verdadeiro" : "Falso"
  return formatNumber(value, 2)
}

const PERIOD_OPTIONS = [
  { value: "1", label: "Hoje" },
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "custom", label: "Período personalizado" },
  { value: "all", label: "Qualquer período" },
] as const
type PeriodOption = (typeof PERIOD_OPTIONS)[number]["value"]
const PAGE_SIZE = 10
const NUMERIC_COMPARATORS: Comparator[] = ["LT", "LTE", "EQUALS", "NOT_EQUALS", "GTE", "GT"]

function periodRange(option: PeriodOption, customFrom: string, customTo: string): { from?: string; to?: string } {
  if (option === "all") return {}
  if (option === "custom") {
    const from = customFrom ? new Date(customFrom) : null
    const to = customTo ? new Date(customTo) : null
    return {
      ...(from && !Number.isNaN(from.getTime()) ? { from: from.toISOString() } : {}),
      // Fim inclusivo: o dia escolhido inteiro.
      ...(to && !Number.isNaN(to.getTime()) ? { to: new Date(to.getTime() + 24 * 60 * 60 * 1000).toISOString() } : {}),
    }
  }
  if (option === "1") {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return { from: start.toISOString() }
  }
  return { from: new Date(Date.now() - Number(option) * 24 * 60 * 60 * 1000).toISOString() }
}

/**
 * Transcrição como está persistida (texto puro). A base NÃO tem speaker/timestamp
 * estruturados — o que existe é a convenção textual "Operador: …" / "Cliente: …" vinda da
 * ingestão. Só viramos "conversa" quando TODAS as falas trazem literalmente um desses dois
 * rótulos; qualquer outra coisa é texto integral. Nunca IA, nunca heurística por frase.
 */
export function transcriptLines(content: string): string[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  // Transcrições ingeridas numa única linha ("Operador: … Cliente: …"): quebra ANTES de cada
  // rótulo que vem após o fim de uma frase — só onde o rótulo já está literalmente no texto.
  if (lines.length > 1) return lines
  return content
    .trim()
    .split(/(?<=[.!?…])\s+(?=(?:Operador|Cliente):\s)/i)
    .filter((line) => line.trim().length > 0)
}

export type ConversationSpeaker = "OPERATOR" | "CUSTOMER"
export type ConversationTurn = { index: number; speaker: ConversationSpeaker; label: string; text: string }
export type ParsedTranscript = { kind: "chat"; turns: ConversationTurn[] } | { kind: "text"; content: string }

const SPEAKER_LABEL = /^(Operador|Cliente):\s+([\s\S]*)$/i

export function parseConversation(content: string): ParsedTranscript {
  const lines = transcriptLines(content)
  const turns: ConversationTurn[] = []
  for (const line of lines) {
    const match = SPEAKER_LABEL.exec(line.trim())
    if (!match) return { kind: "text", content }
    const label = match[1]!.toLowerCase()
    turns.push({ index: turns.length, speaker: label === "operador" ? "OPERATOR" : "CUSTOMER", label: label === "operador" ? "Operador" : "Cliente", text: match[2]!.trim() })
  }
  if (turns.length === 0) return { kind: "text", content }
  return { kind: "chat", turns }
}

/** Trecho que a IA usou como evidência — vem de dado JÁ estruturado do runtime (Feedback de
 * monitoria: `evidenceFound`, cuja literalidade o backend valida contra a transcrição). */
export type TranscriptHighlight = { text: string; reason: string }

function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase()
}

/**
 * Associação determinística evidência → trecho: só substring exata (após normalização de
 * espaços e caixa). Sem similaridade, sem fuzzy — antes destacar nada do que a fala errada.
 * Devolve os segmentos do texto com os trechos marcados (na ordem original).
 */
export function matchHighlights(text: string, highlights: TranscriptHighlight[]): { text: string; highlight: TranscriptHighlight | null }[] {
  // Normaliza (espaços colapsados, minúsculas) mantendo, pra cada caractere normalizado, o índice
  // original — assim o recorte destacado é exatamente o texto persistido.
  let normalized = ""
  const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!
    if (/\s/.test(char)) {
      pendingSpace = normalized.length > 0
      continue
    }
    if (pendingSpace) {
      normalized += " "
      map.push(i - 1)
      pendingSpace = false
    }
    normalized += char.toLowerCase()
    map.push(i)
  }
  const found: { start: number; end: number; highlight: TranscriptHighlight }[] = []
  for (const highlight of highlights) {
    const needle = normalizeForMatch(highlight.text)
    if (!needle) continue
    let from = 0
    for (;;) {
      const at = normalized.indexOf(needle, from)
      if (at === -1) break
      const start = map[at]!
      const end = map[at + needle.length - 1]! + 1
      if (!found.some((item) => start < item.end && end > item.start)) found.push({ start, end, highlight })
      from = at + needle.length
    }
  }
  if (found.length === 0) return [{ text, highlight: null }]
  found.sort((a, b) => a.start - b.start)
  const segments: { text: string; highlight: TranscriptHighlight | null }[] = []
  let position = 0
  for (const item of found) {
    if (item.start > position) segments.push({ text: text.slice(position, item.start), highlight: null })
    segments.push({ text: text.slice(item.start, item.end), highlight: item.highlight })
    position = item.end
  }
  if (position < text.length) segments.push({ text: text.slice(position), highlight: null })
  return segments
}

function HighlightedText({ text, highlights }: { text: string; highlights: TranscriptHighlight[] }) {
  const segments = useMemo(() => matchHighlights(text, highlights), [text, highlights])
  return (
    <>
      {segments.map((segment, index) =>
        segment.highlight ? (
          <mark key={index} className="rounded-sm bg-amber-500/25 px-0.5 text-inherit ring-1 ring-amber-500/50" title={segment.highlight.reason}>
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  )
}

/**
 * A transcrição como conversa (Cliente à esquerda, Operador à direita, sempre com rótulo
 * textual — nunca só cor) ou, sem rótulos confiáveis, o texto integral. `highlights` (opcional)
 * marca os trechos que a IA usou como evidência, por associação determinística.
 */
export function ConversationView({ content, highlights = [], className }: { content: string; highlights?: TranscriptHighlight[]; className?: string }) {
  const parsed = useMemo(() => parseConversation(content), [content])
  if (parsed.kind === "text") {
    return (
      <div className={cn("space-y-2", className)} data-testid="transcript-text">
        <p className="text-xs text-muted-foreground">Esta transcrição não possui identificação estruturada dos participantes.</p>
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm leading-relaxed whitespace-pre-wrap" role="document" aria-label="Transcrição integral">
          <HighlightedText text={content} highlights={highlights} />
        </div>
      </div>
    )
  }
  return (
    <ol className={cn("space-y-3", className)} aria-label="Conversa da interação" data-testid="transcript-chat">
      {parsed.turns.map((turn) => {
        const isOperator = turn.speaker === "OPERATOR"
        const highlighted = highlights.length > 0 && matchHighlights(turn.text, highlights).some((segment) => segment.highlight !== null)
        return (
          <li key={turn.index} className={cn("flex", isOperator ? "justify-end" : "justify-start")} data-speaker={turn.speaker} data-highlighted={highlighted ? "true" : undefined}>
            <div className={cn("max-w-[85%] space-y-1", isOperator ? "items-end text-right" : "items-start")}>
              <p className={cn("flex items-center gap-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase", isOperator && "justify-end")}>
                {isOperator ? <Headset className="h-3 w-3" aria-hidden /> : <User className="h-3 w-3" aria-hidden />}
                {turn.label}
              </p>
              <div
                className={cn(
                  "rounded-2xl px-3 py-2 text-left text-sm leading-relaxed whitespace-pre-wrap",
                  isOperator ? "rounded-tr-sm bg-primary/10 text-foreground" : "rounded-tl-sm bg-muted text-foreground",
                  highlighted && "ring-1 ring-amber-500/60",
                )}
                title={highlighted ? "Trecho utilizado como evidência pelo Agent" : undefined}
              >
                <HighlightedText text={turn.text} highlights={highlights} />
              </div>
              {highlighted ? <p className={cn("text-[11px] text-amber-700 dark:text-amber-300", isOperator && "text-right")}>Trecho utilizado como evidência pelo Agent</p> : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Transcrição congelada num QA Run (session.inputContext) — o histórico mostra ESTA versão,
 * nunca a persistida atual (que pode ter mudado). */
export type FrozenTranscript = { content: string; checksum: string | null }

/**
 * Conversa de UMA interação (Dialog grande e centralizado, sem rota): cabeçalho compacto,
 * conversa com scroll interno, flags (a do gatilho destacada) e ações. Tudo leitura — zero IA,
 * zero reprocessamento de áudio. Reutilizado pelo Contexto do teste, pela evidência selecionada
 * e pelo resultado/histórico (com highlights derivados do resultado daquele run).
 */
export function InteractionConversationDialog({
  interactionId,
  onOpenChange,
  onUse,
  selected = false,
  requiresTranscript = false,
  requiredFlagLabel,
  highlights = [],
  frozenTranscript,
}: {
  interactionId: string | null
  onOpenChange: (open: boolean) => void
  onUse?: ((detail: { id: string; externalId: string }) => void) | undefined
  /** Já é a interação do teste — troca o botão de ação por um estado. */
  selected?: boolean
  /** O Workflow tem etapa de IA que usa a transcrição — avisa se ela não existir. */
  requiresTranscript?: boolean
  /** Flag do gatilho ("VOICE.rechamada") — destacada entre as flags da interação. */
  requiredFlagLabel?: string | undefined
  highlights?: TranscriptHighlight[]
  frozenTranscript?: FrozenTranscript | undefined
}) {
  const query = useQaInteractionDetailQuery(interactionId)
  const detail = query.data
  const missing = query.isError
  const transcriptContent = frozenTranscript?.content ?? detail?.transcript?.content ?? null
  const frozenDiffers = Boolean(frozenTranscript && detail?.transcript && frozenTranscript.checksum && detail.transcript.checksum !== frozenTranscript.checksum)
  const triggerFlag = detail?.flags.find((flag) => `${detail.channel}.${flag.name}` === requiredFlagLabel)
  return (
    <Dialog open={interactionId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Phone className="h-4 w-4" aria-hidden /> Interação{detail ? ` · ${formatDateTime(detail.startedAt)}` : ""}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1">
              {detail ? (
                <p className="text-sm text-foreground">
                  {detail.operatorName}
                  {detail.teamName ? <span className="text-muted-foreground"> · {detail.teamName}</span> : null} · {detail.channel} · {formatCallDuration(detail.durationSeconds)} · <span className="font-mono text-xs">{detail.externalId}</span>
                </p>
              ) : missing ? (
                <p className="text-sm">A interação original deste QA Run não está mais disponível.</p>
              ) : (
                <p className="text-sm">Carregando transcrição…</p>
              )}
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {requiredFlagLabel ? (
                  <Badge variant="default" className="gap-1">
                    <Zap className="h-3 w-3" aria-hidden /> {requiredFlagLabel}
                    {triggerFlag ? ` = ${flagValueText(triggerFlag.value)}` : ""}
                  </Badge>
                ) : null}
                <span>{transcriptContent ? "Transcrição disponível" : detail || frozenTranscript ? "Transcrição não disponível" : ""}</span>
                {frozenTranscript ? <span>· versão congelada neste QA Run{frozenDiffers ? " (o texto persistido mudou depois)" : ""}</span> : null}
                <span>· dados persistidos; nenhuma IA é chamada para exibir esta conversa</span>
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" tabIndex={0} aria-label="Conversa">
          {query.isLoading && !frozenTranscript ? (
            <div className="space-y-3" aria-live="polite">
              <Skeleton className="h-12 w-2/3" />
              <Skeleton className="ml-auto h-12 w-2/3" />
              <Skeleton className="h-12 w-1/2" />
            </div>
          ) : null}
          {transcriptContent ? (
            <ConversationView content={transcriptContent} highlights={highlights} />
          ) : detail || (missing && !frozenTranscript) ? (
            <div className="space-y-2">
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Transcrição não disponível.</p>
              {requiresTranscript && detail ? (
                <p className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  Este Workflow necessita de transcrição e esta interação não possui uma disponível. Ela ainda pode ser usada com &quot;Parar antes da IA&quot; ou &quot;Executar até um node&quot;.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {detail ? (
          <div className="border-t border-border px-5 py-3">
            <p className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <FileText className="h-3.5 w-3.5" aria-hidden /> Flags · motivo: {detail.reason}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {detail.flags.length === 0 ? <span className="text-xs text-muted-foreground">Nenhuma flag recebida para esta interação.</span> : null}
              {detail.flags.map((flag) => {
                const label = `${detail.channel}.${flag.name}`
                const required = requiredFlagLabel === label
                return (
                  <Badge key={flag.channelFlagId} variant={required ? "default" : "outline"} className="gap-1" title={`Recebida em ${formatDateTime(flag.receivedAt)}`}>
                    {required ? <Zap className="h-3 w-3" aria-hidden /> : null}
                    {label} = {flagValueText(flag.value)}
                    {required ? <span className="ml-1 rounded bg-background/30 px-1 text-[10px]">Trigger</span> : null}
                  </Badge>
                )
              })}
            </div>
          </div>
        ) : null}

        <DialogFooter className="border-t border-border px-5 py-3 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          {onUse && detail ? (
            selected ? (
              <Button type="button" variant="secondary" disabled className="gap-1">
                <Check className="h-4 w-4" aria-hidden /> Interação selecionada
              </Button>
            ) : (
              <Button type="button" onClick={() => onUse({ id: detail.id, externalId: detail.externalId })}>
                Usar esta interação no teste
              </Button>
            )
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Resumo compacto da evidência selecionada (no formulário) ou usada (no resultado/histórico). */
export function InteractionEvidenceSummary({
  evidence,
  flagLabel,
  onInspect,
  onReplace,
  highlightCount = 0,
}: {
  evidence: Pick<QaInteractionEvidence, "id" | "externalId" | "startedAt" | "channel" | "operatorName" | "durationSeconds" | "flag" | "hasTranscript" | "transcript" | "transcriptChangedSinceOriginalRun">
  /** null = gatilho Manual com interação (sem flag). */
  flagLabel: string | null
  onInspect: () => void
  onReplace?: (() => void) | undefined
  /** Trechos usados como evidência pela IA neste run (só informativo no botão). */
  highlightCount?: number
}) {
  const hasTranscript = evidence.transcript?.available ?? evidence.hasTranscript ?? false
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "Interação", value: <span className="font-mono text-xs">{evidence.externalId}</span> },
    { label: "Data", value: formatDateTime(evidence.startedAt) },
    ...(evidence.operatorName ? [{ label: "Operador", value: evidence.operatorName }] : []),
    { label: "Canal", value: evidence.channel },
    ...(flagLabel ? [{ label: "Flag", value: `${flagLabel}${evidence.flag ? ` = ${flagValueText(evidence.flag.value)}` : ""}` }] : [{ label: "Origem", value: "Interação escolhida (gatilho Manual)" }]),
    ...(evidence.durationSeconds !== undefined ? [{ label: "Duração", value: formatCallDuration(evidence.durationSeconds) }] : []),
    {
      label: "Transcrição",
      value: hasTranscript ? (
        <span>
          Disponível
          {evidence.transcript?.checksum ? <span className="ml-1 font-mono text-[10px] text-muted-foreground">{evidence.transcript.checksum}</span> : null}
          {evidence.transcriptChangedSinceOriginalRun ? <span className="ml-1 text-amber-700 dark:text-amber-300">· o texto persistido mudou desde o QA Run original; a versão original foi reutilizada</span> : null}
        </span>
      ) : (
        "Não disponível"
      ),
    },
  ]
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Evidência selecionada</p>
      <dl className="mt-2 grid grid-cols-[100px_1fr] gap-x-2 gap-y-0.5 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs font-medium text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onInspect}>
          {hasTranscript ? "Ver transcrição" : "Inspecionar evidência"}
          {highlightCount > 0 ? ` (${highlightCount} trecho${highlightCount > 1 ? "s" : ""} destacado${highlightCount > 1 ? "s" : ""})` : ""}
        </Button>
        {onReplace ? (
          <Button type="button" size="sm" variant="ghost" onClick={onReplace}>
            Trocar interação
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Contexto do teste pra Trigger por Flag de canal: 1. Colaborador → 2. Interações compatíveis
 * (abrir, ler a transcrição, escolher) → 3. Evidência selecionada. Sempre EXATAMENTE UMA
 * interação por QA Run — nunca "executar todas". A lista vem do backend já filtrada pelo que
 * realmente poderia disparar o Workflow (flag, canal, Abrangência, Filtro Populacional).
 */
export function InteractionEvidencePicker({
  workflowId,
  flagLabel,
  valueType,
  hint,
  requiresTranscript,
  operator,
  onOperatorChange,
  value,
  onChange,
}: {
  workflowId: string
  /** null = gatilho Manual com interação: qualquer interação do colaborador com transcrição (sem flag nem cenário). */
  flagLabel: string | null
  valueType: "BOOLEAN" | "NUMERIC"
  /** Condition sobre o valor do gatilho, se houver — habilita o cenário Atende/Não atende. */
  hint: ThresholdHint | null
  requiresTranscript: boolean
  operator: QaPersonOption | null
  onOperatorChange: (person: QaPersonOption | null) => void
  value: QaInteraction | null
  onChange: (interaction: QaInteraction | null) => void
}) {
  const [period, setPeriod] = useState<PeriodOption>("7")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [search, setSearch] = useState("")
  const debouncedSearch = useDebouncedValue(search, 250)
  const [scenario, setScenario] = useState<"ALL" | "MATCH" | "NO_MATCH">("ALL")
  const [comparator, setComparator] = useState<Comparator>(hint?.comparator ?? "LT")
  const [threshold, setThreshold] = useState<string>(hint?.thresholdNumeric !== undefined && hint?.thresholdNumeric !== null ? String(hint.thresholdNumeric) : "")
  const [booleanValue, setBooleanValue] = useState<"true" | "false">(hint?.thresholdBoolean === false ? "false" : "true")
  const [offset, setOffset] = useState(0)
  const [openId, setOpenId] = useState<string | null>(null)

  const params = useMemo(() => {
    if (!operator) return null
    const filtering = scenario !== "ALL" && (valueType === "BOOLEAN" || threshold !== "")
    return {
      operatorId: operator.id,
      ...periodRange(period, customFrom, customTo),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filtering
        ? valueType === "BOOLEAN"
          ? { comparator: "EQUALS", thresholdBoolean: booleanValue === "true", negate: scenario === "NO_MATCH" }
          : { comparator, thresholdNumeric: Number(threshold), negate: scenario === "NO_MATCH" }
        : {}),
      limit: PAGE_SIZE,
      offset,
    }
  }, [operator, period, customFrom, customTo, debouncedSearch, scenario, valueType, comparator, threshold, booleanValue, offset])
  const query = useQaCompatibleInteractionsQuery(workflowId, params)
  const rows = query.data?.rows ?? []

  function resetPaging() {
    setOffset(0)
  }

  function selectFromDetail(detail: { id: string }) {
    const row = rows.find((item) => item.id === detail.id)
    if (row) onChange(row)
    setOpenId(null)
  }

  return (
    <div className="space-y-4">
      {/* 1. Colaborador — só quem é elegível pra este Workflow (Abrangência + Filtro Populacional). */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">1. Colaborador</p>
          <PersonPicker
            workflowId={workflowId}
            value={operator?.id ?? null}
            onChange={(person) => {
              onOperatorChange(person)
              onChange(null)
              resetPaging()
            }}
            emptyHint="Nenhum colaborador elegível para este Workflow (Abrangência/Filtro Populacional)."
          />
        </div>

        {/* 2. Interações compatíveis */}
        <div className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">2. Interação</p>
          {!operator ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Selecione um colaborador para localizar interações compatíveis.</p>
          ) : value ? (
            <InteractionEvidenceSummary
              evidence={{ id: value.id, externalId: value.externalId, startedAt: value.startedAt, channel: value.channel, operatorName: value.operatorName, durationSeconds: value.durationSeconds, flag: value.flagName ? { name: value.flagName, valueType, value: value.value } : null, hasTranscript: value.hasTranscript }}
              flagLabel={flagLabel}
              onInspect={() => setOpenId(value.id)}
              onReplace={() => onChange(null)}
            />
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap items-end gap-2">
                <div className="space-y-1.5">
                  <Label htmlFor="qa-interaction-period">Período</Label>
                  <Select
                    value={period}
                    onValueChange={(next) => {
                      setPeriod(next as PeriodOption)
                      resetPaging()
                    }}
                  >
                    <SelectTrigger id="qa-interaction-period" className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERIOD_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {period === "custom" ? (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="qa-interaction-from">De</Label>
                      <Input id="qa-interaction-from" type="date" className="w-40" value={customFrom} onChange={(event) => (setCustomFrom(event.target.value), resetPaging())} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="qa-interaction-to">Até</Label>
                      <Input id="qa-interaction-to" type="date" className="w-40" value={customTo} onChange={(event) => (setCustomTo(event.target.value), resetPaging())} />
                    </div>
                  </>
                ) : null}
                <div className="space-y-1.5">
                  <Label htmlFor="qa-interaction-search">Identificador</Label>
                  <div className="relative">
                    <Search className="absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input id="qa-interaction-search" className="w-44 pl-8" placeholder="Protocolo / id externo" value={search} onChange={(event) => (setSearch(event.target.value), resetPaging())} />
                  </div>
                </div>
                {hint ? (
                  <div className="space-y-1.5">
                    <Label>Cenário da Condition</Label>
                    <div className="flex gap-1" role="group" aria-label="Cenário da Condition sobre o valor do gatilho">
                      {(["ALL", "MATCH", "NO_MATCH"] as const).map((option) => (
                        <Button key={option} type="button" size="sm" variant={scenario === option ? "default" : "outline"} onClick={() => (setScenario(option), resetPaging())}>
                          {option === "MATCH" ? "Atende" : option === "NO_MATCH" ? "Não atende" : "Todas"}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : null}
                {hint && scenario !== "ALL" ? (
                  valueType === "BOOLEAN" ? (
                    <div className="space-y-1.5">
                      <Label htmlFor="qa-interaction-bool">Valor</Label>
                      <Select value={booleanValue} onValueChange={(next) => setBooleanValue(next as "true" | "false")}>
                        <SelectTrigger id="qa-interaction-bool" className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="true">Verdadeiro</SelectItem>
                          <SelectItem value="false">Falso</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="qa-interaction-comparator">Comparador</Label>
                        <Select value={comparator} onValueChange={(next) => setComparator(next as Comparator)}>
                          <SelectTrigger id="qa-interaction-comparator" className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {NUMERIC_COMPARATORS.map((option) => (
                              <SelectItem key={option} value={option}>
                                {COMPARATOR_LABELS[option]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="qa-interaction-threshold">Valor</Label>
                        <Input id="qa-interaction-threshold" type="number" className="w-24" value={threshold} onChange={(event) => setThreshold(event.target.value)} />
                      </div>
                    </>
                  )
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {query.isLoading
                  ? "Buscando interações…"
                  : query.isError
                    ? (query.error as Error).message
                    : query.data
                      ? `${rows.length}${query.data.hasMore ? "+" : ""} interação(ões) ${query.data.flag ? `compatível(is) com ${query.data.flag.label}` : "do colaborador com transcrição"}${offset > 0 ? ` · página ${offset / PAGE_SIZE + 1}` : ""} — consulta determinística, sem IA.`
                      : ""}
              </p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border">
                <ul className="divide-y divide-border">
                  {rows.map((row) => (
                    <li key={row.id} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          {formatDateTime(row.startedAt)} <span className="font-normal text-muted-foreground">· {formatCallDuration(row.durationSeconds)}</span>
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {row.channel} · {row.flagName ? `${row.flagName}: ${flagValueText(row.value)} · ` : ""}{row.reason} · <span className="font-mono">{row.externalId}</span>
                        </p>
                        <p className={cn("text-xs", row.hasTranscript ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground")}>{row.hasTranscript ? "Transcrição disponível" : "Sem transcrição"}</p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                        <Button type="button" size="sm" variant="outline" onClick={() => setOpenId(row.id)} aria-label={`Ver detalhes da interação ${row.externalId}`}>
                          Ver detalhes
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(row)} aria-label={`Selecionar a interação ${row.externalId}`}>
                          Selecionar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
                {query.data && rows.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    {query.data.flag ? `Nenhuma interação com a Flag ${query.data.flag.label} foi encontrada no período selecionado.` : "Nenhuma interação com transcrição deste colaborador no período selecionado."}
                  </p>
                ) : null}
              </div>
              {query.data && (offset > 0 || query.data.hasMore) ? (
                <div className="flex items-center justify-end gap-1">
                  <Button type="button" size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                    <ChevronLeft className="h-4 w-4" /> Anteriores
                  </Button>
                  <Button type="button" size="sm" variant="ghost" disabled={!query.data.hasMore} onClick={() => setOffset(offset + PAGE_SIZE)}>
                    Próximas <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <InteractionConversationDialog
        interactionId={openId}
        onOpenChange={(open) => !open && setOpenId(null)}
        onUse={selectFromDetail}
        selected={Boolean(value && openId === value.id)}
        requiresTranscript={requiresTranscript}
        requiredFlagLabel={flagLabel ?? undefined}
      />
    </div>
  )
}
