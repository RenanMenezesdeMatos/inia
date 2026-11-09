import express from "express"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createIndicatorDefinition } from "../../indicators/application/indicator-definition-service.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { processQueuedRuns } from "../application/run-service.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"
import { DriverExternalDatabaseConnector } from "../infrastructure/external-databases/external-database-connector.js"
import { createDataHubRouter } from "../presentation/data-hub-router.js"
import { adminTargets, literal, openAdmin, type ExternalAdmin, type ProofTarget } from "./external-database-admin.js"
import { CapturingLogger } from "./fakes.js"
import { loadClientTablesSpec, type ClientTablesSpec, type SpecTable } from "./client-tables-spec.js"

/**
 * PROVA em SQL Server real: o script da Wiki `/wiki/central-de-dados/banco-do-cliente` funciona como está escrito.
 *   docker compose --profile external-example-sqlserver up -d --wait example-sqlserver   (na raiz, com as senhas exportadas)
 *   INIA_DB_PROOF=1 INIA_EXTERNAL_DB_PROOF=1 NODE_ENV=test npx vitest run client-tables-proof
 * Roda o script e o usuário de leitura como estão na página, grava os exemplos da própria página e carrega tudo pelas rotas da
 * tela, na ordem da página, lendo com o usuário de leitura. Banco e organização próprios, apagados no fim.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1" && process.env.INIA_EXTERNAL_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000c091"
const OPERATION = "de00ee00-0000-4000-8000-00000000c092"
const DATABASE = "inia_tabelas_prova"
const FINISHED = new Set(["COMPLETED", "PARTIAL", "FAILED", "CANCELLED"])

let spec: ClientTablesSpec
let target: ProofTarget
let pool: pg.Pool
let ctx: DataHubContext
let app: express.Express
let sourceId: string
const api = (path: string) => `/api/v1/admin/data-hub${path}`

/** O pior caminho até o banco: todas as quebras de linha perdidas. O script precisa rodar mesmo assim. */
const withoutLineBreaks = (script: string) => script.replace(/\r?\n/g, "")

