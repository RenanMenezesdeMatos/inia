import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { CONFIG_UNLOCK_MINUTES, CONFIG_UNLOCK_WINDOW_MINUTES, credentialThrottle, describeSourceTarget, type ConfigUnlockMethod } from "../domain/config-unlock.js"
import { DataRunError, isCredentialRefusal } from "../domain/error-codes.js"
import { resolveDatabaseConnection } from "../domain/database/database-engine.js"
import { sourceSecretsSchema, type SecretPurpose, type SourceConfig, type SourceSecrets } from "../domain/source-config.js"
import { credentialFields, credentialTargetKey, requiredSecretPurposes, sameCredential } from "../domain/source-credentials.js"
import { proveApiCredential, testApiConnection, type CredentialProof } from "./connectors/api-pull-connector.js"
import { testDatabaseConnection } from "./connectors/database-connector.js"
import { testSftpConnection } from "./connectors/sftp-connector.js"
import type { DataHubContext } from "./data-hub-context.js"
import type { SecretStore, SftpClient, SftpConnection } from "./ports.js"
import { listFeedsOfSource, lockSource, recordAudit, requireSource, type DataFeedRow, type DataSourceRow } from "./records.js"

/**
 * LIBERAÇÃO DA CONFIGURAÇÃO DE UMA FONTE. A senha guardada existe para as cargas; configurar exige digitá-la de novo, sem exceção
 * para administrador nem para quem cadastrou. A liberação vale para aquela pessoa, naquela fonte e naquela sessão de login, por
 * 30 minutos. Nada aqui conecta no banco do cliente, exceto o teste de uma credencial NOVA.
 */
type Queryable = Pick<Database, "query">

export type ConfigSession = { personId: string | null; sessionId: string | null }
type IdentifiedSession = { personId: string; sessionId: string }
type SourceRef = Pick<DataSourceRow, "id" | "organizationId" | "name" | "kind" | "config">

export type ConfigAccessView = {
  /** Esta fonte tem credencial guardada a exigir. */
  required: boolean
  unlocked: boolean
  expiresAt: string | null
  /** Campos a digitar (`password`, `token`, `apiKey`, `clientSecret`, `privateKey`). */
  fields: (keyof SourceSecrets)[]
}

export const identifiedSession = (session: ConfigSession | null | undefined): IdentifiedSession | null => (session?.personId && session.sessionId ? { personId: session.personId, sessionId: session.sessionId } : null)

export function configLockedError(source: Pick<SourceRef, "id" | "kind" | "config">): DomainError {
  return new DomainError("Para configurar esta fonte, informe a senha dela de novo.", "DATA_SOURCE_CONFIG_LOCKED", 403, { sourceId: source.id, kind: source.kind, fields: credentialFields(source.config as SourceConfig) })
}

async function activeUnlock(db: Queryable, sourceId: string, session: IdentifiedSession, now: Date): Promise<Date | null> {
  const result = await db.query<{ expires_at: Date }>(
    `select expires_at from data_source_config_unlocks where source_id = $1 and person_id = $2 and session_id = $3 and revoked_at is null and expires_at > $4`,
    [sourceId, session.personId, session.sessionId, now],
  )
  return result.rows[0]?.expires_at ?? null
}

export async function readConfigAccess(ctx: DataHubContext, source: Pick<SourceRef, "id" | "config">, session: ConfigSession): Promise<ConfigAccessView> {
  const fields = credentialFields(source.config as SourceConfig)
  if (fields.length === 0) return { required: false, unlocked: true, expiresAt: null, fields }
  const identified = identifiedSession(session)
  const expiresAt = identified ? await activeUnlock(ctx.db, source.id, identified, ctx.clock.now()) : null
  return { required: true, unlocked: expiresAt !== null, expiresAt: expiresAt?.toISOString() ?? null, fields }
}

/**
 * Guarda das rotas de configuração: sem liberação viva não conecta em nada. Falha fechada sem pessoa ou sessão identificada. `db` lê a
 * liberação (dentro de uma transação, o cliente dela); o registro da recusa vai pelo `ctx.db`, para não cair com o rollback.
 */
