import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import {
  aggregateAchievementClosures,
  aggregateAchievementHistory,
  findLatestIndicatorPerformance,
  findLatestPrvPerformance,
  findRecentIndicatorPerformance,
} from "../application/resolve-employee-performance.js"

/**
 * PROVA: os leitores de desempenho oficial ficam na organização da pessoa consultada. Duas organizações com o MESMO código
 * de indicador (o código é único só dentro da organização): antes, o subselect `code = $n` sem organização devolvia duas
 * linhas e a agregação falhava ("more than one row returned by a subquery"); agora cada pessoa lê só a definição e as
 * linhas da própria organização — e a leitura usa o índice que começa por `organization_id` em vez de varrer a tabela.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run employee-performance-organization-proof --no-file-parallelism
 *
 * Tudo roda numa transação desfeita no fim: nenhuma linha fica no banco de teste.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const id = (n: number) => `ee500000-0000-4000-8000-${n.toString().padStart(12, "0")}`
const ORG_A = id(1)
const ORG_B = id(2)
const INDICATOR_A = id(11)
const INDICATOR_B = id(12)
const PERSON_A = id(21)
const PERSON_B = id(22)
const CODE = "QA_ORG_ISOLATION"
const NOW = new Date("2026-10-17T12:00:00-03:00")
const TZ = "America/Sao_Paulo"

let pool: pg.Pool
let client: pg.PoolClient
let db: Database

describe.skipIf(!ENABLED)("desempenho oficial — isolamento por organização (banco de teste)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    db = client as unknown as Database
    await client.query("begin")
    await client.query(`insert into organizations (id, name, slug) values ($1, 'Org A prova', 'org-a-prova-ee5'), ($2, 'Org B prova', 'org-b-prova-ee5')`, [ORG_A, ORG_B])
    await client.query(
      `insert into indicator_definitions (id, organization_id, code, name, unit, desired_direction) values
         ($1, $3, $5, 'Isolamento A', 'PERCENT', 'HIGHER'), ($2, $4, $5, 'Isolamento B', 'PERCENT', 'HIGHER')`,
      [INDICATOR_A, INDICATOR_B, ORG_A, ORG_B, CODE],
    )
    await client.query(`insert into people (id, organization_id, name, role) values ($1, $3, 'Pessoa A', 'OPERATOR'), ($2, $4, 'Pessoa B', 'OPERATOR')`, [PERSON_A, PERSON_B, ORG_A, ORG_B])
    for (const [period, a, b] of [["2026-07", 70, 10], ["2026-08", 80, 20], ["2026-09", 90, 30]] as const) {
      await client.query(
        `insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, achievement_percent, quartile)
         values ($1, $2, $3, $7, $8, $8, 'Q1'), ($4, $5, $6, $7, $9, $9, 'Q4')`,
        [ORG_A, PERSON_A, INDICATOR_A, ORG_B, PERSON_B, INDICATOR_B, period, a, b],
      )
      await client.query(
        `insert into employee_prv_performance (organization_id, person_id, reference_period, achievement_percent, quartile) values ($1, $2, $5, $6, 'Q1'), ($3, $4, $5, $7, 'Q4')`,
        [ORG_A, PERSON_A, ORG_B, PERSON_B, period, a, b],
      )
    }
  })

  afterAll(async () => {
    await client?.query("rollback")
    client?.release()
    await pool?.end()
  })

  it("a última linha vem do indicador da organização da pessoa", async () => {
    const latest = await findLatestIndicatorPerformance(db, PERSON_A, CODE, NOW, TZ)
    expect(latest).toMatchObject({ indicatorDefinitionId: INDICATOR_A, referencePeriod: "2026-09", value: 90 })
    expect((await findLatestIndicatorPerformance(db, PERSON_B, CODE, NOW, TZ))?.indicatorDefinitionId).toBe(INDICATOR_B)
    expect((await findLatestPrvPerformance(db, PERSON_B, NOW, TZ))?.achievementPercent).toBe(30)
    expect((await findRecentIndicatorPerformance(db, PERSON_A, CODE, NOW, 3, TZ)).map((row) => row.value)).toEqual([90, 80, 70])
  })

  it("agregar o histórico com o código repetido em outra organização não falha e não mistura organizações", async () => {
    const history = await aggregateAchievementHistory(db, "employee_indicator_performance", [PERSON_A], CODE, new Date("2026-07-01T03:00:00Z"), new Date("2026-10-01T03:00:00Z"), NOW, TZ)
    expect(history).toEqual({ avg: 80, min: 70, max: 90, count: 3 })
    const closures = await aggregateAchievementClosures(db, "employee_indicator_performance", [PERSON_B], CODE, 2, NOW, TZ)
    expect(closures).toMatchObject({ avg: 25, min: 20, max: 30, sampleCount: 2, totalClosures: 2 })
    const prv = await aggregateAchievementClosures(db, "employee_prv_performance", [PERSON_A], undefined, 3, NOW, TZ)
    expect(prv).toMatchObject({ avg: 80, sampleCount: 3, totalClosures: 3 })
  })

  it("a leitura de uma pessoa usa o índice da organização, não a tabela inteira", async () => {
    // Mesmo SQL do leitor; o plano com seq scan era o de antes (sem organization_id).
    const plan = await client.query<{ "QUERY PLAN": string }>(
      `explain (costs off) select eip.id from employee_indicator_performance eip
       where eip.organization_id = (select p.organization_id from people p where p.id = $1) and eip.person_id = $1 and eip.reference_period <= '2026-09'
       order by eip.reference_period desc limit 1`,
      [PERSON_A],
    )
    const text = plan.rows.map((row) => row["QUERY PLAN"]).join("\n")
    expect(text).not.toMatch(/Seq Scan on employee_indicator_performance/)
  })
})
