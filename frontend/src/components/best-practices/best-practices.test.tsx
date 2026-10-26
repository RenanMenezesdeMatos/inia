/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import type { AnalysisReport, BestPracticesMeta, PatternDetail } from "@/schemas/best-practices/best-practices.schema"

import { AnalysisReportBody } from "./analyses-panel"
import { GuidancePreview } from "./guidance-preview"
import { NewAnalysisDialog } from "./new-analysis-dialog"
import { PatternDetailBody } from "./pattern-detail-dialog"
import { RelevantPracticesHint } from "./relevant-practices-hint"

const service = vi.hoisted(() => ({
  fetchRelevantPractices: vi.fn(),
  fetchEvidenceCall: vi.fn(),
  reviewPattern: vi.fn(),
  fetchBestPracticesMeta: vi.fn(),
  fetchPatterns: vi.fn(),
  fetchPattern: vi.fn(),
  fetchAnalyses: vi.fn(),
  fetchAnalysis: vi.fn(),
  createAnalysis: vi.fn(),
  fetchGuidancePreview: vi.fn(),
}))
vi.mock("@/services/best-practices/best-practices-service", () => service)

const GROUP = { operatorsSampled: 3, operatorsApplicable: 3, callsSampled: 9, callsApplicable: 9, callsPresent: 8, callsNotApplicable: 0, callsUnclear: 0, operatorRatePercent: 88.9, callRatePercent: 88.9, adopters: 3, operatorsWithPresence: 3, topOperatorSharePercent: 37.5 }
const REFERENCE = { ...GROUP, operatorsSampled: 12, operatorsApplicable: 12, callsSampled: 36, callsApplicable: 36, callsPresent: 2, operatorRatePercent: 5.6, callRatePercent: 5.6, adopters: 0, operatorsWithPresence: 2, topOperatorSharePercent: 50 }
const PATTERN: PatternDetail = {
  id: "p-1", dataOrigin: "SYNTHETIC", syntheticDatasetLabel: "Boas práticas · dataset sintético V1", indicatorId: "i-1", channelFlagId: null, outcomeSource: "INDICATOR", indicatorCode: "TMA", indicatorName: "Tempo Médio de Atendimento", teamId: null, teamName: null, subteamId: null, subteamName: null,
  name: "Retomar resumindo o que foi verificado", description: "Ao voltar de uma verificação, conta o que conferiu e o próximo passo.", observableDefinition: "Ao retomar, diz o que conferiu e o próximo passo.", guidance: "Diga o que conferiu e o que vai fazer agora.", suggestedPhrasing: "Conferi a sua fatura e encontrei o motivo da diferença.", appliesWhen: "quando o operador interrompe para verificar algo", notApplicableWhen: null,
  howItHelps: null, howItHelpsSource: null,
  reviewStatus: "PENDING_REVIEW", obligationStatus: "UNDETERMINED", obligationConfirmedByReview: false, currentStrength: "MODERATE",
  supportedContexts: [{ cellKey: "Fatura", reason: "Fatura", subReason: null, label: "Fatura", strength: "MODERATE", topRatePercent: 88.9, referenceRatePercent: 5.6, topOperators: 3, referenceOperators: 12, topCalls: 9, referenceCalls: 36 }],
  updatedAt: "2026-10-20T12:00:00.000Z", currentVersion: 1, periodStart: "2026-09-01", periodEnd: "2026-09-30", callsAnalyzed: 90, operatorsAnalyzed: 15, available: false,
  unavailabilityReasons: ["Dado sintético: nunca usado em recomendações de produção.", "Ainda não foi aprovado por uma pessoa.", "Pode ser uma obrigação do processo: falta a validação."],
  canManage: true,
  current: {
    id: "v-1", version: 1, analysisId: "a-1",
    contexts: [{ cellKey: "Fatura", reason: "Fatura", subReason: null, label: "Fatura", assessment: { outcome: "SUPPORTED", strength: "MODERATE", top: GROUP, reference: REFERENCE, differencePp: 83.3, consistencyPercent: 100, criteria: [{ key: "OPERATORS", label: "≥ 3 operadores com a situação em cada grupo", met: true, value: "3 × 12", level: "SUPPORT" }], explanation: "Associação moderada." } }],
    strength: "MODERATE",
    obligationCheck: { status: "UNDETERMINED", reasonCode: "UNCERTAIN", explanation: "As fontes não permitem decidir se é obrigação: fica para validação humana.", sources: [], consulted: { documents: 1, argumentScripts: 1, practices: 0, omitted: [] } },
    limitations: ["Associação observada, nunca causa."], periodStart: "2026-09-01", periodEnd: "2026-09-30", referencePeriods: ["2026-09"], callsAnalyzed: 90, operatorsAnalyzed: 15, createdAt: "2026-10-20T12:00:00.000Z",
  },
  evidence: [{ id: "e-1", callRef: "BP-SINT-0004", interactionId: null, operatorLabel: "Operador A", context: "Fatura", occurredAt: "2026-09-04T12:00:00.000Z", turnRef: "T9", excerpt: "Conferi a sua fatura e vi que entrou uma cobrança proporcional" }],
  versions: [],
  reviews: [{ id: "r-1", action: "ANALYSIS_UPDATE", fromStatus: "PENDING_REVIEW", toStatus: "PENDING_REVIEW", reason: "Padrão criado por esta análise (pendente de revisão).", analysisId: "a-1", createdAt: "2026-10-20T12:00:00.000Z", actorName: null }],
}