export async function assertConfigUnlocked(ctx: DataHubContext, source: SourceRef, session: ConfigSession, route: string, db: Queryable = ctx.db): Promise<void> {
  if (credentialFields(source.config as SourceConfig).length === 0) return
  const identified = identifiedSession(session)
  if (identified && (await activeUnlock(db, source.id, identified, ctx.clock.now()))) return
  await recordAudit(ctx.db, { organizationId: source.organizationId, actorId: session.personId, action: "DATA_HUB_CONFIG_ACCESS_DENIED", entityType: "data_source", entityId: source.id, payload: { sourceId: source.id, name: source.name, route } })
  throw configLockedError(source)
}

/**
 * Primeiro comando da transação que grava a configuração (fonte ou conjunto): trava a linha da fonte e, com a trava, confere de novo a
 * liberação de quem edita. A guarda da rota conferiu antes; uma troca de credencial que confirmou depois dela revogou as liberações, e
 * sem esta segunda leitura a edição gravaria assim mesmo um valor oculto que quem trocou passaria a ver. A troca grava na mesma linha
 * da fonte, então uma espera a outra. Fonte sem credencial segue igual. `session` nula = chamada interna sem pessoa: só trava.
 */
export async function assertConfigStillUnlocked(ctx: DataHubContext, client: Queryable, input: { organizationId: string; sourceId: string; session: ConfigSession | null; route: string }): Promise<DataSourceRow> {
  const source = await lockSource(client, input.organizationId, input.sourceId)
  if (input.session) await assertConfigUnlocked(ctx, source, input.session, input.route, client)
  return source
}

export async function grantConfigUnlock(db: Queryable, input: { organizationId: string; sourceId: string; session: IdentifiedSession; method: ConfigUnlockMethod; now: Date }): Promise<Date> {
  const expiresAt = new Date(input.now.getTime() + CONFIG_UNLOCK_MINUTES * 60_000)
  await db.query(`delete from data_source_config_unlocks where source_id = $1 and expires_at < $2`, [input.sourceId, new Date(input.now.getTime() - 24 * 60 * 60_000)])
  await db.query(
    `insert into data_source_config_unlocks (organization_id, source_id, person_id, session_id, method, granted_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (source_id, person_id, session_id) do update set method = excluded.method, granted_at = excluded.granted_at, expires_at = excluded.expires_at, revoked_at = null`,
    [input.organizationId, input.sourceId, input.session.personId, input.session.sessionId, input.method, input.now, expiresAt],
  )
  return expiresAt
}

export async function revokeConfigUnlocks(db: Queryable, sourceId: string, now: Date): Promise<void> {
  await db.query(`update data_source_config_unlocks set revoked_at = $2 where source_id = $1 and revoked_at is null`, [sourceId, now])
}

/** Quem cadastrou digitou a credencial agora: já pode continuar a configuração. */
export async function grantCreatorUnlock(ctx: DataHubContext, source: Pick<SourceRef, "id" | "organizationId" | "config">, session: ConfigSession): Promise<void> {
  const identified = identifiedSession(session)
  if (!identified || credentialFields(source.config as SourceConfig).length === 0) return
  const now = ctx.clock.now()
  const expiresAt = await grantConfigUnlock(ctx.db, { organizationId: source.organizationId, sourceId: source.id, session: identified, method: "SOURCE_CREATED", now })
  await recordAudit(ctx.db, { organizationId: source.organizationId, actorId: identified.personId, action: "DATA_HUB_CONFIG_UNLOCKED", entityType: "data_source", entityId: source.id, payload: { sourceId: source.id, method: "SOURCE_CREATED", expiresAt: expiresAt.toISOString() } })
}

// ---------------------------------------------------------------------------------------------
// Limite de tentativas: 5 recusas em 15 minutos por pessoa + servidor + usuário, sem corrida
// ---------------------------------------------------------------------------------------------
export type CredentialAttempt = { id: string; failuresBefore: Date[]; at: Date }
/** De quem é a tentativa e contra qual destino. `sourceId` nulo = conexão ainda não salva (teste de rascunho ou cadastro). */
export type AttemptOwner = { organizationId: string; personId: string; config: SourceConfig; sourceId: string | null; name: string | null }

