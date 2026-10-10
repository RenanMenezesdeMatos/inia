import { describe, expect, it } from "vitest"
import { countTechnicalIds, HandleRegistry, isHandle, projectForModel, resolveModelArgs, UnknownHandleError } from "./handle-registry.js"

const UUID_A = "5a0b6d1e-1111-4c1c-9c2c-aaaaaaaaaaaa"
const UUID_B = "5a0b6d1e-2222-4c1c-9c2c-bbbbbbbbbbbb"

describe("HandleRegistry — Zero-ID Model Context", () => {
  it("registra handles curtos por tipo, reaproveita o mesmo id e resolve só dentro da execução", () => {
    const registry = new HandleRegistry()
    expect(registry.register("I", UUID_A)).toBe("I1")
    expect(registry.register("I", UUID_B)).toBe("I2")
    expect(registry.register("I", UUID_A)).toBe("I1")
    expect(registry.register("K", UUID_A)).toBe("K1")
    expect(registry.resolve("i2")).toBe(UUID_B)
    expect(registry.resolve("I3")).toBeUndefined()
    // Outra execução = outro registry: o mesmo handle não resolve.
    expect(new HandleRegistry().resolve("I1")).toBeUndefined()
    expect(registry.entries()).toEqual([{ handle: "I1", kind: "I", realId: UUID_A }, { handle: "I2", kind: "I", realId: UUID_B }, { handle: "K1", kind: "K", realId: UUID_A }])
    expect(isHandle("M12")).toBe(true)
    expect(isHandle(UUID_A)).toBe(false)
  })

  it("projectForModel troca ids por handles, remove chaves técnicas e timestamps de infraestrutura, preserva o resto (sem mutar)", () => {
    const registry = new HandleRegistry()
    const data = { interactions: [{ interactionId: UUID_A, startedAt: "2026-09-10T13:00:00.000Z", localDate: "2026-09-10", subject: "Fatura", durationSeconds: 300 }], total: 2, organizationId: "org", operatorId: "op", measurementIds: ["m1"], patterns: [{ interactionEvidence: [{ interactionId: UUID_B, excerpt: "x" }] }], flags: [{ flag: "rechamada", interactionIds: [UUID_A, UUID_B] }], document: { documentId: UUID_A, title: "KB" } }
    const projected = JSON.stringify(projectForModel(data, registry))
    expect(projected).toBe('{"interactions":[{"interaction":"I1","localDate":"2026-09-10","subject":"Fatura","durationSeconds":300}],"total":2,"patterns":[{"interactionEvidence":[{"interaction":"I2","excerpt":"x"}]}],"flags":[{"flag":"rechamada","interactions":["I1","I2"]}],"document":{"document":"K1","title":"KB"}}')
    expect(countTechnicalIds(projected)).toBe(0)
    expect(countTechnicalIds(JSON.stringify(data))).toBe(5)
    expect(data.interactions[0]!.interactionId).toBe(UUID_A)
  })

  it("resolveModelArgs converte handles em ids reais; handle desconhecido ou UUID nunca visto nesta execução é recusado (nunca cross-execution/cross-org)", () => {
    const registry = new HandleRegistry()
    registry.register("I", UUID_A)
    expect(resolveModelArgs({ interactionIds: ["I1"], objective: "x" }, registry)).toEqual({ interactionIds: [UUID_A], objective: "x" })
    expect(resolveModelArgs({ interactionId: UUID_A }, registry)).toEqual({ interactionId: UUID_A })
    expect(() => resolveModelArgs({ interactionIds: ["I2"] }, registry)).toThrow(UnknownHandleError)
    expect(() => resolveModelArgs({ interactionId: UUID_B }, registry)).toThrow(UnknownHandleError)
    // K1 não é interação: handle de outro tipo também é recusado para o argumento errado.
    registry.register("K", UUID_B)
    expect(() => resolveModelArgs({ interactionId: "K1" }, registry)).toThrow(UnknownHandleError)
  })
})
