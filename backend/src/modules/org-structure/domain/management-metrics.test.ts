import { describe, expect, it } from "vitest"
import { computeManagementMetrics, isUnconfirmedStatus, MINIMUM_SENSITIVE_AGGREGATE_POPULATION, type ManagementMetricsInput, type StructureMemberRow } from "./management-metrics.js"

/**
 * Estrutura de teste da Supervisora Vanessa (30 operadores diretos) e do Gerente Roberto
 * (4 Coordenadores → 20 Supervisores → 487 Operadores, com um operador reportando DIRETO a um
 * Coordenador — nível pulado). Nenhum número vem de cargo presumido: tudo sai das relações reais.
 */
const FRESH = { state: "FRESH" as const, lastSuccessLocalDate: "2026-09-17" }
const STALE = { state: "STALE" as const, lastSuccessLocalDate: "2026-09-10" }
const TODAY = "2026-09-17"

function member(id: string, role: string, reportsToId: string, status: StructureMemberRow["status"] = "EM_PRODUCAO", confirmed = status !== "EM_PRODUCAO"): StructureMemberRow {
  return { id, role, reportsToId, status, confirmed }
}

function vanessaTeam(): StructureMemberRow[] {
  const statuses: Array<StructureMemberRow["status"]> = ["FERIAS", "FERIAS", "INSS", "MATERNIDADE"]
  return Array.from({ length: 30 }, (_, index) => member(`op-${index + 1}`, "OPERATOR", "vanessa", statuses[index] ?? "EM_PRODUCAO"))
}

function robertoStructure(): StructureMemberRow[] {
  const rows: StructureMemberRow[] = []
  let operator = 0
  for (let c = 1; c <= 4; c += 1) {
    rows.push(member(`coord-${c}`, "COORDINATOR", "roberto"))
    for (let s = 1; s <= 5; s += 1) {
      const supervisor = `sup-${c}-${s}`
      rows.push(member(supervisor, "SUPERVISOR", `coord-${c}`))
      // 6 supervisores com 25 e 14 com 24 → 486; +1 operador direto do Coordenador 1 = 487.
      const size = c === 1 || (c === 2 && s === 1) ? 25 : 24
      for (let o = 1; o <= size; o += 1) rows.push(member(`op-${(operator += 1)}`, "OPERATOR", supervisor))
    }
  }
  rows.push(member("op-skip", "OPERATOR", "coord-1"))
  return rows
}

function input(partial: Partial<ManagementMetricsInput> & Pick<ManagementMetricsInput, "root" | "members">): ManagementMetricsInput {
  return { statusFreshness: FRESH, today: TODAY, groupBenchmark: null, ...partial }
}

describe("Métricas gerenciais — span, abrangência, camadas", () => {
  it("SPAN DE CONTROLE = subordinados diretos (reports_to_id), qualquer cargo; abrangência = operadores em qualquer profundidade", () => {
    const vanessa = computeManagementMetrics(input({ root: { id: "vanessa", role: "SUPERVISOR" }, members: vanessaTeam() }))
    expect(vanessa.directSpan).toBe(30)
    expect(vanessa.operatorReach).toBe(30)
    expect(vanessa.structuralPopulation).toBe(30)
    expect(vanessa.roleCounts).toEqual([{ role: "OPERATOR", count: 30 }])
    expect(vanessa.layerMetrics).toEqual([])

    const roberto = computeManagementMetrics(input({ root: { id: "roberto", role: "MANAGER" }, members: robertoStructure() }))
    expect(roberto.directSpan).toBe(4)
    expect(roberto.operatorReach).toBe(487)
    expect(roberto.structuralPopulation).toBe(4 + 20 + 487)
    expect(roberto.roleCounts).toEqual([
      { role: "COORDINATOR", count: 4 },
      { role: "SUPERVISOR", count: 20 },
      { role: "OPERATOR", count: 487 },
    ])
  })

  it("férias, INSS, maternidade e paternidade NÃO alteram o span (30 vinculados, 26 em produção → span 30)", () => {
    const members = vanessaTeam()
    members[4] = member("op-5", "OPERATOR", "vanessa", "PATERNIDADE")
    const metrics = computeManagementMetrics(input({ root: { id: "vanessa", role: "SUPERVISOR" }, members }))
    expect(metrics.directSpan).toBe(30)
    expect(metrics.statusDistribution.find((share) => share.bucket === "EM_PRODUCAO")?.count).toBe(25)
    for (const bucket of ["FERIAS", "INSS", "MATERNIDADE", "PATERNIDADE"]) expect(metrics.statusDistribution.find((share) => share.bucket === bucket)?.count).toBeGreaterThan(0)
  })

  it("nível pulado: um operador que reporta DIRETO ao Coordenador conta no span do Coordenador e vira um par real (COORDINATOR → OPERATOR)", () => {
    const coordinator = computeManagementMetrics(input({ root: { id: "coord-1", role: "COORDINATOR" }, members: robertoStructure().filter((row) => row.id.startsWith("sup-1-") || row.reportsToId?.startsWith("sup-1-") || row.id === "op-skip") }))
    expect(coordinator.directSpan).toBe(6)
    expect(coordinator.roleCounts).toEqual([
      { role: "SUPERVISOR", count: 5 },
      { role: "OPERATOR", count: 5 * 25 + 1 },
    ])
    const roberto = computeManagementMetrics(input({ root: { id: "roberto", role: "MANAGER" }, members: robertoStructure() }))
    expect(roberto.layerMetrics).toEqual([
      { managerRole: "COORDINATOR", reportRole: "SUPERVISOR", managers: 4, reports: 20, average: 5 },
      { managerRole: "COORDINATOR", reportRole: "OPERATOR", managers: 4, reports: 1, average: 0.3 },
      { managerRole: "SUPERVISOR", reportRole: "OPERATOR", managers: 20, reports: 486, average: 24.3 },
    ])
  })

  it("médias por camada a partir das relações reais: 20 supervisões / 4 coordenações = 5,0; operadores / supervisão com 1 casa decimal; o próprio líder nunca é 'gestor' de uma camada", () => {
    const coordinator = computeManagementMetrics(input({ root: { id: "coord-2", role: "COORDINATOR" }, members: robertoStructure().filter((row) => row.id.startsWith("sup-2-") || row.reportsToId?.startsWith("sup-2-")) }))
    expect(coordinator.directSpan).toBe(5)
    expect(coordinator.operatorReach).toBe(25 + 24 * 4)
    expect(coordinator.layerMetrics).toEqual([{ managerRole: "SUPERVISOR", reportRole: "OPERATOR", managers: 5, reports: 121, average: 24.2 }])
  })
})

