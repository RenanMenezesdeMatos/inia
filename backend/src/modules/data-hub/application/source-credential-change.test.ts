import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { MASKED_VALUE } from "../domain/config-mask.js"
import { feedConnectorConfigSchema, type SourceConfig } from "../domain/source-config.js"
import { InMemorySecretStore, MockHttpClient, json } from "../testing/fakes.js"
import { createDataHubContext } from "./data-hub-context.js"
import type { DataFeedRow } from "./records.js"
import { rotateSourceSecrets, updateSource } from "./source-service.js"

/**
 * Trocar a credencial libera a configuração para quem trocou, e a liberação mostra os valores ocultos da fonte e dos conjuntos. Numa API
 * Pull com token, a prova da nova só diz que ela vale nessa API, não que é a da fonte: quem tinha o papel e um token PRÓPRIO válido
 * trocava a credencial e passava a ver cabeçalhos, parâmetros e endpoint que nunca soube. Banco e HTTP falsos, nenhuma rede.
 */
const ORG = "org-1"
const SOURCE_ID = "6f1c2a8e-3333-4c5e-9d1a-000000000002"
const BASE = "https://api.cliente.local/v1"
const STORED_TOKEN = "TOKEN-GUARDADO-DA-FONTE"
const OWN_TOKEN = "TOKEN-PROPRIO-DE-QUEM-TROCA"
const SECRET = "segredo-que-quem-troca-nunca-viu"
const SESSION = { personId: "person-1", sessionId: "jti-1" }

type Auth = Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"]
const BEARER: Auth = { kind: "BEARER" }
const API_KEY: Auth = { kind: "API_KEY", headerName: "X-API-Key" }
const NONE: Auth = { kind: "NONE" }
const apiConfig = (headers: Record<string, string>, auth: Auth = BEARER, baseUrl = BASE): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth, headers, timeoutMs: 30_000 } })
const feedRow = (name: string, api: Record<string, unknown> = {}) => ({ id: `feed-${name}`, organizationId: ORG, sourceId: SOURCE_ID, name, connectorConfig: feedConnectorConfigSchema.parse({ connector: "API_PULL", api: { endpoint: "/dados", extractPath: "data", ...api } }) }) as DataFeedRow
const secretFeed = () => feedRow("Pessoas", { headers: { "X-Conjunto": SECRET } })

/** `onBegin`: o que outra pessoa grava (e confirma) entre a conferência de antes e a transação de escrita. */
type State = { config: SourceConfig; feeds: DataFeedRow[]; unlocked?: boolean; onBegin?: (state: State) => void }

/**
 * Banco falso: a fonte, os conjuntos e a liberação vêm do estado; cada comando fica anotado para conferir que nada foi gravado. Os da
 * transação também ficam à parte, em `transaction`.
 */
function fakeDatabase(state: State, statements: string[], transaction: string[] = []) {
  const rows = (sql: string): unknown[] => {
    if (sql.includes("from data_sources s")) return [{ id: SOURCE_ID, organizationId: ORG, name: "API do cliente", description: null, kind: "API_PULL", status: "ACTIVE", config: state.config }]
    if (sql.includes("from data_feeds f")) return state.feeds
    if (sql.includes("from data_source_config_unlocks")) return state.unlocked ? [{ expires_at: new Date(Date.now() + 10 * 60_000) }] : []
    if (sql.includes("insert into data_source_credential_attempts")) return [{ id: "1" }]
    return []
  }
  const run = async (sql: string, params: unknown[] = []) => {
    statements.push(sql)
    if (sql.includes("update data_sources set name")) state.config = JSON.parse(String(params[3])) as SourceConfig
    const result = rows(sql)
    return { rows: result, rowCount: result.length }
  }
  const runInTransaction = async (sql: string, params: unknown[] = []) => {
    transaction.push(sql)
    if (sql === "begin") state.onBegin?.(state)
    return run(sql, params)
  }
  const client = { query: vi.fn(runInTransaction), release: vi.fn() }
  return { query: vi.fn(run), connect: vi.fn(async () => client) } as unknown as Database
}

