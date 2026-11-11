/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { FollowUpEntry } from "@/components/follow-up/follow-up-entry"
import { areasFor } from "@/components/layout/top-bar/area-switcher"
import { ReportOfferAction } from "@/components/operator/operator-inia-chat/chat-message-list"
import type { FollowUpItem } from "@/schemas/analytics/analytics.schema"
import type { QueryTableCard } from "@/schemas/leadership/leadership.schema"
import type { VisualizationData } from "@/schemas/reports/reports.schema"
import { staticCompatibility } from "./report-form/form-helpers"
import { ReportDeliveryView, type DeliveryViewModel } from "./report-delivery-view"
import { ReportVisualization } from "./report-visualization"

vi.mock("@/services/reports/reports-service", () => ({ retryDeliveryAnalysis: vi.fn(async () => ({ analysisStatus: "READY" })) }))

beforeAll(() => installJsdomStubs())
afterEach(() => cleanup())

const card: QueryTableCard = {
  type: "QUERY_TABLE", generatedAt: "2026-10-16T12:00:00.000Z", structure: { subject: { kind: "SUPERVISOR_TEAM", supervisorId: "s1" }, label: "Equipe da Sara", description: null }, source: "OFFICIAL",
  title: "Pessoas — TMA", scopeNote: "Competência oficial: Setembro 2026", period: "2026-09", indicatorCode: "TMA",
  columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "achievement", label: "Atingimento", numeric: true }],
  rows: [{ cells: { person: "Ana", achievement: "80,5%" }, subject: null, personId: null }, { cells: { person: "Bia", achievement: "—" }, subject: null, personId: null }],
  totalRows: 2, highlights: [], methods: [], limitations: [],
}
const bar: VisualizationData = { type: "BAR", title: "Pessoas — TMA", unit: "PERCENT", metricKey: "achievement", metricLabel: "Atingimento", categories: ["Ana", "Bia"], series: [{ key: "achievement", label: "Atingimento", values: [80.5, null] }], kpis: [], fallbackReason: null, empty: false }
const model = (overrides: Partial<DeliveryViewModel> = {}): DeliveryViewModel => ({ deliveryId: "d1", kind: "DELIVERY", reason: null, periodLabel: "Setembro 2026", structureLabel: "Equipe da Sara", sources: [{ source: "OFFICIAL_INDICATOR_PERFORMANCE", label: "Fechamento oficial dos indicadores", watermark: "official:5", lastUpdatedAt: "2026-10-16T15:00:00.000Z", stale: false, detail: null }], visualization: bar, dataset: card, comparison: null, analysisStatus: "READY", analysisText: "**Resumo** O TMA melhorou.", empty: false, occurrences: 1, lastCheckedAt: "2026-10-16T12:00:00.000Z", createdAt: "2026-10-16T12:00:00.000Z", ...overrides })

describe("visualização do report", () => {
  it("valores exatos a um clique: a tabela mostra o texto da aplicação ('—' é sem dado, não zero)", () => {
    render(<ReportVisualization data={bar} card={card} />)
    fireEvent.mouseDown(screen.getByRole("radio", { name: "Valores exatos" }))
    fireEvent.click(screen.getByRole("radio", { name: "Valores exatos" }))
    expect(screen.getByRole("cell", { name: "80,5%" })).toBeInTheDocument()
    expect(screen.getByRole("cell", { name: "—" })).toBeInTheDocument()
  })

  it("resultado vazio é dito como vazio e a visualização incompatível avisa por quê", () => {
    const { unmount } = render(<ReportVisualization data={{ ...bar, empty: true, categories: [], series: [] }} card={{ ...card, rows: [], totalRows: 0 }} />)
    expect(screen.getByText(/resultado vazio, não zero/)).toBeInTheDocument()
    unmount()
    render(<ReportVisualization data={{ ...bar, type: "TABLE", fallbackReason: "A visualização escolhida não cabe nos dados desta entrega (linha); mostrando a tabela." }} card={card} />)
    expect(screen.getByText(/não cabe nos dados desta entrega/)).toBeInTheDocument()
  })
})

