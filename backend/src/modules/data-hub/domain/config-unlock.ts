import { isDeepStrictEqual } from "node:util"
import type { SourceConfig } from "./source-config.js"
import { safeOrigin } from "./source-credentials.js"

/**
 * LIBERAÇÃO DA CONFIGURAÇÃO — regras puras. Quem digita a credencial da fonte fica liberado por 30 minutos; 5 falhas em 15 minutos
 * por pessoa e fonte bloqueiam novas tentativas, e o bloqueio acaba quando a falha que completou o limite sai da janela.
 */
export const CONFIG_UNLOCK_MINUTES = 30
export const CONFIG_UNLOCK_MAX_FAILURES = 5
export const CONFIG_UNLOCK_WINDOW_MINUTES = 15

export type ConfigUnlockMethod = "PASSWORD_ENTERED" | "SOURCE_CREATED" | "CREDENTIAL_CHANGED"

export type CredentialThrottle = { locked: false } | { locked: true; retryAt: Date }

export function credentialThrottle(failures: readonly Date[], now: Date): CredentialThrottle {
  const windowMs = CONFIG_UNLOCK_WINDOW_MINUTES * 60_000
  const recent = failures.filter((at) => now.getTime() - at.getTime() < windowMs).sort((a, b) => a.getTime() - b.getTime())
  if (recent.length < CONFIG_UNLOCK_MAX_FAILURES) return { locked: false }
  return { locked: true, retryAt: new Date(recent[recent.length - CONFIG_UNLOCK_MAX_FAILURES]!.getTime() + windowMs) }
}

// ---------------------------------------------------------------------------------------------
// O que entra no registro sobre uma fonte. Só campos seguros têm valor; o resto aparece pelo nome.
// ---------------------------------------------------------------------------------------------
export type SourceTarget = Record<string, string | number | null>

/** Para onde a fonte aponta, sem segredo: nunca cabeçalho, certificado, chave ou caminho da URL (que pode levar token). */
export function describeSourceTarget(config: SourceConfig): SourceTarget {
  if (config.kind === "DATABASE") {
    const database = config.database
    return { engine: database.engine, host: database.host, port: database.port ?? null, instance: database.instanceName ?? null, database: database.database, username: database.username, tls: database.tls?.mode ?? null }
  }
  if (config.kind === "SFTP") return { host: config.sftp.host, port: config.sftp.port, username: config.sftp.username, authKind: config.sftp.authKind }
  if (config.kind === "API_PULL") {
    const auth = config.api.auth
    return { origin: safeOrigin(config.api.baseUrl), authKind: auth.kind, username: auth.kind === "BASIC" ? auth.username : null, tokenOrigin: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? safeOrigin(auth.tokenUrl) : null }
  }
  return {}
}

/** Campos de configuração sem valor no registro: mudou, mas o conteúdo não aparece. */
function restOfConfig(config: SourceConfig): Record<string, unknown> {
  if (config.kind === "DATABASE") return { caCertificate: config.database.tls?.caCertificate ?? null, connectTimeoutMs: config.database.connectTimeoutMs, queryTimeoutMs: config.database.queryTimeoutMs }
  if (config.kind === "SFTP") return { remoteDirectory: config.sftp.remoteDirectory, hostKeyFingerprint: config.sftp.hostKeyFingerprint ?? null, timeoutMs: config.sftp.timeoutMs }
  if (config.kind === "API_PULL") {
    const auth = config.api.auth
    return { baseUrl: config.api.baseUrl, headers: config.api.headers, timeoutMs: config.api.timeoutMs, headerName: auth.kind === "API_KEY" ? auth.headerName : null, clientId: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.clientId : null, tokenUrl: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.tokenUrl : null, scope: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.scope ?? null : null }
  }
  return {}
}

export type FieldChange = { field: string; before: unknown; after: unknown }
export type SourceChanges = { changes: FieldChange[]; changedFields: string[] }

const changedKeys = (before: Record<string, unknown>, after: Record<string, unknown>) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !isDeepStrictEqual(normalized(before[key]), normalized(after[key])))

/** O JSONB muda a ordem das chaves e descarta `undefined`: a comparação não pode ver diferença onde não houve mudança. */
function normalized(value: unknown): unknown {
  return value === undefined ? null : JSON.parse(JSON.stringify(value))
}

export function sourceChanges(before: { name: string; description: string | null; config: SourceConfig }, after: { name: string; description: string | null; config: SourceConfig }): SourceChanges {
  const safeBefore: Record<string, unknown> = { name: before.name, description: before.description, ...describeSourceTarget(before.config) }
  const safeAfter: Record<string, unknown> = { name: after.name, description: after.description, ...describeSourceTarget(after.config) }
  const changes = changedKeys(safeBefore, safeAfter).map((field) => ({ field, before: safeBefore[field] ?? null, after: safeAfter[field] ?? null }))
  return { changes, changedFields: changedKeys(restOfConfig(before.config), restOfConfig(after.config)) }
}

/** Campos alterados de um conjunto de dados, só pelo nome: mapeamento e conector citam colunas do cliente. */
export function feedChangedFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return changedKeys(before, after)
}