describe("Métricas gerenciais — situação atual, denominador e buckets", () => {
  it("quantidade + porcentagem com denominador ÚNICO (população estrutural) e 1 casa decimal; buckets explicam o total", () => {
    const metrics = computeManagementMetrics(input({ root: { id: "vanessa", role: "SUPERVISOR" }, members: vanessaTeam() }))
    expect(metrics.statusDistribution).toEqual([
      { bucket: "EM_PRODUCAO", count: 26, percent: 86.7 },
      { bucket: "FERIAS", count: 2, percent: 6.7 },
      { bucket: "INSS", count: 1, percent: 3.3 },
      { bucket: "MATERNIDADE", count: 1, percent: 3.3 },
      { bucket: "PATERNIDADE", count: 0, percent: 0 },
    ])
    expect(metrics.statusDistribution.reduce((sum, share) => sum + share.count, 0)).toBe(metrics.structuralPopulation)
    expect(metrics.privacy).toEqual({ sensitiveBreakdownSuppressed: false, minimumPopulation: MINIMUM_SENSITIVE_AGGREGATE_POPULATION })
    expect(metrics.confidence).toEqual({ statusFreshness: "FRESH", unconfirmed: 0 })
  })

  it("situações fora das cinco (transferido, piloto, código desconhecido) somam em OUTRAS — ninguém some do total", () => {
    const members = [...vanessaTeam(), member("t-1", "OPERATOR", "vanessa", "TRANSFERIDO"), member("p-1", "OPERATOR", "vanessa", "PILOTO"), member("x-1", "OPERATOR", "vanessa", null, false)]
    const metrics = computeManagementMetrics(input({ root: { id: "vanessa", role: "SUPERVISOR" }, members }))
    expect(metrics.structuralPopulation).toBe(33)
    expect(metrics.statusDistribution.find((share) => share.bucket === "OTHER")).toEqual({ bucket: "OTHER", count: 3, percent: 9.1 })
    expect(metrics.statusDistribution.reduce((sum, share) => sum + share.count, 0)).toBe(33)
  })

  it("fonte de situação ATRASADA: status presumido (sem período cobrindo hoje) vira NÃO CONFIRMADO — nunca 'Em produção'; situação sustentada por período continua valendo", () => {
    const metrics = computeManagementMetrics(input({ root: { id: "vanessa", role: "SUPERVISOR" }, members: vanessaTeam(), statusFreshness: STALE }))
    expect(metrics.statusDistribution.find((share) => share.bucket === "EM_PRODUCAO")).toEqual({ bucket: "EM_PRODUCAO", count: 0, percent: 0 })
    expect(metrics.statusDistribution.find((share) => share.bucket === "UNCONFIRMED")).toEqual({ bucket: "UNCONFIRMED", count: 26, percent: 86.7 })
    expect(metrics.statusDistribution.find((share) => share.bucket === "FERIAS")?.count).toBe(2)
    expect(metrics.confidence).toEqual({ statusFreshness: "STALE", unconfirmed: 26 })
    // Em produção CONFIRMADO por período (retorno informado pela fonte) não é degradado.
    const confirmed = computeManagementMetrics(input({ root: { id: "v", role: "SUPERVISOR" }, members: [member("a", "OPERATOR", "v", "EM_PRODUCAO", true)], statusFreshness: STALE }))
    expect(confirmed.statusDistribution.find((share) => share.bucket === "EM_PRODUCAO")?.count).toBe(1)
    expect(confirmed.confidence.unconfirmed).toBe(0)
  })

  it("regra de 'não confirmado' = a mesma de statusConfidence da elegibilidade: STALE ∧ presumido ∧ data posterior à última carga; FRESH/UNKNOWN nunca degradam", () => {
    const presumed = { confirmed: false }
    expect(isUnconfirmedStatus(presumed, STALE, TODAY)).toBe(true)
    expect(isUnconfirmedStatus(presumed, { state: "STALE", lastSuccessLocalDate: TODAY }, TODAY)).toBe(false)
    expect(isUnconfirmedStatus(presumed, { state: "STALE", lastSuccessLocalDate: null }, TODAY)).toBe(true)
    expect(isUnconfirmedStatus(presumed, FRESH, TODAY)).toBe(false)
    expect(isUnconfirmedStatus(presumed, { state: "UNKNOWN", lastSuccessLocalDate: null }, TODAY)).toBe(false)
    expect(isUnconfirmedStatus({ confirmed: true }, STALE, TODAY)).toBe(false)
  })

  it("população vazia: nada explode — percentuais 0, buckets nomeados presentes", () => {
    const metrics = computeManagementMetrics(input({ root: { id: "x", role: "SUPERVISOR" }, members: [] }))
    expect(metrics.structuralPopulation).toBe(0)
    expect(metrics.statusDistribution.map((share) => share.percent)).toEqual([0, 0, 0])
    expect(metrics.privacy.sensitiveBreakdownSuppressed).toBe(true)
  })
})

