/**
 * PROVA contra o banco de TESTE real (migration 077): o pipeline com o store Postgres grava run, revisões, ocorrências e
 * recomendações; a decisão humana respeita as constraints (original intacto, versão humana separada, decisão única); o gate
 * de entrega só devolve APPROVED_*; o procedimental fica BLOCKED. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run interaction-feedback-pipeline-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { composeInteractionFeedback } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import type { InteractionFinding, InteractionSemanticFrame, SemanticObservation } from "../../investigation/domain/interaction-semantic-frame.js"
import { FEEDBACK_PILOT_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"
import { decideItemReview, deliverableItems, runInteractionFeedbackPipeline } from "../application/interaction-feedback-pipeline.js"
import { createPostgresInteractionFeedbackStore } from "../infrastructure/postgres-interaction-feedback-store.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "x", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
const obs = (id: string, kind: SemanticObservation["kind"], speaker: string, turn: string, quote: string): SemanticObservation => ({ id, kind, summary: id, evidence: [unit(turn, speaker, quote)] })
const finding = (id: string, kind: InteractionFinding["kind"], observations: SemanticObservation[], extra: Partial<InteractionFinding> = {}): InteractionFinding => ({ id, interactionRef: "I6", kind, summary: "s", observationRefs: observations.map((item) => item.id), evidence: observations.flatMap((item) => item.evidence), quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: `SF-${id}`, ownership: "AGENT", ...extra })

describe.skipIf(!ENABLED)("InteractionFeedback pipeline — prova Postgres (migration 077)", () => {
  beforeAll(async () => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL }); client = await pool.connect(); await client.query("begin") })
  afterAll(async () => { if (client) { await client.query("rollback"); client.release() } if (pool) await pool.end() })

  it("run → revisões PENDING → decisão → gate de entrega; ocorrências e recomendação BLOCKED persistidas", async () => {
    const person = (await client.query<{ id: string; organization_id: string }>("select id, organization_id from people limit 1")).rows[0]!
    const document = (await client.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type) values ($1, 'Doc Prova', 'PROCEDURE') returning id", [person.organization_id])).rows[0]!
    const action = obs("A1", "AGENT_ACTION", "OPERADOR", "T4", "Registrei tudo no protocolo 1234567890123.")
    const assertion = obs("P1", "PROCEDURE_ASSERTION", "OPERADOR", "T15", "Não precisa explicar, vou refazer por aqui.")
    const frame = { interactionRef: "I6", interactionId: "x", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [assertion], interactionEvents: [], findings: [finding("F1", "STRENGTH", [action]), finding("FP1", "PROCEDURAL_DIVERGENCE", [assertion], { source: "PROCEDURAL", procedural: { assertionRef: "P1", status: "CONTRADICTED", ruleRef: "KR3", documentTitle: "Doc Prova", reason: "" } })], empty: false } as unknown as InteractionSemanticFrame
    const lineage = new Map([["I6/P1", { interactionRef: "I6", assertionRef: "P1", status: "CONTRADICTED" as const, ruleRef: "KR3", documentRef: "K5", documentTitle: "Doc Prova", ruleQuote: "regra", documentId: document.id }]])
    const feedback = composeInteractionFeedback({ subject: { collaboratorRef: person.id }, frame, interactionLabel: "14/03/2026", sourceRun: "proof", proceduralLineage: lineage })
    const store = createPostgresInteractionFeedbackStore(client)
    const writer = { async write(input: FeedbackWriterInputV1) { return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "Nesta conversa você informou o protocolo.", whyItMatters: "Isso pode ajudar o cliente depois.", whatYouCanDo: "Continue informando o protocolo." })) }, provenance: { promptVersion: "FEEDBACK_WRITER_PROMPT_V1", validation: { status: "VALID" } } as never } } }
    const now = () => new Date("2026-09-24T12:00:00Z")
    const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store, now, deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback, { organizationId: person.organization_id, collaboratorId: person.id, teamId: null, interactionId: null, occurredAt: now() })
    if (result.status !== "RECORDED") throw new Error(result.status)
    expect(result.reviews.map((review) => [review.section, review.reviewStatus])).toEqual([["STRENGTH", "PENDING_REVIEW"]])
    // V1.5.5: disposição de TODO item de colaborador gravada (o procedimental = BLOCKED, sem redação; constraints da 079). A
    // interação carrega incerteza procedimental (bloqueante para autonomia): o STRENGTH não seria autônomo nem fora do piloto.
    const dispositions = await client.query("select section, finding_kind, structural_state, disposition, reasons, policy_version, autonomy_eligible, item_review_id, delivered_at from interaction_feedback_delivery_decisions where run_id = $1 order by item_index", [result.runId])
    expect(dispositions.rows).toEqual([
      { section: "STRENGTH", finding_kind: "STRENGTH", structural_state: "STRUCTURALLY_DELIVERABLE", disposition: "HOLD_FOR_QA", reasons: ["PILOT_HOLD_ALL_FOR_QA", "BLOCKING_UNCERTAINTY"], policy_version: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", autonomy_eligible: false, item_review_id: result.reviews[0]!.id, delivered_at: null },
      { section: "OPPORTUNITY", finding_kind: "PROCEDURAL_DIVERGENCE", structural_state: "BLOCKED", disposition: "BLOCKED", reasons: ["PROCEDURAL_MATCHING_NOT_VALIDATED"], policy_version: "FEEDBACK_DELIVERY_POLICY_PILOT_V1", autonomy_eligible: null, item_review_id: null, delivered_at: null },
    ])
    await client.query("savepoint s0")
    // BLOCKED com redação é recusado pelo banco (QA nunca recebe item bloqueado).
    await expect(client.query("update interaction_feedback_delivery_decisions set item_review_id = $2 where run_id = $1 and disposition = 'BLOCKED'", [result.runId, result.reviews[0]!.id])).rejects.toThrow(/constraint/)
    await client.query("rollback to savepoint s0")

    const occurrences = await client.query("select issue_category, delivery_status, finding_refs from operational_issue_occurrences where run_id = $1", [result.runId])
    expect(occurrences.rows).toEqual([{ issue_category: "PROCEDURAL_DIVERGENCE", delivery_status: "BLOCKED_PROCEDURAL_MATCHING", finding_refs: ["I6/FP1"] }])
    const recommendations = await client.query("select document_id, href, delivery_status, review_status from knowledge_recommendations where organization_id = $1 and document_id = $2", [person.organization_id, document.id])
    expect(recommendations.rows).toEqual([{ document_id: document.id, href: `/materiais/${document.id}`, delivery_status: "BLOCKED_PROCEDURAL_MATCHING", review_status: "NOT_REVIEWED" }])

    const reviewId = result.reviews[0]!.id
    const edited = { observed: "Nesta conversa você passou o protocolo do atendimento.", whyItMatters: "Ter o protocolo pode ajudar o cliente numa próxima consulta.", whatYouCanDo: "Continue passando o protocolo ao final." }
    expect(await decideItemReview({ store, now }, { organizationId: person.organization_id, reviewId, reviewerId: person.id, decision: "APPROVED_EDITED", reasonCategory: "TOO_GENERIC", finalWording: edited })).toMatchObject({ ok: true })
    expect(await decideItemReview({ store, now }, { organizationId: person.organization_id, reviewId, reviewerId: person.id, decision: "REJECTED", reasonCategory: "TONE" })).toEqual({ ok: false, error: "REVIEW_ALREADY_DECIDED" })
    const row = (await client.query("select review_status, writer_original, proposed_wording, final_wording, reason_category from interaction_feedback_item_reviews where id = $1", [reviewId])).rows[0]
    expect(row).toMatchObject({ review_status: "APPROVED_EDITED", reason_category: "TOO_GENERIC", final_wording: edited, proposed_wording: { observed: "Nesta conversa você informou o protocolo." }, writer_original: { slot: "ITEM_1", observed: "Nesta conversa você informou o protocolo." } })
    expect((await deliverableItems(store, person.organization_id, result.runId)).map((item) => [item.disposition, item.qaStatus, item.wording])).toEqual([["HOLD_FOR_QA", "APPROVED_EDITED", edited]])

    // Constraint do banco (defesa em profundidade): REJECTED sem motivo é recusado mesmo por SQL direto.
    await client.query("savepoint s1")
    await expect(client.query("update interaction_feedback_item_reviews set review_status = 'REJECTED', final_wording = null, reason_category = null where id = $1", [reviewId])).rejects.toThrow(/check constraint/)
    await client.query("rollback to savepoint s1")
    const run = (await client.query("select writer_invoked, status, delivery_state, writer_input is not null as has_input, writer_provenance from interaction_feedback_runs where id = $1", [result.runId])).rows[0]
    expect(run).toMatchObject({ writer_invoked: true, status: "HAS_POINTS", delivery_state: "DELIVERABLE", has_input: true, writer_provenance: { promptVersion: "FEEDBACK_WRITER_PROMPT_V1", validation: { status: "VALID" } } })
  })
})
