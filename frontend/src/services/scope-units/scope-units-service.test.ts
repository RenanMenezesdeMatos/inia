import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({ adminGet: vi.fn() }))
vi.mock("@/lib/admin/admin-api", () => api)

import { fetchScopeUnitsByIds, MAX_SCOPE_UNIT_IDS } from "./scope-units-service"

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`
const unit = (id: string) => ({ kind: "TEAM", id, name: `Grupo ${id.slice(-3)}`, teamId: null, teamName: null, operatingUniverse: "B2C", productionOperators: 1, eligible: true, manageable: true })

beforeEach(() => {
  api.adminGet.mockReset()
  api.adminGet.mockImplementation(async (url: string) => ({ items: (new URLSearchParams(url.split("?")[1]).get("ids") ?? "").split(",").map(unit), nextCursor: null }))
})

describe("fetchScopeUnitsByIds (run-10 QA-06)", () => {
  it("resolve os 300 vínculos que o alcance aceita, em pedidos curtos (URL abaixo do maxQueryString padrão do IIS)", async () => {
    const ids = Array.from({ length: MAX_SCOPE_UNIT_IDS }, (_, index) => uuid(index))
    const items = await fetchScopeUnitsByIds("SUBTEAM", "workflows.manage", ids, ["B2B", "B2C", "B2X"])
    expect(items.map((item) => item.id).sort()).toEqual([...ids].sort())
    const urls = api.adminGet.mock.calls.map(([url]) => url as string)
    expect(urls.length).toBeGreaterThan(1)
    for (const url of urls) {
      expect(url.split("?")[1]!.length).toBeLessThan(2048)
      expect(new URLSearchParams(url.split("?")[1]).get("universes")).toBe("B2B,B2C,B2X")
    }
  })

  it("sem ids não pede nada; ids repetidos vão uma vez só", async () => {
    expect(await fetchScopeUnitsByIds("TEAM", "agents.manage", [])).toEqual([])
    expect(api.adminGet).not.toHaveBeenCalled()
    await fetchScopeUnitsByIds("TEAM", "agents.manage", [uuid(1), uuid(1)])
    expect(new URLSearchParams((api.adminGet.mock.calls[0]![0] as string).split("?")[1]).get("ids")).toBe(uuid(1))
  })
})
