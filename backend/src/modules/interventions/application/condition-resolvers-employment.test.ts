import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"

const statusAt = vi.hoisted(() => ({ status: "INSS", basis: "PERIOD", confirmed: true }))
vi.mock("../../people/application/employment-status-service.js", () => ({ resolveEmployeeStatusAt: async () => statusAt }))
vi.mock("../../people/application/employment-status-freshness.js", () => ({ resolveEmploymentStatusFreshness: async () => ({ state: "FRESH", lastSuccessLocalDate: "2026-10-29" }) }))
vi.mock("../../indicators/application/operational-measurement-resolver.js", () => ({
  resolveEligibleDaysBySubject: async (_db: unknown, personIds: string[]) =>
    new Map(personIds.map((id) => [id, { eligibleDays: 10, scheduledWorkDays: 18, excludedByStatus: { INSS: 3, MATERNIDADE: 2, FERIAS: 3 }, statusConfidence: { unconfirmedDays: 0 }, scheduleConfidence: { unknownScheduleDays: 0 } }])),
}))
// A condição de indicador espalha a avaliação nos fatos — inclusive a elegibilidade da medição operacional por situação.
vi.mock("../../workflows/application/condition-evaluator.js", () => ({
  evaluateDataCondition: async () => ({ branch: "false", evaluation: { kind: "historical_count", count: 0, eligibility: { eligibleDays: 1, excludedByStatus: { INSS: 29, FERIAS: 1 } }, statuses: ["PATERNIDADE"] } }),
}))

const { createConditionResolver } = await import("./condition-resolvers.js")
const db = { query: async () => ({ rows: [{ active: true }] }) } as unknown as Database
const subject = { organizationId: "org-1", personId: "p-1", policyIndicatorCode: null, subjectKey: "GENERAL", asOf: new Date("2026-10-29T12:00:00Z"), timeZone: "America/Sao_Paulo" } as never

// Achado APPSEC-01 (29/10/2026): a simulação de política devolvia "não elegível (INSS)" de um líder a quem não tem people.manage.
describe("condição de situação funcional — o tipo do afastamento sensível nunca sai da avaliação", () => {
  it.each(["INSS", "MATERNIDADE", "PATERNIDADE"])("%s: decisão igual, resumo e fatos só com 'motivo protegido'", async (status) => {
    statusAt.status = status
    const outcome = await createConditionResolver(db, subject)({ kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: true } as never)
    expect(outcome.status).toBe("NOT_MET")
    expect(outcome.facts).toMatchObject({ status: "AFASTAMENTO_PROTEGIDO" })
    expect(outcome.summary).toContain("não elegível (afastamento — motivo protegido)")
    expect(JSON.stringify(outcome)).not.toMatch(/INSS|MATERNIDADE|PATERNIDADE/)
  })

  it("situação não sensível continua com o nome (férias)", async () => {
    statusAt.status = "FERIAS"
    const outcome = await createConditionResolver(db, subject)({ kind: "EMPLOYMENT", check: "CURRENTLY_ELIGIBLE", expected: false } as never)
    expect(outcome).toMatchObject({ status: "MET", facts: { status: "FERIAS" } })
    expect(outcome.summary).toContain("não elegível (FERIAS)")
  })

  it("condição de indicador: a elegibilidade por situação que vem da medição também sai protegida (reteste dinâmico do APPSEC-01)", async () => {
    const outcome = await createConditionResolver(db, subject)({ kind: "INDICATOR", criterion: { comparator: "GT", historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "TMA", aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 30 }, compareTo: { kind: "GOAL" } } } } as never)
    expect(outcome.facts).toMatchObject({ eligibility: { eligibleDays: 1, excludedByStatus: { AFASTAMENTO_PROTEGIDO: 29, FERIAS: 1 } }, statuses: ["AFASTAMENTO_PROTEGIDO"] })
    expect(JSON.stringify(outcome)).not.toMatch(/INSS|MATERNIDADE|PATERNIDADE/)
  })

  it("dias elegíveis: os dias fora por afastamento sensível são somados numa chave protegida", async () => {
    const outcome = await createConditionResolver(db, subject)({ kind: "EMPLOYMENT", check: "ELIGIBLE_DAYS", period: { kind: "ROLLING_DAYS", days: 30 }, comparator: "GTE", threshold: 5 } as never)
    expect(outcome.facts).toMatchObject({ excludedByStatus: { AFASTAMENTO_PROTEGIDO: 5, FERIAS: 3 } })
    expect(JSON.stringify(outcome)).not.toMatch(/INSS|MATERNIDADE|PATERNIDADE/)
  })
})
