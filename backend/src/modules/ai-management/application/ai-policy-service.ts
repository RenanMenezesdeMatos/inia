import { z } from "zod"
import { env } from "../../../config/env.js"
import { INIA_LIVE_MODEL, iniaVoiceName } from "../../../config/inia-voice.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { FALLBACK_ELIGIBLE_CATEGORIES } from "../../../shared/application/model-routing/ai-errors.js"
import { AI_USE_CASES, findUseCase, type AiUseCaseDefinition } from "../../../shared/application/model-routing/ai-use-cases.js"
import { listModelProfiles } from "../../../shared/application/model-routing/model-registry.js"
import { listModelPricing } from "../../../shared/application/model-routing/model-pricing.js"
import { resolveRoute, type RoutePurpose } from "../../../shared/application/model-routing/route-policy.js"
import { legacyProviderKey } from "../../../shared/application/model-routing/llm-gateway.js"
import { AI_AUTO_STRATEGIES, AI_ROUTING_MODES, defaultFallbackOn, planRoute, validatePolicy, type ModelSnapshot, type PolicyIssue, type PolicySnapshot } from "../domain/ai-routing-policy.js"
import { auditAi, type Actor, type AiAdminContext } from "./ai-admin-context.js"
import { loadModelSnapshots, POLICY_SELECT, policyFromRow } from "./ai-runtime-store.js"

/**
 * POLÍTICAS DE ROTEAMENTO por Use Case (§21–§32, §62–§64, §82, §86–§88). Ciclo DRAFT → ACTIVE:
 * o admin configura o rascunho (pode estar inválido), "Testar roteamento" faz o plano SEM chamada
 * paga, e só um rascunho VÁLIDO é ativado. Desativar volta o Use Case para a configuração legada
 * do ambiente — explicitamente, nunca por falha.
 */
export const policyDraftSchema = z.object({
  mode: z.enum(AI_ROUTING_MODES),
  strategy: z.enum(AI_AUTO_STRATEGIES).nullish(),
  modelIds: z.array(z.uuid()).max(20),
  fallbackOn: z.array(z.enum(FALLBACK_ELIGIBLE_CATEGORIES)).optional(),
  maxEstimatedCostPerRequest: z.union([z.string().trim().regex(/^\d+(\.\d+)?$/), z.number().nonnegative()]).transform(String).nullish(),
  costCurrency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).nullish(),
})

export type PolicyModelView = { modelId: string; displayName: string | null; providerModelId: string | null; connectionName: string | null; providerKey: string | null; enabled: boolean; available: boolean }
export type PolicyView = { id: string; status: string; mode: string; strategy: string | null; fallbackOn: string[]; maxEstimatedCostPerRequest: string | null; costCurrency: string | null; models: PolicyModelView[]; issues: PolicyIssue[]; valid: boolean; version: number; updatedAt: string; activatedAt: string | null }
export type LegacyRouteView = { providerKey: string; model: string; tier: string; mode: string; reason: string } | null
export type UseCaseRoutingView = { useCase: Pick<AiUseCaseDefinition, "key" | "label" | "description" | "group" | "requiredCapabilities" | "preferredCapabilities" | "routable" | "requiresSpeechVoice" | "notes">; active: PolicyView | null; draft: PolicyView | null; effective: "POLICY" | "LEGACY"; legacy: LegacyRouteView }

type PolicyRowExtra = { version: number; updated_at: Date; activated_at: Date | null }

