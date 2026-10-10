import { describe, expect, it } from "vitest"
import { evaluateFeedbackDelivery, wordingSha256, type DeliveryCandidate } from "./feedback-delivery-eligibility.js"

const proposed = { observed: "proposto", whyItMatters: "b", whatYouCanDo: "c" }
const final = { observed: "final humano", whyItMatters: "b", whatYouCanDo: "c" }
const base: DeliveryCandidate = { organizationId: "o", itemReviewId: "r", decisionId: "d", runId: "run", collaboratorId: "c", structural: "STRUCTURALLY_DELIVERABLE", disposition: "HOLD_FOR_QA", policyVersion: "P", qaStatus: "PENDING_REVIEW", proposedOrigin: "WRITER", proposedWording: proposed, finalWording: null, deliveredAt: null }
const at = (patch: Partial<DeliveryCandidate>) => evaluateFeedbackDelivery({ ...base, ...patch })

describe("V1.5.6 — matriz de elegibilidade de entrega (estrutura × disposição × QA × entrega)", () => {
  it("BLOCKED nunca entrega, qualquer que seja o QA", () => {
    for (const qaStatus of ["PENDING_REVIEW", "APPROVED_UNCHANGED", "APPROVED_EDITED", "NOT_SELECTED_FOR_QA"] as const) expect(at({ structural: "BLOCKED", disposition: "BLOCKED", qaStatus, finalWording: final })).toEqual({ eligible: false, reason: "BLOCKED" })
  })
  it("HOLD_FOR_QA: pendente não entrega; aprovado entrega o proposto; editado entrega o FINAL; rejeitado nunca", () => {
    expect(at({ qaStatus: "PENDING_REVIEW" })).toEqual({ eligible: false, reason: "AWAITING_QA" })
    expect(at({ qaStatus: "NOT_SELECTED_FOR_QA" })).toEqual({ eligible: false, reason: "AWAITING_QA" })
    expect(at({ qaStatus: "APPROVED_UNCHANGED" })).toEqual({ eligible: true, mode: "QA_APPROVED", wordingSource: "PROPOSED", wording: proposed, qaStatus: "APPROVED_UNCHANGED" })
    expect(at({ qaStatus: "APPROVED_EDITED", finalWording: final })).toEqual({ eligible: true, mode: "QA_APPROVED", wordingSource: "HUMAN_EDITED", wording: final, qaStatus: "APPROVED_EDITED" })
    expect(at({ qaStatus: "APPROVED_EDITED", finalWording: null })).toEqual({ eligible: false, reason: "FINAL_WORDING_MISSING" })
    expect(at({ qaStatus: "REJECTED" })).toEqual({ eligible: false, reason: "QA_REJECTED" })
  })
  it("AUTO_DELIVER entrega sem QA — nunca um fallback; um QA eventual (amostragem futura) continua valendo", () => {
    expect(at({ disposition: "AUTO_DELIVER", qaStatus: "NOT_SELECTED_FOR_QA" })).toEqual({ eligible: true, mode: "AUTONOMOUS", wordingSource: "PROPOSED", wording: proposed, qaStatus: "NOT_SELECTED_FOR_QA" })
    expect(at({ disposition: "AUTO_DELIVER", qaStatus: "NOT_SELECTED_FOR_QA", proposedOrigin: "FALLBACK" })).toEqual({ eligible: false, reason: "AUTONOMOUS_FALLBACK_NOT_ALLOWED" })
    expect(at({ disposition: "AUTO_DELIVER", qaStatus: "REJECTED" })).toEqual({ eligible: false, reason: "QA_REJECTED" })
    expect(at({ disposition: "AUTO_DELIVER", qaStatus: "PENDING_REVIEW" })).toEqual({ eligible: false, reason: "AWAITING_QA" })
  })
  it("fallback aprovado EXPLICITAMENTE no QA pode sair (a origem fica registrada na entrega)", () => {
    expect(at({ qaStatus: "APPROVED_UNCHANGED", proposedOrigin: "FALLBACK" })).toMatchObject({ eligible: true, mode: "QA_APPROVED", wordingSource: "PROPOSED" })
  })
  it("já entregue nunca entrega de novo; o hash prova a versão entregue", () => {
    expect(at({ qaStatus: "APPROVED_UNCHANGED", deliveredAt: new Date() })).toEqual({ eligible: false, reason: "ALREADY_DELIVERED" })
    expect(wordingSha256(proposed)).toMatch(/^[0-9a-f]{64}$/)
    expect(wordingSha256(proposed)).not.toBe(wordingSha256(final))
  })
})
