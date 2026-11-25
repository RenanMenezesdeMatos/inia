/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { OrchestratorForm } from "./node-config/orchestrator-form"
import { TriggerFields } from "./trigger-fields"
import { WorkflowUniverseProvider } from "./workflow-universe-context"

/**
 * Hierarquia universo → recursos no Workflow: o gatilho por indicador e a etapa "Orquestrador" só oferecem o que é do universo do
 * Workflow (ou ainda sem universo); a referência já salva de outro universo fica visível e marcada (o publish recusa).
 */
const INDICATORS = [
  { code: "EMPRESAS", name: "Indicador Empresas", operatingUniverse: "B2B", active: true },
  { code: "CONSUMIDOR", name: "Indicador Consumidor", operatingUniverse: "B2C", active: true },
  { code: "PENDENTE", name: "Indicador Pendente", operatingUniverse: null, active: true },
] as unknown as IndicatorWithRules[]
vi.mock("@/queries/admin/use-indicator-rule-queries", () => ({ useIndicatorsWithRulesQuery: () => ({ data: INDICATORS, isLoading: false }) }))
vi.mock("@/queries/admin/use-channel-flag-queries", () => ({ useChannelFlagsQuery: () => ({ data: [] }) }))
vi.mock("@/queries/admin/use-assistant-queries", () => ({ useOrchestratorVersionsQuery: () => ({ data: undefined, isPending: true }) }))

const orchestrator = (id: string, name: string, operatingUniverse: string | null) =>
  ({ id, name, operatingUniverse, invocationMode: "BOTH", scopeType: "ALL_TEAMS", teamId: null, subteamId: null, currentVersionId: null, structuredOutput: null }) as unknown as Orchestrator
const ORCHESTRATORS = [orchestrator("o-b2b", "INIA Empresas", "B2B"), orchestrator("o-b2c", "INIA Consumidor", "B2C")]
const node = (orchestratorId: string) => ({ id: "n1", type: "orchestrator", position: { x: 0, y: 0 }, config: { orchestratorId, instruction: "" } }) as unknown as Extract<FlowNode, { type: "orchestrator" }>

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(cleanup)

describe("Workflow — seletores encadeados pelo universo", () => {
  it("gatilho por indicador num Workflow B2B: o indicador B2C não é oferecido", async () => {
    render(<TriggerFields value={{ kind: "indicator", indicatorCode: "" }} onChange={vi.fn()} universe="B2B" />)
    fireEvent.click(screen.getByRole("combobox", { name: "Indicador" }))
    expect(await screen.findByRole("option", { name: "Indicador Empresas" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Indicador Pendente" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Indicador Consumidor" })).toBeNull()
  })

  it("sem universo escolhido (pendente), todos os indicadores continuam oferecidos", async () => {
    render(<TriggerFields value={{ kind: "indicator", indicatorCode: "" }} onChange={vi.fn()} universe={null} />)
    fireEvent.click(screen.getByRole("combobox", { name: "Indicador" }))
    expect(await screen.findByRole("option", { name: "Indicador Consumidor" })).toBeInTheDocument()
  })

  it("etapa Orquestrador num Workflow B2B: só o Orquestrador B2B é oferecido", async () => {
    render(
      <WorkflowUniverseProvider value="B2B">
        <OrchestratorForm node={node("")} orchestrators={ORCHESTRATORS} onChange={vi.fn()} />
      </WorkflowUniverseProvider>,
    )
    fireEvent.click(screen.getByRole("combobox", { name: "Orquestrador" }))
    expect(await screen.findByRole("option", { name: "INIA Empresas" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: /INIA Consumidor/ })).toBeNull()
  })

  it("Orquestrador já salvo de outro universo fica visível, marcado e com aviso", () => {
    render(
      <WorkflowUniverseProvider value="B2B">
        <OrchestratorForm node={node("o-b2c")} orchestrators={ORCHESTRATORS} onChange={vi.fn()} />
      </WorkflowUniverseProvider>,
    )
    expect(screen.getByRole("combobox", { name: "Orquestrador" })).toHaveTextContent("INIA Consumidor (de outro universo: B2C)")
    expect(screen.getByText(/é de outro universo de atuação — a publicação vai rejeitar/)).toBeInTheDocument()
  })
})
