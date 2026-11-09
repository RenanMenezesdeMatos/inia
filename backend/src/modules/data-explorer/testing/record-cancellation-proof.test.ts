/**
 * PROVA contra o banco de teste real: cancelar e reativar registros pela Consultar dados, com rotas, guard, carga e PostgreSQL de verdade.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run record-cancellation-proof --no-file-parallelism
 * Duas organizações próprias, apagadas no fim. Nenhuma chamada de IA nem rede externa.
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp, type CreateAppOptions } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import type { DataHubContext } from "../../data-hub/application/data-hub-context.js"
import type { DataFeedRow } from "../../data-hub/application/records.js"
import type { DomainWriter, ValidRecord, WriteContext } from "../../data-hub/application/writers/domain-writer.js"
import { goalsWriter } from "../../data-hub/application/writers/master-data-writers.js"
import { indicatorMeasurementsWriter, officialIndicatorPerformanceWriter, prvPerformanceWriter } from "../../data-hub/application/writers/performance-writers.js"
import { loadIndicatorDependencies } from "../../indicators/application/indicator-dependencies.js"
import { loadIndicatorCanonicalContext } from "../../indicators/application/load-indicator-canonical-context.js"
import { runWorkflowTick } from "../../workflows/application/engine.js"
import { EXPLORER_LOCK_NAMESPACE } from "../application/read-only-session.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const API = "/api/v1/admin/data-explorer"
const RULES_API = "/api/v1/admin/indicator-rules/definitions"
const PASSWORD = "Prova@Cancelamento-2026"
const ORG_A = "ce00ee00-0000-4000-8000-0000000a0174"
const ORG_B = "ce00ee00-0000-4000-8000-0000000b0174"
const REASON = "Indicador cadastrado com a estratégia errada"
const WRITTEN_REASON = "Motivo-Escrito-A-Mao-que-nao-pode-ir-para-a-auditoria"
const ANY_FINGERPRINT = "0".repeat(64)

let pool: pg.Pool
const ids: Record<string, string> = {}
const insertId = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(`${sql} returning id`, params)).rows[0]!.id

async function cleanup() {
  for (const org of [ORG_A, ORG_B]) {
    for (const table of ["audit_logs", "data_ingestion_runs", "data_feeds", "data_sources", "evidences", "feedbacks", "supervision_cases", "workflow_enrollments", "workflow_versions", "workflows_all", "goals_all", "employee_prv_performance_all", "employee_indicator_performance_all", "indicator_measurements_all", "data_record_cancellations", "indicator_definitions_all", "analytics_operational_dirty", "analytics_versions", "access_role_assignments", "user_accounts", "people", "subteams", "teams", "operations"]) {
      if (table === "workflow_versions") {
        await pool.query(`update workflows_all set active_version_id = null where organization_id = $1`, [org])
        await pool.query(`delete from workflow_versions where workflow_id in (select id from workflows_all where organization_id = $1)`, [org])
      } else await pool.query(`delete from ${table} where organization_id = $1`, [org])
    }
    await pool.query(`delete from organizations where id = $1`, [org])
  }
}

async function seed() {
  const hash = await hashPassword(PASSWORD)
  await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova cancelamento A', 'prova-cancelamento-a'), ($2, 'Prova cancelamento B', 'prova-cancelamento-b')`, [ORG_A, ORG_B])
  const operationA = await insertId(`insert into operations (organization_id, name, timezone) values ($1, 'Operação', 'America/Sao_Paulo')`, [ORG_A])
  const operationB = await insertId(`insert into operations (organization_id, name, timezone) values ($1, 'Operação', 'America/Sao_Paulo')`, [ORG_B])
  ids.teamA = await insertId(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo A', 'GA')`, [ORG_A, operationA])
  const teamB = await insertId(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo B', 'GB')`, [ORG_B, operationB])
  const person = (key: string, org: string, team: string | null, matricula: string, role = "OPERATOR") => insertId(`insert into people (organization_id, team_id, name, role, job_title, matricula, current_employment_status) values ($1, $2, $3, $4, 'Assistente', $5, 'EM_PRODUCAO')`, [org, team, `Pessoa ${key}`, role, matricula])
  const account = async (key: string, org: string, role?: string) => {
    ids[key] = await person(key, org, null, `M-${key}`, "ADMIN")
    const accountId = await insertId(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4)`, [org, ids[key], `${key}@prova-cancelamento.inia.local`, hash])
    if (role) await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())`, [org, accountId, role])
  }
  await account("geral", ORG_A, "ADMINISTRADOR_GERAL")
  await account("dados", ORG_A, "ADMINISTRADOR_DE_DADOS")
  await account("administrador", ORG_A, "ADMINISTRADOR")
  await account("semPapel", ORG_A)
  await account("geralB", ORG_B, "ADMINISTRADOR_GERAL")
  ids.op = await person("op", ORG_A, ids.teamA, "A-001")
  ids.op2 = await person("op2", ORG_A, ids.teamA, "A-002")
  ids.opB = await person("opB", ORG_B, teamB, "B-001")
}

type Agent = ReturnType<typeof request.agent>
async function login(app: ReturnType<typeof createApp>, key: string): Promise<Agent> {
  const agent = request.agent(app)
  const response = await agent.post("/api/v1/auth/login").send({ email: `${key}@prova-cancelamento.inia.local`, password: PASSWORD })
  expect(response.status, key).toBe(200)
  return agent
}

const newApp = (options: CreateAppOptions = {}) => createApp(pool as unknown as Database, { rateLimits: false, ...options })
const where = (...children: unknown[]) => ({ type: "group", logic: "AND", children })
const indicatorFilter = (code: string) => where({ type: "condition", column: "indicator", operator: "EQ", value: code })

async function createIndicator(code: string, overrides: { org?: string; unit?: string; aggregation?: string } = {}) {
  return insertId(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, daily_supported, official_closure_supported, operational_aggregation) values ($1, $2, $3, $4, 'LOWER', true, true, $5)`, [overrides.org ?? ORG_A, code, `Indicador ${code}`, overrides.unit ?? "SECONDS", overrides.aggregation ?? "SUM"])
}

const dayOf = (day: number) => `2026-03-${String(day).padStart(2, "0")}`

async function seedMeasurements(indicatorId: string, days: number[], options: { org?: string; subject?: string; value?: number; source?: string } = {}) {
  const rows: string[] = []
  for (const day of days) {
    rows.push(await insertId(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, $4, $5::date, $5::date + 1, $6, 'DAILY')`, [options.org ?? ORG_A, indicatorId, options.subject ?? ids.op, options.value ?? 300, dayOf(day), options.source ?? "PROVA"]))
  }
  return rows
}

const state = async (table: string, id: string) => (await pool.query<{ cancelled_at: Date | null; cancellation_id: string | null; value?: string }>(`select * from ${table}_all where id = $1`, [id])).rows[0]
const visible = async (table: string, id: string) => (await pool.query(`select 1 from ${table} where id = $1`, [id])).rowCount ?? 0

/** Prévia e confirmação, do jeito que a tela faz. */
async function cancel(agent: Agent, body: Record<string, unknown>, reason = REASON) {
  const preview = await agent.post(`${API}/cancellations/preview`).send(body)
  expect(preview.status, JSON.stringify(preview.body)).toBe(200)
  const response = await agent.post(`${API}/cancellations`).send({ ...body, reason, expectedFingerprint: preview.body.data.scopeFingerprint })
  return { preview: preview.body.data, response }
}

function writeContext(org: string, contractKey: string, sourceNamespace = "PROVA"): WriteContext {
  return { ctx: { db: pool } as unknown as DataHubContext, organizationId: org, timeZone: "America/Sao_Paulo", feed: { contractKey, contractVersion: 1 } as unknown as DataFeedRow, runId: "00000000-0000-4000-8000-000000000000", sourceNamespace }
}

