import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { findUseCase } from "../../../shared/application/model-routing/ai-use-cases.js"
import { connectionHealth, type ConnectionHealthStatus } from "../domain/ai-health.js"
import { findAiProvider } from "../domain/ai-provider-catalog.js"
import { formatDecimal, parseDecimal } from "../domain/decimal.js"
import type { AiAdminContext } from "./ai-admin-context.js"
import { ORG_TIMEZONE_SQL } from "./ai-runtime-store.js"

/**
 * DASHBOARD DE USO E CUSTO (§34–§39, §45–§48, §54, §78). Tudo por agregação SQL sobre
 * `ai_usage_events` (índices por organização × tempo × dimensão) — nunca N+1 por evento. Tokens só
 * somam o que o provider informou (com a contagem de eventos que informaram cada campo); custo é
 * sempre separado por MOEDA (sem conversão) e o custo desconhecido é contado, nunca estimado.
 */
export const usageQuerySchema = z.object({
  period: z.enum(["TODAY", "7D", "30D", "MONTH", "CUSTOM"]).default("30D"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  providerKey: z.string().trim().min(1).optional(),
  modelId: z.uuid().optional(),
  useCase: z.string().trim().min(1).optional(),
})
export type UsageQuery = z.infer<typeof usageQuerySchema>

export type TokenTotals = { input: number | null; output: number | null; reasoning: number | null; cached: number | null; total: number | null; reported: { input: number; output: number; reasoning: number; cached: number; total: number } }
export type Metrics = { requests: number; attempts: number; errors: number; blocked: number; fallbacks: number; tokens: TokenTotals; costByCurrency: Record<string, string>; unknownCostCalls: number; localCalls: number; latencyAvgMs: number | null; latencyP50Ms: number | null; latencyP95Ms: number | null; errorRate: number | null }
export type BreakdownRow = Metrics & { key: string; label: string; secondary: string | null }
export type DailyPoint = { day: string; requests: number; tokens: number | null; costByCurrency: Record<string, string> }
export type UsageDashboard = { period: { from: string; to: string; label: string; timezone: string }; totals: Metrics; daily: DailyPoint[]; byProvider: BreakdownRow[]; byModel: BreakdownRow[]; byUseCase: BreakdownRow[]; currencies: string[] }

type MetricRow = { dim: string | null; dim2: string | null; requests: number; attempts: number; errors: number; blocked: number; fallbacks: number; input: string | null; output: string | null; reasoning: string | null; cached: string | null; total: string | null; input_n: number; output_n: number; reasoning_n: number; cached_n: number; total_n: number; unknown_cost: number; local_calls: number; lat_avg: number | null; lat_p50: number | null; lat_p95: number | null }
type CostRow = { dim: string | null; currency: string; amount: string }

const METRIC_COLUMNS = `
  count(distinct correlation_id)::int requests, count(*)::int attempts,
  count(*) filter (where status = 'ERROR')::int errors, count(*) filter (where status = 'BLOCKED')::int blocked, count(*) filter (where fallback_index > 0)::int fallbacks,
  sum(input_tokens)::text input, sum(output_tokens)::text output, sum(reasoning_tokens)::text reasoning, sum(cached_tokens)::text cached, sum(total_tokens)::text total,
  count(input_tokens)::int input_n, count(output_tokens)::int output_n, count(reasoning_tokens)::int reasoning_n, count(cached_tokens)::int cached_n, count(total_tokens)::int total_n,
  count(*) filter (where status = 'SUCCESS' and cost_status = 'UNKNOWN')::int unknown_cost, count(*) filter (where status = 'SUCCESS' and is_local)::int local_calls,
  avg(duration_ms) filter (where status = 'SUCCESS') lat_avg,
  percentile_cont(0.5) within group (order by duration_ms) filter (where status = 'SUCCESS') lat_p50,
  percentile_cont(0.95) within group (order by duration_ms) filter (where status = 'SUCCESS') lat_p95`

const num = (value: string | null): number | null => (value === null ? null : Number(value))
const round = (value: number | null): number | null => (value === null ? null : Math.round(Number(value)))

function metricsOf(row: MetricRow | undefined, costs: CostRow[]): Metrics {
  const costByCurrency: Record<string, string> = {}
  for (const cost of costs) costByCurrency[cost.currency] = formatDecimal(parseDecimal(costByCurrency[cost.currency] ?? "0") + parseDecimal(cost.amount), 6)
  if (!row) return { requests: 0, attempts: 0, errors: 0, blocked: 0, fallbacks: 0, tokens: { input: null, output: null, reasoning: null, cached: null, total: null, reported: { input: 0, output: 0, reasoning: 0, cached: 0, total: 0 } }, costByCurrency, unknownCostCalls: 0, localCalls: 0, latencyAvgMs: null, latencyP50Ms: null, latencyP95Ms: null, errorRate: null }
  return {
    requests: row.requests,
    attempts: row.attempts,
    errors: row.errors,
    blocked: row.blocked,
    fallbacks: row.fallbacks,
    // Soma só do que foi INFORMADO; `reported` diz quantos eventos informaram cada campo (null = nenhum informou).
    tokens: { input: row.input_n > 0 ? num(row.input) : null, output: row.output_n > 0 ? num(row.output) : null, reasoning: row.reasoning_n > 0 ? num(row.reasoning) : null, cached: row.cached_n > 0 ? num(row.cached) : null, total: row.total_n > 0 ? num(row.total) : null, reported: { input: row.input_n, output: row.output_n, reasoning: row.reasoning_n, cached: row.cached_n, total: row.total_n } },
    costByCurrency,
    unknownCostCalls: row.unknown_cost,
    localCalls: row.local_calls,
    latencyAvgMs: round(row.lat_avg),
    latencyP50Ms: round(row.lat_p50),
    latencyP95Ms: round(row.lat_p95),
    errorRate: row.attempts > 0 ? Math.round((row.errors / row.attempts) * 1000) / 10 : null,
  }
}

/** Janela do período no fuso da organização. */
async function resolvePeriod(context: AiAdminContext, organizationId: string, query: UsageQuery): Promise<{ from: Date; to: Date; label: string; timezone: string }> {
  const now = context.now()
  const tzRow = await context.db.query<{ timezone: string; today_start: Date; month_start: Date }>(
    `select ${ORG_TIMEZONE_SQL} timezone,
            date_trunc('day', $2::timestamptz at time zone ${ORG_TIMEZONE_SQL}) at time zone ${ORG_TIMEZONE_SQL} today_start,
            date_trunc('month', $2::timestamptz at time zone ${ORG_TIMEZONE_SQL}) at time zone ${ORG_TIMEZONE_SQL} month_start`,
    [organizationId, now],
  )
  const row = tzRow.rows[0]!
  const day = 86_400_000
  switch (query.period) {
    case "TODAY":
      return { from: new Date(row.today_start), to: now, label: "Hoje", timezone: row.timezone }
    case "7D":
      return { from: new Date(new Date(row.today_start).getTime() - 6 * day), to: now, label: "Últimos 7 dias", timezone: row.timezone }
    case "MONTH":
      return { from: new Date(row.month_start), to: now, label: "Mês atual", timezone: row.timezone }
    case "CUSTOM": {
      if (!query.from || !query.to || query.from >= query.to) throw new DomainError("Informe um período válido (início antes do fim).", "AI_USAGE_PERIOD_INVALID", 422)
      if (query.to.getTime() - query.from.getTime() > 366 * day) throw new DomainError("O período personalizado pode ter no máximo 1 ano.", "AI_USAGE_PERIOD_TOO_LONG", 422)
      return { from: query.from, to: query.to, label: "Personalizado", timezone: row.timezone }
    }
    default:
      return { from: new Date(new Date(row.today_start).getTime() - 29 * day), to: now, label: "Últimos 30 dias", timezone: row.timezone }
  }
}

export async function usageDashboard(context: AiAdminContext, organizationId: string, rawQuery: unknown): Promise<UsageDashboard> {
  const query = usageQuerySchema.parse(rawQuery)
  const period = await resolvePeriod(context, organizationId, query)
  const params: unknown[] = [organizationId, period.from, period.to]
  const filters: string[] = []
  if (query.providerKey) filters.push(`provider_key = $${params.push(query.providerKey)}`)
  if (query.modelId) filters.push(`model_id = $${params.push(query.modelId)}`)
  if (query.useCase) filters.push(`use_case = $${params.push(query.useCase)}`)
  const where = `where organization_id = $1 and occurred_at >= $2 and occurred_at <= $3${filters.map((filter) => ` and ${filter}`).join("")}`
  // O fuso só entra nas consultas diárias (as demais não têm o parâmetro).
  const dailyParams = [...params, period.timezone]
  const tzIndex = dailyParams.length
  const metric = (dim: string, dim2 = "null") => context.db.query<MetricRow>(`select ${dim} dim, ${dim2} dim2, ${METRIC_COLUMNS} from ai_usage_events ${where} group by 1`, params)
  const cost = (dim: string) => context.db.query<CostRow>(`select ${dim} dim, currency, sum(cost)::text amount from ai_usage_events ${where} and cost is not null group by 1, 2`, params)
  const modelDim = `coalesce(model_id::text, 'legacy:' || model_name)`
  const [totals, totalCost, daily, dailyCost, provider, providerCost, model, modelCost, useCase, useCaseCost] = await Promise.all([
    metric("'all'"),
    cost("'all'"),
    context.db.query<{ day_key: string; requests: number; tokens: string | null }>(`select to_char(occurred_at at time zone $${tzIndex}, 'YYYY-MM-DD') as day_key, count(distinct correlation_id)::int requests, sum(total_tokens)::text tokens from ai_usage_events ${where} group by 1 order by 1`, dailyParams),
    context.db.query<{ day_key: string; currency: string; amount: string }>(`select to_char(occurred_at at time zone $${tzIndex}, 'YYYY-MM-DD') as day_key, currency, sum(cost)::text amount from ai_usage_events ${where} and cost is not null group by 1, 2`, dailyParams),
    metric("provider_key"),
    cost("provider_key"),
    metric(modelDim, "max(model_name)"),
    cost(modelDim),
    metric("use_case"),
    cost("use_case"),
  ])
  const breakdown = (rows: MetricRow[], costs: CostRow[], label: (row: MetricRow) => { label: string; secondary: string | null }): BreakdownRow[] =>
    rows
      .map((row) => ({ key: row.dim ?? "—", ...label(row), ...metricsOf(row, costs.filter((item) => item.dim === row.dim)) }))
      .sort((left, right) => right.requests - left.requests)
  const modelIds = model.rows.map((row) => row.dim).filter((dim): dim is string => Boolean(dim) && !dim!.startsWith("legacy:"))
  const modelNames = modelIds.length > 0 ? await context.db.query<{ id: string; display_name: string; connection_name: string }>(`select m.id, m.display_name, c.name connection_name from ai_models m join ai_connections c on c.id = m.connection_id where m.organization_id = $1 and m.id = any($2::uuid[])`, [organizationId, modelIds]) : { rows: [] }
  const modelLabel = new Map(modelNames.rows.map((row) => [row.id, row]))
  const dailyCosts = new Map<string, Record<string, string>>()
  for (const row of dailyCost.rows) dailyCosts.set(row.day_key, { ...(dailyCosts.get(row.day_key) ?? {}), [row.currency]: formatDecimal(parseDecimal(row.amount), 6) })
  const totalsMetrics = metricsOf(totals.rows[0], totalCost.rows)
  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString(), label: period.label, timezone: period.timezone },
    totals: totalsMetrics,
    daily: daily.rows.map((row) => ({ day: row.day_key, requests: row.requests, tokens: num(row.tokens), costByCurrency: dailyCosts.get(row.day_key) ?? {} })),
    byProvider: breakdown(provider.rows, providerCost.rows, (row) => ({ label: findAiProvider(row.dim ?? "")?.name ?? row.dim ?? "—", secondary: null })),
    byModel: breakdown(model.rows, modelCost.rows, (row) => {
      if (row.dim?.startsWith("legacy:")) return { label: row.dim2 ?? row.dim.slice(7), secondary: "Configuração legada do ambiente" }
      const known = modelLabel.get(row.dim ?? "")
      return { label: known?.display_name ?? row.dim2 ?? "Modelo removido", secondary: known ? `${known.connection_name} · ${row.dim2 ?? ""}` : row.dim2 }
    }),
    byUseCase: breakdown(useCase.rows, useCaseCost.rows, (row) => ({ label: findUseCase(row.dim ?? "")?.label ?? row.dim ?? "—", secondary: row.dim })),
    currencies: [...new Set(totalCost.rows.map((row) => row.currency))],
  }
}

