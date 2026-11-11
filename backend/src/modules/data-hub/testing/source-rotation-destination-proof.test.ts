/**
 * PROVA contra o banco de TESTE real (achado da 5ª auditoria, POST /sources/:id/secrets): a credencial trocada só é gravada para o
 * destino em que foi provada. Enquanto a credencial nova é testada no destino atual, outra pessoa troca o destino da fonte (com a
 * credencial dela). Antes, a troca gravava a credencial nova por cima, ligada ao destino novo, e o "Testar conexão" a mandava para lá.
 * Agora a troca é recusada (409) e a fonte fica com o destino e a credencial de quem trocou o destino.
 * Loja de credenciais real (AES no PostgreSQL), HTTP falso — nenhuma rede. Organização própria, apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run source-rotation-destination-proof
 */
import { randomBytes } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import type { HttpClient, HttpRequest } from "../application/ports.js"
import { createSource, rotateSourceSecrets, testSourceConnection, updateSource } from "../application/source-service.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-0000000a0d01"
const CLIENT_URL = "https://api.cliente.example/v1"
const OTHER_URL = "https://coletor.outro.example/v1"
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
const config = (baseUrl: string) => ({ kind: "API_PULL", api: { baseUrl, auth: { kind: "BEARER" }, headers: {}, timeoutMs: 30_000 } })

let pool: pg.Pool
let real: PgAesSecretStore
let ctx: DataHubContext
let sent: { url: string; authorization: string | undefined }[] = []
/** Executado uma vez, quando a prova da credencial nova chega ao destino: é a troca de destino confirmada no meio. */
let duringProbe: (() => Promise<unknown>) | null = null
const http: HttpClient = {
  send: async (request: HttpRequest) => {
    sent.push({ url: request.url, authorization: request.headers.authorization })
    if (request.headers.authorization === "Bearer TOKEN-NOVO" && duringProbe) {
      const run = duringProbe
      duringProbe = null
      await run()
    }
    return { status: 200, headers: {}, body: "{}" }
  },
}

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_secrets where organization_id = $1`, [ORG])
  await pool.query(`delete from data_source_config_unlocks where organization_id = $1`, [ORG])
  await pool.query(`delete from data_source_credential_attempts where organization_id = $1`, [ORG]).catch(() => undefined)
  await pool.query(`delete from data_sources where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

describe.skipIf(!ENABLED)("Central de Dados — troca de credencial gravada só no destino em que foi provada", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 10 })
    real = new PgAesSecretStore(pool as unknown as Database, randomBytes(32), null)
    ctx = createDataHubContext(pool as unknown as Database, { secrets: real, http, logger: silent })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova troca de credencial', 'prova-troca-credencial')`, [ORG])
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("destino trocado durante a prova da credencial nova: 409, e a credencial nova nunca vai para o destino novo", async () => {
    const sourceId = (await createSource(ctx, ORG, null, { name: "Prova troca", config: config(CLIENT_URL), secrets: { token: "TOKEN-ANTIGO" } })).id
    duringProbe = () => updateSource(ctx, ORG, null, sourceId, { name: "Prova troca", config: config(OTHER_URL), secrets: { token: "TOKEN-DO-OUTRO" } })
    const refusal = await rotateSourceSecrets(ctx, ORG, null, sourceId, { token: "TOKEN-NOVO" }).then(
      () => null,
      (error: unknown) => (error instanceof DomainError ? { code: error.code, statusCode: error.statusCode } : error),
    )
    expect(duringProbe).toBeNull()
    expect(refusal).toEqual({ code: "DATA_SOURCE_DESTINATION_CHANGED", statusCode: 409 })
    expect(await real.get({ sourceId, purpose: "API_AUTH" })).toBe("TOKEN-DO-OUTRO")
    sent = []
    await testSourceConnection(ctx, ORG, null, sourceId)
    expect(sent.length).toBeGreaterThan(0)
    expect(sent.filter((entry) => entry.authorization === "Bearer TOKEN-NOVO")).toEqual([])
    expect(sent.every((entry) => entry.url.startsWith(OTHER_URL) && entry.authorization === "Bearer TOKEN-DO-OUTRO")).toBe(true)
  })
})
