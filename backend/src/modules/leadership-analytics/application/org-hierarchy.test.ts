import { describe, expect, it } from "vitest"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository, person } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import type { QueryTableCard } from "../domain/view-models.js"
import { CLOSURE, L, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import { executeLeadershipTool } from "./leadership-toolset.js"
import { HIERARCHY_DECLARATION, HIERARCHY_LEADERSHIP_DECLARATION, HIERARCHY_TOOL, hierarchyStatusLabel, runHierarchyQuery } from "./org-hierarchy.js"

const org = leadershipOrg()
const byId = (id: string) => org.people.find((item) => item.id === id)!
const run = (viewerId: string, args: Record<string, unknown>, people = org.people) => runHierarchyQuery({ people, viewer: people.find((item) => item.id === viewerId)!, args, now: CLOSURE.now })
const table = (result: { card: unknown }) => result.card as QueryTableCard
const column = (card: QueryTableCard, key: string) => card.rows.map((row) => row.cells[key])

describe("org_hierarchy — organograma aberto a todos", () => {
  it("operador pergunta \"quem é meu chefe\": líder direto e a cadeia até o topo", () => {
    const operator = operatorsOf(1)[0]!
    const result = run(operator, {})
    const card = table(result)
    expect(column(card, "name")).toEqual(["Sara Silva", "Carla Coordenadora", "Gabriel Gerente"])
    expect(column(card, "level")[0]).toBe("Líder direto")
    expect(card.highlights.join(" ")).toContain("Líder direto: Sara Silva (Supervisor)")
    expect(card.highlights.join(" ")).toContain("Pares (mesmo líder direto): 4.")
    // Só organograma: nenhuma linha leva para o perfil de outra pessoa.
    expect(card.rows.every((row) => row.personId === null && row.subject === null)).toBe(true)
  })

  it("alcança qualquer pessoa da organização, inclusive fora do escopo de quem pergunta", async () => {
    const repository = new InMemoryAnalyticsRepository(org)
    const scope = await loadViewerScope(repository, leaderUser(L.sara, "SUPERVISOR"))
    expect(scope.nodes.has(L.hugo)).toBe(false)
    const result = await executeLeadershipTool({ repository, scope, closure: CLOSURE, loadPendingActions: async () => ({ pending: [], history: [], pendingCount: 0 }) }, HIERARCHY_TOOL, { pessoa: "Hugo Reis" })
    expect(result.issue).toBeUndefined()
    expect(table(result).highlights.join(" ")).toContain("Líder direto: Helena Gerente (Gerente)")
  })

  it("quantas pessoas estão abaixo e quantas respondem diretamente — calculado sobre todos", () => {
    const below = table(run(L.sara, { consulta: "ABAIXO", pessoa: "Gabriel Gerente" }))
    // Carla + Sara + Saulo + Sônia + Davi + 15 operadores = 20.
    expect(below.highlights[0]).toBe("Total: 20 pessoas (Operador: 16, Supervisor: 3, Coordenador: 1).")
    expect(Object.fromEntries(below.rows.map((row) => [row.cells.group, row.cells.count]))).toEqual({ Operador: "16", Supervisor: "3", Coordenador: "1" })
    expect(below.rows.find((row) => row.cells.group === "Operador")!.cells.share).toBe("80,0%")

    const direct = table(run(L.sara, { consulta: "DIRETOS", pessoa: "Gabriel" }))
    expect(direct.totalRows).toBe(3)
    expect(Object.fromEntries(direct.rows.map((row) => [row.cells.name, row.cells.below]))).toEqual({ "Carla Coordenadora": "12", "Davi Direto": "0", "Sônia Prado": "5" })
  })

  it("span pela contagem: operadores por supervisor na organização, com média, mediana, mínimo e máximo", () => {
    const card = table(run(operatorsOf(2)[0]!, { consulta: "CONTAGEM", agrupar_por: "SUPERVISOR", cargos: ["OPERADOR"] }))
    expect(card.rows).toHaveLength(4)
    expect(card.rows.every((row) => row.cells.count === "5")).toBe(true)
    expect(card.highlights.join(" ")).toContain("média 5 por supervisor · mediana 5 · mínimo 5 · máximo 5 (soma das linhas: 20)")
    // Davi responde direto ao gerente: fica no total, fora das linhas, e isso é dito.
    expect(card.highlights[0]).toContain("Total: 21 pessoas")
    expect(card.limitations.join(" ")).toContain("1 pessoa não tem supervisor")
  })

  it("líder do nível sem ninguém entra com zero no span (média e mínimo não o ignoram)", () => {
    const people = [...org.people, person({ id: "40000000-0000-4000-8000-0000000000aa", name: "Sílvia Nova", role: "SUPERVISOR", reportsToId: L.gabriel, teamId: L.team, teamName: "Atendimento" })]
    const card = table(run(L.gabriel, { consulta: "CONTAGEM", estrutura_de: "Gabriel Gerente", agrupar_por: "SUPERVISOR", cargos: ["OPERADOR"] }, people))
    expect(card.rows.find((row) => row.cells.group === "Sílvia Nova")?.cells.count).toBe("0")
    expect(card.highlights.join(" ")).toContain("mínimo 0")
  })

  it("contagem por Grupo e filtro por Grupo", () => {
    const byTeam = table(run(L.sara, { consulta: "CONTAGEM", agrupar_por: "GRUPO" }))
    expect(Object.fromEntries(byTeam.rows.map((row) => [row.cells.group, row.cells.count]))).toEqual({ Atendimento: "21", "Outro Grupo": "7" })
    const filtered = table(run(L.sara, { consulta: "CONTAGEM", grupo: "outro grupo", agrupar_por: "NENHUM" }))
    expect(filtered.rows[0]!.cells.count).toBe("7")
  })

  it("homônimos viram ambiguidade com cargo; nome inexistente, não encontrado; inativo não é contado", () => {
    const ambiguous = run(L.gabriel, { pessoa: "Silva" })
    expect(ambiguous.issue?.kind).toBe("AMBIGUOUS")
    expect(ambiguous.issue?.candidates).toEqual(["Sara Silva (Supervisor, Atendimento)", "Saulo Silva (Supervisor, Atendimento)"])
    expect(run(L.gabriel, { pessoa: "Ninguém Existe" }).issue?.kind).toBe("NOT_FOUND")

    const people = org.people.map((item) => (item.id === operatorsOf(3)[0] ? { ...item, active: false } : item))
    const direct = table(run(L.gabriel, { consulta: "DIRETOS", pessoa: "Sônia" }, people))
    expect(direct.totalRows).toBe(4)
  })

  it("cadeia com líder inativo: aparece pelo nome, SEM marca de situação (SL-03), e quem está abaixo continua contado", () => {
    const people = org.people.map((item) => (item.id === L.carla ? { ...item, active: false } : item))
    const chain = column(table(run(operatorsOf(1)[0]!, {}, people)), "name")
    expect(chain).toContain("Carla Coordenadora")
    expect(chain.join(" ")).not.toMatch(/inativ/i)
    expect(table(run(L.gabriel, { consulta: "ABAIXO", agrupar_por: "NENHUM" }, people)).rows[0]!.cells.count).toBe("19")
  })

  it("texto de busca longo é cortado em 120 caracteres (SL-02)", () => {
    const result = run(L.gabriel, { consulta: "PESSOA", pessoa: "x".repeat(1_000_000) }, org.people)
    expect(JSON.stringify(result)).not.toContain("x".repeat(121))
  })

  it("ciclo no cadastro não trava a cadeia", () => {
    const people = org.people.map((item) => (item.id === L.gabriel ? { ...item, reportsToId: L.sara } : item))
    const card = table(run(operatorsOf(1)[0]!, {}, people))
    expect(column(card, "name")).toEqual(["Sara Silva", "Carla Coordenadora", "Gabriel Gerente"])
  })

  it("declaração não traz parâmetros de resultado nem de escopo de acesso", () => {
    const properties = Object.keys((HIERARCHY_DECLARATION.parameters as { properties: Record<string, unknown> }).properties)
    expect(properties).not.toContain("indicador")
    expect(properties).not.toContain("competencia")
    expect(byId(L.gabriel).role).toBe("MANAGER")
  })
})

describe("org_hierarchy — visão da liderança: ativos, inativos e situação funcional (21/11/2026)", () => {
  const inactiveOperator = operatorsOf(3)[0]!
  const people = org.people.map((item) => (item.id === inactiveOperator || item.id === L.carla ? { ...item, active: false } : item))
  const statuses = new Map<string, string | null>([[operatorsOf(1)[0]!, "FERIAS"], [operatorsOf(1)[1]!, "INSS"], [operatorsOf(1)[2]!, "VACATION"], [L.sara, "EM_PRODUCAO"]])
  const lead = (viewerId: string, args: Record<string, unknown>) => runHierarchyQuery({ people, viewer: people.find((item) => item.id === viewerId)!, args, now: CLOSURE.now, leadership: { statuses, dateLabel: "21/11/2026" } })

  it("rótulo da situação: afastamento sensível protegido, legado canonizado, ausente = Não informada (nunca Em produção)", () => {
    expect(hierarchyStatusLabel("INSS")).toBe("Afastamento (motivo protegido)")
    expect(hierarchyStatusLabel("MATERNIDADE")).toBe("Afastamento (motivo protegido)")
    expect(hierarchyStatusLabel("VACATION")).toBe("FÉRIAS")
    expect(hierarchyStatusLabel(null)).toBe("Não informada")
    expect(hierarchyStatusLabel("QUALQUER")).toBe("Não informada")
  })

  it("lista com cadastro TODOS traz ativos e inativos, com colunas de cadastro e situação", () => {
    const card = table(lead(L.gabriel, { consulta: "DIRETOS", pessoa: "Sara Silva", cadastro: "TODOS" }))
    expect(card.columns.map((item) => item.key)).toEqual(["name", "role", "team", "subteam", "registry", "status", "below"])
    const byName = Object.fromEntries(card.rows.map((row) => [row.cells.name, row.cells]))
    expect(byName[org.people.find((item) => item.id === operatorsOf(1)[0])!.name]!.status).toBe("FÉRIAS")
    expect(byName[org.people.find((item) => item.id === operatorsOf(1)[1])!.name]!.status).toBe("Afastamento (motivo protegido)")
    expect(byName[org.people.find((item) => item.id === operatorsOf(1)[3])!.name]!.status).toBe("Não informada")
    expect(JSON.stringify(card.rows)).not.toContain("INSS")
  })

  it("padrão ATIVOS conta só ativos e avisa quantos inativos ficaram fora; INATIVOS lista só os inativos", () => {
    const active = table(lead(L.gabriel, { consulta: "ABAIXO", agrupar_por: "NENHUM" }))
    expect(active.rows[0]!.cells.count).toBe("18")
    expect(active.highlights.join(" ")).toContain("Fora da contagem: 2 pessoas inativas no cadastro")
    const inactive = table(lead(L.gabriel, { consulta: "ABAIXO", listar_pessoas: true, cadastro: "INATIVOS" }))
    expect(inactive.totalRows).toBe(2)
    expect(inactive.rows.every((row) => row.cells.registry === "Inativo")).toBe(true)
  })

  it("cadeia marca o líder inativo e traz a situação; a ficha mostra cadastro e situação da pessoa; acha inativo pelo nome", () => {
    const card = table(lead(operatorsOf(1)[0]!, {}))
    expect(column(card, "name")).toContain("Carla Coordenadora (inativo no cadastro)")
    expect(card.highlights.join(" ")).toContain("Cadastro: ativo · situação funcional em 21/11/2026: FÉRIAS.")
    const carla = lead(L.gabriel, { pessoa: "Carla Coordenadora" })
    expect(carla.issue).toBeUndefined()
    expect(table(carla).highlights.join(" ")).toContain("Cadastro: inativo")
  })

  it("agrupar por SITUACAO conta por situação funcional, com o sensível no bucket protegido", () => {
    const card = table(lead(L.gabriel, { consulta: "ABAIXO", cargos: ["OPERADOR"], agrupar_por: "SITUACAO" }))
    const counts = Object.fromEntries(card.rows.map((row) => [row.cells.group, row.cells.count]))
    expect(counts["FÉRIAS"]).toBe("2")
    expect(counts["Afastamento (motivo protegido)"]).toBe("1")
    expect(Object.keys(counts)).not.toContain("INSS")
  })

  it("operador continua sem inativos nem situação; a declaração da liderança tem cadastro e SITUACAO, a do operador não", () => {
    const operatorView = table(runHierarchyQuery({ people, viewer: people.find((item) => item.id === operatorsOf(1)[0])!, args: { cadastro: "TODOS" }, now: CLOSURE.now }))
    expect(JSON.stringify([operatorView.rows, operatorView.columns, operatorView.highlights])).not.toMatch(/inativ|FÉRIAS|Situação funcional/i)
    expect(Object.keys((HIERARCHY_DECLARATION.parameters as { properties: Record<string, unknown> }).properties)).not.toContain("cadastro")
    const leadProps = (HIERARCHY_LEADERSHIP_DECLARATION.parameters as { properties: Record<string, { enum?: string[] }> }).properties
    expect(leadProps.cadastro?.enum).toEqual(["ATIVOS", "INATIVOS", "TODOS"])
    expect(leadProps.agrupar_por?.enum).toContain("SITUACAO")
  })

  it("pelo caminho da liderança, a situação vem do leitor da força de trabalho, na data de hoje", async () => {
    const repository = new InMemoryAnalyticsRepository(org)
    const scope = await loadViewerScope(repository, leaderUser(L.sara, "SUPERVISOR"))
    const dates: string[] = []
    const result = await executeLeadershipTool(
      { repository, scope, closure: CLOSURE, loadPendingActions: async () => ({ pending: [], history: [], pendingCount: 0 }), loadStatuses: async (ids, date) => { dates.push(date); return new Map(ids.map((id) => [id, "FERIAS"])) } },
      HIERARCHY_TOOL,
      { pessoa: "Hugo Reis" },
    )
    expect(dates).toHaveLength(1)
    expect(table(result).highlights.join(" ")).toContain("situação funcional em")
    expect(result.text).toContain("visão da liderança")
  })
})
