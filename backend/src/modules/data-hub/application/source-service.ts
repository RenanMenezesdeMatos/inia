import { createHash, randomBytes } from "node:crypto"
import { isIP } from "node:net"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { DataRunError, isCredentialRefusal } from "../domain/error-codes.js"
import { CREDENTIAL_CHANGED, feedHasHiddenValues, ORIGIN_CHANGED, restoreMaskedSourceConfig, sameApiOrigin, sourceHiddenValues } from "../domain/config-mask.js"
import { describeSourceTarget, sourceChanges } from "../domain/config-unlock.js"
import { syncAtSourceResume, type Cadence } from "../domain/freshness.js"
import { insecureCredentialTransportWarning, sourceConfigSchema, sourceInputSchema, sourceSecretsSchema, type SecretPurpose, type SourceConfig, type SourceInput, type SourceSecrets } from "../domain/source-config.js"
import { credentialFields, requiredSecretPurposes, secretTargetOf } from "../domain/source-credentials.js"
import { z } from "zod"
import { databaseConfigSchema, NEW_SOURCE_TLS_MODE, resolveDatabaseConnection, describeDatabaseConnection } from "../domain/database/database-engine.js"
import { testApiConnection } from "./connectors/api-pull-connector.js"
import { databaseConfigOf, describeTestDetail, resolveSourceConnection, testDatabaseConnection, type DatabaseConnectionReport } from "./connectors/database-connector.js"
import { testSftpConnection } from "./connectors/sftp-connector.js"
import { assertConfigStillUnlocked, attemptOwnerOf, blockedAfterRefusal, configLockedError, identifiedSession, readConfigAccess, refuseRejectedCredential, reserveCredentialAttempt, resetUnlocksAfterCredentialChange, revokeConfigUnlocks, settleCredentialAttempt, verifyNewCredential, type ConfigSession } from "./config-unlock-service.js"
import type { DataHubContext } from "./data-hub-context.js"
import type { SecretWriteOptions } from "./ports.js"
import { findSource, listFeedsOfSource, lockSource, recordAudit, requireSource, type DataSourceRow } from "./records.js"
import { cancelOrphanRuns, cancelWaitingRetries } from "./run-service.js"

export { requiredSecretPurposes, secretTargetOf } from "../domain/source-credentials.js"

type Queryable = Pick<Database, "query">

/**
 * Fontes: CRUD, teste de conexão, pausar/retomar, rotação de credencial e tokens de push.
 * Segredos entram pelo SecretStore e nunca voltam; a resposta da API só diz "configurado em…".
 */
function publicId(): string {
  return randomBytes(6).toString("base64url").replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase() || randomBytes(4).toString("hex")
}

async function storeSecrets(ctx: DataHubContext, source: { id: string; organizationId: string }, config: SourceConfig, secrets: SourceSecrets | undefined, actorId: string | null, requireAll: boolean, options: SecretWriteOptions = {}): Promise<string[]> {
  const stored: string[] = []
  for (const entry of requiredSecretPurposes(config)) {
    const value = secrets?.[entry.field]
    if (value) {
      await ctx.secrets.put({ organizationId: source.organizationId, sourceId: source.id, purpose: entry.purpose, value, actorId }, options)
      stored.push(entry.purpose)
    } else if (entry.required && requireAll) {
      const existing = await ctx.secrets.get({ sourceId: source.id, purpose: entry.purpose })
      if (!existing) throw new DomainError(`Informe a credencial "${entry.field}" para este tipo de autenticação.`, "DATA_SOURCE_SECRET_REQUIRED", 422)
    }
  }
  return stored
}

export type SourceView = DataSourceRow & { secrets: { purpose: SecretPurpose; createdAt: string; rotatedAt: string | null }[]; transportWarning: string | null }

export async function describeSource(ctx: DataHubContext, source: DataSourceRow): Promise<SourceView> {
  return { ...source, secrets: await ctx.secrets.describe(source.id), transportWarning: insecureCredentialTransportWarning(source.config) }
}

/** Banco novo sem criptografia escolhida nasce validando o certificado (achado DATA-5); a tela sempre manda o modo escolhido. */
export function withNewSourceDefaults(input: SourceInput): SourceInput {
  if (input.config.kind !== "DATABASE" || input.config.database.tls) return input
  return { ...input, config: { ...input.config, database: { ...input.config.database, tls: { mode: NEW_SOURCE_TLS_MODE } } } }
}

