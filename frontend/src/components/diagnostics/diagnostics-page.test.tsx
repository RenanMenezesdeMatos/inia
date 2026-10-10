/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"

import type { ProcessRow } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { DiagnosticsPage } from "./diagnostics-page"

const service = vi.hoisted(() => ({
  fetchMemorySummary: vi.fn(),
  fetchMemoryFilterOptions: vi.fn(),
  fetchProcessAggregates: vi.fn(),
  fetchPeopleAggregates: vi.fn(),
  fetchConcentration: vi.fn(),
  fetchMaterialAggregates: vi.fn(),
  fetchIndicatorInvestigations: vi.fn(),
  fetchIndicatorInvestigation: vi.fn(),
  fetchAssessments: vi.fn(),
  fetchAssessmentDetail: vi.fn(),
  memoryExportHref: (_filters: unknown, view: string) => `/export.csv?view=${view}`,
}))
vi.mock("@/services/diagnostics/diagnostics-memory-service", () => service)

/** 20 regras avaliadas; 6 em desvio por regra — duas delas a MESMA conduta (protocolo antes de transferir, duas fontes): 5 condutas. */
const OCCURRENCES = { basis: "FULL" as const, assessed: 19, deviations: 5, met: 14, assessedRules: 20, deviationRules: 6, sharedDeviationRules: 2, undeterminedAssessedRules: 0, deviationRate: 26.3 }
const STATS = { calls: 4, assessed: 20, met: 14, notMet: 5, partial: 1, inconclusive: 2, notApplicable: 3, deviationRate: 30, coverageRate: 90.9, occurrences: OCCURRENCES }
const SUMMARY = { filters: {}, method: "Contagens da leitura vigente de cada chamada × etapa. Denominador = etapas avaliadas.", stats: STATS, criteria: 6, people: 2, lastAnalysisAt: "2026-09-29T12:00:00.000Z", callOutcomes: { total: 4, usable: 3, partial: 1, insufficient: 0, path_incorrect: 1, path_assessed: 4 } }
const PROCESS = { ...STATS, practiceKey: "KP-aaaaaaaaaaaa", title: "Prazo da análise", description: "Informar o prazo da análise da contestação exibido na ferramenta", organized: true, rules: 1, sources: [{ documentId: "doc-1", documentTitle: "Contestação de conta", section: "35. Prazo da análise", kind: "KNOWLEDGE" as const }], people: 2, peopleWithDeviation: 1, peopleWithMet: 2 }
const THEME = { ...STATS, themeKey: "KT-aaaaaaaaaaaa", title: "Prazo e próximos passos", points: 1, people: 2, peopleWithDeviation: 1, peopleWithMet: 2 }
/** Resposta de pontos do processo: temas com os pontos dentro. */
const themes = (items: ProcessRow[], extra: Partial<typeof THEME> = {}) => ({ order: "DEVIATIONS" as const, totalPoints: items.length, listedPoints: items.length, themes: items.length > 0 ? [{ ...THEME, ...extra, points: items.length, items }] : [] })
const SECTION = (section: string, assessed: number, deviations: number) => ({ section, assessed, met: assessed - deviations, deviations, recommended: 0, points: [{ practiceKey: `KP-${section.length}`, title: `Ponto da ${section}`, assessed, met: assessed - deviations, deviations }] })
const MATERIAL = { ...STATS, documentId: "doc-1", title: "Contestação de conta", href: "/materiais/doc-1", groundedCalls: 4, groundedPeople: 2, peopleWithDeviation: 1, recommended: 0, delivered: 0, recommendedPeople: 0, reasons: [], practices: [],
  sections: Array.from({ length: 10 }, (_, index) => SECTION(`${index + 30}. Seção ${index + 1}`, 10 - index, index % 3)) }
