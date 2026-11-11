import { beforeEach, describe, expect, it, vi } from "vitest"
import { finishWindow, finishWindowBySubject, toRaw, type MeasurementWindowRow, type WindowEligibilityFacts } from "../../../indicators/application/operational-measurement-resolver.js"
import type { IndicatorInfo, ToolContext } from "../tool-context.js"

/**
 * Mínimo de privacidade do compare_population (achado C13 + desvio da 2ª rodada): o portão conta EXATAMENTE os colegas que
 * entram na referência pooled. Colegas cujo único "dado" é o zero lógico de falta injustificada (ZERO_CONTRIBUTION) aparecem
 * na janela por pessoa, mas a referência não os soma — contá-los deixava o valor de UM colega sair como "referência".
 * A janela por pessoa e a pooled usam as funções de pós-processamento reais do resolvedor; só o SQL é substituído.
 */
const state = vi.hoisted(() => ({ rows: [] as Record<string, string>[], facts: new Map<string, { eligibleDays: number; unjustifiedAbsenceDays: number }>() }))

const indicator: IndicatorInfo = { id: "i", code: "PRODUCAO", name: "Produção", unit: "COUNT", direction: "HIGHER", kind: "SUM", dailySupported: true, unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION", minimumSampleSize: null, minimumCoverage: null, active: true, officialClosureSupported: false }
const PEERS = ["P1", "P2", "P3", "P4", "P5"]

vi.mock("../tool-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tool-context.js")>()),
  loadIndicator: vi.fn(async () => indicator),
  loadPeerPopulation: vi.fn(async () => ({ ids: PEERS, label: "Grupo QA", kind: "GROUP" })),
}))

vi.mock("../../../indicators/application/operational-measurement-resolver.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../indicators/application/operational-measurement-resolver.js")>()
  const definition = { kind: "SUM" as const, unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" as const }
  return {
    ...actual,
    resolveOperationalWindowBySubject: vi.fn(async (_db: unknown, input: { subjectIds: string[] } & Parameters<typeof actual.finishWindowBySubject>[1]) =>
      actual.finishWindowBySubject(state.rows.filter((row) => input.subjectIds.includes(row.subject_id!)) as MeasurementWindowRow[], input, definition, state.facts as Map<string, WindowEligibilityFacts>),
    ),
    // Pooled de vários sujeitos: sem elegibilidade (nenhum zero lógico entra), como no resolvedor real; 1 sujeito = o colaborador.
    resolveOperationalWindow: vi.fn(async (_db: unknown, input: { subjectIds: string[] } & Parameters<typeof actual.finishWindow>[1]) => {
      const rows = state.rows.filter((row) => input.subjectIds.includes(row.subject_id!))
      const merged = rows.length === 0 ? undefined : ({ sample_count: String(rows.reduce((sum, row) => sum + Number(row.sample_count), 0)), days_with_data: String(rows.reduce((sum, row) => sum + Number(row.days_with_data), 0)), sum_value: String(rows.reduce((sum, row) => sum + Number(row.sum_value), 0)), avg_value: null, min_value: null, max_value: null } as MeasurementWindowRow)
      return actual.finishWindow(actual.toRaw(merged), input, definition, undefined, 0, 0)
    }),
  }
})

const { comparePopulation } = await import("./indicator-tools.js")

const context = {
  db: {},
  organizationId: "org",
  timeZone: "America/Sao_Paulo",
  now: new Date("2026-10-10T12:00:00Z"),
  defaultPeriod: { start: new Date("2026-10-05T03:00:00Z"), end: new Date("2026-10-06T03:00:00Z"), label: "2026-10-05" },
  subject: { operatorId: "ME", teamId: "T", teamName: "QA", subteamId: null, subteamName: null },
} as unknown as ToolContext

const realRow = (subject: string, value: number) => ({ subject_id: subject, sample_count: "1", days_with_data: "1", sum_value: String(value), avg_value: String(value), min_value: String(value), max_value: String(value) })

beforeEach(() => {
  state.rows = [realRow("ME", 120)]
  state.facts = new Map(PEERS.map((id) => [id, { eligibleDays: 1, unjustifiedAbsenceDays: 0 }]))
})

describe("compare_population — o mínimo de privacidade conta só quem entra na referência", () => {
  it("1 colega com medição real + 3 colegas só com zero lógico de falta → POPULATION_TOO_SMALL, nunca o valor do colega", async () => {
    state.rows.push(realRow("P1", 137))
    for (const id of ["P2", "P3", "P4"]) state.facts.set(id, { eligibleDays: 1, unjustifiedAbsenceDays: 1 })
    // Pré-condição: a janela por pessoa realmente inclui os zeros lógicos (é o que enganava o portão antigo).
    const bySubject = finishWindowBySubject(state.rows.filter((row) => row.subject_id !== "ME") as MeasurementWindowRow[], { aggregation: "SUM", window: context.defaultPeriod, expectedDays: 0 }, { kind: "SUM", unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" }, state.facts)
    expect([...bySubject.values()].filter((entry) => entry.daysWithData > 0)).toHaveLength(4)
    expect(finishWindow(toRaw(realRow("P1", 137)), { aggregation: "SUM", window: context.defaultPeriod, expectedDays: 0 }, { kind: "SUM", unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" }, undefined, 0).value).toBe(137)

    const result = await comparePopulation(context, { indicatorCode: "PRODUCAO", reference: "GROUP" })
    expect(result.data).toMatchObject({ status: "POPULATION_TOO_SMALL" })
    expect(result.data).not.toHaveProperty("referenceValue")
  })

  it("4 colegas com medição real (mais um só com zero lógico) → referência agregada devolvida", async () => {
    state.rows.push(realRow("P1", 100), realRow("P2", 110), realRow("P3", 90), realRow("P4", 100))
    state.facts.set("P5", { eligibleDays: 1, unjustifiedAbsenceDays: 1 })
    const result = await comparePopulation(context, { indicatorCode: "PRODUCAO", reference: "GROUP" })
    expect(result.data).toMatchObject({ referenceValue: 400, targetValue: 120 })
  })
})
