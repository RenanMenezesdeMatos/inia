/**
 * PROVA contra o banco de teste real: configurar uma fonte com credencial guardada exige digitar a credencial de novo, para aquela
 * pessoa, naquela fonte e naquela sessão, por 30 minutos, e cada ação fica no registro sem segredo nenhum.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run config-unlock-proof
 * Rotas reais da Central, banco do cliente, API e SFTP falsos (nenhuma rede), loja de credenciais real. Organização própria, apagada no fim.
 */
import { randomBytes } from "node:crypto"
import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import type { ExternalDatabaseConnector, ExternalDatabaseSession, HttpRequest, HttpResponse } from "../application/ports.js"
import { MASKED_VALUE } from "../domain/config-mask.js"
import type { ResolvedDatabaseConnection } from "../domain/database/database-engine.js"
import { DataRunError } from "../domain/error-codes.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"
import { createDataHubRouter } from "../presentation/data-hub-router.js"
import { FakeSftpClient, json, MockHttpClient } from "./fakes.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-0000000c0172"
const ANA = "de00ee00-0000-4000-8000-0000000c1001"
const BRUNO = "de00ee00-0000-4000-8000-0000000c1002"
const CAIO = "de00ee00-0000-4000-8000-0000000c1003"
const SECRET = "Senha-Do-Banco-Original-123"
const NEW_SECRET = "Senha-Nova-Do-Servidor-456"
const WRONG = "Senha-Errada-789"
const BEARER = "token-da-api-guardado"
const SFTP_SECRET = "senha-do-sftp-guardada"
const ALL_SECRETS = [SECRET, NEW_SECRET, WRONG, BEARER, "token-novo-da-api", SFTP_SECRET, "senha-sftp-nova"]
const API = "/api/v1/admin/data-hub"
const CLIENT_VALUE = "VALOR-DO-CLIENTE-NUNCA-NO-REGISTRO"

/** Banco do cliente de mentira: conta conexões e confere a senha como um servidor de verdade. */
class FakeClientDatabase implements ExternalDatabaseConnector {
  opened = 0
  passwords: string[] = []
  acceptedPassword = SECRET
  unreachable = false
  async open(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession> {
    this.opened += 1
    this.passwords.push(connection.password)
    if (this.unreachable) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })
    if (connection.password !== this.acceptedPassword) throw Object.assign(new Error("password authentication failed for user"), { code: "28P01" })
    return {
      flavor: connection.engine,
      serverVersion: "PostgreSQL 15 (prova)",
      tlsActive: true,
      readOnlyEnforced: true,
      privilegeWarning: async () => null,
      close: async () => undefined,
      query: async (statement) => {
        const sql = statement.sql
        if (sql.includes("AS schema_name")) return [{ schema_name: "public", object_name: "colaboradores", object_kind: "TABLE", estimated_rows: 3 }]
        if (sql.includes("AS can_select")) return [{ object_kind: "TABLE", can_select: true }]
        if (sql.includes("AS column_name")) return [{ column_name: "matricula", native_type: "text", typtype: "b", nullable: false, pk_position: 1 }, { column_name: "nome", native_type: "text", typtype: "b", nullable: false, pk_position: null }]
        return [{ matricula: "P-1", nome: CLIENT_VALUE }, { matricula: "P-2", nome: CLIENT_VALUE }]
      },
    }
  }
}

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let clientDb: FakeClientDatabase
let http: MockHttpClient
let sftp: FakeSftpClient
let offsetMs = 0
/** Como a API do cliente responde: cada cenário decide o que faz com e sem credencial. */
let apiResponds: (request: HttpRequest, url: URL) => HttpResponse = () => json(404, {})
const clock = { now: () => new Date(Date.now() + offsetMs) }
let app: express.Express

/** Sessão da pessoa: os cabeçalhos fazem o papel do cookie, depois de `requireAuth` e da permissão, que têm prova própria. */
const as = (personId: string | null, sessionId: string | null = `sessao-${personId}`) => {
  const headers = { "x-person": personId ?? "", "x-session": sessionId ?? "" }
  return {
    get: (path: string) => request(app).get(`${API}${path}`).set(headers),
    post: (path: string, body?: object) => request(app).post(`${API}${path}`).set(headers).send(body ?? {}),
    patch: (path: string, body: object) => request(app).patch(`${API}${path}`).set(headers).send(body),
    delete: (path: string) => request(app).delete(`${API}${path}`).set(headers),
  }
}

const databaseConfig = (overrides: Record<string, unknown> = {}) => ({ engine: "POSTGRESQL", host: "db.cliente.local", port: 5432, database: "rh", username: "inia_leitura", tls: { mode: "VERIFY_FULL" }, connectTimeoutMs: 15_000, queryTimeoutMs: 120_000, ...overrides })
const databaseFeedConfig = { connector: "DATABASE", database: { object: { schema: "public", name: "colaboradores", kind: "TABLE" }, sync: { mode: "FULL", keyColumns: ["matricula"] }, batchSize: 500, maxRowsPerRun: 1000 } }
const feedBody = (feedKey: string) => ({ feedKey, name: `Colaboradores ${feedKey}`, contractKey: "EMPLOYEES", connectorConfig: databaseFeedConfig, mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "name", source: "nome", transforms: [] }, { target: "role", source: "nivel", transforms: [] }] }, cadence: { kind: "MANUAL" } })

