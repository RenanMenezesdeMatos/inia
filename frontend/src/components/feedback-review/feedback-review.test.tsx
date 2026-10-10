/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { toast } from "sonner"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { SUPERVISOR_CONTEXT } from "@/components/analytics/testing/fixtures"
import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { profileTabsFor } from "@/components/profile/profile-tabs"
import { QaLabPage } from "@/components/admin/qa-lab/qa-lab-page"
import { ApiError } from "@/lib/api/api-client"
import type { FeedbackReviewDetail, FeedbackReviewPage } from "@/schemas/feedback-review/feedback-review.schema"

import { FeedbackReviewView } from "./feedback-review-view"

const service = vi.hoisted(() => ({ fetchFeedbackQualityAccess: vi.fn(), fetchFeedbackReviews: vi.fn(), fetchFeedbackReview: vi.fn(), checkFeedbackReviewEdit: vi.fn(), decideFeedbackReview: vi.fn() }))
const navigation = vi.hoisted(() => ({ replace: vi.fn(), search: "" }))
vi.mock("@/services/feedback-review/feedback-review-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigation.replace, push: vi.fn() }), usePathname: () => "/qa-lab/feedbacks", useSearchParams: () => new URLSearchParams(navigation.search) }))
// O QA Lab de administração tem outros laboratórios; aqui só interessa a aba Feedbacks.
vi.mock("@/components/admin/qa-lab/workflow-lab", () => ({ WorkflowLab: () => null }))
vi.mock("@/components/admin/qa-lab/agent-lab", () => ({ AgentLab: () => null }))
vi.mock("@/components/admin/qa-lab/orchestrator-lab", () => ({ OrchestratorLab: () => null }))
vi.mock("@/components/admin/qa-lab/qa-history", () => ({ QaHistory: () => null }))

const ACCESS = { enabled: true, canReview: true, canDecide: true, scopes: [{ scopeType: "MY_STRUCTURE", label: "Sua estrutura" }] }

const ITEM: FeedbackReviewPage["items"][number] = {
  reviewId: "rev-1",
  status: "PENDING_REVIEW",
  statusLabel: "Aguardando avaliação",
  collaborator: { id: "op-1", name: "Operadora Um" },
  team: { id: "t-1", name: "B2C · Atendimento" },
  interactionLabel: "14/03/2026",
  occurredAt: "2026-03-14T12:00:00.000Z",
  createdAt: "2026-03-14T12:05:00.000Z",
  section: "OPPORTUNITY",
  sectionLabel: "Ponto de desenvolvimento",
  kindLabel: "Atrito na comunicação",
  isFallback: false,
  reviewedAt: null,
}
const PAGE: FeedbackReviewPage = { items: [ITEM, { ...ITEM, reviewId: "rev-2", section: "STRENGTH", sectionLabel: "Ponto positivo", kindLabel: "Comportamento positivo", isFallback: true }], total: 2, page: 1, pageSize: 20, filterOptions: { collaborators: [{ id: "op-1", name: "Operadora Um" }], teams: [{ id: "t-1", name: "B2C · Atendimento" }] } }
const EMPTY: FeedbackReviewPage = { items: [], total: 0, page: 1, pageSize: 20, filterOptions: { collaborators: [], teams: [] } }
const PROPOSED = { observed: "Você usou um termo técnico, o que levou o cliente a dizer que não entendeu.", whyItMatters: "Explicar com palavras simples pode facilitar a compreensão.", whatYouCanDo: "Você pode explicar o termo com um exemplo." }
const REASONS = ["FACTUAL_OVERCLAIM", "UNSUPPORTED_EFFECT", "UNSUPPORTED_PROCEDURE", "TOO_GENERIC", "NOT_ACTIONABLE", "TONE", "PRIVACY", "WRONG_FOCUS", "OTHER"].map((code) => ({ code, label: code === "FACTUAL_OVERCLAIM" ? "Afirma mais do que a evidência mostra" : code === "TOO_GENERIC" ? "Genérico demais" : code }))
const DETAIL: FeedbackReviewDetail = {
  ...ITEM,
  collaborator: { id: "op-1", name: "Operadora Um", jobTitle: "Operadora" },
  meaning: "momento de atrito na conversa ligado à condução do operador, observado nesta interação",
  guidanceLabel: "Sugestão de desenvolvimento (não é obrigação)",
  uncertainty: "evidência de uma única interação; não representa padrão",
  evidence: [{ speakerLabel: "Operador", text: "É o faturamento pro rata do ciclo.", truncated: false, masked: false }, { speakerLabel: "Cliente", text: "Não entendi nada disso.", truncated: false, masked: false }],
  evidenceWithheldCount: 1,
  proposedWording: PROPOSED,
  proposedIsFallback: false,
  finalWording: null,
  decision: null,
  selection: { disposition: "HOLD_FOR_QA", dispositionLabel: "Selecionado para QA", structurallyDeliverable: true, policyLabel: "Política do piloto", reasons: ["Política do piloto: todo feedback entregável passa por QA"], explanations: ["Pela política atual, todo feedback passa por avaliação humana antes de seguir."] },
  deliveryState: "AWAITING_QA",
  deliveryStateLabel: "Estruturalmente entregável · aguardando avaliação de QA",
  knowledgeRecommendations: [],
  limits: { maxChars: 600 },
  reasons: REASONS,
}
const decided = (patch: Partial<FeedbackReviewDetail>): FeedbackReviewDetail => ({ ...DETAIL, ...patch })

/** O Sheet abre com o skeleton; espera o conteúdo do detalhe (texto proposto) antes de interagir. */
async function openedDialog() {
  const dialog = await screen.findByRole("dialog")
  await within(dialog).findByText(PROPOSED.whyItMatters)
  return dialog
}

function renderView(openReviewId: string | null = null) {
  const onOpenReview = vi.fn()
  const view = renderWithQuery(<FeedbackReviewView openReviewId={openReviewId} onOpenReview={onOpenReview} />)
  return { ...view, onOpenReview }
}

beforeAll(installJsdomStubs)
beforeEach(() => { service.fetchFeedbackQualityAccess.mockResolvedValue(ACCESS) })
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  navigation.search = ""
  window.localStorage.clear()
})

