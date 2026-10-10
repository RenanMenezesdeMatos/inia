import type { Database } from "../../../infrastructure/database/pool.js"
import type { AiCallLimiterRecord } from "../../../shared/application/model-routing/ai-call-limiter.js"
import type { AiUsageEventInput, AiWorkflowCorrelation } from "../../../shared/application/model-routing/ai-runtime.js"
import type { AiBudget } from "../domain/ai-budget.js"
import type { AiModelKind, AiQualityTier, ModelCapabilities } from "../domain/ai-capabilities.js"
import { findAiProvider, isLocalDeployment } from "../domain/ai-provider-catalog.js"
import type { AiPricingVersion } from "../domain/ai-pricing.js"
import type { AiAutoStrategy, AiRoutingMode, ModelSnapshot, PolicySnapshot } from "../domain/ai-routing-policy.js"
import { speechSettingsOf } from "../domain/ai-speech.js"
import type { EncryptedSecret } from "./ai-secrets.js"

/**
 * LEITURAS DO RUNTIME (Postgres). Snapshot da configuração ATIVA de uma organização em poucas
 * consultas fixas (nunca uma por modelo) + escrita do evento de uso. O snapshot fica em cache por
 * poucos segundos e é invalidado a cada escrita administrativa neste processo (§85: sem restart).
 */
type Queryable = Pick<Database, "query">

export type ConnectionRuntime = {
  id: string
  name: string
  providerKey: string
  baseUrl: string | null
  apiVersion: string | null
  isLocal: boolean
  timeoutMs: number
  enabled: boolean
  apiKey: EncryptedSecret | null
  headers: EncryptedSecret | null
}

export type OrgAiSnapshot = {
  loadedAt: number
  timezone: string
  policies: Map<string, PolicySnapshot>
  models: Map<string, ModelSnapshot>
  connections: Map<string, ConnectionRuntime>
  pricing: Map<string, AiPricingVersion[]>
  budgets: AiBudget[]
  /** Preços cadastrados por `provider::modelo` para precificar o uso LEGADO (sem policy); null = mais de um modelo cadastrado com o mesmo id (ambíguo → sem preço). */
  legacyPricing: Map<string, AiPricingVersion[] | null>
}

export function legacyPricingKey(providerKey: string, modelName: string): string {
  return `${providerKey}::${modelName.replace(/^models\//, "")}`
}

type PolicyRow = { id: string; use_case: string; status: string; mode: string; strategy: string | null; max_estimated_cost_per_request: string | null; cost_currency: string | null; fallback_on: string[]; model_ids: string[] | null }
type ModelRow = { id: string; display_name: string; provider_model_id: string; enabled: boolean; kind: string; capabilities: ModelCapabilities; context_window: number | null; max_output_tokens: number | null; quality_tier: string | null; model_timeout_ms: number | null; metadata: Record<string, unknown> | null; connection_id: string; connection_name: string; connection_enabled: boolean; provider_key: string; base_url: string | null; api_version: string | null; is_local: boolean; connection_timeout_ms: number }
type PricingRow = { id: string; model_id: string; currency: string; input_per_million: string; output_per_million: string; cached_input_per_million: string | null; reasoning_per_million: string | null; effective_from: Date; effective_to: Date | null; note: string | null }
type SecretRow = { connection_id: string; purpose: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }
type BudgetRow = { id: string; scope: string; scope_key: string | null; currency: string; monthly_amount: string; warning_thresholds: number[]; hard_limit: boolean; enabled: boolean }

export function pricingFromRow(row: PricingRow): AiPricingVersion {
  return { id: row.id, modelId: row.model_id, currency: row.currency, inputPerMillion: row.input_per_million, outputPerMillion: row.output_per_million, cachedInputPerMillion: row.cached_input_per_million, reasoningPerMillion: row.reasoning_per_million, effectiveFrom: new Date(row.effective_from), effectiveTo: row.effective_to ? new Date(row.effective_to) : null, source: "MANUAL", note: row.note }
}

export function budgetFromRow(row: BudgetRow): AiBudget {
  return { id: row.id, scope: row.scope as AiBudget["scope"], scopeKey: row.scope_key, currency: row.currency, monthlyAmount: row.monthly_amount, warningThresholds: row.warning_thresholds, hardLimit: row.hard_limit, enabled: row.enabled }
}

