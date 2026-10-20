import { describe, expect, it } from "vitest"
import type { PendingActionsSummary } from "../../pending-actions/domain/view-models.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { indicatorRow, InMemoryAnalyticsRepository, prvRow } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import type { QueryTableCard } from "../domain/view-models.js"
import type { InteractionStatRow } from "./indicator-diagnosis.js"
import { executeLeadershipTool, type LeadershipToolDependencies } from "./leadership-toolset.js"
import { loadSelfChatContext } from "./self-context.js"
import type { Database } from "../../../infrastructure/database/pool.js"

const NO_PENDING: PendingActionsSummary = { pending: [], history: [], pendingCount: 0 }

/** PRV de agosto: Sara (1) concentra o Q4 (4 de 5); julho todos Q2. */
function orgWithPrv() {
  const org = leadershipOrg()
  const prv: Record<number, number[]> = { 1: [80, 82, 84, 86, 115], 2: [101, 102, 103, 104, 95], 3: [110, 111, 112, 113, 114], 4: [70, 70, 70, 70, 70] }
  for (const [index, values] of Object.entries(prv)) {
    operatorsOf(Number(index)).forEach((id, position) => {
      const value = values[position]!
      org.prvRows!.push(prvRow(id, "2026-08", value, value >= 110 ? "Q1" : value >= 100 ? "Q2" : value >= 90 ? "Q3" : "Q4"))
      org.prvRows!.push(prvRow(id, "2026-07", 100, "Q2"))
    })
  }
  return org
}

async function depsFor(personId: string, role: "SUPERVISOR" | "COORDINATOR" | "MANAGER", org = orgWithPrv(), extra: Partial<LeadershipToolDependencies> = {}): Promise<LeadershipToolDependencies> {
  const repository = new InMemoryAnalyticsRepository(org)
  return { repository, scope: await loadViewerScope(repository, leaderUser(personId, role)), closure: CLOSURE, loadPendingActions: async () => NO_PENDING, ...extra }
}
const run = async (deps: LeadershipToolDependencies, name: string, args: Record<string, unknown>) => (await executeLeadershipTool(deps, name, args)).card as QueryTableCard
const cells = (card: QueryTableCard, label: string) => card.rows.map((row) => row.cells[card.columns.find((column) => column.label === label)!.key])

describe("consulta v3 — PRV, quartis, consolidado e várias competências", () => {
  it("piores de PRV: pessoas pelo resultado geral, do menor ao maior; 'pior quartil geral' = Q4 de PRV", async () => {
    const deps = await depsFor(L.gabriel, "MANAGER")
    const worst = await run(deps, "leadership_indicator_query", { indicadores: ["PRV"], agrupar_por: "PESSOA", limite: 3 })
    expect(cells(worst, "Atingimento")).toEqual(["80%", "82%", "84%"])
    const q4 = await run(deps, "leadership_indicator_query", { indicadores: ["quartil geral"], agrupar_por: "PESSOA", quartis: ["Q4"] })
    expect(q4.totalRows).toBe(4)
  })

  it("quartis por supervisor: distribuição Q1–Q4 e dispersão, mais Q4 primeiro (sem indicador = PRV)", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_query", { visao: "QUARTIS", agrupar_por: "SUPERVISOR" })
    expect(card.title).toContain("PRV")
    expect(cells(card, "Supervisor")[0]).toBe("Sara Silva")
    expect(cells(card, "Q4")[0]).toBe("4 (80%)")
    expect(cells(card, "Desvio padrão")[0]).toMatch(/p\.p\./)
  })

  it("consolidado por Grupo/unidade: quem tem algum indicador fora, atingimento geral, PRV médio e Q4 de PRV", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_query", { visao: "CONSOLIDADO", agrupar_por: "SUPERVISOR" })
    const sara = card.rows.find((row) => row.cells.group === "Sara Silva")!
    expect(sara.cells).toMatchObject({ people: "5", belowAny: "4 (80%)", prvQ4: "4 (80%)" })
  })

  it("recorrência: supervisores acima da estrutura em mais meses vêm primeiro; pessoas por meses fora", async () => {
    const deps = await depsFor(L.gabriel, "MANAGER")
    const groups = await run(deps, "leadership_indicator_query", { indicadores: ["TMA"], agrupar_por: "SUPERVISOR", ultimas_competencias: 2, competencia: "2026-08", periodos_como: "RECORRENCIA" })
    expect(cells(groups, "Supervisor")[0]).toBe("Sara Silva")
    expect(cells(groups, "Meses acima da estrutura")[0]).toBe("1")
    const people = await run(deps, "leadership_indicator_query", { indicadores: ["TMA"], agrupar_por: "PESSOA", ultimas_competencias: 2, competencia: "2026-08", periodos_como: "RECORRENCIA", limite: 2 })
    expect(cells(people, "Meses fora")).toEqual(["1", "1"])
  })

  it("mês a mês: uma coluna por competência", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_query", { indicadores: ["TMA"], agrupar_por: "SUPERVISOR", ultimas_competencias: 2, competencia: "2026-08", periodos_como: "POR_MES" })
    expect(card.columns.map((column) => column.label)).toEqual(["Supervisor", "% fora jul/26", "% fora ago/26"])
  })
})

