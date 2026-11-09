import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { executeReportRun } from "../application/report-executor.js"
import { createPostgresReportRuntime, type RecipientContexts, type ReportRuntime } from "../application/report-runtime.js"
import { reportAnalysisSchema, reportAudienceSchema, reportDefinitionSchema, reportScheduleSchema, reportVisualizationSchema, toToolCall, type ReportDefinition } from "../domain/report-definition.js"
import { createMemoryReportStore } from "./memory-report-store.js"

/**
 * PROVA — execução de report com os destinatários carregados EM LOTE (`contextsFor`) × conta a conta (`contextFor` por
 * destinatário, o caminho de antes), contra o banco de TESTE real, numa organização PRÓPRIA criada e apagada pela prova (os
 * dados precisam estar commitados: numa transação aberta a versão do fechamento oficial muda a cada leitura).
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run report-run-batch-proof
 *
 * Estrutura: Gerente Marta → Coordenador Caio (Supervisora Sara [Norte: A1–A4], Supervisor Saulo [Norte: B1–B4]) e Coordenadora
 * Cora (Supervisora Selma [Sul: C1–C4, só C1 com dado], Supervisor Sílvio [Sul: D1, D2], com a CONTA inativa). Administradora
 * Ana: sem estrutura, papel ADMINISTRADOR no Grupo Norte (vê a equipe da Sara pelo acesso). A1 tem conta (operador).
 * Fechamento oficial jul–set/2026 de dois indicadores da prova e do PRV; um feed ACTIVE do fechamento oficial.
 *
 * O que prova, cenário a cenário (duas execuções seguidas: entrega e depois aviso de bases sem atualização):
 *  - entregas, destinatários, versões por escopo, avisos, impressão digital do cartão e resultado da execução IDÊNTICOS;
 *  - menos consultas no lote; numa estrutura fixa, o número de consultas não depende de quantos destinatários a veem;
 *  - a cobertura reaproveita o que a ferramenta leu (zero consultas) e devolve o mesmo número da leitura no banco;
 *  - o estado dos feeds sai numa consulta por execução.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const NOW = new Date("2026-10-18T12:00:00Z")
const PERIODS = ["2026-07", "2026-08", "2026-09"]

let pool: pg.Pool
let tag = ""
type Key = "org" | "norte" | "sul" | "tma" | "nps" | "marta" | "caio" | "cora" | "sara" | "saulo" | "selma" | "silvio" | "ana" | "a1"
const ids = {} as Record<Key, string>
const accounts = {} as Record<"marta" | "caio" | "cora" | "sara" | "saulo" | "selma" | "silvio" | "ana" | "a1", string>

async function cleanup() {
  const orgs = (await pool.query<{ id: string }>(`select id from organizations where slug like 'prova-report-lote-%'`)).rows.map((row) => row.id)
  if (orgs.length === 0) return
  const run = (sql: string) => pool.query(sql, [orgs])
  await run(`delete from employee_indicator_performance where organization_id = any($1)`)
  await run(`delete from employee_prv_performance where organization_id = any($1)`)
  await run(`delete from indicator_definitions where organization_id = any($1)`)
  await run(`delete from data_feeds where organization_id = any($1)`)
  await run(`delete from data_sources where organization_id = any($1)`)
  await run(`delete from access_role_assignments where organization_id = any($1)`)
  await run(`delete from user_accounts where organization_id = any($1)`)
  await run(`update people set reports_to_id = null where organization_id = any($1)`)
  await run(`delete from people where organization_id = any($1)`)
  await run(`delete from teams where organization_id = any($1)`)
  await run(`delete from operations where organization_id = any($1)`)
  await run(`delete from analytics_operational_dirty where organization_id = any($1)`)
  await run(`delete from organizations where id = any($1)`)
}

async function seed() {
  tag = randomUUID().slice(0, 8)
  const one = async (sql: string, params: unknown[]) => (await pool.query<{ id: string }>(sql, params)).rows[0]!.id
  const org = (ids.org = await one(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Prova Report em Lote ${tag}`, `prova-report-lote-${tag}`]))
  const operation = await one(`insert into operations (organization_id, name) values ($1, 'Operação da prova') returning id`, [org])
  ids.norte = await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Norte') returning id`, [org, operation])
  ids.sul = await one(`insert into teams (organization_id, operation_id, name) values ($1, $2, 'Sul') returning id`, [org, operation])
  const personRow = (name: string, role: string, reportsTo: string | null, team: string | null) => one(`insert into people (organization_id, name, role, reports_to_id, team_id, active) values ($1, $2, $3, $4, $5, true) returning id`, [org, name, role, reportsTo, team])
  ids.marta = await personRow("Marta Gerente", "MANAGER", null, null)
  ids.caio = await personRow("Caio Coordenador", "COORDINATOR", ids.marta, null)
  ids.cora = await personRow("Cora Coordenadora", "COORDINATOR", ids.marta, null)
  ids.sara = await personRow("Sara Supervisora", "SUPERVISOR", ids.caio, ids.norte)
  ids.saulo = await personRow("Saulo Supervisor", "SUPERVISOR", ids.caio, ids.norte)
  ids.selma = await personRow("Selma Supervisora", "SUPERVISOR", ids.cora, ids.sul)
  ids.silvio = await personRow("Sílvio Supervisor", "SUPERVISOR", ids.cora, ids.sul)
  ids.ana = await personRow("Ana Administradora", "ADMIN", null, null)
  const operators: { id: string; team: "A" | "B" | "C" | "D"; index: number }[] = []
  for (const [team, leader, group, size] of [["A", ids.sara, ids.norte, 4], ["B", ids.saulo, ids.norte, 4], ["C", ids.selma, ids.sul, 4], ["D", ids.silvio, ids.sul, 2]] as const) {
    for (let index = 1; index <= size; index += 1) operators.push({ id: await personRow(`Operador ${team}${index}`, "OPERATOR", leader, group), team, index })
  }
  ids.a1 = operators[0]!.id
  const account = (personId: string, key: string, active = true) => one(`insert into user_accounts (organization_id, person_id, email, password_hash, active) values ($1, $2, $3, 'x', $4) returning id`, [org, personId, `${key}-${tag}@prova-report-lote.test`, active])
  for (const key of ["marta", "caio", "cora", "sara", "saulo", "selma", "ana", "a1"] as const) accounts[key] = await account(ids[key], key)
  accounts.silvio = await account(ids.silvio, "silvio", false)
  await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at, source) values ($1, $2, 'ADMINISTRADOR', 'GROUP', $3, now(), 'MANUAL')`, [org, accounts.ana, ids.norte])
  ids.tma = await one(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, 'PROVA_LOTE_TMA', 'Tempo da prova', 'SECONDS', 'LOWER') returning id`, [org])
  ids.nps = await one(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, 'PROVA_LOTE_NPS', 'Nota da prova', 'POINTS', 'HIGHER') returning id`, [org])
  const quartile = (value: number) => (["Q1", "Q2", "Q3", "Q4"] as const)[value % 4]!
  for (const operator of operators) {
    // Equipe da Selma: só C1 tem fechamento (cobertura de 25% — o aviso de cobertura insuficiente).
    if (operator.team === "C" && operator.index > 1) continue
    for (const [periodIndex, period] of PERIODS.entries()) {
      const seedValue = operator.index * 7 + periodIndex * 3 + operator.team.charCodeAt(0)
      await pool.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, quartile) values ($1, $2, $3, $4, $5, 420, $6, $7)`, [org, operator.id, ids.tma, period, 380 + (seedValue % 90), 80 + (seedValue % 40), quartile(seedValue)])
      await pool.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, quartile) values ($1, $2, $3, $4, $5, 8, $6, $7)`, [org, operator.id, ids.nps, period, 5 + (seedValue % 5), 70 + (seedValue % 50), quartile(seedValue + 1)])
      await pool.query(`insert into employee_prv_performance (organization_id, person_id, reference_period, achievement_percent, quartile) values ($1, $2, $3, $4, $5)`, [org, operator.id, period, 85 + (seedValue % 30), quartile(seedValue + 2)])
    }
  }
  const source = await one(`insert into data_sources (organization_id, public_id, name, kind) values ($1, $2, 'Fonte da prova', 'API_PUSH') returning id`, [org, `prova-lote-${tag}`])
  await pool.query(`insert into data_feeds (organization_id, source_id, feed_key, name, contract_key, status, last_success_at, expected_interval_minutes) values ($1, $2, 'fechamento', 'Fechamento oficial da prova', 'OFFICIAL_INDICATOR_PERFORMANCE', 'ACTIVE', '2026-10-05T10:00:00Z', 1440)`, [org, source])
}

/** Banco que conta as idas (e o texto de cada uma) — o mesmo pool, sem mudar nada do que é lido. */
function countingDatabase() {
  const log: string[] = []
  const db = {
    query: (...args: unknown[]) => {
      log.push(String(args[0]).replace(/\s+/g, " ").trim())
      return (pool.query as (...params: unknown[]) => Promise<unknown>)(...args)
    },
    connect: () => pool.connect(),
  } as unknown as Database
  return { db, log }
}

