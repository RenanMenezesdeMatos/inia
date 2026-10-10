import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "../../../../infrastructure/database/pool.js"

const generateForRoute = vi.fn()
vi.mock("../../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../shared/application/model-routing/llm-gateway.js")>()
  return { ...original, generateForRoute: (...args: unknown[]) => generateForRoute(...args) }
})

const { analyzeInteractions, findInteractions, normalizeTemporalComparisonStatus, TEMPORAL_STATUS_ALIASES } = await import("./interaction-tools.js")
const { HandleRegistry } = await import("../../domain/handle-registry.js")
const { defaultInvestigationToolState } = await import("../tool-context.js")
type ToolContext = import("../tool-context.js").ToolContext

const UUID = (n: number) => `de00${String(n).padStart(4, "0")}-0000-4000-8000-000000000000`
const period = { start: new Date("2026-06-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z"), label: "trimestre (2026-06-01 a 2026-08-31)" }
const transcripts = [
  { id: UUID(1), reason: "fatura", operator_id: "op", started_at: "2026-06-03T12:00:00Z", content: "OPERADOR: Vou consultar o histórico. CLIENTE: Alô, você continua aí? OPERADOR: Continuo aqui, desculpe." },
  { id: UUID(2), reason: "plano", operator_id: "op", started_at: "2026-08-20T12:00:00Z", content: "OPERADOR: Antes de acessar a linha, conclua a validação no aplicativo. CLIENTE: Feito. OPERADOR: O protocolo deste contato é X." },
]
function context(overrides: Partial<ToolContext["investigation"]> = {}, db?: Database): ToolContext {
  return {
    db: db ?? ({ query: vi.fn(async () => ({ rows: transcripts, rowCount: 2 })) } as unknown as Database),
    organizationId: "org", agentId: "agent", now: new Date("2026-09-18T12:00:00Z"), timeZone: "America/Fortaleza",
    subject: { operatorId: "op", operatorName: "Mariana Alves", teamId: "t", teamName: "B2C", subteamId: "s", subteamName: "Diag", interactionId: null, indicatorCode: null },
    defaultPeriod: period, workdayCache: new Map(), knowledgeCandidates: new Map(), collectedFacts: [], telemetry: { requests: [] }, handles: new HandleRegistry(),
    investigation: { ...defaultInvestigationToolState(), ...overrides },
  }
}
const reply = (payload: unknown) => ({ kind: "text", text: JSON.stringify(payload), usage: { promptTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null, reasoningTokens: null }, durationMs: 1, model: "m", provider: "GEMINI", cache: { mode: "NONE" }, cost: { status: "NOT_CONFIGURED" } })

beforeEach(() => generateForRoute.mockReset())

/** Contrato semântico (V1.4.0): frame de UMA interação com observações/findings; `unit` = evidência literal de um turno. */
const unit = (ref: string, turn: string, speaker: string, quote: string) => ({ interactionRef: ref, turnRef: turn, speaker, quote })
/** Duas fases (V1.4.0 §21): a 1ª resposta é a extração de frames; a 2ª (só quando há finding) é a síntese de patterns (+ temporalComparison). */
const mockTwoPhase = (frames: unknown[], phaseB?: { patterns: unknown[]; temporalComparison?: unknown }) => {
  generateForRoute.mockResolvedValueOnce(reply({ frames }))
  if (phaseB) generateForRoute.mockResolvedValueOnce(reply(phaseB))
}
const frame = (ref: string, parts: Partial<{ customerNeeds: unknown[]; questions: unknown[]; answers: unknown[]; agentActions: unknown[]; agentStatements: unknown[]; commitments: unknown[]; customerSignals: unknown[]; procedureAssertions: unknown[]; findings: unknown[] }> = {}) => ({ interactionRef: ref, customerNeeds: [], questions: [], answers: [], agentActions: [], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], findings: [], ...parts })

