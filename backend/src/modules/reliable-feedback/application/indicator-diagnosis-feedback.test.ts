import { describe, expect, it } from "vitest"
import type { RawCheckpoint } from "../../agents/domain/process-assessment-contract.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { buildSegments, INDICATOR_DIAGNOSIS_PLAN_VERSION, type IndicatorDiagnosisPlan } from "../../indicator-diagnosis/domain/indicator-diagnosis.js"
import { practiceKeyOf } from "../../indicator-diagnosis/domain/process-patterns.js"
import type { PeerObservationRow } from "../../indicator-diagnosis/domain/peer-practice-evidence.js"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY } from "../domain/reliable-feedback-item.js"
import { supportMaterialsOf } from "../domain/reliable-feedback-artifact.js"
import type { IndicatorWriterInput, IndicatorWriterItem } from "../domain/reliable-writer.js"
import { emptyStrategyConfig } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { ResolvedStrategy } from "../../indicator-diagnosis/application/diagnostic-strategy-service.js"
import { generateReliableFeedback, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { decideReliableReview } from "./decide-reliable-review.js"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const MEASUREMENT = "33333333-3333-4333-8333-333333333333"
const DOC = "44444444-4444-4444-8444-444444444444"
const TITLE = "Contestação de Contas Móvel"
const RULE = "Antes de abrir a contestação, confirme com o cliente o valor contestado e o mês da fatura."
const presented = [{ documentId: DOC, documentTitle: TITLE, heading: "Abertura", excerpt: RULE }]
const NOT_FOLLOWED = "CLIENTE: Quero contestar a fatura de agosto.\nOPERADOR: Vou abrir a contestação agora mesmo.\nCLIENTE: Tá bom."
const FOLLOWED = "CLIENTE: Quero contestar a fatura de agosto.\nOPERADOR: Antes de abrir, confirmo: o valor contestado é da fatura de agosto?\nCLIENTE: Isso."
const QUOTE_NOT = "Vou abrir a contestação agora mesmo."
const QUOTE_OK = "Antes de abrir, confirmo: o valor contestado é da fatura de agosto?"
const HANDLES = ["I1", "I2", "I3", "I4", "I5"]
/** Estratégia publicada (V1.6.2) com tudo ligado nos pisos do produto — o que os cenários da V1.6.1 assumiam. */
const STRATEGY: ResolvedStrategy = {
  id: "77777777-7777-4777-8777-777777777777",
  version: 1,
  config: { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, peerComparison: { enabled: true, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 } },
}
const idOf = (handle: string) => `5555555${handle.slice(1)}-5555-4555-8555-555555555555`

const canonical = (value: number): IndicatorCanonicalContext => ({ contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT, indicator: { id: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" }, measurement: { id: MEASUREMENT, subjectId: OPERATOR, value, periodStart: "2026-09-01", periodEnd: "2026-09-30", granularity: "MONTHLY" }, target: { value: 660, source: "TEAM", goalId: "g" }, ...canonicalComparison(value, 660, "LOWER"), provenance: { source: "indicator_measurements+goals", loadedAt: "x" } })
const plan = (overrides: Partial<IndicatorDiagnosisPlan> = {}): IndicatorDiagnosisPlan => ({
  contract: INDICATOR_DIAGNOSIS_PLAN_VERSION, measurementId: MEASUREMENT, collaboratorId: OPERATOR, indicator: { code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" },
  period: { start: "2026-09-01T03:00:00.000Z", end: "2026-10-01T03:00:00.000Z", label: "01/09/2026 a 30/09/2026" }, dimension: "SUBJECT", metric: "INTERACTION_DURATION_SECONDS", interactionsInPeriod: 30, overallAverageDurationSeconds: 689,
  segments: buildSegments([{ key: "segunda_via", label: "Segunda via", canonical: true, interactions: 22, withTranscript: 20, averageDurationSeconds: 560 }, { key: "contestacao", label: "Contestação", canonical: true, interactions: 8, withTranscript: 8, averageDurationSeconds: 1050 }]),
  selectedSegment: { key: "contestacao", label: "Contestação", reason: "maior tempo registrado acima da média geral do período, ponderado pelo volume de atendimentos" },
  sample: HANDLES.map((handle) => ({ handle, interactionId: idOf(handle), startedAt: "2026-09-10T12:00:00.000Z", localDate: "2026-09-10" })), sampling: null, status: "READY_FOR_ASSESSMENT", strategy: { versionId: STRATEGY.id, version: 1 }, ...overrides,
})
const checkpoint = (status: "FOLLOWED" | "NOT_FOLLOWED", overrides: Partial<RawCheckpoint> = {}): RawCheckpoint => ({ requirement: "Confirmar valor e mês antes de abrir a contestação", evidenceType: "OBSERVED", knowledgeDetailQuote: null, status, transcriptEvidence: [status === "FOLLOWED" ? QUOTE_OK : QUOTE_NOT], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: "Confirme o valor e o mês antes de abrir." }, uncertainty: null, ...overrides })
type Scenario = Record<string, "FOLLOWED" | "NOT_FOLLOWED" | "NONE">
const sourceOutput = (scenario: Scenario, overrides: Partial<RawCheckpoint> = {}, sampleIds: Record<string, string> = {}, summary = "Seu TMA ficou fora da meta.") => ({
  kind: "indicator",
  input: { organizationId: ORG, operatorId: OPERATOR, contextSnapshot: { indicatorMeasurementId: MEASUREMENT }, structured: { title: "t", summary, relatedProcedure: "p", recommendation: "Revise as pausas." } },
  knowledgeExcerpts: presented,
  diagnosis: {
    measurementId: MEASUREMENT,
    strategyVersionId: STRATEGY.id,
    sample: HANDLES.map((handle) => ({ handle, interactionId: sampleIds[handle] ?? idOf(handle) })),
    interactionAssessments: Object.entries(scenario).map(([handle, status]) => ({ interactionRef: handle, processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: status === "NONE" ? [] : [checkpoint(status, overrides)] }] } })),
  },
})
const request = (sourceNodeOutput: unknown, enrollmentId = "enr-1"): ReliableGenerationRequest => ({ organizationId: ORG, enrollmentId, workflowId: "wf", workflowVersionId: "v1", nodeId: "feedback", sourceNodeId: "agent", sourceType: "AGENT", domain: "INDICATOR", sourceNodeOutput, collaboratorId: OPERATOR, interactionId: null, indicatorMeasurementId: MEASUREMENT, configuredAgentId: "a" })

type Wording = { observed: string; whyItMatters: string; whatYouCanDo: string }
const FACT: Wording = { observed: "No período de 01/09/2026 a 30/09/2026, seu TMA foi 689 s, fora da meta de 660 s.", whyItMatters: "", whatYouCanDo: "" }
const GROUNDED_DEV: Wording = { observed: "Em 3 de 5 atendimentos analisados de Contestação, a confirmação do valor e do mês antes de abrir a contestação não foi identificada.", whyItMatters: `O documento “${TITLE}” orienta: “${RULE}”`, whatYouCanDo: "Nos próximos atendimentos de Contestação, confirme o valor contestado e o mês da fatura antes de abrir a contestação." }

function setup(options: { strategy?: ResolvedStrategy | null; value?: number; plan?: IndicatorDiagnosisPlan | null; transcripts?: Scenario; peers?: { peers: { personId: string; value: number }[]; observations: PeerObservationRow[] }; pattern?: (item: IndicatorWriterItem) => Wording; fact?: Wording } = {}) {
  const store = createInMemoryReliableFeedbackStore()
  const inputs: IndicatorWriterInput[] = []
  const transcripts = options.transcripts ?? {}
  const deps: ReliableGenerationDeps = {
    enabled: true,
    store,
    policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY,
    now: () => new Date("2026-10-02T12:00:00Z"),
    writer: {
      writeMonitoring: async () => { throw new Error("não usado") },
      writeIndicator: async (input) => {
        inputs.push(input)
        return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, ...(item.diagnosis ? (options.pattern ?? (() => GROUNDED_DEV))(item) : options.fact ?? FACT) })) } }
      },
    },
    loadMonitoringContext: async (organizationId, interactionId, collaboratorId) => {
      const handle = HANDLES.find((entry) => idOf(entry) === interactionId)
      if (organizationId !== ORG || collaboratorId !== OPERATOR || !handle) return null
      return { transcript: transcripts[handle] === "FOLLOWED" ? FOLLOWED : NOT_FOLLOWED, label: `Atendimento de 1${handle.slice(1)}/09/2026`, otherOperatorNames: [] }
    },
    loadIndicatorContext: async () => canonical(options.value ?? 689),
    loadPublishedKnowledge: async (organizationId, ids) => new Map(organizationId === ORG && ids.includes(DOC) ? [[DOC, { documentId: DOC, title: TITLE, content: `## Abertura\n${RULE}`, version: 2 }]] : []),
    loadIndicatorDiagnosisPlan: async () => (options.plan === undefined ? plan() : options.plan),
    loadPeerPracticeData: async () => options.peers ?? { peers: [], observations: [] },
    resolveDiagnosticStrategy: async () => options.strategy === undefined ? STRATEGY : options.strategy,
  }
  return { deps, store, inputs }
}
const THREE_OF_FIVE: Scenario = { I1: "NOT_FOLLOWED", I2: "NOT_FOLLOWED", I3: "NOT_FOLLOWED", I4: "FOLLOWED", I5: "FOLLOWED" }