export const ORG_TIMEZONE_SQL = `coalesce((select op.timezone from operations op where op.organization_id = $1 order by op.created_at limit 1), 'America/Fortaleza')`

/** Modelos (+ conexão) por id, com preço, latência recente e rate limit recente — 4 consultas fixas. */
export async function loadModelSnapshots(db: Queryable, organizationId: string, modelIds: string[], now: Date): Promise<{ models: Map<string, ModelSnapshot>; connections: Map<string, ConnectionRuntime>; pricing: Map<string, AiPricingVersion[]> }> {
  const models = new Map<string, ModelSnapshot>()
  const connections = new Map<string, ConnectionRuntime>()
  const pricing = new Map<string, AiPricingVersion[]>()
  if (modelIds.length === 0) return { models, connections, pricing }
  const [modelRows, pricingRows, latencyRows, rateRows] = await Promise.all([
    db.query<ModelRow>(
      `select m.id, m.display_name, m.provider_model_id, m.enabled, m.kind, m.capabilities, m.context_window, m.max_output_tokens, m.quality_tier, m.timeout_ms model_timeout_ms, m.metadata,
              c.id connection_id, c.name connection_name, c.enabled connection_enabled, c.provider_key, c.base_url, c.api_version, c.is_local, c.timeout_ms connection_timeout_ms
         from ai_models m join ai_connections c on c.id = m.connection_id
        where m.organization_id = $1 and m.id = any($2::uuid[])`,
      [organizationId, modelIds],
    ),
    db.query<PricingRow>(`select id, model_id, currency, input_per_million::text, output_per_million::text, cached_input_per_million::text, reasoning_per_million::text, effective_from, effective_to, note from ai_model_pricing where organization_id = $1 and model_id = any($2::uuid[]) order by effective_from desc`, [organizationId, modelIds]),
    db.query<{ model_id: string; median: number | null }>(
      `select model_id, percentile_cont(0.5) within group (order by duration_ms) median
         from ai_usage_events
        where organization_id = $1 and model_id = any($2::uuid[]) and status = 'SUCCESS' and duration_ms is not null and occurred_at > $3::timestamptz - interval '7 days'
        group by model_id having count(*) >= 3`,
      [organizationId, modelIds, now],
    ),
    db.query<{ model_id: string; last: Date }>(`select model_id, max(occurred_at) last from ai_usage_events where organization_id = $1 and model_id = any($2::uuid[]) and error_category = 'RATE_LIMIT' and occurred_at > $3::timestamptz - interval '5 minutes' group by model_id`, [organizationId, modelIds, now]),
  ])
  for (const row of pricingRows.rows) pricing.set(row.model_id, [...(pricing.get(row.model_id) ?? []), pricingFromRow(row)])
  const latency = new Map(latencyRows.rows.map((row) => [row.model_id, row.median === null ? null : Math.round(Number(row.median))]))
  const rateLimited = new Map(rateRows.rows.map((row) => [row.model_id, new Date(row.last)]))
  const connectionIds = [...new Set(modelRows.rows.map((row) => row.connection_id))]
  const secrets = connectionIds.length > 0 ? await db.query<SecretRow>(`select connection_id, purpose, ciphertext, iv, auth_tag from ai_connection_secrets where organization_id = $1 and connection_id = any($2::uuid[]) and revoked_at is null`, [organizationId, connectionIds]) : { rows: [] as SecretRow[] }
  for (const row of modelRows.rows) {
    const provider = findAiProvider(row.provider_key)
    if (!connections.has(row.connection_id)) {
      const secretOf = (purpose: string) => {
        const secret = secrets.rows.find((item) => item.connection_id === row.connection_id && item.purpose === purpose)
        return secret ? { ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.auth_tag } : null
      }
      connections.set(row.connection_id, { id: row.connection_id, name: row.connection_name, providerKey: row.provider_key, baseUrl: row.base_url ?? provider?.defaultBaseUrl ?? null, apiVersion: row.api_version, isLocal: provider ? isLocalDeployment(provider, row.is_local) : row.is_local, timeoutMs: row.connection_timeout_ms, enabled: row.connection_enabled, apiKey: secretOf("API_KEY"), headers: secretOf("CUSTOM_HEADERS") })
    }
    const versions = pricing.get(row.id) ?? []
    const current = versions.find((version) => version.effectiveFrom <= now && (version.effectiveTo === null || now < version.effectiveTo)) ?? null
    models.set(row.id, {
      id: row.id,
      displayName: row.display_name,
      providerModelId: row.provider_model_id,
      enabled: row.enabled,
      kind: row.kind as AiModelKind,
      capabilities: row.capabilities ?? {},
      contextWindow: row.context_window,
      maxOutputTokens: row.max_output_tokens,
      qualityTier: row.quality_tier as AiQualityTier | null,
      timeoutMs: row.model_timeout_ms,
      isLocal: connections.get(row.connection_id)!.isLocal,
      pricing: current,
      recentLatencyMs: latency.get(row.id) ?? null,
      lastRateLimitedAt: rateLimited.get(row.id) ?? null,
      connection: { id: row.connection_id, name: row.connection_name, enabled: row.connection_enabled, providerKey: row.provider_key, providerActive: provider !== null },
      speech: speechSettingsOf(row.metadata),
    })
  }
  return { models, connections, pricing }
}

