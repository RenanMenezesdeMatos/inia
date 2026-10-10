import { describe, expect, it } from "vitest"
import { findUseCase } from "../../../shared/application/model-routing/ai-use-cases.js"
import { ENGINE_MODEL } from "../../feedback-engine/infrastructure/gateway-engine-model.js"
import { FEEDBACK_WRITER_MODEL_CONFIG } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import { legacyRouteFor } from "./ai-policy-service.js"

/** A tela de Roteamento mostra o modelo que a função usa SEM policy — tem de ser o que o código realmente chama. */
describe("rota legada exibida para as funções do feedback", () => {
  it("diagnóstico do motor = modelo fixo do motor; redação = os dois modelos fixos das etapas", () => {
    expect(legacyRouteFor(findUseCase("FEEDBACK_ANALYSIS")!)?.model).toBe(ENGINE_MODEL)
    const writer = legacyRouteFor(findUseCase("FEEDBACK_WRITER")!)?.model ?? ""
    expect(writer).toContain(ENGINE_MODEL)
    expect(writer).toContain(FEEDBACK_WRITER_MODEL_CONFIG.model)
  })
})