export type ConnectionHealthView = { connectionId: string; name: string; providerKey: string; providerName: string | null; enabled: boolean; status: ConnectionHealthStatus; lastTest: { status: string; checkedAt: string; latencyMs: number | null; message: string | null } | null; lastSuccessAt: string | null; lastErrorAt: string | null; lastErrorCategory: string | null; attempts24h: number; errors24h: number; recentLatencyMs: number | null }

/** Saúde por conexão (+ uma linha para a configuração legada, quando houve uso dela nas 24h). */
export async function connectionsHealth(context: AiAdminContext, organizationId: string): Promise<ConnectionHealthView[]> {
  const now = context.now()
  const rows = await context.db.query<{ id: string; name: string; provider_key: string; enabled: boolean; last_health_status: string | null; last_health_check_at: Date | null; last_health_latency_ms: number | null; last_health_message: string | null; attempts: number; errors: number; rate_limits: number; last_success: Date | null; last_error: Date | null; last_error_category: string | null; latency: number | null }>(
    `select c.id, c.name, c.provider_key, c.enabled, c.last_health_status, c.last_health_check_at, c.last_health_latency_ms, c.last_health_message,
            coalesce(e.attempts, 0) attempts, coalesce(e.errors, 0) errors, coalesce(e.rate_limits, 0) rate_limits, e.last_success, e.last_error, e.latency,
            (select error_category from ai_usage_events x where x.organization_id = c.organization_id and x.connection_id = c.id and x.status = 'ERROR' order by x.occurred_at desc limit 1) last_error_category
       from ai_connections c
       left join lateral (
         select count(*)::int attempts, count(*) filter (where status = 'ERROR')::int errors,
                count(*) filter (where error_category = 'RATE_LIMIT' and occurred_at > $2::timestamptz - interval '1 hour')::int rate_limits,
                max(occurred_at) filter (where status = 'SUCCESS') last_success, max(occurred_at) filter (where status = 'ERROR') last_error,
                avg(duration_ms) filter (where status = 'SUCCESS') latency
           from ai_usage_events e where e.organization_id = c.organization_id and e.connection_id = c.id and e.occurred_at > $2::timestamptz - interval '24 hours'
       ) e on true
      where c.organization_id = $1 order by c.name`,
    [organizationId, now],
  )
  return rows.rows.map((row) => {
    const lastTest = row.last_health_status && row.last_health_check_at ? { status: row.last_health_status, checkedAt: new Date(row.last_health_check_at) } : null
    const status = row.enabled ? connectionHealth({ lastTest, attempts24h: row.attempts, errors24h: row.errors, rateLimitsLastHour: row.rate_limits, lastSuccessAt: row.last_success ? new Date(row.last_success) : null, lastErrorAt: row.last_error ? new Date(row.last_error) : null }) : "UNKNOWN"
    return {
      connectionId: row.id,
      name: row.name,
      providerKey: row.provider_key,
      providerName: findAiProvider(row.provider_key)?.name ?? null,
      enabled: row.enabled,
      status,
      lastTest: lastTest ? { status: lastTest.status, checkedAt: lastTest.checkedAt.toISOString(), latencyMs: row.last_health_latency_ms, message: row.last_health_message } : null,
      lastSuccessAt: row.last_success ? new Date(row.last_success).toISOString() : null,
      lastErrorAt: row.last_error ? new Date(row.last_error).toISOString() : null,
      lastErrorCategory: row.last_error_category,
      attempts24h: row.attempts,
      errors24h: row.errors,
      recentLatencyMs: round(row.latency),
    }
  })
}