beforeAll(() => installJsdomStubs())
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const inDialog = (node: React.ReactNode) => <Dialog open><DialogContent>{node}</DialogContent></Dialog>

describe("detalhe do padrão", () => {
  it("mostra por que não orienta, os números por contexto, a obrigação pendente, a evidência mascarada e a fala como exemplo", () => {
    renderWithQuery(inDialog(<PatternDetailBody pattern={PATTERN} />))
    expect(screen.getByText("Não orienta operadores agora")).toBeInTheDocument()
    expect(screen.getByText("Dado sintético: nunca usado em recomendações de produção.")).toBeInTheDocument()
    expect(screen.getByText("Dados sintéticos — não é prova")).toBeInTheDocument()
    expect(screen.getByText("+83 p.p.")).toBeInTheDocument()
    expect(screen.getByText(/As fontes não permitem decidir/)).toBeInTheDocument()
    expect(screen.getByText(/Sugestão de fala — exemplo para experimentar, não é fala de nenhuma chamada/)).toBeInTheDocument()
    expect(screen.getByText("Operador A")).toBeInTheDocument()
    expect(screen.getByText(/Conferi a sua fatura e vi que entrou/)).toBeInTheDocument()
  })

  it("revisão: aprovar fica bloqueado até confirmar que não é obrigação; a confirmação pede o motivo", async () => {
    service.reviewPattern.mockResolvedValue({ id: "p-1", reviewStatus: "PENDING_REVIEW", obligationConfirmedByReview: true })
    renderWithQuery(inDialog(<PatternDetailBody pattern={PATTERN} />))
    expect(screen.getByRole("button", { name: /Aprovar/ })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Confirmar que não é obrigação/ }))
    const confirm = await screen.findByRole("button", { name: "Confirmar" })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Como você confirmou?"), { target: { value: "Procedimentos revisados: não é exigido." } })
    fireEvent.click(confirm)
    await vi.waitFor(() => expect(service.reviewPattern).toHaveBeenCalledWith("p-1", { action: "CONFIRM_NOT_OBLIGATION", reason: "Procedimentos revisados: não é exigido." }))
  })

  it("BEST_PRACTICE_HOW_IT_HELPS_V1: o rascunho da IA aparece marcado para conferir; sem texto, a tela diz que o feedback não liga a prática ao resultado", () => {
    const draft = "O cliente não precisa anotar o protocolo na linha, e esse tempo sai da chamada."
    renderWithQuery(inDialog(<PatternDetailBody pattern={{ ...PATTERN, howItHelps: draft, howItHelpsSource: "AI_DRAFT" }} />))
    expect(screen.getByText(draft)).toBeInTheDocument()
    expect(screen.getByText("Rascunho da IA — confira antes de aprovar")).toBeInTheDocument()
    cleanup()
    renderWithQuery(inDialog(<PatternDetailBody pattern={{ ...PATTERN, howItHelps: draft, howItHelpsSource: "REVIEWER" }} />))
    expect(screen.queryByText("Rascunho da IA — confira antes de aprovar")).not.toBeInTheDocument()
    cleanup()
    renderWithQuery(inDialog(<PatternDetailBody pattern={PATTERN} />))
    expect(screen.getByText("Sem texto: o feedback não liga esta prática ao resultado.")).toBeInTheDocument()
  })

  it("BEST_PRACTICE_HOW_IT_HELPS_V1: quem revisa escreve o 'como ajuda no resultado' na edição e ele vai junto com o resto", async () => {
    service.reviewPattern.mockResolvedValue({ id: "p-1", reviewStatus: "PENDING_REVIEW", obligationConfirmedByReview: false })
    renderWithQuery(inDialog(<PatternDetailBody pattern={PATTERN} />))
    fireEvent.click(screen.getByRole("button", { name: /Editar/ }))
    fireEvent.change(screen.getByLabelText("Como isso ajuda no resultado (opcional)"), { target: { value: "  O cliente não precisa anotar o protocolo na linha.  " } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar e voltar para revisão" }))
    await vi.waitFor(() => expect(service.reviewPattern).toHaveBeenCalledWith("p-1", expect.objectContaining({ action: "EDIT", changes: expect.objectContaining({ howItHelps: "O cliente não precisa anotar o protocolo na linha." }) })))
  })

  it("quem só lê não vê as ações de revisão", () => {
    renderWithQuery(inDialog(<PatternDetailBody pattern={{ ...PATTERN, canManage: false }} />))
    expect(screen.queryByRole("button", { name: /Aprovar/ })).not.toBeInTheDocument()
  })
})