/** Abre um tema (os pontos só aparecem quando o tema é aberto). */
const openTheme = async (title = "Prazo e próximos passos") => fireEvent.click(await screen.findByRole("button", { name: new RegExp(title) }))
const ASSESSMENT_ROW = { id: "cca-1", callAssessmentId: "ca-1", interactionId: "int-1", personId: "p-1", personName: "Larissa Monteiro", teamName: "B2C", date: "2026-09-20", subject: "Contestação", status: "NOT_MET", criterionKey: "KC-aaaaaaaaaaaa", criterionText: "Informar o prazo exibido na ferramenta", rationale: "Disse 'é só aguardar' sem informar o prazo.", materiality: "HIGH", documentTitle: "Contestação de conta", section: "35. Prazo da análise", evidence: [{ turn: "T9", speaker: "OPERADOR", quote: "é só aguardar a análise" }] }
const DETAIL = {
  id: "ca-1", interactionId: "int-1", externalId: "EXT-1", personId: "p-1", personName: "Larissa Monteiro", occurredAt: "2026-09-20T13:00:00.000Z", date: "2026-09-20", subject: "Contestação", channel: "VOICE", selectionReason: "Interação do gatilho", transcriptStatus: "COMPLETE",
  procedure: { documentId: "doc-1", title: "Contestação de conta", version: 3, perspective: "IN_FORCE_AT_CALL" },
  scenario: { customerNeed: "Contestar cobrança de serviço não contratado", correctPath: "Abrir contestação e informar prazo", pathTaken: "Abriu contestação sem prazo", pathRationale: "Faltou o prazo" },
  pathAssessment: "PARTIALLY_CORRECT", coverage: { status: "COMPLETE" }, outcome: "USABLE", limitations: [], isCurrent: true, structureBasis: "CURRENT_AT_ANALYSIS",
  criteria: [{ id: "cca-1", criterionKey: "KC-aaaaaaaaaaaa", text: "Informar o prazo exibido na ferramenta", section: "35. Prazo da análise", documentId: "doc-1", documentTitle: "Contestação de conta", documentVersion: 3, status: "NOT_MET", evidenceKind: "CONDUCT_OBSERVED", evidence: [{ turn: "T9", speaker: "OPERADOR", quote: "é só aguardar a análise" }], opportunityTurn: null, rationale: "Não informou o prazo.", guidance: { moment: "Ao registrar a contestação", condition: null, action: "informe o prazo exibido na ferramenta" }, whyItMatters: null, materiality: "HIGH", ruleConflict: false, onPath: true, identityBasis: "FIRST_SEEN", href: "/materiais/doc-1" }],
  transcript: [{ turn: "T9", speaker: "OPERADOR", text: "Pronto, é só aguardar a análise.", timestamp: null }],
}

const INVESTIGATION_ROW = { id: "inv-1", personId: "p-1", personName: "Larissa Monteiro", indicatorCode: "REINCIDENCIA_7D", indicatorName: "Reincidência em até 7 Dias", periodLabel: "setembro/2026", official: { value: 11.6, target: 9, unit: "PERCENT", withinTarget: false }, conclusion: "PATTERN_SUPPORTED", focus: [{ label: "Reparo de banda larga", reason: "DETERIORATED" }], patterns: [], evidence: [], reference: null, questions: [], limitations: [], createdAt: "2026-10-06T12:00:00.000Z" }
const INVESTIGATION = {
  id: "inv-1", personId: "p-1", personName: "Larissa Monteiro", createdAt: "2026-10-06T12:00:00.000Z", callAssessments: { "int-1": "ca-1" },
  official: { name: "Reincidência em até 7 Dias", periodLabel: "setembro/2026", value: 11.6, target: 9, unit: "PERCENT", direction: "LOWER", withinTarget: false, movement: "WORSENED", previous: { value: 8.51, periodLabel: "agosto/2026" }, quartile: "Q4", previousQuartile: "Q2" },
  localization: {
    proxy: { kind: "SIGNAL_RATE", label: "a taxa de chamadas com o sinal", description: "aproximação pelo sinal registrado." }, windows: { current: { label: "01/09 a 30/09" }, previous: { label: "01/08 a 31/08" } }, overall: { current: null, previous: null, direction: "WORSE" }, decomposition: null,
    segments: [
      { key: "reparo", label: "Reparo de banda larga", previous: { n: 4, value: 0 }, current: { n: 5, value: 1 }, changeDirection: "WORSE", sufficient: true },
      { key: "plano", label: "Plano", previous: { n: 1, value: 0 }, current: null, changeDirection: "UNKNOWN", sufficient: false },
    ],
    daily: { available: false, outliers: [] }, focus: [{ key: "reparo", label: "Reparo de banda larga", reason: "DETERIORATED" }], limitations: ["Métrica por assunto é aproximação."],
  },
  evidence: [{ segmentLabel: "Reparo de banda larga", analyzedCalls: 5, universe: 5, sampleNote: "5 de 5 chamadas do assunto têm análise.", patterns: [
    { criterionKey: "KC-aaaaaaaaaaaa", practiceTitle: "Confirmar o entendimento da solicitação do cliente", text: "Confirmar ou resumir a demanda **preservando** o sentido do relato.", documentTitle: "Argumentário: Compreensão da demanda", heading: "Pontos obrigatórios", classification: "DEVELOPMENT_PATTERN", eligible: 4, met: 0, notMet: 3, partial: 1, inconclusive: 1, examples: [{ interactionId: "int-1", localDate: "2026-09-23", rationale: "Não informou o prazo." }] },
    { criterionKey: "KC-cccccccccccc", text: "Oferecer ajuda para outra solicitação.", classification: "ISOLATED_DEVIATION", eligible: 2, met: 0, notMet: 2, partial: 0, inconclusive: 0, examples: [] },
  ] }],
  reference: null,
  questions: [{ id: "WHERE", question: "Onde o resultado mudou?", answered: true, summary: "No assunto Reparo de banda larga." }],
  conclusion: "PATTERN_SUPPORTED", limitations: [],
}

