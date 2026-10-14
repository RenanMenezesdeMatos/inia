/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { IntelligenceReport, InterventionDetail } from "@/schemas/interventions/intervention.schema"

import { ApiError } from "@/lib/api/api-client"

import { CaseInterventions } from "./case-interventions"
import { IntelligenceReportView } from "./intelligence-report-view"
import { InterventionPanel } from "./intervention-panel"

const service = vi.hoisted(() => ({
  fetchIntervention: vi.fn(),
  fetchCaseInterventions: vi.fn(),
  fetchTrainingCompetencies: vi.fn(),
  applyTrainingCompetency: vi.fn(),
  fetchForwardTargets: vi.fn(),
  retryReportNarrative: vi.fn(),
  acceptIntervention: vi.fn(),
  approveIntervention: vi.fn(),
  returnIntervention: vi.fn(),
  decideContinuity: vi.fn(),
  cancelIntervention: vi.fn(),
  forwardIntervention: vi.fn(),
  completeIntervention: vi.fn(),
  updateInterventionPlan: vi.fn(),
  addInterventionItem: vi.fn(),
  updateInterventionItem: vi.fn(),
  requestAiDraft: vi.fn(),
  applyAiDraft: vi.fn(),
}))
vi.mock("@/services/interventions/intervention-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }), usePathname: () => "/supervisor/cases/case-1", useSearchParams: () => new URLSearchParams() }))

const DETAIL: InterventionDetail = {
  id: "int-1",
  caseId: "case-1",
  caseTitle: "TMA acima da meta",
  person: { id: "op-1", name: "Karoline", teamName: "Atendimento" },
  type: { key: "OBSERVAR", name: "Observar", capabilities: [{ key: "OBSERVATION", label: "Observação" }] },
  indicatorCode: "TMA",
  status: "PROPOSED",
  statusLabel: "Recomendada",
  sensitive: false,
  overdue: false,
  dueAt: "2026-10-28T12:00:00.000Z",
  responsible: { id: "sup-1", name: "Vanessa" },
  approver: null,
  origin: "WORKFLOW",
  policy: { id: "pol-1", name: "Acompanhamento de TMA", version: 2 },
  reason: "TMA acima da meta nos últimos 30 dias.",
  createdAt: "2026-10-13T12:00:00.000Z",
  updatedAt: "2026-10-13T12:00:00.000Z",
  signalCount: 1,
  revision: 3,
  initialSituation: {},
  evidence: [{ kind: "INDICATOR_RESULT", kindLabel: "Resultado de indicador", ref: "m-1", label: "TMA 412 s (meta 360 s)", occurredAt: null, addedBy: null }],
  plan: {},
  formValues: {},
  form: [],
  completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: true },
  approvalRequired: false,
  aiDraftEnabled: false,
  aiDraft: null,
  outcome: null,
  items: [],
  counts: { tasksTotal: 0, tasksDone: 0, tasksSkipped: 0, checkpointsTotal: 0, checkpointsDone: 0, activitiesTotal: 0, activitiesDone: 0 },
  events: [],
  report: null,
  laterReports: [],
  availableActions: ["ACCEPT", "CANCEL"],
  readiness: [],
  continuityDecisions: null,
  audit: { origin: "WORKFLOW", workflowId: "wf-1", workflowName: "Acompanhamento diário", enrollmentId: "enr-1", nodeId: "policy", evaluationId: "ev-1", ruleKey: "ACIMA_DA_META_30D", typeVersionId: "tv-1", policyVersionId: "pv-2" },
}

const CONTINUITY: InterventionDetail = {
  ...DETAIL,
  id: "int-2",
  type: { key: "AVALIACAO_CONTINUIDADE", name: "Solicitar avaliação de continuidade", capabilities: [{ key: "CONTINUITY_REVIEW", label: "Avaliação de continuidade" }] },
  status: "AWAITING_APPROVAL",
  statusLabel: "Aguardando decisão",
  sensitive: true,
  approvalRequired: true,
  approver: { id: "man-1", name: "Roberto" },
  availableActions: [],
  continuityDecisions: [
    { value: "CONTINUITY_CONFIRMED", label: "Continuidade confirmada" },
    { value: "DEVELOPMENT_CONTINUES", label: "Desenvolvimento continua" },
  ],
}