function tooManyAttempts(retryAt: Date): DomainError {
  return new DomainError("Muitas tentativas com a senha errada neste servidor. Aguarde alguns minutos e tente de novo.", "DATA_SOURCE_UNLOCK_TOO_MANY_ATTEMPTS", 429, { retryAt: retryAt.toISOString() })
}

async function auditBlocked(ctx: DataHubContext, owner: AttemptOwner, retryAt: Date): Promise<void> {
  await recordAudit(ctx.db, { organizationId: owner.organizationId, actorId: owner.personId, action: "DATA_HUB_CONFIG_UNLOCK_BLOCKED", entityType: "data_source", entityId: owner.sourceId ?? owner.organizationId, payload: { ...(owner.sourceId ? { sourceId: owner.sourceId, name: owner.name } : {}), target: describeSourceTarget(owner.config), retryAt: retryAt.toISOString() } })
}

/**
 * A tentativa fica gravada como falha ANTES de contar, de comparar e de conectar (como `reserveAttempt` no login): pedidos simultâneos se
 * enxergam, e o último a contar vê os outros. Bloqueado = a tentativa vira REFUSED, não conta, e a senha nem é usada.
 * Acertar não zera a conta: em API a chave é só a origem, e um token próprio válido, ou uma API que aceita qualquer token, zeraria as
 * tentativas contra a credencial de outra fonte. Quem acertou está liberado; os erros saem sozinhos da janela de 15 minutos.
 */
export async function reserveCredentialAttempt(ctx: DataHubContext, owner: AttemptOwner): Promise<CredentialAttempt> {
  const targetKey = credentialTargetKey(owner.config)
  if (!targetKey) throw new DomainError("Esta conexão não usa credencial.", "DATA_SOURCE_SECRET_REQUIRED", 422)
  const at = ctx.clock.now()
  await ctx.db.query(`delete from data_source_credential_attempts where person_id = $1 and attempted_at < $2`, [owner.personId, new Date(at.getTime() - 24 * 60 * 60_000)])
  const reserved = await ctx.db.query<{ id: string | number }>(
    `insert into data_source_credential_attempts (organization_id, person_id, target_key, outcome, attempted_at) values ($1, $2, $3, 'FAILED', $4) returning id`,
    [owner.organizationId, owner.personId, targetKey, at],
  )
  const id = String(reserved.rows[0]!.id)
  const recent = await ctx.db.query<{ attempted_at: Date }>(
    `select attempted_at from data_source_credential_attempts
      where person_id = $1 and target_key = $2 and outcome = 'FAILED' and attempted_at > $3 and id <> $4::bigint`,
    [owner.personId, targetKey, new Date(at.getTime() - CONFIG_UNLOCK_WINDOW_MINUTES * 60_000), id],
  )
  const failuresBefore = recent.rows.map((row) => row.attempted_at)
  const throttle = credentialThrottle(failuresBefore, at)
  if (throttle.locked) {
    await settleCredentialAttempt(ctx, id, "REFUSED")
    await auditBlocked(ctx, owner, throttle.retryAt)
    throw tooManyAttempts(throttle.retryAt)
  }
  return { id, failuresBefore, at }
}

export async function settleCredentialAttempt(ctx: DataHubContext, attemptId: string, outcome: "SUCCEEDED" | "REFUSED"): Promise<void> {
  await ctx.db.query(`update data_source_credential_attempts set outcome = $2 where id = $1::bigint`, [attemptId, outcome])
}

/** A recusa já está gravada pela reserva. Se foi ela que completou o limite, a resposta passa a ser a do bloqueio. */
export async function blockedAfterRefusal(ctx: DataHubContext, owner: AttemptOwner, attempt: CredentialAttempt): Promise<DomainError | null> {
  const after = credentialThrottle([...attempt.failuresBefore, attempt.at], attempt.at)
  if (!after.locked) return null
  await auditBlocked(ctx, owner, after.retryAt)
  return tooManyAttempts(after.retryAt)
}