export function policyFromRow(row: PolicyRow): PolicySnapshot {
  return { id: row.id, useCase: row.use_case, status: row.status as PolicySnapshot["status"], mode: row.mode as AiRoutingMode, strategy: row.strategy as AiAutoStrategy | null, maxEstimatedCostPerRequest: row.max_estimated_cost_per_request, costCurrency: row.cost_currency, fallbackOn: row.fallback_on ?? [], modelIds: row.model_ids ?? [] }
}

export const POLICY_SELECT = `select p.id, p.use_case, p.status, p.mode, p.strategy, p.max_estimated_cost_per_request::text, p.cost_currency, p.fallback_on,
       coalesce((select array_agg(pm.model_id::text order by pm.position) from ai_routing_policy_models pm where pm.policy_id = p.id), '{}') model_ids
  from ai_routing_policies p`

export async function loadOrgSnapshot(db: Queryable, organizationId: string, now: Date): Promise<OrgAiSnapshot> {
  const [policyRows, budgetRows, timezoneRow, legacyPricingRows] = await Promise.all([
    db.query<PolicyRow>(`${POLICY_SELECT} where p.organization_id = $1 and p.status = 'ACTIVE'`, [organizationId]),
    db.query<BudgetRow>(`select id, scope, scope_key, currency, monthly_amount::text, warning_thresholds, hard_limit, enabled from ai_budgets where organization_id = $1 and enabled`, [organizationId]),
    db.query<{ timezone: string }>(`select ${ORG_TIMEZONE_SQL} timezone`, [organizationId]),
    db.query<LegacyPricingRow>(
      `select c.provider_key, m.provider_model_id, m.id ai_model_id, p.id, p.model_id, p.currency, p.input_per_million::text, p.output_per_million::text, p.cached_input_per_million::text, p.reasoning_per_million::text, p.effective_from, p.effective_to, p.note
         from ai_models m join ai_connections c on c.id = m.connection_id left join ai_model_pricing p on p.model_id = m.id
        where m.organization_id = $1 order by p.effective_from desc`,
      [organizationId],
    ),
  ])
  const policies = new Map(policyRows.rows.map((row) => [row.use_case, policyFromRow(row)]))
  const modelIds = [...new Set([...policies.values()].flatMap((policy) => policy.modelIds))]
  const { models, connections, pricing } = await loadModelSnapshots(db, organizationId, modelIds, now)
  return { loadedAt: now.getTime(), timezone: timezoneRow.rows[0]?.timezone ?? "America/Fortaleza", policies, models, connections, pricing, budgets: budgetRows.rows.map(budgetFromRow), legacyPricing: legacyPricingOf(legacyPricingRows.rows) }
}

/** Agrupa os preços por provider × id do modelo; o mesmo id cadastrado em duas conexões = ambíguo (null), nunca um palpite. */
type LegacyPricingRow = Omit<PricingRow, "id" | "model_id"> & { id: string | null; model_id: string | null; provider_key: string; provider_model_id: string; ai_model_id: string }

