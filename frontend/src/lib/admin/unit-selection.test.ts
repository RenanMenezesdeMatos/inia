import { describe, expect, it } from "vitest"

import { coversUnit, hasOrgUnits, narrowToTeam, wholeTeams } from "./unit-selection"

const PARENTS = new Map([["a1", "a"], ["a2", "a"], ["b1", "b"]])
const place = (teamId: string | null, subteamId: string | null = null) => ({ teamId, subteamId })

describe("escolha de vários Grupos e Subgrupos", () => {
  it("sem escolha, tudo cabe; o Subgrupo refina o Grupo dele e os outros Grupos entram inteiros", () => {
    expect(hasOrgUnits({ teamId: [], subteamId: undefined })).toBe(false)
    expect(coversUnit({}, place(null), PARENTS)).toBe(true)
    const value = { teamId: ["a", "b"], subteamId: ["a1"] }
    expect([...wholeTeams(value, PARENTS)]).toEqual(["b"])
    expect(coversUnit(value, place("a", "a1"), PARENTS)).toBe(true)
    expect(coversUnit(value, place("a", "a2"), PARENTS)).toBe(false)
    expect(coversUnit(value, place("b", "b1"), PARENTS)).toBe(true)
    expect(coversUnit(value, place(null), PARENTS)).toBe(false)
    expect(coversUnit({ subteamId: ["a1", "b1"] }, place("b", "b1"), PARENTS)).toBe(true)
  })

  it("detalhar um Grupo mantém só os Subgrupos escolhidos dele", () => {
    expect(narrowToTeam({ teamId: ["a", "b"], subteamId: ["a1", "b1"] }, "a", PARENTS)).toEqual({ teamId: ["a"], subteamId: ["a1"] })
    expect(narrowToTeam({ teamId: ["a", "b"], subteamId: ["a1"] }, "b", PARENTS)).toEqual({ teamId: ["b"], subteamId: undefined })
  })
})
