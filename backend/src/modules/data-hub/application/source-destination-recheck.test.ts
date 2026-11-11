import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { SourceConfig } from "../domain/source-config.js"
import { InMemorySecretStore, MockHttpClient, json } from "../testing/fakes.js"
import { createDataHubContext } from "./data-hub-context.js"
import { rotateSourceSecrets, updateSource } from "./source-service.js"

/**
 * A credencial só vale para o destino em que foi provada (achado da 5ª auditoria, POST /sources/:id/secrets). A troca de credencial testa
 * a nova no destino lido ANTES da transação; se outra pessoa troca o destino nesse meio-tempo, gravar a credencial a ligaria ao destino
 * novo, para onde o "Testar conexão" a mandaria. Na transação, com a linha travada, o destino gravado agora precisa ser o lido antes.
 * O mesmo no PATCH: gravar a configuração lida antes por cima de uma troca de destino devolveria a credencial nova ao destino antigo.
 * Banco e HTTP falsos, nenhuma rede.
 */
const ORG = "org-1"
const SOURCE_ID = "6f1c2a8e-3333-4c5e-9d1a-000000000003"
const BASE = "https://api.cliente.local/v1"
const OTHER = "https://coletor.outro.example/v1"
const SESSION = { personId: "person-1", sessionId: "jti-1" }
const apiConfig = (baseUrl = BASE): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth: { kind: "BEARER" }, headers: {}, timeoutMs: 30_000 } })

/** `onBegin`: o que outra pessoa confirma entre a leitura de antes (e a prova) e a transação de escrita. */
type State = { config: SourceConfig; unlocked: boolean; onBegin?: (state: State) => void }

function setup(state: State) {
  const transaction: string[] = []
  const rows = (sql: string): unknown[] => {
    if (sql.includes("from data_sources s")) return [{ id: SOURCE_ID, organizationId: ORG, name: "API do cliente", description: null, kind: "API_PULL", status: "ACTIVE", config: state.config }]
    if (sql.includes("from data_source_config_unlocks")) return state.unlocked ? [{ expires_at: new Date(Date.now() + 10 * 60_000) }] : []
    if (sql.includes("insert into data_source_credential_attempts")) return [{ id: "1" }]
    return []
  }
  const run = async (sql: string, params: unknown[] = []) => {
    if (sql.includes("update data_sources set name")) state.config = JSON.parse(String(params[3])) as SourceConfig
    const result = rows(sql)
    return { rows: result, rowCount: result.length }
  }
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      transaction.push(sql)
      if (sql === "begin") state.onBegin?.(state)
      return run(sql, params)
    }),
    release: vi.fn(),
  }
  const db = { query: vi.fn(run), connect: vi.fn(async () => client) } as unknown as Database
  const http = new MockHttpClient().on("/", (request) => (Object.keys(request.headers).some((name) => name.toLowerCase() === "authorization") ? json(200, { data: [] }) : json(401, {})))
  const secrets = new InMemorySecretStore()
  return { ctx: createDataHubContext(db, { http, secrets }), secrets, transaction }
}

const refusalOf = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => (error instanceof DomainError ? { code: error.code, statusCode: error.statusCode } : error),
  )

const expectLockedAndRolledBack = (transaction: string[]) => {
  expect(transaction.some((sql) => sql.includes("from data_sources s") && sql.includes("for update"))).toBe(true)
  expect(transaction.filter((sql) => /^\s*(insert|update|delete)\s/i.test(sql))).toEqual([])
  expect(transaction.at(-1)).toBe("rollback")
}

describe("credencial gravada só para o destino em que foi provada", () => {
  it.each([
    ["sem liberação", false],
    ["com liberação viva", true],
  ])("POST /secrets (%s): destino trocado por outra pessoa durante a prova → 409, sem gravar a credencial", async (_label, unlocked) => {
    const state: State = { config: apiConfig(), unlocked, onBegin: (current) => (current.config = apiConfig(OTHER)) }
    const { ctx, secrets, transaction } = setup(state)
    await secrets.put({ organizationId: ORG, sourceId: SOURCE_ID, purpose: "API_AUTH", value: "TOKEN-DO-OUTRO", actorId: null })
    const refusal = await refusalOf(rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: "TOKEN-NOVO" }, SESSION))
    expect(refusal).toEqual({ code: "DATA_SOURCE_DESTINATION_CHANGED", statusCode: 409 })
    expectLockedAndRolledBack(transaction)
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe("TOKEN-DO-OUTRO")
  })

  it("POST /secrets: mudança no mesmo servidor (outro caminho) não é troca de destino, e a credencial é gravada", async () => {
    const state: State = { config: apiConfig(), unlocked: false, onBegin: (current) => (current.config = apiConfig(`${BASE}/v2`)) }
    const { ctx, secrets } = setup(state)
    await rotateSourceSecrets(ctx, ORG, "actor-1", SOURCE_ID, { token: "TOKEN-NOVO" }, SESSION)
    expect(await secrets.get({ sourceId: SOURCE_ID, purpose: "API_AUTH" })).toBe("TOKEN-NOVO")
  })

  it("PATCH só do nome: destino trocado por outra pessoa no meio → 409, sem devolver o destino antigo por cima", async () => {
    const state: State = { config: apiConfig(), unlocked: true, onBegin: (current) => (current.config = apiConfig(OTHER)) }
    const { ctx, transaction } = setup(state)
    const refusal = await refusalOf(updateSource(ctx, ORG, "actor-1", SOURCE_ID, { name: "Outro nome" }, SESSION))
    expect(refusal).toEqual({ code: "DATA_SOURCE_DESTINATION_CHANGED", statusCode: 409 })
    expectLockedAndRolledBack(transaction)
    expect(state.config).toEqual(apiConfig(OTHER))
  })
})
