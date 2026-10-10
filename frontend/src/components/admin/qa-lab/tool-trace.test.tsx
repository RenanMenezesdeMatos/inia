/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

import { RunResult } from "./run-result"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"

afterEach(cleanup)

function renderRun(value: QaRun) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><RunResult run={value} /></QueryClientProvider>)
}

const trace = [
  { sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA: 452 s no período · meta 400 (fora) · 20 medição(ões), cobertura 100%", quality: { status: "SUFFICIENT", sampleCount: 20, coverage: 1, freshness: "FRESH" }, provenance: { period: { start: "", end: "", label: "2026-08-01 a 2026-08-31" }, population: "colaborador", filters: [], dataSource: "MEASUREMENT (operacional diário)" }, status: "COMPLETED", startedAt: "", completedAt: "" },
  { sequence: 2, tool: "segment_indicator", label: "Segmentar", capability: "SEGMENTATION", argumentsSummary: { indicatorCode: "TMA", dimension: "SUBJECT" }, resultSummary: "SUBJECT: 4 bucket(s) — Segunda via=720 (n=3)", quality: { status: "INSUFFICIENT_SAMPLE", sampleCount: 4, coverage: null, freshness: null, note: "menos de 5 interações" }, provenance: { population: "interações do colaborador", filters: ["dimensão Assunto"], dataSource: "INTERACTIONS (duração registrada)" }, status: "COMPLETED", startedAt: "", completedAt: "" },
  { sequence: 3, tool: "segment_indicator", label: "Segmentar", capability: "SEGMENTATION", argumentsSummary: { indicatorCode: "TMA", dimension: "SUBJECT" }, resultSummary: "(cache) SUBJECT: 4 bucket(s)", quality: null, provenance: null, status: "CACHED", startedAt: "", completedAt: "" },
]

function run(nodeOutput: unknown): QaRun {
  return {
    id: "run-1",
    resourceType: "AGENT",
    resourceId: "agent-1",
    resourceName: "[POC TOOLS] Diagnóstico de Performance",
    status: "COMPLETED",
    executedByName: "Admin",
    createdAt: "2026-09-17T12:00:00.000Z",
    durationMs: 1200,
    errorMessage: null,
    input: { agentId: "agent-1", input: "Diagnostique.", operatorId: null, aiPolicy: "REAL", maxAiCalls: null },
    state: null,
    trace: {
      steps: [{ index: 1, nodeId: "agent", nodeType: "agent", label: "Agent", status: "completed", startedAt: "2026-09-17T12:00:00.000Z", simulatedNow: "2026-09-17T12:00:00.000Z", durationMs: 1200, outcome: { kind: "complete" }, aiCalls: 3, totalTokens: 900, nodeOutput }],
      effects: [],
      aiCalls: [],
      knowledgeRetrievals: [],
      people: {},
      context: { agent: { id: "agent-1", name: "Agent", agentType: "CUSTOM", objective: "o", active: true }, knowledgeDocuments: [], operator: null, inputContext: "Diagnostique." },
    },
  } as unknown as QaRun
}

describe("QA Lab — Ferramentas utilizadas (trace de investigação)", () => {
  it("lista as Tools na ordem, com rótulo amigável, argumentos, resumo, qualidade e proveniência; resumo do orçamento", () => {
    renderRun(run({ text: "resposta", structured: null, supportMaterials: [], toolTrace: trace, investigation: { toolCalls: 2, cachedCalls: 1, rejectedCalls: 0, budget: 10, outcome: "ANSWERED" } }))
    fireEvent.click(screen.getByRole("button", { name: /^1\. Agent/ }))
    const block = screen.getByTestId("qa-tool-trace")
    expect(block).toHaveTextContent("Ferramentas utilizadas")
    expect(block).toHaveTextContent("2 chamada(s) de 10 · 1 do cache")
    expect(block).toHaveTextContent("1. Consultar indicador")
    expect(block).toHaveTextContent("indicatorCode=TMA")
    expect(block).toHaveTextContent("TMA: 452 s no período · meta 400 (fora)")
    expect(block).toHaveTextContent("período 2026-08-01 a 2026-08-31 · colaborador · MEASUREMENT (operacional diário)")
    expect(block).toHaveTextContent("2. Segmentar")
    expect(block).toHaveTextContent("Amostra insuficiente")
    expect(block).toHaveTextContent("cache")
    expect(block).not.toHaveTextContent("PROMPT")
  })

  it("V1.1: rodada/preflight, paralelismo e ref do ledger por chamada; resumo com preflight/rodadas/ondas; síntese auditável com gating", () => {
    const v11 = [
      { ...trace[0]!, round: 0, concurrency: 3, ledgerRef: "F1" },
      { ...trace[1]!, sequence: 2, round: 1, concurrency: 2, ledgerRef: "F2", argumentsSummary: { interactionIds: ["5a0b6d1e-1111-4c1c-9c2c-aaaaaaaaaaaa"] }, modelArguments: { interactionIds: ["I1"] } },
    ]
    renderRun(
      run({
        text: "resposta",
        structured: null,
        supportMaterials: [],
        toolTrace: v11,
        investigation: {
          toolCalls: 2, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED", preflightCalls: 1, investigationToolCalls: 1, planningRounds: 1, maxPlanningRounds: 3, parallelWaves: 1,
          synthesis: { supportedHypotheses: ["TMA acima do subgrupo (F1)"], unsupportedHypotheses: ["concentração por assunto"], limitations: ["amostra de 2 interações"], behavioralClaims: [{ text: "Na interação analisada você repetiu a confirmação", evidenceRefs: ["F2"], scope: "INTERACTION_SPECIFIC" }], recommendationSupport: [{ text: "Pode ajudar revisar o encerramento", basis: "GENERAL_DEVELOPMENT_SUGGESTION", evidenceRefs: [] }], evidenceRepresentativeness: [{ ref: "F2", tool: "analyze_interactions", analyzed: 2, universe: 1267, level: "ANECDOTAL" }] },
          evidenceGating: { rejectedClaims: [{ kind: "BEHAVIORAL_CLAIM", text: "Você navega lentamente", reason: "sem referência a fato do ledger" }], corrected: true },
        },
      }),
    )
    fireEvent.click(screen.getByRole("button", { name: /^1\. Agent/ }))
    const block = screen.getByTestId("qa-tool-trace")
    expect(block).toHaveTextContent("1 escolhida(s) pelo Agent de 12 · 1 no preflight · 2 no total · 1 rodada(s) de 3 · 1 onda(s) em paralelo")
    // Auditoria: id real na chamada + como o modelo pediu (handle).
    expect(block).toHaveTextContent("interactionIds=[\"5a0b6d1e-1111-4c1c-9c2c-aaaaaaaaaaaa\"]")
    expect(block).toHaveTextContent("pedido como interactionIds=[\"I1\"]")
    expect(block).toHaveTextContent("F1")
    expect(block).toHaveTextContent("preflight")
    expect(block).toHaveTextContent("paralelo ×3")
    expect(block).toHaveTextContent("rodada 1")
    const gating = screen.getByTestId("qa-evidence-gating")
    expect(gating).toHaveTextContent("1 afirmação(ões) sem evidência rejeitada(s) pela validação — corrigidas na re-request")
    expect(gating).toHaveTextContent('"Você navega lentamente" — sem referência a fato do ledger')
    expect(gating).toHaveTextContent("TMA acima do subgrupo (F1)")
    expect(gating).toHaveTextContent("amostra de 2 interações")
    expect(gating).toHaveTextContent("Pode ajudar revisar o encerramento — Sugestão geral de desenvolvimento")
    expect(gating).toHaveTextContent("Nesta(s) interação(ões)")
    expect(screen.getByTestId("qa-representativeness")).toHaveTextContent("F2 · 2 analisada(s) de 1267 registrada(s) · Anedótica")
  })

  it("sem trace, o bloco não aparece", () => {
    renderRun(run({ text: "resposta", structured: null, supportMaterials: [] }))
    fireEvent.click(screen.getByRole("button", { name: /^1\. Agent/ }))
    expect(screen.queryByTestId("qa-tool-trace")).not.toBeInTheDocument()
    expect(screen.getByText("Resultado do node")).toBeInTheDocument()
  })
})
