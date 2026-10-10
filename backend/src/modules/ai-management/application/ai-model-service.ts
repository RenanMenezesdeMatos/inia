import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AiProviderError } from "../../../shared/application/model-routing/ai-errors.js"
import { AI_CAPABILITIES, AI_MODEL_KINDS, AI_QUALITY_TIERS, type ModelCapabilities } from "../domain/ai-capabilities.js"
import { findAiProvider } from "../domain/ai-provider-catalog.js"
import { computeCallCost, pricingAt, validatePricingInput, type AiPricingVersion } from "../domain/ai-pricing.js"
import { localCostLabel } from "../domain/ai-routing-policy.js"
import { SPEECH_INSTRUCTIONS_MAX_LENGTH, SPEECH_VOICE_PATTERN, speechSettingsOf, type SpeechSettings } from "../domain/ai-speech.js"
import { auditAi, type Actor, type AiAdminContext } from "./ai-admin-context.js"
import { runtimeConnection } from "./ai-connection-service.js"
import { resolveConnection } from "./ai-runtime-service.js"
import { insertUsageEvent, pricingFromRow } from "./ai-runtime-store.js"

/**
 * MODELOS e PREÇOS (§12–§14, §41–§44, §62, §65, §67–§69, §81). Modelo = algo utilizável por UMA
 * conexão; o `providerModelId` nunca muda (o nome amigável sim). Preço é VERSIONADO: novo preço
 * fecha o vigente, nunca o sobrescreve.
 */
const capabilityClaim = z.object({ supported: z.boolean() })
const capabilitiesInput = z.partialRecord(z.enum(AI_CAPABILITIES), capabilityClaim)

export const modelCreateSchema = z.object({
  connectionId: z.uuid(),
  providerModelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(AI_MODEL_KINDS).optional(),
  contextWindow: z.number().int().positive().nullish(),
  maxOutputTokens: z.number().int().positive().nullish(),
  capabilities: capabilitiesInput.optional(),
  qualityTier: z.enum(AI_QUALITY_TIERS).nullish(),
  timeoutMs: z.number().int().min(1000).max(300_000).nullish(),
  enabled: z.boolean().optional(),
})

export const modelPatchSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  enabled: z.boolean().optional(),
  contextWindow: z.number().int().positive().nullish(),
  maxOutputTokens: z.number().int().positive().nullish(),
  capabilities: capabilitiesInput.optional(),
  qualityTier: z.enum(AI_QUALITY_TIERS).nullish(),
  timeoutMs: z.number().int().min(1000).max(300_000).nullish(),
  /** Voz para síntese de voz (Use Case SPEECH_SYNTHESIS): nome da voz do provider + instrução de tom opcional; null = sem voz. */
  speech: z.object({ voice: z.string().trim().regex(SPEECH_VOICE_PATTERN, "Nome de voz inválido."), instructions: z.string().trim().max(SPEECH_INSTRUCTIONS_MAX_LENGTH).nullish() }).nullish(),
  /** Desabilitar modelo de política ATIVA exige confirmação explícita (a política fica inválida — §62). */
  acknowledgeActivePolicyImpact: z.boolean().optional(),
})

const decimalString = z.union([z.string().trim(), z.number()]).transform((value) => String(value))
export const pricingCreateSchema = z.object({
  currency: z.string().trim().toUpperCase(),
  inputPerMillion: decimalString,
  outputPerMillion: decimalString,
  cachedInputPerMillion: decimalString.nullish(),
  reasoningPerMillion: decimalString.nullish(),
  effectiveFrom: z.coerce.date().optional(),
  note: z.string().trim().max(300).nullish(),
})

export type PricingView = { id: string; currency: string; inputPerMillion: string; outputPerMillion: string; cachedInputPerMillion: string | null; reasoningPerMillion: string | null; effectiveFrom: string; effectiveTo: string | null; note: string | null }

