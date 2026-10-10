import { describe, expect, it, vi } from "vitest"
import { createInMemoryReliableFeedbackStore } from "../infrastructure/in-memory-reliable-feedback-store.js"
import { generateReliableFeedback, ReliableGenerationInProgressError, type ReliableGenerationDeps, type ReliableGenerationRequest } from "./generate-reliable-feedback.js"
import { decideReliableReview } from "./decide-reliable-review.js"
import { toReliableReviewDetail } from "../../interaction-feedback/domain/review-view.js"
import { RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, RELIABLE_FEEDBACK_PILOT_POLICY, type ReliableFeedbackPolicy } from "../domain/reliable-feedback-item.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import type { ReliableFeedbackWriterPort } from "./ports.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const INTERACTION = "22222222-2222-4222-8222-222222222222"
const MEASUREMENT = "33333333-3333-4333-8333-333333333333"
const TRANSCRIPT = ["CLIENTE: Quero saber quando chega a fatura.", "OPERADOR: Vou verificar aqui, aguarde um momento.", "OPERADOR: A fatura chega em até cinco dias úteis.", "CLIENTE: Ok."].join("\n")
const RELEASING: ReliableFeedbackPolicy = { ...RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, version: "TEST_RELEASING", releasedItemKinds: ["MONITORING_DEVELOPMENT_POINT", "INDICATOR_TARGET_MET", "INDICATOR_TARGET_NOT_MET"] }

const monitoringOutput = (evidence = "Vou verificar aqui, aguarde um momento.") => ({ kind: "monitoring", input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { title: "t", summary: "s", impactedIndicator: "i", evidenceFound: evidence, observedBehavior: "não explicou o prazo antes de pedir espera", relatedProcedure: "p", recommendation: "Explique o motivo da espera." } } })
const indicatorOutput = (summary = "Seu TMA ficou fora da meta.") => ({ kind: "indicator", input: { organizationId: ORG, operatorId: OPERATOR, contextSnapshot: { indicatorMeasurementId: MEASUREMENT }, structured: { title: "t", summary, relatedProcedure: "p", recommendation: "Revise as pausas." } } })
const request = (overrides: Partial<ReliableGenerationRequest> = {}): ReliableGenerationRequest => ({ organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf", workflowVersionId: "v1", nodeId: "feedback", sourceNodeId: "agent", sourceType: "AGENT", domain: "MONITORING", sourceNodeOutput: monitoringOutput(), collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: "agent-a", ...overrides })
const canonical: IndicatorCanonicalContext = { contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT, indicator: { id: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" }, measurement: { id: MEASUREMENT, subjectId: OPERATOR, value: 420, periodStart: "2026-09-01", periodEnd: "2026-09-30", granularity: "MONTHLY" }, target: { value: 400, source: "TEAM", goalId: "g" }, ...canonicalComparison(420, 400, "LOWER"), provenance: { source: "indicator_measurements+goals", loadedAt: "2026-10-01T00:00:00Z" } }

function fakeWriter(wording: { observed: string; whyItMatters: string; whatYouCanDo: string } | "FAIL" = { observed: "Nesta interação você pediu para o cliente aguardar.", whyItMatters: "", whatYouCanDo: "" }) {
  const calls = { monitoring: 0, indicator: 0 }
  const write = async (input: { items: { slot: string }[] }) => {
    if (wording === "FAIL") { const error = new Error("timeout"); error.name = "WRITER_TIMEOUT"; throw error }
    return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, ...wording })) } }
  }
  const writer: ReliableFeedbackWriterPort = { writeMonitoring: async (input) => { calls.monitoring += 1; return write(input) }, writeIndicator: async (input) => { calls.indicator += 1; return write(input) } }
  return { writer, calls }
}
function deps(overrides: Partial<ReliableGenerationDeps> & { reactivations?: { enrollmentId: string; nodeId: string }[] } = {}) {
  const reactivations = overrides.reactivations ?? []
  const store = createInMemoryReliableFeedbackStore({ onReactivate: (input) => { reactivations.push(input); return true } })
  const loadMonitoringContext = vi.fn(async (organizationId: string, interactionId: string, collaboratorId: string) => (organizationId === ORG && interactionId === INTERACTION && collaboratorId === OPERATOR ? { transcript: TRANSCRIPT, label: "Atendimento de 14/09/2026", otherOperatorNames: [] } : null))
  const loadIndicatorContext = vi.fn(async () => canonical)
  const base: ReliableGenerationDeps = { enabled: true, store, writer: fakeWriter().writer, policy: RELIABLE_FEEDBACK_PILOT_POLICY, loadMonitoringContext, loadIndicatorContext, loadPublishedKnowledge: async () => new Map(), loadIndicatorDiagnosisPlan: async () => null, loadPeerPracticeData: async () => ({ peers: [], observations: [] }), resolveDiagnosticStrategy: async () => null, now: () => new Date("2026-09-24T12:00:00Z") }
  return { ...base, ...overrides, store, reactivations }
}

