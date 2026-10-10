"use client"

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { AI_CALL_ROLE_LABELS, CACHE_MODE_LABELS, CONTEXT_BREAKDOWN_LABELS, GATING_STATUS_LABELS, LLM_PHASE_LABELS, NEED_STATUS_LABELS, SUFFICIENCY_STATUS_LABELS, UNIVERSE_RELATIONSHIP_LABELS, type CostEstimate, type LlmContextBreakdown, type QaRunSummary, type QaRunTelemetry, type QaTokenTotals, EVIDENCE_SOURCE_LABELS, SAMPLING_STRATEGY_LABELS } from "@/schemas/admin/qa-lab.schema"
import { REPRESENTATIVENESS_LABELS } from "@/schemas/admin/investigation.schema"

import { formatDateTime, formatDuration, formatNumber } from "./qa-lab-format"

/**
 * TELEMETRIA DE EFICIÊNCIA no QA Lab (V1.1). Tudo aqui vem de `trace.telemetry`, calculado por
 * código no backend a partir do que o provider informou por request. Campo null = "Não informado"
 * — nunca estimamos cached/reasoning. Runs anteriores (sem telemetria) mostram só o que existe.
 */
export const NOT_INFORMED = "Não informado"

/** Dataset de diagnóstico do run — discreto: versão + fingerprint resumido (hash inteiro no title). */
function DatasetLine({ dataset }: { dataset: QaRunTelemetry["dataset"] | null }) {
  const status = dataset?.status ?? "NOT_INFORMED"
  const text =
    status === "APPLIED" ? `Dataset ${dataset!.version} · fingerprint ${dataset!.shortFingerprint}`
    : status === "NOT_APPLICABLE" ? "Dataset: não aplicável (colaborador fora da massa de diagnóstico)"
    : `Dataset: ${NOT_INFORMED}`
  return (
    <p className="text-[11px] text-muted-foreground" data-testid="qa-dataset" title={dataset?.fingerprint ?? undefined}>
      {text}
    </p>
  )
}

export function formatTokens(value: number | null | undefined): string {
  return value === null || value === undefined ? NOT_INFORMED : formatNumber(value)
}

const TOOL_OUTCOME_LABELS: Record<NonNullable<NonNullable<QaRunTelemetry["toolBudget"]>["outcome"]>, string> = {
  ANSWERED: "Respondida",
  BUDGET_EXHAUSTED: "Orçamento esgotado",
  NO_TOOLS: "Sem ferramentas",
  TIMEOUT: "Tempo esgotado",
}

export function toolBudgetLabel(toolBudget: QaRunTelemetry["toolBudget"]): string {
  if (!toolBudget) return "Sem investigação"
  // V1.2: o orçamento é das Tools escolhidas pelo Agent; o preflight aparece à parte.
  const agentCalls = toolBudget.investigation ?? null
  const base = agentCalls !== null ? `${agentCalls} de ${toolBudget.budget ?? "—"}${toolBudget.preflight ? ` (+${toolBudget.preflight} preflight)` : ""}` : toolBudget.budget !== null ? `${toolBudget.executed} de ${toolBudget.budget}` : `${toolBudget.executed}`
  return toolBudget.outcome ? `${base} · ${TOOL_OUTCOME_LABELS[toolBudget.outcome]}` : base
}

export function ToolBudgetBadge({ toolBudget }: { toolBudget: QaRunTelemetry["toolBudget"] | undefined }) {
  if (toolBudget === undefined) return <span className="text-xs text-muted-foreground">Tool Budget: {NOT_INFORMED.toLowerCase()}</span>
  if (toolBudget === null) return <span className="text-xs text-muted-foreground">—</span>
  const exhausted = toolBudget.outcome === "BUDGET_EXHAUSTED" || toolBudget.outcome === "TIMEOUT"
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", exhausted && "border-amber-500/50 text-amber-700 dark:text-amber-400")} data-testid="qa-tool-budget">
      {toolBudgetLabel(toolBudget)}
    </Badge>
  )
}

export function TokenBudgetBadge({ tokenBudget }: { tokenBudget: QaRunTelemetry["tokenBudget"] | undefined }) {
  if (tokenBudget === undefined) return <span className="text-xs text-muted-foreground">Token Budget: {NOT_INFORMED.toLowerCase()}</span>
  if (tokenBudget === null) return <span className="text-xs text-muted-foreground">—</span>
  if (tokenBudget.status === "NOT_INFORMED") return <span className="text-xs text-muted-foreground">{NOT_INFORMED}</span>
  const warning = tokenBudget.status === "WARNING"
  const title = warning
    ? `Acima do limiar de aviso (${tokenBudget.exceeded.map((key) => `${key}: ${formatNumber(tokenBudget.thresholds[key])}`).join(", ")})`
    : `Dentro dos limiares de aviso (total ${formatTokens(tokenBudget.thresholds.total)})`
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", warning ? "border-amber-500/50 text-amber-700 dark:text-amber-400" : "border-emerald-500/40 text-emerald-700 dark:text-emerald-400")} title={title} data-testid="qa-token-budget">
      {warning ? "Alerta de tokens" : "OK"}
    </Badge>
  )
}

/** Delta entre este run e a referência: absoluto e percentual (negativo = economia). */
export function deltaOf(current: number | null, before: number | null): { absolute: number; percent: number | null } | null {
  if (current === null || before === null) return null
  const absolute = current - before
  return { absolute, percent: before > 0 ? Math.round((absolute / before) * 1000) / 10 : null }
}

function DeltaText({ current, before, unit }: { current: number | null; before: number | null; unit?: "ms" | "cost" }) {
  const delta = deltaOf(current, before)
  if (!delta) return <span className="text-muted-foreground">{NOT_INFORMED}</span>
  const format = (value: number) => (unit === "ms" ? formatDuration(Math.abs(value)) : unit === "cost" ? formatNumber(Math.abs(value), 6) : formatNumber(Math.abs(value)))
  const Icon = delta.absolute < 0 ? ArrowDownRight : delta.absolute > 0 ? ArrowUpRight : Minus
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", delta.absolute < 0 ? "text-emerald-700 dark:text-emerald-400" : delta.absolute > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
      <Icon className="size-3.5" />
      {delta.absolute < 0 ? "−" : delta.absolute > 0 ? "+" : ""}
      {format(delta.absolute)}
      {delta.percent !== null ? ` (${delta.percent > 0 ? "+" : ""}${formatNumber(delta.percent, 1)}%)` : ""}
    </span>
  )
}

