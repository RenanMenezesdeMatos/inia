import type pg from "pg"
import { describe, expect, it } from "vitest"
import type { CanonicalRecord } from "../../domain/data-contract.js"
import { OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT_V1 } from "../../domain/contracts/performance-contracts.js"
import { mapRecord } from "../../domain/mapping.js"
import type { ValidRecord, WriteContext } from "./domain-writer.js"
import { indicatorMeasurementsWriter, officialIndicatorPerformanceWriter } from "./performance-writers.js"

/**
 * Fechamento oficial com numerador e denominador (contrato @2): a regra em volta do SQL. O SQL de
 * verdade é provado contra o banco de teste em testing/data-hub-proof.test.ts.
 */
const TZ = "America/Fortaleza"
const identity = (keys: readonly string[]) => ({ fields: keys.map((key) => ({ target: key, source: key, transforms: [] })) })
const V2_KEYS = OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT.fields.map((field) => field.key)
const V1_KEYS = OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT_V1.fields.map((field) => field.key)

/** Indicadores de teste por COMPORTAMENTO — os códigos são dados inventados aqui, nunca do catálogo real. */
const INDICATORS = [
  { id: "ind-rate", code: "TEST_RATE", unit: "PERCENT", direction: "HIGHER", aggregation: "RATE", dailySupported: false, officialClosureSupported: true, active: true },
  { id: "ind-time", code: "TEST_TIME", unit: "SECONDS", direction: "LOWER", aggregation: "WEIGHTED_AVERAGE", dailySupported: true, officialClosureSupported: true, active: true },
  { id: "ind-snapshot", code: "TEST_SNAPSHOT", unit: "CASES", direction: "LOWER", aggregation: "LATEST", dailySupported: true, officialClosureSupported: true, active: true },
  { id: "ind-daily-rate", code: "TEST_DAILY_RATE", unit: "PERCENT", direction: "HIGHER", aggregation: "RATE", dailySupported: true, officialClosureSupported: true, active: true },
  { id: "ind-sum", code: "TEST_SUM", unit: "COUNT", direction: "HIGHER", aggregation: "SUM", dailySupported: true, officialClosureSupported: true, active: true },
  { id: "ind-average", code: "TEST_AVERAGE", unit: "POINTS", direction: "HIGHER", aggregation: "AVERAGE", dailySupported: true, officialClosureSupported: true, active: true },
]

function writeContext(): WriteContext {
  const db = {
    query: async (sql: string) => {
      if (sql.includes("from people")) return { rows: [{ id: "p-1", matricula: "OP-1", teamId: "t-1", subteamId: "s-1", role: "OPERATOR", active: true }] }
      if (sql.includes("from indicator_definitions")) return { rows: INDICATORS }
      return { rows: [] }
    },
  }
  return { ctx: { db }, organizationId: "org-1", timeZone: TZ, feed: { id: "feed-1" }, runId: "run-1", sourceNamespace: "fonte-a" } as unknown as WriteContext
}

let recordNumber = 0
function valid(record: CanonicalRecord): ValidRecord {
  recordNumber += 1
  return { recordNumber, sourceRecordKey: String(record.externalEmployeeId), record }
}

const closure = (indicatorCode: string, value: number, components: { numerator?: number; denominator?: number } = {}, referencePeriod = "2026-08"): CanonicalRecord => ({
  externalEmployeeId: "OP-1",
  indicatorCode,
  referencePeriod,
  value,
  numerator: components.numerator ?? null,
  denominator: components.denominator ?? null,
  targetValue: null,
  achievementPercent: null,
  weightPercent: null,
  quartile: null,
  subgroupExternalCode: null,
})

describe("contrato do fechamento oficial — versões", () => {
  it("@2 mapeia numerador e denominador; os dois vêm juntos e o denominador é positivo (regra pura)", () => {
    const ok = mapRecord(OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, identity(V2_KEYS), { externalEmployeeId: "OP-1", indicatorCode: "TEST_TIME", referencePeriod: "2026-08", value: "468", numerator: "380016", denominator: "812" }, { timeZone: TZ })
    expect(ok.errors).toEqual([])
    expect(ok.record).toMatchObject({ value: 468, numerator: 380016, denominator: 812 })
    const alone = mapRecord(OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, identity(V2_KEYS), { externalEmployeeId: "OP-1", indicatorCode: "TEST_TIME", referencePeriod: "2026-08", value: "468", numerator: "380016" }, { timeZone: TZ })
    expect(alone.errors).toEqual([{ code: "DATA_CONTRACT_VIOLATION", field: "denominator", message: "Numerador e denominador vêm juntos: informe os dois ou nenhum." }])
    const onlyDenominator = mapRecord(OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, identity(V2_KEYS), { externalEmployeeId: "OP-1", indicatorCode: "TEST_TIME", referencePeriod: "2026-08", value: "468", denominator: "812" }, { timeZone: TZ })
    expect(onlyDenominator.errors.map((error) => error.field)).toEqual(["numerator"])
    const zero = mapRecord(OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, identity(V2_KEYS), { externalEmployeeId: "OP-1", indicatorCode: "TEST_TIME", referencePeriod: "2026-08", value: "0", numerator: "0", denominator: "0" }, { timeZone: TZ })
    expect(zero.errors).toEqual([{ code: "DATA_CONTRACT_VIOLATION", field: "denominator", message: "Denominador precisa ser maior que zero." }])
    // Sem componentes continua válido: fechamento oficial nunca é perdido por falta de dado opcional.
    expect(mapRecord(OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT, identity(V2_KEYS), { externalEmployeeId: "OP-1", indicatorCode: "TEST_TIME", referencePeriod: "2026-08", value: "468" }, { timeZone: TZ }).errors).toEqual([])
  })

  it("@1 continua aceito e não conhece os componentes: colunas extras na origem nunca entram no registro", () => {
    const mapped = mapRecord(OFFICIAL_INDICATOR_PERFORMANCE_CONTRACT_V1, identity([...V1_KEYS, "numerator", "denominator"]), { externalEmployeeId: "OP-1", indicatorCode: "TEST_TIME", referencePeriod: "2026-08", value: "468", numerator: "1", denominator: "999" }, { timeZone: TZ })
    expect(mapped.errors).toEqual([])
    expect(mapped.record).not.toHaveProperty("numerator")
    expect(mapped.record).not.toHaveProperty("denominator")
  })
})

