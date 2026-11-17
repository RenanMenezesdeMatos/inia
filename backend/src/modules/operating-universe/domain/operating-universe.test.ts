import { describe, expect, it } from "vitest"
import { narrowUniverses, parseOperatingUniverse, resourceUsableIn, universeAccessFor, universesCompatible } from "./operating-universe.js"
import { personAllowedByUniverse } from "../application/universe-access.js"

describe("universo de atuação — domínio", () => {
  it("B2X é universo próprio; carga aceita só os três códigos", () => {
    expect(parseOperatingUniverse(" b2x ")).toBe("B2X")
    expect(parseOperatingUniverse("")).toBeNull()
    expect(parseOperatingUniverse("B2B2C")).toBe("INVALID")
    expect(universesCompatible("B2X", "B2B")).toBe(false)
    expect(universesCompatible("B2X", null)).toBe(true)
  })

  it("sem ativação nada é filtrado; com ativação, só o próprio universo (pendente = nenhum) ou todos com a permissão", () => {
    expect(resourceUsableIn(universeAccessFor({ enforced: false, own: null, allUniverses: false }), null)).toBe(true)
    const b2b = universeAccessFor({ enforced: true, own: "B2B", allUniverses: false })
    expect([resourceUsableIn(b2b, "B2B"), resourceUsableIn(b2b, "B2C"), resourceUsableIn(b2b, null)]).toEqual([true, false, false])
    expect(universeAccessFor({ enforced: true, own: null, allUniverses: false })).toMatchObject({ universes: [] })
    expect(universeAccessFor({ enforced: true, own: "B2B", allUniverses: true })).toMatchObject({ universes: ["B2B", "B2C", "B2X"] })
  })

  it("filtro da tela opera dentro da permissão: pedir outro universo é 403, nunca vazio silencioso", () => {
    const b2b = universeAccessFor({ enforced: true, own: "B2B", allUniverses: false })
    expect(narrowUniverses(b2b, [])).toEqual(["B2B"])
    expect(() => narrowUniverses(b2b, ["B2C"])).toThrow(expect.objectContaining({ code: "OPERATING_UNIVERSE_FORBIDDEN", statusCode: 403 }))
    expect(narrowUniverses(universeAccessFor({ enforced: true, own: "B2B", allUniverses: true }), ["B2X"])).toEqual(["B2X"])
  })

  it("pessoas: universo do viewer, ou a permissão de todos os universos no ESCOPO dela (Grupo/Subgrupo/organização/estrutura)", () => {
    const person = (operatingUniverse: string | null, teamId = "X", subteamId = "Y") => ({ id: "p", teamId, subteamId, operatingUniverse })
    const none = { organizationWide: false, teamIds: [], subteamIds: [] }
    const coordB2B = { enforced: true, own: "B2B" as const, cross: none, crossInStructure: false }
    // Pelo PAPEL (fora da própria estrutura): só o universo do viewer; pendente fica fora.
    expect([personAllowedByUniverse(coordB2B, person("B2B"), false), personAllowedByUniverse(coordB2B, person("B2C"), false), personAllowedByUniverse(coordB2B, person(null), false)]).toEqual([true, false, false])
    // Na PRÓPRIA estrutura (hierarquia): qualquer universo — supervisor pode liderar equipes B2B e B2C.
    expect([personAllowedByUniverse(coordB2B, person("B2C"), true), personAllowedByUniverse(coordB2B, person(null), true)]).toEqual([true, true])
    const groupX = { ...coordB2B, cross: { ...none, teamIds: ["X"] } }
    expect([personAllowedByUniverse(groupX, person("B2C"), false), personAllowedByUniverse(groupX, person("B2C", "Z", "W"), false)]).toEqual([true, false])

    expect(personAllowedByUniverse({ ...coordB2B, enforced: false }, person("B2C"), false)).toBe(true)
  })
})
