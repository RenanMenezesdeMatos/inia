/**
 * PROVA contra o banco de TESTE real (Indicator Diagnosis V2): diagnóstico DIRETO de UM indicador, SEM fechamento do PRV, pelo
 * MESMO motor do TMA. Workflow por Agenda → "Chamar agente" (formato "Diagnóstico do indicador" + fonte "Fechamentos oficiais" +
 * indicador) → "Gerar feedback" → Output → Acompanhamento. Mesmo processamento de matrícula do tick (`processEnrollment`). ZERO
 * chamada de modelo real: o gateway responde por propósito. Nenhuma linha em `employee_prv_performance` existe nos cenários.
 *   INIA_DB_PROOF=1 npx vitest run direct-indicator-diagnosis-proof
 *
 * Cenários: R1 Rechamada (estratégia AGENT_SELECTED + sinal) — IA escolhe passos, indisponível recusado, sem vínculo = sem crítica,
 * feedback com título do indicador e período, gestão com denominadores · R2 idempotência + rascunho não substitui a publicada ·
 * R3 nova versão publicada = novo diagnóstico · R4 planejador fora do contrato 2× = padrão determinístico · T1 indicador de duração
 * (estratégia FIXA, a do TMA) pelo MESMO pipeline direto: processo avaliado, padrão agregado, denominador só de conclusivas.
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
  plannerPrompts: [] as string[],
  plannerReply: (() => ({ selectedSteps: [], notSelected: [] })) as () => unknown,
  agentPrompts: [] as string[],
  lastAgentPrompt: "",
  agentReply: (() => ({})) as (prompt: string) => unknown,
  narrativeReply: null as null | { paragraphs: string[]; card: string; supervisorNotes: string[] },
}))
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  return {
    ...original,
    generateForRoute: async (request: { classification?: { purpose?: string; tags?: string[] }; contents?: { text: string }[]; systemPrompt?: string }) => {
      if (request.classification?.tags?.includes("stage:PRV_DIAGNOSIS_NARRATIVE")) {
        control.calls.push("PRV_NARRATIVE")
        return reply(control.narrativeReply ?? { paragraphs: [], card: "", supervisorNotes: [] })
      }
      const purpose = request.classification?.purpose ?? "?"
      control.calls.push(purpose)
      if (purpose === "PLANNING") {
        control.plannerPrompts.push((request.contents ?? []).map((content) => content.text).join("\n"))
        const value = control.plannerReply()
        return typeof value === "string" ? { ...reply({}), text: value } : reply(value)
      }
      if (purpose === "ASSESSMENT_COVERAGE_REPAIR") {
        const user = (request.contents ?? []).map((content) => content.text).join("\n")
        return reply({ assessments: [...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => ({ checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [] })) })
      }
      if (purpose === "AGENT_SYNTHESIS") {
        const prompt = (request.contents ?? []).map((content) => content.text).join("\n")
        control.agentPrompts.push(prompt)
        control.lastAgentPrompt = [request.systemPrompt ?? "", prompt].join("\n")
        return reply(control.agentReply(prompt))
      }
      throw new Error(`request inesperada na prova: ${purpose}`)
    },
  }
})

const { env } = await import("../../../config/env.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { resolveOfficialClosure } = await import("../../indicators/application/official-closure.js")
const { referencePeriodDates, referencePeriodLabel } = await import("../domain/prv-closing.js")
const { saveStrategyDraft, publishStrategyDraft } = await import("../application/diagnostic-strategy-service.js")
const { emptyStrategyConfig } = await import("../domain/diagnostic-strategy.js")
const { DIRECT_DIAGNOSIS_LOGIC_VERSION } = await import("../domain/prv-investigation.js")
const { validateWorkflowForPublish } = await import("../../workflows/application/validate-workflow-for-publish.js")

void process.env.INIA_DB_PROOF
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], interactions: [] as string[], workflows: [] as string[], agents: [] as string[], indicators: [] as string[], accounts: [] as string[], documents: [] as string[], subteams: [] as string[], flags: [] as string[] }

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
    if (before.status === "completed" || before.status === "dead" || (before.status === "waiting" && before.next_eval_at > new Date("2100-01-01"))) return before
    await processEnrollment(pool, await claimed(id))
    const after = await state(id)
    if (after.attempts > before.attempts) throw new Error(`nó ${before.current_node_id} falhou: ${JSON.stringify((await pool.query(`select payload from workflow_enrollment_events where enrollment_id = $1 and event_type in ('node_failed','flow_dead') order by created_at desc limit 1`, [id])).rows[0])}`)
  }
  return state(id)
}

// APOSENTADA (motor de feedback FEEDBACK_ENGINE_V1): "Gerar feedback" não usa mais o diagnóstico em artefato confiável; a investigação
// de indicador do caminho atual é provada em `feedback-engine/testing/feedback-engine-workflow-proof.test.ts` (cenário I). Mantida
// como histórico até a remoção explícita do arquivo.
describe.skip("Indicator Diagnosis V2 — diagnóstico DIRETO de um indicador (sem PRV): prova Postgres (motor real, zero chamada de modelo real)", () => {
  const stamp = Date.now()
  const tag = stamp.toString(36).replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!)
  const FLAG = `rechamada_prova_${tag}`
  const CONTESTACAO = `Contestação V2 ${tag}`
  const SEGUNDA_VIA = `Segunda via V2 ${tag}`
  const PLANO = `Plano V2 ${tag}`
  const TITLE = `Prova V2 · Contestação ${tag}`
  const RULE = "Confirme com o cliente o valor contestado e o mês da fatura antes de abrir a contestação."
  const GAP_QUOTE = "Vou abrir a contestação agora mesmo."
  const DONE_QUOTE = "Vou abrir a contestação do valor de junho que o senhor confirmou."
  const TRANSCRIPT_GAP = ["CLIENTE: Quero contestar a fatura de junho.", `OPERADOR: ${GAP_QUOTE}`, "CLIENTE: Tá bom."].join("\n")
  const TRANSCRIPT_DONE = ["CLIENTE: Quero contestar a fatura de junho.", "OPERADOR: Qual o valor e o mês da fatura?", "CLIENTE: Junho, cento e vinte reais.", `OPERADOR: ${DONE_QUOTE}`].join("\n")
  let team: string
  let agent: string
  let document: string
  let flagId: string
  let recall: { id: string; code: string; strategyVersionId: string; workflow: { workflow: string; version: string } }
  let duration: { id: string; code: string; strategyVersionId: string; workflow: { workflow: string; version: string } }
  let actor: { userAccountId: string; personId: string }
  let period: string
  let previousPeriod: string

  const day = (referencePeriod: string, dayOfMonth: number, hourUtc = 13) => `${referencePeriod}-${String(dayOfMonth).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00Z`
  const person = async (name: string) => {
    const subteam = (await pool.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1,$2,$3) returning id", [ORG, team, `${name} ${tag}`])).rows[0]!.id
    created.subteams.push(subteam)
    const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1,$2,'OPERATOR',$3,$4) returning id", [ORG, name, team, subteam])).rows[0]!.id
    created.people.push(id)
    return id
  }
  const interaction = async (personId: string, reason: string, startedAt: string, seconds: number, transcript: string | null, signaled = false) => {
    const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,$3,$4,$5,$6) returning id`, [ORG, personId, reason, startedAt, new Date(new Date(startedAt).getTime() + seconds * 1000), `PROOF-V2-${stamp}-${Math.random()}`])).rows[0]!.id
    if (transcript) await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, id, transcript])
    if (signaled) await pool.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean) values ($1,$2,$3,true)`, [ORG, id, flagId])
    created.interactions.push(id)
    return id
  }
  /** Fechamento OFICIAL de UM indicador (contrato OFFICIAL_INDICATOR_PERFORMANCE) — nenhuma linha de PRV. */
  const officialClosing = async (personId: string, indicatorId: string, rows: { period: string; value: number; target: number; achievement: number; quartile: string }[]) => {
    for (const row of rows) await pool.query("insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, quartile, source) values ($1,$2,$3,$4,$5,$6,$7,$8,'PROOF')", [ORG, personId, indicatorId, row.period, row.value, row.target, row.achievement, row.quartile])
  }
  const enroll = async (personId: string, target: { workflow: string; version: string }) =>
    (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id, scheduled_for) values ($1,$2,$3,'trigger','active','2999-01-01',$4,now()) returning id`, [ORG, target.workflow, target.version, personId])).rows[0]!.id
  const artifactOf = async (enrollment: string) => (await pool.query<{ disposition: string; prv_closing_key: string | null; artifact: { label: string; blockedReason: string | null; items: { kind: string; decision: { disposition: string } }[]; prvClosing?: { diagnosis: { version: string; source?: { kind: string; indicatorCode: string }; prv: unknown; investigations: Record<string, unknown>[] } } } }>("select disposition, prv_closing_key, artifact from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows[0]
  const publishedOf = async (personId: string) => (await pool.query<{ id: string; impacted_indicator: string; recommendation: string; context_snapshot: { reliableFeedback: { feedbackView?: { heading?: { title: string; subtitle: string }; narrative: string[]; card: string; cycle?: { title: string; indicators: { lines: { label: string; value: string }[]; notes: string[] }[] }; developments: { title: string }[] }; supervisorView?: { source?: { kind: string }; indicators: Record<string, unknown>[] }; prvClosing?: { source?: { kind: string } } } } }>("select id, impacted_indicator, recommendation, context_snapshot from feedbacks where operator_id = $1 order by created_at", [personId])).rows
  const workflowFor = async (indicatorCode: string, label: string) => {
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Agenda mensal", position: { x: 0, y: 0 }, config: {} },
        { id: "agent", type: "action", label: `Diagnóstico · ${label}`, position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId: agent, scheduledDataSource: { kind: "PERFORMANCE", closures: 1, indicatorCode }, outputContract: "INDICATOR_DIAGNOSIS" } },
        { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 2 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
        { id: "output", type: "output", label: "Feedback ao colaborador", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: "always" }, { id: "e2", source: "agent", target: "feedback", sourceHandle: "always" }, { id: "e3", source: "feedback", target: "output", sourceHandle: "always" }, { id: "e4", source: "output", target: "end", sourceHandle: "always" }],
    }
    const trigger = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 }, intervalDays: 1 }
    const id = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1,$2,$3,$4) returning id`, [ORG, `Prova V2 ${label} ${tag}`, JSON.stringify(trigger), JSON.stringify(graph)])).rows[0]!.id
    created.workflows.push(id)
    const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [id, JSON.stringify(graph)])).rows[0]!.id
    return { workflow: id, version, graph, trigger }
  }
  const assessingAgent = (prompt: string) => {
    const refs = [...prompt.matchAll(/=== (I\d+) · [\d-]+ ===\n([\s\S]*?)(?=\n\n=== I|$)/g)].map((match) => ({ ref: match[1]!, done: match[2]!.includes(DONE_QUOTE) }))
    const found = new RegExp(`\\[(CP-[0-9a-f]{10})[^\\]]*\\]\\s*(?:[-*•]\\s*)?${RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(control.lastAgentPrompt)
    return {
      title: "Diagnóstico", summary: "Avaliação dos atendimentos.", relatedProcedure: TITLE, recommendation: "Confirme o valor antes de abrir.",
      interactionAssessments: refs.map(({ ref, done }) => ({ interactionRef: ref, processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: [{ ...(found ? { checkpointRef: found[1]! } : {}), requirement: "Confirmar valor e mês antes de abrir a contestação", status: done ? "FOLLOWED" : "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [done ? DONE_QUOTE : GAP_QUOTE], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: "Confirme o valor e o mês antes de abrir." }, uncertainty: null }] }] } })),
    }
  }
  const recallConfig = (instructions: string) => ({
    ...emptyStrategyConfig(),
    segmentation: { enabled: true, dimensions: ["SUBJECT" as const], minimumSegmentInteractions: 3 },
    interactionInvestigation: { enabled: true, maxInteractions: 10, minimumAnalyzed: 3, minimumCoveragePercent: null, maxRepairInteractions: 5 },
    processAssessment: { enabled: true, population: "LINKED_PREVIOUS_OF_SIGNAL" as const },
    closingTriage: { enabled: true, developmentQuartiles: ["Q3" as const, "Q4" as const], belowTarget: true, quartileWorsened: true, recognitionQuartiles: ["Q1" as const] },
    populationSignal: { kind: "INTERACTION_FLAG" as const, flagName: FLAG },
    investigation: { mode: "AGENT_SELECTED" as const, objective: "Entender onde as rechamadas aparecem nos atendimentos do colaborador, sem transformar associação em causa.", instructions, allowedSteps: ["SIGNAL_DISTRIBUTION" as const, "SIGNAL_EVOLUTION" as const, "REASON_MIX_SHIFT" as const, "PROCESS_ASSESSMENT" as const], prohibitedClaims: ["reduzirá a rechamada"] },
  })

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const closure = await resolveOfficialClosure(pool as never, ORG, new Date())
    period = closure.lastClosedPeriod
    previousPeriod = referencePeriodDates(period).previousPeriod
    flagId = (await pool.query<{ id: string }>("insert into channel_flags (organization_id, channel, flag_name, value_type, description) values ($1,'VOICE',$2,'BOOLEAN','Prova V2 — novo contato sobre o mesmo motivo') returning id", [ORG, FLAG])).rows[0]!.id
    created.flags.push(flagId)
    document = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,$2,'PROCEDURE','TEXT') returning id", [ORG, TITLE])).rows[0]!.id
    created.documents.push(document)
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1,$2,1,$3,'PUBLISHED',$4)", [ORG, document, `## Abertura da contestação\n- ${RULE}\n- Registre a contestação no sistema.`, `proof-v2-${document}`])
    await pool.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1,'ALL_TEAMS')", [document])
    agent = (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,'Proof V2 · Investigador','CALL_FEEDBACK','Investigar indicadores','Prova V2','Avalie os processos dos atendimentos.') returning id`, [ORG])).rows[0]!.id
    created.agents.push(agent)
    await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agent, document])
    const admin = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof V2 Admin', 'ADMIN') returning id", [ORG])).rows[0]!.id
    created.people.push(admin)
    const account = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id", [ORG, admin, `proof-v2-${stamp}@inia.local`])).rows[0]!.id
    created.accounts.push(account)
    actor = { userAccountId: account, personId: admin }

    // Rechamada: taxa (percentual, menor é melhor) — o catálogo é metadata; o sinal (flag) é da ESTRATÉGIA, nunca do código.
    const recallId = (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction, operational_aggregation) values ($1,$2,'Rechamada Prova','PERCENT','LOWER','RATE') returning id`, [ORG, `PROOF_V2_REC_${stamp}`])).rows[0]!.id
    created.indicators.push(recallId)
    await saveStrategyDraft(pool as never, ORG, recallId, { config: recallConfig("Veja a situação oficial e a evolução; veja por motivo onde as rechamadas se concentram; atendimentos anteriores só com vínculo confiável.") }, actor)
    const recallVersion = (await publishStrategyDraft(pool as never, ORG, recallId, actor)).published!.id
    const recallCode = (await pool.query<{ code: string }>("select code from indicator_definitions where id = $1", [recallId])).rows[0]!.code
    const recallWorkflow = await workflowFor(recallCode, "Rechamada")
    recall = { id: recallId, code: recallCode, strategyVersionId: recallVersion, workflow: { workflow: recallWorkflow.workflow, version: recallWorkflow.version } }
    // O Workflow direto PUBLICA (mesma validação do botão Publicar): Agenda + "Fechamentos oficiais" + indicador + estratégia publicada.
    await validateWorkflowForPublish(pool as never, ORG, recallWorkflow.workflow, { scopeType: "ORGANIZATION", teamId: null, subteamId: null, draftGraph: recallWorkflow.graph, triggerConfig: recallWorkflow.trigger as never, consolidatedStructure: null })

    // Duração (a MESMA estratégia FIXA do TMA): o indicador de tempo pelo pipeline direto.
    const durationId = (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1,$2,'TMA Prova Direta','SECONDS','LOWER') returning id`, [ORG, `PROOF_V2_TMA_${stamp}`])).rows[0]!.id
    created.indicators.push(durationId)
    await saveStrategyDraft(pool as never, ORG, durationId, { config: { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: false, quartileWorsened: false, recognitionQuartiles: ["Q1"] } } }, actor)
    const durationVersion = (await publishStrategyDraft(pool as never, ORG, durationId, actor)).published!.id
    const durationCode = (await pool.query<{ code: string }>("select code from indicator_definitions where id = $1", [durationId])).rows[0]!.code
    const durationWorkflow = await workflowFor(durationCode, "TMA")
    duration = { id: durationId, code: durationCode, strategyVersionId: durationVersion, workflow: { workflow: durationWorkflow.workflow, version: durationWorkflow.version } }
  })

  afterAll(async () => {
    if (!pool) return
    const people = created.people
    await pool.query("delete from workflow_output_emissions where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    const feedbacks = (await pool.query<{ id: string; case_id: string }>("select id, case_id from feedbacks where operator_id = any($1::uuid[])", [people])).rows
    await pool.query("delete from feedback_support_materials where feedback_id = any($1::uuid[])", [feedbacks.map((row) => row.id)])
    await pool.query("delete from case_timeline_events where case_id = any($1::uuid[])", [feedbacks.map((row) => row.case_id)])
    await pool.query("delete from feedbacks where operator_id = any($1::uuid[])", [people])
    await pool.query("delete from evidences where case_id = any($1::uuid[])", [feedbacks.map((row) => row.case_id)])
    await pool.query("delete from supervision_cases where operator_id = any($1::uuid[])", [people])
    await pool.query("delete from prv_closing_diagnoses where person_id = any($1::uuid[])", [people])
    await pool.query("delete from process_checkpoint_observations where person_id = any($1::uuid[])", [people])
    await pool.query("delete from reliable_feedback_artifacts where collaborator_id = any($1::uuid[])", [people])
    await pool.query("delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))", [created.workflows])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from agent_runs where agent_id = any($1::uuid[])", [created.agents])
    await pool.query("delete from agent_knowledge_documents where agent_id = any($1::uuid[])", [created.agents])
    await pool.query("delete from agents where id = any($1::uuid[])", [created.agents])
    await pool.query("delete from employee_indicator_performance where person_id = any($1::uuid[])", [people])
    await pool.query("delete from indicator_diagnostic_strategy_versions where strategy_id in (select id from indicator_diagnostic_strategies where indicator_definition_id = any($1::uuid[]))", [created.indicators]).catch(() => undefined)
    await pool.query("delete from indicator_diagnostic_strategies where indicator_definition_id = any($1::uuid[])", [created.indicators]).catch(() => undefined)
    await pool.query("delete from indicator_definitions where id = any($1::uuid[])", [created.indicators]).catch(() => undefined)
    await pool.query("delete from knowledge_document_org_scopes where knowledge_document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_versions where document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_documents where id = any($1::uuid[])", [created.documents])
    await pool.query("delete from interaction_flags where interaction_id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from transcripts where interaction_id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from channel_flags where id = any($1::uuid[])", [created.flags])
    await pool.query("delete from access_role_assignments where user_account_id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from user_accounts where id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from audit_logs where actor_id = any($1::uuid[])", [people])
    await pool.query("delete from people where id = any($1::uuid[])", [people])
    await pool.query("delete from subteams where id = any($1::uuid[])", [created.subteams])
    await pool.end()
  })

  /** 48 atendimentos no período (14 de Contestação com 5 rechamadas) + 44 no anterior (3 rechamadas); nenhuma linha de PRV. */
  async function recallPopulation(operator: string) {
    await officialClosing(operator, recall.id, [{ period, value: 14.6, target: 10, achievement: 68.5, quartile: "Q4" }, { period: previousPeriod, value: 9.8, target: 10, achievement: 102, quartile: "Q2" }])
    let index = 0
    const add = async (month: string, reason: string, count: number, signaled: number) => {
      for (let item = 0; item < count; item += 1) {
        index += 1
        await interaction(operator, reason, day(month, 1 + (index % 27), 11 + (index % 6)), 400, "OPERADOR: Bom dia.\nCLIENTE: Liguei de novo sobre a fatura.", item < signaled)
      }
    }
    await add(period, CONTESTACAO, 14, 5)
    await add(period, SEGUNDA_VIA, 20, 1)
    await add(period, PLANO, 14, 1)
    await add(previousPeriod, CONTESTACAO, 12, 1)
    await add(previousPeriod, SEGUNDA_VIA, 22, 1)
    await add(previousPeriod, PLANO, 10, 1)
  }

  it("R1. Rechamada direto (sem PRV): a IA lê a estratégia e escolhe passos; indisponível recusado; sem vínculo = nenhuma crítica; feedback do indicador e do período; gestão com denominadores", async () => {
    const operator = await person("Proof V2 Operadora R1")
    await recallPopulation(operator)
    expect((await pool.query("select 1 from employee_prv_performance where person_id = $1", [operator])).rowCount).toBe(0)
    control.calls.length = 0
    control.plannerPrompts.length = 0
    // A IA pede também o processo (indisponível pelo contrato de dados) e um passo inexistente: o sistema recusa os dois.
    control.plannerReply = () => ({ selectedSteps: [{ step: "SIGNAL_DISTRIBUTION", purpose: "ver em que motivos as rechamadas aparecem" }, { step: "SIGNAL_EVOLUTION", purpose: "comparar com o período anterior" }, { step: "PROCESS_ASSESSMENT", purpose: "avaliar os atendimentos anteriores" }, { step: "PICK_PEERS", purpose: "comparar com colegas" }], notSelected: [{ step: "REASON_MIX_SHIFT", reason: "o sinal já mostra a composição" }] })
    control.narrativeReply = null
    const enrollment = await enroll(operator, recall.workflow)
    expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    // Custo: 1 planejamento. Nenhum Agent de avaliação (o passo de processo é indisponível), nenhum redator (nada a interpretar).
    expect(control.calls).toEqual(["PLANNING"])
    const plannerPrompt = control.plannerPrompts[0]!
    expect(plannerPrompt).toContain("atendimentos anteriores só com vínculo confiável")
    expect(plannerPrompt).toContain("INDISPONÍVEL: os dados de interação não trazem vínculo com o atendimento anterior")
    expect(plannerPrompt).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/)

    const artifact = (await artifactOf(enrollment))!
    expect(artifact.prv_closing_key).toMatch(new RegExp(`^${DIRECT_DIAGNOSIS_LOGIC_VERSION}:${period}:`))
    expect(artifact.artifact.label).toBe(`Rechamada Prova · ${referencePeriodLabel(period)}`)
    const diagnosis = artifact.artifact.prvClosing!.diagnosis
    expect(diagnosis).toMatchObject({ version: DIRECT_DIAGNOSIS_LOGIC_VERSION, source: { kind: "DIRECT_INDICATOR", indicatorCode: recall.code }, prv: null })
    const investigation = diagnosis.investigations[0] as { strategy: unknown; conclusion: { type: string; developmentPatterns: string[] }; steps: { mode: string; selected: string[]; rejected: { step: string; reason: string }[]; planner: { status: string; agentRunId: string } }; signal: { distribution: { signaled: number; interactions: number; concentration: { signaled: number } | null } }; evidenceGap: unknown; sample: { analyzedCount: number } }
    expect(investigation.strategy).toEqual({ versionId: recall.strategyVersionId, version: 1 })
    expect(investigation.steps).toMatchObject({ mode: "AGENT_SELECTED", selected: ["SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION"], planner: { status: "SELECTED" } })
    expect(investigation.steps.rejected.map((entry) => [entry.step, entry.reason])).toEqual([["PROCESS_ASSESSMENT", "UNAVAILABLE"], ["PICK_PEERS", "UNKNOWN_STEP"]])
    expect(investigation.signal.distribution).toMatchObject({ signaled: 7, interactions: 48, concentration: { signaled: 5 } })
    expect(investigation.evidenceGap).toEqual({ step: "PROCESS_ASSESSMENT", reason: "DATA_CONTRACT_NO_INTERACTION_LINK" })
    expect(investigation.conclusion).toMatchObject({ type: "MIX_SHIFT", developmentPatterns: [] })
    expect(investigation.sample.analyzedCount).toBe(0)
    // Auditoria do planejador: a execução do Agent guarda a entrada (estratégia + fatos) e a escolha — nunca raciocínio livre.
    const plannerRun = (await pool.query<{ status: string; output_text: string }>("select status, output_text from agent_runs where id = $1", [investigation.steps.planner.agentRunId])).rows[0]!
    expect(plannerRun.status).toBe("COMPLETED")
    expect(JSON.parse(plannerRun.output_text)).toHaveProperty("selectedSteps")
    // Só o resultado oficial vira item (nenhum padrão comportamental) — e segue: nada é inventado.
    expect(artifact.artifact.items.map((item) => [item.kind, item.decision.disposition])).toEqual([["INDICATOR_TARGET_NOT_MET", "READY"]])
    expect(await pool.query("select 1 from process_checkpoint_observations where person_id = $1", [operator]).then((result) => result.rowCount)).toBe(0)

    const [published] = await publishedOf(operator)
    expect(published!.impacted_indicator).toBe(`Rechamada Prova · ${referencePeriodLabel(period)}`)
    const view = published!.context_snapshot.reliableFeedback.feedbackView!
    expect(view.heading!.title).toBe("Rechamada Prova")
    expect(view.heading!.subtitle.toLowerCase()).toBe(referencePeriodLabel(period))
    const text = [view.card, ...view.narrative, published!.recommendation].join(" ")
    expect(text).not.toMatch(/fechamento do PRV|PRV/i)
    expect(text).not.toMatch(/porque|por causa|causou|provocou|reduzirá|vai reduzir/i)
    expect(view.narrative.join(" ")).toContain("Das 48 interações que você atendeu no período, 7 chegaram marcadas como")
    expect(view.narrative.join(" ")).toContain("não indicam qual atendimento anterior o originou")
    expect(view.developments).toEqual([])
    const supervisor = published!.context_snapshot.reliableFeedback.supervisorView!
    expect(supervisor.source).toMatchObject({ kind: "DIRECT_INDICATOR" })
    expect(supervisor.indicators[0]).toMatchObject({ strategy: { versionId: recall.strategyVersionId, version: 1 }, signal: { signaled: 7, interactions: 48 }, evidenceGap: "os dados de interação não trazem vínculo com o atendimento anterior" })
    // A verdade diagnóstica versionada, com a origem direta.
    expect((await pool.query("select source_kind, logic_version, strategy_versions from prv_closing_diagnoses where person_id = $1", [operator])).rows).toEqual([{ source_kind: "DIRECT_INDICATOR", logic_version: DIRECT_DIAGNOSIS_LOGIC_VERSION, strategy_versions: [{ indicatorCode: recall.code, strategyVersionId: recall.strategyVersionId }] }])

    // R2 (idempotência): mesma fonte + mesma versão = nenhuma chamada, nenhum segundo feedback; um RASCUNHO novo não substitui a publicada.
    await saveStrategyDraft(pool as never, ORG, recall.id, { config: recallConfig("Rascunho que ainda não foi publicado.") }, actor)
    control.calls.length = 0
    const again = await enroll(operator, recall.workflow)
    expect(await drive(again)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual([])
    expect((await artifactOf(again))!.artifact.blockedReason).toBe("PRV_CLOSING_ALREADY_DIAGNOSED")
    expect(await publishedOf(operator)).toHaveLength(1)

    // R3: nova versão PUBLICADA = diagnóstico novo (o anterior continua gravado).
    const v2 = (await publishStrategyDraft(pool as never, ORG, recall.id, actor)).published!
    expect(v2.version).toBe(2)
    control.calls.length = 0
    const third = await enroll(operator, recall.workflow)
    expect(await drive(third)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual(["PLANNING"])
    expect((await pool.query("select strategy_versions from prv_closing_diagnoses where person_id = $1 order by created_at", [operator])).rows.map((row) => (row.strategy_versions as { strategyVersionId: string }[])[0]!.strategyVersionId)).toEqual([recall.strategyVersionId, v2.id])
  })

  it("R4. resposta do planejador fora do contrato 2× (inclusive com um id de equipe): padrão determinístico — todos os passos permitidos e disponíveis; nenhum escopo da IA", async () => {
    const operator = await person("Proof V2 Operador R4")
    await recallPopulation(operator)
    control.calls.length = 0
    control.plannerReply = () => ({ selectedSteps: [{ step: "SIGNAL_DISTRIBUTION", purpose: "x", teamId: "00000000-0000-4000-8000-000000000999" }], notSelected: [] })
    const enrollment = await enroll(operator, (await pool.query<{ workflow_id: string; id: string }>("select workflow_id, id from workflow_versions where workflow_id = $1 order by created_at desc limit 1", [recall.workflow.workflow])).rows.map((row) => ({ workflow: row.workflow_id, version: row.id }))[0]!)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual(["PLANNING", "PLANNING"])
    const investigation = (await artifactOf(enrollment))!.artifact.prvClosing!.diagnosis.investigations[0] as { steps: { selected: string[]; planner: { status: string; attempts: number; error: string } } }
    expect(investigation.steps.planner).toMatchObject({ status: "FALLBACK_DEFAULT", attempts: 2, error: "PLAN_SCHEMA_INVALID" })
    expect(investigation.steps.selected).toEqual(["REASON_MIX_SHIFT", "SIGNAL_DISTRIBUTION", "SIGNAL_EVOLUTION"])
  })

  it("T1. indicador de duração com a estratégia FIXA do TMA pelo MESMO pipeline direto (sem PRV): processo avaliado, padrão agregado, denominador só de conclusivas", async () => {
    const operator = await person("Proof V2 Operadora T1")
    await officialClosing(operator, duration.id, [{ period, value: 495, target: 450, achievement: 90.9, quartile: "Q4" }])
    for (const [index, dayOfMonth] of [3, 6, 11, 14, 18].entries()) await interaction(operator, CONTESTACAO, day(period, dayOfMonth), index === 1 ? 1500 : 800, index === 1 ? TRANSCRIPT_DONE : TRANSCRIPT_GAP)
    for (const dayOfMonth of [4, 9, 16]) await interaction(operator, SEGUNDA_VIA, day(period, dayOfMonth), 240, "OPERADOR: Segunda via enviada.")
    control.calls.length = 0
    control.agentPrompts.length = 0
    control.agentReply = assessingAgent
    control.narrativeReply = null
    const enrollment = await enroll(operator, duration.workflow)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    // FIXO: nenhuma chamada de planejamento; o Agent avalia as chamadas do motivo (mesmo contrato do fechamento do PRV).
    expect(control.calls.filter((call) => call === "PLANNING")).toEqual([])
    expect(control.calls[0]).toBe("AGENT_SYNTHESIS")
    const artifact = (await artifactOf(enrollment))!
    const investigation = artifact.artifact.prvClosing!.diagnosis.investigations[0] as { steps: { mode: string }; conclusion: { type: string }; patterns: { behaviors: { eligible: number; counts: { followed: number; notFollowed: number; notObservable: number } }[] } }
    expect(investigation.steps.mode).toBe("FIXED")
    expect(investigation.conclusion.type).toBe("ACTIONABLE_PATTERN")
    const behavior = investigation.patterns.behaviors[0]!
    // Denominador = só avaliações conclusivas (seguido + não seguido elegíveis); não observável fica fora.
    expect(behavior.eligible).toBe(behavior.counts.followed + behavior.counts.notFollowed)
    expect(behavior.counts.notFollowed).toBeGreaterThanOrEqual(3)
    const [published] = await publishedOf(operator)
    expect(published!.context_snapshot.reliableFeedback.feedbackView!.heading!.title).toBe("TMA Prova Direta")
    expect((await pool.query("select source_kind from prv_closing_diagnoses where person_id = $1", [operator])).rows).toEqual([{ source_kind: "DIRECT_INDICATOR" }])
  })
})
