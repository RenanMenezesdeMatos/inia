import { z } from "zod"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { AiProviderError } from "../../../shared/application/model-routing/ai-errors.js"
import { mergeCapabilities, type ModelCapabilities } from "../domain/ai-capabilities.js"
import { AI_PROVIDERS, findAiProvider, isLocalDeployment, type AiProviderDefinition } from "../domain/ai-provider-catalog.js"
import { endpointProblem } from "../infrastructure/adapters/http.js"
import { auditAi, type Actor, type AiAdminContext } from "./ai-admin-context.js"
import { customHeaderProblem, encryptAiSecret, maskSecret, SECRET_KEY_VERSION, type SecretView } from "./ai-secrets.js"
import { resolveConnection } from "./ai-runtime-service.js"
import type { ConnectionRuntime } from "./ai-runtime-store.js"
import type { ConnectionTestResult } from "./provider-adapter-port.js"

/**
 * CONEXÕES DE IA (§7–§17, §61, §79, §80). A API key entra por aqui e NUNCA sai: a resposta traz
 * só `configured` + máscara. Substituir/remover revoga o segredo anterior (sem guardar o valor).
 */
export type ConnectionView = {
  id: string
  providerKey: string
  provider: { key: string; name: string; icon: string; deployment: string; credential: string; supportsModelDiscovery: boolean; supportsCustomHeaders: boolean; notes: string[] } | null
  name: string
  baseUrl: string | null
  effectiveBaseUrl: string | null
  apiVersion: string | null
  isLocal: boolean
  timeoutMs: number
  /** Chamadas simultâneas desta conexão somando TODAS as instâncias da INIA; null = sem teto próprio. */
  maxConcurrentCalls: number | null
  enabled: boolean
  credential: SecretView
  customHeaderNames: string[]
  health: { status: string | null; checkedAt: string | null; latencyMs: number | null; message: string | null }
  modelCount: number
  enabledModelCount: number
  lastUsedAt: string | null
  activePolicyUseCases: string[]
  createdAt: string
  updatedAt: string
}

const httpUrl = z.string().trim().max(500).refine((value) => endpointProblem(value) === null, { message: "Endpoint inválido (use http:// ou https://, sem usuário/senha na URL)." })

export const connectionCreateSchema = z.object({
  providerKey: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  baseUrl: httpUrl.nullish(),
  apiVersion: z.string().trim().max(40).nullish(),
  isLocal: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(1000).nullish(),
  apiKey: z.string().trim().min(4).max(4000).nullish(),
  customHeaders: z.record(z.string(), z.string().max(2000)).nullish(),
  enabled: z.boolean().optional(),
})

export const connectionPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  baseUrl: httpUrl.nullish(),
  apiVersion: z.string().trim().max(40).nullish(),
  isLocal: z.boolean().optional(),
  timeoutMs: z.number().int().min(1000).max(300_000).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(1000).nullish(),
  enabled: z.boolean().optional(),
})

export const secretSchema = z.object({ apiKey: z.string().trim().min(4).max(4000) })
export const headersSchema = z.object({ customHeaders: z.record(z.string(), z.string().max(2000)) })

type ConnectionRow = {
  id: string
  provider_key: string
  name: string
  base_url: string | null
  api_version: string | null
  is_local: boolean
  timeout_ms: number
  max_concurrent_calls: number | null
  enabled: boolean
  last_health_check_at: Date | null
  last_health_status: string | null
  last_health_latency_ms: number | null
  last_health_message: string | null
  created_at: Date
  updated_at: Date
  key_hint: string | null
  key_updated_at: Date | null
  header_hint: string | null
  model_count: number
  enabled_model_count: number
  last_used_at: Date | null
  active_use_cases: string[] | null
}

