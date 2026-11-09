import { beforeEach, describe, expect, it, vi } from "vitest"
import type { AnalyticsReadRepository, PersonNode } from "../../performance-analytics/application/analytics-read-repository.js"
import { clearOfficialAnalyticsCache } from "../../performance-analytics/application/official-analytics-cache.js"
import type { ViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { periodCoveredFor, resolveAnalysisPeriod } from "./references.js"

const ORG = "org-1"
const viewer: PersonNode = { id: "dir", name: "Diretora", role: "DIRECTOR", reportsToId: null, teamId: null, teamName: null, subteamId: null, subteamName: null, avatarUrl: null, jobTitle: null, operationalCapitalCode: null } as PersonNode
const scope: ViewerScope = { viewer, role: "DIRECTOR", organizationId: ORG, accountId: "acc", access: { organizationWide: true, teamIds: [], subteamIds: [] }, nodes: new Map(), children: new Map() }
const closure = { lastClosedPeriod: "2026-09", now: new Date("2026-10-17T12:00:00-03:00"), timeZone: "America/Sao_Paulo" }
const members = ["a", "b", "c", "d"]

function repositoryWith(versions: { STRUCTURE: string; OFFICIAL: string }) {
  const state = { versions }
  const repository = {
    loadCacheVersions: vi.fn(async () => state.versions),
    loadPeriodCoverage: vi.fn(async () => [{ period: "2026-09", people: 4 }]),
    loadIndicatorPerformance: vi.fn(async () => [
      { personId: "a", referencePeriod: "2026-08", indicatorCode: "TMA" },
      { personId: "b", referencePeriod: "2026-08", indicatorCode: "TMA" },
      { personId: "c", referencePeriod: "2026-08", indicatorCode: "TMA" },
    ]),
    loadPrvPerformance: vi.fn(async () => []),
  }
  return { repository: repository as unknown as AnalyticsReadRepository, spies: repository, state }
}

describe("competência da análise — cache oficial", () => {
  beforeEach(() => clearOfficialAnalyticsCache())

  it("mesma estrutura e mesmas versões: a cobertura do histórico é lida uma vez só, por mais que o chat pergunte", async () => {
    const { repository, spies } = repositoryWith({ STRUCTURE: "1", OFFICIAL: "7" })
    const first = await resolveAnalysisPeriod(repository, scope, members, null, closure)
    const again = await resolveAnalysisPeriod(repository, scope, [...members].reverse(), null, closure)
    expect(first).toEqual({ period: "2026-09", requested: false, note: null })
    expect(again).toEqual(first)
    expect(spies.loadPeriodCoverage).toHaveBeenCalledTimes(1)
  })

  it("fechamento novo (versão OFFICIAL sobe) relê a cobertura", async () => {
    const { repository, spies, state } = repositoryWith({ STRUCTURE: "1", OFFICIAL: "7" })
    await resolveAnalysisPeriod(repository, scope, members, null, closure)
    state.versions = { STRUCTURE: "1", OFFICIAL: "8" }
    await resolveAnalysisPeriod(repository, scope, members, null, closure)
    expect(spies.loadPeriodCoverage).toHaveBeenCalledTimes(2)
  })

  it("escrita pendente na transação: calcula sem guardar", async () => {
    const { repository, spies } = repositoryWith({ STRUCTURE: "1", OFFICIAL: "uncommitted:9" })
    await resolveAnalysisPeriod(repository, scope, members, null, closure)
    await resolveAnalysisPeriod(repository, scope, members, null, closure)
    expect(spies.loadPeriodCoverage).toHaveBeenCalledTimes(2)
  })

  it("cobertura por indicador: mesma decisão e uma leitura por conjunto de pedido", async () => {
    const { repository, spies } = repositoryWith({ STRUCTURE: "1", OFFICIAL: "7" })
    const start = { period: "2026-09", requested: false, note: null }
    const chosen = await periodCoveredFor(repository, scope, members, ["TMA"], start)
    expect(chosen.period).toBe("2026-08")
    expect(chosen.note).toContain("só 0 de 4 pessoas")
    expect(await periodCoveredFor(repository, scope, members, ["TMA"], start)).toEqual(chosen)
    expect(spies.loadIndicatorPerformance).toHaveBeenCalledTimes(1)
    // Outro pedido (outro indicador) é outra chave.
    await periodCoveredFor(repository, scope, members, ["FCR"], start)
    expect(spies.loadIndicatorPerformance).toHaveBeenCalledTimes(2)
  })
})
