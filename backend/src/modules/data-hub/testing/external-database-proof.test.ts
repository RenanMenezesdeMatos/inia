import net from "node:net"
import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createIndicatorDefinition, deleteIndicatorDefinition } from "../../indicators/application/indicator-definition-service.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import type { ExternalDatabaseConnector, ExternalDatabaseSession } from "../application/ports.js"
import { findFeed, type DataRunRow } from "../application/records.js"
import { enqueueRun, processQueuedRuns, recoverInterruptedRuns } from "../application/run-service.js"
import { DATABASE_ENGINES, type DatabaseEngine, type ResolvedDatabaseConnection } from "../domain/database/database-engine.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"
import { DriverExternalDatabaseConnector } from "../infrastructure/external-databases/external-database-connector.js"
import { createDataHubRouter } from "../presentation/data-hub-router.js"
import { adminExec, adminTargets, insertRows, openAdmin, resetProofArea, table, types, type ProofTarget } from "./external-database-admin.js"
import { CapturingLogger } from "./fakes.js"

/**
 * PROVA DE PONTA A PONTA — bancos de dados EXTERNOS reais × banco de teste da INIA:
 *
 *   docker compose --profile external-examples up -d          (na raiz do repositório)
 *   INIA_DB_PROOF=1 INIA_EXTERNAL_DB_PROOF=1 NODE_ENV=test npx vitest run external-database-proof
 *
 * Motores: INIA_EXTERNAL_DB_ENGINES (padrão: todos). Um motor listado e inacessível FALHA (nunca vira "pulado").
 * Para cada motor, pelas mesmas rotas da tela: testar (ok, senha errada, porta fechada, servidor mudo, banco
 * inexistente, TLS) → criar a conexão → descobrir tabelas/visões → colunas → amostra → mapeamento sugerido → prévia
 * → ativar → sincronizar → sincronizar de novo (nada duplica) → incremental (só o novo) → páginas + continuação →
 * empates na ordenação (com e sem chave) → falha de rede no meio (retoma do checkpoint) → falha ao aplicar
 * (checkpoint não avança, página inteira desfeita) → trava real na origem (tempo esgotado, nova tentativa, termina quando a
 * trava sai) → carga interrompida (retomada automática) → mudança de esquema →
 * permissão revogada → reiniciar leitura → isolamento entre organizações → senha em lugar nenhum.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1" && process.env.INIA_EXTERNAL_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OTHER_ORG = "00000000-0000-4000-8000-000000000999"
const ENGINES = (process.env.INIA_EXTERNAL_DB_ENGINES ?? DATABASE_ENGINES.join(",")).split(",").map((value) => value.trim()).filter(Boolean) as DatabaseEngine[]
const PREFIX: Record<DatabaseEngine, string> = { POSTGRESQL: "TXDB-PG", MARIADB: "TXDB-MA", MYSQL: "TXDB-MY", SQLSERVER: "TXDB-MS" }
const SUM_INDICATOR = "TEST_TXDB_SUM"
const TIE_INDICATOR = "TEST_TXDB_TIE"
const OPERATORS = 25
const DAYS = 100

/** Conector real com falha de rede injetável na N-ésima leitura de página (simula queda no meio da carga). */
class FlakyConnector implements ExternalDatabaseConnector {
  failOnPageQuery: number | null = null
  pageQueries = 0
  private readonly real = new DriverExternalDatabaseConnector()
  async open(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession> {
    const session = await this.real.open(connection)
    return {
      ...session,
      flavor: session.flavor,
      serverVersion: session.serverVersion,
      tlsActive: session.tlsActive,
      readOnlyEnforced: session.readOnlyEnforced,
      privilegeWarning: () => session.privilegeWarning(),
      close: () => session.close(),
      query: async (statement, options) => {
        if (statement.sql.includes("__inia_p")) {
          this.pageQueries += 1
          if (this.failOnPageQuery !== null && this.pageQueries === this.failOnPageQuery) {
            this.failOnPageQuery = null
            throw Object.assign(new Error("read ECONNRESET (injetado pela prova)"), { code: "ECONNRESET" })
          }
        }
        return session.query(statement, options)
      },
    }
  }
}

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let flaky: FlakyConnector
let logger: CapturingLogger
let app: express.Express
let otherApp: express.Express
let actorPersonId = "00000000-0000-4000-8000-000000000000"

function appFor(organizationId: string): express.Express {
  const instance = express()
  instance.use(express.json())
  instance.use((req, _res, next) => {
    // Sessão identificada: quem cria a conexão pelas rotas digitou a senha e fica liberado para configurá-la.
    req.user = { sub: "x", jti: "prova-bancos-externos", personId: actorPersonId, organizationId, role: "ADMIN", name: "Admin", email: "a@b", avatarUrl: null, jobTitle: null, teamId: null, teamName: null } as never
    next()
  })
  instance.use("/api/v1/admin/data-hub", createDataHubRouter(db, { logger, databases: flaky, secrets: new PgAesSecretStore(db) }))
  instance.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next
    if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
    return res.status(error.name === "ZodError" ? 400 : 500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
  })
  return instance
}