function legacyPricingOf(rows: LegacyPricingRow[]): Map<string, AiPricingVersion[] | null> {
  const modelsByKey = new Map<string, Set<string>>()
  const versionsByModel = new Map<string, AiPricingVersion[]>()
  for (const row of rows) {
    const key = legacyPricingKey(row.provider_key, row.provider_model_id)
    const modelId = row.ai_model_id
    modelsByKey.set(key, (modelsByKey.get(key) ?? new Set()).add(modelId))
    if (row.id && row.model_id) versionsByModel.set(modelId, [...(versionsByModel.get(modelId) ?? []), pricingFromRow({ ...row, id: row.id, model_id: row.model_id })])
  }
  const result = new Map<string, AiPricingVersion[] | null>()
  for (const [key, modelIds] of modelsByKey) {
    const only = modelIds.size === 1 ? [...modelIds][0]! : null
    result.set(key, only === null ? null : (versionsByModel.get(only) ?? []))
  }
  return result
}

export type MonthSpendRow = { use_case: string; provider_key: string; currency: string | null; amount: string | null; unknown_calls: number }

/** Gasto do mês corrente (fuso da organização) por Use Case × provider × moeda — UMA consulta, base de todos os orçamentos. */
export async function loadMonthSpend(db: Queryable, organizationId: string, now: Date): Promise<MonthSpendRow[]> {
  const result = await db.query<MonthSpendRow>(
    `with bounds as (select date_trunc('month', $2::timestamptz at time zone ${ORG_TIMEZONE_SQL}) at time zone ${ORG_TIMEZONE_SQL} month_start)
     select use_case, provider_key, currency, sum(cost)::text amount, count(*) filter (where cost_status = 'UNKNOWN' and status = 'SUCCESS')::int unknown_calls
       from ai_usage_events, bounds
      where organization_id = $1 and occurred_at >= bounds.month_start and occurred_at <= $2
      group by use_case, provider_key, currency`,
    [organizationId, now],
  )
  return result.rows
}

export type UsageRow = AiUsageEventInput & { workflow?: AiWorkflowCorrelation | null; limiter?: AiCallLimiterRecord | null; cost: string | null; currency: string | null; costStatus: "EXACT" | "ESTIMATED" | "UNKNOWN"; costUnknownReason: "NO_PRICING" | "NO_USAGE" | null; pricingId: string | null; pricingSource: "TABLE" | "LEGACY_ENV" | "NONE"; policyId: string | null }

export async function insertUsageEvent(db: Queryable, row: UsageRow): Promise<void> {
  const usage = row.usage
  await db.query(
    `insert into ai_usage_events (organization_id, occurred_at, use_case, purpose, phase, source, origin, provider_key, connection_id, model_id, model_name, is_local, correlation_id, attempt, fallback_index,
       input_tokens, output_tokens, reasoning_tokens, cached_tokens, total_tokens, cost, currency, cost_status, cost_unknown_reason, pricing_id, pricing_source, duration_ms, status, error_category, routing_mode, policy_id, route_reason, fallback_reason,
       call_priority, call_priority_reason, queue_wait_ms, queue_reason, limiter_attempt,
       workflow_id, workflow_version_id, enrollment_id, root_enrollment_id, workflow_node_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43)`,
    [
      row.organizationId, row.occurredAt, row.useCase, row.purpose, row.phase, row.source, row.origin, row.providerKey, row.connectionId, row.modelId, row.modelName, row.isLocal, row.correlationId, row.attempt, row.fallbackIndex,
      usage?.promptTokens ?? null, usage?.outputTokens ?? null, usage?.reasoningTokens ?? null, usage?.cachedInputTokens ?? null, usage?.totalTokens ?? null,
      row.cost, row.currency, row.costStatus, row.costUnknownReason, row.pricingId, row.pricingSource, row.durationMs, row.status, row.errorCategory, row.routingMode, row.policyId, row.routeReason, row.fallbackReason,
      row.limiter?.priority ?? null, row.limiter?.priorityReason ?? null, row.limiter?.queueWaitMs ?? null, row.limiter?.queueReason ?? null, row.limiter?.attempt ?? null,
      row.workflow?.workflowId ?? null, row.workflow?.workflowVersionId ?? null, row.workflow?.enrollmentId ?? null, row.workflow?.rootEnrollmentId ?? null, row.workflow?.nodeId ?? null,
    ],
  )
}
