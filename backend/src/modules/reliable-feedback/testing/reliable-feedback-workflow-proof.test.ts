/**
 * PROVA contra o banco de TESTE real (V1.5.12): Workflow → "Chamar agente" (Agent configurável, execução REAL do runAgent)
 * → "Gerar feedback" (camada de confiabilidade) → [QA de exceção] → Output FOLLOW_UP/O próprio operador → Acompanhamento.
 * Usa o MESMO processamento de matrícula do tick (`processEnrollment`, só sobre as matrículas desta prova). ZERO chamada
 * de modelo: o gateway responde por propósito (Agent = AGENT_SYNTHESIS; redator = FEEDBACK_WRITING). Dados COMMITADOS
 * (concorrência entre conexões) e apagados no fim.
 *   INIA_DB_PROOF=1 npx vitest run reliable-feedback-workflow-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { reply } from "../../interaction-feedback/testing/fake-semantic-model.js"

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, INIA_INTERACTION_FEEDBACK_PIPELINE: "ON", INIA_FEEDBACK_DELIVERY_POLICY: "AUTONOMOUS_V1" } }
})
const control = vi.hoisted(() => ({
  calls: [] as string[],
  /** V1.6.1 — o texto que o Agent recebeu (prova de que só a amostra, por handle, entra no prompt). */
  agentPrompts: [] as string[],
  /** V1.7.1n — prompt completo (sistema + turno) da última chamada do Agent: o modelo "copia" o código [CP-…] da etapa. */
  lastAgentPrompt: "",
  release: false,
  agentReply: (() => ({})) as () => unknown,
  writerWording: (() => ({ observed: "", whyItMatters: "", whatYouCanDo: "" })) as (item: Record<string, unknown>) => { observed: string; whyItMatters: string; whatYouCanDo: string },
  /** Feedback por Flag V2 — resposta do redator da NARRATIVA de supervisor (monitoria de processo). */
  narrativeReply: null as null | { sentences: { paragraph: number; text: string; stance: string; refs: string[] }[]; card?: { text: string; refs: string[] } },
}))
/** V1.7.1n — como o modelo real: o código [CP-…] que o sistema marcou antes do texto da etapa no prompt (sem código = contrato V2). */
const checkpointRefFor = (text: string): { checkpointRef?: string } => {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const found = new RegExp(`\\[(CP-[0-9a-f]{10})[^\\]]*\\]\\s*${escaped}`).exec(control.lastAgentPrompt)
  return found ? { checkpointRef: found[1]! } : {}
}
// V1.5.12a: a AUTONOMOUS_V1 REAL libera os tipos (claro/seguro segue). `release = false` troca pela PILOT_V1 (tudo em QA),
// só para provar o caminho do QA de exceção com o motor real.
vi.mock("../domain/reliable-feedback-item.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../domain/reliable-feedback-item.js")>()
  return { ...original, RELIABLE_FEEDBACK_POLICIES: { PILOT_V1: original.RELIABLE_FEEDBACK_PILOT_POLICY, get AUTONOMOUS_V1() { return control.release ? original.RELIABLE_FEEDBACK_AUTONOMOUS_POLICY : original.RELIABLE_FEEDBACK_PILOT_POLICY } } }
})
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  return {
    ...original,
    generateForRoute: async (request: { classification?: { purpose?: string; phase?: string; tags?: string[] }; contents?: { text: string }[]; systemPrompt?: string }) => {
      // Feedback por Flag V2 — o redator da narrativa usa a MESMA rota do redator (FEEDBACK_WRITING), com a etapa na tag.
      if (request.classification?.tags?.includes("stage:SUPERVISOR_NARRATIVE")) {
        control.calls.push("SUPERVISOR_NARRATIVE")
        return reply(control.narrativeReply ?? { sentences: [] })
      }
      // V2.1 — a verificação semântica da composição (modelo fixo, tag própria): aqui, tudo sustentado.
      if (request.classification?.tags?.includes("stage:NARRATIVE_FACTUALITY")) {
        control.calls.push("NARRATIVE_FACTUALITY")
        const text = request.contents?.[0]?.text ?? ""
        const payload = JSON.parse(text.slice(text.indexOf("\n") + 1)) as { claims: { id: string }[] }
        return reply({ claims: payload.claims.map((claim) => ({ id: claim.id, status: "SUPPORTED", unsupportedMeaning: null, reason: "prova" })) })
      }
      const purpose = request.classification?.purpose ?? "?"
      control.calls.push(purpose)
      if (purpose === "FEEDBACK_WRITING") {
        const text = request.contents?.[0]?.text ?? ""
        const payload = JSON.parse(text.slice(text.indexOf("\n") + 1)) as { items: (Record<string, unknown> & { itemRef: string })[] }
        return reply({ items: payload.items.map((item) => ({ itemRef: item.itemRef, ...control.writerWording(item) })) })
      }
      if (purpose === "AGENT_SYNTHESIS") {
        control.agentPrompts.push((request.contents ?? []).map((content) => content.text).join("\n"))
        control.lastAgentPrompt = [request.systemPrompt ?? "", ...(request.contents ?? []).map((content) => content.text)].join("\n")
        return reply(control.agentReply())
      }
      throw new Error(`request inesperada na prova: ${purpose} (${request.classification?.phase})`)
    },
  }
})

const { env } = await import("../../../config/env.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { createPostgresReliableFeedbackStore } = await import("../infrastructure/postgres-reliable-feedback-store.js")
const { publishReliableFeedbackToFollowUp } = await import("../infrastructure/publish-reliable-feedback.js")
const { decideReliableReview } = await import("../application/decide-reliable-review.js")
const { createPostgresFeedbackReviewReader } = await import("../../interaction-feedback/infrastructure/postgres-feedback-review-reader.js")
const { fetchOperatorFeedbacks } = await import("../../reporting/application/fetch-operator-overview.js")

void process.env.INIA_DB_PROOF
// run-agent.ts ainda fixa a organização (dívida registrada na auditoria) — a prova usa a mesma, sem propagar a dívida.
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], interactions: [] as string[], workflows: [] as string[], agents: [] as string[], indicators: [] as string[], measurements: [] as string[], goals: [] as string[], accounts: [] as string[], documents: [] as string[] }

