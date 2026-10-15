import { createHash, randomBytes } from "node:crypto"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { DataRunError } from "../domain/error-codes.js"
import { sourceConfigSchema, sourceInputSchema, sourceSecretsSchema, type SecretPurpose, type SourceConfig, type SourceInput, type SourceSecrets } from "../domain/source-config.js"
import { z } from "zod"
import { databaseConfigSchema, resolveDatabaseConnection, describeDatabaseConnection } from "../domain/database/database-engine.js"
import { testApiConnection } from "./connectors/api-pull-connector.js"
import { databaseConfigOf, describeTestDetail, resolveSourceConnection, testDatabaseConnection, type DatabaseConnectionReport } from "./connectors/database-connector.js"
import { testSftpConnection } from "./connectors/sftp-connector.js"
import type { DataHubContext } from "./data-hub-context.js"
import { findSource, recordAudit, requireSource, type DataSourceRow } from "./records.js"

/**
 * Fontes: CRUD, teste de conexão, pausar/retomar, rotação de credencial e tokens de push.
 * Segredos entram pelo SecretStore e nunca voltam; a resposta da API só diz "configurado em…".
 */
function publicId(): string {
  return randomBytes(6).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || randomBytes(4).toString("hex")
}

/** Quais segredos a configuração exige e onde guardar cada um. */
export function requiredSecretPurposes(config: SourceConfig): { purpose: SecretPurpose; field: keyof SourceSecrets; required: boolean }[] {
  if (config.kind === "API_PULL") {
    switch (config.api.auth.kind) {
      case "NONE":
        return []
      case "BEARER":
        return [{ purpose: "API_AUTH", field: "token", required: true }]
      case "API_KEY":
        return [{ purpose: "API_AUTH", field: "apiKey", required: true }]
      case "BASIC":
        return [{ purpose: "API_AUTH", field: "password", required: true }]
      case "OAUTH2_CLIENT_CREDENTIALS":
        return [{ purpose: "API_AUTH", field: "clientSecret", required: true }]
    }
  }
  if (config.kind === "DATABASE") return [{ purpose: "DATABASE_PASSWORD", field: "password", required: true }]
  if (config.kind === "SFTP") {
    return config.sftp.authKind === "PASSWORD"
      ? [{ purpose: "SFTP_PASSWORD", field: "password", required: true }]
      : [
          { purpose: "SFTP_PRIVATE_KEY", field: "privateKey", required: true },
          { purpose: "SFTP_PASSPHRASE", field: "passphrase", required: false },
        ]
  }
  return []
}

/**
 * DESTINO A QUE UMA CREDENCIAL GUARDADA PERTENCE (achado I-F2). Segredo nunca volta pela API — mas, se bastasse trocar o
 * host/usuário/URL e manter a senha guardada, um administrador apontaria a fonte para um servidor próprio e a receberia em
 * claro na próxima conexão. Por isso, quando este destino muda, as credenciais precisam ser digitadas de novo.
 * Inclui o modo de TLS: rebaixar a criptografia também exige a senha de novo.
 */
export function secretTargetOf(config: SourceConfig): string | null {
  if (config.kind === "API_PULL") {
    const auth = config.api.auth
    return JSON.stringify({ origin: safeOrigin(config.api.baseUrl), auth: auth.kind, tokenUrl: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.tokenUrl : null, headerName: auth.kind === "API_KEY" ? auth.headerName.toLowerCase() : null, username: auth.kind === "BASIC" ? auth.username : null })
  }
  if (config.kind === "DATABASE") {
    const database = config.database
    return JSON.stringify({ engine: database.engine, host: database.host.trim().toLowerCase(), port: database.port ?? null, instance: database.instanceName?.toLowerCase() ?? null, username: database.username, tls: database.tls?.mode ?? null })
  }
  if (config.kind === "SFTP") return JSON.stringify({ host: config.sftp.host.trim().toLowerCase(), port: config.sftp.port, username: config.sftp.username, auth: config.sftp.authKind })
  return null
}

function safeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value
  }
}

