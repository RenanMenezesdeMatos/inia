/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import type { SimulationResult, StrategyConfig, StrategyOverview } from "@/schemas/admin/indicator-diagnostic-strategy.schema"
import type { IndicatorWithRules } from "@/schemas/admin/indicator-rule.schema"

const state = vi.hoisted(() => ({
  overview: null as unknown,
  saveRule: vi.fn(async () => ({})),
  saveDraft: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({})),
  discard: vi.fn(async () => ({})),
  simulate: vi.fn(),
  simulation: null as unknown,
  optionSearches: [] as string[],
}))

vi.mock("@/queries/admin/use-indicator-rule-queries", () => {
  const mutation = (mutateAsync = vi.fn(async () => ({}))) => ({ mutate: vi.fn(), mutateAsync, isPending: false, isError: false, error: null, reset: vi.fn() })
  return {
    useSaveIndicatorRuleMutation: () => mutation(state.saveRule),
    useSetIndicatorRuleActiveMutation: () => mutation(),
    useSaveIndicatorGlossaryMutation: () => mutation(),
    useDeleteIndicatorRuleMutation: () => mutation(),
    useUpdateIndicatorDefinitionMutation: () => mutation(),
    useDeleteIndicatorDefinitionMutation: () => mutation(),
    useSetIndicatorDefinitionActiveMutation: () => mutation(),
    useCreateIndicatorDefinitionMutation: () => mutation(),
    useIndicatorCatalogQuery: () => ({ data: undefined, isLoading: true }),
    useIndicatorDependenciesQuery: () => ({ data: undefined, isLoading: true }),
    useIndicatorsWithRulesPageQuery: () => ({ data: undefined, isLoading: true }),
  }
})
vi.mock("@/queries/admin/use-org-structure-queries", () => ({ useTeamsQuery: () => ({ data: [] }) }))
vi.mock("@/queries/admin/use-channel-flag-queries", () => ({
  useChannelFlagsQuery: () => ({
    isLoading: false,
    data: [
      { id: "f-1", channel: "VOICE", flagName: "rechamada", valueType: "BOOLEAN", description: null, active: true, createdAt: "2026-09-01" },
      { id: "f-2", channel: "VOICE", flagName: "nota_ura", valueType: "NUMERIC", description: null, active: true, createdAt: "2026-09-01" },
      { id: "f-3", channel: "VOICE", flagName: "antiga", valueType: "BOOLEAN", description: null, active: false, createdAt: "2026-09-01" },
    ],
  }),
}))
vi.mock("@/queries/admin/use-indicator-diagnostic-strategy-queries", () => {
  const mutation = (mutateAsync: (input?: unknown) => Promise<unknown> = vi.fn(async () => ({}))) => ({ mutate: vi.fn((input: unknown) => mutateAsync(input)), mutateAsync, isPending: false, isError: false, error: null, reset: vi.fn() })
  return {
    useStrategyOverviewQuery: () => ({ data: state.overview, isLoading: false }),
    useSaveStrategyDraftMutation: () => mutation(state.saveDraft),
    usePublishStrategyMutation: () => mutation(state.publish),
    useDiscardStrategyDraftMutation: () => mutation(state.discard),
    useSetStrategyActiveMutation: () => mutation(),
    useSimulationOptionsQuery: (_indicatorId: string, _enabled: boolean, search = "") => {
      state.optionSearches.push(search)
      return { isPending: false, data: { collaborators: [{ id: "op-1", name: "Operadora Um", measurements: [{ id: "m-1", periodLabel: "01/06/2026 a 30/06/2026", interactions: 3 }] }], agents: [{ id: "ag-1", name: "Especialista" }] } }
    },
    useSimulateStrategyMutation: () => ({ mutate: state.simulate, isPending: false, isError: false, error: null, data: state.simulation }),
  }
})

import { IndicatorManager } from "./indicators-page"
import { periodOptionLabel } from "./indicator-diagnostic-simulation-dialog"
import { DiagnosticStrategyStatusBadge, IndicatorDiagnosticStrategyTab } from "./indicator-diagnostic-strategy-tab"