export type ModelView = {
  id: string
  connectionId: string
  connectionName: string
  connectionEnabled: boolean
  providerKey: string
  providerName: string | null
  providerModelId: string
  displayName: string
  enabled: boolean
  kind: string
  origin: string
  contextWindow: number | null
  maxOutputTokens: number | null
  capabilities: ModelCapabilities
  qualityTier: string | null
  timeoutMs: number | null
  /** Voz para síntese de voz (null = sem voz cadastrada). */
  speech: SpeechSettings | null
  isLocal: boolean
  lastSeenAt: string | null
  missingFromLastSync: boolean
  currentPricing: PricingView | null
  /** Local: API_COST_ZERO ≠ custo computacional (não medido) — §44. */
  costLabel: "NOT_LOCAL" | "API_COST_ZERO" | "API_COST_UNKNOWN" | "API_COST_CONFIGURED"
  usage30d: { requests: number; errors: number; costByCurrency: Record<string, string> }
  policies: { useCase: string; status: string }[]
}

type ModelRow = {
  id: string
  connection_id: string
  connection_name: string
  connection_enabled: boolean
  provider_key: string
  is_local: boolean
  provider_model_id: string
  display_name: string
  enabled: boolean
  kind: string
  origin: string
  context_window: number | null
  max_output_tokens: number | null
  capabilities: ModelCapabilities
  quality_tier: string | null
  timeout_ms: number | null
  last_seen_at: Date | null
  metadata: Record<string, unknown>
  policies: { useCase: string; status: string }[] | null
}

type PricingRow = Parameters<typeof pricingFromRow>[0]

const MODEL_SELECT = `
  select m.id, m.connection_id, c.name connection_name, c.enabled connection_enabled, c.provider_key, c.is_local, m.provider_model_id, m.display_name, m.enabled, m.kind, m.origin,
         m.context_window, m.max_output_tokens, m.capabilities, m.quality_tier, m.timeout_ms, m.last_seen_at, m.metadata,
         (select json_agg(json_build_object('useCase', p.use_case, 'status', p.status)) from ai_routing_policies p join ai_routing_policy_models pm on pm.policy_id = p.id
           where pm.model_id = m.id and p.status in ('ACTIVE', 'DRAFT')) policies
    from ai_models m join ai_connections c on c.id = m.connection_id`

function pricingView(pricing: AiPricingVersion): PricingView {
  return { id: pricing.id, currency: pricing.currency, inputPerMillion: pricing.inputPerMillion, outputPerMillion: pricing.outputPerMillion, cachedInputPerMillion: pricing.cachedInputPerMillion, reasoningPerMillion: pricing.reasoningPerMillion, effectiveFrom: pricing.effectiveFrom.toISOString(), effectiveTo: pricing.effectiveTo?.toISOString() ?? null, note: pricing.note }
}

async function loadViews(context: AiAdminContext, organizationId: string, where: string, params: unknown[]): Promise<ModelView[]> {
  const rows = await context.db.query<ModelRow>(`${MODEL_SELECT} where m.organization_id = $1 ${where} order by c.name, m.display_name`, [organizationId, ...params])
  if (rows.rows.length === 0) return []
  const ids = rows.rows.map((row) => row.id)
  const now = context.now()
  const [pricing, usage] = await Promise.all([
    context.db.query<PricingRow>(`select id, model_id, currency, input_per_million::text, output_per_million::text, cached_input_per_million::text, reasoning_per_million::text, effective_from, effective_to, note from ai_model_pricing where organization_id = $1 and model_id = any($2::uuid[]) and effective_from <= $3 and (effective_to is null or effective_to > $3)`, [organizationId, ids, now]),
    context.db.query<{ model_id: string; currency: string | null; requests: number; errors: number; cost: string | null }>(
      `select model_id, currency, count(distinct correlation_id)::int requests, count(*) filter (where status = 'ERROR')::int errors, sum(cost)::text cost
         from ai_usage_events where organization_id = $1 and model_id = any($2::uuid[]) and occurred_at > $3::timestamptz - interval '30 days'
        group by model_id, currency`,
      [organizationId, ids, now],
    ),
  ])
  const currentPricing = new Map(pricing.rows.map((row) => [row.model_id, pricingFromRow(row)]))
  return rows.rows.map((row) => {
    const provider = findAiProvider(row.provider_key)
    const price = currentPricing.get(row.id) ?? null
    const isLocal = provider ? provider.deployment === "LOCAL" || (provider.deployment === "REMOTE_OR_LOCAL" && row.is_local) : row.is_local
    const usageRows = usage.rows.filter((item) => item.model_id === row.id)
    const costByCurrency: Record<string, string> = {}
    for (const item of usageRows) if (item.currency && item.cost) costByCurrency[item.currency] = item.cost
    return {
      id: row.id,
      connectionId: row.connection_id,
      connectionName: row.connection_name,
      connectionEnabled: row.connection_enabled,
      providerKey: row.provider_key,
      providerName: provider?.name ?? null,
      providerModelId: row.provider_model_id,
      displayName: row.display_name,
      enabled: row.enabled,
      kind: row.kind,
      origin: row.origin,
      contextWindow: row.context_window,
      maxOutputTokens: row.max_output_tokens,
      capabilities: row.capabilities ?? {},
      qualityTier: row.quality_tier,
      timeoutMs: row.timeout_ms,
      speech: speechSettingsOf(row.metadata),
      isLocal,
      lastSeenAt: row.last_seen_at?.toISOString() ?? null,
      missingFromLastSync: row.metadata?.missingFromLastSync === true,
      currentPricing: price ? pricingView(price) : null,
      costLabel: localCostLabel({ isLocal, pricing: price }),
      usage30d: { requests: usageRows.reduce((sum, item) => sum + item.requests, 0), errors: usageRows.reduce((sum, item) => sum + item.errors, 0), costByCurrency },
      policies: row.policies ?? [],
    }
  })
}

