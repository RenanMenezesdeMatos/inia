import { describe, expect, it } from "vitest"

import { operatorFeedbackPageSchema } from "@/schemas/operator/operator-overview.schema"

import { mapOperatorFeedbackHistory } from "./operator-feed"

const row = (overrides: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  kind: "MONITORING",
  status: "PUBLISHED",
  summary: "Resumo.",
  impactedIndicator: "TMA",
  evidenceFound: null,
  observedBehavior: null,
  relatedProcedure: null,
  recommendation: "Texto.",
  createdAt: "2026-11-10T12:00:00.000Z",
  occurredAt: "2026-11-10T12:00:00.000Z",
  acknowledgedAt: "2026-11-10T13:00:00.000Z",
  ...overrides,
})
const EVALUATION = {
  agreement: { value: "DISAGREE", reason: "INACCURATE", justification: "Eu informei o protocolo.", recordedAt: "2026-11-10T13:00:00.000Z", review: null },
  legacyContestation: null,
}

describe("Acompanhamento — mapeamento da página do servidor para o feed", () => {
  it("a avaliação do colaborador (escolha na ciência) passa pelo schema e chega ao item — no SSR e no 'carregar mais'", () => {
    const page = operatorFeedbackPageSchema.parse({ items: [row({ evaluation: EVALUATION })], nextCursor: null })
    const [item] = mapOperatorFeedbackHistory(page.items)
    expect(item).toMatchObject({ acknowledgedAt: "2026-11-10T13:00:00.000Z", evaluation: EVALUATION })
  })

  it("sem avaliação = null; item não publicado não tem ciência nem avaliação", () => {
    const page = operatorFeedbackPageSchema.parse({ items: [row(), row({ id: "22222222-2222-4222-8222-222222222222", status: "DRAFT", evaluation: EVALUATION })], nextCursor: null })
    const [published, draft] = mapOperatorFeedbackHistory(page.items)
    expect(published!.evaluation).toBeNull()
    expect(draft).not.toHaveProperty("evaluation")
    expect(draft).not.toHaveProperty("acknowledgedAt")
  })
})