describe("V1.5.12 — Gerar feedback confiável (caso de uso)", () => {
  it("monitoria READY: usa a saída do Agent (sem reanalisar a interação), redator UMA vez, artefato com a evidência conferida", async () => {
    const { writer, calls } = fakeWriter()
    const setup = deps({ writer, policy: RELEASING })
    const result = await generateReliableFeedback(setup, request())
    expect(calls).toEqual({ monitoring: 1, indicator: 0 })
    expect(result.nodeOutput).toMatchObject({ kind: "RELIABLE_FEEDBACK_ARTIFACT", disposition: "READY", domain: "MONITORING", sourceNodeId: "agent" })
    expect(result.nodeOutput.items[0]!.facts[0]).toMatchObject({ role: "OPERADOR", text: "Vou verificar aqui, aguarde um momento." })
    expect(setup.store.reviews).toHaveLength(0)
  })
  it("IDEMPOTENTE: mesma matrícula/nó/origem reaproveita o artefato concluído — redator não é chamado de novo", async () => {
    const { writer, calls } = fakeWriter()
    const setup = deps({ writer, policy: RELEASING })
    const first = await generateReliableFeedback(setup, request())
    const second = await generateReliableFeedback(setup, request())
    expect(second).toMatchObject({ artifactId: first.artifactId, reused: true })
    expect(calls.monitoring).toBe(1)
    // Outra origem (outro nó) = outro artefato.
    await generateReliableFeedback(setup, request({ sourceNodeId: "agent-b" }))
    expect(calls.monitoring).toBe(2)
  })
  it("posse em andamento por outra execução = erro técnico (o motor tenta de novo), nunca geração dupla", async () => {
    const setup = deps()
    await setup.store.claim({ organizationId: ORG, artifactKey: "WORKFLOW_NODE:enr-1:feedback:agent", enrollmentId: "enr-1", workflowId: "wf", workflowVersionId: "v1", nodeId: "feedback", sourceNodeId: "agent", sourceType: "AGENT", domain: "MONITORING", collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, contractVersion: "x" }, new Date("2026-09-24T12:00:00Z"), 180)
    await expect(generateReliableFeedback(setup, request())).rejects.toBeInstanceOf(ReliableGenerationInProgressError)
  })
  it("política REAL: PILOT_V1 → HOLD_FOR_QA (tudo em QA); AUTONOMOUS_V1 (V1.5.12a) → READY para item claro, sem QA", async () => {
    const pilot = deps({ policy: RELIABLE_FEEDBACK_PILOT_POLICY })
    const held = await generateReliableFeedback(pilot, request())
    expect(held.nodeOutput.disposition).toBe("HOLD_FOR_QA")
    expect(held.nodeOutput.items).toEqual([])
    expect(pilot.store.reviews).toHaveLength(1)
    expect(pilot.store.reviews[0]!.reviewRequiredBy).toEqual(expect.arrayContaining(["PILOT_HOLD_ALL_FOR_QA", "FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"]))
    for (const [domain, extra] of [["MONITORING", {}], ["INDICATOR", { domain: "INDICATOR", sourceNodeOutput: indicatorOutput(), interactionId: null, indicatorMeasurementId: MEASUREMENT }]] as const) {
      const autonomous = deps({ policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY })
      const ready = await generateReliableFeedback(autonomous, request(extra as Partial<ReliableGenerationRequest>))
      expect(ready.nodeOutput.disposition, domain).toBe("READY")
      expect(ready.record.artifact!.items[0]!.decision.reasons, domain).toEqual(["AUTONOMY_CRITERIA_MET"])
      expect(autonomous.store.reviews, domain).toHaveLength(0)
    }
  })
  it("falha do redator (timeout, 0 retry) = fallback do item + HOLD_FOR_QA (fallback nunca é autônomo)", async () => {
    const { writer, calls } = fakeWriter("FAIL")
    const setup = deps({ writer, policy: RELEASING })
    const result = await generateReliableFeedback(setup, request())
    expect(calls.monitoring).toBe(1)
    expect(result.nodeOutput.disposition).toBe("HOLD_FOR_QA")
    expect(result.record.artifact!.writer.error).toBe("WRITER_TIMEOUT")
    expect(setup.store.reviews[0]!.wordingSource).toBe("FALLBACK")
  })
  it("evidência não literal / de outra organização / de outro colaborador = BLOCKED, sem redator, sem QA", async () => {
    const { writer, calls } = fakeWriter()
    const invented = await generateReliableFeedback(deps({ writer, policy: RELEASING }), request({ sourceNodeOutput: monitoringOutput("O operador foi grosseiro com o cliente.") }))
    expect(invented.nodeOutput).toMatchObject({ disposition: "BLOCKED", items: [] })
    const otherOrg = await generateReliableFeedback(deps({ writer, policy: RELEASING }), request({ organizationId: "99999999-0000-4000-8000-000000000009" }))
    expect(otherOrg.nodeOutput).toMatchObject({ disposition: "BLOCKED", reasons: ["ORGANIZATION_MISMATCH"] })
    const otherCollaborator = await generateReliableFeedback(deps({ writer, policy: RELEASING }), request({ collaboratorId: "44444444-4444-4444-8444-444444444444" }))
    expect(otherCollaborator.nodeOutput.disposition).toBe("BLOCKED")
    expect(calls.monitoring).toBe(0)
  })
  it("Orquestrador sem evidência estruturada (só síntese livre) → BLOCKED, nunca entrega insegura", async () => {
    const setup = deps({ policy: RELEASING })
    const result = await generateReliableFeedback(setup, request({ sourceType: "ORCHESTRATOR", sourceNodeId: "orq", sourceNodeOutput: { text: "O operador errou feio.", orchestratorName: "Qualidade", orchestratorId: "o", agentId: null, calls: [], results: [{ agentId: "s", toolName: "t", text: "livre", contract: "TEXT" }], supportMaterialCandidates: [], structuredResult: null } }))
    expect(result.nodeOutput).toMatchObject({ disposition: "BLOCKED", reasons: ["SOURCE_HAS_NO_CLAIMS"] })
  })
  it("indicador: números do contexto canônico; interpretação com número inventado é descartada e vai a QA", async () => {
    const { writer, calls } = fakeWriter({ observed: "No período de 01/09/2026 a 30/09/2026, seu TMA foi 420 s, fora da meta de 400 s.", whyItMatters: "", whatYouCanDo: "" })
    const setup = deps({ writer, policy: RELEASING })
    const ready = await generateReliableFeedback(setup, request({ domain: "INDICATOR", interactionId: null, indicatorMeasurementId: MEASUREMENT, sourceNodeOutput: indicatorOutput() }))
    expect(calls.indicator).toBe(1)
    expect(ready.nodeOutput).toMatchObject({ disposition: "READY", label: "TMA · 01/09/2026 a 30/09/2026" })
    expect(ready.nodeOutput.items[0]!.facts.map((fact) => fact.text)).toContain("TMA no período 01/09/2026 a 30/09/2026: 420 s")
    const conflict = await generateReliableFeedback(deps({ writer, policy: RELEASING }), request({ enrollmentId: "enr-2", domain: "INDICATOR", interactionId: null, indicatorMeasurementId: MEASUREMENT, sourceNodeOutput: indicatorOutput("Seu TMA foi 999 s e melhorou muito.") }))
    expect(conflict.nodeOutput.disposition).toBe("HOLD_FOR_QA")
    expect(conflict.record.artifact!.items[0]!.analysisConflicts).toEqual(expect.arrayContaining(["UNSUPPORTED_NUMBER", "TREND_WITHOUT_CANONICAL_HISTORY"]))
    expect(conflict.nodeOutput.items).toEqual([])
  })
  it("indicador: texto do redator que recalcula (\"7 minutos\") cai no fallback canônico → HOLD_FOR_QA", async () => {
    const { writer } = fakeWriter({ observed: "Seu TMA foi de 7 minutos, 20 s acima da meta.", whyItMatters: "x", whatYouCanDo: "y" })
    const setup = deps({ writer, policy: RELEASING })
    const result = await generateReliableFeedback(setup, request({ domain: "INDICATOR", interactionId: null, indicatorMeasurementId: MEASUREMENT, sourceNodeOutput: indicatorOutput() }))
    expect(result.nodeOutput.disposition).toBe("HOLD_FOR_QA")
    expect(setup.store.reviews[0]).toMatchObject({ wordingSource: "FALLBACK", writerViolations: expect.arrayContaining(["UNSUPPORTED_NUMBER"]) })
    expect(setup.store.reviews[0]!.proposedWording.observed).toContain("420 s")
  })
  it("sem contexto canônico (medição de outro colaborador/organização) → BLOCKED", async () => {
    const setup = deps({ policy: RELEASING, loadIndicatorContext: vi.fn(async () => null) })
    const result = await generateReliableFeedback(setup, request({ domain: "INDICATOR", interactionId: null, indicatorMeasurementId: MEASUREMENT, sourceNodeOutput: indicatorOutput() }))
    expect(result.nodeOutput).toMatchObject({ disposition: "BLOCKED", reasons: ["NO_CANONICAL_INDICATOR_CONTEXT"] })
  })
})