export async function listModels(context: AiAdminContext, organizationId: string, filter: { connectionId?: string | undefined } = {}): Promise<ModelView[]> {
  return filter.connectionId ? loadViews(context, organizationId, "and m.connection_id = $2", [filter.connectionId]) : loadViews(context, organizationId, "", [])
}

export async function getModel(context: AiAdminContext, organizationId: string, id: string): Promise<ModelView> {
  const [model] = await loadViews(context, organizationId, "and m.id = $2", [id])
  if (!model) throw new DomainError("Modelo não encontrado.", "AI_MODEL_NOT_FOUND", 404)
  return model
}

/** Capacidade informada pelo admin = MANUAL (§67). */
function manualCapabilities(current: ModelCapabilities, input: Partial<Record<string, { supported: boolean }>> | undefined): ModelCapabilities {
  if (!input) return current
  const next: ModelCapabilities = { ...current }
  for (const capability of AI_CAPABILITIES) {
    const claim = input[capability]
    if (claim) next[capability] = { supported: claim.supported, source: "MANUAL" }
  }
  return next
}

export async function createModel(context: AiAdminContext, actor: Actor, rawInput: unknown): Promise<ModelView> {
  const input = modelCreateSchema.parse(rawInput)
  const connection = await context.db.query<{ id: string }>(`select id from ai_connections where organization_id = $1 and id = $2`, [actor.organizationId, input.connectionId])
  if (!connection.rows[0]) throw new DomainError("Conexão não encontrada.", "AI_CONNECTION_NOT_FOUND", 404)
  let id: string
  try {
    const inserted = await context.db.query<{ id: string }>(
      `insert into ai_models (organization_id, connection_id, provider_model_id, display_name, enabled, kind, context_window, max_output_tokens, capabilities, quality_tier, timeout_ms, origin, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'MANUAL', $12, $12) returning id`,
      [actor.organizationId, input.connectionId, input.providerModelId, input.displayName ?? input.providerModelId, input.enabled ?? true, input.kind ?? "GENERATIVE", input.contextWindow ?? null, input.maxOutputTokens ?? null, JSON.stringify(manualCapabilities({}, input.capabilities)), input.qualityTier ?? null, input.timeoutMs ?? null, context.now()],
    )
    id = inserted.rows[0]!.id
  } catch (error) {
    if ((error as { code?: string }).code === "23505") throw new DomainError("Este modelo já está cadastrado nesta conexão.", "AI_MODEL_DUPLICATE", 409)
    throw error
  }
  await auditAi(context.db, actor, "AI_MODEL_CREATED", "ai_model", id, { connectionId: input.connectionId, providerModelId: input.providerModelId })
  context.runtime.invalidate(actor.organizationId)
  return getModel(context, actor.organizationId, id)
}

