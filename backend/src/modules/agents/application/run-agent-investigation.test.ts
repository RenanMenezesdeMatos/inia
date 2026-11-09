import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { answerAgentVersionQuery } from "../testing/agent-version-fakes.js"

const generateAgentReply = vi.fn()
const runInvestigation = vi.fn()
const usage = { promptTokens: 6000, outputTokens: 500, totalTokens: 6500, cachedInputTokens: null, reasoningTokens: null }
vi.mock("../infrastructure/gemini-agent-client.js", () => ({
  // A síntese com gating usa a variante com uso — mesmo mock, envelope com tokens do "provider".
  generateAgentReplyWithUsage: async (...args: unknown[]) => ({ text: await generateAgentReply(...args), usage, durationMs: 40, model: "gemini-test" }),
  AGENT_LLM_MODEL: "test",
}))
// Texto livre sem saída estruturada sai pelo gateway → adapter → cliente de function calling (mesmo mock, resposta em texto).
vi.mock("../../assistant/infrastructure/gemini-function-calling-client.js", () => ({
  generateWithTools: async (contents: { text?: string }[], systemPrompt: string) => ({ kind: "text", text: await generateAgentReply(systemPrompt, contents[0]?.text ?? ""), usage, durationMs: 40, model: "gemini-test" }),
}))
vi.mock("../../investigation/application/investigation-runtime.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../investigation/application/investigation-runtime.js")>()
  return { ...original, runInvestigation: (...args: unknown[]) => runInvestigation(...args) }
})
vi.mock("./build-system-prompt.js", () => ({ buildSystemPromptWithTrace: async () => ({ systemPrompt: "PROMPT DO AGENT", knowledge: { mode: "NONE", authorizedDocuments: [], retrieved: [], injectedChars: 0, estimatedTokens: 0, authorizedChars: 0, budget: { maxChunks: 8, maxChars: 9000 } } }) }))
vi.mock("../../workflows/application/organization-timezone.js", () => ({ resolveOrganizationTimezone: async () => "America/Fortaleza", DEFAULT_ORGANIZATION_TIMEZONE: "America/Fortaleza" }))

const { runAgent } = await import("./run-agent.js")

const ORGANIZATION = "00000000-0000-4000-8000-0000000000a1"
const OPERATOR = "00000000-0000-4000-8000-000000000030"
const AGENT = "00000000-0000-4000-8000-000000000ac1"

