import { describe, expect, it } from "vitest"
import { CONFIG_UNLOCK_MAX_FAILURES, CONFIG_UNLOCK_WINDOW_MINUTES, credentialThrottle, describeSourceTarget, feedChangedFields, sourceChanges } from "./config-unlock.js"
import type { SourceConfig } from "./source-config.js"
import { classifyDatabaseError } from "./database/database-errors.js"
import { DataRunError, NOT_A_CREDENTIAL_REFUSAL, isCredentialRefusal } from "./error-codes.js"
import { credentialFields, credentialTargetKey, sameCredential } from "./source-credentials.js"

const NOW = new Date("2026-11-05T12:00:00.000Z")
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000)

const database = (overrides: Partial<Extract<SourceConfig, { kind: "DATABASE" }>["database"]> = {}): SourceConfig => ({
  kind: "DATABASE",
  database: { engine: "SQLSERVER", host: "sql.cliente.local", port: 1433, database: "rh", username: "inia_leitura", tls: { mode: "VERIFY_FULL" }, connectTimeoutMs: 15_000, queryTimeoutMs: 120_000, ...overrides },
})

describe("limite de tentativas da senha da fonte", () => {
  it("bloqueia só na quinta falha dentro da janela e libera quando ela sai da janela", () => {
    const four = [1, 2, 3, 4].map(minutesAgo)
    expect(credentialThrottle(four, NOW)).toEqual({ locked: false })
    const five = [...four, minutesAgo(5)]
    expect(CONFIG_UNLOCK_MAX_FAILURES).toBe(5)
    expect(CONFIG_UNLOCK_WINDOW_MINUTES).toBe(15)
    expect(credentialThrottle(five, NOW)).toEqual({ locked: true, retryAt: new Date(minutesAgo(5).getTime() + 15 * 60_000) })
    expect(credentialThrottle([minutesAgo(16), ...four], NOW)).toEqual({ locked: false })
  })
})