/** Rota LEGADA de um Use Case (§86): o que roda hoje sem policy — modelo e tier, nunca segredo. */
export function legacyRouteFor(useCase: AiUseCaseDefinition): LegacyRouteView {
  const purpose = useCase.purposes[0]?.split(" ")[0]
  if (useCase.key === "CHAT" || useCase.key === "VOICE_REALTIME") return { providerKey: "GOOGLE_GENAI", model: useCase.key === "CHAT" ? "gemini-3.1-flash-lite" : "gemini-2.5-flash-native-audio-latest", tier: "—", mode: "fixo no cliente legado", reason: "cliente legado dedicado" }
  if (useCase.key === "SPEECH_SYNTHESIS") return { providerKey: "GOOGLE_GENAI", model: `${INIA_LIVE_MODEL.replace(/^models\//, "")} / ${env.INIA_AVATAR_TTS_MODEL}`, tier: "—", mode: "fixo por ambiente", reason: `voz da conversa (Gemini Live) conferida pela transcrição, com o TTS do Gemini como reserva — voz "${iniaVoiceName()}"` }
  // O motor de feedback não passa pela política de tiers: sem policy, a análise sai sempre pelo modelo fixo do motor
  // (feedback-engine/infrastructure/gateway-engine-model.ts › ENGINE_MODEL).
  if (useCase.key === "FEEDBACK_ANALYSIS") return { providerKey: "GOOGLE_GENAI", model: "gemini-3.8-flash", tier: "—", mode: "fixo no motor", reason: "rota fixa do motor de feedback (sem fallback ou escalação)" }
  if (useCase.key === "FEEDBACK_WRITER") return { providerKey: "GOOGLE_GENAI", model: "gemini-3.8-flash / gemini-3.1-flash-lite", tier: "—", mode: "fixo por etapa", reason: "rotas fixas de sempre: motor de feedback e verificação da narrativa no 3.8 Flash; redatores e narrativas no 3.1 Flash-Lite (sem fallback ou escalação)" }
  if (!purpose || useCase.internal) return null
  try {
    const route = resolveRoute({ purpose: purpose as RoutePurpose, phase: "SYNTHESIS" }, env.INIA_MODEL_ROUTING)
    return { providerKey: legacyProviderKey(route.profile.provider), model: route.profile.model, tier: route.tier, mode: route.mode, reason: route.reason }
  } catch {
    return null
  }
}

export function legacyEnvironmentSummary() {
  return {
    credentialConfigured: Boolean(env.GEMINI_API_KEY),
    routingMode: env.INIA_MODEL_ROUTING,
    profiles: listModelProfiles().map((profile) => ({ id: profile.id, providerKey: legacyProviderKey(profile.provider), model: profile.model, tier: profile.tier, enabled: profile.enabled })),
    pricingConfigured: listModelPricing().length > 0,
    profilesOverridden: Boolean(env.INIA_MODEL_PROFILES),
  }
}

async function loadPolicies(context: AiAdminContext, organizationId: string, statuses: string[]): Promise<(PolicySnapshot & PolicyRowExtra)[]> {
  const rows = await context.db.query<Parameters<typeof policyFromRow>[0] & PolicyRowExtra>(`${POLICY_SELECT.replace("select p.id,", "select p.version, p.updated_at, p.activated_at, p.id,")} where p.organization_id = $1 and p.status = any($2::text[])`, [organizationId, statuses])
  return rows.rows.map((row) => ({ ...policyFromRow(row), version: row.version, updated_at: row.updated_at, activated_at: row.activated_at }))
}

function toView(policy: PolicySnapshot & PolicyRowExtra, models: ReadonlyMap<string, ModelSnapshot>): PolicyView {
  const issues = validatePolicy(policy, findUseCase(policy.useCase), models)
  return {
    id: policy.id,
    status: policy.status,
    mode: policy.mode,
    strategy: policy.strategy,
    fallbackOn: policy.fallbackOn,
    maxEstimatedCostPerRequest: policy.maxEstimatedCostPerRequest,
    costCurrency: policy.costCurrency,
    models: policy.modelIds.map((modelId) => {
      const model = models.get(modelId)
      return { modelId, displayName: model?.displayName ?? null, providerModelId: model?.providerModelId ?? null, connectionName: model?.connection.name ?? null, providerKey: model?.connection.providerKey ?? null, enabled: Boolean(model?.enabled && model.connection.enabled), available: Boolean(model) }
    }),
    issues,
    valid: issues.length === 0,
    version: policy.version,
    updatedAt: policy.updated_at.toISOString(),
    activatedAt: policy.activated_at?.toISOString() ?? null,
  }
}

