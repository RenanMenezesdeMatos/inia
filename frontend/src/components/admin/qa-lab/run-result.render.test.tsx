/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

import { RunResult } from "./run-result"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"

/**
 * Fumaça do resultado de um QA Run inteiro: cada seção (passos com Condition, coleção, ranking,
 * consolidação, destinatário; efeitos simulados de todos os tipos; requests de IA; contexto;
 * pendências do trace principal e de cada colaborador do fan-out) monta sem quebrar. O resultado
 * é dividido em `run-result/*`; os testes de Ferramentas/Telemetria só passam por uma parte dele.
 * A rede fica pendurada — só a montagem é verificada.
 */
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderRun(run: QaRun): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  render(<RunResult run={run} canvas={<div>Canvas da simulação</div>} />, { wrapper })
}

const people = {
  "op-1": { id: "op-1", name: "Larissa Monteiro", role: "OPERATOR", teamName: "B2C" },
  "op-2": { id: "op-2", name: "Rafael Souza", role: "OPERATOR", teamName: "B2C" },
  "op-3": { id: "op-3", name: "Camila Pereira", role: "OPERATOR", teamName: "B2B" },
  "sup-1": { id: "sup-1", name: "Supervisora Um", role: "SUPERVISOR", teamName: "B2C" },
  "man-1": { id: "man-1", name: "Gerente Um", role: "MANAGER", teamName: null },
}

const evidence = {
  windowLabel: "09/09/2026 → 15/09/2026",
  aggregation: "WEIGHTED_AVERAGE",
  aggregationKind: "WEIGHTED_AVERAGE",
  method: "Σ numerador ÷ Σ denominador",
  sampleCount: 287,
  daysWithData: 5,
  expectedDays: 5,
  coverage: 1,
  numerator: 142639,
  denominator: 287,
  sampleTotal: 287,
  minimumCoverage: 0.6,
  coverageSatisfied: true,
  ignoredMeasurements: 2,
  eligibility: {
    businessDays: 5,
    calendarDays: 7,
    scheduledWorkDays: 5,
    eligibleDays: 5,
    excludedBeforeHire: 0,
    excludedByStatus: { FERIAS: 1 },
    excludedByScheduledDayOff: 2,
    excludedByHoliday: 0,
    excludedByUnknownSchedule: 0,
    statusConfidence: { freshness: "STALE", unconfirmedDays: 2, lastSuccessLocalDate: "2026-09-12" },
    scheduleConfidence: { freshness: "STALE", basis: "EXPLICIT_SCHEDULE", scheduleType: "SIX_BY_ONE", unconfirmedScheduleDays: 3, unknownScheduleDays: 0, lastSuccessLocalDate: "2026-09-10" },
    holidayConfidence: { policy: "EXCLUDE_APPLICABLE_HOLIDAYS", operationalCapitalCode: "SP", confidence: "CAPITAL_KNOWN", applicableHolidayDays: 1 },
    observed: { workedObservedDays: 4, workedDespitePlan: { exception: { DAY_OFF: 1 }, scheduledDayOff: 1, holiday: 0, unknownSchedule: 0 }, missingExpectedProductionDays: 1, productionWithNonEligibleStatusDays: 1, evidenceSources: { interactions: true, indicatorCodes: ["ATENDIMENTOS"] } },
  },
}

const calculation = { source: "MEASUREMENT", indicatorCode: "TMA", aggregation: "AVERAGE", periodLabel: "Últimos 7 dias", windowLabel: "09/09 → 15/09", previousWindowLabel: "02/09 → 08/09", direction: "LOWER", quartileReason: "INSUFFICIENT_POPULATION" }

function step(index: number, nodeId: string, nodeType: string, label: string, extra: Record<string, unknown> = {}) {
  return { index, nodeId, nodeType, label, status: "completed", startedAt: "2026-09-17T12:00:00.000Z", simulatedNow: "2026-09-17T12:00:00.000Z", durationMs: 1200, outcome: { kind: "complete" }, aiCalls: 0, totalTokens: 0, ...extra }
}