describe("força de trabalho — quantos, %, quem; afastamento sensível protegido", () => {
  const statuses = new Map<string, string | null>([[operatorsOf(1)[0]!, "FERIAS"], [operatorsOf(1)[1]!, "INSS"], [operatorsOf(3)[0]!, "MATERNIDADE"]])
  const loadStatuses = async (ids: string[]) => new Map(ids.map((id) => [id, statuses.get(id) ?? null]))

  it("por supervisor: quantidade e % por situação; um afastamento sensível isolado fica só no total (o tipo apontaria a pessoa — AI-04)", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER", orgWithPrv(), { loadStatuses }), "leadership_workforce", { agrupar_por: "SUPERVISOR" })
    const sara = card.rows.find((row) => row.cells.group === "Sara Silva")!
    expect(sara.cells).toMatchObject({ total: "5", EM_PRODUCAO: "3 (60%)", FERIAS: "1 (20%)", AFASTAMENTO: "1 (20%)" })
    expect(sara.cells.INSS ?? "0").toBe("0")
  })

  it("lista nominal nunca expõe o motivo de afastamento sensível", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER", orgWithPrv(), { loadStatuses }), "leadership_workforce", { situacoes: ["FERIAS", "AFASTAMENTO"], listar_pessoas: true })
    expect(cells(card, "Situação").sort()).toEqual(["Afastamento (motivo protegido)", "Afastamento (motivo protegido)", "Férias"])
  })

  it("recorte com menos de 5 pessoas: afastamentos só somados", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER", orgWithPrv(), { loadStatuses }), "leadership_workforce", { estrutura: "Sônia", agrupar_por: "ESTRUTURA" })
    expect(card.columns.map((column) => column.label)).toContain("Afastamentos (total)")
    // Sônia tem 5 operadores e UMA licença-maternidade: com a lista nominal da mesma ferramenta, o tipo apontaria a pessoa — fica
    // só no total (regra `sensitiveBreakdownAllowed`, testada na função pura das métricas gerenciais).
    expect(card.rows[0]!.cells.AFASTAMENTO).toBe("1 (20%)")
    expect(card.rows[0]!.cells.MATERNIDADE ?? "0").toBe("0")
  })
})

describe("diagnóstico do indicador — piores × melhores nas interações", () => {
  // Piores em TMA (Sara 4 + Saulo 1) gastam mais em "Fatura › Contestação"; melhores, menos.
  const worst = [...operatorsOf(1).slice(0, 4), operatorsOf(2)[4]!]
  const interactions: InteractionStatRow[] = [
    ...worst.map((personId) => ({ personId, reason: "Fatura", subReason: "Contestação", calls: 4, seconds: 4 * 600 })),
    ...worst.map((personId) => ({ personId, reason: "Suporte", subReason: "Sem sinal", calls: 2, seconds: 2 * 300 })),
    ...operatorsOf(3).map((personId) => ({ personId, reason: "Fatura", subReason: "Contestação", calls: 2, seconds: 2 * 300 })),
    ...operatorsOf(3).map((personId) => ({ personId, reason: "Suporte", subReason: "Sem sinal", calls: 4, seconds: 4 * 300 })),
  ]

  it("indicador de tempo: o motivo que mais pesa na diferença de duração vem primeiro, com os grupos e onde estão os piores", async () => {
    const deps = await depsFor(L.gabriel, "MANAGER", orgWithPrv(), { loadInteractionStats: async (ids) => interactions.filter((row) => ids.includes(row.personId)), loadHireDates: async () => new Map() })
    const card = await run(deps, "leadership_indicator_diagnosis", { indicador: "TMA" })
    expect(card.rows[0]!.cells).toMatchObject({ reason: "Fatura", subReason: "Contestação", worstCalls: "20", worstShare: "66,7%", worstDuration: "600 s", bestDuration: "300 s" })
    expect(card.rows[0]!.cells.impact).toBe("+200 s")
    expect(card.highlights.join(" ")).toContain("5 pessoas fora da referência × 10 dentro da referência")
    expect(card.highlights.join(" ")).toContain("Carla Coordenadora 5")
  })

  it("nível motivo agrega os submotivos", async () => {
    const deps = await depsFor(L.gabriel, "MANAGER", orgWithPrv(), { loadInteractionStats: async (ids) => interactions.filter((row) => ids.includes(row.personId)), loadHireDates: async () => new Map() })
    const card = await run(deps, "leadership_indicator_diagnosis", { indicador: "TMA", nivel: "MOTIVO" })
    expect(card.columns.map((column) => column.label)).not.toContain("Submotivo")
  })
})