/** O runtime com quem distribui alcançando a organização inteira (o recorte do público não é o que se prova aqui). */
function runtimeOver(db: Database): ReportRuntime {
  const runtime = createPostgresReportRuntime(db, () => NOW)
  return { ...runtime, distributionScope: async () => ({ organizationWide: true, teamIds: [], subteamIds: [] }) }
}

/** O caminho de antes: uma sessão por destinatário (`contextFor`) e a conta relida quando não há contexto. */
function perAccount(runtime: ReportRuntime): ReportRuntime {
  return {
    ...runtime,
    contextsFor: async (organizationId): Promise<RecipientContexts> => ({
      lookup: async (accountId) => {
        const context = await runtime.contextFor(organizationId, accountId)
        return { account: context ? context.account : await runtime.account(organizationId, accountId), context }
      },
    }),
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !["id", "runId", "reportId", "deliveryId", "createdAt", "updatedAt", "generatedAt", "lastCheckedAt"].includes(key)).map(([key, inner]) => [key, normalize(inner)]))
  return value
}

type Scenario = { owner: keyof typeof accounts; audience: unknown; definition: Record<string, unknown> }

/** Duas execuções seguidas do mesmo report (entrega e depois a regra de atualização) — entregas normalizadas e consultas. */
async function execute(runtime: ReportRuntime, log: string[], scenario: Scenario) {
  const memory = createMemoryReportStore()
  const ownerPerson = ids[scenario.owner]
  const report = await memory.store.createReport(
    {
      organizationId: ids.org, ownerAccountId: accounts[scenario.owner], ownerPersonId: ownerPerson, name: "Prova em lote", description: null, status: "ACTIVE", origin: "SCREEN", timeZone: "America/Fortaleza", nextRunAt: null, sourceProposalId: null,
      definition: reportDefinitionSchema.parse(scenario.definition),
      visualization: reportVisualizationSchema.parse({ type: "TABLE" }),
      schedule: reportScheduleSchema.parse({ frequency: "DAILY", times: ["08:00"] }),
      audience: scenario.audience as never,
      analysis: reportAnalysisSchema.parse({}),
    },
    accounts[scenario.owner],
  )
  const outcomes: unknown[] = []
  const queries: number[] = []
  for (let index = 0; index < 2; index += 1) {
    const queued = (await memory.store.enqueueRun({ organizationId: ids.org, reportId: report.id, scheduledFor: new Date(Date.UTC(2026, 9, 18 + index, 11)).toISOString(), triggerKind: "SCHEDULE", configVersion: 1 }))!
    const before = log.length
    outcomes.push(normalize(await executeReportRun({ store: memory.store, runtime, now: () => NOW }, queued)))
    queries.push(log.length - before)
  }
  const deliveries = [...memory.deliveries].sort((a, b) => `${a.scopeKey}|${a.kind}`.localeCompare(`${b.scopeKey}|${b.kind}`))
  const snapshot = deliveries.map((delivery) => ({ ...(normalize(delivery) as object), recipients: memory.recipients.filter((row) => row.deliveryId === delivery.id).map((row) => row.personId).sort() }))
  return { snapshot, outcomes, queries, feedQueries: log.filter((sql) => sql.includes("from data_feeds")).length }
}