const steps = [
  step(1, "trigger", "trigger", "Gatilho", { nodeOutput: { flag: "rechamada", value: true } }),
  step(2, "condition", "condition", "TMA acima da meta", {
    outcome: { kind: "branch", branch: "true", payload: { evaluation: { kind: "historical_aggregate", aggregation: "WEIGHTED_AVERAGE", indicatorCode: "TMA", value: 497, sampleCount: 287, comparator: "GT", reference: 400, referenceKind: "GOAL", goalSource: { kind: "SUBTEAM", name: "Diagnóstico IA" }, evidence, previousEvidence: { ...evidence, windowLabel: "02/09/2026 → 08/09/2026", eligibility: { businessDays: 5, eligibleDays: 5, excludedBeforeHire: 1, excludedByStatus: {} } } } } },
  }),
  step(3, "quartile", "condition", "Quartil operacional", {
    outcome: { kind: "branch", branch: "no_data", payload: { evaluation: { kind: "operational_quartile", indicatorCode: "TMA", periodLabel: "Semana", windowLabel: "09/09 → 15/09", direction: "LOWER", aggregation: "AVERAGE", population: { evaluatedCount: 10, eligibleCount: 9, ineligibleCount: 1, rankedCount: 8, noDataCount: 1, belowCoverageCount: 1 }, value: "Q4", position: 8, operationalValue: 520, comparator: "EQUALS", threshold: "Q4", evidence, reasonText: "Cobertura abaixo do mínimo" } } },
  }),
  step(4, "group", "condition", "Grupo de regras", {
    outcome: { kind: "branch", branch: "false", payload: { evaluation: { kind: "group", operator: "ANY", rules: [{ sourcePath: "agent.structured.score", comparator: "GTE", threshold: 7, result: false }, { sourcePath: null, comparator: "EQUALS", threshold: true, result: false }] } } },
  }),
  step(5, "recurrence", "condition", "Recorrência no PRV", {
    outcome: { kind: "branch", branch: "true", payload: { evaluation: { kind: "performance_recurrence", metric: "QUARTILE", periodsRequested: 3, totalPeriods: 3, snapshots: [{ referencePeriod: "2026-07", quartile: "Q4" }, { referencePeriod: "2026-08", quartile: "Q4" }], matchCount: 2, matchQuartile: "Q4", comparator: "GTE", threshold: 2 } } },
  }),
  step(6, "collection", "select_employees", "Selecionar colaboradores", {
    nodeOutput: { kind: "EMPLOYEE_COLLECTION", memberIds: ["op-1", "op-2"], evaluatedCount: 5, selectedCount: 2, notMatchedCount: 2, noDataCount: 1 },
  }),
  step(7, "ranking", "select_employees", "Ranking por grupo", {
    nodeOutput: {
      kind: "EMPLOYEE_COLLECTION",
      mode: "RANKING",
      memberIds: ["op-1", "op-3"],
      evaluatedCount: 6,
      selectedCount: 2,
      rankedCount: 5,
      noDataCount: 1,
      partitionBy: "TEAM",
      requestedCountPerPartition: 1,
      partitions: [
        { id: "team-b2c", name: "B2C", evaluatedCount: 3, rankedCount: 3, noDataCount: 0, selectedCount: 1, calculation, members: [{ employeeId: "op-1", value: 520.5, position: 1, operationalQuartile: "Q4", evidence }] },
        { id: "team-b2b", name: "B2B", evaluatedCount: 3, rankedCount: 2, noDataCount: 1, selectedCount: 1, calculation: { ...calculation, quartileReason: "DIRECTION_UNSUPPORTED", direction: null }, members: [{ employeeId: "op-3", previousValue: 400, currentValue: 480, change: 20, performanceChange: -20, position: 1, evidence, previousEvidence: evidence }] },
        { id: null, name: null, evaluatedCount: 0, rankedCount: 0, noDataCount: 0, selectedCount: 0, members: [] },
      ],
    },
  }),
  step(8, "ranking-legacy", "select_employees", "Ranking antigo", {
    nodeOutput: { kind: "EMPLOYEE_COLLECTION", mode: "RANKING", memberIds: ["op-2"], evaluatedCount: 2, selectedCount: 1, rankedCount: 2, noDataCount: 0, requestedCount: 1, ranked: [{ employeeId: "op-2", value: 410, position: 1 }] },
  }),
  step(9, "fan-in", "consolidate_results", "Consolidar resultados", {
    nodeOutput: { kind: "EMPLOYEE_FAN_IN", expectedCount: 2, completedCount: 1, failedCount: 1, children: [{ employeeId: "op-1", status: "completed" }, { employeeId: "op-2", status: "failed", failureReason: "Agent indisponível" }] },
  }),
  step(10, "agent", "action", "Chamar agente", {
    aiCalls: 2,
    totalTokens: 1800,
    nodeOutput: {
      text: "Resposta do agente",
      structured: { resumo: "ok" },
      supportMaterials: [{ materialId: "m-1", title: "Checklist de Encerramento", reason: "Etapa de protocolo" }],
      supportMaterialCandidates: [{ materialId: "m-1", title: "Checklist de Encerramento" }, { materialId: "m-2", title: "Contestação de cobrança" }],
      toolTrace: [{ sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA 497 s", quality: null, provenance: null, status: "COMPLETED", startedAt: "", completedAt: "" }],
      investigation: { toolCalls: 1, cachedCalls: 0, rejectedCalls: 0, budget: 8, outcome: "ANSWERED" },
    },
  }),
  step(11, "output", "output", "Enviar ao Acompanhamento", { outcome: { kind: "complete", payload: { recipients: [{ id: "man-1", name: "Gerente Um", role: "MANAGER" }] } } }),
  step(12, "broken", "output", "Output sem destinatário", { status: "failed", error: "WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND" }),
  step(13, "review", "human_review", "Revisão humana", { status: "waiting" }),
]

const effects = [
  { kind: "FEEDBACK", id: 1, nodeId: "agent", feedbackKind: "monitoring", operatorId: "op-1", teamId: "team-b2c", caseId: "case-1", feedbackId: "fb-1", title: "Prazo da análise", recommendation: "Informe o prazo exibido na ferramenta.", evidenceFound: "é só aguardar a análise", supportMaterials: [{ materialId: "m-1", title: "Checklist de Encerramento", reason: "Etapa de protocolo" }], input: {} },
  { kind: "ALERT", id: 2, nodeId: "review", alertType: "WORKFLOW_HUMAN_REVIEW", recipientId: "sup-1", title: "Revisão", description: "Revise o feedback.", severity: "MEDIUM", caseId: "case-1", surfaces: ["FOLLOW_UP", "NOTIFICATION"] },
  { kind: "ALERT", id: 3, nodeId: null, alertType: "WORKFLOW_ESCALATION", recipientId: "man-1", title: "Escalonamento", description: "Recorrência no Q4.", severity: "HIGH", caseId: null, surfaces: ["NOTIFICATION"] },
  { kind: "WORKFLOW_OUTPUT", id: 4, nodeId: "output", surface: "CHAT", recipientId: "op-1", interactionMode: "PASSIVE", content: { texto: "Recado" } },
  { kind: "CONFIG_VALUE", id: 5, nodeId: null, configKey: "meta.tma", valueType: "NUMBER", value: 400, scopeType: "TEAM", teamId: "team-b2c", subteamId: null },
  { kind: "INTERACTION_FEEDBACK", id: 6, nodeId: null, interactionId: "int-1", status: "GENERATED", notAnalyzableReason: null, feedbackStatus: "HAS_POINTS", writerInvoked: true, dispositions: { AUTO_DELIVER: 1, HOLD_FOR_QA: 1, BLOCKED: 0 }, reasons: ["WRITER_FALLBACK_USED"], policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" },
  { kind: "RELIABLE_FEEDBACK", id: 7, nodeId: null, domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT", disposition: "HOLD_FOR_QA", itemCount: 3, emittableCount: 2, reasons: ["CLAIM_BOUNDARY_NOT_ENFORCED"], policyVersion: "RELIABLE_FEEDBACK_POLICY_AUTONOMOUS_V1", writerInvoked: false, text: "Olá!" },
  { kind: "RELIABLE_FEEDBACK_EMISSION", id: 8, nodeId: null, surface: "FOLLOW_UP", recipientId: "op-1", artifactId: "art-1", caseId: "case-1", feedbackId: "fb-1", reused: true },
  { kind: "AGENT_RUN", id: 9, nodeId: null, runId: "run-agent-1", agentId: "agent-1", status: "FAILED", outputText: null, errorMessage: "JSON inválido" },
]

const knowledge = { mode: "RETRIEVAL", authorizedDocuments: [{ id: "doc-1", title: "Contestação de cobrança", chars: 9000 }], retrieved: [{ documentId: "doc-1", documentTitle: "Contestação de cobrança", heading: "35. Prazo da análise", excerpt: "O operador deverá informar o prazo exibido na ferramenta.", score: 3.2 }], injectedChars: 60, estimatedTokens: 15, authorizedChars: 9000, budget: { maxChunks: 8, maxTotalChars: 9000, minRelativeScore: 0.2 } }

const aiCalls = [
  { sequence: 1, role: "agent", agentId: "agent-1", agentName: "Especialista de Faturamento", model: "gemini-3.8-flash", promptTokens: 1200, outputTokens: 600, totalTokens: 1800, durationMs: 2300, startedAt: "2026-09-17T12:00:00.000Z", systemPrompt: "Você é a INIA.", input: "Analise a chamada.", outputText: "{\"ok\":true}", knowledge },
]

const interaction = { id: "int-1", externalId: "EXT-001", reason: "Contestação de cobrança", channel: "VOICE", startedAt: "2026-09-17T11:00:00.000Z", endedAt: "2026-09-17T11:08:00.000Z", durationSeconds: 480, operatorId: "op-1", operatorName: "Larissa Monteiro", flag: { name: "rechamada", valueType: "BOOLEAN", value: true }, transcript: { available: true, version: 2, checksum: "abc123", length: 4200 }, transcriptChangedSinceOriginalRun: true }

function workflowRun(overrides: Record<string, unknown> = {}): QaRun {
  return {
    id: "run-1",
    executedBy: "admin-1",
    executedByName: "Admin",
    resourceType: "WORKFLOW",
    resourceId: "wf-1",
    resourceName: "Monitoria · Contestação de conta",
    status: "WAITING",
    input: { maxAiCalls: 10 },
    context: { workflow: { workflowState: "DRAFT", graphChecksum: "abc123", versionId: null, capturedAt: "2026-09-17T11:59:00.000Z", rerunOfSnapshot: true } },
    state: {
      currentNodeId: "review",
      status: "waiting",
      pauseReason: "HUMAN_REVIEW",
      resumeAt: null,
      nodeOutputs: {},
      variables: {},
      simulatedNow: "2026-09-17T12:00:00.000Z",
      revision: 3,
      session: {
        inputContext: "Operador: Bom dia.\nCliente: Quero contestar a conta.",
        evidence: { transcript: { checksum: "abc123" } },
        employeeRuns: [
          { employeeId: "op-2", state: { status: "waiting", pauseReason: "WAIT", resumeAt: "2026-09-18T12:00:00.000Z", currentNodeId: "wait" } },
          { employeeId: "op-3", state: { status: "paused", pauseReason: "AI_BUDGET", resumeAt: null, currentNodeId: "agent" } },
        ],
      },
    },
    trace: {
      steps,
      effects,
      aiCalls,
      knowledgeRetrievals: [],
      people,
      pendingReview: { nodeId: "review", reviewerIds: ["sup-1"], instruction: "Confira a evidência.", content: { feedback: "Informe o prazo." } },
      employeeRuns: [
        { employeeId: "op-1", status: "waiting", steps: [step(1, "agent", "action", "Chamar agente")], pendingReview: { nodeId: "review", reviewerIds: [], instruction: null, content: { feedback: "Ponto" } } },
        { employeeId: "op-2", status: "waiting", steps: [], pendingReview: null },
        { employeeId: "op-3", status: "paused", steps: [step(1, "agent", "action", "Chamar agente", { status: "paused_before_ai" })], pendingReview: null },
      ],
      context: {
        operator: { name: "Larissa Monteiro", role: "OPERATOR", teamName: "B2C", subteamName: "Diagnóstico IA", hierarchy: [{ name: "Supervisora Um", role: "SUPERVISOR" }] },
        indicators: [{ code: "TMA", name: "TMA", value: 497, targetValue: 400, achievementPercent: 80.5, quartile: "Q4", referencePeriod: "2026-08" }],
        shift: { startTime: "08:00", workMinutes: 360 },
        trigger: { kind: "channel_flag", channel: "VOICE", flagName: "rechamada", value: true },
        interaction,
        agent: { name: "Especialista de Faturamento", agentType: "CALL_AGENT", objective: "Avaliar o processo" },
        knowledgeDocuments: [{ title: "Contestação de cobrança" }],
        orchestrator: { name: "Orquestrador de Faturamento", invocationContext: "WORKFLOW" },
        availableSpecialists: [{ name: "Especialista de Faturamento", toolName: "faturamento" }],
        simulatedNow: "2026-09-17T12:00:00.000Z",
      },
    },
    aiCalls: 2,
    inputTokens: 1200,
    outputTokens: 600,
    totalTokens: 1800,
    durationMs: 4100,
    errorMessage: "Execução interrompida por erro de teste",
    createdAt: "2026-09-17T12:00:00.000Z",
    updatedAt: "2026-09-17T12:00:00.000Z",
    ...overrides,
  } as unknown as QaRun
}

function openAllSteps(): void {
  for (const button of screen.getAllByRole("button", { name: /^\d+\. / })) {
    // Fechado = chevron para a direita (passos concluídos começam fechados; os demais, abertos).
    if (button.querySelector(".lucide-chevron-right")) fireEvent.click(button)
  }
}

describe("RunResult — todas as seções montam", () => {
  it("cabeçalho, badges, pendência de revisão humana e passo a passo (Condition, coleção, ranking, consolidação, destinatário, erro)", () => {
    renderRun(workflowRun())
    expect(screen.getByText("Monitoria · Contestação de conta")).toBeInTheDocument()
    expect(screen.getByText("Rascunho")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Executar novamente esta versão/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Testar rascunho atual/ })).toBeInTheDocument()
    expect(screen.getByText("Execução interrompida por erro de teste")).toBeInTheDocument()
    expect(screen.getByText("Canvas da simulação")).toBeInTheDocument()
    expect(screen.getByText(/Revisor que seria utilizado: Supervisora Um/)).toBeInTheDocument()
    expect(screen.getAllByRole("button", { name: "Aprovar" }).length).toBeGreaterThan(0)

    openAllSteps()
    expect(screen.getByText("Contexto do gatilho")).toBeInTheDocument()
    expect(screen.getByText("Meta resolvida")).toBeInTheDocument()
    expect(screen.getByText("Subgrupo Diagnóstico IA")).toBeInTheDocument()
    expect(screen.getByText("Como o valor foi formado (medição operacional)")).toBeInTheDocument()
    expect(screen.getAllByText(/⚠ Fonte de escala atrasada \(última carga 10\/09\/2026\)/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Quartil operacional — TMA \(Semana\)/)).toBeInTheDocument()
    expect(screen.getByText("Sem dados — motivo")).toBeInTheDocument()
    expect(screen.getByText("Qualquer regra (OU)")).toBeInTheDocument()
    expect(screen.getByText(/2026-07: Q4/)).toBeInTheDocument()
    expect(screen.getByText("Coleção de colaboradores")).toBeInTheDocument()
    expect(screen.getAllByText("Ranking de colaboradores")).toHaveLength(2)
    expect(screen.getByText(/Separado por Grupo — 3 baldes/)).toBeInTheDocument()
    expect(screen.getByText(/Quartil operacional não classificado: só 3 colaborador\(es\) com dados/)).toBeInTheDocument()
    expect(screen.getByText(/0 selecionados neste balde/)).toBeInTheDocument()
    expect(screen.getByText("Consolidação")).toBeInTheDocument()
    expect(screen.getByText(/falhou \(Agent indisponível\)/)).toBeInTheDocument()
    expect(screen.getByTestId("qa-tool-trace")).toHaveTextContent("Consultar indicador")
    expect(screen.getByTestId("qa-support-materials")).toHaveTextContent("2 candidato(s) vindo(s) do retrieval")
    expect(screen.getByText("Resultado do node")).toBeInTheDocument()
    expect(screen.getByText("Destinatário resolvido:").parentElement).toHaveTextContent("Gerente Um")
    expect(screen.getByText("WORKFLOW_OUTPUT_RECIPIENT_NOT_FOUND")).toBeInTheDocument()
    expect(screen.getAllByText("OUTPUT SIMULADO").length).toBeGreaterThan(0)
  })

  it("fan-out: um grupo por colaborador com revisão, espera e pausa próprias", () => {
    renderRun(workflowRun())
    expect(screen.getByText(/Aplicar individualmente — 3 colaborador\(es\)/)).toBeInTheDocument()
    expect(screen.getByText(/Revisão humana simulada — Larissa Monteiro/)).toBeInTheDocument()
    expect(screen.getByText(/Aguardando \(tempo simulado\) — Rafael Souza/)).toBeInTheDocument()
    expect(screen.getByText(/Execução pausada — Camila Pereira/)).toBeInTheDocument()
    expect(screen.getByText(/orçamento compartilhado entre todos os colaboradores: 2 \/ 10/)).toBeInTheDocument()
  })

  it("abas de efeitos simulados, requests de IA, telemetria e contexto", () => {
    renderRun(workflowRun())

    fireEvent.click(screen.getByRole("button", { name: /Efeitos simulados/ }))
    for (const title of ["REVISÃO HUMANA SIMULADA", "ESCALONAMENTO SIMULADO", "CONFIGURAÇÃO — NÃO ALTERADA", "FEEDBACK DE ATENDIMENTO SIMULADO", "FEEDBACK CONFIÁVEL SIMULADO", "PUBLICAÇÃO NO ACOMPANHAMENTO SIMULADA", "EXECUÇÃO DE AGENTE SIMULADA"]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(screen.getAllByText("OUTPUT SIMULADO")).toHaveLength(2)

    fireEvent.click(screen.getByRole("button", { name: /Requests de IA/ }))
    fireEvent.click(screen.getByText("Ver contexto/prompt enviado"))
    expect(screen.getByText("Prompt final (system)")).toBeInTheDocument()
    expect(screen.getByText("Você é a INIA.")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /Tokens e eficiência/ }))

    fireEvent.click(screen.getByRole("button", { name: /Contexto utilizado/ }))
    for (const title of ["Colaborador", "Indicadores (performance mais recente)", "Jornada", "Gatilho", "Transcrição (contexto disponível para IA)", "Agent", "Orchestrator", "Relógio simulado"]) {
      expect(screen.getByText(title)).toBeInTheDocument()
    }
    expect(screen.getByText(/O texto persistido mudou desde o QA Run original/)).toBeInTheDocument()
  })

  it("pendências do trace principal: espera simulada e pausa por orçamento de IA", () => {
    renderRun(workflowRun({ status: "WAITING", state: { ...workflowRun().state!, status: "waiting", pauseReason: "WAIT", resumeAt: "2026-09-18T12:00:00.000Z" }, trace: { ...workflowRun().trace, pendingReview: null, employeeRuns: [] } }))
    expect(screen.getByText("Aguardando (tempo simulado)")).toBeInTheDocument()
    cleanup()

    renderRun(workflowRun({ status: "PAUSED", state: { ...workflowRun().state!, status: "paused", pauseReason: "AI_BUDGET" }, trace: { ...workflowRun().trace, pendingReview: null, employeeRuns: [] } }))
    expect(screen.getByText("Execução pausada")).toBeInTheDocument()
    expect(screen.getByText(/Limite de requests de IA atingido antes da próxima etapa \(utilizado: 2 \/ 10\)/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Continuar com IA real \(sem limite\)/ })).toBeInTheDocument()
  })

  it("Agent sem request de IA mas com retrieval de base: mostra o que entraria no prompt", () => {
    renderRun(
      workflowRun({
        resourceType: "AGENT",
        status: "PAUSED",
        state: null,
        errorMessage: null,
        context: {},
        trace: { steps: [], effects: [], aiCalls: [], knowledgeRetrievals: [{ ...knowledge, agentId: "agent-1", agentName: "Especialista de Faturamento", role: "agent" }], people: {}, context: {} },
      }),
    )
    expect(screen.getByText("Nenhum passo executado.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /^Executar novamente$/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Efeitos simulados/ }))
    expect(screen.getByText("Nenhum efeito seria produzido por esta execução.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Requests de IA/ }))
    expect(screen.getByText(/Retrieval de bases de conhecimento já executado/)).toBeInTheDocument()
  })
})
