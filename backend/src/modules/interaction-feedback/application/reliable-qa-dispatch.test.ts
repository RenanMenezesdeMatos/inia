import { describe, expect, it, vi } from "vitest"
import { generateReliableFeedback, type ReliableGenerationRequest } from "../../reliable-feedback/application/generate-reliable-feedback.js"
import { createInMemoryReliableFeedbackStore } from "../../reliable-feedback/infrastructure/in-memory-reliable-feedback-store.js"
import { RELIABLE_FEEDBACK_PILOT_POLICY } from "../../reliable-feedback/domain/reliable-feedback-item.js"
import { canonicalComparison, INDICATOR_CANONICAL_CONTEXT_CONTRACT } from "../../indicators/domain/indicator-canonical-context.js"
import type { ReliableFeedbackStore } from "../../reliable-feedback/application/ports.js"
import { createInMemoryInteractionFeedbackStore } from "../testing/in-memory-interaction-feedback-store.js"
import { checkFeedbackReviewEdit, decideFeedbackReview, getFeedbackReview } from "./feedback-review-service.js"
import type { FeedbackReviewReader, ScopedReview } from "./feedback-review-reader.js"
import type { FeedbackDeliveryStore } from "./deliver-feedback.js"

/**
 * V1.5.12 — a MESMA tela/serviço do QA de feedback decide itens do FEEDBACK CONFIÁVEL do Workflow. Diferença: a decisão
 * nunca entrega — fecha o QA do artefato e reativa a matrícula (o Workflow segue para Revisão humana/Output).
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATOR = "11111111-1111-4111-8111-111111111111"
const QA = "99999999-9999-4999-8999-999999999999"
const INTERACTION = "22222222-2222-4222-8222-222222222222"
const MEASUREMENT = "33333333-3333-4333-8333-333333333333"
const viewer = { organizationId: ORG, personId: QA }
const context = { collaborator: { id: OPERATOR, name: "Operadora", jobTitle: "Operador" }, team: null, occurredAt: null, createdAt: new Date("2026-09-24T12:00:00Z"), reviewerName: null, selection: { decision: { disposition: "HOLD_FOR_QA" as const, structural: "STRUCTURALLY_DELIVERABLE" as const, reasons: ["FEEDBACK_KIND_NOT_RELEASED_FOR_AUTONOMY"] as never, policyVersion: "RELIABLE_FEEDBACK_POLICY_PILOT_V1", autonomyEligible: null }, deliveredAt: null } }

function readerFor(store: ReliableFeedbackStore): FeedbackReviewReader {
  return {
    grantsOf: async () => [{ scopeType: "ORGANIZATION", teamId: null, subteamId: null }],
    listQueue: async () => ({ rows: [], total: 0, filterOptions: { collaborators: [], teams: [] } }),
    loadInScope: async (_viewer, reviewId): Promise<ScopedReview | null> => {
      const record = await store.getReview(ORG, reviewId)
      return record ? { origin: "WORKFLOW", record, context, knowledge: [] } : null
    },
  }
}

async function held(domain: "MONITORING" | "INDICATOR") {
  const reactivations: unknown[] = []
  const store = createInMemoryReliableFeedbackStore({ onReactivate: (input) => { reactivations.push(input); return true } })
  const writer = { writeMonitoring: vi.fn(async (input: { items: { slot: string }[] }) => ({ rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "Você pediu para o cliente aguardar.", whyItMatters: "", whatYouCanDo: "" })) } })), writeIndicator: vi.fn(async (input: { items: { slot: string }[] }) => ({ rawOutput: { items: input.items.map((item) => ({ slot: item.slot, observed: "No período de 01/09/2026 a 30/09/2026, seu TMA foi 420 s, fora da meta de 400 s.", whyItMatters: "", whatYouCanDo: "" })) } })) }
  const request: ReliableGenerationRequest = domain === "MONITORING"
    ? { organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf", workflowVersionId: "v", nodeId: "feedback", sourceNodeId: "agent", sourceType: "AGENT", domain, sourceNodeOutput: { kind: "monitoring", input: { organizationId: ORG, operatorId: OPERATOR, interactionId: INTERACTION, structured: { evidenceFound: "Vou verificar aqui, aguarde.", observedBehavior: "pediu espera sem explicar", recommendation: "explique" } } }, collaboratorId: OPERATOR, interactionId: INTERACTION, indicatorMeasurementId: null, configuredAgentId: "a" }
    : { organizationId: ORG, enrollmentId: "enr-1", workflowId: "wf", workflowVersionId: "v", nodeId: "feedback", sourceNodeId: "agent", sourceType: "AGENT", domain, sourceNodeOutput: { kind: "indicator", input: { organizationId: ORG, operatorId: OPERATOR, contextSnapshot: { indicatorMeasurementId: MEASUREMENT }, structured: { summary: "TMA fora da meta.", recommendation: "Revise as pausas." } } }, collaboratorId: OPERATOR, interactionId: null, indicatorMeasurementId: MEASUREMENT, configuredAgentId: "a" }
  await generateReliableFeedback({
    enabled: true, store, writer, policy: RELIABLE_FEEDBACK_PILOT_POLICY, now: () => new Date("2026-09-24T12:00:00Z"),
    loadMonitoringContext: async () => ({ transcript: "CLIENTE: Quando chega?\nOPERADOR: Vou verificar aqui, aguarde.", label: "Atendimento de 14/09/2026", otherOperatorNames: [] }),
    loadPublishedKnowledge: async () => new Map(),
    loadIndicatorDiagnosisPlan: async () => null,
    loadPeerPracticeData: async () => ({ peers: [], observations: [] }),
    resolveDiagnosticStrategy: async () => null,
    loadIndicatorContext: async () => ({ contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT, indicator: { id: "i", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER" }, measurement: { id: MEASUREMENT, subjectId: OPERATOR, value: 420, periodStart: "2026-09-01", periodEnd: "2026-09-30", granularity: "MONTHLY" }, target: { value: 400, source: "TEAM", goalId: "g" }, ...canonicalComparison(420, 400, "LOWER"), provenance: { source: "indicator_measurements+goals", loadedAt: "x" } }),
  }, request)
  const deliveries = { findReadyItem: vi.fn(), recordDelivery: vi.fn() } as unknown as FeedbackDeliveryStore
  const deps = { reader: readerFor(store), store: createInMemoryInteractionFeedbackStore().store, now: () => new Date("2026-09-24T13:00:00Z"), deliveries, reliable: store }
  return { store, deps, reactivations, reviewId: store.reviews[0]!.id, deliveries }
}

describe("V1.5.12 — QA de feedback decide itens do feedback confiável (sem entregar)", () => {
  it("detalhe na MESMA projeção da tela: origem WORKFLOW, evidência exibível e estado \"o Workflow está esperando\"", async () => {
    const { deps, reviewId } = await held("MONITORING")
    const detail = await getFeedbackReview(deps, viewer, reviewId)
    expect(detail).toMatchObject({ origin: "WORKFLOW", status: "PENDING_REVIEW", interactionLabel: "Atendimento de 14/09/2026", proposedIsFallback: false })
    expect(detail.evidence).toEqual([{ speakerLabel: "Operador", text: "Vou verificar aqui, aguarde.", truncated: false, masked: false }])
    expect(detail.deliveryStateLabel).toMatch(/Workflow está esperando/)
    expect(detail.selection.reasons).toContain("Tipo de feedback ainda não liberado para seguir sem QA")
  })
  it("aprovar → reativa a matrícula (uma vez) e NÃO chama a entrega do feedback direto", async () => {
    const { deps, reviewId, reactivations, deliveries } = await held("MONITORING")
    const detail = await decideFeedbackReview(deps, viewer, reviewId, { decision: "APPROVED_UNCHANGED" })
    expect(detail.status).toBe("APPROVED_UNCHANGED")
    expect(detail.deliveryStateLabel).toMatch(/Workflow retoma/)
    expect(reactivations).toEqual([{ organizationId: ORG, enrollmentId: "enr-1", nodeId: "feedback" }])
    expect(deliveries.recordDelivery).not.toHaveBeenCalled()
    await expect(decideFeedbackReview(deps, viewer, reviewId, { decision: "APPROVED_UNCHANGED" })).rejects.toMatchObject({ code: "FEEDBACK_REVIEW_ALREADY_DECIDED", statusCode: 409 })
  })
  it("indicador: dado oficial aparece como \"Dado oficial\"; edição com número recalculado é BLOQUEADA (o dado é do sistema)", async () => {
    const { deps, reviewId } = await held("INDICATOR")
    const detail = await getFeedbackReview(deps, viewer, reviewId)
    expect(detail.evidence.map((entry) => entry.speakerLabel)).toEqual(["Dado oficial", "Dado oficial"])
    expect(detail.uncertainty).toMatch(/dados oficiais de um único período/)
    const check = await checkFeedbackReviewEdit(deps, viewer, reviewId, { observed: "Seu TMA foi de 7 minutos.", whyItMatters: "Pode ajudar.", whatYouCanDo: "Você pode revisar as pausas." })
    expect(check.blocking.map((entry) => entry.code)).toContain("UNSUPPORTED_NUMBER")
    await expect(decideFeedbackReview(deps, viewer, reviewId, { decision: "APPROVED_EDITED", finalWording: { observed: "Seu TMA foi de 7 minutos.", whyItMatters: "Pode ajudar.", whatYouCanDo: "Você pode revisar as pausas." }, reasonCategory: "OTHER" })).rejects.toMatchObject({ code: "FEEDBACK_REVIEW_EDIT_BLOCKED" })
  })
})
