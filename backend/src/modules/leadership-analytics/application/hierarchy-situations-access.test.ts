import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import { buildLeadershipChatContext, loadLeadershipSession, toolDependencies } from "./leadership-context.js"
import { executeLeadershipTool, leadershipDeclarationsFor } from "./leadership-toolset.js"
import { HIERARCHY_DECLARATION, HIERARCHY_LEADERSHIP_DECLARATION, HIERARCHY_TOOL } from "./org-hierarchy.js"

/**
 * Férias por pessoa têm UMA regra (25/11/2026, `canViewVacations`): cargo de gestão ou `structure.vacations.view` na organização inteira.
 * A `org_hierarchy` alcança a organização toda, então segue a mesma regra: `indicators.view` num Grupo não basta (CFD-01, run-12).
 */
const GROUP = { teamIds: [L.team] }
const ORG_WIDE = { organizationWide: true }

async function sessionOf(personId: string, role: AuthTokenPayload["role"], grants: Record<string, { organizationWide?: boolean; teamIds?: string[] }>) {
  const user = leaderUser(personId, role)
  const repository = new InMemoryAnalyticsRepository({ ...leadershipOrg(), access: { [user.sub]: grants } })
  return (await loadLeadershipSession({} as Database, user, { repository, closure: CLOSURE }))!
}

const ask = async (session: Awaited<ReturnType<typeof sessionOf>>, asked: string[][] = []) => {
  const loadStatuses = async (ids: readonly string[]) => {
    asked.push([...ids])
    return new Map(ids.map((id) => [id, "FERIAS" as const]))
  }
  return executeLeadershipTool({ ...toolDependencies(session), loadStatuses }, HIERARCHY_TOOL, { consulta: "CONTAGEM", listar_pessoas: true, cadastro: "TODOS" })
}
const declared = (session: Awaited<ReturnType<typeof sessionOf>>) => leadershipDeclarationsFor(session.domainAccess, session.seesOrganizationSituations).find((declaration) => declaration.name === HIERARCHY_TOOL)

describe("situação funcional na hierarquia da organização", () => {
  it("operador com indicators.view num Grupo: só o organograma aberto — nem consulta a situação", async () => {
    const session = await sessionOf(operatorsOf(1)[0]!, "OPERATOR", { "indicators.view": GROUP })
    const asked: string[][] = []
    const result = await ask(session, asked)
    expect(asked).toEqual([])
    expect(JSON.stringify(result)).not.toMatch(/FÉRIAS|Férias|Situação funcional|inativo no cadastro/)
    expect(declared(session)).toBe(HIERARCHY_DECLARATION)
    const chat = await buildLeadershipChatContext(session)
    expect(chat.instructions).not.toContain("situação funcional de hoje de cada pessoa")
    expect(chat.instructions).toContain("org_hierarchy")
  })

  it("cargo de gestão continua com inativos e situação, em qualquer estrutura", async () => {
    const session = await sessionOf(L.sara, "SUPERVISOR", {})
    expect(JSON.stringify(await ask(session))).toContain("FÉRIAS")
    expect(declared(session)).toBe(HIERARCHY_LEADERSHIP_DECLARATION)
    expect((await buildLeadershipChatContext(session)).instructions).toContain("situação funcional de hoje de cada pessoa")
  })

  it("Administrador geral (structure.vacations.view na organização) vê, mesmo sem cargo de gestão; num Grupo, não", async () => {
    const operator = operatorsOf(1)[0]!
    expect(JSON.stringify(await ask(await sessionOf(operator, "OPERATOR", { "indicators.view": ORG_WIDE, "structure.vacations.view": ORG_WIDE })))).toContain("FÉRIAS")
    expect(JSON.stringify(await ask(await sessionOf(operator, "OPERATOR", { "indicators.view": ORG_WIDE, "structure.vacations.view": GROUP })))).not.toContain("FÉRIAS")
  })

  it("sem dizer de quem é a regra, vale o lado fechado", async () => {
    const repository = new InMemoryAnalyticsRepository(leadershipOrg())
    const scope = await loadViewerScope(repository, leaderUser(L.sara, "SUPERVISOR"))
    const result = await executeLeadershipTool({ repository, scope, closure: CLOSURE, loadPendingActions: async () => ({ pending: [], history: [], pendingCount: 0 }), loadStatuses: async (ids) => new Map(ids.map((id) => [id, "FERIAS" as const])) }, HIERARCHY_TOOL, { consulta: "CONTAGEM", listar_pessoas: true })
    expect(JSON.stringify(result)).not.toContain("FÉRIAS")
  })
})
