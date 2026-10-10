import { describe, expect, it } from "vitest"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { buildIndicatorMembers } from "./build-indicator-members.js"
import { buildStructureBreakdown, buildStructureDashboard } from "./build-structure-dashboard.js"
import { fixtureOrg, IDS } from "../testing/fixture-org.js"
import { InMemoryAnalyticsRepository, ORG } from "../testing/in-memory-analytics-repository.js"
import { loadViewerScope } from "./viewer-scope.js"

function user(personId: string, role: AuthTokenPayload["role"]): AuthTokenPayload {
  return { sub: "acc", personId, organizationId: ORG, role, name: "x", email: "x@inia.com", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe("Indicadores do Supervisor — consolidado da equipe", () => {
  it("não existe PRV de estrutura: a resposta é STRUCTURE, sem campo de PRV, com o método de consolidação documentado", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09")
    expect(dashboard.mode).toBe("STRUCTURE")
    expect("prv" in dashboard).toBe(false)
    expect(dashboard.consolidationMethod).toMatch(/Média aritmética simples/)
    expect(dashboard.groupingOptions).toEqual([])
  })

  it("consolidado = média dos atingimentos válidos (93,3 + 112,5 + 37,5) / 3 — o TMA em segundos sem atingimento oficial fica FORA, nunca vira zero nem mistura unidade", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09")
    expect(dashboard.consolidatedAchievementPercent).toBe(81.1)
    expect(dashboard.memberCount).toBe(2)
    expect(dashboard.membersWithData).toBe(2)
    // período anterior: só URA de op-1 (102.5) e op-2 (30) → 66.25 → 66.3
    expect(dashboard.previousConsolidatedAchievementPercent).toBe(66.3)
    expect(dashboard.deltaPp).toBe(14.8)
    expect(dashboard.trend).toBe("UP")
  })

  it("indicadores consolidados: por indicador, média entre membros; distribuição de quartil; membros abaixo da referência", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09")
    const ura = dashboard.indicators.find((indicator) => indicator.code === "NOTA_URA")!
    expect(ura.consolidatedAchievementPercent).toBe(75)
    expect(ura.membersWithData).toBe(2)
    expect(ura.membersBelowTarget).toBe(1)
    expect(ura.distribution).toEqual({ Q1: 1, Q2: 0, Q3: 0, Q4: 1, NO_DATA: 0 })
    const tma = dashboard.indicators.find((indicator) => indicator.code === "TMA")!
    expect(tma.consolidatedAchievementPercent).toBe(93.3)
    expect(tma.membersWithData).toBe(2)
    expect(tma.membersBelowTarget).toBe(2) // op-1: 93,3% oficial; op-2: 400s acima da meta de 300s (LOWER), sem atingimento oficial
    expect(tma.distribution).toEqual({ Q1: 0, Q2: 1, Q3: 0, Q4: 0, NO_DATA: 1 })
  })

  it("distribuição de PRV Q1–Q4 da equipe conta SEM DADOS à parte", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.bruno, "SUPERVISOR"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.bruno }, "2026-09")
    expect(dashboard.prvDistribution).toEqual({ Q1: 0, Q2: 1, Q3: 0, Q4: 0, NO_DATA: 1 })
    expect(dashboard.attentionPoints.map((insight) => insight.text)).toContain("1 de 2 colaborador está sem dado oficial neste período.")
  })

  it("estrutura sem nenhum dado no período → consolidado null e histórico todo null (estado vazio, não 0%)", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.bruno, "SUPERVISOR"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.bruno }, "2026-03")
    expect(dashboard.consolidatedAchievementPercent).toBeNull()
    expect(dashboard.indicators).toEqual([])
    expect(dashboard.history.every((point) => point.value === null)).toBe(true)
    expect(dashboard.attentionPoints[0]?.text).toBe("Nenhum membro possui dado oficial de atingimento neste período.")
  })

  it("carrega a performance da estrutura inteira em UMA query por tabela — nunca uma por colaborador", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    await buildStructureDashboard(repository, scope, { kind: "DIRECTOR_STRUCTURE", directorId: IDS.director }, "2026-09")
    expect(repository.calls.filter((call) => call === "loadIndicatorPerformance")).toHaveLength(1)
    expect(repository.calls.filter((call) => call === "loadPrvPerformance")).toHaveLength(1)
  })
})

