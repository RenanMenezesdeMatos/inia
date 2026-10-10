import { describe, expect, it } from "vitest"
import type { AccessContext } from "../../../access/domain/access-decision.js"
import { identifiedScopeCoversView } from "./usability-context.js"

/** Achado I-F8: nomes na Monitoria só quando o escopo de `usability.users.view` cobre todo o recorte de `usability.view`. */
const context = (assignments: AccessContext["assignments"]): AccessContext => ({ organizationId: "org", accountId: "acc", personId: "p", assignments })

describe("monitoria de usabilidade — escopo das listas identificadas", () => {
  it("Analista no mesmo escopo do recorte identifica pessoas", () => {
    expect(identifiedScopeCoversView(context([{ id: "1", roleCode: "ANALISTA_DE_USABILIDADE", scope: { type: "GROUP", teamId: "t1" } }]))).toBe(true)
    expect(identifiedScopeCoversView(context([{ id: "1", roleCode: "ANALISTA_DE_USABILIDADE", scope: { type: "MY_STRUCTURE" } }]))).toBe(true)
  })

  it("Leitor na organização + Analista num Subgrupo: o recorte é a organização, os nomes não", () => {
    expect(identifiedScopeCoversView(context([
      { id: "1", roleCode: "LEITOR_DE_USABILIDADE", scope: { type: "ORGANIZATION" } },
      { id: "2", roleCode: "ANALISTA_DE_USABILIDADE", scope: { type: "SUBGROUP", subteamId: "s1", teamId: "t1" } },
    ]))).toBe(false)
  })

  it("Analista na organização cobre qualquer recorte", () => {
    expect(identifiedScopeCoversView(context([
      { id: "1", roleCode: "LEITOR_DE_USABILIDADE", scope: { type: "GROUP", teamId: "t2" } },
      { id: "2", roleCode: "ANALISTA_DE_USABILIDADE", scope: { type: "ORGANIZATION" } },
    ]))).toBe(true)
  })
})