describe("analyze_interactions V1.3.2 — consciente do objetivo, contagem sem ambiguidade, zero cálculo pelo LLM (contrato semântico V1.4.0)", () => {
  const analysisObjective = { investigationObjective: "IDENTIFY_EMPLOYEE_PATTERN" as const, question: "Existe um padrão de comportamento do colaborador?", requiredClaimScope: "EMPLOYEE_PATTERN" as const, periodIntent: "PERIOD_EVOLUTION" as const, periodLabel: period.label, openEvidenceNeeds: [{ id: "E_TEMPORAL_COVERAGE", question: "A evidência atravessa o período?" }], materialQuestions: ["Há comportamento recorrente nas interações do período?"], materialHypotheses: [{ hypothesis: "As pausas variam com o assunto", status: "OPEN" }], contradictoryEvidenceSummary: [], analysisPurpose: "", recordedUniverseCount: 30 }
  const semanticReply = () => mockTwoPhase([
      frame("I1", { customerSignals: [{ id: "S1", kind: "CONFIRMATION_REQUEST", summary: "cliente pergunta se a ligação continua", evidence: [unit("I1", "T2", "CLIENTE", "Alô, você continua aí?")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "cliente precisou perguntar se a ligação continuava durante a consulta", observationRefs: ["S1"] }] }),
      frame("I2", { customerSignals: [{ id: "S1", kind: "CONFIRMATION_REQUEST", summary: "inventado", evidence: [unit("I2", "T2", "CLIENTE", "isto não está na transcrição")] }], agentActions: [{ id: "A1", kind: "GUIDED", summary: "orienta validação no aplicativo antes de acessar a linha", evidence: [unit("I2", "T1", "OPERADOR", "conclua a validação no aplicativo")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "sem evidência (observação inventada)", observationRefs: ["S1"] }, { id: "F2", kind: "STRENGTH", summary: "validação antes de acessar a linha", observationRefs: ["A1"] }] }),
    ], { patterns: [
      { description: "cliente pergunta se a ligação continua durante consulta", kind: "RISK", findingRefs: ["I1/F1", "I2/F1"] },
      { description: "validação no aplicativo antes de acessar a linha", kind: "STRENGTH", findingRefs: ["I2/F2"] },
    ] })

  it("§55 o prompt da análise carrega o objetivo derivado, escopo, intenção do período e lacunas abertas + o pedido do Agent — e nenhum vocabulário de gabarito; a Tool devolve contagens calculadas por código", async () => {
    semanticReply()
    const ctx = context({ analysisObjective, recordedUniverseCount: 30, temporalBuckets: 3, samplingStrategy: "TEMPORAL_STRATIFIED" })
    const result = await analyzeInteractions(ctx, { interactionIds: [UUID(1), UUID(2)], objective: "condução do atendimento nas interações analisadas" })
    const request = generateForRoute.mock.calls[0]![0] as { systemPrompt: string; contents: { text: string }[] }
    expect(request.systemPrompt).toContain("CONTEXTO INVESTIGATIVO")
    expect(request.systemPrompt).toContain("Identificar padrão do colaborador — Existe um padrão de comportamento do colaborador?")
    expect(request.systemPrompt).toContain("EMPLOYEE_PATTERN")
    expect(request.systemPrompt).toContain("evolução no período (janela longa)")
    expect(request.systemPrompt).toContain("E_TEMPORAL_COVERAGE (A evidência atravessa o período?)")
    expect(request.systemPrompt).toContain("As pausas variam com o assunto [OPEN]")
    expect(request.systemPrompt).toContain("Pedido do Agent nesta análise: condução do atendimento nas interações analisadas")
    expect(request.systemPrompt).toContain("Zero achados sustentados é uma resposta válida")
    // V1.4.0: método (fato antes de julgamento), balance e handles válidos explícitos.
    expect(request.systemPrompt).toContain("OBSERVAR PRIMEIRO")
    expect(request.systemPrompt).toContain("As referências válidas nesta análise são SOMENTE: I1, I2")
    expect(request.systemPrompt).toContain("NÃO pressupõe problema")
    expect(request.systemPrompt).toContain("devolva EXATAMENTE 2 frame(s)")
    // Fase B: frames compactos (sem transcrição), pedindo só patterns com findingRefs.
    const phaseB = generateForRoute.mock.calls[1]![0] as { systemPrompt: string; contents: { text: string }[] }
    expect(phaseB.systemPrompt).toContain("PATTERNS ENTRE INTERAÇÕES")
    // V1.4.1: FRICTION só com sinal do cliente (S1) é rebaixado a INTERACTION_FRICTION pela regra de atribuição.
    expect(phaseB.contents[0]!.text).toContain("I1/F1 [INTERACTION_FRICTION]")
    expect(phaseB.contents[0]!.text).toContain("AMOSTRA: 2 transcrição(ões) analisada(s) de 30 registrada(s)")
    expect(phaseB.contents[0]!.text).not.toContain("[T2] CLIENTE")
    expect(generateForRoute).toHaveBeenCalledTimes(2)
    for (const token of ["gabarito", "ground truth", "ground_truth", "rotulos_plantados", "caso_controle", "metricas_esperadas", "expectedPattern", "interactionOrdinal", "#1", "#2"]) expect(`${request.systemPrompt}\n${request.contents[0]!.text}`.toLowerCase()).not.toContain(token.toLowerCase())
    // Handles no lugar de UUIDs (Zero-ID) no que o modelo lê.
    expect(request.contents[0]!.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}/)
    const data = result.data as { analyzedTranscriptCount: number; recordedUniverseCount: number; universeRelationship: string; analyzedShareOfUniversePercent: number; findings: { finding: string; kind: string; matchedTranscriptCount: number; verifiedExcerptCount: number; matchedShareOfAnalyzedPercent: number | null; prevalenceInUniversePercent: number | null; support: { level: string }; findingRefs: string[]; verifiedExcerpts: unknown[] }[]; countingNote: string; discardedExcerpts: number; temporalCoverage: { buckets: number; bucketsCovered: number }; semantic: { telemetry: Record<string, unknown> } }
    expect(data).toMatchObject({ analyzedTranscriptCount: 2, recordedUniverseCount: 30, universeRelationship: "PARTIAL_COVERAGE", analyzedShareOfUniversePercent: 6.7, discardedExcerpts: 1, temporalCoverage: { buckets: 3, bucketsCovered: 2 } })
    // Observação inventada em I2 descartada por código → o finding I2/F1 cai → matched = 1 (limite inferior), participação só na amostra, prevalência = null.
    expect(data.findings[0]).toMatchObject({ kind: "INTERACTION_FRICTION", matchedTranscriptCount: 1, verifiedExcerptCount: 1, matchedShareOfAnalyzedPercent: 50, prevalenceInUniversePercent: null, support: { level: "OBSERVED" }, findingRefs: ["I1/F1"] })
    expect(data.findings[1]).toMatchObject({ kind: "STRENGTH", matchedTranscriptCount: 1, verifiedExcerptCount: 1, support: { level: "OBSERVED" } })
    expect(data.semantic.telemetry).toMatchObject({ semanticFramesCreated: 2, interactionsWithFindings: 2, strengthFindingsCount: 1, riskFindingsCount: 0, interactionFrictionFindingsCount: 1, findingKindDowngraded: 1, observationsDropped: 1, findingsDropped: 1, crossInteractionPatternsCount: 2, phases: "TWO_PHASE", framesRecoveredByRetry: 0, phaseAFindings: 2, phaseBPromotedFindings: 0 })
    expect(data.countingNote).toContain("NÃO representa N de 30")
    expect(JSON.stringify(data)).not.toContain("occurrenceCount")
    expect(JSON.stringify(data)).not.toContain("occurrenceSharePercent")
  })

  it("§10 NO_RELEVANT_PATTERN_FOUND: frames vazios são resposta válida (quality NO_DATA com a nota, findings vazio, nunca padrão forçado); cobertura total permite prevalência", async () => {
    mockTwoPhase([frame("I1"), frame("I2")])
    const empty = await analyzeInteractions(context({ analysisObjective, recordedUniverseCount: 2 }), { interactionIds: [UUID(1), UUID(2)], objective: "condução do atendimento" })
    expect(empty.quality).toMatchObject({ status: "NO_DATA", note: expect.stringContaining("NO_RELEVANT_PATTERN_FOUND") })
    expect((empty.data as { findings: unknown[]; semantic: { telemetry: { framesEmpty: number; semanticFramesCreated: number } } }).findings).toEqual([])
    expect((empty.data as { semantic: { telemetry: { framesEmpty: number; semanticFramesCreated: number } } }).semantic.telemetry).toMatchObject({ semanticFramesCreated: 2, framesEmpty: 2 })
    // Sem finding em nenhum frame, a Fase B nem é chamada (uma request só).
    expect(generateForRoute).toHaveBeenCalledTimes(1)
    mockTwoPhase([
      frame("I1", { agentActions: [{ id: "A1", kind: "OTHER", summary: "confirma presença", evidence: [unit("I1", "T3", "OPERADOR", "Continuo aqui")] }], findings: [{ id: "F1", kind: "CONTEXT", summary: "responde à checagem", observationRefs: ["A1"] }] }),
      frame("I2", { agentStatements: [{ id: "D1", summary: "informa o protocolo", evidence: [unit("I2", "T3", "OPERADOR", "O protocolo deste contato")] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "informa o protocolo", observationRefs: ["D1"] }] }),
    ], { patterns: [{ description: "informa o protocolo / confirma presença", kind: "NEUTRAL", findingRefs: ["I1/F1", "I2/F1"] }] })
    const full = await analyzeInteractions(context({ analysisObjective, recordedUniverseCount: 2 }), { interactionIds: [UUID(1), UUID(2)], objective: "condução do atendimento" })
    expect((full.data as { universeRelationship: string; findings: { prevalenceInUniversePercent: number | null; kind: string }[] })).toMatchObject({ universeRelationship: "FULL_COVERAGE", findings: [{ prevalenceInUniversePercent: 100, kind: "STRENGTH" }] })
  })

  it("sem objetivo derivado (Tool fora do runtime) o prompt cai no pedido simples — sem contexto investigativo", async () => {
    mockTwoPhase([frame("I1"), frame("I2")])
    await analyzeInteractions(context(), { interactionIds: [UUID(1)], objective: "estrutura do atendimento" })
    const request = generateForRoute.mock.calls[0]![0] as { systemPrompt: string }
    expect(request.systemPrompt).toContain("Objetivo da análise: estrutura do atendimento")
    expect(request.systemPrompt).not.toContain("CONTEXTO INVESTIGATIVO")
  })

  it("V1.4.0 §21/§22 frames faltando na Fase A → retry DIRIGIDO só para os handles ausentes (uma vez); o que não voltar vira frame vazio NOT_RETURNED; Fase B recebe só frames compactos", async () => {
    generateForRoute.mockResolvedValueOnce(reply({ frames: [frame("I1", { customerSignals: [{ id: "S1", kind: "OTHER", summary: "pergunta se continua", evidence: [unit("I1", "T2", "CLIENTE", "Alô, você continua aí?")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "pergunta se continua", observationRefs: ["S1"] }] })] }))
    generateForRoute.mockResolvedValueOnce(reply({ frames: [frame("I2")] }))
    generateForRoute.mockResolvedValueOnce(reply({ patterns: [{ description: "pergunta se continua", kind: "RISK", findingRefs: ["I1/F1"] }] }))
    const result = await analyzeInteractions(context({ recordedUniverseCount: 30 }), { interactionIds: [UUID(1), UUID(2)], objective: "x" })
    const retry = generateForRoute.mock.calls[1]![0] as { systemPrompt: string; contents: { text: string }[] }
    expect(retry.systemPrompt).toContain("não trouxe frame para: I2")
    expect(retry.systemPrompt).toContain("As referências válidas nesta análise são SOMENTE: I2")
    expect(retry.contents[0]!.text).toContain("=== I2 ·")
    expect(retry.contents[0]!.text).not.toContain("=== I1 ·")
    const data = result.data as { findings: { finding: string }[]; semantic: { frames: { interactionRef: string; source: string; empty: boolean }[]; telemetry: { framesRecoveredByRetry: number; framesNotReturned: number; phases: string } } }
    expect(data.findings.map((item) => item.finding)).toEqual(["pergunta se continua"])
    expect(data.semantic.frames.map((item) => `${item.interactionRef}:${item.source}:${item.empty}`)).toEqual(["I1:MODEL:false", "I2:MODEL:true"])
    expect(data.semantic.telemetry).toMatchObject({ framesRecoveredByRetry: 1, framesNotReturned: 0, phases: "TWO_PHASE" })
    // V1.4.6.8: completude estrutural medida por código antes e depois do retry (JSON válido ≠ contrato completo).
    expect((data.semantic.telemetry as unknown as { frameContract: unknown }).frameContract).toMatchObject({ retryAttempted: true, initial: { status: "INCOMPLETE", missingInteractionRefs: ["I2"], frameCoveragePercent: 50 }, afterRetry: { status: "COMPLETE", missingFrameCount: 0, emptyInteractionRefs: ["I2"] } })
    // Exemplos do contrato nunca usam um handle real: só o placeholder (os handles reais estão só nas listas dinâmicas).
    expect((generateForRoute.mock.calls[0]![0] as { systemPrompt: string }).systemPrompt).toContain('"interactionRef":"<INTERACTION_REF>"')
    expect((generateForRoute.mock.calls[0]![0] as { systemPrompt: string }).systemPrompt).not.toMatch(/"interactionRef":"I\d+"/)
    expect(generateForRoute).toHaveBeenCalledTimes(3)
    // Retry sem resposta útil: o frame ausente vira NOT_RETURNED vazio (nunca inventado) e a análise segue.
    generateForRoute.mockResolvedValueOnce(reply({ frames: [frame("I1")] }))
    generateForRoute.mockResolvedValueOnce(reply({ frames: [] }))
    const partial = await analyzeInteractions(context({ recordedUniverseCount: 30 }), { interactionIds: [UUID(1), UUID(2)], objective: "x" })
    expect((partial.data as typeof data).semantic.frames.map((item) => `${item.interactionRef}:${item.source}`)).toEqual(["I1:MODEL", "I2:NOT_RETURNED"])
    expect((partial.data as typeof data).semantic.telemetry).toMatchObject({ framesRecoveredByRetry: 0, framesNotReturned: 1 })
    expect(((partial.data as typeof data).semantic.telemetry as unknown as { frameContract: unknown }).frameContract).toMatchObject({ retryAttempted: true, initial: { status: "INCOMPLETE", missingInteractionRefs: ["I2"] }, afterRetry: { status: "INCOMPLETE", missingInteractionRefs: ["I2"] } })
  })
})

describe("analyze_interactions V1.3.3 — Evidence Projection & Literal Integrity (BUG_V2_1)", () => {
  const lot = [
    { id: UUID(1), reason: "contestacao", operator_id: "op", started_at: "2026-06-17T16:45:00Z", content: "[00:00–00:07] OPERADOR: Você está no atendimento Conecta Demo. Qual é a sua dúvida hoje?\n[01:40–02:48] EVENTO: [Intervalo sem fala e sem música; consulta em andamento.]\n[02:48–02:54] CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.\n[02:54–03:02] OPERADOR: Continuo aqui. Desculpe por não ter atualizado você durante a consulta; já retomo a explicação." },
    { id: UUID(2), reason: "esim", operator_id: "op", started_at: "2026-07-01T12:20:00Z", content: "[00:00–00:06] OPERADOR: Olá, meu nome é Mariana Alves, do atendimento Conecta Demo.\n[02:00–02:06] CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.\n[02:06–02:12] OPERADOR: Continuo aqui. Desculpe por não ter atualizado você durante a consulta; já retomo a explicação.\n[03:00–03:05] OPERADOR: O protocolo deste contato é DEMO-202606-M011." },
  ]
  const db = { query: vi.fn(async () => ({ rows: lot, rowCount: 2 })) } as unknown as Database
  const silenceFrame = (ref: string, clientTurn: string, operatorTurn: string) => frame(ref, {
    customerSignals: [{ id: "S1", kind: "CONFIRMATION_REQUEST", summary: "cliente pergunta se a ligação continua", evidence: [unit(ref, clientTurn, "CLIENTE", "Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.")] }],
    agentStatements: [{ id: "D1", summary: "operador admite não ter atualizado", evidence: [unit(ref, operatorTurn, "OPERADOR", "Continuo aqui. Desculpe por não ter atualizado você durante a consulta; já retomo a explicação.")] }],
    findings: [{ id: "F1", kind: "FRICTION", summary: "cliente pergunta se a ligação continua e o operador admite não ter atualizado", observationRefs: ["S1", "D1"] }],
  })

  it("§3/§8 o modelo recebe turnos numerados sem timestamp; sinal do cliente + declaração do operador como DUAS observações do mesmo frame → finding com 2 unidades; pattern em 2 interações conta matched=2 / excerpts=4", async () => {
    mockTwoPhase([silenceFrame("I1", "T3", "T4"), silenceFrame("I2", "T2", "T3")], { patterns: [{ description: "cliente pergunta se a ligação continua e o operador admite não ter atualizado", kind: "RISK", findingRefs: ["I1/F1", "I2/F1"] }] })
    const result = await analyzeInteractions(context({ recordedUniverseCount: 36, temporalBuckets: 3 }, db), { interactionIds: [UUID(1), UUID(2)], objective: "gestão de pausas" })
    const request = generateForRoute.mock.calls[0]![0] as { contents: { text: string }[] }
    expect(request.contents[0]!.text).toContain("[T3] CLIENTE: Alô, você continua aí?")
    expect(request.contents[0]!.text).not.toMatch(/\[\d\d:\d\d[–-]\d\d:\d\d\]/)
    const data = result.data as { findings: { matchedTranscriptCount: number; verifiedExcerptCount: number; evidenceRequirement: string; support: { level: string; bucketsMatched: number }; verifiedExcerpts: { interactionRef: string; turnRef: string; speaker: string | null; excerpt: string; interactionId: string }[] }[]; discardedExcerpts: number; evidenceVerification: Record<string, unknown> }
    expect(data.findings).toHaveLength(1)
    expect(data.findings[0]).toMatchObject({ matchedTranscriptCount: 2, verifiedExcerptCount: 4, evidenceRequirement: "ANY", support: { level: "REPEATED_IN_SAMPLE", bucketsMatched: 2 } })
    expect(data.findings[0]!.verifiedExcerpts.map((item) => `${item.interactionRef}/${item.turnRef}/${item.speaker}`)).toEqual(["I1/T3/CLIENTE", "I1/T4/OPERADOR", "I2/T2/CLIENTE", "I2/T3/OPERADOR"])
    // Auditoria: id real da interação + turno; nunca vai ao modelo (o prompt só tem handles).
    expect(data.findings[0]!.verifiedExcerpts[0]!.interactionId).toBe(UUID(1))
    expect(data.evidenceVerification).toEqual({ candidateExcerptCount: 4, verifiedExcerptCount: 4, rejectedExcerptCount: 0, findingsBeforeVerification: 4, findingsAfterVerification: 4, rejectionReasons: { NOT_LITERAL: 0, WRONG_TURN: 0, WRONG_SPEAKER: 0, WRONG_INTERACTION: 0, REIDENTIFICATION: 0, MISSING_REQUIRED_EVIDENCE: 0 }, turnRefMismatchResolved: 0, ordinalResolvedCount: 0, ordinalResolutionRejectedCount: 0 })
    expect(result.quality.status).toBe("SUFFICIENT")
  })

  it("§17/§13 a concatenação antiga ('CLIENTE: … OPERADOR: …') continua NÃO literal; 3 trechos da mesma interação = matched 1; falante errado = WRONG_SPEAKER; telemetria por motivo", async () => {
    mockTwoPhase([
      frame("I1", { customerSignals: [{ id: "S1", kind: "OTHER", summary: "par concatenado (formato do V2)", evidence: [{ interactionId: "I1", excerpt: "CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído. OPERADOR: Continuo aqui. Desculpe por não ter atualizado você durante a consulta; já retomo a explicação." }] }], findings: [{ id: "F1", kind: "FRICTION", summary: "par concatenado", observationRefs: ["S1"] }] }),
      frame("I2", { agentStatements: [{ id: "D1", summary: "apresentação", evidence: [{ interactionRef: "I2", turnRef: "T1", quote: "meu nome é Mariana Alves" }] }, { id: "D2", summary: "protocolo", evidence: [{ interactionRef: "I2", turnRef: "T4", quote: "O protocolo deste contato é DEMO-202606-M011." }] }, { id: "D3", summary: "falante errado", evidence: [{ interactionRef: "I2", turnRef: "T2", speaker: "OPERADOR", quote: "Alô, você continua aí?" }] }], findings: [{ id: "F1", kind: "CONTEXT", summary: "três trechos de I2", observationRefs: ["D1", "D2", "D3"] }] }),
    ], { patterns: [{ description: "par concatenado (formato do V2)", findingRefs: ["I1/F1"] }, { description: "três trechos de I2", findingRefs: ["I2/F1"] }] })
    const result = await analyzeInteractions(context({ recordedUniverseCount: 36 }, db), { interactionIds: [UUID(1), UUID(2)], objective: "gestão de pausas" })
    const data = result.data as { findings: { finding: string; matchedTranscriptCount: number; verifiedExcerptCount: number }[]; discardedExcerpts: number; evidenceVerification: { rejectionReasons: Record<string, number>; findingsBeforeVerification: number; findingsAfterVerification: number } }
    expect(data.findings.map((item) => item.finding)).toEqual(["três trechos de I2"])
    expect(data.findings[0]).toMatchObject({ matchedTranscriptCount: 1, verifiedExcerptCount: 2 })
    expect(data.discardedExcerpts).toBe(2)
    expect(data.evidenceVerification).toMatchObject({ rejectionReasons: { NOT_LITERAL: 1, WRONG_SPEAKER: 1 } })
    expect(result.quality.note).toContain("2 trecho(s) descartado(s)")
  })
})

describe("analyze_interactions V1.3.4 — posição temporal calculada e comparação entre blocos validada (V1.3.4.1: universo por bloco, ausência estabelecida, aliases fechados)", () => {
  const quarter = [
    { id: UUID(1), reason: "contestacao", operator_id: "op", started_at: "2026-06-17T16:45:00Z", content: "[00:00–00:07] OPERADOR: Olá.\n[02:48–02:54] CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.\n[03:00–03:05] OPERADOR: O protocolo deste contato é DEMO-1." },
    { id: UUID(2), reason: "esim", operator_id: "op", started_at: "2026-07-22T12:20:00Z", content: "[00:00–00:06] OPERADOR: Olá.\n[02:00–02:06] CLIENTE: Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.\n[03:00–03:05] OPERADOR: O protocolo deste contato é DEMO-2." },
    { id: UUID(3), reason: "plano", operator_id: "op", started_at: "2026-08-20T12:20:00Z", content: "[00:00–00:06] OPERADOR: Olá.\n[03:00–03:05] OPERADOR: O protocolo deste contato é DEMO-3." },
  ]
  // Universo registrado por bloco (V1.3.4.1): a consulta `select started_at` devolve 12 interações por mês (parcial) ou só as 3 analisadas (cobertura total).
  const universeRows = (perBucket: number) => ["06", "07", "08"].flatMap((month) => Array.from({ length: perBucket }, (_, index) => ({ started_at: `2026-${month}-${String(2 + index).padStart(2, "0")}T12:00:00Z` })))
  const dbWith = (universePerBucket: number) => ({ query: vi.fn(async (sql: string) => (sql.trim().startsWith("select started_at") ? { rows: universeRows(universePerBucket), rowCount: universePerBucket * 3 } : { rows: quarter, rowCount: 3 })) }) as unknown as Database
  const db = dbWith(12)
  const ctx = (database: Database = db) => context({ recordedUniverseCount: 36, temporalBuckets: 3, samplingStrategy: "TEMPORAL_STRATIFIED" }, database)
  const silence = (ref: string, turn: string) => frame(ref, { customerSignals: [{ id: "S1", kind: "CONFIRMATION_REQUEST", summary: "cliente pergunta se a ligação continua", evidence: [unit(ref, turn, "CLIENTE", "Alô, você continua aí? Ficou sem som por um tempo e pensei que tivesse caído.")] }], findings: [{ id: "F1", kind: "FRICTION", summary: "cliente pergunta se a ligação continua", observationRefs: ["S1"] }] })
  const silencePatterns = { frames: [silence("I1", "T2"), silence("I2", "T2"), frame("I3")], patterns: [{ description: "cliente pergunta se a ligação continua", kind: "RISK", findingRefs: ["I1/F1", "I2/F1"] }] }
  const mockWith = (payload: { frames: unknown[]; patterns: unknown[] }, temporalComparison?: unknown) => mockTwoPhase(payload.frames, { patterns: payload.patterns, ...(temporalComparison !== undefined ? { temporalComparison } : {}) })
  const protocolFrame = (ref: string, turn: string, code: string) => frame(ref, { agentStatements: [{ id: "D1", summary: "informa o protocolo", evidence: [unit(ref, turn, "OPERADOR", `O protocolo deste contato é ${code}.`)] }], findings: [{ id: "F1", kind: "STRENGTH", summary: "informa o protocolo", observationRefs: ["D1"] }] })
  const protocol = { frames: [protocolFrame("I1", "T3", "DEMO-1"), frame("I2"), protocolFrame("I3", "T2", "DEMO-3")], patterns: [{ description: "informa o protocolo", kind: "STRENGTH", findingRefs: ["I1/F1", "I3/F1"] }] }
  type ComparisonData = { temporalComparison: { status: string; comparedBuckets: string[]; analyzedBuckets: string[]; downgradedReason: string | null; findings: { directionSupported: boolean | null; relationValidationStatus: string; relationValidationReason: string | null; evidenceRefs: string[]; shareDeltaPercentagePoints: number | null }[]; countsByFinding: { bucketRef: string; matchedTranscriptCount: number; analyzedTranscriptCount: number; universeCount: number | null; absenceEstablished: boolean; zeroMatchedInSample: boolean }[][]; analyzedByBucket: Record<string, number> } }

  it("§4/§5/§10 o modelo recebe a legenda dos blocos (dias locais inclusivos, sem sobreposição — V1.3.4.1 §17) e '=== I-n · B-n · data local · assunto ===' por interação — sem ISO, sem UUID, sem posição #n (V1.4.0 §26); a instrução pede temporalComparison e diz que ausência na amostra ≠ ausência no bloco", async () => {
    mockTwoPhase([frame("I1"), frame("I2"), frame("I3")])
    await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "evolução da comunicação em pausas" })
    const request = generateForRoute.mock.calls[0]![0] as { systemPrompt: string; contents: { text: string }[] }
    expect(request.contents[0]!.text).toContain("PERÍODOS DA JANELA")
    expect(request.contents[0]!.text).toContain("B1 = 2026-06-01 a 2026-06-30 (início da janela) · B2 = 2026-07-01 a 2026-07-31 (meio da janela) · B3 = 2026-08-01 a 2026-08-31 (fim da janela)")
    expect(request.contents[0]!.text).toContain("=== I1 · B1 · 2026-06-17 · assunto: contestacao ===")
    expect(request.contents[0]!.text).toContain("=== I2 · B2 · 2026-07-22 · assunto: esim ===")
    expect(request.contents[0]!.text).toContain("=== I3 · B3 · 2026-08-20 · assunto: plano ===")
    expect(request.contents[0]!.text).not.toMatch(/T\d\d:\d\d:\d\dZ/)
    expect(request.contents[0]!.text).not.toMatch(/#\d/)
    expect(request.contents[0]!.text).not.toContain("Interação #")
    expect(request.systemPrompt).not.toContain("interactionOrdinal")
    // As instruções temporais (comparação entre blocos) vão para a FASE B (patterns), onde a comparação é declarada.
    expect(request.systemPrompt).not.toContain("AUSÊNCIA NA AMOSTRA ≠ AUSÊNCIA NO BLOCO")
    mockTwoPhase([silence("I1", "T2"), frame("I2"), frame("I3")], { patterns: [] })
    await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "evolução da comunicação em pausas" })
    const phaseB = generateForRoute.mock.calls.at(-1)![0] as { systemPrompt: string; contents: { text: string }[] }
    expect(phaseB.systemPrompt).toContain("temporalComparison")
    expect(phaseB.systemPrompt).toContain("COBERTURA")
    expect(phaseB.systemPrompt).toContain("AUSÊNCIA NA AMOSTRA ≠ AUSÊNCIA NO BLOCO")
    expect(phaseB.contents[0]!.text).toContain("PERÍODOS DA JANELA")
    expect(phaseB.contents[0]!.text).toContain("=== I1 · B1 · 2026-06-17 · assunto: contestacao ===")
  })

  it("§11/§13 (V1.3.4.1 §20/§21) DECREASED B1→B3 com 1/1 → 0/1: universo 12 por bloco → SAMPLE_DIFFERENCE_ONLY (zero na amostra ≠ ausência); cobertura total (universo = analisadas) → SUPPORTED; INCREASED é rebaixado; NO_DIFFERENCE é aceito como está", async () => {
    const declared = { status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "DECREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I3", "I2"] }] }
    mockWith(silencePatterns, declared)
    const partial = (await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "pausas" })).data as ComparisonData
    expect(partial.temporalComparison).toMatchObject({ status: "SAMPLE_DIFFERENCE_ONLY", comparedBuckets: ["B1", "B3"], analyzedBuckets: ["B1", "B2", "B3"] })
    expect(partial.temporalComparison.analyzedByBucket).toEqual({ B1: 1, B2: 1, B3: 1 })
    expect(partial.temporalComparison.findings[0]).toMatchObject({ directionSupported: false, relationValidationStatus: "SAMPLE_DIFFERENCE_ONLY", evidenceRefs: ["I1", "I3"], shareDeltaPercentagePoints: -100 })
    expect(partial.temporalComparison.countsByFinding[0]!.map((count) => `${count.bucketRef}:${count.matchedTranscriptCount}/${count.analyzedTranscriptCount}/${count.universeCount}`)).toEqual(["B1:1/1/12", "B2:1/1/12", "B3:0/1/12"])
    expect(partial.temporalComparison.countsByFinding[0]![2]).toMatchObject({ zeroMatchedInSample: true, absenceEstablished: false })
    expect(partial.temporalComparison.downgradedReason).toContain("zero na amostra não é ausência")
    // Cobertura total: as 3 analisadas SÃO o universo de cada bloco → ausência em B3 estabelecida → DECREASED sustentado.
    mockWith(silencePatterns, declared)
    const full = (await analyzeInteractions(ctx(dbWith(1)), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "pausas" })).data as ComparisonData
    expect(full.temporalComparison).toMatchObject({ status: "DIFFERENCE_OBSERVED", downgradedReason: null })
    expect(full.temporalComparison.findings[0]).toMatchObject({ directionSupported: true, relationValidationStatus: "SUPPORTED" })
    expect(full.temporalComparison.countsByFinding[0]![2]).toMatchObject({ universeCount: 1, absenceEstablished: true })
    mockWith(silencePatterns, { status: "DIFFERENCE_OBSERVED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "INCREASED", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1"] }] })
    const downgraded = await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "pausas" })
    expect((downgraded.data as ComparisonData).temporalComparison).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", downgradedReason: "nenhuma relação declarada é sustentada pelas contagens validadas" })
    mockWith(protocol, { status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B2", "B3"], findings: [] })
    const none = await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "protocolo" })
    expect((none.data as ComparisonData).temporalComparison).toMatchObject({ status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B2", "B3"], downgradedReason: null })
    // Janela curta (1 bloco): sem comparação temporal, sem legenda, sem consulta de universo por bloco.
    mockTwoPhase([frame("I1"), frame("I2"), frame("I3")])
    const shortDb = dbWith(12)
    const short = await analyzeInteractions(context({ recordedUniverseCount: 12, temporalBuckets: 1 }, shortDb), { interactionIds: [UUID(1)], objective: "x" })
    expect((short.data as { temporalComparison: unknown }).temporalComparison).toBeNull()
    expect((generateForRoute.mock.calls.at(-1)![0] as { contents: { text: string }[] }).contents[0]!.text).not.toContain("PERÍODOS DA JANELA")
    expect((shortDb.query as unknown as { mock: { calls: [string][] } }).mock.calls.some(([sql]) => sql.trim().startsWith("select started_at"))).toBe(false)
  })

  it("§19/V1.3.4.2 §2–§7/§36 política de alias: typo real (NO_DEFFERENCE_SUPPORTED) e abreviação do MESMO conceito normalizam; 'STABLE'/'NO_CHANGE'/'CHANGED' no status são RELAÇÃO — status vira INSUFFICIENT_EVIDENCE (não promovido), a relação em findings é validada pela regra específica; desconhecido = INSUFFICIENT; achados nunca são perdidos", async () => {
    mockWith(protocol, { status: "NO_DEFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B3"], findings: [{ relation: "SAME", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3" }, { relation: "STABLE", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I3"] }] })
    const typo = (await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "protocolo" })).data as ComparisonData & { findings: unknown[] }
    expect(typo.findings).toHaveLength(1)
    expect(typo.temporalComparison).toMatchObject({ status: "NO_DIFFERENCE_SUPPORTED", comparedBuckets: ["B1", "B3"], statusNormalization: "ALIAS" })
    expect(typo.temporalComparison.findings).toHaveLength(1)
    expect(typo.temporalComparison.downgradedReason).toBe('status declarado "NO_DEFFERENCE_SUPPORTED" lido como alias lexical de NO_DIFFERENCE_SUPPORTED')
    // §7 fixture V4: status "STABLE" + relação STABLE com relationValidationStatus INSUFFICIENT (B2 sem match) → status NÃO vira NO_DIFFERENCE.
    mockWith(protocol, { status: "stable", comparedBuckets: ["B1", "B3"], findings: [{ relation: "STABLE", subjectFindingIndex: 0, earlierBucket: "B1", laterBucket: "B3", evidenceRefs: ["I1", "I3"] }] })
    const relationAsStatus = (await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "protocolo" })).data as ComparisonData & { findings: unknown[] }
    expect(relationAsStatus.findings).toHaveLength(1)
    expect(relationAsStatus.temporalComparison).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", statusNormalization: "RELATION_AS_STATUS", declaredStatus: "stable" })
    expect(relationAsStatus.temporalComparison.downgradedReason).toContain('status declarado "stable" é uma RELAÇÃO, não um status — não promovido')
    expect(relationAsStatus.temporalComparison.findings[0]).toMatchObject({ relationValidationStatus: "INSUFFICIENT_EVIDENCE" })
    mockWith(protocol, { status: "MOSTLY_SIMILAR", comparedBuckets: ["B1", "B3"], findings: [] })
    const unknown = (await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "protocolo" })).data as ComparisonData & { findings: unknown[] }
    expect(unknown.findings).toHaveLength(1)
    expect(unknown.temporalComparison).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", statusNormalization: "UNKNOWN", downgradedReason: 'status declarado "MOSTLY_SIMILAR" desconhecido — tratado como INSUFFICIENT_EVIDENCE' })
    expect(normalizeTemporalComparisonStatus("NO_DIFFERENCE_SUPPORTED")).toEqual({ status: "NO_DIFFERENCE_SUPPORTED", normalization: "EXACT", declared: "NO_DIFFERENCE_SUPPORTED" })
    expect(normalizeTemporalComparisonStatus("NO_DEFFERENCE_SUPPORTED")).toMatchObject({ status: "NO_DIFFERENCE_SUPPORTED", normalization: "ALIAS" })
    expect(normalizeTemporalComparisonStatus("no difference")).toMatchObject({ status: "NO_DIFFERENCE_SUPPORTED", normalization: "ALIAS" })
    for (const relationWord of ["STABLE", "stable", "NO_CHANGE", "no change", "UNCHANGED", "CHANGED", "CHANGE_OBSERVED"]) expect(normalizeTemporalComparisonStatus(relationWord), relationWord).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", normalization: "RELATION_AS_STATUS" })
    expect(normalizeTemporalComparisonStatus("NO_DIFFERENCE_WHATSOEVER")).toMatchObject({ status: "INSUFFICIENT_EVIDENCE", normalization: "UNKNOWN" })
    expect(Object.keys(TEMPORAL_STATUS_ALIASES).every((alias) => alias === alias.toUpperCase())).toBe(true)
    // Nenhum alias de status é uma palavra de relação (política §3).
    expect(Object.keys(TEMPORAL_STATUS_ALIASES).some((alias) => /STABLE|CHANGE/.test(alias))).toBe(false)
  })

  it("V1.4.0 §26–§29/§59 (era V1.3.4.2 §23/§29) o Model Context mostra SÓ o handle canônico — sem #n; I3 é sempre I3; handle inexistente = WRONG_INTERACTION; ordinal explícito continua resolvendo só pelo resolver interno (nunca sugerido)", async () => {
    mockTwoPhase([
      protocolFrame("I3", "T2", "DEMO-3"),
      protocolFrame("I1", "T3", "DEMO-1"),
      // "I2" citado com o trecho de I3 (posição usada como handle): literal em OUTRA interação → WRONG_INTERACTION, observação cai.
      frame("I2", { agentStatements: [{ id: "D1", summary: "posição usada como handle", evidence: [unit("I2", "T2", "OPERADOR", "O protocolo deste contato é DEMO-3.")] }], findings: [{ id: "F1", kind: "CONTEXT", summary: "sem observação válida", observationRefs: ["D1"] }] }),
      // Handle inexistente na apresentação: frame descartado.
      frame("I9", { agentStatements: [{ id: "D1", summary: "x", evidence: [unit("I9", "T1", "OPERADOR", "Olá.")] }] }),
    ], { patterns: [{ description: "informa o protocolo", kind: "STRENGTH", findingRefs: ["I3/F1", "I1/F1", "I2/F1"] }] })
    const result = await analyzeInteractions(ctx(), { interactionIds: [UUID(1), UUID(2), UUID(3)], objective: "protocolo" })
    const request = generateForRoute.mock.calls[0]![0] as { systemPrompt: string; contents: { text: string }[] }
    expect(request.contents[0]!.text).toContain("=== I1 · B1 · 2026-06-17 · assunto: contestacao ===")
    expect(request.contents[0]!.text).toContain("=== I3 · B3 · 2026-08-20 · assunto: plano ===")
    expect(request.contents[0]!.text).not.toMatch(/#\d/)
    expect(request.systemPrompt).toContain("As referências válidas nesta análise são SOMENTE: I1, I2, I3 — nunca outra, nunca uma posição.")
    expect(request.systemPrompt).not.toContain("interactionOrdinal")
    const data = result.data as { findings: { finding: string; matchedTranscriptCount: number; verifiedExcerpts: { interactionRef: string; referenceResolution?: string }[] }[]; evidenceVerification: { ordinalResolvedCount: number; ordinalResolutionRejectedCount: number; rejectionReasons: Record<string, number> }; semantic: { telemetry: { drops: { frameForUnknownInteraction: number; observationWithoutEvidence: number; findingWithoutObservation: number } } } }
    expect(data.findings).toHaveLength(1)
    expect(data.findings[0]).toMatchObject({ matchedTranscriptCount: 2 })
    expect(data.findings[0]!.verifiedExcerpts.map((item) => `${item.interactionRef}:${item.referenceResolution}`)).toEqual(["I3:HANDLE", "I1:HANDLE"])
    expect(data.evidenceVerification).toMatchObject({ ordinalResolvedCount: 0, ordinalResolutionRejectedCount: 0, rejectionReasons: expect.objectContaining({ WRONG_INTERACTION: 1 }) })
    expect(data.semantic.telemetry.drops).toMatchObject({ frameForUnknownInteraction: 1, observationWithoutEvidence: 1, findingWithoutObservation: 1 })
  })
})

