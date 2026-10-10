/**
 * PROVA contra o banco de TESTE real (V1.5.6): entrega do feedback de interação ao Acompanhamento — exatamente uma vez
 * com CONCORRÊNCIA REAL (várias conexões do pool ao mesmo tempo), rejeitado nunca entrega, constraints da 080 (autonomia
 * nunca entrega fallback; um registro por item), leitura só do próprio colaborador, ciência e varredor idempotente.
 * Diferente das outras provas, os dados são COMMITADOS (concorrência entre conexões exige) e apagados no fim (cascade pelo run).
 *   INIA_DB_PROOF=1 npx vitest run feedback-delivery-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { composeInteractionFeedback } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { acknowledgeFeedbackDelivery, deliverFeedbackItem, deliverReadyFeedbackItems, listMyFeedbackDeliveries } from "../application/deliver-feedback.js"
import { decideItemReview, runInteractionFeedbackPipeline } from "../application/interaction-feedback-pipeline.js"
import { FEEDBACK_AUTONOMOUS_DELIVERY_POLICY, FEEDBACK_PILOT_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"
import { loadFeedbackDeliveryMetrics } from "../infrastructure/postgres-feedback-delivery-metrics.js"
import { createPostgresFeedbackDeliveryStore } from "../infrastructure/postgres-feedback-delivery-store.js"
import { createPostgresInteractionFeedbackStore } from "../infrastructure/postgres-interaction-feedback-store.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
const created: { runId?: string; runIds: string[]; people: string[] } = { runIds: [], people: [] }

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "x", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
function feedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "s", evidence: [unit("T4", "OPERADOR", "O prazo é de até cinco dias úteis a partir de hoje.")] }
  const statement = { id: "D1", kind: "AGENT_STATEMENT", summary: "s", evidence: [unit("T9", "OPERADOR", "É o faturamento pro rata do ciclo.")] }
  const signal = { id: "S1", kind: "CUSTOMER_SIGNAL", summary: "s", evidence: [unit("T10", "CLIENTE", "Não entendi nada disso.")] }
  const finding = (id: string, kind: string, observations: { id: string; evidence: unknown[] }[]) => ({ id, interactionRef: "I6", kind, summary: "s", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF${id}`, ownership: "AGENT" })
  const frame = { interactionRef: "I6", interactionId: "x", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [statement], commitments: [], customerSignals: [signal], procedureAssertions: [], interactionEvents: [], empty: false, findings: [finding("1", "STRENGTH", [action]), finding("2", "FRICTION", [statement, signal])] }
  return composeInteractionFeedback({ subject: { collaboratorRef: "c" }, frame: frame as never, interactionLabel: "14/03/2026", sourceRun: "proof" })
}
const writer = { async write(input: FeedbackWriterInputV1) { return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "Nesta conversa você informou o prazo ao cliente.", whyItMatters: "Isso pode ajudar o cliente a se organizar.", whatYouCanDo: "Você pode manter essa prática em conversas parecidas." })) } } } }

describe.skipIf(!ENABLED)("Entrega ao Acompanhamento — prova Postgres (concorrência real, exatamente uma vez)", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 }) })
  afterAll(async () => {
    if (!pool) return
    if (created.runId) await pool.query("delete from interaction_feedback_runs where id = $1", [created.runId])
    if (created.runIds.length) await pool.query("delete from interaction_feedback_runs where id = any($1::uuid[])", [created.runIds])
    if (created.people.length) await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  it("QA aprova → 6 execuções simultâneas → 1 entrega; rejeitado nunca entrega; constraints; leitura e ciência", async () => {
    const org = (await pool.query<{ id: string }>("select id from organizations limit 1")).rows[0]!
    const insertPerson = async (name: string) => { const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, $2, 'OPERATOR') returning id", [org.id, name])).rows[0]!.id; created.people.push(id); return id }
    const operator = await insertPerson("Proof Entrega Operador")
    const reviewer = await insertPerson("Proof Entrega QA")
    const store = createPostgresInteractionFeedbackStore(pool)
    const now = () => new Date()
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store, now, deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), { organizationId: org.id, collaboratorId: operator, teamId: null, interactionId: null, occurredAt: new Date("2026-03-14T12:00:00Z") })
    if (result.status !== "RECORDED") throw new Error(result.status)
    created.runId = result.runId
    const strength = result.reviews.find((review) => review.section === "STRENGTH")!
    const opportunity = result.reviews.find((review) => review.section === "OPPORTUNITY")!
    const deps = { deliveries: createPostgresFeedbackDeliveryStore(pool), now }

    // Piloto: nada entrega antes do QA.
    expect(await deliverFeedbackItem(deps, { organizationId: org.id, itemReviewId: strength.id })).toEqual({ status: "NOT_ELIGIBLE", reason: "AWAITING_QA" })
    await decideItemReview({ store, now }, { organizationId: org.id, reviewId: strength.id, reviewerId: reviewer, decision: "APPROVED_UNCHANGED" })
    await decideItemReview({ store, now }, { organizationId: org.id, reviewId: opportunity.id, reviewerId: reviewer, decision: "REJECTED", reasonCategory: "TONE" })

    // Concorrência REAL: cada chamada usa o pool (conexões diferentes) ao mesmo tempo.
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => deliverFeedbackItem({ deliveries: createPostgresFeedbackDeliveryStore(pool), now }, { organizationId: org.id, itemReviewId: strength.id })))
    expect(outcomes.filter((entry) => entry.status === "DELIVERED")).toHaveLength(1)
    expect(outcomes.filter((entry) => entry.status === "ALREADY_DELIVERED")).toHaveLength(5)
    expect(await deliverFeedbackItem(deps, { organizationId: org.id, itemReviewId: opportunity.id })).toEqual({ status: "NOT_ELIGIBLE", reason: "QA_REJECTED" })
    const rows = (await pool.query("select item_review_id, delivery_mode, wording_source, proposed_origin, qa_status, policy_version from interaction_feedback_deliveries where run_id = $1", [result.runId])).rows
    expect(rows).toEqual([{ item_review_id: strength.id, delivery_mode: "QA_APPROVED", wording_source: "PROPOSED", proposed_origin: "WRITER", qa_status: "APPROVED_UNCHANGED", policy_version: "FEEDBACK_DELIVERY_POLICY_PILOT_V1" }])
    const decisions = (await pool.query("select item_review_id, disposition, delivered_at is not null delivered from interaction_feedback_delivery_decisions where run_id = $1 order by item_index", [result.runId])).rows
    expect(decisions).toEqual([{ item_review_id: strength.id, disposition: "HOLD_FOR_QA", delivered: true }, { item_review_id: opportunity.id, disposition: "HOLD_FOR_QA", delivered: false }])

    // Constraints (defesa em profundidade): segundo registro do mesmo item e autonomia com fallback são recusados pelo banco.
    const clone = `insert into interaction_feedback_deliveries (organization_id, collaborator_id, run_id, item_review_id, delivery_decision_id, delivery_mode, wording_source, proposed_origin, qa_status, policy_version, wording_sha256, delivered_at, created_at)
      select organization_id, collaborator_id, run_id, item_review_id, delivery_decision_id, $2, 'PROPOSED', $3, $4, policy_version, wording_sha256, now(), now() from interaction_feedback_deliveries where run_id = $1`
    await expect(pool.query(clone, [result.runId, "QA_APPROVED", "WRITER", "APPROVED_UNCHANGED"])).rejects.toThrow(/duplicate key|unique/)
    await expect(pool.query(clone, [result.runId, "AUTONOMOUS", "FALLBACK", "NOT_SELECTED_FOR_QA"])).rejects.toThrow(/check constraint|duplicate key/)

    // Varredor idempotente depois: nada novo.
    const swept = await deliverReadyFeedbackItems(deps)
    expect((await pool.query("select count(*)::int n from interaction_feedback_deliveries where run_id = $1", [result.runId])).rows[0].n).toBe(1)
    expect(swept.failed).toBe(0)

    // Leitura: só o próprio colaborador; ciência dele.
    const mine = await listMyFeedbackDeliveries(deps, { organizationId: org.id, personId: operator })
    expect(mine.map((entry) => [entry.sectionLabel, entry.blocks[0]!.text])).toEqual([["Ponto positivo", "Nesta conversa você informou o prazo ao cliente."]])
    expect(await listMyFeedbackDeliveries(deps, { organizationId: org.id, personId: reviewer })).toEqual([])
    await expect(acknowledgeFeedbackDelivery(deps, { organizationId: org.id, personId: reviewer }, mine[0]!.id)).rejects.toMatchObject({ statusCode: 404 })
    const ack = await acknowledgeFeedbackDelivery(deps, { organizationId: org.id, personId: operator }, mine[0]!.id)
    expect(ack.acknowledgedAt).toEqual(expect.any(String))
  })

  it("V1.5.9 — política AUTÔNOMA no Postgres: AUTO_DELIVER → varredor → Acompanhamento SEM QA; métricas por política/tipo/motivo/QA", async () => {
    const org = (await pool.query<{ id: string }>("select id from organizations limit 1")).rows[0]!
    const operator = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Autônomo Operador', 'OPERATOR') returning id", [org.id])).rows[0]!.id
    const reviewer = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Autônomo QA', 'OPERATOR') returning id", [org.id])).rows[0]!.id
    created.people.push(operator, reviewer)
    const store = createPostgresInteractionFeedbackStore(pool)
    const now = () => new Date()
    const context = { organizationId: org.id, collaboratorId: operator, teamId: null, interactionId: null, occurredAt: new Date("2026-03-14T12:00:00Z") }
    const autonomous = await runInteractionFeedbackPipeline({ enabled: true, writer, store, now, deliveryPolicy: FEEDBACK_AUTONOMOUS_DELIVERY_POLICY }, feedback(), context)
    const pilot = await runInteractionFeedbackPipeline({ enabled: true, writer, store, now, deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), context)
    if (autonomous.status !== "RECORDED" || pilot.status !== "RECORDED") throw new Error("pipeline")
    created.runIds.push(autonomous.runId, pilot.runId)
    const deps = { deliveries: createPostgresFeedbackDeliveryStore(pool), now }

    // Piloto: um item vai pro QA e é editado (métrica "enviado ao QA e editado").
    const pilotStrength = pilot.reviews.find((review) => review.section === "STRENGTH")!
    await decideItemReview({ store, now }, { organizationId: org.id, reviewId: pilotStrength.id, reviewerId: reviewer, decision: "APPROVED_EDITED", finalWording: { observed: "Nesta conversa você informou o prazo de até cinco dias úteis.", whyItMatters: "Isso pode ajudar o cliente a se organizar.", whatYouCanDo: "Você pode manter essa prática em conversas parecidas." }, reasonCategory: "TOO_GENERIC" })
    await deliverReadyFeedbackItems(deps)

    // Autônomo: entregue pelo varredor, sem revisão humana.
    const delivered = (await pool.query("select delivery_mode, qa_status, policy_version from interaction_feedback_deliveries where run_id = $1 order by created_at", [autonomous.runId])).rows
    expect(delivered).toEqual([
      { delivery_mode: "AUTONOMOUS", qa_status: "NOT_SELECTED_FOR_QA", policy_version: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" },
      { delivery_mode: "AUTONOMOUS", qa_status: "NOT_SELECTED_FOR_QA", policy_version: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1" },
    ])
    expect((await pool.query("select count(*)::int n from interaction_feedback_item_reviews where run_id = $1 and reviewed_by is not null", [autonomous.runId])).rows[0].n).toBe(0)

    const metrics = await loadFeedbackDeliveryMetrics(pool, { organizationId: org.id, runIds: created.runIds })
    expect(metrics.outcomes).toEqual([
      { policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1", section: "OPPORTUNITY", findingKind: "FRICTION", disposition: "AUTO_DELIVER", qaStatus: "NOT_SELECTED_FOR_QA", autonomyEligible: true, delivered: 1, items: 1 },
      { policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1", section: "STRENGTH", findingKind: "STRENGTH", disposition: "AUTO_DELIVER", qaStatus: "NOT_SELECTED_FOR_QA", autonomyEligible: true, delivered: 1, items: 1 },
      { policyVersion: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", section: "OPPORTUNITY", findingKind: "FRICTION", disposition: "HOLD_FOR_QA", qaStatus: "PENDING_REVIEW", autonomyEligible: true, delivered: 0, items: 1 },
      { policyVersion: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", section: "STRENGTH", findingKind: "STRENGTH", disposition: "HOLD_FOR_QA", qaStatus: "APPROVED_EDITED", autonomyEligible: true, delivered: 1, items: 1 },
    ])
    expect(metrics.reasons).toEqual([
      { policyVersion: "FEEDBACK_DELIVERY_POLICY_AUTONOMOUS_V1", disposition: "AUTO_DELIVER", reason: "AUTONOMY_CRITERIA_MET", items: 2 },
      { policyVersion: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", disposition: "HOLD_FOR_QA", reason: "PILOT_HOLD_ALL_FOR_QA", items: 2 },
    ])
    // Isolamento: outra organização não vê nada.
    expect(await loadFeedbackDeliveryMetrics(pool, { organizationId: "00000000-0000-4000-8000-000000000999", runIds: created.runIds })).toEqual({ outcomes: [], reasons: [] })
  })
})
