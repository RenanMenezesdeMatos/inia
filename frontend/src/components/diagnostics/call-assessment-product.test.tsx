/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, within } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { assessmentDetailSchema } from "@/schemas/diagnostics/diagnostics-memory.schema"

import { CallAssessmentDetail } from "./call-assessment-detail"

vi.mock("@/queries/best-practices/use-best-practices", () => ({ useRelevantPracticesQuery: () => ({ data: [] }) }))

/**
 * `PRODUCT_APPLICABILITY_V1` na leitura da liderança: o que foi identificado em cada pedido, com o que sustentou (ou não), e os pontos
 * sem avaliação por depender de um produto não estabelecido — num grupo próprio, nunca como "sem conclusão" nem como desvio.
 * Produtos e trechos são EXEMPLOS FICTÍCIOS de teste.
 */
const criterion = (overrides: Record<string, unknown>) => ({ id: "c", criterionKey: "KC-x", text: "Regra", section: null, documentId: "d", documentTitle: "Procedimento", documentVersion: 1, status: "NOT_MET", evidenceKind: "OMISSION", evidence: [], opportunityTurn: null, rationale: null, guidance: null, whyItMatters: null, materiality: "HIGH", ruleConflict: false, onPath: true, identityBasis: "FIRST_SEEN", href: null, ...overrides })
const DETAIL = assessmentDetailSchema.parse({
  id: "ca-p", interactionId: "int-p", externalId: "EXT-P", personId: "p-1", personName: "Ana Teste", occurredAt: "2026-10-20T13:00:00.000Z", date: "2026-10-20", subject: "Segunda via", channel: "VOICE", selectionReason: "Gatilho", transcriptStatus: "COMPLETE",
  procedure: null,
  scenario: { customerNeed: "Segunda via da fatura", correctPath: "", pathTaken: "", pathRationale: "" },
  pathAssessment: "UNDETERMINED", coverage: { status: "COMPLETE" }, outcome: "PARTIAL", limitations: [], isCurrent: true, structureBasis: "CURRENT_AT_ANALYSIS",
  criteria: [
    criterion({ id: "c-protocol", text: "Informar o número do protocolo antes de encerrar.", status: "NOT_MET", rationale: "Encerrou sem o protocolo.", productApplicability: { effect: "INDEPENDENT", request: null, requestLabel: null, products: [], reason: null } }),
    criterion({ id: "c-trunk", text: "Informar que a segunda via vai ao e-mail do gestor do contrato.", status: "NOT_OBSERVABLE", productApplicability: { effect: "SUSPENDED", request: "Q1", requestLabel: "Produto não identificado pela gravação", products: ["Tronco de voz"], reason: "o produto não foi identificado" } }),
    criterion({ id: "c-unclear", text: "Confirmar a dúvida do cliente.", status: "NOT_OBSERVABLE", productApplicability: null }),
  ],
  productIdentification: {
    requests: [{ ref: "Q1", summary: "Segunda via da fatura", object: { kind: "ACCOUNT", description: "conta do cliente" }, status: "NOT_IDENTIFIED", label: "Produto não identificado pela gravação", possible: [], reviewConfirmed: true, evidence: [{ reader: "ANALYSIS", origin: "RECORDING", kind: "Número ou dado citado", turn: "T2", speaker: "CLIENTE", quote: "A conta é 7000 12", metadata: null, criterion: { title: "Conta iniciada em 7000", version: 1, conclusive: true }, points: ["Tronco de voz"], role: "INDICATIVE", roleLabel: "só indica", reason: "a transcrição não preservou o dado com segurança" }], limitations: ["O número da conta foi cortado na transcrição."] }],
    rules: [{ lineHandle: "O2", title: "Informar que a segunda via vai ao e-mail do gestor do contrato.", request: "Q1", products: ["Tronco de voz"], effect: "SUSPENDED", reason: "o produto não foi identificado" }],
    counts: { independent: 1, established: 0, otherProduct: 0, suspended: 1 },
  },
  transcript: [{ turn: "T2", speaker: "CLIENTE", text: "A conta é 7000 12 [inaudível].", timestamp: null }],
})

beforeAll(installJsdomStubs)
afterEach(() => cleanup())

describe("Diagnóstico — produto do atendimento e pontos que dependem dele", () => {
  it("topo e contagem dizem o que foi identificado e quantos pontos dependem do produto; o ponto suspenso tem grupo próprio", () => {
    renderWithQuery(<CallAssessmentDetail detail={DETAIL} />)
    expect(screen.getAllByText("Produto não identificado pela gravação")[0]).toBeInTheDocument()
    expect(screen.getByText("1 dependem do produto")).toBeInTheDocument()
    expect(screen.getByText("1 sem conclusão")).toBeInTheDocument()
    const group = screen.getByRole("button", { name: /Sem avaliação — depende do produto/ })
    fireEvent.click(group)
    const note = screen.getByTestId("criterion-product-note")
    expect(note).toHaveTextContent("Regra de Tronco de voz: sem avaliação — o produto não foi identificado. Não conta como falha nem como acerto.")
  })

  it("aba Cenário: evidência com origem, indício e por que não sustentou; limitação do número; o que ficou sem avaliação", () => {
    renderWithQuery(<CallAssessmentDetail detail={DETAIL} />)
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Cenário" }))
    const section = screen.getByTestId("product-identification")
    expect(within(section).getByText(/Número ou dado citado/)).toBeInTheDocument()
    expect(section).toHaveTextContent("indício “Conta iniciada em 7000” (versão 1, confirma o produto sob condição) — só indica (a transcrição não preservou o dado com segurança)")
    expect(section).toHaveTextContent("O número da conta foi cortado na transcrição.")
    expect(section).toHaveTextContent("Ficaram sem avaliação por depender do produto (1)")
  })
})
