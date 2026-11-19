import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import type { DomainFactsLoader } from "./data-domains.js"
import { loadLeadershipSession, toolDependencies } from "./leadership-context.js"
import { executeLeadershipTool, leadershipDeclarationsFor } from "./leadership-toolset.js"

/**
 * DC-06 — `ai.usage_ranking.view` com escopo "Minha estrutura": a tela "Quem mais usa" aceita, então o chat da liderança também
 * (população = a própria subárvore). No Apoio com Anjo "Minha estrutura" continua sem valer.
 */
const ORG_WIDE = { organizationWide: true, teamIds: [], subteamIds: [] }

async function sessionOf(grants: Record<string, { myStructure?: boolean; organizationWide?: boolean }>) {
  const user = leaderUser(L.carla, "COORDINATOR")
  const repository = new InMemoryAnalyticsRepository({ ...leadershipOrg(), access: { [user.sub]: { "indicators.view": ORG_WIDE, ...grants } } })
  const session = await loadLeadershipSession({} as Database, user, { repository, closure: CLOSURE })
  return session!
}

describe("uso da INIA com a permissão em \"Minha estrutura\" (DC-06)", () => {
  it("a ferramenta é declarada e a população fica na própria subárvore, mesmo com a estrutura consultada fora dela", async () => {
    const session = await sessionOf({ "ai.usage_ranking.view": { myStructure: true } })
    expect(leadershipDeclarationsFor(session.domainAccess).map((declaration) => declaration.name)).toContain("leadership_inia_usage")
    const asked: string[][] = []
    const loader: DomainFactsLoader = async (_domain, ids) => {
      asked.push([...ids].sort())
      return { facts: [], truncated: false }
    }
    const deps = { ...toolDependencies(session), loadDomainFacts: loader }
    const own = await executeLeadershipTool(deps, "leadership_inia_usage", { estrutura: "Sara", agrupar_por: "PESSOA" })
    expect(own.issue?.kind).not.toBe("INVALID")
    await executeLeadershipTool(deps, "leadership_inia_usage", { estrutura: "Sônia", agrupar_por: "PESSOA" })
    expect(asked).toEqual([operatorsOf(1).sort(), []])
  })

  it("sem a permissão em lugar nenhum a ferramenta continua fora; no Apoio com Anjo \"Minha estrutura\" não vale", async () => {
    const none = await sessionOf({})
    expect(leadershipDeclarationsFor(none.domainAccess).map((declaration) => declaration.name)).not.toContain("leadership_inia_usage")
    const support = await sessionOf({ "human_support.coordinate": { myStructure: true } })
    const names = leadershipDeclarationsFor(support.domainAccess).map((declaration) => declaration.name)
    expect(names).not.toContain("leadership_support")
    expect(names).not.toContain("leadership_inia_usage")
  })
})
