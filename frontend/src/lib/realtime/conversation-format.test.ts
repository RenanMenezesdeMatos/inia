import { describe, expect, it } from "vitest"
import { conversationStatusLabel } from "./conversation-format"

describe("conversationStatusLabel", () => {
  const closed = (closeReason: "MANUAL" | "INACTIVITY" | "LEGACY" | "COMPLETED" | "HUMAN_SUPPORT") => ({ kind: "CONVERSATION" as const, status: "CLOSED" as const, startedAt: "2026-11-10T10:00:00.000Z", closeReason, origin: "USER" as const })

  it("conversa encerrada quando terminou o atendimento do Anjo tem rótulo próprio", () => {
    expect(conversationStatusLabel(closed("HUMAN_SUPPORT"))).toBe("Encerrada após o apoio do Anjo")
  })

  it("os demais motivos continuam como antes", () => {
    expect(conversationStatusLabel(closed("INACTIVITY"))).toBe("Encerrada por inatividade")
    expect(conversationStatusLabel(closed("MANUAL"))).toBe("Encerrada")
  })
})