async function cleanupInia() {
  for (const table of ["audit_logs", "data_sources", "data_raw_objects", "indicator_measurements", "employee_indicator_performance", "employee_prv_performance", "goals", "interaction_flags", "transcripts", "interactions", "employee_status_periods", "employee_schedule_days", "employee_schedule_exceptions", "employee_work_shifts"]) {
    await pool.query(`delete from ${table} where organization_id = $1`, [ORG])
  }
  await pool.query(`update people set reports_to_id = null where organization_id = $1`, [ORG])
  for (const table of ["people", "subteams", "teams", "channel_flags", "indicator_definitions", "operations"]) await pool.query(`delete from ${table} where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

async function dropExternal(admin: ExternalAdmin) {
  await admin.exec(`if db_id('${DATABASE}') is not null begin alter database [${DATABASE}] set single_user with rollback immediate; drop database [${DATABASE}]; end`)
  await admin.exec(`if exists (select 1 from sys.server_principals where name = '${spec.CLIENT_READER_LOGIN}') drop login [${spec.CLIENT_READER_LOGIN}]`)
}

function insertExample(table: SpecTable, values: Record<string, string | number | boolean | null> = {}): string {
  const columns = spec.columnsOf(table)
  const sqlValue = (name: string, example: string | number | boolean | null) => {
    const value = name in values ? values[name]! : example
    if (value === true) return "1"
    if (value === false) return "0"
    return literal(target, value)
  }
  return `insert into ${spec.CLIENT_SCHEMA}.${table.name} (${columns.map((column) => column.name).join(", ")}) values (${columns.map((column) => sqlValue(column.name, column.example)).join(", ")})`
}

/** A carga desta tabela terminou como? */
async function loadTable(table: SpecTable, manual: Record<string, string> = {}) {
  const connectorConfig = { connector: "DATABASE", database: { object: { schema: spec.CLIENT_SCHEMA, name: table.name, kind: "TABLE" }, sync: { mode: "INCREMENTAL", cursorColumn: spec.UPDATED_AT_COLUMN, keyColumns: table.readKeys } } }
  const sample = await request(app).post(api(`/sources/${sourceId}/sample`)).send({ connectorConfig, contractKey: table.contractKey })
  expect(sample.status, JSON.stringify(sample.body)).toBe(200)
  const suggested = sample.body.data.suggestedMapping.fields as { target: string; source: string; transforms: unknown[] }[]
  const mapping = { fields: [...suggested, ...Object.entries(manual).map(([field, source]) => ({ target: field, source, transforms: [] }))] }
  const feed = await request(app).post(api(`/sources/${sourceId}/feeds`)).send({ feedKey: `tabela-${table.name}`.replace(/_/g, "-"), name: `Tabela ${table.name}`, contractKey: table.contractKey, connectorConfig, mapping, cadence: { kind: "MANUAL" } })
  expect(feed.status, JSON.stringify(feed.body)).toBe(201)
  const activated = await request(app).post(api(`/feeds/${feed.body.data.id}/status`)).send({ action: "ACTIVATE" })
  expect(activated.status, JSON.stringify(activated.body)).toBe(200)
  const queued = await request(app).post(api(`/feeds/${feed.body.data.id}/sync`))
  expect(queued.status, JSON.stringify(queued.body)).toBe(202)
  for (let round = 0; round < 100; round += 1) {
    await processQueuedRuns(ctx, 10)
    const run = await pool.query<{ status: string; records_received: number; records_rejected: number; error_message: string | null }>(`select status, records_received, records_rejected, error_message from data_ingestion_runs where id = $1`, [queued.body.data.id])
    if (FINISHED.has(run.rows[0]!.status)) return run.rows[0]!
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`A carga de ${table.name} não terminou a tempo.`)
}

describe.skipIf(!ENABLED)("Tabelas no banco do cliente — o script da Wiki em SQL Server real", () => {
  beforeAll(async () => {
    spec = await loadClientTablesSpec()
    target = { ...adminTargets().SQLSERVER, database: DATABASE, schema: spec.CLIENT_SCHEMA, readerUser: spec.CLIENT_READER_LOGIN }
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 5 })
    await cleanupInia()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Tabelas do cliente', 'tabelas-c091')`, [ORG])
    await pool.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'Operação da prova', 'America/Fortaleza')`, [OPERATION, ORG])
    const actor = await pool.query<{ id: string }>(`insert into people (organization_id, name, role) values ($1, 'Admin da prova', 'SUPERVISOR') returning id`, [ORG])
    const db = pool as unknown as Database
    await createIndicatorDefinition(db, ORG, { code: "TMA", name: "TMA (prova)", unit: "SECONDS", desiredDirection: "LOWER", dailySupported: true, operationalAggregation: "WEIGHTED_AVERAGE", officialClosureSupported: true })
    await pool.query(`insert into channel_flags (organization_id, channel, flag_name, value_type) values ($1, 'VOICE', 'rechamada', 'BOOLEAN')`, [ORG])

    const overrides = { logger: new CapturingLogger(), databases: new DriverExternalDatabaseConnector(), secrets: new PgAesSecretStore(db), wakeWorker: () => undefined }
    ctx = createDataHubContext(db, overrides)
    app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.user = { sub: "x", personId: actor.rows[0]!.id, organizationId: ORG, role: "ADMIN", name: "Admin", email: "a@b", avatarUrl: null, jobTitle: null, teamId: null, teamName: null } as never
      next()
    })
    app.use("/api/v1/admin/data-hub", createDataHubRouter(db, overrides))
    app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next
      if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
      return res.status(error.name === "ZodError" ? 400 : 500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
    })

    const master = await openAdmin(target, "master")
    try {
      await dropExternal(master)
      // A menor versão que a página declara: SQL Server 2016.
      await master.exec(`create database [${DATABASE}]; alter database [${DATABASE}] set compatibility_level = 130;`)
    } finally {
      await master.close()
    }
  }, 120_000)

  afterAll(async () => {
    if (!pool) return
    await cleanupInia()
    await pool.end()
    const master = await openAdmin(target, "master")
    await dropExternal(master)
    await master.close()
  }, 60_000)

  it("o script e o usuário de leitura rodam como estão na página, mesmo sem nenhuma quebra de linha", async () => {
    const admin = await openAdmin(target, DATABASE)
    try {
      await admin.exec(withoutLineBreaks(spec.clientTablesScript()))
      await admin.exec(withoutLineBreaks(spec.clientReaderScript()).replace("TROQUE_POR_UMA_SENHA_FORTE", target.readerPassword))
      // Uma tabela fora do schema da INIA: o usuário de leitura não pode enxergar.
      await admin.exec("create table dbo.fora_do_schema (id int primary key)")
    } finally {
      await admin.close()
    }
  }, 60_000)

  it("o usuário de leitura enxerga só as tabelas do schema da INIA", async () => {
    const created = await request(app).post(api("/sources")).send({ name: "Banco do cliente", config: { kind: "DATABASE", database: { engine: "SQLSERVER", host: target.host, port: target.port, database: DATABASE, username: spec.CLIENT_READER_LOGIN, tls: { mode: "REQUIRED" }, connectTimeoutMs: 5_000, queryTimeoutMs: 60_000 } }, secrets: { password: target.readerPassword } })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    sourceId = created.body.data.id
    const tested = await request(app).post(api(`/sources/${sourceId}/test-connection`))
    expect(tested.body.data.health, JSON.stringify(tested.body)).toBe("HEALTHY")
    const objects = await request(app).get(api(`/sources/${sourceId}/database/objects`))
    const seen = (objects.body.data.objects ?? objects.body.data) as { schema: string; name: string }[]
    expect(seen.map((object) => `${object.schema}.${object.name}`).sort()).toEqual(spec.CLIENT_TABLES.map((table) => `${spec.CLIENT_SCHEMA}.${table.name}`).sort())
  }, 60_000)

  it("os exemplos da página entram em todas as tabelas, na ordem da página, sem nenhuma rejeição", async () => {
    const admin = await openAdmin(target, DATABASE)
    try {
      for (const table of spec.CLIENT_TABLES) await admin.exec(insertExample(table))
      const employees = spec.CLIENT_TABLES.find((table) => table.name === "colaboradores")!
      // O gestor do exemplo também precisa existir, na mesma carga.
      await admin.exec(insertExample(employees, { matricula: "SUP-0042", nome: "Carlos Menezes", nivel: "SUPERVISOR", gestor_matricula: null, email: null }))
    } finally {
      await admin.close()
    }
    const manual: Record<string, Record<string, string>> = { colaboradores: { currentStatus: "situacao_funcional" }, ausencias: { type: "tipo" } }
    for (const table of spec.CLIENT_TABLES) {
      const run = await loadTable(table, manual[table.name])
      const expected = table.name === "colaboradores" ? 2 : 1
      expect({ table: table.name, ...run }).toMatchObject({ table: table.name, status: "COMPLETED", records_received: expected, records_rejected: 0 })
    }
  }, 180_000)

  it("os valores ficam gravados como a página explica", async () => {
    const one = async <Row extends pg.QueryResultRow>(sql: string) => (await pool.query<Row>(sql, [ORG])).rows[0]!
    expect(await one(`select value::float8 as value, numerator::float8 as numerator, denominator::float8 as denominator, sample_count, granularity, to_char(period_start at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI') as period_start, to_char(period_end at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI') as period_end from indicator_measurements where organization_id = $1`)).toEqual({ value: 450, numerator: 8100, denominator: 18, sample_count: 18, granularity: "DAILY", period_start: "2026-09-15 00:00", period_end: "2026-09-16 00:00" })
    expect(await one(`select reason, sub_reason, to_char(started_at at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI:SS') as started, to_char(ended_at at time zone 'America/Fortaleza', 'YYYY-MM-DD HH24:MI:SS') as ended from interactions where organization_id = $1`)).toEqual({ reason: "Fatura", sub_reason: "Segunda via", started: "2026-09-15 14:02:10", ended: "2026-09-15 14:11:42" })
    expect(await one(`select t.version, t.content from transcripts t join interactions i on i.id = t.interaction_id where i.organization_id = $1`)).toEqual({ version: 1, content: "Operador: Bom dia, em que posso ajudar?\nCliente: Preciso da segunda via da minha fatura." })
    expect(await one(`select f.value_boolean from interaction_flags f join interactions i on i.id = f.interaction_id where i.organization_id = $1`)).toEqual({ value_boolean: true })
    expect(await one(`select reference_period, value::float8 as value, numerator::float8 as numerator, denominator::float8 as denominator, quartile from employee_indicator_performance where organization_id = $1`)).toMatchObject({ value: 468, numerator: 380016, denominator: 812, quartile: "Q2" })
    expect(await one(`select count(*)::int as n from people where organization_id = $1 and matricula in ('OP-10234', 'SUP-0042')`)).toEqual({ n: 2 })
    expect(await one(`select m.name as gestor from people p join people m on m.id = p.reports_to_id where p.organization_id = $1 and p.matricula = 'OP-10234'`)).toEqual({ gestor: "Carlos Menezes" })
    expect(await one(`select count(*)::int as n from employee_schedule_days d join people p on p.id = d.person_id where p.organization_id = $1`)).toEqual({ n: 1 })
    expect(await one(`select count(*)::int as n from employee_schedule_exceptions e join people p on p.id = e.person_id where p.organization_id = $1`)).toEqual({ n: 1 })
    expect(await one(`select count(*)::int as n from employee_work_shifts s join people p on p.id = s.person_id where p.organization_id = $1`)).toEqual({ n: 1 })
    expect(await one(`select count(*)::int as n from employee_status_periods s join people p on p.id = s.person_id where p.organization_id = $1 and s.status = 'FERIAS'`)).toEqual({ n: 1 })
  })
})
