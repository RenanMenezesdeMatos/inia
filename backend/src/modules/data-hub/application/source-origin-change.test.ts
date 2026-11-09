import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { MASKED_VALUE } from "../domain/config-mask.js"
import { feedConnectorConfigSchema, type SourceConfig } from "../domain/source-config.js"
import { InMemorySecretStore, MockHttpClient, json } from "../testing/fakes.js"
import { fetchApiRecords } from "./connectors/api-pull-connector.js"
import { createDataHubContext } from "./data-hub-context.js"
import type { DataFeedRow } from "./records.js"
import { requireSource } from "./records.js"
import { testSourceConnection, updateSource } from "./source-service.js"

/**
 * Valor escondido (cabeçalho extra, parâmetro fixo, o que vem depois do "?") só vale para o servidor em que foi digitado. Numa API
 * Pull sem autenticação não há senha a pedir: quem tem o papel trocava a Base URL para um servidor próprio mantendo o valor
 * escondido, e o "Testar conexão", a prova da credencial ou a carga entregavam o valor lá. Nenhuma rede: HTTP falso.
 */
const ORG = "org-1"
const SOURCE_ID = "6f1c2a8e-3333-4c5e-9d1a-000000000001"
const OLD = "https://api.cliente.local/v1"
const ATTACKER = "https://atacante.example/v1"
const HEADER_SECRET = "segredo-do-cabecalho"
const FEED_SECRET = "segredo-do-conjunto"
const SESSION = { personId: "person-1", sessionId: "jti-1" }

type Auth = Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"]
const apiConfig = (baseUrl: string, headers: Record<string, string>, auth: Auth = { kind: "NONE" }): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth, headers, timeoutMs: 30_000 } })
const feedRow = (name: string, api: Record<string, unknown>) => ({ id: `feed-${name}`, organizationId: ORG, sourceId: SOURCE_ID, name, connectorConfig: feedConnectorConfigSchema.parse({ connector: "API_PULL", api: { endpoint: "/dados", extractPath: "data", ...api } }) }) as DataFeedRow
const secretFeed = () => feedRow("Pessoas", { queryParams: { chave: FEED_SECRET }, headers: { "X-Conjunto": FEED_SECRET } })

/** Banco falso: a fonte e os conjuntos vêm do estado; a gravação da fonte atualiza o estado, como o banco faria. */
function fakeDatabase(state: { config: SourceConfig; feeds: DataFeedRow[]; unlocked?: boolean }) {
  const rows = (sql: string): unknown[] => {
    if (sql.includes("from data_sources s")) return [{ id: SOURCE_ID, organizationId: ORG, name: "API do cliente", description: null, kind: "API_PULL", status: "ACTIVE", config: state.config }]
    if (sql.includes("from data_feeds f")) return state.feeds
    if (sql.includes("from data_source_config_unlocks")) return state.unlocked ? [{ expires_at: new Date(Date.now() + 10 * 60_000) }] : []
    if (sql.includes("insert into data_source_credential_attempts")) return [{ id: "1" }]
    return []
  }
  const run = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("update data_sources set name")) state.config = JSON.parse(String(params[3])) as SourceConfig
    const result = rows(sql)
    return { rows: result, rowCount: result.length }
  }
  const client = { query: vi.fn(run), release: vi.fn() }
  return { query: vi.fn(run), connect: vi.fn(async () => client) } as unknown as Database
}

function setup(state: { config: SourceConfig; feeds: DataFeedRow[]; unlocked?: boolean }) {
  const http = new MockHttpClient().on("/", (request) => (request.headers.authorization === undefined && state.config.kind === "API_PULL" && state.config.api.auth.kind !== "NONE" ? json(401, {}) : json(200, { data: [] })))
  const secrets = new InMemorySecretStore()
  const ctx = createDataHubContext(fakeDatabase(state), { http, secrets })
  /** Tudo que saiu para o servidor do atacante, com cabeçalhos e endereço completos. */
  const leaked = () => http.requests.filter((request) => new URL(request.url).host === "atacante.example").map((request) => JSON.stringify(request))
  return { ctx, http, secrets, leaked }
}

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof DomainError ? { code: error.code, statusCode: error.statusCode, details: error.details } : error),
  )