/** Passa pelo `prepare` e pelo `apply` reais, como a carga da Central: quem rejeita e quem grava é o código de produção. */
async function load<T>(writer: DomainWriter<T>, contractKey: string, records: Record<string, unknown>[], org = ORG_A, source = "PROVA") {
  const context = writeContext(org, contractKey, source)
  const valid = records.map((record, index) => ({ recordNumber: index + 1, record, sourceRecordKey: null })) as unknown as ValidRecord[]
  const { ready, rejections } = await writer.prepare(context, valid)
  const client = await pool.connect()
  try {
    await client.query("begin")
    const result = await writer.apply(context, client, ready)
    await client.query("commit")
    return { ...result, rejections }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

const measurementRecord = (code: string, day: number, value: number, extra: Record<string, unknown> = {}) => ({ externalEmployeeId: "A-001", indicatorCode: code, date: dayOf(day), value, ...extra })

describe.skipIf(!ENABLED)("Cancelamento de registros — prova Postgres", () => {
  let app: ReturnType<typeof createApp>
  let geral: Agent
  let dados: Agent

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    await seed()
    app = newApp()
    geral = await login(app, "geral")
    dados = await login(app, "dados")
  }, 60_000)

  afterAll(async () => {
    if (pool) {
      await cleanup()
      await pool.end()
    }
  }, 60_000)

  describe("acesso", () => {
    const calls = (agent: Agent) => [
      () => agent.get(`${API}/cancellations?dataset=goals`),
      () => agent.post(`${API}/cancellations/preview`).send({ dataset: "goals", search: "abc" }),
      () => agent.post(`${API}/cancellations`).send({ dataset: "goals", search: "abc", reason: REASON, expectedFingerprint: ANY_FINGERPRINT }),
      () => agent.get(`${API}/cancellations/00000000-0000-4000-8000-000000000001/reactivation`),
      () => agent.post(`${API}/cancellations/00000000-0000-4000-8000-000000000001/reactivation`).send({ expectedRows: 1 }),
    ]

    it("sem sessão: 401 em todas as rotas", async () => {
      for (const call of calls(request.agent(app))) expect((await call()).status).toBe(401)
    })

    it.each(["administrador", "semPapel"])("%s: 403 em todas as rotas, por chamada direta", async (key) => {
      const agent = await login(app, key)
      for (const call of calls(agent)) expect((await call()).status).toBe(403)
    })

    it("Administrador geral e Administrador de dados têm a ação; a tela recebe as chaves só por isso", async () => {
      const indicator = await createIndicator("PROVA_ACESSO")
      await seedMeasurements(indicator, [1])
      for (const agent of [geral, dados]) {
        expect((await agent.get(`${API}/datasets/indicator_measurements`)).body.data.canCancel).toBe(true)
        const page = await agent.post(`${API}/query`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_ACESSO") })
        expect(page.body.data.rowKeys).toHaveLength(1)
      }
      expect((await geral.get(`${API}/datasets/interactions`)).body.data.canCancel).toBe(false)
      expect((await geral.post(`${API}/query`).send({ dataset: "interactions" })).body.data.rowKeys).toBeNull()
    })
  })

  describe("alcance", () => {
    it("recusa conjunto inteiro, conjunto não cancelável, pedido com campo a mais e mistura de marcados com filtro", async () => {
      const post = (body: unknown) => geral.post(`${API}/cancellations/preview`).send(body as object)
      expect((await post({ dataset: "goals" })).body.error.code).toBe("DATA_CANCEL_SCOPE_REQUIRED")
      expect((await post({ dataset: "interactions", search: "abc" })).body.error.code).toBe("DATA_CANCEL_NOT_AVAILABLE")
      expect((await post({ dataset: "goals", search: "abc", organizationId: ORG_B })).status).toBe(400)
      expect((await post({ dataset: "goals", search: "abc", table: "people" })).status).toBe(400)
      expect((await post({ dataset: "goals", keys: [ids.op], search: "abc" })).status).toBe(400)
      expect((await post({ dataset: "goals", keys: ["'; drop table people; --"] })).status).toBe(400)
      expect((await post({ dataset: "goals", filter: where({ type: "condition", column: "coluna_que_nao_existe", operator: "EQ", value: "x" }) })).status).toBe(422)
    })

    it("id de outra organização não alcança nada, nem por marcados nem por filtro", async () => {
      const indicatorB = await createIndicator("PROVA_ORG_B", { org: ORG_B })
      const [rowB] = await seedMeasurements(indicatorB, [1], { org: ORG_B, subject: ids.opB! })
      const byKey = await geral.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [rowB], reason: REASON, expectedFingerprint: ANY_FINGERPRINT })
      expect(byKey.body.error.code).toBe("DATA_CANCEL_NOTHING")
      const preview = await geral.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_ORG_B") })
      expect(preview.body.data.rows).toBe(0)
      expect((await state("indicator_measurements", rowB!))?.cancelled_at).toBeNull()
    })

    it("a confirmação recusa se a quantidade mudou desde a prévia, sem alterar nada", async () => {
      const indicator = await createIndicator("PROVA_MUDOU")
      const rows = await seedMeasurements(indicator, [1, 2])
      const response = await geral.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_MUDOU"), reason: REASON, expectedFingerprint: ANY_FINGERPRINT })
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe("DATA_CANCEL_SCOPE_CHANGED")
      for (const id of rows) expect((await state("indicator_measurements", id))?.cancelled_at).toBeNull()
    })

    it("um registro saiu e outro entrou, com a mesma quantidade: recusa, porque o novo nunca apareceu na prévia", async () => {
      const code = "PROVA_TROCA"
      const indicator = await createIndicator(code)
      const [first, second] = await seedMeasurements(indicator, [1, 2])
      const body = { dataset: "indicator_measurements", filter: indicatorFilter(code) }
      const preview = (await geral.post(`${API}/cancellations/preview`).send(body)).body.data
      const [third] = await seedMeasurements(indicator, [3])
      await pool.query(`delete from indicator_measurements_all where id = $1`, [second])
      const response = await geral.post(`${API}/cancellations`).send({ ...body, reason: REASON, expectedFingerprint: preview.scopeFingerprint })
      expect(response.body.error.code).toBe("DATA_CANCEL_SCOPE_CHANGED")
      for (const id of [first!, third!]) expect((await state("indicator_measurements", id))?.cancelled_at).toBeNull()
    })

    it("filtro que alcança tudo é permitido, mas a prévia avisa", async () => {
      const preview = await geral.post(`${API}/cancellations/preview`).send({ dataset: "prv_closures", filter: where({ type: "condition", column: "created_at", operator: "IS_NOT_EMPTY" }) })
      expect(preview.status).toBe(200)
      if (preview.body.data.rows > 0) expect(preview.body.data.notices.join(" ")).toContain("todos os registros ativos")
      const indicator = await createIndicator("PROVA_TUDO")
      await seedMeasurements(indicator, [1])
      const partial = await geral.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_TUDO") })
      const others = await pool.query<{ total: string }>(`select count(*) total from indicator_measurements where organization_id = $1 and indicator_definition_id <> $2`, [ORG_A, indicator])
      expect(partial.body.data.wholeDataset).toBe(Number(others.rows[0]?.total) === 0)
    })

    it("ninguém cancela os próprios resultados", async () => {
      const indicator = await createIndicator("PROVA_PROPRIO")
      const [own] = await seedMeasurements(indicator, [1], { subject: ids.dados! })
      const preview = await dados.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", keys: [own] })
      expect(preview.body.data.canCancel).toBe(false)
      expect(preview.body.data.blockers[0].code).toBe("DATA_CANCEL_OWN_RECORDS")
      const refused = await dados.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [own], reason: REASON, expectedFingerprint: preview.body.data.scopeFingerprint })
      expect(refused.status).toBe(403)
      expect(refused.body.error.code).toBe("DATA_CANCEL_OWN_RECORDS")
      expect((await state("indicator_measurements", own!))?.cancelled_at).toBeNull()
      // Outro administrador pode.
      expect((await cancel(geral, { dataset: "indicator_measurements", keys: [own] })).response.status).toBe(201)
    })

    it("linha presa por outra operação: diz isso, não que há outro cancelamento", async () => {
      const indicator = await createIndicator("PROVA_TRAVA")
      const [row] = await seedMeasurements(indicator, [1])
      const quick = await login(newApp({ dataExplorerLimits: { cancelLockTimeoutMs: 100 } }), "geral")
      const fingerprint = (await quick.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", keys: [row] })).body.data.scopeFingerprint
      const holder = await pool.connect()
      try {
        await holder.query("begin")
        await holder.query(`select 1 from indicator_measurements_all where id = $1 for update`, [row])
        const response = await quick.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [row], reason: REASON, expectedFingerprint: fingerprint })
        expect(response.body.error.code).toBe("DATA_CANCEL_LOCKED")
      } finally {
        await holder.query("rollback")
        holder.release()
      }
    })

    it("acima do limite por vez: a prévia avisa, a confirmação recusa, e nada é feito em parte", async () => {
      const indicator = await createIndicator("PROVA_LIMITE")
      const rows = await seedMeasurements(indicator, [1, 2, 3])
      const small = await login(newApp({ dataExplorerLimits: { cancelMaxRows: 2, cancelMaxKeys: 1 } }), "geral")
      const preview = await small.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_LIMITE") })
      expect(preview.body.data).toMatchObject({ capped: true, canCancel: false })
      expect(preview.body.data.blockers[0].code).toBe("DATA_CANCEL_TOO_MANY")
      expect((await small.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_LIMITE"), reason: REASON, expectedFingerprint: ANY_FINGERPRINT })).body.error.code).toBe("DATA_CANCEL_TOO_MANY")
      expect((await small.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", keys: rows.slice(0, 2) })).body.error.code).toBe("DATA_CANCEL_TOO_MANY_KEYS")
      for (const id of rows) expect((await state("indicator_measurements", id))?.cancelled_at).toBeNull()
    })

    it("um cancelamento por organização de cada vez, somando todas as APIs", async () => {
      const indicator = await createIndicator("PROVA_OCUPADO")
      const [row] = await seedMeasurements(indicator, [1])
      const holder = await pool.connect()
      try {
        await holder.query("begin")
        await holder.query(`select pg_advisory_xact_lock($1::int, hashtext($2))`, [EXPLORER_LOCK_NAMESPACE, `explorer-cancel:${ORG_A}`])
        const response = await geral.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [row], reason: REASON, expectedFingerprint: ANY_FINGERPRINT })
        expect(response.status).toBe(429)
        expect(response.body.error.code).toBe("DATA_CANCEL_BUSY")
      } finally {
        await holder.query("rollback")
        holder.release()
      }
    })
  })

  describe("motivo", () => {
    it("é obrigatório, com tamanho e sem caractere de controle, e nunca volta na resposta", async () => {
      const indicator = await createIndicator("PROVA_MOTIVO")
      const [row] = await seedMeasurements(indicator, [1])
      for (const reason of ["curto", " ".repeat(30), "x".repeat(501), "motivo com\u0007 controle ok", "\u{1F600}\u{1F600}\u{1F600}\u{1F600}\u{1F600}", "motivo com \u202e controle ok", "motivo com \u200b controle ok", "motivo com \u0085 controle ok", "motivo com \u2028 controle ok"]) {
        const response = await geral.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [row], reason, expectedFingerprint: ANY_FINGERPRINT })
        expect(response.body.error.code).toBe("DATA_CANCEL_INVALID_REASON")
        expect(JSON.stringify(response.body)).not.toContain("controle ok")
      }
    })

    it("fica no lote e fora da auditoria; comando no texto é só texto", async () => {
      const indicator = await createIndicator("PROVA_INJECAO")
      const [row] = await seedMeasurements(indicator, [1])
      const reason = `${WRITTEN_REASON}'; drop table people; --`
      const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [row] }, reason)
      expect(response.status).toBe(201)
      const stored = await pool.query<{ reason: string }>(`select reason from data_record_cancellations where id = $1`, [response.body.data.cancellationId])
      expect(stored.rows[0]?.reason).toBe(reason)
      expect((await pool.query(`select 1 from people where id = $1`, [ids.op])).rowCount).toBe(1)
      const audit = JSON.stringify((await pool.query(`select payload from audit_logs where organization_id = $1`, [ORG_A])).rows)
      expect(audit).not.toContain(WRITTEN_REASON)
    })
  })

  it("motivo com acento, emoji e quebra de linha é aceito e guardado como veio", async () => {
    const indicator = await createIndicator("PROVA_MOTIVO_OK")
    const [row] = await seedMeasurements(indicator, [1])
    const reason = "Código errado na origem \u{1F600}\nsegunda linha"
    const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [row] }, reason)
    expect(response.status).toBe(201)
    expect((await pool.query<{ reason: string }>(`select reason from data_record_cancellations where id = $1`, [response.body.data.cancellationId])).rows[0]?.reason).toBe(reason)
  })

  describe("cancelar", () => {
    it("o registro fica no banco, sai da leitura normal e aparece marcado na consulta", async () => {
      const indicator = await createIndicator("PROVA_MARCA")
      const [gone, kept] = await seedMeasurements(indicator, [1, 2])
      const { preview, response } = await cancel(dados, { dataset: "indicator_measurements", keys: [gone] })
      expect(preview).toMatchObject({ rows: 1, canCancel: true, blockers: [] })
      expect(preview.notices.join(" ")).toContain("volta a valer")
      expect(response.status).toBe(201)
      expect(response.body.data.rows).toBe(1)

      expect(await visible("indicator_measurements", gone!)).toBe(0)
      expect((await state("indicator_measurements", gone!))?.cancellation_id).toBe(response.body.data.cancellationId)
      expect(await visible("indicator_measurements", kept!)).toBe(1)

      const page = await dados.post(`${API}/query`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_MARCA") })
      const status = page.body.data.columns.indexOf("record_status")
      expect(page.body.data.rows.map((row: string[]) => row[status]).sort()).toEqual(["ACTIVE", "CANCELLED"])
      // Registro cancelado não tem chave: não há o que cancelar nele.
      expect(page.body.data.rowKeys.filter((key: string | null) => key === null)).toHaveLength(1)

      const onlyActive = await dados.post(`${API}/query`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_MARCA"), recordStatus: "ACTIVE" })
      expect(onlyActive.body.data.rows).toHaveLength(1)
      const onlyCancelled = await dados.post(`${API}/count`).send({ dataset: "indicator_measurements", filter: indicatorFilter("PROVA_MARCA"), recordStatus: "CANCELLED" })
      expect(onlyCancelled.body.data.count).toBe(1)
      expect((await dados.post(`${API}/query`).send({ dataset: "interactions", recordStatus: "ACTIVE" })).status).toBe(400)

      const items = (await dados.get(`${API}/cancellations?dataset=indicator_measurements`)).body.data.items
      expect(items[0]).toMatchObject({ rows: 1, remaining: 1, reason: REASON, cancelledBy: "Pessoa dados", reactivatedAt: null })
    })

    it("o CSV com cancelados sempre leva a situação, mesmo sem pedir a coluna", async () => {
      const indicator = await createIndicator("PROVA_CSV")
      const [gone] = await seedMeasurements(indicator, [1])
      await cancel(geral, { dataset: "indicator_measurements", keys: [gone] })
      const csv = await geral.post(`${API}/export`).send({ dataset: "indicator_measurements", columns: ["value"], filter: indicatorFilter("PROVA_CSV") })
      expect(csv.status).toBe(200)
      expect(csv.text).toContain("Situação do registro")
      expect(csv.text).toContain("CANCELLED")
      const activeOnly = await geral.post(`${API}/export`).send({ dataset: "indicator_measurements", columns: ["value"], filter: indicatorFilter("PROVA_CSV"), recordStatus: "ACTIVE" })
      expect(activeOnly.text).not.toContain("Situação do registro")
    })

    it("a lógica deixa de ver: dependências do indicador, contexto da execução e read model", async () => {
      const indicator = await createIndicator("PROVA_LOGICA")
      const [gone] = await seedMeasurements(indicator, [1])
      const db = pool as unknown as Database
      expect((await loadIndicatorDependencies(db, ORG_A, { id: indicator, code: "PROVA_LOGICA" })).measurements).toBe(1)
      expect(await loadIndicatorCanonicalContext(db, { organizationId: ORG_A, measurementId: gone! })).not.toBeNull()
      await pool.query(`delete from analytics_operational_dirty where organization_id = $1`, [ORG_A])
      await cancel(geral, { dataset: "indicator_measurements", keys: [gone] })
      expect((await loadIndicatorDependencies(db, ORG_A, { id: indicator, code: "PROVA_LOGICA" })).hasHistory).toBe(false)
      expect(await loadIndicatorCanonicalContext(db, { organizationId: ORG_A, measurementId: gone! })).toBeNull()
      const dirty = await pool.query(`select 1 from analytics_operational_dirty where organization_id = $1 and person_id = $2`, [ORG_A, ids.op])
      expect(dirty.rowCount).toBeGreaterThan(0)
    })

    it("fechamento e PRV somem da leitura e o cache da camada oficial é invalidado", async () => {
      const indicator = await createIndicator("PROVA_FECHAMENTO")
      const closure = await insertId(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, source) values ($1, $2, $3, '2026-02', 10, 'PROVA')`, [ORG_A, ids.op, indicator])
      const prv = await insertId(`insert into employee_prv_performance (organization_id, person_id, reference_period, achievement_percent, quartile, source) values ($1, $2, '2026-02', 90, 'Q1', 'PROVA')`, [ORG_A, ids.op])
      const version = async () => Number((await pool.query<{ version: string }>(`select version from analytics_versions where organization_id = $1 and domain = 'OFFICIAL'`, [ORG_A])).rows[0]?.version ?? 0)
      const before = await version()
      const first = await cancel(geral, { dataset: "official_closures", keys: [closure] })
      expect(first.preview.notices.join(" ")).toContain("A PRV não é recalculada")
      expect(first.response.status).toBe(201)
      expect((await cancel(geral, { dataset: "prv_closures", keys: [prv] })).response.status).toBe(201)
      expect(await visible("employee_indicator_performance", closure)).toBe(0)
      expect(await visible("employee_prv_performance", prv)).toBe(0)
      expect(await version()).toBeGreaterThan(before)
    })

    it("meta cancelada deixa de valer no contexto da execução", async () => {
      const indicator = await createIndicator("PROVA_META")
      const [measurement] = await seedMeasurements(indicator, [1])
      const goal = await insertId(`insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1, $2, 'PERSON', $3, 250, '2026-01-01')`, [ORG_A, indicator, ids.op])
      const db = pool as unknown as Database
      expect((await loadIndicatorCanonicalContext(db, { organizationId: ORG_A, measurementId: measurement! }))?.target?.value).toBe(250)
      expect((await cancel(geral, { dataset: "goals", keys: [goal] })).response.status).toBe(201)
      expect((await loadIndicatorCanonicalContext(db, { organizationId: ORG_A, measurementId: measurement! }))?.target ?? null).toBeNull()
    })
  })

  describe("o que depende do registro", () => {
    async function workflowFor(code: string, active = true) {
      const workflow = await insertId(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, trigger_config) values ($1, $2, $3, 'ALL_TEAMS', 'ALL_TEAMS', $4)`, [ORG_A, `Workflow ${code}`, active, JSON.stringify({ kind: "indicator", indicatorCode: code })])
      const version = await insertId(`insert into workflow_versions (workflow_id, graph) values ($1, $2)`, [workflow, JSON.stringify({ nodes: [{ id: "t", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} }], edges: [] })])
      await pool.query(`update workflows set active_version_id = $1 where id = $2`, [version, workflow])
      return { workflow, version }
    }

    const enroll = (workflow: { workflow: string; version: string }, measurement: string, status: string) => insertId(`insert into workflow_enrollments (organization_id, workflow_id, version_id, indicator_measurement_id, current_node_id, status) values ($1, $2, $3, $4, 't', $5)`, [ORG_A, workflow.workflow, workflow.version, measurement, status])

    it.each(["active", "waiting"])("execução %s em Workflow ativo: recusa, e nada muda", async (status) => {
      const code = `PROVA_EXEC_${status.toUpperCase()}`
      const indicator = await createIndicator(code)
      const [row] = await seedMeasurements(indicator, [1])
      await enroll(await workflowFor(code), row!, status)
      const preview = await geral.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", keys: [row] })
      expect(preview.body.data).toMatchObject({ runningExecutions: 1, canCancel: false })
      expect(preview.body.data.blockers[0].code).toBe("DATA_CANCEL_IN_FLIGHT")
      const response = await geral.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [row], reason: REASON, expectedFingerprint: preview.body.data.scopeFingerprint })
      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe("DATA_CANCEL_IN_FLIGHT")
      expect((await state("indicator_measurements", row!))?.cancelled_at).toBeNull()
    })

    it("execução bloqueada ou de Workflow pausado não prende o registro para sempre: permite e avisa", async () => {
      const blockedCode = "PROVA_EXEC_BLOQUEADA"
      const blockedIndicator = await createIndicator(blockedCode)
      const [blockedRow] = await seedMeasurements(blockedIndicator, [1])
      await enroll(await workflowFor(blockedCode), blockedRow!, "blocked")
      const { preview, response } = await cancel(geral, { dataset: "indicator_measurements", keys: [blockedRow] })
      expect(preview).toMatchObject({ runningExecutions: 0, stoppedExecutions: 1, canCancel: true })
      expect(preview.notices.join(" ")).toContain("fica bloqueada")
      expect(response.status).toBe(201)
      expect(await loadIndicatorCanonicalContext(pool as unknown as Database, { organizationId: ORG_A, measurementId: blockedRow! })).toBeNull()

      const pausedCode = "PROVA_EXEC_PAUSADA"
      const pausedIndicator = await createIndicator(pausedCode)
      const [pausedRow] = await seedMeasurements(pausedIndicator, [1])
      await enroll(await workflowFor(pausedCode, false), pausedRow!, "waiting")
      const paused = await cancel(geral, { dataset: "indicator_measurements", keys: [pausedRow] })
      expect(paused.preview).toMatchObject({ runningExecutions: 0, stoppedExecutions: 1 })
      expect(paused.response.status).toBe(201)
    })

    it("evidência que cita vários registros no mesmo campo também conta na prévia", async () => {
      const indicator = await createIndicator("PROVA_RESUMO")
      const [row, other] = await seedMeasurements(indicator, [1, 2])
      const caseId = await insertId(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'Caso', 'Resumo', 'DETECTED', 'P3', 'PROVA_RESUMO', 1, 1)`, [ORG_A, ids.op, ids.teamA])
      await pool.query(`insert into evidences (organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum) values ($1, $2, 'INDICATOR', 'Prova', 'Prova', 'indicator_period_summary', $3, now(), 'x')`, [ORG_A, caseId, `${other},${row}`])
      await pool.query(`insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at) values ($1, $2, $3, 'PUBLISHED', 'INDICATOR', 'TMA', 'e', 'o', 'p', 'r', now())`, [ORG_A, caseId, ids.op])
      const preview = await geral.post(`${API}/cancellations/preview`).send({ dataset: "indicator_measurements", keys: [row] })
      expect(preview.body.data).toMatchObject({ evidences: 1, feedbacks: 1 })
      expect(preview.body.data.notices.join(" ")).toContain("Feedback já entregue não é alterado")
    })

    it("execução terminada e evidência continuam existindo, ao contrário de apagar a linha", async () => {
      const code = "PROVA_HISTORICO"
      const indicator = await createIndicator(code)
      const [row] = await seedMeasurements(indicator, [1])
      const enrollment = await enroll(await workflowFor(code), row!, "completed")
      const caseId = await insertId(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, status, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'Caso', 'Resumo', 'DETECTED', 'P3', $4, 1, 1)`, [ORG_A, ids.op, ids.teamA, code])
      await pool.query(`insert into evidences (organization_id, case_id, evidence_type, title, description, source_type, source_id, occurred_at, checksum) values ($1, $2, 'INDICATOR', 'Prova', 'Prova', 'indicator_measurement', $3, now(), 'x')`, [ORG_A, caseId, row])
      const feedback = await insertId(`insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at) values ($1, $2, $3, 'PUBLISHED', 'INDICATOR', 'TMA', 'e', 'o', 'p', 'r', now())`, [ORG_A, caseId, ids.op])
      const { preview, response } = await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      expect(preview).toMatchObject({ executions: 1, runningExecutions: 0, evidences: 1, feedbacks: 1, workflowsOnReload: 1, canCancel: true })
      expect(preview.notices.join(" ")).toContain("Feedback já entregue não é alterado")
      expect(preview.notices.join(" ")).toContain("um Workflow ativo roda outra vez")
      expect(response.status).toBe(201)
      // A execução segue ligada ao registro, e o feedback entregue não mudou.
      const linked = await pool.query(`select 1 from workflow_enrollments where id = $1 and indicator_measurement_id = $2`, [enrollment, row])
      expect(linked.rowCount).toBe(1)
      expect((await pool.query<{ status: string }>(`select status from feedbacks where id = $1`, [feedback])).rows[0]?.status).toBe("PUBLISHED")
      // Tela de histórico: a leitura pelo id continua achando quem foi medido.
      const history = await pool.query<{ subject_id: string }>(`select m.subject_id from workflow_enrollments e left join indicator_measurements_all m on m.id = e.indicator_measurement_id where e.id = $1`, [enrollment])
      expect(history.rows[0]?.subject_id).toBe(ids.op)
    })

    it("carga do mesmo tipo em andamento: recusa cancelar e reativar", async () => {
      const indicator = await createIndicator("PROVA_CARGA_ANDANDO")
      const [row, other] = await seedMeasurements(indicator, [1, 2])
      const { response: first } = await cancel(geral, { dataset: "indicator_measurements", keys: [other] })
      const source = await insertId(`insert into data_sources (organization_id, public_id, name, kind) values ($1, 'prova-cancelamento', 'Fonte', 'FILE_UPLOAD')`, [ORG_A])
      const feed = await insertId(`insert into data_feeds (organization_id, source_id, feed_key, name, contract_key) values ($1, $2, 'prova', 'Feed', 'INDICATOR_MEASUREMENTS')`, [ORG_A, source])
      const run = await insertId(`insert into data_ingestion_runs (organization_id, source_id, feed_id, contract_key, contract_version, trigger_kind, status) values ($1, $2, $3, 'INDICATOR_MEASUREMENTS', 1, 'FILE_UPLOAD', 'APPLYING')`, [ORG_A, source, feed])
      const refused = await geral.post(`${API}/cancellations`).send({ dataset: "indicator_measurements", keys: [row], reason: REASON, expectedFingerprint: ANY_FINGERPRINT })
      expect(refused.body.error.code).toBe("DATA_CANCEL_RUN_IN_PROGRESS")
      const reactivation = await geral.post(`${API}/cancellations/${first.body.data.cancellationId}/reactivation`).send({ expectedRows: 1 })
      expect(reactivation.body.error.code).toBe("DATA_CANCEL_RUN_IN_PROGRESS")
      await pool.query(`delete from data_ingestion_runs where id = $1`, [run])
      await pool.query(`delete from data_feeds where id = $1`, [feed])
      await pool.query(`delete from data_sources where id = $1`, [source])
    })
  })

  describe("carga depois do cancelamento (o erro silencioso)", () => {
    it("medição com o MESMO valor volta a valer e conta como alterada", async () => {
      const indicator = await createIndicator("PROVA_CARGA_IGUAL")
      const first = await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord("PROVA_CARGA_IGUAL", 1, 300)])
      expect(first.inserted).toBe(1)
      const row = first.lineage[0]!.entityId
      // Sem cancelamento, a mesma carga não muda nada: o caminho normal segue igual.
      expect((await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord("PROVA_CARGA_IGUAL", 1, 300)])).unchanged).toBe(1)
      await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      expect(await visible("indicator_measurements", row)).toBe(0)
      const again = await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord("PROVA_CARGA_IGUAL", 1, 300)])
      expect(again.updated).toBe(1)
      expect(await visible("indicator_measurements", row)).toBe(1)
      expect((await state("indicator_measurements", row))?.cancellation_id).toBeNull()
      expect(indicator).toBeTruthy()
    })

    it("medição com valor NOVO volta a valer com o valor novo", async () => {
      await createIndicator("PROVA_CARGA_NOVA")
      const row = (await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord("PROVA_CARGA_NOVA", 1, 300)])).lineage[0]!.entityId
      await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord("PROVA_CARGA_NOVA", 1, 280)])
      const loaded = await pool.query<{ value: string }>(`select value from indicator_measurements where id = $1`, [row])
      expect(Number(loaded.rows[0]?.value)).toBe(280)
    })

    it("fechamento, PRV e meta também voltam pela carga", async () => {
      await createIndicator("PROVA_CARGA_FECH")
      const closureRecord = { externalEmployeeId: "A-001", indicatorCode: "PROVA_CARGA_FECH", referencePeriod: "2026-01", value: 10 }
      const prvRecord = { externalEmployeeId: "A-002", referencePeriod: "2026-01", achievementPercent: 95, quartile: "Q1" }
      const goalRecord = { indicatorCode: "PROVA_CARGA_FECH", subjectType: "EMPLOYEE", subjectExternalCode: "A-001", targetValue: 5, validFrom: "2026-01-01" }
      const cases = [
        { writer: officialIndicatorPerformanceWriter as DomainWriter<never>, contract: "OFFICIAL_INDICATOR_PERFORMANCE", record: closureRecord, dataset: "official_closures", table: "employee_indicator_performance" },
        { writer: prvPerformanceWriter as DomainWriter<never>, contract: "PRV_PERFORMANCE", record: prvRecord, dataset: "prv_closures", table: "employee_prv_performance" },
        { writer: goalsWriter as DomainWriter<never>, contract: "GOALS", record: goalRecord, dataset: "goals", table: "goals" },
      ]
      for (const { writer, contract, record, dataset, table } of cases) {
        const row = (await load(writer, contract, [record])).lineage[0]!.entityId
        expect((await cancel(geral, { dataset, keys: [row] })).response.status, dataset).toBe(201)
        expect(await visible(table, row), dataset).toBe(0)
        expect((await load(writer, contract, [record])).updated, dataset).toBe(1)
        expect(await visible(table, row), dataset).toBe(1)
      }
    })

    it("a ingestão antiga em tempo real também reativa", async () => {
      await createIndicator("PROVA_CARGA_TEMPO_REAL")
      const row = (await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord("PROVA_CARGA_TEMPO_REAL", 1, 300)])).lineage[0]!.entityId
      const original = await pool.query<{ period_start: Date; period_end: Date; source: string }>(`select period_start, period_end, source from indicator_measurements where id = $1`, [row])
      await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      const response = await geral.post("/api/v1/ingestion/indicator-measurements/batch").send([{ indicatorCode: "PROVA_CARGA_TEMPO_REAL", operatorId: ids.op, value: 300, periodStart: original.rows[0]!.period_start.toISOString(), periodEnd: original.rows[0]!.period_end.toISOString(), source: original.rows[0]!.source }])
      expect(response.status).toBeLessThan(300)
      expect(await visible("indicator_measurements", row)).toBe(1)
    })
  })

  describe("reativar", () => {
    it("volta como estava, sem disparar Workflow, e a auditoria registra", async () => {
      const code = "PROVA_REATIVAR"
      const indicator = await createIndicator(code)
      const rows = await seedMeasurements(indicator, [1, 2])
      const workflow = await insertId(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, trigger_config) values ($1, 'Workflow reativar', true, 'ALL_TEAMS', 'ALL_TEAMS', $2)`, [ORG_A, JSON.stringify({ kind: "indicator", indicatorCode: code })])
      const version = await insertId(`insert into workflow_versions (workflow_id, graph) values ($1, $2)`, [workflow, JSON.stringify({ nodes: [{ id: "t", type: "trigger", label: "Início", position: { x: 0, y: 0 }, config: {} }], edges: [] })])
      await pool.query(`update workflows set active_version_id = $1 where id = $2`, [version, workflow])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter(code) })
      const id = response.body.data.cancellationId
      const preview = await geral.get(`${API}/cancellations/${id}/reactivation`)
      expect(preview.body.data).toMatchObject({ rows: 2, canReactivate: true, problems: [] })
      expect((await geral.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 1 })).body.error.code).toBe("DATA_CANCEL_SCOPE_CHANGED")
      const done = await geral.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 2 })
      expect(done.status).toBe(200)
      expect(done.body.data.rows).toBe(2)
      for (const row of rows) expect(await visible("indicator_measurements", row)).toBe(1)
      expect((await pool.query(`select 1 from workflow_enrollments where workflow_id = $1`, [workflow])).rowCount).toBe(0)
      const item = (await geral.get(`${API}/cancellations?dataset=indicator_measurements`)).body.data.items.find((entry: { id: string }) => entry.id === id)
      expect(item).toMatchObject({ remaining: 0, reactivatedRows: 2, reactivatedBy: "Pessoa geral" })
      const audit = await pool.query<{ payload: Record<string, unknown> }>(`select payload from audit_logs where organization_id = $1 and action = 'DATA_HUB_RECORDS_REACTIVATED' order by created_at desc limit 1`, [ORG_A])
      expect(audit.rows[0]?.payload).toMatchObject({ result: "OK", rows: 2, cancellationId: id, dataset: "indicator_measurements" })
      // Uma segunda vez não tem o que fazer.
      expect((await geral.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 2 })).body.error.code).toBe("DATA_REACTIVATION_NOTHING")
    })

    it("ninguém reativa os próprios resultados, mesmo que outro administrador tenha cancelado", async () => {
      const indicator = await createIndicator("PROVA_REATIVAR_PROPRIO")
      const [own] = await seedMeasurements(indicator, [1], { subject: ids.dados! })
      const [other] = await seedMeasurements(indicator, [1])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [own, other] })
      expect(response.status).toBe(201)
      const id = response.body.data.cancellationId
      const preview = await dados.get(`${API}/cancellations/${id}/reactivation`)
      expect(preview.body.data.canReactivate).toBe(false)
      expect(preview.body.data.blockers.map((blocker: { code: string }) => blocker.code)).toContain("DATA_CANCEL_OWN_RECORDS")
      const refused = await dados.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 2 })
      expect(refused.status).toBe(403)
      expect(refused.body.error.code).toBe("DATA_CANCEL_OWN_RECORDS")
      expect((await state("indicator_measurements", own!))?.cancellation_id).toBe(id)
      // Outro administrador pode.
      expect((await geral.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 2 })).status).toBe(200)
      expect(await visible("indicator_measurements", own!)).toBe(1)
    })

    it("mudou a regra do indicador depois do cancelamento: reativar é barrado e a carga é o caminho", async () => {
      const code = "PROVA_REGRA_MUDOU"
      const indicator = await createIndicator(code)
      const rows = await seedMeasurements(indicator, [1])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter(code) })
      const id = response.body.data.cancellationId
      expect((await geral.patch(`${RULES_API}/${indicator}`).send({ operationalAggregation: "AVERAGE" })).status).toBe(200)
      const preview = await geral.get(`${API}/cancellations/${id}/reactivation`)
      expect(preview.body.data.canReactivate).toBe(false)
      expect(preview.body.data.problems).toMatchObject([{ code: "INDICATOR_RULE_CHANGED", count: 1 }])
      const refused = await geral.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 1 })
      expect(refused.status).toBe(409)
      expect(refused.body.error).toMatchObject({ code: "DATA_REACTIVATION_BLOCKED", details: { problems: [{ code: "INDICATOR_RULE_CHANGED", count: 1 }] } })
      expect(await visible("indicator_measurements", rows[0]!)).toBe(0)
    })

    it("direção ou código mudaram depois do cancelamento: barrado, como a estratégia", async () => {
      const code = "PROVA_DIRECAO"
      const indicator = await createIndicator(code)
      await seedMeasurements(indicator, [1])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter(code) })
      expect((await geral.patch(`${RULES_API}/${indicator}`).send({ desiredDirection: "HIGHER" })).status).toBe(200)
      const preview = await geral.get(`${API}/cancellations/${response.body.data.cancellationId}/reactivation`)
      expect(preview.body.data.problems).toMatchObject([{ code: "INDICATOR_RULE_CHANGED", count: 1 }])
    })

    it("outra carga trouxe o mesmo dia por outra origem: reativar é barrado, senão o dia contaria duas vezes", async () => {
      const code = "PROVA_DOBRO"
      const indicator = await createIndicator(code)
      const row = (await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord(code, 1, 300)], ORG_A, "FEED_A")).lineage[0]!.entityId
      const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      const replacement = (await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", [measurementRecord(code, 1, 300)], ORG_A, "FEED_B")).lineage[0]!.entityId
      expect(replacement).not.toBe(row)
      const id = response.body.data.cancellationId
      const preview = await geral.get(`${API}/cancellations/${id}/reactivation`)
      expect(preview.body.data.canReactivate).toBe(false)
      expect(preview.body.data.problems).toMatchObject([{ code: "ACTIVE_RECORD_IN_PERIOD", count: 1 }])
      const refused = await geral.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 1 })
      expect(refused.body.error.code).toBe("DATA_REACTIVATION_BLOCKED")
      expect(await visible("indicator_measurements", row)).toBe(0)
      const active = await pool.query<{ total: string }>(`select count(*) total from indicator_measurements where indicator_definition_id = $1`, [indicator])
      expect(Number(active.rows[0]?.total)).toBe(1)
    })

    it("medição aceita pela carga volta mesmo com componentes que a estratégia não usa: reativar é desfazer", async () => {
      const code = "PROVA_DESFAZER"
      const indicator = await createIndicator(code)
      const [row] = await seedMeasurements(indicator, [1])
      await pool.query(`update indicator_measurements set numerator = 3000, denominator = 10 where id = $1`, [row])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      const done = await geral.post(`${API}/cancellations/${response.body.data.cancellationId}/reactivation`).send({ expectedRows: 1 })
      expect(done.status).toBe(200)
      expect(await visible("indicator_measurements", row!)).toBe(1)
    })

    it("indicador desativado depois do cancelamento: também barrado", async () => {
      const code = "PROVA_DESATIVOU"
      const indicator = await createIndicator(code)
      await seedMeasurements(indicator, [1])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter(code) })
      await pool.query(`update indicator_definitions set active = false where id = $1`, [indicator])
      const refused = await geral.post(`${API}/cancellations/${response.body.data.cancellationId}/reactivation`).send({ expectedRows: 1 })
      expect(refused.body.error).toMatchObject({ code: "DATA_REACTIVATION_BLOCKED", details: { problems: [{ code: "INDICATOR_NOT_AVAILABLE", count: 1 }] } })
    })

    it("lote de outra organização não existe", async () => {
      const indicator = await createIndicator("PROVA_LOTE")
      await seedMeasurements(indicator, [1])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter("PROVA_LOTE") })
      const other = await login(app, "geralB")
      const id = response.body.data.cancellationId
      expect((await other.get(`${API}/cancellations/${id}/reactivation`)).status).toBe(404)
      expect((await other.post(`${API}/cancellations/${id}/reactivation`).send({ expectedRows: 1 })).status).toBe(404)
      expect((await other.get(`${API}/cancellations?dataset=indicator_measurements`)).body.data.items).toEqual([])
      expect((await geral.get(`${API}/cancellations/nao-e-um-id/reactivation`)).status).toBe(404)
    })
  })

  describe("o caso real do TMA, do começo ao fim", () => {
    it("indicador como Soma trava; cancelar libera a correção; a carga traz tudo de volta na regra certa", async () => {
      const code = "PROVA_TMA_REAL"
      const indicator = await createIndicator(code, { unit: "SECONDS", aggregation: "SUM" })
      const days = Array.from({ length: 15 }, (_, index) => index + 1)
      const loaded = await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", days.map((day) => measurementRecord(code, day, 300)))
      expect(loaded.inserted).toBe(15)

      // Com histórico, a estratégia não muda.
      const locked = await geral.patch(`${RULES_API}/${indicator}`).send({ operationalAggregation: "WEIGHTED_AVERAGE" })
      expect(locked.status).toBe(409)
      expect(locked.body.error.code).toBe("INDICATOR_SEMANTIC_LOCKED")

      // Cancela as 15 pela consulta, com filtro.
      const { preview, response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter(code) })
      expect(preview.rows).toBe(15)
      expect(response.status).toBe(201)

      // Sem histórico vivo, a correção passa.
      const corrected = await geral.patch(`${RULES_API}/${indicator}`).send({ operationalAggregation: "WEIGHTED_AVERAGE" })
      expect(corrected.status, JSON.stringify(corrected.body)).toBe(200)

      // Mesmo arquivo, agora com os componentes que a regra certa exige: tudo volta a valer, na mesma linha.
      const reloaded = await load(indicatorMeasurementsWriter, "INDICATOR_MEASUREMENTS", days.map((day) => measurementRecord(code, day, 300, { numerator: 3000, denominator: 10 })))
      expect(reloaded.rejections).toEqual([])
      expect(reloaded.updated).toBe(15)
      const active = await pool.query<{ total: string }>(`select count(*) total from indicator_measurements where indicator_definition_id = $1 and numerator = 3000`, [indicator])
      expect(Number(active.rows[0]?.total)).toBe(15)
      const cancelled = await pool.query<{ total: string }>(`select count(*) total from indicator_measurements_all where indicator_definition_id = $1 and cancelled_at is not null`, [indicator])
      expect(Number(cancelled.rows[0]?.total)).toBe(0)

      // A consulta mostra tudo ativo e o lote antigo não tem mais o que reativar.
      const item = (await geral.get(`${API}/cancellations?dataset=indicator_measurements`)).body.data.items.find((entry: { id: string }) => entry.id === response.body.data.cancellationId)
      expect(item.remaining).toBe(0)
      expect((await geral.get(`${API}/cancellations/${response.body.data.cancellationId}/reactivation`)).body.data.canReactivate).toBe(false)
    })
  })

  describe("cadeias por chave: o que depende do registro cancelado", () => {
    const node = (id: string, type: string, label: string, config: Record<string, unknown> = {}) => ({ id, type, label, position: { x: 0, y: 0 }, config })
    const END = node("end", "end", "Fim")
    const toEnd = { id: "e", source: "x", sourceHandle: "always", target: "end" }
    const STEPS: Record<string, ReturnType<typeof node>> = {
      "Chamar agente": node("x", "action", "Chamar agente", { actionType: "CALL_AGENT", agentId: "00000000-0000-4000-8000-0000000000aa" }),
      Saída: node("x", "output", "Saída", { target: { type: "CURRENT_OPERATOR" }, surfaces: ["CHAT"], interactionMode: "PASSIVE", source: "nodeOutputs.analysis" }),
      Escalonar: node("x", "action", "Escalonar", { actionType: "ESCALATE", target: { type: "SUPERVISOR_OF_OPERATOR" }, surfaces: ["CHAT"], interactionMode: "PASSIVE" }),
      Revisão: node("x", "human_review", "Revisão", { reviewTarget: { type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" } }),
      Condição: node("x", "condition", "Condição", { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null }),
    }

    /** Execução parada num Workflow pausado, com a medição cancelada; depois o Workflow volta e o motor roda de verdade. */
    async function parkedExecution(code: string, step: ReturnType<typeof node>) {
      const indicator = await createIndicator(code)
      const [measurement] = await seedMeasurements(indicator, [1])
      const workflow = await insertId(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, trigger_config) values ($1, $2, false, 'ALL_TEAMS', 'ALL_TEAMS', $3)`, [ORG_A, `Workflow ${code}`, JSON.stringify({ kind: "indicator", indicatorCode: code })])
      const version = await insertId(`insert into workflow_versions (workflow_id, graph) values ($1, $2)`, [workflow, JSON.stringify({ nodes: [node("trigger", "trigger", "Gatilho"), step, END], edges: [{ id: "t", source: "trigger", sourceHandle: "always", target: "x" }, toEnd, { ...toEnd, id: "e2", sourceHandle: "true" }, { ...toEnd, id: "e3", sourceHandle: "false" }] })])
      await pool.query(`update workflows set active_version_id = $1 where id = $2`, [version, workflow])
      const enrollment = await insertId(`insert into workflow_enrollments (organization_id, workflow_id, version_id, indicator_measurement_id, current_node_id, status, next_eval_at, matched_value_numeric) values ($1, $2, $3, $4, 'x', 'waiting', now(), 300)`, [ORG_A, workflow, version, measurement])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [measurement] })
      expect(response.status, code).toBe(201)
      await pool.query(`update workflows set active = true where id = $1`, [workflow])
      await runWorkflowTick(pool as unknown as Database, { enrollmentIds: [enrollment] })
      const state = (await pool.query<{ status: string; current_node_id: string; attempts: number; blocked_reason: string | null; last_error: string | null }>(`select * from workflow_enrollments where id = $1`, [enrollment])).rows[0]!
      const events = (await pool.query<{ event_type: string; payload: { message?: string; errorCode?: string; reason?: string } }>(`select event_type, payload from workflow_enrollment_events where enrollment_id = $1 order by created_at`, [enrollment])).rows
      return { state, events, enrollment, workflow, measurement: measurement!, version }
    }

    it.each(Object.keys(STEPS))("execução parada que volta a rodar, com a medição cancelada, em %s: bloqueia com o motivo e nada roda", async (label) => {
      const effects = async () => (await pool.query<{ total: number }>(`select ((select count(*) from alerts where organization_id = $1) + (select count(*) from supervision_cases where organization_id = $1) + (select count(*) from agent_runs where organization_id = $1))::int total`, [ORG_A])).rows[0]!.total
      const before = await effects()
      const { state: execution, events, measurement } = await parkedExecution(`PROVA_CADEIA_${Object.keys(STEPS).indexOf(label)}`, STEPS[label]!)
      expect(execution.status).toBe("blocked")
      expect(execution.blocked_reason).toBe("TRIGGERING_RECORD_CANCELLED")
      expect(execution.current_node_id).toBe("x")
      expect(events.map((event) => event.event_type)).toEqual(["node_blocked"])
      expect(events[0]?.payload.message).toContain("foi cancelada na Central de Dados")
      expect(await visible("indicator_measurements", measurement)).toBe(0)
      // Nenhum efeito: sem aviso para revisor, sem caso aberto, sem chamada de agente.
      expect(await effects()).toBe(before)
    })

    it("nova tentativa só anda depois de a medição voltar a valer", async () => {
      const { workflow, enrollment, measurement } = await parkedExecution("PROVA_CADEIA_TENTATIVA", node("x", "condition", "Condição", { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null }))
      const blockedPreview = await geral.get(`/api/v1/admin/workflows/${workflow}/enrollments/${enrollment}/retry`)
      expect(blockedPreview.status).toBe(200)
      expect(blockedPreview.body.data.blockers.map((blocker: { code: string }) => blocker.code)).toContain("WORKFLOW_RETRY_RECORD_CANCELLED")
      await pool.query(`update indicator_measurements_all set cancelled_at = null, cancellation_id = null where id = $1`, [measurement])
      const allowed = await geral.get(`/api/v1/admin/workflows/${workflow}/enrollments/${enrollment}/retry`)
      expect(allowed.body.data.blockers.map((blocker: { code: string }) => blocker.code)).not.toContain("WORKFLOW_RETRY_RECORD_CANCELLED")
    })

    it("execução manual não aceita medição cancelada, nem a lista a oferece", async () => {
      const code = "PROVA_CADEIA_MANUAL"
      const indicator = await createIndicator(code)
      const [row] = await seedMeasurements(indicator, [1])
      const workflow = await insertId(`insert into workflows (organization_id, name, active, scope_type, draft_scope_type, trigger_config) values ($1, 'Workflow manual', true, 'ALL_TEAMS', 'ALL_TEAMS', $2)`, [ORG_A, JSON.stringify({ kind: "manual", context: "INDICATOR_MEASUREMENT", indicatorCode: code })])
      const version = await insertId(`insert into workflow_versions (workflow_id, graph) values ($1, $2)`, [workflow, JSON.stringify({ nodes: [node("trigger", "trigger", "Gatilho"), END], edges: [{ id: "t", source: "trigger", sourceHandle: "always", target: "end" }] })])
      await pool.query(`update workflows set active_version_id = $1 where id = $2`, [version, workflow])
      await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      expect((await geral.get(`/api/v1/admin/workflows/${workflow}/manual-run/measurements?collaboratorId=${ids.op}`)).body.data).toEqual([])
      const manual = await geral.post(`/api/v1/admin/workflows/${workflow}/manual-runs`).send({ collaboratorId: ids.op, indicatorMeasurementId: row, idempotencyKey: `prova-${row}` })
      expect(manual.status).toBe(422)
    })

    it("excluir o Workflow não apaga as execuções dele, e o registro cancelado fica", async () => {
      const code = "PROVA_CADEIA_EXCLUIR"
      const { workflow, enrollment, measurement } = await parkedExecution(code, node("x", "condition", "Condição", { comparator: "GTE", thresholdNumeric: 1, thresholdBoolean: null }))
      expect((await geral.delete(`/api/v1/admin/workflows/${workflow}`)).status).toBe(204)
      expect((await pool.query(`select 1 from workflow_enrollments where id = $1`, [enrollment])).rowCount).toBe(1)
      expect((await state("indicator_measurements", measurement))?.cancelled_at).not.toBeNull()
    })

    it("trava do indicador em cadeia: a mensagem diz o que falta, e só libera sem nada ativo", async () => {
      const code = "PROVA_CADEIA_TRAVA"
      const indicator = await createIndicator(code)
      const [measurement] = await seedMeasurements(indicator, [1])
      const goal = await insertId(`insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1, $2, 'PERSON', $3, 250, '2026-01-01')`, [ORG_A, indicator, ids.op])
      const closure = await insertId(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, source) values ($1, $2, $3, '2026-02', 10, 'PROVA')`, [ORG_A, ids.op, indicator])
      const change = () => geral.patch(`${RULES_API}/${indicator}`).send({ operationalAggregation: "AVERAGE" })
      await cancel(geral, { dataset: "indicator_measurements", keys: [measurement] })
      const first = await change()
      expect(first.status).toBe(409)
      expect(first.body.error.message).toContain("1 metas")
      expect(first.body.error.message).toContain("1 fechamentos oficiais")
      expect(first.body.error.message).not.toContain("medições")
      await cancel(geral, { dataset: "goals", keys: [goal] })
      expect((await change()).body.error.message).not.toContain("metas")
      await cancel(geral, { dataset: "official_closures", keys: [closure] })
      expect((await change()).status).toBe(200)
      // Registro cancelado é histórico: não impede excluir o indicador.
      expect((await geral.delete(`${RULES_API}/${indicator}`)).status).toBe(204)
    })

    it("o lote não pode ser apagado com registros presos a ele: o banco recusa", async () => {
      const indicator = await createIndicator("PROVA_CADEIA_LOTE")
      const [row] = await seedMeasurements(indicator, [1])
      const { response } = await cancel(geral, { dataset: "indicator_measurements", keys: [row] })
      await expect(pool.query(`delete from data_record_cancellations where id = $1`, [response.body.data.cancellationId])).rejects.toMatchObject({ code: "23503" })
    })
  })

  it("ler a lista de lotes e a conferência de reativar fica na auditoria, marcando o dado pessoal", async () => {
    const indicator = await createIndicator("PROVA_LISTA")
    await seedMeasurements(indicator, [1])
    const { response } = await cancel(geral, { dataset: "indicator_measurements", filter: indicatorFilter("PROVA_LISTA") })
    await pool.query(`delete from audit_logs where organization_id = $1 and action in ('DATA_HUB_RECORDS_CANCEL_LIST', 'DATA_HUB_RECORDS_REACTIVATION_PREVIEW')`, [ORG_A])
    expect((await geral.get(`${API}/cancellations?dataset=indicator_measurements`)).body.data.hasMore).toBe(false)
    await geral.get(`${API}/cancellations/${response.body.data.cancellationId}/reactivation`)
    const audit = await pool.query<{ action: string; payload: Record<string, unknown> }>(`select action, payload from audit_logs where organization_id = $1 and action in ('DATA_HUB_RECORDS_CANCEL_LIST', 'DATA_HUB_RECORDS_REACTIVATION_PREVIEW') order by action`, [ORG_A])
    expect(audit.rows.map((row) => row.action)).toEqual(["DATA_HUB_RECORDS_CANCEL_LIST", "DATA_HUB_RECORDS_REACTIVATION_PREVIEW"])
    expect(audit.rows[0]?.payload.personalColumns).toContain("cancel_reason")
    expect(JSON.stringify(audit.rows)).not.toContain(REASON)
  })

  it("nada desta prova gravou motivo em log de auditoria nem valor de filtro", async () => {
    const audit = JSON.stringify((await pool.query(`select payload from audit_logs where organization_id = $1 and action like 'DATA_HUB_RECORDS_%'`, [ORG_A])).rows)
    expect(audit).not.toContain(REASON)
    expect(audit).not.toContain("PROVA_TMA_REAL")
  })
})
