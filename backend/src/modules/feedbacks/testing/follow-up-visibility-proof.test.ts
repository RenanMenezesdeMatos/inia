/**
 * PROVA contra o banco de TESTE real (migration 095): ocultação LÓGICA no Acompanhamento — seleção explícita, nada apagado,
 * nada reescrito; feed do colaborador (mais recente primeiro, desempate por id), feed da estrutura e contadores sem o oculto;
 * idempotência, proteção contra id de outro colaborador, restauração e auditoria. Dados commitados e apagados no fim.
 *   INIA_DB_PROOF=1 npx vitest run follow-up-visibility-proof
 */
import { randomUUID } from "node:crypto"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { fetchOperatorFeedbacks } from "../../reporting/application/fetch-operator-overview.js"
import { hideFeedbacksFromFollowUp, restoreFeedbackToFollowUp } from "../application/follow-up-visibility.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], cases: [] as string[], feedbacks: [] as string[] }

describe.skipIf(!ENABLED)("Visibilidade no Acompanhamento — prova Postgres (migration 095)", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 }) })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from audit_logs where entity_id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from feedback_follow_up_hides where feedback_id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from feedbacks where id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1::uuid[])", [created.cases])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  it("oculta só o selecionado; feed, estrutura e contadores sem ele; restaurar devolve; nada apagado", async () => {
    const team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const person = async (name: string) => { const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, 'OPERATOR', $3) returning id", [ORG, name, team])).rows[0]!.id; created.people.push(id); return id }
    const operator = await person("Proof Visibilidade Operadora")
    const other = await person("Proof Visibilidade Outro")
    const feedback = async (operatorId: string, title: string, at: string, id: string = randomUUID()) => {
      const caseId = (await pool.query<{ id: string }>(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, $4, $4, 'P3', 'X', '-', '-') returning id`, [ORG, operatorId, team, title])).rows[0]!.id
      created.cases.push(caseId)
      await pool.query(
        `insert into feedbacks (id, organization_id, case_id, operator_id, status, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, feedback_kind, published_at, created_at)
         values ($1, $2, $3, $4, 'PUBLISHED', $5, 'e', 'o', 'p', 'r', 'MONITORING', $6, $6)`,
        [id, ORG, caseId, operatorId, title, at],
      )
      created.feedbacks.push(id)
      return id
    }
    const legacyA = await feedback(operator, "Legado A", "2026-09-25T21:12:35Z")
    const legacyB = await feedback(operator, "Legado B", "2026-09-28T18:30:49Z")
    const kept = await feedback(operator, "Reconhecimento legítimo", "2026-09-15T13:10:00Z")
    // Empate de instante: o desempate é o id (desc) — determinístico.
    const tieLow = await feedback(operator, "Empate baixo", "2026-09-29T12:32:00Z", "00000000-0000-4000-8000-0000000000a1")
    const tieHigh = await feedback(operator, "Empate alto", "2026-09-29T12:32:00Z", "00000000-0000-4000-8000-0000000000a2")
    const othersFeedback = await feedback(other, "De outra pessoa", "2026-09-26T12:00:00Z")

    const clock = fixedClock("2026-09-29T12:40:00Z")
    const input = { organizationId: ORG, expectedOperatorId: operator, reasonCode: "DEVELOPMENT_ARTIFACT" as const, reason: "Smokes de desenvolvimento", selectionRef: "PROOF_SELECTION", actorId: null, clock }
    // Id de outro colaborador na seleção → recusa inteira (nada gravado).
    await expect(hideFeedbacksFromFollowUp(pool, { ...input, feedbackIds: [legacyA, othersFeedback] })).rejects.toMatchObject({ code: "FOLLOW_UP_HIDE_OPERATOR_MISMATCH" })
    expect((await pool.query("select count(*)::int n from feedback_follow_up_hides where feedback_id = any($1::uuid[])", [created.feedbacks])).rows[0].n).toBe(0)

    expect(await hideFeedbacksFromFollowUp(pool, { ...input, feedbackIds: [legacyA, legacyB] })).toEqual({ hidden: [legacyA, legacyB], alreadyHidden: [] })
    expect(await hideFeedbacksFromFollowUp(pool, { ...input, feedbackIds: [legacyA] })).toEqual({ hidden: [], alreadyHidden: [legacyA] })

    // Feed do colaborador: sem os ocultos, MAIS RECENTE PRIMEIRO, empate por id.
    const feed = await fetchOperatorFeedbacks(pool, ORG, operator, { personId: operator })
    expect(feed.map((row) => row.id)).toEqual([tieHigh, tieLow, kept])
    // Nada foi apagado nem reescrito.
    const stored = (await pool.query("select id, status, recommendation from feedbacks where id = any($1::uuid[]) order by id", [[legacyA, legacyB]])).rows
    expect(stored).toEqual([{ id: legacyA, status: "PUBLISHED", recommendation: "r" }, { id: legacyB, status: "PUBLISHED", recommendation: "r" }].sort((a, b) => a.id.localeCompare(b.id)))

    // Estrutura e contadores: o oculto não entra; o outro colaborador não muda.
    const analytics = new PgAnalyticsReadRepository(pool)
    const counts = await analytics.loadFollowUpCounts([operator, other])
    expect(counts.get(operator)).toEqual({ total: 3, unacknowledged: 3 })
    expect(counts.get(other)).toEqual({ total: 1, unacknowledged: 1 })
    const structure = await analytics.loadFollowUpFeed({ organizationId: ORG, viewerId: operator, operatorIds: [operator, other], includeViewerAlerts: false, unacknowledgedOnly: false, page: 1, pageSize: 50 })
    const structureIds = structure.items.map((item) => item.id)
    expect(structureIds).toEqual(expect.arrayContaining([tieHigh, tieLow, kept, othersFeedback]))
    expect(structureIds).not.toContain(legacyA)
    expect(structureIds).not.toContain(legacyB)

    // Auditoria e restauração.
    expect((await pool.query("select count(*)::int n from audit_logs where action = 'FEEDBACK_HIDDEN_FROM_FOLLOW_UP' and entity_id = any($1::uuid[])", [[legacyA, legacyB]])).rows[0].n).toBe(2)
    expect(await restoreFeedbackToFollowUp(pool, { organizationId: ORG, feedbackId: legacyB, reason: "Voltou a ser legítimo", actorId: null, clock })).toEqual({ restored: true })
    expect(await restoreFeedbackToFollowUp(pool, { organizationId: ORG, feedbackId: legacyB, reason: "De novo", actorId: null, clock })).toEqual({ restored: false })
    expect((await fetchOperatorFeedbacks(pool, ORG, operator, { personId: operator })).map((row) => row.id)).toEqual([tieHigh, tieLow, legacyB, kept])
    // Histórico da ocultação fica; uma nova ocultação vigente pode ser gravada depois da restauração.
    expect((await pool.query("select count(*)::int n from feedback_follow_up_hides where feedback_id = $1", [legacyB])).rows[0].n).toBe(1)
    await expect(pool.query("insert into feedback_follow_up_hides (organization_id, feedback_id, reason_code, reason, selection_ref, hidden_at) values ($1, $2, 'DEVELOPMENT_ARTIFACT', 'x', 'PROOF_SELECTION', now())", [ORG, legacyA])).rejects.toThrow(/duplicate key|unique/)
  })
})
