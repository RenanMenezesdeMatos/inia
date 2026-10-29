/**
 * PROVA contra o banco de TESTE real (achado N01 da 4ª auditoria): trocar o destino de uma fonte nunca deixa a credencial
 * guardada valer para o destino novo — nem durante a troca, nem quando ela falha no meio.
 *   A) com a troca parada no meio, um "Testar conexão" ainda vê o par antigo inteiro (destino antigo + credencial antiga);
 *   B) a troca e quatro testes de conexão disparados juntos, 30 vezes: a credencial antiga nunca vai para o destino novo;
 *   C) falha ao gravar a credencial nova: nada muda (destino, credencial e auditoria continuam os de antes).
 * Loja de credenciais real (AES no PostgreSQL), HTTP falso — nenhuma rede. Organização própria, apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run source-rebind-proof
 */
import { randomBytes } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import type { HttpClient, HttpRequest, SecretStore } from "../application/ports.js"
import { createSource, testSourceConnection, updateSource } from "../application/source-service.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-0000000a0001"
const OLD_URL = "https://api.cliente.example/v1"
const NEW_URL = "https://outro-destino.example/v1"
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
const config = (baseUrl: string) => ({ kind: "API_PULL", api: { baseUrl, auth: { kind: "BEARER" }, headers: {}, timeoutMs: 30_000 } })
const change = { name: "Prova N01", config: config(NEW_URL), secrets: { token: "TOKEN-NOVO" } }

type Sent = { url: string; authorization: string | undefined }
let pool: pg.Pool
let real: PgAesSecretStore
let ctx: DataHubContext
let sent: Sent[] = []
let onSend: (() => void) | null = null
const http: HttpClient = {
  send: async (request: HttpRequest) => {
    sent.push({ url: request.url, authorization: request.headers.authorization })
    onSend?.()
    return { status: 200, headers: {}, body: "{}" }
  },
}
/** A loja real, com dois ganchos no put: parar (para observar o meio da troca) ou falhar (queda do banco no meio). */
const hooks: { gate: Promise<void> | null; entered: (() => void) | null; fail: boolean } = { gate: null, entered: null, fail: false }
const store: SecretStore = {
  put: async (input, options) => {
    hooks.entered?.()
    if (hooks.gate) await hooks.gate
    if (hooks.fail) throw new Error("conexão com o banco perdida (simulada)")
    return real.put(input, options)
  },
  get: (input) => real.get(input),
  revoke: (input, options) => real.revoke(input, options),
  describe: (sourceId) => real.describe(sourceId),
}
const leaked = (list: Sent[]) => list.filter((entry) => entry.url === NEW_URL && entry.authorization === "Bearer TOKEN-ANTIGO")

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_secrets where organization_id = $1`, [ORG])
  await pool.query(`delete from data_sources where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}
async function freshSource(): Promise<string> {
  return (await createSource(ctx, ORG, null, { name: "Prova N01", config: config(OLD_URL), secrets: { token: "TOKEN-ANTIGO" } })).id
}
async function backToOld(sourceId: string) {
  await pool.query(`update data_sources set config = $2 where id = $1`, [sourceId, JSON.stringify(config(OLD_URL))])
  await real.put({ organizationId: ORG, sourceId, purpose: "API_AUTH", value: "TOKEN-ANTIGO", actorId: null })
}
const updates = async (sourceId: string) => (await pool.query<{ n: number }>(`select count(*)::int n from audit_logs where organization_id = $1 and entity_id = $2 and action = 'DATA_HUB_SOURCE_UPDATED'`, [ORG, sourceId])).rows[0]!.n

describe.skipIf(!ENABLED)("Central de Dados — troca de destino e de credencial num commit só (N01)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 10 })
    real = new PgAesSecretStore(pool as unknown as Database, randomBytes(32), null)
    ctx = createDataHubContext(pool as unknown as Database, { secrets: store, http, logger: silent })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova N01', 'prova-n01')`, [ORG])
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("A) no meio da troca, o teste de conexão vê o par antigo inteiro; depois, o novo", async () => {
    const sourceId = await freshSource()
    let release!: () => void
    hooks.gate = new Promise<void>((resolve) => (release = resolve))
    const entered = new Promise<void>((resolve) => (hooks.entered = resolve))
    try {
      const update = updateSource(ctx, ORG, null, sourceId, change)
      await entered
      sent = []
      const requested = new Promise<void>((resolve) => (onSend = resolve))
      // O teste de conexão termina gravando a saúde na MESMA linha da fonte: espera a troca terminar para isso.
      const reader = testSourceConnection(ctx, ORG, null, sourceId)
      await requested
      expect(sent).toEqual([{ url: OLD_URL, authorization: "Bearer TOKEN-ANTIGO" }])
      release()
      await Promise.all([update, reader])
    } finally {
      hooks.gate = null
      hooks.entered = null
      onSend = null
    }
    sent = []
    await testSourceConnection(ctx, ORG, null, sourceId)
    expect(sent).toEqual([{ url: NEW_URL, authorization: "Bearer TOKEN-NOVO" }])
  })

  it("B) troca + 4 testes de conexão juntos (0–3 ms), 30 vezes: a credencial antiga nunca vai para o destino novo", async () => {
    const sourceId = await freshSource()
    let leaks = 0
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await backToOld(sourceId)
      sent = []
      await Promise.all([
        updateSource(ctx, ORG, null, sourceId, change),
        ...[0, 1, 2, 3].map((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)).then(() => testSourceConnection(ctx, ORG, null, sourceId))),
      ])
      leaks += leaked(sent).length
    }
    expect(leaks).toBe(0)
  }, 60_000)

  it("C) falha ao gravar a credencial nova: destino, credencial e auditoria ficam como estavam", async () => {
    const sourceId = await freshSource()
    hooks.fail = true
    try {
      await expect(updateSource(ctx, ORG, null, sourceId, change)).rejects.toThrow("conexão com o banco perdida")
    } finally {
      hooks.fail = false
    }
    const row = (await pool.query<{ url: string }>(`select config->'api'->>'baseUrl' url from data_sources where id = $1`, [sourceId])).rows[0]!
    expect(row.url).toBe(OLD_URL)
    expect(await real.get({ sourceId, purpose: "API_AUTH" })).toBe("TOKEN-ANTIGO")
    expect(await updates(sourceId)).toBe(0)
    sent = []
    await testSourceConnection(ctx, ORG, null, sourceId)
    expect(sent).toEqual([{ url: OLD_URL, authorization: "Bearer TOKEN-ANTIGO" }])
  })
})
