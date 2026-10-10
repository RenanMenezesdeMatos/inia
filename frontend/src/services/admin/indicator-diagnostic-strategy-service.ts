import { adminGet, adminSend } from "@/lib/admin/admin-api"
import {
  simulationOptionsSchema,
  simulationResultSchema,
  strategyOverviewSchema,
  type SimulationOptions,
  type SimulationResult,
  type StrategyConfig,
  type StrategyOverview,
} from "@/schemas/admin/indicator-diagnostic-strategy.schema"

const base = (indicatorId: string) => `/api/v1/admin/indicator-diagnostic-strategies/indicators/${indicatorId}`

export async function fetchStrategyOverview(indicatorId: string): Promise<StrategyOverview> {
  return strategyOverviewSchema.parse(await adminGet(base(indicatorId)))
}
/** Sem `config` = começar o rascunho (a partir da versão publicada, ou tudo desligado). */
export async function saveStrategyDraft(input: { indicatorId: string; config?: StrategyConfig }): Promise<StrategyOverview> {
  return strategyOverviewSchema.parse(await adminSend(`${base(input.indicatorId)}/draft`, "PUT", input.config ? { config: input.config } : {}))
}
export async function publishStrategyDraft(indicatorId: string): Promise<StrategyOverview> {
  return strategyOverviewSchema.parse(await adminSend(`${base(indicatorId)}/publish`, "POST"))
}
export async function discardStrategyDraft(indicatorId: string): Promise<StrategyOverview> {
  return strategyOverviewSchema.parse(await adminSend(`${base(indicatorId)}/draft`, "DELETE"))
}
export async function setStrategyActive(input: { indicatorId: string; active: boolean }): Promise<StrategyOverview> {
  return strategyOverviewSchema.parse(await adminSend(`${base(input.indicatorId)}/active`, "POST", { active: input.active }))
}
export async function fetchSimulationOptions(indicatorId: string, search?: string): Promise<SimulationOptions> {
  return simulationOptionsSchema.parse(await adminGet(`${base(indicatorId)}/simulation-options${search ? `?search=${encodeURIComponent(search)}` : ""}`))
}
export async function simulateStrategy(input: { indicatorId: string; source: "DRAFT" | "PUBLISHED"; collaboratorId: string; measurementId: string; agentId: string; aiPolicy: "REAL" | "STOP_BEFORE_AI" }): Promise<SimulationResult> {
  const { indicatorId, ...body } = input
  return simulationResultSchema.parse(await adminSend(`${base(indicatorId)}/simulate`, "POST", body))
}