describe("meus resultados (operador) — sempre a própria pessoa", () => {
  it("PRV e indicadores da pessoa da sessão; nenhum parâmetro alcança outra pessoa", async () => {
    const org = orgWithPrv()
    const repository = new InMemoryAnalyticsRepository(org)
    const me = operatorsOf(1)[0]!
    const fakeDb = { query: async () => ({ rows: [{ timezone: "America/Sao_Paulo" }], rowCount: 1 }) } as unknown as Database
    const context = await loadSelfChatContext(fakeDb, { ...leaderUser(me, "OPERATOR") }, { repository, now: CLOSURE.now })
    const result = await context!.toolset.execute("my_results", { competencia: "2026-08", estrutura: "Sara Silva" })
    const card = result.card as QueryTableCard
    expect(card.structure.subject).toEqual({ kind: "EMPLOYEE", employeeId: me })
    expect(card.rows.map((row) => row.cells.indicator)).toEqual(["PRV (resultado geral)", "Tempo Médio de Atendimento"])
    expect(card.rows[1]!.cells).toMatchObject({ achievement: "70%", situation: "fora da meta" })
  })

  it("indicador com dado do mês só: evolução de várias competências por pessoa", async () => {
    const org = orgWithPrv()
    org.indicatorRows!.push(indicatorRow({ personId: operatorsOf(1)[0]!, indicatorCode: "TMA", referencePeriod: "2026-06", value: 300, targetValue: 300, achievementPercent: 100 }))
    const repository = new InMemoryAnalyticsRepository(org)
    const fakeDb = { query: async () => ({ rows: [{ timezone: "America/Sao_Paulo" }], rowCount: 1 }) } as unknown as Database
    const context = await loadSelfChatContext(fakeDb, leaderUser(operatorsOf(1)[0]!, "OPERATOR"), { repository, now: CLOSURE.now })
    const card = (await context!.toolset.execute("my_results", { indicadores: ["TMA"], competencia: "2026-08", ultimas_competencias: 3 })).card as QueryTableCard
    expect(card.columns.map((column) => column.label)).toEqual(["Indicador", "jun/26", "jul/26", "ago/26", "Média", "Meses fora"])
    expect(card.rows[0]!.cells.monthsBelow).toBe("1")
  })
})

describe("consulta v3 — normalização do pedido", () => {
  it("'consolidado' só do PRV vira a visão do próprio PRV (ranking por atingimento, não a tabela de indicadores fora)", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_query", { indicadores: ["PRV"], visao: "CONSOLIDADO", agrupar_por: "PESSOA", ordenar_por: "ATINGIMENTO", ordem: "ASC", limite: 2 })
    expect(card.title).toContain("PRV")
    expect(cells(card, "Atingimento")).toEqual(["80%", "82%"])
  })
})

describe("consulta v3 — o que a estrutura não tem", () => {
  it("nível pedido inexistente abaixo (Coordenador numa gerência só com supervisores): mostra as unidades abaixo e avisa", async () => {
    const card = await run(await depsFor(L.helena, "MANAGER"), "leadership_indicator_query", { indicadores: ["TMA"], agrupar_por: "COORDINATOR" })
    expect(cells(card, "Supervisor")).toEqual(["Hugo Reis"])
    expect(card.limitations.join(" ")).toContain("Não há Coordenador abaixo desta estrutura; mostro as unidades logo abaixo (Supervisor)")
  })

  it("indicador pedido com pouca gente na estrutura: diz a cobertura e quais indicadores têm dado aqui", async () => {
    const card = await run(await depsFor(L.gabriel, "MANAGER"), "leadership_indicator_query", { indicadores: ["FCR"], agrupar_por: "PESSOA" })
    expect(card.limitations).toContain("First Call Resolution tem dado para só 1 de 16 pessoas desta estrutura em Agosto 2026.")
    expect(card.limitations).toContain("Indicadores com dado para a maioria desta estrutura em Agosto 2026: Tempo Médio de Atendimento.")
  })
})

describe("meus resultados — período em curso sem medição", () => {
  it("devolve o último fechamento oficial, dizendo que o mês em curso ainda não tem medição", async () => {
    const repository = new InMemoryAnalyticsRepository(orgWithPrv())
    const fakeDb = { query: async () => ({ rows: [{ timezone: "America/Sao_Paulo" }], rowCount: 1 }) } as unknown as Database
    const context = await loadSelfChatContext(fakeDb, leaderUser(operatorsOf(1)[0]!, "OPERATOR"), { repository, now: CLOSURE.now })
    const card = (await context!.toolset.execute("my_results", { fonte: "OPERACIONAL", janela: "MES_CORRENTE" })).card as QueryTableCard
    expect(card.source).toBe("OFFICIAL")
    expect(card.limitations[0]).toBe("Ainda não há medição diária sua no período em curso; abaixo, o último fechamento oficial.")
    expect(card.rows.map((row) => row.cells.indicator)).toContain("Tempo Médio de Atendimento")
  })
})
