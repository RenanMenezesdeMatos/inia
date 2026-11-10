"use client"

import { useEffect, useId, useState, type ReactNode } from "react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { CheckCircle2, Circle, KeyRound, Plug, Route, Server, Sparkles, Wallet } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { ListErrorState } from "@/components/admin/shared/list/list-states"
import { cn } from "@/lib/utils"
import { formatAiDateTime, formatCount, formatDayLabel, formatLatency, formatMoney, formatRate, formatTokens, moneyEntries, NO_KNOWN_COST_LABEL, NOT_REPORTED_LABEL } from "@/lib/admin/ai-format"
import { useAiModelsQuery, useAiOverviewQuery, useAiProvidersQuery, useAiUseCasesQuery } from "@/queries/admin/use-ai-management-queries"
import type { AiUsageParams } from "@/services/admin/ai-management-service"
import {
  AI_USAGE_PERIOD_LABELS,
  AI_USAGE_PERIODS,
  type AiBudget,
  type AiOnboarding,
  type AiUsagePeriod,
  type BreakdownRow,
  type ConnectionHealth,
  type LegacyEnvironment,
  type UsageDashboard,
  type UsageMetrics,
} from "@/schemas/admin/ai-management.schema"

import { HealthBadge, MoneyList } from "./ai-shared"
import { DateRangePicker } from "@/components/ui/date-picker"

const ALL = "ALL"

/** Datas do filtro personalizado (dia local) → instantes ISO que o backend espera. */
function customRange(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to || from > to) return null
  return { from: new Date(`${from}T00:00:00`).toISOString(), to: new Date(`${to}T23:59:59.999`).toISOString() }
}

export function OverviewTab({ onOpenTab }: { onOpenTab: (tab: string) => void }) {
  const [period, setPeriod] = useState<AiUsagePeriod>("30D")
  const [customFrom, setCustomFrom] = useState("")
  const [customTo, setCustomTo] = useState("")
  const [providerKey, setProviderKey] = useState(ALL)
  const [modelId, setModelId] = useState(ALL)
  const [useCase, setUseCase] = useState(ALL)

  const range = period === "CUSTOM" ? customRange(customFrom, customTo) : null
  const params: AiUsageParams = {
    period,
    ...(range ?? {}),
    ...(providerKey !== ALL ? { providerKey } : {}),
    ...(modelId !== ALL ? { modelId } : {}),
    ...(useCase !== ALL ? { useCase } : {}),
  }
  const overviewQuery = useAiOverviewQuery(params, period !== "CUSTOM" || range !== null)
  const providersQuery = useAiProvidersQuery()
  const modelsQuery = useAiModelsQuery()
  const useCasesQuery = useAiUseCasesQuery()

  const data = overviewQuery.data
  const showOnboarding = data ? !data.onboarding.hasConnection || !data.onboarding.hasActivePolicy : false

  return (
    <div className="space-y-5">
      {data && showOnboarding ? <OnboardingCard onboarding={data.onboarding} onOpenTab={onOpenTab} /> : null}

      <div className="flex flex-wrap items-end gap-3" aria-label="Filtros do painel">
        <FilterSelect label="Período" value={period} onChange={(value) => setPeriod(value as AiUsagePeriod)} options={AI_USAGE_PERIODS.map((value) => ({ value, label: AI_USAGE_PERIOD_LABELS[value] }))} />
        {period === "CUSTOM" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="ai-usage-period">De – até</Label>
              <DateRangePicker id="ai-usage-period" value={{ from: customFrom || undefined, to: customTo || undefined }} onChange={(range) => (setCustomFrom(range.from ?? ""), setCustomTo(range.to ?? ""))} />
            </div>
          </>
        ) : null}
        <FilterSelect label="Provider" value={providerKey} onChange={setProviderKey} options={[{ value: ALL, label: "Todos" }, ...(providersQuery.data ?? []).map((provider) => ({ value: provider.key, label: provider.name }))]} />
        <FilterSelect label="Modelo" value={modelId} onChange={setModelId} options={[{ value: ALL, label: "Todos" }, ...(modelsQuery.data ?? []).map((model) => ({ value: model.id, label: `${model.displayName} · ${model.connectionName}` }))]} />
        <FilterSelect
          label="Use Case"
          value={useCase}
          onChange={setUseCase}
          options={[{ value: ALL, label: "Todos" }, ...(useCasesQuery.data ?? []).map((item) => ({ value: item.key, label: item.label }))]}
        />
      </div>
      {period === "CUSTOM" && !range ? <p className="text-sm text-muted-foreground">Informe o início e o fim do período (início antes do fim).</p> : null}

      {overviewQuery.isError ? (
        <ListErrorState message={(overviewQuery.error as Error).message || "Não foi possível carregar o painel de IA."} onRetry={() => overviewQuery.refetch()} />
      ) : !data ? (
        period === "CUSTOM" && !range ? null : <OverviewSkeleton />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {data.usage.period.label}: {formatAiDateTime(data.usage.period.from)} a {formatAiDateTime(data.usage.period.to)} · fuso {data.usage.period.timezone}
          </p>
          <KpiRow totals={data.usage.totals} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" data-testid="ai-counts">
            <Badge variant="secondary">{data.counts.activeConnections} de {data.counts.connections} conexão(ões) ativa(s)</Badge>
            <Badge variant="secondary">{data.counts.activeModels} de {data.counts.models} modelo(s) ativo(s)</Badge>
            <Badge variant="secondary">{data.counts.activePolicies} política(s) de roteamento ativa(s)</Badge>
          </div>
          <DailyChart usage={data.usage} />
          <BreakdownCard usage={data.usage} />
          <div className="grid gap-4 lg:grid-cols-2">
            <BudgetsCard budgets={data.budgets} onOpenTab={onOpenTab} />
            <HealthCard health={data.health} />
          </div>
          <LegacyCard legacy={data.legacy} />
        </>
      )}
    </div>
  )
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