const api = (path: string) => `/api/v1/admin/data-hub${path}`

async function cleanupInia() {
  await db.query(`delete from data_sources where organization_id = $1 and name like 'TXDB %'`, [ORG])
  await db.query(`delete from indicator_measurements where organization_id = $1 and subject_id in (select id from people where matricula like 'TXDB-%')`, [ORG])
  await db.query(`delete from employee_status_periods where person_id in (select id from people where organization_id = $1 and matricula like 'TXDB-%')`, [ORG])
  await db.query(`update people set reports_to_id = null where organization_id = $1 and matricula like 'TXDB-%'`, [ORG])
  await db.query(`delete from people where organization_id = $1 and matricula like 'TXDB-%'`, [ORG])
  for (const code of [SUM_INDICATOR, TIE_INDICATOR]) {
    const indicator = await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = $2`, [ORG, code])
    if (indicator.rows[0]) await deleteIndicatorDefinition(db, ORG, indicator.rows[0].id)
  }
  await db.query(`drop trigger if exists txdb_fail_apply on indicator_measurements`)
  await db.query(`drop function if exists txdb_fail_apply()`)
}

/** Processa a fila até nenhum Run do feed estar pendente (o worker em segundo plano das rotas também ajuda). */
async function drain(feedId: string, timeoutMs = 120_000): Promise<DataRunRow[]> {
  const started = Date.now()
  for (;;) {
    await processQueuedRuns(ctx, 10)
    const pending = await db.query(`select 1 from data_ingestion_runs where feed_id = $1 and status in ('QUEUED','CONNECTING','FETCHING','PARSING','MAPPING','VALIDATING','APPLYING') and next_attempt_at <= now()`, [feedId])
    const waiting = await db.query(`select 1 from data_ingestion_runs where feed_id = $1 and status in ('CONNECTING','FETCHING','PARSING','MAPPING','VALIDATING','APPLYING')`, [feedId])
    if (!pending.rowCount && !waiting.rowCount) break
    if (Date.now() - started > timeoutMs) throw new Error("Fila não esvaziou a tempo.")
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const runs = await db.query<DataRunRow>(`select id, status, trigger_kind "triggerKind", records_received "recordsReceived", records_inserted "recordsInserted", records_updated "recordsUpdated", records_unchanged "recordsUnchanged", records_rejected "recordsRejected", error_code "errorCode", error_message "errorMessage", checkpoint_after "checkpointAfter" from data_ingestion_runs where feed_id = $1 order by created_at`, [feedId])
  return runs.rows
}

async function measurementCount(prefix: string, code: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    `select count(*)::int n from indicator_measurements m join indicator_definitions d on d.id = m.indicator_definition_id join people p on p.id = m.subject_id
     where m.organization_id = $1 and d.code = $2 and p.matricula like $3`,
    [ORG, code, `${prefix}-%`],
  )
  return result.rows[0]!.n
}

/** Instante com microssegundos (sempre crescente com `index`), no texto aceito pelos três dialetos. */
function micros(index: number): string {
  const base = Date.UTC(2026, 8, 1, 8, 0, 0)
  const seconds = Math.floor(index / 3)
  const micro = 100_000 + (index % 3) * 1 // diferenças de 1 µs: truncar para ms pularia/relerei linhas
  const date = new Date(base + seconds * 1000)
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)}.${String(micro).padStart(6, "0")}`
}

function ddl(target: ProofTarget): string[] {
  const t = types(target)
  return [
    `create table ${table(target, "colaboradores")} (matricula ${t.key} not null primary key, nome ${t.text} not null, nivel ${t.key} not null, gestor_matricula ${t.key}, atualizado_em ${t.timestamp} not null)`,
    `create table ${table(target, "medicoes")} (id ${t.bigint} not null primary key, matricula ${t.key} not null, indicador ${t.key} not null, data_referencia ${t.date} not null, valor ${t.decimal}, atualizado_em ${t.timestamp} not null)`,
    `create table ${table(target, "eventos_sem_chave")} (matricula ${t.key} not null, indicador ${t.key} not null, data_referencia ${t.date} not null, valor ${t.decimal}, atualizado_em ${t.timestamp} not null)`,
    `create table ${table(target, "segredo_rh")} (matricula ${t.key} not null primary key, salario ${t.decimal})`,
  ]
}

/** Instantes crescentes com o índice (um segundo de distância + microssegundos), a partir de uma data. */
function laterInstant(day: string, index: number): string {
  const at = new Date(Date.parse(`${day}T00:00:00Z`) + index * 1000).toISOString()
  return `${at.slice(0, 10)} ${at.slice(11, 19)}.${String(index).padStart(6, "0")}`
}

function dayText(offset: number): string {
  return new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10)
}

