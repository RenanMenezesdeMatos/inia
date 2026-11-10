import { describe, expect, it } from "vitest"

import { areasFor, currentAreaOf } from "./area-switcher"

/** Seletor de área do cabeçalho: "Área do Anjo" só com a capability de atender o apoio (Apoio com Anjo, design_draft.md seção 14). */
describe("Área do Anjo no seletor de área", () => {
  const base = { profileHref: "/operator", canAccessAdministration: false, canReviewFeedback: false, canViewDiagnostics: false }

  it("aparece entre as áreas só com canAttendHumanSupport, levando a /apoio", () => {
    expect(areasFor(base).areas.map((area) => area.key)).toEqual(["profile"])
    expect(areasFor({ ...base, canAttendHumanSupport: false }).areas.map((area) => area.key)).toEqual(["profile"])
    const anjo = areasFor({ ...base, canAttendHumanSupport: true }).areas.find((area) => area.key === "anjo")
    expect(anjo).toMatchObject({ label: "Área do Anjo", href: "/apoio", description: "Atender pedidos de apoio dos operadores" })
    expect(areasFor({ ...base, canAttendHumanSupport: true }).tools).toEqual([])
  })

  it("a rota /apoio é a área atual \"Área do Anjo\"; outras rotas não", () => {
    expect(currentAreaOf("/apoio", "/operator")).toEqual({ key: "anjo", label: "Área do Anjo" })
    expect(currentAreaOf("/apoio/qualquer", "/operator").key).toBe("anjo")
    expect(currentAreaOf("/apoiox", "/operator").key).toBe("profile")
  })
})