describe("entrega × aviso de não encaminhado", () => {
  it("entrega válida: período, data de geração, análise da INIA e atualização das bases", () => {
    render(<ReportDeliveryView model={model()} />)
    expect(screen.getByText(/Equipe da Sara/)).toBeInTheDocument()
    expect(screen.getByText(/Gerado em/)).toBeInTheDocument()
    expect(screen.getByText("Análise da INIA")).toBeInTheDocument()
    expect(screen.getByText(/O TMA melhorou/)).toBeInTheDocument()
    expect(screen.getByText(/Fechamento oficial dos indicadores/)).toBeInTheDocument()
  })

  it("não encaminhado: mensagem de referência, bases pendentes e a última entrega válida preservada — nunca um gráfico", () => {
    render(<ReportDeliveryView model={model({ kind: "NOT_FORWARDED", reason: "STALE_SOURCES", visualization: null, dataset: null, analysisStatus: "NOT_APPLICABLE", occurrences: 3, lastCheckedAt: "2026-10-18T11:00:00.000Z" })} />)
    expect(screen.getByText("Report não encaminhado: as bases necessárias ainda não foram atualizadas para o período configurado.")).toBeInTheDocument()
    expect(screen.getByText("Bases pendentes:")).toBeInTheDocument()
    expect(screen.getByText(/Verificado 3 vezes/)).toBeInTheDocument()
    expect(screen.getByText(/A última entrega válida continua disponível/)).toBeInTheDocument()
    expect(screen.queryByText("Análise da INIA")).not.toBeInTheDocument()
  })

  it("análise que falhou: dados continuam válidos e há 'Tentar novamente'", () => {
    render(<ReportDeliveryView model={model({ analysisStatus: "FAILED", analysisText: null })} />)
    expect(screen.getByText(/Análise da INIA indisponível/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Tentar novamente/ })).toBeInTheDocument()
  })
})

describe("Acompanhamento, seletor de área e chat", () => {
  const item = (category: "REPORT" | "REPORT_NOT_FORWARDED", report: unknown): FollowUpItem => ({ id: "d1", kind: "REPORT", category, title: "TOP 3 em TMA", subtitle: "Equipe da Sara · Setembro 2026", summary: "", detail: null, severity: null, operator: null, caseId: null, createdAt: "2026-10-16T12:00:00.000Z", acknowledgedAt: null, feedback: null, report })
  const content = (kind: "DELIVERY" | "NOT_FORWARDED") => ({ deliveryId: "d1", reportId: "r1", kind, reason: kind === "DELIVERY" ? null : "NO_CHANGE", periodLabel: "Setembro 2026", structureLabel: "Equipe da Sara", sources: [], visualization: kind === "DELIVERY" ? bar : null, dataset: kind === "DELIVERY" ? card : null, comparison: null, analysisStatus: kind === "DELIVERY" ? "PENDING" : "NOT_APPLICABLE", analysisText: null, empty: false, occurrences: 1, lastCheckedAt: "2026-10-16T12:00:00.000Z", reportActive: true })

  it("o item de report aparece no Acompanhamento com o rótulo próprio; o aviso é visualmente outro tipo", () => {
    const { unmount } = render(<FollowUpEntry item={item("REPORT", content("DELIVERY"))} showRecipient={false} />)
    expect(screen.getByText("TOP 3 em TMA")).toBeInTheDocument()
    expect(screen.getAllByText("Report").length).toBeGreaterThan(0)
    expect(screen.getByText(/Análise da INIA em preparação/)).toBeInTheDocument()
    unmount()
    render(<FollowUpEntry item={item("REPORT_NOT_FORWARDED", content("NOT_FORWARDED"))} showRecipient={false} />)
    expect(screen.getAllByText("Report não encaminhado").length).toBeGreaterThan(0)
    expect(screen.getByText(/os dados deste report não mudaram desde a última entrega/)).toBeInTheDocument()
  })

  it("seletor de área: 'Reports' só para quem tem a capacidade", () => {
    const base = { profileHref: "/supervisor", canAccessAdministration: false, canReviewFeedback: false, canViewDiagnostics: true }
    expect(areasFor({ ...base, canUseReports: true }).tools.map((tool) => tool.href)).toContain("/reports")
    expect(areasFor({ ...base, canUseReports: false }).tools.map((tool) => tool.href)).not.toContain("/reports")
  })

  it("chat: o botão da oferta abre a configuração preenchida; com report criado, leva a ele", () => {
    const { unmount } = render(<ReportOfferAction offer={{ proposalId: "p1", title: "TOP 3", status: "OFFERED" }} />)
    expect(screen.getByRole("link", { name: /Criar report desta consulta/ })).toHaveAttribute("href", "/reports/novo?proposta=p1")
    unmount()
    render(<ReportOfferAction offer={{ proposalId: "p1", title: "TOP 3", status: "ACCEPTED", reportId: "r9" }} />)
    expect(screen.getByRole("link", { name: /Report criado/ })).toHaveAttribute("href", "/reports/r9")
  })
})

describe("formulário — compatibilidade da visualização (mesma regra do backend)", () => {
  it("ranking da última competência não oferece evolução; mês a mês oferece linha/área; quartis oferecem distribuição", () => {
    const base = { tool: "INDICATOR_QUERY" as const, structure: { mode: "RECIPIENT" as const }, period: { mode: "LAST_CLOSED" as const }, indicators: ["TMA"], groupBy: "PESSOA" as const, limit: 3 }
    expect(staticCompatibility(base)).toEqual(["TABLE", "BAR"])
    expect(staticCompatibility({ ...base, period: { mode: "LAST_N_CLOSED", months: 3, display: "POR_MES" } })).toContain("LINE")
    expect(staticCompatibility({ ...base, view: "QUARTIS", groupBy: "SUPERVISOR" })).toContain("DISTRIBUTION")
  })
})
