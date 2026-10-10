import { describe, expect, it } from "vitest"
import { speechCacheModelKey, speechSettingsOf } from "./ai-speech.js"

describe("voz cadastrada no modelo (metadata.speech)", () => {
  it("lê só o formato válido; instrução vazia vira null; nada é inventado", () => {
    expect(speechSettingsOf({ speech: { voice: "marin", instructions: "  Fale com calma.  " }, discovery: {} })).toEqual({ voice: "marin", instructions: "Fale com calma." })
    expect(speechSettingsOf({ speech: { voice: "cedar", instructions: "" } })).toEqual({ voice: "cedar", instructions: null })
    expect(speechSettingsOf({ speech: { voice: "<script>" } })).toBeNull()
    expect(speechSettingsOf({ speech: { instructions: "x" } })).toBeNull()
    expect(speechSettingsOf({ discovery: {} })).toBeNull()
    expect(speechSettingsOf(null)).toBeNull()
  })

  it("identidade do áudio no cache: modelo + hash da instrução (trocar o tom gera áudio novo); nunca colide com o legado", () => {
    const plain = speechCacheModelKey("gpt-4o-mini-tts", { voice: "marin", instructions: null })
    const calm = speechCacheModelKey("gpt-4o-mini-tts", { voice: "marin", instructions: "Fale com calma." })
    const warm = speechCacheModelKey("gpt-4o-mini-tts", { voice: "marin", instructions: "Fale com entusiasmo." })
    expect(plain).toBe("gpt-4o-mini-tts")
    expect(calm).toMatch(/^gpt-4o-mini-tts#[0-9a-f]{12}$/)
    expect(new Set([plain, calm, warm]).size).toBe(3)
    for (const key of [plain, calm, warm]) expect(key.startsWith("fallback:") || key.startsWith("models/")).toBe(false)
  })
})