const CONNECTION_SELECT = `
  select c.id, c.provider_key, c.name, c.base_url, c.api_version, c.is_local, c.timeout_ms, c.max_concurrent_calls, c.enabled,
         c.last_health_check_at, c.last_health_status, c.last_health_latency_ms, c.last_health_message, c.created_at, c.updated_at,
         k.hint key_hint, k.created_at key_updated_at, h.hint header_hint,
         (select count(*)::int from ai_models m where m.connection_id = c.id) model_count,
         (select count(*)::int from ai_models m where m.connection_id = c.id and m.enabled) enabled_model_count,
         (select max(e.occurred_at) from ai_usage_events e where e.organization_id = c.organization_id and e.connection_id = c.id) last_used_at,
         (select array_agg(distinct p.use_case) from ai_routing_policies p join ai_routing_policy_models pm on pm.policy_id = p.id join ai_models m on m.id = pm.model_id
           where m.connection_id = c.id and p.status = 'ACTIVE') active_use_cases
    from ai_connections c
    left join ai_connection_secrets k on k.connection_id = c.id and k.purpose = 'API_KEY' and k.revoked_at is null
    left join ai_connection_secrets h on h.connection_id = c.id and h.purpose = 'CUSTOM_HEADERS' and h.revoked_at is null`

function providerSummary(provider: AiProviderDefinition | null): ConnectionView["provider"] {
  return provider ? { key: provider.key, name: provider.name, icon: provider.icon, deployment: provider.deployment, credential: provider.credential, supportsModelDiscovery: provider.supportsModelDiscovery, supportsCustomHeaders: provider.supportsCustomHeaders, notes: provider.notes } : null
}