/** Quem digita uma credencial conta tentativas pela própria pessoa. Sessão sem pessoa não testa senha nenhuma: falha fechada. */
export function attemptOwnerOf(session: ConfigSession | null, input: Omit<AttemptOwner, "personId">): AttemptOwner | null {
  if (!session) return null
  if (!session.personId) throw new DomainError("Sessão sem pessoa identificada: entre de novo para continuar.", "DATA_SOURCE_CONFIG_LOCKED", 403)
  return { ...input, personId: session.personId }
}

// ---------------------------------------------------------------------------------------------
// Liberar com a credencial atual
// ---------------------------------------------------------------------------------------------
const INCORRECT_MESSAGE = "A senha informada não confere com a guardada nesta fonte."

export async function unlockConfiguration(ctx: DataHubContext, organizationId: string, session: ConfigSession, sourceId: string, rawSecrets: unknown): Promise<ConfigAccessView> {
  const source = await requireSource(ctx.db, organizationId, sourceId)
  const config = source.config as SourceConfig
  const identified = identifiedSession(session)
  if (!identified) throw configLockedError(source)
  const entries = requiredSecretPurposes(config).filter((entry) => entry.required)
  if (entries.length === 0) return readConfigAccess(ctx, source, session)
  const secrets = sourceSecretsSchema.parse(rawSecrets)
  const missing = entries.filter((entry) => !secrets[entry.field])
  if (missing.length > 0) throw new DomainError("Informe a senha desta fonte para liberar a configuração.", "DATA_SOURCE_SECRET_REQUIRED", 422, { fields: missing.map((entry) => entry.field) })

  const owner: AttemptOwner = { organizationId, personId: identified.personId, config, sourceId: source.id, name: source.name }
  const attempt = await reserveCredentialAttempt(ctx, owner)
  let matches = true
  try {
    // Sempre todos os campos, sem parar no primeiro que não confere.
    for (const entry of entries) {
      const stored = await ctx.secrets.get({ sourceId: source.id, purpose: entry.purpose })
      if (stored === null) {
        await settleCredentialAttempt(ctx, attempt.id, "REFUSED")
        throw new DomainError("Esta fonte não tem credencial guardada. Troque a credencial para continuar.", "DATA_SOURCE_SECRET_REQUIRED", 422, { fields: entries.map((item) => item.field) })
      }
      if (!sameCredential(entry.field, secrets[entry.field]!, stored)) matches = false
    }
  } catch (error) {
    if (!(error instanceof DomainError)) await settleCredentialAttempt(ctx, attempt.id, "REFUSED")
    throw error
  }
  if (!matches) {
    await recordAudit(ctx.db, { organizationId, actorId: identified.personId, action: "DATA_HUB_CONFIG_UNLOCK_FAILED", entityType: "data_source", entityId: source.id, payload: { sourceId: source.id, name: source.name } })
    throw (await blockedAfterRefusal(ctx, owner, attempt)) ?? new DomainError(INCORRECT_MESSAGE, "DATA_SOURCE_SECRET_INCORRECT", 422)
  }
  await settleCredentialAttempt(ctx, attempt.id, "SUCCEEDED")
  const now = ctx.clock.now()
  const expiresAt = await grantConfigUnlock(ctx.db, { organizationId, sourceId: source.id, session: identified, method: "PASSWORD_ENTERED", now })
  await recordAudit(ctx.db, { organizationId, actorId: identified.personId, action: "DATA_HUB_CONFIG_UNLOCKED", entityType: "data_source", entityId: source.id, payload: { sourceId: source.id, name: source.name, method: "PASSWORD_ENTERED", expiresAt: expiresAt.toISOString() } })
  return readConfigAccess(ctx, source, session)
}

// ---------------------------------------------------------------------------------------------
// Credencial NOVA: precisa funcionar de verdade antes de ser gravada
// ---------------------------------------------------------------------------------------------
function typedSecretStore(config: SourceConfig, secrets: SourceSecrets): SecretStore {
  const byPurpose = new Map<SecretPurpose, string>()
  for (const entry of requiredSecretPurposes(config)) {
    const value = secrets[entry.field]
    if (value) byPurpose.set(entry.purpose, value)
  }
  const readOnly = () => Promise.reject(new Error("O teste de credencial não grava nada."))
  return { get: async ({ purpose }) => byPurpose.get(purpose) ?? null, put: readOnly, revoke: readOnly, describe: async () => [] }
}