export async function createSource(ctx: DataHubContext, organizationId: string, actorId: string | null, rawInput: unknown, session: ConfigSession | null = null): Promise<SourceView> {
  const parsed = withNewSourceDefaults(sourceInputSchema.parse(rawInput))
  const input = { ...parsed, config: restoreMaskedSourceConfig(parsed.config, null) }
  const missing = credentialFields(input.config).filter((field) => !input.secrets?.[field])
  if (missing.length > 0) throw new DomainError(`Informe a credencial "${missing[0]}" para este tipo de autenticação.`, "DATA_SOURCE_SECRET_REQUIRED", 422, { fields: missing })
  if (credentialFields(input.config).length > 0) await refuseRejectedCredential(ctx, { organizationId, name: input.name, config: input.config, secrets: input.secrets!, session })
  const result = await ctx.db.query<{ id: string }>(
    `insert into data_sources (organization_id, public_id, name, description, kind, status, config, created_by, updated_by)
     values ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $7) returning id`,
    [organizationId, publicId(), input.name, input.description ?? null, input.config.kind, JSON.stringify(input.config), actorId],
  )
  const source = (await findSource(ctx.db, organizationId, result.rows[0]!.id))!
  const stored = await storeSecrets(ctx, source, input.config, input.secrets, actorId, true)
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_SOURCE_CREATED", entityType: "data_source", entityId: source.id, payload: { sourceId: source.id, name: source.name, kind: source.kind, target: describeSourceTarget(input.config), secretsConfigured: stored } })
  return describeSource(ctx, source)
}

/**
 * Os conjuntos de uma API Pull chamam o servidor da fonte com os próprios cabeçalhos, parâmetros fixos e endpoint, que saem escondidos
 * para quem não liberou a configuração (numa fonte sem autenticação, para todo mundo). Levar a Base URL para outra origem os mandaria a
 * um servidor escolhido por quem nunca os viu. A gravação da fonte não traz os conjuntos para redigitar, então a troca é recusada
 * enquanto algum conjunto guardar valor escondido. Quem está liberado vê esses valores (a regra de `configVisible`), e a troca segue.
 */
async function refuseHiddenFeedValuesOnNewOrigin(ctx: DataHubContext, current: DataSourceRow, next: SourceConfig, session: ConfigSession | null): Promise<void> {
  const previous = current.config as SourceConfig
  if (previous.kind !== "API_PULL" || next.kind !== "API_PULL" || sameApiOrigin(next.api.baseUrl, previous.api.baseUrl)) return
  const access = await readConfigAccess(ctx, current, session ?? { personId: null, sessionId: null })
  if (access.required && access.unlocked) return
  const hidden = (await listFeedsOfSource(ctx.db, current.organizationId, current.id)).filter((feed) => feedHasHiddenValues(feed.connectorConfig))
  if (hidden.length === 0) return
  const names = hidden.map((feed) => `"${feed.name}"`).join(", ")
  throw new DomainError(
    `A Base URL agora aponta para outro servidor, e ${hidden.length === 1 ? `o conjunto ${names} guarda` : `os conjuntos ${names} guardam`} valores ocultos (cabeçalhos, parâmetros fixos ou o que vem depois do "?" no endpoint), que iriam junto para ele. Tire esses valores dos conjuntos antes de trocar o servidor e digite-os de novo depois, ou cadastre outra fonte para o servidor novo.`,
    "DATA_SOURCE_MASKED_VALUE",
    422,
    { reason: ORIGIN_CHANGED, feeds: hidden.map((feed) => ({ id: feed.id, name: feed.name })) },
  )
}

/**
 * Trocar a credencial libera a configuração para quem trocou (`resetUnlocksAfterCredentialChange`), e a liberação mostra os valores
 * ocultos da fonte e dos conjuntos. A prova da credencial nova diz só que ela vale no destino: numa API Pull com token, um token
 * PRÓPRIO válido da mesma API passa, e quem trocou veria valores que nunca soube. Tirar a liberação automática não resolve, porque
 * liberar depois com a nova (que é dele) daria o mesmo. Então, sem liberação viva (sem ter provado a credencial atual), a troca é
 * recusada enquanto a fonte ou algum conjunto guardar outro valor oculto, antes de qualquer conexão e de gravar. `next` é a
 * configuração que vai valer; da fonte, contam só os valores que seguem iguais aos guardados. Banco e SFTP não têm valor oculto
 * além da credencial (`maskConfigsInResponse` só esconde API Pull): a troca segue como antes.
 * Devolve se a troca depende de não haver valor oculto (quem troca não está liberado): aí a conferência se repete na transação de
 * escrita (`recheckHiddenValuesUnderLock`).
 */
