import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AccessContext } from "../../access/domain/access-decision.js"
import { loadTeamOverview, MAX_ACTIVE } from "./team-overview.js"

/**
 * ARQ-13 — a visão da equipe corta a lista em andamento em `MAX_ACTIVE`, mas diz o total REAL do alcance (`activeTotal`) e se
 * houve corte (`activeTruncated`). Antes a tela adivinhava o corte por "vieram exatamente 200".
 */
const ORG = "00000000-0000-4000-8000-000000000001"
const VIEWER = "11111111-1111-4111-8111-111111111111"
const viewer = { organizationId: ORG, personId: VIEWER, access: { organizationId: ORG, accountId: "33333333-3333-4333-8333-333333333333", personId: VIEWER, assignments: [] } satisfies AccessContext }

const activeRow = (index: number, total: number) => ({
  id: `int-${index}`, case_id: "case-1", person_id: "p-1", person_name: "Operadora", team_name: null, type_name: "Orientar", sensitive: false, indicator_name: null, status: "IN_PROGRESS", due_at: "2026-12-01",
  responsible_id: VIEWER, responsible_name: "Líder", created_at: new Date("2026-11-01T12:00:00Z"), done: 0, total: 1, next_title: null, next_due: null, next_owner: null, active_total: total,
})

function fakeDatabase(rows: ReturnType<typeof activeRow>[]) {
  const activeQueries: string[] = []
  const query = async (sql: string) => {
    const text = sql.replace(/\s+/g, " ")
    if (text.includes("from interventions i") && text.includes("i.status in ('PROPOSED', 'AWAITING_APPROVAL', 'IN_PROGRESS')")) {
      activeQueries.push(text)
      return { rows, rowCount: rows.length }
    }
    return { rows: [], rowCount: 0 }
  }
  return { db: { query } as unknown as Database, activeQueries }
}

describe("visão da equipe — total real e corte (ARQ-13)", () => {
  it("mais acompanhamentos do que o limite: devolve a lista limitada, o total real e `activeTruncated`", async () => {
    const { db, activeQueries } = fakeDatabase(Array.from({ length: MAX_ACTIVE }, (_, index) => activeRow(index, 347)))
    const overview = await loadTeamOverview(db, viewer)
    expect(overview.active).toHaveLength(MAX_ACTIVE)
    expect(overview).toMatchObject({ activeTotal: 347, activeTruncated: true })
    // O total é contado no MESMO alcance da lista, antes do corte.
    expect(activeQueries[0]).toContain("count(*) over ()::int active_total")
    expect(activeQueries[0]).toContain(`limit ${MAX_ACTIVE}`)
  })

  it("exatamente o limite, sem mais nada: não é corte", async () => {
    const { db } = fakeDatabase(Array.from({ length: MAX_ACTIVE }, (_, index) => activeRow(index, MAX_ACTIVE)))
    expect(await loadTeamOverview(db, viewer)).toMatchObject({ activeTotal: MAX_ACTIVE, activeTruncated: false })
  })

  it("nada em andamento: total zero", async () => {
    expect(await loadTeamOverview(fakeDatabase([]).db, viewer)).toMatchObject({ active: [], activeTotal: 0, activeTruncated: false })
  })
})