beforeAll(installJsdomStubs)
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("Intervenção no caso — o que o líder vê e pode fazer", () => {
  it("recomendação: diz o que fazer, mostra motivo e responsável, e aceitar envia a revisão esperada", async () => {
    service.fetchIntervention.mockResolvedValue(DETAIL)
    service.acceptIntervention.mockResolvedValue({ ...DETAIL, status: "IN_PROGRESS", revision: 4, availableActions: [] })
    renderWithQuery(<InterventionPanel interventionId="int-1" />)
    expect(await screen.findByText("O que fazer agora")).toBeInTheDocument()
    expect(screen.getByText(/Aceite \(e complete o plano\) ou descarte esta recomendação/)).toBeInTheDocument()
    expect(screen.getByText("TMA acima da meta nos últimos 30 dias.")).toBeInTheDocument()
    expect(screen.getByText(/Aberta pela política "Acompanhamento de TMA" v2/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Descartar" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Aceitar e iniciar" }))
    await waitFor(() => expect(service.acceptIntervention).toHaveBeenCalledWith("int-1", { expectedRevision: 3 }))
  })

  it("quem só acompanha não vê controles: o painel diz de quem é a vez", async () => {
    service.fetchIntervention.mockResolvedValue({ ...DETAIL, availableActions: [] })
    renderWithQuery(<InterventionPanel interventionId="int-1" />)
    expect(await screen.findByText("Aguarda Vanessa aceitar ou descartar.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aceitar e iniciar" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Descartar" })).not.toBeInTheDocument()
  })

  it("avaliação de continuidade: aviso fixo de que a INIA não decide; sem a permissão, nenhum botão de decisão", async () => {
    service.fetchIntervention.mockResolvedValue(CONTINUITY)
    renderWithQuery(<InterventionPanel interventionId="int-2" />)
    expect(await screen.findByText("Solicitação de avaliação de continuidade")).toBeInTheDocument()
    expect(screen.getByText(/nunca decide, aprova automaticamente ou altera a situação funcional/)).toBeInTheDocument()
    expect(screen.getByText(/Aguarda a decisão de uma pessoa autorizada/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Registrar decisão" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument()
  })

  it("quem tem a permissão de decidir vê só 'Registrar decisão' — nunca 'Aprovar'", async () => {
    service.fetchIntervention.mockResolvedValue({ ...CONTINUITY, availableActions: ["DECIDE_CONTINUITY"] })
    renderWithQuery(<InterventionPanel interventionId="int-2" />)
    expect(await screen.findByRole("button", { name: "Registrar decisão" })).toBeInTheDocument()
    expect(screen.getByText("Registre a decisão sobre a avaliação de continuidade, com justificativa.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Aprovar" })).not.toBeInTheDocument()
  })

  it("atrasada aparece como marca derivada, sem trocar o status", async () => {
    service.fetchIntervention.mockResolvedValue({ ...DETAIL, status: "IN_PROGRESS", statusLabel: "Em andamento", overdue: true, availableActions: ["COMPLETE"] })
    renderWithQuery(<InterventionPanel interventionId="int-1" />)
    expect(await screen.findByText("Em andamento")).toBeInTheDocument()
    expect(screen.getByText("Atrasada")).toBeInTheDocument()
  })
})

const REPORT: IntelligenceReport = {
  contract: "INTERVENTION_REPORT_V1",
  asOf: "2026-10-13T12:00:00.000Z",
  subject: { personId: "op-1", personName: "Karoline", teamName: "Atendimento", indicatorCode: "TMA", indicatorName: "Tempo médio de atendimento" },
  situation: { summary: "Karoline · TMA: 1 ação proposta.", period: "13/09/2026 a 13/10/2026" },
  facts: [{ handle: "F1", kind: "INDICATOR", statement: "TMA médio de 412 s, acima da meta de 360 s", status: "MET", ruleKey: "ACIMA_DA_META_30D" }],
  sources: [{ handle: "S1", kind: "INDICATOR_RESULT", ref: "m-1", label: "Medições diárias de TMA", occurredAt: null }],
  priorInterventions: [],
  diagnosis: [],
  uncertainties: [{ handle: "U1", statement: "Sem diagnóstico sustentado no período", reasonCode: "NO_DATA" }],
  missingData: ["Fechamento oficial de setembro ainda não recebido"],
  policy: {
    id: "pol-1",
    key: "ACOMPANHAMENTO_TMA",
    name: "Acompanhamento de TMA",
    version: 2,
    effectiveFrom: "2026-10-01T00:00:00.000Z",
    matchStrategy: "FIRST_MATCH",
    outcome: "RECOMMENDED",
    outcomeLabel: "Recomendação registrada",
    blockedBy: null,
    rules: [{ key: "ACIMA_DA_META_30D", name: "TMA acima da meta nos últimos 30 dias", priority: 4, status: "MET", statusLabel: "Atendida", conditions: [{ statement: "TMA médio de 412 s, acima da meta de 360 s", status: "MET" }] }],
  },
  actions: [
    {
      handle: "A1",
      typeKey: "OBSERVAR",
      typeName: "Observar",
      capabilities: [{ key: "OBSERVATION", label: "Observação" }],
      status: "RECOMMENDED",
      statusLabel: "Recomendada",
      ruleKey: "ACIMA_DA_META_30D",
      ruleName: "TMA acima da meta nos últimos 30 dias",
      justification: "Medição diária acima da meta vigente na janela de 30 dias.",
      supportingFacts: ["F1"],
      responsible: { personId: "sup-1", name: "Vanessa" },
      approver: null,
      dueAt: "2026-10-28T12:00:00.000Z",
      nextSteps: ["Acompanhar duas chamadas"],
      resultCriteria: ["TMA dentro da meta por 15 dias"],
      interventionId: "int-1",
    },
  ],
}

describe("Relatório de inteligência", () => {
  it("separa fatos de incertezas e mostra cada ação com a própria justificativa", () => {
    render(<IntelligenceReportView report={REPORT} narrative={null} highlightInterventionId="int-1" />)
    expect(screen.getByText("Indicadores e fatos considerados")).toBeInTheDocument()
    expect(screen.getAllByText("TMA médio de 412 s, acima da meta de 360 s").length).toBeGreaterThan(0)
    expect(screen.getByText("Incertezas e dados faltantes")).toBeInTheDocument()
    expect(screen.getByText(/Dado ausente ou insuficiente não é desempenho ruim/)).toBeInTheDocument()
    expect(screen.getByText("Sem diagnóstico sustentado no período")).toBeInTheDocument()
    expect(screen.getByText("Medição diária acima da meta vigente na janela de 30 dias.")).toBeInTheDocument()
    expect(screen.getByText("• Acompanhar duas chamadas")).toBeInTheDocument()
    expect(screen.getByText("Sustentado por: F1")).toBeInTheDocument()
  })

  it("narrativa que falhou não apaga o relatório estruturado e permite tentar de novo", () => {
    const onRetry = vi.fn()
    render(<IntelligenceReportView report={REPORT} narrative={{ status: "FAILED", attempts: 2, current: null, lastError: "timeout", generatedAt: null }} onRetryNarrative={onRetry} />)
    expect(screen.getByText(/A narrativa da INIA não pôde ser gerada \(2 tentativas\)/)).toBeInTheDocument()
    expect(screen.getByText("Medição diária acima da meta vigente na janela de 30 dias.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Tentar de novo/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  it("narrativa pronta vem marcada como redação e hipóteses ficam separadas dos fatos", () => {
    render(
      <IntelligenceReportView
        report={REPORT}
        narrative={{ status: "READY", attempts: 1, lastError: null, generatedAt: "2026-10-13T12:01:00.000Z", current: { situation: { text: "O TMA ficou acima da meta.", refs: ["F1"] }, analysis: [], hypotheses: [{ text: "Consultas longas sem aviso.", refs: ["S1"], toConfirm: "Ouvir chamadas" }], leaderGuidance: [] } }}
      />,
    )
    expect(screen.getByText(/Redigido pela INIA a partir dos fatos e fontes abaixo/)).toBeInTheDocument()
    expect(screen.getByText("Hipóteses (não são fatos)")).toBeInTheDocument()
    expect(screen.getByText("Para confirmar: Ouvir chamadas")).toBeInTheDocument()
  })
})

describe("Intervenções do caso — acesso", () => {
  it("quem vê o caso mas não as intervenções recebe um estado explicativo, não um erro", async () => {
    service.fetchCaseInterventions.mockRejectedValue(new ApiError("Caso não encontrado.", 404, "CASE_NOT_FOUND"))
    renderWithQuery(<CaseInterventions caseId="case-1" />)
    expect(await screen.findByText("Intervenções não disponíveis para o seu acesso")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /Tentar/ })).not.toBeInTheDocument()
  })
})

describe("Treinamento — competência, conteúdos aprovados e atividades (sem IA)", () => {
  it("mostra a competência ligada, os conteúdos publicados e oferece aplicar outra competência", async () => {
    service.fetchIntervention.mockResolvedValue({
      ...DETAIL,
      type: { key: "TREINAR", name: "Treinar", capabilities: [{ key: "TRAINING", label: "Treinamento" }] },
      availableActions: ["ACCEPT", "EDIT", "UPDATE_ITEM"],
      plan: { competencyKeys: ["ESPERA"], contents: [{ documentId: "doc-1", title: "Procedimento Jeito Vivo de Atender" }] },
      items: [{ id: "it-1", kind: "ACTIVITY", title: "Estudar o procedimento de espera", description: "Ler e anotar dúvidas.", ownerId: "op-1", ownerName: "Karoline", dueAt: "2026-10-28", status: "PENDING", result: null, completedAt: null, completedByName: null, position: 0, overdue: false }],
    })
    service.fetchTrainingCompetencies.mockResolvedValue([
      { key: "ESPERA", name: "Gestão da espera", description: "", indicatorCodes: ["TMA"], contents: [{ documentId: "doc-1", title: "Procedimento Jeito Vivo de Atender" }], activities: [{ title: "Estudar o procedimento de espera", description: "", kind: "STUDY", estimatedMinutes: 30 }] },
    ])
    renderWithQuery(<InterventionPanel interventionId="int-1" />)
    expect(await screen.findByText("Gestão da espera")).toBeInTheDocument()
    expect(screen.getByText("Procedimento Jeito Vivo de Atender")).toBeInTheDocument()
    expect(screen.getByText("Estudar o procedimento de espera")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Aplicar competência" })).toBeDisabled()
    expect(screen.getByLabelText("Escolher competência")).toBeInTheDocument()
  })
})

describe("Intervenção proposta — o que falta antes de aceitar", () => {
  it("lista todas as pendências do plano de uma vez (não uma por aviso)", async () => {
    service.fetchIntervention.mockResolvedValue({ ...DETAIL, readiness: [{ path: "items", code: "TASKS_REQUIRED", message: "Inclua pelo menos uma tarefa." }, { path: "plan.learningAssessment", code: "TRAINING_ASSESSMENT_REQUIRED", message: "Treinamento: defina como a aprendizagem será avaliada." }] })
    renderWithQuery(<InterventionPanel interventionId="int-1" />)
    const list = await screen.findByTestId("intervention-readiness")
    expect(list).toHaveTextContent("Inclua pelo menos uma tarefa.")
    expect(list).toHaveTextContent("Treinamento: defina como a aprendizagem será avaliada.")
  })
})