async function refuseCredentialChangeOverHiddenValues(ctx: DataHubContext, current: DataSourceRow, next: SourceConfig, session: ConfigSession | null): Promise<boolean> {
  if (next.kind !== "API_PULL") return false
  const access = await readConfigAccess(ctx, current, session ?? { personId: null, sessionId: null })
  if (access.required && access.unlocked) return false
  await refuseOtherHiddenValues(ctx.db, current, sourceHiddenValues(next, current.config as SourceConfig))
  return true
}

/**
 * Entre a conferência de antes e o commit, outra pessoa liberada pode gravar um valor oculto novo (cabeçalho da fonte, conjunto novo
 * ou alterado). Na transação de escrita, com a linha da fonte travada (`locked`, o primeiro comando dela; toda gravação de fonte ou
 * conjunto trava a mesma linha antes, em `assertConfigStillUnlocked`), confere de novo com o que está gravado agora. `next` nulo = só
 * a credencial muda, e vale a configuração gravada agora; senão o PATCH grava `next` por cima, e da fonte contam os valores que ele mantém.
 */
async function recheckHiddenValuesUnderLock(client: Queryable, current: DataSourceRow, next: SourceConfig | null, locked: DataSourceRow): Promise<void> {
  const stored = locked.config as SourceConfig
  await refuseOtherHiddenValues(client, current, next ? sourceHiddenValues(next, current.config as SourceConfig) : sourceHiddenValues(stored))
}

/**
 * A credencial vale só para o destino em que foi provada (ou para o qual foi digitada). Entre a leitura de antes (que decidiu o destino,
 * a prova e a revogação) e a transação de escrita, outra pessoa pode ter trocado o destino da fonte; com a linha travada, confere que o
 * destino gravado agora é o mesmo da leitura. Senão, recusa sem gravar: gravar a credencial (ou devolver o destino antigo por cima da
 * troca) ligaria uma credencial a um destino para o qual ela não foi provada.
 */
function refuseDestinationChangedSince(snapshot: DataSourceRow, locked: DataSourceRow): void {
  if (secretTargetOf(locked.config as SourceConfig) === secretTargetOf(snapshot.config as SourceConfig)) return
  throw new DomainError("Outra pessoa mudou o destino desta fonte enquanto a alteração era conferida. Abra a fonte de novo, confira o destino atual e informe a credencial outra vez.", "DATA_SOURCE_DESTINATION_CHANGED", 409)
}

async function refuseOtherHiddenValues(db: Queryable, current: DataSourceRow, fields: string[]): Promise<void> {
  const feeds = (await listFeedsOfSource(db, current.organizationId, current.id)).filter((feed) => feedHasHiddenValues(feed.connectorConfig))
  if (fields.length === 0 && feeds.length === 0) return
  const where = [
    ...(fields.length > 0 ? [`na fonte (${fields.join(", ")})`] : []),
    ...(feeds.length > 0 ? [`${feeds.length === 1 ? "no conjunto" : "nos conjuntos"} ${feeds.map((feed) => `"${feed.name}"`).join(", ")}`] : []),
  ].join(" e ")
  throw new DomainError(
    `Esta fonte guarda valores ocultos além da credencial ${where}, e quem troca a credencial passa a vê-los. Libere a configuração com a credencial atual e troque em seguida. Sem a credencial atual, tire esses valores, troque a credencial e digite-os de novo.`,
    "DATA_SOURCE_MASKED_VALUE",
    422,
    { reason: CREDENTIAL_CHANGED, fields, feeds: feeds.map((feed) => ({ id: feed.id, name: feed.name })) },
  )
}

