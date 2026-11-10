import { describe, expect, it } from "vitest"
import { requestOriginOf } from "./origin.js"

describe("origem do pedido", () => {
  it("botão sem mensagem; descurtida com ajuda vale sobre o sinal; sinal; nada = 404", () => {
    expect(requestOriginOf({ interactionId: null, facts: null })).toBe("BUTTON")
    expect(requestOriginOf({ interactionId: "a", facts: { dislikeNeedsHelp: true, signals: ["KNOWLEDGE_NOT_FOUND"] } })).toBe("DISLIKE")
    expect(requestOriginOf({ interactionId: "a", facts: { dislikeNeedsHelp: false, signals: ["NO_REPLY"] } })).toBe("SIGNAL")
    expect(requestOriginOf({ interactionId: "a", facts: { dislikeNeedsHelp: false, signals: [] } })).toBeNull()
    expect(requestOriginOf({ interactionId: "a", facts: null })).toBeNull()
  })
})