/** Sem fixar a chave do servidor: o teste ainda não mudou nada na fonte, e a primeira carga depois da troca é quem fixa. */
function sftpWithoutHostKeyPin(sftp: SftpClient): SftpClient {
  const withoutPin = (connection: SftpConnection): SftpConnection => {
    const copy = { ...connection }
    delete copy.onHostKey
    return copy
  }
  return { list: (connection, directory) => sftp.list(withoutPin(connection), directory), download: (connection, path) => sftp.download(withoutPin(connection), path) }
}

function scrubbed(message: string, secrets: SourceSecrets): string {
  return Object.values(secrets).reduce<string>((text, secret) => (secret ? text.split(secret).join("***") : text), message)
}

/**
 * Conecta no destino `config` com o que foi digitado, sem ler nem gravar nada guardado. Falha vira `DataRunError` com código estável.
 * Com `proveWith`, uma API também precisa provar que confere a credencial (`proveApiCredential`).
 */
export async function testTypedCredential(ctx: DataHubContext, source: Pick<DataSourceRow, "id">, config: SourceConfig, secrets: SourceSecrets, options: { proveWith?: DataFeedRow[] } = {}): Promise<CredentialProof> {
  const draft = { ...source, config } as DataSourceRow
  const typedCtx: DataHubContext = { ...ctx, secrets: typedSecretStore(config, secrets), sftp: sftpWithoutHostKeyPin(ctx.sftp) }
  try {
    if (config.kind === "API_PULL") {
      if (options.proveWith) return await proveApiCredential(typedCtx, draft, options.proveWith)
      await testApiConnection(typedCtx, draft)
    } else if (config.kind === "SFTP") await testSftpConnection(typedCtx, draft)
    else if (config.kind === "DATABASE") await testDatabaseConnection(ctx, resolveDatabaseConnection(config.database, secrets.password ?? ""), source.id)
    return "PROVEN"
  } catch (error) {
    if (error instanceof DataRunError) throw new DataRunError(error.code, scrubbed(error.message, secrets), error.details)
    throw new DataRunError("DATA_SOURCE_UNREACHABLE", scrubbed(error instanceof Error ? error.message : "Falha ao testar a credencial.", secrets))
  }
}

/**
 * Limite de tentativas + teste real de uma credencial nova. Recusa do servidor conta no mesmo limite da liberação: sem isso, esta rota
 * serviria para testar senhas à vontade. Queda de rede não conta, mas também não grava. `session` nula = chamada interna sem pessoa
 * (provas de serviço): o teste continua obrigatório.
 */
