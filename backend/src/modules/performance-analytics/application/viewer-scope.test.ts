import { describe, expect, it } from "vitest"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { fixtureOrg, IDS } from "../testing/fixture-org.js"
import { InMemoryAnalyticsRepository, ORG, person, type InMemoryOrg } from "../testing/in-memory-analytics-repository.js"
import { buildBreadcrumb, loadViewerScope, resolveDefaultSubject, resolveSubject, type ScopePermission } from "./viewer-scope.js"

function user(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe("escopo do viewer — sujeito padrão por papel", () => {
  it("Operador → o próprio colaborador; Supervisor → a própria equipe; Gerente+ → a própria estrutura", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    expect(resolveDefaultSubject(await loadViewerScope(repository, user(IDS.op1, "OPERATOR")))?.subject).toEqual({ kind: "EMPLOYEE", employeeId: IDS.op1 })
    expect(resolveDefaultSubject(await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR")))?.subject).toEqual({ kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa })
    expect(resolveDefaultSubject(await loadViewerScope(repository, user(IDS.coordinator, "COORDINATOR")))?.subject).toEqual({ kind: "COORDINATOR_STRUCTURE", coordinatorId: IDS.coordinator })
    expect(resolveDefaultSubject(await loadViewerScope(repository, user(IDS.managerA, "MANAGER")))?.subject).toEqual({ kind: "MANAGER_STRUCTURE", managerId: IDS.managerA })
    expect(resolveDefaultSubject(await loadViewerScope(repository, user(IDS.senior, "SENIOR_MANAGER")))?.subject).toEqual({ kind: "SENIOR_MANAGER_STRUCTURE", seniorManagerId: IDS.senior })
    expect(resolveDefaultSubject(await loadViewerScope(repository, user(IDS.director, "DIRECTOR")))?.subject).toEqual({ kind: "DIRECTOR_STRUCTURE", directorId: IDS.director })
  })

  it("carrega a subárvore UMA vez (uma CTE), nunca uma query por pessoa", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    expect(repository.calls).toEqual(["loadPerson", "loadAccessVisibility", "loadDescendants", "loadPeopleInVisibility"])
  })
})

describe("V1.5.8 — visão ampliada só por permission + scope, nunca pelo nível hierárquico", () => {
  const ADMIN_PERSON = "admin-legado"
  const orgWith = (access: InMemoryOrg["access"] = {}) => {
    const org = fixtureOrg()
    org.people.push(person({ id: ADMIN_PERSON, name: "Admin Legado", role: "ADMIN" }))
    org.access = access
    return new InMemoryAnalyticsRepository(org)
  }
  const visibleIds = async (repository: InMemoryAnalyticsRepository, viewer: AuthTokenPayload, permission?: ScopePermission) => [...(await loadViewerScope(repository, viewer, permission)).nodes.keys()].sort()
  const admin = user(ADMIN_PERSON, "ADMIN")

  it("people.role = ADMIN sem atribuição: nenhum bypass — ninguém visível, qualquer colaborador dá 403", async () => {
    const repository = orgWith()
    expect(await visibleIds(repository, admin)).toEqual([])
    const scope = await loadViewerScope(repository, admin)
    expect(() => resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op1 })).toThrow(/acesso/)
    expect(resolveDefaultSubject(scope)).toBeNull()
  })

  it("indicators.view com escopo SUBGROUP (Chat): só quem é do Subgrupo — nem o resto do Grupo, nem outro Grupo", async () => {
    const repository = orgWith({ acc: { "indicators.view": { subteamIds: [IDS.subteamA1] } } })
    expect(await visibleIds(repository, admin)).toEqual([IDS.op1])
    const scope = await loadViewerScope(repository, admin)
    expect(resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op1 }).members.map((node) => node.id)).toEqual([IDS.op1])
    expect(() => resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op2 })).toThrow(/acesso/)
    expect(() => resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op3 })).toThrow(/acesso/)
    expect(() => resolveSubject(scope, { kind: "TEAM", teamId: IDS.teamB })).toThrow(/acesso/)
  })

  it("indicators.view com escopo GROUP: o Grupo inteiro (inclusive Subgrupos), nunca o outro Grupo", async () => {
    const repository = orgWith({ acc: { "indicators.view": { teamIds: [IDS.teamA] } } })
    const visible = await visibleIds(repository, admin)
    expect(visible).toContain(IDS.op1)
    expect(visible).toContain(IDS.op2)
    expect(visible).not.toContain(IDS.op3)
    expect(visible).not.toContain(IDS.op4)
  })

  it("indicators.view com escopo ORGANIZATION: a organização inteira", async () => {
    const repository = orgWith({ acc: { "indicators.view": { organizationWide: true } } })
    expect(await visibleIds(repository, admin)).toEqual(fixtureOrg().people.map((node) => node.id).sort())
  })

  it("a permissão é da SUPERFÍCIE: calendar.manage não amplia Indicadores (e vice-versa)", async () => {
    const repository = orgWith({ acc: { "calendar.manage": { organizationWide: true } } })
    expect(await visibleIds(repository, admin)).toEqual([])
    expect((await visibleIds(repository, admin, "calendar.manage")).length).toBe(fixtureOrg().people.length)
  })

  it("Supervisor sem atribuição: continua com a própria equipe (regra operacional), sem visão ampla", async () => {
    const repository = orgWith()
    const visible = await visibleIds(repository, user(IDS.vanessa, "SUPERVISOR"))
    expect(visible).toEqual([IDS.op1, IDS.op2].sort())
  })

  it("operacional ∪ acesso: Supervisora de A com indicators.view no Grupo B vê a própria equipe + o Grupo B", async () => {
    const repository = orgWith({ acc: { "indicators.view": { teamIds: [IDS.teamB] } } })
    const visible = await visibleIds(repository, user(IDS.vanessa, "SUPERVISOR"))
    expect(visible).toEqual(expect.arrayContaining([IDS.op1, IDS.op2, IDS.op3, IDS.op4, IDS.bruno]))
    expect(visible).not.toContain(IDS.coordinator)
  })
})

