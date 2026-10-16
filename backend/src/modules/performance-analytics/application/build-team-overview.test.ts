import { describe, expect, it } from "vitest"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { buildTeamMembersPage, buildTeamOverview } from "./build-team-overview.js"
import { fixtureOrg, IDS } from "../testing/fixture-org.js"
import { definition, indicatorRow, InMemoryAnalyticsRepository, ORG, person } from "../testing/in-memory-analytics-repository.js"
import { loadViewerScope } from "./viewer-scope.js"

function user(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe("Equipe do Supervisor", () => {
  it("resumo por fatos: dentro/abaixo da referência, em evolução, sem dados, acompanhamentos sem ciência e revisões pendentes", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const overview = await buildTeamOverview(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09")
    expect(overview.showsMembersDirectly).toBe(true)
    expect(overview.units).toEqual([])
    expect(overview.summary).toEqual({ memberCount: 2, withinReference: 0, belowReference: 2, improving: 0, noData: 0, unacknowledgedFollowUps: 3, pendingReviews: 1 })
    expect(overview.filterOptions.indicators.map((indicator) => indicator.code)).toEqual(["TMA", "NOTA_URA"])
    expect(overview.filterOptions.subteams).toEqual([{ id: IDS.subteamA1, name: "Chat", teamId: IDS.teamA }])
  })

  it("linha do colaborador: situação, PRV oficial, média (não é PRV), indicadores em atenção, acompanhamentos e pendências", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const page = await buildTeamMembersPage(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09", { sort: "situation", order: "asc", page: 1, pageSize: 10 })
    expect(page.total).toBe(2)
    const bia = page.items.find((row) => row.name === "Bia Operadora")!
    expect(bia).toMatchObject({
      situation: "BELOW_REFERENCE",
      prvAchievementPercent: 35,
      prvQuartile: "Q4",
      averageAchievementPercent: 37.5,
      indicatorsWithData: 2,
      indicatorsBelowTarget: 2,
      followUps: { total: 2, unacknowledged: 2 },
      pendingReviews: 1,
    })
    expect(bia.attentionIndicators.map((indicator) => indicator.code)).toEqual(["NOTA_URA", "TMA"]) // menor atingimento primeiro; sem atingimento por último
    const ana = page.items.find((row) => row.name === "Ana Operadora")!
    expect(ana).toMatchObject({ situation: "BELOW_REFERENCE", prvAchievementPercent: 105, averageAchievementPercent: 102.9, indicatorsBelowTarget: 1 })
  })

  it("filtros: busca, situação, indicador em atenção, só com pendências, subgrupo", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const subject = { kind: "SUPERVISOR_TEAM" as const, supervisorId: IDS.vanessa }
    const base = { sort: "name" as const, order: "asc" as const, page: 1, pageSize: 10 }
    expect((await buildTeamMembersPage(repository, scope, subject, "2026-09", { ...base, search: "ana" })).items.map((row) => row.name)).toEqual(["Ana Operadora"])
    expect((await buildTeamMembersPage(repository, scope, subject, "2026-09", { ...base, attentionIndicatorCode: "NOTA_URA" })).items.map((row) => row.name)).toEqual(["Bia Operadora"])
    expect((await buildTeamMembersPage(repository, scope, subject, "2026-09", { ...base, pendingOnly: true })).items.map((row) => row.name)).toEqual(["Ana Operadora", "Bia Operadora"])
    expect((await buildTeamMembersPage(repository, scope, subject, "2026-09", { ...base, subteamId: IDS.subteamA1 })).items.map((row) => row.name)).toEqual(["Ana Operadora"])
    expect((await buildTeamMembersPage(repository, scope, subject, "2026-09", { ...base, situation: "WITHIN_REFERENCE" })).total).toBe(0)
  })

  it("filtro por indicador em atenção considera TODOS os indicadores abaixo — não só os 3 piores mostrados na linha", async () => {
    const org = fixtureOrg()
    for (const [code, achievement] of [["Q1", 50], ["Q2", 60], ["Q3", 70], ["Q4", 80]] as const) {
      org.definitions!.push(definition(code, `Indicador ${code}`, "PERCENT", "HIGHER"))
      org.indicatorRows!.push(indicatorRow({ personId: IDS.op1, indicatorCode: code, referencePeriod: "2026-09", value: achievement, targetValue: 100, achievementPercent: achievement }))
    }
    const repository = new InMemoryAnalyticsRepository(org)
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const page = await buildTeamMembersPage(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09", { sort: "name", order: "asc", page: 1, pageSize: 10, attentionIndicatorCode: "Q4" })
    const ana = page.items.find((row) => row.name === "Ana Operadora")!
    expect(ana.attentionIndicators.map((indicator) => indicator.code)).not.toContain("Q4")
    expect(page.items.map((row) => row.name)).toEqual(["Ana Operadora"])
  })

  it("SEM DADOS não vira zero: colaborador sem linhas tem média/PRV null e situação NO_DATA", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.bruno, "SUPERVISOR"))
    const page = await buildTeamMembersPage(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.bruno }, "2026-09", { sort: "achievement", order: "desc", page: 1, pageSize: 10 })
    expect(page.items.map((row) => [row.name, row.situation, row.averageAchievementPercent, row.prvAchievementPercent])).toEqual([
      ["Caio Operador", "IMPROVING", 105.6, 98],
      ["Dora Sem Dados", "NO_DATA", null, null],
    ])
  })
})