describe("V1.6.1 — feedback de indicador a partir do DIAGNÓSTICO (fato → onde → chamadas → processo → base → pares)", () => {
  it("B + I) TMA fora da meta + motivo investigado + etapa não seguida + base verificada → ponto de desenvolvimento com orientação, material e limitações", async () => {
    const { deps, inputs, store } = setup({ transcripts: THREE_OF_FIVE })
    const result = await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))
    expect(result.nodeOutput.disposition).toBe("READY")
    expect(result.nodeOutput.items.map((item) => item.sectionLabel)).toEqual(["Ponto de desenvolvimento", "Ponto de desenvolvimento"])
    const pattern = result.record.artifact!.items[1]!
    expect(pattern).toMatchObject({ kind: "INDICATOR_DEVELOPMENT_PATTERN", grounding: "OFFICIAL_PROCEDURE", knowledge: { documentId: DOC, applicability: "VERIFIED", href: `/materiais/${DOC}` }, decision: { disposition: "READY", reasons: ["AUTONOMY_CRITERIA_MET"] } })
    expect(pattern.facts.map((fact) => fact.role)).toEqual(["ANALISE", "ANALISE", "OPERADOR", "OPERADOR"])
    expect(pattern.facts[1]!.text).toBe("Etapa “Confirmar valor e mês antes de abrir a contestação”: não foi identificada em 3 de 5 atendimentos analisados de Contestação.")
    // O redator recebe só fatos/verificações estruturadas — nenhuma transcrição inteira, nenhum id.
    const writerItem = inputs[0]!.items[1]!
    expect(writerItem.diagnosis).toMatchObject({ requirement: "Confirmar valor e mês antes de abrir a contestação", knowledge: { documentTitle: TITLE, quote: RULE }, peer: null })
    expect(JSON.stringify(inputs[0])).not.toContain("CLIENTE: Quero contestar")
    expect(JSON.stringify(inputs[0])).not.toContain(idOf("I1"))
    expect(result.nodeOutput.items[1]!.wording.whatYouCanDo).toBe(GROUNDED_DEV.whatYouCanDo)
    // I) material de apoio = documento REAL da regra.
    expect(supportMaterialsOf(result.nodeOutput.items)).toEqual([{ materialId: DOC, title: TITLE, reason: "Utilizado em: Abertura" }]) // V1.7.1e — o ASSUNTO (seção), não o texto cru da regra
    expect(result.nodeOutput.text).toContain(`**Material de apoio:** ${TITLE}`)
    expect(result.nodeOutput.text).toContain("**Limitações da análise:**")
    expect(result.nodeOutput.limitations).toContain("Uma etapa observada nos atendimentos analisados não demonstra que ela causou o resultado do indicador.")
    expect(result.record.artifact!.indicatorDiagnosis).toMatchObject({ status: "DEVELOPMENT_SUPPORTED", segmentation: { selected: { key: "contestacao" } }, patterns: [{ notFollowed: 3, followed: 2, analyzed: 5 }] })
    // Observações verificadas (base dos pares) gravadas junto do artefato.
    expect(store.observations.map((entry) => entry.status).sort()).toEqual(["FOLLOWED", "FOLLOWED", "NOT_FOLLOWED", "NOT_FOLLOWED", "NOT_FOLLOWED"])
  })

  it("C + J) mesmo caso SEM regra da base → padrão exibido sem 'o que fazer'; orientação escrita sem fonte cai no fallback e nunca é READY", async () => {
    const { deps } = setup({ transcripts: THREE_OF_FIVE })
    const result = await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE, { knowledgeQuote: null })))
    const pattern = result.record.artifact!.items[1]!
    expect(pattern).toMatchObject({ kind: "INDICATOR_DEVELOPMENT_PATTERN", knowledge: null, grounding: "NO_GROUNDED_GUIDANCE", wordingSource: "FALLBACK" })
    expect(pattern.writerViolations).toEqual(expect.arrayContaining(["UNGROUNDED_GUIDANCE", "UNGROUNDED_RELEVANCE"]))
    expect(pattern.proposedWording).toEqual({ observed: "Etapa “Confirmar valor e mês antes de abrir a contestação”: não foi identificada em 3 de 5 atendimentos analisados de Contestação.", whyItMatters: "", whatYouCanDo: "" })
    expect(pattern.decision.disposition).toBe("HOLD_FOR_QA")
    expect(pattern.decision.reasons).toEqual(expect.arrayContaining(["PROCESS_RULE_UNVERIFIED", "WRITER_FALLBACK_USED"]))
    expect(result.nodeOutput.disposition).toBe("HOLD_FOR_QA")
  })

  it("D + K) indicador DENTRO da meta + etapa seguida de forma consistente → reconhecimento proporcional (sem elogio vazio)", async () => {
    const all: Scenario = { I1: "FOLLOWED", I2: "FOLLOWED", I3: "FOLLOWED", I4: "FOLLOWED", I5: "NONE" }
    const { deps } = setup({ value: 640, transcripts: all, fact: { observed: "No período de 01/09/2026 a 30/09/2026, seu TMA foi 640 s, dentro da meta de 660 s.", whyItMatters: "", whatYouCanDo: "" }, pattern: () => ({ observed: "Em 4 de 5 atendimentos analisados de Contestação, você confirmou o valor e o mês antes de abrir a contestação.", whyItMatters: `O documento “${TITLE}” orienta: “${RULE}”`, whatYouCanDo: "" }) })
    const result = await generateReliableFeedback(deps, request(sourceOutput(all, {}, {}, "Seu TMA ficou dentro da meta.")))
    expect(result.nodeOutput.disposition).toBe("READY")
    expect(result.record.artifact!.items.map((item) => [item.kind, item.section, item.decision.disposition])).toEqual([["INDICATOR_TARGET_MET", "STRENGTH", "READY"], ["INDICATOR_STRENGTH_PATTERN", "STRENGTH", "READY"]])
    expect(result.nodeOutput.items.map((item) => item.sectionLabel)).toEqual(["Ponto forte", "Ponto forte"])
    expect(result.record.artifact!.indicatorDiagnosis!.status).toBe("STRENGTH_ONLY")
    expect(result.nodeOutput.text).not.toContain("Não houve evidência suficiente")
  })

  it("A) fora da meta sem padrão → NO_ACTIONABLE_DIAGNOSIS: só o fato, limitação factual, nenhuma orientação", async () => {
    const none: Scenario = { I1: "NOT_FOLLOWED", I2: "FOLLOWED", I3: "NONE", I4: "NONE", I5: "NONE" }
    const { deps, inputs } = setup({ transcripts: none })
    const result = await generateReliableFeedback(deps, request(sourceOutput(none)))
    expect(result.record.artifact!.items.map((item) => item.kind)).toEqual(["INDICATOR_TARGET_NOT_MET"])
    expect(result.record.artifact!.indicatorDiagnosis).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", reason: "NO_CONSISTENT_PATTERN" })
    expect(inputs[0]!.items).toHaveLength(1)
    expect(result.nodeOutput.items[0]!.wording).toEqual(FACT)
    expect(result.nodeOutput.text).toContain("Não houve evidência suficiente para uma orientação específica: nenhuma etapa do processo apareceu de forma consistente na amostra analisada.")
  })

  it("indicador não decomponível ou amostra do nó que não bate com a do sistema → nada inventado (atendimentos descartados com o motivo)", async () => {
    const notDecomposable = setup({ plan: plan({ status: "NOT_DECOMPOSABLE", selectedSegment: null, sample: [] }) })
    const factual = await generateReliableFeedback(notDecomposable.deps, request(sourceOutput(THREE_OF_FIVE)))
    expect(factual.record.artifact!.indicatorDiagnosis).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", reason: "NOT_DECOMPOSABLE" })
    expect(factual.record.artifact!.items).toHaveLength(1)

    const changed = setup({ transcripts: THREE_OF_FIVE })
    const result = await generateReliableFeedback(changed.deps, request(sourceOutput(THREE_OF_FIVE, {}, { I1: "66666666-6666-4666-8666-666666666666" })))
    expect(result.record.artifact!.indicatorDiagnosis!.discarded).toEqual([{ handle: "I1", reason: "PLAN_CHANGED" }])
    // Sobram 2 de 4 não seguidas e 2 seguidas: 2 ≥ 2 ainda é padrão — mas a contagem é da amostra VERIFICADA (4), nunca da declarada.
    expect(result.record.artifact!.indicatorDiagnosis!.patterns[0]).toMatchObject({ analyzed: 4, notFollowed: 2, followed: 2 })
  })

  it("F) pares comparáveis → agregado no item (REFERENCIA) e o redator pode citar os números dele", async () => {
    const key = practiceKeyOf({ requirement: "x", knowledge: { documentId: DOC, documentTitle: TITLE, heading: null, version: 2, quote: RULE, literalInPublished: true, presentedInRun: true, anchorTerms: [], applicability: "VERIFIED", applicabilityBasis: "LEXICAL_ANCHOR", leadIn: null, failure: null, contentSha256: null } })
    const peers = Array.from({ length: 16 }, (_, index) => ({ personId: `p${String(index).padStart(2, "0")}`, value: 500 + index * 10 }))
    const observations: PeerObservationRow[] = ["p00", "p01", "p02", "p03"].flatMap((personId) => [1, 2].map((n) => ({ personId, interactionId: `${personId}-${n}`, practiceKey: key, status: "FOLLOWED" as const, segmentKey: "contestacao" })))
    const { deps, inputs } = setup({ transcripts: THREE_OF_FIVE, peers: { peers, observations }, pattern: () => ({ ...GROUNDED_DEV, observed: `${GROUNDED_DEV.observed} No grupo de referência, a etapa foi identificada em 8 de 8 atendimentos analisados.` }) })
    const result = await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))
    const pattern = result.record.artifact!.items[1]!
    expect(pattern.facts.find((fact) => fact.role === "REFERENCIA")!.text).toContain("a etapa foi identificada em 8 de 8 atendimentos analisados de Contestação; na sua amostra, em 2 de 5")
    expect(inputs[0]!.items[1]!.diagnosis!.peer).toContain("quartil de melhor resultado oficial do indicador no mesmo Grupo e no mesmo período (4 de 16 pessoas)")
    expect(pattern).toMatchObject({ wordingSource: "WRITER", writerViolations: [] })
    expect(result.record.artifact!.indicatorDiagnosis!.patterns[0]!.peer).toMatchObject({ status: "AVAILABLE", comparison: "HIGHER_IN_REFERENCE", privacySatisfied: true, causalClaimAllowed: false })
    expect(JSON.stringify(result.record.artifact)).not.toMatch(/p0[0-3]/)
  })

  it("G) redator afirma CAUSA entre comportamento e indicador → validador rejeita → fallback → não READY", async () => {
    const { deps } = setup({ transcripts: THREE_OF_FIVE, pattern: () => ({ ...GROUNDED_DEV, observed: "Seu TMA ficou fora da meta porque, em 3 de 5 atendimentos analisados de Contestação, você não confirmou o valor antes de abrir a contestação." }) })
    const result = await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))
    const pattern = result.record.artifact!.items[1]!
    expect(pattern.writerViolations).toContain("CAUSAL_CLAIM")
    expect(pattern.wordingSource).toBe("FALLBACK")
    expect(pattern.decision.disposition).toBe("HOLD_FOR_QA")
    const reduce = setup({ transcripts: THREE_OF_FIVE, pattern: () => ({ ...GROUNDED_DEV, whatYouCanDo: "Confirme o valor antes de abrir a contestação para reduzir o seu TMA." }) })
    // V1.7.1i — a causa só no "Como aplicar" (campo complementar) sai SÓ com o campo; ela nunca chega ao colaborador.
    const reduced = (await generateReliableFeedback(reduce.deps, request(sourceOutput(THREE_OF_FIVE)))).record.artifact!.items[1]!
    expect(reduced.writerFieldValidation).toEqual(expect.arrayContaining([expect.objectContaining({ field: "whatYouCanDo", codes: ["CAUSAL_CLAIM"] })]))
    expect(reduced.proposedWording!.whatYouCanDo).not.toMatch(/reduzir o seu TMA/)
  })

  it("H) redator inventa benchmark (número/grupo de referência sem evidência) ou rotula o motivo → rejeitado", async () => {
    const { deps } = setup({ transcripts: THREE_OF_FIVE, pattern: () => ({ ...GROUNDED_DEV, observed: `${GROUNDED_DEV.observed} No grupo de referência, essa etapa aparece em 18 de 22 atendimentos.` }) })
    const pattern = (await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))).record.artifact!.items[1]!
    expect(pattern.writerViolations).toEqual(expect.arrayContaining(["PEER_CLAIM_WITHOUT_EVIDENCE", "UNSUPPORTED_NUMBER"]))
    const label = setup({ transcripts: THREE_OF_FIVE, pattern: () => ({ ...GROUNDED_DEV, observed: `Contestação é um motivo complexo. ${GROUNDED_DEV.observed}` }) })
    expect((await generateReliableFeedback(label.deps, request(sourceOutput(THREE_OF_FIVE)))).record.artifact!.items[1]!.writerViolations).toContain("UNSUPPORTED_SEGMENT_LABEL")
  })

  it("QA: a edição humana também não pode criar causa, pares sem evidência ou orientação sem fonte", async () => {
    const { deps, store } = setup({ transcripts: THREE_OF_FIVE, pattern: () => ({ ...GROUNDED_DEV, observed: "Seu TMA ficou alto porque você não confirmou o valor." }) })
    await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))
    const review = store.reviews.find((entry) => entry.itemKind === "INDICATOR_DEVELOPMENT_PATTERN")!
    expect(review.reviewItem).toMatchObject({ domain: "INDICATOR", knowledge: { documentId: DOC } })
    // O revisor vê o fato, a análise da amostra (motivo + contagem), as falas verificadas e a regra da base com o link.
    const detail = toReliableReviewDetail(review, { collaborator: { id: OPERATOR, name: "Operador", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-10-02T12:00:00Z"), reviewerName: null, selection: { decision: { disposition: "HOLD_FOR_QA", structural: "STRUCTURALLY_EMITTABLE", reasons: [], policyVersion: "P", autonomyEligible: false }, deliveredAt: null } as never })
    expect(detail.evidence.map((entry) => entry.speakerLabel)).toEqual(["Dado oficial", "Dado oficial", "Análise da amostra", "Análise da amostra", "Operador", "Operador"])
    expect(detail).toMatchObject({ processBasis: { documentTitle: TITLE, statusLabel: "Não seguido", href: `/materiais/${DOC}`, applicability: "VERIFIED" }, uncertainty: expect.stringContaining("associação com o indicador não é causa") })
    const decide = (observed: string) => decideReliableReview({ store, now: deps.now }, { organizationId: ORG, reviewId: review.id, reviewerId: "qa", decision: "APPROVED_EDITED", finalWording: { observed, whyItMatters: "", whatYouCanDo: "" }, reasonCategory: "FACTUAL_OVERCLAIM" })
    expect(await decide("Isso explica o seu resultado no indicador.")).toMatchObject({ ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: expect.arrayContaining(["CAUSAL_CLAIM"]) })
    expect(await decide("Seus colegas com melhores resultados fazem diferente.")).toMatchObject({ ok: false, violations: expect.arrayContaining(["PEER_CLAIM_WITHOUT_EVIDENCE"]) })
    expect(await decide("Em 3 de 5 atendimentos analisados de Contestação, a confirmação do valor não foi identificada.")).toMatchObject({ ok: true })
  })
})