function setup(state: State) {
  // A API confere a credencial (sem nenhuma, 401) e aceita qualquer token: é assim que um token próprio válido passa na prova.
  const authorized = (headers: Record<string, string>) => Object.keys(headers).some((name) => ["authorization", "x-api-key"].includes(name.toLowerCase()))
  const http = new MockHttpClient().on("/", (request) => (authorized(request.headers) ? json(200, { data: [] }) : json(401, {})))
  const secrets = new InMemorySecretStore()
  const statements: string[] = []
  const transaction: string[] = []
  const ctx = createDataHubContext(fakeDatabase(state, statements, transaction), { http, secrets })
  const isWrite = (sql: string) => /^\s*(insert|update|delete)\s/i.test(sql)
  const writes = () => statements.filter(isWrite)
  return { ctx, http, secrets, writes, transaction, isWrite }
}

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof DomainError ? { code: error.code, statusCode: error.statusCode, details: error.details, message: error.message } : error),
  )

describe("trocar a credencial não mostra a quem troca os valores ocultos que ele nunca viu", () => {
  it.each([
    ["BEARER", BEARER, "token"],
    ["API_KEY", API_KEY, "apiKey"],
  ] as const)("POST /secrets (%s) com token próprio válido e conjunto com valor oculto, sem liberação: 422 antes de qualquer chamada ou gravação", async (_label, auth, field) => {
    const state: State = { config: apiConfig({}, auth), feeds: [secretFeed(), feedRow("Sem segredo")], unlocked: false }
    const { ctx, http, secrets, writes } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: STORED_TOKEN, actorId: null })
    const refusal = await refusalOf(rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { [field]: OWN_TOKEN }, SESSION))
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "CREDENTIAL_CHANGED", fields: [], feeds: [{ id: "feed-Pessoas", name: "Pessoas" }] } })
    expect(http.requests).toEqual([])
    expect(writes()).toEqual([])
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe(STORED_TOKEN)
  })

  it("POST /secrets: cabeçalho e o que vem depois do \"?\" na Base URL da própria fonte também contam, e a mensagem diz o caminho sem citar o valor", async () => {
    const state: State = { config: apiConfig({ "X-Tenant": SECRET }, BEARER, `${BASE}?chave=${SECRET}`), feeds: [], unlocked: false }
    const { ctx, http, secrets, writes } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: STORED_TOKEN, actorId: null })
    const refusal = (await refusalOf(rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: OWN_TOKEN }, SESSION))) as { details: unknown; message: string } | null
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "CREDENTIAL_CHANGED", fields: ["Base URL", "Cabeçalho: X-Tenant"], feeds: [] } })
    expect(refusal?.message).toContain("credencial atual")
    expect(refusal?.message).toContain("digite-os de novo")
    expect(JSON.stringify(refusal)).not.toContain(SECRET)
    expect(http.requests).toEqual([])
    expect(writes()).toEqual([])
  })

  it("POST /secrets com liberação viva: quem provou a credencial atual já vê os valores, e a troca segue", async () => {
    const state: State = { config: apiConfig({ "X-Tenant": SECRET }), feeds: [secretFeed()], unlocked: true }
    const { ctx, secrets } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: STORED_TOKEN, actorId: null })
    await rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: "TOKEN-NOVO" }, SESSION)
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe("TOKEN-NOVO")
  })

  it("POST /secrets sem outros valores ocultos: a senha mudou no servidor, e quem tem a nova troca sem liberação, como antes", async () => {
    const state: State = { config: apiConfig({}), feeds: [feedRow("Sem segredo")], unlocked: false }
    const { ctx, http, secrets } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: STORED_TOKEN, actorId: null })
    await rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: "TOKEN-NOVO" }, SESSION)
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe("TOKEN-NOVO")
    expect(http.requests.length).toBeGreaterThan(0) // a prova da nova continua obrigatória
  })

  it("PATCH que passa a fonte sem autenticação para token mantendo valores ocultos: 422 antes de qualquer chamada ou gravação", async () => {
    const state: State = { config: apiConfig({ "X-Tenant": SECRET }, NONE), feeds: [secretFeed()] }
    const { ctx, http, writes } = setup(state)
    const refusal = await refusalOf(updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig({ "X-Tenant": MASKED_VALUE }), secrets: { token: OWN_TOKEN } }, SESSION))
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "CREDENTIAL_CHANGED", fields: ["Cabeçalho: X-Tenant"], feeds: [{ id: "feed-Pessoas", name: "Pessoas" }] } })
    expect(http.requests).toEqual([])
    expect(writes()).toEqual([])
    expect(state.config).toEqual(apiConfig({ "X-Tenant": SECRET }, NONE))
  })

  it("PATCH com o cabeçalho digitado de novo e conjuntos sem valor oculto: aceito, porque quem troca conhece tudo que passa a ver", async () => {
    const state: State = { config: apiConfig({ "X-Tenant": SECRET }, NONE), feeds: [feedRow("Sem segredo")] }
    const { ctx, secrets } = setup(state)
    await updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig({ "X-Tenant": "digitado" }), secrets: { token: OWN_TOKEN } }, SESSION)
    expect(state.config).toEqual(apiConfig({ "X-Tenant": "digitado" }))
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe(OWN_TOKEN)
  })
})