async function storeSecrets(ctx: DataHubContext, source: { id: string; organizationId: string }, config: SourceConfig, secrets: SourceSecrets | undefined, actorId: string | null, requireAll: boolean): Promise<string[]> {
  const stored: string[] = []
  for (const entry of requiredSecretPurposes(config)) {
    const value = secrets?.[entry.field]
    if (value) {
      await ctx.secrets.put({ organizationId: source.organizationId, sourceId: source.id, purpose: entry.purpose, value, actorId })
      stored.push(entry.purpose)
    } else if (entry.required && requireAll) {
      const existing = await ctx.secrets.get({ sourceId: source.id, purpose: entry.purpose })
      if (!existing) throw new DomainError(`Informe a credencial "${entry.field}" para este tipo de autenticação.`, "DATA_SOURCE_SECRET_REQUIRED", 422)
    }
  }
  return stored
}

export type SourceView = DataSourceRow & { secrets: { purpose: SecretPurpose; createdAt: string; rotatedAt: string | null }[] }

export async function describeSource(ctx: DataHubContext, source: DataSourceRow): Promise<SourceView> {
  return { ...source, secrets: await ctx.secrets.describe(source.id) }
}

export async function createSource(ctx: DataHubContext, organizationId: string, actorId: string | null, rawInput: unknown): Promise<SourceView> {
  const input: SourceInput = sourceInputSchema.parse(rawInput)
  const result = await ctx.db.query<{ id: string }>(
    `insert into data_sources (organization_id, public_id, name, description, kind, status, config, created_by, updated_by)
     values ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $7) returning id`,
    [organizationId, publicId(), input.name, input.description ?? null, input.config.kind, JSON.stringify(input.config), actorId],
  )
  const source = (await findSource(ctx.db, organizationId, result.rows[0]!.id))!
  const stored = await storeSecrets(ctx, source, input.config, input.secrets, actorId, true)
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_SOURCE_CREATED", entityType: "data_source", entityId: source.id, payload: { kind: source.kind, secretsConfigured: stored } })
  return describeSource(ctx, source)
}

export async function updateSource(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, rawInput: unknown): Promise<SourceView> {
  const current = await requireSource(ctx.db, organizationId, sourceId)
  const input = sourceInputSchema.partial({ config: true }).parse(rawInput)
  const config = input.config ? sourceConfigSchema.parse(input.config) : current.config
  if (config.kind !== current.kind) throw new DomainError("O tipo da conexão não pode ser alterado depois de criada — crie outra fonte.", "DATA_SOURCE_KIND_IMMUTABLE", 422)
  // Destino da credencial mudou: todas as credenciais exigidas precisam vir NESTA requisição (nunca reaproveitar a guardada).
  const targetChanged = secretTargetOf(config) !== secretTargetOf(current.config as SourceConfig)
  if (targetChanged) {
    const missing = requiredSecretPurposes(config).filter((entry) => entry.required && !input.secrets?.[entry.field])
    if (missing.length > 0) {
      throw new DomainError("O servidor, o usuário ou a forma de autenticação mudou: informe a credencial de novo (a guardada vale só para o destino original).", "DATA_SOURCE_SECRET_REENTRY_REQUIRED", 422, { fields: missing.map((entry) => entry.field) })
    }
  }
  await ctx.db.query(`update data_sources set name = $2, description = $3, config = $4, updated_by = $5, updated_at = now(), connection_health = case when $6 then 'UNKNOWN' else connection_health end where id = $1`, [
    sourceId,
    input.name ?? current.name,
    input.description ?? current.description,
    JSON.stringify(config),
    actorId,
    Boolean(input.config),
  ])
  const stored = await storeSecrets(ctx, current, config, input.secrets, actorId, false)
  if (targetChanged) {
    // Segredos opcionais que não vieram de novo (ex.: passphrase) não acompanham a fonte para o destino novo.
    for (const entry of requiredSecretPurposes(current.config as SourceConfig)) {
      if (!stored.includes(entry.purpose)) await ctx.secrets.revoke({ sourceId, purpose: entry.purpose })
    }
  }
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_SOURCE_UPDATED", entityType: "data_source", entityId: sourceId, payload: { configChanged: Boolean(input.config), secretsRotated: stored, secretTargetChanged: targetChanged } })
  return describeSource(ctx, (await findSource(ctx.db, organizationId, sourceId))!)
}