export async function updateSource(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, rawInput: unknown, session: ConfigSession | null = null): Promise<SourceView> {
  const current = await requireSource(ctx.db, organizationId, sourceId)
  const input = sourceInputSchema.partial({ config: true }).parse(rawInput)
  const config = input.config ? restoreMaskedSourceConfig(sourceConfigSchema.parse(input.config), current.config as SourceConfig) : current.config
  if (config.kind !== current.kind) throw new DomainError("O tipo da conexão não pode ser alterado depois de criada — crie outra fonte.", "DATA_SOURCE_KIND_IMMUTABLE", 422)
  // Antes de qualquer conexão: a prova da credencial nova, logo abaixo, já chama os conjuntos no servidor novo.
  await refuseHiddenFeedValuesOnNewOrigin(ctx, current, config, session)
  // Destino da credencial mudou: todas as credenciais exigidas precisam vir NESTA requisição (nunca reaproveitar a guardada).
  const targetChanged = secretTargetOf(config) !== secretTargetOf(current.config as SourceConfig)
  if (targetChanged) {
    const missing = requiredSecretPurposes(config).filter((entry) => entry.required && !input.secrets?.[entry.field])
    if (missing.length > 0) {
      throw new DomainError("O servidor, o banco, o usuário ou a forma de autenticação mudou: informe a credencial de novo (a guardada vale só para o destino original).", "DATA_SOURCE_SECRET_REENTRY_REQUIRED", 422, { fields: missing.map((entry) => entry.field) })
    }
  }
  // Credencial digitada: precisa funcionar no destino que vai valer ANTES de gravar qualquer coisa. Antes do teste, a recusa de quem
  // passaria a ver valores ocultos que nunca soube (sem autenticação → token próprio, sem liberação a pedir).
  const credentialTyped = requiredSecretPurposes(config).some((entry) => input.secrets?.[entry.field])
  const identified = identifiedSession(session)
  const recheckHiddenValues = credentialTyped && (await refuseCredentialChangeOverHiddenValues(ctx, current, config, session))
  if (credentialTyped) await verifyNewCredential(ctx, current, config, input.secrets!, identified)
  const nextName = input.name ?? current.name
  const nextDescription = input.description ?? current.description
  // Configuração, credenciais e auditoria num commit só (achado N01 da 4ª auditoria): com commits separados, o destino novo ficava
  // gravado enquanto a credencial antiga continuava ativa — um "Testar conexão" (ou uma carga) nesse meio-tempo mandava a credencial
  // guardada para o destino novo, e uma falha na troca deixava os dois assim, sem registro. Quem lê vê o par antigo ou o novo.
  await inTransaction(ctx.db, async (client) => {
    const locked = await assertConfigStillUnlocked(ctx, client, { organizationId, sourceId, session, route: "PATCH /sources/:id" })
    refuseDestinationChangedSince(current, locked)
    if (recheckHiddenValues) await recheckHiddenValuesUnderLock(client, current, config, locked)
    await client.query(`update data_sources set name = $2, description = $3, config = $4, updated_by = $5, updated_at = now(), connection_health = case when $6 then 'UNKNOWN' else connection_health end where id = $1`, [
      sourceId,
      nextName,
      nextDescription,
      JSON.stringify(config),
      actorId,
      Boolean(input.config),
    ])
    const stored = await storeSecrets(ctx, current, config, input.secrets, actorId, false, { db: client })
    if (targetChanged) {
      // Segredos opcionais que não vieram de novo (ex.: passphrase) não acompanham a fonte para o destino novo.
      for (const entry of requiredSecretPurposes(current.config as SourceConfig)) {
        if (!stored.includes(entry.purpose)) await ctx.secrets.revoke({ sourceId, purpose: entry.purpose }, { db: client })
      }
    }
    if (stored.length > 0 || targetChanged) await resetUnlocksAfterCredentialChange(client, { organizationId, sourceId, session: identified, now: ctx.clock.now() })
    await recordAudit(client, { organizationId, actorId, action: "DATA_HUB_SOURCE_UPDATED", entityType: "data_source", entityId: sourceId, payload: { sourceId, name: nextName, ...sourceChanges({ name: current.name, description: current.description, config: current.config as SourceConfig }, { name: nextName, description: nextDescription, config }), secretsRotated: stored, secretTargetChanged: targetChanged } })
  })
  return describeSource(ctx, (await findSource(ctx.db, organizationId, sourceId))!)
}