export async function updateModel(context: AiAdminContext, actor: Actor, id: string, rawInput: unknown): Promise<ModelView> {
  const input = modelPatchSchema.parse(rawInput)
  const current = await getModel(context, actor.organizationId, id)
  const activeUseCases = current.policies.filter((policy) => policy.status === "ACTIVE").map((policy) => policy.useCase)
  if (input.enabled === false && current.enabled && activeUseCases.length > 0 && !input.acknowledgeActivePolicyImpact) {
    throw new DomainError(`Este modelo atende política(s) ativa(s): ${activeUseCases.join(", ")}. Desabilitá-lo deixa essas políticas sem esse candidato (sem troca silenciosa de modelo). Confirme para prosseguir.`, "AI_MODEL_IN_USE_ACTIVE", 409, { activeUseCases })
  }
  const sets: string[] = []
  const values: unknown[] = [actor.organizationId, id]
  const add = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }
  if (input.displayName !== undefined) add("display_name", input.displayName)
  if (input.enabled !== undefined) add("enabled", input.enabled)
  if (input.contextWindow !== undefined) add("context_window", input.contextWindow)
  if (input.maxOutputTokens !== undefined) add("max_output_tokens", input.maxOutputTokens)
  if (input.capabilities !== undefined) add("capabilities", JSON.stringify(manualCapabilities(current.capabilities, input.capabilities)))
  if (input.qualityTier !== undefined) add("quality_tier", input.qualityTier)
  if (input.timeoutMs !== undefined) add("timeout_ms", input.timeoutMs)
  if (input.speech !== undefined) {
    // Fica em metadata.speech (a sincronização preserva); null remove a voz.
    values.push(input.speech ? JSON.stringify({ voice: input.speech.voice, instructions: input.speech.instructions || null }) : null)
    sets.push(`metadata = (metadata - 'speech') || case when $${values.length}::jsonb is null then '{}'::jsonb else jsonb_build_object('speech', $${values.length}::jsonb) end`)
  }
  if (sets.length === 0) return current
  add("updated_at", context.now())
  await context.db.query(`update ai_models set ${sets.join(", ")} where organization_id = $1 and id = $2`, values)
  const action = input.enabled === false && current.enabled ? "AI_MODEL_DISABLED" : input.enabled === true && !current.enabled ? "AI_MODEL_ENABLED" : "AI_MODEL_UPDATED"
  await auditAi(context.db, actor, action, "ai_model", id, { fields: Object.keys(input).filter((key) => key !== "acknowledgeActivePolicyImpact"), activeUseCases })
  context.runtime.invalidate(actor.organizationId)
  return getModel(context, actor.organizationId, id)
}

