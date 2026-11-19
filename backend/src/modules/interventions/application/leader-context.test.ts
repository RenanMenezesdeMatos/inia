import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createConditionResolver } from "./condition-resolvers.js"
import { loadEvolutionReference, loadLeaderContext } from "./leader-context.js"

/**
 * QA-01 — o marco da "evolução desde o último feedback" é buscado por consulta própria: o mais recente com idade para comparar,
 * sem depender da lista do resumo (cortada em 5). ARQ-04 — quando o marco vira evidência da regra (condição "Evolução"), só
 * feedback com citação conferida, o mesmo filtro da condição "Feedbacks publicados".
 */
const asOf = new Date("2026-11-19T12:00:00Z")
const input = { organizationId: "org-1", personId: "p-1", indicatorCode: "TMA", indicatorName: "TMA", asOf, timeZone: "America/Sao_Paulo" }
const DAY_MS = 86_400_000
const twentyDaysAgo = new Date(asOf.getTime() - 20 * DAY_MS)

function fakeDatabase() {
  const queries: { sql: string; params: unknown[] }[] = []
  const query = async (sql: string, params: unknown[] = []) => {
    const text = sql.replace(/\s+/g, " ").trim()
    queries.push({ sql: text, params })
    // Histórico do resumo: os 5 mais recentes (todos com menos de 7 dias), de 7 no período.
    if (text.includes("count(*) over () total")) {
      return { rows: [1, 2, 3, 4, 5].map((age) => ({ id: `recent-${age}`, kind: "MONITORING", title: null, published_at: new Date(asOf.getTime() - age * DAY_MS), acknowledged_at: null, recommendation: "", total: "7" })) }
    }
    // Marco da evolução: o banco devolve o mais recente COM idade suficiente (a ordenação é conferida abaixo).
    if (text.includes("from feedbacks f") && text.includes("limit 1")) return { rows: [{ id: "old-20", published_at: twentyDaysAgo }] }
    if (text.startsWith("select name from indicator_definitions")) return { rows: [{ name: "TMA" }] }
    return { rows: [] }
  }
  return { db: { query } as unknown as Database, queries }
}

const referenceQuery = (queries: { sql: string; params: unknown[] }[]) => queries.find((item) => item.sql.includes("from feedbacks f") && item.sql.includes("limit 1"))

describe("marco da evolução (QA-01)", () => {
  it("consulta própria: prefere o mais recente com 7 dias ou mais, dentro da janela, sem o teto de 5 da lista", async () => {
    const { db, queries } = fakeDatabase()
    const reference = await loadEvolutionReference(db, input, { days: 30 })
    expect(reference).toEqual({ id: "old-20", publishedAt: twentyDaysAgo.toISOString() })
    const { sql, params } = referenceQuery(queries)!
    expect(sql).toContain("order by (f.published_at <= $6) desc, f.published_at desc, f.id desc limit 1")
    expect(params[2]).toEqual(new Date(asOf.getTime() - 30 * DAY_MS))
    expect(params[5]).toEqual(new Date(asOf.getTime() - 7 * DAY_MS))
    expect(params).toHaveLength(6)
  })

  it("resumo da liderança: 5 feedbacks na semana na lista e o marco é o de 20 dias (fora da lista)", async () => {
    const { db, queries } = fakeDatabase()
    const context = await loadLeaderContext(db, input)
    expect(context.feedbacks).toHaveLength(5)
    expect(referenceQuery(queries)).toBeDefined()
    // No resumo o texto é histórico, nunca evidência: sem o filtro de citação conferida.
    expect(referenceQuery(queries)!.sql).not.toContain("evidenceVerified")
  })
})

describe("condição Evolução × citação conferida (ARQ-04)", () => {
  it("o feedback de referência passa pelo mesmo filtro `evidenceVerified` da condição Feedbacks publicados", async () => {
    const { db, queries } = fakeDatabase()
    const subject = { organizationId: "org-1", personId: "p-1", policyIndicatorCode: "TMA", subjectKey: "INDICATOR:TMA", asOf, timeZone: "America/Sao_Paulo" }
    await createConditionResolver(db, subject)({ kind: "EVOLUTION", indicatorCode: null, withinDays: 30, expectation: "NOT_IMPROVED", minimumImprovementPercent: 0 } as never)
    const { sql, params } = referenceQuery(queries)!
    expect(sql).toContain("coalesce(f.context_snapshot->>'evidenceVerified', 'true') <> 'false'")
    expect(params[2]).toEqual(new Date(asOf.getTime() - 30 * DAY_MS))
    // A condição não lê mais a lista do resumo (era dela o corte de 5).
    expect(queries.some((item) => item.sql.includes("count(*) over () total"))).toBe(false)
  })
})
