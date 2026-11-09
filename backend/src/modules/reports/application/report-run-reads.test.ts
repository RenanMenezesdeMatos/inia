import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createPostgresAccessRepository, loadAccessContexts } from "../../access/infrastructure/postgres-access-repository.js"
import { ReportRunReads } from "./report-run-reads.js"

const ORG = "00000000-0000-4000-8000-00000000abc1"
const person = (id: string, role: string, reportsToId: string | null, teamId: string | null) => ({ id, name: id, role, reportsToId, teamId, teamName: teamId, subteamId: null, subteamName: null, avatarUrl: null, jobTitle: null, operationalCapitalCode: null, active: true })
const PEOPLE = [person("p-sup", "SUPERVISOR", null, "g1"), person("p-op1", "OPERATOR", "p-sup", "g1"), person("p-op2", "OPERATOR", "p-sup", "g1"), person("p-op3", "OPERATOR", null, "g2"), person("p-adm", "ADMIN", null, null)]
const ACCOUNTS = [{ id: "acc-sup", person_id: "p-sup", active: true }, { id: "acc-adm", person_id: "p-adm", active: true }, { id: "acc-off", person_id: "p-op3", active: false }]
const ASSIGNMENTS = [{ id: "as1", user_account_id: "acc-adm", role_code: "ADMINISTRADOR", scope_type: "GROUP", team_id: "g1", subteam_id: null, subteam_team_id: null, team_name: "G1", subteam_name: null, source: "MANUAL", granted_at: new Date("2026-01-01"), granted_by_name: null, revoked_at: null }]
const PERFORMANCE = ["2026-07", "2026-08", "2026-09"].flatMap((period) => ["p-op1", "p-op2", "p-op3"].map((personId) => ({ personId, indicatorCode: "TMA", referencePeriod: period, value: 400, targetValue: 420, achievementPercent: 105, weightPercent: null, quartile: "Q1", numerator: null, denominator: null, source: "TEST" })))
const PRV = PERFORMANCE.map((row) => ({ personId: row.personId, referencePeriod: row.referencePeriod, achievementPercent: 98, quartile: "Q2", source: "TEST" }))

/** Banco falso: responde às consultas que o leitor faz e registra cada uma (uma ida ao banco = uma entrada). */
function fakeDatabase(options: { failPerformance?: boolean } = {}) {
  const log: string[] = []
  const query = async (text: string, params: unknown[] = []) => {
    const sql = text.replace(/\s+/g, " ")
    const ids = (index: number) => (Array.isArray(params[index]) ? (params[index] as string[]) : [params[index] as string])
    if (sql.includes("from analytics_versions where organization_id = $1 union all")) return log.push("versions"), { rows: [{ domain: "STRUCTURE", version: "1" }, { domain: "OFFICIAL", version: "1" }] }
    if (sql.includes("from people p left join teams t")) return log.push("people"), { rows: PEOPLE }
    if (sql.includes("from user_accounts ua join people p on p.id = ua.person_id")) return log.push("accounts"), { rows: ACCOUNTS.filter((account) => account.active && ids(1).includes(account.id)) }
    if (sql.includes("from access_role_assignments a")) return log.push("assignments"), { rows: ASSIGNMENTS.filter((row) => ids(1).includes(row.user_account_id)) }
    if (sql.includes("from indicator_definitions where organization_id = $1 and active")) return log.push("definitions"), { rows: [{ id: "d1", code: "TMA", name: "TMA", unit: "SECONDS", direction: "LOWER", capabilities: {} }] }
    if (sql.includes("from employee_indicator_performance eip")) {
      log.push("performance")
      if (options.failPerformance) throw new Error("banco indisponível")
      return { rows: PERFORMANCE.filter((row) => ids(1).includes(row.personId) && ids(2).includes(row.referencePeriod)) }
    }
    if (sql.includes("from employee_prv_performance")) return log.push("prv"), { rows: PRV.filter((row) => ids(1).includes(row.personId) && ids(2).includes(row.referencePeriod)) }
    throw new Error(`consulta inesperada no teste: ${sql.slice(0, 80)}`)
  }
  return { db: { query, connect: async () => { throw new Error("sem conexão dedicada no teste") } } as unknown as Database, log }
}