describe("Gerência — Agrupar por e drill-down", () => {
  it("Diretor agrupa por Gerente Sênior/Gerente/Coordenador/Supervisor/Grupo/Subgrupo; cada grupo é navegável", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "DIRECTOR_STRUCTURE", directorId: IDS.director }, "2026-09")
    expect(dashboard.groupingOptions).toEqual(["SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])

    const byManager = await buildStructureBreakdown(repository, scope, { kind: "DIRECTOR_STRUCTURE", directorId: IDS.director }, "2026-09", "MANAGER")
    expect(byManager.groups.map((group) => [group.label, group.memberCount, group.consolidatedAchievementPercent, group.subject?.kind])).toEqual([
      ["Roberta Gerente", 2, 105.6, "MANAGER_STRUCTURE"],
      ["Roberto Gerente", 2, 81.1, "MANAGER_STRUCTURE"],
    ])
    expect(byManager.groups[1]).toMatchObject({ attentionCount: 2, improvingCount: 0, noDataCount: 0, topAttentionIndicators: [{ code: "NOTA_URA", consolidatedAchievementPercent: 75 }, { code: "TMA", consolidatedAchievementPercent: 93.3 }] })
    expect(byManager.groups[0]).toMatchObject({ attentionCount: 0, noDataCount: 1 })
  })

  it("quem não está sob nenhuma unidade da dimensão cai num balde residual explícito (não some nem duplica)", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    const byCoordinator = await buildStructureBreakdown(repository, scope, { kind: "DIRECTOR_STRUCTURE", directorId: IDS.director }, "2026-09", "COORDINATOR")
    expect(byCoordinator.groups.map((group) => [group.label, group.memberCount, group.subject === null])).toEqual([
      ["Patrícia Coordenadora", 2, false],
      ["Sem coordenador", 2, true],
    ])
    expect(byCoordinator.groups.reduce((sum, group) => sum + group.memberCount, 0)).toBe(4)
  })

  it("Gerente só agrupa por cargos abaixo do seu — pedir Gerente Sênior é rejeitado como agrupamento inválido", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.managerA, "MANAGER"))
    const dashboard = await buildStructureDashboard(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }, "2026-09")
    expect(dashboard.groupingOptions).toEqual(["COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
    await expect(buildStructureBreakdown(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }, "2026-09", "SENIOR_MANAGER")).rejects.toThrowError(/Agrupamento não disponível/)
  })

  it("agrupar por Subgrupo separa quem não tem subgrupo", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.managerA, "MANAGER"))
    const bySubteam = await buildStructureBreakdown(repository, scope, { kind: "MANAGER_STRUCTURE", managerId: IDS.managerA }, "2026-09", "SUBTEAM")
    expect(bySubteam.groups.map((group) => [group.label, group.memberCount])).toEqual([
      ["Chat", 1],
      ["Sem subgrupo", 1],
    ])
  })

  it("drill-down: o Diretor abre a equipe da Vanessa (dentro do escopo) e o breadcrumb mostra toda a cadeia", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.director, "DIRECTOR"))
    const team = await buildStructureDashboard(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09")
    expect(team.breadcrumb.map((entry) => entry.label)).toEqual(["Paulo Diretor", "Fernanda Sênior", "Roberto Gerente", "Patrícia Coordenadora", "Vanessa Supervisora"])
    expect(team.consolidatedAchievementPercent).toBe(81.1)
  })
})

describe("Colaboradores por indicador", () => {
  it("lista os membros com valor/atingimento/quartil/tendência, ordenados por atingimento e com SEM DADOS no fim", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const page = await buildIndicatorMembers(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09", "TMA", { sort: "achievement", order: "desc", page: 1, pageSize: 10 })
    expect(page.indicator).toMatchObject({ code: "TMA", name: "Tempo Médio de Atendimento", unit: "SECONDS", direction: "LOWER", capabilities: { operationalEnabled: true, officialClosureSupported: true } })
    expect(page.items.map((row) => [row.name, row.value, row.achievementPercent, row.withinTarget])).toEqual([
      ["Ana Operadora", 280, 93.3, false],
      ["Bia Operadora", 400, null, false],
    ])
    expect(page.total).toBe(2)
  })

  it("busca por nome e paginação são aplicadas no backend", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    const page = await buildIndicatorMembers(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09", "NOTA_URA", { search: "bia", sort: "name", order: "asc", page: 1, pageSize: 1 })
    expect(page.items.map((row) => row.name)).toEqual(["Bia Operadora"])
    expect(page.total).toBe(1)
  })

  it("indicador inexistente é erro de domínio claro", async () => {
    const repository = new InMemoryAnalyticsRepository(fixtureOrg())
    const scope = await loadViewerScope(repository, user(IDS.vanessa, "SUPERVISOR"))
    await expect(buildIndicatorMembers(repository, scope, { kind: "SUPERVISOR_TEAM", supervisorId: IDS.vanessa }, "2026-09", "NAO_EXISTE", { sort: "name", order: "asc", page: 1, pageSize: 10 })).rejects.toMatchObject({ code: "INDICATOR_NOT_FOUND" })
  })
})