describe("comparação da credencial", () => {
  it("só a credencial exata confere; chave privada aceita fim de linha do Windows", () => {
    expect(sameCredential("password", "Senha@1", "Senha@1")).toBe(true)
    expect(sameCredential("password", "senha@1", "Senha@1")).toBe(false)
    expect(sameCredential("password", "Senha@1 ", "Senha@1")).toBe(false)
    expect(sameCredential("privateKey", "-----BEGIN\r\nCHAVE\r\n-----END\r\n", "-----BEGIN\nCHAVE\n-----END")).toBe(true)
    expect(sameCredential("privateKey", "-----BEGIN\nOUTRA\n-----END", "-----BEGIN\nCHAVE\n-----END")).toBe(false)
  })

  it("só fonte com credencial guardada obrigatória exige senha, com o campo certo para cada tipo", () => {
    expect(credentialFields({ kind: "FILE_UPLOAD" })).toEqual([])
    expect(credentialFields({ kind: "API_PUSH" })).toEqual([])
    const api = (auth: Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"]): SourceConfig => ({ kind: "API_PULL", api: { baseUrl: "https://api.cliente.local", auth, headers: {}, timeoutMs: 30_000 } })
    expect(credentialFields(api({ kind: "NONE" }))).toEqual([])
    expect(credentialFields(api({ kind: "BEARER" }))).toEqual(["token"])
    expect(credentialFields(api({ kind: "API_KEY", headerName: "X-Key" }))).toEqual(["apiKey"])
    expect(credentialFields(api({ kind: "BASIC", username: "u" }))).toEqual(["password"])
    expect(credentialFields(api({ kind: "OAUTH2_CLIENT_CREDENTIALS", tokenUrl: "https://a.b/t", clientId: "c" }))).toEqual(["clientSecret"])
    expect(credentialFields(database())).toEqual(["password"])
    const sftp = (authKind: "PASSWORD" | "PRIVATE_KEY"): SourceConfig => ({ kind: "SFTP", sftp: { host: "s", port: 22, username: "u", remoteDirectory: "/", authKind, timeoutMs: 30_000 } })
    expect(credentialFields(sftp("PASSWORD"))).toEqual(["password"])
    // A frase-senha é opcional: quem tem a chave não precisa dela para liberar.
    expect(credentialFields(sftp("PRIVATE_KEY"))).toEqual(["privateKey"])
  })
})

describe("o que conta como senha recusada", () => {
  const context = { engine: "MYSQL", host: "h", port: 3306, database: "d", username: "u", phase: "CONNECT" } as const
  it("só quando o servidor julgou a credencial", () => {
    expect(isCredentialRefusal(new DataRunError("DATA_SOURCE_AUTH_FAILED", "recusada"))).toBe(true)
    expect(isCredentialRefusal(new DataRunError("DATA_SOURCE_AUTH_FAILED", "chave do servidor", NOT_A_CREDENTIAL_REFUSAL))).toBe(false)
    expect(isCredentialRefusal(new DataRunError("DATA_SOURCE_UNREACHABLE", "fora do ar"))).toBe(false)
    expect(isCredentialRefusal(classifyDatabaseError({ code: "ER_ACCESS_DENIED_ERROR", message: "Access denied for user" }, context))).toBe(true)
    expect(isCredentialRefusal(classifyDatabaseError({ code: "28P01", message: "password authentication failed" }, { ...context, engine: "POSTGRESQL" }))).toBe(true)
    expect(isCredentialRefusal(classifyDatabaseError({ number: 18456, message: "Login failed for user" }, { ...context, engine: "SQLSERVER" }))).toBe(true)
    const authMode = classifyDatabaseError({ code: "ER_NOT_SUPPORTED_AUTH_MODE", message: "Client does not support authentication protocol" }, context)
    expect(authMode.code).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(isCredentialRefusal(authMode)).toBe(false)
  })
})

describe("chave do limite de tentativas: servidor + usuário", () => {
  const api = (auth: Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"], baseUrl = "https://api.cliente.local/v1"): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth, headers: {}, timeoutMs: 30_000 } })

  it("banco: mudar banco, criptografia, tipo ou caixa não muda a chave; outro servidor, porta ou usuário muda", () => {
    const base = credentialTargetKey(database())
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    for (const same of [database({ database: "outro" }), database({ tls: { mode: "DISABLED" } }), database({ engine: "POSTGRESQL" }), database({ host: " SQL.CLIENTE.LOCAL " }), database({ username: "INIA_LEITURA" }), database({ queryTimeoutMs: 1000 })]) expect(credentialTargetKey(same)).toBe(base)
    for (const other of [database({ host: "outro.cliente.local" }), database({ port: 1434 }), database({ username: "sa" }), database({ port: 1433, instanceName: "SQLEXPRESS" })]) expect(credentialTargetKey(other)).not.toBe(base)
    // Sem porta informada vale a porta padrão do banco.
    expect(credentialTargetKey(database({ port: undefined }))).toBe(base)
  })

  it("API e SFTP: origem + usuário; quem não usa credencial não tem chave", () => {
    expect(credentialTargetKey({ kind: "FILE_UPLOAD" })).toBeNull()
    expect(credentialTargetKey({ kind: "API_PUSH" })).toBeNull()
    expect(credentialTargetKey(api({ kind: "NONE" }))).toBeNull()
    expect(credentialTargetKey(api({ kind: "BEARER" }))).toBe(credentialTargetKey(api({ kind: "BEARER" }, "https://api.cliente.local/v2")))
    expect(credentialTargetKey(api({ kind: "BEARER" }))).not.toBe(credentialTargetKey(api({ kind: "BEARER" }, "https://outra.cliente.local")))
    expect(credentialTargetKey(api({ kind: "BASIC", username: "a" }))).not.toBe(credentialTargetKey(api({ kind: "BASIC", username: "b" })))
    const sftp = (username: string): SourceConfig => ({ kind: "SFTP", sftp: { host: "s", port: 22, username, remoteDirectory: "/", authKind: "PASSWORD", timeoutMs: 30_000 } })
    expect(credentialTargetKey(sftp("a"))).not.toBe(credentialTargetKey(sftp("b")))
  })
})

describe("o que vai para o registro", () => {
  const base = { name: "RH", description: null }

  it("campos seguros mostram antes e depois; o resto aparece só pelo nome", () => {
    const changes = sourceChanges({ ...base, config: database() }, { ...base, name: "RH novo", config: database({ host: "sql2.cliente.local", database: "rh_novo", queryTimeoutMs: 60_000, tls: { mode: "VERIFY_FULL", caCertificate: "-----BEGIN CERTIFICATE-----CA" } }) })
    expect(changes.changes).toEqual(expect.arrayContaining([{ field: "name", before: "RH", after: "RH novo" }, { field: "host", before: "sql.cliente.local", after: "sql2.cliente.local" }, { field: "database", before: "rh", after: "rh_novo" }]))
    expect(changes.changedFields.sort()).toEqual(["caCertificate", "queryTimeoutMs"])
    expect(JSON.stringify(changes)).not.toContain("BEGIN CERTIFICATE")
  })

  it("API Pull: nunca grava cabeçalho, caminho da URL nem token", () => {
    const api = (headers: Record<string, string>, baseUrl: string): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth: { kind: "BEARER" }, headers, timeoutMs: 30_000 } })
    const before = api({ "X-Tenant": "valor-secreto" }, "https://api.cliente.local/v1?token=abc")
    const after = api({ "X-Tenant": "outro-valor-secreto" }, "https://api.cliente.local/v2?token=def")
    const text = JSON.stringify([describeSourceTarget(before), sourceChanges({ ...base, config: before }, { ...base, config: after })])
    expect(text).not.toMatch(/valor-secreto|token=|abc|def/)
    expect(sourceChanges({ ...base, config: before }, { ...base, config: after }).changedFields.sort()).toEqual(["baseUrl", "headers"])
  })

  it("sem mudança real, nada aparece, mesmo com as chaves em outra ordem", () => {
    expect(sourceChanges({ ...base, config: database() }, { ...base, config: database() })).toEqual({ changes: [], changedFields: [] })
    expect(feedChangedFields({ mapping: { fields: [{ target: "a", source: "b" }] }, cadence: { kind: "MANUAL" } }, { mapping: { fields: [{ source: "b", target: "a" }] }, cadence: { kind: "MANUAL" } })).toEqual([])
    expect(feedChangedFields({ name: "A", availabilityPolicy: null }, { name: "B", availabilityPolicy: undefined })).toEqual(["name"])
  })
})
