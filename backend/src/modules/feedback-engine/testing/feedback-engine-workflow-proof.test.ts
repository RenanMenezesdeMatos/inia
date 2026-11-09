/**
 * PROVA contra o banco de TESTE real: motor de feedback (FEEDBACK_ENGINE_V1) dentro do Workflow existente — "Chamar agente"
 * (avaliação de processo) → "Gerar feedback" → Output FOLLOW_UP → Acompanhamento, sem QA e sem aprovação de checkpoint. Usa o
 * MESMO processamento de matrícula do tick (`processEnrollment`) e os stores Postgres reais. ZERO chamada de modelo: o modelo
 * do motor é o falso de `fake-engine-model.ts`. Dados COMMITADOS (concorrência entre conexões) e apagados no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-engine-workflow-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import type { AgentConfig } from "../../agents/domain/agent-config.js"
import type { EngineModelRequest } from "../application/ports.js"
import { CHECKLIST_V1, PROCEDURE_V1, TRANSCRIPT } from "./fixtures.js"

const control = vi.hoisted(() => ({ model: null as null | { generate: (request: unknown) => Promise<unknown> } }))
vi.mock("../infrastructure/gateway-engine-model.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../infrastructure/gateway-engine-model.js")>()
  return { ...original, createGatewayEngineModel: () => ({ generate: (request: unknown) => control.model!.generate(request) }) }
})

const { env } = await import("../../../config/env.js")
const { fakeEngineModel } = await import("./fake-engine-model.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { createEngineDeps } = await import("../application/engine-wiring.js")
const { analyzeCall } = await import("../application/analyze-call.js")
const { findLegacyHolds, resolveLegacyHold } = await import("../application/legacy-holds.js")
const { loadAgentLifecycle, loadEditableAgentConfig, publishAgentDraft, saveAgentDraft } = await import("../../agents/application/agent-versions.js")
const { memorySummary, processAggregates, peopleAggregates, assessmentDetail } = await import("../application/leadership-diagnostics.js")
/** Pontos de todos os temas (a resposta agrupa por tema). */
const pointsOf = (result: Awaited<ReturnType<typeof processAggregates>>) => result.themes.flatMap((theme) => theme.items)
const { createDiagnosticsRouter } = await import("../../diagnostics/presentation/diagnostics-router.js")
const { confirmAllObligations } = await import("./fake-engine-model.js")
const { default: express } = await import("express")
const { default: supertest } = await import("supertest")
const { fetchOperatorFeedbacks } = await import("../../reporting/application/fetch-operator-overview.js")
const { createPostgresFeedbackMemoryStore } = await import("../infrastructure/postgres-feedback-memory-store.js")
const { createPostgresReliableFeedbackStore } = await import("../../reliable-feedback/infrastructure/postgres-reliable-feedback-store.js")
const { loadDispatchDetail } = await import("../../workflows/application/workflow-results-reader.js")
const { resolveOfficialClosure } = await import("../../indicators/application/official-closure.js")
const { referencePeriodDates } = await import("../../indicator-diagnosis/domain/prv-closing.js")
const { saveStrategyDraft, publishStrategyDraft } = await import("../../indicator-diagnosis/application/diagnostic-strategy-service.js")
const { emptyStrategyConfig } = await import("../../indicator-diagnosis/domain/diagnostic-strategy.js")
const { reprojectFeedbackGreetings } = await import("../infrastructure/reproject-feedback-greetings.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], interactions: [] as string[], workflows: [] as string[], agents: [] as string[], documents: [] as string[], indicators: [] as string[], accounts: [] as string[] }

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
async function drive(id: string, maxSteps = 8) {
  for (let step = 0; step < maxSteps; step += 1) {
    const before = await state(id)
    if (before.status === "completed" || before.status === "dead" || before.status === "waiting") return before
    await processEnrollment(pool, await claimed(id))
    const after = await state(id)
    if (after.attempts > before.attempts) throw new Error(`nó ${before.current_node_id} falhou: ${JSON.stringify((await pool.query(`select payload from workflow_enrollment_events where enrollment_id = $1 and event_type in ('node_failed','flow_dead') order by created_at desc limit 1`, [id])).rows[0])}`)
  }
  return state(id)
}

describe.skipIf(!ENABLED)("Motor de feedback no Workflow — prova Postgres (zero chamada de modelo)", () => {
  let operator: string
  let outsider: string
  let supervisor: string
  let team: string
  let agent: string
  let agentB: string
  let procedureDoc: string
  const stages: string[] = []
  const useModel = (options: Parameters<typeof fakeEngineModel>[0] = {}, delayMs = 0) => {
    const fake = fakeEngineModel(options)
    control.model = { async generate(request: unknown) { stages.push((request as EngineModelRequest).stage); if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs)); return fake.model.generate(request as EngineModelRequest) } }
    return fake
  }
  /** Publica pelas mesmas funções da tela. O Workflow executa a versão vigente (PEN-002): mudar a coluna do agente por SQL não chega à execução. */
  const publishAgent = async (agentId: string, changes: Partial<AgentConfig> = {}) => {
    const publisher = { personId: null, name: "Proof Engine" }
    const editable = (await loadEditableAgentConfig(pool, ORG, agentId))!
    await saveAgentDraft(pool, editable.lifecycle, { ...editable.config, ...changes }, publisher)
    await publishAgentDraft(pool, (await loadAgentLifecycle(pool, ORG, agentId))!, publisher)
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    supervisor = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Proof Engine Supervisora', 'SUPERVISOR', $2) returning id", [ORG, team])).rows[0]!.id
    operator = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1, 'Proof Engine Operadora', 'OPERATOR', $2, $3) returning id", [ORG, team, supervisor])).rows[0]!.id
    outsider = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Proof Engine Fora do Escopo', 'OPERATOR', $2) returning id", [ORG, team])).rows[0]!.id
    created.people.push(operator, outsider, supervisor)
    const newAgent = async (name: string) => (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,$2,'CALL_FEEDBACK','Avaliar segunda via','Prova do motor','Avalie a chamada pelo procedimento.') returning id`, [ORG, name])).rows[0]!.id
    agent = await newAgent("Proof Engine · Especialista de segunda via")
    agentB = await newAgent("Proof Engine · Especialista B")
    created.agents.push(agent, agentB)
    const document = async (title: string, content: string) => {
      const id = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,$2,'PROCEDURE','TEXT') returning id", [ORG, title])).rows[0]!.id
      await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, effective_from) values ($1,$2,1,$3,'PUBLISHED',md5($3),'2026-01-01')", [ORG, id, content])
      for (const agentId of [agent, agentB]) await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agentId, id])
      created.documents.push(id)
      return id
    }
    procedureDoc = await document("Procedimento — Segunda via de conta", PROCEDURE_V1)
    await document("Checklist de Encerramento de Chamada", CHECKLIST_V1)
    // Agente criado por SQL nasce sem versão, e o Workflow só roda agente publicado (PEN-002). Publica depois de ligar as bases, que fazem parte da versão.
    for (const agentId of [agent, agentB]) await publishAgent(agentId)
  })
  afterAll(async () => {
    if (!pool) return
    const people = created.people
    const feedbackRows = (await pool.query<{ id: string; case_id: string }>("select id, case_id from feedbacks where operator_id = any($1::uuid[])", [people])).rows
    await pool.query("delete from workflow_output_emissions where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    await pool.query("delete from feedback_material_recommendations where person_id = any($1::uuid[])", [people])
    await pool.query("delete from feedback_support_materials where feedback_id = any($1::uuid[])", [feedbackRows.map((row) => row.id)])
    await pool.query("delete from case_timeline_events where case_id = any($1::uuid[])", [feedbackRows.map((row) => row.case_id)])
    await pool.query("delete from audit_logs where action = 'FEEDBACK_GREETING_REPROJECTED' and entity_id = any($1::uuid[])", [feedbackRows.map((row) => row.id)])
    await pool.query("delete from feedback_follow_up_hides where feedback_id = any($1::uuid[])", [feedbackRows.map((row) => row.id)])
    await pool.query("delete from feedbacks where operator_id = any($1::uuid[])", [people])
    await pool.query("delete from evidences where case_id = any($1::uuid[])", [feedbackRows.map((row) => row.case_id)])
    await pool.query("delete from supervision_cases where operator_id = any($1::uuid[])", [people])
    await pool.query("delete from feedback_engine_messages where person_id = any($1::uuid[])", [people])
    await pool.query("update call_criterion_assessments set superseded_by = null where person_id = any($1::uuid[])", [people])
    await pool.query("delete from call_criterion_assessments where person_id = any($1::uuid[])", [people])
    await pool.query("update call_assessments set superseded_by = null where person_id = any($1::uuid[])", [people])
    await pool.query("delete from call_assessments where person_id = any($1::uuid[])", [people])
    await pool.query("delete from feedback_analysis_runs where person_id = any($1::uuid[])", [people])
    await pool.query("delete from knowledge_practice_members where source_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_practices p where p.organization_id = $1 and not exists (select 1 from knowledge_practice_members m where m.organization_id = p.organization_id and m.practice_key = p.practice_key)", [ORG])
    await pool.query("delete from knowledge_practice_themes t where t.organization_id = $1 and not exists (select 1 from knowledge_practices p where p.organization_id = t.organization_id and p.theme_key = t.theme_key)", [ORG])
    await pool.query("delete from knowledge_criteria where document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_criteria_extractions where document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from reliable_feedback_item_reviews where artifact_id in (select id from reliable_feedback_artifacts where collaborator_id = any($1::uuid[]))", [people])
    await pool.query("delete from reliable_feedback_artifacts where collaborator_id = any($1::uuid[])", [people])
    await pool.query("delete from audit_logs where entity_type = 'reliable_feedback_artifact' and organization_id = $1 and payload->>'reason' like 'Prova do motor%'", [ORG])
    await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from agent_runs where agent_id = any($1::uuid[])", [created.agents])
    await pool.query("delete from agent_knowledge_documents where agent_id = any($1::uuid[])", [created.agents])
    await pool.query("delete from agents where id = any($1::uuid[])", [created.agents])
    await pool.query("delete from employee_indicator_performance where person_id = any($1::uuid[])", [people])
    await pool.query("update indicator_investigations set superseded_by = null where person_id = any($1::uuid[])", [people])
    await pool.query("delete from indicator_investigations where person_id = any($1::uuid[])", [people])
    await pool.query("delete from feedback_analysis_runs where person_id = any($1::uuid[])", [people])
    // Versão publicada da estratégia só sai pela cascata do indicador (gatilho de imutabilidade).
    await pool.query("delete from audit_logs where entity_type = 'indicator_diagnostic_strategy' and actor_id = any($1::uuid[])", [people])
    await pool.query("delete from indicator_definitions where id = any($1::uuid[])", [created.indicators])
    await pool.query("delete from user_accounts where id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from knowledge_versions where document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_documents where id = any($1::uuid[])", [created.documents])
    await pool.query("delete from transcripts where interaction_id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    // As consultas da liderança (caso H) registram o acesso a dados pessoais; sem isto a pessoa não sai (FK do registro).
    await pool.query("delete from personal_data_access_log where viewer_person_id = any($1::uuid[]) or subject_person_id = any($1::uuid[])", [people])
    await pool.query("delete from people where id = any($1::uuid[])", [people])
    await pool.end()
  })

  const insertInteraction = async (startedAt: Date, personId = operator) => {
    const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Segunda via',$3,$4,$5) returning id`, [ORG, personId, startedAt, new Date(startedAt.getTime() + 360_000), `PROOF-ENGINE-${startedAt.getTime()}-${Math.random()}`])).rows[0]!.id
    await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, id, TRANSCRIPT])
    created.interactions.push(id)
    return id
  }
  const insertWorkflow = async (name: string, options: { withOutput?: boolean } = {}) => {
    const nodes = [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", type: "action", label: "Especialista", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId: agent, outputContract: "PROCESS_ASSESSMENT" } },
      { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 2 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
      { id: "output", type: "output", label: "Feedback ao operador", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
    ]
    const edges = [["trigger", "agent"], ["agent", "feedback"], ["feedback", "output"], ["output", "end"]]
    const graph = options.withOutput === false
      ? { nodes: nodes.filter((node) => node.id !== "output"), edges: [["trigger", "agent"], ["agent", "feedback"], ["feedback", "end"]].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })) }
      : { nodes, edges: edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })) }
    const workflow = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1,$2,$3,$4) returning id`, [ORG, name, JSON.stringify({ kind: "channel_flag", channelFlagId: "00000000-0000-4000-8000-000000000000" }), JSON.stringify(graph)])).rows[0]!.id
    created.workflows.push(workflow)
    const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [workflow, JSON.stringify(graph)])).rows[0]!.id
    return { workflow, version }
  }
  const enroll = async (wf: { workflow: string; version: string }, interactionId: string) =>
    (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, matched_flag_name, matched_value_boolean) values ($1,$2,$3,'trigger','active','2999-01-01',$4,'rechamada',true) returning id`, [ORG, wf.workflow, wf.version, interactionId])).rows[0]!.id
  const feedbacksOf = async (personId = operator) => (await pool.query<{ id: string; context_snapshot: { feedbackEngine?: { messageId: string; feedbackView: { narrative: string[]; greeting: string | null } } } }>("select id, context_snapshot from feedbacks where operator_id = $1 order by created_at", [personId])).rows
  const currentCriteria = async (interactionId: string) => (await pool.query<{ criterion_key: string; status: string; identity_basis: string; document_version: number }>("select criterion_key, status, identity_basis, document_version from call_criterion_assessments where interaction_id = $1 and is_current order by criterion_key", [interactionId])).rows

  it("A) Workflow existente sem configuração nova: análise → memória → mensagem → Acompanhamento; nenhuma espera de QA; retry não duplica nada", async () => {
    stages.length = 0
    useModel()
    const interactionId = await insertInteraction(new Date("2026-09-20T13:00:00Z"))
    const wf = await insertWorkflow("Proof Engine · monitoria")
    const enrollment = await enroll(wf, interactionId)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    // Análise → revisão independente das conclusões → redação → verificação.
    // Análise → revisão → organização das regras em práticas (só na primeira vez que essas linhas aparecem) → redação → verificação.
    expect(stages).toEqual(["CALL_ANALYSIS", "CALL_REVIEW", "PRACTICE_IDENTITY", "PRACTICE_THEMES", "COMPOSITION", "VERIFICATION"])

    // Memória: uma leitura vigente da chamada, acertos/desvios/não aplicáveis separados, identidade automática dos critérios.
    const assessments = (await pool.query<{ id: string; is_current: boolean; outcome: string; path_assessment: string }>("select id, is_current, outcome, path_assessment from call_assessments where interaction_id = $1", [interactionId])).rows
    expect(assessments).toHaveLength(1)
    expect(assessments[0]).toMatchObject({ is_current: true, path_assessment: "PARTIALLY_CORRECT" })
    const statuses = (await currentCriteria(interactionId)).reduce<Record<string, number>>((acc, row) => ({ ...acc, [row.status]: (acc[row.status] ?? 0) + 1 }), {})
    expect(statuses).toMatchObject({ MET: 3, NOT_MET: 1, NOT_APPLICABLE: 2 })
    expect((await pool.query("select 1 from knowledge_criteria where document_id = $1", [procedureDoc])).rowCount).toBeGreaterThan(0)

    // Acompanhamento: um feedback, com o view model do motor lido pelo feed (coalesce com o caminho anterior).
    const feedbacks = await feedbacksOf()
    expect(feedbacks).toHaveLength(1)
    expect(feedbacks[0]!.context_snapshot.feedbackEngine?.feedbackView.narrative.join(" ")).toContain("data de nascimento")
    const feed = await fetchOperatorFeedbacks(pool as never, ORG, operator, { personId: operator })
    expect(feed[0]!.feedbackView).toMatchObject({ version: "FEEDBACK_VIEW_V1" })
    // Saudação montada pelo sistema na entrega (FEEDBACK_GREETING_V1): o primeiro nome do cadastro, nunca o redator.
    expect(feedbacks[0]!.context_snapshot.feedbackEngine?.feedbackView.greeting).toBe("Olá, Proof!")

    // Feedback publicado ANTES da saudação: a reprojeção a acrescenta (ensaio não grava; aplicar grava uma vez; idempotente).
    await pool.query(`update feedbacks set context_snapshot = jsonb_set(context_snapshot, '{feedbackEngine,feedbackView,greeting}', 'null'::jsonb) where id = $1`, [feedbacks[0]!.id])
    const greetingInput = { organizationId: ORG, actorId: null, clock: { now: () => new Date() }, feedbackIds: [feedbacks[0]!.id] }
    const dryRun = await reprojectFeedbackGreetings(pool as never, { ...greetingInput, apply: false })
    expect(dryRun.rows).toEqual([expect.objectContaining({ outcome: "ADDED", before: null, after: "Olá, Proof!" })])
    expect((await feedbacksOf())[0]!.context_snapshot.feedbackEngine?.feedbackView.greeting).toBeNull()
    expect((await reprojectFeedbackGreetings(pool as never, { ...greetingInput, apply: true })).applied).toBe(1)
    expect((await feedbacksOf())[0]!.context_snapshot.feedbackEngine?.feedbackView.greeting).toBe("Olá, Proof!")
    expect((await reprojectFeedbackGreetings(pool as never, { ...greetingInput, apply: true })).rows).toEqual([expect.objectContaining({ outcome: "UNCHANGED_SAME_GREETING" })])
    // Saudação gravada por uma regra anterior (nome inteiro) → alinhada ao primeiro nome.
    await pool.query(`update feedbacks set context_snapshot = jsonb_set(context_snapshot, '{feedbackEngine,feedbackView,greeting}', '"Olá, Proof Engine Operadora!"'::jsonb) where id = $1`, [feedbacks[0]!.id])
    expect((await reprojectFeedbackGreetings(pool as never, { ...greetingInput, apply: true })).rows).toEqual([expect.objectContaining({ outcome: "UPDATED", before: "Olá, Proof Engine Operadora!", after: "Olá, Proof!" })])
    expect((await pool.query("select 1 from audit_logs where action = 'FEEDBACK_GREETING_REPROJECTED' and entity_id = $1", [feedbacks[0]!.id])).rowCount).toBe(2)
    const message = (await pool.query<{ status: string; delivered_at: Date | null }>("select status, delivered_at from feedback_engine_messages where enrollment_id = $1", [enrollment])).rows
    expect(message).toHaveLength(1)
    expect(message[0]!.status).toBe("PUBLISHABLE")
    expect(message[0]!.delivered_at).not.toBeNull()
    expect((await pool.query("select 1 from workflow_output_emissions where enrollment_id = $1 and engine_message_id is not null", [enrollment])).rowCount).toBe(1)
    expect((await pool.query("select 1 from workflow_enrollment_events where enrollment_id = $1 and event_type ilike '%qa%'", [enrollment])).rowCount).toBe(0)

    // Retry dos nós "Gerar feedback" e Output (como um reprocessamento do motor): mesma mensagem, mesma emissão, zero modelo.
    stages.length = 0
    await pool.query("update workflow_enrollments set status = 'active', current_node_id = 'feedback', next_eval_at = now() where id = $1", [enrollment])
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(stages).toEqual([])
    expect(await feedbacksOf()).toHaveLength(1)
    expect((await pool.query("select 1 from workflow_output_emissions where enrollment_id = $1", [enrollment])).rowCount).toBe(1)

    // Resultados do Workflow: a mensagem do motor aparece como enviada.
    const detail = await loadDispatchDetail(pool as never, ORG, wf.workflow, { unrestricted: true }, enrollment, 1, 50)
    expect(detail!.persons.items[0]!.feedbacks[0]).toMatchObject({ kind: "ENGINE", disposition: "READY", sent: true })
  })

  it("B) mesma chamada em outra execução (`ONE_MONITORING_PER_CALL_V1`): a chamada já tem monitoria entregue — nada é analisado nem publicado, abstenção com motivo", async () => {
    stages.length = 0
    useModel()
    const interactionId = (await pool.query<{ interaction_id: string }>("select interaction_id from call_assessments where person_id = $1 and is_current order by created_at limit 1", [operator])).rows[0]!.interaction_id
    const wf = await insertWorkflow("Proof Engine · segunda execução")
    const enrollment = await enroll(wf, interactionId)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(stages).toEqual([])
    expect((await pool.query("select 1 from call_assessments where interaction_id = $1", [interactionId])).rowCount).toBe(1)
    expect((await pool.query<{ status: string; abstain_reason: string }>("select status, abstain_reason from feedback_engine_messages where enrollment_id = $1", [enrollment])).rows[0]).toMatchObject({ status: "ABSTAINED", abstain_reason: "CALL_ALREADY_MONITORED" })
    expect(await feedbacksOf()).toHaveLength(1)
  })

  it("C) falha do redator: a análise fica na memória e a mensagem NÃO sai (abstenção com motivo; nunca texto de template do sistema, nunca QA)", async () => {
    stages.length = 0
    useModel({ failComposition: true })
    const interactionId = await insertInteraction(new Date("2026-09-21T13:00:00Z"))
    const wf = await insertWorkflow("Proof Engine · redator falha")
    const enrollment = await enroll(wf, interactionId)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(stages[0]).toBe("CALL_ANALYSIS")
    const message = (await pool.query<{ status: string; abstain_reason: string; message: unknown }>("select status, abstain_reason, message from feedback_engine_messages where enrollment_id = $1", [enrollment])).rows[0]!
    expect(message).toMatchObject({ status: "ABSTAINED", abstain_reason: "NO_SAFE_MESSAGE:WRITER_OUTPUT_INVALID", message: null })
    expect((await pool.query("select 1 from workflow_output_emissions where enrollment_id = $1", [enrollment])).rowCount).toBe(0)
    expect((await pool.query("select 1 from call_assessments where interaction_id = $1 and is_current", [interactionId])).rowCount).toBe(1)
  })

  it("D) sem Output no grafo: a memória é gravada mesmo sem publicação; a mensagem fica publicável e não entregue", async () => {
    useModel()
    const interactionId = await insertInteraction(new Date("2026-09-22T13:00:00Z"))
    const wf = await insertWorkflow("Proof Engine · sem Output", { withOutput: false })
    const enrollment = await enroll(wf, interactionId)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect((await pool.query("select 1 from call_criterion_assessments where interaction_id = $1 and is_current", [interactionId])).rowCount).toBeGreaterThan(0)
    expect((await pool.query<{ status: string; delivered_at: Date | null }>("select status, delivered_at from feedback_engine_messages where enrollment_id = $1", [enrollment])).rows[0]).toMatchObject({ status: "PUBLISHABLE", delivered_at: null })
  })

  it("O) `ONE_MONITORING_PER_CALL_V1` na publicação: duas mensagens publicáveis da MESMA chamada (Workflows diferentes) publicadas AO MESMO TEMPO → uma só entra no Acompanhamento; a outra volta 'chamada já monitorada'; um terceiro Workflow nem analisa", async () => {
    useModel()
    const interactionId = await insertInteraction(new Date("2026-09-23T13:00:00Z"))
    const first = await enroll(await insertWorkflow("Proof Engine · monitoria X (sem Output)", { withOutput: false }), interactionId)
    const second = await enroll(await insertWorkflow("Proof Engine · monitoria Y (sem Output)", { withOutput: false }), interactionId)
    expect(await drive(first)).toMatchObject({ status: "completed" })
    expect(await drive(second)).toMatchObject({ status: "completed" })
    const messages = (await pool.query<{ id: string; enrollment_id: string; status: string }>("select id, enrollment_id, status from feedback_engine_messages where enrollment_id = any($1::uuid[]) order by created_at", [[first, second]])).rows
    expect(messages.map((row) => row.status)).toEqual(["PUBLISHABLE", "PUBLISHABLE"])
    const feedbacksBefore = (await feedbacksOf()).length
    const { publishEngineFeedbackToFollowUp } = await import("../infrastructure/publish-engine-feedback.js")
    const results = await Promise.all(messages.map((row) => publishEngineFeedbackToFollowUp(pool as never, { organizationId: ORG, enrollmentId: row.enrollment_id, nodeId: "output", recipientId: operator, messageId: row.id })))
    expect(results.filter((result) => result.feedbackId !== null)).toHaveLength(1)
    expect(results.filter((result) => result.skipped?.reason === "CALL_ALREADY_MONITORED")).toHaveLength(1)
    expect((await feedbacksOf()).length).toBe(feedbacksBefore + 1)
    expect((await pool.query("select 1 from feedback_engine_messages where enrollment_id = any($1::uuid[]) and delivered_at is not null", [[first, second]])).rowCount).toBe(1)
    // Terceiro Workflow (com Output) na mesma chamada: nada é chamado; a mensagem se abstém com o motivo e nada é publicado.
    stages.length = 0
    const third = await enroll(await insertWorkflow("Proof Engine · monitoria Z"), interactionId)
    expect(await drive(third)).toMatchObject({ status: "completed" })
    expect(stages).toEqual([])
    expect((await pool.query<{ status: string; abstain_reason: string }>("select status, abstain_reason from feedback_engine_messages where enrollment_id = $1", [third])).rows[0]).toMatchObject({ status: "ABSTAINED", abstain_reason: "CALL_ALREADY_MONITORED" })
    expect((await feedbacksOf()).length).toBe(feedbacksBefore + 1)
  })

  it("E) execuções concorrentes da MESMA análise: uma chamada de modelo, uma leitura vigente", async () => {
    stages.length = 0
    useModel({}, 400)
    const interactionId = await insertInteraction(new Date("2026-09-23T13:00:00Z"))
    const deps = createEngineDeps({ db: pool as never })
    const request = { organizationId: ORG, interactionId, collaboratorId: operator, agentId: agent, trigger: { kind: "EVALUATION" as const, selectionReason: "Prova de concorrência" } }
    const settled = await Promise.allSettled([analyzeCall(deps.analyze, request), analyzeCall(createEngineDeps({ db: pool as never }).analyze, request)])
    expect(stages.filter((stage) => stage === "CALL_ANALYSIS")).toHaveLength(1)
    expect(settled.some((entry) => entry.status === "fulfilled")).toBe(true)
    for (const entry of settled) if (entry.status === "rejected") expect((entry.reason as { code?: string }).code).toMatch(/IN_PROGRESS/)
    expect((await pool.query("select 1 from call_assessments where interaction_id = $1 and is_current", [interactionId])).rowCount).toBe(1)
  })

  it("F) regra muda na base: reanálise substitui a leitura anterior sem contar duas vezes; critério inalterado mantém a identidade; leitura mais antiga que termina depois não sobrescreve", async () => {
    useModel()
    const interactionId = await insertInteraction(new Date("2026-09-24T13:00:00Z"))
    const request = { organizationId: ORG, interactionId, collaboratorId: operator, agentId: agent, trigger: { kind: "EVALUATION" as const, selectionReason: "Prova de mudança de regra" } }
    const first = await analyzeCall(createEngineDeps({ db: pool as never }).analyze, request)
    const before = await currentCriteria(interactionId)
    // Versão 2 publicada e vigente antes da chamada: o prazo por correio muda (2 → 3 dias úteis).
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, effective_from) values ($1,$2,2,$3,'PUBLISHED',md5($3),'2026-09-01')", [ORG, procedureDoc, PROCEDURE_V1.replace("prazo de 2 dias úteis", "prazo de 3 dias úteis")])
    const second = await analyzeCall(createEngineDeps({ db: pool as never }).analyze, request)
    expect(second.runId).not.toBe(first.runId)
    const assessments = (await pool.query<{ id: string; is_current: boolean; superseded_by: string | null }>("select id, is_current, superseded_by from call_assessments where interaction_id = $1 order by created_at", [interactionId])).rows
    expect(assessments.filter((row) => row.is_current)).toHaveLength(1)
    expect(assessments[0]).toMatchObject({ is_current: false, superseded_by: assessments[1]!.id })
    const after = await currentCriteria(interactionId)
    expect(after.length).toBe(before.length)
    const unchanged = before.find((row) => row.status === "NOT_MET")!
    expect(after.find((row) => row.criterion_key === unchanged.criterion_key)).toMatchObject({ status: "NOT_MET", document_version: 2 })

    // Uma leitura iniciada ANTES (relógio anterior) que conclui DEPOIS não vira a vigente.
    const olderClock = { now: () => new Date(Date.now() - 3_600_000) }
    const late = await analyzeCall(createEngineDeps({ db: pool as never, clock: olderClock }).analyze, { ...request, agentId: agentB })
    expect(late.runId).not.toBe(second.runId)
    const current = (await pool.query<{ analysis_run_id: string }>("select analysis_run_id from call_assessments where interaction_id = $1 and is_current", [interactionId])).rows
    expect(current.map((row) => row.analysis_run_id)).toEqual([second.runId])
  })

  it("G) retenções antigas de QA: listadas, reprocessadas pelo motor ou encerradas com motivo — nunca aprovadas; a fila de QA não as mostra mais", async () => {
    const interactionId = await insertInteraction(new Date("2026-09-25T13:00:00Z"))
    const wf = await insertWorkflow("Proof Engine · retenção antiga")
    const hold = async (label: string) => {
      const enrollment = (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, interaction_id, matched_flag_name, matched_value_boolean) values ($1,$2,$3,'feedback','waiting','2998-12-31',$4,'rechamada',true) returning id`, [ORG, wf.workflow, wf.version, interactionId])).rows[0]!.id
      const artifact = (await pool.query<{ id: string }>(
        `insert into reliable_feedback_artifacts (organization_id, artifact_key, enrollment_id, node_id, source_node_id, source_type, domain, collaborator_id, interaction_id, contract_version, status, disposition, artifact, completed_at, created_at, updated_at)
         values ($1,$2,$3,'feedback','agent','AGENT','MONITORING',$4,$5,'RELIABLE_FEEDBACK_ARTIFACT_V1','COMPLETED','HOLD_FOR_QA',$6,now(),now(),now()) returning id`,
        [ORG, `proof-engine-${label}-${Math.random()}`, enrollment, operator, interactionId, JSON.stringify({ label, items: [] })],
      )).rows[0]!.id
      const review = (await pool.query<{ id: string }>(
        `insert into reliable_feedback_item_reviews (organization_id, artifact_id, item_index, section, item_kind, subject_label, review_item, wording_source, proposed_wording, review_required_by, created_at)
         values ($1,$2,0,'OPPORTUNITY','MONITORING_DEVELOPMENT_POINT',$3,'{}','WRITER','{"observed":"x","whyItMatters":"","whatYouCanDo":""}','{PILOT_POLICY}',now()) returning id`,
        [ORG, artifact, label],
      )).rows[0]!.id
      return { enrollment, artifact, review }
    }
    const reprocess = await hold("reprocessar")
    const close = await hold("encerrar")
    const listed = await findLegacyHolds(pool, ORG)
    expect(listed.map((entry) => entry.artifactId)).toEqual(expect.arrayContaining([reprocess.artifact, close.artifact]))
    expect(listed.find((entry) => entry.artifactId === reprocess.artifact)).toMatchObject({ waitingAtNode: true, pendingItems: 1 })

    expect(await resolveLegacyHold(pool as never, { organizationId: ORG, artifactId: reprocess.artifact, mode: "REPROCESS", reason: "Prova do motor: reprocessar" })).toMatchObject({ superseded: true, enrollment: "REACTIVATED" })
    expect(await resolveLegacyHold(pool as never, { organizationId: ORG, artifactId: reprocess.artifact, mode: "REPROCESS", reason: "Prova do motor: repetir" })).toMatchObject({ superseded: false })
    expect(await state(reprocess.enrollment)).toMatchObject({ status: "active", current_node_id: "feedback" })
    expect(await resolveLegacyHold(pool as never, { organizationId: ORG, artifactId: close.artifact, mode: "CLOSE", reason: "Prova do motor: encerrar" })).toMatchObject({ superseded: true, enrollment: "CLOSED" })
    expect(await state(close.enrollment)).toMatchObject({ status: "completed" })
    expect((await pool.query("select 1 from workflow_enrollment_events where enrollment_id = $1 and event_type = 'legacy_hold_closed'", [close.enrollment])).rowCount).toBe(1)

    // Nada foi aprovado: os itens continuam PENDING_REVIEW no histórico, mas a decisão é recusada e a lista não os traz mais.
    expect((await pool.query<{ review_status: string }>("select review_status from reliable_feedback_item_reviews where id = $1", [reprocess.review])).rows[0]!.review_status).toBe("PENDING_REVIEW")
    const store = createPostgresReliableFeedbackStore(pool as never)
    const decided = await store.decideReview(ORG, reprocess.review, { status: "APPROVED_UNCHANGED", finalWording: null, reasonCategory: null, comment: null, editWarnings: [], reviewedBy: supervisor, reviewedAt: new Date() } as never, () => "READY" as never)
    expect(decided.written).toBe(false)
    expect((await findLegacyHolds(pool, ORG)).map((entry) => entry.artifactId)).not.toContain(reprocess.artifact)

    // A matrícula reativada roda pelo motor novo (análise → mensagem) — nunca pelo QA.
    useModel()
    await pool.query("update workflow_enrollments set next_eval_at = now() where id = $1", [reprocess.enrollment])
    expect(await drive(reprocess.enrollment)).toMatchObject({ status: "completed" })
    expect((await pool.query("select 1 from feedback_engine_messages where enrollment_id = $1", [reprocess.enrollment])).rowCount).toBe(1)
  })

  it("H) consultas da liderança sobre a memória real: contagens com denominador, recorte por pessoas do escopo e detalhe só dentro dele", async () => {
    const filters = { from: "2026-09-01", to: "2026-09-30", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null }
    const summary = await memorySummary(pool as never, ORG, [operator], filters)
    expect(summary.stats.calls).toBeGreaterThanOrEqual(4)
    expect(summary.stats.assessed).toBe(summary.stats.met + summary.stats.notMet + summary.stats.partial)
    const outside = await memorySummary(pool as never, ORG, [outsider], filters)
    expect(outside.stats.calls).toBe(0)
    const processes = await processAggregates(pool as never, ORG, [operator], { ...filters, status: "DEVIATION" })
    expect(pointsOf(processes).some((row) => `${row.title} ${row.description ?? ""}`.includes("data de nascimento"))).toBe(true)
    const assessmentId = (await pool.query<{ id: string }>("select id from call_assessments where person_id = $1 and is_current limit 1", [operator])).rows[0]!.id
    expect(await assessmentDetail(pool as never, ORG, [operator], assessmentId)).toMatchObject({ id: assessmentId })
    expect(await assessmentDetail(pool as never, ORG, [outsider], assessmentId)).toBeNull()
    expect(await assessmentDetail(pool as never, "00000000-0000-4000-8000-0000000000ff", [operator], assessmentId)).toBeNull()
  })

  it("I) indicador por agenda (fechamento oficial): oficial intacto, localização por assunto, a IA (planejador) escolhe analisar as chamadas do recorte pela MESMA análise do motor e a mensagem sai sem QA", async () => {
    stages.length = 0
    useModel({ composition: { sentences: [
      { text: "Nas chamadas de segunda via analisadas, os dados foram enviados sem confirmar a data de nascimento.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 },
      { text: "Na próxima vez, logo depois de confirmar o nome, peça a data de nascimento antes de enviar qualquer dado da conta.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 },
    ], card: { text: "Confirme a data de nascimento antes de enviar a segunda via.", refs: ["A1"] } } })
    const closure = await resolveOfficialClosure(pool as never, ORG, new Date())
    const period = closure.lastClosedPeriod
    const previous = referencePeriodDates(period).previousPeriod
    const admin = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof Engine Admin', 'ADMIN') returning id", [ORG])).rows[0]!.id
    created.people.push(admin)
    const account = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id", [ORG, admin, `proof-engine-${Date.now()}@inia.local`])).rows[0]!.id
    created.accounts.push(account)
    const actor = { userAccountId: account, personId: admin }
    const indicator = (await pool.query<{ id: string; code: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1,$2,'TMA Prova Motor','SECONDS','LOWER') returning id, code`, [ORG, `PROOF_ENGINE_TMA_${Date.now()}`])).rows[0]!
    created.indicators.push(indicator.id)
    await saveStrategyDraft(pool as never, ORG, indicator.id, { config: { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: true, quartileWorsened: true, recognitionQuartiles: ["Q1"] } } }, actor)
    await publishStrategyDraft(pool as never, ORG, indicator.id, actor)
    // Ferramentas de investigação são do AGENT (lista vazia = nenhuma): o especialista desta prova tem as que o diagnóstico usa.
    await publishAgent(agent, { investigationCapabilities: ["INDICATOR_ANALYSIS", "SEGMENTATION", "INTERACTION_ANALYSIS"] })
    const person = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1, 'Proof Engine Indicador', 'OPERATOR', $2, $3) returning id", [ORG, team, supervisor])).rows[0]!.id
    created.people.push(person)
    for (const [ref, value, achievement, quartile] of [[previous, 330, 109, "Q2"], [period, 450, 80, "Q4"]] as const) {
      await pool.query("insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, quartile, source) values ($1,$2,$3,$4,$5,360,$6,$7,'PROOF')", [ORG, person, indicator.id, ref, value, achievement, quartile])
    }
    // Chamadas do mesmo assunto nos dois meses: mais longas no mês fechado (o recorte que a investigação precisa localizar).
    for (const [ref, seconds] of [[previous, 300], [period, 480]] as const) {
      for (let day = 3; day <= 8; day += 1) {
        const startedAt = new Date(`${ref}-${String(day).padStart(2, "0")}T13:00:00Z`)
        const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Segunda via',$3,$4,$5) returning id`, [ORG, person, startedAt, new Date(startedAt.getTime() + seconds * 1000), `PROOF-ENGINE-IND-${ref}-${day}-${Math.random()}`])).rows[0]!.id
        await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, id, TRANSCRIPT])
        created.interactions.push(id)
      }
    }
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Agenda", position: { x: 0, y: 0 }, config: {} },
        { id: "agent", type: "action", label: "Diagnóstico", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId: agent, scheduledDataSource: { kind: "PERFORMANCE", closures: 1, indicatorCode: indicator.code }, outputContract: "INDICATOR_DIAGNOSIS" } },
        { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 2 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
        { id: "output", type: "output", label: "Feedback", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
      ],
      edges: [["trigger", "agent"], ["agent", "feedback"], ["feedback", "output"], ["output", "end"]].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })),
    }
    const trigger = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 }, intervalDays: 1 }
    const workflow = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1,'Proof Engine · indicador',$2,$3) returning id`, [ORG, JSON.stringify(trigger), JSON.stringify(graph)])).rows[0]!.id
    created.workflows.push(workflow)
    const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [workflow, JSON.stringify(graph)])).rows[0]!.id
    const enrollment = (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id, scheduled_for) values ($1,$2,$3,'trigger','active','2999-01-01',$4,now()) returning id`, [ORG, workflow, version, person])).rows[0]!.id
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })

    const investigation = (await pool.query<{ conclusion: string; official: { value: number; target: number | null }; localization: { segments: { label: string; changeDirection: string; sufficient: boolean }[] }; evidence: { analyzedCalls: number }[]; is_current: boolean }>("select conclusion, official, localization, evidence, is_current from indicator_investigations where person_id = $1", [person])).rows
    expect(investigation).toHaveLength(1)
    expect(investigation[0]!.is_current).toBe(true)
    expect(investigation[0]!.official).toMatchObject({ value: 450, target: 360 })
    expect(investigation[0]!.localization.segments.find((segment) => segment.label === "Segunda via")).toMatchObject({ changeDirection: "WORSE", sufficient: true })
    const analyzed = investigation[0]!.evidence.reduce((sum, entry) => sum + entry.analyzedCalls, 0)
    expect(analyzed).toBeGreaterThanOrEqual(3)
    expect(stages.filter((stage) => stage === "CALL_ANALYSIS").length).toBeLessThanOrEqual(5)
    expect(stages.filter((stage) => stage === "INVESTIGATION_PLANNING").length).toBeGreaterThanOrEqual(1)
    const run = (await pool.query<{ result: { tools: { ledger: { tool: string; status: string }[]; capabilities: { source: string } } } }>("select r.result from indicator_investigations i join feedback_analysis_runs r on r.id = i.analysis_run_id where i.person_id = $1", [person])).rows[0]!
    expect(run.result.tools.ledger.map((entry) => `${entry.tool}:${entry.status}`)).toContain("analyze_calls:OK")
    // Capacidades = as do Agent (nunca deduzidas de lista vazia nem da estratégia).
    expect(run.result.tools.capabilities.source).toBe("AGENT")
    expect(investigation[0]!.conclusion).toBe("PATTERN_SUPPORTED")
    // O fechamento oficial não foi tocado; a mensagem saiu sem QA.
    expect((await pool.query<{ value: string }>("select value from employee_indicator_performance where person_id = $1 and reference_period = $2", [person, period])).rows[0]!.value).toMatch(/^450/)
    const message = (await pool.query<{ status: string; delivered_at: Date | null }>("select status, delivered_at from feedback_engine_messages where enrollment_id = $1", [enrollment])).rows[0]!
    expect(message.status).toBe("PUBLISHABLE")
    expect(message.delivered_at).not.toBeNull()
    expect((await feedbacksOf(person))).toHaveLength(1)

    // Validade e reuso da investigação (Postgres real): mesmas fontes → reuso (inclusive pela chave registrada DEPOIS das análises
    // que a própria investigação fez); chamada NOVA no período com o MESMO oficial → nova revisão vigente, anterior no histórico.
    const { investigateIndicator } = await import("../application/investigate-indicator.js")
    // Mesma marca que o nó do Workflow põe na chave de reuso: a publicação da versão vigente (`loadRunnableEngineAgent`).
    const agentConfiguredAt = (await pool.query<{ published_at: Date }>("select v.published_at from agents a join agent_versions v on v.id = a.current_version_id where a.id = $1", [agent])).rows[0]!.published_at.toISOString()
    // `ONE_INDICATOR_FEEDBACK_PER_PERIOD_V1`: o período já foi entregue à pessoa — uma nova execução não investiga (zero modelo).
    const stagesBeforeSkip = stages.length
    const skipped = await investigateIndicator(createEngineDeps({ db: pool as never }).investigate, { organizationId: ORG, personId: person, agentId: agent, agentConfiguredAt, enrollmentId: enrollment, target: { kind: "OFFICIAL_CLOSING" as const, indicatorCode: indicator.code }, trigger: { kind: "EVALUATION" as const, selectionReason: "prova do período entregue" }, now: new Date() })
    expect(skipped).toEqual({ investigations: [], skippedReason: "PERIOD_ALREADY_DELIVERED" })
    expect(stages.length).toBe(stagesBeforeSkip)
    // Mecânica de reuso/revisão da investigação (simulação, sem entrega): a regra do período não se aplica.
    const again = { organizationId: ORG, personId: person, agentId: agent, agentConfiguredAt, enrollmentId: enrollment, target: { kind: "OFFICIAL_CLOSING" as const, indicatorCode: indicator.code }, trigger: { kind: "EVALUATION" as const, selectionReason: "prova de reuso" }, now: new Date(), skipDeliveredPeriods: false }
    const callsBefore = stages.filter((stage) => stage === "CALL_ANALYSIS").length
    const reused = await investigateIndicator(createEngineDeps({ db: pool as never }).investigate, again)
    expect(reused.investigations[0]).toMatchObject({ reused: true })
    expect(stages.filter((stage) => stage === "CALL_ANALYSIS").length).toBe(callsBefore)
    const startedAt = new Date(`${period}-20T13:00:00Z`)
    const extra = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Segunda via',$3,$4,$5) returning id`, [ORG, person, startedAt, new Date(startedAt.getTime() + 500_000), `PROOF-ENGINE-IND-EXTRA-${Math.random()}`])).rows[0]!.id
    await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, extra, TRANSCRIPT])
    created.interactions.push(extra)
    const revised = await investigateIndicator(createEngineDeps({ db: pool as never }).investigate, { ...again, now: new Date() })
    expect(revised.investigations[0]!.reused).toBe(false)
    const revisions = (await pool.query<{ analysis_run_id: string; is_current: boolean; official: { value: number } }>("select analysis_run_id, is_current, official from indicator_investigations where person_id = $1 order by created_at", [person])).rows
    expect(revisions).toHaveLength(2)
    expect(revisions.map((row) => row.is_current)).toEqual([false, true])
    expect(revisions.every((row) => row.official.value === 450)).toBe(true)
    // A revisão nova não publica de novo o que já saiu para a pessoa (a mensagem é da matrícula; o achado entregue é suprimido).
    expect((await feedbacksOf(person))).toHaveLength(1)

    // Investigação INTERROMPIDA pelo orçamento (SQL real): fica no histórico, mas a chave de reuso é liberada.
    const { createPostgresFeedbackMemoryStore } = await import("../infrastructure/postgres-feedback-memory-store.js")
    const store = createPostgresFeedbackMemoryStore(pool as never)
    const latest = (await pool.query<{ result: unknown }>("select r.result from indicator_investigations i join feedback_analysis_runs r on r.id = i.analysis_run_id where i.person_id = $1 and i.is_current", [person])).rows[0]!.result
    const key = `proof-interrupted-${Math.random()}`
    const claim = await store.claimAnalysis({ organizationId: ORG, kind: "INDICATOR_INVESTIGATION", analysisKey: key, personId: person, interactionId: null, indicatorDefinitionId: indicator.id, periodStart: `${period}-01`, periodEnd: `${period}-28`, agentId: agent, trigger: { kind: "EVALUATION", selectionReason: "prova" }, logicVersion: "INDICATOR_INVESTIGATION_V4", asOf: new Date() }, new Date(), 60)
    if (claim.kind !== "CLAIMED") throw new Error("claim")
    await store.completeIndicatorInvestigation(ORG, claim.runId, { investigation: { ...(latest as object), completeness: { status: "INTERRUPTED_BY_BUDGET", pendingReviews: 0, note: "prova" } } as never, provenance: { reuseKeys: [] }, metrics: {}, reusable: false }, new Date())
    expect(await store.findCompletedByReuseKey(ORG, "INDICATOR_INVESTIGATION", key)).toBeNull()
    expect((await pool.query<{ analysis_key: string; status: string }>("select analysis_key, status from feedback_analysis_runs where id = $1", [claim.runId])).rows[0]).toMatchObject({ status: "COMPLETED", analysis_key: `${key}:INCOMPLETE:${claim.runId}` })
  })

  it("J) revisão com timeout no Workflow: análise SUSPENSA (nada na memória nem na liderança), nó em nova tentativa; recuperado, só a revisão é refeita e a mensagem sai uma vez; retomadas concorrentes não pagam duas vezes", async () => {
    const { createPostgresFeedbackMemoryStore } = await import("../infrastructure/postgres-feedback-memory-store.js")
    const { DomainError } = await import("../../../shared/domain/domain-error.js")
    const store = createPostgresFeedbackMemoryStore(pool as never)
    stages.length = 0
    let reviewFailures = 2 // a tentativa do nó + a nova tentativa transitória do medidor
    const fake = fakeEngineModel()
    control.model = { async generate(request: unknown) {
      const stage = (request as EngineModelRequest).stage
      stages.push(stage)
      if (stage === "CALL_REVIEW" && reviewFailures > 0) {
        reviewFailures -= 1
        throw new DomainError("tempo esgotado", "AI_PROVIDER_TIMEOUT", 504, { category: "TIMEOUT" })
      }
      return fake.model.generate(request as EngineModelRequest)
    } }
    const interactionId = await insertInteraction(new Date("2026-09-26T13:00:00Z"))
    const wf = await insertWorkflow("Proof Engine · revisão pendente")
    const enrollment = await enroll(wf, interactionId)
    const feedbacksBefore = (await feedbacksOf()).length
    const summaryBefore = await memorySummary(pool as never, ORG, [operator], { from: "2026-09-01", to: "2026-09-30", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null })

    // Gatilho → "Chamar agente": a revisão cai (inclusive a nova tentativa transitória do medidor) e o NÓ falha de forma retomável.
    for (let step = 0; step < 3 && (await state(enrollment)).attempts === 0; step += 1) await processEnrollment(pool, await claimed(enrollment))
    expect(await state(enrollment)).toMatchObject({ status: "active", current_node_id: "agent", attempts: 1 })
    const failed = (await pool.query<{ payload: { errorCategory: string; willRetry: boolean; errorCode: string } }>("select payload from workflow_enrollment_events where enrollment_id = $1 and event_type = 'node_failed' order by created_at desc limit 1", [enrollment])).rows[0]!.payload
    expect(failed).toMatchObject({ errorCategory: "TRANSIENT_PROVIDER_ERROR", willRetry: true, errorCode: "FEEDBACK_CALL_REVIEW_PENDING" })
    expect(stages).toEqual(["CALL_ANALYSIS", "CALL_REVIEW", "CALL_REVIEW"])
    const suspended = (await pool.query<{ id: string; status: string; result: { checkpoint: { stage: string; reason: string } } }>("select id, status, result from feedback_analysis_runs where interaction_id = $1", [interactionId])).rows
    expect(suspended).toHaveLength(1)
    expect(suspended[0]).toMatchObject({ status: "FAILED", result: { checkpoint: { stage: "REVIEW_PENDING", reason: "TECHNICAL" } } })
    expect((await pool.query("select 1 from call_assessments where interaction_id = $1", [interactionId])).rowCount).toBe(0)
    expect(await store.pendingReviewInteractions(ORG, [interactionId])).toEqual(new Set([interactionId]))
    const summaryPending = await memorySummary(pool as never, ORG, [operator], { from: "2026-09-01", to: "2026-09-30", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null })
    expect(summaryPending.callOutcomes.total).toBe(summaryBefore.callOutcomes.total)

    // Provedor recuperado: a nova tentativa do nó retoma a MESMA execução e paga só a revisão; a mensagem sai uma vez.
    const before = stages.length
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(stages.slice(before)).toEqual(["CALL_REVIEW", "COMPOSITION", "VERIFICATION"])
    expect((await pool.query<{ id: string; status: string }>("select id, status from feedback_analysis_runs where interaction_id = $1", [interactionId])).rows).toEqual([{ id: suspended[0]!.id, status: "COMPLETED" }])
    expect((await pool.query("select 1 from call_assessments where interaction_id = $1 and is_current", [interactionId])).rowCount).toBe(1)
    expect(await store.pendingReviewInteractions(ORG, [interactionId])).toEqual(new Set())
    expect((await feedbacksOf()).length).toBe(feedbacksBefore + 1)

    // Leitura gravada antes da correção como "concluída" sem revisão: fora das agregações da liderança e marcada como pendente.
    await pool.query("update feedback_analysis_runs set outcome_reasons = array_append(outcome_reasons, 'REVIEW_UNAVAILABLE') where id = $1", [suspended[0]!.id])
    const summaryLegacy = await memorySummary(pool as never, ORG, [operator], { from: "2026-09-01", to: "2026-09-30", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null })
    expect(summaryLegacy.callOutcomes.total).toBe(summaryPending.callOutcomes.total)
    expect(await store.pendingReviewInteractions(ORG, [interactionId])).toEqual(new Set([interactionId]))
    await pool.query("update feedback_analysis_runs set outcome_reasons = array_remove(outcome_reasons, 'REVIEW_UNAVAILABLE') where id = $1", [suspended[0]!.id])

    // Duas retomadas CONCORRENTES (conexões diferentes) da mesma revisão pendente: uma paga, a outra espera.
    reviewFailures = 2
    const other = await insertInteraction(new Date("2026-09-27T13:00:00Z"))
    const request = { organizationId: ORG, interactionId: other, collaboratorId: operator, agentId: agent, trigger: { kind: "EVALUATION" as const, selectionReason: "Prova de retomada concorrente" } }
    await expect(analyzeCall(createEngineDeps({ db: pool as never }).analyze, request)).rejects.toMatchObject({ code: "FEEDBACK_CALL_REVIEW_PENDING" })
    stages.length = 0
    useModel({}, 400)
    const settled = await Promise.allSettled([analyzeCall(createEngineDeps({ db: pool as never }).analyze, request), analyzeCall(createEngineDeps({ db: pool as never }).analyze, request)])
    expect(stages).toEqual(["CALL_REVIEW"])
    expect(settled.filter((entry) => entry.status === "fulfilled")).toHaveLength(1)
    for (const entry of settled) if (entry.status === "rejected") expect((entry.reason as { code?: string }).code).toBe("FEEDBACK_ANALYSIS_IN_PROGRESS")
    expect((await pool.query("select 1 from call_assessments where interaction_id = $1", [other])).rowCount).toBe(1)
  })
  it("K) mesma omissão em duas regras: a revisão liga → UMA ocorrência por chamada, duas fontes preservadas; chamadas diferentes nunca se unem; registro antigo sem ligação fica fora da taxa por conduta — da análise à rota HTTP e ao CSV", async () => {
    const operatorK = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1, 'Proof Engine Ocorrências', 'OPERATOR', $2, $3) returning id", [ORG, team, supervisor])).rows[0]!.id
    created.people.push(operatorK)
    const agentK = (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,'Proof Engine · Ocorrências','CALL_FEEDBACK','Avaliar segunda via','Prova do motor','Avalie a chamada pelo procedimento.') returning id`, [ORG])).rows[0]!.id
    created.agents.push(agentK)
    const transfer = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,'Procedimento — Transferência','PROCEDURE','TEXT') returning id", [ORG])).rows[0]!.id
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, effective_from) values ($1,$2,1,$3,'PUBLISHED',md5($3),'2026-01-01')", [ORG, transfer, "# Procedimento — Transferência\n\n## 1. Antes de transferir ou encerrar\n\n- Informar o número do protocolo antes de transferir ou encerrar a chamada.\n"])
    created.documents.push(transfer)
    const checklist = (await pool.query<{ id: string }>("select id from knowledge_documents where id = any($1::uuid[]) and title like 'Checklist%'", [created.documents])).rows[0]!.id
    for (const documentId of [procedureDoc, checklist, transfer]) await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agentK, documentId])
    const obligations = (handle: (text: string) => string) => ({
      need: { summary: "O cliente precisa da segunda via da fatura.", conditions: [] },
      sources: { primary: "D1", related: [], rationale: "Procedimento da segunda via." },
      argumentScripts: [], notAssessed: [], sourceConflicts: [], limitations: [],
      conduct: { pathTaken: "Validou o nome e encerrou.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou o protocolo." },
      obligations: [
        { id: "OBL-NOME", sources: [handle("Confirmar nome completo")], action: "Confirmar o nome completo", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "MET", evidence: [{ turn: "T3", speaker: "OPERADOR", quote: "Me confirma seu nome completo?", role: "CONDUCT" }], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", rationale: "Pediu o nome completo.", guidance: null },
        { id: "OBL-PROT-CHECK", sources: [handle("informe o protocolo")], action: "Informar o protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "CENTRAL", rationale: "Encerrou sem informar o protocolo.", guidance: { moment: "Antes de encerrar", action: "Informe o número do protocolo." } },
        { id: "OBL-PROT-TRANSF", sources: [handle("Informar o número do protocolo antes de transferir")], action: "Informar o número do protocolo antes de encerrar", condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", finding: "NOT_MET", evidence: [], opportunityTurn: "T9", materiality: "HIGH", role: "SUPPORTING", rationale: "O protocolo não foi informado.", guidance: null },
      ],
    })
    const linking = (payload: Parameters<typeof confirmAllObligations>[0]) => {
      const review = confirmAllObligations(payload)
      return { ...review, claims: review.claims.map((claim) => (claim.id === "O3" ? { ...claim, sameConductAs: "O2" } : claim)) }
    }
    const analyzeOn = async (date: string, legacy: boolean) => {
      const interactionId = await insertInteraction(new Date(date), operatorK)
      useModel(legacy ? {} : { analysis: obligations, obligationReview: linking })
      await analyzeCall(createEngineDeps({ db: pool as never }).analyze, { organizationId: ORG, interactionId, collaboratorId: operatorK, agentId: agentK, trigger: { kind: "EVALUATION" as const, selectionReason: "Prova de ocorrências" } })
      return interactionId
    }
    const first = await analyzeOn("2026-07-10T13:00:00Z", false)
    const second = await analyzeOn("2026-07-13T13:00:00Z", false)
    // Leitura do contrato anterior (por linha, sem revisão capaz de ligar regras): ligação NÃO determinável.
    const legacy = await analyzeOn("2026-07-14T13:00:00Z", true)

    // PERSISTÊNCIA: as duas regras do protocolo da mesma chamada compartilham a chave; outra chamada tem outra chave; legado = null.
    const rows = async (interactionId: string) => (await pool.query<{ status: string; criterion_text: string; occurrence_key: string | null; occurrence_basis: string | null }>("select status, criterion_text, occurrence_key, occurrence_basis from call_criterion_assessments where interaction_id = $1 and is_current order by criterion_text", [interactionId])).rows
    const protocolOf = (list: Awaited<ReturnType<typeof rows>>) => list.filter((row) => row.status === "NOT_MET" && /protocolo/.test(row.criterion_text))
    const firstProtocol = protocolOf(await rows(first))
    const secondProtocol = protocolOf(await rows(second))
    expect(firstProtocol).toHaveLength(2)
    expect(firstProtocol.map((row) => row.occurrence_basis)).toEqual(["REVIEW_SAME_CONDUCT", "REVIEW_SAME_CONDUCT"])
    expect(new Set(firstProtocol.map((row) => row.occurrence_key)).size).toBe(1)
    expect(secondProtocol.map((row) => row.occurrence_key)).toEqual([secondProtocol[0]!.occurrence_key, secondProtocol[0]!.occurrence_key])
    expect(secondProtocol[0]!.occurrence_key).not.toBe(firstProtocol[0]!.occurrence_key)
    expect((await rows(first)).find((row) => row.status === "MET")).toMatchObject({ occurrence_basis: "SINGLE_RULE" })
    const legacyRows = await rows(legacy)
    expect(legacyRows.length).toBeGreaterThan(0)
    expect(legacyRows.every((row) => row.occurrence_key === null && row.occurrence_basis === null)).toBe(true)
    const legacyAssessed = legacyRows.filter((row) => ["MET", "NOT_MET", "PARTIAL"].includes(row.status)).length
    const legacyDeviations = legacyRows.filter((row) => ["NOT_MET", "PARTIAL"].includes(row.status)).length

    // CONSULTAS: por regra, nada muda de significado; por conduta, as duas regras contam uma vez POR CHAMADA; o legado fica de fora.
    const filters = { from: "2026-07-01", to: "2026-07-31", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null }
    const summary = await memorySummary(pool as never, ORG, [operatorK], filters)
    expect(summary.stats.notMet + summary.stats.partial).toBe(4 + legacyDeviations)
    expect(summary.stats.assessed).toBe(6 + legacyAssessed)
    expect(summary.stats.occurrences).toMatchObject({ basis: "PARTIAL", deviations: 2, deviationRules: 4, sharedDeviationRules: 4, assessed: 4, assessedRules: 6, met: 2, undeterminedAssessedRules: legacyAssessed, deviationRate: 50 })
    const onlyNew = await memorySummary(pool as never, ORG, [operatorK], { ...filters, to: "2026-07-13" })
    expect(onlyNew.stats.occurrences).toMatchObject({ basis: "FULL", deviations: 2, undeterminedAssessedRules: 0 })
    const onlyLegacy = await memorySummary(pool as never, ORG, [operatorK], { ...filters, from: "2026-07-14" })
    expect(onlyLegacy.stats.occurrences).toMatchObject({ basis: "NONE", deviations: 0, deviationRate: null })
    const people = await peopleAggregates(pool as never, ORG, [operatorK], filters, "PERSON", { limit: 10, offset: 0 })
    expect(people.items[0]).toMatchObject({ key: operatorK, occurrences: { deviations: 2, deviationRules: 4 } })
    const processes = await processAggregates(pool as never, ORG, [operatorK], { ...filters, status: "DEVIATION" })
    const protocolRows = pointsOf(processes).filter((row) => /protocolo/.test(`${row.title} ${row.description ?? ""}`))
    expect(protocolRows).toHaveLength(2)
    for (const row of protocolRows) expect(row).toMatchObject({ notMet: 2, occurrences: { sharedDeviationRules: 2 } })

    // APRESENTAÇÃO (rota real, sessão da supervisora): o resumo traz o bloco de ocorrências; o CSV traz as colunas; a avaliação mostra a outra fonte.
    const app = express()
    app.use((req, _res, next) => {
      req.user = { sub: "00000000-0000-4000-8000-00000000abcd", personId: supervisor, organizationId: ORG, role: "SUPERVISOR", name: "Supervisora", email: "sup@proof.inia", avatarUrl: null, jobTitle: null, teamId: team, teamName: null } as never
      next()
    })
    app.use("/diagnostics", createDiagnosticsRouter(pool as never))
    app.use(((error, _req, res, next) => { void next; res.status(500).json({ error: String((error as Error).stack ?? error) }) }) as import("express").ErrorRequestHandler)
    const query = `from=2026-07-01&to=2026-07-31&personId=${operatorK}`
    const response = await supertest(app).get(`/diagnostics/memory/summary?${query}`)
    expect(response.status, JSON.stringify(response.body).slice(0, 600)).toBe(200)
    expect(response.body.data.stats.occurrences).toMatchObject({ basis: "PARTIAL", deviations: 2, deviationRules: 4, undeterminedAssessedRules: legacyAssessed })
    expect(response.body.data.method).toMatch(/OCORRÊNCIAS de conduta/)
    const csv = await supertest(app).get(`/diagnostics/memory/export.csv?${query}&view=people&groupBy=PERSON`)
    // Preâmbulo: cada linha é UMA célula escapada (achado C12) — a que tem `;` ou aspas (método, filtros) sai entre aspas, `"# …"`.
    const lines = csv.text.replace(/^\uFEFF/, "").split("\r\n").filter((line) => !/^"?#/.test(line) && line.trim())
    const header = lines[0]!.split(";")
    const values = lines[1]!.split(";")
    expect(values[header.indexOf("Ocorrências de desvio (condutas distintas)")]).toBe("2")
    expect(values[header.indexOf("Taxa de desvio")]).toBe(`${Math.round(((4 + legacyDeviations) / (6 + legacyAssessed)) * 1000) / 10}%`)
    expect(values[header.indexOf("Regras avaliadas sem ligação determinável")]).toBe(String(legacyAssessed))
    const assessmentId = (await pool.query<{ id: string }>("select id from call_assessments where interaction_id = $1 and is_current", [first])).rows[0]!.id
    const detail = await supertest(app).get(`/diagnostics/memory/assessments/${assessmentId}`)
    const linked = (detail.body.data.criteria as { text: string; occurrence: { basis: string; sameConductAs: { text: string }[] } | null }[]).filter((criterion) => criterion.occurrence?.basis === "REVIEW_SAME_CONDUCT")
    expect(linked).toHaveLength(2)
    expect(linked[0]!.occurrence!.sameConductAs.map((other) => other.text)).toEqual([linked[1]!.text])
    const legacyAssessment = (await pool.query<{ id: string }>("select id from call_assessments where interaction_id = $1 and is_current", [legacy])).rows[0]!.id
    const legacyDetail = await supertest(app).get(`/diagnostics/memory/assessments/${legacyAssessment}`)
    expect((legacyDetail.body.data.criteria as { occurrence: unknown }[]).every((criterion) => criterion.occurrence === null)).toBe(true)
  })

  it("L) parcial (o que foi feito + protocolo) × regra do protocolo: a PARTE descumprida é UMA ocorrência; ato exigido, parte julgada, divergência e necessidade central gravados e lidos pela liderança", async () => {
    const operatorL = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1, 'Proof Engine Parte Descumprida', 'OPERATOR', $2, $3) returning id", [ORG, team, supervisor])).rows[0]!.id
    created.people.push(operatorL)
    const agentL = (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,'Proof Engine · Parte descumprida','CALL_FEEDBACK','Avaliar segunda via','Prova do motor','Avalie a chamada pelo procedimento.') returning id`, [ORG])).rows[0]!.id
    created.agents.push(agentL)
    const closing = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,'Procedimento — Encerramento com resumo','PROCEDURE','TEXT') returning id", [ORG])).rows[0]!.id
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash, effective_from) values ($1,$2,1,$3,'PUBLISHED',md5($3),'2026-01-01')", [ORG, closing, "# Procedimento — Encerramento com resumo\n\n## 1. Antes de encerrar\n\nAntes de encerrar, informar:\n- O que foi feito no atendimento;\n- O número do protocolo.\n"])
    created.documents.push(closing)
    const checklist = (await pool.query<{ id: string }>("select id from knowledge_documents where id = any($1::uuid[]) and title like 'Checklist%'", [created.documents])).rows[0]!.id
    for (const documentId of [procedureDoc, checklist, closing]) await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agentL, documentId])
    const base = { condition: null, conditionHolds: "NOT_CONDITIONAL", conditionEvidence: [], items: [], itemsMode: "NONE", where: "IN_CONVERSATION", evidence: [], opportunityTurn: null, materiality: "HIGH", role: "CENTRAL", guidance: null }
    const said = { turn: "T7", speaker: "OPERADOR", quote: "Vou enviar por e-mail agora mesmo." }
    const holder: { handle?: (text: string) => string } = {}
    const birthDate = (handle: (text: string) => string, finding: string, where: string) => ({ ...base, id: "OBL-NASC", sources: [handle("Confirmar data de nascimento")], action: "Confirmar a data de nascimento", where, finding, opportunityTurn: finding === "NOT_MET" ? "T4" : null, role: "SUPPORTING", rationale: finding === "NOT_MET" ? "Só o nome foi confirmado." : "Pode ter sido validada em sistema." })
    useModel({
      analysis: (handle) => {
        holder.handle = handle
        return {
          need: { summary: "O cliente precisa da segunda via da fatura.", conditions: [] },
          sources: { primary: "D1", related: [], rationale: "Procedimento da segunda via." },
          argumentScripts: [], notAssessed: [], sourceConflicts: [], limitations: [],
          conduct: { pathTaken: "Validou o nome, enviou por e-mail e encerrou.", assessment: "PARTIALLY_CORRECT", rationale: "Faltou o protocolo." },
          obligations: [
            { ...base, id: "OBL-ENC", sources: [handle("Antes de encerrar, informar"), handle("O que foi feito no atendimento"), handle("O número do protocolo")], action: "Informar o que foi feito e o número do protocolo antes de encerrar", finding: "PARTIAL", items: [{ text: "O que foi feito", line: handle("O que foi feito no atendimento"), status: "DONE" }, { text: "Número do protocolo", line: handle("O número do protocolo"), status: "NOT_DONE" }], itemsMode: "ALL", evidence: [{ ...said, role: "CONDUCT" }], opportunityTurn: "T9", rationale: "Disse o que faria; faltou o protocolo.", guidance: { moment: "Antes de encerrar", action: "Informe o número do protocolo." } },
            { ...base, id: "OBL-PROT", sources: [handle("informe o protocolo")], action: "Informar o protocolo antes de encerrar", finding: "NOT_MET", opportunityTurn: "T9", role: "ROUTINE", rationale: "Nenhum protocolo foi dito." },
            { ...base, id: "OBL-ENVIO", sources: [handle("Enviar a segunda via pelo canal")], action: "Enviar a segunda via pelo canal escolhido e dizer ao cliente por onde ela vai", finding: "MET", evidence: [{ ...said, role: "CONDUCT" }], rationale: "Disse ao cliente que a segunda via vai por e-mail." },
            birthDate(handle, "NOT_VERIFIABLE", "OUTSIDE_CONVERSATION"),
          ],
        }
      },
      obligationReview: (payload, labelsOf) => {
        const handle = holder.handle!
        const review = confirmAllObligations(payload, labelsOf)
        return {
          ...review,
          need: { status: "NOT_DETERMINABLE", requiredGuidance: "Dizer ao cliente como acompanhar o envio.", sources: [handle("O número do protocolo")], heard: [said], unknown: "Se o cliente recebeu algum registro do atendimento.", note: null },
          missed: [{ ...birthDate(handle, "NOT_MET", "IN_CONVERSATION"), id: undefined }],
          claims: review.claims.map((claim) => (claim.id === "O2" ? { ...claim, sameConductAs: "O1" } : claim.id === "O3" ? { ...claim, actPlace: "MIXED", judgedPart: "dizer ao cliente por onde a segunda via vai", outsidePart: "enviar a segunda via" } : claim)),
        }
      },
    })
    const interactionId = await insertInteraction(new Date("2026-07-16T13:00:00Z"), operatorL)
    await analyzeCall(createEngineDeps({ db: pool as never }).analyze, { organizationId: ORG, interactionId, collaboratorId: operatorL, agentId: agentL, trigger: { kind: "EVALUATION" as const, selectionReason: "Prova da parte descumprida" } })

    type Row = { status: string; criterion_text: string; occurrence_key: string | null; occurrence_basis: string | null; verification: { review?: { actPlace?: string; judgedPart?: string | null }; judgedPart?: string; operationalPart?: { text: string; executionClaim: string }; divergence?: { outcome: string; analysisStatus: string; reviewStatus: string } } }
    const rows = (await pool.query<Row>("select status, criterion_text, occurrence_key, occurrence_basis, verification from call_criterion_assessments where interaction_id = $1 and is_current order by criterion_text", [interactionId])).rows
    // OCORRÊNCIA: a parcial (o que foi feito ✓, protocolo ✗) e a regra só do protocolo — a parte que faltou é a mesma conduta.
    const adverse = rows.filter((row) => row.status === "NOT_MET" || row.status === "PARTIAL")
    const protocol = adverse.filter((row) => /protocolo/.test(row.criterion_text))
    expect(protocol.map((row) => row.status).sort()).toEqual(["NOT_MET", "PARTIAL"])
    expect(protocol.map((row) => row.occurrence_basis)).toEqual(["REVIEW_SAME_CONDUCT", "REVIEW_SAME_CONDUCT"])
    expect(new Set(protocol.map((row) => row.occurrence_key)).size).toBe(1)
    // MISTA: só a parte da conversa julgada; a parte operacional gravada à parte. A fala tem UM papel (aqui, a conduta de dizer o canal):
    // sobre o envio em si ela não é tomada como declaração nem execução (NONE) — nunca mais do que a análise atribuiu.
    const sending = rows.find((row) => /Enviar a segunda via/.test(row.criterion_text))!
    expect(sending).toMatchObject({ status: "MET", verification: { review: { actPlace: "MIXED", judgedPart: "dizer ao cliente por onde a segunda via vai" }, judgedPart: "dizer ao cliente por onde a segunda via vai", operationalPart: { text: "enviar a segunda via", executionClaim: "NONE" } } })
    // DIVERGÊNCIA: a análise deixou de lado ("fora da conversa"); a revisão contestou; a confirmação decidiu — UMA linha, com o registro.
    const birth = rows.filter((row) => /data de nascimento/.test(row.criterion_text))
    expect(birth).toHaveLength(1)
    expect(birth[0]).toMatchObject({ status: "NOT_MET", verification: { divergence: { outcome: "REVIEW_READING_CONFIRMED", analysisStatus: "NOT_OBSERVABLE", reviewStatus: "NOT_MET" } } })
    // NECESSIDADE CENTRAL: resposta própria, gravada no cenário com as linhas literais.
    const scenario = (await pool.query<{ scenario: { centralNeed?: { resolution: string; sourceLines: { text: string }[]; heard: { turn: string }[] } } }>("select scenario from call_assessments where interaction_id = $1 and is_current", [interactionId])).rows[0]!.scenario
    expect(scenario.centralNeed).toMatchObject({ resolution: "NOT_DETERMINABLE", sourceLines: [{ text: "- O número do protocolo." }], heard: [{ turn: "T7" }] })

    // LIDERANÇA: por regra, 3 desvios (protocolo ×2 + nascimento); por conduta, 2 ocorrências; o processo mostra as duas regras do protocolo.
    const filters = { from: "2026-07-16", to: "2026-07-16", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null }
    const summary = await memorySummary(pool as never, ORG, [operatorL], filters)
    expect(summary.stats.notMet + summary.stats.partial).toBe(3)
    expect(summary.stats.occurrences).toMatchObject({ basis: "FULL", deviations: 2, deviationRules: 3, sharedDeviationRules: 2 })
    // A obrigação mista conta como avaliada, mas a liderança vê que a conclusão vale só para a parte da conversa.
    expect(summary.stats.conversationPartOnly).toBe(1)
    const people = await peopleAggregates(pool as never, ORG, [operatorL], filters, "PERSON", { limit: 10, offset: 0 })
    expect(people.items[0]).toMatchObject({ key: operatorL, occurrences: { deviations: 2, deviationRules: 3 } })
    const processes = await processAggregates(pool as never, ORG, [operatorL], { ...filters, status: "DEVIATION" })
    // Cada regra é um ponto próprio aqui (o modelo falso não junta práticas): os dois pontos ligados pela mesma conduta na chamada.
    const protocolRows = pointsOf(processes).filter((row) => row.occurrences.sharedDeviationRules > 0)
    expect(protocolRows).toHaveLength(2)
    for (const row of protocolRows) expect(row).toMatchObject({ occurrences: { sharedDeviationRules: 1 } })
    const assessmentId = (await pool.query<{ id: string }>("select id from call_assessments where interaction_id = $1 and is_current", [interactionId])).rows[0]!.id
    const detail = await assessmentDetail(pool as never, ORG, [operatorL], assessmentId)
    const linked = (detail!.criteria as { text: string; occurrence: { basis: string; sameConductAs: { text: string }[] } | null }[]).filter((criterion) => criterion.occurrence?.basis === "REVIEW_SAME_CONDUCT")
    expect(linked).toHaveLength(2)
  })

  it("M) FEEDBACK_FIRMNESS_V1: a mesma prática orientada num retorno ENTREGUE e errada de novo numa chamada posterior → insistência, com a data e o histórico por prática", async () => {
    stages.length = 0
    useModel()
    // O retorno da prova A foi entregue agora; esta chamada acontece DEPOIS da entrega (orientação anterior só conta se veio antes).
    const delivered = (await pool.query<{ brief: { developments: { practiceKeys?: string[]; firmness?: { level: string } }[] }; delivered_at: Date }>("select brief, delivered_at from feedback_engine_messages where person_id = $1 and status = 'PUBLISHABLE' and delivered_at is not null order by delivered_at limit 1", [operator])).rows[0]!
    const practice = delivered.brief.developments[0]!.practiceKeys![0]!
    expect(practice).toMatch(/^K[CP]-/)
    const interactionId = await insertInteraction(new Date(delivered.delivered_at.getTime() + 60_000))
    const wf = await insertWorkflow("Proof Engine · insistência")
    const enrollment = await enroll(wf, interactionId)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    const brief = (await pool.query<{ brief: { developments: { practiceKeys?: string[]; firmness?: { level: string; basis: string[] }; history: string | null }[] } }>("select brief from feedback_engine_messages where enrollment_id = $1", [enrollment])).rows[0]!.brief
    const point = brief.developments.find((finding) => (finding.practiceKeys ?? []).includes(practice))!
    expect(point.firmness).toMatchObject({ level: "INSIST" })
    expect(point.firmness!.basis[0]).toMatch(/já foi orientado num retorno entregue em \d{2}\/\d{2}\/\d{4}/)
    // Histórico pela PRÁTICA (a chamada anterior da prova A conta, mesmo com outra identidade de obrigação).
    expect(point.history).toMatch(/Nas chamadas anteriores, esta etapa .* analisadas em que se aplicava/)
  })

  it("N) PRACTICE_IDENTITY_V1: duas regras de documentos diferentes que pedem a mesma conduta viram UM ponto na liderança, com as duas fontes; memória e orientação anterior (chave antiga KC-) seguem a prática", async () => {
    const memory = createPostgresFeedbackMemoryStore(pool as never)
    const operatorK = (await pool.query<{ id: string }>("select id from people where organization_id = $1 and name = 'Proof Engine Ocorrências' and id = any($2::uuid[])", [ORG, created.people])).rows[0]!.id
    // As duas regras do protocolo (checklist e transferência) que a prova K avaliou — cada uma organizada como prática própria pelo modelo falso.
    const lines = (await pool.query<{ line_key: string; text: string }>(
      "select distinct split_part(verification->>'lineKey', '#', 1) line_key, criterion_text text from call_criterion_assessments where person_id = $1 and criterion_text ilike '%protocolo%' and is_current",
      [operatorK],
    )).rows
    expect(lines.length).toBe(2)
    const before = await processAggregates(pool as never, ORG, [operatorK], { from: "2026-01-01", to: "2026-12-31", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null })
    const separated = pointsOf(before).filter((row) => row.sources.some((source) => source.documentTitle.startsWith("Checklist") || source.documentTitle.includes("Transferência")) && row.notMet + row.partial > 0)
    expect(separated.length).toBe(2)
    // O modelo (aqui, a decisão gravada) diz que as duas pedem a MESMA conduta: uma prática, as duas linhas.
    const stored = await memory.practiceMemberships(ORG, lines.map((entry) => entry.line_key))
    const sourceOf = (await pool.query<{ line_key: string; source_id: string; source_title: string; source_version: number; section_heading: string | null; rule_text: string }>("select line_key, source_id, source_title, source_version, section_heading, rule_text from knowledge_practice_members where line_key = any($1::text[])", [lines.map((entry) => entry.line_key)])).rows
    expect(stored.size).toBe(2)
    await pool.query("delete from knowledge_practice_members where line_key = any($1::text[])", [lines.map((entry) => entry.line_key)])
    const practiceKey = "KP-0000000000a1"
    await memory.savePracticeAssignments(ORG, {
      practices: [{ practiceKey, title: "Informar o protocolo ao cliente" }],
      members: sourceOf.map((entry) => ({ line: { lineKey: entry.line_key, sourceKind: "KNOWLEDGE" as const, sourceId: entry.source_id, sourceVersion: entry.source_version, sourceTitle: entry.source_title, heading: entry.section_heading, leadIn: null, text: entry.rule_text }, practiceKey, basis: "NEW_PRACTICE" as const })),
      unassigned: [],
    }, { identityVersion: "PRACTICE_IDENTITY_V1", model: "prova" }, new Date())
    const after = await processAggregates(pool as never, ORG, [operatorK], { from: "2026-01-01", to: "2026-12-31", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null })
    const merged = pointsOf(after).filter((row) => row.practiceKey === practiceKey)
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ title: "Informar o protocolo ao cliente", organized: true, rules: 2 })
    expect(merged[0]!.sources.map((source) => source.documentTitle).sort()).toEqual([...new Set(sourceOf.map((entry) => entry.source_title))].sort())
    expect(after.totalPoints).toBe(before.totalPoints - 1)
    // Filtro do drill pela prática: as regras das duas fontes.
    const drilled = await processAggregates(pool as never, ORG, [operatorK], { from: "2026-01-01", to: "2026-12-31", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null, practiceKey })
    expect(pointsOf(drilled).map((row) => row.practiceKey)).toEqual([practiceKey])
    // Memória do motor: as duas regras carregam a mesma prática (histórico e padrões contam juntos).
    const snapshot = await memory.currentMemory(ORG, { personIds: [operatorK] })
    const protocolRows = snapshot.criteria.filter((row) => lines.some((entry) => entry.line_key === row.anchorLineKey))
    expect(new Set(protocolRows.map((row) => row.practiceKey))).toEqual(new Set([practiceKey]))
    expect(protocolRows.every((row) => row.practiceTitle === "Informar o protocolo ao cliente")).toBe(true)
    // Obrigação que começa pela ABERTURA de uma lista (sem conduta): a prática vem da primeira linha de origem que pede conduta.
    const opening = "open0000test"
    await pool.query("insert into knowledge_practice_members (organization_id, line_key, practice_key, basis, source_kind, source_id, source_version, source_title, rule_text, identity_version) values ($1,$2,null,'NO_CONDUCT','KNOWLEDGE',$3,1,'Prova','Antes de encerrar:','PRACTICE_IDENTITY_V1')", [ORG, opening, sourceOf[0]!.source_id])
    const target = (await pool.query<{ id: string }>("select id from call_criterion_assessments where person_id = $1 and split_part(verification->>'lineKey', '#', 1) <> all($2::text[]) and is_current limit 1", [operatorK, lines.map((entry) => entry.line_key)])).rows[0]!.id
    await pool.query("update call_criterion_assessments set verification = verification || jsonb_build_object('lineKey', $2::text, 'sourceLineKeys', jsonb_build_array($3::text, $4::text)) where id = $1", [target, `${opening}#prova`, opening, lines[0]!.line_key])
    const viaItem = (await memory.currentMemory(ORG, { personIds: [operatorK] })).criteria.find((row) => row.anchorLineKey === opening)!
    expect(viaItem).toMatchObject({ practiceKey, sourceLineKeys: [opening, lines[0]!.line_key] })
    // Obrigação de VÁRIAS linhas em que nenhuma linha pede conduta sozinha (análise antiga, sem linhas de origem): organizada como
    // regra COMPOSTA pela chave inteira — a leitura ganha o ponto dela em vez de ficar pelo texto cru das linhas.
    const compositeLineKey = `${opening}#composta`
    await pool.query("update call_criterion_assessments set verification = (verification - 'sourceLineKeys') || jsonb_build_object('lineKey', $2::text) where id = $1", [target, compositeLineKey])
    const compositeKey = "KP-0000000000a2"
    await memory.savePracticeAssignments(ORG, {
      practices: [{ practiceKey: compositeKey, title: "Cumprir o checklist de encerramento" }],
      members: [{ line: { lineKey: compositeLineKey, sourceKind: "KNOWLEDGE" as const, sourceId: sourceOf[0]!.source_id, sourceVersion: 1, sourceTitle: "Prova", heading: null, leadIn: null, text: "Antes de encerrar:\n(1) confirme a solução aplicada;", combined: true }, practiceKey: compositeKey, basis: "NEW_PRACTICE" as const }],
      unassigned: [],
    }, { identityVersion: "PRACTICE_IDENTITY_V1", model: "prova" }, new Date())
    const viaComposite = (await memory.currentMemory(ORG, { personIds: [operatorK] })).criteria.find((row) => row.anchorLineKey === opening)!
    expect(viaComposite).toMatchObject({ practiceKey: compositeKey, practiceTitle: "Cumprir o checklist de encerramento", obligationLineKey: compositeLineKey })
    await pool.query("delete from knowledge_practice_members where line_key = $1", [opening])

    // TEMA (`PRACTICE_THEMES_V1`): o ponto aparece pelo NOME CURTO dentro do tema, com a conduta completa como descrição; as contagens
    // do tema são as dos pontos que ele mostra.
    const themeKey = "KT-0000000000b1"
    await memory.savePracticeThemes(ORG, { themes: [{ themeKey, title: "Encerramento" }], assignments: [{ practiceKey, themeKey, shortTitle: "Protocolo", basis: "NEW_THEME" }], unassigned: [] }, { themeVersion: "PRACTICE_THEMES_V1", model: "prova" }, new Date())
    const themed = await processAggregates(pool as never, ORG, [operatorK], { from: "2026-01-01", to: "2026-12-31", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null })
    const closing = themed.themes.find((theme) => theme.themeKey === themeKey)!
    expect(closing).toMatchObject({ title: "Encerramento", points: 1 })
    expect(closing.items).toHaveLength(1)
    expect(closing.items[0]).toMatchObject({ practiceKey, title: "Protocolo", description: "Informar o protocolo ao cliente", rules: 2 })
    expect({ assessed: closing.assessed, notMet: closing.notMet, met: closing.met }).toEqual({ assessed: closing.items[0]!.assessed, notMet: closing.items[0]!.notMet, met: closing.items[0]!.met })
    expect(themed.themes.flatMap((theme) => theme.items)).toHaveLength(themed.listedPoints)
    // Visões DIFERENTES: onde se erra = só pontos com desvio; onde se acerta = só com acerto; todos = os avaliados.
    const allFilters = { from: "2026-01-01", to: "2026-12-31", teamId: null, subteamId: null, personId: null, subject: null, documentId: null, criterionKey: null, status: null }
    const [errs, hits, every] = await Promise.all((["DEVIATIONS", "MET", "ALL"] as const).map((order) => processAggregates(pool as never, ORG, [operatorK], allFilters, order)))
    expect(pointsOf(errs!).every((point) => point.notMet + point.partial > 0)).toBe(true)
    expect(pointsOf(hits!).every((point) => point.met > 0)).toBe(true)
    expect(pointsOf(every!)).toHaveLength(every!.totalPoints)
    expect(pointsOf(errs!).length + pointsOf(hits!).length).toBeGreaterThanOrEqual(every!.totalPoints)
    // Pontos ainda sem tema ficam num grupo à parte, sempre por último.
    expect(themed.themes.findIndex((theme) => theme.themeKey === null)).toBe(themed.themes.some((theme) => theme.themeKey === null) ? themed.themes.length - 1 : -1)

    // Retorno ENTREGUE antes da organização guardava a chave da linha-âncora (KC-…): conta para a prática da linha.
    const message = (await pool.query<{ id: string; delivered_at: Date | null }>("select id, delivered_at from feedback_engine_messages where person_id = $1 and status = 'PUBLISHABLE' and delivered_at is not null order by delivered_at limit 1", [operator])).rows[0]!
    const developments = (await pool.query<{ brief: { developments: { findingKey: string; practiceKeys?: string[] }[] } }>("select brief from feedback_engine_messages where id = $1", [message.id])).rows[0]!.brief.developments
    const legacyLine = (await pool.query<{ line_key: string }>("select line_key from knowledge_practice_members where practice_key = $1 limit 1", [developments[0]!.practiceKeys![0]])).rows[0]!
    expect(developments[0]!.practiceKeys![0]).toMatch(/^KP-/)
    await pool.query(
      "update feedback_engine_messages set brief = jsonb_set(brief, '{developments,0,practiceKeys}', $2::jsonb) where id = $1",
      [message.id, JSON.stringify([`KC-${legacyLine.line_key}`])],
    )
    expect((await memory.deliveredPractices(ORG, operator, [developments[0]!.practiceKeys![0]!], new Date("2999-01-01"))).map((entry) => entry.practiceKey)).toEqual([developments[0]!.practiceKeys![0]])
  })

  it("P) `HIDDEN_ARTIFACT_NOT_DELIVERED_V1`: retorno OCULTO do Acompanhamento (artefato de desenvolvimento) não conta como ponto já entregue nem como orientação anterior; restaurado, volta a contar", async () => {
    const memory = createPostgresFeedbackMemoryStore(pool as never)
    const message = (await pool.query<{ id: string; finding_keys: string[]; brief: { developments: { practiceKeys?: string[] }[] }; delivered_at: Date }>("select id, finding_keys, brief, delivered_at from feedback_engine_messages where person_id = $1 and status = 'PUBLISHABLE' and delivered_at is not null order by delivered_at limit 1", [operator])).rows[0]!
    // Orientação anterior: só o que foi entregue até este retorno (o primeiro da pessoa) — os retornos posteriores das outras provas ficam fora.
    const untilThisMessage = new Date(message.delivered_at.getTime() + 1)
    // A prova N trocou a chave do ponto pela da linha-âncora (KC-…): vale a prática da linha, como na leitura.
    const briefKeys = message.brief.developments.flatMap((finding) => finding.practiceKeys ?? [])
    const practiceKeys = [...briefKeys, ...(await pool.query<{ practice_key: string }>("select practice_key from knowledge_practice_members where practice_key is not null and 'KC-' || line_key = any($1::text[])", [briefKeys])).rows.map((row) => row.practice_key)]
    const feedback = (await pool.query<{ id: string }>("select id from feedbacks where context_snapshot -> 'feedbackEngine' ->> 'messageId' = $1", [message.id])).rows[0]!
    const countNow = async () => ({
      findings: (await memory.deliveredFindings(ORG, operator, message.finding_keys)).filter((entry) => entry.messageId === message.id).length,
      practices: (await memory.deliveredPractices(ORG, operator, practiceKeys, untilThisMessage)).length,
    })
    const before = await countNow()
    expect(before.findings).toBeGreaterThan(0)
    expect(before.practices).toBeGreaterThan(0)
    await pool.query("insert into feedback_follow_up_hides (organization_id, feedback_id, reason_code, reason, selection_ref, hidden_at) values ($1, $2, 'DEVELOPMENT_ARTIFACT', 'prova', 'PROOF_HIDDEN_ARTIFACT', now())", [ORG, feedback.id])
    expect(await countNow()).toEqual({ findings: 0, practices: 0 })
    await pool.query("update feedback_follow_up_hides set restored_at = now(), restore_reason = 'prova' where feedback_id = $1 and restored_at is null", [feedback.id])
    expect(await countNow()).toEqual(before)
  })
})