let counter = 0
/** Fonte de banco cadastrada por Ana com a senha digitada. */
async function createDatabaseSource(name = `Banco ${(counter += 1)}`): Promise<string> {
  const created = await as(ANA).post("/sources", { name, config: { kind: "DATABASE", database: databaseConfig() }, secrets: { password: SECRET } })
  expect(created.status).toBe(201)
  return created.body.data.id as string
}
const unlock = (personId: string, sourceId: string, password = SECRET, sessionId?: string) => as(personId, sessionId).post(`/sources/${sourceId}/unlock-configuration`, { password })
const anaFeed = async (sourceId: string, key = "colaboradores") => {
  const created = await as(ANA).post(`/sources/${sourceId}/feeds`, feedBody(key))
  expect(created.status).toBe(201)
  return created.body.data.id as string
}

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await pool.query(`delete from data_secrets where organization_id = $1`, [ORG])
  await pool.query(`delete from data_ingestion_runs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_sources where organization_id = $1`, [ORG])
  await pool.query(`delete from people where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

const auditOf = async (sourceId: string, action: string) => (await pool.query<{ actor_id: string | null; payload: Record<string, unknown> }>(`select actor_id, payload from audit_logs where organization_id = $1 and action = $2 and (entity_id = $3 or payload->>'sourceId' = $4) order by created_at`, [ORG, action, sourceId, sourceId])).rows

describe.skipIf(!ENABLED)("Central de Dados — configurar exige a senha da fonte", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 20 })
    db = pool as unknown as Database
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova liberação', 'prova-liberacao-172')`, [ORG])
    for (const [id, name] of [[ANA, "Ana Dados"], [BRUNO, "Bruno Geral"], [CAIO, "Caio Dados"]] as const) await pool.query(`insert into people (id, organization_id, name, role) values ($1, $2, $3, 'ADMIN')`, [id, ORG, name])
    clientDb = new FakeClientDatabase()
    http = new MockHttpClient()
    http.on("/", (req, url) => apiResponds(req, url))
    http.on("/", (req, url) => apiResponds(req, url), "POST")
    sftp = new FakeSftpClient()
    const secrets = new PgAesSecretStore(db, randomBytes(32), null)
    const logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
    const overrides = { secrets, databases: clientDb, http, sftp, clock, logger, wakeWorker: () => undefined }
    ctx = createDataHubContext(db, overrides)
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      const personId = String(req.headers["x-person"] ?? "")
      const sessionId = String(req.headers["x-session"] ?? "")
      req.user = { sub: "conta", personId: personId || undefined, organizationId: ORG, role: "ADMIN", name: "Prova", email: "a@b", avatarUrl: null, jobTitle: null, teamId: null, teamName: null, ...(sessionId ? { jti: sessionId } : {}) } as never
      next()
    })
    app.use(API, createDataHubRouter(db, overrides))
    app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next
      if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } })
      if (error instanceof DataRunError) return res.status(422).json({ error: { code: error.code, message: error.message } })
      return res.status(error.name === "ZodError" ? 400 : 500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
    })
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  beforeEach(async () => {
    offsetMs = 0
    // A conta é por pessoa + servidor + usuário, e as fontes da prova apontam para o mesmo servidor.
    await pool.query(`delete from data_source_credential_attempts where organization_id = $1`, [ORG])
    clientDb.acceptedPassword = SECRET
    clientDb.unreachable = false
    clientDb.opened = 0
    clientDb.passwords = []
    http.requests.length = 0
  })

  it("A) Ana cadastra e Bruno não configura: nenhuma rota de configuração passa e nada conecta no banco do cliente", async () => {
    const sourceId = await createDatabaseSource()
    const feedId = await anaFeed(sourceId)
    clientDb.opened = 0
    const bruno = as(BRUNO)
    const attempts = [
      bruno.get(`/sources/${sourceId}/database/objects`),
      bruno.get(`/sources/${sourceId}/database/columns?schema=public&name=colaboradores`),
      bruno.post(`/sources/${sourceId}/sample`, { connectorConfig: databaseFeedConfig, contractKey: "EMPLOYEES" }),
      bruno.post(`/sources/${sourceId}/preview`, { contractKey: "EMPLOYEES", mapping: { fields: [] }, sample: { columns: [], records: [] } }),
      bruno.post(`/sources/${sourceId}/sftp-files`, { connectorConfig: databaseFeedConfig }),
      bruno.post(`/sources/${sourceId}/feeds`, feedBody("de-bruno")),
      bruno.patch(`/sources/${sourceId}`, { name: "Renomeada por Bruno" }),
      bruno.post(`/sources/${sourceId}/status`, { action: "ACTIVATE" }),
      bruno.post(`/sources/${sourceId}/status`, { action: "RESUME" }),
      bruno.patch(`/feeds/${feedId}`, { name: "Renomeado" }),
      bruno.post(`/feeds/${feedId}/status`, { action: "ACTIVATE" }),
      bruno.post(`/feeds/${feedId}/status`, { action: "RESUME" }),
      bruno.post(`/feeds/${feedId}/checkpoint/reset`),
      bruno.post(`/feeds/${feedId}/sample`),
      bruno.post(`/feeds/${feedId}/preview`, { sample: { columns: [], records: [] } }),
    ]
    for (const attempt of attempts) {
      const response = await attempt
      expect(response.status, String(response.request?.url)).toBe(403)
      expect(response.body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
      expect(response.body.error.details).toMatchObject({ sourceId, kind: "DATABASE", fields: ["password"] })
    }
    expect(clientDb.opened).toBe(0)
    expect(await auditOf(sourceId, "DATA_HUB_CONFIG_ACCESS_DENIED")).toHaveLength(attempts.length)
    expect((await auditOf(sourceId, "DATA_HUB_CONFIG_ACCESS_DENIED"))[0]).toMatchObject({ actor_id: BRUNO, payload: { route: "GET /sources/:id/database/objects" } })
    // O próprio Ana, que cadastrou, continua: digitou a senha agora.
    expect((await as(ANA).get(`/sources/${sourceId}/database/objects`)).status).toBe(200)
  })

  it("B) Bruno vê, testa, pausa, sincroniza e exclui sem a senha", async () => {
    const sourceId = await createDatabaseSource()
    const feedId = await anaFeed(sourceId)
    const bruno = as(BRUNO)
    const detail = await bruno.get(`/sources/${sourceId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.configAccess).toEqual({ required: true, unlocked: false, expiresAt: null, fields: ["password"] })
    expect(detail.body.data.createdByName).toBe("Ana Dados")
    expect((await bruno.get(`/feeds/${feedId}`)).body.data.configAccess).toMatchObject({ required: true, unlocked: false })
    expect((await bruno.get(`/sources/${sourceId}/feeds`)).status).toBe(200)
    expect((await bruno.get("/sources")).body.data.some((source: { id: string }) => source.id === sourceId)).toBe(true)
    const tested = await bruno.post(`/sources/${sourceId}/test-connection`)
    expect(tested.body.data.health).toBe("HEALTHY")
    expect((await bruno.post("/database/test", { config: databaseConfig(), sourceId })).body.data.health).toBe("HEALTHY")
    expect((await bruno.post("/database/test", { config: databaseConfig(), password: SECRET })).body.data.health).toBe("HEALTHY")
    // Ativar pela Ana, para Bruno poder pausar, sincronizar e cancelar.
    expect((await as(ANA).post(`/feeds/${feedId}/status`, { action: "ACTIVATE" })).status).toBe(200)
    const sync = await bruno.post(`/feeds/${feedId}/sync`)
    expect(sync.status).toBe(202)
    expect((await bruno.post(`/runs/${sync.body.data.id}/cancel`)).status).toBe(200)
    expect((await bruno.post(`/feeds/${feedId}/status`, { action: "PAUSE" })).status).toBe(200)
    expect((await bruno.post(`/sources/${sourceId}/status`, { action: "PAUSE" })).status).toBe(200)
    expect((await bruno.delete(`/feeds/${feedId}`)).status).toBe(204)
    expect((await bruno.delete(`/sources/${sourceId}`)).status).toBe(204)
    expect((await bruno.get(`/sources/${sourceId}`)).status).toBe(404)
  })

  it("C) Bruno com a senha certa configura, e a resposta diz até quando", async () => {
    const sourceId = await createDatabaseSource()
    clientDb.opened = 0
    const unlocked = await unlock(BRUNO, sourceId)
    expect(unlocked.status).toBe(200)
    expect(clientDb.opened).toBe(0) // liberar não conecta no banco do cliente
    expect(unlocked.body.data).toMatchObject({ required: true, unlocked: true, fields: ["password"] })
    const minutesLeft = (Date.parse(unlocked.body.data.expiresAt) - Date.now()) / 60_000
    expect(minutesLeft).toBeGreaterThan(29)
    expect(minutesLeft).toBeLessThanOrEqual(30)
    const bruno = as(BRUNO)
    expect((await bruno.get(`/sources/${sourceId}`)).body.data.configAccess.unlocked).toBe(true)
    expect((await bruno.get(`/sources/${sourceId}/database/objects`)).body.data.objects).toHaveLength(1)
    expect((await bruno.get(`/sources/${sourceId}/database/columns?schema=public&name=colaboradores`)).body.data.columns).toHaveLength(2)
    const sample = await bruno.post(`/sources/${sourceId}/sample`, { connectorConfig: databaseFeedConfig, contractKey: "EMPLOYEES" })
    expect(sample.status).toBe(200)
    expect(sample.body.data.records).toHaveLength(2)
    const feed = await bruno.post(`/sources/${sourceId}/feeds`, feedBody("de-bruno"))
    expect(feed.status).toBe(201)
    expect((await bruno.post(`/feeds/${feed.body.data.id}/status`, { action: "ACTIVATE" })).status).toBe(200)
    expect((await bruno.patch(`/sources/${sourceId}`, { name: "Renomeada com a senha", config: { kind: "DATABASE", database: databaseConfig({ queryTimeoutMs: 60_000 }) } })).status).toBe(200)
    // Liberar Bruno não libera Caio, nem Bruno em outra fonte.
    expect((await as(CAIO).get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    const other = await createDatabaseSource()
    expect((await bruno.get(`/sources/${other}/database/objects`)).status).toBe(403)
  })

  it("D) senha errada conta: a 5ª falha bloqueia, nem a certa entra, Caio não é afetado e a janela libera", async () => {
    const sourceId = await createDatabaseSource()
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await unlock(BRUNO, sourceId, WRONG)
      expect(response.status).toBe(422)
      expect(response.body.error.code).toBe("DATA_SOURCE_SECRET_INCORRECT")
    }
    const fifth = await unlock(BRUNO, sourceId, WRONG)
    expect(fifth.status).toBe(429)
    expect(fifth.body.error.code).toBe("DATA_SOURCE_UNLOCK_TOO_MANY_ATTEMPTS")
    expect(Date.parse(fifth.body.error.details.retryAt)).toBeGreaterThan(Date.now())
    expect((await unlock(BRUNO, sourceId)).status).toBe(429)
    expect((await as(BRUNO).get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    // Sem campo não consome tentativa nem chega perto da comparação.
    expect((await as(CAIO).post(`/sources/${sourceId}/unlock-configuration`, {})).status).toBe(422)
    expect((await unlock(CAIO, sourceId)).status).toBe(200)
    expect(await auditOf(sourceId, "DATA_HUB_CONFIG_UNLOCK_FAILED")).toHaveLength(5)
    expect((await auditOf(sourceId, "DATA_HUB_CONFIG_UNLOCK_BLOCKED")).length).toBeGreaterThanOrEqual(2)
    offsetMs = 16 * 60_000
    expect((await unlock(BRUNO, sourceId)).status).toBe(200)
  })

  it("D2) 12 tentativas erradas ao mesmo tempo: só 5 chegam a comparar", async () => {
    const sourceId = await createDatabaseSource()
    const responses = await Promise.all(Array.from({ length: 12 }, () => unlock(CAIO, sourceId, WRONG)))
    expect(responses.every((response) => response.status === 422 || response.status === 429)).toBe(true)
    const rows = await pool.query<{ outcome: string; n: number }>(`select outcome, count(*)::int n from data_source_credential_attempts where person_id = $1 group by 1`, [CAIO])
    const failed = rows.rows.find((row) => row.outcome === "FAILED")?.n ?? 0
    expect(failed).toBeLessThanOrEqual(5)
    expect(failed + (rows.rows.find((row) => row.outcome === "REFUSED")?.n ?? 0)).toBe(12)
    expect((await auditOf(sourceId, "DATA_HUB_CONFIG_UNLOCK_FAILED")).length).toBe(failed)
  })

  it("E) passados 30 minutos, a configuração volta a pedir a senha, até para quem cadastrou, e o que já foi preenchido continua aceitando depois", async () => {
    const sourceId = await createDatabaseSource()
    expect((await unlock(BRUNO, sourceId)).status).toBe(200)
    offsetMs = 29 * 60_000
    expect((await as(BRUNO).get(`/sources/${sourceId}/database/objects`)).status).toBe(200)
    expect((await as(ANA).get(`/sources/${sourceId}/database/objects`)).status).toBe(200)
    offsetMs = 31 * 60_000
    for (const person of [BRUNO, ANA]) {
      expect((await as(person).get(`/sources/${sourceId}/database/objects`)).body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
      expect((await as(person).get(`/sources/${sourceId}`)).body.data.configAccess).toMatchObject({ unlocked: false, expiresAt: null })
    }
    expect((await unlock(ANA, sourceId)).status).toBe(200)
    expect((await as(ANA).get(`/sources/${sourceId}/database/objects`)).status).toBe(200)
  })

  it("F) login novo perde a liberação; sem pessoa ou sem sessão, falha fechada", async () => {
    const sourceId = await createDatabaseSource()
    expect((await unlock(BRUNO, sourceId, SECRET, "login-1")).status).toBe(200)
    expect((await as(BRUNO, "login-1").get(`/sources/${sourceId}/database/objects`)).status).toBe(200)
    clientDb.opened = 0
    expect((await as(BRUNO, "login-2").get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    expect((await as(BRUNO, null).get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    expect((await as(BRUNO, null).post(`/sources/${sourceId}/unlock-configuration`, { password: SECRET })).body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
    expect((await as(null).get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    expect((await as(null).post(`/sources/${sourceId}/secrets`, { password: SECRET })).body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
    expect(clientDb.opened).toBe(0)
  })

  it("G) o conteúdo bruto de uma carga de banco não abre pela amostra nem pela importação de outra fonte", async () => {
    const protectedSource = await createDatabaseSource()
    const secretContent = new TextEncoder().encode(`matricula;nome\nP-1;${CLIENT_VALUE}`)
    const retained = await ctx.rawObjects.put({ organizationId: ORG, sourceId: protectedSource, feedId: null, filename: "carga.csv", contentType: "text/csv", content: secretContent })
    const fileSource = (await as(BRUNO).post("/sources", { name: `Arquivo ${(counter += 1)}`, config: { kind: "FILE_UPLOAD" } })).body.data.id as string
    const fileConfig = { connector: "FILE_UPLOAD", file: { format: "CSV" } }
    const stolen = await as(BRUNO).post(`/sources/${fileSource}/sample`, { connectorConfig: fileConfig, contractKey: "EMPLOYEES", rawObjectId: retained.id })
    expect(stolen.status).toBe(422)
    expect(stolen.body.error.code).toBe("DATA_RAW_EXPIRED")
    expect(JSON.stringify(stolen.body)).not.toContain(CLIENT_VALUE)
    const feed = (await as(BRUNO).post(`/sources/${fileSource}/feeds`, { feedKey: "arquivo", name: "Arquivo", contractKey: "EMPLOYEES", connectorConfig: fileConfig, mapping: feedBody("arquivo").mapping })).body.data.id as string
    expect((await as(BRUNO).post(`/feeds/${feed}/sample`, { rawObjectId: retained.id })).status).toBe(422)
    expect((await as(BRUNO).post(`/feeds/${feed}/import`, { rawObjectId: retained.id })).status).toBe(422)
    // O arquivo da própria fonte e o enviado antes de existir a fonte continuam valendo.
    const own = await ctx.rawObjects.put({ organizationId: ORG, sourceId: fileSource, feedId: null, filename: "a.csv", contentType: "text/csv", content: new TextEncoder().encode("matricula;nome\nX;Y") })
    const unbound = await ctx.rawObjects.put({ organizationId: ORG, sourceId: null, feedId: null, filename: "b.csv", contentType: "text/csv", content: new TextEncoder().encode("matricula;nome\nX;Y") })
    expect((await as(BRUNO).post(`/sources/${fileSource}/sample`, { connectorConfig: fileConfig, contractKey: "EMPLOYEES", rawObjectId: own.id })).status).toBe(200)
    expect((await as(BRUNO).post(`/sources/${fileSource}/sample`, { connectorConfig: fileConfig, contractKey: "EMPLOYEES", rawObjectId: unbound.id })).status).toBe(200)
    // Envio e importação seguem livres e ficam no registro, com quem fez e o nome do arquivo; a tentativa negada também.
    const uploaded = await request(app).post(`${API}/uploads`).set({ "x-person": BRUNO, "x-session": `sessao-${BRUNO}` }).field("sourceId", fileSource).attach("file", Buffer.from(`matricula;nome\nP-9;${CLIENT_VALUE}`), "colaboradores.csv")
    expect(uploaded.status).toBe(201)
    expect((await as(BRUNO).post(`/feeds/${feed}/import`, { rawObjectId: uploaded.body.data.rawObjectId })).status).toBe(202)
    expect((await auditOf(fileSource, "DATA_HUB_FILE_UPLOADED"))[0]).toMatchObject({ actor_id: BRUNO, payload: { filename: "colaboradores.csv", rows: 1 } })
    const imports = await auditOf(fileSource, "DATA_HUB_FILE_IMPORTED")
    expect(imports.map((entry) => entry.payload.outcome ?? "OK")).toEqual(["FAILED", "OK"])
    expect(imports[1]).toMatchObject({ actor_id: BRUNO, payload: { filename: "colaboradores.csv", runId: expect.any(String) } })
  })

  it("H) a senha guardada não testa nem aponta para outro banco do mesmo servidor", async () => {
    const sourceId = await createDatabaseSource()
    clientDb.opened = 0
    const otherDatabase = await as(BRUNO).post("/database/test", { config: databaseConfig({ database: "financeiro" }), sourceId })
    expect(otherDatabase.status).toBe(422)
    expect(otherDatabase.body.error.code).toBe("DATA_SOURCE_SECRET_REENTRY_REQUIRED")
    expect(clientDb.opened).toBe(0)
    const repoint = await as(ANA).patch(`/sources/${sourceId}`, { name: "Banco", config: { kind: "DATABASE", database: databaseConfig({ database: "financeiro" }) } })
    expect(repoint.status).toBe(422)
    expect(repoint.body.error.code).toBe("DATA_SOURCE_SECRET_REENTRY_REQUIRED")
    expect((await pool.query<{ database: string }>(`select config->'database'->>'database' database from data_sources where id = $1`, [sourceId])).rows[0]!.database).toBe("rh")
    // Fonte citada precisa existir nesta organização.
    expect((await as(BRUNO).post("/database/test", { config: databaseConfig(), password: SECRET, sourceId: "de00ee00-0000-4000-8000-0000000c9999" })).status).toBe(404)
  })

  it("I) troca de senha: só grava o que conecta, a falha conta no limite, e as liberações antigas caem", async () => {
    const sourceId = await createDatabaseSource()
    expect((await unlock(BRUNO, sourceId)).status).toBe(200)
    // O servidor trocou a senha; Caio não conhece a antiga e sabe a nova.
    clientDb.acceptedPassword = NEW_SECRET
    clientDb.passwords = []
    const refused = await as(CAIO).post(`/sources/${sourceId}/secrets`, { password: WRONG })
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(JSON.stringify(refused.body)).not.toContain(WRONG)
    expect(await ctx.secrets.get({ sourceId, purpose: "DATABASE_PASSWORD" })).toBe(SECRET)
    expect(await auditOf(sourceId, "DATA_HUB_SECRET_ROTATION_FAILED")).toHaveLength(1)
    const rotated = await as(CAIO).post(`/sources/${sourceId}/secrets`, { password: NEW_SECRET })
    expect(rotated.status).toBe(200)
    expect(await ctx.secrets.get({ sourceId, purpose: "DATABASE_PASSWORD" })).toBe(NEW_SECRET)
    expect(clientDb.passwords).not.toContain(SECRET)
    const afterRotation = (await as(CAIO).get(`/sources/${sourceId}`)).body.data
    expect(afterRotation.configAccess.unlocked).toBe(true)
    expect(afterRotation.connectionHealth).toBe("HEALTHY") // a troca acabou de conectar: a tela não volta para "Não testada"
    for (const person of [BRUNO, ANA]) expect((await as(person).get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    expect((await unlock(BRUNO, sourceId, SECRET)).body.error.code).toBe("DATA_SOURCE_SECRET_INCORRECT")
    expect((await unlock(BRUNO, sourceId, NEW_SECRET)).status).toBe(200)
    expect((await pool.query<{ method: string }>(`select method from data_source_config_unlocks where source_id = $1 and person_id = $2`, [sourceId, CAIO])).rows[0]!.method).toBe("CREDENTIAL_CHANGED")

    // Mudar o destino: exige a liberação, mais a senha nova, mais o teste.
    clientDb.acceptedPassword = SECRET
    const other = await createDatabaseSource()
    expect((await as(BRUNO).patch(`/sources/${other}`, { name: "Outro", config: { kind: "DATABASE", database: databaseConfig({ host: "novo.cliente.local" }) }, secrets: { password: NEW_SECRET } })).status).toBe(403)
    expect((await unlock(BRUNO, other)).status).toBe(200)
    const failedTest = await as(BRUNO).patch(`/sources/${other}`, { name: "Outro", config: { kind: "DATABASE", database: databaseConfig({ host: "novo.cliente.local" }) }, secrets: { password: NEW_SECRET } })
    expect(failedTest.status).toBe(422)
    expect((await pool.query<{ host: string }>(`select config->'database'->>'host' host from data_sources where id = $1`, [other])).rows[0]!.host).toBe("db.cliente.local")
    clientDb.acceptedPassword = NEW_SECRET
    const moved = await as(BRUNO).patch(`/sources/${other}`, { name: "Outro", config: { kind: "DATABASE", database: databaseConfig({ host: "novo.cliente.local" }) }, secrets: { password: NEW_SECRET } })
    expect(moved.status).toBe(200)
    const [updated] = await auditOf(other, "DATA_HUB_SOURCE_UPDATED")
    expect(updated!.payload).toMatchObject({ secretTargetChanged: true, secretsRotated: ["DATABASE_PASSWORD"] })
    expect(updated!.payload.changes).toEqual(expect.arrayContaining([{ field: "host", before: "db.cliente.local", after: "novo.cliente.local" }, { field: "name", before: expect.any(String), after: "Outro" }]))
    expect((await as(ANA).get(`/sources/${other}/database/objects`)).status).toBe(403)
  })

  it("I2) troca de senha errada conta no mesmo limite da liberação", async () => {
    const sourceId = await createDatabaseSource()
    for (let attempt = 1; attempt <= 3; attempt += 1) expect((await as(CAIO).post(`/sources/${sourceId}/secrets`, { password: WRONG })).status).toBe(422)
    for (let attempt = 1; attempt <= 1; attempt += 1) expect((await unlock(CAIO, sourceId, WRONG)).status).toBe(422)
    expect((await as(CAIO).post(`/sources/${sourceId}/secrets`, { password: WRONG })).status).toBe(429)
    const opened = clientDb.opened
    expect((await as(CAIO).post(`/sources/${sourceId}/secrets`, { password: SECRET })).status).toBe(429)
    expect(clientDb.opened).toBe(opened) // bloqueado nem tenta conectar
  })

  it("J) API Pull e SFTP pedem a própria credencial; arquivo, push e API sem autenticação não têm senha a exigir", async () => {
    apiResponds = (sent) => (sent.headers.authorization === "Bearer token-novo-da-api" || sent.headers.authorization === `Bearer ${BEARER}` ? json(200, { ok: true }) : json(401, { error: "não autorizado" }))
    const api = (await as(ANA).post("/sources", { name: "API RH", config: { kind: "API_PULL", api: { baseUrl: "https://api.cliente.local", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 5000 } }, secrets: { token: BEARER } })).body.data.id as string
    expect((await as(BRUNO).get(`/sources/${api}`)).body.data.configAccess).toMatchObject({ required: true, unlocked: false, fields: ["token"] })
    expect((await as(BRUNO).post(`/sources/${api}/unlock-configuration`, { password: BEARER })).status).toBe(422)
    expect((await as(BRUNO).post(`/sources/${api}/unlock-configuration`, { token: "outro" })).body.error.code).toBe("DATA_SOURCE_SECRET_INCORRECT")
    expect((await as(BRUNO).post(`/sources/${api}/unlock-configuration`, { token: BEARER })).status).toBe(200)
    // Trocar a credencial testa com o que foi digitado, nunca com a guardada.
    http.requests.length = 0
    expect((await as(CAIO).post(`/sources/${api}/secrets`, { token: "token-invalido" })).body.error.code).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(http.requests.map((sent) => sent.headers.authorization)).toEqual(["Bearer token-invalido"])
    http.requests.length = 0
    expect((await as(CAIO).post(`/sources/${api}/secrets`, { token: "token-novo-da-api" })).status).toBe(200)
    expect(await ctx.secrets.get({ sourceId: api, purpose: "API_AUTH" })).toBe("token-novo-da-api")

    const sftpSource = (await as(ANA).post("/sources", { name: "SFTP RH", config: { kind: "SFTP", sftp: { host: "sftp.cliente.local", port: 22, username: "inia", remoteDirectory: "/in", authKind: "PASSWORD", timeoutMs: 5000 } }, secrets: { password: SFTP_SECRET } })).body.data.id as string
    expect((await as(BRUNO).post(`/sources/${sftpSource}/sftp-files`, { connectorConfig: { connector: "SFTP", sftp: { filePattern: "*.csv", format: "CSV" } } })).status).toBe(403)
    expect((await as(BRUNO).post(`/sources/${sftpSource}/unlock-configuration`, { password: SFTP_SECRET })).status).toBe(200)
    expect((await as(BRUNO).post(`/sources/${sftpSource}/sftp-files`, { connectorConfig: { connector: "SFTP", sftp: { filePattern: "*.csv", format: "CSV" } } })).status).toBe(200)
    expect((await auditOf(sftpSource, "DATA_HUB_SFTP_FILES_LISTED"))[0]!.payload).toMatchObject({ files: 0 })
    sftp.authFailure = true
    expect((await as(CAIO).post(`/sources/${sftpSource}/secrets`, { password: "senha-sftp-nova" })).body.error.code).toBe("DATA_SOURCE_AUTH_FAILED")
    sftp.authFailure = false
    // O teste da credencial nova não fixa a chave do servidor: a fonte ainda não mudou.
    const realList = sftp.list.bind(sftp)
    const seen: { onHostKey?: unknown }[] = []
    sftp.list = async (connection, directory) => {
      seen.push(connection)
      return realList(connection, directory)
    }
    expect((await as(CAIO).post(`/sources/${sftpSource}/secrets`, { password: "senha-sftp-nova" })).status).toBe(200)
    sftp.list = realList
    expect(seen).toHaveLength(1)
    expect(seen[0]!.onHostKey).toBeUndefined()

    for (const config of [{ kind: "FILE_UPLOAD" }, { kind: "API_PUSH" }, { kind: "API_PULL", api: { baseUrl: "https://aberta.cliente.local", auth: { kind: "NONE" }, headers: {}, timeoutMs: 5000 } }]) {
      const open = (await as(ANA).post("/sources", { name: `Sem senha ${config.kind} ${(counter += 1)}`, config })).body.data.id as string
      expect((await as(BRUNO).get(`/sources/${open}`)).body.data.configAccess).toEqual({ required: false, unlocked: true, expiresAt: null, fields: [] })
      expect((await as(BRUNO).patch(`/sources/${open}`, { name: `Renomeada ${(counter += 1)}` })).status).toBe(200)
    }
  })

  it("K) cada ação fica no registro com o nome de quem fez, vale para fonte excluída e nunca leva segredo nem dado do cliente", async () => {
    const sourceId = await createDatabaseSource("Banco do registro")
    const feedId = await anaFeed(sourceId, "registro")
    expect((await as(BRUNO).get(`/sources/${sourceId}/database/objects`)).status).toBe(403)
    expect((await unlock(BRUNO, sourceId, WRONG)).status).toBe(422)
    expect((await unlock(BRUNO, sourceId)).status).toBe(200)
    await as(BRUNO).get(`/sources/${sourceId}/database/objects`)
    await as(BRUNO).get(`/sources/${sourceId}/database/columns?schema=public&name=colaboradores`)
    await as(BRUNO).post(`/feeds/${feedId}/sample`)
    await as(BRUNO).post(`/sources/${sourceId}/test-connection`)
    await as(BRUNO).patch(`/sources/${sourceId}`, { name: "Banco do registro novo", config: { kind: "DATABASE", database: databaseConfig({ queryTimeoutMs: 60_000 }) } })
    await as(BRUNO).patch(`/feeds/${feedId}`, { name: "Conjunto renomeado" })
    await as(BRUNO).post(`/feeds/${feedId}/checkpoint/reset`)
    await as(CAIO).delete(`/feeds/${feedId}`)
    await as(CAIO).delete(`/sources/${sourceId}`)

    const page = await as(CAIO).get(`/audit-events?sourceId=${sourceId}&page=1&pageSize=100`)
    expect(page.status).toBe(200)
    const events = page.body.data.items as { action: string; actorName: string | null; sourceName: string; sourceDeletedAt: string | null; feedName: string | null; payload: Record<string, unknown> }[]
    const byAction = (action: string) => events.find((event) => event.action === action)
    for (const action of ["DATA_HUB_SOURCE_CREATED", "DATA_HUB_CONFIG_UNLOCKED", "DATA_HUB_FEED_CREATED", "DATA_HUB_CONFIG_ACCESS_DENIED", "DATA_HUB_CONFIG_UNLOCK_FAILED", "DATA_HUB_DATABASE_OBJECTS_LISTED", "DATA_HUB_DATABASE_COLUMNS_READ", "DATA_HUB_SAMPLE_READ", "DATA_HUB_CONNECTION_TESTED", "DATA_HUB_SOURCE_UPDATED", "DATA_HUB_FEED_UPDATED", "DATA_HUB_CHECKPOINT_RESET", "DATA_HUB_FEED_DELETED", "DATA_HUB_SOURCE_DELETED"]) {
      expect(byAction(action), action).toBeDefined()
    }
    expect(byAction("DATA_HUB_SOURCE_CREATED")).toMatchObject({ actorName: "Ana Dados", payload: { name: "Banco do registro", kind: "DATABASE", target: { host: "db.cliente.local", port: 5432, database: "rh", username: "inia_leitura", tls: "VERIFY_FULL" } } })
    expect(byAction("DATA_HUB_SOURCE_DELETED")).toMatchObject({ actorName: "Caio Dados", payload: { name: "Banco do registro novo", secretsRevoked: ["DATABASE_PASSWORD"] } })
    expect(byAction("DATA_HUB_FEED_DELETED")).toMatchObject({ actorName: "Caio Dados", feedName: expect.any(String), payload: { name: "Conjunto renomeado" } })
    expect(byAction("DATA_HUB_SOURCE_UPDATED")!.payload.changes).toEqual(expect.arrayContaining([{ field: "name", before: "Banco do registro", after: "Banco do registro novo" }]))
    expect(byAction("DATA_HUB_SOURCE_UPDATED")!.payload.changedFields).toEqual(["queryTimeoutMs"])
    expect(byAction("DATA_HUB_FEED_UPDATED")!.payload).toMatchObject({ sourceId, name: "Conjunto renomeado", previousName: "Colaboradores registro", sourceName: "Banco do registro novo" })
    expect(byAction("DATA_HUB_FEED_UPDATED")!.payload.changedFields).toContain("name")
    expect(byAction("DATA_HUB_DATABASE_OBJECTS_LISTED")).toMatchObject({ actorName: "Bruno Geral", payload: { objects: 1, truncated: false } })
    expect(byAction("DATA_HUB_DATABASE_COLUMNS_READ")).toMatchObject({ payload: { object: "public.colaboradores", columns: 2 } })
    expect(byAction("DATA_HUB_SAMPLE_READ")).toMatchObject({ actorName: "Bruno Geral", payload: { object: "public.colaboradores", rows: 2 } })
    expect(byAction("DATA_HUB_CONFIG_UNLOCKED")?.sourceDeletedAt).not.toBeNull() // fonte excluída continua no registro, pelo nome
    expect(byAction("DATA_HUB_CONFIG_UNLOCKED")?.sourceName).toBe("Banco do registro novo")

    // Filtros e paginação.
    const filtered = await as(CAIO).get(`/audit-events?sourceId=${sourceId}&action=DATA_HUB_SAMPLE_READ&page=1&pageSize=5`)
    expect(filtered.body.data).toMatchObject({ total: 1, page: 1, pageSize: 5 })
    expect((await as(CAIO).get(`/audit-events?search=Caio&sourceId=${sourceId}&page=1&pageSize=5`)).body.data.items.every((event: { actorName: string }) => event.actorName === "Caio Dados")).toBe(true)
    expect((await as(CAIO).get("/audit-events?action=OUTRA_ACAO")).status).toBe(400) // ação fora da Central nunca vira filtro

    // Nenhum segredo nem dado do cliente em lugar nenhum do registro da organização.
    const everything = JSON.stringify((await pool.query(`select action, payload from audit_logs where organization_id = $1`, [ORG])).rows)
    for (const secret of [...ALL_SECRETS, CLIENT_VALUE]) expect(everything, secret).not.toContain(secret)
    const authorship = await as(BRUNO).get(`/sources/${await createDatabaseSource("Autoria")}`)
    expect(authorship.body.data).toMatchObject({ createdByName: "Ana Dados", updatedByName: "Ana Dados" })
    expect(authorship.body.data.lastChangedAt).toEqual(expect.any(String))
  })

  it("M) senha digitada no teste conta por servidor + usuário: mudar o banco ou a criptografia não zera, e só recusa de senha conta", async () => {
    const test = (person: string, password: string, overrides: Record<string, unknown> = {}) => as(person).post("/database/test", { config: databaseConfig(overrides), password })
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const refused = await test(BRUNO, WRONG, attempt % 2 ? {} : { database: `outro_${attempt}` })
      expect(refused.status).toBe(200)
      expect(refused.body.data).toMatchObject({ health: "ERROR", errorCode: "DATA_SOURCE_AUTH_FAILED" })
    }
    expect((await test(BRUNO, WRONG, { tls: { mode: "PREFERRED" } })).status).toBe(429)
    clientDb.opened = 0
    for (const overrides of [{}, { database: "financeiro" }, { tls: { mode: "DISABLED" } }, { engine: "MYSQL", port: 5432 }, { host: "DB.CLIENTE.LOCAL", username: "INIA_LEITURA" }]) expect((await test(BRUNO, SECRET, overrides)).status).toBe(429)
    expect(clientDb.opened).toBe(0) // bloqueado nem tenta conectar
    expect((await test(BRUNO, SECRET, { host: "outro.cliente.local" })).status).toBe(200)
    expect((await test(CAIO, SECRET)).body.data.health).toBe("HEALTHY")
    offsetMs = 16 * 60_000
    expect((await test(BRUNO, SECRET)).body.data.health).toBe("HEALTHY")
    // Acertar não zera a conta; servidor fora do ar não conta.
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await test(BRUNO, WRONG)).status).toBe(200)
    expect((await test(BRUNO, SECRET)).body.data.health).toBe("HEALTHY")
    expect((await test(BRUNO, WRONG)).status).toBe(429)
    offsetMs = 32 * 60_000
    clientDb.unreachable = true
    for (let attempt = 1; attempt <= 6; attempt += 1) expect((await test(BRUNO, WRONG)).body.data.errorCode).toBe("DATA_SOURCE_UNREACHABLE")
    clientDb.unreachable = false
    expect((await test(BRUNO, WRONG)).status).toBe(200)
    // Senha digitada contra uma fonte citada conta do mesmo jeito; sem pessoa, nem testa.
    expect((await as(null).post("/database/test", { config: databaseConfig(), password: SECRET })).body.error.code).toBe("DATA_SOURCE_CONFIG_LOCKED")
  })

  it("N) cadastro com senha recusada não grava nada e conta: cadastrar outra fonte não serve para tentar senhas", async () => {
    const create = (password: string | null, name = `Palpite ${(counter += 1)}`) => as(BRUNO).post("/sources", { name, config: { kind: "DATABASE", database: databaseConfig() }, ...(password ? { secrets: { password } } : {}) })
    const refused = await create(WRONG, "Palpite recusado")
    expect(refused.status).toBe(422)
    expect(refused.body.error.code).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(JSON.stringify(refused.body)).not.toContain(WRONG)
    expect((await pool.query(`select 1 from data_sources where organization_id = $1 and name = 'Palpite recusado'`, [ORG])).rowCount).toBe(0)
    const audit = await pool.query<{ actor_id: string; payload: Record<string, unknown> }>(`select actor_id, payload from audit_logs where organization_id = $1 and action = 'DATA_HUB_SOURCE_CREATE_REFUSED' and payload->>'name' = 'Palpite recusado'`, [ORG])
    expect(audit.rows[0]).toMatchObject({ actor_id: BRUNO, payload: { name: "Palpite recusado", target: { host: "db.cliente.local", username: "inia_leitura" }, errorCode: "DATA_SOURCE_AUTH_FAILED" } })
    // Sem senha nem chega a gravar a fonte pela metade.
    expect((await create(null, "Sem senha")).body.error.code).toBe("DATA_SOURCE_SECRET_REQUIRED")
    expect((await pool.query(`select 1 from data_sources where organization_id = $1 and name = 'Sem senha'`, [ORG])).rowCount).toBe(0)
    // A conta é a mesma em todos os caminhos: cadastro, teste, liberação e troca de senha.
    const existing = await createDatabaseSource()
    expect((await as(BRUNO).post("/database/test", { config: databaseConfig(), password: WRONG })).status).toBe(200)
    expect((await unlock(BRUNO, existing, WRONG)).status).toBe(422)
    expect((await as(BRUNO).post(`/sources/${existing}/secrets`, { password: WRONG })).status).toBe(422)
    expect((await create(WRONG)).status).toBe(429)
    expect((await create(SECRET)).status).toBe(429)
    expect((await unlock(BRUNO, existing)).status).toBe(429)
    offsetMs = 16 * 60_000
    // Senha certa cadastra e libera quem cadastrou; servidor fora do alcance não impede o cadastro.
    expect((await create(SECRET)).status).toBe(201)
    clientDb.unreachable = true
    expect((await create(SECRET)).status).toBe(201)
  })

  it("O) testar com a senha guardada nunca bloqueia: a senha mudou no servidor, e quem clica em testar ainda consegue trocar", async () => {
    const sourceId = await createDatabaseSource()
    clientDb.acceptedPassword = NEW_SECRET
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const tested = await as(BRUNO).post(`/sources/${sourceId}/test-connection`)
      expect(tested.status).toBe(200)
      expect(tested.body.data).toMatchObject({ health: "ERROR", errorCode: "DATA_SOURCE_AUTH_FAILED" })
      expect((await as(BRUNO).post("/database/test", { config: databaseConfig(), sourceId })).status).toBe(200)
    }
    expect((await as(BRUNO).post(`/sources/${sourceId}/secrets`, { password: NEW_SECRET })).status).toBe(200)
    expect(await ctx.secrets.get({ sourceId, purpose: "DATABASE_PASSWORD" })).toBe(NEW_SECRET)
  })

  it("P) troca de credencial de API: precisa de prova; sem prova, só com a credencial atual", async () => {
    const createApi = async (name: string, auth: Record<string, unknown> = { kind: "BEARER" }, secrets: Record<string, string> = { token: BEARER }) => {
      const created = await as(ANA).post("/sources", { name, config: { kind: "API_PULL", api: { baseUrl: "https://api.cliente.local", auth, headers: {}, timeoutMs: 5000 } }, secrets })
      expect(created.status).toBe(201)
      return created.body.data.id as string
    }
    // Endereço base que responde 404 para todo mundo não prova nada: qualquer token passaria.
    apiResponds = () => json(404, {})
    const notFound = await createApi("API 404")
    const unproven = await as(CAIO).post(`/sources/${notFound}/secrets`, { token: "qualquer-coisa" })
    expect(unproven.status).toBe(422)
    expect(unproven.body.error.code).toBe("DATA_SOURCE_CREDENTIAL_UNPROVEN")
    expect(await ctx.secrets.get({ sourceId: notFound, purpose: "API_AUTH" })).toBe(BEARER)
    expect(http.requests.at(-1)!.headers.authorization).toBeUndefined() // contraprova: o mesmo pedido, sem a credencial
    expect(http.requests.slice(-2).map((sent) => sent.statusOnly)).toEqual([true, true]) // com e sem a credencial, sem baixar o corpo
    // Quem prova conhecer a atual pode trocar mesmo sem prova da nova.
    expect((await as(CAIO).post(`/sources/${notFound}/unlock-configuration`, { token: BEARER })).status).toBe(200)
    expect((await as(CAIO).post(`/sources/${notFound}/secrets`, { token: "token-novo-da-api" })).status).toBe(200)
    expect(await ctx.secrets.get({ sourceId: notFound, purpose: "API_AUTH" })).toBe("token-novo-da-api")
    expect((await as(CAIO).get(`/sources/${notFound}`)).body.data.connectionHealth).toBe("UNKNOWN") // sem prova, não diz que conectou

    // API aberta (200 para qualquer um) também não prova.
    apiResponds = () => json(200, { ok: true })
    const open = await createApi("API aberta")
    expect((await as(BRUNO).post(`/sources/${open}/secrets`, { token: "qualquer-coisa" })).body.error.code).toBe("DATA_SOURCE_CREDENTIAL_UNPROVEN")

    // Base sem prova, mas o conjunto de dados confere o token: é ele que decide, e o pedido traz só uma linha.
    apiResponds = (sent, url) => (url.pathname !== "/dados" ? json(404, {}) : sent.headers.authorization === "Bearer token-do-servidor" || sent.headers.authorization === `Bearer ${BEARER}` ? json(200, { data: [] }) : json(401, {}))
    const guarded = await createApi("API com conjunto")
    const feed = await as(ANA).post(`/sources/${guarded}/feeds`, { feedKey: "dados", name: "Dados", contractKey: "EMPLOYEES", connectorConfig: { connector: "API_PULL", api: { endpoint: "/dados", extractPath: "data", pagination: { kind: "OFFSET", offsetParam: "offset", limitParam: "limit", limit: 500 } } }, mapping: feedBody("dados").mapping })
    expect(feed.status).toBe(201)
    http.requests.length = 0
    expect((await as(BRUNO).post(`/sources/${guarded}/secrets`, { token: "token-errado" })).body.error.code).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(http.requests.at(-1)!.url).toContain("limit=1")
    expect(await ctx.secrets.get({ sourceId: guarded, purpose: "API_AUTH" })).toBe(BEARER)
    expect((await as(BRUNO).post(`/sources/${guarded}/secrets`, { token: "token-do-servidor" })).status).toBe(200)
    expect(await ctx.secrets.get({ sourceId: guarded, purpose: "API_AUTH" })).toBe("token-do-servidor")

    // Endereço fora do ar não encerra a prova: o seguinte decide. Sem nenhum endereço de pé, a resposta é essa, e não "sem prova".
    apiResponds = (sent, url) => (url.pathname !== "/dados" ? json(503, {}) : sent.headers.authorization === "Bearer token-apos-queda" ? json(200, { data: [] }) : json(401, {}))
    expect((await as(BRUNO).post(`/sources/${guarded}/secrets`, { token: "token-apos-queda" })).status).toBe(200)
    apiResponds = () => json(503, {})
    const down = await createApi("API fora do ar") // fora do alcance não impede o cadastro
    expect((await as(BRUNO).post(`/sources/${down}/secrets`, { token: "qualquer-coisa" })).body.error.code).toBe("DATA_SOURCE_UNREACHABLE")

    // OAuth2: quem julga é o servidor de token.
    apiResponds = (sent, url) => (url.pathname === "/oauth/token" ? (sent.body?.includes("client_secret=segredo-certo") ? json(200, { access_token: "abc" }) : json(401, {})) : json(404, {}))
    const oauth = await createApi("API OAuth2", { kind: "OAUTH2_CLIENT_CREDENTIALS", tokenUrl: "https://api.cliente.local/oauth/token", clientId: "inia" }, { clientSecret: "segredo-certo" })
    expect((await as(CAIO).post(`/sources/${oauth}/secrets`, { clientSecret: "segredo-errado" })).body.error.code).toBe("DATA_SOURCE_AUTH_FAILED")
    expect((await as(CAIO).post(`/sources/${oauth}/secrets`, { clientSecret: "segredo-certo" })).status).toBe(200)
  })

  it("P2) acertar não zera o limite: cadastrar com um token qualquer numa API que aceita tudo não abre novas tentativas", async () => {
    apiResponds = () => json(404, {})
    const created = await as(ANA).post("/sources", { name: "API que aceita tudo", config: { kind: "API_PULL", api: { baseUrl: "https://api.cliente.local", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 5000 } }, secrets: { token: BEARER } })
    const sourceId = created.body.data.id as string
    const guess = () => as(CAIO).post(`/sources/${sourceId}/unlock-configuration`, { token: "palpite" })
    for (let attempt = 1; attempt <= 4; attempt += 1) expect((await guess()).body.error.code).toBe("DATA_SOURCE_SECRET_INCORRECT")
    const own = await as(CAIO).post("/sources", { name: "Fonte para zerar a conta", config: { kind: "API_PULL", api: { baseUrl: "https://api.cliente.local", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 5000 } }, secrets: { token: "qualquer-coisa" } })
    expect(own.status).toBe(201)
    expect((await as(CAIO).post(`/sources/${own.body.data.id}/unlock-configuration`, { token: "qualquer-coisa" })).status).toBe(200)
    expect((await guess()).status).toBe(429)
    expect((await as(CAIO).post(`/sources/${sourceId}/unlock-configuration`, { token: BEARER })).status).toBe(429)
  })

  it("P3) chave do servidor SFTP divergente não conta como senha errada: não bloqueia e não impede o cadastro", async () => {
    const config = { kind: "SFTP", sftp: { host: "sftp-chave.cliente.local", port: 22, username: "inia", remoteDirectory: "/in", authKind: "PASSWORD", hostKeyFingerprint: "SHA256:esperada", timeoutMs: 5000 } }
    const created = await as(ANA).post("/sources", { name: "SFTP com chave", config, secrets: { password: SFTP_SECRET } })
    const sourceId = created.body.data.id as string
    sftp.hostKeyMismatch = true
    try {
      for (let attempt = 1; attempt <= 7; attempt += 1) {
        const refused = await as(BRUNO).post(`/sources/${sourceId}/secrets`, { password: SFTP_SECRET })
        expect(refused.status).toBe(422)
        expect(refused.body.error.message).toContain("host key")
      }
      expect((await as(BRUNO).post("/sources", { name: "SFTP com chave 2", config, secrets: { password: SFTP_SECRET } })).status).toBe(201)
    } finally {
      sftp.hostKeyMismatch = false
    }
    expect((await as(BRUNO).post(`/sources/${sourceId}/secrets`, { password: SFTP_SECRET })).status).toBe(200)
  })

  it("Q) cabeçalho, parâmetro e URL de API Pull saem escondidos sem liberação; salvar o valor escondido mantém o atual", async () => {
    const HEADER_SECRET = "valor-do-cabecalho-secreto"
    const URL_SECRET = "chave-na-url-secreta"
    const PARAM_SECRET = "valor-do-parametro-secreto"
    apiResponds = (sent) => (sent.headers.authorization ? json(200, { data: [] }) : json(401, {}))
    const baseUrl = `https://api.cliente.local/v1?chave=${URL_SECRET}`
    const config = (headers: Record<string, string>, url = baseUrl) => ({ kind: "API_PULL", api: { baseUrl: url, auth: { kind: "BEARER" }, headers, timeoutMs: 5000 } })
    const created = await as(ANA).post("/sources", { name: "API com cabeçalho", config: config({ "X-Tenant": HEADER_SECRET }), secrets: { token: BEARER } })
    expect(created.status).toBe(201)
    const sourceId = created.body.data.id as string
    expect(JSON.stringify(created.body)).not.toContain(HEADER_SECRET)
    const feed = await as(ANA).post(`/sources/${sourceId}/feeds`, { feedKey: "dados", name: "Dados", contractKey: "EMPLOYEES", connectorConfig: { connector: "API_PULL", api: { endpoint: `/dados?token=${URL_SECRET}`, queryParams: { chave: PARAM_SECRET }, extractPath: "data" } }, mapping: feedBody("dados").mapping })
    expect(feed.status).toBe(201)
    const feedId = feed.body.data.id as string
    expect(JSON.stringify(feed.body)).not.toContain(PARAM_SECRET)

    const hidden = (body: unknown) => {
      const text = JSON.stringify(body)
      for (const secret of [HEADER_SECRET, URL_SECRET, PARAM_SECRET]) expect(text, secret).not.toContain(secret)
    }
    const bruno = as(BRUNO)
    for (const path of ["/sources", `/sources/${sourceId}`, `/sources/${sourceId}/feeds`, `/feeds/${feedId}`, "/overview", "/quality"]) {
      const response = await bruno.get(path)
      expect(response.status, path).toBe(200)
      hidden(response.body)
    }
    const locked = (await bruno.get(`/sources/${sourceId}`)).body.data
    expect(locked.config.api.headers).toEqual({ "X-Tenant": MASKED_VALUE })
    expect(locked.config.api.baseUrl).toBe(`https://api.cliente.local/v1?chave=${MASKED_VALUE}`)
    expect((await bruno.get(`/feeds/${feedId}`)).body.data.connectorConfig.api.queryParams).toEqual({ chave: MASKED_VALUE })
    hidden((await bruno.post(`/sources/${sourceId}/status`, { action: "PAUSE" })).body)
    const tested = await bruno.post(`/sources/${sourceId}/test-connection`)
    expect(tested.body.data.health).toBe("HEALTHY")
    expect(tested.body.data.detail).toContain(`chave=${MASKED_VALUE}`)
    hidden(tested.body)

    // Liberado, os dois detalhes mostram. A lista continua escondendo.
    expect((await bruno.post(`/sources/${sourceId}/unlock-configuration`, { token: BEARER })).status).toBe(200)
    expect((await bruno.get(`/sources/${sourceId}`)).body.data.config.api).toMatchObject({ headers: { "X-Tenant": HEADER_SECRET }, baseUrl })
    expect((await bruno.get(`/feeds/${feedId}`)).body.data.connectorConfig.api.queryParams).toEqual({ chave: PARAM_SECRET })
    hidden((await bruno.get("/sources")).body)

    // Tela aberta antes de liberar devolve o valor escondido: mantém o que está gravado e o destino não muda.
    const stored = async () => (await pool.query<{ config: { api: { headers: Record<string, string>; baseUrl: string } } }>(`select config from data_sources where id = $1`, [sourceId])).rows[0]!.config.api
    const kept = await bruno.patch(`/sources/${sourceId}`, { name: "API com cabeçalho", config: config({ "X-Tenant": MASKED_VALUE }, locked.config.api.baseUrl) })
    expect(kept.status).toBe(200)
    expect(await stored()).toMatchObject({ headers: { "X-Tenant": HEADER_SECRET }, baseUrl })
    const [update] = (await auditOf(sourceId, "DATA_HUB_SOURCE_UPDATED")).slice(-1)
    expect(update!.payload.changedFields).toEqual([])
    // Valor novo troca; marcador sem valor anterior, ou URL editada com o marcador, é recusado e nunca gravado.
    expect((await bruno.patch(`/sources/${sourceId}`, { name: "API com cabeçalho", config: config({ "X-Tenant": "novo" }, baseUrl) })).status).toBe(200)
    expect((await stored()).headers).toEqual({ "X-Tenant": "novo" })
    expect((await bruno.patch(`/sources/${sourceId}`, { name: "API com cabeçalho", config: config({ "X-Outro": MASKED_VALUE }, baseUrl) })).body.error.code).toBe("DATA_SOURCE_MASKED_VALUE")
    expect((await bruno.patch(`/sources/${sourceId}`, { name: "API com cabeçalho", config: config({}, `https://api.cliente.local/v2?chave=${MASKED_VALUE}`) })).body.error.code).toBe("DATA_SOURCE_MASKED_VALUE")
    expect((await as(ANA).post("/sources", { name: "Com marcador", config: { kind: "API_PULL", api: { baseUrl: "https://api.cliente.local", auth: { kind: "NONE" }, headers: { "X-Tenant": MASKED_VALUE }, timeoutMs: 5000 } } })).body.error.code).toBe("DATA_SOURCE_MASKED_VALUE")
    const feedKept = await bruno.patch(`/feeds/${feedId}`, { connectorConfig: { connector: "API_PULL", api: { endpoint: `/dados?token=${MASKED_VALUE}`, queryParams: { chave: MASKED_VALUE }, extractPath: "data" } } })
    expect(feedKept.status).toBe(200)
    const feedApi = (await pool.query<{ api: { endpoint: string; queryParams: Record<string, string> } }>(`select connector_config->'api' api from data_feeds where id = $1`, [feedId])).rows[0]!.api
    expect(feedApi).toMatchObject({ endpoint: `/dados?token=${URL_SECRET}`, queryParams: { chave: PARAM_SECRET } })

    // Fonte sem credencial não tem senha para pedir: os valores ficam escondidos para todo mundo, e dá para trocar digitando de novo.
    const open = (await as(ANA).post("/sources", { name: "API sem autenticação", config: { kind: "API_PULL", api: { baseUrl: "https://aberta.cliente.local", auth: { kind: "NONE" }, headers: { "X-Tenant": HEADER_SECRET }, timeoutMs: 5000 } } })).body.data.id as string
    hidden((await as(ANA).get(`/sources/${open}`)).body)
    // Nada disso foi para o registro.
    const everything = JSON.stringify((await pool.query(`select payload from audit_logs where organization_id = $1`, [ORG])).rows)
    for (const secret of [HEADER_SECRET, URL_SECRET, PARAM_SECRET]) expect(everything, secret).not.toContain(secret)
  })

  it("R) baixar o CSV de rejeições fica no registro, com quem baixou e quantas linhas, sem o conteúdo", async () => {
    const sourceId = await createDatabaseSource("Banco do CSV")
    const feedId = await anaFeed(sourceId, "csv")
    expect((await as(ANA).post(`/feeds/${feedId}/status`, { action: "ACTIVATE" })).status).toBe(200)
    const run = (await as(CAIO).post(`/feeds/${feedId}/sync`)).body.data.id as string
    for (const number of [1, 2]) await pool.query(`insert into data_ingestion_rejections (organization_id, run_id, record_number, source_record_key, error_code, field, message) values ($1, $2, $3, $4, 'DATA_TYPE_INVALID', 'name', 'inválido')`, [ORG, run, number, CLIENT_VALUE])
    const csv = await as(BRUNO).get(`/runs/${run}/rejections.csv`)
    expect(csv.status).toBe(200)
    expect(csv.text).toContain(CLIENT_VALUE)
    const page = await as(BRUNO).get(`/audit-events?action=DATA_HUB_REJECTIONS_EXPORTED&sourceId=${sourceId}&page=1&pageSize=5`)
    expect(page.body.data.total).toBe(1)
    expect(page.body.data.items[0]).toMatchObject({ actorName: "Bruno Geral", sourceName: "Banco do CSV", feedName: expect.any(String), payload: { rows: 2 } })
    expect(JSON.stringify(page.body)).not.toContain(CLIENT_VALUE)
  })

  it("L) posição de leitura antiga no registro não aparece, mesmo gravada antes da correção", async () => {
    const sourceId = await createDatabaseSource()
    const feedId = await anaFeed(sourceId, "antigo")
    await pool.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'DATA_HUB_CHECKPOINT_RESET', 'data_feed', $3, $4)`, [ORG, ANA, feedId, JSON.stringify({ previous: { position: [CLIENT_VALUE] } })])
    const page = await as(CAIO).get(`/audit-events?feedId=${feedId}&action=DATA_HUB_CHECKPOINT_RESET&page=1&pageSize=5`)
    expect(page.body.data.total).toBe(1)
    expect(JSON.stringify(page.body)).not.toContain(CLIENT_VALUE)
  })
})
