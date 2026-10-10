import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { runtimeParametersOf } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import { indicatorPeriodKey } from "../domain/delivery-guards.js"
import type { OfficialFacts } from "../domain/indicator-investigation.js"
import { request, setup, strategyWith, worsened } from "../testing/investigation-world.js"
import { investigateIndicator } from "./investigate-indicator.js"

/**
 * `PRV_CLOSING_STRATEGY_SCOPE_V1` + `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1` na investigação — zero IA. Do fechamento do PRV só entram
 * indicadores com estratégia publicada e ativa; indicador × período já entregue à pessoa não é investigado de novo.
 */
const nps: OfficialFacts = { ...worsened, indicatorId: "ind-nps", code: "NPS", name: "NPS", unit: "POINTS", direction: "HIGHER", sourceRef: "closing-nps", value: 40, target: 60, gapToTarget: 20 }
const meta = (official: OfficialFacts) => ({ id: official.indicatorId, code: official.code, name: official.name, unit: official.unit, direction: official.direction, dailySupported: false })

function prvWorld(options: { configured: string[]; delivered?: string[] }) {
  const world = setup({ strategy: strategyWith({ segmentation: true }) })
  const byId = new Map([[worsened.indicatorId, worsened], [nps.indicatorId, nps]])
  Object.assign(world.investigate.data, {
    closingIndicators: async () => ({ referencePeriod: "2026-08", indicatorIds: [nps.indicatorId, worsened.indicatorId] }),
    indicatorById: async (_org: string, id: string) => (byId.has(id) ? meta(byId.get(id)!) : null),
    officialFromClosing: async (_org: string, _person: string, id: string) => byId.get(id) ?? null,
  })
  world.investigate.strategy = async (_org, _enrollment, indicatorId) => runtimeParametersOf(options.configured.includes(indicatorId) ? strategyWith({ segmentation: true }) : null)
  const delivered = new Set(options.delivered ?? [])
  world.memory.deliveredIndicatorPeriods = async () => delivered
  return world
}

describe("fechamento do PRV — só indicadores com estratégia, e nunca o mesmo período duas vezes", () => {
  it("nenhum indicador do fechamento tem estratégia publicada: nada é investigado (motivo explícito)", async () => {
    const world = prvWorld({ configured: [] })
    const result = await investigateIndicator(world.investigate, request({ target: { kind: "PRV_CLOSING" } }))
    expect(result).toEqual({ investigations: [], skippedReason: "NO_INDICATOR_WITH_STRATEGY" })
    expect(world.fake.calls).toHaveLength(0)
  })

  it("o indicador SEM estratégia fica fora: com o único configurado já entregue no período, nada sobra", async () => {
    const world = prvWorld({ configured: [worsened.indicatorId], delivered: [indicatorPeriodKey("TMA", worsened.periodStart, worsened.periodEnd)] })
    const result = await investigateIndicator(world.investigate, request({ target: { kind: "PRV_CLOSING" } }))
    expect(result).toEqual({ investigations: [], skippedReason: "PERIOD_ALREADY_DELIVERED" })
    expect(world.fake.calls).toHaveLength(0)
  })

  it("só o configurado é investigado (o NPS, fora da meta mas sem estratégia, não entra)", async () => {
    const world = prvWorld({ configured: [worsened.indicatorId] })
    const result = await investigateIndicator(world.investigate, request({ target: { kind: "PRV_CLOSING" } }))
    expect(result.investigations.map((entry) => entry.indicatorCode)).toEqual(["TMA"])
  })

  it("indicador × período já entregue: o fechamento oficial não é investigado de novo; a simulação (\"Testar diagnóstico\") ignora a regra", async () => {
    const world = prvWorld({ configured: [worsened.indicatorId], delivered: [indicatorPeriodKey("TMA", worsened.periodStart, worsened.periodEnd)] })
    expect(await investigateIndicator(world.investigate, request())).toEqual({ investigations: [], skippedReason: "PERIOD_ALREADY_DELIVERED" })
    const simulated = await investigateIndicator(world.investigate, request({ skipDeliveredPeriods: false }))
    expect(simulated.investigations).toHaveLength(1)
    expect(simulated.investigations[0]!.indicatorCode).toBe("TMA")
  })
})