async function compare(scenario: Scenario) {
  const reference = countingDatabase()
  const batch = countingDatabase()
  const before = await execute(perAccount(runtimeOver(reference.db)), reference.log, scenario)
  const after = await execute(runtimeOver(batch.db), batch.log, scenario)
  expect(after.snapshot).toEqual(before.snapshot)
  expect(after.outcomes).toEqual(before.outcomes)
  return { before, after }
}

const distribution = (people: (keyof typeof accounts)[]) => reportAudienceSchema.parse({ mode: "DISTRIBUTION", personIds: people.map((key) => ids[key]) })
const tmaQuery = { tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["PROVA_LOTE_TMA"], groupBy: "PESSOA", sortBy: "ATINGIMENTO", order: "ASC", limit: 5 }
const saraTeam = () => ({ mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: ids.sara, label: "Equipe da Sara" })

describe.skipIf(!ENABLED)("execução de report em lote × conta a conta — prova contra o banco de teste", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    await seed()
  })

  afterAll(async () => {
    await cleanup()
    await pool.end()
  })

  it("estrutura de quem recebe, 9 pessoas no público (6 estruturas, conta inativa, operador, acesso sem estrutura): mesmas entregas, menos consultas", async () => {
    const { before, after } = await compare({ owner: "ana", audience: distribution(["marta", "caio", "cora", "sara", "saulo", "selma", "silvio", "a1", "ana"]), definition: tmaQuery })
    const outcome = after.outcomes[0] as { status: string; outcome: { recipients: number; deliveries: number; notForwarded: { reason: string }[]; denied: { name: string; reason: string }[] } }
    expect(outcome.status).toBe("PARTIAL")
    // A conta inativa do Sílvio nem entra no público; os outros 8 são destinatários.
    expect(outcome.outcome.recipients).toBe(8)
    expect(outcome.outcome.deliveries + outcome.outcome.notForwarded.length).toBe(6)
    expect(outcome.outcome.notForwarded.map((item) => item.reason)).toContain("INSUFFICIENT_COVERAGE")
    expect(outcome.outcome.denied.map((item) => `${item.name}:${item.reason}`).sort()).toEqual(["Ana Administradora:NO_STRUCTURE", "Operador A1:NO_STRUCTURE"])
    expect((after.outcomes[1] as { status: string }).status).toBe("NOT_FORWARDED")
    expect(after.queries[0]).toBeLessThan(before.queries[0]!)
    expect(after.queries[1]).toBeLessThan(before.queries[1]!)
    // Estado das fontes: uma consulta de feeds por execução no lote; uma por grupo conta a conta.
    expect(after.feedQueries).toBe(2)
    expect(before.feedQueries).toBe(12)
  })

  it("estrutura fixa vista por vários (hierarquia e acesso pelo Grupo): um grupo, mesmas entregas, e o número de consultas não depende de quantos a veem", async () => {
    const definition = { ...tmaQuery, structure: saraTeam(), indicators: ["PROVA_LOTE_NPS"] }
    const many = await compare({ owner: "ana", audience: distribution(["marta", "caio", "sara", "ana", "saulo", "cora", "a1"]), definition })
    const outcome = many.after.outcomes[0] as { outcome: { deliveries: number; delivered: number; denied: { name: string; reason: string }[] } }
    expect(outcome.outcome).toMatchObject({ deliveries: 1, delivered: 4 })
    expect(outcome.outcome.denied.map((item) => `${item.name}:${item.reason}`).sort()).toEqual(["Cora Coordenadora:ACCESS_DENIED", "Operador A1:ACCESS_DENIED", "Saulo Supervisor:ACCESS_DENIED"])
    expect((many.after.snapshot[0] as { recipients: string[] }).recipients).toEqual([ids.ana, ids.caio, ids.marta, ids.sara].sort())
    const one = await compare({ owner: "ana", audience: distribution(["marta"]), definition })
    expect(many.after.queries).toEqual(one.after.queries)
    expect(many.before.queries[0]).toBeGreaterThan(one.before.queries[0]!)
  })

  it("report para si com estrutura fixa (o responsável também recebe), várias competências e dois indicadores: mesma entrega", async () => {
    const { before, after } = await compare({ owner: "sara", audience: { mode: "SELF" }, definition: { ...tmaQuery, structure: saraTeam(), period: { mode: "LAST_N_CLOSED", months: 3, display: "ULTIMA" }, indicators: ["PROVA_LOTE_TMA", "PROVA_LOTE_NPS"], groupBy: "PESSOA", limit: 10 } })
    expect((after.outcomes[0] as { status: string }).status).toBe("COMPLETED")
    expect(after.queries[0]).toBeLessThanOrEqual(before.queries[0]!)
  })

  it("quartis do PRV (cobertura pelo PRV) e força de trabalho (situação funcional): mesmas entregas", async () => {
    const quartiles = await compare({ owner: "ana", audience: distribution(["caio", "cora"]), definition: { tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, view: "QUARTIS", groupBy: "UNIDADE", limit: 20 } })
    expect(quartiles.after.queries[0]).toBeLessThan(quartiles.before.queries[0]!)
    const workforce = await compare({ owner: "ana", audience: distribution(["sara", "selma"]), definition: { tool: "WORKFORCE", structure: { mode: "RECIPIENT" }, period: { mode: "TODAY" }, groupBy: "SUPERVISOR", limit: 20 } })
    expect((workforce.after.outcomes[0] as { status: string }).status).toBe("COMPLETED")
    expect(workforce.after.queries[0]).toBeLessThan(workforce.before.queries[0]!)
  })

  it("cobertura: no lote reaproveita o que a ferramenta leu (nenhuma consulta) e dá o mesmo número que a leitura no banco", async () => {
    for (const definition of [reportDefinitionSchema.parse(tmaQuery), reportDefinitionSchema.parse({ ...tmaQuery, indicators: ["PRV"], view: "QUARTIS" })] as ReportDefinition[]) {
      const call = toToolCall(definition)
      const batch = countingDatabase()
      const contexts = await runtimeOver(batch.db).contextsFor(ids.org, [accounts.sara])
      const fromBatch = (await contexts.lookup(accounts.sara)).context!
      const card = (await fromBatch.runTool(call.name, call.args)).card as { period: string }
      const before = batch.log.length
      const reused = await fromBatch.coverage(fromBatch.ownStructure!, definition, card.period)
      expect(batch.log.length).toBe(before)

      const single = countingDatabase()
      const fromAccount = (await runtimeOver(single.db).contextFor(ids.org, accounts.sara))!
      const singleCard = (await fromAccount.runTool(call.name, call.args)).card as { period: string }
      const singleBefore = single.log.length
      const read = await fromAccount.coverage(fromAccount.ownStructure!, definition, singleCard.period)
      expect(single.log.length).toBeGreaterThan(singleBefore)
      expect(singleCard.period).toBe(card.period)
      expect(reused).toBe(read)
      expect(reused).toBe(1)
    }
  })
})