/**
 * Troca de credencial no MESMO destino: não exige a antiga, porque o caso normal é ela ter mudado no servidor; exige a nova funcionando
 * de verdade. Assim quem não conhece a senha não derruba as cargas gravando outra. Quem foi liberado com a anterior volta a precisar
 * de senha, e quem trocou fica liberado. Por isso, sem liberação viva, a troca é recusada enquanto a fonte ou algum conjunto guardar
 * outro valor oculto (`refuseCredentialChangeOverHiddenValues`).
 */
export async function rotateSourceSecrets(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, rawSecrets: unknown, session: ConfigSession | null = null): Promise<SourceView> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  const secrets = sourceSecretsSchema.parse(rawSecrets)
  const config = source.config as SourceConfig
  const entries = requiredSecretPurposes(config)
  if (!entries.some((entry) => secrets[entry.field])) throw new DomainError("Nenhuma credencial informada para rotacionar.", "DATA_SOURCE_SECRET_REQUIRED", 422)
  const identified = identifiedSession(session)
  if (session && !identified) throw configLockedError(source)
  const recheckHiddenValues = await refuseCredentialChangeOverHiddenValues(ctx, source, config, session)
  const proof = await verifyNewCredential(ctx, source, config, secrets, identified)
  await inTransaction(ctx.db, async (client) => {
    // Sempre trava: a credencial foi provada no destino lido antes da prova, e só pode ser gravada se ele ainda for o da fonte.
    const locked = await lockSource(client, organizationId, sourceId)
    refuseDestinationChangedSince(source, locked)
    if (recheckHiddenValues) await recheckHiddenValuesUnderLock(client, source, null, locked)
    const stored = await storeSecrets(ctx, source, config, secrets, actorId, false, { db: client })
    // A credencial testada é a que vale inteira: uma frase-senha antiga não acompanha a chave nova.
    for (const entry of entries) {
      if (!stored.includes(entry.purpose)) await ctx.secrets.revoke({ sourceId, purpose: entry.purpose }, { db: client })
    }
    // O teste acima acabou de conectar com esta credencial, e é esse o estado da conexão. Sem prova (API que responde igual com e sem credencial), segue não testada.
    const proven = proof === "PROVEN"
    await client.query(`update data_sources set connection_health = $3, connection_checked_at = coalesce($4, connection_checked_at), connection_error = null, status = case when status = 'ERROR' then 'ACTIVE' else status end, updated_by = $2, updated_at = now() where id = $1`, [sourceId, actorId, proven ? "HEALTHY" : "UNKNOWN", proven ? ctx.clock.now() : null])
    await resetUnlocksAfterCredentialChange(client, { organizationId, sourceId, session: identified, now: ctx.clock.now() })
    await recordAudit(client, { organizationId, actorId, action: "DATA_HUB_SECRET_ROTATED", entityType: "data_source", entityId: sourceId, payload: { sourceId, name: source.name, purposes: stored } })
  })
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
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_CONNECTION_TESTED", entityType: "data_source", entityId: sourceId, payload: { sourceId, name: source.name, health: result.health, errorCode: result.errorCode } })
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
    const feeds = await ctx.db.query<{ id: string; cadence: Cadence }>(`select id, cadence from data_feeds where source_id = $1 and status = 'ACTIVE' and deleted_at is null`, [sourceId])
    if (feeds.rows.length > 0) {
      const timeZone = await resolveOrganizationTimezone(ctx.db, organizationId)
      for (const feed of feeds.rows) await ctx.db.query(`update data_feeds set next_sync_at = $2 where id = $1`, [feed.id, syncAtSourceResume(feed.cadence, ctx.clock.now(), timeZone)])
    }
  }
  const cancelledRuns = action === "PAUSE" ? await cancelWaitingRetries(ctx.db, { organizationId, sourceId }) : 0
  await recordAudit(ctx.db, { organizationId, actorId, action: `DATA_HUB_SOURCE_${action}D`, entityType: "data_source", entityId: sourceId, payload: { sourceId, name: source.name, ...(cancelledRuns > 0 ? { cancelledQueuedRuns: cancelledRuns } : {}) } })
  return describeSource(ctx, (await findSource(ctx.db, organizationId, sourceId))!)
}

