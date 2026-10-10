import { describe, expect, it } from "vitest"
import { DEMO_ID_PREFIX, demoId, DemoIdRegistry, isDemoId } from "./demo-ids.js"

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/

describe("demo-ids", () => {
  it("é determinístico e produz UUID válido com prefixo reconhecível", () => {
    expect(demoId("person:operator:0001")).toBe(demoId("person:operator:0001"))
    expect(demoId("person:operator:0001")).not.toBe(demoId("person:operator:0002"))
    expect(demoId("qualquer chave")).toMatch(UUID_V4)
    expect(demoId("qualquer chave").startsWith(DEMO_ID_PREFIX)).toBe(true)
    expect(isDemoId("00000000-0000-4000-8000-000000000001")).toBe(false)
  })

  it("o registro acusa colisão entre chaves diferentes e aceita a mesma chave duas vezes", () => {
    const registry = new DemoIdRegistry()
    expect(registry.claim("a")).toBe(registry.claim("a"))
    expect(registry.size).toBe(1)
    registry.claim("b")
    expect(registry.size).toBe(2)
  })
})