export async function verifyNewCredential(ctx: DataHubContext, source: DataSourceRow, config: SourceConfig, secrets: SourceSecrets, session: IdentifiedSession | null): Promise<CredentialProof> {
  const fields = credentialFields(config)
  const missing = fields.filter((field) => !secrets[field])
  if (missing.length > 0) throw new DomainError("Informe a credencial completa desta fonte.", "DATA_SOURCE_SECRET_REQUIRED", 422, { fields: missing })
  const owner = attemptOwnerOf(session, { organizationId: source.organizationId, config, sourceId: source.id, name: source.name })
  const attempt = owner ? await reserveCredentialAttempt(ctx, owner) : null
  const refused = (errorCode: string) => recordAudit(ctx.db, { organizationId: source.organizationId, actorId: session?.personId ?? null, action: "DATA_HUB_SECRET_ROTATION_FAILED", entityType: "data_source", entityId: source.id, payload: { sourceId: source.id, name: source.name, errorCode } })
  let proof: CredentialProof
  try {
    proof = await testTypedCredential(ctx, source, config, secrets, config.kind === "API_PULL" ? { proveWith: await listFeedsOfSource(ctx.db, source.organizationId, source.id) } : {})
  } catch (error) {
    if (!(error instanceof DataRunError)) {
      if (attempt) await settleCredentialAttempt(ctx, attempt.id, "REFUSED")
      throw error
    }
    await refused(error.code)
    const failure = new DomainError(`A credencial nova não foi gravada: o teste de conexão falhou. ${error.message}`, error.code, 422)
    const passwordRefused = isCredentialRefusal(error)
    if (attempt && !passwordRefused) await settleCredentialAttempt(ctx, attempt.id, "REFUSED")
    throw attempt && owner && passwordRefused ? ((await blockedAfterRefusal(ctx, owner, attempt)) ?? failure) : failure
  }
  // Sem como provar a nova, só troca quem já provou conhecer a atual. Quem está liberado passou por isso.
  if (proof === "UNPROVEN" && session && !(await activeUnlock(ctx.db, source.id, session, ctx.clock.now()))) {
    if (attempt) await settleCredentialAttempt(ctx, attempt.id, "REFUSED")
    await refused("DATA_SOURCE_CREDENTIAL_UNPROVEN")
    throw new DomainError("Esta API responde igual com e sem credencial, então não dá para provar a nova. Libere a configuração com a credencial atual e troque em seguida.", "DATA_SOURCE_CREDENTIAL_UNPROVEN", 422)
  }
  if (attempt) await settleCredentialAttempt(ctx, attempt.id, "SUCCEEDED")
  return proof
}

/**
 * Cadastro: a credencial digitada é testada antes de gravar. Se o servidor recusa, nada é gravado e a recusa conta no limite; assim
 * nenhuma fonte guarda um palpite para testar depois com "Testar conexão". Servidor fora do alcance não impede o cadastro: a rede pode
 * estar para ser liberada, e é só depois disso que o teste de conexão faz sentido. O mesmo vale para o que não julga a senha, como a
 * chave do servidor SFTP divergente.
 */
export async function refuseRejectedCredential(ctx: DataHubContext, input: { organizationId: string; name: string; config: SourceConfig; secrets: SourceSecrets; session: ConfigSession | null }): Promise<void> {
  const owner = attemptOwnerOf(input.session, { organizationId: input.organizationId, config: input.config, sourceId: null, name: input.name })
  const attempt = owner ? await reserveCredentialAttempt(ctx, owner) : null
  try {
    await testTypedCredential(ctx, { id: `draft:${input.organizationId}:${credentialTargetKey(input.config)}` }, input.config, input.secrets)
  } catch (error) {
    if (!(error instanceof DataRunError) || !isCredentialRefusal(error)) {
      if (attempt) await settleCredentialAttempt(ctx, attempt.id, "REFUSED")
      if (error instanceof DataRunError) return
      throw error
    }
    await recordAudit(ctx.db, { organizationId: input.organizationId, actorId: input.session?.personId ?? null, action: "DATA_HUB_SOURCE_CREATE_REFUSED", entityType: "data_source", entityId: input.organizationId, payload: { name: input.name, target: describeSourceTarget(input.config), errorCode: error.code } })
    const failure = new DomainError(`A fonte não foi cadastrada: o servidor recusou a credencial. ${error.message}`, error.code, 422)
    throw (attempt && owner ? await blockedAfterRefusal(ctx, owner, attempt) : null) ?? failure
  }
  if (attempt) await settleCredentialAttempt(ctx, attempt.id, "SUCCEEDED")
}

/**
 * Depois de trocar a credencial, quem foi liberado com a anterior precisa provar a nova. Quem trocou continua liberado: ou já estava
 * liberado com a atual, ou a fonte e os conjuntos não guardam outro valor oculto para ele ver (`refuseCredentialChangeOverHiddenValues`,
 * em `source-service.ts`, recusa a troca antes).
 */
export async function resetUnlocksAfterCredentialChange(db: Queryable, input: { organizationId: string; sourceId: string; session: IdentifiedSession | null; now: Date }): Promise<void> {
  await revokeConfigUnlocks(db, input.sourceId, input.now)
  if (input.session) await grantConfigUnlock(db, { organizationId: input.organizationId, sourceId: input.sourceId, session: input.session, method: "CREDENTIAL_CHANGED", now: input.now })
}
