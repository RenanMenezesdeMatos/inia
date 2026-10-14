/**
 * PROVA contra o banco de TESTE real (migration 130): o `/operator/overview` lê só o necessário.
 *  - Indicadores: o ÚLTIMO período de cada indicador da pessoa (nunca o histórico), com a meta da equipe VIGENTE nele.
 *  - Acompanhamento: páginas por cursor (keyset) que, somadas, dão exatamente a lista ordenada — sem buraco nem repetição, mesmo
 *    com itens no MESMO microssegundo; oculto e rascunho fora; cursor de outra pessoa não vaza nada.
 * Dados commitados e apagados no fim, pelos ids criados.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run operator-overview-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { decodeFollowUpCursor } from "../../feedbacks/domain/follow-up-cursor.js"
import { fetchOperatorFeedbackPage, fetchOperatorIndicators } from "../application/fetch-operator-overview.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], teams: [] as string[], cases: [] as string[], feedbacks: [] as string[], definitions: [] as string[] }

describe.skipIf(!ENABLED)("Overview do colaborador — prova Postgres (migration 130)", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 }) })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from feedback_follow_up_hides where feedback_id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from feedbacks where id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1::uuid[])", [created.cases])
    await pool.query("delete from indicator_measurements where indicator_definition_id = any($1::uuid[])", [created.definitions])
    await pool.query("delete from goals where indicator_definition_id = any($1::uuid[])", [created.definitions])
    await pool.query("delete from indicator_definitions where id = any($1::uuid[])", [created.definitions])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.query("delete from teams where id = any($1::uuid[])", [created.teams])
    await pool.end()
  })

  async function fixture() {
    const operation = (await pool.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const team = (await pool.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id", [ORG, operation, `Proof Overview ${randomUUID()}`])).rows[0]!.id
    created.teams.push(team)
    const person = async (name: string) => { const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, 'OPERATOR', $3) returning id", [ORG, name, team])).rows[0]!.id; created.people.push(id); return id }
    return { team, operator: await person("Proof Overview Operadora"), other: await person("Proof Overview Outro") }
  }

  it("indicadores: só o último período de cada um, com a meta vigente nele (não a de outro período)", async () => {
    const { team, operator, other } = await fixture()
    const definition = async (direction: "LOWER" | "HIGHER") => {
      const code = `PROOF_OVR_${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`
      const id = (await pool.query<{ id: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction, daily_supported) values ($1, $2, $2, 'SECONDS', $3, true) returning id", [ORG, code, direction])).rows[0]!.id
      created.definitions.push(id)
      return { id, code }
    }
    const tma = await definition("LOWER")
    const quality = await definition("HIGHER")
    const measure = (definitionId: string, subject: string, day: string, value: number) =>
      pool.query(`insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, $4, $5::date, $5::date + interval '1 day' - interval '1 second', 'PROOF', 'DAILY')`, [ORG, definitionId, subject, value, day])
    for (const [day, value] of [["2026-08-30", 300], ["2026-09-01", 410], ["2026-09-15", 380], ["2026-08-31", 250]] as const) await measure(tma.id, operator, day, value)
    await measure(quality.id, operator, "2026-07-10", 92)
    await measure(tma.id, other, "2026-09-30", 999)
    // Duas metas sobrepostas da equipe: a de setembro vale para a medição de 15/09; a anterior não.
    await pool.query("insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1, $2, 'TEAM', $3, 300, '2026-01-01'), ($1, $2, 'TEAM', $3, 420, '2026-09-01')", [ORG, tma.id, team])

    const rows = (await fetchOperatorIndicators(pool, ORG, operator)).filter((row) => row.code === tma.code || row.code === quality.code)
    expect(rows.map((row) => ({ code: row.code, value: row.value, targetValue: row.targetValue, achieved: row.achieved }))).toEqual([
      { code: tma.code, value: 380, targetValue: 420, achieved: true },
      { code: quality.code, value: 92, targetValue: null, achieved: null },
    ])
  })

  it("Acompanhamento: as páginas pelo cursor somam a lista ordenada, sem buraco nem repetição; oculto, rascunho e outra pessoa fora", async () => {
    const { team, operator, other } = await fixture()
    const feedback = async (operatorId: string, at: string, options: { id?: string; status?: string } = {}) => {
      const caseId = (await pool.query<{ id: string }>(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'Proof', 'Proof', 'P3', 'X', '-', '-') returning id`, [ORG, operatorId, team])).rows[0]!.id
      created.cases.push(caseId)
      const id = options.id ?? randomUUID()
      const status = options.status ?? "PUBLISHED"
      await pool.query(
        `insert into feedbacks (id, organization_id, case_id, operator_id, status, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, feedback_kind, published_at, created_at)
         values ($1, $2, $3, $4, $5::feedback_status, 'X', 'e', 'o', 'p', 'r', 'MONITORING', case when $5::text = 'PUBLISHED' then $6::timestamptz end, $6::timestamptz)`,
        [id, ORG, caseId, operatorId, status, at],
      )
      created.feedbacks.push(id)
      return id
    }
    // 7 publicados; três no MESMO microssegundo (desempate por id desc), um dia a dia, um rascunho e um oculto.
    const same = "2026-09-20T10:00:00.123456Z"
    const prefix = randomUUID().slice(0, 23)
    const tieIds = ["0000000000c1", "0000000000c3", "0000000000c2"].map((suffix) => `${prefix}-${suffix}`)
    for (const id of tieIds) await feedback(operator, same, { id })
    const daily = [await feedback(operator, "2026-09-22T08:00:00Z"), await feedback(operator, "2026-09-18T08:00:00Z"), await feedback(operator, "2026-09-25T08:00:00Z"), await feedback(operator, "2026-09-10T08:00:00Z")]
    const draft = await feedback(operator, "2026-09-30T08:00:00Z", { status: "DRAFT" })
    const hidden = await feedback(operator, "2026-09-29T08:00:00Z")
    await pool.query("insert into feedback_follow_up_hides (organization_id, feedback_id, reason_code, reason, selection_ref, hidden_at) values ($1, $2, 'DEVELOPMENT_ARTIFACT', 'prova', 'PROOF', now())", [ORG, hidden])
    const othersFeedback = await feedback(other, "2026-09-12T08:00:00Z")

    const expected = (await pool.query<{ id: string }>(
      `select id from feedbacks where id = any($1::uuid[]) and operator_id = $2 and status = 'PUBLISHED' and id <> $3 order by coalesce(published_at, created_at) desc, id desc`,
      [created.feedbacks, operator, hidden],
    )).rows.map((row) => row.id)
    expect(expected).toHaveLength(7)
    expect(expected.slice(2, 5)).toEqual([...tieIds].sort().reverse())

    const viewer = { personId: operator }
    const collected: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page: Awaited<ReturnType<typeof fetchOperatorFeedbackPage>> = await fetchOperatorFeedbackPage(pool, ORG, operator, viewer, { publishedOnly: true, limit: 2, before: decodeFollowUpCursor(cursor) })
      collected.push(...page.items.map((item) => item.id))
      expect(page.items.every((item) => !("cursorAt" in item))).toBe(true)
      cursor = page.nextCursor
      pages++
    } while (cursor && pages < 10)
    expect(collected).toEqual(expected)
    expect(pages).toBe(4)
    expect(collected).not.toContain(draft)
    expect(collected).not.toContain(othersFeedback)
    expect(daily.every((id) => collected.includes(id))).toBe(true)

    // Página exata: sem página vazia no fim.
    const firstSeven = await fetchOperatorFeedbackPage(pool, ORG, operator, viewer, { publishedOnly: true, limit: 7 })
    expect(firstSeven.items.map((item) => item.id)).toEqual(expected)
    expect(firstSeven.nextCursor).toBeNull()

    // O cursor só posiciona: aplicado a OUTRA pessoa, devolve só os feedbacks dela.
    const afterFirst = await fetchOperatorFeedbackPage(pool, ORG, operator, viewer, { publishedOnly: true, limit: 1 })
    const foreign = await fetchOperatorFeedbackPage(pool, ORG, other, { personId: other }, { publishedOnly: true, before: decodeFollowUpCursor(afterFirst.nextCursor) })
    expect(foreign.items.map((item) => item.id)).toEqual([othersFeedback])

    // Sem `publishedOnly` (leituras internas) o rascunho entra, na mesma ordem.
    const all = await fetchOperatorFeedbackPage(pool, ORG, operator, viewer, { limit: 50 })
    expect(all.items[0]!.id).toBe(draft)
  })
})