export async function deleteSource(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string): Promise<void> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  // Uma operação só: fonte removida nunca fica com feed agendado, token de push ou credencial ainda válidos.
  await inTransaction(ctx.db, async (client) => {
    await client.query(`update data_feeds set deleted_at = now(), deleted_by_person_id = $2, status = 'PAUSED', next_sync_at = null where source_id = $1 and deleted_at is null`, [sourceId, actorId])
    await client.query(`update data_sources set deleted_at = now(), deleted_by_person_id = $2, status = 'PAUSED', updated_by = $2, updated_at = now() where id = $1 and deleted_at is null`, [sourceId, actorId])
    await client.query(`update data_push_tokens set revoked_at = now() where source_id = $1 and revoked_at is null`, [sourceId])
    // Cargas ainda na fila de qualquer feed da fonte terminam aqui (nunca ficam órfãs ocupando a fila de todas as organizações).
    const cancelledRuns = await cancelOrphanRuns(client, { organizationId, sourceId })
    // A credencial continua cifrada para auditoria, mas revogada: nenhuma leitura do SecretStore a devolve mais.
    const revoked = await client.query<{ purpose: SecretPurpose }>(`update data_secrets set revoked_at = now() where source_id = $1 and revoked_at is null returning purpose`, [sourceId])
    await revokeConfigUnlocks(client, sourceId, ctx.clock.now())
    await recordAudit(client, { organizationId, actorId, action: "DATA_HUB_SOURCE_DELETED", entityType: "data_source", entityId: sourceId, payload: { sourceId, name: source.name, kind: source.kind, target: describeSourceTarget(source.config as SourceConfig), secretsRevoked: revoked.rows.map((row) => row.purpose), ...(cancelledRuns > 0 ? { cancelledQueuedRuns: cancelledRuns } : {}) } })
  })
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

export async function testDatabaseDraft(ctx: DataHubContext, organizationId: string, actorId: string | null, rawInput: unknown, session: ConfigSession | null = null): Promise<ConnectionTestResult> {
  const input = databaseDraftTestSchema.parse(rawInput)
  const checkedAt = ctx.clock.now()
  let password = input.password ?? null
  // Fonte citada existe nesta organização: o registro nunca aponta para uma fonte que a pessoa só digitou.
  const source = input.sourceId ? await requireSource(ctx.db, organizationId, input.sourceId) : null
  if (!password) {
    if (!source) throw new DomainError("Informe a senha do banco para testar a conexão.", "DATA_SOURCE_SECRET_REQUIRED", 422)
    if (source.kind !== "DATABASE") throw new DomainError("A fonte informada não é um banco de dados.", "DATA_FEED_CONNECTOR_MISMATCH", 422)
    databaseConfigOf(source)
    // A senha guardada só testa o MESMO destino (servidor, porta, banco, usuário, TLS); outro destino = digitar a senha (achado I-F2).
    if (secretTargetOf({ kind: "DATABASE", database: input.config }) !== secretTargetOf(source.config as SourceConfig)) {
      throw new DomainError("O servidor, o banco, o usuário ou a criptografia mudou: informe a senha para testar este destino.", "DATA_SOURCE_SECRET_REENTRY_REQUIRED", 422, { fields: ["password"] })
    }
    password = await ctx.secrets.get({ sourceId: source.id, purpose: "DATABASE_PASSWORD" })
    if (!password) throw new DomainError("Esta conexão não tem senha guardada — informe a senha.", "DATA_SOURCE_SECRET_REQUIRED", 422)
  }
  // Senha digitada é uma tentativa, e conta no limite por pessoa + servidor + usuário. A guardada não é palpite de ninguém: testar com ela é livre.
  const owner = input.password ? attemptOwnerOf(session, { organizationId, config: { kind: "DATABASE", database: input.config }, sourceId: source?.id ?? null, name: source?.name ?? null }) : null
  const attempt = owner ? await reserveCredentialAttempt(ctx, owner) : null
  const connection = resolveDatabaseConnection(input.config, password)
  let result: ConnectionTestResult
  let passwordRefused = false
  try {
    const report = await testDatabaseConnection(ctx, connection, input.sourceId ?? `draft:${organizationId}:${input.config.engine}:${input.config.host}:${input.config.database}:${input.config.username}`)
    result = { health: "HEALTHY", detail: describeTestDetail(report), errorCode: null, checkedAt: checkedAt.toISOString(), database: report }
  } catch (error) {
    const runError = error instanceof DataRunError ? error : new DataRunError("DATA_SOURCE_UNREACHABLE", error instanceof Error ? error.message : "Falha ao testar a conexão.")
    passwordRefused = isCredentialRefusal(runError)
    result = { health: "ERROR", detail: runError.message, errorCode: runError.code, checkedAt: checkedAt.toISOString(), database: null }
  }
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_DATABASE_TESTED", entityType: "data_source", entityId: input.sourceId ?? organizationId, payload: { ...(source ? { sourceId: source.id, name: source.name, usedStoredPassword: !input.password } : {}), target: describeDatabaseConnection(input.config), health: result.health, errorCode: result.errorCode } })
  if (attempt && owner) {
    if (passwordRefused) {
      const blocked = await blockedAfterRefusal(ctx, owner, attempt)
      if (blocked) throw blocked
    } else {
      await settleCredentialAttempt(ctx, attempt.id, result.health === "HEALTHY" ? "SUCCEEDED" : "REFUSED")
    }
  }
  return result
}

