import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadIndicatorOperationalDefinition, resolveOperationalClosedMonths, resolveOperationalWindowBySubject } from "../application/operational-measurement-resolver.js"

/**
 * PROVA (isolamento entre organizações) contra o banco de TESTE real: duas organizações com o MESMO
 * código de indicador e definições opostas; a OUTRA organização é a mais antiga, então a busca antiga
 * pelo código sozinho (`order by created_at limit 1`) devolvia a definição dela. Tudo numa transação
 * desfeita ao final (nada fica no banco).
 *   INIA_DB_PROOF=1 npx vitest run indicator-definition-organization-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OTHER_ORG = "c0000000-0000-4000-8000-000000000001"
const CODE = "TEST_XORG_DEFINITION"
const TZ = "America/Fortaleza"
const PERSON = "c0000000-0000-4000-8000-000000000021"
const MONTH = { start: new Date("2026-08-01T00:00:00-03:00"), end: new Date("2026-09-01T00:00:00-03:00") }
const NOW = new Date("2026-09-16T15:00:00-03:00")

let client: pg.Client
let db: Database
let ownId = ""

describe.skipIf(!ENABLED)("prova — definição operacional do indicador presa à organização", () => {
  beforeAll(async () => {
    client = new pg.Client({ connectionString: env.TEST_DATABASE_URL })
    await client.connect()
    db = client as unknown as Database
    await client.query("begin")
    await client.query(`insert into organizations (id, name, slug, created_at) values ($1, 'Outra organização (prova)', 'prova-outra-org-xorg', '2000-01-01')`, [OTHER_ORG])
    // A OUTRA organização: linha mais antiga, direção/estratégia/política opostas.
    await client.query(
      `insert into indicator_definitions_all (organization_id, code, name, unit, desired_direction, operational_aggregation, daily_supported, unjustified_absence_policy, created_at)
       values ($1, $2, 'Indicador de outra organização', 'SECONDS', 'LOWER', 'SUM', true, 'ZERO_CONTRIBUTION', '2000-01-01')`,
      [OTHER_ORG, CODE],
    )
    const own = await client.query<{ id: string }>(
      `insert into indicator_definitions_all (organization_id, code, name, unit, desired_direction, operational_aggregation, daily_supported, unjustified_absence_policy)
       values ($1, $2, 'Indicador desta organização', 'SECONDS', 'HIGHER', 'WEIGHTED_AVERAGE', true, 'NO_SAMPLE') returning id`,
      [ORG, CODE],
    )
    ownId = own.rows[0]!.id
    await client.query(`insert into people (id, organization_id, name, role, hired_at) values ($1, $2, 'Operador prova xorg', 'OPERATOR', '2020-01-01')`, [PERSON, ORG])
    // Uma medição diária (escala explícita) num mês fechado, pela definição DESTA organização.
    const day = { start: "2026-08-10T00:00:00-03:00", end: "2026-08-11T00:00:00-03:00" }
    await client.query(`insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, source) values ($1, $2, '2026-08-10', true, 'QA_PROOF_XORG')`, [ORG, PERSON])
    await client.query(
      `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator)
       values ($1, $2, 'PERSON', $3, 300, $4, $5, 'QA_PROOF_XORG', 'DAILY', 600, 2)`,
      [ORG, ownId, PERSON, day.start, day.end],
    )
  })

  afterAll(async () => {
    if (!client) return
    await client.query("rollback")
    await client.end()
  })

  it("a definição lida é a da organização pedida — nunca a mais antiga com o mesmo código", async () => {
    expect(await loadIndicatorOperationalDefinition(db, ORG, CODE)).toMatchObject({ id: ownId, direction: "HIGHER", kind: "WEIGHTED_AVERAGE", unjustifiedAbsencePolicy: "NO_SAMPLE" })
    expect(await loadIndicatorOperationalDefinition(db, OTHER_ORG, CODE)).toMatchObject({ direction: "LOWER", kind: "SUM", unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" })
  })

  it("meses fechados casam as medições pela definição DESTA organização (antes: a da outra, e o mês virava SEM DADOS)", async () => {
    const result = await resolveOperationalClosedMonths(db, { organizationId: ORG, indicatorCode: CODE, subjectIds: [PERSON], months: [MONTH], aggregation: "WEIGHTED_AVERAGE", timeZone: TZ, now: NOW })
    expect(result.monthsWithData).toBe(1)
    expect(result.total.sampleCount).toBeGreaterThan(0)
    expect(result.total.kind).toBe("WEIGHTED_AVERAGE")
  })

  it("janela sem definição em mãos aplica a estratégia e a política de falta DESTA organização", async () => {
    const bySubject = await resolveOperationalWindowBySubject(db, { indicatorCode: CODE, subjectIds: [PERSON], window: MONTH, aggregation: "WEIGHTED_AVERAGE", timeZone: TZ, now: NOW }, { organizationId: ORG })
    const result = bySubject.get(PERSON)!
    expect(result.kind).toBe("WEIGHTED_AVERAGE")
    expect(result.unjustifiedAbsence.policy).toBe("NO_SAMPLE")
  })
})
