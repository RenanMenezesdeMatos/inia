/**
 * PROVA contra o banco de TESTE real (Indicator Diagnosis V1): fechamento OFICIAL do PRV → Workflow por Agenda → "Chamar agente"
 * (Diagnóstico do fechamento do PRV: triagem + população + reuso + amostra; Agent só para o que falta) → "Gerar feedback"
 * (verificação, agregação determinística, projeções) → Output → Acompanhamento. Mesmo processamento de matrícula do tick
 * (`processEnrollment`). ZERO chamada de modelo real: o gateway responde por propósito. Dados COMMITADOS e apagados no fim.
 *   INIA_DB_PROOF=1 npx vitest run prv-closing-diagnosis-proof
 *
 * Cenários (pedido): A padrão acionável · B TMA dentro da meta (reconhecimento) · C sem padrão · D mudança de mix ·
 * E concentração por dia · F padrão do grupo não vira crítica individual · G reuso (+ idempotência) · H preflight sem IA.
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
  agentPrompts: [] as string[],
  lastAgentPrompt: "",
  agentReply: (() => ({})) as (prompt: string) => unknown,
  agentTags: [] as string[][],
  repairPrompts: [] as string[],
  /** V1.0.1 — reparo seletivo por chamada: padrão = NOT_OBSERVABLE para cada etapa pedida (nenhuma conclusão inventada). */
  repairReply: ((user: string) => ({ assessments: [...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => ({ checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [] })) })) as (user: string) => unknown,
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
      if (purpose === "ASSESSMENT_COVERAGE_REPAIR") {
        const user = (request.contents ?? []).map((content) => content.text).join("\n")
        control.repairPrompts.push(user)
        return reply(control.repairReply(user))
      }
      if (purpose === "AGENT_SYNTHESIS") {
        const prompt = (request.contents ?? []).map((content) => content.text).join("\n")
        control.agentPrompts.push(prompt)
        control.lastAgentPrompt = [request.systemPrompt ?? "", prompt].join("\n")
        control.agentTags.push(request.classification?.tags ?? [])
        const value = control.agentReply(prompt)
        // V1.0.2 — resposta ilegível do modelo (texto cru, ex.: JSON com um "}" a mais).
        return value && typeof value === "object" && "__raw" in value ? { ...reply({}), text: (value as { __raw: string }).__raw } : reply(value)
      }
      throw new Error(`request inesperada na prova: ${purpose}`)
    },
  }
})

