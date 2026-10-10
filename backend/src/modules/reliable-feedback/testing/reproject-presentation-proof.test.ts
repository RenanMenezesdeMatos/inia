/**
 * PROVA contra o banco de TESTE real: reprojeção da APRESENTAÇÃO de um feedback confiável V2 já publicado — sem IA e sem nova
 * emissão. O exemplo de condução "protocolo … é 7" gravado antes da correção sai; o que estava publicado fica em
 * `presentationRevisions`; auditoria; idempotente; recusa quando o conjunto de pontos mudou ou o feedback não é V2.
 *   INIA_DB_PROOF=1 npx vitest run reproject-presentation-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { emittedItems, renderPublishedNarrative } from "../domain/reliable-feedback-artifact.js"
import { resolvePresentation } from "../domain/feedback-presentation.js"
import { feedbackViewOf } from "../domain/feedback-view.js"
import { reprojectPublishedFeedbackPresentation } from "../infrastructure/reproject-published-presentation.js"
import { replayV173, V173_COLLABORATOR, V173_ORG } from "./replay-v173.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const PROTOCOL_7 = "Antes de encerrar, anote seu número de protocolo, que é 7."
let pool: pg.Pool
const created = { cases: [] as string[], feedbacks: [] as string[] }

describe.skipIf(!ENABLED)("Reprojeção da apresentação publicada — prova Postgres", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 }) })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from audit_logs where entity_id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from feedbacks where id = any($1::uuid[])", [created.feedbacks])
    await pool.query("delete from supervision_cases where id = any($1::uuid[])", [created.cases])
    await pool.end()
  })

  it("tira o exemplo sem fonte, guarda o publicado antes, audita e é idempotente; recusa conjunto de pontos diferente", async () => {
    const { store, artifact, record } = await replayV173().then((result) => ({ ...result, record: [...result.store.artifacts.values()][0]! }))
    // Artefato GRAVADO antes da correção: o exemplo "que é 7" estava no texto proposto do protocolo.
    const protocol = record.artifact!.items.find((item) => item.process?.behavior?.code === "PROVIDE_PROTOCOL")!
    protocol.proposedWording = { ...protocol.proposedWording!, suggestedResponse: PROTOCOL_7 }
    const items = emittedItems(artifact, [])
    const oldView = { ...feedbackViewOf(items, resolvePresentation(null, items, { domain: "MONITORING", label: artifact.label, firstName: "Larissa" }))!, developments: [] }
    const oldRecommendation = `${renderPublishedNarrative(items, [], { presentation: null, confirmedProducts: [] })}\n\n${PROTOCOL_7}`
    const team = (await pool.query<{ team_id: string }>("select team_id from people where id = $1", [V173_COLLABORATOR])).rows[0]!.team_id
    const insert = async (snapshot: object) => {
      const caseId = (await pool.query<{ id: string }>(`insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1, $2, $3, 'Feedback de atendimento', 'card antigo', 'P2', 'MONITORIA', '-', '-') returning id`, [V173_ORG, V173_COLLABORATOR, team])).rows[0]!.id
      created.cases.push(caseId)
      const id = (await pool.query<{ id: string }>(`insert into feedbacks (organization_id, case_id, operator_id, status, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, feedback_kind, context_snapshot, published_at) values ($1, $2, $3, 'PUBLISHED', $4, 'e', 'o', 'p', $5, 'MONITORING', $6, now()) returning id`, [V173_ORG, caseId, V173_COLLABORATOR, artifact.label, oldRecommendation, JSON.stringify(snapshot)])).rows[0]!.id
      created.feedbacks.push(id)
      return id
    }
    const feedbackId = await insert({ reliableFeedback: { artifactId: record.id, feedbackView: oldView, items: artifact.items.map(() => ({})) } })
    const clock = fixedClock("2026-09-29T13:00:00Z")
    const input = { organizationId: V173_ORG, feedbackId, reason: "prova", actorId: null, clock }

    const result = await reprojectPublishedFeedbackPresentation(pool, store, input)
    expect(result.changed).toBe(true)
    const row = (await pool.query("select recommendation, context_snapshot, (select summary from supervision_cases c where c.id = f.case_id) summary from feedbacks f where id = $1", [feedbackId])).rows[0]
    const view = row.context_snapshot.reliableFeedback.feedbackView
    expect(view.heading).toEqual({ title: "Contestação de cobrança", subtitle: "Atendimento de 28/09/2026" })
    expect(view.developments.map((detail: { title: string }) => detail.title)).toEqual(["Encerramento da chamada"])
    expect(JSON.stringify(view)).not.toContain("que é 7")
    expect(row.recommendation).not.toContain("que é 7")
    expect(row.summary).toBe(view.card)
    // O publicado antes não se perde.
    expect(row.context_snapshot.reliableFeedback.presentationRevisions).toEqual([expect.objectContaining({ reason: "prova", previous: expect.objectContaining({ recommendation: oldRecommendation, card: "card antigo" }) })])
    expect((await pool.query("select count(*)::int n from audit_logs where action = 'FEEDBACK_PRESENTATION_REPROJECTED' and entity_id = $1", [feedbackId])).rows[0].n).toBe(1)
    // O artefato e o diagnóstico não mudaram.
    expect(record.artifact!.items.length).toBe(artifact.items.length)

    // Idempotente: rodar de novo não muda nada nem audita de novo.
    expect((await reprojectPublishedFeedbackPresentation(pool, store, input)).changed).toBe(false)
    expect((await pool.query("select count(*)::int n from audit_logs where action = 'FEEDBACK_PRESENTATION_REPROJECTED' and entity_id = $1", [feedbackId])).rows[0].n).toBe(1)

    // Conjunto de pontos diferente do publicado → não é só apresentação → recusa. Feedback não V2 → recusa.
    const mismatch = await insert({ reliableFeedback: { artifactId: record.id, feedbackView: oldView, items: [{}] } })
    await expect(reprojectPublishedFeedbackPresentation(pool, store, { ...input, feedbackId: mismatch })).rejects.toThrow(/conjunto de pontos mudou/)
    const legacy = await insert({ reliableFeedback: { artifactId: record.id } })
    await expect(reprojectPublishedFeedbackPresentation(pool, store, { ...input, feedbackId: legacy })).rejects.toThrow(/formato V2/)
  })
})
