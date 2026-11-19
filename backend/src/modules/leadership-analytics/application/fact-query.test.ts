import { describe, expect, it } from "vitest"
import type { PendingActionsSummary } from "../../pending-actions/domain/view-models.js"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import type { QueryTableCard } from "../domain/view-models.js"
import { narrowByText, type DomainFactsLoader } from "./data-domains.js"
import { describe as describeValues, resolveFactPeriod } from "./fact-query.js"
import { executeLeadershipTool, LEADERSHIP_TOOL_DECLARATIONS, leadershipDeclarationsFor, type LeadershipToolDependencies } from "./leadership-toolset.js"

const NO_PENDING: PendingActionsSummary = { pending: [], history: [], pendingCount: 0 }

/** Supervisora 1: 3 atendimentos do operador 0 (um com rechamada), 1 do operador 1; os outros sem atendimento. */
const loader: DomainFactsLoader = async (domain, personIds) => {
  if (domain !== "INTERACTIONS") return { facts: [], truncated: false }
  const [a, b] = operatorsOf(1)
  const call = (personId: string, reason: string, seconds: number, recall: boolean, day: string) => ({ personId, key: `${personId}-${day}-${seconds}`, dims: { MOTIVO: reason, SUBMOTIVO: null, CANAL: "VOICE", DIA: day, "OCORRENCIA:rechamada": recall ? "sim" : "não" }, measures: { DURACAO: seconds, rechamada: recall ? 1 : 0 } })
  const facts = [call(a!, "Fatura", 300, true, "2026-08-03"), call(a!, "Fatura", 600, false, "2026-08-04"), call(a!, "Cobrança", 120, false, "2026-08-10"), call(b!, "Fatura", 240, false, "2026-08-11")]
  return { facts: facts.filter((fact) => personIds.includes(fact.personId)), truncated: false, flags: [{ name: "rechamada", label: "Rechamada", valueType: "BOOLEAN" }] }
}

async function deps(): Promise<LeadershipToolDependencies> {
  const repository = new InMemoryAnalyticsRepository(leadershipOrg())
  return { repository, scope: await loadViewerScope(repository, leaderUser(L.gabriel, "MANAGER")), closure: CLOSURE, loadPendingActions: async () => NO_PENDING, loadDomainFacts: loader, domainAccess: { INIA_USAGE: ALL, SUPPORT: ALL } }
}
const ALL = { organizationWide: true, teamIds: [], subteamIds: [] }