function fakeDb(capabilities: string[]): Database {
  const agentRow = { name: "Agent", objective: "obj", description: "desc", context_prompt: "p", active: true, recommend_support_materials: false, investigation_capabilities: capabilities }
  return {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      // PEN-002: o runtime executa a versão vigente — a configuração da versão sai da mesma linha simulada.
      const versioned = answerAgentVersionQuery(text, params, () => agentRow)
      if (versioned) return versioned
      if (text.includes("from agents where id")) return { rows: [agentRow], rowCount: 1 }
      if (text.includes("from people p left join teams")) return { rows: [{ name: "Camila Fonseca", team_id: "t1", team_name: "B2C", subteam_id: "s1", subteam_name: "Voz" }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
}

const recorder = { start: vi.fn(async () => "run-1"), complete: vi.fn(async () => undefined), fail: vi.fn(async () => undefined) }

const trace = [{ sequence: 1, tool: "get_indicator_snapshot", label: "Consultar indicador", capability: "INDICATOR_ANALYSIS", argumentsSummary: { indicatorCode: "TMA" }, resultSummary: "TMA: 452 s (meta 400)", quality: { status: "SUFFICIENT", sampleCount: 20, coverage: 1, freshness: "FRESH" }, provenance: { population: "colaborador", filters: [], dataSource: "MEASUREMENT" }, status: "COMPLETED", startedAt: "", completedAt: "", round: 0, ledgerRef: "F1" }]
const ledger = [{ ref: "F1", sequence: 1, round: 0, tool: "get_indicator_snapshot", capability: "INDICATOR_ANALYSIS", keyArgs: "indicatorCode=TMA", summary: "TMA: 452 s (meta 400)", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: null, periodLabel: null, preflight: true }]
const behavioralLedgerEntry = { ref: "F2", sequence: 2, round: 1, tool: "analyze_interactions", capability: "INTERACTION_ANALYSIS", keyArgs: "", summary: "1 padrão: repete a confirmação de dados (2 interações)", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: null, periodLabel: null, preflight: false }
const investigationOutcome = (overrides: Record<string, unknown> = {}) => ({
  notes: "Hipótese sustentada: concentração em segunda via.",
  trace,
  summary: { toolCalls: 1, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED", preflightCalls: 1, planningRounds: 0, requests: 1, tokens: { input: 3000, cached: null, output: 200, reasoning: null, total: 3200 } },
  ledger,
  limitations: [],
  knowledgeCandidates: [],
  dossier: "EVIDÊNCIAS DA INVESTIGAÇÃO\nF1. Consultar indicador: TMA: 452 s (meta 400)",
  requests: [{ phase: "PLANNING", model: "gemini-test", usage: { promptTokens: 3000, outputTokens: 200, totalTokens: 3200, cachedInputTokens: null, reasoningTokens: null }, durationMs: 10, toolCalls: [] }],
  operationalUniverse: null,
  objective: { kind: "DESCRIBE_PERFORMANCE", question: "Como está o TMA?", requiredScope: null, causal: false },
  stopReason: "ANSWER_SUFFICIENT",
  ...overrides,
})
const indicatorWorkflow = { kind: "indicator" as const, operatorId: OPERATOR, teamId: "t1", indicatorMeasurementId: "m1", measuredAt: "2026-09-16T03:00:00Z", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", value: 452, targetValue: 400, comparator: "GT", thresholdNumeric: "400" }
// V1.3 fail-closed: o envelope (behavioralClaims como array) é obrigatório — o padrão dos testes já o traz vazio.
const feedbackJson = (extra: Record<string, unknown> = {}) => JSON.stringify({ title: "TMA acima da meta", summary: "Resumo", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Recomendação", behavioralClaims: [], recommendationSupport: [], ...extra })

beforeEach(() => {
  generateAgentReply.mockReset()
  runInvestigation.mockReset()
  recorder.complete.mockClear()
})

describe("runAgent — investigação antes da resposta", () => {
  it("Agent sem capacidades responde como sempre: nenhuma investigação, input intacto, sem trace", async () => {
    generateAgentReply.mockResolvedValue(JSON.stringify({ title: "Título", summary: "Resumo", relatedProcedure: "Procedimento", recommendation: "Recomendação" }))
    const outcome = await runAgent(fakeDb([]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: { kind: "indicator", operatorId: OPERATOR, teamId: "t1", indicatorMeasurementId: "m1", measuredAt: "2026-09-16T03:00:00Z", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", value: 452, targetValue: 400, comparator: "GT", thresholdNumeric: "400" } })
    expect(runInvestigation).not.toHaveBeenCalled()
    expect(generateAgentReply.mock.calls[0]![1]).toBe("Indicador: TMA")
    expect(outcome.toolTrace).toBeUndefined()
    expect(recorder.complete).toHaveBeenCalledWith(expect.anything(), "run-1", expect.any(String), undefined)
  })

  it("Agent com capacidades (∩ restrição do Workflow) investiga sobre o sujeito do Workflow; o dossiê entra na chamada final e o trace viaja no resultado e no registro da execução", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome())
    generateAgentReply.mockResolvedValue(feedbackJson())
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS"]), {
      organizationId: ORGANIZATION,
      agentId: AGENT,
      inputContext: "Indicador: TMA",
      source: "WORKFLOW",
      recorder,
      allowedCapabilities: ["INDICATOR_ANALYSIS", "WORK_CONTEXT"],
      now: new Date("2026-09-17T12:00:00Z"),
      workflow: { kind: "indicator", operatorId: OPERATOR, teamId: "t1", indicatorMeasurementId: null, measuredAt: "2026-09-16T03:00:00Z", indicatorCode: "TMA", indicatorName: "TMA", unit: "SECONDS", value: 452, targetValue: 400, comparator: "GT", thresholdNumeric: "400", periodSummary: { measurementIds: [], periodLabel: "Mês anterior", periodStart: "2026-08-01T03:00:00Z", periodEnd: "2026-09-01T03:00:00Z" } },
    })
    const call = runInvestigation.mock.calls[0]![0] as { capabilities: string[]; subject: { operatorId: string; indicatorCode: string | null; operatorName: string }; defaultPeriod: { label: string }; objective: string; systemPrompt: string }
    // effective = Agent ∩ Workflow: WORK_CONTEXT não é concedido; SEGMENTATION/INTERACTION ficam de fora.
    expect(call.capabilities).toEqual(["INDICATOR_ANALYSIS"])
    expect(call.subject).toMatchObject({ operatorId: OPERATOR, indicatorCode: "TMA", operatorName: "Camila Fonseca" })
    expect(call.defaultPeriod.label).toBe("Mês anterior (2026-08-01 a 2026-08-31)")
    expect(call.systemPrompt).toBe("PROMPT DO AGENT")
    // A chamada final recebe o input original + o dossiê (só fatos apurados pela aplicação).
    expect(generateAgentReply.mock.calls[0]![1]).toBe("Indicador: TMA\n\nEVIDÊNCIAS DA INVESTIGAÇÃO\nF1. Consultar indicador: TMA: 452 s (meta 400)")
    // O contrato da síntese pede hipóteses/limitações/afirmações/suporte com as refs válidas do ledger.
    expect(generateAgentReply.mock.calls[0]![0]).toContain("refs válidas são somente F1")
    expect(outcome.toolTrace).toEqual(trace)
    expect(outcome.investigation).toMatchObject({ toolCalls: 1, outcome: "ANSWERED", evidenceGating: { rejectedClaims: [], corrected: false } })
    // Token Budget do run inclui a síntese final (1 request de investigação + 1 de síntese).
    expect(outcome.investigation).toMatchObject({ requests: 2, tokens: { input: 9000, output: 700, total: 9700, cached: null, reasoning: null } })
    expect(outcome.workflowResult?.toolTrace).toEqual(trace)
    expect(recorder.complete).toHaveBeenCalledWith(expect.anything(), "run-1", expect.any(String), trace)
  })

  it("fora do Workflow (teste manual/QA) sem sujeito não há investigação mesmo com capacidades; com sujeito explícito há", async () => {
    generateAgentReply.mockResolvedValue("resposta livre")
    await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "pergunta", source: "QA_SIMULATION", recorder })
    expect(runInvestigation).not.toHaveBeenCalled()
    runInvestigation.mockResolvedValue(investigationOutcome({ notes: "", trace: [], ledger: [], dossier: "", requests: [] }))
    await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "pergunta", source: "QA_SIMULATION", recorder, subject: { operatorId: OPERATOR } })
    expect(runInvestigation).toHaveBeenCalledTimes(1)
    // Investigação sem nenhuma Tool concluída: o input final fica intacto.
    expect(generateAgentReply.mock.calls[1]![1]).toBe("pergunta")
  })

  it("materiais de apoio: com a capacidade, os candidatos da investigação (query_knowledge) entram na seção do prompt final e a seleção passa pela MESMA validação da V1 — sem round-trip de Tool", async () => {
    const candidate = { materialId: "11111111-1111-4111-8111-111111111111", title: "Procedimento de segunda via" }
    runInvestigation.mockResolvedValue(investigationOutcome({ knowledgeCandidates: [candidate] }))
    generateAgentReply.mockResolvedValue(feedbackJson({ supportMaterials: [{ materialId: candidate.materialId, reason: "Descreve o envio imediato por e-mail, o passo que faltou." }, { materialId: "22222222-2222-4222-8222-222222222222", reason: "Id que a IA inventou e não está entre os candidatos." }] }))
    const outcome = await runAgent(fakeDb(["KNOWLEDGE", "SUPPORT_MATERIALS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(generateAgentReply.mock.calls[0]![0]).toContain(candidate.title)
    expect(outcome.workflowResult?.supportMaterials).toEqual([{ materialId: candidate.materialId, title: candidate.title, reason: "Descreve o envio imediato por e-mail, o passo que faltou." }])
    expect(outcome.workflowResult?.supportMaterialsRejected).toHaveLength(1)
  })
})

describe("runAgent — EVIDENCE GATING da síntese final (V1.1)", () => {
  it("afirmação comportamental sem fato de interação no ledger → UMA re-request corretiva; corrigida, passa e fica registrada", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome())
    generateAgentReply
      .mockResolvedValueOnce(feedbackJson({ recommendation: "Você navega lentamente nos sistemas. - Evite pausas silenciosas.", behavioralClaims: [{ text: "Você navega lentamente nos sistemas", evidenceRefs: ["F1"] }], recommendationSupport: [{ text: "Evite pausas silenciosas", basis: "OBSERVED_EVIDENCE", evidenceRefs: [] }] }))
      .mockResolvedValueOnce(feedbackJson({ recommendation: "Os dados mostram TMA acima da meta, mas a amostra de interações não permite identificar uma causa comportamental. - Pode ajudar revisar o roteiro de encerramento.", behavioralClaims: [], recommendationSupport: [{ text: "Pode ajudar revisar o roteiro de encerramento", basis: "GENERAL_DEVELOPMENT_SUGGESTION", evidenceRefs: [] }], limitations: ["amostra de 2 interações"] }))
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(outcome.status).toBe("COMPLETED")
    expect(generateAgentReply).toHaveBeenCalledTimes(2)
    expect(generateAgentReply.mock.calls[1]![1]).toContain("CORREÇÃO OBRIGATÓRIA")
    expect(generateAgentReply.mock.calls[1]![1]).toContain("Você navega lentamente nos sistemas")
    expect(outcome.investigation?.evidenceGating).toMatchObject({
      rejectedClaims: [
        { kind: "BEHAVIORAL_CLAIM", text: "Você navega lentamente nos sistemas", reason: "refs F1 não são evidência de interação/transcrição" },
        { kind: "RECOMMENDATION", text: "Evite pausas silenciosas", reason: "OBSERVED_EVIDENCE sem referência válida ao ledger" },
      ],
      corrected: true,
      correctionAttempted: true,
      correctionSucceeded: true,
    })
    expect(outcome.investigation?.synthesis?.limitations).toEqual(["amostra de 2 interações"])
    expect(outcome.investigation?.synthesis?.recommendationSupport[0]?.basis).toBe("GENERAL_DEVELOPMENT_SUGGESTION")
    expect(outcome.investigation?.requests).toBe(3)
    expect(outcome.workflowResult?.input.structured.recommendation).toContain("não permite identificar uma causa comportamental")
  })

  it("afirmação comportamental COM fato de transcrição (analyze_interactions) passa sem correção", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome({ ledger: [...ledger, behavioralLedgerEntry] }))
    generateAgentReply.mockResolvedValue(feedbackJson({ behavioralClaims: [{ text: "Você repete a confirmação de dados", evidenceRefs: ["F2"] }], recommendationSupport: [{ text: "Confirme os dados uma única vez", basis: "OBSERVED_EVIDENCE", evidenceRefs: ["F2"] }] }))
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS", "INTERACTION_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(generateAgentReply).toHaveBeenCalledTimes(1)
    expect(outcome.investigation?.evidenceGating).toMatchObject({ rejectedClaims: [], corrected: false, envelopePresent: true })
  })

  it("KNOWLEDGE_GUIDANCE sem base de conhecimento real é rejeitada; se a correção insistir, a resposta é descartada (AGENT_UNSUPPORTED_BEHAVIORAL_CLAIM) e a execução falha", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome())
    generateAgentReply.mockResolvedValue(feedbackJson({ recommendationSupport: [{ text: "Siga o procedimento de fechamento em 3 passos", basis: "KNOWLEDGE_GUIDANCE", evidenceRefs: [] }] }))
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(generateAgentReply).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe("FAILED")
    expect(outcome.errorMessage).toContain("mantém afirmações sem evidência após correção")
    expect(recorder.fail).toHaveBeenCalled()
  })

  it("V1.3 fail-closed: JSON sem os campos internos de evidência → UMA correção pedindo o envelope; persistindo, descarte (AGENT_EVIDENCE_ENVELOPE_MISSING) — nunca publicado como 'zero claims'", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome())
    generateAgentReply.mockResolvedValue(JSON.stringify({ title: "TMA acima da meta", summary: "Resumo", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Você costuma navegar lentamente." }))
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(generateAgentReply).toHaveBeenCalledTimes(2)
    expect(generateAgentReply.mock.calls[1]![1]).toContain("não trouxe os campos internos de auditoria")
    expect(outcome.status).toBe("FAILED")
    expect(outcome.errorMessage).toContain("fail-closed")
  })

  it("feedback de chamada (interação em foco): a transcrição do input vale como evidência (ref TRANSCRICAO) para afirmações comportamentais", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome())
    const transcript = "Operador: Vou confirmar seus dados de novo. Cliente: já confirmei."
    generateAgentReply.mockResolvedValue(JSON.stringify({ title: "Título", summary: "Resumo", impactedIndicator: "Rechamada", evidenceFound: "Vou confirmar seus dados de novo", observedBehavior: "Repetiu a confirmação", relatedProcedure: "Procedimento", recommendation: "Confirme uma vez.", behavioralClaims: [{ text: "Você repetiu a confirmação de dados", evidenceRefs: ["TRANSCRICAO"] }] }))
    const outcome = await runAgent(fakeDb(["INTERACTION_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: transcript, source: "WORKFLOW", recorder, workflow: { kind: "channel_flag", interactionId: "int-1", operatorId: OPERATOR, teamId: "t1", startedAt: "2026-09-10T13:00:00Z", flagName: "rechamada", matchedValueBoolean: true, matchedValueNumeric: null, comparator: "EQUALS", thresholdBoolean: true, thresholdNumeric: null } })
    expect(outcome.status).toBe("COMPLETED")
    expect(generateAgentReply.mock.calls[0]![0]).toContain("refs válidas são somente TRANSCRICAO, F1")
    expect(outcome.investigation?.evidenceGating).toMatchObject({ rejectedClaims: [], corrected: false, envelopePresent: true })
  })
})

describe("runAgent — FACT PRESERVATION (V1.3.1 — §28–30/§56)", () => {
  const trendLedger = [...ledger, { ref: "F2", sequence: 2, round: 1, tool: "compare_periods", capability: "INDICATOR_ANALYSIS", keyArgs: "indicatorCode=TMA", summary: "ago 467 × jul 525 → -58 (-11.1%) · IMPROVED", qualityStatus: "SUFFICIENT", qualityNote: null, sampleCount: 21, periodLabel: null, preflight: false, signals: { performance: "IMPROVED" } }]
  const explain = { kind: "EXPLAIN_INDICATOR_DEVIATION" as const, question: "Por que o TMA está assim?", requiredScope: null, causal: true }

  it("fato crítico IMPROVED: texto que afirma 'vem piorando' é corrigido em UMA re-request; a versão com 'melhora' passa e consideredCriticalFacts fica no resumo", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome({ ledger: trendLedger, objective: explain, summary: { toolCalls: 2, cachedCalls: 0, rejectedCalls: 0, budget: 12, outcome: "ANSWERED", preflightCalls: 1, planningRounds: 1, requests: 1, interactionsInPeriod: 0, tokens: { input: 3000, cached: null, output: 200, reasoning: null, total: 3200 } } }))
    generateAgentReply
      .mockResolvedValueOnce(feedbackJson({ recommendation: "Seu TMA vem piorando mês a mês; foque em reduzir o tempo.", limitations: ["sem interações"], consideredCriticalFacts: ["F1", "F2"] }))
      .mockResolvedValueOnce(feedbackJson({ recommendation: "Houve melhora relevante frente ao mês anterior, mas o TMA segue acima da meta.", limitations: ["sem interações"], consideredCriticalFacts: ["F1", "F2"] }))
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(outcome.status).toBe("COMPLETED")
    expect(generateAgentReply).toHaveBeenCalledTimes(2)
    expect(generateAgentReply.mock.calls[1]![1]).toContain("Fato crítico à decisão")
    expect(generateAgentReply.mock.calls[1]![1]).toContain("MELHORA")
    expect(outcome.investigation?.evidenceGating).toMatchObject({ corrected: true, rejectedClaims: [{ kind: "CRITICAL_FACT", text: "F2 (tendência)" }] })
    expect(outcome.investigation?.synthesis?.consideredCriticalFacts).toEqual(["F1", "F2"])
  })

  it("fato crítico não DECLARADO (consideredCriticalFacts sem F2) → correção; insistindo sem contradição, a resposta passa com factPreservation UNDECLARED (omissão registrada, nunca descarte); contradição persistente descarta", async () => {
    runInvestigation.mockResolvedValue(investigationOutcome({ ledger: trendLedger, objective: explain }))
    generateAgentReply.mockResolvedValue(feedbackJson({ recommendation: "Foque em reduzir o tempo.", consideredCriticalFacts: ["F1"], limitations: ["x"] }))
    const outcome = await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(generateAgentReply).toHaveBeenCalledTimes(2)
    expect(outcome.status).toBe("COMPLETED")
    expect(outcome.investigation?.evidenceGating).toMatchObject({ corrected: true, factPreservation: "UNDECLARED" })
    generateAgentReply.mockReset().mockResolvedValue(feedbackJson({ recommendation: "Seu TMA vem piorando.", consideredCriticalFacts: ["F1", "F2"], limitations: ["x"] }))
    const contradiction = await runAgent(fakeDb(["INDICATOR_ANALYSIS"]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(contradiction.status).toBe("FAILED")
    expect(contradiction.errorMessage).toContain("F2 (tendência)")
  })
})

describe("V1.7.1c — resposta fora do contrato no Agent direto (§15/§24)", () => {
  it("a resposta rejeitada fica na PRÓPRIA execução (agent_runs) e o erro classificado segue para o Workflow — nada de só a mensagem", async () => {
    const { ModelOutputContractError } = await import("../../../shared/domain/model-output-contract-error.js")
    generateAgentReply.mockResolvedValue("Aqui está a análise, sem JSON nenhum.")
    recorder.fail.mockClear()
    const outcome = await runAgent(fakeDb([]), { organizationId: ORGANIZATION, agentId: AGENT, inputContext: "Indicador: TMA", source: "WORKFLOW", recorder, workflow: indicatorWorkflow })
    expect(outcome.status).toBe("FAILED")
    expect(recorder.fail).toHaveBeenCalledWith(expect.anything(), "run-1", "O agente não retornou um JSON válido.", "Aqui está a análise, sem JSON nenhum.")
    expect(outcome.error).toBeInstanceOf(ModelOutputContractError)
    expect((outcome.error as InstanceType<typeof ModelOutputContractError>).diagnostics).toMatchObject({ contract: "STRUCTURED_JSON", agentId: AGENT, agentRunId: "run-1", violations: [{ code: "JSON_INVALID" }] })
  })
})