describe("Métricas gerenciais — privacidade dos agregados e referência do Grupo", () => {
  it(`estrutura com menos de ${MINIMUM_SENSITIVE_AGGREGATE_POPULATION} pessoas: INSS/maternidade/paternidade só somados ("Afastamentos"), nunca um a um; o total continua explicado`, () => {
    const members = [member("a", "OPERATOR", "v"), member("b", "OPERATOR", "v", "MATERNIDADE")]
    const metrics = computeManagementMetrics(input({ root: { id: "v", role: "SUPERVISOR" }, members }))
    expect(metrics.privacy.sensitiveBreakdownSuppressed).toBe(true)
    expect(metrics.statusDistribution.map((share) => share.bucket)).toEqual(["EM_PRODUCAO", "FERIAS", "SENSITIVE_LEAVE"])
    expect(metrics.statusDistribution.find((share) => share.bucket === "SENSITIVE_LEAVE")).toEqual({ bucket: "SENSITIVE_LEAVE", count: 1, percent: 50 })
    expect(JSON.stringify(metrics.statusDistribution)).not.toContain("MATERNIDADE")
    expect(metrics.statusDistribution.reduce((sum, share) => sum + share.count, 0)).toBe(2)
    // No limiar (5) o detalhamento volta.
    const five = computeManagementMetrics(input({ root: { id: "v", role: "SUPERVISOR" }, members: [...members, member("c", "OPERATOR", "v"), member("d", "OPERATOR", "v"), member("e", "OPERATOR", "v")] }))
    expect(five.privacy.sensitiveBreakdownSuppressed).toBe(false)
    expect(five.statusDistribution.find((share) => share.bucket === "MATERNIDADE")?.count).toBe(1)
  })

  it("referência do Grupo é passada adiante como veio (mesmo cargo + mesmo Grupo é responsabilidade do carregador); sem Grupo → null", () => {
    const benchmark = { groupId: "g1", groupName: "Atendimento B2B", peerRole: "SUPERVISOR", peerCount: 18, averageDirectSpan: 25.4 }
    expect(computeManagementMetrics(input({ root: { id: "v", role: "SUPERVISOR" }, members: vanessaTeam(), groupBenchmark: benchmark })).groupBenchmark).toEqual(benchmark)
    expect(computeManagementMetrics(input({ root: { id: "v", role: "SUPERVISOR" }, members: vanessaTeam() })).groupBenchmark).toBeNull()
  })
})