describe("V1.5.12 — QA de exceção: decisão fecha o QA do artefato e REATIVA a mesma matrícula (nunca entrega)", () => {
  const decide = (setup: ReturnType<typeof deps>, reviewId: string, input: Parameters<typeof decideReliableReview>[1] extends infer T ? Omit<T & object, "organizationId" | "reviewId" | "reviewerId"> : never) =>
    decideReliableReview({ store: setup.store, now: setup.now }, { organizationId: ORG, reviewId, reviewerId: "qa-1", ...input })

  it("APPROVED_UNCHANGED → READY + reativação da matrícula no nó; a próxima geração devolve READY sem redator", async () => {
    const { writer, calls } = fakeWriter()
    const setup = deps({ writer })
    await generateReliableFeedback(setup, request())
    const result = await decide(setup, setup.store.reviews[0]!.id, { decision: "APPROVED_UNCHANGED" })
    expect(result).toMatchObject({ ok: true, resolution: { disposition: "READY", reactivated: true } })
    expect(setup.reactivations).toEqual([{ organizationId: ORG, enrollmentId: "enr-1", nodeId: "feedback" }])
    const again = await generateReliableFeedback(setup, request())
    expect(again.nodeOutput.disposition).toBe("READY")
    expect(again.nodeOutput.items[0]!.qaStatus).toBe("APPROVED_UNCHANGED")
    expect(calls.monitoring).toBe(1)
  })
  it("APPROVED_EDITED → o Workflow segue com o texto EDITADO validado", async () => {
    const setup = deps()
    await generateReliableFeedback(setup, request())
    const finalWording = { observed: "Você pediu para o cliente aguardar sem explicar o motivo.", whyItMatters: "", whatYouCanDo: "" }
    expect(await decide(setup, setup.store.reviews[0]!.id, { decision: "APPROVED_EDITED", finalWording, reasonCategory: "TOO_GENERIC" })).toMatchObject({ ok: true })
    const again = await generateReliableFeedback(setup, request())
    expect(again.nodeOutput.items[0]).toMatchObject({ wording: finalWording, wordingSource: "HUMAN_EDITED" })
  })
  it("REJECTED → REJECTED (nada emitido); segunda decisão = já decidido; edição de indicador com número fora do canônico é bloqueada", async () => {
    const setup = deps()
    await generateReliableFeedback(setup, request())
    const reviewId = setup.store.reviews[0]!.id
    expect(await decide(setup, reviewId, { decision: "REJECTED", reasonCategory: "WRONG_FOCUS" })).toMatchObject({ ok: true, resolution: { disposition: "REJECTED" } })
    expect(await decide(setup, reviewId, { decision: "APPROVED_UNCHANGED" })).toEqual({ ok: false, error: "REVIEW_ALREADY_DECIDED" })
    expect((await generateReliableFeedback(setup, request())).nodeOutput).toMatchObject({ disposition: "REJECTED", items: [] })

    const indicator = deps()
    await generateReliableFeedback(indicator, request({ domain: "INDICATOR", interactionId: null, indicatorMeasurementId: MEASUREMENT, sourceNodeOutput: indicatorOutput() }))
    const blocked = await decide(indicator, indicator.store.reviews[0]!.id, { decision: "APPROVED_EDITED", finalWording: { observed: "Seu TMA foi de 7 minutos.", whyItMatters: "", whatYouCanDo: "" }, reasonCategory: "OTHER" })
    expect(blocked).toMatchObject({ ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: ["UNSUPPORTED_NUMBER"] })
  })
  it("BLOCKED não tem revisão: o QA não consegue desbloquear estrutura", async () => {
    const setup = deps()
    await generateReliableFeedback(setup, request({ sourceNodeOutput: monitoringOutput("Frase inventada que não está na conversa.") }))
    expect(setup.store.reviews).toEqual([])
    expect((await generateReliableFeedback(setup, request())).nodeOutput.disposition).toBe("BLOCKED")
  })
})