beforeAll(installJsdomStubs)
afterEach(cleanup)
beforeEach(() => {
  state.saveRule.mockClear()
  state.saveDraft.mockClear()
  state.publish.mockClear()
  state.discard.mockClear()
  state.simulate.mockClear()
  state.simulation = null
  state.optionSearches = []
})

const indicator = (partial: Partial<IndicatorWithRules> = {}): IndicatorWithRules => ({
  id: "ind-1", code: "IND_X", name: "Indicador X", unit: "SECONDS", desiredDirection: "LOWER", active: true,
  operationalAggregation: "AVERAGE", dailySupported: true, minimumSampleSize: null, minimumCoverage: null, officialClosureSupported: true, provesWorkActivity: false, unjustifiedAbsencePolicy: "NO_SAMPLE", availabilityPolicy: null,
  calculation: { label: "Média", description: "Média do período." },
  glossaryDescription: null, interpretation: null, goodPractices: null, feedbackGuidance: null,
  calculationRules: [{ id: "r-1", scopeType: "ALL_TEAMS", teamId: null, teamName: null, subteamId: null, subteamName: null, calculationPeriod: "MONTHLY", calculationMethod: "Média do mês", attainmentRule: null, active: true }],
  ...partial,
} as IndicatorWithRules)

const config = (partial: Partial<StrategyConfig> = {}): StrategyConfig => ({
  schemaVersion: 1,
  segmentation: { enabled: false, dimensions: [], minimumSegmentInteractions: 3 },
  interactionInvestigation: { enabled: false, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null },
  processAssessment: { enabled: false },
  allowedBusinessDomainIds: [],
  peerComparison: { enabled: false, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 },
  noDiagnosisBehavior: "FACTUAL_ONLY",
  ...partial,
})
const LIMITS = { minimumSegmentInteractions: { floor: 3, max: 50 }, maxInteractions: { min: 3, max: 10, productDefault: 5 }, minimumAnalyzed: { floor: 3 }, minimumCoveragePercent: { min: 1, max: 100 }, peerMinimumPopulation: { floor: 4, max: 100 }, peerMinimumContributors: { floor: 4, max: 100 }, peerMinimumObservedInteractions: { floor: 5, max: 500 } }
const capabilities = (decomposable: boolean): StrategyOverview["capabilities"] => ({
  indicator: { decomposable, metric: decomposable ? "INTERACTION_DURATION_SECONDS" : null },
  dimensions: decomposable ? [{ code: "SUBJECT", label: "Motivo / assunto do atendimento", description: "Agrupa por motivo." }] : [],
  mandatorySources: [{ code: "OFFICIAL_RESULT", label: "Resultado oficial do indicador (valor, meta, período)" }],
  configurableSources: decomposable
    ? [
        { code: "INTERACTIONS", label: "Investigar atendimentos do motivo", description: "d", requires: ["SEGMENTATION"], lockedOnWith: null },
        { code: "PROCESS_ASSESSMENT", label: "Avaliar processos nos atendimentos", description: "A INIA compara etapas observáveis do atendimento com processos aplicáveis da Base de Conhecimento.", requires: ["INTERACTIONS"], lockedOnWith: null },
        { code: "KNOWLEDGE", label: "Consultar Base de Conhecimento", description: "d", requires: ["PROCESS_ASSESSMENT"], lockedOnWith: "PROCESS_ASSESSMENT" },
        { code: "PEER_COMPARISON", label: "Comparação agregada com grupo de referência", description: "d", requires: ["PROCESS_ASSESSMENT"], lockedOnWith: null },
      ]
    : [],
  sampling: { selection: "DETERMINISTIC", limits: LIMITS },
  peerRules: ["Mesmo indicador e mesmo período"],
  noDiagnosisBehaviors: [
    { code: "FACTUAL_ONLY", label: "Gerar somente feedback factual", description: "d" },
    { code: "HOLD_FOR_QA", label: "Encaminhar para QA", description: "d" },
    { code: "NO_FEEDBACK", label: "Não gerar feedback", description: "d" },
  ],
  guardrails: ["Indicador + comportamento observado nunca é tratado como causa"],
})
const overview = (partial: Partial<StrategyOverview> = {}): StrategyOverview => ({
  indicator: { id: "ind-1", code: "IND_X", name: "Indicador X", unit: "SECONDS", active: true },
  status: "NOT_CONFIGURED", active: true, published: null, draft: null, history: [], draftIssues: [], capabilities: capabilities(true), domains: [{ id: "d-1", name: "Faturamento", active: true }],
  newDraftTemplate: partial.published?.config ?? config(),
  ...partial,
})
const version = (status: "DRAFT" | "PUBLISHED", cfg: StrategyConfig, number = 1) => ({ id: `v-${number}`, version: number, status, config: cfg, createdAt: "2026-09-24T00:00:00Z", createdByName: "Admin", publishedAt: status === "PUBLISHED" ? "2026-09-24T00:00:00Z" : null, publishedByName: status === "PUBLISHED" ? "Admin" : null })