describe("writer do fechamento oficial — componentes validados pela ESTRATÉGIA do catálogo", () => {
  it("guarda numerador e denominador como vieram quando conferem com o valor (tolerância de arredondamento)", async () => {
    const { ready, rejections } = await officialIndicatorPerformanceWriter.prepare(writeContext(), [
      valid(closure("TEST_TIME", 468, { numerator: 380016, denominator: 812 })),
      valid(closure("TEST_RATE", 85, { numerator: 690, denominator: 812 }, "2026-07")), // 84,98% informado como 85
      valid(closure("TEST_RATE", 2, { numerator: 12, denominator: 500 }, "2026-06")), // 2,4% informado sem casas
    ])
    expect(rejections).toEqual([])
    expect(ready.map((row) => [row.value, row.numerator, row.denominator])).toEqual([[468, 380016, 812], [85, 690, 812], [2, 12, 500]])
  })

  it("sem componentes o fechamento entra com nulos, qualquer que seja a estratégia (contrato @1 ou @2 sem as colunas)", async () => {
    const { ready, rejections } = await officialIndicatorPerformanceWriter.prepare(writeContext(), [valid(closure("TEST_TIME", 468)), valid(closure("TEST_SNAPSHOT", 12, {}, "2026-07"))])
    expect(rejections).toEqual([])
    expect(ready.map((row) => [row.numerator, row.denominator])).toEqual([[null, null], [null, null]])
  })

  it("incoerência vai inteira para a quarentena com o motivo — nunca corrige o valor oficial nem os componentes", async () => {
    const { ready, rejections } = await officialIndicatorPerformanceWriter.prepare(writeContext(), [
      valid(closure("TEST_RATE", 90, { numerator: 9, denominator: 20 })),
      valid(closure("TEST_TIME", 468, { numerator: 9900, denominator: 20 }, "2026-07")),
      valid(closure("TEST_RATE", 2.1, { numerator: 12, denominator: 500 }, "2026-06")),
    ])
    expect(ready).toEqual([])
    expect(rejections.map((rejection) => [rejection.error.code, rejection.error.field])).toEqual([["DATA_CONTRACT_VIOLATION", "value"], ["DATA_CONTRACT_VIOLATION", "value"], ["DATA_CONTRACT_VIOLATION", "value"]])
    expect(rejections[0]!.error.message).toBe("Valor oficial 90 não confere com numerador ÷ denominador (9 ÷ 20 × 100 = 45; tolerância ±0,5). O fechamento não foi gravado: a INIA nunca corrige o valor oficial nem os componentes.")
    expect(rejections[1]!.error.message).toContain("(9.900 ÷ 20 = 495;")
  })

  it("estratégia que não define o valor por componentes recusa numerador e denominador com o motivo", async () => {
    const { ready, rejections } = await officialIndicatorPerformanceWriter.prepare(writeContext(), [valid(closure("TEST_SNAPSHOT", 12, { numerator: 12, denominator: 1 }))])
    expect(ready).toEqual([])
    expect(rejections[0]!.error).toEqual({ code: "DATA_CONTRACT_VIOLATION", field: "numerator", message: expect.stringContaining('A estratégia "Último valor" do indicador "TEST_SNAPSHOT" não define o valor por numerador e denominador') })
  })

  it("apply grava os componentes no mesmo upsert e só mantém os antigos quando o valor oficial não mudou", async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params })
        return { rows: [{ id: "eip-1", key: "p-1|ind-time|2026-08", inserted: true }, { id: "eip-2", key: "p-1|ind-rate|2026-07", inserted: false }], rowCount: 2 }
      },
    } as unknown as pg.PoolClient
    const context = writeContext()
    const { ready } = await officialIndicatorPerformanceWriter.prepare(context, [valid(closure("TEST_TIME", 468, { numerator: 380016, denominator: 812 })), valid(closure("TEST_RATE", 80, {}, "2026-07"))])
    const outcome = await officialIndicatorPerformanceWriter.apply(context, client, ready)
    expect(outcome).toMatchObject({ inserted: 1, updated: 1, unchanged: 0, businessMaxEventTime: "2026-09-01T00:00:00.000Z" })
    const [{ sql, params }] = calls as [{ sql: string; params: unknown[] }]
    expect(params.slice(11)).toEqual([[380016, null], [812, null]])
    expect(sql).toContain("numerator = case when excluded.numerator is null and excluded.value = employee_indicator_performance_all.value then employee_indicator_performance_all.numerator else excluded.numerator end")
    expect(sql).toContain("or (excluded.numerator is not null and (employee_indicator_performance_all.numerator is distinct from excluded.numerator")
  })
})