describe("V1.6.2 — a ESTRATÉGIA do indicador parametriza o runtime (mesmo motor, nenhum contrato paralelo)", () => {
  const withConfig = (config: Partial<ResolvedStrategy["config"]>): ResolvedStrategy => ({ ...STRATEGY, config: { ...STRATEGY.config, ...config } })
  const NONE: Scenario = { I1: "NOT_FOLLOWED", I2: "FOLLOWED", I3: "NONE", I4: "NONE", I5: "NONE" }

  it("I) sem diagnóstico acionável + 'Encaminhar para QA' → o feedback factual fica retido no QA (nunca sugestão genérica)", async () => {
    const { deps, store } = setup({ transcripts: NONE, strategy: withConfig({ noDiagnosisBehavior: "HOLD_FOR_QA" }) })
    const result = await generateReliableFeedback(deps, request(sourceOutput(NONE)))
    expect(result.record.artifact!.indicatorDiagnosis).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", reason: "NO_CONSISTENT_PATTERN" })
    expect(result.record.artifact!.items.map((item) => [item.kind, item.decision.disposition])).toEqual([["INDICATOR_TARGET_NOT_MET", "HOLD_FOR_QA"]])
    expect(result.record.artifact!.items[0]!.decision.reasons).toContain("NO_DIAGNOSIS_HOLD_FOR_QA")
    expect(result.record.artifact!.items[0]!.proposedWording!.whatYouCanDo).toBe("")
    expect(store.reviews).toHaveLength(1)
    expect(result.nodeOutput.disposition).toBe("HOLD_FOR_QA")
  })
  it("I) sem diagnóstico acionável + 'Não gerar feedback' → nada emitido, redator nem é chamado; o diagnóstico fica na auditoria", async () => {
    const { deps, inputs } = setup({ transcripts: NONE, strategy: withConfig({ noDiagnosisBehavior: "NO_FEEDBACK" }) })
    const result = await generateReliableFeedback(deps, request(sourceOutput(NONE)))
    expect(result.nodeOutput).toMatchObject({ disposition: "BLOCKED", reasons: ["NO_ACTIONABLE_DIAGNOSIS_NO_FEEDBACK"], items: [] })
    expect(inputs).toHaveLength(0)
    expect(result.record.artifact!.indicatorDiagnosis).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", strategy: { versionId: STRATEGY.id, version: 1 } })
  })
  it("com diagnóstico acionável, a política de 'sem diagnóstico' não interfere", async () => {
    const { deps } = setup({ transcripts: THREE_OF_FIVE, strategy: withConfig({ noDiagnosisBehavior: "NO_FEEDBACK" }) })
    expect((await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))).nodeOutput.disposition).toBe("READY")
  })
  it("F) versão da estratégia do nó de origem ≠ versão presa na execução → nada do diagnóstico é aceito (STRATEGY_MISMATCH)", async () => {
    const { deps } = setup({ transcripts: THREE_OF_FIVE, strategy: { ...STRATEGY, id: "88888888-8888-4888-8888-888888888888", version: 2 } })
    const result = await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))
    expect(result.record.artifact!.indicatorDiagnosis).toMatchObject({ status: "NO_ACTIONABLE_DIAGNOSIS", reason: "STRATEGY_MISMATCH" })
    expect(result.record.artifact!.items.map((item) => item.kind)).toEqual(["INDICATOR_TARGET_NOT_MET"])
  })
  it("amostra mínima da versão (acima do piso) e cobertura mínima valem no resultado", async () => {
    const sample = setup({ transcripts: THREE_OF_FIVE, strategy: withConfig({ interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 6, minimumCoveragePercent: null } }) })
    expect((await generateReliableFeedback(sample.deps, request(sourceOutput(THREE_OF_FIVE)))).record.artifact!.indicatorDiagnosis).toMatchObject({ reason: "INSUFFICIENT_SAMPLE" })
    // 5 analisados de 8 atendimentos do motivo = 62,5 % < 70 %.
    const coverage = setup({ transcripts: THREE_OF_FIVE, strategy: withConfig({ interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: 70 } }) })
    expect((await generateReliableFeedback(coverage.deps, request(sourceOutput(THREE_OF_FIVE)))).record.artifact!.indicatorDiagnosis).toMatchObject({ reason: "INSUFFICIENT_COVERAGE" })
  })
  it("H) comparação com pares desligada ou com mínimo acima do disponível → sem agregado (e sem prometer comparação)", async () => {
    const key = practiceKeyOf({ requirement: "x", knowledge: { documentId: DOC, documentTitle: TITLE, heading: null, version: 2, quote: RULE, literalInPublished: true, presentedInRun: true, anchorTerms: [], applicability: "VERIFIED", applicabilityBasis: "LEXICAL_ANCHOR", leadIn: null, failure: null, contentSha256: null } })
    const peers = { peers: Array.from({ length: 16 }, (_, index) => ({ personId: `p${String(index).padStart(2, "0")}`, value: 500 + index * 10 })), observations: ["p00", "p01", "p02", "p03"].flatMap((personId) => [1, 2].map((n) => ({ personId, interactionId: `${personId}-${n}`, practiceKey: key, status: "FOLLOWED" as const, segmentKey: "contestacao" }))) }
    const off = setup({ transcripts: THREE_OF_FIVE, peers, strategy: withConfig({ peerComparison: { ...STRATEGY.config.peerComparison, enabled: false } }) })
    const withoutPeers = await generateReliableFeedback(off.deps, request(sourceOutput(THREE_OF_FIVE)))
    expect(withoutPeers.record.artifact!.items[1]!.facts.some((fact) => fact.role === "REFERENCIA")).toBe(false)
    expect(withoutPeers.nodeOutput.limitations.some((line) => line.includes("grupo de referência"))).toBe(false)
    const strict = setup({ transcripts: THREE_OF_FIVE, peers, strategy: withConfig({ peerComparison: { enabled: true, minimumPopulation: 4, minimumContributors: 5, minimumObservedInteractions: 5 } }) })
    const tooFew = await generateReliableFeedback(strict.deps, request(sourceOutput(THREE_OF_FIVE)))
    expect(tooFew.record.artifact!.indicatorDiagnosis!.patterns[0]!.peer).toMatchObject({ status: "NO_PEER_EVIDENCE", reason: "CONTRIBUTORS_BELOW_MINIMUM" })
  })
  it("fato do resultado leva ONDE o resultado se concentra (fato do sistema), inclusive sem padrão", async () => {
    const { deps } = setup({ transcripts: NONE })
    const result = await generateReliableFeedback(deps, request(sourceOutput(NONE)))
    expect(result.record.artifact!.items[0]!.facts.find((fact) => fact.topic === "SEGMENT")!.text).toMatch(/^Motivo investigado: Contestação — 8 de 30 atendimentos do período/)
  })
})