describe("V1.6.0 — Gerar feedback a partir da AVALIAÇÃO DE PROCESSO (monitoria process-centric)", () => {
  const DOC = "44444444-4444-4444-8444-444444444444"
  const TITLE = "Prazo de Entrega da Fatura"
  const RULE = "Informe ao cliente que a fatura chega em até cinco dias úteis após o fechamento."
  const excerpts = [{ documentId: DOC, documentTitle: TITLE, heading: "Prazo", excerpt: RULE }]
  const loadPublishedKnowledge = vi.fn(async (organizationId: string, ids: readonly string[]) => new Map(organizationId === ORG && ids.includes(DOC) ? [[DOC, { documentId: DOC, title: TITLE, content: `## Prazo\n${RULE}`, version: 2 }]] : []))
  const assessmentOutput = (status: "FOLLOWED" | "NOT_OBSERVABLE") => {
    const base = monitoringOutput("A fatura chega em até cinco dias úteis.")
    return { ...base, knowledgeExcerpts: excerpts, input: { ...base.input, structured: { ...base.input.structured, processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: [{ requirement: "Informar o prazo da fatura", status, transcriptEvidence: status === "FOLLOWED" ? ["A fatura chega em até cinco dias úteis."] : [], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: "Continue informando o prazo." }, uncertainty: null }] }] } } } }
  }

  it("etapa FOLLOWED com regra verificada → PONTO FORTE READY sob AUTONOMOUS_V1; o redator recebe a regra e o grounding", async () => {
    const inputs: unknown[] = []
    const writer: ReliableFeedbackWriterPort = {
      writeMonitoring: async (input) => { inputs.push(input); return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "Nesta interação você informou o prazo de até cinco dias úteis.", whyItMatters: "", whatYouCanDo: "" })) } } },
      writeIndicator: async () => { throw new Error("não usado") },
    }
    const setup = deps({ writer, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, loadPublishedKnowledge })
    const result = await generateReliableFeedback(setup, request({ sourceNodeOutput: assessmentOutput("FOLLOWED") }))
    expect(loadPublishedKnowledge).toHaveBeenCalledWith(ORG, [DOC])
    expect(result.nodeOutput).toMatchObject({ disposition: "READY" })
    expect(result.nodeOutput.items[0]).toMatchObject({ section: "STRENGTH", sectionLabel: "Ponto forte", grounding: "OFFICIAL_PROCEDURE", knowledge: { documentId: DOC, quote: RULE, applicability: "VERIFIED", href: `/materiais/${DOC}` }, process: { requirement: "Informar o prazo da fatura", status: "FOLLOWED" } })
    // V1.7.1e — behavior-first: assunto → o que você fez bem (+ fala) → base oficial (regra, documento · seção, Abrir processo ↗).
    // V1.7.2 — ponto cumprido comum vai para "O que manter" (sem bloco próprio); a regra, a fala e o link continuam no item.
    expect(result.nodeOutput.text).toContain("## O que manter")
    expect(result.nodeOutput.text).not.toContain("**Base oficial**")
    expect(result.nodeOutput.text).toContain(`[${TITLE} ↗](/materiais/${DOC})`)
    expect(result.nodeOutput.items[0]!.facts.map((fact) => fact.text)).toContain("A fatura chega em até cinco dias úteis.")
    expect(inputs[0]).toMatchObject({ contract: "WORKFLOW_MONITORING_FEEDBACK_WRITER_INPUT_V6", items: [{ grounding: "OFFICIAL_PROCEDURE", requirement: "Informar o prazo da fatura", guidance: { source: "KB_RULE", knowledge: { documentTitle: TITLE, ruleText: RULE } } }] })
    expect(result.record.artifact!.processAssessment).toMatchObject({ summary: { FOLLOWED: 1, knowledgeVerified: 1 } })
  })
  it("sob PILOT_V1 o item vai ao QA levando a regra e a etapa (base do processo no revisor)", async () => {
    const setup = deps({ loadPublishedKnowledge })
    await generateReliableFeedback(setup, request({ sourceNodeOutput: assessmentOutput("FOLLOWED") }))
    expect(setup.store.reviews[0]!.reviewItem).toMatchObject({ domain: "MONITORING", knowledge: { documentId: DOC, applicability: "VERIFIED" }, process: { requirement: "Informar o prazo da fatura" } })
  })
  it("QA: a tela mostra a base do processo; edição só com o fato é aceita, orientação sem fundamento é bloqueante", async () => {
    const setup = deps({ loadPublishedKnowledge })
    await generateReliableFeedback(setup, request({ sourceNodeOutput: assessmentOutput("FOLLOWED") }))
    const review = setup.store.reviews[0]!
    const detail = toReliableReviewDetail(review, { collaborator: { id: OPERATOR, name: "Operador", jobTitle: null }, team: null, occurredAt: null, createdAt: new Date("2026-09-24T12:00:00Z"), reviewerName: null, selection: { decision: { disposition: "HOLD_FOR_QA", structural: "STRUCTURALLY_EMITTABLE", reasons: [], policyVersion: "P", autonomyEligible: true }, deliveredAt: null } as never })
    expect(detail).toMatchObject({ processBasis: { requirement: "Informar o prazo da fatura", statusLabel: "Seguido", documentTitle: TITLE, quote: RULE, href: `/materiais/${DOC}`, applicability: "VERIFIED" }, groundingLabel: expect.any(String) })

    // Item SEM regra (legado): "o que fazer" editado pelo QA sem fundamento é bloqueado; só o fato passa.
    const legacy = deps()
    await generateReliableFeedback(legacy, request())
    const legacyReview = legacy.store.reviews[0]!.id
    const blocked = await decideReliableReview({ store: legacy.store, now: legacy.now }, { organizationId: ORG, reviewId: legacyReview, reviewerId: "qa-1", decision: "APPROVED_EDITED", finalWording: { observed: "Você pediu para o cliente aguardar.", whyItMatters: "", whatYouCanDo: "Organize melhor o atendimento." }, reasonCategory: "TOO_GENERIC" })
    expect(blocked).toMatchObject({ ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: ["UNGROUNDED_GUIDANCE"] })
  })
  it("nenhuma etapa evidenciada → artefato BLOCKED (NO_EVIDENCED_PROCESS_CHECKPOINT), redator não é chamado", async () => {
    const { writer, calls } = fakeWriter()
    const result = await generateReliableFeedback(deps({ writer, policy: RELIABLE_FEEDBACK_AUTONOMOUS_POLICY, loadPublishedKnowledge }), request({ sourceNodeOutput: assessmentOutput("NOT_OBSERVABLE") }))
    expect(result.nodeOutput).toMatchObject({ disposition: "BLOCKED", reasons: ["NO_EVIDENCED_PROCESS_CHECKPOINT"] })
    expect(calls.monitoring).toBe(0)
  })
})
