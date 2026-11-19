import type pg from "pg"
import { describe, expect, it } from "vitest"
import type { DemoMass } from "./build-demo-mass.js"
import { resetDemoMass } from "./reset-demo-mass.js"

/**
 * AL-07 — `operational_alignment_reads` (migration 227) é só inserção e referencia `people` sem `on delete`: a leitura de uma pessoa
 * demo precisa sair ANTES de a pessoa ser apagada, com o gatilho desligado só dentro da transação do reset. Cliente roteirizado:
 * a prova é a ordem dos comandos (sem banco).
 */
const PERSON = "de000000-0000-4000-8000-0000000000aa"
const mass = {
  structure: { people: [{ id: PERSON, key: "op-1", role: "OPERATOR", adopted: null }], teams: [], subteams: [], operations: [], byKey: new Map() },
  interactionsOf: () => [],
  dailyMeasurementsOf: () => [],
  diagnosticCalls: [],
  performance: { goals: [], indicatorRows: [], prvRows: [] },
} as unknown as DemoMass

function scriptedClient(options: { reads: number }) {
  const statements: string[] = []
  const client = {
    query: async (sql: string) => {
      const text = sql.replace(/\s+/g, " ").trim()
      statements.push(text)
      if (text.startsWith("select count(*)")) return { rows: [{ count: "0" }], rowCount: 1 }
      if (text.startsWith("select 1 from operational_alignment_reads")) return { rows: Array.from({ length: options.reads }, () => ({})), rowCount: options.reads }
      return { rows: [], rowCount: 0 }
    },
  } as unknown as pg.PoolClient
  return { client, statements }
}

describe("reset da massa demo × leituras de alinhamento (AL-07)", () => {
  it("pessoa demo com 'Li o alinhamento': a leitura sai antes da pessoa, com o gatilho desligado só na transação", async () => {
    const { client, statements } = scriptedClient({ reads: 1 })
    const report = await resetDemoMass(client, mass)
    expect(report.blockers).toEqual([])
    const at = (prefix: string) => statements.findIndex((statement) => statement.startsWith(prefix))
    const order = [at("begin"), at("alter table operational_alignment_reads disable trigger operational_alignment_reads_no_update"), at("delete from operational_alignment_reads where person_id = any($1::uuid[])"), at("alter table operational_alignment_reads enable trigger operational_alignment_reads_no_update"), at("delete from people where id = any($1::uuid[])"), at("commit")]
    expect(order.every((index) => index >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(report.deleted).toHaveProperty("operational_alignment_reads")
  })

  it("sem leitura de pessoa demo: o gatilho não é tocado (nenhum `alter table`)", async () => {
    const { client, statements } = scriptedClient({ reads: 0 })
    await resetDemoMass(client, mass)
    expect(statements.some((statement) => statement.startsWith("alter table"))).toBe(false)
    expect(statements.some((statement) => statement.startsWith("delete from operational_alignment_reads"))).toBe(false)
  })
})
