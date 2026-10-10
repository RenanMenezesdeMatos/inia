import { describe, expect, it } from "vitest"
import { composeInteractionFeedback, type ProceduralLineage } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import type { InteractionFinding, InteractionSemanticFrame, SemanticObservation } from "../../investigation/domain/interaction-semantic-frame.js"
import { evaluateFeedbackDelivery } from "../domain/feedback-delivery-eligibility.js"
import { FEEDBACK_AUTONOMOUS_DELIVERY_POLICY, FEEDBACK_DELIVERY_POLICIES, FEEDBACK_PILOT_DELIVERY_POLICY, type FeedbackDeliveryPolicy } from "../domain/feedback-delivery-policy.js"
import { createInMemoryFeedbackDeliveryStore } from "../testing/in-memory-feedback-delivery-store.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { deliverFeedbackItem, deliverReadyFeedbackItems, listMyFeedbackDeliveries } from "./deliver-feedback.js"
import { decideItemReview, runInteractionFeedbackPipeline } from "./interaction-feedback-pipeline.js"

/**
 * V1.5.9 — FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1: QA é EXCEÇÃO. Claro e seguro → AUTO_DELIVER (vai ao Acompanhamento sem
 * revisão humana); ambíguo → HOLD_FOR_QA com motivo estruturado; inseguro → BLOCKED (QA não desbloqueia). Zero modelo:
 * redator falso com os contratos existentes.
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const COLLABORATOR = "22222222-2222-4222-8222-222222222222"
const REVIEWER = "33333333-3333-4333-8333-333333333333"
const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
const obs = (id: string, kind: SemanticObservation["kind"], speaker: string, turn: string, quote: string): SemanticObservation => ({ id, kind, summary: `RESUMO-DO-MODELO ${id}`, evidence: [unit(turn, speaker, quote)] })
let seq = 0
const finding = (kind: InteractionFinding["kind"], observations: SemanticObservation[], extra: Partial<InteractionFinding> = {}): InteractionFinding => { seq += 1; return { id: `F${seq}`, interactionRef: "I6", kind, summary: "SUMMARY", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${seq}`, ownership: "AGENT", ...extra } }
const frame = (observations: SemanticObservation[], findings: InteractionFinding[]): InteractionSemanticFrame => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", source: "MODEL", customerNeeds: observations.filter((item) => item.kind === "CUSTOMER_NEED") as never, questions: [], answers: [], agentActions: observations.filter((item) => item.kind === "AGENT_ACTION") as never, agentStatements: observations.filter((item) => item.kind === "AGENT_STATEMENT") as never, commitments: [], customerSignals: observations.filter((item) => item.kind === "CUSTOMER_SIGNAL") as never, procedureAssertions: observations.filter((item) => item.kind === "PROCEDURE_ASSERTION") as never, interactionEvents: [], findings, empty: false })
const compose = (f: InteractionSemanticFrame, lineage?: Map<string, ProceduralLineage>) => composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: f, interactionLabel: "14/03/2026", sourceRun: "run-1", proceduralLineage: lineage })

// Evidência literal clara (sem número longo, sem procedimento).
const informed = obs("A1", "AGENT_ACTION", "OPERADOR", "T4", "Vou te passar o prazo: são até cinco dias úteis para a análise.")
const jargon = obs("D1", "AGENT_STATEMENT", "OPERADOR", "T19", "Isso é o ciclo de faturamento retroativo com pro rata do upgrade.")
const confused = obs("S1", "CUSTOMER_SIGNAL", "CLIENTE", "T20", "Pro rata? Moça, fala em português, por favor.")
const saidTen = obs("D2", "AGENT_STATEMENT", "OPERADOR", "T8", "O valor da multa de cancelamento é de cento e dez reais.")
const saidZero = obs("D3", "AGENT_STATEMENT", "OPERADOR", "T12", "Nesse caso não existe multa nenhuma para cancelar o seu plano.")
const assertion = obs("P1", "PROCEDURE_ASSERTION", "OPERADOR", "T15", "Não precisa explicar a validação, vou refazer por aqui mesmo.")
const onlyNumber = obs("A9", "AGENT_ACTION", "OPERADOR", "T30", "Anota aí: 98765432109876.")
const kbLineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "O operador deve explicar a validação.", documentId: "11111111-2222-4333-8444-555555555555" }]])
const divergence = () => finding("PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })

const WRITTEN = { STRENGTH: { observed: "Nesta conversa você informou ao cliente o prazo da análise.", whyItMatters: "Isso pode ajudar o cliente a saber o que esperar.", whatYouCanDo: "Continue informando o prazo com clareza." }, OPPORTUNITY: { observed: "Nesta conversa o cliente disse que não entendeu o termo usado.", whyItMatters: "Palavras do dia a dia podem facilitar a compreensão.", whatYouCanDo: "Sugestão: explique o termo com um exemplo simples." } }
const good = (input: FeedbackWriterInputV1) => ({ items: input.items.map((item) => ({ slot: item.slot, ...WRITTEN[item.section] })) })
let tick = 0
const now = () => new Date(Date.UTC(2026, 8, 25, 12, 0, tick++))

async function run(feedback: ReturnType<typeof compose>, options: { writer?: (input: FeedbackWriterInputV1) => unknown; policy?: FeedbackDeliveryPolicy } = {}) {
  const memory = createInMemoryInteractionFeedbackStore()
  const deliveries = createInMemoryFeedbackDeliveryStore(memory)
  const writer = { calls: 0, async write(input: FeedbackWriterInputV1) { writer.calls += 1; return { rawOutput: (options.writer ?? good)(input) } } }
  const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store: memory.store, now, deliveryPolicy: options.policy ?? FEEDBACK_AUTONOMOUS_DELIVERY_POLICY }, feedback, { organizationId: ORG, collaboratorId: COLLABORATOR, teamId: null, interactionId: null, occurredAt: new Date("2026-03-14T12:00:00Z") })
  if (result.status === "SKIPPED_FLAG_OFF") throw new Error(result.status)
  const decisions = result.decisions.map((entry) => ({ kind: entry.findingKind, section: entry.section, disposition: entry.decision.disposition, reasons: entry.decision.reasons, policy: entry.decision.policyVersion, autonomyEligible: entry.decision.autonomyEligible, reviewId: entry.itemReviewId }))
  const deps = { deliveries: deliveries.store, now }
  return { memory, deps, result, decisions, writer }
}

describe("V1.5.9 — política autônoma: QA é exceção", () => {
  it("é uma política NOVA e versionada; a PILOT_V1 histórica não mudou", () => {
    expect(FEEDBACK_AUTONOMOUS_DELIVERY_POLICY.version).toBe("FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1")
    expect(FEEDBACK_DELIVERY_POLICIES).toEqual({ PILOT_V1: FEEDBACK_PILOT_DELIVERY_POLICY, AUTONOMOUS_V1: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY })
    expect(FEEDBACK_PILOT_DELIVERY_POLICY).toEqual({ version: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", holdAllForQa: true, requireQaForSections: [], requireQaForFindingKinds: [], autonomyOwnership: ["AGENT"], nonBlockingUncertainties: ["SINGLE_INTERACTION"], note: FEEDBACK_PILOT_DELIVERY_POLICY.note })
    expect(FEEDBACK_AUTONOMOUS_DELIVERY_POLICY.postDeliveryAudit?.sampleRate).toBe(0)
  })

  it("A) STRENGTH claro + evidência READY + Writer PASS + validadores PASS → AUTO_DELIVER (não exige QA por ser do Writer)", async () => {
    const { decisions, result } = await run(compose(frame([informed], [finding("STRENGTH", [informed])])))
    expect(decisions).toEqual([expect.objectContaining({ kind: "STRENGTH", disposition: "AUTO_DELIVER", reasons: ["AUTONOMY_CRITERIA_MET"], policy: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1", autonomyEligible: true })])
    expect(result.status === "RECORDED" && result.reviews.map((review) => review.reviewStatus)).toEqual(["NOT_SELECTED_FOR_QA"])
  })

  it("B) OPPORTUNITY (FRICTION) claro + evidência READY + coaching não normativo + Writer/validadores PASS → AUTO_DELIVER (ponto de atenção não vai sempre ao humano)", async () => {
    const { decisions } = await run(compose(frame([jargon, confused], [finding("FRICTION", [jargon, confused])])))
    expect(decisions).toEqual([expect.objectContaining({ kind: "FRICTION", section: "OPPORTUNITY", disposition: "AUTO_DELIVER", reasons: ["AUTONOMY_CRITERIA_MET"] })])
  })

  it("C) fallback NUNCA é AUTO_DELIVER: texto que viola a fronteira de efeito → HOLD_FOR_QA com motivos estruturados; erro do redator → HOLD_FOR_QA", async () => {
    const violating = await run(compose(frame([informed], [finding("STRENGTH", [informed])])), { writer: (input) => ({ items: input.items.map((item) => ({ slot: item.slot, observed: "Nesta conversa você informou o prazo.", whyItMatters: "Isso garante que o cliente entendeu tudo.", whatYouCanDo: "Continue assim." })) }) })
    expect(violating.decisions[0]).toMatchObject({ disposition: "HOLD_FOR_QA", autonomyEligible: false })
    expect(violating.decisions[0]!.reasons).toEqual(expect.arrayContaining(["WRITER_FALLBACK_USED", "WRITER_VALIDATION_FAILED", "EFFECT_CLAIM_BOUNDARY_VIOLATED"]))
    expect(await deliverFeedbackItem(violating.deps, { organizationId: ORG, itemReviewId: violating.decisions[0]!.reviewId! })).toEqual({ status: "NOT_ELIGIBLE", reason: "AWAITING_QA" })
    const failed = await run(compose(frame([informed], [finding("STRENGTH", [informed])])), { writer: () => { throw new Error("boom") } })
    expect(failed.decisions[0]).toMatchObject({ disposition: "HOLD_FOR_QA" })
    expect(failed.decisions[0]!.reasons).toEqual(expect.arrayContaining(["WRITER_NOT_PASSED", "WRITER_FALLBACK_USED"]))
  })

  it("D) procedimental (divergência com lineage) → BLOCKED por PROCEDURAL_MATCHING_NOT_VALIDATED", async () => {
    const { decisions } = await run(compose(frame([informed, assertion], [finding("STRENGTH", [informed]), divergence()]), kbLineage))
    expect(decisions.find((entry) => entry.kind === "PROCEDURAL_DIVERGENCE")).toMatchObject({ disposition: "BLOCKED", reasons: ["PROCEDURAL_MATCHING_NOT_VALIDATED"], autonomyEligible: null, reviewId: null })
    // …e não contamina o STRENGTH claro da mesma interação.
    expect(decisions.find((entry) => entry.kind === "STRENGTH")).toMatchObject({ disposition: "AUTO_DELIVER" })
  })

  it("E) evidência exibível insuficiente (só um número retido) → BLOCKED", async () => {
    const { decisions } = await run(compose(frame([onlyNumber], [finding("STRENGTH", [onlyNumber])])))
    expect(decisions).toEqual([expect.objectContaining({ disposition: "BLOCKED", reasons: ["INSUFFICIENT_DISPLAY_EVIDENCE"], reviewId: null })])
  })

  it("F) ambíguo/configurado → HOLD_FOR_QA com motivo: CONTRADICTION (tipo não liberado) e evidência que é afirmação de procedimento não verificada", async () => {
    const contradiction = await run(compose(frame([saidTen, saidZero], [finding("CONTRADICTION", [saidTen, saidZero])])))
    expect(contradiction.decisions).toEqual([expect.objectContaining({ kind: "CONTRADICTION", disposition: "HOLD_FOR_QA", reasons: ["FINDING_KIND_NOT_RELEASED_FOR_AUTONOMY"], autonomyEligible: true })])
    const procedural = await run(compose(frame([assertion, confused], [finding("FRICTION", [assertion, confused])])))
    expect(procedural.decisions).toEqual([expect.objectContaining({ kind: "FRICTION", disposition: "HOLD_FOR_QA", reasons: ["ITEM_EVIDENCE_UNVERIFIED_PROCEDURE_ASSERTION"] })])
    // Toda decisão HOLD_FOR_QA tem motivo; nunca "por segurança" sem motivo.
    for (const entry of [...contradiction.decisions, ...procedural.decisions]) expect(entry.reasons.length).toBeGreaterThan(0)
  })

  it("incerteza da INTERAÇÃO que não toca o item (irmão excluído) não manda o item claro para QA — no piloto mandava", async () => {
    const withExcluded = compose(frame([informed], [finding("STRENGTH", [informed]), finding("STRENGTH", [], { evidence: [] })]))
    expect(withExcluded.uncertainties.map((entry) => entry.code)).toContain("ITEMS_EXCLUDED")
    const autonomous = await run(withExcluded)
    expect(autonomous.decisions.filter((entry) => entry.disposition !== "BLOCKED")).toEqual([expect.objectContaining({ disposition: "AUTO_DELIVER" })])
  })

  it("G) AUTO_DELIVER → entrega → Acompanhamento, SEM revisão humana (modo AUTONOMOUS, texto do redator)", async () => {
    const s = await run(compose(frame([informed, jargon, confused], [finding("STRENGTH", [informed]), finding("FRICTION", [jargon, confused])])))
    expect(s.decisions.map((entry) => entry.disposition)).toEqual(["AUTO_DELIVER", "AUTO_DELIVER"])
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 2, alreadyDelivered: 0, failed: 0 })
    const mine = await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR })
    expect(mine).toHaveLength(2)
    expect(mine.map((entry) => entry.blocks[0]!.text).sort()).toEqual([WRITTEN.OPPORTUNITY.observed, WRITTEN.STRENGTH.observed].sort())
    expect([...s.memory.reviews.values()].every((review) => review.reviewStatus === "NOT_SELECTED_FOR_QA" && review.reviewedBy === null)).toBe(true)
    expect(s.memory.decisions.every((entry) => entry.deliveredAt !== null)).toBe(true)
    // Exatamente uma vez: uma nova varredura não entrega de novo.
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    expect(s.writer.calls).toBe(1)
  })

  it("H) HOLD_FOR_QA → só entrega depois da decisão de QA (aprovado → QA_APPROVED; rejeitado → nunca)", async () => {
    const s = await run(compose(frame([saidTen, saidZero], [finding("CONTRADICTION", [saidTen, saidZero])])))
    const reviewId = s.decisions[0]!.reviewId!
    expect(await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: reviewId })).toEqual({ status: "NOT_ELIGIBLE", reason: "AWAITING_QA" })
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    await decideItemReview({ store: s.memory.store, now }, { organizationId: ORG, reviewId, reviewerId: REVIEWER, decision: "APPROVED_UNCHANGED" })
    expect(await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: reviewId })).toMatchObject({ status: "DELIVERED", delivery: { deliveryMode: "QA_APPROVED", qaStatus: "APPROVED_UNCHANGED", policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" } })
    const rejected = await run(compose(frame([saidTen, saidZero], [finding("CONTRADICTION", [saidTen, saidZero])])))
    await decideItemReview({ store: rejected.memory.store, now }, { organizationId: ORG, reviewId: rejected.decisions[0]!.reviewId!, reviewerId: REVIEWER, decision: "REJECTED", reasonCategory: "TONE" })
    expect(await deliverReadyFeedbackItems(rejected.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
  })

  it("I) BLOCKED nunca entrega, mesmo com tentativa de QA: não há item de QA e uma aprovação forjada continua BLOCKED", async () => {
    const s = await run(compose(frame([onlyNumber], [finding("STRENGTH", [onlyNumber])])))
    expect(s.decisions[0]).toMatchObject({ disposition: "BLOCKED", reviewId: null })
    expect(s.memory.reviews.size).toBe(0)
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    const forged = evaluateFeedbackDelivery({ organizationId: ORG, itemReviewId: "r", decisionId: "d", runId: "run", collaboratorId: COLLABORATOR, structural: "BLOCKED", disposition: "BLOCKED", policyVersion: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY.version, qaStatus: "APPROVED_UNCHANGED", proposedOrigin: "WRITER", proposedWording: WRITTEN.STRENGTH, finalWording: null, deliveredAt: null })
    expect(forged).toEqual({ eligible: false, reason: "BLOCKED" })
  })

  it("mesma interação na PILOT_V1: tudo HOLD_FOR_QA (piloto preservado), mas a autonomia continua medida (autonomyEligible)", async () => {
    const { decisions } = await run(compose(frame([informed, jargon, confused], [finding("STRENGTH", [informed]), finding("FRICTION", [jargon, confused])])), { policy: FEEDBACK_PILOT_DELIVERY_POLICY })
    expect(decisions.map((entry) => [entry.disposition, entry.reasons, entry.autonomyEligible])).toEqual([["HOLD_FOR_QA", ["PILOT_HOLD_ALL_FOR_QA"], true], ["HOLD_FOR_QA", ["PILOT_HOLD_ALL_FOR_QA"], true]])
  })
})
