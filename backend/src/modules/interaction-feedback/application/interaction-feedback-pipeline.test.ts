import { describe, expect, it, vi } from "vitest"
import { composeInteractionFeedback, INTERNAL_REF_PATTERN, type ProceduralLineage } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import type { InteractionFinding, InteractionSemanticFrame, SemanticObservation } from "../../investigation/domain/interaction-semantic-frame.js"
import { deliveryStateOf, FEEDBACK_PILOT_DELIVERY_POLICY, summarizeRunDelivery, type FeedbackDeliveryPolicy } from "../domain/feedback-delivery-policy.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { decideItemReview, deliverableItems, reviewerView, runInteractionFeedbackPipeline, WRITER_REJECTED_FALLBACK_USED } from "./interaction-feedback-pipeline.js"
import type { FeedbackWriterPort } from "./ports.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const OTHER_ORG = "00000000-0000-4000-8000-000000000999"
const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
const obs = (id: string, kind: SemanticObservation["kind"], speaker: string, turn: string, quote: string): SemanticObservation => ({ id, kind, summary: `RESUMO-DO-MODELO ${id}`, evidence: [unit(turn, speaker, quote)] })
let seq = 0
const finding = (kind: InteractionFinding["kind"], observations: SemanticObservation[], extra: Partial<InteractionFinding> = {}): InteractionFinding => { seq += 1; return { id: `F${seq}`, interactionRef: "I6", kind, summary: "SUMMARY", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${seq}`, ownership: "AGENT", ...extra } }
const frame = (observations: SemanticObservation[], findings: InteractionFinding[], extra: Partial<InteractionSemanticFrame> = {}): InteractionSemanticFrame => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", source: "MODEL", customerNeeds: observations.filter((item) => item.kind === "CUSTOMER_NEED") as never, questions: [], answers: [], agentActions: observations.filter((item) => item.kind === "AGENT_ACTION") as never, agentStatements: observations.filter((item) => item.kind === "AGENT_STATEMENT") as never, commitments: [], customerSignals: observations.filter((item) => item.kind === "CUSTOMER_SIGNAL") as never, procedureAssertions: observations.filter((item) => item.kind === "PROCEDURE_ASSERTION") as never, interactionEvents: [], findings, empty: observations.length + findings.length === 0, ...extra })
const compose = (f: InteractionSemanticFrame, lineage?: Map<string, ProceduralLineage>) => composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: f, interactionLabel: "14/03/2026", sourceRun: "run-1", proceduralLineage: lineage })

const action = obs("A1", "AGENT_ACTION", "OPERADOR", "T4", "Registrei tudo no protocolo 1234567890123, anota aí.")
const statement = obs("D1", "AGENT_STATEMENT", "OPERADOR", "T19", "Isso é o ciclo de faturamento retroativo com pro rata do upgrade.")
const signal = obs("S1", "CUSTOMER_SIGNAL", "CLIENTE", "T20", "Pro rata? Moça, fala em português, por favor.")
const assertion = obs("P1", "PROCEDURE_ASSERTION", "OPERADOR", "T15", "Não precisa explicar, vou refazer por aqui.")
const kbLineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "Antes de acessar informações protegidas, o operador deve explicar a validação.", documentId: "11111111-2222-4333-8444-555555555555" }]])
const divergence = () => finding("PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })

const good = (input: FeedbackWriterInputV1) => ({ items: input.items.map((item) => ({ slot: item.slot, observed: item.section === "STRENGTH" ? "Nesta conversa você informou o protocolo ao cliente." : "Nesta conversa o cliente não entendeu o termo usado.", whyItMatters: "Isso pode ajudar o cliente a acompanhar o atendimento.", whatYouCanDo: item.section === "STRENGTH" ? "Continue informando o protocolo ao final do atendimento." : "Sugestão: explique o termo com palavras do dia a dia." })) })
const writerOf = (build: (input: FeedbackWriterInputV1) => unknown): FeedbackWriterPort & { calls: number } => { const writer = { calls: 0, async write(input: FeedbackWriterInputV1) { writer.calls += 1; return { rawOutput: build(input) } } }; return writer }
const context = { organizationId: ORG, collaboratorId: "22222222-2222-4222-8222-222222222222", teamId: null, interactionId: "0f0e0d0c-0000-4000-8000-000000000006", occurredAt: new Date("2026-03-14T12:00:00Z") }
const NOW = () => new Date("2026-09-24T12:00:00Z")
const setup = (build: (input: FeedbackWriterInputV1) => unknown = good, enabled = true, deliveryPolicy: FeedbackDeliveryPolicy = FEEDBACK_PILOT_DELIVERY_POLICY) => { const memory = createInMemoryInteractionFeedbackStore(); const writer = writerOf(build); return { memory, writer, deps: { enabled, writer, store: memory.store, now: NOW, deliveryPolicy } } }
const reviewer = "33333333-3333-4333-8333-333333333333"

describe("V1.5.0/V1.5.5 — pipeline controlado do InteractionFeedback (interno, sem entrega)", () => {
  it("flag OFF: nada é lido, escrito ou chamado", async () => {
    const { memory, writer, deps } = setup(good, false)
    expect(await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)).toEqual({ status: "SKIPPED_FLAG_OFF" })
    expect(writer.calls).toBe(0)
    expect(memory.runs.size + memory.reviews.size + memory.occurrences.length).toBe(0)
  })
  it("HAS_POINTS + Writer PASS → política do piloto: HOLD_FOR_QA (PENDING_REVIEW) para TODO item entregável, inclusive STRENGTH; nada entregável ainda", async () => {
    const { memory, writer, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action, statement, signal], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(writer.calls).toBe(1)
    expect(result.reviews.map((review) => [review.section, review.wordingSource, review.reviewStatus])).toEqual([["STRENGTH", "WRITER", "PENDING_REVIEW"], ["OPPORTUNITY", "WRITER", "PENDING_REVIEW"]])
    expect(result.reviews[0]!.reviewRequiredBy).toEqual(expect.arrayContaining([FEEDBACK_PILOT_DELIVERY_POLICY.version, "PILOT_HOLD_ALL_FOR_QA"]))
    expect(result.decisions.map((entry) => [entry.decision.disposition, entry.decision.structural, entry.decision.policyVersion])).toEqual([["HOLD_FOR_QA", "STRUCTURALLY_DELIVERABLE", FEEDBACK_PILOT_DELIVERY_POLICY.version], ["HOLD_FOR_QA", "STRUCTURALLY_DELIVERABLE", FEEDBACK_PILOT_DELIVERY_POLICY.version]])
    expect(result.delivery).toEqual({ disposition: "HOLD_FOR_QA", counts: { AUTO_DELIVER: 0, HOLD_FOR_QA: 2, BLOCKED: 0 } })
    expect(result.reviews[0]!.writerOriginal).toMatchObject({ slot: "ITEM_1", observed: "Nesta conversa você informou o protocolo ao cliente." })
    expect(await deliverableItems(memory.store, ORG, result.runId)).toEqual([])
    // Estrutura do feedback preservada: revisão estrutural continua calculada (a do piloto é uma camada a mais).
    expect([...memory.runs.values()][0]!.feedbackSnapshot.review.required).toBe(true)
  })
  it("Writer reprovado na validação → fallback inteiro, WRITER_REJECTED_FALLBACK_USED, original preservado, PENDING_REVIEW", async () => {
    const { deps } = setup((input) => ({ items: input.items.map((item) => ({ slot: item.slot, observed: "Você sempre informa o protocolo.", whyItMatters: "Isso garante que o cliente recebeu tudo.", whatYouCanDo: "Continue assim." })) }))
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    const review = result.reviews[0]!
    expect(review).toMatchObject({ wordingSource: "FALLBACK", reviewStatus: "PENDING_REVIEW" })
    expect(review.writerViolations).toEqual(expect.arrayContaining(["PATTERN_LANGUAGE", "GUARANTEED_EFFECT"]))
    expect(review.reviewRequiredBy).toContain(WRITER_REJECTED_FALLBACK_USED)
    expect(review.writerOriginal).toMatchObject({ observed: "Você sempre informa o protocolo." })
    expect(review.proposedWording.observed).toMatch(/^Nesta interação foi observado um comportamento positivo/)
    expect(result.fallbacks).toBe(1)
  })
  it("redator falha (erro/malformado): zero retry, fallback de cada item, continua exigindo revisão", async () => {
    const { deps, writer } = setup(() => { throw new Error("boom") })
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(writer.calls).toBe(1)
    expect(result).toMatchObject({ writerError: "Error", fallbacks: 1, reviews: [{ wordingSource: "FALLBACK", writerViolations: ["SCHEMA"], writerOriginal: null }] })
  })
  it("APPROVED_UNCHANGED → original preservado e entregável (gate); decisão é única", async () => {
    const { memory, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context) as { runId: string; reviews: { id: string; proposedWording: unknown }[] }
    const decided = await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId: result.reviews[0]!.id, reviewerId: reviewer, decision: "APPROVED_UNCHANGED" })
    expect(decided).toMatchObject({ ok: true, review: { reviewStatus: "APPROVED_UNCHANGED", finalWording: null, reviewedBy: reviewer } })
    expect(await deliverableItems(memory.store, ORG, result.runId)).toEqual([{ reviewId: result.reviews[0]!.id, slot: "ITEM_1", section: "STRENGTH", wording: result.reviews[0]!.proposedWording, disposition: "HOLD_FOR_QA", qaStatus: "APPROVED_UNCHANGED" }])
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId: result.reviews[0]!.id, reviewerId: reviewer, decision: "REJECTED", reasonCategory: "TONE" })).toEqual({ ok: false, error: "REVIEW_ALREADY_DECIDED" })
  })
  it("APPROVED_EDITED → original e proposto intactos + versão humana separada, com motivo; edição que vaza ref interna é bloqueada", async () => {
    const { memory, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context) as { runId: string; reviews: { id: string }[] }
    const reviewId = result.reviews[0]!.id
    const edited = { observed: "Nesta conversa você registrou o atendimento e passou o protocolo.", whyItMatters: "Ter o protocolo pode ajudar o cliente numa próxima consulta.", whatYouCanDo: "Continue passando o protocolo ao final." }
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId, reviewerId: reviewer, decision: "APPROVED_EDITED", finalWording: edited })).toEqual({ ok: false, error: "REASON_REQUIRED" })
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId, reviewerId: reviewer, decision: "APPROVED_EDITED", reasonCategory: "TOO_GENERIC", finalWording: { ...edited, observed: "Na interação I6 você passou o protocolo." } })).toMatchObject({ ok: false, error: "EDIT_VIOLATES_CONTRACT", violations: ["INTERNAL_REF"] })
    const decided = await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId, reviewerId: reviewer, decision: "APPROVED_EDITED", reasonCategory: "TOO_GENERIC", comment: "mais específico", finalWording: edited })
    expect(decided).toMatchObject({ ok: true, review: { reviewStatus: "APPROVED_EDITED", finalWording: edited, reasonCategory: "TOO_GENERIC", reviewerComment: "mais específico", reviewedBy: reviewer } })
    const stored = memory.reviews.get(reviewId)!
    expect(stored.writerOriginal).toMatchObject({ observed: "Nesta conversa você informou o protocolo ao cliente." })
    expect(stored.proposedWording.observed).toBe("Nesta conversa você informou o protocolo ao cliente.")
    expect((await deliverableItems(memory.store, ORG, result.runId))[0]!.wording).toEqual(edited)
  })
  it("REJECTED → exige motivo, nunca entregável; outra organização não enxerga nem decide", async () => {
    const { memory, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context) as { runId: string; reviews: { id: string }[] }
    const reviewId = result.reviews[0]!.id
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: OTHER_ORG, reviewId, reviewerId: reviewer, decision: "APPROVED_UNCHANGED" })).toEqual({ ok: false, error: "REVIEW_NOT_FOUND" })
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId, reviewerId: reviewer, decision: "REJECTED" })).toEqual({ ok: false, error: "REASON_REQUIRED" })
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId, reviewerId: reviewer, decision: "REJECTED", reasonCategory: "UNSUPPORTED_EFFECT" })).toMatchObject({ ok: true, review: { reviewStatus: "REJECTED" } })
    expect(await deliverableItems(memory.store, ORG, result.runId)).toEqual([])
  })
  it("NOTHING_MATERIAL e INSUFFICIENT_EVIDENCE → run auditável, sem redator, sem revisão, sem entrega", async () => {
    for (const feedback of [compose(frame([signal], [finding("INTERACTION_FRICTION", [signal], { ownership: "INTERACTION" })])), compose(frame([], []))]) {
      const { memory, writer, deps } = setup()
      const result = await runInteractionFeedbackPipeline(deps, feedback, context)
      expect(result).toMatchObject({ status: "RECORDED_WITHOUT_WRITER", reason: feedback.status })
      expect(writer.calls).toBe(0)
      expect(memory.reviews.size).toBe(0)
      expect([...memory.runs.values()][0]).toMatchObject({ writerInvoked: false, writerInput: null })
    }
  })
  it("item sem evidência exibível suficiente → sem redator para ele; ocorrência registrada como INSUFFICIENT_DISPLAY_EVIDENCE", async () => {
    const { memory, writer, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([statement], [finding("FRICTION", [statement])])), context)
    expect(result).toMatchObject({ status: "RECORDED_WITHOUT_WRITER", reason: "DELIVERY_BLOCKED" })
    expect(writer.calls).toBe(0)
    expect(memory.occurrences).toEqual([expect.objectContaining({ issueCategory: "COMMUNICATION_FRICTION", deliveryStatus: "INSUFFICIENT_DISPLAY_EVIDENCE" })])
  })
  it("procedimental bloqueado: nunca vai ao redator nem é liberado pela revisão; ocorrência + recomendação BLOCKED com lineage e link canônico", async () => {
    const { memory, writer, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action, assertion], [finding("STRENGTH", [action]), divergence()]), kbLineage), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(writer.calls).toBe(1)
    expect(result.reviews.map((review) => review.section)).toEqual(["STRENGTH"])
    expect(memory.occurrences).toEqual([expect.objectContaining({ findingKind: "PROCEDURAL_DIVERGENCE", issueCategory: "PROCEDURAL_DIVERGENCE", ownership: "AGENT", structuralPolarity: "NEGATIVE", scope: "INTERACTION_SPECIFIC", deliveryStatus: "BLOCKED_PROCEDURAL_MATCHING" })])
    expect(memory.recommendations).toEqual([expect.objectContaining({ documentId: "11111111-2222-4333-8444-555555555555", documentTitle: "Procedimento de Validação", ruleRef: "KR3", href: "/materiais/11111111-2222-4333-8444-555555555555", recommendationType: "PROCEDURAL_RULE", deliveryStatus: "BLOCKED_PROCEDURAL_MATCHING", reviewStatus: "NOT_REVIEWED", occurrenceId: memory.occurrences[0]!.id })])
    // Aprovar tudo o que existe para revisão NÃO libera o procedimental: ele nunca virou item de revisão.
    await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId: result.reviews[0]!.id, reviewerId: reviewer, decision: "APPROVED_UNCHANGED" })
    expect((await deliverableItems(memory.store, ORG, result.runId)).map((item) => item.section)).toEqual(["STRENGTH"])
  })
  it("OperationalIssueOccurrence vem só da estrutura (nunca do texto do redator); evidência como origem, sem trecho bruto", async () => {
    const { memory, deps } = setup(() => ({ items: [] }))
    await runInteractionFeedbackPipeline(deps, compose(frame([statement, signal], [finding("FRICTION", [statement, signal])])), context)
    expect(memory.occurrences).toEqual([expect.objectContaining({ findingKind: "FRICTION", issueCategory: "COMMUNICATION_FRICTION", deliveryStatus: "ELIGIBLE_PENDING_REVIEW", findingRefs: [expect.stringMatching(/^I6\/F\d+$/)] })])
    expect(JSON.stringify(memory.occurrences)).not.toContain("pro rata")
    expect(memory.occurrences[0]!.evidenceRefs.every((ref) => /^[0-9a-f]{64}$/.test(ref.rawSha256))).toBe(true)
  })
  it("visão do revisor: só o necessário — nada de raw, provenance, handles, prompt ou dados técnicos", async () => {
    const { deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    const view = reviewerView(result.reviews[0]!)
    const text = JSON.stringify({ ...view, reviewId: "x" })
    expect(text).not.toMatch(INTERNAL_REF_PATTERN)
    expect(text).not.toContain("1234567890123")
    expect(text).not.toMatch(/provenance|rawEvidence|findingRef|systemPrompt|RESUMO-DO-MODELO|SUMMARY/)
    expect(view.evidence[0]!.text).toBe("Registrei tudo no protocolo [PROTOCOLO], anota aí.")
  })
  it("redator só é chamado com o FeedbackWriterInput (claim ceiling incluído); nada além", async () => {
    const spy = vi.fn(good)
    const { deps } = setup(spy)
    await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({ contract: "FEEDBACK_WRITER_INPUT_V1", effectClaimMode: "POTENTIAL_ONLY" })
    expect(JSON.stringify(spy.mock.calls[0]![0])).not.toMatch(/1234567890123|provenance|findingRef/)
  })
})

// V1.5.5 — FEEDBACK AUTONOMY POLICY: disposição determinística por item, gravada com política e motivos.
const AUTONOMY_TEST_POLICY: FeedbackDeliveryPolicy = { ...FEEDBACK_PILOT_DELIVERY_POLICY, version: "FEEDBACK_DELIVERY_POLICY_TEST_AUTONOMY", holdAllForQa: false, note: "só teste controlado" }

describe("V1.5.5 — política de autonomia: AUTO_DELIVER × HOLD_FOR_QA × BLOCKED", () => {
  it("piloto: item entregável = HOLD_FOR_QA; os critérios de autonomia são avaliados e gravados mesmo assim (contrafactual)", async () => {
    const { memory, deps } = setup()
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(result.decisions).toEqual([expect.objectContaining({ section: "STRENGTH", decision: { disposition: "HOLD_FOR_QA", structural: "STRUCTURALLY_DELIVERABLE", reasons: ["PILOT_HOLD_ALL_FOR_QA"], policyVersion: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", autonomyEligible: true, autonomyBlockers: [] }, itemReviewId: result.reviews[0]!.id })])
    expect(memory.reviews.get(result.reviews[0]!.id)!.reviewStatus).toBe("PENDING_REVIEW")
  })
  it("procedimental bloqueado → BLOCKED (nunca HOLD_FOR_QA), inclusive sob uma política de autonomia; sem redação para o QA", async () => {
    for (const policy of [FEEDBACK_PILOT_DELIVERY_POLICY, AUTONOMY_TEST_POLICY]) {
      const { deps } = setup(good, true, policy)
      const result = await runInteractionFeedbackPipeline(deps, compose(frame([action, assertion], [finding("STRENGTH", [action]), divergence()]), kbLineage), context)
      if (result.status !== "RECORDED") throw new Error(result.status)
      const procedural = result.decisions.find((entry) => entry.findingKind === "PROCEDURAL_DIVERGENCE")!
      expect(procedural).toMatchObject({ itemReviewId: null, decision: { disposition: "BLOCKED", structural: "BLOCKED", reasons: ["PROCEDURAL_MATCHING_NOT_VALIDATED"], autonomyEligible: null } })
    }
  })
  it("evidência exibível insuficiente → BLOCKED; execução INSUFFICIENT_EVIDENCE → resumo BLOCKED; nada material → nada a entregar", async () => {
    const insufficient = await runInteractionFeedbackPipeline(setup().deps, compose(frame([statement], [finding("FRICTION", [statement])])), context)
    expect(insufficient).toMatchObject({ status: "RECORDED_WITHOUT_WRITER", reason: "DELIVERY_BLOCKED", delivery: { disposition: "BLOCKED", counts: { BLOCKED: 1, HOLD_FOR_QA: 0, AUTO_DELIVER: 0 } }, decisions: [{ itemReviewId: null, decision: { disposition: "BLOCKED", reasons: ["INSUFFICIENT_DISPLAY_EVIDENCE"] } }] })
    const empty = compose(frame([], []))
    expect(await runInteractionFeedbackPipeline(setup().deps, empty, context)).toMatchObject({ status: "RECORDED_WITHOUT_WRITER", delivery: { disposition: empty.status === "INSUFFICIENT_EVIDENCE" ? "BLOCKED" : "NOTHING_TO_DELIVER" } })
    expect(summarizeRunDelivery("INSUFFICIENT_EVIDENCE", [])).toEqual({ disposition: "BLOCKED", counts: { AUTO_DELIVER: 0, HOLD_FOR_QA: 0, BLOCKED: 0 } })
    expect(summarizeRunDelivery("NOTHING_MATERIAL", [])).toMatchObject({ disposition: "NOTHING_TO_DELIVER" })
  })
  it("política de autonomia (teste controlado) → AUTO_DELIVER sem depender de QA: redação NOT_SELECTED_FOR_QA, fora da fila, entregável pelo gate", async () => {
    const { memory, deps } = setup(good, true, AUTONOMY_TEST_POLICY)
    const result = await runInteractionFeedbackPipeline(deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(result.decisions[0]!.decision).toEqual({ disposition: "AUTO_DELIVER", structural: "STRUCTURALLY_DELIVERABLE", reasons: ["AUTONOMY_CRITERIA_MET"], policyVersion: "FEEDBACK_DELIVERY_POLICY_TEST_AUTONOMY", autonomyEligible: true, autonomyBlockers: [] })
    expect(result.reviews[0]).toMatchObject({ reviewStatus: "NOT_SELECTED_FOR_QA", reviewRequiredBy: [] })
    expect(await deliverableItems(memory.store, ORG, result.runId)).toEqual([expect.objectContaining({ disposition: "AUTO_DELIVER", qaStatus: "NOT_SELECTED_FOR_QA", wording: result.reviews[0]!.proposedWording })])
    // Não há avaliação a fazer num item não selecionado.
    expect(await decideItemReview({ store: memory.store, now: NOW }, { organizationId: ORG, reviewId: result.reviews[0]!.id, reviewerId: reviewer, decision: "REJECTED", reasonCategory: "TONE" })).toEqual({ ok: false, error: "NOT_SELECTED_FOR_QA" })
  })
  it("autonomia exige Writer PASS e validadores PASS: fallback ou redator com erro → HOLD_FOR_QA com o motivo", async () => {
    const rejected = await runInteractionFeedbackPipeline(setup(() => ({ items: [] }), true, AUTONOMY_TEST_POLICY).deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (rejected.status !== "RECORDED") throw new Error(rejected.status)
    expect(rejected.decisions[0]!.decision).toMatchObject({ disposition: "HOLD_FOR_QA", autonomyEligible: false, reasons: ["WRITER_FALLBACK_USED", "WRITER_VALIDATION_FAILED"] })
    const failed = await runInteractionFeedbackPipeline(setup(() => { throw new Error("boom") }, true, AUTONOMY_TEST_POLICY).deps, compose(frame([action], [finding("STRENGTH", [action])])), context)
    if (failed.status !== "RECORDED") throw new Error(failed.status)
    expect(failed.decisions[0]!.decision.reasons).toEqual(expect.arrayContaining(["WRITER_NOT_PASSED", "WRITER_FALLBACK_USED"]))
    expect(failed.reviews[0]!.reviewStatus).toBe("PENDING_REVIEW")
  })
  it("política de risco pode exigir QA mesmo com os critérios atendidos", async () => {
    const policy = { ...AUTONOMY_TEST_POLICY, requireQaForSections: ["OPPORTUNITY"] as const }
    const result = await runInteractionFeedbackPipeline(setup(good, true, policy).deps, compose(frame([action, statement, signal], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal])])), context)
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(result.decisions.map((entry) => [entry.section, entry.decision.disposition, entry.decision.reasons])).toEqual([["STRENGTH", "AUTO_DELIVER", ["AUTONOMY_CRITERIA_MET"]], ["OPPORTUNITY", "HOLD_FOR_QA", ["RISK_POLICY_SECTION"]]])
    expect(result.delivery).toEqual({ disposition: "AUTO_DELIVER", counts: { AUTO_DELIVER: 1, HOLD_FOR_QA: 1, BLOCKED: 0 } })
  })
  it("deliverable × QA × entregue: QA nunca desbloqueia BLOCKED; REJECTED nunca sai; entrega real é um estado próprio", () => {
    expect(deliveryStateOf("BLOCKED", "APPROVED_UNCHANGED", null)).toBe("BLOCKED")
    expect(deliveryStateOf("HOLD_FOR_QA", "PENDING_REVIEW", null)).toBe("AWAITING_QA")
    expect(deliveryStateOf("HOLD_FOR_QA", "APPROVED_EDITED", null)).toBe("READY_FOR_DELIVERY")
    expect(deliveryStateOf("HOLD_FOR_QA", "REJECTED", null)).toBe("QA_REJECTED")
    expect(deliveryStateOf("AUTO_DELIVER", "NOT_SELECTED_FOR_QA", null)).toBe("READY_FOR_DELIVERY")
    expect(deliveryStateOf("AUTO_DELIVER", "REJECTED", null)).toBe("QA_REJECTED")
    expect(deliveryStateOf("AUTO_DELIVER", "NOT_SELECTED_FOR_QA", new Date())).toBe("DELIVERED")
  })
})