describe("find_interactions V1.3.2 — amostragem pela pergunta e flags compactas", () => {
  const rows = ["06-02", "06-15", "07-05", "07-20", "08-03", "08-25"].map((d, index) => ({ id: UUID(10 + index), started_at: `2026-${d}T12:00:00Z`, ended_at: `2026-${d}T12:05:00Z`, reason: index % 2 ? "plano" : "fatura", canonical_subject: null, channel: "VOICE", duration: "300", flags: [{ name: "rechamada", boolean: false, numeric: null }, { name: "tempo_silencio", boolean: null, numeric: index === 0 ? "61" : "10" }, { name: "cancelamento", boolean: index === 3, numeric: null }], transcript_chars: 500 }))
  const db = { query: vi.fn(async (sql: string) => (sql.trim().startsWith("select count(*)") ? { rows: [{ count: String(rows.length) }], rowCount: 1 } : { rows, rowCount: rows.length })) } as unknown as Database

  it("§22/§23 janela longa com estratégia do runtime TEMPORAL_STRATIFIED: 4 de 6 distribuídas pelos 3 blocos (2/1/1), metadata sem ids, determinística; flags só quando presentes", async () => {
    const result = await findInteractions(context({ samplingStrategy: "TEMPORAL_STRATIFIED" }, db), { limit: 4 })
    const data = result.data as { returned: number; total: number; sampling: { strategy: string; candidateCount: number; selectedCount: number; periodBuckets: { from: string; to: string; candidates: number }[]; selectedPerBucket: number[]; selectionReason: string }; interactions: { localDate: string; flags: { flag: string; value: unknown }[] }[] }
    expect(data.sampling).toMatchObject({ strategy: "TEMPORAL_STRATIFIED", candidateCount: 6, selectedCount: 4, selectedPerBucket: [1, 1, 2] })
    expect(data.sampling.periodBuckets).toHaveLength(3)
    expect(JSON.stringify(data.sampling)).not.toMatch(/de00\d{4}/)
    expect(data.interactions.map((item) => item.localDate)).toEqual(["2026-08-25", "2026-08-03", "2026-07-20", "2026-06-15"])
    // Flags: só presentes (booleana verdadeira / numérica) — "rechamada: false" não entra.
    expect(data.interactions[2]!.flags).toEqual([{ flag: "tempo_silencio", value: 10 }, { flag: "cancelamento", value: true }])
    const again = await findInteractions(context({ samplingStrategy: "TEMPORAL_STRATIFIED" }, db), { limit: 4 })
    expect((again.data as typeof data).interactions.map((item) => item.localDate)).toEqual(data.interactions.map((item) => item.localDate))
    expect(result.provenance.method).toContain("TEMPORAL_STRATIFIED")
  })

  it("RECENT (janela curta ou pedido explícito) devolve só as mais recentes; o modelo pode pedir outra estratégia", async () => {
    const recent = await findInteractions(context({ samplingStrategy: "RECENT" }, db), { limit: 3 })
    expect((recent.data as { interactions: { localDate: string }[] }).interactions.map((item) => item.localDate)).toEqual(["2026-08-25", "2026-08-03", "2026-07-20"])
    const bySubject = await findInteractions(context({ samplingStrategy: "RECENT" }, db), { limit: 2, sampling: "SUBJECT_STRATIFIED" })
    expect((bySubject.data as { sampling: { strategy: string } }).sampling.strategy).toBe("SUBJECT_STRATIFIED")
  })
})