/** "−28.400 tokens (−35,4%) vs execução anterior" — só quando há referência compatível e os dois totais existem. */
export function tokensSavedText(telemetry: QaRunTelemetry | null | undefined): string | null {
  const delta = telemetry?.reference ? deltaOf(telemetry.tokens.total, telemetry.reference.tokens.total) : null
  if (!delta) return null
  if (delta.absolute === 0) return "Mesmo total de tokens da execução anterior"
  const percent = delta.percent !== null ? ` (${delta.percent > 0 ? "+" : ""}${formatNumber(delta.percent, 1)}%)` : ""
  return delta.absolute < 0 ? `${formatNumber(-delta.absolute)} tokens economizados${percent} vs execução anterior` : `${formatNumber(delta.absolute)} tokens a mais${percent} vs execução anterior`
}

/** Linha de telemetria de uma execução na listagem (tabela). */
export const TELEMETRY_COLUMNS = ["Requests IA", "Preflight", "Tools Agent", "Tools total", "Rodadas", "Input", "Cached", "Uncached", "Output", "Reasoning", "Total", "Duração", "Tool Budget", "Token Budget"] as const

export function telemetryCells(run: Pick<QaRunSummary, "aiCalls" | "inputTokens" | "outputTokens" | "totalTokens" | "durationMs" | "telemetry">): { key: (typeof TELEMETRY_COLUMNS)[number]; node: React.ReactNode }[] {
  const telemetry = run.telemetry ?? null
  const tokens: QaTokenTotals = telemetry?.tokens ?? { input: run.inputTokens, cached: null, uncached: null, output: run.outputTokens, reasoning: null, total: run.totalTokens }
  return [
    { key: "Requests IA", node: telemetry?.requests ?? run.aiCalls },
    { key: "Preflight", node: telemetry ? (telemetry.toolBudget ? (telemetry.toolBudget.preflight ?? NOT_INFORMED) : "—") : NOT_INFORMED },
    { key: "Tools Agent", node: telemetry ? (telemetry.toolBudget ? (telemetry.toolBudget.investigation ?? NOT_INFORMED) : "—") : NOT_INFORMED },
    { key: "Tools total", node: telemetry ? (telemetry.toolBudget ? telemetry.toolBudget.executed : "—") : NOT_INFORMED },
    { key: "Rodadas", node: telemetry ? (telemetry.toolBudget?.planningRounds ?? "—") : NOT_INFORMED },
    { key: "Input", node: formatTokens(tokens.input) },
    { key: "Cached", node: formatTokens(tokens.cached) },
    { key: "Uncached", node: formatTokens(tokens.uncached) },
    { key: "Output", node: formatTokens(tokens.output) },
    { key: "Reasoning", node: formatTokens(tokens.reasoning) },
    { key: "Total", node: formatTokens(tokens.total) },
    { key: "Duração", node: formatDuration(run.durationMs) },
    { key: "Tool Budget", node: <ToolBudgetBadge toolBudget={telemetry ? telemetry.toolBudget : undefined} /> },
    { key: "Token Budget", node: <TokenBudgetBadge tokenBudget={telemetry ? telemetry.tokenBudget : undefined} /> },
  ]
}

