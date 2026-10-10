import { describe, expect, it } from "vitest"
import { effectiveMaxOutputTokens, effectiveTimeoutMs } from "./ai-runtime-service.js"

/** O que a etapa exige × o que o admin cadastrou no modelo/conexão, quando a chamada sai pela policy. */
describe("limites da chamada pela policy", () => {
  it("teto de saída: o da etapa, limitado pelo do modelo; sem etapa = o do modelo; sem nenhum = o padrão do provider", () => {
    expect(effectiveMaxOutputTokens(8_192, null)).toBe(8_192)
    expect(effectiveMaxOutputTokens(32_768, 16_384)).toBe(16_384)
    expect(effectiveMaxOutputTokens(8_192, 16_384)).toBe(8_192)
    expect(effectiveMaxOutputTokens(undefined, 4_096)).toBe(4_096)
    expect(effectiveMaxOutputTokens(undefined, null)).toBeNull()
  })

  it("tempo: o da etapa é o piso (calibrado no legado); o do modelo/conexão só estende; sem etapa = o configurado", () => {
    expect(effectiveTimeoutMs(240_000, 60_000)).toBe(240_000)
    expect(effectiveTimeoutMs(30_000, 60_000)).toBe(60_000)
    expect(effectiveTimeoutMs(undefined, 60_000)).toBe(60_000)
  })
})
