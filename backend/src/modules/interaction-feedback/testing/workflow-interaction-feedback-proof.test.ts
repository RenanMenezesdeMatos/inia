/**
 * PROVA contra o banco de TESTE real (V1.5.10): Workflow → "Gerar feedback de atendimento" → pipeline → política AUTÔNOMA
 * → varredor → Acompanhamento. Usa o MESMO processamento de matrícula do tick (`processEnrollment`, só sobre as matrículas
 * desta prova — nunca reivindica matrícula alheia do banco de teste) e o registro de gerações da migration 082.
 * ZERO chamada de modelo: o gateway e o redator são substituídos por falsos (respostas por estágio).
 * Dados COMMITADOS (concorrência entre conexões) e apagados no fim.
 *   INIA_DB_PROOF=1 npx vitest run workflow-interaction-feedback-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { FeedbackWriterInputV1 } from "../../investigation/domain/interaction-feedback-writer.js"
import { fakeSemanticReply, fakeWriter, SCENARIO_TRANSCRIPTS } from "./fake-semantic-model.js"

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, INIA_INTERACTION_FEEDBACK_PIPELINE: "ON", INIA_FEEDBACK_DELIVERY_POLICY: "AUTONOMOUS_V1" } }
})
const control = vi.hoisted(() => ({ writerFailsFor: new Set<string>(), gatewayFails: false, gatewayCalls: [] as { phase?: string; tags?: string[] }[] }))
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  return {
    ...original,
    generateForRoute: async (request: { classification?: { phase?: string; tags?: string[] }; contents?: { text: string }[] }) => {
      control.gatewayCalls.push({ ...request.classification })
      if (control.gatewayFails) { const error = new Error("provider indisponível (simulado)"); error.name = "PROVIDER_UNAVAILABLE"; throw error }
      const text = request.contents?.map((content) => content.text).join("\n") ?? ""
      return fakeSemanticReply(request, () => (text.includes("9876543210") ? "BLOCKED" : "CLEAR"))
    },
  }
})
vi.mock("../infrastructure/gemini-feedback-writer.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../infrastructure/gemini-feedback-writer.js")>()
  const base = fakeWriter()
  return { ...original, createGeminiFeedbackWriter: () => ({ async write(input: FeedbackWriterInputV1) { if ([...control.writerFailsFor].some((prefix) => input.interactionLabel.startsWith(prefix))) { const error = new Error("falha simulada"); error.name = "WRITER_TRANSPORT_ERROR"; throw error } return base.write(input) } }) }
})

const { env } = await import("../../../config/env.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { deliverReadyFeedbackItems } = await import("../application/deliver-feedback.js")
const { createPostgresFeedbackDeliveryStore } = await import("../infrastructure/postgres-feedback-delivery-store.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
const created = { people: [] as string[], interactions: [] as string[], workflows: [] as string[] }

type Claimed = Parameters<typeof processEnrollment>[1]
async function claimed(id: string): Promise<Claimed> {
  const result = await pool.query<Claimed>(
    `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
            we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id,
            w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
     from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
    [id],
  )
  return result.rows[0]!
}
const enrollmentState = async (id: string) => (await pool.query<{ status: string; current_node_id: string; attempts: number }>(`select status, current_node_id, attempts from workflow_enrollments where id = $1`, [id])).rows[0]!

describe.skipIf(!ENABLED)("Workflow → feedback de atendimento — prova Postgres (motor real, zero chamada de modelo)", () => {
  let org: string
  let operator: string
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    org = (await pool.query<{ id: string }>("select id from organizations limit 1")).rows[0]!.id
    operator = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Workflow Feedback Operador', 'OPERATOR') returning id", [org])).rows[0]!.id
    created.people.push(operator)
  })
  afterAll(async () => {
    if (!pool) return
    // Geração ↔ run se referenciam (run_id / generation_id): desfaz o vínculo antes de apagar (cascade pelo run apaga o resto).
    await pool.query("update interaction_feedback_generations set run_id = null where organization_id = $1 and collaborator_id = any($2::uuid[])", [org, created.people])
    await pool.query("delete from interaction_feedback_runs where organization_id = $1 and collaborator_id = any($2::uuid[])", [org, created.people])
    await pool.query("delete from interaction_feedback_generations where organization_id = $1 and collaborator_id = any($2::uuid[])", [org, created.people])
    await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [created.workflows]).catch(() => undefined)
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from transcripts where interaction_id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  const insertInteraction = async (startedAt: Date, transcript: string) => {
    const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'segunda_via',$3,$4,$5) returning id`, [org, operator, startedAt, new Date(startedAt.getTime() + 300_000), `PROOF-WF-FB-${startedAt.getTime()}-${Math.random()}`])).rows[0]!.id
    await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [org, id, transcript])
    created.interactions.push(id)
    return id
  }
  const insertWorkflow = async (name: string, trigger: Record<string, unknown>, interactionSource: Record<string, unknown>) => {
    const graph = {
      nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "gerar", type: "action", label: "Gerar feedback de atendimento", position: { x: 0, y: 1 }, config: { actionType: "GENERATE_INTERACTION_FEEDBACK", interactionSource } }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} }],
      edges: [{ id: "e1", source: "trigger", target: "gerar", sourceHandle: "always" }, { id: "e2", source: "gerar", target: "end", sourceHandle: "always" }],
    }
    const workflow = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1,$2,$3,$4) returning id`, [org, name, JSON.stringify(trigger), JSON.stringify(graph)])).rows[0]!.id
    created.workflows.push(workflow)
    const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [workflow, JSON.stringify(graph)])).rows[0]!.id
    return { workflow, version }
  }
  const enroll = async (wf: { workflow: string; version: string }, source: { interactionId?: string; subjectId?: string }) =>
    (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, scheduled_subject_id) values ($1,$2,$3,'gerar','active','2999-01-01',$4,$5) returning id`, [org, wf.workflow, wf.version, source.interactionId ?? null, source.subjectId ?? null])).rows[0]!.id
  const runsFor = async (interactionIds: string[]) => (await pool.query<{ id: string; interaction_id: string; generation_id: string; completed: boolean }>(`select id, interaction_id, generation_id, completed_at is not null completed from interaction_feedback_runs where interaction_id = any($1::uuid[])`, [interactionIds])).rows

  it("A/C/E/28) Agenda → amostra reproduzível persistida → AUTO_DELIVER → varredor entrega no Acompanhamento sem QA; retry não duplica; execução nova escolhe outras", async () => {
    // Interações do MÊS ANTERIOR (a janela MONTH do motor é o mês civil anterior, no fuso da organização).
    const now = new Date()
    const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 15))
    const interactions = await Promise.all([3, 5, 8, 12, 17].map((day) => insertInteraction(new Date(previousMonth.getTime() + (day - 1) * 86_400_000), SCENARIO_TRANSCRIPTS.CLEAR)))
    const wf = await insertWorkflow("Prova V1.5.10 · agenda", { kind: "schedule", mode: "CALENDAR", times: ["09:00"], intervalDays: 1, anchorDate: "2026-09-16" }, { kind: "COLLABORATOR_SAMPLE", period: "MONTH", sampleSize: 2, strategy: "DETERMINISTIC_SAMPLE" })
    const first = await enroll(wf, { subjectId: operator })
    control.gatewayCalls.length = 0
    await processEnrollment(pool, await claimed(first))
    expect(await enrollmentState(first)).toMatchObject({ status: "active", current_node_id: "end", attempts: 0 })
    // Planner ausente: só análise semântica (extração + síntese), uma dupla por interação.
    expect(control.gatewayCalls.map((call) => call.phase)).toEqual(Array(4).fill("SEMANTIC_ANALYSIS"))
    const generations = (await pool.query<{ interaction_id: string; status: string; selection_rank: number; enrollment_id: string; outcome: { dispositions: Record<string, number> } }>(`select interaction_id, status, selection_rank, enrollment_id, outcome from interaction_feedback_generations where workflow_id = $1 order by selection_rank`, [wf.workflow])).rows
    expect(generations.map((row) => [row.status, row.selection_rank, row.enrollment_id])).toEqual([["COMPLETED", 1, first], ["COMPLETED", 2, first]])
    expect(generations.every((row) => row.outcome.dispositions.AUTO_DELIVER === 1)).toBe(true)
    const selected = generations.map((row) => row.interaction_id)
    let runs = await runsFor(interactions)
    expect(runs).toHaveLength(2)
    expect(runs.every((run) => run.completed)).toBe(true)
    // AUTO_DELIVER: nenhuma revisão PENDING_REVIEW; o varredor existente entrega (AUTONOMOUS) exatamente uma vez.
    expect((await pool.query(`select review_status from interaction_feedback_item_reviews where run_id = any($1::uuid[])`, [runs.map((run) => run.id)])).rows).toEqual([{ review_status: "NOT_SELECTED_FOR_QA" }, { review_status: "NOT_SELECTED_FOR_QA" }])
    const deliveries = createPostgresFeedbackDeliveryStore(pool)
    const sweep = await deliverReadyFeedbackItems({ deliveries, now: () => new Date() })
    expect(sweep.delivered).toBeGreaterThanOrEqual(2)
    expect((await pool.query(`select delivery_mode, qa_status, collaborator_id from interaction_feedback_deliveries where run_id = any($1::uuid[])`, [runs.map((run) => run.id)])).rows).toEqual([{ delivery_mode: "AUTONOMOUS", qa_status: "NOT_SELECTED_FOR_QA", collaborator_id: operator }, { delivery_mode: "AUTONOMOUS", qa_status: "NOT_SELECTED_FOR_QA", collaborator_id: operator }])

    // C) retry da MESMA execução (a matrícula volta ao nó): mesma seleção, nenhum run novo, zero request de modelo.
    await pool.query(`update workflow_enrollments set current_node_id = 'gerar' where id = $1`, [first])
    control.gatewayCalls.length = 0
    await processEnrollment(pool, await claimed(first))
    expect(control.gatewayCalls).toHaveLength(0)
    expect(await runsFor(interactions)).toHaveLength(2)
    const retryOutput = (await pool.query<{ node_outputs: { gerar: { results: { interactionId: string; reused: boolean }[] } } }>(`select node_outputs from workflow_enrollments where id = $1`, [first])).rows[0]!.node_outputs.gerar
    expect(retryOutput.results.map((result) => [result.interactionId, result.reused])).toEqual(selected.map((id) => [id, true]))

    // 28) execução NOVA: outra semente, fora as já atendidas → outras 2 interações, 2 feedbacks novos.
    const second = await enroll(wf, { subjectId: operator })
    await processEnrollment(pool, await claimed(second))
    runs = await runsFor(interactions)
    expect(runs).toHaveLength(4)
    const secondSelection = (await pool.query<{ interaction_id: string }>(`select interaction_id from interaction_feedback_generations where enrollment_id = $1`, [second])).rows.map((row) => row.interaction_id)
    expect(secondSelection).toHaveLength(2)
    expect(secondSelection.some((id) => selected.includes(id))).toBe(false)
  })

  it("B/G/F/D) Flag: a interação do gatilho; BLOCKED sem QA nem entrega; HOLD_FOR_QA na fila sem prender o Workflow; concorrência = um feedback", async () => {
    const wf = await insertWorkflow("Prova V1.5.10 · flag", { kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000000" }, { kind: "TRIGGER_INTERACTION" })
    // G) BLOCKED: evidência só com número longo — resultado funcional, sem QA e sem entrega.
    const blockedInteraction = await insertInteraction(new Date("2026-03-10T14:00:00Z"), SCENARIO_TRANSCRIPTS.BLOCKED)
    const blockedEnrollment = await enroll(wf, { interactionId: blockedInteraction })
    await processEnrollment(pool, await claimed(blockedEnrollment))
    expect(await enrollmentState(blockedEnrollment)).toMatchObject({ current_node_id: "end", attempts: 0 })
    const [blockedRun] = await runsFor([blockedInteraction])
    expect((await pool.query(`select disposition, reasons, item_review_id from interaction_feedback_delivery_decisions where run_id = $1`, [blockedRun!.id])).rows).toEqual([{ disposition: "BLOCKED", reasons: ["INSUFFICIENT_DISPLAY_EVIDENCE"], item_review_id: null }])
    expect((await pool.query(`select 1 from interaction_feedback_item_reviews where run_id = $1`, [blockedRun!.id])).rowCount).toBe(0)

    // F) HOLD_FOR_QA: o redator falha → fallback → item na fila de QA; a matrícula AVANÇA (o Workflow não espera o QA).
    const holdInteraction = await insertInteraction(new Date("2026-03-11T14:00:00Z"), SCENARIO_TRANSCRIPTS.CLEAR)
    control.writerFailsFor.add("Atendimento de 11/03/2026")
    const holdEnrollment = await enroll(wf, { interactionId: holdInteraction })
    await processEnrollment(pool, await claimed(holdEnrollment))
    control.writerFailsFor.clear()
    expect(await enrollmentState(holdEnrollment)).toMatchObject({ status: "active", current_node_id: "end" })
    const [holdRun] = await runsFor([holdInteraction])
    expect((await pool.query(`select d.disposition, r.review_status from interaction_feedback_delivery_decisions d join interaction_feedback_item_reviews r on r.id = d.item_review_id where d.run_id = $1`, [holdRun!.id])).rows).toEqual([{ disposition: "HOLD_FOR_QA", review_status: "PENDING_REVIEW" }])
    await deliverReadyFeedbackItems({ deliveries: createPostgresFeedbackDeliveryStore(pool), now: () => new Date() })
    expect((await pool.query(`select 1 from interaction_feedback_deliveries where run_id = any($1::uuid[])`, [[blockedRun!.id, holdRun!.id]])).rowCount).toBe(0)

    // D) duas matrículas CONCORRENTES do mesmo disparo (a mesma flag da mesma interação) → exatamente UM feedback.
    const shared = await insertInteraction(new Date("2026-03-12T14:00:00Z"), SCENARIO_TRANSCRIPTS.CLEAR)
    const [a, b] = await Promise.all([enroll(wf, { interactionId: shared }), enroll(wf, { interactionId: shared })])
    await Promise.all([processEnrollment(pool, await claimed(a!)), processEnrollment(pool, await claimed(b!))])
    // Quem perdeu a corrida recebeu IN_PROGRESS (retry do motor) ou já reaproveitou; uma nova tentativa conclui.
    for (const id of [a!, b!]) if ((await enrollmentState(id)).current_node_id !== "end") await processEnrollment(pool, await claimed(id))
    expect((await enrollmentState(a!)).current_node_id).toBe("end")
    expect((await enrollmentState(b!)).current_node_id).toBe("end")
    expect(await runsFor([shared])).toHaveLength(1)
    expect((await pool.query(`select count(*)::int n from interaction_feedback_generations where interaction_id = $1`, [shared])).rows[0]).toEqual({ n: 1 })
  })

  it("H) falha técnica → mecanismo normal do motor (node_failed, tentativa contada, geração FAILED); a próxima tentativa conclui", async () => {
    const wf = await insertWorkflow("Prova V1.5.10 · falha", { kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000000" }, { kind: "TRIGGER_INTERACTION" })
    const interaction = await insertInteraction(new Date("2026-03-13T14:00:00Z"), SCENARIO_TRANSCRIPTS.CLEAR)
    const enrollment = await enroll(wf, { interactionId: interaction })
    control.gatewayFails = true
    await processEnrollment(pool, await claimed(enrollment))
    control.gatewayFails = false
    expect(await enrollmentState(enrollment)).toMatchObject({ status: "active", current_node_id: "gerar", attempts: 1 })
    expect((await pool.query(`select event_type from workflow_enrollment_events where enrollment_id = $1`, [enrollment])).rows).toEqual([{ event_type: "node_failed" }])
    expect((await pool.query(`select status, last_error from interaction_feedback_generations where interaction_id = $1`, [interaction])).rows).toEqual([{ status: "FAILED", last_error: "PROVIDER_UNAVAILABLE" }])
    expect(await runsFor([interaction])).toHaveLength(0)
    await processEnrollment(pool, await claimed(enrollment))
    expect(await enrollmentState(enrollment)).toMatchObject({ current_node_id: "end" })
    expect(await runsFor([interaction])).toHaveLength(1)
  })
})