describe("V1.7.1b — exemplo de condução e apresentação pessoal no feedback de indicador (§27, §25-F)", () => {
  const EXAMPLE = "Antes de abrir a contestação, vou confirmar com o senhor o valor contestado e o mês da fatura."

  it("A/F) padrão de desenvolvimento com base → exemplo de condução; o feedback abre com o nome do cadastro e fala do resultado oficial", async () => {
    const { deps, inputs } = setup({ transcripts: THREE_OF_FIVE, pattern: () => ({ ...GROUNDED_DEV, suggestedResponse: EXAMPLE }) as Wording })
    const result = await generateReliableFeedback({ ...deps, loadRecipient: async () => ({ firstName: "Rafael" }) }, request(sourceOutput(THREE_OF_FIVE)))
    // O escopo vem do código: só o padrão de desenvolvimento com etapa, regra verificada e orientação oficial admite exemplo.
    expect(inputs[0]!.items.map((item) => item.suggestedResponse?.allowed ?? false)).toEqual([false, true])
    const pattern = result.record.artifact!.items[1]!
    expect(pattern).toMatchObject({ kind: "INDICATOR_DEVELOPMENT_PATTERN", wordingSource: "WRITER", proposedWording: { suggestedResponse: EXAMPLE }, decision: { disposition: "READY" } })
    const text = result.nodeOutput.text
    expect(text).toContain("Olá, Rafael!")
    expect(text).toContain("Analisei seu resultado oficial de TMA no período de 01/09/2026 a 30/09/2026.")
    expect(text).toContain(`_“${EXAMPLE}”_`)
    expect(result.nodeOutput.presentation!.closing).toContain("o resultado oficial ficou fora da meta")
    expect(result.nodeOutput.presentation!.closing).toContain("não indica, sozinho, a causa do resultado")
    expect(JSON.stringify(inputs[0])).not.toContain("Rafael")
  })

  it("B) KPI fora da meta SEM achado de processo → sem exemplo: o redator tenta no fato oficial → recusado", async () => {
    const { deps } = setup({ transcripts: THREE_OF_FIVE, fact: { ...FACT, suggestedResponse: "Vou reduzir o tempo das minhas ligações." } as Wording })
    const result = await generateReliableFeedback(deps, request(sourceOutput(THREE_OF_FIVE)))
    const fact = result.record.artifact!.items[0]!
    // V1.7.1h — só o exemplo sai; o texto do fato oficial (válido) fica.
    expect(fact).toMatchObject({ kind: "INDICATOR_TARGET_NOT_MET", wordingSource: "WRITER", writerFieldValidation: expect.arrayContaining([{ field: "suggestedResponse", codes: ["SUGGESTED_RESPONSE_NOT_ALLOWED"], action: "DROPPED" }]) })
    expect(fact.proposedWording!.suggestedResponse ?? "").toBe("")
  })

  it("C) produto ambíguo nos atendimentos da amostra → ponto 'Vale confirmar' com exemplo de DESAMBIGUAÇÃO (sem regra de nenhum produto)", async () => {
    const FIXO = { id: "66666666-6666-4666-8666-666666666666", title: "Contestação de Contas Fixo", rule: "Antes de abrir a contestação do fixo, confirme o número da linha fixa." }
    const both = [...presented, { documentId: FIXO.id, documentTitle: FIXO.title, heading: "Abertura", excerpt: FIXO.rule }]
    const { deps } = setup({ transcripts: THREE_OF_FIVE })
    const withFixo: ReliableGenerationDeps = { ...deps, loadPublishedKnowledge: async () => new Map([[DOC, { documentId: DOC, title: TITLE, content: `## Abertura\n${RULE}`, version: 2 }], [FIXO.id, { documentId: FIXO.id, title: FIXO.title, content: `## Abertura\n${FIXO.rule}`, version: 1 }]]) }
    const source = sourceOutput(THREE_OF_FIVE) as ReturnType<typeof sourceOutput> & { knowledgeExcerpts: unknown }
    source.knowledgeExcerpts = both
    source.diagnosis.interactionAssessments = source.diagnosis.interactionAssessments.map((entry) => ({ ...entry, processAssessment: { ...entry.processAssessment, processes: entry.processAssessment.processes.map((process) => ({ ...process, product: "Móvel" })), applicability: [{ status: "AMBIGUOUS", resolvedProduct: null, source: "NONE", evidence: [], candidates: [{ product: "Móvel", documentTitle: TITLE, ruleQuote: RULE }, { product: "Fixo", documentTitle: FIXO.title, ruleQuote: FIXO.rule }], operatorStatement: null }] } }))
    const result = await generateReliableFeedback(withFixo, request(source))
    const items = result.record.artifact!.items
    // Nenhum padrão de desenvolvimento nasce de etapa cujo produto não foi confirmado.
    expect(items.some((item) => item.kind === "INDICATOR_DEVELOPMENT_PATTERN")).toBe(false)
    const attention = items.find((item) => item.kind === "INDICATOR_APPLICABILITY_POINT")!
    expect(attention).toMatchObject({ section: "ATTENTION", wordingSource: "SYSTEM", decision: { disposition: "READY" }, applicability: { sample: { affected: 5, analyzed: 5 } } })
    expect(attention.proposedWording!.suggestedResponse).toBe("Antes de seguir, vou confirmar qual produto está vinculado à sua solicitação, porque o procedimento muda conforme o serviço: é Móvel ou Fixo?")
    expect(attention.proposedWording!.observed).toBe("Em 5 de 5 atendimentos analisados não foi possível confirmar qual produto estava sendo tratado (Móvel ou Fixo).")
  })
})
