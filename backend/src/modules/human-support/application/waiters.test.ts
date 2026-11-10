import { afterEach, describe, expect, it, vi } from "vitest"
import { versionKey } from "./inbox-versions.js"
import { createWaiterRegistry } from "./waiters.js"

const ORG = "org-1"
afterEach(() => vi.useRealTimers())

function registryWith(versions: Map<string, string>) {
  const reads: number[] = []
  const registry = createWaiterRegistry({
    tickMs: 1000,
    readVersions: async (keys) => {
      reads.push(keys.length)
      return new Map(keys.map((key) => [versionKey(key.organizationId, key.personId), versions.get(versionKey(key.organizationId, key.personId)) ?? "0"]))
    },
  })
  return { registry, reads }
}

describe("registro de esperas das chamadas longas", () => {
  it("responde por mudança no laço de 1 s, com UMA leitura para todas as pessoas esperando", async () => {
    vi.useFakeTimers()
    const versions = new Map([[versionKey(ORG, "ana"), "3"], [versionKey(ORG, "bia"), "7"]])
    const { registry, reads } = registryWith(versions)
    const ana = registry.wait({ organizationId: ORG, personId: "ana", since: "3", timeoutMs: 20_000 })
    const bia = registry.wait({ organizationId: ORG, personId: "bia", since: "7", timeoutMs: 20_000 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(reads).toEqual([2])
    versions.set(versionKey(ORG, "ana"), "4")
    await vi.advanceTimersByTimeAsync(1000)
    await expect(ana).resolves.toBe("CHANGED")
    expect(registry.stats()).toMatchObject({ open: 1, answeredByChange: 1 })
    registry.stop()
    await expect(bia).resolves.toBe("CANCELLED")
  })

  it("responde pelo prazo; sem nenhuma espera, o laço para (nenhuma leitura)", async () => {
    vi.useFakeTimers()
    const { registry, reads } = registryWith(new Map())
    const waiting = registry.wait({ organizationId: ORG, personId: "ana", since: "0", timeoutMs: 2500 })
    await vi.advanceTimersByTimeAsync(2500)
    await expect(waiting).resolves.toBe("TIMEOUT")
    const before = reads.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(reads.length).toBe(before)
    expect(registry.stats()).toMatchObject({ open: 0, answeredByTimeout: 1 })
  })

  it("dreno: as abertas respondem na hora e as novas também", async () => {
    vi.useFakeTimers()
    const { registry } = registryWith(new Map())
    const open = registry.wait({ organizationId: ORG, personId: "ana", since: "0", timeoutMs: 20_000 })
    registry.drain()
    await expect(open).resolves.toBe("DRAINING")
    await expect(registry.wait({ organizationId: ORG, personId: "bia", since: "0", timeoutMs: 20_000 })).resolves.toBe("DRAINING")
    expect(registry.draining).toBe(true)
    expect(registry.stats().answeredByDrain).toBe(2)
  })

  it("a quinta chamada da mesma pessoa faz a mais antiga responder; cancelar pela conexão fechada tira da lista", async () => {
    vi.useFakeTimers()
    const { registry } = registryWith(new Map())
    const calls = Array.from({ length: 4 }, () => registry.wait({ organizationId: ORG, personId: "ana", since: "0", timeoutMs: 20_000 }))
    const fifth = registry.wait({ organizationId: ORG, personId: "ana", since: "0", timeoutMs: 20_000 })
    await expect(calls[0]).resolves.toBe("EVICTED")
    expect(registry.stats().open).toBe(4)
    const controller = new AbortController()
    const other = registry.wait({ organizationId: ORG, personId: "bia", since: "0", timeoutMs: 20_000, signal: controller.signal })
    controller.abort()
    await expect(other).resolves.toBe("CANCELLED")
    registry.stop()
    await expect(fifth).resolves.toBe("CANCELLED")
  })
})
