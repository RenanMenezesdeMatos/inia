import { describe, expect, it, vi } from "vitest"

import { alignmentChangesOf, recordAlignmentUsage } from "./alignment-audit.js"

describe("rastro de auditoria dos alinhamentos", () => {
  it("guarda só os campos que mudaram (antes e depois) e os processos incluídos e excluídos", () => {
    const before = { fields: { title: "A", guidance: "Oriente o app.", startsOn: "2026-11-10" }, processes: ["p1", "p2"] }
    const after = { fields: { title: "A", guidance: "Oriente o app ou o site.", startsOn: "2026-11-10" }, processes: ["p2", "p3"] }
    expect(alignmentChangesOf(before, after)).toEqual({ changedFields: ["guidance"], processesAdded: ["p3"], processesRemoved: ["p1"], before: { guidance: "Oriente o app." }, after: { guidance: "Oriente o app ou o site." } })
    expect(alignmentChangesOf(null, after)).toMatchObject({ changedFields: ["title", "guidance", "startsOn"], processesAdded: ["p2", "p3"], processesRemoved: [] })
  })

  it("uso pela IA nunca derruba a resposta: escrita recusada (QA Lab) é ignorada; sem alinhamento aplicado, nada é gravado", async () => {
    const query = vi.fn(async () => {
      throw Object.assign(new Error("bloqueado"), { code: "QA_WRITE_BLOCKED" })
    })
    const resolution = { rule: "OPERATIONAL_ALIGNMENT_RULE_V1" as const, status: "RESOLVED" as const, referenceDate: new Date("2026-11-15T15:00:00Z"), applied: [{ alignmentId: "a1", versionId: "v1" }] as never, setAside: [], productPrecedence: [] }
    expect(() => recordAlignmentUsage({ query } as never, "org", resolution, { surface: "CONVERSATION", personId: "p1" })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(query).toHaveBeenCalledTimes(1)
    recordAlignmentUsage({ query } as never, "org", { ...resolution, applied: [] }, { surface: "CONVERSATION", personId: "p1" })
    expect(query).toHaveBeenCalledTimes(1)
  })
})