export async function rotateSourceSecrets(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, rawSecrets: unknown): Promise<SourceView> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  const secrets = sourceSecretsSchema.parse(rawSecrets)
  const stored = await storeSecrets(ctx, source, source.config, secrets, actorId, false)
  if (stored.length === 0) throw new DomainError("Nenhuma credencial informada para rotacionar.", "DATA_SOURCE_SECRET_REQUIRED", 422)
  await ctx.db.query(`update data_sources set connection_health = 'UNKNOWN', connection_error = null, status = case when status = 'ERROR' then 'ACTIVE' else status end, updated_by = $2, updated_at = now() where id = $1`, [sourceId, actorId])
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_SECRET_ROTATED", entityType: "data_source", entityId: sourceId, payload: { purposes: stored } })
  return describeSource(ctx, (await findSource(ctx.db, organizationId, sourceId))!)
}

export type ConnectionTestResult = { health: "HEALTHY" | "ERROR"; detail: string; errorCode: string | null; checkedAt: string; database?: DatabaseConnectionReport | null }

export async function testSourceConnection(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string): Promise<ConnectionTestResult> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  let result: ConnectionTestResult
  const checkedAt = ctx.clock.now()
  try {
    if (source.kind === "API_PULL") result = { health: "HEALTHY", detail: (await testApiConnection(ctx, source)).detail, errorCode: null, checkedAt: checkedAt.toISOString() }
    else if (source.kind === "SFTP") result = { health: "HEALTHY", detail: (await testSftpConnection(ctx, source)).detail, errorCode: null, checkedAt: checkedAt.toISOString() }
    else if (source.kind === "DATABASE") {
      const report = await testDatabaseConnection(ctx, await resolveSourceConnection(ctx, source), source.id)
      result = { health: "HEALTHY", detail: describeTestDetail(report), errorCode: null, checkedAt: checkedAt.toISOString(), database: report }
    }
    else result = { health: "HEALTHY", detail: source.kind === "API_PUSH" ? "Fonte passiva: o cliente envia os dados para o endpoint da INIA." : "Fonte manual: os arquivos são enviados pela tela de importação.", errorCode: null, checkedAt: checkedAt.toISOString() }
  } catch (error) {
    const runError = error instanceof DataRunError ? error : new DataRunError("DATA_SOURCE_UNREACHABLE", error instanceof Error ? error.message : "Falha ao testar a conexão.")
    result = { health: "ERROR", detail: runError.message, errorCode: runError.code, checkedAt: checkedAt.toISOString() }
  }
  await ctx.db.query(`update data_sources set connection_health = $2, connection_checked_at = $3, connection_error = $4, updated_at = now() where id = $1`, [sourceId, result.health, checkedAt, result.health === "ERROR" ? result.detail : null])
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_CONNECTION_TESTED", entityType: "data_source", entityId: sourceId, payload: { health: result.health, errorCode: result.errorCode } })
  return result
}

export async function setSourceStatus(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, action: "ACTIVATE" | "PAUSE" | "RESUME"): Promise<SourceView> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  const next = action === "PAUSE" ? "PAUSED" : "ACTIVE"
  if (action === "PAUSE" && source.status !== "ACTIVE" && source.status !== "ERROR") throw new DomainError("Só uma fonte ativa pode ser pausada.", "DATA_SOURCE_INVALID_TRANSITION", 409)
  if (action === "RESUME" && source.status !== "PAUSED" && source.status !== "ERROR") throw new DomainError("Só uma fonte pausada (ou com erro) pode ser retomada.", "DATA_SOURCE_INVALID_TRANSITION", 409)
  await ctx.db.query(`update data_sources set status = $2, updated_by = $3, updated_at = now() where id = $1`, [sourceId, next, actorId])
  // Feeds ativos de uma fonte pausada não são agendados (o agendador filtra pela fonte); ao retomar, recalcula a próxima execução.
  if (next === "ACTIVE") {
    await ctx.db.query(`update data_feeds set next_sync_at = case when cadence->>'kind' = 'MANUAL' then null else now() end where source_id = $1 and status = 'ACTIVE' and deleted_at is null`, [sourceId])
  }
  await recordAudit(ctx.db, { organizationId, actorId, action: `DATA_HUB_SOURCE_${action}D`, entityType: "data_source", entityId: sourceId })
  return describeSource(ctx, (await findSource(ctx.db, organizationId, sourceId))!)
}