type Claimed = Parameters<typeof processEnrollment>[1]
async function claimed(id: string): Promise<Claimed> {
  return (await pool.query<Claimed>(
    `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
            we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id,
            w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
     from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
    [id],
  )).rows[0]!
}
const state = async (id: string) => (await pool.query<{ status: string; current_node_id: string; attempts: number; next_eval_at: Date }>(`select status, current_node_id, attempts, next_eval_at from workflow_enrollments where id = $1`, [id])).rows[0]!
/** Processa a matrícula nó a nó (como ticks sucessivos) até concluir ou parar de andar. */
async function drive(id: string, maxSteps = 8) {
  for (let step = 0; step < maxSteps; step += 1) {
    const before = await state(id)
    if (before.status === "completed" || before.status === "dead" || (before.status === "waiting" && before.next_eval_at > new Date("2100-01-01"))) return before
    await processEnrollment(pool, await claimed(id))
    const after = await state(id)
    if (after.attempts > before.attempts) throw new Error(`nó ${before.current_node_id} falhou: ${JSON.stringify((await pool.query(`select payload from workflow_enrollment_events where enrollment_id = $1 and event_type in ('node_failed','flow_dead') order by created_at desc limit 1`, [id])).rows[0])}`)
  }
  return state(id)
}

// APOSENTADA (motor de feedback FEEDBACK_ENGINE_V1): o nó "Gerar feedback" do Workflow não usa mais a camada confiável nem o QA
// de exceção — a prova equivalente do caminho atual é `feedback-engine/testing/feedback-engine-workflow-proof.test.ts`. Mantida
// como histórico até a remoção explícita do arquivo.
describe.skip("V1.5.12 — Workflow → Agent → Gerar feedback → Output: prova Postgres (motor real, zero chamada de modelo)", () => {
  let operator: string
  let team: string
  let qaPerson: string
  let agentA: string
  let agentB: string
  const TRANSCRIPT = ["CLIENTE: Oi, quero saber quando chega a segunda via da fatura.", "OPERADOR: Vou verificar aqui, aguarde um momento.", "OPERADOR: A segunda via chega em até cinco dias úteis.", "CLIENTE: Tá, mas você não me disse por onde vou receber."].join("\n")
  const OPERATOR_QUOTE = "Vou verificar aqui, aguarde um momento."
  const monitoringAgentReply = (evidenceFound = OPERATOR_QUOTE) => ({ title: "Espera sem explicação", summary: "O operador pediu espera sem explicar.", impactedIndicator: "rechamada", evidenceFound, observedBehavior: "pediu para o cliente aguardar sem explicar o que ia verificar", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Explique o que você vai verificar antes de pedir para o cliente aguardar." })
  const monitoringWording = () => ({ observed: "Nesta interação você pediu para o cliente aguardar enquanto verificava a informação.", whyItMatters: "", whatYouCanDo: "" }) // V1.6.0: sem regra da base, só o fato

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    operator = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Proof Reliable Operadora', 'OPERATOR', $2) returning id", [ORG, team])).rows[0]!.id
    qaPerson = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Reliable QA', 'ADMIN') returning id", [ORG])).rows[0]!.id
    created.people.push(operator, qaPerson)
    const account = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id", [ORG, qaPerson, `proof-reliable-qa-${Date.now()}@inia.local`])).rows[0]!.id
    created.accounts.push(account)
    await pool.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1,$2,'QA_DE_FEEDBACK','ORGANIZATION',now())", [ORG, account])
    const agent = async (name: string) => (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,$2,'CALL_FEEDBACK','Dar feedback de atendimento','Prova V1.5.12','Analise a chamada e aponte um ponto de desenvolvimento.') returning id`, [ORG, name])).rows[0]!.id
    agentA = await agent("Proof Reliable · Agent A")
    agentB = await agent("Proof Reliable · Agent B")
    created.agents.push(agentA, agentB)
  })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from workflow_output_emissions where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    const feedbackIds = (await pool.query<{ id: string; case_id: string }>("select id, case_id from feedbacks where operator_id = $1", [operator])).rows
    await pool.query("delete from case_timeline_events where case_id = any($1::uuid[])", [feedbackIds.map((row) => row.case_id)])
    await pool.query("delete from feedbacks where operator_id = $1", [operator])
    await pool.query("delete from evidences where case_id = any($1::uuid[])", [feedbackIds.map((row) => row.case_id)])
    await pool.query("delete from supervision_cases where operator_id = $1", [operator])
    await pool.query("delete from reliable_feedback_artifacts where collaborator_id = $1", [operator])
    await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from agent_runs where agent_id = any($1::uuid[])", [created.agents])
    await pool.query("delete from agents where id = any($1::uuid[])", [created.agents])
    await pool.query("delete from goals where id = any($1::uuid[])", [created.goals])
    await pool.query("delete from knowledge_versions where document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_documents where id = any($1::uuid[])", [created.documents])
    await pool.query("delete from indicator_measurements where id = any($1::uuid[])", [created.measurements])
    await pool.query("delete from indicator_definitions where id = any($1::uuid[])", [created.indicators])
    await pool.query("delete from transcripts where interaction_id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from access_role_assignments where user_account_id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from user_accounts where id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from audit_logs where entity_type = 'indicator_diagnostic_strategy' and actor_id = any($1::uuid[])", [created.people])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  const insertInteraction = async (startedAt: Date, transcript = TRANSCRIPT) => {
    const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'segunda_via',$3,$4,$5) returning id`, [ORG, operator, startedAt, new Date(startedAt.getTime() + 300_000), `PROOF-RELIABLE-${startedAt.getTime()}-${Math.random()}`])).rows[0]!.id
    await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, id, transcript])
    created.interactions.push(id)
    return id
  }
  const insertWorkflow = async (name: string, trigger: Record<string, unknown>, agentId: string, options: { withOutput?: boolean; outputContract?: string } = {}) => {
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
        { id: "agent", type: "action", label: "Especialista", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId, ...(options.outputContract ? { outputContract: options.outputContract } : {}) } },
        { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 2 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
        { id: "output", type: "output", label: "Feedback ao operador", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: "always" }, { id: "e2", source: "agent", target: "feedback", sourceHandle: "always" }, { id: "e3", source: "feedback", target: "output", sourceHandle: "always" }, { id: "e4", source: "output", target: "end", sourceHandle: "always" }],
    }
    if (options.withOutput === false) graph.nodes.splice(3, 1)
    const workflow = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1,$2,$3,$4) returning id`, [ORG, name, JSON.stringify(trigger), JSON.stringify(graph)])).rows[0]!.id
    created.workflows.push(workflow)
    const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [workflow, JSON.stringify(graph)])).rows[0]!.id
    return { workflow, version }
  }
  const enroll = async (wf: { workflow: string; version: string }, source: { interactionId?: string; measurementId?: string; strategyVersionId?: string }) =>
    (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, indicator_measurement_id, matched_flag_name, matched_value_boolean, matched_value_numeric, indicator_diagnostic_strategy_version_id) values ($1,$2,$3,'trigger','active','2999-01-01',$4,$5,$6,$7,$8,$9) returning id`, [ORG, wf.workflow, wf.version, source.interactionId ?? null, source.measurementId ?? null, source.interactionId ? "rechamada" : null, source.interactionId ? true : null, source.measurementId ? "420" : null, source.strategyVersionId ?? null])).rows[0]!.id
  const feedbacksOf = async () => (await pool.query<{ id: string; feedback_kind: string; status: string; impacted_indicator: string; evidence_found: string; recommendation: string; context_snapshot: { reliableFeedback?: { artifactId: string; domain: string; sourceNodeId: string } } }>("select id, feedback_kind, status, impacted_indicator, evidence_found, recommendation, context_snapshot from feedbacks where operator_id = $1 order by created_at", [operator])).rows
  const FLAG_TRIGGER = { kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000000" }

  it("37/43) MONITORIA READY: Agent A usado, sem Fase A/B, redator 1×, Output 1× → Acompanhamento; retry do nó e do Output não duplicam", async () => {
    control.release = true
    control.agentReply = () => monitoringAgentReply()
    control.writerWording = monitoringWording
    control.calls.length = 0
    const interaction = await insertInteraction(new Date("2026-09-14T13:00:00Z"))
    const wf = await insertWorkflow("Prova V1.5.12 · monitoria", FLAG_TRIGGER, agentA)
    const enrollment = await enroll(wf, { interactionId: interaction })
    expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end", attempts: 0 })
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", "FEEDBACK_WRITING"])
    expect((await pool.query("select agent_id from agent_runs where agent_id = any($1::uuid[])", [[agentA, agentB]])).rows).toEqual([{ agent_id: agentA }])
    const artifacts = (await pool.query<{ id: string; disposition: string; domain: string; source_type: string; normalized_input: { provenance: { agentId: string } } }>("select id, disposition, domain, source_type, normalized_input from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows
    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({ disposition: "READY", domain: "MONITORING", source_type: "AGENT" })
    expect(artifacts[0]!.normalized_input.provenance.agentId).toBe(agentA)
    let feedbacks = await feedbacksOf()
    expect(feedbacks).toHaveLength(1)
    expect(feedbacks[0]).toMatchObject({ feedback_kind: "MONITORING", status: "PUBLISHED" })
    expect(feedbacks[0]!.evidence_found).toContain(OPERATOR_QUOTE)
    expect(feedbacks[0]!.recommendation).toContain("Nesta interação você pediu para o cliente aguardar")
    expect(feedbacks[0]!.recommendation).not.toContain("O que fazer")
    expect(feedbacks[0]!.context_snapshot.reliableFeedback).toMatchObject({ artifactId: artifacts[0]!.id, domain: "MONITORING", sourceNodeId: "agent" })
    // Acompanhamento do colaborador (o MESMO leitor do feed): o feedback aparece; ciência disponível (PUBLISHED).
    const feed = await fetchOperatorFeedbacks(pool, ORG, operator, { personId: operator })
    expect(feed.map((row) => row.id)).toContain(feedbacks[0]!.id)
    expect((await pool.query("select count(*)::int n from workflow_output_emissions where enrollment_id = $1", [enrollment])).rows[0]).toEqual({ n: 1 })

    // Retry depois do Agent/Writer: volta ao nó "Gerar feedback" → reaproveita o artefato, ZERO request de modelo.
    await pool.query("update workflow_enrollments set status = 'active', current_node_id = 'feedback' where id = $1", [enrollment])
    control.calls.length = 0
    await drive(enrollment)
    expect(control.calls).toEqual([])
    expect(await feedbacksOf()).toHaveLength(1)
    // Retry do Output e publicação CONCORRENTE do mesmo nó Output: exatamente uma emissão.
    const store = createPostgresReliableFeedbackStore(pool)
    const concurrent = await Promise.all([1, 2, 3].map(() => publishReliableFeedbackToFollowUp(pool, store, { organizationId: ORG, enrollmentId: enrollment, nodeId: "output", recipientId: operator, artifactId: artifacts[0]!.id })))
    expect(new Set(concurrent.map((entry) => entry.feedbackId)).size).toBe(1)
    expect(concurrent.every((entry) => entry.reused)).toBe(true)
    feedbacks = await feedbacksOf()
    expect(feedbacks).toHaveLength(1)
  })

  it("38) Agent configurável: o mesmo desenho com o Agent B usa o Agent B", async () => {
    control.release = true
    control.agentReply = () => monitoringAgentReply()
    const interaction = await insertInteraction(new Date("2026-09-15T13:00:00Z"))
    const wf = await insertWorkflow("Prova V1.5.12 · agent B", FLAG_TRIGGER, agentB)
    const enrollment = await enroll(wf, { interactionId: interaction })
    await drive(enrollment)
    expect((await pool.query("select agent_id from agent_runs where agent_id = $1", [agentB])).rowCount).toBe(1)
    const artifact = (await pool.query<{ normalized_input: { provenance: { agentId: string } } }>("select normalized_input from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows[0]!
    expect(artifact.normalized_input.provenance.agentId).toBe(agentB)
  })

  it("41) QA: HOLD_FOR_QA → matrícula esperando e zero Output; fila do QA (leitor Postgres) mostra o item; aprovar → reativa → Output 1×; rejeitar → encerra sem Output", async () => {
    control.release = false
    control.agentReply = () => monitoringAgentReply()
    control.writerWording = monitoringWording
    const store = createPostgresReliableFeedbackStore(pool)
    const reader = createPostgresFeedbackReviewReader(pool)
    const before = (await feedbacksOf()).length

    // A/B) aprovar
    const approvedInteraction = await insertInteraction(new Date("2026-09-16T13:00:00Z"))
    const wf = await insertWorkflow("Prova V1.5.12 · QA", FLAG_TRIGGER, agentA)
    const approvedEnrollment = await enroll(wf, { interactionId: approvedInteraction })
    expect(await drive(approvedEnrollment)).toMatchObject({ status: "waiting", current_node_id: "feedback" })
    expect((await feedbacksOf()).length).toBe(before)
    expect((await pool.query("select count(*)::int n from workflow_output_emissions where enrollment_id = $1", [approvedEnrollment])).rows[0]).toEqual({ n: 0 })
    const queue = await reader.listQueue({ organizationId: ORG, personId: qaPerson }, { status: "PENDING_REVIEW", collaboratorId: operator, page: 1, pageSize: 50 })
    const pending = queue.rows.filter((row) => row.record.origin === "WORKFLOW")
    expect(pending.length).toBeGreaterThanOrEqual(1)
    const artifactId = (await pool.query<{ id: string }>("select id from reliable_feedback_artifacts where enrollment_id = $1", [approvedEnrollment])).rows[0]!.id
    const reviewId = (await pool.query<{ id: string }>("select id from reliable_feedback_item_reviews where artifact_id = $1", [artifactId])).rows[0]!.id
    expect(pending.map((row) => row.record.id)).toContain(reviewId)
    const scoped = await reader.loadInScope({ organizationId: ORG, personId: qaPerson }, reviewId)
    expect(scoped).toMatchObject({ origin: "WORKFLOW" })
    // V1.7.1e — o QA recebe a análise inteira (artefato + todas as revisões) para a prévia do feedback completo.
    if (scoped?.origin !== "WORKFLOW") throw new Error("esperava revisão do Workflow")
    expect(scoped.analysis?.reviews.map((review) => review.id)).toContain(reviewId)
    expect(scoped.analysis?.artifact.items.length).toBeGreaterThanOrEqual(1)
    // Quem não tem o papel de QA não vê (escopo por atribuição, nunca por cargo).
    expect(await reader.loadInScope({ organizationId: ORG, personId: operator }, reviewId)).toBeNull()
    const decided = await decideReliableReview({ store, now: () => new Date() }, { organizationId: ORG, reviewId, reviewerId: qaPerson, decision: "APPROVED_UNCHANGED" })
    expect(decided).toMatchObject({ ok: true, resolution: { disposition: "READY", reactivated: true } })
    expect(await state(approvedEnrollment)).toMatchObject({ status: "active", current_node_id: "feedback" })
    control.calls.length = 0
    expect(await drive(approvedEnrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    expect(control.calls).toEqual([])
    expect((await feedbacksOf()).length).toBe(before + 1)
    expect((await pool.query("select count(*)::int n from workflow_output_emissions where enrollment_id = $1", [approvedEnrollment])).rows[0]).toEqual({ n: 1 })

    // D) rejeitar
    const rejectedInteraction = await insertInteraction(new Date("2026-09-17T13:00:00Z"))
    const rejectedEnrollment = await enroll(wf, { interactionId: rejectedInteraction })
    await drive(rejectedEnrollment)
    const rejectedArtifact = (await pool.query<{ id: string }>("select id from reliable_feedback_artifacts where enrollment_id = $1", [rejectedEnrollment])).rows[0]!.id
    const rejectedReview = (await pool.query<{ id: string }>("select id from reliable_feedback_item_reviews where artifact_id = $1", [rejectedArtifact])).rows[0]!.id
    expect(await decideReliableReview({ store, now: () => new Date() }, { organizationId: ORG, reviewId: rejectedReview, reviewerId: qaPerson, decision: "REJECTED", reasonCategory: "WRONG_FOCUS" })).toMatchObject({ ok: true, resolution: { disposition: "REJECTED", reactivated: true } })
    expect(await drive(rejectedEnrollment)).toMatchObject({ status: "completed", current_node_id: "feedback" })
    expect((await feedbacksOf()).length).toBe(before + 1)
    expect((await pool.query("select count(*)::int n from workflow_output_emissions where enrollment_id = $1", [rejectedEnrollment])).rows[0]).toEqual({ n: 0 })
  })

  it("41E) BLOCKED: evidência só do cliente (sinal ≠ causa) → nunca emitido, sem QA; a matrícula encerra sem Output", async () => {
    control.release = true
    control.agentReply = () => monitoringAgentReply("Tá, mas você não me disse por onde vou receber.")
    control.calls.length = 0
    const interaction = await insertInteraction(new Date("2026-09-18T13:00:00Z"))
    const wf = await insertWorkflow("Prova V1.5.12 · bloqueado", FLAG_TRIGGER, agentA)
    const enrollment = await enroll(wf, { interactionId: interaction })
    const before = (await feedbacksOf()).length
    expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "feedback" })
    expect(control.calls).toEqual(["AGENT_SYNTHESIS"])
    const artifact = (await pool.query<{ id: string; disposition: string }>("select id, disposition from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows[0]!
    expect(artifact.disposition).toBe("BLOCKED")
    expect((await pool.query("select 1 from reliable_feedback_item_reviews where artifact_id = $1", [artifact.id])).rowCount).toBe(0)
    expect((await feedbacksOf()).length).toBe(before)
  })

  it("40) INDICADOR READY por Agent: valores canônicos do sistema no Acompanhamento; texto do redator que recalcula cai no fallback canônico", async () => {
    control.release = true
    const indicator = (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1,$2,'TMA Prova','SECONDS','LOWER') returning id`, [ORG, `PROOF_TMA_${Date.now()}`])).rows[0]!.id
    created.indicators.push(indicator)
    const code = (await pool.query<{ code: string }>("select code from indicator_definitions where id = $1", [indicator])).rows[0]!.code
    created.goals.push((await pool.query<{ id: string }>("insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1,$2,'PERSON',$3,400,'2026-01-01') returning id", [ORG, indicator, operator])).rows[0]!.id)
    const measure = async (start: string, end: string) => {
      const id = (await pool.query<{ id: string }>("insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1,$2,'PERSON',$3,420,$4,$5,'PROOF','MONTHLY') returning id", [ORG, indicator, operator, start, end])).rows[0]!.id
      created.measurements.push(id)
      return id
    }
    const wf = await insertWorkflow("Prova V1.5.12 · indicador", { kind: "indicator", indicatorCode: code }, agentA)
    control.agentReply = () => ({ title: "TMA fora da meta", summary: "Seu TMA ficou acima da meta no período.", relatedProcedure: "Nenhum procedimento específico cadastrado", recommendation: "Reveja o tempo de pausas entre as etapas do atendimento." })
    control.writerWording = (item) => ({ observed: `No período de ${(item.officialData as { period: string }).period}, seu TMA Prova foi 420 s, fora da meta de 400 s.`, whyItMatters: "", whatYouCanDo: "" })
    control.calls.length = 0
    const ready = await enroll(wf, { measurementId: await measure("2026-08-01T03:00:00Z", "2026-09-01T03:00:00Z") })
    const before = (await feedbacksOf()).length
    expect(await drive(ready)).toMatchObject({ status: "completed", current_node_id: "end" })
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", "FEEDBACK_WRITING"])
    const feedbacks = await feedbacksOf()
    expect(feedbacks).toHaveLength(before + 1)
    const published = feedbacks.at(-1)!
    expect(published).toMatchObject({ feedback_kind: "INDICATOR", status: "PUBLISHED", impacted_indicator: "TMA Prova" })
    expect(published.evidence_found).toContain("TMA Prova no período 01/08/2026 a 31/08/2026: 420 s")
    expect(published.evidence_found).toContain("Meta vigente: 400 s")
    const canonical = (await pool.query<{ canonical_context: { measurement: { value: number }; target: { value: number; source: string }; withinTarget: boolean } }>("select canonical_context from reliable_feedback_artifacts where enrollment_id = $1", [ready])).rows[0]!.canonical_context
    expect(canonical).toMatchObject({ measurement: { value: 420 }, target: { value: 400, source: "PERSON" }, withinTarget: false })

    // O redator "recalcula" (6,9 minutos / 25 s acima): validador canônico → fallback → QA; o valor oficial não muda.
    // (20 s seria a distância CANÔNICA 420 × 400 e 7 é o mês do período — ambos sustentados desde a V1.5.12a.)
    control.writerWording = () => ({ observed: "Seu TMA Prova foi de 6,9 minutos, 25 s acima da meta.", whyItMatters: "x", whatYouCanDo: "y" })
    const recalculated = await enroll(wf, { measurementId: await measure("2026-07-01T03:00:00Z", "2026-08-01T03:00:00Z") })
    expect(await drive(recalculated)).toMatchObject({ status: "waiting", current_node_id: "feedback" })
    const review = (await pool.query<{ wording_source: string; writer_violations: string[]; proposed_wording: { observed: string } }>("select r.wording_source, r.writer_violations, r.proposed_wording from reliable_feedback_item_reviews r join reliable_feedback_artifacts a on a.id = r.artifact_id where a.enrollment_id = $1", [recalculated])).rows[0]!
    expect(review.wording_source).toBe("FALLBACK")
    expect(review.writer_violations).toContain("UNSUPPORTED_NUMBER")
    expect(review.proposed_wording.observed).toBe("No período de 01/07/2026 a 31/07/2026, o resultado oficial de TMA Prova foi 420 s, fora da meta de 400 s (quanto menor, melhor).")
  })

  it("V1.6.0) AVALIAÇÃO DE PROCESSO: runAgent real recupera a base → etapa verificada contra a versão PUBLICADA → Ponto forte no Acompanhamento com Material de apoio e procedimento real", async () => {
    control.release = true
    control.calls.length = 0
    const TITLE = `Prova V1.6.0 · Prazo da Segunda Via ${Date.now()}`
    const RULE = "Informe ao cliente que a segunda via chega em até cinco dias úteis."
    const document = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,$2,'PROCEDURE','TEXT') returning id", [ORG, TITLE])).rows[0]!.id
    created.documents.push(document)
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1,$2,1,$3,'PUBLISHED',$4)", [ORG, document, `## Prazo\n${RULE}\n\n## Canal\nConfirme o canal de envio escolhido pelo cliente.`, `proof-v160-${document}`])
    await pool.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1,'ALL_TEAMS')", [document])
    const agent = (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,'Proof Reliable · Agent Processo','CALL_FEEDBACK','Avaliar processo','Prova V1.6.0','Avalie o processo.') returning id`, [ORG])).rows[0]!.id
    created.agents.push(agent)
    await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agent, document])
    const QUOTE = "A segunda via chega em até cinco dias úteis."
    control.agentReply = () => ({ ...monitoringAgentReply(QUOTE), processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: [
      { ...checkpointRefFor(RULE), requirement: "Informar o prazo da segunda via", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [QUOTE], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: "Continue informando o prazo." }, uncertainty: null, conductEvidence: { role: "INFORMATION_PROVIDED", relation: "EQUIVALENT" } },
      { ...checkpointRefFor("Confirme o canal de envio escolhido pelo cliente."), requirement: "Confirmar o canal de envio", status: "NOT_OBSERVABLE", transcriptEvidence: [], knowledgeQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: "a chamada não mostra a confirmação" },
    ] }] } })
    control.writerWording = () => ({ observed: "Nesta interação você informou que a segunda via chega em até cinco dias úteis.", whyItMatters: "", whatYouCanDo: "" })
    // FEEDBACK EXPERIENCE V2 — composição V7: frases com vínculo (a força S1 é a única do assessment) + card curto com a ref da força.
    control.narrativeReply = { sentences: [{ paragraph: 1, text: "Você conduziu bem este atendimento: informou ao cliente que a segunda via chega em até cinco dias úteis.", stance: "STRENGTH", refs: ["S1"] }, { paragraph: 2, text: "Mantenha essa forma de conduzir nas próximas chamadas.", stance: "STRENGTH", refs: ["S1"] }], card: { text: "Boa informação do prazo da segunda via.", refs: ["S1"] } }
    const interaction = await insertInteraction(new Date("2026-09-15T13:00:00Z"))
    const wf = await insertWorkflow("Prova V1.6.0 · avaliação de processo", FLAG_TRIGGER, agent, { outputContract: "PROCESS_ASSESSMENT" })
    const before = (await feedbacksOf()).length
    const enrollment = await enroll(wf, { interactionId: interaction })
    expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    // MONITORING V2 (fase 4) — contrato V5: especialista + UM redator (composição). O redator de itens não é chamado.
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", "SUPERVISOR_NARRATIVE", "NARRATIVE_FACTUALITY"])
    const artifact = (await pool.query<{ disposition: string; artifact: { items: { kind: string; knowledge: { documentId: string; applicability: string } | null }[]; processAssessment: { summary: Record<string, number> } } }>("select disposition, artifact from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows[0]!
    expect(artifact.disposition).toBe("READY")
    expect(artifact.artifact.items).toMatchObject([{ kind: "MONITORING_STRENGTH", knowledge: { documentId: document, applicability: "VERIFIED" } }])
    expect(artifact.artifact.processAssessment.summary).toMatchObject({ FOLLOWED: 1, NOT_OBSERVABLE: 1, knowledgeVerified: 1 })
    // V1.7.1n — as etapas vieram pelo CÓDIGO do catálogo marcado no prompt (identidade do sistema), nunca pela citação.
    expect(control.lastAgentPrompt).toMatch(/\[CP-[0-9a-f]{10}\] Informe ao cliente que a segunda via/)
    expect((artifact.artifact.processAssessment as unknown as { checkpoints: { source: { ref: string } | null }[] }).checkpoints.map((checkpoint) => checkpoint.source?.ref ?? null)).toEqual([expect.stringMatching(/^CP-[0-9a-f]{10}$/), expect.stringMatching(/^CP-[0-9a-f]{10}$/)])
    const feedbacks = await feedbacksOf()
    expect(feedbacks).toHaveLength(before + 1)
    const published = feedbacks.at(-1)!
    const row = (await pool.query<{ related_procedure: string; recommendation: string }>("select related_procedure, recommendation from feedbacks where id = $1", [published.id])).rows[0]!
    expect(row.related_procedure).toBe(TITLE)
    // V1.7.1e — behavior-first: assunto no título, o que você fez bem + fala, base oficial com documento · seção e o link do
    // processo no próprio achado — tudo renderizado pelo sistema, a partir da estrutura.
    // V1.7.2 — apresentação de supervisor: o ponto cumprido comum vai para "O que manter" (sem bloco nem placar); o documento em
    // "Materiais utilizados"; o card do Acompanhamento (resumo do caso) é o resumo curto do supervisor.
    // Feedback por Flag V2 — narrativa do redator (validada contra os itens) + "Entenda este feedback" com os detalhes.
    // O primeiro nome do CADASTRO abre a narrativa ("Proof, você…"); o modelo nunca recebe nem escreve o nome.
    expect(row.recommendation).toMatch(/^Proof, você conduziu bem este atendimento: informou ao cliente que a segunda via chega/)
    expect(row.recommendation).toContain("**Entenda este feedback**")
    expect(row.recommendation).toContain("## O que manter")
    expect(row.recommendation).not.toMatch(/\*\*O que você fez bem\*\*|Visão geral|pontos? fortes?/)
    expect(row.recommendation).toContain(`[${TITLE} ↗](/materiais/${document})`)
    const card = (await pool.query<{ summary: string }>("select c.summary from feedbacks f join supervision_cases c on c.id = f.case_id where f.id = $1", [published.id])).rows[0]!.summary
    // FEEDBACK EXPERIENCE V2 — card curto do redator, preso à força S1 pelo vínculo (o do sistema é a reserva).
    expect(card).toBe("Boa informação do prazo da segunda via.")
    // O view model publicado (snapshot) — sem nada técnico — e a leitura do Acompanhamento com o link resolvido para quem lê.
    const snapshot = (await pool.query<{ context_snapshot: { reliableFeedback: { feedbackView: { narrative: string[]; card: string; materials: unknown[] }; presentation: { narrative: { source: Record<string, string> } } } } }>("select context_snapshot from feedbacks where id = $1", [published.id])).rows[0]!.context_snapshot.reliableFeedback
    expect(snapshot.presentation.narrative.source).toEqual({ narrative: "WRITER", card: "WRITER" })
    expect(snapshot.feedbackView).toMatchObject({ version: "FEEDBACK_VIEW_V1", card, narrative: [expect.stringMatching(/^Proof, você conduziu bem/), expect.any(String)] })
    expect(JSON.stringify(snapshot.feedbackView)).not.toMatch(/READY|HOLD_FOR_QA|checkpointRef|CP-[0-9a-f]|VERIFIED|evidenceType/)
    const feed = await fetchOperatorFeedbacks(pool, ORG, operator, { personId: operator })
    const read = feed.find((entry) => entry.id === published.id) as unknown as { feedbackView: { materials: { href: string | null; accessible: boolean }[] } }
    expect(read.feedbackView.materials).toEqual([expect.objectContaining({ title: TITLE, href: `/materiais/${document}`, accessible: true })])
    expect(row.recommendation).not.toMatch(/Ponto forte ·|cumpriu a etapa/)
    expect(row.recommendation).not.toContain("Para manter")
    const materials = (await pool.query<{ knowledge_document_id: string; reason: string }>("select knowledge_document_id, reason from feedback_support_materials where feedback_id = $1", [published.id])).rows
    expect(materials).toEqual([{ knowledge_document_id: document, reason: "Utilizado em: Prazo" }]) // V1.7.1e — o ASSUNTO do achado
  })
  it("V1.6.1) DIAGNÓSTICO DO INDICADOR: plano do sistema (motivo + amostra) → Agent avalia só a amostra → verificação → padrão + pares agregados → Acompanhamento com base e material; observações gravadas", async () => {
    control.release = true
    const stamp = Date.now()
    // Sem sequência longa de dígitos (o guard de privacidade trata ≥ 8 dígitos seguidos como identificador, até em fato do sistema).
    const tag = stamp.toString(36).replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!)
    const TITLE = `Prova V1.6.1 · Contestação ${tag}`
    const RULE = "Antes de abrir a contestação, confirme com o cliente o valor contestado e o mês da fatura."
    const QUOTE = "Vou abrir a contestação agora mesmo."
    const REASON = `Contestação Prova ${tag}`
    const TRANSCRIPT_CONTESTACAO = ["CLIENTE: Quero contestar a fatura de junho.", `OPERADOR: ${QUOTE}`, "CLIENTE: Tá bom."].join("\n")
    // Base publicada, com alcance para todos, ligada a um Agent novo.
    const document = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,$2,'PROCEDURE','TEXT') returning id", [ORG, TITLE])).rows[0]!.id
    created.documents.push(document)
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1,$2,1,$3,'PUBLISHED',$4)", [ORG, document, `## Abertura\n${RULE}`, `proof-v161-${document}`])
    await pool.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1,'ALL_TEAMS')", [document])
    const agent = (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,'Proof Reliable · Agent Diagnóstico','CALL_FEEDBACK','Diagnosticar indicador','Prova V1.6.1','Avalie os processos dos atendimentos.') returning id`, [ORG])).rows[0]!.id
    created.agents.push(agent)
    await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agent, document])
    // Indicador (menor é melhor), meta 660, medição de julho = 689 (fora da meta).
    const indicator = (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1,$2,'TMA Diagnóstico','SECONDS','LOWER') returning id`, [ORG, `PROOF_DIAG_${stamp}`])).rows[0]!.id
    created.indicators.push(indicator)
    const code = (await pool.query<{ code: string }>("select code from indicator_definitions where id = $1", [indicator])).rows[0]!.code
    created.goals.push((await pool.query<{ id: string }>("insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1,$2,'TEAM',$3,660,'2026-01-01') returning id", [ORG, indicator, team])).rows[0]!.id)
    const PERIOD = ["2026-07-01T03:00:00Z", "2026-08-01T03:00:00Z"] as const
    const measure = async (personId: string, value: number) => {
      const id = (await pool.query<{ id: string }>("insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1,$2,'PERSON',$3,$4,$5,$6,'PROOF','MONTHLY') returning id", [ORG, indicator, personId, value, PERIOD[0], PERIOD[1]])).rows[0]!.id
      created.measurements.push(id)
      return id
    }
    const interactionOf = async (personId: string, reason: string, startedAt: string, seconds: number, transcript: string | null) => {
      const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,$3,$4,$5,$6) returning id`, [ORG, personId, reason, startedAt, new Date(new Date(startedAt).getTime() + seconds * 1000), `PROOF-V161-${stamp}-${Math.random()}`])).rows[0]!.id
      if (transcript) await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, id, transcript])
      created.interactions.push(id)
      return id
    }
    // Colaborador: 4 atendimentos longos do motivo investigado + 3 curtos de outro motivo (o sistema escolhe onde investigar).
    const own = [] as string[]
    for (const day of [3, 8, 14, 21]) own.push(await interactionOf(operator, REASON, `2026-07-${String(day).padStart(2, "0")}T13:00:00Z`, 900, TRANSCRIPT_CONTESTACAO))
    for (const day of [4, 9, 15]) await interactionOf(operator, `Segunda via Prova ${tag}`, `2026-07-${String(day).padStart(2, "0")}T13:00:00Z`, 300, "OPERADOR: Segunda via enviada.")
    const measurement = await measure(operator, 689)
    // 16 colegas do MESMO Grupo com medição do MESMO indicador e período; o quartil de melhor resultado (4) tem observações
    // VERIFICADAS da mesma prática no mesmo motivo (8 atendimentos, todos seguindo a etapa).
    const { practiceKeyOf } = await import("../../indicator-diagnosis/domain/process-patterns.js")
    const practiceKey = practiceKeyOf({ requirement: "x", knowledge: { documentId: document, documentTitle: TITLE, heading: null, version: 1, quote: RULE, literalInPublished: true, presentedInRun: true, anchorTerms: [], applicability: "VERIFIED", applicabilityBasis: "LEXICAL_ANCHOR", leadIn: null, failure: null, contentSha256: null } })
    for (let index = 0; index < 16; index += 1) {
      const peer = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id", [ORG, `Proof Reliable Par ${index}`, team])).rows[0]!.id
      created.people.push(peer)
      await measure(peer, 500 + index * 10)
      if (index < 4) {
        for (const day of [5, 12]) {
          const interaction = await interactionOf(peer, REASON, `2026-07-${String(day).padStart(2, "0")}T14:00:00Z`, 600, null)
          // V1.7.1j — observação de par ELEGÍVEL (prova completa) — só VERIFIED entra na agregação.
          await pool.query("insert into process_checkpoint_observations (organization_id, person_id, interaction_id, practice_key, document_id, document_version, requirement, status, occurred_at, analytics_status) values ($1,$2,$3,$4,$5,1,'Confirmar valor e mês antes de abrir','FOLLOWED',$6,'VERIFIED')", [ORG, peer, interaction, practiceKey, document, `2026-07-${String(day).padStart(2, "0")}T14:00:00Z`])
        }
        // …e uma NEEDS_REVIEW (regra só exemplo, por exemplo): registrada, mas FORA da agregação dos pares (interactionCount segue 8).
        const unreviewed = await interactionOf(peer, REASON, "2026-07-19T14:00:00Z", 600, null)
        await pool.query("insert into process_checkpoint_observations (organization_id, person_id, interaction_id, practice_key, document_id, document_version, requirement, status, occurred_at, analytics_status, analytics_reasons) values ($1,$2,$3,$4,$5,1,'Confirmar valor e mês antes de abrir','FOLLOWED','2026-07-19T14:00:00Z','NEEDS_REVIEW',array['EXAMPLE_ONLY_RULE'])", [ORG, peer, unreviewed, practiceKey, document])
      }
    }
    // V1.6.2 — o COMO investigar é a estratégia PUBLICADA do indicador (pela mesma API/serviço da tela), presa na execução.
    const { saveStrategyDraft, publishStrategyDraft } = await import("../../indicator-diagnosis/application/diagnostic-strategy-service.js")
    const { emptyStrategyConfig } = await import("../../indicator-diagnosis/domain/diagnostic-strategy.js")
    const actor = { userAccountId: created.accounts[0]!, personId: qaPerson }
    await saveStrategyDraft(pool, ORG, indicator, { config: { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, peerComparison: { enabled: true, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 } } }, actor)
    const strategyVersionId = (await publishStrategyDraft(pool, ORG, indicator, actor)).published!.id
    const wf = await insertWorkflow("Prova V1.6.1 · diagnóstico", { kind: "indicator", indicatorCode: code }, agent, { outputContract: "INDICATOR_DIAGNOSIS" })
    control.agentPrompts.length = 0
    control.calls.length = 0
    control.agentReply = () => ({
      title: "TMA fora da meta", summary: "Seu TMA ficou fora da meta no período.", relatedProcedure: TITLE, recommendation: "Confirme o valor antes de abrir.",
      interactionAssessments: ["I1", "I2", "I3", "I4"].map((interactionRef) => ({ interactionRef, processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: [{ ...checkpointRefFor(RULE), requirement: "Confirmar valor e mês antes de abrir a contestação", status: "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [QUOTE], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: "Confirme o valor e o mês antes de abrir." }, uncertainty: null }] }] } })),
    })
    control.writerWording = (item) => {
      const diagnosis = item.diagnosis as { pattern: string; knowledge: { documentTitle: string; quote: string } } | null
      if (!diagnosis) return { observed: `No período de ${(item.officialData as { period: string }).period}, seu TMA Diagnóstico foi 689 s, fora da meta de 660 s.`, whyItMatters: "", whatYouCanDo: "" }
      return { observed: diagnosis.pattern, whyItMatters: `O documento “${diagnosis.knowledge.documentTitle}” orienta: “${diagnosis.knowledge.quote}”`, whatYouCanDo: "Nos próximos atendimentos desse motivo, confirme o valor contestado e o mês da fatura antes de abrir a contestação." }
    }
    const enrollment = await enroll(wf, { measurementId: measurement, strategyVersionId })
    const before = (await feedbacksOf()).length
    expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", "FEEDBACK_WRITING"])
    // O Agent recebeu SÓ a amostra do motivo investigado, por handle — nenhum id técnico, nenhum atendimento de outro motivo.
    const prompt = control.agentPrompts[0]!
    expect(prompt).toContain(`Motivo investigado: ${REASON} — 4 de 7 atendimentos do período`)
    expect(prompt.match(/=== I\d · 2026-07-\d\d ===/g)).toHaveLength(4)
    expect(prompt).not.toContain("Segunda via enviada")
    for (const id of own) expect(prompt).not.toContain(id)

    const artifact = (await pool.query<{ disposition: string; artifact: { items: { kind: string; facts: { role: string; text: string }[]; decision: { disposition: string } }[]; indicatorDiagnosis: { status: string; segmentation: { selected: { label: string } }; patterns: { notFollowed: number; analyzed: number; peer: { status: string; interactionCount?: number; populationSize?: number } }[] } } }>("select disposition, artifact from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows[0]!
    expect(artifact.disposition).toBe("READY")
    expect(artifact.artifact.items.map((item) => [item.kind, item.decision.disposition])).toEqual([["INDICATOR_TARGET_NOT_MET", "READY"], ["INDICATOR_DEVELOPMENT_PATTERN", "READY"]])
    expect(artifact.artifact.indicatorDiagnosis).toMatchObject({ status: "DEVELOPMENT_SUPPORTED", segmentation: { selected: { label: REASON } }, patterns: [{ notFollowed: 4, analyzed: 4, peer: { status: "AVAILABLE", interactionCount: 8, populationSize: 4 } }] })
    const peerFact = artifact.artifact.items[1]!.facts.find((fact) => fact.role === "REFERENCIA")!.text
    expect(peerFact).toContain("(4 de 16 pessoas)")
    expect(peerFact).toContain("a etapa foi identificada em 8 de 8 atendimentos analisados")
    expect(peerFact).not.toMatch(/Proof Reliable Par/)

    const feedbacks = await feedbacksOf()
    expect(feedbacks).toHaveLength(before + 1)
    const published = (await pool.query<{ id: string; related_procedure: string; recommendation: string }>("select id, related_procedure, recommendation from feedbacks where id = $1", [feedbacks.at(-1)!.id])).rows[0]!
    expect(published.related_procedure).toBe(TITLE)
    expect(published.recommendation).toContain("**O que fazer nos próximos casos:**")
    expect(published.recommendation).toContain("**Limitações da análise:**")
    expect(published.recommendation).not.toMatch(/porque|para reduzir/)
    expect((await pool.query("select knowledge_document_id from feedback_support_materials where feedback_id = $1", [published.id])).rows).toEqual([{ knowledge_document_id: document }])
    // As etapas VERIFICADAS do colaborador viram observações (base dos próximos benchmarks).
    const observations = (await pool.query<{ interaction_id: string; status: string; practice_key: string }>("select interaction_id, status, practice_key from process_checkpoint_observations where person_id = $1 and document_id = $2 order by interaction_id", [operator, document])).rows
    expect(observations.map((row) => row.interaction_id).sort()).toEqual([...own].sort())
    expect(new Set(observations.map((row) => `${row.status}|${row.practice_key}`))).toEqual(new Set([`NOT_FOLLOWED|${practiceKey}`]))
    // V1.7.1i (migration 087) — o BANCO recusa etapa composta parcial ou de completude desconhecida gravada como "cumprida":
    // nenhum agregado futuro (diagnóstico, histórico, chat) consegue ler PARTIAL como FOLLOWED.
    const row = observations[0]!
    await expect(pool.query("update process_checkpoint_observations set status = 'FOLLOWED', completeness = 'PARTIAL' where interaction_id = $1 and practice_key = $2", [row.interaction_id, row.practice_key])).rejects.toThrow(/followed_complete_check/)
    await expect(pool.query("update process_checkpoint_observations set status = 'FOLLOWED', completeness = 'UNKNOWN' where interaction_id = $1 and practice_key = $2", [row.interaction_id, row.practice_key])).rejects.toThrow(/followed_complete_check/)
    await pool.query("update process_checkpoint_observations set completeness = 'PARTIAL', sub_items = $3::jsonb where interaction_id = $1 and practice_key = $2", [row.interaction_id, row.practice_key, JSON.stringify([{ text: "prazo", status: "VERIFIED_ABSENT" }])])
    expect((await pool.query("select status, completeness, sub_items from process_checkpoint_observations where interaction_id = $1 and practice_key = $2", [row.interaction_id, row.practice_key])).rows[0]).toEqual({ status: "NOT_FOLLOWED", completeness: "PARTIAL", sub_items: [{ text: "prazo", status: "VERIFIED_ABSENT" }] })
  })
})
