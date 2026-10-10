import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { periodSampleOf, type OfficialFacts } from "../domain/indicator-investigation.js"
import { investigationOf, PERSON, request, setup, worsened } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * `POPULATION_SIGNAL_V2` (06/10/2026) — zero IA. NOTA_URA é "maior é melhor", mas o sinal que a decompõe pelas chamadas (`nota_ura` ≤ 2)
 * marca o evento RUIM: mais chamadas com o sinal = pior. O sentido da taxa vem do que a estratégia DECLARA sobre o sinal, nunca do
 * sentido do indicador (que tornaria "mais notas baixas" uma melhora). Flag numérica entra com a condição declarada.
 */
const notaUra: OfficialFacts = { ...worsened, indicatorId: "ind-nota", code: "NOTA_URA", name: "Nota da Pesquisa na URA", unit: "STARS", direction: "HIGHER", sourceRef: "closing-nota", value: 3.9, target: 4.3, gapToTarget: 0.4, previous: { value: 4.64, periodLabel: "julho/2026", withinTarget: true }, movement: "WORSENED" }
const meta = { id: "ind-nota", code: "NOTA_URA", name: "Nota da Pesquisa na URA", unit: "STARS", direction: "HIGHER" as const, dailySupported: false }

function signalStrategy(effect: "ADVERSE" | "FAVORABLE") {
  return {
    id: "s-nota",
    version: 1,
    config: {
      schemaVersion: 1,
      segmentation: { enabled: true, dimensions: ["SUBJECT" as const], minimumSegmentInteractions: 3 },
      interactionInvestigation: { enabled: false, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null },
      processAssessment: { enabled: false },
      allowedBusinessDomainIds: [],
      peerComparison: { enabled: false, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 },
      noDiagnosisBehavior: "FACTUAL_ONLY" as const,
      populationSignal: { kind: "INTERACTION_FLAG" as const, flagName: "nota_ura", condition: { operator: "LTE" as const, value: 2 }, effect },
    },
  } as never
}

function build(effect: "ADVERSE" | "FAVORABLE") {
  const built = setup({ official: notaUra, strategy: signalStrategy(effect) })
  const resolved: unknown[] = []
  const row = (key: string, n: number, signaled: number) => ({ personId: PERSON, key, n, avgDuration: 400, signaled })
  Object.assign(built.investigate.data, {
    indicatorByCode: async () => meta,
    indicatorById: async () => meta,
    resolveSignal: async (_org: string, signal: unknown) => {
      resolved.push(signal)
      return { flagIds: ["flag-nota"], condition: { operator: "LTE", value: 2 } }
    },
    // Agosto (atual): na Contestação 6 de 10 chamadas com nota ≤ 2 (julho: 1 de 10); Troca de plano estável (1 de 10 nos dois).
    segmentRows: async (_org: string, _personIds: readonly string[], window: { start: Date }) => (window.start.getUTCMonth() === 7 ? [row("CONTESTACAO", 10, 6), row("PLANO", 10, 1)] : [row("CONTESTACAO", 10, 1), row("PLANO", 10, 1)]),
  })
  return { ...built, resolved }
}

describe("sinal da população numérico e com sentido declarado", () => {
  it("sinal ADVERSO num indicador \"maior é melhor\": mais chamadas com nota ≤ 2 é PIORA, localizada no assunto em que subiu", async () => {
    const { investigate, memory, resolved } = build("ADVERSE")
    const result = await investigateIndicator(investigate, request())
    const investigation = await investigationOf(memory, result.investigations[0]!.runId)
    expect(resolved).toEqual([{ flagName: "nota_ura", condition: { operator: "LTE", value: 2 }, effect: "ADVERSE" }])
    expect(investigation.localization.proxy.kind).toBe("SIGNAL_RATE")
    expect(investigation.localization.proxy.label).toContain("nota_ura ≤ 2")
    expect(investigation.localization.overall.direction).toBe("WORSE")
    const contestacao = investigation.localization.segments.find((segment) => segment.key === "CONTESTACAO")!
    expect(contestacao.changeDirection).toBe("WORSE")
    expect(investigation.localization.focus.map((focus) => focus.key)).toContain("CONTESTACAO")
  })

  it("o mesmo dado com o sinal declarado FAVORÁVEL é melhora — o sentido é o que a estratégia declara sobre o sinal", async () => {
    const { investigate, memory } = build("FAVORABLE")
    const result = await investigateIndicator(investigate, request())
    const investigation = await investigationOf(memory, result.investigations[0]!.runId)
    expect(investigation.localization.overall.direction).toBe("BETTER")
    expect(investigation.localization.segments.find((segment) => segment.key === "CONTESTACAO")!.changeDirection).toBe("BETTER")
  })

  it("taxa que sai de ZERO no período anterior (0 de 10 → 6 de 10) é a mudança material do assunto — antes o foco ficava vazio (`ZERO_BASELINE_MATERIALITY_V1`)", async () => {
    const { investigate, memory } = build("ADVERSE")
    const row = (key: string, n: number, signaled: number) => ({ personId: PERSON, key, n, avgDuration: 400, signaled })
    Object.assign(investigate.data, {
      segmentRows: async (_org: string, _personIds: readonly string[], window: { start: Date }) => (window.start.getUTCMonth() === 7 ? [row("CONTESTACAO", 10, 6), row("PLANO", 10, 0)] : [row("CONTESTACAO", 10, 0), row("PLANO", 10, 0)]),
    })
    const investigation = await investigationOf(memory, (await investigateIndicator(investigate, request())).investigations[0]!.runId)
    expect(investigation.localization.segments.find((segment) => segment.key === "CONTESTACAO")!.relativeChange).toBeNull()
    expect(investigation.localization.focus).toEqual([expect.objectContaining({ key: "CONTESTACAO", reason: "DETERIORATED" })])
    // Assunto estável em zero continua fora do foco.
    expect(investigation.localization.focus.map((focus) => focus.key)).not.toContain("PLANO")
  })

  it("amostra do período em indicador por sinal: o assunto com mais chamadas SINALIZADAS abre a amostra, mesmo com menos chamadas", () => {
    const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, index) => ({ id: `${prefix}${index}` }))
    const plan = periodSampleOf({ subjects: [{ key: "GRANDE", label: "Grande", calls: ids("g", 6), signaled: 0 }, { key: "SINAL", label: "Com sinal", calls: ids("s", 3), signaled: 3 }], analyzed: new Set(), target: 3, room: 10 })
    expect(plan.topSubject?.key).toBe("SINAL")
    expect(plan.pick.map((entry) => entry.subjectKey)).toEqual(["SINAL", "SINAL", "SINAL"])
    // Sem a contagem de sinal (indicadores por duração/volume): o assunto com mais chamadas, como antes.
    expect(periodSampleOf({ subjects: [{ key: "GRANDE", label: "Grande", calls: ids("g", 6) }, { key: "SINAL", label: "Com sinal", calls: ids("s", 3) }], analyzed: new Set(), target: 3, room: 10 }).topSubject?.key).toBe("GRANDE")
  })
})
