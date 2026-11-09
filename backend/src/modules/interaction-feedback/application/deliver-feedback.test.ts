import { describe, expect, it, vi } from "vitest"
import { composeInteractionFeedback, INTERNAL_REF_PATTERN, type ProceduralLineage } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import type { InteractionFinding, InteractionSemanticFrame, SemanticObservation } from "../../investigation/domain/interaction-semantic-frame.js"
import { FEEDBACK_PILOT_DELIVERY_POLICY, type FeedbackDeliveryPolicy } from "../domain/feedback-delivery-policy.js"
import { wordingSha256 } from "../domain/feedback-delivery-eligibility.js"
import { createInMemoryFeedbackDeliveryStore } from "../testing/in-memory-feedback-delivery-store.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { acknowledgeFeedbackDelivery, deliverFeedbackItem, deliverReadyFeedbackItems, listMyFeedbackDeliveries } from "./deliver-feedback.js"
import { decideItemReview, runInteractionFeedbackPipeline } from "./interaction-feedback-pipeline.js"

const ORG = "00000000-0000-4000-8000-000000000001"
const COLLABORATOR = "22222222-2222-4222-8222-222222222222"
const OTHER = "22222222-2222-4222-8222-000000000099"
const REVIEWER = "33333333-3333-4333-8333-333333333333"
const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
const obs = (id: string, kind: SemanticObservation["kind"], speaker: string, turn: string, quote: string): SemanticObservation => ({ id, kind, summary: `RESUMO-DO-MODELO ${id}`, evidence: [unit(turn, speaker, quote)] })
let seq = 0
const finding = (kind: InteractionFinding["kind"], observations: SemanticObservation[], extra: Partial<InteractionFinding> = {}): InteractionFinding => { seq += 1; return { id: `F${seq}`, interactionRef: "I6", kind, summary: "SUMMARY", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${seq}`, ownership: "AGENT", ...extra } }
const frame = (observations: SemanticObservation[], findings: InteractionFinding[]): InteractionSemanticFrame => ({ interactionRef: "I6", interactionId: "0f0e0d0c-0000-4000-8000-000000000006", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: observations.filter((item) => item.kind === "AGENT_ACTION") as never, agentStatements: observations.filter((item) => item.kind === "AGENT_STATEMENT") as never, commitments: [], customerSignals: observations.filter((item) => item.kind === "CUSTOMER_SIGNAL") as never, procedureAssertions: observations.filter((item) => item.kind === "PROCEDURE_ASSERTION") as never, interactionEvents: [], findings, empty: false })
const compose = (f: InteractionSemanticFrame, lineage?: Map<string, ProceduralLineage>) => composeInteractionFeedback({ subject: { collaboratorRef: "C-1" }, frame: f, interactionLabel: "14/03/2026", sourceRun: "run-1", proceduralLineage: lineage })

const action = obs("A1", "AGENT_ACTION", "OPERADOR", "T4", "Registrei tudo no protocolo 1234567890123, anota aí.")
const statement = obs("D1", "AGENT_STATEMENT", "OPERADOR", "T19", "Isso é o ciclo de faturamento retroativo com pro rata do upgrade.")
const signal = obs("S1", "CUSTOMER_SIGNAL", "CLIENTE", "T20", "Pro rata? Moça, fala em português, por favor.")
const assertion = obs("P1", "PROCEDURE_ASSERTION", "OPERADOR", "T15", "Não precisa explicar, vou refazer por aqui.")
const kbLineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Procedimento de Validação", ruleQuote: "O operador deve explicar a validação.", documentId: "11111111-2222-4333-8444-555555555555" }]])
const divergence = () => finding("PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Procedimento de Validação", reason: "" } })

const WRITTEN = { STRENGTH: { observed: "Nesta conversa você informou o protocolo ao cliente.", whyItMatters: "Isso pode ajudar o cliente a acompanhar o atendimento.", whatYouCanDo: "Continue informando o protocolo ao final do atendimento." }, OPPORTUNITY: { observed: "Nesta conversa o cliente disse que não entendeu o termo usado.", whyItMatters: "Palavras do dia a dia podem facilitar a compreensão.", whatYouCanDo: "Sugestão: explique o termo com um exemplo simples." } }
const good = (input: FeedbackWriterInputV1) => ({ items: input.items.map((item) => ({ slot: item.slot, ...WRITTEN[item.section] })) })
const AUTONOMY: FeedbackDeliveryPolicy = { ...FEEDBACK_PILOT_DELIVERY_POLICY, version: "FEEDBACK_DELIVERY_POLICY_TEST_AUTONOMY", holdAllForQa: false, note: "só teste" }
let clockTick = 0
const now = () => new Date(Date.UTC(2026, 8, 24, 12, 0, clockTick++))

async function scenario(options: { writer?: (input: FeedbackWriterInputV1) => unknown; policy?: FeedbackDeliveryPolicy; feedback?: ReturnType<typeof compose> } = {}) {
  const memory = createInMemoryInteractionFeedbackStore()
  const deliveries = createInMemoryFeedbackDeliveryStore(memory)
  const writer = { calls: 0, async write(input: FeedbackWriterInputV1) { writer.calls += 1; return { rawOutput: (options.writer ?? good)(input) } } }
  const feedback = options.feedback ?? compose(frame([action, statement, signal], [finding("STRENGTH", [action]), finding("FRICTION", [statement, signal])]))
  const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store: memory.store, now, deliveryPolicy: options.policy ?? FEEDBACK_PILOT_DELIVERY_POLICY }, feedback, { organizationId: ORG, collaboratorId: COLLABORATOR, teamId: null, interactionId: null, occurredAt: new Date("2026-03-14T12:00:00Z") })
  if (result.status === "SKIPPED_FLAG_OFF") throw new Error(result.status)
  const deps = { deliveries: deliveries.store, now }
  const reviewOf = (section: "STRENGTH" | "OPPORTUNITY") => (result.status === "RECORDED" ? result.reviews.find((review) => review.section === section)! : undefined)!
  const qa = (reviewId: string, input: Omit<Parameters<typeof decideItemReview>[1], "organizationId" | "reviewId" | "reviewerId">) => decideItemReview({ store: memory.store, now }, { organizationId: ORG, reviewId, reviewerId: REVIEWER, ...input })
  return { memory, deliveries, deps, result, reviewOf, qa, writer }
}

describe("V1.5.6 — entrega ao Acompanhamento: caminho do piloto (QA → entrega)", () => {
  it("HOLD_FOR_QA + pendente → não entrega; aprovado sem edição → UMA entrega com o texto PROPOSTO", async () => {
    const s = await scenario()
    const strength = s.reviewOf("STRENGTH")
    expect(await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })).toEqual({ status: "NOT_ELIGIBLE", reason: "AWAITING_QA" })
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    await s.qa(strength.id, { decision: "APPROVED_UNCHANGED" })
    const outcome = await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })
    expect(outcome).toMatchObject({ status: "DELIVERED", delivery: { deliveryMode: "QA_APPROVED", wordingSource: "PROPOSED", proposedOrigin: "WRITER", qaStatus: "APPROVED_UNCHANGED", policyVersion: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", collaboratorId: COLLABORATOR, wordingSha256: wordingSha256(WRITTEN.STRENGTH), acknowledgedAt: null } })
    const mine = await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR })
    expect(mine).toHaveLength(1)
    expect(mine[0]!.blocks.map((block) => block.text)).toEqual([WRITTEN.STRENGTH.observed, WRITTEN.STRENGTH.whyItMatters, WRITTEN.STRENGTH.whatYouCanDo])
    // A decisão estrutural passa a registrar a entrega REAL (delivered_at) — sem mudar disposição nem motivos.
    expect(s.memory.decisions.find((entry) => entry.itemReviewId === strength.id)).toMatchObject({ deliveredAt: outcome.status === "DELIVERED" ? outcome.delivery.deliveredAt : null, decision: { disposition: "HOLD_FOR_QA" } })
    expect(s.writer.calls).toBe(1)
  })
  it("aprovado com edição → entrega o texto FINAL do QA (a origem continua intacta)", async () => {
    const s = await scenario()
    const opportunity = s.reviewOf("OPPORTUNITY")
    const edited = { observed: "Você usou o termo \"pro rata\" e o cliente disse que não entendeu.", whyItMatters: WRITTEN.OPPORTUNITY.whyItMatters, whatYouCanDo: WRITTEN.OPPORTUNITY.whatYouCanDo }
    await s.qa(opportunity.id, { decision: "APPROVED_EDITED", finalWording: edited, reasonCategory: "FACTUAL_OVERCLAIM" })
    expect(await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: opportunity.id })).toMatchObject({ status: "DELIVERED", delivery: { wordingSource: "HUMAN_EDITED", qaStatus: "APPROVED_EDITED", wordingSha256: wordingSha256(edited) } })
    expect((await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR }))[0]!.blocks[0]!.text).toBe(edited.observed)
    expect(s.memory.reviews.get(opportunity.id)!.proposedWording).toEqual(WRITTEN.OPPORTUNITY)
  })
  it("rejeitado no QA → nenhuma execução posterior entrega (chamada direta nem varredor)", async () => {
    const s = await scenario()
    const strength = s.reviewOf("STRENGTH")
    await s.qa(strength.id, { decision: "REJECTED", reasonCategory: "TOO_GENERIC" })
    expect(await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })).toEqual({ status: "NOT_ELIGIBLE", reason: "QA_REJECTED" })
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    expect(s.deliveries.deliveries).toEqual([])
  })
  it("fallback: vai para QA no piloto; se o QA aprovar explicitamente, é entregue com a origem registrada — sem detalhe técnico ao colaborador", async () => {
    const s = await scenario({ writer: () => ({ items: [] }) })
    const strength = s.reviewOf("STRENGTH")
    expect(strength.wordingSource).toBe("FALLBACK")
    await s.qa(strength.id, { decision: "APPROVED_UNCHANGED" })
    expect(await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })).toMatchObject({ status: "DELIVERED", delivery: { proposedOrigin: "FALLBACK", deliveryMode: "QA_APPROVED" } })
    expect(JSON.stringify(await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR }))).not.toMatch(/fallback|FALLBACK|WRITER/i)
  })
  it("procedimental bloqueado → BLOCKED, sem redação: nenhum caminho de entrega existe (o varredor nem o enxerga)", async () => {
    const s = await scenario({ feedback: compose(frame([action, assertion], [finding("STRENGTH", [action]), divergence()]), kbLineage) })
    const blocked = s.memory.decisions.find((entry) => entry.findingKind === "PROCEDURAL_DIVERGENCE")!
    expect(blocked).toMatchObject({ itemReviewId: null, decision: { disposition: "BLOCKED" } })
    await s.qa(s.reviewOf("STRENGTH").id, { decision: "APPROVED_UNCHANGED" })
    await deliverReadyFeedbackItems(s.deps)
    const mine = await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR })
    expect(mine.map((entry) => entry.section)).toEqual(["STRENGTH"])
    expect(JSON.stringify(mine)).not.toMatch(/Procedimento de Validação|materiais|KR3|K5/)
  })
})

describe("V1.5.6 — caminho autônomo (política de TESTE; o runtime continua no piloto)", () => {
  it("AUTO_DELIVER → o varredor (forma do futuro worker) entrega SEM QA", async () => {
    const s = await scenario({ policy: AUTONOMY, feedback: compose(frame([action], [finding("STRENGTH", [action])])) })
    const strength = s.reviewOf("STRENGTH")
    expect(strength.reviewStatus).toBe("NOT_SELECTED_FOR_QA")
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 1, alreadyDelivered: 0, failed: 0 })
    expect(s.deliveries.deliveries).toEqual([expect.objectContaining({ deliveryMode: "AUTONOMOUS", qaStatus: "NOT_SELECTED_FOR_QA", wordingSource: "PROPOSED", policyVersion: "FEEDBACK_DELIVERY_POLICY_TEST_AUTONOMY" })])
    expect(s.memory.reviews.get(strength.id)!.reviewedBy).toBeNull()
  })
  it("fallback nunca é AUTO_DELIVER na política atual (vai para QA) e não sai sozinho", async () => {
    const s = await scenario({ policy: AUTONOMY, writer: () => ({ items: [] }), feedback: compose(frame([action], [finding("STRENGTH", [action])])) })
    expect(s.memory.decisions[0]!.decision.disposition).toBe("HOLD_FOR_QA")
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
  })
})

describe("V1.5.6 — exatamente uma vez", () => {
  it("chamada repetida, retry após sucesso e varredor depois → 1 conteúdo", async () => {
    const s = await scenario()
    const strength = s.reviewOf("STRENGTH")
    await s.qa(strength.id, { decision: "APPROVED_UNCHANGED" })
    const first = await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })
    const again = await deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })
    expect(again).toEqual({ status: "ALREADY_DELIVERED", delivery: first.status === "DELIVERED" ? first.delivery : null })
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    expect(s.deliveries.deliveries).toHaveLength(1)
  })
  it("corrida: execuções concorrentes (duplo clique, dois jobs, duas instâncias) → exatamente 1 DELIVERED", async () => {
    const s = await scenario()
    const strength = s.reviewOf("STRENGTH")
    await s.qa(strength.id, { decision: "APPROVED_UNCHANGED" })
    const outcomes = await Promise.all([1, 2, 3, 4].map(() => deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })))
    expect(outcomes.filter((entry) => entry.status === "DELIVERED")).toHaveLength(1)
    expect(outcomes.filter((entry) => entry.status === "ALREADY_DELIVERED")).toHaveLength(3)
    expect(s.deliveries.deliveries).toHaveLength(1)
  })
  it("falha técnica ao gravar → nada marcado como entregue, QA intacto, sem redator; retry idempotente entrega uma vez", async () => {
    const s = await scenario()
    const strength = s.reviewOf("STRENGTH")
    await s.qa(strength.id, { decision: "APPROVED_UNCHANGED" })
    s.deliveries.control.failNextRecord = true
    await expect(deliverFeedbackItem(s.deps, { organizationId: ORG, itemReviewId: strength.id })).rejects.toThrow(/falha simulada/)
    expect(s.deliveries.deliveries).toEqual([])
    expect(s.memory.decisions.find((entry) => entry.itemReviewId === strength.id)!.deliveredAt).toBeNull()
    expect(s.memory.reviews.get(strength.id)!.reviewStatus).toBe("APPROVED_UNCHANGED")
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 1, alreadyDelivered: 0, failed: 0 })
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 0 })
    expect(s.deliveries.deliveries).toHaveLength(1)
    expect(s.writer.calls).toBe(1)
  })
})

describe("V1.5.6 — o que o colaborador vê e a ciência", () => {
  it("só as próprias entregas; nada técnico (QA, IA, política, hashes, refs, provenance, dono, escopo, incerteza)", async () => {
    const s = await scenario()
    for (const section of ["STRENGTH", "OPPORTUNITY"] as const) await s.qa(s.reviewOf(section).id, { decision: "APPROVED_UNCHANGED" })
    await deliverReadyFeedbackItems(s.deps)
    const mine = await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR })
    expect(mine.map((entry) => [entry.title, entry.sectionLabel])).toEqual(expect.arrayContaining([["Feedback de atendimento", "Ponto positivo"], ["Feedback de atendimento", "Ponto de atenção"]]))
    expect(mine.find((entry) => entry.section === "STRENGTH")!.blocks.map((block) => block.label)).toEqual(["O que foi observado", "Por que isso importa", "O que você pode continuar fazendo"])
    expect(mine.find((entry) => entry.section === "OPPORTUNITY")!.blocks.map((block) => block.label)).toEqual(["O que foi observado", "Por que isso importa", "O que você pode fazer"])
    // Evidência: só a projeção de display, curta e mascarada.
    expect(mine.find((entry) => entry.section === "STRENGTH")!.evidence).toEqual([{ speakerLabel: "Você", text: "Registrei tudo no protocolo [PROTOCOLO], anota aí.", truncated: false }])
    const text = JSON.stringify(mine.map((entry) => ({ ...entry, id: "x", deliveredAt: "x", interactionAt: "x" })))
    expect(text).not.toMatch(INTERNAL_REF_PATTERN)
    expect(text).not.toMatch(/1234567890123|QA|Gemini|\bIA\b|policy|POLICY|sha|provenance|ownership|AGENT|INTERACTION_SPECIFIC|incerteza|única interação|RESUMO-DO-MODELO|SUMMARY|writer|WRITER|fallback|reviewer|revis/i)
    expect(await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: OTHER })).toEqual([])
    expect(await listMyFeedbackDeliveries(s.deps, { organizationId: "00000000-0000-4000-8000-00000000beef", personId: COLLABORATOR })).toEqual([])
  })
  it("entregue ≠ lido: ciência só do próprio colaborador, idempotente; de outra pessoa = 404", async () => {
    const s = await scenario()
    await s.qa(s.reviewOf("STRENGTH").id, { decision: "APPROVED_UNCHANGED" })
    await deliverReadyFeedbackItems(s.deps)
    const delivery = s.deliveries.deliveries[0]!
    expect(delivery.acknowledgedAt).toBeNull()
    await expect(acknowledgeFeedbackDelivery(s.deps, { organizationId: ORG, personId: OTHER }, delivery.id)).rejects.toMatchObject({ code: "FEEDBACK_DELIVERY_NOT_FOUND", statusCode: 404 })
    const first = await acknowledgeFeedbackDelivery(s.deps, { organizationId: ORG, personId: COLLABORATOR }, delivery.id)
    expect(await acknowledgeFeedbackDelivery(s.deps, { organizationId: ORG, personId: COLLABORATOR }, delivery.id)).toEqual(first)
    expect((await listMyFeedbackDeliveries(s.deps, { organizationId: ORG, personId: COLLABORATOR }))[0]!.acknowledgedAt).toBe(first.acknowledgedAt)
  })
})

describe("V1.5.6 — falha técnica no varredor", () => {
  it("o item que falhou é contado e o motivo vai para o log; a rodada seguinte entrega (nada ficou marcado)", async () => {
    const s = await scenario({ policy: AUTONOMY, feedback: compose(frame([action], [finding("STRENGTH", [action])])) })
    const failure = new Error("connection timeout")
    const flaky = { ...s.deps.deliveries, recordDelivery: async () => { throw failure } }
    const logged = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await deliverReadyFeedbackItems({ ...s.deps, deliveries: flaky })).toEqual({ delivered: 0, alreadyDelivered: 0, failed: 1 })
      expect(logged).toHaveBeenCalledWith(expect.stringContaining(s.reviewOf("STRENGTH").id), failure)
    } finally {
      logged.mockRestore()
    }
    expect(await deliverReadyFeedbackItems(s.deps)).toEqual({ delivered: 1, alreadyDelivered: 0, failed: 0 })
  })
})
