import express, { type ErrorRequestHandler } from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { composeInteractionFeedback } from "../../investigation/domain/interaction-feedback.js"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { deliverReadyFeedbackItems } from "../application/deliver-feedback.js"
import { decideItemReview, runInteractionFeedbackPipeline } from "../application/interaction-feedback-pipeline.js"
import { startFeedbackDeliverySweeper } from "../application/feedback-delivery-sweeper.js"
import { FEEDBACK_PILOT_DELIVERY_POLICY } from "../domain/feedback-delivery-policy.js"
import { createInMemoryFeedbackDeliveryStore } from "../testing/in-memory-feedback-delivery-store.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { createFeedbackDeliveryRouter } from "./feedback-delivery-router.js"

const ORG = "00000000-0000-4000-8000-00000000a001"
const OP = "00000000-0000-4000-8000-000000000011"
const OTHER_OP = "00000000-0000-4000-8000-000000000012"
const unit = (turnRef: string, speaker: string, quote: string) => ({ interactionRef: "I6", interactionId: "x", turnRef, speaker, quote, resolvedBy: "TURN_REF" as const, turnRefMismatch: false, referenceResolution: "HANDLE" as const })
function feedback() {
  const action = { id: "A1", kind: "AGENT_ACTION", summary: "s", evidence: [unit("T4", "OPERADOR", "Vou te passar o prazo: são até cinco dias úteis.")] }
  const finding = { id: "1", interactionRef: "I6", kind: "STRENGTH", summary: "s", observationRefs: ["A1"], evidence: action.evidence, quality: { observationCount: 1, evidenceCount: 1 }, source: "PHASE_B", attribution: "OPERATOR", declaredKind: null, handle: "SF1", ownership: "AGENT" }
  const frame = { interactionRef: "I6", interactionId: "x", source: "MODEL", customerNeeds: [], questions: [], answers: [], agentActions: [action], agentStatements: [], commitments: [], customerSignals: [], procedureAssertions: [], interactionEvents: [], empty: false, findings: [finding] }
  return composeInteractionFeedback({ subject: { collaboratorRef: "c" }, frame: frame as never, interactionLabel: "14/03/2026", sourceRun: "r" })
}
const WORDING = { observed: "Você informou ao cliente o prazo de até cinco dias úteis.", whyItMatters: "Isso pode ajudar o cliente a se organizar.", whatYouCanDo: "Você pode manter essa prática." }

async function setup() {
  const memory = createInMemoryInteractionFeedbackStore()
  const deliveries = createInMemoryFeedbackDeliveryStore(memory)
  const writer = { async write(input: FeedbackWriterInputV1) { return { rawOutput: { items: input.items.map((item) => ({ slot: item.slot, ...WORDING })) } } } }
  const now = () => new Date("2026-09-24T12:00:00Z")
  const result = await runInteractionFeedbackPipeline({ enabled: true, writer, store: memory.store, now, deliveryPolicy: FEEDBACK_PILOT_DELIVERY_POLICY }, feedback(), { organizationId: ORG, collaboratorId: OP, teamId: null, interactionId: null, occurredAt: new Date("2026-03-14T12:00:00Z") })
  if (result.status !== "RECORDED") throw new Error(result.status)
  await decideItemReview({ store: memory.store, now }, { organizationId: ORG, reviewId: result.reviews[0]!.id, reviewerId: OTHER_OP, decision: "APPROVED_UNCHANGED" })
  await deliverReadyFeedbackItems({ deliveries: deliveries.store, now })
  const app = (personId: string | null) => {
    const instance = express()
    instance.use(express.json())
    instance.use((req, res, next) => { if (!personId) return res.status(401).json({}); req.user = { sub: "a", personId, organizationId: ORG, role: "OPERATOR", name: "x", email: "x@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }; next() })
    instance.use("/feedback-deliveries", createFeedbackDeliveryRouter({} as Database, { deliveries: deliveries.store, clock: fixedClock(new Date("2026-09-25T09:00:00Z")) }))
    const errorHandler: ErrorRequestHandler = (error, _req, res, next) => { void next; if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code } }); if (error instanceof ZodError) return res.status(400).json({ error: { code: "VALIDATION_ERROR" } }); return res.status(500).json({}) }
    instance.use(errorHandler)
    return instance
  }
  return { app, deliveries }
}

describe("V1.5.6 — Acompanhamento do colaborador (/feedback-deliveries)", () => {
  it("GET /mine: só as entregas da pessoa da sessão, com o texto entregue e contexto mínimo", async () => {
    const s = await setup()
    const mine = (await request(s.app(OP)).get("/feedback-deliveries/mine")).body.data
    expect(mine).toEqual([expect.objectContaining({ kind: "INTERACTION_FEEDBACK", title: "Feedback de atendimento", sectionLabel: "Ponto positivo", interactionAt: "2026-03-14T12:00:00.000Z", acknowledgedAt: null, blocks: [{ key: "observed", label: "O que foi observado", text: WORDING.observed }, { key: "whyItMatters", label: "Por que isso importa", text: WORDING.whyItMatters }, { key: "whatYouCanDo", label: "O que você pode continuar fazendo", text: WORDING.whatYouCanDo }] })])
    expect((await request(s.app(OTHER_OP)).get("/feedback-deliveries/mine")).body.data).toEqual([])
    // Não existe parâmetro para ler o feedback de outra pessoa.
    expect((await request(s.app(OTHER_OP)).get(`/feedback-deliveries/mine?collaboratorId=${OP}`)).body.data).toEqual([])
  })
  it("não existe ciência sem credencial: POST /:id/acknowledge não é rota (a ciência é com login e senha, em feedback-read-confirmations)", async () => {
    const s = await setup()
    const id = s.deliveries.deliveries[0]!.id
    expect((await request(s.app(OP)).post(`/feedback-deliveries/${id}/acknowledge`)).status).toBe(404)
    expect((await request(s.app(OP)).get("/feedback-deliveries/mine")).body.data[0].acknowledgedAt).toBeNull()
  })
  it("varredor não liga com a flag OFF", () => {
    expect(startFeedbackDeliverySweeper({} as Database, { enabled: false })).toBeNull()
  })
})
