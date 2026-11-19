import { describe, expect, it } from "vitest"
import { loadViewerScope } from "../../performance-analytics/application/viewer-scope.js"
import { InMemoryAnalyticsRepository } from "../../performance-analytics/testing/in-memory-analytics-repository.js"
import { CLOSURE, leaderUser, leadershipOrg, operatorsOf } from "../testing/leadership-fixture.js"
import type { QueryTableCard } from "../domain/view-models.js"
import type { DomainFactsLoader } from "./data-domains.js"
import { executeSelfDataTool, SELF_DATA_DECLARATIONS } from "./self-data-tools.js"

const [me, colleague] = operatorsOf(1) as [string, string]

async function operatorScope() {
  const repository = new InMemoryAnalyticsRepository(leadershipOrg())
  return loadViewerScope(repository, leaderUser(me, "OPERATOR"))
}

/** O carregamento devolve registros de duas pessoas: só os da própria pessoa podem entrar. */
function spyLoader(asked: string[][]): DomainFactsLoader {
  return async (_domain, ids) => {
    asked.push(ids)
    const call = (personId: string, key: string) => ({ personId, key, dims: { MOTIVO: "Fatura", SUBMOTIVO: null, CANAL: "VOICE", DIA: "2026-09-02" }, measures: { DURACAO: 300 } })
    return { facts: [call(me, "a"), call(me, "b"), call(colleague, "c"), call(colleague, "d"), call(colleague, "e")], truncated: false, flags: [] }
  }
}

describe("ferramentas de dados do operador — só os dados da própria pessoa", () => {
  it("o carregamento recebe só a pessoa da sessão e o cálculo ignora registros de outra pessoa", async () => {
    const asked: string[][] = []
    const result = await executeSelfDataTool(await operatorScope(), { name: "my_interactions", args: { estatisticas: ["TOTAL"] }, lastClosedPeriod: CLOSURE.lastClosedPeriod, now: CLOSURE.now, load: spyLoader(asked) })
    expect(asked).toEqual([[me]])
    expect(result.text).toContain("Total do recorte: 1 pessoas, 2 registros")
  })

  it("estrutura e agrupamento por pessoa/líder/Grupo enviados pelo modelo são descartados", async () => {
    const asked: string[][] = []
    const result = await executeSelfDataTool(await operatorScope(), { name: "my_interactions", args: { estrutura: "Sara", agrupar_por: "PESSOA" }, lastClosedPeriod: CLOSURE.lastClosedPeriod, now: CLOSURE.now, load: spyLoader(asked) })
    expect(asked).toEqual([[me]])
    expect((result.card as QueryTableCard).rows).toHaveLength(1)
    expect((result.card as QueryTableCard).structure.subject).toEqual({ kind: "EMPLOYEE", employeeId: me })
  })

  it("o modelo nem recebe os parâmetros de escopo nem os agrupamentos por pessoa", () => {
    for (const declaration of SELF_DATA_DECLARATIONS) {
      const properties = (declaration.parameters as { properties: Record<string, { enum?: string[] }> }).properties
      expect(properties).not.toHaveProperty("estrutura")
      for (const grouping of ["PESSOA", "SUPERVISOR", "GRUPO", "GERENTE"]) expect(properties.agrupar_por?.enum ?? []).not.toContain(grouping)
    }
    expect(SELF_DATA_DECLARATIONS.map((declaration) => declaration.name)).toEqual(["my_interactions", "my_monitoring", "my_feedbacks", "my_schedule", "my_communications", "my_calculate"])
  })

  it("DL-03: a jornada observada (produção, classificação da gestão, divergência) não existe para o operador", async () => {
    const asked: string[][] = []
    const result = await executeSelfDataTool(await operatorScope(), { name: "my_workday", args: { agrupar_por: "CLASSIFICACAO" }, lastClosedPeriod: CLOSURE.lastClosedPeriod, now: CLOSURE.now, load: spyLoader(asked) })
    expect(result.issue?.kind).toBe("INVALID")
    expect(result.card).toBeNull()
    expect(asked).toEqual([])
  })
})