describe("trocar o servidor de uma API Pull não leva valores escondidos", () => {
  it("fonte sem autenticação: Base URL nova com o cabeçalho escondido é recusada, e o teste de conexão continua no servidor de antes", async () => {
    const state = { config: apiConfig(OLD, { "X-Api-Token": HEADER_SECRET }), feeds: [] }
    const { ctx, leaked } = setup(state)
    const refusal = await refusalOf(updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig(ATTACKER, { "X-Api-Token": MASKED_VALUE }) }, SESSION))
    expect(refusal).toEqual({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { field: "Cabeçalho: X-Api-Token", reason: "ORIGIN_CHANGED" } })
    expect(state.config).toEqual(apiConfig(OLD, { "X-Api-Token": HEADER_SECRET }))
    await testSourceConnection(ctx, ORG, "actor-1", SOURCE_ID)
    expect(leaked()).toEqual([])
  })

  it("fonte sem autenticação: Base URL nova com conjunto que guarda valor escondido é recusada, e a carga continua no servidor de antes", async () => {
    const state = { config: apiConfig(OLD, {}), feeds: [secretFeed(), feedRow("Sem segredo", {})] }
    const { ctx, leaked } = setup(state)
    const refusal = await refusalOf(updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig(ATTACKER, {}) }, SESSION))
    expect(refusal).toEqual({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { reason: "ORIGIN_CHANGED", feeds: [{ id: "feed-Pessoas", name: "Pessoas" }] } })
    expect(state.config).toEqual(apiConfig(OLD, {}))
    await fetchApiRecords(ctx, await requireSource(ctx.db, ORG, SOURCE_ID), state.feeds[0]!, { checkpoint: null })
    expect(leaked()).toEqual([])
  })

  it("fonte com credencial sem liberação viva: recusa antes da prova da credencial nova chamar os conjuntos no servidor novo", async () => {
    const state = { config: apiConfig(OLD, {}, { kind: "BEARER" }), feeds: [secretFeed()], unlocked: false }
    const { ctx, secrets, leaked } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: "TOKEN-ANTIGO", actorId: null })
    const refusal = await refusalOf(updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig(ATTACKER, {}, { kind: "BEARER" }), secrets: { token: "TOKEN-DO-ATACANTE" } }, SESSION))
    expect(refusal).toMatchObject({ code: "DATA_SOURCE_MASKED_VALUE", details: { reason: "ORIGIN_CHANGED" } })
    expect(leaked()).toEqual([])
  })

  it("mesmo servidor com outro caminho: cabeçalho escondido mantém o guardado, mesmo com conjunto que guarda valor escondido", async () => {
    const state = { config: apiConfig(OLD, { "X-Api-Token": HEADER_SECRET }), feeds: [secretFeed()] }
    const { ctx } = setup(state)
    await updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig("https://api.cliente.local/v2", { "X-Api-Token": MASKED_VALUE }) }, SESSION)
    expect(state.config).toEqual(apiConfig("https://api.cliente.local/v2", { "X-Api-Token": HEADER_SECRET }))
  })

  it("servidor novo com o cabeçalho digitado de novo e conjuntos sem valor escondido é aceito", async () => {
    const state = { config: apiConfig(OLD, { "X-Api-Token": HEADER_SECRET }), feeds: [feedRow("Sem segredo", {})] }
    const { ctx } = setup(state)
    await updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig("https://novo.cliente.local/v1", { "X-Api-Token": "digitado" }) }, SESSION)
    expect(state.config).toEqual(apiConfig("https://novo.cliente.local/v1", { "X-Api-Token": "digitado" }))
  })

  it("fonte com credencial e liberação viva: quem já vê os valores troca o servidor, e os conjuntos seguem com ele", async () => {
    const state = { config: apiConfig(OLD, {}, { kind: "BEARER" }), feeds: [secretFeed()], unlocked: true }
    const { ctx, secrets } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: "TOKEN-ANTIGO", actorId: null })
    await updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "API do cliente", config: apiConfig("https://novo.cliente.local/v1", {}, { kind: "BEARER" }), secrets: { token: "TOKEN-NOVO" } }, SESSION)
    expect(state.config).toEqual(apiConfig("https://novo.cliente.local/v1", {}, { kind: "BEARER" }))
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe("TOKEN-NOVO")
  })
})