describe("V1.6.2 — drawer do indicador: abas e \"Nova regra\" como ação (regressão)", () => {
  it("L) abas Definição / Regras de cálculo / Diagnóstico com IA / Glossário; \"Nova regra\" abre o formulário dentro da aba e salva a regra", async () => {
    state.overview = overview()
    render(<IndicatorManager indicator={indicator()} />)
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Definição", "Regras de cálculo", "Diagnóstico com IA", "Glossário"])
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Regras de cálculo" }))
    fireEvent.click(screen.getByRole("tab", { name: "Regras de cálculo" }))
    await waitFor(() => expect(screen.getByText("Média do mês")).toBeInTheDocument())
    fireEvent.click(screen.getByRole("button", { name: /Nova regra/ }))
    expect(screen.getByRole("heading", { name: "Nova regra" })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText("Como o indicador é calculado neste grupo"), { target: { value: "Média ponderada pelo volume" } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar regra" }))
    await waitFor(() => expect(state.saveRule).toHaveBeenCalledWith(expect.objectContaining({ indicatorDefinitionId: "ind-1", calculationMethod: "Média ponderada pelo volume", calculationPeriod: "MONTHLY" })))
    await waitFor(() => expect(screen.getByText("Média do mês")).toBeInTheDocument())
    // Editar uma regra existente continua funcionando pelo mesmo formulário.
    fireEvent.click(screen.getByRole("button", { name: "Editar regra" }))
    expect(screen.getByRole("heading", { name: "Editar regra" })).toBeInTheDocument()
    expect(screen.getByLabelText("Como o indicador é calculado neste grupo")).toHaveValue("Média do mês")
  })
})

describe("V1.6.2 — aba Diagnóstico com IA", () => {
  it("A) sem estratégia: \"não configurado\"; configurar abre um rascunho LOCAL — nada é gravado até salvar (V1.6.2a)", () => {
    state.overview = overview()
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.getByText("Não configurado")).toBeInTheDocument()
    expect(screen.getByText(/Diagnóstico com IA não configurado/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Configurar estratégia" }))
    expect(screen.getByText("Novo rascunho (ainda não salvo)")).toBeInTheDocument()
    expect(screen.getByText(/Alterações não salvas/)).toBeInTheDocument()
    // Alterar sem salvar: só estado local.
    fireEvent.click(screen.getByRole("switch", { name: "Segmentar o resultado" }))
    expect(state.saveDraft).not.toHaveBeenCalled()
    // Cancelar volta ao estado sem estratégia, sem escrita.
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    expect(screen.getByText(/Diagnóstico com IA não configurado/)).toBeInTheDocument()
    expect(state.saveDraft).not.toHaveBeenCalled()
    // Salvar é o que cria o rascunho.
    fireEvent.click(screen.getByRole("button", { name: "Configurar estratégia" }))
    fireEvent.click(screen.getByRole("switch", { name: "Segmentar o resultado" }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    expect(state.saveDraft).toHaveBeenCalledTimes(1)
    expect(state.saveDraft).toHaveBeenCalledWith({ indicatorId: "ind-1", config: expect.objectContaining({ segmentation: expect.objectContaining({ enabled: true, dimensions: ["SUBJECT"] }) }) })
  })
  it("P) só capacidades reais: dimensão Motivo; nada de Produto/Canal/Flag/Histórico; Base de Conhecimento travada com processos", () => {
    state.overview = overview({ status: "DRAFT", draft: version("DRAFT", config({ segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 } })) })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.getByText("Motivo / assunto do atendimento")).toBeInTheDocument()
    const text = screen.getByTestId("diagnostic-strategy-tab").textContent ?? ""
    for (const missing of ["Produto", "Canal", "Flag", "Histórico do indicador", "prompt", "Permitir afirmar causa", "Sempre gerar orientação", "Sempre trazer ponto positivo", "aleatória"]) expect(text).not.toContain(missing)
    expect(screen.getByRole("switch", { name: "Consultar Base de Conhecimento" })).toBeDisabled()
  })
  it("P) indicador não decomponível: aviso honesto e nenhuma opção de investigação", () => {
    state.overview = overview({ status: "DRAFT", capabilities: capabilities(false), draft: version("DRAFT", config()) })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.getByText(/ainda não possui uma dimensão operacional disponível para diagnóstico aprofundado/)).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Segmentar o resultado" })).toBeNull()
    expect(screen.getByRole("radiogroup", { name: "Quando a INIA não encontrar evidência suficiente" })).toBeInTheDocument()
  })
  it("rascunho: ligar a investigação liga a avaliação de processos junto; salvar envia a configuração tipada; publicar mostra os bloqueios", async () => {
    state.overview = overview({ status: "DRAFT", draft: version("DRAFT", config({ segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 } })) })
    const { AdminApiError } = await import("@/lib/admin/admin-api")
    state.publish.mockRejectedValueOnce(new AdminApiError("x", "STRATEGY_INVALID_FOR_PUBLISH", { issues: [{ code: "STRATEGY_PEER_WITHOUT_PROCESS", field: "peerComparison", message: "A comparação precisa de pelo menos 4 pessoas contribuindo." }] }))
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    fireEvent.click(screen.getByRole("switch", { name: "Investigar atendimentos do motivo" }))
    expect(screen.getByRole("switch", { name: "Avaliar processos nos atendimentos" })).toBeChecked()
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    expect(state.saveDraft).toHaveBeenCalledWith({ indicatorId: "ind-1", config: expect.objectContaining({ interactionInvestigation: expect.objectContaining({ enabled: true }), processAssessment: { enabled: true } }) })
    fireEvent.click(screen.getByRole("button", { name: /Publicar estratégia/ }))
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("A comparação precisa de pelo menos 4 pessoas contribuindo."))
  })
  it("POPULATION_SIGNAL_V2) sinal nas chamadas: flag numérica pede a condição; o admin declara o que a chamada sinalizada representa; salvar envia o sinal tipado", () => {
    state.overview = overview({ status: "DRAFT", draft: version("DRAFT", config()) })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    fireEvent.click(screen.getByRole("switch", { name: "Usar um sinal das chamadas" }))
    // Só flags ATIVAS; a primeira (ordem alfabética) é a numérica — pede o valor.
    const value = screen.getByLabelText("Valor")
    fireEvent.change(value, { target: { value: "2" } })
    fireEvent.click(screen.getByRole("radio", { name: /Resultado ruim/ }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    expect(state.saveDraft).toHaveBeenCalledWith({ indicatorId: "ind-1", config: expect.objectContaining({ populationSignal: { kind: "INTERACTION_FLAG", flagName: "nota_ura", condition: { operator: "LTE", value: 2 }, effect: "ADVERSE" } }) })
  })
  it("POPULATION_SIGNAL_V2) versão publicada mostra o sinal com a condição e o que ele representa (só leitura)", () => {
    state.overview = overview({ status: "PUBLISHED", published: version("PUBLISHED", config({ populationSignal: { kind: "INTERACTION_FLAG", flagName: "nota_ura", condition: { operator: "LTE", value: 2 }, effect: "ADVERSE" } })), history: [] })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.getByText("“nota_ura ≤ 2”")).toBeInTheDocument()
    expect(screen.getByText(/Quanto mais chamadas com o sinal, pior/)).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: "Usar um sinal das chamadas" })).toBeNull()
  })
  it("D) versão publicada é só leitura; \"Editar estratégia\" cria o próximo rascunho", () => {
    state.overview = overview({ status: "PUBLISHED", published: version("PUBLISHED", config()), history: [{ id: "v-1", version: 1, status: "PUBLISHED", publishedAt: "2026-09-24T00:00:00Z", publishedByName: "Admin" }] })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.getByRole("switch", { name: "Segmentar o resultado" })).toBeDisabled()
    expect(screen.queryByRole("button", { name: /Publicar estratégia/ })).toBeNull()
    expect(screen.getByText(/Versões publicadas não mudam/)).toBeInTheDocument()
    // Abrir a publicada não cria versão; "Editar" também não — só salvar cria o próximo rascunho a partir da vigente.
    fireEvent.click(screen.getByRole("button", { name: "Editar estratégia" }))
    expect(state.saveDraft).not.toHaveBeenCalled()
    expect(screen.getByRole("switch", { name: "Segmentar o resultado" })).toBeEnabled()
    fireEvent.click(screen.getByRole("radio", { name: /Encaminhar para QA/ }))
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    expect(state.saveDraft).toHaveBeenCalledWith({ indicatorId: "ind-1", config: expect.objectContaining({ noDiagnosisBehavior: "HOLD_FOR_QA" }) })
  })
  it("E/F/G) descartar pede confirmação: cancelar mantém o rascunho; confirmar descarta (V1.6.2a)", async () => {
    state.overview = overview({ status: "DRAFT", draft: version("DRAFT", config()) })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Descartar rascunho?")).toBeInTheDocument()
    expect(within(dialog).getByText("As alterações ainda não publicadas desta versão serão perdidas.")).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(state.discard).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Descartar rascunho" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Descartar rascunho" }))
    expect(state.discard).toHaveBeenCalledWith("ind-1")
  })
  it("I) pendência de publicação em seção recolhida: a seção abre e o erro aparece junto do campo, pelo `field` do backend (V1.6.2a)", async () => {
    const peerOn = config({ segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, peerComparison: { enabled: true, minimumPopulation: 3, minimumContributors: 4, minimumObservedInteractions: 5 } })
    state.overview = overview({ status: "DRAFT", draft: version("DRAFT", peerOn) })
    const { AdminApiError } = await import("@/lib/admin/admin-api")
    state.publish.mockRejectedValueOnce(new AdminApiError("x", "STRATEGY_INVALID_FOR_PUBLISH", { issues: [{ code: "STRATEGY_BELOW_PRODUCT_MINIMUM", field: "peerComparison.minimumPopulation", message: "O grupo de referência precisa de pelo menos 4 pessoas." }] }))
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.queryByLabelText("Pessoas no grupo")).toBeNull()
    // Uma alteração local: publicar salva antes; depois disso ela deixa de ser "não salva", mesmo que a publicação falhe.
    fireEvent.click(screen.getByRole("radio", { name: /Encaminhar para QA/ }))
    expect(screen.getByText(/Alterações não salvas/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Publicar estratégia/ }))
    const field = await screen.findByLabelText("Pessoas no grupo")
    expect(field).toHaveAttribute("aria-invalid", "true")
    expect(document.getElementById(field.getAttribute("aria-describedby")!)).toHaveTextContent("O grupo de referência precisa de pelo menos 4 pessoas.")
    await waitFor(() => expect(field).toHaveFocus())
    expect(screen.queryByText(/Alterações não salvas/)).toBeNull()
    // Seções sem pendência continuam fechadas.
    expect(screen.queryByLabelText("Máximo de atendimentos")).toBeNull()
  })
  it("N) Testar diagnóstico: para antes da IA por padrão; o relatório diz que nada foi enviado nem gravado", () => {
    state.overview = overview({ status: "PUBLISHED", published: version("PUBLISHED", config()) })
    state.simulation = {
      strategy: { versionId: "v-1", version: 1, status: "PUBLISHED" },
      officialResult: { indicatorName: "Indicador X", value: "700 s", target: "600 s", comparison: "fora da meta", period: "01/06/2026 a 30/06/2026" },
      investigation: {
        official: { name: "Indicador X", periodLabel: "junho/2026", value: 700, target: 600, withinTarget: false, previous: null },
        localization: { proxy: { kind: "DURATION_SECONDS", label: "Duração registrada", description: "Aproximação pela duração das chamadas." }, windows: { current: { label: "jun/2026" }, previous: { label: "mai/2026" } }, overall: { current: { n: 8, value: 900 }, previous: null, direction: "UNKNOWN" }, decomposition: null, segments: [{ key: "c", label: "Contestação", current: { n: 8, value: 900 }, previous: null, changeDirection: "UNKNOWN", sufficient: false }], daily: { available: false, outliers: [] }, focus: [], limitations: [] },
        evidence: [], reference: null, questions: [{ id: "WHERE", question: "Onde mudou?", answered: false, summary: "Sem período anterior comparável." }], conclusion: "INSUFFICIENT_DATA", limitations: [],
      },
      aiExecuted: false, aiStoppedReason: "A simulação parou antes da IA.", feedback: null, usage: { requests: 0, promptTokens: 0, outputTokens: 0, totalTokens: 0, models: [] }, error: null,
    } satisfies SimulationResult
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    fireEvent.click(screen.getByRole("button", { name: /Testar diagnóstico/ }))
    const report = screen.getByTestId("simulation-report")
    expect(within(report).getByText(/nada foi enviado nem gravado/)).toBeInTheDocument()
    expect(within(report).getByText("Contestação")).toBeInTheDocument()
    expect(within(report).getByText("Nenhuma chamada de modelo.")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "Executar a IA" })).not.toBeChecked()
    // O nome do campo é o rótulo visível (WCAG 2.5.3).
    expect(screen.getByRole("combobox", { name: "Agent que avalia os atendimentos" })).toBeInTheDocument()
  })
})