const { env } = await import("../../../config/env.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { resolveOfficialClosure } = await import("../../indicators/application/official-closure.js")
const { referencePeriodDates } = await import("../domain/prv-closing.js")
const { saveStrategyDraft, publishStrategyDraft } = await import("../application/diagnostic-strategy-service.js")
const { emptyStrategyConfig } = await import("../domain/diagnostic-strategy.js")
const { practiceKeyOf } = await import("../domain/process-patterns.js")
const { PRV_DIAGNOSIS_LOGIC_VERSION } = await import("../domain/prv-investigation.js")
const { STRUCTURED_OUTPUT_RETRY_NOTICE } = await import("../../agents/application/structured-output-retry.js")

void process.env.INIA_DB_PROOF
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], interactions: [] as string[], workflows: [] as string[], agents: [] as string[], indicators: [] as string[], accounts: [] as string[], documents: [] as string[], subteams: [] as string[] }

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
describe.skip("Indicator Diagnosis V1 — fechamento do PRV → TMA: prova Postgres (motor real, zero chamada de modelo real)", () => {
  const stamp = Date.now()
  const tag = stamp.toString(36).replace(/\d/g, (digit) => "abcdefghij"[Number(digit)]!)
  const TITLE = `Prova PRV · Contestação ${tag}`
  const RULE = "Confirme com o cliente o valor contestado e o mês da fatura antes de abrir a contestação."
  const GAP_QUOTE = "Vou abrir a contestação agora mesmo."
  const DONE_QUOTE = "Vou abrir a contestação do valor de junho que o senhor confirmou."
  const REASON = `Contestação PRV ${tag}`
  const OTHER = `Segunda via PRV ${tag}`
  const TRANSCRIPT_GAP = ["CLIENTE: Quero contestar a fatura de junho.", `OPERADOR: ${GAP_QUOTE}`, "CLIENTE: Tá bom."].join("\n")
  const TRANSCRIPT_DONE = ["CLIENTE: Quero contestar a fatura de junho.", "OPERADOR: Qual o valor e o mês da fatura?", "CLIENTE: Junho, cento e vinte reais.", `OPERADOR: ${DONE_QUOTE}`].join("\n")
  let team: string
  let agent: string
  let document: string
  let indicator: string
  let code: string
  let strategyVersionId: string
  let workflow: { workflow: string; version: string }
  let period: string
  let previousPeriod: string
  let practiceKey: string
  let checkpointRef: string

  const day = (referencePeriod: string, dayOfMonth: number, hourUtc = 13) => `${referencePeriod}-${String(dayOfMonth).padStart(2, "0")}T${String(hourUtc).padStart(2, "0")}:00:00Z`
  const person = async (name: string, subteam: string | null) => {
    const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1,$2,'OPERATOR',$3,$4) returning id", [ORG, name, team, subteam])).rows[0]!.id
    created.people.push(id)
    return id
  }
  const subteam = async (label: string) => {
    const id = (await pool.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1,$2,$3) returning id", [ORG, team, `${label} ${tag}`])).rows[0]!.id
    created.subteams.push(id)
    return id
  }
  const interaction = async (personId: string, reason: string, startedAt: string, seconds: number, transcript: string | null) => {
    const id = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,$3,$4,$5,$6) returning id`, [ORG, personId, reason, startedAt, new Date(new Date(startedAt).getTime() + seconds * 1000), `PROOF-PRV-${stamp}-${Math.random()}`])).rows[0]!.id
    if (transcript) await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,$3)`, [ORG, id, transcript])
    created.interactions.push(id)
    return id
  }
  /** Linhas OFICIAIS do fechamento (a fonte oficial entrega pronto; a INIA só lê). */
  const officialClosing = async (personId: string, rows: { period: string; value: number; target: number; achievement: number; quartile: string }[]) => {
    for (const row of rows) {
      await pool.query("insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, source) values ($1,$2,$3,$4,$5,$6,$7,25,$8,'PROOF')", [ORG, personId, indicator, row.period, row.value, row.target, row.achievement, row.quartile])
      await pool.query("insert into employee_prv_performance (organization_id, person_id, reference_period, achievement_percent, quartile, source) values ($1,$2,$3,$4,$5,'PROOF')", [ORG, personId, row.period, row.achievement, row.quartile])
    }
  }
  /** Observação JÁ verificada (memória operacional de uma avaliação anterior compatível: contrato V3, versão publicada vigente). */
  const storedObservation = async (personId: string, interactionId: string, occurredAt: string, status: "FOLLOWED" | "NOT_FOLLOWED", options: { documentVersion?: number; checkpointRef?: string | null } = {}) => {
    await pool.query(
      `insert into process_checkpoint_observations (organization_id, person_id, interaction_id, practice_key, document_id, document_version, requirement, status, occurred_at, analytics_status, checkpoint_ref, display_context)
       values ($1,$2,$3,$4,$5,$6,'Confirmar valor e mês antes de abrir a contestação',$7,$8,'VERIFIED',$9,$10::jsonb)`,
      [ORG, personId, interactionId, practiceKey, document, options.documentVersion ?? 1, status, occurredAt, options.checkpointRef === undefined ? checkpointRef : options.checkpointRef, JSON.stringify({ quotes: [{ text: status === "FOLLOWED" ? DONE_QUOTE : GAP_QUOTE, truncated: false }], rule: { documentTitle: TITLE, heading: "Abertura", quote: RULE }, guidance: null })],
    )
  }
  const enroll = async (personId: string) =>
    (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id, scheduled_for) values ($1,$2,$3,'trigger','active','2999-01-01',$4,now()) returning id`, [ORG, workflow.workflow, workflow.version, personId])).rows[0]!.id
  /** O Agent "lê" o prompt: para cada I-n apresentado, avalia pela transcrição daquele atendimento (fala do gap × fala correta). */
  const assessingAgent = (prompt: string) => {
    const refs = [...prompt.matchAll(/=== (I\d+) · [\d-]+ ===\n([\s\S]*?)(?=\n\n=== I|$)/g)].map((match) => ({ ref: match[1]!, done: match[2]!.includes(DONE_QUOTE) }))
    const found = new RegExp(`\\[(CP-[0-9a-f]{10})[^\\]]*\\]\\s*(?:[-*•]\\s*)?${RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(control.lastAgentPrompt)
    return {
      title: "Diagnóstico", summary: "Avaliação dos atendimentos.", relatedProcedure: TITLE, recommendation: "Confirme o valor antes de abrir.",
      interactionAssessments: refs.map(({ ref, done }) => ({ interactionRef: ref, processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: [{ ...(found ? { checkpointRef: found[1]! } : {}), requirement: "Confirmar valor e mês antes de abrir a contestação", status: done ? "FOLLOWED" : "NOT_FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [done ? DONE_QUOTE : GAP_QUOTE], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: "Confirme o valor e o mês antes de abrir." }, uncertainty: null }] }] } })),
    }
  }
  const artifactOf = async (enrollment: string) => (await pool.query<{ disposition: string; prv_closing_key: string | null; artifact: { blockedReason: string | null; items: { kind: string; decision: { disposition: string } }[]; prvClosing?: { diagnosis: { investigations: { conclusion: { type: string; developmentPatterns: string[]; teamOnlyPatterns: string[]; mixShift: boolean }; sample: { eligibleCount: number; reusableCount: number; analyzedCount: number; reanalyzedInteractionCount: number; newObservationCount: number; reusedObservationCount: number }; patterns: { behaviors: { eligible: number; counts: { followed: number; notFollowed: number }; concentration: { label: string } | null }[] } | null; attribution: { attribution: string }[]; official: { value: number; quartile: string } }[] } } } }>("select disposition, prv_closing_key, artifact from reliable_feedback_artifacts where enrollment_id = $1", [enrollment])).rows[0]
  const publishedOf = async (personId: string) => (await pool.query<{ id: string; feedback_kind: string; impacted_indicator: string; recommendation: string; context_snapshot: { reliableFeedback: { feedbackView?: { kind?: string; narrative: string[]; cycle?: { indicators: { lines: { label: string; value: string }[] }[] }; developments: { title: string }[]; maintain: unknown }; supervisorView?: { indicators: { patterns: { attribution: string; concentration: string | null }[]; sample: { reused: number; reanalyzed: number } }[] } } } }>("select id, feedback_kind, impacted_indicator, recommendation, context_snapshot from feedbacks where operator_id = $1 order by created_at", [personId])).rows

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 8 })
    team = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 1", [ORG])).rows[0]!.id
    const closure = await resolveOfficialClosure(pool as never, ORG, new Date())
    period = closure.lastClosedPeriod
    previousPeriod = referencePeriodDates(period).previousPeriod
    document = (await pool.query<{ id: string }>("insert into knowledge_documents (organization_id, title, document_type, source_type) values ($1,$2,'PROCEDURE','TEXT') returning id", [ORG, TITLE])).rows[0]!.id
    created.documents.push(document)
    await pool.query("insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1,$2,1,$3,'PUBLISHED',$4)", [ORG, document, `## Abertura da contestação\n- ${RULE}\n- Registre a contestação no sistema.\n\n## Prazo da análise\n\nO operador deverá informar o prazo exibido na ferramenta.\n\nEvitar:\n\n- “É só aguardar.”\n- “O setor vai verificar.”`, `proof-prv-${document}`])
    await pool.query("insert into knowledge_document_org_scopes (knowledge_document_id, scope_type) values ($1,'ALL_TEAMS')", [document])
    agent = (await pool.query<{ id: string }>(`insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1,'Proof PRV · Especialista','CALL_FEEDBACK','Avaliar processos','Prova PRV','Avalie os processos dos atendimentos.') returning id`, [ORG])).rows[0]!.id
    created.agents.push(agent)
    await pool.query("insert into agent_knowledge_documents (agent_id, knowledge_document_id) values ($1,$2)", [agent, document])
    indicator = (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1,$2,'TMA Prova','SECONDS','LOWER') returning id`, [ORG, `PROOF_PRV_${stamp}`])).rows[0]!.id
    created.indicators.push(indicator)
    code = (await pool.query<{ code: string }>("select code from indicator_definitions where id = $1", [indicator])).rows[0]!.code
    const admin = (await pool.query<{ id: string }>("insert into people (organization_id, name, role) values ($1, 'Proof PRV Admin', 'ADMIN') returning id", [ORG])).rows[0]!.id
    created.people.push(admin)
    const account = (await pool.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id", [ORG, admin, `proof-prv-${stamp}@inia.local`])).rows[0]!.id
    created.accounts.push(account)
    // A regra de triagem é da ESTRATÉGIA publicada do indicador (a mesma API/serviço da tela) — nunca do código.
    const actor = { userAccountId: account, personId: admin }
    await saveStrategyDraft(pool as never, ORG, indicator, { config: { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, closingTriage: { enabled: true, developmentQuartiles: ["Q3", "Q4"], belowTarget: false, quartileWorsened: false, recognitionQuartiles: ["Q1"] } } }, actor)
    strategyVersionId = (await publishStrategyDraft(pool as never, ORG, indicator, actor)).published!.id
    practiceKey = practiceKeyOf({ requirement: "x", knowledge: { documentId: document, documentTitle: TITLE, heading: null, version: 1, quote: RULE, literalInPublished: true, presentedInRun: true, anchorTerms: [], applicability: "VERIFIED", applicabilityBasis: "LEXICAL_ANCHOR", leadIn: null, failure: null, contentSha256: null } })
    checkpointRef = "CP-0123456789"
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Fechamento mensal", position: { x: 0, y: 0 }, config: {} },
        { id: "agent", type: "action", label: "Diagnóstico do fechamento", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId: agent, scheduledDataSource: { kind: "PERFORMANCE", closures: 1 }, outputContract: "PRV_CLOSING_DIAGNOSIS" } },
        { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 2 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
        { id: "output", type: "output", label: "Feedback ao colaborador", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
        { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", target: "agent", sourceHandle: "always" }, { id: "e2", source: "agent", target: "feedback", sourceHandle: "always" }, { id: "e3", source: "feedback", target: "output", sourceHandle: "always" }, { id: "e4", source: "output", target: "end", sourceHandle: "always" }],
    }
    const trigger = { kind: "schedule", mode: "CALENDAR", times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 }, intervalDays: 1 }
    const id = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1,$2,$3,$4) returning id`, [ORG, `Prova PRV ${tag}`, JSON.stringify(trigger), JSON.stringify(graph)])).rows[0]!.id
    created.workflows.push(id)
    const version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id`, [id, JSON.stringify(graph)])).rows[0]!.id
    workflow = { workflow: id, version }
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
    await pool.query("delete from employee_prv_performance where person_id = any($1::uuid[])", [people])
    await pool.query("delete from indicator_diagnostic_strategy_versions where strategy_id in (select id from indicator_diagnostic_strategies where indicator_definition_id = any($1::uuid[]))", [created.indicators]).catch(() => undefined)
    await pool.query("delete from indicator_diagnostic_strategies where indicator_definition_id = any($1::uuid[])", [created.indicators]).catch(() => undefined)
    await pool.query("delete from indicator_definitions where id = any($1::uuid[])", [created.indicators]).catch(() => undefined)
    await pool.query("delete from knowledge_document_org_scopes where knowledge_document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_versions where document_id = any($1::uuid[])", [created.documents])
    await pool.query("delete from knowledge_documents where id = any($1::uuid[])", [created.documents])
    await pool.query("delete from transcripts where interaction_id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    await pool.query("delete from access_role_assignments where user_account_id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from user_accounts where id = any($1::uuid[])", [created.accounts])
    await pool.query("delete from audit_logs where actor_id = any($1::uuid[])", [people])
    await pool.query("delete from people where id = any($1::uuid[])", [people])
    await pool.query("delete from subteams where id = any($1::uuid[])", [created.subteams])
    await pool.end()
  })

  it("A. TMA fora da meta (Q4) com padrão recorrente: fechamento lido, oficial intacto, população correta, Agent só nas chamadas faltantes, padrão, feedback ao colaborador e visão técnica", async () => {
    const operator = await person("Proof PRV Operadora A", await subteam("PRV A"))
    await officialClosing(operator, [{ period, value: 495, target: 450, achievement: 90.9, quartile: "Q4" }, { period: previousPeriod, value: 410, target: 450, achievement: 109, quartile: "Q2" }])
    // 6 chamadas do motivo (uma LONGA e correta) + 3 curtas de outro motivo no fechamento; 2 do motivo no mês anterior (fora do recorte).
    for (const [index, dayOfMonth] of [3, 6, 11, 14, 18, 24].entries()) await interaction(operator, REASON, day(period, dayOfMonth), index === 1 ? 1500 : 800, index === 1 ? TRANSCRIPT_DONE : TRANSCRIPT_GAP)
    for (const dayOfMonth of [4, 9, 16]) await interaction(operator, OTHER, day(period, dayOfMonth), 240, "OPERADOR: Segunda via enviada.")
    const outside = await interaction(operator, REASON, day(previousPeriod, 20), 900, TRANSCRIPT_GAP)
    control.calls.length = 0
    control.agentPrompts.length = 0
    control.repairPrompts.length = 0
    control.agentReply = assessingAgent
    control.narrativeReply = { paragraphs: ["Neste fechamento, seu TMA Prova oficial ficou em 495 s, fora da meta de 450 s.", "Nas chamadas analisadas, o ponto que mais apareceu foi confirmar o valor e o mês antes de abrir a contestação."], card: "TMA Prova fora da meta; foco em confirmar valor e mês.", supervisorNotes: ["O padrão aparece em chamadas do próprio colaborador; associação não é causa."] }
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    // Custo: 1 Agent (reanálise das faltantes) + 1 reparo por chamada que voltou sem as etapas centrais (MUST_ASSESS) + 1 redator
    // (interpretação/narrativa). Nenhuma Tool, nenhum redator de item.
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", ...Array(5).fill("ASSESSMENT_COVERAGE_REPAIR"), "PRV_NARRATIVE"])
    const prompt = control.agentPrompts[0]!
    expect(prompt.match(/=== I\d+ · [\d-]+ ===/g)).toHaveLength(5)
    expect(prompt).not.toContain("Segunda via enviada")
    expect(prompt).not.toContain(outside)
    const artifact = (await artifactOf(enrollment))!
    expect(artifact.prv_closing_key).toMatch(new RegExp(`^${PRV_DIAGNOSIS_LOGIC_VERSION}:`))
    const investigation = artifact.artifact.prvClosing!.diagnosis.investigations[0]!
    expect(investigation.official).toMatchObject({ value: 495, quartile: "Q4" })
    expect(investigation.sample).toMatchObject({ eligibleCount: 6, reusableCount: 0, analyzedCount: 5, reanalyzedInteractionCount: 5 })
    expect(investigation.conclusion.type).toBe("ACTIONABLE_PATTERN")
    const behavior = investigation.patterns!.behaviors[0]!
    expect(behavior.eligible).toBe(5)
    expect(behavior.counts.notFollowed).toBeGreaterThanOrEqual(3)
    expect(artifact.artifact.items.map((item) => [item.kind, item.decision.disposition])).toEqual(expect.arrayContaining([["INDICATOR_TARGET_NOT_MET", "READY"], ["INDICATOR_DEVELOPMENT_PATTERN", "READY"]]))
    const [published] = await publishedOf(operator)
    expect(published!.feedback_kind).toBe("INDICATOR")
    const view = published!.context_snapshot.reliableFeedback.feedbackView!
    expect(view.kind).toBe("INDICATOR")
    expect(view.narrative[0]).toContain("495 s")
    expect(view.cycle!.indicators[0]!.lines).toEqual(expect.arrayContaining([{ label: "Resultado oficial", value: "495 s" }, { label: "Quartil oficial", value: "Q4 (Q1 = melhor, Q4 = pior)" }]))
    expect(view.developments[0]!.title).toBe("Confirmar valor e mês antes de abrir a contestação")
    expect(published!.recommendation).not.toMatch(/porque|por causa|mais rápido|encerre mais cedo/i)
    expect(published!.context_snapshot.reliableFeedback.supervisorView!.indicators[0]!.sample).toMatchObject({ reused: 0, reanalyzed: 5 })
    // V1.0.1 — o reparo recebe SÓ a conversa daquela chamada e SÓ as etapas centrais que faltaram (nunca o diagnóstico inteiro).
    expect(control.repairPrompts).toHaveLength(5)
    for (const repairPrompt of control.repairPrompts) expect(repairPrompt).not.toMatch(/=== I\d+|DIAGNÓSTICO DO INDICADOR/)
    expect((published!.context_snapshot.reliableFeedback.supervisorView!.indicators[0] as unknown as { coverage: unknown }).coverage).toMatchObject({ interactionCount: 5, repairInteractions: 5, missingAfterRepair: 0, inconsistentAfterRepair: 0, status: "completa" })
    // O oficial NUNCA é tocado: a linha continua exatamente como veio.
    expect((await pool.query("select value::float, quartile, achievement_percent::float from employee_indicator_performance where person_id = $1 and reference_period = $2", [operator, period])).rows[0]).toEqual({ value: 495, quartile: "Q4", achievement_percent: 90.9 })
    // Memória operacional: observações novas com contexto exibível + a verdade diagnóstica versionada.
    const observations = (await pool.query<{ display_context: { quotes: unknown[] } | null; checkpoint_ref: string | null }>("select display_context, checkpoint_ref from process_checkpoint_observations where person_id = $1", [operator])).rows
    expect(observations).toHaveLength(5)
    expect(observations).toEqual(observations.map(() => ({ display_context: expect.objectContaining({ quotes: [expect.objectContaining({ text: expect.any(String) })] }), checkpoint_ref: expect.stringMatching(/^CP-/) })))
    const diagnosis = (await pool.query<{ logic_version: string; strategy_versions: { strategyVersionId: string }[]; reference_period: string }>("select logic_version, strategy_versions, reference_period from prv_closing_diagnoses where person_id = $1", [operator])).rows
    expect(diagnosis).toEqual([{ logic_version: PRV_DIAGNOSIS_LOGIC_VERSION, strategy_versions: [{ indicatorCode: code, strategyVersionId }], reference_period: period }])

    // G (idempotência): mesmo fechamento + mesma estratégia + mesma lógica = nenhum modelo, nenhum segundo feedback.
    control.calls.length = 0
    const again = await enroll(operator)
    expect(await drive(again)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual([])
    expect((await artifactOf(again))!.artifact.blockedReason).toBe("PRV_CLOSING_ALREADY_DIAGNOSED")
    expect(await publishedOf(operator)).toHaveLength(1)
  })

  it("G. reuso: chamadas já avaliadas de forma compatível são reaproveitadas; só as faltantes vão ao Agent; incompatível é reavaliada", async () => {
    const operator = await person("Proof PRV Operadora G", await subteam("PRV G"))
    await officialClosing(operator, [{ period, value: 520, target: 450, achievement: 86, quartile: "Q4" }])
    const ids: string[] = []
    for (const dayOfMonth of [2, 5, 9, 13, 17, 21]) ids.push(await interaction(operator, REASON, day(period, dayOfMonth), 800, TRANSCRIPT_GAP))
    // 3 compatíveis (reaproveitadas) + 1 com versão antiga da base (incompatível → reavaliada).
    for (const index of [0, 1, 2]) await storedObservation(operator, ids[index]!, day(period, [2, 5, 9][index]!), "NOT_FOLLOWED")
    await storedObservation(operator, ids[3]!, day(period, 13), "NOT_FOLLOWED", { checkpointRef: null })
    control.calls.length = 0
    control.agentPrompts.length = 0
    control.agentReply = assessingAgent
    control.narrativeReply = null
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(control.calls[0]).toBe("AGENT_SYNTHESIS")
    // Teto 5: 3 reaproveitadas + 2 novas (entre as 3 sem avaliação compatível) — nunca as 6.
    expect(control.agentPrompts[0]!.match(/=== I\d+ · [\d-]+ ===/g)).toHaveLength(2)
    const investigation = (await artifactOf(enrollment))!.artifact.prvClosing!.diagnosis.investigations[0]!
    expect(investigation.sample).toMatchObject({ eligibleCount: 6, reusableCount: 3, analyzedCount: 5, reanalyzedInteractionCount: 2, newObservationCount: 2, reusedObservationCount: 3 })
    expect(investigation.conclusion.type).toBe("ACTIONABLE_PATTERN")
  })

  it("H. PREFLIGHT: amostra possível abaixo do mínimo = ZERO chamadas de modelo (feedback factual pela estratégia)", async () => {
    const operator = await person("Proof PRV Operador H", await subteam("PRV H"))
    await officialClosing(operator, [{ period, value: 530, target: 450, achievement: 85, quartile: "Q4" }])
    await interaction(operator, REASON, day(period, 7), 800, TRANSCRIPT_GAP)
    await interaction(operator, REASON, day(period, 8), 800, TRANSCRIPT_GAP)
    control.calls.length = 0
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual([])
    const artifact = (await artifactOf(enrollment))!
    expect(artifact.artifact.prvClosing!.diagnosis.investigations[0]!.conclusion.type).toBe("INSUFFICIENT_SAMPLE")
    expect(artifact.artifact.items.map((item) => item.kind)).toEqual(["INDICATOR_TARGET_NOT_MET"])
  })

  it("C. TMA fora da meta sem padrão (observações heterogêneas): NO_ACTIONABLE_DIAGNOSIS, nada inventado, zero IA", async () => {
    const operator = await person("Proof PRV Operador C", await subteam("PRV C"))
    await officialClosing(operator, [{ period, value: 505, target: 450, achievement: 89, quartile: "Q3" }])
    const statuses: ("FOLLOWED" | "NOT_FOLLOWED")[] = ["FOLLOWED", "FOLLOWED", "NOT_FOLLOWED", "NOT_FOLLOWED", "FOLLOWED"]
    for (const [index, status] of statuses.entries()) {
      const id = await interaction(operator, REASON, day(period, 3 + index * 4), 800, status === "FOLLOWED" ? TRANSCRIPT_DONE : TRANSCRIPT_GAP)
      await storedObservation(operator, id, day(period, 3 + index * 4), status)
    }
    control.calls.length = 0
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual([])
    const investigation = (await artifactOf(enrollment))!.artifact.prvClosing!.diagnosis.investigations[0]!
    expect(investigation.conclusion.type).toBe("NO_ACTIONABLE_DIAGNOSIS")
    const [published] = await publishedOf(operator)
    expect(published!.context_snapshot.reliableFeedback.feedbackView!.developments).toEqual([])
    expect(published!.context_snapshot.reliableFeedback.feedbackView!.narrative.join(" ")).toContain("não apareceu um ponto de processo que se repetisse o suficiente")
  })

  it("B. TMA dentro da meta (Q1, reconhecimento pela estratégia): prática consistente = POSITIVE_PATTERN, nenhum gap inventado", async () => {
    const operator = await person("Proof PRV Operadora B", await subteam("PRV B"))
    await officialClosing(operator, [{ period, value: 410, target: 450, achievement: 109, quartile: "Q1" }])
    for (const dayOfMonth of [3, 7, 12, 19, 26]) {
      const id = await interaction(operator, REASON, day(period, dayOfMonth), 700, TRANSCRIPT_DONE)
      await storedObservation(operator, id, day(period, dayOfMonth), "FOLLOWED")
    }
    control.calls.length = 0
    control.narrativeReply = null
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual(["PRV_NARRATIVE"])
    const artifact = (await artifactOf(enrollment))!
    expect(artifact.artifact.prvClosing!.diagnosis.investigations[0]!.conclusion.type).toBe("POSITIVE_PATTERN")
    expect(artifact.artifact.items.map((item) => item.kind)).toEqual(["INDICATOR_TARGET_MET", "INDICATOR_STRENGTH_PATTERN"])
    const view = (await publishedOf(operator))[0]!.context_snapshot.reliableFeedback.feedbackView!
    expect(view.developments).toEqual([])
    expect(view.maintain).not.toBeNull()
  })

  it("D. mudança de mix: participação do motivo cresce entre os meses — fato de composição, sem causalidade no texto", async () => {
    const operator = await person("Proof PRV Operadora D", await subteam("PRV D"))
    await officialClosing(operator, [{ period, value: 540, target: 450, achievement: 83, quartile: "Q4" }, { period: previousPeriod, value: 430, target: 450, achievement: 104, quartile: "Q2" }])
    // Mês anterior: 4 de 24 no motivo; fechamento: 12 de 24 (o motivo ficou maior e mais longo).
    for (let index = 0; index < 20; index += 1) await interaction(operator, OTHER, day(previousPeriod, 1 + (index % 27), 11 + (index % 5)), 300, null)
    for (let index = 0; index < 4; index += 1) await interaction(operator, REASON, day(previousPeriod, 2 + index, 15), 700, null)
    for (let index = 0; index < 12; index += 1) {
      const id = await interaction(operator, REASON, day(period, 1 + index * 2, 12 + (index % 4)), 900, TRANSCRIPT_GAP)
      if (index < 5) await storedObservation(operator, id, day(period, 1 + index * 2, 12 + (index % 4)), index < 4 ? "NOT_FOLLOWED" : "FOLLOWED")
    }
    for (let index = 0; index < 12; index += 1) await interaction(operator, OTHER, day(period, 2 + index * 2, 11), 300, null)
    control.calls.length = 0
    control.narrativeReply = { paragraphs: ["Seu TMA Prova aumentou por causa das chamadas de contestação."], card: "TMA Prova fora da meta.", supervisorNotes: ["O mix explica o resultado."] }
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    const investigation = (await artifactOf(enrollment))!.artifact.prvClosing!.diagnosis.investigations[0]!
    expect(investigation.conclusion.mixShift).toBe(true)
    expect(investigation.conclusion.type).toBe("MIX_AND_OPERATIONAL_PATTERN")
    // O redator tentou causalidade: recusado campo a campo; publicado o texto do sistema.
    const published = (await publishedOf(operator))[0]!
    const text = published.context_snapshot.reliableFeedback.feedbackView!.narrative.join(" ")
    expect(text).not.toMatch(/por causa|explica|causou|provocou|respons[áa]vel/i)
    expect(text).toContain("passaram a representar uma parte maior dos seus atendimentos")
  })

  it("E. concentração por dia da semana com volume suficiente (reuso integral: zero chamada ao Agent)", async () => {
    const operator = await person("Proof PRV Operador E", await subteam("PRV E"))
    await officialClosing(operator, [{ period, value: 515, target: 450, achievement: 87, quartile: "Q4" }])
    const dates = [...Array(31).keys()].map((index) => new Date(`${period}-01T15:00:00Z`).getTime() + index * 86_400_000).map((time) => new Date(time)).filter((date) => date.toISOString().startsWith(period))
    const mondays = dates.filter((date) => date.getUTCDay() === 1)
    const thursdays = dates.filter((date) => date.getUTCDay() === 4)
    let count = 0
    for (const [index, date] of [...mondays, ...mondays].slice(0, 9).entries()) {
      const at = new Date(date.getTime() + index * 3_600_000).toISOString()
      const id = await interaction(operator, REASON, at, 800, TRANSCRIPT_GAP)
      await storedObservation(operator, id, at, "NOT_FOLLOWED")
      count += 1
    }
    for (const [index, date] of [...thursdays, ...thursdays].slice(0, 5).entries()) {
      const at = new Date(date.getTime() + index * 3_600_000).toISOString()
      const id = await interaction(operator, REASON, at, 700, TRANSCRIPT_DONE)
      await storedObservation(operator, id, at, "FOLLOWED")
      count += 1
    }
    expect(count).toBe(14)
    control.calls.length = 0
    control.narrativeReply = null
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    expect(control.calls).toEqual(["PRV_NARRATIVE"])
    const investigation = (await artifactOf(enrollment))!.artifact.prvClosing!.diagnosis.investigations[0]!
    expect(investigation.sample).toMatchObject({ reusableCount: 14, analyzedCount: 14, reanalyzedInteractionCount: 0 })
    expect(investigation.patterns!.behaviors[0]!.concentration?.label).toBe("segunda-feira")
    const supervisor = (await publishedOf(operator))[0]!.context_snapshot.reliableFeedback.supervisorView!
    expect(supervisor.indicators[0]!.patterns[0]!.concentration).toContain("segunda-feira")
  })

  it("F. padrão do Subgrupo não vira crítica individual: colaborador correto + colegas com gap = sem ponto de desenvolvimento", async () => {
    const group = await subteam("PRV F")
    const operator = await person("Proof PRV Operadora F", group)
    await officialClosing(operator, [{ period, value: 500, target: 450, achievement: 90, quartile: "Q4" }])
    for (const dayOfMonth of [4, 8, 12, 16, 20]) {
      const id = await interaction(operator, REASON, day(period, dayOfMonth), 800, TRANSCRIPT_DONE)
      await storedObservation(operator, id, day(period, dayOfMonth), "FOLLOWED")
    }
    for (let peer = 0; peer < 4; peer += 1) {
      const colleague = await person(`Proof PRV Colega F${peer}`, group)
      for (const dayOfMonth of [5, 15]) {
        const id = await interaction(colleague, REASON, day(period, dayOfMonth + peer), 800, TRANSCRIPT_GAP)
        await storedObservation(colleague, id, day(period, dayOfMonth + peer), "NOT_FOLLOWED")
      }
    }
    control.calls.length = 0
    control.narrativeReply = null
    const enrollment = await enroll(operator)
    expect(await drive(enrollment)).toMatchObject({ status: "completed" })
    const investigation = (await artifactOf(enrollment))!.artifact.prvClosing!.diagnosis.investigations[0]!
    expect(investigation.conclusion.developmentPatterns).toEqual([])
    expect(investigation.attribution[0]!.attribution).toBe("TEAM_ONLY")
    const published = (await publishedOf(operator))[0]!
    const view = published.context_snapshot.reliableFeedback.feedbackView!
    expect(view.developments).toEqual([])
    expect(JSON.stringify(view)).not.toMatch(/Subgrupo|equipe|colegas/i)
    expect(published.context_snapshot.reliableFeedback.supervisorView!.indicators[0]!.patterns[0]!.attribution).toBe("só do Subgrupo — não atribuído ao colaborador")
  })

  it("I. COBERTURA: 1ª resposta incompleta e inconsistente ('é só aguardar' como OMISSÃO) → reparo único por chamada (um falha) → padrão de prazo NOT_FOLLOWED VERIFIED, chamada longa correta preservada", async () => {
    const operator = await person("Proof PRV Operadora I", await subteam("PRV I"))
    await officialClosing(operator, [{ period, value: 505, target: 450, achievement: 89, quartile: "Q4" }, { period: previousPeriod, value: 415, target: 450, achievement: 108, quartile: "Q2" }])
    const WAIT = "Agora é só aguardar, o setor vai verificar."
    const DEADLINE = "A análise leva até cinco dias úteis e o retorno vem por SMS."
    const call = (deadline: string, marker: string) => ["CLIENTE: Quero contestar a fatura de junho.", "OPERADOR: Qual o valor e o mês da fatura?", "CLIENTE: Junho, cento e vinte reais.", `OPERADOR: ${DONE_QUOTE}`, `CLIENTE: E quando sai? ${marker}`, `OPERADOR: ${deadline}`, "CLIENTE: Tá bom."].join("\n")
    // 4 com a espera sem prazo + 2 corretas (uma LONGA). A última correta tem o reparo falhando.
    const plan = [{ gap: true, seconds: 820 }, { gap: false, seconds: 1600 }, { gap: true, seconds: 840 }, { gap: true, seconds: 800 }, { gap: true, seconds: 860 }, { gap: false, seconds: 780, failRepair: true }]
    for (const [index, entry] of plan.entries()) await interaction(operator, REASON, day(period, 3 + index * 4), entry.seconds, call(entry.gap ? WAIT : DEADLINE, entry.failRepair ? "[FALHA-REPARO]" : `[C${index}]`))
    control.calls.length = 0
    control.agentPrompts.length = 0
    control.repairPrompts.length = 0
    control.narrativeReply = null
    // O Agent "lê" o prompt como no smoke real: avalia só a regra de abertura e, nas chamadas da espera, marca o PRAZO como omissão
    // citando a própria fala — sem as demais etapas centrais.
    control.agentReply = (prompt) => {
      const deadlineRef = /\[(CP-[0-9a-f]{10})[^\]]*\]\s*O operador deverá informar o prazo/.exec(control.lastAgentPrompt)?.[1]
      const ruleRef = new RegExp(`\\[(CP-[0-9a-f]{10})[^\\]]*\\]\\s*(?:[-*•]\\s*)?${RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(control.lastAgentPrompt)?.[1]
      const refs = [...prompt.matchAll(/=== (I\d+) · [\d-]+ ===\n([\s\S]*?)(?=\n\n=== I|$)/g)].map((match) => ({ ref: match[1]!, gap: match[2]!.includes(WAIT) }))
      return {
        title: "Diagnóstico", summary: "Avaliação.", relatedProcedure: TITLE, recommendation: "Informe o prazo.",
        interactionAssessments: refs.map(({ ref, gap }) => ({ interactionRef: ref, processAssessment: { processes: [{ documentTitle: TITLE, checkpoints: [
          { checkpointRef: ruleRef, requirement: "Confirmar valor e mês antes de abrir a contestação", status: "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [DONE_QUOTE], knowledgeQuote: RULE, guidance: { source: "OFFICIAL_PROCEDURE", text: null }, uncertainty: null },
          ...(gap ? [{ checkpointRef: deadlineRef, requirement: "Informar o prazo exibido na ferramenta", status: "NOT_FOLLOWED", evidenceType: "OMISSION", transcriptEvidence: [`OPERADOR: ${WAIT}`], knowledgeQuote: null, guidance: { source: "NO_GROUNDED_GUIDANCE", text: null }, uncertainty: null }] : []),
        ] }] } })),
      }
    }
    // Reparo: reavalia pelo SENTIDO da fala (espera sem prazo = conduta observada; prazo concreto = cumprido).
    control.repairReply = (user) => {
      if (user.includes("[FALHA-REPARO]")) throw new Error("timeout do provedor")
      const gap = user.includes(WAIT)
      return { assessments: [...user.matchAll(/^\[(CP-[0-9a-f]{10})\][^\n]*\n(?: {2}Abertura[^\n]*\n)? {2}Etapa \(texto literal da base\): ([^\n]*)/gm)].map((match) => (match[2]!.includes("O operador deverá informar o prazo")
        ? { checkpointRef: match[1], status: gap ? "NOT_FOLLOWED" : "FOLLOWED", evidenceType: "OBSERVED", transcriptEvidence: [`OPERADOR: ${gap ? WAIT : DEADLINE}`] }
        : { checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [] })) }
    }
    const enrollment = await enroll(operator)
    try {
      expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    } finally {
      control.repairReply = (user) => ({ assessments: [...user.matchAll(/^\[(CP-[0-9a-f]{10})\]/gm)].map((match) => ({ checkpointRef: match[1], status: "NOT_OBSERVABLE", evidenceType: null, transcriptEvidence: [] })) })
    }
    // 1 Agent + 1 reparo por chamada (5 da amostra; uma falhou e NÃO derrubou o diagnóstico) + 1 redator. Nunca um 2º reparo.
    expect(control.calls.filter((purpose) => purpose === "ASSESSMENT_COVERAGE_REPAIR")).toHaveLength(control.agentPrompts[0]!.match(/=== I\d+ · [\d-]+ ===/g)!.length)
    const artifact = (await artifactOf(enrollment))!.artifact
    type CoverageInvestigation = { coverage: { inconsistentInitial: number; interactions: { repairError: string | null; repairCalls: number }[] }; patterns: { behaviors: { practiceKey: string; classification: string }[] }; conclusion: { type: string; developmentPatterns: string[] } }
    const investigation = artifact.prvClosing!.diagnosis.investigations[0]! as unknown as CoverageInvestigation
    const coverage = investigation.coverage
    expect(coverage.inconsistentInitial).toBeGreaterThanOrEqual(3)
    expect(coverage.interactions.filter((entry) => entry.repairError).length).toBeLessThanOrEqual(1)
    expect(coverage.interactions.every((entry) => entry.repairCalls <= 1)).toBe(true)
    // O padrão plantado aparece: prazo NÃO seguido e VERIFIED nas chamadas da espera; as corretas (inclusive a longa) FOLLOWED.
    const observations = (await pool.query<{ practice_key: string; status: string; analytics_status: string; seconds: number }>("select o.practice_key, o.status, o.analytics_status, extract(epoch from i.ended_at - i.started_at)::int seconds from process_checkpoint_observations o join interactions i on i.id = o.interaction_id where o.person_id = $1 and o.practice_key = 'BEHAVIOR:INFORM_DEADLINE'", [operator])).rows
    expect(observations.filter((row) => row.status === "NOT_FOLLOWED" && row.analytics_status === "VERIFIED").length).toBeGreaterThanOrEqual(3)
    expect(observations.filter((row) => row.status === "NOT_FOLLOWED").every((row) => row.seconds < 1000)).toBe(true)
    const deadlinePattern = investigation.patterns.behaviors.find((behavior) => behavior.practiceKey === "BEHAVIOR:INFORM_DEADLINE")
    expect(deadlinePattern).toMatchObject({ classification: "DEVELOPMENT" })
    expect(investigation.conclusion.developmentPatterns).toContain("BEHAVIOR:INFORM_DEADLINE")
    expect(["ACTIONABLE_PATTERN", "MIX_AND_OPERATIONAL_PATTERN"]).toContain(investigation.conclusion.type)
    const published = (await publishedOf(operator))[0]!
    // Nada causal no corpo (o aviso das limitações é a negação explícita: "não demonstra que ele causou o resultado").
    const body = published.recommendation.split("**Limitações")[0]!
    expect(body).not.toMatch(/porque|por causa|causou|mais rápido/i)
    expect(published.recommendation).toContain("não demonstra que ele causou o resultado do indicador")
  })

  it("J. RETRY TÉCNICO: 1ª resposta do Agent com JSON malformado (um '}' a mais) → UMA repetição da mesma tarefa só com o aviso de formato → diagnóstico segue; reparos semânticos no mesmo orçamento", async () => {
    const operator = await person("Proof PRV Operadora J", await subteam("PRV J"))
    await officialClosing(operator, [{ period, value: 495, target: 450, achievement: 90.9, quartile: "Q4" }, { period: previousPeriod, value: 410, target: 450, achievement: 109, quartile: "Q2" }])
    for (const [index, dayOfMonth] of [3, 6, 11, 14, 18, 24].entries()) await interaction(operator, REASON, day(period, dayOfMonth), index === 1 ? 1500 : 800, index === 1 ? TRANSCRIPT_DONE : TRANSCRIPT_GAP)
    control.calls.length = 0
    control.agentPrompts.length = 0
    control.agentTags.length = 0
    control.repairPrompts.length = 0
    control.narrativeReply = null
    let attempt = 0
    control.agentReply = (prompt) => (attempt++ === 0 ? { __raw: `${JSON.stringify(assessingAgent(prompt))}}` } : assessingAgent(prompt))
    const enrollment = await enroll(operator)
    try {
      expect(await drive(enrollment)).toMatchObject({ status: "completed", current_node_id: "end" })
    } finally {
      control.agentReply = assessingAgent
    }
    // 2 chamadas do Agent (a 2ª marcada como retry técnico) + os MESMOS 5 reparos do cenário A + redator.
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", "AGENT_SYNTHESIS", ...Array(5).fill("ASSESSMENT_COVERAGE_REPAIR"), "PRV_NARRATIVE"])
    expect(control.agentTags).toEqual([[], ["stage:STRUCTURED_OUTPUT_RETRY"]])
    const [first, second] = control.agentPrompts
    expect(second!.startsWith(first!)).toBe(true)
    expect(second!.slice(first!.length).trim()).toBe(STRUCTURED_OUTPUT_RETRY_NOTICE)
    const outputs = (await pool.query<{ node_outputs: unknown }>("select node_outputs from workflow_enrollments where id = $1", [enrollment])).rows[0]!.node_outputs
    const find = (value: unknown): { structuredOutput?: { structuredOutputRetryCount: number }; coverage?: { repairInteractions: number } } | null => {
      if (!value || typeof value !== "object") return null
      if ("structuredOutput" in value && "coverage" in value) return value as never
      for (const child of Object.values(value)) { const found = find(child); if (found) return found }
      return null
    }
    const assessment = find(outputs)
    expect(assessment?.structuredOutput?.structuredOutputRetryCount).toBe(1)
    expect(assessment?.coverage?.repairInteractions).toBe(5)
    expect(await publishedOf(operator)).toHaveLength(1)
  })

  it("K. RETRY TÉCNICO: duas respostas malformadas → falha fechada (sem 3ª chamada, sem reparo, sem feedback)", async () => {
    const operator = await person("Proof PRV Operadora K", await subteam("PRV K"))
    await officialClosing(operator, [{ period, value: 495, target: 450, achievement: 90.9, quartile: "Q4" }, { period: previousPeriod, value: 410, target: 450, achievement: 109, quartile: "Q2" }])
    for (const [index, dayOfMonth] of [3, 6, 11, 14, 18, 24].entries()) await interaction(operator, REASON, day(period, dayOfMonth), index === 1 ? 1500 : 800, index === 1 ? TRANSCRIPT_DONE : TRANSCRIPT_GAP)
    control.calls.length = 0
    control.agentPrompts.length = 0
    control.agentTags.length = 0
    control.agentReply = (prompt) => ({ __raw: `${JSON.stringify(assessingAgent(prompt))}}` })
    const enrollment = await enroll(operator)
    try {
      await drive(enrollment).catch(() => null)
    } finally {
      control.agentReply = assessingAgent
    }
    expect(await state(enrollment)).toMatchObject({ status: "dead" })
    expect(control.calls).toEqual(["AGENT_SYNTHESIS", "AGENT_SYNTHESIS"])
    const dead = (await pool.query<{ payload: { errorCode: string; errorCategory: string } }>("select payload from workflow_enrollment_events where enrollment_id = $1 and event_type = 'flow_dead'", [enrollment])).rows[0]!.payload
    expect(dead).toMatchObject({ errorCode: "AGENT_STRUCTURED_OUTPUT_INVALID", errorCategory: "MODEL_OUTPUT_CONTRACT_INVALID" })
    expect(await publishedOf(operator)).toHaveLength(0)
  })
})