describe("valor oculto gravado por outra pessoa entre a conferência e o commit", () => {
  /** A transação travou a fonte antes de reler e terminou em rollback, sem gravar nada nela. */
  const expectLockedAndRolledBack = (transaction: string[], isWrite: (sql: string) => boolean) => {
    const lock = transaction.findIndex((sql) => sql.includes("from data_sources s") && sql.includes("for update"))
    const reread = transaction.findIndex((sql) => sql.includes("from data_feeds f"))
    expect(lock).toBeGreaterThan(-1)
    expect(reread).toBeGreaterThan(lock)
    expect(transaction.filter(isWrite)).toEqual([])
    expect(transaction).not.toContain("commit")
    expect(transaction.at(-1)).toBe("rollback")
  }

  it("POST /secrets: conjunto com valor oculto gravado depois da conferência de antes é recusado dentro da transação, sem gravar", async () => {
    const state: State = { config: apiConfig({}), feeds: [feedRow("Sem segredo")], unlocked: false, onBegin: (current) => current.feeds.push(secretFeed()) }
    const { ctx, secrets, transaction, isWrite } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: STORED_TOKEN, actorId: null })
    const refusal = await refusalOf(rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: OWN_TOKEN }, SESSION))
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "CREDENTIAL_CHANGED", fields: [], feeds: [{ id: "feed-Pessoas", name: "Pessoas" }] } })
    expectLockedAndRolledBack(transaction, isWrite)
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe(STORED_TOKEN)
  })

  it("POST /secrets: cabeçalho oculto gravado na própria fonte depois da conferência de antes também é recusado", async () => {
    const state: State = { config: apiConfig({}), feeds: [], unlocked: false, onBegin: (current) => (current.config = apiConfig({ "X-Tenant": SECRET })) }
    const { ctx, secrets, transaction, isWrite } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: STORED_TOKEN, actorId: null })
    const refusal = await refusalOf(rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: OWN_TOKEN }, SESSION))
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "CREDENTIAL_CHANGED", fields: ["Cabeçalho: X-Tenant"], feeds: [] } })
    expectLockedAndRolledBack(transaction, isWrite)
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe(STORED_TOKEN)
  })

  it("PATCH sem autenticação → token: conjunto com valor oculto gravado depois da conferência de antes é recusado, sem gravar", async () => {
    const state: State = { config: apiConfig({}, NONE), feeds: [], onBegin: (current) => current.feeds.push(secretFeed()) }
    const { ctx, secrets, transaction, isWrite } = setup(state)
    const refusal = await refusalOf(updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig({}), secrets: { token: OWN_TOKEN } }, SESSION))
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "CREDENTIAL_CHANGED", fields: [], feeds: [{ id: "feed-Pessoas", name: "Pessoas" }] } })
    expectLockedAndRolledBack(transaction, isWrite)
    expect(state.config).toEqual(apiConfig({}, NONE))
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBeNull()
  })
})