describe("relatório da análise", () => {
  it("explica cada decisão e as limitações", () => {
    const report: AnalysisReport = {
      outcome: "PATTERNS_FOUND", summary: "2 padrões.", population: { label: "Central Sintética", origin: "SYNTHETIC" }, period: { start: "2026-09-01", end: "2026-09-30", referencePeriods: ["2026-09"] },
      comparison: { top: "Melhores resultados (1º quartil oficial)", reference: "Referência (demais quartis)", method: "Pelo quartil oficial." }, groups: { top: 4, reference: 12, excluded: [] },
      cells: [{ cellKey: "Cancelamento", label: "Cancelamento", status: "INSUFFICIENT_DATA", note: "Dados insuficientes: 0 operador(es) com melhores resultados.", groups: { TOP: { operators: 0, evaluable: 0, fewCalls: 0, sampled: 0 }, REFERENCE: { operators: 2, evaluable: 2, fewCalls: 0, sampled: 0 } } }],
      discovery: { calls: 12, proposed: 11, rejected: [{ name: "Manter um tom de voz descontraído", reason: "REQUIRES_AUDIO" }], recognizedKnown: [], noCandidateReason: null, failed: false },
      candidates: [{ key: "B6", name: "Encerrar a chamada de forma direta, sem o aviso final", origin: "DISCOVERED", patternId: null, observableDefinition: "x", contexts: [], strength: "MODERATE", obligation: { status: "CONFLICT", sources: [] }, decision: "DISCARDED_CONFLICT", decisionNote: "" }],
      codings: { total: 900, reused: 0, unclear: 1, unverifiedQuotes: 0, fromCustomer: 1, modelFailures: 0 }, limitations: ["DADOS SINTÉTICOS: validam o mecanismo."], method: ["Associação, nunca causa."], usage: { calls: 25, costUsd: 0, models: [] },
    }
    renderWithQuery(<AnalysisReportBody report={report} />)
    expect(screen.getByText("Descartado: contraria o processo")).toBeInTheDocument()
    expect(screen.getByText(/Recusado na descoberta: Manter um tom de voz descontraído \(exige áudio\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 fala\(s\) de cliente recusada\(s\) como evidência/)).toBeInTheDocument()
    expect(screen.getByText("DADOS SINTÉTICOS: validam o mecanismo.")).toBeInTheDocument()
  })
})

describe("indicativo no Diagnóstico", () => {
  it("sem prática relevante não aparece nada", async () => {
    service.fetchRelevantPractices.mockResolvedValue([])
    const { container } = renderWithQuery(<RelevantPracticesHint interactionId="int-1" />)
    await vi.waitFor(() => expect(service.fetchRelevantPractices).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
  it("com prática: fechado, com a contagem; aberto mostra a associação e o link para as evidências", async () => {
    service.fetchRelevantPractices.mockResolvedValue([{ patternId: "p-9", name: "Explicar o motivo da espera", description: "d", contexts: ["Suporte técnico"], association: "Apareceu em 89% × 6%.", strength: "Moderada", you: "Nas suas chamadas analisadas, o comportamento apareceu em 0 de 3 em que a situação existiu.", youKind: "RARELY", howTo: "Diga quanto tempo leva.", suggestedPhrasing: null, notApplicableWhen: null, synthetic: false, indicatorName: "TMA" }])
    renderWithQuery(<RelevantPracticesHint indicatorId="i-1" personId="p-1" />)
    fireEvent.click(await screen.findByText("Boas práticas observadas para este caso (1)"))
    expect(await screen.findByText("Apareceu em 89% × 6%.")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Ver evidências e critérios" })).toHaveAttribute("href", "/best-practices?pattern=p-9")
  })
})

describe("seletores sem valor inicial", () => {
  const META: BestPracticesMeta = {
    indicators: [{ id: "i-1", code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER_IS_BETTER" }],
    signals: [{ id: "f-1", name: "Nota da URA", good: "Nota da URA ≥ 4", bad: "Nota da URA ≤ 2" }],
    teams: [], manageableTeams: [{ id: "t-1", name: "Grupo QA", subteams: [], wholeTeam: true }],
    datasets: [
      { id: "d-1", key: "BP_A", label: "Dataset A", description: "", version: 1, hasAnswerKey: true, calls: 10, operators: 2, operatorList: [{ ref: "OP-1", name: "Operador 1" }, { ref: "OP-2", name: "Operador 2" }], periods: ["2026-09"] },
      { id: "d-2", key: "BP_B", label: "Dataset B", description: "", version: 1, hasAnswerKey: true, calls: 10, operators: 1, operatorList: [{ ref: "OP-9", name: "Operador 9" }], periods: ["2026-09"] },
    ],
    periods: ["2026-09"], capabilities: { canManage: true, canRunSynthetic: true },
    comparisonModes: [{ mode: "TOP_QUARTILE_VS_REST", top: "1º quartil", reference: "Demais quartis", method: "" }],
    method: [], labels: { outcome: {}, strength: {}, obligation: {}, review: {} },
  }
  const choose = async (trigger: string, option: string) => {
    fireEvent.click(screen.getByRole("combobox", { name: trigger }))
    fireEvent.click(await screen.findByRole("option", { name: option }))
  }
  // O Radix avisa a troca controlado ↔ não controlado por console.warn (em desenvolvimento).
  const watchControlWarnings = () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
    return { found: () => spy.mock.calls.filter((call) => call.some((arg) => typeof arg === "string" && /changing from (un)?controlled/.test(arg))), restore: () => spy.mockRestore() }
  }

  it("a pré-visualização troca dataset, operador e indicador sem alternar entre controlado e não controlado", async () => {
    const warnings = watchControlWarnings()
    service.fetchGuidancePreview.mockResolvedValue({ text: "Orientação de teste" })
    renderWithQuery(<GuidancePreview meta={META} />)
    await choose("Indicador da pré-visualização", "Tempo Médio de Atendimento")
    await choose("Dataset", "Dataset B")
    await choose("Operador fictício", "Operador 9")
    expect(await screen.findByText("Orientação de teste")).toBeInTheDocument()
    expect(warnings.found()).toEqual([])
    warnings.restore()
  })
  it("a nova análise pode comparar só um Subgrupo do Grupo; quem administra só o Subgrupo não vê \"Todo o Grupo\"", async () => {
    service.createAnalysis.mockResolvedValue({ id: "a-1", status: "QUEUED" })
    const withSubteams = { ...META, manageableTeams: [{ id: "t-1", name: "Grupo QA", subteams: [{ id: "s-1", name: "Célula A" }], wholeTeam: true }] }
    const { unmount } = renderWithQuery(<NewAnalysisDialog meta={withSubteams} />)
    fireEvent.click(screen.getByRole("button", { name: "Nova análise" }))
    fireEvent.click(screen.getByRole("radio", { name: "Reais" }))
    await choose("Indicador", "Tempo Médio de Atendimento")
    await choose("Subgrupo", "Célula A")
    fireEvent.click(screen.getByRole("button", { name: "Pedir análise" }))
    await vi.waitFor(() => expect(service.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ origin: "REAL", teamId: "t-1", subteamId: "s-1" })))
    unmount()
    renderWithQuery(<NewAnalysisDialog meta={{ ...withSubteams, manageableTeams: [{ ...withSubteams.manageableTeams[0]!, wholeTeam: false }] }} />)
    fireEvent.click(screen.getByRole("button", { name: "Nova análise" }))
    fireEvent.click(screen.getByRole("combobox", { name: "Subgrupo" }))
    expect(await screen.findByRole("option", { name: "Célula A" })).toBeInTheDocument()
    expect(screen.queryByRole("option", { name: "Todo o Grupo" })).not.toBeInTheDocument()
  })
  it("a nova análise pode medir pelo SINAL da chamada (chamadas boas × ruins), sem indicador nem quartil", async () => {
    service.createAnalysis.mockResolvedValue({ id: "a-2", status: "QUEUED" })
    renderWithQuery(<NewAnalysisDialog meta={META} />)
    fireEvent.click(screen.getByRole("button", { name: "Nova análise" }))
    fireEvent.click(screen.getByRole("radio", { name: /Sinal da chamada/ }))
    expect(screen.getByText(/Compara chamadas com Nota da URA ≥ 4 \(boas\) e com Nota da URA ≤ 2 \(ruins\)/)).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Comparação" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Pedir análise" }))
    await vi.waitFor(() => expect(service.createAnalysis).toHaveBeenCalledWith(expect.objectContaining({ outcomeSource: "CALL_SIGNAL", channelFlagId: "f-1" })))
    expect(service.createAnalysis.mock.lastCall![0]).not.toHaveProperty("indicatorDefinitionId")
  })
  it("a nova análise escolhe o indicador sem alternar entre controlado e não controlado", async () => {
    const warnings = watchControlWarnings()
    renderWithQuery(<NewAnalysisDialog meta={META} />)
    fireEvent.click(screen.getByRole("button", { name: "Nova análise" }))
    await choose("Indicador", "Tempo Médio de Atendimento")
    expect(screen.getByRole("button", { name: "Pedir análise" })).toBeEnabled()
    expect(warnings.found()).toEqual([])
    warnings.restore()
  })
})