async function seedExternal(target: ProofTarget, prefix: string) {
  await resetProofArea(target, ddl)
  // A INIA NÃO pode ler esta tabela (sem permissão) — usada para provar o erro de permissão.
  if (target.engine === "POSTGRESQL") await adminExec(target, `revoke select on ${table(target, "segredo_rh")} from ${target.readerUser}`)
  else if (target.engine === "SQLSERVER") await adminExec(target, `deny select on ${table(target, "segredo_rh")} to [${target.readerUser}]`)
  else await adminExec(target, `revoke select on \`${target.database}\`.* from '${target.readerUser}'@'%'; grant select on \`${target.database}\`.colaboradores to '${target.readerUser}'@'%'; grant select on \`${target.database}\`.medicoes to '${target.readerUser}'@'%'; grant select on \`${target.database}\`.eventos_sem_chave to '${target.readerUser}'@'%'; flush privileges`)
  // Sempre no banco da prova: no SQL Server o administrador entra no `master` por padrão e não acharia as tabelas.
  const admin = await (await import("./external-database-admin.js")).openAdmin(target, target.database)
  try {
    // Gestor vem DEPOIS dos liderados na tabela: a carga única de colaboradores resolve o gestor na mesma carga.
    const people: (string | null)[][] = Array.from({ length: OPERATORS }, (_, index) => [`${prefix}-${String(index + 1).padStart(4, "0")}`, `Operador ${index + 1} ${prefix}`, "OPERATOR", `${prefix}-SUP`, micros(index)])
    people.push([`${prefix}-SUP`, `Supervisora ${prefix}`, "SUPERVISOR", null, micros(OPERATORS)])
    await insertRows(admin, target, "colaboradores", ["matricula", "nome", "nivel", "gestor_matricula", "atualizado_em"], people)
    const measurements: (string | number | null)[][] = []
    let id = 0
    for (let day = 0; day < DAYS; day += 1) {
      for (let person = 0; person < OPERATORS; person += 1) {
        id += 1
        // ids 301–450 empatam no instante (empate resolvido pela chave id).
        const at = id >= 301 && id <= 450 ? micros(300) : micros(id)
        measurements.push([id, `${prefix}-${String(person + 1).padStart(4, "0")}`, SUM_INDICATOR, dayText(day), person + day + 0.5, at])
      }
    }
    await insertRows(admin, target, "medicoes", ["id", "matricula", "indicador", "data_referencia", "valor", "atualizado_em"], measurements)
    // Sem chave: 90 instantes distintos, 150 linhas empatadas, 10 distintas (= 250, 25 pessoas × 10 dias).
    const events: (string | number | null)[][] = []
    let n = 0
    for (let day = 0; day < 10; day += 1) {
      for (let person = 0; person < OPERATORS; person += 1) {
        n += 1
        const at = n <= 90 ? micros(n) : n <= 240 ? micros(1_000) : micros(1_000 + n)
        events.push([`${prefix}-${String(person + 1).padStart(4, "0")}`, TIE_INDICATOR, dayText(day), 1, at])
      }
    }
    await insertRows(admin, target, "eventos_sem_chave", ["matricula", "indicador", "data_referencia", "valor", "atualizado_em"], events)
  } finally {
    await admin.close()
  }
}