export async function deleteSource(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string): Promise<void> {
  await requireSource(ctx.db, organizationId, sourceId)
  // Uma operação só: fonte removida nunca fica com feed agendado, token de push ou credencial ainda válidos.
  const client = await ctx.db.connect()
  try {
    await client.query("begin")
    await client.query(`update data_feeds set deleted_at = now(), status = 'PAUSED', next_sync_at = null where source_id = $1 and deleted_at is null`, [sourceId])
    await client.query(`update data_sources set deleted_at = now(), status = 'PAUSED', updated_by = $2, updated_at = now() where id = $1`, [sourceId, actorId])
    await client.query(`update data_push_tokens set revoked_at = now() where source_id = $1 and revoked_at is null`, [sourceId])
    // A credencial continua cifrada para auditoria, mas revogada: nenhuma leitura do SecretStore a devolve mais.
    const revoked = await client.query<{ purpose: SecretPurpose }>(`update data_secrets set revoked_at = now() where source_id = $1 and revoked_at is null returning purpose`, [sourceId])
    await recordAudit(client, { organizationId, actorId, action: "DATA_HUB_SOURCE_DELETED", entityType: "data_source", entityId: sourceId, payload: { secretsRevoked: revoked.rows.map((row) => row.purpose) } })
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

// ---------------------------------------------------------------------------------------------
// Banco externo: teste ANTES de salvar (nada é gravado — nem fonte, nem segredo, nem saúde)
// ---------------------------------------------------------------------------------------------
export const databaseDraftTestSchema = z.object({
  config: databaseConfigSchema,
  /** Senha digitada agora. Ausente = usar a senha já guardada da fonte `sourceId` (edição). */
  password: z.string().min(1).max(4000).optional(),
  sourceId: z.string().uuid().optional(),
})

export async function testDatabaseDraft(ctx: DataHubContext, organizationId: string, actorId: string | null, rawInput: unknown): Promise<ConnectionTestResult> {
  const input = databaseDraftTestSchema.parse(rawInput)
  const checkedAt = ctx.clock.now()
  let password = input.password ?? null
  if (!password) {
    if (!input.sourceId) throw new DomainError("Informe a senha do banco para testar a conexão.", "DATA_SOURCE_SECRET_REQUIRED", 422)
    const source = await requireSource(ctx.db, organizationId, input.sourceId)
    if (source.kind !== "DATABASE") throw new DomainError("A fonte informada não é um banco de dados.", "DATA_FEED_CONNECTOR_MISMATCH", 422)
    databaseConfigOf(source)
    // A senha guardada só testa o MESMO destino (servidor, porta, usuário, TLS); outro destino = digitar a senha (achado I-F2).
    if (secretTargetOf({ kind: "DATABASE", database: input.config }) !== secretTargetOf(source.config as SourceConfig)) {
      throw new DomainError("O servidor, o usuário ou a criptografia mudou: informe a senha para testar este destino.", "DATA_SOURCE_SECRET_REENTRY_REQUIRED", 422, { fields: ["password"] })
    }
    password = await ctx.secrets.get({ sourceId: source.id, purpose: "DATABASE_PASSWORD" })
    if (!password) throw new DomainError("Esta conexão não tem senha guardada — informe a senha.", "DATA_SOURCE_SECRET_REQUIRED", 422)
  }
  const connection = resolveDatabaseConnection(input.config, password)
  let result: ConnectionTestResult
  try {
    const report = await testDatabaseConnection(ctx, connection, input.sourceId ?? `draft:${organizationId}:${input.config.engine}:${input.config.host}:${input.config.database}:${input.config.username}`)
    result = { health: "HEALTHY", detail: describeTestDetail(report), errorCode: null, checkedAt: checkedAt.toISOString(), database: report }
  } catch (error) {
    const runError = error instanceof DataRunError ? error : new DataRunError("DATA_SOURCE_UNREACHABLE", error instanceof Error ? error.message : "Falha ao testar a conexão.")
    result = { health: "ERROR", detail: runError.message, errorCode: runError.code, checkedAt: checkedAt.toISOString(), database: null }
  }
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_DATABASE_TESTED", entityType: "data_source", entityId: input.sourceId ?? organizationId, payload: { target: describeDatabaseConnection(input.config), health: result.health, errorCode: result.errorCode } })
  return result
}

// ---------------------------------------------------------------------------------------------
// Tokens de push
// ---------------------------------------------------------------------------------------------
export type PushTokenView = { id: string; label: string; tokenPrefix: string; feedId: string | null; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

export function hashPushToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

export async function createPushToken(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, input: { label: string; feedId?: string | null }): Promise<{ token: string; view: PushTokenView }> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  if (source.kind !== "API_PUSH") throw new DomainError("Tokens de push só existem para fontes API Push.", "DATA_SOURCE_NOT_PUSH", 422)
  // Token restrito a um feed: o feed precisa ser DESTA fonte (senão o token nasceria inutilizável ou ligado a outra fonte).
  if (input.feedId) {
    const feed = await ctx.db.query(`select 1 from data_feeds where id = $1 and source_id = $2 and deleted_at is null`, [input.feedId, sourceId])
    if (!feed.rows[0]) throw new DomainError("O feed informado não pertence a esta fonte.", "DATA_FEED_NOT_FOUND", 422)
  }
  const token = `inia_push_${randomBytes(24).toString("base64url")}`
  const prefix = token.slice(0, 14)
  const result = await ctx.db.query<{ id: string; created_at: Date }>(
    `insert into data_push_tokens (organization_id, source_id, feed_id, label, token_prefix, token_hash, created_by) values ($1, $2, $3, $4, $5, $6, $7) returning id, created_at`,
    [organizationId, sourceId, input.feedId ?? null, input.label, prefix, hashPushToken(token), actorId],
  )
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_PUSH_TOKEN_CREATED", entityType: "data_push_token", entityId: result.rows[0]!.id, payload: { sourceId, tokenPrefix: prefix } })
  return { token, view: { id: result.rows[0]!.id, label: input.label, tokenPrefix: prefix, feedId: input.feedId ?? null, createdAt: result.rows[0]!.created_at.toISOString(), lastUsedAt: null, revokedAt: null } }
}

export async function listPushTokens(ctx: DataHubContext, organizationId: string, sourceId: string): Promise<PushTokenView[]> {
  const result = await ctx.db.query<{ id: string; label: string; token_prefix: string; feed_id: string | null; created_at: Date; last_used_at: Date | null; revoked_at: Date | null }>(
    `select id, label, token_prefix, feed_id, created_at, last_used_at, revoked_at from data_push_tokens where organization_id = $1 and source_id = $2 order by created_at desc`,
    [organizationId, sourceId],
  )
  return result.rows.map((row) => ({ id: row.id, label: row.label, tokenPrefix: `${row.token_prefix}…`, feedId: row.feed_id, createdAt: row.created_at.toISOString(), lastUsedAt: row.last_used_at?.toISOString() ?? null, revokedAt: row.revoked_at?.toISOString() ?? null }))
}

export async function revokePushToken(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, tokenId: string): Promise<void> {
  const result = await ctx.db.query(`update data_push_tokens set revoked_at = now() where organization_id = $1 and source_id = $2 and id = $3 and revoked_at is null`, [organizationId, sourceId, tokenId])
  if (!result.rowCount) throw new DomainError("Token não encontrado ou já revogado.", "DATA_PUSH_TOKEN_NOT_FOUND", 404)
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_PUSH_TOKEN_REVOKED", entityType: "data_push_token", entityId: tokenId, payload: { sourceId } })
}

/** Rotacionar = revogar o atual e emitir outro com o mesmo rótulo (o segredo novo aparece uma única vez). */
export async function rotatePushToken(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, tokenId: string): Promise<{ token: string; view: PushTokenView }> {
  const current = await ctx.db.query<{ label: string; feed_id: string | null }>(`select label, feed_id from data_push_tokens where organization_id = $1 and source_id = $2 and id = $3 and revoked_at is null`, [organizationId, sourceId, tokenId])
  if (!current.rows[0]) throw new DomainError("Token não encontrado ou já revogado.", "DATA_PUSH_TOKEN_NOT_FOUND", 404)
  await revokePushToken(ctx, organizationId, actorId, sourceId, tokenId)
  return createPushToken(ctx, organizationId, actorId, sourceId, { label: current.rows[0].label, feedId: current.rows[0].feed_id })
}
