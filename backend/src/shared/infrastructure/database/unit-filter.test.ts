import { describe, expect, it, vi } from "vitest"
import { refinedUnits, unitMatcher } from "./unit-filter.js"

const dbOf = (parents: Record<string, string>) => ({
  query: vi.fn(async (_sql: string, params: [string[]]) => ({ rows: params[0].flatMap((id) => (parents[id] ? [{ team_id: parents[id] }] : [])) })),
})

describe("filtro de Grupo e Subgrupo em memória", () => {
  const night = [{ teamId: "vendas", subteamId: "noite" }, { teamId: "vendas", subteamId: "noite" }]

  it("Subgrupo sem ninguém na lista continua refinando o Grupo dele (a estrutura decide, nunca a lista)", async () => {
    const refined = await refinedUnits(dbOf({ manha: "vendas" }) as never, { teamId: ["vendas"], subteamId: ["manha"] })
    expect(refined).toEqual({ teamId: [], subteamId: ["manha"] })
    expect(night.filter(unitMatcher(refined))).toEqual([])
  })

  it("os outros Grupos escolhidos entram inteiros", async () => {
    const refined = await refinedUnits(dbOf({ manha: "vendas" }) as never, { teamId: ["vendas", "suporte"], subteamId: ["manha"] })
    expect([...night, { teamId: "suporte", subteamId: null }].filter(unitMatcher(refined))).toEqual([{ teamId: "suporte", subteamId: null }])
  })

  it("sem os dois tipos de escolha não consulta o banco; sem escolha, não filtra", async () => {
    const db = dbOf({})
    expect(await refinedUnits(db as never, { teamId: ["vendas"] })).toEqual({ teamId: ["vendas"], subteamId: [] })
    expect(db.query).not.toHaveBeenCalled()
    expect(night.filter(unitMatcher({}))).toHaveLength(2)
  })
})