function TotalsGrid({ tokens, requests, toolBudget, durationMs, technicalIds, cost }: { tokens: QaTokenTotals; requests: number; toolBudget: QaRunTelemetry["toolBudget"]; durationMs: number; technicalIds?: number | null; cost?: CostEstimate | null }) {
  const items: { label: string; value: React.ReactNode }[] = [
    { label: "Requests de IA", value: requests },
    { label: "Preflight calls", value: toolBudget ? (toolBudget.preflight ?? NOT_INFORMED) : "—" },
    { label: "Tool calls (Agent)", value: toolBudget ? (toolBudget.investigation ?? NOT_INFORMED) : "—" },
    { label: "Tool calls (total)", value: toolBudget ? `${toolBudget.executed}${toolBudget.cached ? ` (+${toolBudget.cached} cache)` : ""}${toolBudget.rejected ? ` · ${toolBudget.rejected} recusada(s)` : ""}` : "—" },
    { label: "Planning rounds", value: toolBudget?.planningRounds ?? "—" },
    { label: "IDs técnicos no prompt", value: technicalIds === undefined ? "—" : technicalIds === null ? NOT_INFORMED : technicalIds },
    { label: "Input", value: formatTokens(tokens.input) },
    { label: "Cached input", value: formatTokens(tokens.cached) },
    { label: "Uncached input", value: formatTokens(tokens.uncached) },
    { label: "Output", value: formatTokens(tokens.output) },
    { label: "Reasoning", value: formatTokens(tokens.reasoning) },
    { label: "Total", value: formatTokens(tokens.total) },
    { label: "Duração", value: formatDuration(durationMs) },
    ...(cost !== undefined ? [{ label: "Custo estimado", value: formatCost(cost) }] : []),
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-5" data-testid="qa-telemetry-totals">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{item.label}</dt>
          <dd className="truncate font-medium tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export const PRICE_NOT_CONFIGURED = "Preço não configurado"

/** Custo ESTIMADO (pricing configurado) — nunca fatura real; sem pricing, "Preço não configurado". */
export function formatCost(cost: CostEstimate | null | undefined): string {
  if (!cost || cost.status === "NOT_CONFIGURED") return PRICE_NOT_CONFIGURED
  return `${cost.currency} ${cost.totalEstimatedCost.toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`
}

const costTotal = (cost: CostEstimate | null | undefined): number | null => (cost && cost.status === "ESTIMATED_PROVIDER_COST" ? cost.totalEstimatedCost : null)

/** Contexto lógico enviado ao modelo, por categoria (caracteres) — prova do Zero-ID/compactação. */
function ContextBreakdownList({ breakdown }: { breakdown: LlmContextBreakdown }) {
  const keys = (Object.keys(CONTEXT_BREAKDOWN_LABELS) as (keyof LlmContextBreakdown)[]).filter((key) => typeof breakdown[key] === "number" && (key !== "dynamicPromptChars" || (breakdown[key] ?? 0) > 0))
  const total = keys.reduce((sum, key) => sum + (breakdown[key] ?? 0), 0)
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4" data-testid="qa-context-breakdown">
      {keys.map((key) => (
        <div key={key}>
          <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{CONTEXT_BREAKDOWN_LABELS[key]}</dt>
          <dd className="tabular-nums">
            {formatNumber(breakdown[key] ?? 0)} chars{total > 0 ? ` (${formatNumber(((breakdown[key] ?? 0) / total) * 100, 0)}%)` : ""}
          </dd>
        </div>
      ))}
    </dl>
  )
}

const percent = (value: number | null | undefined) => (value === null || value === undefined ? "Não determinado" : `${formatNumber(value * 100, 0)}%`)

/** CACHE · QUALIDADE · COBERTURA (V1.3 — §46/§8): só o que a telemetria informou; ausente = run anterior. */
function CacheQualitySections({ telemetry }: { telemetry: QaRunTelemetry }) {
  const cache = telemetry.cache ?? null
  const quality = telemetry.quality ?? null
  const coverage = telemetry.coverage ?? null
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="qa-telemetry-v13">
      <section className="space-y-1 rounded-md border border-border p-3" data-testid="qa-telemetry-cache">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cache</h4>
        {cache ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Modo</dt><dd className="font-medium">{CACHE_MODE_LABELS[cache.mode]}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Tokens em cache</dt><dd className="tabular-nums">{formatTokens(cache.cachedTokens)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Hit rate</dt><dd className="tabular-nums">{cache.hitRate === null ? NOT_INFORMED : `${formatNumber(cache.hitRate * 100, 1)}%`}</dd></div>
            {cache.explicitRequests > 0 ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Requests com cache explícito</dt><dd className="tabular-nums">{cache.explicitRequests}</dd></div> : null}
            {cache.cacheKeyVersions.length > 0 ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Versão do prefixo</dt><dd className="font-mono text-[11px]">{cache.cacheKeyVersions.join(", ")}</dd></div> : null}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">{NOT_INFORMED} nesta execução.</p>
        )}
      </section>
      <section className="space-y-1 rounded-md border border-border p-3" data-testid="qa-telemetry-quality">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Qualidade</h4>
        {quality ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Gating</dt><dd className={cn("font-medium", quality.gatingStatus === "FALLBACK" || quality.gatingStatus === "DISCARDED" ? "text-amber-700 dark:text-amber-400" : "")}>{GATING_STATUS_LABELS[quality.gatingStatus]}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Envelope de evidência</dt><dd>{quality.envelopePresent === null ? NOT_INFORMED : quality.envelopePresent ? "Presente" : "Ausente"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Correction retry</dt><dd>{quality.correctionAttempted ? `${quality.correctionSucceeded ? "1 (aceita)" : "1 (não resolveu)"}${quality.correctionCategories?.length ? ` · ${quality.correctionCategories.join(", ")}` : ""}${quality.persistentCategories?.length ? ` → persistiu: ${quality.persistentCategories.join(", ")}` : ""}` : "Nenhum"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Fallback factual</dt><dd>{quality.fallbackUsed ? `Sim${quality.fallbackReason === "ENVELOPE_MISSING" ? " (sem envelope)" : quality.fallbackReason === "CLAIMS_REJECTED" ? " (claims rejeitadas)" : ""}` : "Não"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Claims rejeitadas</dt><dd className="tabular-nums">{quality.rejectedClaims}</dd></div>
            {quality.candidates ? (
              <div className="flex justify-between gap-2" data-testid="qa-claim-candidates"><dt className="text-muted-foreground">Candidatos de afirmação</dt><dd className="text-right">
                {quality.candidates.available} candidato(s) · {quality.candidates.selected} selecionado(s) · {quality.candidates.delivered} entregue(s)
                {quality.candidates.textPolarityMismatch > 0 ? ` · ${quality.candidates.textPolarityMismatch} texto(s) com polaridade incompatível` : ""}
                {quality.candidates.textScopeMismatch > 0 ? ` · ${quality.candidates.textScopeMismatch} texto(s) acima do escopo` : ""}
                {quality.candidates.swapRejected > 0 ? ` · ${quality.candidates.swapRejected} troca(s) de candidato recusada(s)` : ""}
                {quality.candidates.duplicateSelection > 0 ? ` · ${quality.candidates.duplicateSelection} seleção(ões) duplicada(s)` : ""}
              </dd></div>
            ) : null}
            {quality.claims ? (
              <div className="flex justify-between gap-2" data-testid="qa-claim-salvage"><dt className="text-muted-foreground">Afirmações</dt><dd className="text-right">
                {quality.claims.proposed} proposta(s) · {quality.claims.proposed - quality.claims.dropped} aceita(s){quality.claims.corrected > 0 ? ` (${quality.claims.corrected} após correção)` : ""} · {quality.claims.dropped} descartada(s)
                {quality.claims.preservedAfterSiblingFailure > 0 ? ` · ${quality.claims.preservedAfterSiblingFailure} preservada(s) apesar de irmã inválida` : ""}
                {quality.claims.recommendationsDropped > 0 ? ` · ${quality.claims.recommendationsDropped} recomendação(ões) descartada(s)` : ""}
                {quality.salvage === "FULL_FALLBACK" ? " · resposta inteira substituída" : quality.salvage === "PARTIAL" ? " · salvamento parcial" : ""}
              </dd></div>
            ) : null}
            {quality.markerStatus ? <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Marker parse status</dt><dd className="font-mono text-[11px]">{quality.markerStatus}{quality.firstAttemptMarkerStatus && quality.firstAttemptMarkerStatus !== quality.markerStatus ? ` (1ª tentativa: ${quality.firstAttemptMarkerStatus})` : ""}</dd></div> : null}
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Escopos das afirmações</dt><dd className="text-right">{quality.claimScopes.length > 0 ? quality.claimScopes.map((item) => `${item.count}× ${item.label}`).join(" · ") : "Nenhuma afirmação comportamental"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Limitações declaradas</dt><dd className="tabular-nums">{quality.limitations}</dd></div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Sem gating nesta execução (sem investigação).</p>
        )}
      </section>
      <section className="space-y-1 rounded-md border border-border p-3" data-testid="qa-telemetry-coverage">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Cobertura da evidência</h4>
        {coverage ? (
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Interações disponíveis</dt><dd className="tabular-nums">{coverage.recordedInteractions ?? NOT_INFORMED}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Interações analisadas</dt><dd className="tabular-nums">{coverage.analyzedInteractions ?? NOT_INFORMED}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Cobertura das registradas</dt><dd className="tabular-nums">{percent(coverage.recordedCoverage)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Universo operacional</dt><dd className="tabular-nums">{coverage.operationalUniverse === null ? "Não determinado" : formatNumber(coverage.operationalUniverse)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Cobertura operacional</dt><dd className="tabular-nums">{percent(coverage.operationalCoverage)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Relação entre universos</dt><dd>{coverage.universeRelationship ? UNIVERSE_RELATIONSHIP_LABELS[coverage.universeRelationship] : "Não determinado"}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Representatividade</dt><dd>{coverage.representativeness ? REPRESENTATIVENESS_LABELS[coverage.representativeness] : NOT_INFORMED}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-muted-foreground">Claim scope permitido</dt><dd>{coverage.allowedScopeLabel ?? "Nenhum (sem evidência de interação)"}</dd></div>
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">Sem investigação com interações nesta execução.</p>
        )}
      </section>
    </div>
  )
}

/** INVESTIGATION OUTCOME (V1.3.1 — §38/39): objetivo, escopo exigido, motivo da parada, suficiência, necessidades, hipóteses, STOP proposto × aceito. */
function SufficiencySection({ sufficiency }: { sufficiency: NonNullable<QaRunTelemetry["sufficiency"]> }) {
  const sim = (value: boolean | null) => (value === null ? NOT_INFORMED : value ? "sim" : "não")
  return (
    <section className="space-y-2 rounded-md border border-border p-3" data-testid="qa-telemetry-sufficiency">
      <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Investigation outcome</h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Objetivo</dt><dd className="font-medium">{sufficiency.objectiveLabel ?? NOT_INFORMED}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Claim scope exigido</dt><dd>{sufficiency.requiredScope ?? "Quantitativo (nenhum)"}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Stop reason</dt><dd className={cn("font-medium", sufficiency.stopReason && sufficiency.stopReason !== "ANSWER_SUFFICIENT" ? "text-amber-700 dark:text-amber-400" : "")}>{sufficiency.stopReasonLabel ?? NOT_INFORMED}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Suficiência</dt><dd>{sufficiency.status ? (SUFFICIENCY_STATUS_LABELS[sufficiency.status] ?? sufficiency.status) : NOT_INFORMED}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Evidence needs</dt><dd className="tabular-nums">Satisfeitas {sufficiency.needs.satisfied} · Abertas {sufficiency.needs.open} · Bloqueadas {sufficiency.needs.blocked}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Hipóteses materiais</dt><dd className="tabular-nums">Sustentadas {sufficiency.hypotheses.supported} · Refutadas {sufficiency.hypotheses.refuted} · Abertas/bloqueadas {sufficiency.hypotheses.open + sufficiency.hypotheses.blocked}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Evidência conflitante</dt><dd>{sufficiency.contradictoryEvidence ? "sim" : "não"}</dd></div>
        <div><dt className="text-[11px] tracking-wide text-muted-foreground uppercase">Mais evidência mudaria a conclusão</dt><dd>{sim(sufficiency.additionalEvidenceCouldChangeConclusion)}</dd></div>
      </dl>
      <p className="text-xs" data-testid="qa-stop-decision">
        <span className="font-medium">Stop proposed:</span> {sim(sufficiency.stopProposed)} · <span className="font-medium">Stop accepted:</span> {sim(sufficiency.stopAccepted)}
        {sufficiency.rejections.length > 0 ? (
          <span className="block text-amber-700 dark:text-amber-400">
            {sufficiency.rejections.map((item) => `Rodada ${item.round}: ${item.reasons.join("; ")}`).join(" · ")}
          </span>
        ) : null}
      </p>
      {sufficiency.needs.items.length > 0 ? (
        <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="qa-evidence-needs">
          {sufficiency.needs.items.map((need) => (
            <li key={need.id}>
              <span className="font-mono">{need.id}</span> · {NEED_STATUS_LABELS[need.status] ?? need.status}
              {need.blockedBy ? ` (${need.blockedBy === "NO_DATA" ? "dados não existem" : "sem ferramenta autorizada"})` : ""} · {need.question}
              {need.material ? "" : " (não material)"}
            </li>
          ))}
        </ul>
      ) : null}
      {sufficiency.criticalFacts.length > 0 ? <p className="text-[11px] text-muted-foreground">Fatos críticos à decisão: {sufficiency.criticalFacts.map((fact) => `${fact.ref} (${fact.label})`).join(", ")}</p> : null}
      {sufficiency.stopRejectedAtFinalRound ? (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="qa-stop-final-round">
          Stop rejected at final round: sim · lacunas restantes {(sufficiency.remainingMaterialNeeds ?? []).join(", ") || "—"} · ferramentas disponíveis {(sufficiency.candidateToolsAvailable ?? []).join(", ") || "—"}
        </p>
      ) : null}
      {sufficiency.evidenceSources ? (
        <p className="text-xs text-muted-foreground" data-testid="qa-evidence-sources">
          <span className="font-medium">Fontes de evidência:</span>{" "}
          {sufficiency.evidenceSources.available.map((source) => `${EVIDENCE_SOURCE_LABELS[source] ?? source} ${sufficiency.evidenceSources!.used.includes(source) ? "✓" : "—"}`).join(" · ")}
          {sufficiency.samplingStrategy ? ` · Amostragem: ${SAMPLING_STRATEGY_LABELS[sufficiency.samplingStrategy] ?? sufficiency.samplingStrategy}` : ""}
          {sufficiency.periodIntent ? ` · Período: ${sufficiency.periodIntent === "PERIOD_EVOLUTION" ? "padrão e evolução (janela longa)" : sufficiency.periodIntent === "PERIOD_PATTERN" ? "padrão no período" : "uma interação"}` : ""}
        </p>
      ) : null}
      {sufficiency.temporal ? (
        <p className="text-[11px] text-muted-foreground" data-testid="qa-temporal-comparison" title={Object.entries(sufficiency.temporal.rejectionReasons).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}: ${count}`).join(" · ") || "nenhuma rejeição temporal"}>
          Comparação temporal: {sufficiency.temporal.availableBuckets} bloco(s) disponível(is) · {sufficiency.temporal.analyzedBuckets} analisado(s)
          {sufficiency.temporal.comparedBuckets.length > 0 ? ` · ${sufficiency.temporal.comparedBuckets.join(" × ")} comparados` : ""}
          {` · ${sufficiency.temporal.temporalComparisonStatus === "NOT_REQUIRED" ? "não exigida" : sufficiency.temporal.temporalComparisonStatus === "DIFFERENCE_OBSERVED" ? "Diferença sustentada" : sufficiency.temporal.temporalComparisonStatus === "SAMPLE_DIFFERENCE_ONLY" ? "Diferença só na amostra" : sufficiency.temporal.temporalComparisonStatus === "NO_DIFFERENCE_SUPPORTED" ? "Nenhuma diferença sustentada" : sufficiency.temporal.temporalComparisonStatus === "INSUFFICIENT_EVIDENCE" ? "Comparação insuficiente" : "Exigida, não realizada"}`}
          {sufficiency.temporal.temporalClaimsProposed > 0 ? ` · claims temporais ${sufficiency.temporal.temporalClaimsAccepted}/${sufficiency.temporal.temporalClaimsProposed} aceitas` : ""}
          {sufficiency.temporal.conclusion && sufficiency.temporal.conclusion.kind !== "NOT_COMPARED" ? (
            <span data-testid="qa-temporal-conclusion" title={sufficiency.temporal.conclusion.safeMeaning}>
              {` · Conclusão autorizada: ${sufficiency.temporal.conclusion.kind === "SUPPORTED_RELATION" ? `relação sustentada (${sufficiency.temporal.conclusion.allowedRelations.join(", ")})` : sufficiency.temporal.conclusion.kind === "NO_DIFFERENCE_SUPPORTED" ? "nenhuma diferença sustentada (não é estabilidade)" : sufficiency.temporal.conclusion.kind === "SAMPLE_DIFFERENCE_ONLY" ? "diferença só na amostra" : "insuficiente"}`}
            </span>
          ) : null}
        </p>
      ) : null}
      {sufficiency.semantic ? (
        <p className="text-[11px] text-muted-foreground" data-testid="qa-semantic-analysis" title={`patterns por suporte: ${Object.entries(sufficiency.semantic.patternsBySupport).filter(([, count]) => count > 0).map(([level, count]) => `${level}: ${count}`).join(" · ") || "nenhum"} · por tipo: ${Object.entries(sufficiency.semantic.patternsByKind).filter(([, count]) => count > 0).map(([kind, count]) => `${kind}: ${count}`).join(" · ") || "nenhum"}${sufficiency.semantic.framesNotReturned > 0 ? ` · ${sufficiency.semantic.framesNotReturned} frame(s) não devolvido(s) pelo modelo (criados vazios)` : ""}${sufficiency.semantic.contractViolations > 0 ? ` · ${sufficiency.semantic.contractViolations} chamada(s) sem frames (contrato pulado)` : ""}`}>
          Análise semântica: {sufficiency.semantic.semanticFramesCreated} frame(s) · {sufficiency.semantic.interactionsWithFindings} com finding · {sufficiency.semantic.strengthFindingsCount} força(s) · {sufficiency.semantic.riskFindingsCount} risco(s) · {sufficiency.semantic.unresolvedNeedsCount + sufficiency.semantic.partialNeedsCount} necessidade(s) não resolvida(s)/parcial(is) · {sufficiency.semantic.proceduralQuestionsCount} questão(ões) procedimental(is) · {sufficiency.semantic.crossInteractionPatternsCount} pattern(s) entre interações
          {sufficiency.semantic.patternsBySupport.EMPLOYEE_PATTERN_SUPPORTED ? ` (${sufficiency.semantic.patternsBySupport.EMPLOYEE_PATTERN_SUPPORTED} com suporte de padrão do colaborador)` : ""}
          {sufficiency.semantic.patternsByScope && Object.values(sufficiency.semantic.patternsByScope).some((count) => count > 0) ? ` · escopo de suporte: ${Object.entries(sufficiency.semantic.patternsByScope).filter(([, count]) => count > 0).map(([scope, count]) => `${count}× ${scope}`).join(" · ")}` : ""}
          {typeof sufficiency.semantic.phaseBPromotedFindings === "number" ? ` · findings: ${sufficiency.semantic.phaseAFindings ?? 0} na extração + ${sufficiency.semantic.phaseBPromotedFindings} promovido(s) na síntese${(sufficiency.semantic.promotionRejectedCount ?? 0) > 0 ? ` (${sufficiency.semantic.promotionRejectedCount} promoção(ões) recusada(s))` : ""}${(sufficiency.semantic.interactionFrictionFindingsCount ?? 0) > 0 ? ` · ${sufficiency.semantic.interactionFrictionFindingsCount} atrito(s) sem atribuição` : ""}` : ""}
          {typeof sufficiency.semantic.answerCompletenessDowngraded === "number" ? ` · interpretação: ${sufficiency.semantic.answerCompletenessDowngraded} resposta(s) rebaixada(s) por componente · ${sufficiency.semantic.needStatusDowngraded ?? 0} necessidade(s) rebaixada(s) de resolvida${(sufficiency.semantic.frictionDowngradedByCompleteAnswer ?? 0) > 0 ? ` · ${sufficiency.semantic.frictionDowngradedByCompleteAnswer} atrito(s) sem materialidade` : ""}${(sufficiency.semantic.contradictionDowngradedByCorrection ?? 0) > 0 ? ` · ${sufficiency.semantic.contradictionDowngradedByCorrection} correção(ões) explícita(s) (não é contradição)` : ""}` : ""}
        </p>
      ) : null}
      {sufficiency.semantic?.frameContract ? (
        <p className="text-[11px] text-muted-foreground" data-testid="qa-frame-contract" title={`frames esperados: ${sufficiency.semantic.frameContract.expectedFrames} · ausentes antes do retry: ${sufficiency.semantic.frameContract.initialMissingFrames} · duplicados: ${sufficiency.semantic.frameContract.duplicateFrames} (${sufficiency.semantic.frameContract.duplicateFrameObservationsDropped} observação(ões) descartada(s)) · refs inesperados: ${sufficiency.semantic.frameContract.unexpectedFrames}${sufficiency.semantic.frameContract.exampleRefEchoed > 0 ? ` (${sufficiency.semantic.frameContract.exampleRefEchoed} eco do placeholder de exemplo)` : ""} · vazios: ${sufficiency.semantic.frameContract.emptyFrames}`}>
          Contrato de frames: {sufficiency.semantic.frameContract.initialComplete}/{sufficiency.semantic.frameContract.calls} completo(s) na 1ª resposta · {sufficiency.semantic.frameContract.finalComplete}/{sufficiency.semantic.frameContract.calls} após retry ({sufficiency.semantic.frameContract.retries} retry) · ausentes {sufficiency.semantic.frameContract.initialMissingFrames} → {sufficiency.semantic.frameContract.finalMissingFrames} · duplicados {sufficiency.semantic.frameContract.duplicateFrames} · inesperados {sufficiency.semantic.frameContract.unexpectedFrames} · vazios {sufficiency.semantic.frameContract.emptyFrames}
        </p>
      ) : null}
      {sufficiency.outcomeAttribution ? (
        <p className="text-[11px] text-muted-foreground" data-testid="qa-outcome-attribution" title={`pontes aceitas: ${Object.entries(sufficiency.outcomeAttribution.bridges).filter(([, count]) => count > 0).map(([bridge, count]) => `${bridge}: ${count}`).join(" · ") || "nenhuma"} · sidecar ${sufficiency.outcomeAttribution.sidecarStatus} · patterns por dono: ${Object.entries(sufficiency.outcomeAttribution.patternsByOwnership).filter(([, count]) => count > 0).map(([owner, count]) => `${owner}: ${count}`).join(" · ") || "nenhum"}`}>
          Necessidades: {sufficiency.outcomeAttribution.needsOpen} em aberto de {sufficiency.outcomeAttribution.needsTotal}
          {Object.entries(sufficiency.outcomeAttribution.byAttribution).filter(([, count]) => count > 0).length > 0 ? ` — ${Object.entries(sufficiency.outcomeAttribution.byAttribution).filter(([, count]) => count > 0).map(([kind, count]) => `${count}× ${kind}`).join(" · ")}` : " — sem atribuição determinada"}
          {` · ${sufficiency.outcomeAttribution.findingsAgentAttributed} ligada(s) à conduta do operador · ${sufficiency.outcomeAttribution.findingsNeutralized} mantida(s) como resultado da interação`}
          {sufficiency.outcomeAttribution.agentAttributionRejected > 0 ? ` · ${sufficiency.outcomeAttribution.agentAttributionRejected} atribuição(ões) ao operador recusada(s) por falta de ponte` : ""}
          {sufficiency.outcomeAttribution.patternsScopeCappedByOwnership > 0 ? ` · ${sufficiency.outcomeAttribution.patternsScopeCappedByOwnership} pattern(s) com teto reduzido por não serem de conduta do operador` : ""}
        </p>
      ) : null}
      {sufficiency.procedural ? (
        <p className="text-[11px] text-muted-foreground" data-testid="qa-procedural-evaluation" title={`trechos da base disponíveis: ${sufficiency.procedural.knowledgeExcerptsAvailable} (${sufficiency.procedural.knowledgeSource}) · regras declaradas ${sufficiency.procedural.rulesDeclared}, recusadas ${sufficiency.procedural.rulesRejected} (trecho não literal, documento inexistente ou assunto vazio)`}>
          Avaliação procedimental: {sufficiency.procedural.assertionsDeclared} afirmação(ões) normativa(s) · {sufficiency.procedural.rulesVerified} regra(s) da base com trecho literal · {sufficiency.procedural.evaluations} comparação(ões)
          {Object.entries(sufficiency.procedural.byStatus).filter(([, count]) => count > 0).length > 0 ? ` — ${Object.entries(sufficiency.procedural.byStatus).filter(([, count]) => count > 0).map(([status, count]) => `${count}× ${status}`).join(" · ")}` : " — nenhuma"}
          {` · cobertura ${sufficiency.procedural.coverage === "COMPLETE" ? "COMPLETA" : "PARCIAL (só os pontos verificados)"}`}
        </p>
      ) : null}
      {(sufficiency.interactionAnalysis ?? []).length > 0 ? (
        <ul className="text-[11px] text-muted-foreground" data-testid="qa-interaction-analysis">
          {(sufficiency.interactionAnalysis ?? []).map((item, index) => (
            <li key={index}>
              Análise de interações: {item.analyzedTranscriptCount} analisada(s){item.recordedUniverseCount !== null ? ` de ${item.recordedUniverseCount} registrada(s)` : " (universo não determinado)"} · {item.findings} achado(s) · {item.verifiedExcerpts} trecho(s) verificado(s)
              {item.temporalBuckets !== null && item.temporalBuckets > 1 ? ` · blocos temporais ${item.temporalBucketsCovered}/${item.temporalBuckets}` : ""}
              {item.evidenceVerification ? (
                <span data-testid="qa-evidence-verification" title={Object.entries(item.evidenceVerification.rejectionReasons).filter(([, count]) => count > 0).map(([reason, count]) => `${reason}: ${count}`).join(" · ") || "nenhum descarte"}>
                  {` · Evidências semânticas: ${item.evidenceVerification.candidateExcerptCount} candidata(s) · ${item.evidenceVerification.verifiedExcerptCount} validada(s) · ${item.evidenceVerification.rejectedExcerptCount} descartada(s) · achados ${item.evidenceVerification.findingsAfterVerification}/${item.evidenceVerification.findingsBeforeVerification}`}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/** Painel "Tokens e eficiência" do detalhe: total, antes/depois, por fase e por request. */
export function RunTelemetryPanel({ run }: { run: Pick<QaRunSummary, "aiCalls" | "inputTokens" | "outputTokens" | "totalTokens" | "durationMs"> & { telemetry: QaRunTelemetry | null | undefined } }) {
  const telemetry = run.telemetry ?? null
  if (!telemetry) {
    return (
      <div className="space-y-3" data-testid="qa-telemetry-panel">
        <p className="text-sm text-muted-foreground">Execução anterior à telemetria de eficiência: só os totais registrados estão disponíveis; fase, cache, reasoning e Tool calls ficam como &quot;{NOT_INFORMED}&quot;.</p>
        <TotalsGrid tokens={{ input: run.inputTokens, cached: null, uncached: null, output: run.outputTokens, reasoning: null, total: run.totalTokens }} requests={run.aiCalls} toolBudget={null} durationMs={run.durationMs} />
      </div>
    )
  }
  const reference = telemetry.reference
  const comparison = telemetry.comparison ?? null
  const datasetChanged = comparison?.status === "DATASET_CHANGED"
  const saved = datasetChanged ? null : tokensSavedText(telemetry)
  return (
    <div className="space-y-5" data-testid="qa-telemetry-panel">
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Total da execução</h4>
          <ToolBudgetBadge toolBudget={telemetry.toolBudget} />
          <TokenBudgetBadge tokenBudget={telemetry.tokenBudget} />
          {telemetry.cacheHitRate !== null ? <Badge variant="secondary">cache do provider: {formatNumber(telemetry.cacheHitRate * 100, 1)}%</Badge> : null}
          {telemetry.toolBudget?.parallelWaves ? <Badge variant="secondary">{telemetry.toolBudget.parallelWaves} onda(s) em paralelo</Badge> : null}
          {telemetry.toolBudget?.preflight ? <Badge variant="secondary">{telemetry.toolBudget.preflight} no preflight</Badge> : null}
        </div>
        <TotalsGrid tokens={telemetry.tokens} requests={telemetry.requests} toolBudget={telemetry.toolBudget} durationMs={run.durationMs} technicalIds={telemetry.technicalIdsInPrompts ?? null} cost={telemetry.cost ? telemetry.cost.total : null} />
        <DatasetLine dataset={telemetry.dataset ?? null} />
        {telemetry.cost && telemetry.cost.total.status === "ESTIMATED_PROVIDER_COST" ? (
          <p className="text-[11px] text-muted-foreground" data-testid="qa-cost-by-phase">
            Custo estimado (ESTIMATED_PROVIDER_COST, nunca fatura real) por fase: {telemetry.cost.byPhase.map((item) => `${LLM_PHASE_LABELS[item.phase]} ${formatCost(item.cost)}`).join(" · ")}
          </p>
        ) : null}
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Contexto</h4>
        {telemetry.contextBreakdown ? <ContextBreakdownList breakdown={telemetry.contextBreakdown} /> : <p className="text-xs text-muted-foreground">{NOT_INFORMED}</p>}
        {telemetry.promptComponents && telemetry.promptComponents.length > 0 ? (
          <p className="text-[11px] text-muted-foreground" data-testid="qa-prompt-components">
            Componentes do prompt (somados nas requests): {telemetry.promptComponents.map((item) => `${item.id} ${formatNumber(item.chars)} chars${item.static ? "" : " (dinâmico)"}`).join(" · ")}
          </p>
        ) : null}
        <CacheQualitySections telemetry={telemetry} />
        {telemetry.sufficiency ? <SufficiencySection sufficiency={telemetry.sufficiency} /> : null}
        {telemetry.tokenBudget?.status === "WARNING" ? (
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Token Budget: acima do limiar de aviso em {telemetry.tokenBudget.exceeded.join(", ")} (limiares: total {formatTokens(telemetry.tokenBudget.thresholds.total)}, input {formatTokens(telemetry.tokenBudget.thresholds.input)}, output {formatTokens(telemetry.tokenBudget.thresholds.output)}). É observabilidade — a execução não é interrompida.
          </p>
        ) : null}
      </section>

      {reference ? (
        <section className="space-y-2" data-testid="qa-telemetry-comparison">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Antes × depois (referência: execução compatível de {formatDateTime(reference.createdAt)})</h4>
          {comparison ? (
            <p className={cn("text-xs", datasetChanged ? "text-amber-700 dark:text-amber-400" : comparison.status === "UNKNOWN" ? "text-muted-foreground" : "text-emerald-700 dark:text-emerald-400")} data-testid="qa-benchmark-compatibility">
              {comparison.message}
              {comparison.status === "UNKNOWN" && (comparison.referenceDataset === null || comparison.referenceDataset === undefined) ? ` Dataset da referência: ${NOT_INFORMED}.` : null}
            </p>
          ) : null}
          {saved ? <p className="text-sm font-medium">{saved}</p> : null}
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Métrica</TableHead>
                  <TableHead className="text-right">Antes</TableHead>
                  <TableHead className="text-right">Depois</TableHead>
                  <TableHead className="text-right">Diferença</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    { label: "Total de tokens", before: reference.tokens.total, after: telemetry.tokens.total },
                    { label: "Input", before: reference.tokens.input, after: telemetry.tokens.input },
                    { label: "Cached input", before: reference.tokens.cached, after: telemetry.tokens.cached },
                    { label: "Output", before: reference.tokens.output, after: telemetry.tokens.output },
                    { label: "Requests de IA", before: reference.requests, after: telemetry.requests },
                    { label: "Tool calls", before: reference.toolCalls, after: telemetry.toolBudget?.executed ?? null },
                    { label: "Planning rounds", before: reference.planningRounds ?? null, after: telemetry.toolBudget?.planningRounds ?? null },
                    { label: "Uncached input", before: reference.tokens.input !== null && reference.tokens.cached !== null ? Math.max(0, reference.tokens.input - reference.tokens.cached) : reference.tokens.cached === null ? reference.tokens.input : null, after: telemetry.tokens.uncached ?? (telemetry.tokens.cached === null ? telemetry.tokens.input : null) },
                    { label: "Prompt estático (chars)", before: reference.staticPromptChars ?? null, after: telemetry.contextBreakdown?.staticPromptChars ?? null },
                    { label: "Schemas de ferramentas (chars)", before: reference.toolSchemaChars ?? null, after: telemetry.contextBreakdown?.toolSchemaChars ?? null },
                    { label: "Custo estimado", before: costTotal(reference.cost), after: costTotal(telemetry.cost?.total), unit: "cost" as const },
                    { label: "Duração", before: reference.durationMs, after: run.durationMs, unit: "ms" as const },
                  ] as { label: string; before: number | null; after: number | null; unit?: "ms" | "cost" }[]
                ).map((row) => (
                  <TableRow key={row.label}>
                    <TableCell className="text-sm">{row.label}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{row.unit === "ms" ? (row.before === null ? NOT_INFORMED : formatDuration(row.before)) : row.unit === "cost" ? (row.before === null ? PRICE_NOT_CONFIGURED : formatNumber(row.before, 6)) : formatTokens(row.before)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{row.unit === "ms" ? (row.after === null ? NOT_INFORMED : formatDuration(row.after)) : row.unit === "cost" ? (row.after === null ? PRICE_NOT_CONFIGURED : formatNumber(row.after, 6)) : formatTokens(row.after)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {datasetChanged ? <span className="text-muted-foreground">Dataset diferente</span> : <DeltaText current={row.after} before={row.before} unit={row.unit} />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">Sem execução de referência compatível (mesmo recurso e mesmo colaborador/interação) para comparar antes × depois.</p>
      )}

      <section className="space-y-2" data-testid="qa-telemetry-phases">
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Por fase</h4>
        <div className="overflow-x-auto rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fase</TableHead>
                <TableHead className="text-right">Requests</TableHead>
                <TableHead className="text-right">Tools pedidas</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Cached</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Reasoning</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Duração</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {telemetry.phases.map((phase) => (
                <TableRow key={phase.phase}>
                  <TableCell className="text-sm">{LLM_PHASE_LABELS[phase.phase]}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{phase.requests}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{phase.toolCallsRequested}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatTokens(phase.tokens.input)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatTokens(phase.tokens.cached)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatTokens(phase.tokens.output)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatTokens(phase.tokens.reasoning)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatTokens(phase.tokens.total)}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">{formatDuration(phase.durationMs)}</TableCell>
                </TableRow>
              ))}
              {telemetry.phases.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-sm text-muted-foreground">
                    Nenhuma request ao modelo nesta execução.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">Preflight nunca chama o modelo (só Tools determinísticas) — por isso não aparece como fase de request.</p>
      </section>

      {telemetry.perRequest ? (
        <section className="space-y-2" data-testid="qa-telemetry-requests">
          <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Por request</h4>
          <div className="overflow-x-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Fase</TableHead>
                  <TableHead>Provedor · Modelo · Tier</TableHead>
                  <TableHead>Rota</TableHead>
                  <TableHead className="text-right">Input</TableHead>
                  <TableHead className="text-right">Cached</TableHead>
                  <TableHead className="text-right">Output</TableHead>
                  <TableHead className="text-right">Reasoning</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Custo est.</TableHead>
                  <TableHead className="text-right">Duração</TableHead>
                  <TableHead>Tools solicitadas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {telemetry.perRequest.map((request) => (
                  <TableRow key={request.sequence}>
                    <TableCell className="text-sm tabular-nums">{request.sequence}</TableCell>
                    <TableCell className="text-sm">
                      {request.phase ? LLM_PHASE_LABELS[request.phase] : NOT_INFORMED}
                      <span className="block text-[11px] text-muted-foreground">
                        {AI_CALL_ROLE_LABELS[request.role]}
                        {request.agentName ? ` — ${request.agentName}` : ""}
                      </span>
                      {request.classification ? <span className="block font-mono text-[10px] text-muted-foreground">{request.classification.purpose} · {request.classification.source}</span> : null}
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono text-[11px]">{request.model}</span>
                      <span className="block text-[11px] text-muted-foreground">
                        {request.route?.provider ?? request.provider}
                        {request.route ? ` · ${request.route.tier}` : ""}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64 text-[11px] text-muted-foreground">
                      {request.route ? (
                        <>
                          <span className="block" title={request.route.reason}>{request.route.reason}</span>
                          {request.route.escalated ? <Badge variant="outline" className="mt-0.5 mr-1 text-[10px]">escalado</Badge> : null}
                          {request.route.fallback ? <Badge variant="outline" className="mt-0.5 text-[10px]">fallback</Badge> : null}
                        </>
                      ) : (
                        NOT_INFORMED
                      )}
                      {request.technicalIds !== null && request.technicalIds !== undefined ? <span className="block">IDs técnicos: {request.technicalIds}</span> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatTokens(request.tokens.input)}
                      {request.promptBreakdown ? (
                        <span className="block text-[11px] text-muted-foreground" title="Composição estimada do prompt em caracteres (o número de tokens é o do provider)">
                          sys {formatNumber(request.promptBreakdown.systemPromptChars)} · tools {formatNumber(request.promptBreakdown.toolSchemaChars)} ({request.promptBreakdown.declaredTools}) · entrada {formatNumber(request.promptBreakdown.inputChars)} chars
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {formatTokens(request.tokens.cached)}
                      {request.cache && request.cache.mode !== "NONE" ? <span className="block text-[10px] text-muted-foreground">{request.cache.mode === "EXPLICIT" ? "explícito" : "implícito"}</span> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatTokens(request.tokens.output)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatTokens(request.tokens.reasoning)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatTokens(request.tokens.total)}</TableCell>
                    <TableCell className="text-right text-[11px] tabular-nums">{request.cost === undefined ? "—" : formatCost(request.cost)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{formatDuration(request.durationMs)}</TableCell>
                    <TableCell className="text-xs">{request.toolCalls.length > 0 ? request.toolCalls.join(", ") : <span className="text-muted-foreground">—</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  )
}