// ---------------------------------------------------------------------------------------------
// Tokens de push
// ---------------------------------------------------------------------------------------------
export type PushTokenView = {
  id: string
  label: string
  tokenPrefix: string
  feedId: string | null
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
  /** Depois desta data o token é recusado como se não existisse (R-28). `null` = sem validade (tokens antigos). */
  expiresAt: string | null
  /** IPs/redes (CIDR) de onde o token é aceito. `null` = qualquer origem. */
  allowedNetworks: string[] | null
}

export const PUSH_TOKEN_MAX_VALIDITY_DAYS = 730
export const PUSH_TOKEN_MAX_NETWORKS = 20

export function hashPushToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** IP (v4/v6) ou rede CIDR válida; devolve a forma normalizada ou `null`. */
export function normalizeAllowedNetwork(value: string): string | null {
  const [address, prefix, extra] = value.trim().split("/")
  if (extra !== undefined || !address) return null
  const family = isIP(address)
  if (!family) return null
  if (prefix === undefined) return address
  if (!/^\d{1,3}$/.test(prefix)) return null
  const bits = Number(prefix)
  return bits <= (family === 6 ? 128 : 32) ? `${address}/${bits}` : null
}

export const pushTokenInputSchema = z.object({
  label: z.string().trim().min(2).max(80),
  feedId: z.string().uuid().nullable().optional(),
  expiresInDays: z.number().int().min(1).max(PUSH_TOKEN_MAX_VALIDITY_DAYS).nullable().optional(),
  allowedNetworks: z
    .array(z.string().max(64))
    .max(PUSH_TOKEN_MAX_NETWORKS)
    .nullable()
    .optional()
    .transform((networks, issue) => {
      if (!networks || networks.length === 0) return null
      const normalized = networks.map(normalizeAllowedNetwork)
      const invalid = networks.filter((_, index) => !normalized[index])
      if (invalid.length > 0) {
        issue.addIssue({ code: "custom", message: `Endereço ou rede inválida: ${invalid.join(", ")}. Use um IP (10.0.0.5) ou uma rede (10.0.0.0/24).` })
        return z.NEVER
      }
      return [...new Set(normalized as string[])]
    }),
})
export type PushTokenInput = z.input<typeof pushTokenInputSchema>

type PushTokenRow = { id: string; label: string; token_prefix: string; feed_id: string | null; created_at: Date; last_used_at: Date | null; revoked_at: Date | null; expires_at: Date | null; allowed_networks: string[] | null }
const PUSH_TOKEN_COLUMNS = "id, label, token_prefix, feed_id, created_at, last_used_at, revoked_at, expires_at, allowed_networks"

function pushTokenView(row: PushTokenRow): PushTokenView {
  return {
    id: row.id,
    label: row.label,
    tokenPrefix: `${row.token_prefix}…`,
    feedId: row.feed_id,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    allowedNetworks: row.allowed_networks,
  }
}