describe("V1.4.8f — sidecar needKind na análise (desligado por padrão, fail-closed)", async () => {
  const { env } = await import("../../../../config/env.js")
  const { NEED_KIND_SYSTEM_PROMPT } = await import("../../domain/need-kind-sidecar.js")
  const needFrame = frame("I1", { customerNeeds: [{ id: "N1", summary: "RESUMO-DO-MODELO", resolutionStatus: "UNRESOLVED", evidence: [unit("I1", "T2", "CLIENTE", "Alô, você continua aí?")], resolutionEvidence: [] }] })
  const mockDiscovery = () => {
    generateForRoute.mockResolvedValueOnce(reply({ frames: [needFrame, frame("I2")] }))
    generateForRoute.mockResolvedValueOnce(reply({ findings: [], patterns: [] }))
    generateForRoute.mockResolvedValueOnce(reply({ needs: [], assertions: [] }))
  }
  type Data = { findings: unknown[]; semantic: { frames: { customerNeeds: { id: string; summary: string; resolutionStatus: string; needKind?: Record<string, unknown> }[]; findings: unknown[] }[]; telemetry: { needKind?: Record<string, unknown> } } }
  const run = async (flag: "ON" | "OFF") => {
    const previous = env.INIA_NEED_KIND_SIDECAR
    env.INIA_NEED_KIND_SIDECAR = flag
    try { const ctx = context(); const result = await analyzeInteractions(ctx, { interactionIds: [UUID(1), UUID(2)], objective: "atendimento" }); return { ctx, data: result.data as Data } } finally { env.INIA_NEED_KIND_SIDECAR = previous }
  }

  it("OFF (padrão): nenhuma chamada extra, necessidade sem anotação, telemetria ausente", async () => {
    expect(env.INIA_NEED_KIND_SIDECAR).toBe("OFF")
    mockDiscovery()
    const { data } = await run("OFF")
    expect(generateForRoute).toHaveBeenCalledTimes(3)
    expect(data.semantic.frames[0]!.customerNeeds[0]!.needKind).toBeUndefined()
    expect(data.semantic.telemetry.needKind).toBeUndefined()
  })

  it("ON: chamada própria (stage:NEED_KIND) DEPOIS da descoberta, só evidência ±1, anotação com provenance; findings idênticos ao OFF", async () => {
    mockDiscovery()
    const off = (await run("OFF")).data
    generateForRoute.mockReset()
    mockDiscovery()
    generateForRoute.mockResolvedValueOnce(reply({ needs: [{ interactionRef: "I1", needRef: "N1", needKind: "INFORMATION", basisTurns: ["T2"] }] }))
    const { ctx, data } = await run("ON")
    expect(generateForRoute).toHaveBeenCalledTimes(4)
    const request = generateForRoute.mock.calls[3]![0] as { systemPrompt: string; contents: { text: string }[]; classification: { tags: string[] } }
    expect(request.systemPrompt).toBe(NEED_KIND_SYSTEM_PROMPT)
    expect(request.classification.tags).toEqual(["stage:NEED_KIND"])
    expect(request.contents[0]!.text).toContain("necessidade: [T2] CLIENTE: Alô, você continua aí?")
    expect(request.contents[0]!.text).not.toMatch(/RESUMO-DO-MODELO|UNRESOLVED/)
    const need = data.semantic.frames[0]!.customerNeeds[0]!
    expect(need).toMatchObject({ summary: "RESUMO-DO-MODELO", resolutionStatus: "UNRESOLVED" })
    expect(need.needKind).toMatchObject({ needKind: "INFORMATION", status: "VALID", source: "SIDECAR_NEED_KIND_V1", model: "m", basisTurns: ["T2"] })
    expect(need.needKind!.requestSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(data.semantic.telemetry.needKind).toMatchObject({ status: "OK", needs: 1, valid: 1, byKind: { INFORMATION: 1 } })
    expect(ctx.telemetry.requests.at(-1)).toMatchObject({ stage: "NEED_KIND" })
    expect(data.findings).toEqual(off.findings)
    expect(data.semantic.frames.map((item) => item.findings)).toEqual(off.semantic.frames.map((item) => item.findings))
  })

  it("ON com erro do provider: investigação segue, necessidade UNKNOWN (PROVIDER_ERROR), nunca INFORMATION", async () => {
    mockDiscovery()
    generateForRoute.mockRejectedValueOnce(new Error("503"))
    const { data } = await run("ON")
    expect(data.semantic.frames[0]!.customerNeeds[0]!.needKind).toMatchObject({ needKind: "UNKNOWN", status: "FALLBACK", fallbackReason: "PROVIDER_ERROR", model: null })
    expect(data.semantic.telemetry.needKind).toMatchObject({ status: "FAILED", parseStatus: "PROVIDER_ERROR" })
  })
})