describe("escopo do viewer — autorização", () => {
  it("Supervisor não abre a equipe de outro supervisor nem um operador de fora", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.vanessa, "SUPERVISOR"))
    expect(() => resolveSubject(scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.bruno })).toThrowError(/não tem acesso/)
    expect(() => resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op3 })).toThrowError(/não tem acesso/)
    expect(() => resolveSubject(scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA })).toThrowError(/não tem acesso/)
  })

  it("Supervisor vê a própria equipe direta e cada operador dela", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.vanessa, "SUPERVISOR"))
    expect(resolveSubject(scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }).members.map((member) => member.id)).toEqual([IDS.op1, IDS.op2])
    expect(resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op2 }).members.map((member) => member.id)).toEqual([IDS.op2])
  })

  it("Gerente não escapa do próprio escopo: outro gerente, o diretor e um Grupo de fora dão 403", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.managerA, "MANAGER"))
    expect(() => resolveSubject(scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerB })).toThrowError(/não tem acesso/)
    expect(() => resolveSubject(scope, { kind: "DIRECTOR_STRUCTURE", directorId: IDS.director })).toThrowError(/não tem acesso/)
    expect(() => resolveSubject(scope, { kind: "TEAM", teamId: IDS.teamB })).toThrowError(/não tem acesso/)
    expect(() => resolveSubject(scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.bruno })).toThrowError(/não tem acesso/)
  })

  it("Gerente enxerga toda a estrutura abaixo (coordenadora → supervisora → operadores) e o recorte do Grupo dentro dela", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.managerA, "MANAGER"))
    expect(resolveSubject(scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }).members.map((member) => member.id)).toEqual([IDS.op1, IDS.op2])
    expect(resolveSubject(scope, { kind: "COORDINATOR_STRUCTURE", coordinatorId: IDS.coordinator }).members.map((member) => member.id)).toEqual([IDS.op1, IDS.op2])
    expect(resolveSubject(scope, { kind: "TEAM", teamId: IDS.teamA }).members.map((member) => member.id)).toEqual([IDS.op1, IDS.op2])
    expect(resolveSubject(scope, { kind: "SUBTEAM", subteamId: IDS.subteamA1 }).members.map((member) => member.id)).toEqual([IDS.op1])
  })

  it("Operador só vê a si mesmo", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.op1, "OPERATOR"))
    expect(resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op1 }).members.map((member) => member.id)).toEqual([IDS.op1])
    expect(() => resolveSubject(scope, { kind: "EMPLOYEE", employeeId: IDS.op2 })).toThrowError(/não tem acesso/)
    expect(() => resolveSubject(scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa })).toThrowError(/não tem acesso/)
  })

  it("Diretor: um Grupo que não tem ninguém no escopo continua negado (nunca vaza gente de outra estrutura)", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.director, "DIRECTOR"))
    expect(() => resolveSubject(scope, { kind: "TEAM", teamId: "20000000-0000-4000-8000-000000000099" })).toThrowError(/não tem acesso/)
  })
})

describe("breadcrumb", () => {
  it("vai do sujeito padrão do viewer até o colaborador, passando por cada gestor intermediário", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.director, "DIRECTOR"))
    const trail = buildBreadcrumb(scope, { kind: "EMPLOYEE", employeeId: IDS.op1 })
    expect(trail.map((entry) => [entry.kind, entry.label])).toEqual([
      ["DIRECTOR_STRUCTURE", "Paulo Diretor"],
      ["SENIOR_MANAGER_STRUCTURE", "Fernanda Sênior"],
      ["MANAGER_STRUCTURE", "Roberto Gerente"],
      ["COORDINATOR_STRUCTURE", "Patrícia Coordenadora"],
      ["SUPERVISOR_TEAM", "Vanessa Supervisora"],
      ["EMPLOYEE", "Ana Operadora"],
    ])
  })

  it("no sujeito padrão só existe a raiz", async () => {
    const scope = await loadViewerScope(new InMemoryAnalyticsRepository(fixtureOrg()), user(IDS.vanessa, "SUPERVISOR"))
    expect(buildBreadcrumb(scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa })).toHaveLength(1)
  })
})