export async function listRouting(context: AiAdminContext, organizationId: string): Promise<UseCaseRoutingView[]> {
  const policies = await loadPolicies(context, organizationId, ["ACTIVE", "DRAFT"])
  const { models } = await loadModelSnapshots(context.db, organizationId, [...new Set(policies.flatMap((policy) => policy.modelIds))], context.now())
  return AI_USE_CASES.filter((useCase) => !useCase.internal).map((useCase) => {
    const active = policies.find((policy) => policy.useCase === useCase.key && policy.status === "ACTIVE")
    const draft = policies.find((policy) => policy.useCase === useCase.key && policy.status === "DRAFT")
    const { key, label, description, group, requiredCapabilities, preferredCapabilities, routable, requiresSpeechVoice, notes } = useCase
    return { useCase: { key, label, description, group, requiredCapabilities, preferredCapabilities, routable, ...(requiresSpeechVoice ? { requiresSpeechVoice } : {}), ...(notes ? { notes } : {}) }, active: active ? toView(active, models) : null, draft: draft ? toView(draft, models) : null, effective: active ? "POLICY" : "LEGACY", legacy: legacyRouteFor(useCase) }
  })
}

function requireRoutableUseCase(key: string): AiUseCaseDefinition {
  const useCase = findUseCase(key)
  if (!useCase || useCase.internal) throw new DomainError("Use Case desconhecido.", "AI_USE_CASE_UNKNOWN", 404)
  if (!useCase.routable) throw new DomainError(`"${useCase.label}" não é configurável nesta versão.`, "AI_USE_CASE_NOT_ROUTABLE", 422)
  return useCase
}

async function routingViewOf(context: AiAdminContext, organizationId: string, useCaseKey: string): Promise<UseCaseRoutingView> {
  const view = (await listRouting(context, organizationId)).find((item) => item.useCase.key === useCaseKey)
  if (!view) throw new DomainError("Use Case desconhecido.", "AI_USE_CASE_UNKNOWN", 404)
  return view
}