describe("QA Lab › Feedbacks — fila", () => {
  it("carregando → fila vazia com mensagem clara", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(EMPTY)
    renderView()
    expect(await screen.findByText("Nenhum feedback aguardando avaliação")).toBeInTheDocument()
    expect(screen.getByText("Seu escopo de QA: Sua estrutura")).toBeInTheDocument()
    expect(service.fetchFeedbackReviews).toHaveBeenCalledWith(expect.objectContaining({ status: "PENDING_REVIEW", page: 1, pageSize: 20 }))
  })

  it("fila carregada: pessoa, equipe, tipo de ponto, status e marca de fallback; abrir chama onOpenReview", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    const { onOpenReview } = renderView()
    const rows = await screen.findAllByTestId("feedback-review-row")
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText("Operadora Um")).toBeInTheDocument()
    expect(within(rows[0]!).getByText(/B2C · Atendimento/)).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Ponto de desenvolvimento")).toBeInTheDocument()
    expect(within(rows[0]!).getByText("Aguardando avaliação")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Texto de fallback de segurança")).toBeInTheDocument()
    fireEvent.click(rows[0]!)
    expect(onOpenReview).toHaveBeenCalledWith("rev-1")
  })

  it("erro ao carregar a fila → estado de erro com tentar de novo", async () => {
    service.fetchFeedbackReviews.mockRejectedValue(new ApiError("Falha de rede", 500, null))
    renderView()
    expect(await screen.findByText("Falha de rede")).toBeInTheDocument()
  })
})