export async function createPushToken(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, rawInput: PushTokenInput): Promise<{ token: string; view: PushTokenView }> {
  const input = pushTokenInputSchema.parse(rawInput)
  const source = await requireSource(ctx.db, organizationId, sourceId)
  if (source.kind !== "API_PUSH") throw new DomainError("Tokens de push só existem para fontes API Push.", "DATA_SOURCE_NOT_PUSH", 422)
  // Token restrito a um feed: o feed precisa ser DESTA fonte (senão o token nasceria inutilizável ou ligado a outra fonte).
  if (input.feedId) {
    const feed = await ctx.db.query(`select 1 from data_feeds where id = $1 and source_id = $2 and deleted_at is null`, [input.feedId, sourceId])
    if (!feed.rows[0]) throw new DomainError("O feed informado não pertence a esta fonte.", "DATA_FEED_NOT_FOUND", 422)
  }
  const token = `inia_push_${randomBytes(24).toString("base64url")}`
  const prefix = token.slice(0, 14)
  const result = await ctx.db.query<PushTokenRow>(
    `insert into data_push_tokens (organization_id, source_id, feed_id, label, token_prefix, token_hash, created_by, expires_at, allowed_networks)
     values ($1, $2, $3, $4, $5, $6, $7, case when $8::int is null then null else now() + make_interval(days => $8::int) end, $9) returning ${PUSH_TOKEN_COLUMNS}`,
    [organizationId, sourceId, input.feedId ?? null, input.label, prefix, hashPushToken(token), actorId, input.expiresInDays ?? null, input.allowedNetworks],
  )
  const row = result.rows[0]!
  await recordAudit(ctx.db, {
    organizationId,
    actorId,
    action: "DATA_HUB_PUSH_TOKEN_CREATED",
    entityType: "data_push_token",
    entityId: row.id,
    payload: { sourceId, tokenPrefix: prefix, expiresAt: row.expires_at?.toISOString() ?? null, allowedNetworks: row.allowed_networks },
  })
  return { token, view: { ...pushTokenView(row), tokenPrefix: prefix } }
}

export async function listPushTokens(ctx: DataHubContext, organizationId: string, sourceId: string): Promise<PushTokenView[]> {
  const result = await ctx.db.query<PushTokenRow>(`select ${PUSH_TOKEN_COLUMNS} from data_push_tokens where organization_id = $1 and source_id = $2 order by created_at desc`, [organizationId, sourceId])
  return result.rows.map(pushTokenView)
}

export async function revokePushToken(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, tokenId: string): Promise<void> {
  const result = await ctx.db.query(`update data_push_tokens set revoked_at = now() where organization_id = $1 and source_id = $2 and id = $3 and revoked_at is null`, [organizationId, sourceId, tokenId])
  if (!result.rowCount) throw new DomainError("Token não encontrado ou já revogado.", "DATA_PUSH_TOKEN_NOT_FOUND", 404)
  await recordAudit(ctx.db, { organizationId, actorId, action: "DATA_HUB_PUSH_TOKEN_REVOKED", entityType: "data_push_token", entityId: tokenId, payload: { sourceId } })
}

/**
 * Rotacionar = revogar o atual e emitir outro com o mesmo rótulo, o mesmo feed, as mesmas redes e o mesmo PRAZO de validade
 * (contado a partir de agora). O segredo novo aparece uma única vez.
 */
export async function rotatePushToken(ctx: DataHubContext, organizationId: string, actorId: string | null, sourceId: string, tokenId: string): Promise<{ token: string; view: PushTokenView }> {
  const current = await ctx.db.query<{ label: string; feed_id: string | null; validity_days: number | null; allowed_networks: string[] | null }>(
    `select label, feed_id, allowed_networks,
            case when expires_at is null then null else least(${PUSH_TOKEN_MAX_VALIDITY_DAYS}, greatest(1, ceil(extract(epoch from expires_at - created_at) / 86400)))::int end validity_days
       from data_push_tokens where organization_id = $1 and source_id = $2 and id = $3 and revoked_at is null`,
    [organizationId, sourceId, tokenId],
  )
  const row = current.rows[0]
  if (!row) throw new DomainError("Token não encontrado ou já revogado.", "DATA_PUSH_TOKEN_NOT_FOUND", 404)
  await revokePushToken(ctx, organizationId, actorId, sourceId, tokenId)
  return createPushToken(ctx, organizationId, actorId, sourceId, { label: row.label, feedId: row.feed_id, expiresInDays: row.validity_days, allowedNetworks: row.allowed_networks })
}