beforeAll(installJsdomStubs)
beforeEach(() => {
  service.fetchMemorySummary.mockResolvedValue(SUMMARY)
  service.fetchMemoryFilterOptions.mockResolvedValue({ teams: [{ id: "t-1", name: "B2C" }], subteams: [], subjects: ["Contestação"], documents: [{ id: "doc-1", title: "Contestação de conta" }], people: [{ id: "p-1", name: "Larissa Monteiro" }] })
  service.fetchProcessAggregates.mockResolvedValue(themes([PROCESS]))
  service.fetchAssessments.mockResolvedValue({ total: 1, items: [ASSESSMENT_ROW], page: 1, pageSize: 25 })
  service.fetchAssessmentDetail.mockResolvedValue(DETAIL)
  service.fetchIndicatorInvestigations.mockResolvedValue({ total: 0, items: [], page: 1, pageSize: 25 })
  service.fetchMaterialAggregates.mockResolvedValue({ items: [MATERIAL] })
  service.fetchPeopleAggregates.mockResolvedValue({ total: 2, groupBy: "PERSON", page: 1, pageSize: 200, items: [
    { ...STATS, key: "p-1", label: "Larissa Monteiro", topDeviations: [], notMet: 5, partial: 1, met: 4, assessed: 10 },
    { ...STATS, key: "p-2", label: "Rafael Souza", topDeviations: [], notMet: 0, partial: 0, met: 10, assessed: 10 },
  ] })
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("DiagnosticsPage — memória real do motor de feedback", () => {
  it("mostra os números com denominador e o método, sem os exemplos fixos do mock antigo", async () => {
    renderWithQuery(<DiagnosticsPage />)
    expect(await screen.findByText("30%")).toBeInTheDocument()
    expect(screen.getByText("6 de 20 regras avaliadas (cada regra numa chamada conta uma vez)")).toBeInTheDocument()
    expect(screen.getByText(/Denominador = etapas avaliadas/)).toBeInTheDocument()
    expect(screen.queryByText("Ana Lima")).not.toBeInTheDocument()
    expect(screen.queryByText(/Confiança/)).not.toBeInTheDocument()
  })

  it("Ver chamadas abre a REVISÃO do ponto: números, quem mais erra, situações com contagem, a lista e a chamada escolhida com o ponto em destaque", async () => {
    renderWithQuery(<DiagnosticsPage />)
    await openTheme()
    fireEvent.click(await screen.findByRole("button", { name: "Ver chamadas" }))
    const review = await screen.findByRole("dialog", { name: "Prazo da análise" })
    expect(within(review).getByText("Ponto do processo · Prazo e próximos passos")).toBeInTheDocument()
    expect(within(review).getByText("Informar o prazo da análise da contestação exibido na ferramenta")).toBeInTheDocument()
    await waitFor(() => expect(service.fetchAssessments).toHaveBeenCalled())
    expect(service.fetchAssessments.mock.calls[0]![0]).toMatchObject({ practiceKey: "KP-aaaaaaaaaaaa", status: "DEVIATION" })
    // Quem mais erra (por pessoa) e as situações com a contagem de cada uma.
    expect(await within(review).findByText(/Quem mais erra · 1 de 2 pessoas com desvio/)).toBeInTheDocument()
    expect(within(review).getByRole("radio", { name: /Desvios\s*6/ })).toHaveAttribute("aria-checked", "true")
    // Lista: o que aconteceu e a fala; a primeira chamada já aparece à direita, com o ponto em destaque.
    expect(await within(review).findByText("Disse 'é só aguardar' sem informar o prazo.")).toBeInTheDocument()
    expect(await within(review).findByRole("heading", { name: "Neste ponto" })).toBeInTheDocument()
    expect(within(review).getAllByText(/é só aguardar a análise/).length).toBeGreaterThan(0)
    expect(within(review).getByText(/informe o prazo exibido na ferramenta/)).toBeInTheDocument()
    expect(within(review).getByRole("link", { name: /Contestação de conta/ })).toHaveAttribute("target", "_blank")
    // Clicar numa pessoa filtra as chamadas; a situação continua.
    fireEvent.click(within(review).getAllByRole("button", { name: /Larissa Monteiro/ }).find((button) => button.hasAttribute("aria-pressed"))!)
    await waitFor(() => expect(service.fetchAssessments.mock.calls.at(-1)![0]).toMatchObject({ practiceKey: "KP-aaaaaaaaaaaa", personId: "p-1", status: "DEVIATION" }))
    fireEvent.click(within(review).getByRole("radio", { name: /Acertos/ }))
    await waitFor(() => expect(service.fetchAssessments.mock.calls.at(-1)![0]).toMatchObject({ personId: "p-1", status: "MET" }))
  })

  it("conta por regra e, à parte, por conduta: a mesma omissão contrariando duas regras é UMA conduta em desvio", async () => {
    renderWithQuery(<DiagnosticsPage />)
    expect(await screen.findByText("26,3%")).toBeInTheDocument()
    expect(screen.getByText("5 conduta(s) em desvio de 19 avaliada(s) · 6 desvio(s) por regra")).toBeInTheDocument()
  })

  it("dados antigos sem ligação entre regras: a taxa por conduta não é inventada (parcial avisa; nenhuma ligação = sem taxa)", async () => {
    service.fetchMemorySummary.mockResolvedValue({ ...SUMMARY, stats: { ...STATS, occurrences: { ...OCCURRENCES, basis: "PARTIAL", assessed: 9, deviations: 2, assessedRules: 10, deviationRules: 3, sharedDeviationRules: 2, undeterminedAssessedRules: 10, deviationRate: 22.2 } } })
    renderWithQuery(<DiagnosticsPage />)
    expect(await screen.findByText(/10 regra\(s\) de análises antigas fora desta taxa/)).toBeInTheDocument()
    cleanup()
    service.fetchMemorySummary.mockResolvedValue({ ...SUMMARY, stats: { ...STATS, occurrences: { ...OCCURRENCES, basis: "NONE", assessed: 0, deviations: 0, met: 0, assessedRules: 0, deviationRules: 0, sharedDeviationRules: 0, undeterminedAssessedRules: 20, deviationRate: null } } })
    renderWithQuery(<DiagnosticsPage />)
    expect(await screen.findByText(/não dá para contar condutas distintas/)).toBeInTheDocument()
  })

  it("na avaliação da chamada, a regra ligada à mesma conduta mostra a outra fonte normativa", async () => {
    service.fetchAssessmentDetail.mockResolvedValue({ ...DETAIL, criteria: DETAIL.criteria.map((criterion) => ({ ...criterion, occurrence: { basis: "REVIEW_SAME_CONDUCT", sameConductAs: [{ criterionKey: "KC-bbbbbbbbbbbb", text: "Antes de encerrar qualquer chamada: informe o protocolo", documentTitle: "Checklist de Encerramento" }] } })) })
    renderWithQuery(<DiagnosticsPage />)
    await openTheme()
    fireEvent.click(await screen.findByRole("button", { name: "Ver chamadas" }))
    const sheet = await screen.findByRole("dialog", { name: "Prazo da análise" })
    expect(await within(sheet).findByText(/Mesma conduta avaliada também por: Antes de encerrar qualquer chamada: informe o protocolo \(Checklist de Encerramento\) — conta como uma ocorrência/)).toBeInTheDocument()
  })

  it("os pontos aparecem agrupados por TEMA: fechado, o tema mostra quantos pontos e o resumo; aberto, o nome curto, a conduta e as fontes", async () => {
    const closing = { ...PROCESS, practiceKey: "KP-bbbbbbbbbbbb", title: "Protocolo", description: "Informar o número do protocolo de atendimento", notMet: 2, partial: 0, met: 3, assessed: 5 }
    const loose = { ...PROCESS, practiceKey: "KC-cccccccccccc", title: "Consultar os sistemas para verificar o consumo", description: null, organized: false }
    service.fetchProcessAggregates.mockResolvedValue({ order: "DEVIATIONS", totalPoints: 4, listedPoints: 3, themes: [
      { ...THEME, themeKey: "KT-bbbbbbbbbbbb", title: "Encerramento do atendimento", points: 2, notMet: 7, partial: 1, met: 9, assessed: 17, deviationRate: 47.1, people: 4, peopleWithDeviation: 3, items: [PROCESS, closing] },
      { ...THEME, themeKey: null, title: null, points: 1, items: [loose] },
    ] })
    renderWithQuery(<DiagnosticsPage />)
    const trigger = await screen.findByRole("button", { name: /Encerramento do atendimento/ })
    expect(within(trigger).getByText("2 pontos com desvio")).toBeInTheDocument()
    expect(within(trigger).getByText(/em 17 avaliações/)).toBeInTheDocument()
    expect(within(trigger).getByText("47,1%")).toBeInTheDocument()
    expect(within(trigger).getByText(/3 de 4 pessoas com desvio/)).toBeInTheDocument()
    expect(screen.getByText("1 tema · 3 de 4 pontos avaliados com desvio")).toBeInTheDocument()
    // Fechado: nenhum ponto à vista (nada do texto longo das regras).
    expect(screen.queryByText("Protocolo")).not.toBeInTheDocument()
    fireEvent.click(trigger)
    expect(await screen.findByText("Protocolo")).toBeInTheDocument()
    expect(screen.getByText("Informar o número do protocolo de atendimento")).toBeInTheDocument()
    // Pontos sem tema: grupo à parte, por último, explicado.
    await openTheme("Ainda sem tema")
    expect(await screen.findByText(/ainda não agrupou num tema/)).toBeInTheDocument()
    expect(screen.getByText("Consultar os sistemas para verificar o consumo")).toBeInTheDocument()
  })

  it("um ponto reúne as regras que pedem a mesma conduta (base e argumentário), com as fontes; a ordem troca para onde mais se acerta", async () => {
    const merged = { ...PROCESS, rules: 3, sources: [{ documentId: "doc-1", documentTitle: "Contestação de conta", section: "35. Prazo da análise", kind: "KNOWLEDGE" as const }, { documentId: "doc-2", documentTitle: "Checklist de Encerramento", section: null, kind: "KNOWLEDGE" as const }, { documentId: "arg-1", documentTitle: "Contestação", section: null, kind: "ARGUMENT_SCRIPT" as const }] }
    service.fetchProcessAggregates.mockResolvedValue(themes([merged]))
    renderWithQuery(<DiagnosticsPage />)
    await openTheme()
    expect(await screen.findByText("Prazo da análise")).toBeInTheDocument()
    expect(screen.getByText("Informar o prazo da análise da contestação exibido na ferramenta")).toBeInTheDocument()
    expect(screen.getByText("Contestação de conta · 35. Prazo da análise; Checklist de Encerramento; +1 · reúne 3 regras")).toBeInTheDocument()
    expect(service.fetchProcessAggregates.mock.calls.at(-1)![1]).toBe("DEVIATIONS")
  })

  it("onde mais se ACERTA é outra pergunta: pede só os pontos com acerto, resume pelos acertos e abre as chamadas já nos acertos", async () => {
    renderWithQuery(<DiagnosticsPage />)
    await screen.findByRole("button", { name: /Prazo e próximos passos/ })
    // As visões se combinam: soma "acerta", tira "erra" → só os acertos.
    fireEvent.click(screen.getByRole("button", { name: "Onde mais se acerta" }))
    fireEvent.click(screen.getByRole("button", { name: "Onde mais se erra" }))
    await waitFor(() => expect(service.fetchProcessAggregates.mock.calls.at(-1)![1]).toBe("MET"))
    const trigger = await screen.findByRole("button", { name: /Prazo e próximos passos/ })
    expect(within(trigger).getByText(/acertos em 20 avaliações/)).toBeInTheDocument()
    expect(within(trigger).getByText("70%")).toBeInTheDocument()
    expect(within(trigger).getByText(/2 de 2 pessoas acertaram/)).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(await screen.findByRole("columnheader", { name: "Taxa de acerto" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Ver chamadas" }))
    await waitFor(() => expect(service.fetchAssessments).toHaveBeenCalled())
    expect(service.fetchAssessments.mock.calls.at(-1)![0]).toMatchObject({ practiceKey: "KP-aaaaaaaaaaaa", status: "MET" })
  })

  it("visões COMBINADAS: erra + acerta = uma lista só com desvios e acertos lado a lado; a última visão nunca fica desmarcada", async () => {
    renderWithQuery(<DiagnosticsPage />)
    const errs = await screen.findByRole("button", { name: "Onde mais se erra" })
    fireEvent.click(errs)
    expect(errs).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Onde mais se acerta" }))
    await waitFor(() => expect(service.fetchProcessAggregates.mock.calls.at(-1)![1]).toBe("ALL"))
    expect(screen.getByRole("button", { name: "Onde mais se erra" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Onde mais se acerta" })).toHaveAttribute("aria-pressed", "true")
    const trigger = await screen.findByRole("button", { name: /Prazo e próximos passos/ })
    expect(within(trigger).getByText((_, element) => element?.textContent === "6 desvios e 14 acertos em 20 avaliações")).toBeInTheDocument()
    expect(screen.getByText("1 tema · 1 ponto avaliado")).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(await screen.findByRole("columnheader", { name: "Desvios" })).toBeInTheDocument()
    expect(screen.getByRole("columnheader", { name: "Acertos" })).toBeInTheDocument()
    expect(screen.queryByRole("heading", { name: "Onde agir primeiro" })).not.toBeInTheDocument()
  })

  it("Gráficos somados a uma visão mostram só aqueles pontos, acima da lista; sozinhos, todos os pontos (cada gráfico com a legenda acessível dos valores)", async () => {
    const other = { ...PROCESS, practiceKey: "KP-bbbbbbbbbbbb", title: "Protocolo", description: null, notMet: 0, partial: 0, met: 4, assessed: 4 }
    service.fetchProcessAggregates.mockResolvedValue({ ...themes([PROCESS, other]), order: "ALL" })
    renderWithQuery(<DiagnosticsPage />)
    fireEvent.click(await screen.findByRole("button", { name: "Gráficos" }))
    expect(await screen.findByRole("heading", { name: "Onde agir primeiro" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Prazo e próximos passos/ })).toBeInTheDocument()
    expect(service.fetchProcessAggregates.mock.calls.at(-1)![1]).toBe("DEVIATIONS")
    expect(screen.getByText(/Só os pontos com desvio, do que tem mais desvios/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Onde mais se erra" }))
    await waitFor(() => expect(service.fetchProcessAggregates.mock.calls.at(-1)![1]).toBe("ALL"))
    await waitFor(() => expect(screen.queryByRole("button", { name: /Prazo e próximos passos/ })).not.toBeInTheDocument())
    expect(await screen.findByRole("heading", { name: "Acertos e desvios por tema" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Onde agir primeiro" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Acertos e desvios por ponto (2)" })).toBeInTheDocument()
    // Pelos desvios: o prazo (6 desvios) vem antes do protocolo (0).
    expect(screen.getByText(/Acertos e desvios por ponto do processo: Prazo da análise \(Prazo e próximos passos\) — 6 desvio\(s\), 14 acerto\(s\) em 20 avaliação\(ões\); Protocolo/)).toBeInTheDocument()
    expect(screen.getByText(/Pontos do processo por avaliações e taxa de desvio: Prazo da análise — 20 avaliação\(ões\), taxa de desvio 30%/)).toBeInTheDocument()
  })

  it("Materiais: um documento por linha, que abre nas seções mais avaliadas (com os pontos de cada uma); oito primeiro e 'mostrar todas'", async () => {
    renderWithQuery(<DiagnosticsPage />)
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Materiais/ }), { button: 0 })
    const trigger = await screen.findByRole("button", { name: /Contestação de conta/ })
    expect(within(trigger).getByText("10 seções")).toBeInTheDocument()
    expect(within(trigger).getByText(/em 4 chamadas/)).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(await screen.findByText("30. Seção 1")).toBeInTheDocument()
    expect(screen.getByText("Ponto da 30. Seção 1 (10)")).toBeInTheDocument()
    expect(screen.queryByText("39. Seção 10")).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Mostrar todas as 10 seções" }))
    expect(screen.getByText("39. Seção 10")).toBeInTheDocument()
    expect(screen.getByRole("link", { name: /Abrir documento/ })).toHaveAttribute("target", "_blank")
  })

  it("Materiais em gráficos: documentos e seções mais avaliadas; sem indicação no feedback, diz isso em vez de um gráfico vazio", async () => {
    renderWithQuery(<DiagnosticsPage />)
    fireEvent.mouseDown(await screen.findByRole("tab", { name: /Materiais/ }), { button: 0 })
    fireEvent.click(await screen.findByRole("button", { name: "Gráficos" }))
    expect(await screen.findByRole("heading", { name: "Avaliações sustentadas por documento" })).toBeInTheDocument()
    // Somados: os gráficos e os documentos juntos.
    expect(screen.getByRole("button", { name: /Contestação de conta/ })).toBeInTheDocument()
    expect(screen.getByText("Nenhum documento foi indicado como material de apoio em feedback neste recorte.")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Seções mais avaliadas" })).toBeInTheDocument()
    expect(screen.getByText(/Seções mais avaliadas: 30. Seção 1 \(Contestação de conta\) — 0 desvio\(s\), 10 acerto\(s\)/)).toBeInTheDocument()
  })

  it("estado vazio honesto quando nada foi analisado no recorte", async () => {
    service.fetchMemorySummary.mockResolvedValue({ ...SUMMARY, stats: { ...STATS, calls: 0, assessed: 0, met: 0, notMet: 0, partial: 0, inconclusive: 0, notApplicable: 0, deviationRate: null, coverageRate: null, occurrences: { ...OCCURRENCES, basis: "EMPTY", assessed: 0, deviations: 0, met: 0, assessedRules: 0, deviationRules: 0, sharedDeviationRules: 0, deviationRate: null } }, people: 0, lastAnalysisAt: null })
    service.fetchProcessAggregates.mockResolvedValue(themes([]))
    renderWithQuery(<DiagnosticsPage />)
    expect(await screen.findByText("Nenhuma chamada analisada neste recorte")).toBeInTheDocument()
    expect(await screen.findByText("Nenhum ponto com desvio neste recorte")).toBeInTheDocument()
  })
})

describe("DiagnosticsPage — investigação de indicador", () => {
  beforeEach(() => {
    service.fetchIndicatorInvestigations.mockResolvedValue({ total: 1, items: [INVESTIGATION_ROW], page: 1, pageSize: 25 })
    service.fetchIndicatorInvestigation.mockResolvedValue(INVESTIGATION)
  })

  it("a linha mostra resultado × meta e abre a investigação numa tela ampla (diálogo), nunca um painel lateral estreito", async () => {
    renderWithQuery(<DiagnosticsPage />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Indicadores/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Indicadores/ }))
    expect(await screen.findByText("meta 9% · fora")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Abrir a investigação de Reincidência em até 7 Dias de Larissa Monteiro" }))
    const dialog = await screen.findByRole("dialog", { name: "Reincidência em até 7 Dias · setembro/2026" })
    // Fato oficial e conclusão no topo.
    expect(within(dialog).getByText("11,6%")).toBeInTheDocument()
    expect(within(dialog).getByText("Fora da meta")).toBeInTheDocument()
    expect(within(dialog).getByText("Padrão sustentado nas chamadas")).toBeInTheDocument()
    // Padrão pelo nome curto da prática, com a regra sob demanda; desvios isolados recolhidos.
    expect(within(dialog).getByText("Confirmar o entendimento da solicitação do cliente")).toBeInTheDocument()
    expect(within(dialog).queryByText(/preservando/)).toBeNull()
    expect(within(dialog).getByText(/Desvios isolados \(1\)/)).toBeInTheDocument()
    expect(within(dialog).queryByText("Oferecer ajuda para outra solicitação.")).toBeNull()
    // Assunto de pouco volume fica recolhido quando há outros para ler.
    expect(within(dialog).queryByText("Plano")).toBeNull()
    fireEvent.click(within(dialog).getByRole("button", { name: /Mostrar mais 1 assunto com volume insuficiente/ }))
    expect(within(dialog).getByText("Plano")).toBeInTheDocument()
  })

  it("a chamada que sustenta o padrão abre AO LADO, com o ponto em destaque; Esc fecha a chamada antes da investigação", async () => {
    renderWithQuery(<DiagnosticsPage />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Indicadores/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Indicadores/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Abrir a investigação de Reincidência/ }))
    const dialog = await screen.findByRole("dialog", { name: "Reincidência em até 7 Dias · setembro/2026" })
    fireEvent.click(await within(dialog).findByRole("button", { name: /Chamada de 23\/09\/2026/ }))
    const pane = await within(dialog).findByRole("region", { name: "Chamada escolhida" })
    expect(await within(pane).findByRole("heading", { name: "Neste ponto" })).toBeInTheDocument()
    expect(service.fetchAssessmentDetail).toHaveBeenCalledWith("ca-1")
    // Só um diálogo aberto: nada empilhado.
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    fireEvent.keyDown(dialog, { key: "Escape" })
    await waitFor(() => expect(within(dialog).queryByRole("region", { name: "Chamada escolhida" })).toBeNull())
    expect(screen.getByRole("dialog", { name: "Reincidência em até 7 Dias · setembro/2026" })).toBeInTheDocument()
  })

  it("na chamada, clicar numa fala citada leva à transcrição já no trecho", async () => {
    renderWithQuery(<DiagnosticsPage />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Indicadores/ }))
    fireEvent.click(screen.getByRole("tab", { name: /Indicadores/ }))
    fireEvent.click(await screen.findByRole("button", { name: /Abrir a investigação de Reincidência/ }))
    const dialog = await screen.findByRole("dialog", { name: "Reincidência em até 7 Dias · setembro/2026" })
    fireEvent.click(await within(dialog).findByRole("button", { name: /Chamada de 23\/09\/2026/ }))
    const pane = await within(dialog).findByRole("region", { name: "Chamada escolhida" })
    fireEvent.click(await within(pane).findByTitle("Ver na transcrição"))
    const transcript = await within(pane).findByRole("list", { name: "Transcrição da chamada" })
    expect(within(transcript).getByText("Pronto, é só aguardar a análise.")).toBeInTheDocument()
    expect(within(transcript).getByText(/Não cumprido: 35. Prazo da análise/)).toBeInTheDocument()
  })
})