function toView(row: ConnectionRow): ConnectionView {
  const provider = findAiProvider(row.provider_key)
  return {
    id: row.id,
    providerKey: row.provider_key,
    provider: providerSummary(provider),
    name: row.name,
    baseUrl: row.base_url,
    effectiveBaseUrl: row.base_url ?? provider?.defaultBaseUrl ?? null,
    apiVersion: row.api_version,
    isLocal: provider ? isLocalDeployment(provider, row.is_local) : row.is_local,
    timeoutMs: row.timeout_ms,
    maxConcurrentCalls: row.max_concurrent_calls,
    enabled: row.enabled,
    credential: row.key_hint !== null ? { configured: true, maskedValue: row.key_hint, updatedAt: row.key_updated_at?.toISOString() ?? null } : { configured: false, maskedValue: null, updatedAt: null },
    customHeaderNames: row.header_hint ? row.header_hint.split(",").filter(Boolean) : [],
    health: { status: row.last_health_status, checkedAt: row.last_health_check_at?.toISOString() ?? null, latencyMs: row.last_health_latency_ms, message: row.last_health_message },
    modelCount: row.model_count,
    enabledModelCount: row.enabled_model_count,
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    activePolicyUseCases: row.active_use_cases ?? [],
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function listConnections(context: AiAdminContext, organizationId: string): Promise<ConnectionView[]> {
  const result = await context.db.query<ConnectionRow>(`${CONNECTION_SELECT} where c.organization_id = $1 order by c.created_at`, [organizationId])
  return result.rows.map(toView)
}

export async function getConnection(context: AiAdminContext, organizationId: string, id: string): Promise<ConnectionView> {
  const result = await context.db.query<ConnectionRow>(`${CONNECTION_SELECT} where c.organization_id = $1 and c.id = $2`, [organizationId, id])
  const row = result.rows[0]
  // Outra organização = "não encontrada" — nunca revela que o id existe.
  if (!row) throw new DomainError("Conexão não encontrada.", "AI_CONNECTION_NOT_FOUND", 404)
  return toView(row)
}

function validateHeaders(provider: AiProviderDefinition, headers: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!headers || Object.keys(headers).length === 0) return null
  if (!provider.supportsCustomHeaders) throw new DomainError(`O provider ${provider.name} não aceita cabeçalhos personalizados.`, "AI_CONNECTION_HEADERS_NOT_ALLOWED", 422)
  for (const name of Object.keys(headers)) {
    const problem = customHeaderProblem(name)
    if (problem) throw new DomainError(problem, "AI_CONNECTION_HEADER_INVALID", 422)
  }
  return headers
}

async function storeSecret(context: AiAdminContext, actor: Actor, connectionId: string, purpose: "API_KEY" | "CUSTOM_HEADERS", plain: string, hint: string): Promise<void> {
  const encrypted = encryptAiSecret(plain)
  const client = await context.db.connect()
  try {
    await client.query("begin")
    await client.query(`update ai_connection_secrets set revoked_at = $3 where connection_id = $1 and purpose = $2 and revoked_at is null`, [connectionId, purpose, context.now()])
    await client.query(`insert into ai_connection_secrets (organization_id, connection_id, purpose, key_version, ciphertext, iv, auth_tag, hint, created_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [actor.organizationId, connectionId, purpose, SECRET_KEY_VERSION, encrypted.ciphertext, encrypted.iv, encrypted.authTag, hint, actor.personId, context.now()])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

function uniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
}

export async function createConnection(context: AiAdminContext, actor: Actor, rawInput: unknown): Promise<ConnectionView> {
  const input = connectionCreateSchema.parse(rawInput)
  const provider = findAiProvider(input.providerKey)
  if (!provider) throw new DomainError("Provider desconhecido.", "AI_PROVIDER_UNKNOWN", 422)
  if (provider.baseUrlRequired && !input.baseUrl && !provider.defaultBaseUrl) throw new DomainError("Informe o endpoint da conexão.", "AI_CONNECTION_ENDPOINT_REQUIRED", 422)
  if (provider.credential === "REQUIRED" && !input.apiKey) throw new DomainError(`${provider.credentialLabel} é obrigatória para ${provider.name}.`, "AI_CONNECTION_CREDENTIAL_REQUIRED", 422)
  if (provider.credential === "NONE" && input.apiKey) throw new DomainError(`${provider.name} não usa credencial.`, "AI_CONNECTION_CREDENTIAL_NOT_ALLOWED", 422)
  const headers = validateHeaders(provider, input.customHeaders)
  let id: string
  try {
    const inserted = await context.db.query<{ id: string }>(
      `insert into ai_connections (organization_id, provider_key, name, base_url, api_version, is_local, timeout_ms, enabled, created_by, created_at, updated_at, max_concurrent_calls)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11) returning id`,
      [actor.organizationId, provider.key, input.name, input.baseUrl ?? null, input.apiVersion ?? null, provider.deployment === "LOCAL" ? true : provider.deployment === "REMOTE" ? false : Boolean(input.isLocal), input.timeoutMs ?? 60_000, input.enabled ?? true, actor.personId, context.now(), input.maxConcurrentCalls ?? null],
    )
    id = inserted.rows[0]!.id
  } catch (error) {
    if (uniqueViolation(error)) throw new DomainError("Já existe uma conexão com esse nome.", "AI_CONNECTION_NAME_TAKEN", 409)
    throw error
  }
  if (input.apiKey) await storeSecret(context, actor, id, "API_KEY", input.apiKey, maskSecret(input.apiKey))
  if (headers) await storeSecret(context, actor, id, "CUSTOM_HEADERS", JSON.stringify(headers), Object.keys(headers).join(","))
  await auditAi(context.db, actor, "AI_CONNECTION_CREATED", "ai_connection", id, { providerKey: provider.key, name: input.name, endpointHost: input.baseUrl ? new URL(input.baseUrl).host : null, credentialConfigured: Boolean(input.apiKey), customHeaderNames: headers ? Object.keys(headers) : [] })
  context.runtime.invalidate(actor.organizationId)
  return getConnection(context, actor.organizationId, id)
}

export async function updateConnection(context: AiAdminContext, actor: Actor, id: string, rawInput: unknown): Promise<ConnectionView> {
  const input = connectionPatchSchema.parse(rawInput)
  const current = await getConnection(context, actor.organizationId, id)
  const provider = findAiProvider(current.providerKey)
  if (provider?.baseUrlRequired && input.baseUrl === null && !provider.defaultBaseUrl) throw new DomainError("Informe o endpoint da conexão.", "AI_CONNECTION_ENDPOINT_REQUIRED", 422)
  const sets: string[] = []
  const values: unknown[] = [actor.organizationId, id]
  const add = (column: string, value: unknown) => {
    values.push(value)
    sets.push(`${column} = $${values.length}`)
  }
  if (input.name !== undefined) add("name", input.name)
  if (input.baseUrl !== undefined) add("base_url", input.baseUrl)
  if (input.apiVersion !== undefined) add("api_version", input.apiVersion)
  if (input.isLocal !== undefined && provider?.deployment === "REMOTE_OR_LOCAL") add("is_local", input.isLocal)
  if (input.timeoutMs !== undefined) add("timeout_ms", input.timeoutMs)
  if (input.maxConcurrentCalls !== undefined) add("max_concurrent_calls", input.maxConcurrentCalls)
  if (input.enabled !== undefined) add("enabled", input.enabled)
  if (sets.length === 0) return current
  add("updated_at", context.now())
  try {
    await context.db.query(`update ai_connections set ${sets.join(", ")} where organization_id = $1 and id = $2`, values)
  } catch (error) {
    if (uniqueViolation(error)) throw new DomainError("Já existe uma conexão com esse nome.", "AI_CONNECTION_NAME_TAKEN", 409)
    throw error
  }
  // A chave (e os cabeçalhos com credencial) pertencem ao ENDPOINT em que foram cadastrados (achado A-F12): trocar o host
  // revoga as credenciais guardadas — senão bastaria apontar a conexão para um servidor próprio e clicar em "Testar" para
  // receber a chave. Quem administra cadastra a chave de novo para o endpoint novo.
  const originOf = (value: string | null) => {
    try {
      return value ? new URL(value).origin : null
    } catch {
      return value
    }
  }
  const endpointChanged = input.baseUrl !== undefined && originOf(input.baseUrl ?? provider?.defaultBaseUrl ?? null) !== originOf(current.effectiveBaseUrl)
  if (endpointChanged && (current.credential.configured || current.customHeaderNames.length > 0)) {
    await context.db.query(`update ai_connection_secrets set revoked_at = $3 where connection_id = $1 and organization_id = $2 and revoked_at is null`, [id, actor.organizationId, context.now()])
    await auditAi(context.db, actor, "AI_CONNECTION_SECRET_REVOKED", "ai_connection", id, { reason: "ENDPOINT_CHANGED", fromHost: originOf(current.effectiveBaseUrl), toHost: originOf(input.baseUrl ?? provider?.defaultBaseUrl ?? null) })
  }
  const changed = Object.keys(input).filter((key) => key !== "enabled")
  if (changed.length > 0) await auditAi(context.db, actor, "AI_CONNECTION_UPDATED", "ai_connection", id, { fields: changed })
  if (input.enabled !== undefined && input.enabled !== current.enabled) await auditAi(context.db, actor, input.enabled ? "AI_CONNECTION_ENABLED" : "AI_CONNECTION_DISABLED", "ai_connection", id, { activePolicyUseCases: current.activePolicyUseCases })
  context.runtime.invalidate(actor.organizationId)
  return getConnection(context, actor.organizationId, id)
}

export async function replaceConnectionSecret(context: AiAdminContext, actor: Actor, id: string, rawInput: unknown): Promise<ConnectionView> {
  const input = secretSchema.parse(rawInput)
  const current = await getConnection(context, actor.organizationId, id)
  const provider = findAiProvider(current.providerKey)
  if (provider?.credential === "NONE") throw new DomainError(`${provider.name} não usa credencial.`, "AI_CONNECTION_CREDENTIAL_NOT_ALLOWED", 422)
  await storeSecret(context, actor, id, "API_KEY", input.apiKey, maskSecret(input.apiKey))
  await auditAi(context.db, actor, current.credential.configured ? "AI_CONNECTION_SECRET_REPLACED" : "AI_CONNECTION_SECRET_SET", "ai_connection", id, { purpose: "API_KEY" })
  context.runtime.invalidate(actor.organizationId)
  return getConnection(context, actor.organizationId, id)
}

export async function removeConnectionSecret(context: AiAdminContext, actor: Actor, id: string): Promise<ConnectionView> {
  const current = await getConnection(context, actor.organizationId, id)
  const provider = findAiProvider(current.providerKey)
  if (provider?.credential === "REQUIRED" && current.activePolicyUseCases.length > 0) throw new DomainError(`A conexão atende política(s) ativa(s) (${current.activePolicyUseCases.join(", ")}) e ${provider.name} exige credencial. Substitua a chave ou desative as políticas antes.`, "AI_CONNECTION_IN_USE", 409, { activePolicyUseCases: current.activePolicyUseCases })
  await context.db.query(`update ai_connection_secrets set revoked_at = $3 where connection_id = $1 and purpose = $2 and revoked_at is null`, [id, "API_KEY", context.now()])
  await auditAi(context.db, actor, "AI_CONNECTION_SECRET_REMOVED", "ai_connection", id, { purpose: "API_KEY" })
  context.runtime.invalidate(actor.organizationId)
  return getConnection(context, actor.organizationId, id)
}

export async function replaceConnectionHeaders(context: AiAdminContext, actor: Actor, id: string, rawInput: unknown): Promise<ConnectionView> {
  const input = headersSchema.parse(rawInput)
  const current = await getConnection(context, actor.organizationId, id)
  const provider = findAiProvider(current.providerKey)
  if (!provider) throw new DomainError("Provider desconhecido.", "AI_PROVIDER_UNKNOWN", 422)
  const headers = validateHeaders(provider, input.customHeaders)
  if (headers) await storeSecret(context, actor, id, "CUSTOM_HEADERS", JSON.stringify(headers), Object.keys(headers).join(","))
  else await context.db.query(`update ai_connection_secrets set revoked_at = $3 where connection_id = $1 and purpose = $2 and revoked_at is null`, [id, "CUSTOM_HEADERS", context.now()])
  await auditAi(context.db, actor, "AI_CONNECTION_HEADERS_REPLACED", "ai_connection", id, { headerNames: headers ? Object.keys(headers) : [] })
  context.runtime.invalidate(actor.organizationId)
  return getConnection(context, actor.organizationId, id)
}

/**
 * Exclusão (§61): só sem dependência em política (ativa ou rascunho). Com histórico de uso, o
 * histórico continua (evento guarda provider/modelo por nome). Preferível: desabilitar.
 */
export async function deleteConnection(context: AiAdminContext, actor: Actor, id: string): Promise<void> {
  const current = await getConnection(context, actor.organizationId, id)
  const deps = await context.db.query<{ use_case: string; status: string }>(
    `select distinct p.use_case, p.status from ai_routing_policies p join ai_routing_policy_models pm on pm.policy_id = p.id join ai_models m on m.id = pm.model_id where m.connection_id = $1 and p.status in ('ACTIVE', 'DRAFT')`,
    [id],
  )
  if (deps.rows.length > 0) throw new DomainError(`A conexão é usada por política(s) de roteamento (${deps.rows.map((row) => `${row.use_case} ${row.status === "ACTIVE" ? "ativa" : "rascunho"}`).join(", ")}). Remova-a das políticas ou desabilite a conexão.`, "AI_CONNECTION_IN_USE", 409, { policies: deps.rows.map((row) => ({ useCase: row.use_case, status: row.status })) })
  const client = await context.db.connect()
  try {
    await client.query("begin")
    // Políticas ARQUIVADAS que citam modelos desta conexão perdem só a referência (histórico de uso guarda os nomes).
    await client.query(`delete from ai_routing_policy_models where model_id in (select id from ai_models where connection_id = $1)`, [id])
    await client.query(`delete from ai_model_pricing where model_id in (select id from ai_models where connection_id = $1)`, [id])
    await client.query(`delete from ai_models where connection_id = $1`, [id])
    await client.query(`delete from ai_connections where organization_id = $1 and id = $2`, [actor.organizationId, id])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
  await auditAi(context.db, actor, "AI_CONNECTION_DELETED", "ai_connection", id, { providerKey: current.providerKey, name: current.name })
  context.runtime.invalidate(actor.organizationId)
}

/** Conexão pronta para o adapter (segredo decifrado em memória, só durante a operação). */
async function runtimeConnection(context: AiAdminContext, organizationId: string, id: string): Promise<ConnectionRuntime> {
  const view = await getConnection(context, organizationId, id)
  const secrets = await context.db.query<{ purpose: string; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }>(`select purpose, ciphertext, iv, auth_tag from ai_connection_secrets where organization_id = $1 and connection_id = $2 and revoked_at is null`, [organizationId, id])
  const of = (purpose: string) => {
    const row = secrets.rows.find((item) => item.purpose === purpose)
    return row ? { ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag } : null
  }
  return { id: view.id, name: view.name, providerKey: view.providerKey, baseUrl: view.effectiveBaseUrl, apiVersion: view.apiVersion, isLocal: view.isLocal, timeoutMs: view.timeoutMs, maxConcurrentCalls: view.maxConcurrentCalls, enabled: view.enabled, apiKey: of("API_KEY"), headers: of("CUSTOM_HEADERS") }
}

export { runtimeConnection }

/** "Testar conexão" (§11, §16): chamada SEM custo (listar modelos). Resultado persistido como saúde da conexão. */
export async function testConnection(context: AiAdminContext, actor: Actor, id: string): Promise<ConnectionTestResult & { checkedAt: string }> {
  const connection = await runtimeConnection(context, actor.organizationId, id)
  const provider = findAiProvider(connection.providerKey)
  let result: ConnectionTestResult
  if (!provider || !provider.supportsModelDiscovery) {
    result = { status: "UNSUPPORTED", latencyMs: null, message: "Este provider não oferece verificação automática. Use \"Testar modelo\".", modelCount: null }
  } else {
    try {
      result = await context.adapters(provider.adapterType).testConnection(resolveConnection(connection))
    } catch (error) {
      const message = error instanceof AiProviderError ? error.message : "Erro inesperado ao testar a conexão."
      result = { status: error instanceof AiProviderError && error.category === "AUTH" ? "AUTH_ERROR" : "UNKNOWN_ERROR", latencyMs: null, message, modelCount: null }
    }
  }
  const checkedAt = context.now()
  await context.db.query(`update ai_connections set last_health_check_at = $3, last_health_status = $4, last_health_latency_ms = $5, last_health_message = $6 where organization_id = $1 and id = $2`, [actor.organizationId, id, checkedAt, result.status, result.latencyMs, result.message])
  return { ...result, checkedAt: checkedAt.toISOString() }
}

export type SyncReport = { discovered: number; created: number; updated: number; missing: number }

/** "Sincronizar modelos" (§13): upsert por (conexão, id do provider). Capacidade declarada à mão nunca é sobrescrita; modelo que sumiu da listagem não é apagado. */
export async function syncConnectionModels(context: AiAdminContext, actor: Actor, id: string): Promise<SyncReport> {
  const connection = await runtimeConnection(context, actor.organizationId, id)
  const provider = findAiProvider(connection.providerKey)
  if (!provider?.supportsModelDiscovery) throw new DomainError("Este provider não permite descobrir modelos — cadastre-os manualmente.", "AI_DISCOVERY_UNSUPPORTED", 422)
  const discovered = await context.adapters(provider.adapterType).listModels(resolveConnection(connection))
  const existing = await context.db.query<{ id: string; provider_model_id: string; capabilities: ModelCapabilities; origin: string }>(`select id, provider_model_id, capabilities, origin from ai_models where organization_id = $1 and connection_id = $2`, [actor.organizationId, id])
  const byProviderId = new Map(existing.rows.map((row) => [row.provider_model_id, row]))
  const now = context.now()
  const report: SyncReport = { discovered: discovered.length, created: 0, updated: 0, missing: 0 }
  for (const model of discovered) {
    const current = byProviderId.get(model.providerModelId)
    if (current) {
      await context.db.query(
        `update ai_models set capabilities = $3, context_window = coalesce(context_window, $4), max_output_tokens = coalesce(max_output_tokens, $5), last_seen_at = $6, metadata = metadata - 'missingFromLastSync' || $7::jsonb, updated_at = $6 where organization_id = $1 and id = $2`,
        [actor.organizationId, current.id, JSON.stringify(mergeCapabilities(current.capabilities ?? {}, model.capabilities)), model.contextWindow, model.maxOutputTokens, now, JSON.stringify({ discovery: model.metadata })],
      )
      report.updated += 1
    } else {
      await context.db.query(
        `insert into ai_models (organization_id, connection_id, provider_model_id, display_name, enabled, kind, context_window, max_output_tokens, capabilities, origin, last_seen_at, metadata, created_at, updated_at)
         values ($1, $2, $3, $4, true, $5, $6, $7, $8, 'DISCOVERED', $9, $10, $9, $9)`,
        [actor.organizationId, id, model.providerModelId, model.displayName.slice(0, 120), model.kind, model.contextWindow, model.maxOutputTokens, JSON.stringify(model.capabilities), now, JSON.stringify({ discovery: model.metadata })],
      )
      report.created += 1
    }
  }
  const seen = new Set(discovered.map((model) => model.providerModelId))
  const missing = existing.rows.filter((row) => row.origin === "DISCOVERED" && !seen.has(row.provider_model_id)).map((row) => row.id)
  if (missing.length > 0) await context.db.query(`update ai_models set metadata = metadata || '{"missingFromLastSync": true}'::jsonb, updated_at = $3 where organization_id = $1 and id = any($2::uuid[])`, [actor.organizationId, missing, now])
  report.missing = missing.length
  await auditAi(context.db, actor, "AI_MODELS_SYNCED", "ai_connection", id, report)
  context.runtime.invalidate(actor.organizationId)
  return report
}

export function listProviders(): AiProviderDefinition[] {
  return AI_PROVIDERS.filter((provider) => provider.active)
}