/** Salva (cria ou substitui) o RASCUNHO do Use Case — pode estar inválido; a ativação é que exige validade. */
export async function saveDraft(context: AiAdminContext, actor: Actor, useCaseKey: string, rawInput: unknown): Promise<UseCaseRoutingView> {
  requireRoutableUseCase(useCaseKey)
  const input = policyDraftSchema.parse(rawInput)
  const owned = input.modelIds.length > 0 ? await context.db.query<{ id: string }>(`select id from ai_models where organization_id = $1 and id = any($2::uuid[])`, [actor.organizationId, input.modelIds]) : { rows: [] }
  // Modelo de outra organização nunca entra (nem por id adivinhado).
  if (owned.rows.length !== new Set(input.modelIds).size) throw new DomainError("Um ou mais modelos não existem nesta organização.", "AI_MODEL_NOT_FOUND", 404)
  let draftId = ""
  const client = await context.db.connect()
  try {
    await client.query("begin")
    const existing = await client.query<{ id: string; version: number }>(`select id, version from ai_routing_policies where organization_id = $1 and use_case = $2 and status = 'DRAFT' for update`, [actor.organizationId, useCaseKey])
    const active = await client.query<{ version: number }>(`select version from ai_routing_policies where organization_id = $1 and use_case = $2 and status = 'ACTIVE'`, [actor.organizationId, useCaseKey])
    const values = [input.mode, input.mode === "AUTO" ? (input.strategy ?? null) : null, input.fallbackOn ?? defaultFallbackOn(), input.maxEstimatedCostPerRequest ?? null, input.maxEstimatedCostPerRequest ? (input.costCurrency ?? null) : null, actor.personId, context.now()]
    let policyId: string
    if (existing.rows[0]) {
      policyId = existing.rows[0].id
      await client.query(`update ai_routing_policies set mode = $2, strategy = $3, fallback_on = $4, max_estimated_cost_per_request = $5, cost_currency = $6, updated_by = $7, updated_at = $8 where id = $1`, [policyId, ...values])
      await client.query(`delete from ai_routing_policy_models where policy_id = $1`, [policyId])
    } else {
      const inserted = await client.query<{ id: string }>(
        `insert into ai_routing_policies (organization_id, use_case, status, mode, strategy, fallback_on, max_estimated_cost_per_request, cost_currency, version, created_by, updated_by, created_at, updated_at)
         values ($1, $2, 'DRAFT', $3, $4, $5, $6, $7, $8, $9, $9, $10, $10) returning id`,
        [actor.organizationId, useCaseKey, ...values.slice(0, 5), (active.rows[0]?.version ?? 0) + 1, actor.personId, context.now()],
      )
      policyId = inserted.rows[0]!.id
    }
    for (const [position, modelId] of input.modelIds.entries()) await client.query(`insert into ai_routing_policy_models (policy_id, position, model_id) values ($1, $2, $3)`, [policyId, position, modelId])
    await client.query("commit")
    draftId = policyId
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  await auditAi(context.db, actor, "AI_ROUTING_DRAFT_SAVED", "ai_routing_policy", draftId, { useCase: useCaseKey, mode: input.mode, strategy: input.strategy ?? null, modelIds: input.modelIds, fallbackOn: input.fallbackOn ?? defaultFallbackOn() })
  return routingViewOf(context, actor.organizationId, useCaseKey)
}

/** Ativa o rascunho VÁLIDO: a ativa anterior é arquivada (histórico), o Use Case passa a usar a policy imediatamente. */
export async function activateDraft(context: AiAdminContext, actor: Actor, useCaseKey: string): Promise<UseCaseRoutingView> {
  requireRoutableUseCase(useCaseKey)
  const view = await routingViewOf(context, actor.organizationId, useCaseKey)
  if (!view.draft) throw new DomainError("Não há rascunho para ativar.", "AI_POLICY_DRAFT_NOT_FOUND", 404)
  if (!view.draft.valid) throw new DomainError(`A política não pode ser ativada: ${view.draft.issues.map((issue) => issue.message).join(" ")}`, "AI_POLICY_INVALID", 422, { issues: view.draft.issues })
  const client = await context.db.connect()
  try {
    await client.query("begin")
    await client.query(`update ai_routing_policies set status = 'ARCHIVED', updated_at = $3, updated_by = $4 where organization_id = $1 and use_case = $2 and status = 'ACTIVE'`, [actor.organizationId, useCaseKey, context.now(), actor.personId])
    await client.query(`update ai_routing_policies set status = 'ACTIVE', activated_at = $3, activated_by = $4, updated_at = $3 where organization_id = $1 and id = $2`, [actor.organizationId, view.draft.id, context.now(), actor.personId])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  await auditAi(context.db, actor, "AI_ROUTING_ACTIVATED", "ai_routing_policy", view.draft.id, { useCase: useCaseKey, mode: view.draft.mode, strategy: view.draft.strategy, models: view.draft.models.map((model) => model.modelId), previousActiveId: view.active?.id ?? null })
  context.runtime.invalidate(actor.organizationId)
  return routingViewOf(context, actor.organizationId, useCaseKey)
}

/** Volta explicitamente para a configuração legada do ambiente (a policy ativa é arquivada). */
export async function deactivatePolicy(context: AiAdminContext, actor: Actor, useCaseKey: string): Promise<UseCaseRoutingView> {
  requireRoutableUseCase(useCaseKey)
  const view = await routingViewOf(context, actor.organizationId, useCaseKey)
  if (!view.active) throw new DomainError("Não há política ativa.", "AI_POLICY_ACTIVE_NOT_FOUND", 404)
  await context.db.query(`update ai_routing_policies set status = 'ARCHIVED', updated_at = $3, updated_by = $4 where organization_id = $1 and id = $2`, [actor.organizationId, view.active.id, context.now(), actor.personId])
  await auditAi(context.db, actor, "AI_ROUTING_DEACTIVATED", "ai_routing_policy", view.active.id, { useCase: useCaseKey })
  context.runtime.invalidate(actor.organizationId)
  return routingViewOf(context, actor.organizationId, useCaseKey)
}

export async function discardDraft(context: AiAdminContext, actor: Actor, useCaseKey: string): Promise<UseCaseRoutingView> {
  const deleted = await context.db.query<{ id: string }>(`delete from ai_routing_policies where organization_id = $1 and use_case = $2 and status = 'DRAFT' returning id`, [actor.organizationId, useCaseKey])
  if (deleted.rows[0]) await auditAi(context.db, actor, "AI_ROUTING_DRAFT_DISCARDED", "ai_routing_policy", deleted.rows[0].id, { useCase: useCaseKey })
  return routingViewOf(context, actor.organizationId, useCaseKey)
}

export type RoutingTestResult = {
  useCase: string
  source: "ACTIVE" | "DRAFT" | "LEGACY"
  selected: { modelId: string; displayName: string; providerModelId: string; connectionName: string; providerKey: string; reason: string } | null
  chain: { position: number; modelId: string; displayName: string; providerKey: string; connectionName: string; reason: string; capabilities: string[]; pricing: { currency: string; inputPerMillion: string; outputPerMillion: string } | null; recentLatencyMs: number | null }[]
  skipped: { modelId: string; displayName: string | null; reason: string }[]
  notes: string[]
  requiredCapabilities: readonly string[]
  fallbackOn: string[]
  legacy: LegacyRouteView
  budgetBlocked: boolean
}

/** "Testar roteamento" (§64): o MESMO plano que o runtime faria — sem nenhuma chamada ao provider. */
export async function testRouting(context: AiAdminContext, organizationId: string, useCaseKey: string, options: { source?: "ACTIVE" | "DRAFT"; estimatedInputTokens?: number | null } = {}): Promise<RoutingTestResult> {
  const useCase = requireRoutableUseCase(useCaseKey)
  const policies = await loadPolicies(context, organizationId, [options.source ?? "ACTIVE"])
  const policy = policies.find((item) => item.useCase === useCaseKey) ?? null
  const legacy = legacyRouteFor(useCase)
  if (!policy) return { useCase: useCaseKey, source: "LEGACY", selected: null, chain: [], skipped: [], notes: ["Sem política — o Use Case usa a configuração legada do ambiente."], requiredCapabilities: useCase.requiredCapabilities, fallbackOn: [], legacy, budgetBlocked: false }
  const { models } = await loadModelSnapshots(context.db, organizationId, policy.modelIds, context.now())
  const plan = planRoute(policy, useCase, models, { estimatedInputTokens: options.estimatedInputTokens ?? null, now: context.now() })
  const evaluations = await context.runtime.budgetEvaluations(organizationId).catch(() => [])
  const chain = plan.candidates.map((candidate) => ({
    position: candidate.position,
    modelId: candidate.model.id,
    displayName: candidate.model.displayName,
    providerKey: candidate.model.connection.providerKey,
    connectionName: candidate.model.connection.name,
    reason: candidate.reason,
    capabilities: Object.entries(candidate.model.capabilities).filter(([, claim]) => claim?.supported).map(([capability, claim]) => `${capability} (${claim!.source})`),
    pricing: candidate.model.pricing ? { currency: candidate.model.pricing.currency, inputPerMillion: candidate.model.pricing.inputPerMillion, outputPerMillion: candidate.model.pricing.outputPerMillion } : null,
    recentLatencyMs: candidate.model.recentLatencyMs,
  }))
  const first = plan.candidates[0]
  return {
    useCase: useCaseKey,
    source: options.source ?? "ACTIVE",
    selected: first ? { modelId: first.model.id, displayName: first.model.displayName, providerModelId: first.model.providerModelId, connectionName: first.model.connection.name, providerKey: first.model.connection.providerKey, reason: first.reason } : null,
    chain,
    skipped: plan.skipped,
    notes: plan.notes,
    requiredCapabilities: useCase.requiredCapabilities,
    fallbackOn: policy.fallbackOn,
    legacy,
    budgetBlocked: evaluations.some((evaluation) => evaluation.hardLimitReached),
  }
}