export async function deleteModel(context: AiAdminContext, actor: Actor, id: string): Promise<void> {
  const current = await getModel(context, actor.organizationId, id)
  if (current.policies.length > 0) throw new DomainError(`O modelo é usado por política(s) (${current.policies.map((policy) => `${policy.useCase} ${policy.status === "ACTIVE" ? "ativa" : "rascunho"}`).join(", ")}). Remova-o das políticas antes.`, "AI_MODEL_IN_USE", 409, { policies: current.policies })
  const client = await context.db.connect()
  try {
    await client.query("begin")
    await client.query(`delete from ai_routing_policy_models where model_id = $1`, [id])
    await client.query(`delete from ai_model_pricing where organization_id = $1 and model_id = $2`, [actor.organizationId, id])
    await client.query(`delete from ai_models where organization_id = $1 and id = $2`, [actor.organizationId, id])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  await auditAi(context.db, actor, "AI_MODEL_DELETED", "ai_model", id, { providerModelId: current.providerModelId })
  context.runtime.invalidate(actor.organizationId)
}

export async function listPricing(context: AiAdminContext, organizationId: string, modelId: string): Promise<PricingView[]> {
  await getModel(context, organizationId, modelId)
  const rows = await context.db.query<PricingRow>(`select id, model_id, currency, input_per_million::text, output_per_million::text, cached_input_per_million::text, reasoning_per_million::text, effective_from, effective_to, note from ai_model_pricing where organization_id = $1 and model_id = $2 order by effective_from desc`, [organizationId, modelId])
  return rows.rows.map((row) => pricingView(pricingFromRow(row)))
}

/**
 * Nova versão de preço (§41–§43): fecha a vigente em `effectiveFrom` — nunca a sobrescreve. Não
 * é permitido começar antes do início da vigente (não se reescreve o passado; custos já gravados
 * guardam o id da versão aplicada e continuam reproduzíveis).
 */
export async function addPricing(context: AiAdminContext, actor: Actor, modelId: string, rawInput: unknown): Promise<PricingView[]> {
  const input = pricingCreateSchema.parse(rawInput)
  await getModel(context, actor.organizationId, modelId)
  const effectiveFrom = input.effectiveFrom ?? context.now()
  const issues = validatePricingInput({ currency: input.currency, inputPerMillion: input.inputPerMillion, outputPerMillion: input.outputPerMillion, cachedInputPerMillion: input.cachedInputPerMillion ?? null, reasoningPerMillion: input.reasoningPerMillion ?? null, effectiveFrom })
  if (issues.length > 0) throw new DomainError(issues.join(" "), "AI_PRICING_INVALID", 422, { issues })
  const client = await context.db.connect()
  try {
    await client.query("begin")
    const open = await client.query<{ id: string; effective_from: Date }>(`select id, effective_from from ai_model_pricing where model_id = $1 and effective_to is null for update`, [modelId])
    const openRow = open.rows[0]
    if (openRow && effectiveFrom.getTime() <= new Date(openRow.effective_from).getTime()) {
      throw new DomainError("A nova vigência precisa começar depois do início do preço vigente (o histórico não é reescrito).", "AI_PRICING_OVERLAP", 422)
    }
    const later = await client.query(`select 1 from ai_model_pricing where model_id = $1 and effective_from >= $2`, [modelId, effectiveFrom])
    if ((later.rowCount ?? 0) > 0) throw new DomainError("Já existe preço com vigência posterior a esta data.", "AI_PRICING_OVERLAP", 422)
    if (openRow) await client.query(`update ai_model_pricing set effective_to = $2 where id = $1`, [openRow.id, effectiveFrom])
    await client.query(
      `insert into ai_model_pricing (organization_id, model_id, currency, input_per_million, output_per_million, cached_input_per_million, reasoning_per_million, effective_from, note, created_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [actor.organizationId, modelId, input.currency, input.inputPerMillion, input.outputPerMillion, input.cachedInputPerMillion ?? null, input.reasoningPerMillion ?? null, effectiveFrom, input.note ?? null, actor.personId, context.now()],
    )
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  await auditAi(context.db, actor, "AI_PRICING_CREATED", "ai_model", modelId, { currency: input.currency, inputPerMillion: input.inputPerMillion, outputPerMillion: input.outputPerMillion, cachedInputPerMillion: input.cachedInputPerMillion ?? null, reasoningPerMillion: input.reasoningPerMillion ?? null, effectiveFrom: effectiveFrom.toISOString() })
  context.runtime.invalidate(actor.organizationId)
  return listPricing(context, actor.organizationId, modelId)
}

export type ModelTestResult = { status: "OK" | "ERROR"; latencyMs: number; message: string; outputPreview: string | null; usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }; cost: { status: string; amount: string | null; currency: string | null }; testedAt: string }

/**
 * "Testar modelo" (§65): UMA requisição mínima real (pode gerar custo — a UI avisa antes). Não
 * repete, não faz fallback, registra o uso como MODEL_TEST/ADMIN_TEST no dashboard.
 */
export async function testModel(context: AiAdminContext, actor: Actor, id: string): Promise<ModelTestResult> {
  const model = await getModel(context, actor.organizationId, id)
  const connectionRuntime = await runtimeConnection(context, actor.organizationId, model.connectionId)
  const provider = findAiProvider(connectionRuntime.providerKey)
  if (!provider) throw new DomainError("Provider desconhecido.", "AI_PROVIDER_UNKNOWN", 422)
  const pricingRows = await context.db.query<PricingRow>(`select id, model_id, currency, input_per_million::text, output_per_million::text, cached_input_per_million::text, reasoning_per_million::text, effective_from, effective_to, note from ai_model_pricing where organization_id = $1 and model_id = $2`, [actor.organizationId, id])
  const testedAt = context.now()
  const pricing = pricingAt(pricingRows.rows.map(pricingFromRow), testedAt)
  const startedAt = Date.now()
  const correlationId = crypto.randomUUID()
  const base = { organizationId: actor.organizationId, occurredAt: testedAt, useCase: "MODEL_TEST" as const, purpose: "MODEL_TEST", phase: null, source: null, origin: "ADMIN_TEST" as const, providerKey: connectionRuntime.providerKey, connectionId: connectionRuntime.id, modelId: id, modelName: model.providerModelId, isLocal: model.isLocal, correlationId, attempt: 1, fallbackIndex: 0, routingMode: "PINNED" as const, routeReason: "ADMIN_MODEL_TEST", fallbackReason: null, policyId: null }
  try {
    const connection = resolveConnection(connectionRuntime)
    const adapter = context.adapters(provider.adapterType)
    // Modelo de VOZ (voz cadastrada + protocolo com síntese): o teste lê uma frase curta — pedir texto a um modelo de TTS falharia.
    if (model.speech && adapter.synthesizeSpeech) {
      const spoken = await adapter.synthesizeSpeech(connection, model.providerModelId, { text: "Olá! Este é um teste da voz da INIA.", voice: model.speech.voice, instructions: model.speech.instructions }, model.timeoutMs ?? connection.timeoutMs)
      const cost = computeCallCost(spoken.usage, pricing)
      await insertUsageEvent(context.db, { ...base, usage: spoken.usage, durationMs: spoken.durationMs, status: "SUCCESS", errorCategory: null, cost: cost.status === "ESTIMATED" ? cost.amount : null, currency: cost.currency, costStatus: cost.status, costUnknownReason: cost.status === "UNKNOWN" ? cost.reason : null, pricingId: cost.pricingId, pricingSource: cost.pricingId ? "TABLE" : "NONE" })
      const seconds = (spoken.pcm16.length / 2 / spoken.sampleRate).toFixed(1)
      return { status: "OK", latencyMs: Date.now() - startedAt, message: "O modelo devolveu áudio.", outputPreview: `Áudio de ${seconds} s (${spoken.sampleRate} Hz) com a voz "${model.speech.voice}".`, usage: { inputTokens: spoken.usage.promptTokens, outputTokens: spoken.usage.outputTokens, totalTokens: spoken.usage.totalTokens }, cost: { status: cost.status, amount: cost.status === "ESTIMATED" ? cost.amount : null, currency: cost.currency }, testedAt: testedAt.toISOString() }
    }
    const result = await adapter.execute(connection, model.providerModelId, { systemPrompt: "Você é um teste de conectividade. Responda apenas com a palavra OK.", contents: [{ role: "user", text: "Teste" }], tools: [], structuredOutput: false, maxOutputTokens: 16 }, model.timeoutMs ?? connection.timeoutMs)
    const cost = computeCallCost(result.usage, pricing)
    await insertUsageEvent(context.db, { ...base, usage: result.usage, durationMs: result.durationMs, status: "SUCCESS", errorCategory: null, cost: cost.status === "ESTIMATED" ? cost.amount : null, currency: cost.currency, costStatus: cost.status, costUnknownReason: cost.status === "UNKNOWN" ? cost.reason : null, pricingId: cost.pricingId, pricingSource: cost.pricingId ? "TABLE" : "NONE" })
    const text = result.kind === "text" ? result.text : ""
    return { status: "OK", latencyMs: Date.now() - startedAt, message: "O modelo respondeu.", outputPreview: text.slice(0, 200) || null, usage: { inputTokens: result.usage.promptTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }, cost: { status: cost.status, amount: cost.status === "ESTIMATED" ? cost.amount : null, currency: cost.currency }, testedAt: testedAt.toISOString() }
  } catch (error) {
    const category = error instanceof AiProviderError ? error.category : "UNKNOWN"
    await insertUsageEvent(context.db, { ...base, usage: null, durationMs: Date.now() - startedAt, status: "ERROR", errorCategory: category, cost: null, currency: null, costStatus: "UNKNOWN", costUnknownReason: null, pricingId: null, pricingSource: "NONE" })
    return { status: "ERROR", latencyMs: Date.now() - startedAt, message: error instanceof AiProviderError ? error.message : "Erro inesperado ao testar o modelo.", outputPreview: null, usage: { inputTokens: null, outputTokens: null, totalTokens: null }, cost: { status: "UNKNOWN", amount: null, currency: null }, testedAt: testedAt.toISOString() }
  } finally {
    context.runtime.invalidate(actor.organizationId)
  }
}