const measurement = (indicatorCode: string, value: number, components: { numerator?: number; denominator?: number } = {}, date = "2026-09-15"): CanonicalRecord => ({
  externalEmployeeId: "OP-1",
  indicatorCode,
  date,
  periodStart: null,
  periodEnd: null,
  granularity: null,
  value,
  numerator: components.numerator ?? null,
  denominator: components.denominator ?? null,
  sampleCount: null,
})

describe("writer de medições — a mesma regra de componentes do fechamento oficial", () => {
  it.each(["TEST_SUM", "TEST_AVERAGE", "TEST_SNAPSHOT"])("estratégia sem componentes (%s): numerador e denominador vão para a quarentena com a mensagem do fechamento", async (code) => {
    const context = writeContext()
    const measured = await indicatorMeasurementsWriter.prepare(context, [valid(measurement(code, 450, { numerator: 8100, denominator: 18 }))])
    const closed = await officialIndicatorPerformanceWriter.prepare(context, [valid(closure(code, 450, { numerator: 8100, denominator: 18 }))])
    expect(measured.ready).toEqual([])
    expect(measured.rejections[0]!.error).toEqual({ code: "DATA_CONTRACT_VIOLATION", field: "numerator", message: expect.stringContaining(`do indicador "${code}" não define o valor por numerador e denominador`) })
    expect(measured.rejections[0]!.error).toEqual(closed.rejections[0]!.error)
  })

  it("sem componentes, as mesmas estratégias aceitam a medição, e a amostra continua opcional", async () => {
    const { ready, rejections } = await indicatorMeasurementsWriter.prepare(writeContext(), [valid(measurement("TEST_SUM", 35)), valid(measurement("TEST_AVERAGE", 4.5, {}, "2026-09-14")), valid(measurement("TEST_SNAPSHOT", 12, {}, "2026-09-13"))])
    expect(rejections).toEqual([])
    expect(ready.map((row) => [row.value, row.numerator, row.denominator])).toEqual([[35, null, null], [4.5, null, null], [12, null, null]])
  })

  it("Taxa e Média ponderada exigem os componentes e conferem o valor com a tolerância do fechamento", async () => {
    const { ready, rejections } = await indicatorMeasurementsWriter.prepare(writeContext(), [
      valid(measurement("TEST_TIME", 450)),
      valid(measurement("TEST_TIME", 450, { numerator: 8100, denominator: 18 }, "2026-09-14")),
      valid(measurement("TEST_TIME", 900, { numerator: 8100, denominator: 18 }, "2026-09-13")),
      valid(measurement("TEST_DAILY_RATE", 2, { numerator: 12, denominator: 500 }, "2026-09-12")), // 2,4% informado sem casas: arredondamento
      valid(measurement("TEST_DAILY_RATE", 90, { numerator: 9, denominator: 20 }, "2026-09-11")),
    ])
    expect(ready.map((row) => row.value)).toEqual([450, 2])
    expect(rejections.map((rejection) => [rejection.error.code, rejection.error.field])).toEqual([["DATA_COMPONENT_MISSING", "numerator"], ["DATA_CONTRACT_VIOLATION", "value"], ["DATA_CONTRACT_VIOLATION", "value"]])
    expect(rejections[1]!.error.message).toBe("Valor 900 não confere com numerador ÷ denominador (8.100 ÷ 18 = 450; tolerância ±4,5). A medição não foi gravada.")
  })

  it("dia sem elegíveis (denominador zero) não vira incoerência: a conta só existe na soma do período", async () => {
    const { ready, rejections } = await indicatorMeasurementsWriter.prepare(writeContext(), [valid(measurement("TEST_DAILY_RATE", 0, { numerator: 0, denominator: 0 }))])
    expect(rejections).toEqual([])
    expect(ready).toHaveLength(1)
  })

  it("continua recusando valor fora da faixa da unidade", async () => {
    const { rejections } = await indicatorMeasurementsWriter.prepare(writeContext(), [valid(measurement("TEST_DAILY_RATE", 150, { numerator: 150, denominator: 100 })), valid(measurement("TEST_TIME", -1, { numerator: -18, denominator: 18 }))])
    expect(rejections.map((rejection) => rejection.error.message)).toEqual(["Percentual precisa estar entre 0 e 100.", "Tempo em segundos não pode ser negativo."])
  })
})