describe("QA Lab › Feedbacks — detalhe e avaliações", () => {
  it("abre o detalhe: contexto, evidência exibível, aviso de privacidade e os três textos", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(DETAIL)
    renderView("rev-1")
    const dialog = await openedDialog()
    expect(within(dialog).getByText("Operadora Um")).toBeInTheDocument()
    expect(within(dialog).getByText(/É o faturamento pro rata do ciclo/)).toBeInTheDocument()
    expect(within(dialog).getByText("1 trecho foi ocultado por privacidade.")).toBeInTheDocument()
    expect(within(dialog).getByText(PROPOSED.observed)).toBeInTheDocument()
    expect(within(dialog).getByText(PROPOSED.whatYouCanDo)).toBeInTheDocument()
    // V1.7.1e — por que precisa da avaliação, em linguagem humana; a política/códigos ficam nos detalhes técnicos.
    expect(within(dialog).getByRole("list", { name: "Motivos da avaliação" })).toHaveTextContent("Pela política atual, todo feedback passa por avaliação humana antes de seguir.")
    expect(within(dialog).queryByText(/estruturalmente entregável/)).not.toBeInTheDocument()
    expect(within(dialog).getByText("Selecionado para QA · Política do piloto")).toBeInTheDocument()
    expect(within(dialog).getByText("QA de feedback")).toBeInTheDocument()
  })

  it("fallback: o revisor vê que é texto de fallback de segurança e ainda pode decidir", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(decided({ proposedIsFallback: true, isFallback: true }))
    renderView("rev-1")
    const dialog = await openedDialog()
    expect(within(dialog).getByText(/montado pelo texto de segurança/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: /Aprovar$/ })).toBeEnabled()
  })

  it("aprovar sem edição: confirmação → APPROVED_UNCHANGED → estado atualizado e confirmação clara", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(DETAIL)
    service.decideFeedbackReview.mockResolvedValue(decided({ status: "APPROVED_UNCHANGED", statusLabel: "Aprovado sem edição", finalWording: PROPOSED, deliveryState: "READY_FOR_DELIVERY", deliveryStateLabel: "Pronto para entrega (entrega ainda não habilitada)", decision: { status: "APPROVED_UNCHANGED", statusLabel: "Aprovado sem edição", reviewerName: "Supervisora A", reviewedAt: "2026-09-24T12:00:00.000Z", reasonCategory: null, reasonLabel: null, comment: null, editWarnings: [] } }))
    renderView("rev-1")
    const dialog = await openedDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: /Aprovar$/ }))
    const confirm = await screen.findByRole("alertdialog")
    fireEvent.click(within(confirm).getByRole("button", { name: "Aprovar" }))
    await waitFor(() => expect(service.decideFeedbackReview).toHaveBeenCalledWith("rev-1", { decision: "APPROVED_UNCHANGED" }))
    expect(await screen.findByText(/Aprovado sem edição por Supervisora A/)).toBeInTheDocument()
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Pronto para entrega"))
  })

  it("editar e aprovar: três campos separados, motivo obrigatório, checagem antes, decisão com o texto humano", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(DETAIL)
    service.checkFeedbackReviewEdit.mockResolvedValue({ blocking: [], warnings: [] })
    service.decideFeedbackReview.mockResolvedValue(decided({ status: "APPROVED_EDITED", statusLabel: "Aprovado com edição", finalWording: { ...PROPOSED, observed: "Você usou um termo técnico e, em seguida, o cliente disse que não entendeu." }, deliveryState: "READY_FOR_DELIVERY", decision: { status: "APPROVED_EDITED", statusLabel: "Aprovado com edição", reviewerName: "Supervisora A", reviewedAt: "2026-09-24T12:00:00.000Z", reasonCategory: "FACTUAL_OVERCLAIM", reasonLabel: "Afirma mais do que a evidência mostra", comment: null, editWarnings: [] } }))
    renderView("rev-1")
    const dialog = await openedDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: /^Editar$/ }))
    const observed = within(dialog).getByLabelText("O que aconteceu")
    expect(within(dialog).getByLabelText("Por que importa")).toHaveValue(PROPOSED.whyItMatters)
    expect(within(dialog).getByLabelText("O que você pode fazer")).toHaveValue(PROPOSED.whatYouCanDo)
    fireEvent.change(observed, { target: { value: "Você usou um termo técnico e, em seguida, o cliente disse que não entendeu." } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar com edição" }))
    expect(await within(dialog).findByText("Escolha o motivo da edição.")).toBeInTheDocument()
    expect(service.checkFeedbackReviewEdit).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Afirma mais do que a evidência mostra" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar com edição" }))
    await waitFor(() => expect(service.decideFeedbackReview).toHaveBeenCalledWith("rev-1", { decision: "APPROVED_EDITED", finalWording: { ...PROPOSED, observed: "Você usou um termo técnico e, em seguida, o cliente disse que não entendeu." }, reasonCategory: "FACTUAL_OVERCLAIM", comment: null }))
    expect(await screen.findByText(/Aprovado com edição por Supervisora A/)).toBeInTheDocument()
  })

  it("V1.7.1a — feedback confiável: exemplo de condução rotulado como sugestão, editável, e o item dentro da análise completa", async () => {
    const example = "Registrei a sua contestação. O prazo da análise é o que aparece aqui na ferramenta."
    const workflow = decided({
      origin: "WORKFLOW",
      proposedWording: { ...PROPOSED, suggestedResponse: example },
      suggestedResponse: { allowed: true, notAllowedLabel: null, label: "Exemplo de condução", disclaimer: "Sugestão de formulação — não é fala da chamada nem texto oficial.", proposed: example },
      analysis: { position: 1, total: 4, presentation: { greeting: "Olá, Operadora!", introduction: "Analisei seu atendimento sobre contestação.", closing: "O principal ajuste é explicar o prazo.", source: "WRITER" }, priorityLabels: ["ponto de desenvolvimento (vem antes dos pontos fortes)", "regra ancorada na conversa"], others: [{ position: 2, sectionLabel: "Ponto forte", stepTitle: "Qual cobrança não reconhece", dispositionLabel: "segue no feedback" }, { position: 4, sectionLabel: "Ponto forte", stepTitle: "Registrar protocolo", dispositionLabel: "aguarda QA" }] },
    })
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(workflow)
    service.checkFeedbackReviewEdit.mockResolvedValue({ blocking: [], warnings: [] })
    service.decideFeedbackReview.mockResolvedValue(decided({ ...workflow, status: "APPROVED_EDITED", statusLabel: "Aprovado com edição" }))
    renderView("rev-1")
    const dialog = await openedDialog()
    expect(within(dialog).getByText("Exemplo de condução")).toBeInTheDocument()
    expect(within(dialog).getByText(`“${example}”`)).toBeInTheDocument()
    expect(within(dialog).getByText("Sugestão de formulação — não é fala da chamada nem texto oficial.")).toBeInTheDocument()
    expect(within(dialog).getByText(/Ponto 1 de 4 · ordem: ponto de desenvolvimento/)).toBeInTheDocument()
    expect(within(dialog).getByRole("list", { name: "Outros pontos desta análise" })).toHaveTextContent("Registrar protocolo")
    // V1.7.1b/e — a origem da abertura/fechamento fica nos detalhes técnicos (o texto em si aparece na prévia completa).
    expect(within(dialog).getByText(/Abertura e fechamento do redator/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole("button", { name: /^Editar$/ }))
    const field = within(dialog).getByLabelText("Exemplo de condução")
    expect(field).toHaveValue(example)
    const edited = "Antes de encerrar: registrei a sua contestação e o prazo da análise é o que aparece aqui na ferramenta."
    fireEvent.change(field, { target: { value: edited } })
    fireEvent.click(within(dialog).getByRole("radio", { name: "TONE" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar com edição" }))
    await waitFor(() => expect(service.decideFeedbackReview).toHaveBeenCalledWith("rev-1", { decision: "APPROVED_EDITED", finalWording: { ...PROPOSED, suggestedResponse: edited }, reasonCategory: "TONE", comment: null }))
  })

  it("erro de validação: edição com problema grave é bloqueada (não decide); aviso exige 'Aprovar mesmo assim'", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(DETAIL)
    service.checkFeedbackReviewEdit.mockResolvedValueOnce({ blocking: [{ code: "PRIVACY_DATA", message: "O texto contém um dado pessoal (CPF, telefone, e-mail, protocolo ou número longo). Remova-o." }], warnings: [] })
    renderView("rev-1")
    const dialog = await openedDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: /^Editar$/ }))
    fireEvent.change(within(dialog).getByLabelText("O que aconteceu"), { target: { value: "CPF 123.456.789-09 não entendeu." } })
    fireEvent.click(within(dialog).getByRole("radio", { name: "PRIVACY" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar com edição" }))
    expect(await within(dialog).findByText(/contém um dado pessoal/)).toBeInTheDocument()
    expect(service.decideFeedbackReview).not.toHaveBeenCalled()
    service.checkFeedbackReviewEdit.mockResolvedValueOnce({ blocking: [], warnings: [{ code: "PATTERN_LANGUAGE", message: "O texto descreve um padrão ou hábito." }] })
    fireEvent.change(within(dialog).getByLabelText("O que aconteceu"), { target: { value: "Você sempre usa termos técnicos." } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar com edição" }))
    expect(await within(dialog).findByText("O texto descreve um padrão ou hábito.")).toBeInTheDocument()
    expect(service.decideFeedbackReview).not.toHaveBeenCalled()
    service.decideFeedbackReview.mockResolvedValue(decided({ status: "APPROVED_EDITED", statusLabel: "Aprovado com edição", finalWording: PROPOSED, deliveryState: "READY_FOR_DELIVERY" }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Aprovar mesmo assim" }))
    await waitFor(() => expect(service.decideFeedbackReview).toHaveBeenCalledTimes(1))
  })

  it("rejeitar: motivo obrigatório; com motivo → REJECTED e 'não será entregue'", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(DETAIL)
    service.decideFeedbackReview.mockResolvedValue(decided({ status: "REJECTED", statusLabel: "Rejeitado", deliveryState: "QA_REJECTED", deliveryStateLabel: "Rejeitado no QA — não será entregue", decision: { status: "REJECTED", statusLabel: "Rejeitado", reviewerName: "Supervisora A", reviewedAt: "2026-09-24T12:00:00.000Z", reasonCategory: "TOO_GENERIC", reasonLabel: "Genérico demais", comment: "Vago.", editWarnings: [] } }))
    renderView("rev-1")
    const dialog = await openedDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: /^Rejeitar$/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeitar feedback" }))
    expect(await within(dialog).findByText("Escolha o motivo da rejeição.")).toBeInTheDocument()
    expect(service.decideFeedbackReview).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("radio", { name: "Genérico demais" }))
    fireEvent.change(within(dialog).getByLabelText("Comentário (opcional)"), { target: { value: "Vago." } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeitar feedback" }))
    await waitFor(() => expect(service.decideFeedbackReview).toHaveBeenCalledWith("rev-1", { decision: "REJECTED", reasonCategory: "TOO_GENERIC", comment: "Vago." }))
    expect((await screen.findAllByText("Rejeitado no QA — não será entregue")).length).toBeGreaterThan(0)
  })

  it("item já avaliado por outra pessoa (409): mostra a avaliação registrada, sem sobrescrever", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(DETAIL)
    const current = decided({ status: "APPROVED_UNCHANGED", statusLabel: "Aprovado sem edição", finalWording: PROPOSED, deliveryState: "READY_FOR_DELIVERY", deliveryStateLabel: "Pronto para entrega (entrega ainda não habilitada)", decision: { status: "APPROVED_UNCHANGED", statusLabel: "Aprovado sem edição", reviewerName: "Gerente Um", reviewedAt: "2026-09-24T11:00:00.000Z", reasonCategory: null, reasonLabel: null, comment: null, editWarnings: [] } })
    service.decideFeedbackReview.mockRejectedValue(new ApiError("Este feedback já foi revisado.", 409, "FEEDBACK_REVIEW_ALREADY_DECIDED", { current }))
    renderView("rev-1")
    const dialog = await openedDialog()
    fireEvent.click(within(dialog).getByRole("button", { name: /^Rejeitar$/ }))
    fireEvent.click(within(dialog).getByRole("radio", { name: "Genérico demais" }))
    service.fetchFeedbackReview.mockResolvedValue(current)
    fireEvent.click(within(dialog).getByRole("button", { name: "Rejeitar feedback" }))
    expect(await screen.findByText(/Aprovado sem edição por Gerente Um/)).toBeInTheDocument()
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("já foi avaliado"))
    expect(screen.queryByRole("button", { name: /^Editar$/ })).not.toBeInTheDocument()
  })

  it("detalhe com erro (ex.: fora do escopo) → estado de erro, sem ações", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockRejectedValue(new ApiError("Revisão não encontrada ou fora do seu escopo.", 404, "FEEDBACK_REVIEW_NOT_FOUND"))
    renderView("rev-x")
    expect(await screen.findByText("Revisão não encontrada ou fora do seu escopo.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Aprovar$/ })).not.toBeInTheDocument()
  })
})

const TECH = (patch: Record<string, unknown> = {}) => ({ internalStep: "Sempre informar prazo de forma objetiva", requirement: "Informar o prazo", evidenceTypeLabel: "Ação observada na fala", facts: [{ speakerLabel: "Operador", text: "Aí é só aguardar, o pessoal do setor vai olhar e logo resolve.", truncated: false, masked: false }], knowledge: { documentTitle: "Procedimento Operacional — Contestação", href: "/materiais/doc-1", section: "Prazo da análise", version: 3, quote: "Sempre informar prazo de forma objetiva:", kindLabel: "Regra", detail: null, operativeRule: { quote: "O operador deverá informar o prazo exibido na ferramenta.", reason: "o trecho citado era uma frase de abertura; a regra normativa da mesma seção foi usada para orientar" }, applicabilityLabel: "Regra literal, mas sem âncora na conversa — confirme se se aplica" }, reliability: { dispositionLabel: "Selecionado para avaliação", reasons: [] }, wordingSourceLabel: "Texto de segurança (sem redator)", validationWarnings: [], ...patch })
const DEV_BLOCK = ["### Prazo da análise", "**Na chamada**", "> Você disse: “Aí é só aguardar, o pessoal do setor vai olhar e logo resolve.”", "**O que precisa ser ajustado**", "Nesse momento da chamada, faltou informar prazo de forma objetiva.", "**O processo orienta**", "> “O operador deverá informar o prazo exibido na ferramenta.”", "_Procedimento Operacional — Contestação · Seção: Prazo da análise_ — [Abrir processo ↗](/materiais/doc-1)", "**Como aplicar:** Na próxima chamada, informe o prazo exibido na ferramenta."].join("\n\n")
const STRENGTH_BLOCK = ["### Escuta e identificação da solicitação", "**O que você fez bem**", "Você fez as perguntas para identificar qual conta está questionando.", "**Base oficial**", "> “O operador deverá permitir que o cliente explique: - Qual conta está questionando;”", "_Procedimento Operacional — Contestação · Seção: Escuta e identificação da solicitação_ — [Abrir processo ↗](/materiais/doc-1)"].join("\n\n")
const PREVIEW_DETAIL = decided({
  origin: "WORKFLOW",
  proposedWording: { observed: "Nesse momento da chamada, faltou informar prazo de forma objetiva.", whyItMatters: "", whatYouCanDo: "Na próxima chamada, informe o prazo exibido na ferramenta." },
  proposedIsFallback: true,
  findingLabel: "Prazo da análise",
  selection: { ...DETAIL.selection, reasons: ["O redator não respondeu"], explanations: ["O redator automático não produziu uma resposta válida, e a INIA usou o texto de segurança — montado só com as falas da chamada e as regras do procedimento. Confira se o texto está claro e útil para o colaborador."] },
  decisionEffects: { summary: "Você está avaliando a qualidade do feedback que a INIA pretende enviar. Aprovar não altera a evidência encontrada; apenas autoriza este texto a seguir no Workflow.", approve: "Autoriza este ponto, como está, a seguir no Workflow.", edit: "Permite ajustar a redação sem alterar os fatos suportados (falas, regra, documento). O texto editado passa pelas mesmas verificações.", reject: "Impede que este ponto seja enviado. Os demais pontos da análise continuam com as próprias avaliações." },
  feedbackPreview: {
    version: "QA_FEEDBACK_PREVIEW_V1",
    basisLabel: "Prévia exata do que o colaborador receberia — os pontos que ainda aguardam avaliação aparecem como se fossem aprovados sem edição.",
    parts: [
      { kind: "GREETING", markdown: "Olá, Larissa!", itemIndexes: [], label: null, section: null },
      { kind: "GROUP", markdown: "## Pontos de desenvolvimento", itemIndexes: [], label: null, section: "OPPORTUNITY" },
      { kind: "FINDING", markdown: DEV_BLOCK, itemIndexes: [0], label: "Prazo da análise", section: "OPPORTUNITY" },
      { kind: "GROUP", markdown: "## Pontos fortes", itemIndexes: [], label: null, section: "STRENGTH" },
      { kind: "FINDING", markdown: STRENGTH_BLOCK, itemIndexes: [1], label: "Escuta e identificação da solicitação", section: "STRENGTH" },
      { kind: "CLOSING", markdown: "Para as próximas chamadas, o foco é “Prazo da análise”.", itemIndexes: [], label: null, section: null },
    ],
    pending: 2,
    currentItemIndex: 0,
    items: [
      { itemIndex: 0, reviewId: "rev-1", label: "Prazo da análise", sectionLabel: "Ponto de desenvolvimento", status: "PENDING_REVIEW", statusLabel: "Aguardando avaliação", inPreview: true, isCurrent: true, technical: TECH() },
      { itemIndex: 1, reviewId: "rev-9", label: "Escuta e identificação da solicitação", sectionLabel: "Ponto forte", status: "PENDING_REVIEW", statusLabel: "Aguardando avaliação", inPreview: true, isCurrent: false, technical: TECH({ internalStep: "Escuta e identificação da solicitação", knowledge: null }) },
      { itemIndex: 2, reviewId: "rev-8", label: "Cancelamento da recorrência", sectionLabel: "Ponto forte", status: "REJECTED", statusLabel: "Rejeitado — não será enviado", inPreview: false, isCurrent: false, technical: TECH({ knowledge: null }) },
    ],
  },
})

describe("QA Lab › Feedbacks — V1.7.1e: feedback completo primeiro, detalhes técnicos recolhidos", () => {
  async function openPreview(detail: typeof PREVIEW_DETAIL = PREVIEW_DETAIL) {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    service.fetchFeedbackReview.mockResolvedValue(detail)
    const view = renderView("rev-1")
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByRole("article", { name: "Prévia do feedback completo" })
    return { dialog, ...view }
  }

  it("A/E) o feedback COMPLETO aparece primeiro, com as partes renderizadas pelo backend (o mesmo texto que o colaborador recebe)", async () => {
    const { dialog } = await openPreview()
    const headings = within(dialog).getAllByRole("heading", { level: 3 }).map((heading) => heading.textContent)
    expect(headings.indexOf("Feedback que será enviado")).toBeLessThan(headings.indexOf("Por que precisa da sua avaliação"))
    expect(headings.indexOf("Por que precisa da sua avaliação")).toBeLessThan(headings.indexOf("Sua decisão"))
    const article = within(dialog).getByRole("article", { name: "Prévia do feedback completo" })
    expect(article).toHaveTextContent("Olá, Larissa!")
    expect(article).toHaveTextContent("Nesse momento da chamada, faltou informar prazo de forma objetiva.")
    expect(article).toHaveTextContent("Para as próximas chamadas, o foco é “Prazo da análise”.")
    expect(within(dialog).getByText(/Prévia exata do que o colaborador receberia/)).toBeInTheDocument()
    expect(within(dialog).getByRole("status")).toHaveTextContent("2 de 3 pontos aguardam avaliação — o feedback só segue depois que todos forem avaliados.")
    // O ponto em avaliação é destacado; o rejeitado fica fora do texto enviado.
    expect(within(article).getByRole("region", { name: "Achado: Prazo da análise" })).toHaveAttribute("data-current", "true")
    expect(within(dialog).getByText("Cancelamento da recorrência — Rejeitado — não será enviado")).toBeInTheDocument()
  })

  it("B/C) motivo em linguagem humana e o efeito real de aprovar / editar / rejeitar", async () => {
    const { dialog } = await openPreview()
    expect(within(dialog).getByRole("list", { name: "Motivos da avaliação" })).toHaveTextContent("O redator automático não produziu uma resposta válida")
    expect(within(dialog).getByRole("note")).toHaveTextContent("Aprovar não altera a evidência encontrada; apenas autoriza este texto a seguir no Workflow.")
    const effects = dialog.querySelector('dl[aria-label="O que cada decisão faz"]')!
    expect(effects).toHaveTextContent("Autoriza este ponto, como está, a seguir no Workflow.")
    expect(effects).toHaveTextContent("Permite ajustar a redação sem alterar os fatos suportados")
    expect(effects).toHaveTextContent("Impede que este ponto seja enviado.")
    expect(within(dialog).getByRole("button", { name: /^Aprovar$/ })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: /^Editar$/ })).toBeEnabled()
    expect(within(dialog).getByRole("button", { name: /^Rejeitar$/ })).toBeEnabled()
  })

  it("D/G) detalhes técnicos existem, mas recolhidos; o nome interno da etapa e os tipos técnicos não são copy principal", async () => {
    const { dialog } = await openPreview()
    const article = within(dialog).getByRole("article", { name: "Prévia do feedback completo" })
    // O texto do feedback (fora dos "Ver evidências" recolhidos) não usa o nome interno da etapa nem rótulos técnicos.
    const copy = article.cloneNode(true) as HTMLElement
    copy.querySelectorAll("details").forEach((node) => node.remove())
    expect(copy.textContent).not.toMatch(/Sempre informar prazo de forma objetiva|OBSERVED_ACTION|LITERAL_ONLY|Ação observada na fala|checkpoint/i)
    const evidence = within(article).getByRole("group", { name: "Evidências: Prazo da análise" }).closest("details")!
    expect(evidence).not.toHaveAttribute("open")
    expect(evidence).toHaveTextContent("Etapa (nome interno)Sempre informar prazo de forma objetiva")
    expect(evidence).toHaveTextContent("Regra usada para orientar")
    expect(evidence).toHaveTextContent("Regra literal, mas sem âncora na conversa")
    const technical = within(dialog).getByRole("group", { name: "Detalhes técnicos" })
    expect(technical.tagName).toBe("DETAILS")
    expect(technical).not.toHaveAttribute("open")
  })

  it("V1.7.1j) etapa COMPOSTA: completude e subitens aparecem só nas evidências recolhidas (QA/debug), nunca no texto", async () => {
    const completeness = { statusLabel: "Parcial", groups: [{ label: "Observado na etapa", items: ["protocolo"] }, { label: "Comprovadamente ausente", items: ["prazo", "canal de retorno"] }] }
    const preview = PREVIEW_DETAIL.feedbackPreview!
    const detail = { ...PREVIEW_DETAIL, feedbackPreview: { ...preview, items: preview.items.map((item, index) => (index === 0 ? { ...item, technical: { ...item.technical, completeness } } : item)) } }
    const { dialog } = await openPreview(detail as typeof PREVIEW_DETAIL)
    const article = within(dialog).getByRole("article", { name: "Prévia do feedback completo" })
    const evidence = within(article).getByRole("group", { name: "Evidências: Prazo da análise" }).closest("details")!
    expect(evidence).not.toHaveAttribute("open")
    expect(evidence).toHaveTextContent("Etapa composta — completude: Parcial")
    expect(evidence).toHaveTextContent("Comprovadamente ausente: prazo; canal de retorno")
    const copy = article.cloneNode(true) as HTMLElement
    copy.querySelectorAll("details").forEach((node) => node.remove())
    expect(copy.textContent).not.toMatch(/completude|Comprovadamente ausente/)
  })

  it("V1.7.1k) prontidão analítica da observação aparece só nas evidências recolhidas, com os motivos", async () => {
    const analyticReadiness = { statusLabel: "Precisa de revisão", reasons: ["Aplicabilidade da regra não verificada"], eligibleLabel: "Fica fora do histórico analítico" }
    const preview = PREVIEW_DETAIL.feedbackPreview!
    const detail = { ...PREVIEW_DETAIL, feedbackPreview: { ...preview, items: preview.items.map((item, index) => (index === 0 ? { ...item, technical: { ...item.technical, analyticReadiness } } : item)) } }
    const { dialog } = await openPreview(detail as typeof PREVIEW_DETAIL)
    const article = within(dialog).getByRole("article", { name: "Prévia do feedback completo" })
    const evidence = within(article).getByRole("group", { name: "Evidências: Prazo da análise" }).closest("details")!
    expect(evidence).not.toHaveAttribute("open")
    expect(evidence).toHaveTextContent("Prontidão analítica: Precisa de revisão · Fica fora do histórico analítico")
    expect(evidence).toHaveTextContent("Aplicabilidade da regra não verificada")
    const copy = article.cloneNode(true) as HTMLElement
    copy.querySelectorAll("details").forEach((node) => node.remove())
    expect(copy.textContent).not.toMatch(/Prontidão analítica/)
  })

  it("F/H) link do processo no próprio achado e rótulo do comportamento; navegar para outro ponto pendente", async () => {
    const { dialog, onOpenReview } = await openPreview()
    const finding = within(dialog).getByRole("region", { name: "Achado: Prazo da análise" })
    const link = within(finding).getByRole("link", { name: "Abrir processo ↗" })
    expect(link).toHaveAttribute("href", "/materiais/doc-1")
    expect(link).toHaveAttribute("target", "_blank")
    expect(within(dialog).getByText("Prazo da análise", { selector: "span.font-medium" })).toBeInTheDocument()
    const strength = within(dialog).getByRole("region", { name: "Achado: Escuta e identificação da solicitação" })
    fireEvent.click(within(strength).getByRole("button", { name: "Avaliar este ponto" }))
    expect(onOpenReview).toHaveBeenCalledWith("rev-9")
  })
})

describe("QA Lab › Feedbacks — capability e localização", () => {
  it("sem a capability FEEDBACK_QUALITY_REVIEW (flag OFF, sem concessão, Admin sem concessão): tela explica e não busca a fila", async () => {
    service.fetchFeedbackQualityAccess.mockResolvedValue({ ...ACCESS, canReview: false, scopes: [] })
    renderView()
    expect(await screen.findByText("Sem permissão de QA de feedback")).toBeInTheDocument()
    expect(service.fetchFeedbackReviews).not.toHaveBeenCalled()
  })

  it("V1.5.8a: módulo DESLIGADO (rota 404) nunca vira 'Sem permissão'; 403 real continua sendo 'Sem permissão'", async () => {
    service.fetchFeedbackQualityAccess.mockResolvedValue({ enabled: false, canReview: false, canDecide: false, scopes: [] })
    const off = renderWithQuery(<FeedbackReviewView openReviewId={null} onOpenReview={() => {}} />)
    expect(await screen.findByText("QA de feedback desativado neste ambiente")).toBeInTheDocument()
    expect(screen.queryByText("Sem permissão de QA de feedback")).not.toBeInTheDocument()
    off.unmount()
    service.fetchFeedbackQualityAccess.mockResolvedValue({ enabled: true, canReview: false, canDecide: false, scopes: [] })
    renderWithQuery(<FeedbackReviewView openReviewId={null} onOpenReview={() => {}} />)
    expect(await screen.findByText("Sem permissão de QA de feedback")).toBeInTheDocument()
  })

  it("V1.5.8a: o serviço separa 404 (MÓDULO DESLIGADO) de 403 (SEM PERMISSÃO)", async () => {
    const real = await vi.importActual<typeof import("@/services/feedback-review/feedback-review-service")>("@/services/feedback-review/feedback-review-service")
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } }), { status: 404, headers: { "content-type": "application/json" } }))
    expect(await real.fetchFeedbackQualityAccess()).toMatchObject({ enabled: false, canReview: false })
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "FORBIDDEN", message: "Sem permissão." } }), { status: 403, headers: { "content-type": "application/json" } }))
    expect(await real.fetchFeedbackQualityAccess()).toMatchObject({ enabled: true, canReview: false })
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ data: { canReview: true, canDecide: true, scopes: [{ scopeType: "ORGANIZATION", label: "Toda a organização" }] } }), { status: 200, headers: { "content-type": "application/json" } }))
    expect(await real.fetchFeedbackQualityAccess()).toMatchObject({ enabled: true, canReview: true, canDecide: true })
    fetchSpy.mockRestore()
  })

  it("V1.5.8a: QA Lab com o módulo DESLIGADO não tem a aba Feedbacks; ligado + permissão → a fila abre", async () => {
    const off = renderWithQuery(<QaLabPage />)
    expect(screen.queryByRole("tab", { name: /Feedbacks/ })).not.toBeInTheDocument()
    expect(screen.queryByText("Sem permissão de QA de feedback")).not.toBeInTheDocument()
    off.unmount()
    service.fetchFeedbackQualityAccess.mockResolvedValue({ enabled: true, canReview: true, canDecide: true, scopes: [{ scopeType: "ORGANIZATION", label: "Toda a organização" }] })
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    renderWithQuery(<QaLabPage feedbackQaEnabled />)
    const tab = screen.getByRole("tab", { name: /Feedbacks/ })
    fireEvent.mouseDown(tab)
    fireEvent.focus(tab)
    fireEvent.click(tab)
    expect(await screen.findAllByTestId("feedback-review-row")).toHaveLength(2)
  })

  it("a superfície saiu do perfil: nenhuma aba de revisão, mesmo para quem lidera pessoas", () => {
    expect(profileTabsFor(SUPERVISOR_CONTEXT.capabilities).map((tab) => tab.value)).not.toContain("feedback-review")
    expect(profileTabsFor(SUPERVISOR_CONTEXT.capabilities).map((tab) => tab.label)).not.toContain("Revisão de feedback")
  })

  it("o QA Lab tem a aba Feedbacks com a fila; o item aberto vai para a URL (deep link)", async () => {
    service.fetchFeedbackReviews.mockResolvedValue(PAGE)
    renderWithQuery(<QaLabPage feedbackQaEnabled />)
    const tab = screen.getByRole("tab", { name: /Feedbacks/ })
    fireEvent.mouseDown(tab)
    fireEvent.focus(tab)
    fireEvent.click(tab)
    const rows = await screen.findAllByTestId("feedback-review-row")
    expect(rows).toHaveLength(2)
    fireEvent.click(rows[0]!)
    expect(navigation.replace).toHaveBeenCalledWith("/qa-lab/feedbacks?feedbackReview=rev-1", { scroll: false })
  })
})
