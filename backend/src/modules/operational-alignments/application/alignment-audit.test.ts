import { describe, expect, it, vi } from "vitest"

import { alignmentChangesOf, recordAlignmentUsage, runAlignmentLifecycle } from "./alignment-audit.js"

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

/**
 * QA-02 — o sino "alinhamento em vigor" não se perde quando o envio falha: o evento STARTED (o marcador de "já avisei") só é gravado
 * depois do envio; a passada seguinte chama o aviso de novo para a mesma versão. Banco em memória mínimo: versões + eventos STARTED.
 */
function lifecycleDb(versions: { id: string; effectiveFrom: Date }[]) {
  const startedEvents = new Set<string>()
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      const now = params[0] as Date
      const begun = versions.filter((version) => version.effectiveFrom.getTime() <= now.getTime())
      if (sql.trimStart().startsWith("select")) return { rows: begun.filter((version) => !startedEvents.has(version.id)).map((version) => ({ version_id: version.id, effective_from: version.effectiveFrom })), rowCount: 0 }
      if (sql.includes("'STARTED'")) {
        const held = params[1] as string[]
        const fresh = begun.filter((version) => !held.includes(version.id) && !startedEvents.has(version.id))
        for (const version of fresh) startedEvents.add(version.id)
        return { rows: [], rowCount: fresh.length }
      }
      return { rows: [], rowCount: 0 }
    },
  }
  return { db: db as never, startedEvents }
}

describe("job do ciclo de vida: aviso de alinhamento em vigor (QA-02)", () => {
  const now = new Date("2026-11-19T12:00:00Z")
  const silence = () => vi.spyOn(console, "error").mockImplementation(() => undefined)

  it("envio que falha não marca a versão como iniciada: a próxima passada avisa de novo, e só então o evento é gravado uma vez", async () => {
    const errors = silence()
    const { db, startedEvents } = lifecycleDb([{ id: "v-nova", effectiveFrom: new Date("2026-11-19T11:00:00Z") }])
    const notify = vi.fn<(versionIds: string[], at: Date) => Promise<unknown>>().mockRejectedValueOnce(new Error("conexão caiu")).mockResolvedValue(1)
    expect(await runAlignmentLifecycle(db, now, notify)).toMatchObject({ started: 0 })
    expect(startedEvents.size).toBe(0)
    expect(await runAlignmentLifecycle(db, now, notify)).toMatchObject({ started: 1 })
    expect(notify).toHaveBeenCalledTimes(2)
    expect(notify).toHaveBeenLastCalledWith(["v-nova"], now)
    expect([...startedEvents]).toEqual(["v-nova"])
    // Já marcada: nenhuma passada posterior avisa de novo.
    expect(await runAlignmentLifecycle(db, now, notify)).toMatchObject({ started: 0 })
    expect(notify).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })

  it("versão que começou há mais que a janela do aviso tem o evento gravado mesmo com o envio falhando (o rastro não fica preso)", async () => {
    const errors = silence()
    const { db, startedEvents } = lifecycleDb([{ id: "v-antiga", effectiveFrom: new Date("2026-11-10T11:00:00Z") }, { id: "v-nova", effectiveFrom: new Date("2026-11-19T11:00:00Z") }])
    const notify = vi.fn(async () => Promise.reject(new Error("fora do ar")))
    expect(await runAlignmentLifecycle(db, now, notify)).toMatchObject({ started: 1 })
    expect([...startedEvents]).toEqual(["v-antiga"])
    errors.mockRestore()
  })
})
