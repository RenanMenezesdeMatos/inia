import { describe, expect, it } from "vitest"
import { buildSetupMessage } from "./gemini-live-protocol"

const base = { wsUrl: "wss://x", model: "models/live", expiresAt: "2026-10-02T12:00:00Z" }

describe("mensagem de setup da voz ao vivo", () => {
  it("o navegador só abre a sessão: instrução, ferramentas, voz e raciocínio ficam travados no token pelo backend", () => {
    expect(buildSetupMessage(base)).toEqual({ setup: { model: "models/live" } })
  })
})
