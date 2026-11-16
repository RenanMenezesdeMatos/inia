import { describe, expect, it } from "vitest"

import { areasFor, currentAreaOf } from "./area-switcher"

/** Seletor de área do cabeçalho: a área do Anjo deixou de ser uma área própria (11/11/2026) — é a aba "Apoio" do perfil, com um
 * atalho no cabeçalho (`anjo-shortcut.tsx`). */
describe("Área do Anjo fora do seletor de área", () => {
  const base = { profileHref: "/operator", canAccessAdministration: false, canReviewFeedback: false, canViewDiagnostics: false }

  it("o seletor não oferece mais \"Área do Anjo\"", () => {
    expect(areasFor(base).areas.map((area) => area.key)).toEqual(["profile"])
    expect(areasFor(base).tools).toEqual([])
  })

  it("/apoio (que leva à aba do perfil) pertence ao perfil", () => {
    expect(currentAreaOf("/apoio", "/operator").key).toBe("profile")
  })
})