describe("leituras de uma execução de report", () => {
  it("a cobertura lê o que a ferramenta acabou de ler quando cobre o pedido — as mesmas linhas da consulta — e consulta quando não cobre", async () => {
    const { db, log } = fakeDatabase()
    const reads = await ReportRunReads.forAccounts(db, ORG, [])
    const coverage = reads.coverageReads()
    // A ferramenta lê três pessoas × duas competências; a cobertura pede duas pessoas × uma competência.
    await reads.loadIndicatorPerformance(ORG, ["p-op1", "p-op2", "p-op3"], ["2026-08", "2026-09"])
    await reads.loadPrvPerformance(ORG, ["p-op1", "p-op2", "p-op3"], ["2026-08", "2026-09"])
    await reads.loadIndicatorDefinitions(ORG)
    log.length = 0
    const rows = await coverage.loadIndicatorPerformance(ORG, ["p-op1", "p-op2"], ["2026-09"])
    const prv = await coverage.loadPrvPerformance(ORG, ["p-op1", "p-op2"], ["2026-09"])
    const definitions = await coverage.loadIndicatorDefinitions(ORG)
    expect(log).toEqual([])
    const fresh = fakeDatabase()
    const direct = await ReportRunReads.forAccounts(fresh.db, ORG, [])
    expect(rows).toEqual(await direct.loadIndicatorPerformance(ORG, ["p-op1", "p-op2"], ["2026-09"]))
    expect(prv).toEqual(await direct.loadPrvPerformance(ORG, ["p-op1", "p-op2"], ["2026-09"]))
    expect(definitions).toEqual(await direct.loadIndicatorDefinitions(ORG))
    // Pessoa, competência ou organização fora do que a ferramenta leu: vai ao banco.
    await coverage.loadIndicatorPerformance(ORG, ["p-op1", "p-sup"], ["2026-09"])
    await coverage.loadIndicatorPerformance(ORG, ["p-op1"], ["2026-07"])
    await coverage.loadPrvPerformance("00000000-0000-4000-8000-00000000abc2", ["p-op1"], ["2026-09"])
    await coverage.loadIndicatorDefinitions("00000000-0000-4000-8000-00000000abc2")
    expect(log).toEqual(["performance", "performance", "prv", "definitions"])
  })

  it("a leitura da cobertura não muda o que fica guardado: a próxima leitura da ferramenta substitui a anterior", async () => {
    const { db, log } = fakeDatabase()
    const reads = await ReportRunReads.forAccounts(db, ORG, [])
    await reads.loadIndicatorPerformance(ORG, ["p-op1"], ["2026-09"])
    await reads.loadIndicatorPerformance(ORG, ["p-op2"], ["2026-08"])
    log.length = 0
    await reads.coverageReads().loadIndicatorPerformance(ORG, ["p-op1"], ["2026-09"])
    await reads.coverageReads().loadIndicatorPerformance(ORG, ["p-op2"], ["2026-08"])
    expect(log).toEqual(["performance"])
  })

  it("leitura da ferramenta que falhou nunca é reaproveitada", async () => {
    const { db, log } = fakeDatabase({ failPerformance: true })
    const reads = await ReportRunReads.forAccounts(db, ORG, [])
    await expect(reads.loadIndicatorPerformance(ORG, ["p-op1"], ["2026-09"])).rejects.toThrow("banco indisponível")
    log.length = 0
    await expect(reads.coverageReads().loadIndicatorPerformance(ORG, ["p-op1"], ["2026-09"])).rejects.toThrow("banco indisponível")
    expect(log).toEqual(["performance"])
  })

  it("acesso das contas do lote em duas consultas, com o mesmo resultado da leitura conta a conta; grafo conferido uma vez", async () => {
    const { db, log } = fakeDatabase()
    const accountIds = ["acc-sup", "acc-adm", "acc-off"]
    const batch = await loadAccessContexts(db, ORG, accountIds)
    expect(log).toEqual(["accounts", "assignments"])
    const single = createPostgresAccessRepository(db)
    for (const accountId of accountIds) expect(batch.get(accountId)).toEqual(await single.loadContext(ORG, accountId))

    log.length = 0
    const reads = await ReportRunReads.forAccounts(db, ORG, accountIds)
    expect(log).toEqual(["accounts", "assignments"])
    log.length = 0
    expect(await reads.loadAccessVisibility(ORG, "acc-adm", "indicators.view")).toEqual({ organizationWide: false, teamIds: ["g1"], subteamIds: [] })
    expect(await reads.loadAccessVisibility(ORG, "acc-sup", "indicators.view")).toEqual({ organizationWide: false, teamIds: [], subteamIds: [] })
    expect(log).toEqual([])
    for (const personId of ["p-sup", "p-adm", "p-op1"]) {
      await reads.loadPerson(ORG, personId)
      await reads.loadDescendants(ORG, personId)
    }
    await reads.loadPeopleInVisibility(ORG, { organizationWide: false, teamIds: ["g1"], subteamIds: [] })
    expect(log.filter((entry) => entry === "versions")).toHaveLength(1)
    // Outra permissão não foi carregada no lote: lê como sempre.
    log.length = 0
    await reads.loadAccessVisibility(ORG, "acc-adm", "calendar.manage")
    expect(log).toEqual(["accounts", "assignments"])
  })
})
