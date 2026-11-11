/**
 * PROVA contra o banco de TESTE real (achado da 5ª auditoria, irmão do N01): a chave de uma conexão de IA nunca fica ativa num endpoint
 * para o qual não foi cadastrada, mesmo com a troca de endpoint e o cadastro da chave ao mesmo tempo.
 *   A) a chave é cadastrada por outra pessoa DEPOIS de a troca de endpoint ler a conexão e ANTES da transação dela: a troca revoga a
 *      chave assim mesmo (a decisão é tomada sobre a linha travada, não sobre a leitura de antes);
 *   B) o endpoint é trocado DEPOIS de o cadastro da chave ler a conexão e ANTES da transação dele: o cadastro é recusado (409);
 *   C) tela aberta ANTES da troca de endpoint (run-3 C01): o cadastro leva o endpoint que a pessoa via e é recusado (409), mesmo
 *      com a troca já confirmada antes de a requisição chegar;
 *   D) tela atualizada (endpoint novo exibido): o cadastro vale.
 * A referência é sempre o endpoint que a TELA mostrava (`expectedBaseUrl`), nunca o que o servidor lê na hora.
 * Chama o serviço direto (o mesmo das rotas), com o banco real; nenhum provider é chamado. Organização própria, apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run ai-connection-endpoint-race-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { AiAdminContext } from "../application/ai-admin-context.js"
import { createConnection, replaceConnectionSecret, updateConnection } from "../application/ai-connection-service.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-0000000a1a01"
const ACTOR = { organizationId: ORG, personId: null }
const OLD_URL = "https://ia-antiga.example/v1"
const NEW_URL = "https://ia-nova.example/v1"
const KEY = "chave-ficticia-prova-corrida-0123456789abcdef"

let pool: pg.Pool
/** Executado uma vez, antes de a PRÓXIMA transação do serviço abrir: é o "outra pessoa confirmou no meio". */
let beforeNextTransaction: (() => Promise<unknown>) | null = null
let ctx: AiAdminContext
let raw: AiAdminContext

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from ai_connection_secrets where organization_id = $1`, [ORG])
  await pool.query(`delete from ai_connections_all where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}
let seq = 0
const fresh = async () => (await createConnection(raw, ACTOR, { providerKey: "OPENAI_COMPATIBLE", name: `Prova corrida ${(seq += 1)}`, baseUrl: OLD_URL, isLocal: false })).id
/** O estado que a execução usaria: endpoint gravado e se há chave ativa. */
const state = async (id: string) => {
  const connection = await pool.query<{ base_url: string }>(`select base_url from ai_connections where id = $1`, [id])
  const secret = await pool.query(`select 1 from ai_connection_secrets where connection_id = $1 and revoked_at is null`, [id])
  return { baseUrl: connection.rows[0]!.base_url, activeKey: (secret.rowCount ?? 0) > 0 }
}
const codeOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => (error instanceof DomainError ? error.code : String(error)))

describe.skipIf(!ENABLED)("Conexão de IA — chave e troca de endpoint serializadas na linha da conexão", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 10 })
    const db: Database = {
      query: pool.query.bind(pool) as Database["query"],
      connect: (async () => {
        const hook = beforeNextTransaction
        beforeNextTransaction = null
        if (hook) await hook()
        return pool.connect()
      }) as Database["connect"],
    }
    const runtime = { invalidate: () => undefined } as unknown as AiAdminContext["runtime"]
    ctx = { db, runtime, adapters: {} as AiAdminContext["adapters"], now: () => new Date() }
    raw = { ...ctx, db: pool as unknown as Database }
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova corrida IA', 'prova-corrida-ia')`, [ORG])
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("A) chave cadastrada entre a leitura e a transação da troca de endpoint: a troca revoga a chave", async () => {
    const id = await fresh()
    beforeNextTransaction = () => replaceConnectionSecret(raw, ACTOR, id, { apiKey: KEY, expectedBaseUrl: OLD_URL })
    await updateConnection(ctx, ACTOR, id, { baseUrl: NEW_URL })
    expect(await state(id)).toEqual({ baseUrl: NEW_URL, activeKey: false })
    const audit = await pool.query(`select 1 from audit_logs where entity_id = $1 and action = 'AI_CONNECTION_SECRET_REVOKED'`, [id])
    expect(audit.rowCount).toBe(1)
  })

  it("B) endpoint trocado entre a leitura e a transação do cadastro da chave: 409, a chave não fica ativa no endpoint novo", async () => {
    const id = await fresh()
    beforeNextTransaction = () => updateConnection(raw, ACTOR, id, { baseUrl: NEW_URL })
    expect(await codeOf(replaceConnectionSecret(ctx, ACTOR, id, { apiKey: KEY, expectedBaseUrl: OLD_URL }))).toBe("AI_CONNECTION_ENDPOINT_CHANGED")
    expect(await state(id)).toEqual({ baseUrl: NEW_URL, activeKey: false })
  })

  it("C) tela aberta antes da troca de endpoint já confirmada: 409, a chave não fica ativa no endpoint novo", async () => {
    const id = await fresh()
    await updateConnection(raw, ACTOR, id, { baseUrl: NEW_URL })
    expect(await codeOf(replaceConnectionSecret(raw, ACTOR, id, { apiKey: KEY, expectedBaseUrl: OLD_URL }))).toBe("AI_CONNECTION_ENDPOINT_CHANGED")
    expect(await state(id)).toEqual({ baseUrl: NEW_URL, activeKey: false })
  })

  it("D) tela já mostrando o endpoint novo: a chave é cadastrada", async () => {
    const id = await fresh()
    await updateConnection(raw, ACTOR, id, { baseUrl: NEW_URL })
    expect(await codeOf(replaceConnectionSecret(raw, ACTOR, id, { apiKey: KEY, expectedBaseUrl: NEW_URL }))).toBeNull()
    expect(await state(id)).toEqual({ baseUrl: NEW_URL, activeKey: true })
  })
})