describe("V1.6.2 — regressões do QA visual (2026-09-25)", () => {
  it("Testar diagnóstico: a busca por colaborador vai ao servidor; o período diz quantos atendimentos há; o botão diz se consome tokens", async () => {
    state.overview = overview({ status: "PUBLISHED", published: version("PUBLISHED", config()) })
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    fireEvent.click(screen.getByRole("button", { name: /Testar diagnóstico/ }))
    fireEvent.change(screen.getByLabelText("Buscar colaborador"), { target: { value: "  Mariana " } })
    await waitFor(() => expect(state.optionSearches).toContain("Mariana"))
    expect(screen.getByRole("button", { name: "Executar teste sem IA" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("switch", { name: "Executar a IA" }))
    expect(screen.getByRole("button", { name: "Executar teste com IA (consome tokens)" })).toBeInTheDocument()
    expect(periodOptionLabel({ periodLabel: "21/09/2026", interactions: 0 })).toBe("21/09/2026 · sem atendimento")
    expect(periodOptionLabel({ periodLabel: "07/09/2026", interactions: 1 })).toBe("07/09/2026 · 1 atendimento")
    expect(periodOptionLabel({ periodLabel: "01/06/2026 a 30/06/2026", interactions: 3 })).toBe("01/06/2026 a 30/06/2026 · 3 atendimentos")
  })
  it("selo de status único: só \"Configurado\" em destaque; publicada com rascunho pendente aparece na listagem", () => {
    const { rerender } = render(<DiagnosticStrategyStatusBadge status="PUBLISHED" draftPending />)
    expect(screen.getByText("Configurado")).toHaveAttribute("data-variant", "secondary")
    expect(screen.getByText("rascunho pendente")).toBeInTheDocument()
    rerender(<DiagnosticStrategyStatusBadge status="DRAFT" draftPending />)
    expect(screen.getByText("Rascunho")).toHaveAttribute("data-variant", "outline")
    expect(screen.queryByText("rascunho pendente")).toBeNull()
    // A aba usa o MESMO selo: "Não configurado" nunca aparece com o destaque de "Configurado".
    cleanup()
    state.overview = overview()
    render(<IndicatorDiagnosticStrategyTab indicatorId="ind-1" />)
    expect(screen.getByText("Não configurado")).toHaveAttribute("data-variant", "outline")
  })
})

describe("V1.6.2 — K) a tela não tem ramo por código de indicador", () => {
  it("nenhum código de indicador (TMA, NPS, FCR…) nos componentes da estratégia", () => {
    const dir = join(process.cwd(), "src/components/admin/indicators")
    for (const file of readdirSync(dir).filter((name) => /diagnostic/.test(name) && !/\.test\./.test(name))) {
      expect(readFileSync(join(dir, file), "utf8"), file).not.toMatch(/["'`](?:TMA|NPS|FCR|NOTA_URA|REINCIDENCIA)["'`]|=== ?["']TMA/)
    }
  })
})