describe.skipIf(!ENABLED)("Central de Dados — bancos externos reais (prova de ponta a ponta)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    flaky = new FlakyConnector()
    logger = new CapturingLogger()
    ctx = createDataHubContext(db, { logger, databases: flaky, secrets: new PgAesSecretStore(db) })
    await cleanupInia()
    await createIndicatorDefinition(db, ORG, { code: SUM_INDICATOR, name: "Soma externa (teste)", unit: "COUNT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "SUM", officialClosureSupported: false })
    await createIndicatorDefinition(db, ORG, { code: TIE_INDICATOR, name: "Empates externos (teste)", unit: "COUNT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "SUM", officialClosureSupported: false })
    actorPersonId = (await db.query<{ id: string }>(`select id from people where organization_id = $1 order by created_at limit 1`, [ORG])).rows[0]!.id
    app = appFor(ORG)
    otherApp = appFor(OTHER_ORG)
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanupInia()
    await pool.end()
  })

  describe.each(ENGINES)("%s", (engine) => {
    const target = adminTargets()[engine]
    const prefix = PREFIX[engine]
    // Criptografia sempre escolhida, como na tela: fonte nova sem `tls` nasce em VERIFY_FULL (DATA-5), e os contêineres de exemplo
    // não têm certificado válido — "Usar quando o servidor oferecer" (SQL Server: "Obrigatória", certificado próprio).
    const baseConfig = () => ({ engine, host: target.host, port: target.port, database: target.database, username: target.readerUser, tls: { mode: engine === "SQLSERVER" ? ("REQUIRED" as const) : ("PREFERRED" as const) }, connectTimeoutMs: 5_000, queryTimeoutMs: 60_000 })
    let sourceId: string
    let employeesFeedId: string
    let measurementsFeedId: string

    beforeAll(async () => {
      await seedExternal(target, prefix)
    }, 240_000)

    it("testar conexão (sem salvar): ok somente leitura; senha errada, porta fechada, servidor mudo, banco inexistente e TLS com motivos claros", async () => {
      const ok = await request(app).post(api("/database/test")).send({ config: baseConfig(), password: target.readerPassword })
      expect(ok.status, JSON.stringify(ok.body)).toBe(200)
      expect(ok.body.data.health, JSON.stringify(ok.body)).toBe("HEALTHY")
      expect(ok.body.data.database.engineFound).toBe(engine)
      if (engine !== "SQLSERVER") expect(ok.body.data.database.readOnlyEnforced).toBe(true)
      expect(ok.body.data.database.objectsVisible, JSON.stringify(ok.body)).toBeGreaterThanOrEqual(3)
      // Testar não cria fonte nem guarda senha.
      expect((await db.query(`select 1 from data_sources where organization_id = $1 and name = $2`, [ORG, `TXDB ${engine}`])).rowCount).toBe(0)
      expect((await db.query(`select 1 from data_secrets s join data_sources d on d.id = s.source_id where d.organization_id = $1 and d.name = $2`, [ORG, `TXDB ${engine}`])).rowCount).toBe(0)

      const wrong = await request(app).post(api("/database/test")).send({ config: baseConfig(), password: "senha-errada-txdb-123" })
      expect(wrong.body.data, JSON.stringify(wrong.body)).toMatchObject({ health: "ERROR", errorCode: "DATA_SOURCE_AUTH_FAILED" })
      expect(JSON.stringify(wrong.body)).not.toContain("senha-errada-txdb-123")

      const closed = await request(app).post(api("/database/test")).send({ config: { ...baseConfig(), port: 1 }, password: target.readerPassword })
      expect(closed.body.data.errorCode, JSON.stringify(closed.body)).toBe("DATA_SOURCE_UNREACHABLE")

      // Servidor que aceita a conexão e nunca responde → tempo-limite de conexão.
      const silent = net.createServer(() => {})
      await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve))
      const silentPort = (silent.address() as net.AddressInfo).port
      const timeout = await request(app).post(api("/database/test")).send({ config: { ...baseConfig(), port: silentPort, connectTimeoutMs: 1_500 }, password: target.readerPassword })
      silent.close()
      expect(timeout.body.data.errorCode, JSON.stringify(timeout.body)).toBe("DATA_SOURCE_TIMEOUT")

      const missing = await request(app).post(api("/database/test")).send({ config: { ...baseConfig(), database: "banco_que_nao_existe_txdb" }, password: target.readerPassword })
      expect(missing.body.data.errorCode, JSON.stringify(missing.body)).toBe("DATA_SOURCE_NOT_FOUND")

      const tls = await request(app).post(api("/database/test")).send({ config: { ...baseConfig(), tls: { mode: "VERIFY_FULL" } }, password: target.readerPassword })
      expect(tls.body.data.errorCode, JSON.stringify(tls.body)).toBe("DATA_SOURCE_TLS_FAILED")
    }, 120_000)

    it("criar a conexão, descobrir tabelas/visões com permissão e descrever colunas — senha nunca volta", async () => {
      const created = await request(app).post(api("/sources")).send({ name: `TXDB ${engine}`, config: { kind: "DATABASE", database: baseConfig() }, secrets: { password: target.readerPassword } })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      sourceId = created.body.data.id
      expect(created.body.data.secrets).toEqual([expect.objectContaining({ purpose: "DATABASE_PASSWORD" })])
      expect(JSON.stringify(created.body)).not.toContain(target.readerPassword)

      const tested = await request(app).post(api(`/sources/${sourceId}/test-connection`))
      expect(tested.body.data.health, JSON.stringify(tested.body)).toBe("HEALTHY")

      const objects = await request(app).get(api(`/sources/${sourceId}/database/objects`))
      expect(objects.status).toBe(200)
      const names = objects.body.data.objects.filter((object: { schema: string }) => object.schema === target.schema).map((object: { name: string }) => object.name)
      expect(names).toEqual(expect.arrayContaining(["colaboradores", "medicoes", "eventos_sem_chave"]))
      expect(names).not.toContain("segredo_rh")
      const searched = await request(app).get(api(`/sources/${sourceId}/database/objects?search=medic`))
      expect(searched.body.data.objects.every((object: { name: string }) => object.name.includes("medic"))).toBe(true)

      const columns = await request(app).get(api(`/sources/${sourceId}/database/columns?schema=${target.schema}&name=medicoes`))
      expect(columns.status).toBe(200)
      expect(columns.body.data.primaryKey).toEqual(["id"])
      const byName = Object.fromEntries(columns.body.data.columns.map((column: { name: string }) => [column.name, column]))
      expect(byName.atualizado_em).toMatchObject({ category: "DATETIME", cursorEligible: true })
      expect(byName.id).toMatchObject({ category: "INTEGER", keyEligible: true })

      const denied = await request(app).get(api(`/sources/${sourceId}/database/columns?schema=${target.schema}&name=segredo_rh`))
      expect(denied.status).toBe(422)
      expect(["DATA_SOURCE_PERMISSION_DENIED", "DATA_SCHEMA_CHANGED"]).toContain(denied.body.error.code)

      const otherOrg = await request(otherApp).get(api(`/sources/${sourceId}/database/objects`))
      expect(otherOrg.status).toBe(404)
    }, 120_000)

    it("colaboradores: amostra → mapeamento sugerido → prévia → ativar → importar (gestor na mesma carga) → sincronizar de novo não duplica → incremental", async () => {
      const connectorConfig = { connector: "DATABASE", database: { object: { schema: target.schema, name: "colaboradores", kind: "TABLE" }, sync: { mode: "INCREMENTAL", cursorColumn: "atualizado_em", keyColumns: ["matricula"] } } }
      const sample = await request(app).post(api(`/sources/${sourceId}/sample`)).send({ connectorConfig, contractKey: "EMPLOYEES" })
      expect(sample.status).toBe(200)
      expect(sample.body.data.records.length).toBe(20)
      const suggested = Object.fromEntries(sample.body.data.suggestedMapping.fields.map((field: { target: string; source: string }) => [field.target, field.source]))
      expect(suggested).toMatchObject({ externalEmployeeId: "matricula", name: "nome", role: "nivel", reportsToExternalId: "gestor_matricula" })
      const mapping = sample.body.data.suggestedMapping
      const preview = await request(app).post(api(`/sources/${sourceId}/preview`)).send({ contractKey: "EMPLOYEES", mapping, sample: { columns: sample.body.data.columns, records: sample.body.data.records } })
      expect(preview.body.data.mappingProblems).toEqual([])

      // Nada foi escrito no domínio por amostra/prévia.
      expect((await db.query(`select 1 from people where organization_id = $1 and matricula like $2`, [ORG, `${prefix}-%`])).rowCount).toBe(0)

      const feed = await request(app).post(api(`/sources/${sourceId}/feeds`)).send({ feedKey: "colaboradores", name: "TXDB Colaboradores", contractKey: "EMPLOYEES", connectorConfig, mapping, cadence: { kind: "MANUAL" } })
      expect(feed.status).toBe(201)
      employeesFeedId = feed.body.data.id
      expect((await request(app).post(api(`/feeds/${employeesFeedId}/status`)).send({ action: "ACTIVATE" })).status).toBe(200)
      expect((await request(app).post(api(`/feeds/${employeesFeedId}/sync`))).status).toBe(202)
      let runs = await drain(employeesFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: OPERATORS + 1, recordsInserted: OPERATORS + 1 })
      const supervisor = await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = $2`, [ORG, `${prefix}-SUP`])
      const led = await db.query<{ n: number }>(`select count(*)::int n from people where reports_to_id = $1`, [supervisor.rows[0]!.id])
      expect(led.rows[0]!.n).toBe(OPERATORS)

      // De novo: incremental em dia → nada lido.
      await request(app).post(api(`/feeds/${employeesFeedId}/sync`))
      runs = await drain(employeesFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: 0 })

      // O cliente altera uma linha (e o campo de atualização) → só ela é lida.
      await adminExec(target, `update ${table(target, "colaboradores")} set nome = 'Operador Renomeado', atualizado_em = '2026-12-01 10:00:00.000001' where matricula = '${prefix}-0007'`)
      await request(app).post(api(`/feeds/${employeesFeedId}/sync`))
      runs = await drain(employeesFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: 1, recordsUpdated: 1 })
      expect((await db.query<{ name: string }>(`select name from people where organization_id = $1 and matricula = $2`, [ORG, `${prefix}-0007`])).rows[0]!.name).toBe("Operador Renomeado")
    }, 180_000)

    it("medições: páginas de 100, 1.000 linhas por carga → continuações automáticas, empates resolvidos, nenhuma linha pulada nem relida", async () => {
      const connectorConfig = { connector: "DATABASE", database: { object: { schema: target.schema, name: "medicoes", kind: "TABLE" }, sync: { mode: "INCREMENTAL", cursorColumn: "atualizado_em", keyColumns: ["id"] }, batchSize: 100, maxRowsPerRun: 1000 } }
      const mapping = { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "indicatorCode", source: "indicador", transforms: [] }, { target: "date", source: "data_referencia", transforms: [] }, { target: "value", source: "valor", transforms: [] }] }
      const feed = await request(app).post(api(`/sources/${sourceId}/feeds`)).send({ feedKey: "medicoes", name: "TXDB Medições", contractKey: "INDICATOR_MEASUREMENTS", connectorConfig, mapping, cadence: { kind: "MANUAL" } })
      expect(feed.status).toBe(201)
      measurementsFeedId = feed.body.data.id
      await request(app).post(api(`/feeds/${measurementsFeedId}/status`)).send({ action: "ACTIVATE" })
      await request(app).post(api(`/feeds/${measurementsFeedId}/sync`))
      const runs = await drain(measurementsFeedId)
      expect(runs.map((run) => run.triggerKind)).toEqual(["MANUAL", "CONTINUATION", "CONTINUATION"])
      expect(runs.every((run) => run.status === "COMPLETED")).toBe(true)
      expect(runs.map((run) => run.recordsReceived)).toEqual([1000, 1000, 500])
      // Nenhuma releitura (diferenças de 1 µs no campo de atualização) e nenhuma linha pulada.
      expect(runs.reduce((sum, run) => sum + run.recordsUnchanged, 0)).toBe(0)
      expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(OPERATORS * DAYS)
      const checkpoint = (await findFeed(db, ORG, measurementsFeedId))!.checkpoint as { position: string[]; reachedEnd: boolean }
      expect(checkpoint.reachedEnd).toBe(true)
      expect(checkpoint.position[1]).toBe(String(OPERATORS * DAYS))
      // Linhagem e conteúdo bruto retido.
      const lineage = await db.query<{ n: number }>(`select count(*)::int n from data_lineage where feed_id = $1`, [measurementsFeedId])
      expect(lineage.rows[0]!.n).toBe(OPERATORS * DAYS)
    }, 240_000)

    it("sem chave de desempate: 150 linhas com o mesmo instante (maior que a página) entram inteiras, sem pular nem repetir", async () => {
      const connectorConfig = { connector: "DATABASE", database: { object: { schema: target.schema, name: "eventos_sem_chave", kind: "TABLE" }, sync: { mode: "INCREMENTAL", cursorColumn: "atualizado_em", keyColumns: [] }, batchSize: 100 } }
      const mapping = { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "indicatorCode", source: "indicador", transforms: [] }, { target: "date", source: "data_referencia", transforms: [] }, { target: "value", source: "valor", transforms: [] }] }
      const feed = await request(app).post(api(`/sources/${sourceId}/feeds`)).send({ feedKey: "eventos", name: "TXDB Eventos", contractKey: "INDICATOR_MEASUREMENTS", connectorConfig, mapping, cadence: { kind: "MANUAL" } })
      await request(app).post(api(`/feeds/${feed.body.data.id}/status`)).send({ action: "ACTIVATE" })
      await request(app).post(api(`/feeds/${feed.body.data.id}/sync`))
      const runs = await drain(feed.body.data.id)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: 250, recordsInserted: 250, recordsUnchanged: 0 })
      expect(await measurementCount(prefix, TIE_INDICATOR)).toBe(250)
    }, 120_000)

    it("queda de rede no meio: retentativa retoma do último checkpoint confirmado (nada duplicado, nada perdido)", async () => {
      const admin = await (await import("./external-database-admin.js")).openAdmin(target, target.database)
      const rows: (string | number | null)[][] = []
      for (let index = 1; index <= 400; index += 1) rows.push([10_000 + index, `${prefix}-${String((index % OPERATORS) + 1).padStart(4, "0")}`, SUM_INDICATOR, dayText(200 + Math.floor(index / OPERATORS)), 1, laterInstant("2026-12-02", index)])
      await insertRows(admin, target, "medicoes", ["id", "matricula", "indicador", "data_referencia", "valor", "atualizado_em"], rows)
      await admin.close()
      flaky.pageQueries = 0
      flaky.failOnPageQuery = 3 // cai na 3ª página
      await request(app).post(api(`/feeds/${measurementsFeedId}/sync`))
      // A primeira tentativa aplica 2 páginas e cai; a carga volta para a fila (erro transitório) com o checkpoint em 200.
      for (let attempt = 0; attempt < 50; attempt += 1) {
        await processQueuedRuns(ctx, 10)
        const queued = await db.query<{ attempts: number }>(`select attempts from data_ingestion_runs where feed_id = $1 and status = 'QUEUED' and attempts >= 1 order by created_at desc limit 1`, [measurementsFeedId])
        if (queued.rows[0]) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const mid = (await findFeed(db, ORG, measurementsFeedId))!.checkpoint as { position: string[]; reachedEnd: boolean }
      expect(mid.reachedEnd).toBe(false)
      expect(mid.position[1]).toBe(String(10_200))
      expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(OPERATORS * DAYS + 200)
      // Retentativa já: retoma da página 3.
      await db.query(`update data_ingestion_runs set next_attempt_at = now() where feed_id = $1 and status = 'QUEUED'`, [measurementsFeedId])
      const runs = await drain(measurementsFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: 400, recordsInserted: 400, recordsUnchanged: 0 })
      expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(OPERATORS * DAYS + 400)
    }, 180_000)

    it("falha ao aplicar uma página: a página inteira é desfeita, o checkpoint NÃO avança e a próxima carga continua dela", async () => {
      await db.query(`create or replace function txdb_fail_apply() returns trigger language plpgsql as $$ begin if new.value = 777777 then raise exception 'falha simulada ao aplicar (prova)'; end if; return new; end $$`)
      await db.query(`create trigger txdb_fail_apply before insert or update on indicator_measurements for each row execute function txdb_fail_apply()`)
      const admin = await (await import("./external-database-admin.js")).openAdmin(target, target.database)
      const rows: (string | number | null)[][] = []
      for (let index = 1; index <= 300; index += 1) rows.push([20_000 + index, `${prefix}-${String((index % OPERATORS) + 1).padStart(4, "0")}`, SUM_INDICATOR, dayText(400 + Math.floor(index / OPERATORS)), index === 150 ? 777777 : 1, laterInstant("2026-12-03", index)])
      await insertRows(admin, target, "medicoes", ["id", "matricula", "indicador", "data_referencia", "valor", "atualizado_em"], rows)
      await admin.close()
      await request(app).post(api(`/feeds/${measurementsFeedId}/sync`))
      let runs = await drain(measurementsFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "FAILED" })
      const stopped = (await findFeed(db, ORG, measurementsFeedId))!.checkpoint as { position: string[] }
      expect(stopped.position[1]).toBe(String(20_100)) // página 1 aplicada; a página 2 (com a linha 150) foi inteira desfeita
      expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(OPERATORS * DAYS + 400 + 100)
      await db.query(`drop trigger txdb_fail_apply on indicator_measurements`)
      await request(app).post(api(`/feeds/${measurementsFeedId}/sync`))
      runs = await drain(measurementsFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: 200, recordsInserted: 200, recordsUnchanged: 0 })
      expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(OPERATORS * DAYS + 700)
    }, 180_000)

    it("trava real na origem: a carga agendada esgota o tempo sem avançar, espera a próxima tentativa e termina quando a trava sai", async () => {
      const connectionHealth = async () => (await db.query<{ connection_health: string }>(`select connection_health from data_sources where id = $1`, [sourceId])).rows[0]!.connection_health
      const before = await measurementCount(prefix, SUM_INDICATOR)
      // Como o job do cliente: segura a tabela inteira até terminar.
      const lockTable = target.engine === "POSTGRESQL" ? `begin; lock table ${table(target, "medicoes")} in access exclusive mode` : target.engine === "SQLSERVER" ? `begin tran; select top 1 id from ${table(target, "medicoes")} with (tablockx, holdlock)` : `lock tables ${table(target, "medicoes")} write`
      const unlockTable = target.engine === "POSTGRESQL" ? "rollback" : target.engine === "SQLSERVER" ? "if @@trancount > 0 rollback" : "unlock tables"
      const job = await openAdmin(target, target.database)
      const rows: (string | number | null)[][] = []
      for (let index = 1; index <= 10; index += 1) rows.push([30_000 + index, `${prefix}-${String(index + 1).padStart(4, "0")}`, SUM_INDICATOR, dayText(500), 1, laterInstant("2026-12-04", index)])
      await insertRows(job, target, "medicoes", ["id", "matricula", "indicador", "data_referencia", "valor", "atualizado_em"], rows)
      const checkpoint = (await findFeed(db, ORG, measurementsFeedId))!.checkpoint
      // Tempo-limite curto só para a prova ser rápida. No SQL Server fica acima dos 10 s de LOCK_TIMEOUT: a falha vem do bloqueio (erro 1222), não do cliente.
      const setQueryTimeout = (milliseconds: number) => db.query(`update data_sources set config = jsonb_set(config, '{database,queryTimeoutMs}', to_jsonb($2::int)) where id = $1`, [sourceId, milliseconds])
      await setQueryTimeout(target.engine === "SQLSERVER" ? 20_000 : 2_000)
      await job.exec(lockTable)
      try {
        const feed = (await findFeed(db, ORG, measurementsFeedId))!
        const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "SCHEDULE", requestedBy: null })
        await processQueuedRuns(ctx, 10)
        const waiting = await db.query<{ status: string; attempts: number; error_code: string; seconds: number }>(`select status, attempts, error_code, extract(epoch from next_attempt_at - now())::float8 seconds from data_ingestion_runs where id = $1`, [run.id])
        expect(waiting.rows[0]).toMatchObject({ status: "QUEUED", attempts: 1, error_code: "DATA_SOURCE_TIMEOUT" })
        expect(waiting.rows[0]!.seconds).toBeGreaterThan(0)
        expect(await connectionHealth()).toBe("ERROR")
        expect((await findFeed(db, ORG, measurementsFeedId))!.checkpoint).toEqual(checkpoint)
        expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(before)
      } finally {
        await job.exec(unlockTable)
        await job.close()
        await setQueryTimeout(baseConfig().queryTimeoutMs)
      }
      await db.query(`update data_ingestion_runs set next_attempt_at = now() where feed_id = $1 and status = 'QUEUED'`, [measurementsFeedId])
      const runs = await drain(measurementsFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", triggerKind: "SCHEDULE", recordsReceived: 10, recordsInserted: 10 })
      expect(await measurementCount(prefix, SUM_INDICATOR)).toBe(before + 10)
      expect(await connectionHealth()).toBe("HEALTHY")
    }, 180_000)

    it("carga interrompida (processo caiu): a posse vence e o tick devolve a carga para a fila, que termina", async () => {
      await adminExec(target, `update ${table(target, "colaboradores")} set atualizado_em = '2026-12-05 10:00:00.000001' where matricula = '${prefix}-0008'`)
      const queued = await request(app).post(api(`/feeds/${employeesFeedId}/sync`))
      // Simula: o worker pegou a carga e o processo morreu no meio (estado "em andamento" com posse vencida).
      await db.query(`update data_ingestion_runs set status = 'APPLYING', claimed_until = now() - interval '1 minute', attempts = 1 where id = $1 and status = 'QUEUED'`, [queued.body.data.id])
      const recovered = await recoverInterruptedRuns(ctx)
      expect(recovered.requeued).toBeGreaterThanOrEqual(1)
      const runs = await drain(employeesFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: 1 })
    }, 120_000)

    it("mudança de esquema e permissão revogada viram erro claro (feed degradado); reiniciar a leitura relê tudo sem duplicar", async () => {
      const renamed = engine === "SQLSERVER" ? `exec sp_rename '${target.schema}.colaboradores.nome', 'nome_completo', 'COLUMN'` : engine === "POSTGRESQL" ? `alter table ${table(target, "colaboradores")} rename column nome to nome_completo` : `alter table ${table(target, "colaboradores")} rename column nome to nome_completo`
      await adminExec(target, renamed)
      await adminExec(target, `update ${table(target, "colaboradores")} set atualizado_em = '2026-12-06 10:00:00.000001' where matricula = '${prefix}-0009'`)
      await request(app).post(api(`/feeds/${employeesFeedId}/sync`))
      let runs = await drain(employeesFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "FAILED", errorCode: "DATA_SCHEMA_CHANGED" })
      expect((await findFeed(db, ORG, employeesFeedId))!.status).toBe("DEGRADED")
      const back = engine === "SQLSERVER" ? `exec sp_rename '${target.schema}.colaboradores.nome_completo', 'nome', 'COLUMN'` : `alter table ${table(target, "colaboradores")} rename column nome_completo to nome`
      await adminExec(target, back)
      await request(app).post(api(`/feeds/${employeesFeedId}/status`)).send({ action: "RESUME" })

      const revoke = engine === "POSTGRESQL" ? `revoke select on ${table(target, "colaboradores")} from ${target.readerUser}` : engine === "SQLSERVER" ? `deny select on ${table(target, "colaboradores")} to [${target.readerUser}]` : `revoke select on \`${target.database}\`.colaboradores from '${target.readerUser}'@'%'; flush privileges`
      await adminExec(target, revoke)
      await request(app).post(api(`/feeds/${employeesFeedId}/sync`))
      runs = await drain(employeesFeedId)
      expect(runs.at(-1)!.status).toBe("FAILED")
      expect(["DATA_SOURCE_PERMISSION_DENIED", "DATA_SCHEMA_CHANGED"]).toContain(runs.at(-1)!.errorCode)
      const regrant = engine === "POSTGRESQL" ? `grant select on ${table(target, "colaboradores")} to ${target.readerUser}` : engine === "SQLSERVER" ? `revoke select on ${table(target, "colaboradores")} to [${target.readerUser}]` : `grant select on \`${target.database}\`.colaboradores to '${target.readerUser}'@'%'; flush privileges`
      await adminExec(target, regrant)
      await request(app).post(api(`/feeds/${employeesFeedId}/status`)).send({ action: "RESUME" })

      // Reiniciar a leitura: relê as 26 linhas — nenhuma duplicada (upsert pela matrícula).
      expect((await request(app).post(api(`/feeds/${employeesFeedId}/checkpoint/reset`))).status).toBe(200)
      await request(app).post(api(`/feeds/${employeesFeedId}/sync`))
      runs = await drain(employeesFeedId)
      expect(runs.at(-1)).toMatchObject({ status: "COMPLETED", recordsReceived: OPERATORS + 1, recordsInserted: 0 })
      expect((await db.query<{ n: number }>(`select count(*)::int n from people where organization_id = $1 and matricula like $2`, [ORG, `${prefix}-%`])).rows[0]!.n).toBe(OPERATORS + 1)
    }, 180_000)

    it("a senha do banco não aparece em resposta, auditoria, carga nem log; outra organização não vê nada", async () => {
      const detail = await request(app).get(api(`/sources/${sourceId}`))
      const runs = await request(app).get(api(`/runs?sourceId=${sourceId}&pageSize=50`))
      const audit = await db.query<{ payload: unknown }>(`select payload from audit_logs where organization_id = $1 and entity_id = $2`, [ORG, sourceId])
      const runRows = await db.query(`select error_message, stages from data_ingestion_runs where source_id = $1`, [sourceId])
      const everything = JSON.stringify([detail.body, runs.body, audit.rows, runRows.rows, logger.entries])
      expect(everything).not.toContain(target.readerPassword)
      const stored = await db.query<{ ciphertext: Buffer }>(`select ciphertext from data_secrets where source_id = $1 and revoked_at is null`, [sourceId])
      expect(stored.rows[0]!.ciphertext.toString("utf8")).not.toContain(target.readerPassword)
      expect((await request(otherApp).get(api(`/sources/${sourceId}`))).status).toBe(404)
      expect((await request(otherApp).post(api(`/feeds/${measurementsFeedId}/sync`))).status).toBe(404)
    }, 60_000)
  })
})
