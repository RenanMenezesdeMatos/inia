import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOperationalWindowBySubject } from "../../indicators/application/operational-measurement-resolver.js"
import { resolveTimeWindow } from "../../workflows/application/time-window.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { employmentStatusOn } from "../domain/employment-status.js"
import { applyEmployeeStatusSnapshot, loadEmploymentStatusHistory } from "./employment-status-service.js"

/**
 * Integração real (inia_test, migrations 058 e 062 aplicadas): o serviço canônico de situação
 * funcional com a exclusion constraint de verdade e as nove situações reais (EM_PRODUCAO, FERIAS,
 * ATIVIDADE_OFF…). Ligado por INIA_DB_PROOF=1 (mesma chave das provas
 * contra banco); sem ela, os testes puros do domínio (employment-status.test.ts) continuam rodando.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "de00ee00-0000-4000-8000-0000000000e1"
const TZ = "America/Fortaleza"

describe.skipIf(!ENABLED)("applyEmployeeStatusSnapshot — histórico de situação funcional (banco real)", () => {
  let pool: pg.Pool
  let db: Database
  const cleanup = async () => {
    await pool.query(`delete from indicator_measurements where subject_id = $1`, [PERSON])
    await pool.query(`delete from employee_status_periods where person_id = $1`, [PERSON])
    await pool.query(`delete from people where id = $1`, [PERSON])
  }
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    await cleanup()
    await pool.query(`insert into people (id, organization_id, name, role, active, hired_at) values ($1, $2, 'Teste Situação', 'OPERATOR', true, '2026-01-05')`, [PERSON, ORG])
  })
  afterAll(async () => {
    await cleanup()
    await pool.end()
  })
  const history = () => loadEmploymentStatusHistory(db, PERSON).then((periods) => periods.map((period) => [period.status, period.effectiveFrom, period.effectiveTo, period.effectiveFromInferred]))

  it("EM PRODUÇÃO (sexta, sem data) → FÉRIAS (segunda, sem data): EM PRODUÇÃO fecha no domingo, FÉRIAS vale a partir da observação — a sexta anterior NÃO é excluída por suposição", async () => {
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, rawStatus: "EM PRODUÇÃO", observedAt: new Date("2026-09-04T13:00:00-03:00"), source: "TEST", timeZone: TZ })
    const vacation = await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, rawStatus: "FÉRIAS", observedAt: new Date("2026-09-07T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    expect(vacation.action).toBe("CREATED")
    expect(vacation.period.effectiveFromInferred).toBe(true)
    expect(await history()).toEqual([
      ["EM_PRODUCAO", "2026-09-04", "2026-09-06", true],
      ["FERIAS", "2026-09-07", null, true],
    ])
  })

  it("mesmo snapshot FÉRIAS 2× → um único intervalo lógico (só freshness)", async () => {
    const again = await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, rawStatus: "FERIAS", observedAt: new Date("2026-09-09T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    expect(again.action).toBe("REFRESHED")
    expect((await history()).filter((row) => row[0] === "FERIAS")).toHaveLength(1)
    expect(new Date(again.period.observedAt).toISOString()).toBe("2026-09-09T12:00:00.000Z")
  })

  it("FÉRIAS → EM PRODUÇÃO com data efetiva explícita: férias fecham na véspera, EM PRODUÇÃO abre na data", async () => {
    const back = await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, status: "EM_PRODUCAO", effectiveFrom: "2026-09-21", observedAt: new Date("2026-09-22T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    expect(back.action).toBe("CREATED")
    expect(back.period.effectiveFromInferred).toBe(false)
    expect(await history()).toEqual([
      ["EM_PRODUCAO", "2026-09-04", "2026-09-06", true],
      ["FERIAS", "2026-09-07", "2026-09-20", true],
      ["EM_PRODUCAO", "2026-09-21", null, false],
    ])
  })

  it("correção da fonte (FÉRIAS 07–20 → 10–20, datas explícitas): período ajustado, vizinho EM PRODUÇÃO anterior estende até 09, nada sobrepõe", async () => {
    const fixed = await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, status: "FERIAS", effectiveFrom: "2026-09-10", effectiveTo: "2026-09-20", observedAt: new Date("2026-09-23T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    expect(fixed.action).toBe("ADJUSTED")
    expect(await history()).toEqual([
      ["EM_PRODUCAO", "2026-09-04", "2026-09-09", true],
      ["FERIAS", "2026-09-10", "2026-09-20", false],
      ["EM_PRODUCAO", "2026-09-21", null, false],
    ])
  })

  it("período explícito no meio de um EM PRODUÇÃO em aberto (ATIVIDADE OFF 25–26) divide o EM PRODUÇÃO em cabeça e cauda; situação atual segue o dia de hoje", async () => {
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, rawStatus: "ATIVIDADE OFF", effectiveFrom: "2026-09-25", effectiveTo: "2026-09-26", observedAt: new Date("2026-09-24T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    expect(await history()).toEqual([
      ["EM_PRODUCAO", "2026-09-04", "2026-09-09", true],
      ["FERIAS", "2026-09-10", "2026-09-20", false],
      ["EM_PRODUCAO", "2026-09-21", "2026-09-24", false],
      ["ATIVIDADE_OFF", "2026-09-25", "2026-09-26", false],
      ["EM_PRODUCAO", "2026-09-27", null, false],
    ])
    const person = await pool.query<{ current_employment_status: string }>(`select current_employment_status from people where id = $1`, [PERSON])
    const periods = await loadEmploymentStatusHistory(db, PERSON)
    expect(person.rows[0]!.current_employment_status).toBe(employmentStatusOn(periods, localDateOf(new Date(), TZ)))
  })

  it("medição diária recebida DURANTE as férias permanece no banco e fica fora do cálculo (SQL real com a cláusula de elegibilidade); ao corrigir a situação ela volta a contar", async () => {
    const tma = await pool.query<{ id: string }>(`select id from indicator_definitions where code = 'TMA' and organization_id = $1`, [ORG])
    const definitionId = tma.rows[0]!.id
    // 3 dias de TMA: 14/09 (seg, ativo), 15/09 (ter, ativo) e 16/09 (qua) — 16/09 vira férias abaixo.
    for (const [date, value] of [["2026-09-14", 400], ["2026-09-15", 420], ["2026-09-16", 900]] as const) {
      await pool.query(
        `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator, sample_count)
         values ($1, $2, 'PERSON', $3, $4::numeric, ($5::text || 'T00:00:00-03:00')::timestamptz, ($5::text || 'T23:59:59-03:00')::timestamptz, 'TEST', 'DAILY', $4::numeric * 10, 10, 10)`,
        [ORG, definitionId, PERSON, value, date],
      )
    }
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, status: "FERIAS", effectiveFrom: "2026-09-16", effectiveTo: "2026-09-18", observedAt: new Date("2026-09-16T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    const window = resolveTimeWindow({ kind: "ROLLING_DAYS", days: 5 }, new Date("2026-09-18T18:00:00-03:00"), TZ) // 14/09 → 18/09
    const during = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: [PERSON], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5, timeZone: TZ })).get(PERSON)!
    expect(during.daysWithData).toBe(2)
    expect(during.value).toBe(410) // 900 de 16/09 fora — sem apagar nada
    expect(during.eligibility).toMatchObject({ businessDays: 5, eligibleDays: 2, excludedByStatus: { FERIAS: 3 } })
    expect(during.coverage).toBe(1)
    const stillThere = await pool.query<{ n: string }>(`select count(*) n from indicator_measurements where subject_id = $1`, [PERSON])
    expect(Number(stillThere.rows[0]!.n)).toBe(3)
    // Correção: férias começaram na quinta (17/09) — a medição de 16/09 volta a contar, intacta.
    await applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, status: "FERIAS", effectiveFrom: "2026-09-17", effectiveTo: "2026-09-18", observedAt: new Date("2026-09-17T09:00:00-03:00"), source: "TEST", timeZone: TZ })
    const corrected = (await resolveOperationalWindowBySubject(db, { indicatorCode: "TMA", subjectIds: [PERSON], window, aggregation: "WEIGHTED_AVERAGE", expectedDays: 5, timeZone: TZ })).get(PERSON)!
    expect(corrected.daysWithData).toBe(3)
    expect(corrected.eligibility?.eligibleDays).toBe(3)
    expect(Math.round(corrected.value!)).toBe(573) // (400 + 420 + 900) ÷ 3
  })

  it("status bruto desconhecido ou ambíguo é recusado (nunca vira EM PRODUÇÃO por palpite; a fonte mapeia os códigos dela no feed)", async () => {
    for (const rawStatus of ["SEI LA", "ATIVO", "AFASTADO", "LICENÇA"]) {
      await expect(applyEmployeeStatusSnapshot(db, { organizationId: ORG, personId: PERSON, rawStatus, source: "TEST" })).rejects.toThrow(/não reconhecida/)
    }
  })
})