describe("motor de cálculo sobre registros (FACT_QUERY_V1)", () => {
  it("estatísticas: média, mediana e percentis por interpolação, desvio populacional", () => {
    const stats = describeValues([1, 2, 3, 4])!
    expect(stats).toMatchObject({ TOTAL: 10, MEDIA: 2.5, MEDIANA: 2.5, MINIMO: 1, MAXIMO: 4, P25: 1.75, P75: 3.25 })
    expect(stats.DESVIO_PADRAO).toBeCloseTo(1.118, 3)
    expect(describeValues([])).toBeNull()
  })

  it("período: competência, datas ou a última competência fechada", () => {
    expect(resolveFactPeriod({ competencia: "2026-12" }, "2026-08")).toMatchObject({ from: "2026-12-01", toExclusive: "2027-01-01" })
    expect(resolveFactPeriod({ data_inicio: "2026-08-01", data_fim: "2026-08-15" }, "2026-08")).toMatchObject({ from: "2026-08-01", toExclusive: "2026-08-16" })
    expect(resolveFactPeriod({}, "2026-08")).toMatchObject({ from: "2026-08-01", toExclusive: "2026-09-01" })
    expect(resolveFactPeriod({ data_inicio: "2026-08-01" }, "2026-08")).toHaveProperty("error")
  })

  it("DL-10/DL-06: data ou competência impossível e período acima de 12 meses são recusados com mensagem", () => {
    expect(resolveFactPeriod({ data_inicio: "2026-02-01", data_fim: "2026-02-31" }, "2026-09")).toMatchObject({ error: expect.stringContaining("não existe no calendário") })
    expect(resolveFactPeriod({ competencia: "2026-13" }, "2026-09")).toMatchObject({ error: expect.stringContaining("não existe") })
    expect(resolveFactPeriod({ data_inicio: "2025-01-01", data_fim: "2026-06-30" }, "2026-09")).toMatchObject({ error: expect.stringContaining("12 meses") })
    expect(resolveFactPeriod({ data_inicio: "2025-07-01", data_fim: "2026-06-30" }, "2026-09")).toHaveProperty("from")
  })

  it("DL-05: uso da INIA e Apoio com Anjo sem a permissão da tela de origem não são declarados e são recusados", async () => {
    const without: LeadershipToolDependencies = { ...(await deps()), domainAccess: {} }
    for (const name of ["leadership_inia_usage", "leadership_support"]) {
      const result = await executeLeadershipTool(without, name, { agrupar_por: "PESSOA" })
      expect(result.issue?.kind).toBe("INVALID")
      expect(result.card).toBeNull()
      expect(leadershipDeclarationsFor(undefined).map((declaration) => declaration.name)).not.toContain(name)
      expect(leadershipDeclarationsFor({ INIA_USAGE: ALL, SUPPORT: ALL }).map((declaration) => declaration.name)).toContain(name)
    }
  })

  it("DL-07: homônimos não se somam — a chave da linha é o id da pessoa", async () => {
    const [a, b] = operatorsOf(1)
    const repository = new InMemoryAnalyticsRepository({ ...leadershipOrg(), people: leadershipOrg().people.map((entry) => (entry.id === a || entry.id === b ? { ...entry, name: "Maria Silva" } : entry)) })
    const scope = await loadViewerScope(repository, leaderUser(L.gabriel, "MANAGER"))
    const card = (await executeLeadershipTool({ ...(await deps()), repository, scope }, "leadership_interactions", { estrutura: "Sara", agrupar_por: "PESSOA" })).card as QueryTableCard
    const marias = card.rows.filter((row) => row.cells.group!.startsWith("Maria Silva"))
    expect(marias.map((row) => [row.personId, row.cells.records]).sort()).toEqual([[a, "3"], [b, "1"]].sort())
    expect(new Set(marias.map((row) => row.cells.group)).size).toBe(2)
  })

  it("DL-06: quando o carregamento bate o teto, o resultado avisa que é parcial", async () => {
    const result = await executeLeadershipTool({ ...(await deps()), loadDomainFacts: async (...args) => ({ ...(await loader(...args)), truncated: true }) }, "leadership_interactions", {})
    expect(result.text).toContain("RESULTADO PARCIAL")
  })

  it("mediana de atendimentos por pessoa conta com zero quem não atendeu (sobre a população inteira, não sobre uma lista)", async () => {
    const result = await executeLeadershipTool(await deps(), "leadership_interactions", { estrutura: "Sara", estatisticas: ["MEDIANA", "MAXIMO", "TOTAL"] })
    const card = result.card as QueryTableCard
    const population = Number(card.rows[0]!.cells.people)
    expect(population).toBeGreaterThan(2)
    // 3, 1 e zeros: mediana 0 com 5 pessoas (3,1,0,0,0).
    expect(result.text).toContain("Atendimentos por pessoa — mediana: 0")
    expect(result.text).toContain("Atendimentos por pessoa — máximo: 3")
    expect(result.text).toContain("Atendimentos por pessoa — total: 4")
  })

  it("agrupa por motivo, filtra por ocorrência e calcula a taxa sobre todos os atendimentos", async () => {
    const byReason = (await executeLeadershipTool(await deps(), "leadership_interactions", { agrupar_por: "MOTIVO", medidas: ["rechamada"] })).card as QueryTableCard
    const fatura = byReason.rows.find((row) => row.cells.group === "Fatura")!
    expect(fatura.cells.records).toBe("3")
    expect(fatura.cells.rechamada_TAXA).toBe("33,3%")
    const onlyRecall = await executeLeadershipTool(await deps(), "leadership_interactions", { com_ocorrencia: ["Rechamada"] })
    expect(onlyRecall.text).toContain("1 registros")
    const unknown = await executeLeadershipTool(await deps(), "leadership_interactions", { com_ocorrencia: ["inexistente"] })
    expect(unknown.issue?.kind).toBe("INVALID")
  })

  it("filtro por valor que não existe no período diz quais existem, sem resultado inventado", async () => {
    const result = await executeLeadershipTool(await deps(), "leadership_interactions", { motivo: ["Portabilidade"] })
    expect(result.text).toContain('Motivo "Portabilidade" não aparece nos registros do período')
    expect(result.text).toContain("Cobrança; Fatura")
  })

  it("só pessoas do escopo entram: o carregamento recebe os membros resolvidos no backend", async () => {
    const seen: string[][] = []
    const base = await deps()
    await executeLeadershipTool({ ...base, loadDomainFacts: async (domain, ids, from, to) => (seen.push(ids), loader(domain, ids, from, to)) }, "leadership_feedbacks", {})
    expect(seen[0]!.every((id) => base.scope.nodes.has(id))).toBe(true)
  })

  it("cada ferramenta de domínio pede ao carregamento o SEU domínio", async () => {
    const asked: string[] = []
    const base = await deps()
    const spy: DomainFactsLoader = async (domain, ids, from, to) => (asked.push(domain), loader(domain, ids, from, to))
    for (const name of ["leadership_interactions", "leadership_monitoring", "leadership_feedbacks", "leadership_cases", "leadership_schedule", "leadership_workday", "leadership_communications", "leadership_inia_usage", "leadership_support"]) await executeLeadershipTool({ ...base, loadDomainFacts: spy }, name, {})
    expect(asked).toEqual(["INTERACTIONS", "MONITORING", "FEEDBACKS", "CASES", "SCHEDULE", "WORKDAY", "COMMUNICATIONS", "INIA_USAGE", "SUPPORT"])
  })

  it("% de pessoas com registro (ex.: quem usou a INIA) conta a população inteira", async () => {
    const [a] = operatorsOf(1)
    const usage: DomainFactsLoader = async (domain, ids) => ({ truncated: false, facts: domain === "INIA_USAGE" ? [{ personId: a!, key: "c1", dims: { CANAL: "Chat", DIA: "2026-08-02" }, measures: {} }, { personId: a!, key: "c1", dims: { CANAL: "Voz", DIA: "2026-08-03" }, measures: {} }].filter((fact) => ids.includes(fact.personId)) : [] })
    const result = await executeLeadershipTool({ ...(await deps()), loadDomainFacts: usage }, "leadership_inia_usage", { estrutura: "Sara", medidas: ["USOU", "PERGUNTAS_POR_PESSOA", "CONVERSAS_POR_PESSOA"], estatisticas: ["TAXA", "TOTAL", "MAXIMO"] })
    expect(result.text).toContain("Pessoas que usaram a INIA — %: 20%")
    expect(result.text).toContain("Perguntas à INIA por pessoa — total: 2")
    expect(result.text).toContain("Conversas por pessoa — máximo: 1")
  })

  it("cada domínio é uma ferramenta própria oferecida ao modelo", () => {
    const names = LEADERSHIP_TOOL_DECLARATIONS.map((declaration) => declaration.name)
    for (const name of ["leadership_interactions", "leadership_monitoring", "leadership_feedbacks", "leadership_cases", "leadership_schedule", "leadership_workday", "leadership_communications", "leadership_inia_usage", "leadership_support"]) expect(names).toContain(name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe("busca por trecho e escolha da leitura (atendimentos)", () => {
  const fact = (id: string, reason: string, subReason: string, contest: boolean) => ({ personId: "p", key: id, dims: { MOTIVO: reason, SUBMOTIVO: subReason, DIA: "2026-08-01" }, measures: { contestacao: contest ? 1 : 0 } })
  const facts = [fact("1", "Contestação de cobrança", "Fatura", false), fact("2", "Cobrança", "Contestacao de valor", true), fact("3", "Fatura", "Segunda via", true), fact("4", "Plano", "Troca", false)]
  const flags = [{ name: "contestacao", label: "Contestação", valueType: "BOOLEAN" as const }]
  const context = async () => {
    const base = await deps()
    const structure = (await import("./references.js")).resolveStructureReference(base.scope, {})
    if (structure.kind !== "OK") throw new Error("estrutura")
    return { structure: structure.value, periodNote: "Mês 08/2026", now: new Date("2026-11-18T12:00:00Z") }
  }

  it("termo em mais de um campo: devolve a escolha com a contagem de cada leitura e de 'qualquer um', sem escolher", async () => {
    const result = narrowByText(facts, { termo: "contestação" }, flags, await context())
    if (!("choice" in result)) throw new Error("esperava escolha")
    expect(result.choice.options.map((option) => [option.id, option.detail.split(" ")[0]])).toEqual([["MOTIVO", "1"], ["SUBMOTIVO", "1"], ["OCORRENCIA", "2"], ["QUALQUER", "3"]])
    expect(result.summary).toContain("Não escolha por ela")
  })

  it("campo dito (termo_em) ou explícito (submotivo_contem) recorta direto, sem acento nem maiúscula", async () => {
    const only = narrowByText(facts, { termo: "CONTESTACAO", termo_em: ["SUBMOTIVO"] }, flags, await context())
    expect("facts" in only && only.facts.map((item) => item.key)).toEqual(["2"])
    const any = narrowByText(facts, { termo: "contestação", termo_em: ["MOTIVO", "OCORRENCIA"] }, flags, await context())
    expect("facts" in any && any.facts.map((item) => item.key)).toEqual(["1", "2", "3"])
    const explicit = narrowByText(facts, { motivo_contem: "cobranca" }, flags, await context())
    expect("facts" in explicit && explicit.facts.map((item) => item.key)).toEqual(["1", "2"])
  })

  it("termo em um campo só usa esse campo; em nenhum, diz que não aparece", async () => {
    const single = narrowByText(facts, { termo: "segunda via" }, flags, await context())
    expect("facts" in single && single.facts.map((item) => item.key)).toEqual(["3"])
    expect(narrowByText(facts, { termo: "portabilidade" }, flags, await context())).toHaveProperty("error")
  })

  it("DC-04: termo achado num campo só — a ferramenta devolve o campo usado no rastro (a proposta de report o guarda)", async () => {
    expect(narrowByText(facts, { termo: "segunda via" }, flags, await context())).toMatchObject({ resolvedField: "SUBMOTIVO" })
    expect(narrowByText(facts, { termo: "contestação", termo_em: ["SUBMOTIVO"] }, flags, await context())).not.toHaveProperty("resolvedField")
    const [a] = operatorsOf(1)
    const calls: DomainFactsLoader = async (domain, ids) => ({ truncated: false, flags: [], facts: domain === "INTERACTIONS" ? [{ personId: a!, key: "k1", dims: { MOTIVO: "Fatura", SUBMOTIVO: "Segunda via", CANAL: "VOICE", DIA: "2026-08-03" }, measures: { DURACAO: 100 } }].filter((item) => ids.includes(item.personId)) : [] })
    const result = await executeLeadershipTool({ ...(await deps()), loadDomainFacts: calls }, "leadership_interactions", { estrutura: "Sara", termo: "segunda via", competencia: "2026-08" })
    expect(result.card?.type).toBe("QUERY_TABLE")
    expect(result.trace).toEqual({ resolvedTermFields: ["SUBMOTIVO"] })
  })
})