describe("Estrutura (Gerente+)", () => {
  it("Diretor vê primeiro as unidades do nível mais alto abaixo dele, nunca os operadores direto", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    const overview = await buildTeamOverview(repository, scope, { kind: "DIRECTOR_STRUCTURE", directorId: IDS.director }, "2026-09")
    expect(overview.showsMembersDirectly).toBe(false)
    expect(overview.unitsGroupBy).toBe("SENIOR_MANAGER")
    expect(overview.units.map((unit) => [unit.label, unit.leader?.role, unit.memberCount, unit.consolidatedAchievementPercent, unit.attentionCount])).toEqual([["Fernanda Sênior", "SENIOR_MANAGER", 4, 87.2, 2]])
    expect(overview.summary.memberCount).toBe(4)
  })

  it("drill-down desce nível a nível até a equipe, e a equipe mostra os membros", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    const senior = await buildTeamOverview(repository, scope, { kind: "SENIOR_MANAGER_STRUCTURE", seniorManagerId: IDS.senior }, "2026-09")
    expect(senior.unitsGroupBy).toBe("MANAGER")
    expect(senior.units.map((unit) => unit.label)).toEqual(["Roberta Gerente", "Roberto Gerente"])
    const managerB = await buildTeamOverview(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerB }, "2026-09")
    expect(managerB.unitsGroupBy).toBe("SUPERVISOR") // não há coordenador abaixo da Roberta — pula pro próximo nível existente
    expect(managerB.units.map((unit) => unit.label)).toEqual(["Bruno Supervisor"])
    const team = await buildTeamOverview(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.bruno }, "2026-09")
    expect(team.showsMembersDirectly).toBe(true)
    expect(team.breadcrumb.map((entry) => entry.label)).toEqual(["Paulo Diretor", "Fernanda Sênior", "Roberta Gerente", "Bruno Supervisor"])
  })

  it("unidades em cascata: quem não tem coordenador cai no próximo nível (supervisor); operador sem gestor algum é listado como direto", async () => {
    const org = fixtureOrg()
    org.people.push(
      person({ id: "10000000-0000-4000-8000-000000000008", name: "Mariana Supervisora", role: "SUPERVISOR", reportsToId: IDS.managerA }),
      person({ id: "10000000-0000-4000-8000-000000000015", name: "Eva Operadora", role: "OPERATOR", reportsToId: "10000000-0000-4000-8000-000000000008" }),
      person({ id: "10000000-0000-4000-8000-000000000016", name: "Fábio Direto", role: "OPERATOR", reportsToId: IDS.managerA }),
    )
    const repository = new InMemoryAnalyticsRepository(org)
    const scope = await loadViewerScope(repository, user(IDS.managerA, "MANAGER"))
    const overview = await buildTeamOverview(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }, "2026-09")
    expect(overview.units.map((unit) => [unit.label, unit.leader?.role, unit.memberCount])).toEqual([
      ["Patrícia Coordenadora", "COORDINATOR", 2],
      ["Mariana Supervisora", "SUPERVISOR", 1],
    ])
    expect(overview.unitsGroupBy).toBe("COORDINATOR")
    expect(overview.showsMembersDirectly).toBe(false)
    expect(overview.directMemberCount).toBe(1)
    const direct = await buildTeamMembersPage(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }, "2026-09", { directOnly: true, sort: "name", order: "asc", page: 1, pageSize: 10 })
    expect(direct.items.map((row) => row.name)).toEqual(["Fábio Direto"])
  })

  it("revisões pendentes das unidades consideram só as endereçadas a quem está olhando", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.managerA, "MANAGER"))
    const overview = await buildTeamOverview(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }, "2026-09")
    expect(overview.unitsGroupBy).toBe("COORDINATOR")
    expect(overview.units[0]).toMatchObject({ label: "Patrícia Coordenadora", pendingReviews: 2 })
    expect(overview.summary.pendingReviews).toBe(2)
  })
})
