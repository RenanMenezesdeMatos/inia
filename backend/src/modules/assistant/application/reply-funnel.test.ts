import { describe, expect, it } from "vitest"
import { assertFunnelPeriod, funnelMeasures, funnelRatio, replyFunnel, type FunnelCounts } from "./reply-funnel.js"

/** Funil das respostas (M1–M6): regras das taxas, medidas a partir das contagens e o recorte enviado ao banco. */
const counts = (overrides: Partial<FunnelCounts> = {}): FunnelCounts => ({
  answers: 40, up: 12, down: 8, downWithDetails: 6, stillNeedsHelp: 2, reasons: { NOT_FOUND: 4, OTHER: 2 }, downNotCollected: 1, downNotInformed: 1,
  withSignalRow: 30, withSignal: 6, signals: { KNOWLEDGE_NOT_FOUND: 5, CONSULTATION_FAILED: 1 }, noReplyQuestions: 3, ...overrides,
})
const measure = (all: ReturnType<typeof funnelMeasures>, id: string) => all.find((item) => item.id === id)!

describe("taxas do funil", () => {
  it("toda taxa leva numerador e denominador; denominador < 5 oculta a taxa; zero = sem dados (nunca 0%)", () => {
    expect(funnelRatio(3, 10)).toEqual({ numerator: 3, denominator: 10, value: 0.3, status: "OK" })
    expect(funnelRatio(1, 4)).toEqual({ numerator: 1, denominator: 4, value: null, status: "SMALL_SAMPLE" })
    expect(funnelRatio(0, 0)).toEqual({ numerator: 0, denominator: 0, value: null, status: "NO_DATA" })
  })
})

describe("medidas M1–M6", () => {
  it("M1 conta as respostas; M2 = avaliadas / respostas; M3 = curtidas / avaliadas; M5 = ainda precisa de ajuda / descurtidas com motivo; M6 = com sinal / com linha", () => {
    const all = funnelMeasures(counts())
    expect(all.map((item) => item.id)).toEqual(["M1", "M2", "M3", "M4", "M5", "M6"])
    expect(measure(all, "M1").main).toEqual({ numerator: 40, denominator: null, value: 40, status: "OK" })
    expect(measure(all, "M2").main).toEqual({ numerator: 20, denominator: 40, value: 0.5, status: "OK" })
    expect(measure(all, "M3").main).toEqual({ numerator: 12, denominator: 20, value: 0.6, status: "OK" })
    expect(measure(all, "M5").main).toEqual({ numerator: 2, denominator: 6, value: 2 / 6, status: "OK" })
    expect(measure(all, "M6").main).toEqual({ numerator: 6, denominator: 30, value: 0.2, status: "OK" })
  })

  it("M4: todos os motivos do catálogo + não informado + não coletado, com a parcela sobre as descurtidas vigentes", () => {
    const m4 = measure(funnelMeasures(counts()), "M4")
    expect(m4.main).toMatchObject({ numerator: 8, status: "OK" })
    expect(m4.breakdown!.map((item) => [item.key, item.count])).toEqual([
      ["WRONG_INFORMATION", 0], ["DID_NOT_ANSWER", 0], ["NOT_FOUND", 4], ["INCOMPLETE", 0], ["HARD_TO_UNDERSTAND", 0], ["OTHER", 2], ["NOT_INFORMED", 1], ["NOT_COLLECTED", 1],
    ])
    expect(m4.breakdown!.find((item) => item.key === "NOT_FOUND")).toEqual({ key: "NOT_FOUND", label: "Não encontrou a informação", count: 4, value: 0.5 })
    // Poucas descurtidas: parcelas ocultas.
    const few = measure(funnelMeasures(counts({ down: 3, reasons: { NOT_FOUND: 3 }, downNotCollected: 0, downNotInformed: 0 })), "M4")
    expect(few.main.status).toBe("SMALL_SAMPLE")
    expect(few.breakdown!.every((item) => item.value === null)).toBe(true)
  })

  it("M6: um item por sinal do catálogo; NO_REPLY é contagem de perguntas, sem taxa", () => {
    const m6 = measure(funnelMeasures(counts()), "M6")
    expect(m6.breakdown!.map((item) => [item.key, item.count, item.value])).toEqual([
      ["KNOWLEDGE_NOT_FOUND", 5, 5 / 30], ["KNOWLEDGE_INSUFFICIENT", 0, 0], ["CONSULTATION_FAILED", 1, 1 / 30], ["SPECIALIST_BLOCKED", 0, 0], ["NO_REPLY", 3, null],
    ])
  })

  it("sem nenhuma resposta: contagem zero e todas as taxas sem dados", () => {
    const all = funnelMeasures(counts({ answers: 0, up: 0, down: 0, downWithDetails: 0, stillNeedsHelp: 0, reasons: {}, downNotCollected: 0, downNotInformed: 0, withSignalRow: 0, withSignal: 0, signals: {}, noReplyQuestions: 0 }))
    expect(measure(all, "M1").main.value).toBe(0)
    for (const id of ["M2", "M3", "M4", "M5", "M6"]) expect(measure(all, id).main.status).toBe("NO_DATA")
  })
})

describe("período e recorte", () => {
  it("período: datas reais AAAA-MM-DD, início ≤ fim, até 92 dias", () => {
    expect(() => assertFunnelPeriod({ from: "2026-08-10", to: "2026-11-09" })).not.toThrow()
    for (const period of [{ from: "2026-08-09", to: "2026-11-09" }, { from: "2026-11-10", to: "2026-11-09" }, { from: "2026-02-30", to: "2026-03-01" }, { from: "09/11/2026", to: "2026-11-09" }]) {
      expect(() => assertFunnelPeriod(period)).toThrow(expect.objectContaining({ code: "FUNNEL_PERIOD_INVALID", statusCode: 422 }))
    }
  })

  it("o recorte e o filtro vão ao banco como parâmetros, sobre o Grupo/Subgrupo atual da dona da conversa", async () => {
    const calls: { sql: string; params: unknown[] }[] = []
    const db = { query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params })
      return { rows: [{ answers: 0, up: 0, down: 0, down_with_details: 0, still_needs_help: 0, reasons: null, down_not_collected: 0, down_not_informed: 0, with_signal_row: 0, with_signal: 0, signals: null, no_reply_questions: 0, dislike_details_since: null, signals_since: new Date("2026-11-09T15:00:00.000Z") }] }
    } }
    const organization = await replyFunnel(db as never, "org-1", { from: "2026-11-01", to: "2026-11-09" }, { kind: "ORGANIZATION" })
    expect(organization.cutoffs).toEqual({ dislikeDetailsSince: null, signalsSince: "2026-11-09T15:00:00.000Z" })
    expect(calls[0]!.params).toHaveLength(4)
    expect(calls[0]!.sql).toContain("c.origin = 'USER'")
    await replyFunnel(db as never, "org-1", { from: "2026-11-01", to: "2026-11-09" }, { kind: "UNITS", teamIds: ["team-a"], subteamIds: ["sub-b"] }, { subteamId: "sub-b" })
    expect(calls[1]!.params.slice(4)).toEqual([["team-a"], ["sub-b"], "sub-b"])
    expect(calls[1]!.sql).not.toContain("team-a")
  })
})
