import { describe, expect, it } from "vitest"
import { renderApplicationInstruction, PRODUCT_CONFIRMATION_RULE } from "./application-presentation.js"
import { buildPublishedFeedbackContext, renderHistoricalContextForModel, type PublishedFeedbackRecord } from "./historical-context.js"
import { parseFeedbackSessionClarificationScope, productSessionContextOf } from "./product-confirmation.js"

/**
 * `PRODUCT_APPLICABILITY_V1` na sessão "Ouvir com a INIA": o registro publicado leva o que a análise da GRAVAÇÃO estabeleceu sobre o
 * produto; quando ficou indefinido, a sessão ganha a regra de confirmar (curto, sem número completo) e de nunca atribuir a resposta à
 * gravação. Sem produto pendente, a instrução é a de sempre. Produtos e textos são exemplos fictícios de teste.
 */
const record = (product: unknown): PublishedFeedbackRecord => ({
  feedbackId: "fb-1",
  version: 1,
  kind: "MONITORING",
  publishedAt: new Date("2026-10-21T12:00:00Z"),
  impactedIndicator: "Segunda via",
  evidenceFound: "",
  observedBehavior: "",
  recommendation: "",
  relatedProcedure: null,
  suggestedApproach: null,
  caseId: null,
  caseTitle: null,
  caseSummary: null,
  supportMaterials: [],
  snapshot: { interactionId: "int-1", feedbackEngine: { feedbackView: { version: "FEEDBACK_VIEW_V1", heading: { title: "Segunda via", subtitle: "Atendimento de 20/10/2026" }, card: "Informe o protocolo.", greeting: null, narrative: ["Você encerrou sem informar o protocolo."], developments: [], maintain: null, attention: [], materials: [], context: null, kind: "MONITORING", ...(product ? { product } : {}) } } },
} as unknown as PublishedFeedbackRecord)
const presentation = { periodLabel: "Atendimento de 20/10/2026", publishedDay: "21/10/2026", speechText: "Olá!" } as never

describe("sessão de feedback — produto não estabelecido pela gravação", () => {
  it("o registro congelado leva o produto e os pontos não avaliados; a instrução ganha a regra de confirmação e atribuição", () => {
    const context = buildPublishedFeedbackContext(record({ identified: [], undetermined: true, pendingPoints: ["Informar que a segunda via vai ao e-mail do gestor do contrato."] }), new Date("2026-10-21T13:00:00Z"))
    expect(context.product).toEqual({ identified: [], undetermined: true, pendingPoints: ["Informar que a segunda via vai ao e-mail do gestor do contrato."] })
    const rendered = renderHistoricalContextForModel(context)
    expect(rendered).toContain("O produto do pedido NÃO ficou estabelecido pela gravação.")
    expect(rendered).toContain("NÃO foram avaliados neste feedback (não são falha nem acerto)")
    const instruction = renderApplicationInstruction({ context, presentation, now: new Date("2026-10-21T13:00:00Z") })
    expect(instruction).toContain(PRODUCT_CONFIRMATION_RULE)
    expect(PRODUCT_CONFIRMATION_RULE).toContain("nunca peça número completo de conta, contrato, linha ou documento")
    expect(PRODUCT_CONFIRMATION_RULE).toContain("nunca que a gravação mostra")
    expect(productSessionContextOf(context)).toContain("Feedback sobre: Segunda via")
  })

  it("produto estabelecido ou feedback sem catálogo: nenhuma regra nova e nenhum contexto de esclarecimento (sessão de sempre)", () => {
    const identified = buildPublishedFeedbackContext(record({ identified: ["Tronco de voz"], undetermined: false, pendingPoints: [] }), new Date())
    expect(renderHistoricalContextForModel(identified)).toContain("Estabelecido pela gravação: Tronco de voz.")
    expect(renderApplicationInstruction({ context: identified, presentation, now: new Date() })).not.toContain(PRODUCT_CONFIRMATION_RULE)
    expect(productSessionContextOf(identified)).toBeNull()
    const legacy = buildPublishedFeedbackContext(record(null), new Date())
    expect(legacy.product).toBeUndefined()
    expect(renderApplicationInstruction({ context: legacy, presentation, now: new Date() })).not.toContain("PRODUTO")
  })

  it("procedência da confirmação: só o escopo da sessão com CHAT_CONFIRMATION é aceito", () => {
    expect(parseFeedbackSessionClarificationScope({ kind: "FEEDBACK_SESSION", applicationId: "app-1", provenance: "CHAT_CONFIRMATION" })).toMatchObject({ provenance: "CHAT_CONFIRMATION" })
    expect(parseFeedbackSessionClarificationScope({ kind: "LEADERSHIP_PROCESS", orchestratorId: "o", orchestratorName: "x", groupNames: [] })).toBeNull()
    expect(parseFeedbackSessionClarificationScope({ kind: "FEEDBACK_SESSION", applicationId: "app-1", provenance: "RECORDING" })).toBeNull()
  })
})