// ---------------------------------------------------------------- Onboarding

const ONBOARDING_STEPS: { key: keyof AiOnboarding | "done"; title: string; description: string; tab: string; icon: typeof Plug }[] = [
  { key: "hasConnection", title: "Adicionar provider", description: "Crie uma conexão com Gemini, OpenAI, Anthropic, xAI ou um servidor local.", tab: "connections", icon: Plug },
  { key: "hasCredential", title: "Informar API key", description: "A chave é cifrada e nunca volta para a tela.", tab: "connections", icon: KeyRound },
  { key: "hasTestedConnection", title: "Testar", description: "O teste de conexão não gera custo (lista os modelos).", tab: "connections", icon: CheckCircle2 },
  { key: "hasModel", title: "Selecionar modelo", description: "Sincronize os modelos da conexão ou cadastre manualmente.", tab: "models", icon: Server },
  { key: "hasActivePolicy", title: "Atribuir a Use Cases", description: "Escolha qual modelo atende cada uso e ative a política.", tab: "routing", icon: Route },
  { key: "done", title: "Pronto", description: "Os Use Cases com política ativa passam a usar a configuração da organização.", tab: "overview", icon: Sparkles },
]

function OnboardingCard({ onboarding, onOpenTab }: { onboarding: AiOnboarding; onOpenTab: (tab: string) => void }) {
  const done = (key: (typeof ONBOARDING_STEPS)[number]["key"]) => (key === "done" ? Object.values(onboarding).every(Boolean) : onboarding[key])
  const next = ONBOARDING_STEPS.find((step) => !done(step.key))
  return (
    <Card data-testid="ai-onboarding">
      <CardHeader>
        <CardTitle>{onboarding.hasConnection ? "Conclua a configuração de IA" : "Configure a IA da organização"}</CardTitle>
        <CardDescription>
          Enquanto nenhum Use Case tiver política ativa, a INIA continua usando a configuração legada do ambiente — nada muda sem você ativar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ONBOARDING_STEPS.map((step, index) => {
            const complete = done(step.key)
            const current = next?.key === step.key
            return (
              <li key={step.key} className={cn("rounded-lg border p-3", current && "border-primary/50 bg-primary/5")} data-testid={`onboarding-step-${index + 1}`} data-complete={complete}>
                <div className="flex items-start gap-2">
                  {complete ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-label="Concluído" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="Pendente" />}
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {index + 1}. {step.title}
                    </p>
                    <p className="text-xs text-muted-foreground">{step.description}</p>
                    {current && step.key !== "done" ? (
                      <Button size="sm" variant="outline" className="mt-1" onClick={() => onOpenTab(step.tab)}>
                        <step.icon /> Ir para {step.tab === "connections" ? "Conexões" : step.tab === "models" ? "Modelos" : "Roteamento"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------- KPIs

function KpiTile({ label, children, hint, testId }: { label: string; children: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4" data-testid={testId}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 text-xl font-semibold tabular-nums">{children}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

const TOKEN_FIELDS: { key: "input" | "output" | "reasoning" | "cached" | "total"; label: string }[] = [
  { key: "input", label: "Entrada" },
  { key: "output", label: "Saída" },
  { key: "reasoning", label: "Raciocínio" },
  { key: "cached", label: "Cache" },
  { key: "total", label: "Total" },
]

function KpiRow({ totals }: { totals: UsageMetrics }) {
  const spend = moneyEntries(totals.costByCurrency)
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {spend.length === 0 ? (
        <KpiTile label="Gasto no período" testId="kpi-spend" hint={totals.unknownCostCalls > 0 ? `${formatCount(totals.unknownCostCalls)} chamada(s) sem custo conhecido` : undefined}>
          <span className="text-base text-muted-foreground">{NO_KNOWN_COST_LABEL}</span>
        </KpiTile>
      ) : (
        spend.map((entry) => (
          <KpiTile key={entry.currency} label={`Gasto no período (${entry.currency})`} testId={`kpi-spend-${entry.currency}`} hint={totals.unknownCostCalls > 0 ? `+ ${formatCount(totals.unknownCostCalls)} chamada(s) sem custo conhecido` : "Moedas nunca são somadas nem convertidas."}>
            {entry.label}
          </KpiTile>
        ))
      )}
      <KpiTile label="Requisições" testId="kpi-requests" hint={`${formatCount(totals.attempts)} tentativa(s) · ${formatCount(totals.localCalls)} em modelo local`}>
        {formatCount(totals.requests)}
      </KpiTile>
      <KpiTile label="Tokens" testId="kpi-tokens">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-xs font-normal">
          {TOKEN_FIELDS.map((field) => {
            const value = totals.tokens[field.key]
            const reported = totals.tokens.reported[field.key]
            return (
              <div key={field.key} className="contents">
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd className="text-right">
                  {value === null ? (
                    <span className="text-muted-foreground">{NOT_REPORTED_LABEL}</span>
                  ) : (
                    <>
                      <span className="font-medium">{formatTokens(value)}</span> <span className="text-muted-foreground">· informado em {formatCount(reported)} chamada(s)</span>
                    </>
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      </KpiTile>
      <KpiTile label="Taxa de erro" testId="kpi-errors" hint={`${formatCount(totals.errors)} erro(s)`}>
        {formatRate(totals.errorRate)}
      </KpiTile>
      <KpiTile
        label="Latência média"
        testId="kpi-latency"
        hint={
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted underline-offset-2">p50 / p95</span>
            </TooltipTrigger>
            <TooltipContent>
              p50: {formatLatency(totals.latencyP50Ms)} · p95: {formatLatency(totals.latencyP95Ms)} (só chamadas bem-sucedidas)
            </TooltipContent>
          </Tooltip>
        }
      >
        {formatLatency(totals.latencyAvgMs)}
      </KpiTile>
      <KpiTile label="Fallbacks" testId="kpi-fallbacks" hint="Tentativas atendidas por um modelo seguinte da cadeia.">
        {formatCount(totals.fallbacks)}
      </KpiTile>
      <KpiTile label="Bloqueios" testId="kpi-blocked" hint="Chamadas barradas por orçamento (limite rígido) ou política.">
        {formatCount(totals.blocked)}
      </KpiTile>
    </div>
  )
}

// ---------------------------------------------------------------- Gráfico diário

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"]

function DailyChart({ usage }: { usage: UsageDashboard }) {
  const captionId = useId()
  const currencies = usage.currencies
  const hasCost = currencies.length > 0
  const config: ChartConfig = hasCost
    ? Object.fromEntries(currencies.map((currency, index) => [currency, { label: currency, color: SERIES_COLORS[index % SERIES_COLORS.length] }]))
    : { requests: { label: "Requisições", color: "var(--primary)" } }
  // Number() só para desenhar o gráfico — nenhum cálculo monetário acontece aqui.
  const points = usage.daily.map((point) => ({ label: formatDayLabel(point.day), requests: point.requests, ...Object.fromEntries(currencies.map((currency) => [currency, Number(point.costByCurrency[currency] ?? "0")])) }))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{hasCost ? "Custo por dia" : "Requisições por dia"}</CardTitle>
        <CardDescription>
          {hasCost ? "Uma série por moeda — sem conversão entre moedas." : "Nenhum custo conhecido no período (sem preço configurado ou só modelos locais): mostrando requisições por dia."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="rounded-lg bg-muted/60 px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma chamada de IA no período.</p>
        ) : (
          <figure aria-describedby={captionId}>
            <DeferredMount>
              <ChartContainer config={config} className="aspect-auto h-56 w-full">
                {hasCost ? (
                  <LineChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={56} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={(value, name) => <span className="font-medium">{formatMoney(String(value), String(name))}</span>} />} />
                    {currencies.map((currency) => (
                      <Line key={currency} dataKey={currency} type="monotone" stroke={`var(--color-${currency})`} strokeWidth={2} dot={{ r: 2.5 }} isAnimationActive={false} />
                    ))}
                  </LineChart>
                ) : (
                  <BarChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 0 }} accessibilityLayer>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                    <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
                    <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
                    <Bar dataKey="requests" fill="var(--color-requests)" radius={3} isAnimationActive={false} />
                  </BarChart>
                )}
              </ChartContainer>
            </DeferredMount>
            <figcaption id={captionId} className="sr-only">
              {usage.daily
                .map((point) => `${formatDayLabel(point.day)}: ${point.requests} requisição(ões)${hasCost ? `, ${moneyEntries(point.costByCurrency).map((entry) => entry.label).join(" e ") || "sem custo conhecido"}` : ""}`)
                .join("; ")}
            </figcaption>
          </figure>
        )}
      </CardContent>
    </Card>
  )
}

/** Evita a corrida do ResponsiveContainer com a Tab ainda montando (mesmo padrão dos gráficos de Indicadores). */
function DeferredMount({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const timeout = window.setTimeout(() => setReady(true), 150)
    return () => window.clearTimeout(timeout)
  }, [])
  if (!ready) return <div className="h-56 w-full animate-pulse rounded-lg bg-muted/40" aria-hidden />
  return <>{children}</>
}

// ---------------------------------------------------------------- Quebras

function BreakdownCard({ usage }: { usage: UsageDashboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Onde o uso acontece</CardTitle>
        <CardDescription>Tokens somam só o que o provider informou; custo sempre por moeda.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="provider">
          <TabsList>
            <TabsTrigger value="provider">Por provider</TabsTrigger>
            <TabsTrigger value="model">Por modelo</TabsTrigger>
            <TabsTrigger value="use-case">Por Use Case</TabsTrigger>
          </TabsList>
          <TabsContent value="provider" className="mt-3">
            <BreakdownTable rows={usage.byProvider} firstColumn="Provider" />
          </TabsContent>
          <TabsContent value="model" className="mt-3">
            <BreakdownTable rows={usage.byModel} firstColumn="Modelo" />
          </TabsContent>
          <TabsContent value="use-case" className="mt-3">
            <BreakdownTable rows={usage.byUseCase} firstColumn="Use Case" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}

export function BreakdownTable({ rows, firstColumn }: { rows: BreakdownRow[]; firstColumn: string }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma chamada no período.</p>
  return (
    <div className={TABLE_FRAME}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{firstColumn}</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Tokens</TableHead>
            <TableHead>Custo</TableHead>
            <TableHead className="text-right">Latência</TableHead>
            <TableHead className="text-right">Erros</TableHead>
            <TableHead className="text-right">Fallbacks</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <p className="font-medium">{row.label}</p>
                {row.secondary ? <p className="text-xs text-muted-foreground">{row.secondary}</p> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.requests)}</TableCell>
              <TableCell className="text-right tabular-nums">{row.tokens.total === null ? <span className="text-muted-foreground">{NOT_REPORTED_LABEL}</span> : formatTokens(row.tokens.total)}</TableCell>
              <TableCell className="text-sm">
                <MoneyList costByCurrency={row.costByCurrency} />
                {row.unknownCostCalls > 0 ? <span className="block text-xs text-muted-foreground">+ {formatCount(row.unknownCostCalls)} sem custo conhecido</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatLatency(row.latencyAvgMs)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(row.errors)}
                {row.errorRate !== null ? <span className="block text-xs text-muted-foreground">{formatRate(row.errorRate)}</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatCount(row.fallbacks)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

// ---------------------------------------------------------------- Orçamento e saúde

export function BudgetStatusBadge({ status }: { status: "OK" | "WARNING" | "EXCEEDED" }) {
  const meta = { OK: { label: "Dentro do orçamento", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300" }, WARNING: { label: "Alerta", className: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300" }, EXCEEDED: { label: "Excedido", className: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300" } }[status]
  return (
    <Badge variant="outline" className={meta.className}>
      {meta.label}
    </Badge>
  )
}

export function BudgetProgress({ budget }: { budget: AiBudget }) {
  const evaluation = budget.evaluation
  return (
    <div className="space-y-1.5" data-testid={`budget-${budget.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{budget.scopeLabel}</span>
        <Badge variant="outline" className="font-mono">
          {budget.currency}
        </Badge>
        {budget.hardLimit ? <Badge variant="destructive">Limite rígido</Badge> : null}
        {!budget.enabled ? <Badge variant="outline">Desabilitado</Badge> : null}
        {evaluation ? <BudgetStatusBadge status={evaluation.status} /> : null}
      </div>
      {evaluation ? (
        <>
          <Progress value={Math.min(evaluation.percent ?? 0, 100)} className={cn("h-2", evaluation.status === "EXCEEDED" && "[&>[data-slot=progress-indicator]]:bg-destructive", evaluation.status === "WARNING" && "[&>[data-slot=progress-indicator]]:bg-amber-500")} aria-label={`Consumo do orçamento ${budget.scopeLabel}`} />
          <p className="text-xs text-muted-foreground tabular-nums">
            {formatMoney(evaluation.spent, evaluation.currency)} de {formatMoney(evaluation.limit, evaluation.currency)}
            {evaluation.percent !== null ? ` (${formatRate(evaluation.percent)})` : ""} no mês
          </p>
          {evaluation.notComparableCurrencies.length > 0 ? <p className="text-xs text-amber-700 dark:text-amber-300">Gasto em {evaluation.notComparableCurrencies.join(", ")} não é comparável a este orçamento em {budget.currency} (sem conversão).</p> : null}
          {evaluation.unknownCostCalls > 0 ? <p className="text-xs text-muted-foreground">{formatCount(evaluation.unknownCostCalls)} chamada(s) sem custo conhecido — o gasto real pode ser maior.</p> : null}
          {evaluation.hardLimitReached ? <p className="text-xs text-destructive">Limite rígido atingido: novas chamadas pagas deste escopo estão bloqueadas.</p> : null}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">Sem avaliação no momento.</p>
      )}
    </div>
  )
}

function BudgetsCard({ budgets, onOpenTab }: { budgets: AiBudget[]; onOpenTab: (tab: string) => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="size-4" aria-hidden /> Orçamento do mês
        </CardTitle>
        <CardDescription>Cada orçamento só compara gasto na própria moeda.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {budgets.length === 0 ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>Nenhum orçamento configurado.</p>
            <Button size="sm" variant="outline" onClick={() => onOpenTab("budgets")}>
              Configurar orçamento
            </Button>
          </div>
        ) : (
          budgets.map((budget) => <BudgetProgress key={budget.id} budget={budget} />)
        )}
      </CardContent>
    </Card>
  )
}

function HealthCard({ health }: { health: ConnectionHealth[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Saúde por conexão</CardTitle>
        <CardDescription>Derivada do último teste e das chamadas reais das últimas 24h (sem polling).</CardDescription>
      </CardHeader>
      <CardContent>
        {health.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma conexão cadastrada.</p>
        ) : (
          <ul className="divide-y">
            {health.map((item) => (
              <li key={item.connectionId} className="space-y-1 py-2 first:pt-0 last:pb-0" data-testid={`health-${item.connectionId}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {item.name} <span className="font-normal text-muted-foreground">· {item.providerName ?? item.providerKey}</span>
                  </span>
                  <HealthBadge status={item.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Último teste: {item.lastTest ? `${formatAiDateTime(item.lastTest.checkedAt)} (${item.lastTest.status})` : "nunca"} · Último sucesso: {formatAiDateTime(item.lastSuccessAt)} · Último erro: {formatAiDateTime(item.lastErrorAt)}
                  {item.lastErrorCategory ? ` (${item.lastErrorCategory})` : ""} · Latência: {formatLatency(item.recentLatencyMs)} · 24h: {formatCount(item.attempts24h)} tentativa(s), {formatCount(item.errors24h)} erro(s)
                </p>
                {item.lastTest?.message && item.lastTest.status !== "CONNECTED" ? <p className="text-xs text-muted-foreground">{item.lastTest.message}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function LegacyCard({ legacy }: { legacy: LegacyEnvironment }) {
  return (
    <Card data-testid="ai-legacy">
      <CardHeader>
        <CardTitle className="text-base">Configuração legada do ambiente</CardTitle>
        <CardDescription>Use Cases sem política ativa continuam usando esta configuração (variáveis do servidor). Ela não é editável por aqui.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <Badge variant={legacy.credentialConfigured ? "secondary" : "outline"}>Credencial do ambiente: {legacy.credentialConfigured ? "configurada" : "não configurada"}</Badge>
          <Badge variant="outline">Modo de roteamento: {legacy.routingMode}</Badge>
          <Badge variant="outline">Preços do ambiente: {legacy.pricingConfigured ? "configurados" : "não configurados"}</Badge>
          {legacy.profilesOverridden ? <Badge variant="outline">Perfis sobrescritos no ambiente</Badge> : null}
        </div>
        {legacy.profiles.length > 0 ? (
          <div className={TABLE_FRAME}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {legacy.profiles.map((profile) => (
                  <TableRow key={profile.id}>
                    <TableCell>{profile.tier}</TableCell>
                    <TableCell className="font-mono text-xs">{profile.model}</TableCell>
                    <TableCell>{profile.providerKey}</TableCell>
                    <TableCell>{profile.enabled ? "Ativo" : "Inativo"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
