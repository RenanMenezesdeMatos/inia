import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { productionEffects } from "../../workflows/application/effect-sink.js"
import { processNode, type ProcessContext } from "../../workflows/application/node-handlers.js"
import { validateWorkflowForPublish } from "../../workflows/application/validate-workflow-for-publish.js"
import type { FlowGraph } from "../../workflows/domain/graph-schema.js"
import { SimulationEffectSink } from "../../qa-lab/application/simulation-effect-sink.js"
import { createReadOnlyDatabase } from "../../qa-lab/application/read-only-database.js"
import { INTERVENTION_POLICY_SCHEMA_VERSION, type PolicyDefinition } from "../domain/policy-definition.js"
import { INTERVENTION_TYPE_SCHEMA_VERSION, type InterventionTypeDefinition } from "../domain/intervention-type.js"
import { applyEvaluation } from "../application/apply-evaluation.js"
import { loadPolicyHeader, policyVersionInForceAt } from "../application/catalog.js"
import * as config from "../application/config-service.js"
import { evaluatePolicy } from "../application/evaluate-policy.js"
import { generateReportNarrative } from "../application/report-narrative.js"
import type { InterventionPolicyNodeOutput } from "../../workflows/application/intervention-policy-executor.js"

/**
 * PROVA das políticas de acompanhamento contra o banco de TESTE real:
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run interventions-proof
 * Estrutura própria (Grupo "QA Intervenções": gerente → supervisora → operadoras), fechamentos OFICIAIS com quartil, tipos e
 * políticas criados pelo serviço da administração (o mesmo da tela), o nó do Workflow pelo `processNode` do motor, e o percurso
 * do líder pela API. Tudo o que a prova cria é apagado no fim (purga explícita do histórico, só para teste).
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const OPERATION = "00000000-0000-4000-8000-000000000010"
const PASSWORD = "Inia@123"
const ADMIN_GERAL = "carla.nunes@inia.com"
const TAG = `qaint${Date.now().toString(36)}`
const KEY = TAG.toUpperCase().replace(/[^A-Z0-9]/g, "")

let pool: pg.Pool
let app: ReturnType<typeof createApp>
const ids = { team: "", manager: "", supervisor: "", operator: "", operatorNoData: "", operatorRace: "", policyEditor: "", managerAccount: "", supervisorAccount: "", indicator: "", grant: "" }
const actor = { userAccountId: "", personId: "" }
const typeIds: Record<string, string> = {}
let policyId = ""
let continuityPolicyId = ""

const typeDef = (name: string, extra: Partial<InterventionTypeDefinition>): InterventionTypeDefinition => ({
  schemaVersion: INTERVENTION_TYPE_SCHEMA_VERSION,
  name,
  description: `${name} (prova)`,
  capabilities: ["GUIDANCE"],
  responsibleRole: "SUPERVISOR",
  defaultDueDays: 15,
  approval: { required: false },
  evidence: { minimumItems: 1, acceptedKinds: ["EVALUATION", "INDICATOR_RESULT", "FEEDBACK"] },
  form: [],
  completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: true },
  incompatibleWith: [],
  aiDraft: false,
  ...extra,
})

const quartileQ4 = (code: string) => ({ kind: "INDICATOR" as const, criterion: { comparator: "GTE" as const, thresholdNumeric: 2, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE" as const, metric: "INDICATOR_QUARTILE" as const, indicatorCode: code, recurrence: { periods: 2, matchQuartile: "Q4" as const } } } })

async function purge() {
  const client = await pool.connect()
  try {
    await client.query("begin")
    await client.query(`set local inia.history_purge = 'on'`)
    const people = [ids.manager, ids.supervisor, ids.operator, ids.operatorNoData, ids.operatorRace, ids.policyEditor].filter(Boolean)
    await client.query(`delete from alerts where recipient_id = any($1::uuid[]) or case_id in (select id from supervision_cases where operator_id = any($1::uuid[]))`, [people])
    await client.query(`delete from intervention_events where intervention_id in (select id from interventions where person_id = any($1::uuid[]))`, [people])
    await client.query(`delete from intervention_items where intervention_id in (select id from interventions where person_id = any($1::uuid[]))`, [people])
    await client.query(`delete from interventions where person_id = any($1::uuid[])`, [people])
    await client.query(`delete from intervention_report_narratives where report_id in (select id from intervention_reports where person_id = any($1::uuid[]))`, [people])
    await client.query(`delete from intervention_reports where person_id = any($1::uuid[])`, [people])
    await client.query(`delete from intervention_policy_evaluations where person_id = any($1::uuid[])`, [people])
    await client.query(`delete from case_timeline_events where case_id in (select id from supervision_cases where operator_id = any($1::uuid[]))`, [people])
    await client.query(`delete from supervision_cases where operator_id = any($1::uuid[])`, [people])
    await client.query(`delete from intervention_policy_versions where policy_id in (select id from intervention_policies where key like $1)`, [`${KEY}%`])
    await client.query(`delete from audit_logs where entity_id in (select id from intervention_policies where key like $1) or entity_id in (select id from intervention_types where key like $1)`, [`${KEY}%`])
    await client.query(`delete from intervention_policies where key like $1`, [`${KEY}%`])
    await client.query(`delete from intervention_type_versions where type_id in (select id from intervention_types where key like $1)`, [`${KEY}%`])
    await client.query(`delete from intervention_types where key like $1`, [`${KEY}%`])
    await client.query(`delete from interactions where operator_id = any($1::uuid[])`, [people])
    await client.query(`delete from channel_flags where flag_name like $1`, [`${TAG}%`])
    await client.query(`delete from audit_logs where entity_id in (select id from competencies where key like $1)`, [`${KEY}%`])
    await client.query(`delete from competencies where key like $1`, [`${KEY}%`])
    await client.query(`delete from knowledge_versions where document_id in (select id from knowledge_documents where title like $1)`, [`%${TAG}%`])
    await client.query(`delete from knowledge_documents where title like $1`, [`%${TAG}%`])
    await client.query(`delete from employee_indicator_performance where person_id = any($1::uuid[])`, [people])
    await client.query(`delete from indicator_definitions where code like $1`, [`${KEY}%`])
    await client.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where person_id = any($1::uuid[]))`, [people])
    await client.query(`delete from auth_login_attempts where account_id in (select id from user_accounts where person_id = any($1::uuid[]))`, [people])
    await client.query(`delete from auth_revoked_sessions where account_id in (select id from user_accounts where person_id = any($1::uuid[]))`, [people])
    await client.query(`delete from person_profile_preferences where person_id = any($1::uuid[])`, [people])
    await client.query(`delete from user_accounts where person_id = any($1::uuid[])`, [people])
    await client.query(`update people set reports_to_id = null where id = any($1::uuid[])`, [people])
    await client.query(`delete from people where id = any($1::uuid[])`, [people])
    if (ids.team) await client.query(`delete from teams where id = $1`, [ids.team])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}

async function login(email: string) {
  await setProofAccountPassword(pool, email, PASSWORD)
  const agent = request.agent(app)
  const response = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD })
  expect(response.status).toBe(200)
  return agent
}

async function person(name: string, role: string, reportsTo: string | null) {
  return (await pool.query<{ id: string }>(`insert into people (organization_id, team_id, name, role, reports_to_id, hired_at) values ($1,$2,$3,$4,$5,'2025-01-01') returning id`, [ORG, ids.team, `${name} ${TAG}`, role, reportsTo])).rows[0]!.id
}

async function account(personId: string, email: string) {
  return (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,$4) returning id`, [ORG, personId, email, await hashPassword(PASSWORD)])).rows[0]!.id
}

function contextFor(enrollmentId: string, personId: string, effects = productionEffects, now = new Date()): { context: ProcessContext; graph: FlowGraph } {
  const graph: FlowGraph = {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "policy", type: "intervention_policy", label: "Avaliar política", position: { x: 0, y: 100 }, config: { policyId, mode: "APPLY_POLICY", analysisSourceNodeIds: [] } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 200 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "policy" },
      { id: "e2", source: "policy", sourceHandle: "always", target: "end" },
    ],
  }
  return {
    graph,
    context: {
      db: pool,
      graph,
      enrollment: { id: enrollmentId, organization_id: ORG, workflow_id: randomUUID(), version_id: randomUUID(), interaction_id: null, indicator_measurement_id: null, scheduled_subject_id: personId, scheduled_for: null, current_node_id: "policy", matched_flag_name: null, matched_value_boolean: null, matched_value_numeric: null, status: "active", attempts: 0, revision: 0, node_outputs: {}, variables: {} },
      workflow: { scopeType: "ALL_TEAMS", teamId: null, subteamId: null },
      inputContext: "",
      now,
      effects,
    },
  }
}

const count = async (table: string, personId: string) => Number((await pool.query<{ n: number }>(`select count(*)::int n from ${table} where person_id = $1`, [personId])).rows[0]!.n)

describe.skipIf(!ENABLED)("Políticas de acompanhamento e intervenções — percurso completo (banco de teste real)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    app = createApp(pool)
    ids.team = (await pool.query<{ id: string }>(`insert into teams (organization_id, operation_id, name) values ($1, $2, $3) returning id`, [ORG, OPERATION, `QA Intervenções ${TAG}`])).rows[0]!.id
    ids.manager = await person("Gerente", "MANAGER", null)
    ids.supervisor = await person("Supervisora", "SUPERVISOR", ids.manager)
    ids.operator = await person("Operadora", "OPERATOR", ids.supervisor)
    ids.operatorNoData = await person("Operadora sem dados", "OPERATOR", ids.supervisor)
    ids.operatorRace = await person("Operadora corrida", "OPERATOR", ids.supervisor)
    ids.managerAccount = await account(ids.manager, `gerente.${TAG}@inia.local`)
    ids.supervisorAccount = await account(ids.supervisor, `supervisora.${TAG}@inia.local`)
    ids.indicator = (await pool.query<{ id: string }>(`insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, $2, 'TMA da prova', 'SECONDS', 'LOWER') returning id`, [ORG, `${KEY}_TMA`])).rows[0]!.id
    // Fechamentos OFICIAIS recebidos prontos (nunca recalculados): Q4 = pior, nos dois últimos meses fechados.
    for (const personId of [ids.operator, ids.operatorRace]) {
      for (const period of ["2026-08", "2026-09"]) await pool.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, quartile, source) values ($1,$2,$3,$4,520,400,76.9,'Q4','PROOF')`, [ORG, personId, ids.indicator, period])
    }
    const carla = (await pool.query<{ id: string; person_id: string }>(`select id, person_id from user_accounts where lower(email) = $1`, [ADMIN_GERAL])).rows[0]!
    Object.assign(actor, { userAccountId: carla.id, personId: carla.person_id })
    // Decisão sensível: concessão EXPLÍCITA ao gerente, no Grupo da prova (nenhum papel administrativo a tem por padrão).
    ids.grant = (await pool.query<{ id: string }>(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, source, granted_by_account_id, granted_at) values ($1,$2,'AVALIADOR_DE_CONTINUIDADE','GROUP',$3,'MANUAL',$4,now()) returning id`, [ORG, ids.managerAccount, ids.team, carla.id])).rows[0]!.id
  })
  afterAll(async () => {
    if (pool) {
      await purge()
      await pool.end()
    }
  })

  it("o administrador cria tipos e uma política pela API de configuração, sem código; publicar exige combinação válida", async () => {
    const admin = await login(ADMIN_GERAL)
    const create = async (suffix: string, definition: InterventionTypeDefinition) => {
      const created = await admin.post("/api/v1/admin/intervention-policies/types").send({ key: `${KEY}_${suffix}`, definition })
      expect(created.status, JSON.stringify(created.body)).toBe(201)
      const published = await admin.post(`/api/v1/admin/intervention-policies/types/${created.body.data.id}/publish`)
      expect(published.status, JSON.stringify(published.body)).toBe(200)
      typeIds[suffix] = created.body.data.id
    }
    await create("ORIENTAR", typeDef("Orientar", { capabilities: ["GUIDANCE"] }))
    await create("OBSERVAR", typeDef("Observar", { capabilities: ["OBSERVATION", "CHECKPOINTS"] }))
    await create("PLANO", typeDef("Plano de ação", { capabilities: ["ACTION_PLAN"], approval: { required: true, approverRole: "MANAGER" }, completion: { requireAllTasksDone: true, requireLearningAssessment: false, requireOperationalReading: true, requireOutcomeNote: true } }))
    await create("REVISAR_DADOS", typeDef("Revisar dados", { capabilities: ["DATA_REVIEW"] }))
    await create("CONTINUIDADE", typeDef("Solicitar avaliação de continuidade", { capabilities: ["CONTINUITY_REVIEW"], responsibleRole: "SUPERVISOR", approval: { required: true, approverRole: "MANAGER" }, completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false } }))

    // Tipo que tenta enfraquecer a avaliação de continuidade: publicar é recusado (regra fixa, não configurável).
    const weak = await admin.post("/api/v1/admin/intervention-policies/types").send({ key: `${KEY}_FRACO`, definition: typeDef("Continuidade sem decisão", { capabilities: ["CONTINUITY_REVIEW"], approval: { required: false }, completion: { requireAllTasksDone: false, requireLearningAssessment: false, requireOperationalReading: false, requireOutcomeNote: false } }) })
    expect(weak.status).toBe(201)
    const rejected = await admin.post(`/api/v1/admin/intervention-policies/types/${weak.body.data.id}/publish`)
    expect(rejected.status).toBe(422)
    expect(rejected.body.error.details.issues.map((issue: { code: string }) => issue.code)).toContain("CONTINUITY_REVIEW_APPROVAL_REQUIRED")

    const policy = await admin.post("/api/v1/admin/intervention-policies/policies").send({ key: `${KEY}_TMA`, name: `Acompanhamento TMA ${TAG}`, scopeType: "GROUP", teamId: ids.team })
    expect(policy.status, JSON.stringify(policy.body)).toBe(201)
    policyId = policy.body.data.id
    const definition: PolicyDefinition = {
      schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION,
      description: "Prova: quartil oficial Q4 recorrente abre plano (aprovação) e recomenda orientação; dado insuficiente pede revisão de dados.",
      indicatorCode: `${KEY}_TMA`,
      matchStrategy: "ALL_MATCHES",
      report: { aiNarrative: false },
      rules: [
        { key: "Q4_RECORRENTE", name: "Q4 oficial em 2 fechamentos", priority: 1, justification: "Resultado oficial no pior quartil por dois fechamentos seguidos.", when: { operator: "ALL", items: [quartileQ4(`${KEY}_TMA`)] }, actions: [{ typeKey: `${KEY}_PLANO`, effect: "OPEN", dueInDays: 30, onActive: "UPDATE", cooldownDays: 0 }, { typeKey: `${KEY}_ORIENTAR`, effect: "RECOMMEND", dueInDays: null, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [{ typeKey: `${KEY}_REVISAR_DADOS`, effect: "OPEN", dueInDays: 7, onActive: "KEEP", cooldownDays: 0 }] },
        { key: "SEMPRE_OBSERVAR", name: "Observar a evolução", priority: 2, justification: "Acompanhar a evolução do indicador de perto.", when: { operator: "ALL", items: [{ kind: "PRIOR_INTERVENTIONS", typeKeys: [], statuses: ["ACTIVE", "COMPLETED", "CANCELLED"], operationalResults: [], sameSubject: true, withinDays: 365, comparator: "GTE", threshold: 0 }] }, actions: [{ typeKey: `${KEY}_OBSERVAR`, effect: "OPEN", dueInDays: null, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] },
      ],
    }
    expect((await admin.put(`/api/v1/admin/intervention-policies/policies/${policyId}/draft`).send({ definition })).status).toBe(200)
    const validation = await admin.post(`/api/v1/admin/intervention-policies/policies/${policyId}/validate`)
    expect(validation.body.data).toEqual({ valid: true, issues: [] })
    const published = await admin.post(`/api/v1/admin/intervention-policies/policies/${policyId}/publish`).send({})
    expect(published.status, JSON.stringify(published.body)).toBe(200)
    expect(published.body.data.inForce.version).toBe(1)

    // Versão publicada é imutável no banco (mesmo fora da aplicação).
    await expect(pool.query(`update intervention_policy_versions set definition = '{}'::jsonb where policy_id = $1 and status = 'PUBLISHED'`, [policyId])).rejects.toThrow(/imutável/)
  })

  it("simulação: fatos, condições e ações propostas — e nenhuma linha gravada", async () => {
    const admin = await login(ADMIN_GERAL)
    const before = { evaluations: await count("intervention_policy_evaluations", ids.operator), interventions: await count("interventions", ids.operator) }
    const simulated = await admin.post(`/api/v1/admin/intervention-policies/policies/${policyId}/simulate`).send({ personId: ids.operator })
    expect(simulated.status, JSON.stringify(simulated.body)).toBe(200)
    expect(simulated.body.data.effects).toBe("NONE")
    expect(simulated.body.data.evaluation.outcome).toBe("CREATED")
    expect(simulated.body.data.evaluation.decisions.map((decision: { typeKey: string; status: string }) => [decision.typeKey, decision.status])).toEqual([[`${KEY}_PLANO`, "PENDING_APPROVAL"], [`${KEY}_ORIENTAR`, "RECOMMENDED"], [`${KEY}_OBSERVAR`, "CREATED"]])
    expect(simulated.body.data.report.facts[0].statement).toMatch(/Q4 em 2 dos últimos 2 fechamentos oficiais \(Q1 = melhor, Q4 = pior\)/)
    expect({ evaluations: await count("intervention_policy_evaluations", ids.operator), interventions: await count("interventions", ids.operator) }).toEqual(before)
  })

  it("dados insuficientes não viram classificação: sem fechamento oficial a regra é INCONCLUSIVA e só abre a revisão de dados", async () => {
    const policy = (await loadPolicyHeader(pool, ORG, policyId))!
    const evaluation = (await evaluatePolicy(pool, { organizationId: ORG, policy, personId: ids.operatorNoData, asOf: new Date(), recommendOnly: false }))!
    expect(evaluation.rules.find((rule) => rule.key === "Q4_RECORRENTE")?.status).toBe("INCONCLUSIVE")
    expect(evaluation.decisions.map((decision) => [decision.typeKey, decision.mode, decision.status])).toEqual([[`${KEY}_REVISAR_DADOS`, "INCONCLUSIVE", "CREATED"], [`${KEY}_OBSERVAR`, "MATCHED", "CREATED"]])
    expect(evaluation.decisions.some((decision) => decision.typeKey === `${KEY}_PLANO`)).toBe(false)
  })

  it("o nó do Workflow avalia a política publicada, abre intervenções rastreáveis e o retry não duplica nada", async () => {
    const enrollmentId = randomUUID()
    const { context } = contextFor(enrollmentId, ids.operator)
    const node = context.graph.nodes.find((candidate) => candidate.id === "policy")!
    const first = await processNode(context, node)
    expect(first.kind).toBe("advance")
    const output = (first as { nodeOutput: InterventionPolicyNodeOutput }).nodeOutput
    expect(output.structuredResult.outcome).toBe("CREATED")
    expect(output.structuredResult.decisionsByType).toEqual({ [`${KEY}_OBSERVAR`]: "CREATED", [`${KEY}_ORIENTAR`]: "RECOMMENDED", [`${KEY}_PLANO`]: "PENDING_APPROVAL", [`${KEY}_REVISAR_DADOS`]: "NOT_DECIDED" })
    expect(output.caseId).toBeTruthy()
    expect((first as unknown as { eventPayload: { caseId: string } }).eventPayload.caseId).toBe(output.caseId)

    const rows = (await pool.query<{ type_key: string; status: string; case_id: string; responsible_id: string; approver_id: string | null; policy_version_id: string; evaluation_id: string; report_id: string; enrollment_id: string }>(`select type_key, status, case_id, responsible_id, approver_id, policy_version_id, evaluation_id, report_id, enrollment_id from interventions where person_id = $1 order by type_key`, [ids.operator])).rows
    expect(rows.map((row) => [row.type_key, row.status])).toEqual([[`${KEY}_OBSERVAR`, "IN_PROGRESS"], [`${KEY}_ORIENTAR`, "PROPOSED"], [`${KEY}_PLANO`, "AWAITING_APPROVAL"]])
    expect(new Set(rows.map((row) => row.case_id)).size).toBe(1)
    expect(new Set(rows.map((row) => row.report_id)).size).toBe(1)
    expect(rows.every((row) => row.responsible_id === ids.supervisor && row.enrollment_id === enrollmentId && row.evaluation_id === output.evaluationId)).toBe(true)
    expect(rows.find((row) => row.type_key === `${KEY}_PLANO`)?.approver_id).toBe(ids.manager)
    const report = (await pool.query<{ structured: { actions: { typeKey: string; justification: string; responsible: { name: string } }[]; facts: unknown[]; policy: { version: number } } }>(`select structured from intervention_reports where id = $1`, [output.reportId])).rows[0]!.structured
    expect(report.policy.version).toBe(1)
    expect(report.actions).toHaveLength(3)
    expect(report.actions.every((action) => action.justification.length > 0 && action.responsible.name.includes("Supervisora"))).toBe(true)
    const timeline = (await pool.query<{ event_type: string }>(`select event_type from case_timeline_events where case_id = $1`, [output.caseId])).rows.map((row) => row.event_type)
    expect(timeline).toEqual(expect.arrayContaining(["CASE_OPENED_BY_POLICY", "INTERVENTION_OPENED", "INTERVENTION_REPORT_CREATED"]))
    // Cabeçalho do caso = o fato da regra que decidiu, dito como ele é; limiar de recorrência não vira "meta".
    const caseRow = (await pool.query<{ indicator_value: string; indicator_target: string }>(`select indicator_value, indicator_target from supervision_cases where id = $1`, [output.caseId])).rows[0]!
    expect(caseRow).toEqual({ indicator_value: "Q4 em 2 de 2 fechamentos", indicator_target: "—" })

    // Retry/retomada do MESMO nó: devolve a mesma avaliação, nada novo.
    const again = await processNode({ ...context, now: new Date(Date.now() + 60_000) }, node)
    expect((again as { nodeOutput: InterventionPolicyNodeOutput }).nodeOutput.evaluationId).toBe(output.evaluationId)
    expect(await count("interventions", ids.operator)).toBe(3)
    expect(await count("intervention_policy_evaluations", ids.operator)).toBe(1)

    // Nova execução (outro disparo): mesma identidade ativa → EXISTING; o plano (onActive UPDATE) registra o sinal.
    const second = await processNode(contextFor(randomUUID(), ids.operator).context, node)
    const secondOutput = (second as { nodeOutput: InterventionPolicyNodeOutput }).nodeOutput
    expect(secondOutput.structuredResult.outcome).toBe("EXISTING")
    expect(secondOutput.decisions.find((decision) => decision.typeKey === `${KEY}_PLANO`)).toMatchObject({ status: "EXISTING", updated: true })
    expect(await count("interventions", ids.operator)).toBe(3)
    expect((await pool.query<{ signal_count: number }>(`select signal_count from interventions where person_id = $1 and type_key = $2`, [ids.operator, `${KEY}_PLANO`])).rows[0]!.signal_count).toBe(2)
  })

  it("QA Lab: o mesmo nó sobre banco somente leitura e efeitos simulados não grava nada", async () => {
    const sink = new SimulationEffectSink()
    const { context } = contextFor(randomUUID(), ids.operatorRace, sink)
    const before = await count("intervention_policy_evaluations", ids.operatorRace)
    const outcome = await processNode({ ...context, db: createReadOnlyDatabase(pool) }, context.graph.nodes[1]!)
    expect((outcome as { nodeOutput: InterventionPolicyNodeOutput }).nodeOutput.structuredResult.outcome).toBe("CREATED")
    expect(sink.effects.find((effect) => effect.kind === "INTERVENTION_POLICY")).toBeTruthy()
    expect(await count("intervention_policy_evaluations", ids.operatorRace)).toBe(before)
  })

  it("concorrência: duas avaliações simultâneas da mesma identidade abrem UMA intervenção; a outra registra a existente", async () => {
    const policy = (await loadPolicyHeader(pool, ORG, policyId))!
    const [a, b] = await Promise.all([1, 2].map(() => evaluatePolicy(pool, { organizationId: ORG, policy, personId: ids.operatorRace, asOf: new Date(), recommendOnly: false })))
    const [ra, rb] = await Promise.all([applyEvaluation(pool, { evaluation: a!, origin: "MANUAL", idempotencyKey: `race:${randomUUID()}`, requestedBy: ids.supervisor }), applyEvaluation(pool, { evaluation: b!, origin: "MANUAL", idempotencyKey: `race:${randomUUID()}`, requestedBy: ids.supervisor })])
    const plano = [ra, rb].map((result) => result.decisions.find((decision) => decision.typeKey === `${KEY}_PLANO`)!.status).sort()
    expect(plano).toEqual(["EXISTING", "PENDING_APPROVAL"])
    expect(Number((await pool.query<{ n: number }>(`select count(*)::int n from interventions where person_id = $1 and type_key = $2`, [ids.operatorRace, `${KEY}_PLANO`])).rows[0]!.n)).toBe(1)
  })

  it("versão fixada: uma publicação posterior não muda o que estava em vigor nem as intervenções abertas", async () => {
    const before = new Date()
    const policy = await config.getPolicy(pool, ORG, policyId)
    await config.savePolicyDraft(pool, ORG, actor, policyId, { ...policy.inForce!.definition, description: "v2 da prova" })
    await config.publishPolicyDraft(pool, ORG, actor, policyId)
    expect((await policyVersionInForceAt(pool, ORG, policyId, before))?.version).toBe(1)
    expect((await policyVersionInForceAt(pool, ORG, policyId, new Date()))?.version).toBe(2)
    const versions = (await pool.query<{ version: number }>(`select v.version from interventions i join intervention_policy_versions v on v.id = i.policy_version_id where i.person_id = $1`, [ids.operator])).rows
    expect(versions.every((row) => row.version === 1)).toBe(true)
  })

  it("percurso do líder: aviso → pendência → caso → aceitar/aprovar → executar → registrar resultado", async () => {
    const supervisor = await login(`supervisora.${TAG}@inia.local`)
    const manager = await login(`gerente.${TAG}@inia.local`)
    const bell = await supervisor.get("/api/v1/notifications")
    const assigned = bell.body.data.items.find((item: { kind: string; title: string }) => item.kind === "INTERVENTION" && item.title.includes("Orientar"))
    expect(assigned.target).toMatchObject({ type: "INTERVENTION" })

    const pending = await supervisor.get("/api/v1/pending-actions")
    const items = pending.body.data.pending.filter((item: { kind: string }) => item.kind === "INTERVENTION")
    expect(items.some((item: { typeName: string; pendingReason: string }) => item.typeName === "Orientar" && item.pendingReason === "ACCEPT")).toBe(true)
    const orientar = items.find((item: { typeName: string; operator: { personId: string } }) => item.typeName === "Orientar" && item.operator.personId === ids.operator)
    const detail = await supervisor.get(`/api/v1/interventions/${orientar.interventionId}`)
    expect(detail.status).toBe(200)
    expect(detail.body.data.report.structured.actions.length).toBe(3)
    expect(detail.body.data.availableActions).toEqual(expect.arrayContaining(["ACCEPT", "CANCEL", "FORWARD"]))
    const accepted = await supervisor.post(`/api/v1/interventions/${orientar.interventionId}/accept`).send({ expectedRevision: detail.body.data.revision })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.data.status).toBe("IN_PROGRESS")
    // A pendência foi resolvida, a intervenção continua (no caso e na ficha) até a conclusão registrada.
    const caseView = await supervisor.get(`/api/v1/interventions/cases/${orientar.caseId}`)
    expect(caseView.body.data.interventions.find((item: { id: string }) => item.id === orientar.interventionId).status).toBe("IN_PROGRESS")
    const completed = await supervisor.post(`/api/v1/interventions/${orientar.interventionId}/complete`).send({ note: "Orientação feita na reunião de 13/10 com o procedimento.", expectedRevision: accepted.body.data.revision })
    expect(completed.body.data.status).toBe("COMPLETED")

    // Plano: só o aprovador designado aprova (a supervisora responsável não); o gerente vê na Pendências dele.
    const plano = (await pool.query<{ id: string }>(`select id from interventions where person_id = $1 and type_key = $2`, [ids.operator, `${KEY}_PLANO`])).rows[0]!.id
    expect((await supervisor.post(`/api/v1/interventions/${plano}/approve`).send({})).status).toBe(403)
    const managerPending = await manager.get("/api/v1/pending-actions")
    expect(managerPending.body.data.pending.some((item: { interventionId?: string; pendingReason?: string }) => item.interventionId === plano && item.pendingReason === "APPROVE")).toBe(true)
    expect(managerPending.body.data.pendingCount).toBeGreaterThanOrEqual(1)
    const approved = await manager.post(`/api/v1/interventions/${plano}/approve`).send({ note: "Ok" })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.data.status).toBe("IN_PROGRESS")

    // Executar: tarefa + checkpoint com leitura; concluir separa tarefas, aprendizagem e evolução operacional.
    let revision = approved.body.data.revision as number
    const task = await supervisor.post(`/api/v1/interventions/${plano}/items`).send({ kind: "TASK", title: "Ouvir 3 chamadas com a colaboradora", ownerId: ids.operator, dueAt: "2026-10-20", expectedRevision: revision })
    expect(task.status, JSON.stringify(task.body)).toBe(200)
    revision = task.body.data.revision
    const checkpoint = task.body.data.items.find((item: { kind: string }) => item.kind === "CHECKPOINT")
    const taskItem = task.body.data.items.find((item: { kind: string }) => item.kind === "TASK")
    expect((await supervisor.patch(`/api/v1/interventions/${plano}/items/${checkpoint.id}`).send({ status: "DONE", expectedRevision: revision })).status).toBe(422)
    const recorded = await supervisor.patch(`/api/v1/interventions/${plano}/items/${checkpoint.id}`).send({ status: "DONE", reading: "TMA 470 s na semana (meta 400 s).", expectedRevision: revision })
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200)
    revision = recorded.body.data.revision
    const early = await supervisor.post(`/api/v1/interventions/${plano}/complete`).send({ note: "Plano cumprido.", operational: { result: "IMPROVED", reading: "" }, expectedRevision: revision })
    expect(early.status).toBe(422)
    expect(early.body.error.details.issues.map((issue: { code: string }) => issue.code)).toEqual(expect.arrayContaining(["INTERVENTION_TASKS_PENDING", "INTERVENTION_OPERATIONAL_READING"]))
    const done = await supervisor.patch(`/api/v1/interventions/${plano}/items/${taskItem.id}`).send({ status: "DONE", note: "Feito.", expectedRevision: revision })
    revision = done.body.data.revision
    const stale = await supervisor.post(`/api/v1/interventions/${plano}/complete`).send({ note: "x", expectedRevision: revision - 1 })
    expect(stale.status).toBe(409)
    const final = await supervisor.post(`/api/v1/interventions/${plano}/complete`).send({ note: "Plano cumprido.", operational: { result: "UNCHANGED", reading: "TMA de outubro 465 s × 520 s no fechamento de setembro; meta 400 s." }, expectedRevision: revision })
    expect(final.status, JSON.stringify(final.body)).toBe(200)
    expect(final.body.data.outcome).toMatchObject({ activities: { tasksTotal: 1, tasksDone: 1 }, operational: { result: "UNCHANGED" } })
    expect(final.body.data.events.map((event: { eventType: string }) => event.eventType)).toEqual(expect.arrayContaining(["OPENED", "SIGNAL_RECEIVED", "APPROVED", "ITEM_ADDED", "CHECKPOINT_RECORDED", "COMPLETED"]))
  })

  it("avaliação de continuidade: abre por regra como SOLICITAÇÃO; só quem tem a permissão sensível decide; nada muda na situação funcional", async () => {
    const admin = await login(ADMIN_GERAL)
    const policy = await admin.post("/api/v1/admin/intervention-policies/policies").send({ key: `${KEY}_CONT`, name: `Continuidade ${TAG}`, scopeType: "GROUP", teamId: ids.team })
    continuityPolicyId = policy.body.data.id
    const definition: PolicyDefinition = {
      schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION,
      description: "Prova da avaliação de continuidade.",
      indicatorCode: `${KEY}_TMA`,
      matchStrategy: "FIRST_MATCH",
      report: { aiNarrative: false },
      rules: [{ key: "Q4_PERSISTENTE", name: "Q4 oficial persistente", priority: 1, justification: "Pior quartil oficial em fechamentos consecutivos, depois de plano de ação concluído.", when: { operator: "ALL", items: [quartileQ4(`${KEY}_TMA`)] }, actions: [{ typeKey: `${KEY}_CONTINUIDADE`, effect: "OPEN", dueInDays: 10, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] }],
    }
    await admin.put(`/api/v1/admin/intervention-policies/policies/${continuityPolicyId}/draft`).send({ definition })
    expect((await admin.post(`/api/v1/admin/intervention-policies/policies/${continuityPolicyId}/publish`).send({})).status).toBe(200)
    const header = (await loadPolicyHeader(pool, ORG, continuityPolicyId))!
    const statusBefore = (await pool.query(`select current_employment_status, active from people where id = $1`, [ids.operator])).rows[0]
    const periodsBefore = Number((await pool.query<{ n: number }>(`select count(*)::int n from employee_status_periods where person_id = $1`, [ids.operator])).rows[0]!.n)
    const applied = await applyEvaluation(pool, { evaluation: (await evaluatePolicy(pool, { organizationId: ORG, policy: header, personId: ids.operator, asOf: new Date(), recommendOnly: false }))!, origin: "MANUAL", idempotencyKey: `cont:${randomUUID()}`, requestedBy: null })
    const decision = applied.decisions[0]!
    expect(decision.status).toBe("PENDING_APPROVAL")
    const row = (await pool.query<{ status: string; sensitive: boolean; approval_recipient_ids: string[] }>(`select status, sensitive, approval_recipient_ids from interventions where id = $1`, [decision.interventionId])).rows[0]!
    expect(row).toMatchObject({ status: "AWAITING_APPROVAL", sensitive: true })
    expect(row.approval_recipient_ids).toContain(ids.manager)

    const supervisor = await login(`supervisora.${TAG}@inia.local`)
    const manager = await login(`gerente.${TAG}@inia.local`)
    expect((await supervisor.post(`/api/v1/interventions/${decision.interventionId}/decide`).send({ decision: "REFERRED_TO_FORMAL_PROCESS", justification: "Tentativa sem a permissão sensível — deve ser negada." })).status).toBe(403)
    expect((await manager.post(`/api/v1/interventions/${decision.interventionId}/approve`).send({})).status).toBe(422)
    expect((await manager.post(`/api/v1/interventions/${decision.interventionId}/decide`).send({ decision: "REFERRED_TO_FORMAL_PROCESS", justification: "curta" })).status).toBe(422)
    const decided = await manager.post(`/api/v1/interventions/${decision.interventionId}/decide`).send({ decision: "REFERRED_TO_FORMAL_PROCESS", justification: "Plano de ação concluído sem evolução; encaminhado ao processo formal conduzido pelo RH." })
    expect(decided.status, JSON.stringify(decided.body)).toBe(200)
    expect(decided.body.data.outcome.continuity).toMatchObject({ decision: "REFERRED_TO_FORMAL_PROCESS", employmentStatusChanged: false })
    expect((await pool.query(`select current_employment_status, active from people where id = $1`, [ids.operator])).rows[0]).toEqual(statusBefore)
    expect(Number((await pool.query<{ n: number }>(`select count(*)::int n from employee_status_periods where person_id = $1`, [ids.operator])).rows[0]!.n)).toBe(periodsBefore)
  })

  it("narrativa da IA: falha fica registrada, o fundamento estruturado continua e a nova tentativa não duplica intervenções", async () => {
    const report = (await pool.query<{ id: string }>(`select id from intervention_reports where person_id = $1 order by created_at limit 1`, [ids.operator])).rows[0]!.id
    const interventionsBefore = await count("interventions", ids.operator)
    const failed = await generateReportNarrative(pool, { organizationId: ORG, reportId: report }, async () => "isto não é JSON")
    expect(failed).toMatchObject({ status: "FAILED", attempt: 1 })
    const invented = await generateReportNarrative(pool, { organizationId: ORG, reportId: report }, async () => JSON.stringify({ situation: { text: "Situação com fato inventado F99 e mais texto.", refs: ["F99"] }, analysis: [{ text: "Análise que cita fonte inexistente no relatório.", refs: ["S77"] }], hypotheses: [], leaderGuidance: [] }))
    expect(invented).toMatchObject({ status: "FAILED", attempt: 2 })
    const ok = await generateReportNarrative(pool, { organizationId: ORG, reportId: report }, async () => JSON.stringify({ situation: { text: "A colaboradora ficou no pior quartil oficial nos dois últimos fechamentos.", refs: ["F1"] }, analysis: [{ text: "O resultado oficial sustenta abrir o plano; não há diagnóstico de causa.", refs: ["F1", "S1"] }], hypotheses: [{ text: "Pode haver concentração em atendimentos longos.", refs: ["F1"], toConfirm: "Investigar a composição das chamadas." }], leaderGuidance: [{ action: "A1", text: "Aprove o plano e acompanhe o checkpoint." }] }))
    expect(ok).toMatchObject({ status: "READY", attempt: 3 })
    expect(await count("interventions", ids.operator)).toBe(interventionsBefore)
    const structured = (await pool.query<{ n: number }>(`select count(*)::int n from intervention_reports where id = $1`, [report])).rows[0]!.n
    expect(structured).toBe(1)
  })

  it("publicação do Workflow: política inexistente ou inativa bloqueia; referência de análise precisa vir antes do nó", async () => {
    const { graph } = contextFor(randomUUID(), ids.operator)
    const row = (policy: string, analysis: string[] = []) => ({ scopeType: "TEAM", teamId: ids.team, subteamId: null, consolidatedStructure: null, triggerConfig: { kind: "manual", context: "COLLABORATOR" } as never, draftGraph: { ...graph, nodes: graph.nodes.map((node) => (node.type === "intervention_policy" ? { ...node, config: { policyId: policy, mode: "APPLY_POLICY", analysisSourceNodeIds: analysis } } : node)) } })
    await expect(validateWorkflowForPublish(pool, ORG, randomUUID(), row(policyId))).resolves.toBeTruthy()
    await expect(validateWorkflowForPublish(pool, ORG, randomUUID(), row(randomUUID()))).rejects.toMatchObject({ code: "WORKFLOW_INTERVENTION_POLICY_NOT_FOUND" })
    await expect(validateWorkflowForPublish(pool, ORG, randomUUID(), row(policyId, ["end"]))).rejects.toMatchObject({ code: "WORKFLOW_INTERVENTION_POLICY_SOURCE_NOT_ANCESTOR" })
    await config.setPolicyActive(pool, ORG, actor, continuityPolicyId, false)
    await expect(validateWorkflowForPublish(pool, ORG, randomUUID(), row(continuityPolicyId))).rejects.toMatchObject({ code: "WORKFLOW_INTERVENTION_POLICY_INACTIVE" })
  })

  it("flag de atendimento, líder direto e competência no treinamento — sem IA e sem digitar chaves", async () => {
    const admin = await login(ADMIN_GERAL)
    const flagName = `${TAG}_rechamada`
    await pool.query(`insert into channel_flags (organization_id, channel, flag_name, value_type, description) values ($1, 'VOICE', $2, 'BOOLEAN', 'Flag da prova')`, [ORG, flagName])
    const flagId = (await pool.query<{ id: string }>(`select id from channel_flags where organization_id = $1 and flag_name = $2`, [ORG, flagName])).rows[0]!.id
    // Quatro atendimentos nos últimos dias, três com a flag: a INIA só lê o que chegou calculado com cada atendimento.
    for (let index = 0; index < 4; index += 1) {
      const started = new Date(Date.now() - (index + 1) * 86_400_000)
      const interaction = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Prova',$3,$4,$5) returning id`, [ORG, ids.operatorNoData, started, new Date(started.getTime() + 300_000), `${TAG}-AT-${index}`])).rows[0]!.id
      if (index < 3) await pool.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_boolean) values ($1,$2,$3,true)`, [ORG, interaction, flagId])
    }
    const catalog = await admin.get("/api/v1/admin/intervention-policies/editor-catalog")
    expect(catalog.body.data.flags.some((flag: { flagName: string; valueType: string }) => flag.flagName === flagName && flag.valueType === "BOOLEAN")).toBe(true)

    // Tipo com responsável "Líder direto": quem o colaborador reporta, sem precisar saber o nível.
    const observe = await admin.post("/api/v1/admin/intervention-policies/types").send({ key: `${KEY}_ACOMPANHAR`, definition: typeDef("Acompanhar de perto", { capabilities: ["OBSERVATION"], responsibleRole: "DIRECT_LEADER" }) })
    expect(observe.status, JSON.stringify(observe.body)).toBe(201)
    expect((await admin.post(`/api/v1/admin/intervention-policies/types/${observe.body.data.id}/publish`)).status).toBe(200)
    const flagPolicy = await admin.post("/api/v1/admin/intervention-policies/policies").send({ key: `${KEY}_FLAG`, name: `Rechamada ${TAG}`, scopeType: "GROUP", teamId: ids.team })
    const flagDefinition: PolicyDefinition = {
      schemaVersion: INTERVENTION_POLICY_SCHEMA_VERSION,
      description: "Prova: rechamada recorrente.",
      indicatorCode: null,
      matchStrategy: "FIRST_MATCH",
      report: { aiNarrative: false },
      rules: [{ key: "RECHAMADA", name: "Rechamada em 3 atendimentos", priority: 1, justification: "Rechamada recorrente nos últimos 30 dias.", when: { operator: "ALL", items: [{ kind: "INTERACTION_FLAG", channel: "VOICE", flagName, match: { type: "BOOLEAN", value: true }, withinDays: 30, measure: "COUNT", comparator: "GTE", threshold: 3, minimumInteractions: 1 }] }, actions: [{ typeKey: `${KEY}_ACOMPANHAR`, effect: "RECOMMEND", dueInDays: 10, onActive: "KEEP", cooldownDays: 0 }], inconclusiveActions: [] }],
    }
    expect((await admin.put(`/api/v1/admin/intervention-policies/policies/${flagPolicy.body.data.id}/draft`).send({ definition: flagDefinition })).status).toBe(200)
    expect((await admin.post(`/api/v1/admin/intervention-policies/policies/${flagPolicy.body.data.id}/validate`)).body.data).toEqual({ valid: true, issues: [] })
    const flagged = await admin.post(`/api/v1/admin/intervention-policies/policies/${flagPolicy.body.data.id}/simulate`).send({ personId: ids.operatorNoData, version: "DRAFT" })
    expect(flagged.status, JSON.stringify(flagged.body)).toBe(200)
    expect(flagged.body.data.evaluation.outcome).toBe("RECOMMENDED")
    expect(flagged.body.data.report.facts[0].statement).toMatch(/3 de 4 atendimento\(s\) ≥ 3/)
    expect(flagged.body.data.report.sources.filter((source: { kind: string }) => source.kind === "INTERACTION")).toHaveLength(3)
    expect(flagged.body.data.report.actions[0].responsible.personId).toBe(ids.supervisor)
    // Sem atendimento na janela não há sinal: inconclusiva, nunca "não teve rechamada".
    const silent = await admin.post(`/api/v1/admin/intervention-policies/policies/${flagPolicy.body.data.id}/simulate`).send({ personId: ids.operator, version: "DRAFT" })
    expect(silent.body.data.evaluation.outcome).toBe("INCONCLUSIVE")

    // Treinamento: o líder escolhe a competência; entram os conteúdos PUBLICADOS e as atividades viram itens.
    const document = (await pool.query<{ id: string }>(`insert into knowledge_documents (organization_id, title, document_type) values ($1,$2,'PROCEDURE') returning id`, [ORG, `Procedimento de espera ${TAG}`])).rows[0]!.id
    await pool.query(`insert into knowledge_versions (organization_id, document_id, version, content, status, content_hash) values ($1,$2,1,'Avise o cliente antes da espera.','PUBLISHED','prova')`, [ORG, document])
    const competency = await admin.post("/api/v1/admin/intervention-policies/competencies").send({ key: `${KEY}_ESPERA`, name: "Gestão da espera", description: "Prova", knowledgeDocumentIds: [document], practiceKeys: [], criterionKeys: [], indicatorCodes: [`${KEY}_TMA`], activities: [{ key: "estudo", title: "Estudar o procedimento de espera", description: "Ler e anotar dúvidas.", kind: "STUDY", documentId: document, estimatedMinutes: 30 }, { key: "escuta", title: "Ouvir duas chamadas de referência", description: "Com o supervisor.", kind: "SHADOWING", documentId: null, estimatedMinutes: 40 }] })
    expect(competency.status, JSON.stringify(competency.body)).toBe(201)
    const training = await admin.post("/api/v1/admin/intervention-policies/types").send({ key: `${KEY}_TREINAR`, definition: typeDef("Treinar", { capabilities: ["TRAINING"], responsibleRole: "DIRECT_LEADER", completion: { requireAllTasksDone: false, requireLearningAssessment: true, requireOperationalReading: false, requireOutcomeNote: true } }) })
    expect((await admin.post(`/api/v1/admin/intervention-policies/types/${training.body.data.id}/publish`)).status).toBe(200)
    const leader = await login(`supervisora.${TAG}@inia.local`)
    const opened = await leader.post("/api/v1/interventions").send({ personId: ids.operatorNoData, typeKey: `${KEY}_TREINAR`, indicatorCode: `${KEY}_TMA`, reason: "Orientar a gestão da espera no atendimento.", idempotencyKey: `${TAG}-treino` })
    expect(opened.status, JSON.stringify(opened.body)).toBe(201)
    expect(opened.body.data.responsible.id).toBe(ids.supervisor)
    const competencies = await leader.get("/api/v1/interventions/competencies")
    expect(competencies.body.data.find((item: { key: string }) => item.key === `${KEY}_ESPERA`).contents).toEqual([{ documentId: document, title: `Procedimento de espera ${TAG}` }])
    const applied = await leader.post(`/api/v1/interventions/${opened.body.data.id}/competency`).send({ expectedRevision: opened.body.data.revision, competencyKey: `${KEY}_ESPERA` })
    expect(applied.status, JSON.stringify(applied.body)).toBe(200)
    expect(applied.body.data.plan.contents).toEqual([{ documentId: document, title: `Procedimento de espera ${TAG}` }])
    expect(applied.body.data.items.filter((item: { kind: string }) => item.kind === "ACTIVITY").map((item: { title: string }) => item.title)).toEqual(["Estudar o procedimento de espera", "Ouvir duas chamadas de referência"])
    // Repetir não duplica conteúdo nem atividade.
    const again = await leader.post(`/api/v1/interventions/${opened.body.data.id}/competency`).send({ expectedRevision: applied.body.data.revision, competencyKey: `${KEY}_ESPERA` })
    expect(again.body.data.items.filter((item: { kind: string }) => item.kind === "ACTIVITY")).toHaveLength(2)
    expect(again.body.data.plan.contents).toHaveLength(1)
  })

  it("gestor de políticas com escopo de grupo: o catálogo do editor mostra só o grupo dele e a política nasce nesse escopo", async () => {
    ids.policyEditor = await person("Analista de políticas", "SUPERVISOR", ids.manager)
    const editorAccount = await account(ids.policyEditor, `politicas.${TAG}@inia.local`)
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, source, granted_by_account_id, granted_at) values ($1,$2,'GESTOR_DE_POLITICAS_DE_ACOMPANHAMENTO','GROUP',$3,'MANUAL',$4,now())`, [ORG, editorAccount, ids.team, actor.userAccountId])
    const editor = await login(`politicas.${TAG}@inia.local`)
    // Sem as permissões de estrutura, indicadores ou base: as telas próprias continuam fechadas para ele.
    expect((await editor.get("/api/v1/admin/org-structure/teams")).status).toBe(403)
    const catalog = await editor.get("/api/v1/admin/intervention-policies/editor-catalog")
    expect(catalog.status).toBe(200)
    expect(catalog.body.data.unrestricted).toBe(false)
    expect(catalog.body.data.teams.map((team: { id: string }) => team.id)).toEqual([ids.team])
    expect(catalog.body.data.indicators.some((indicator: { code: string }) => indicator.code === `${KEY}_TMA`)).toBe(true)
    expect(catalog.body.data.documents.every((document: { title: string; published: boolean }) => typeof document.title === "string" && typeof document.published === "boolean")).toBe(true)
    expect((await editor.post("/api/v1/admin/intervention-policies/policies").send({ key: `${KEY}_ORG`, name: `Organização ${TAG}`, scopeType: "ORGANIZATION" })).status).toBe(403)
    expect((await editor.post("/api/v1/admin/intervention-policies/policies").send({ key: `${KEY}_GRUPO`, name: `Grupo ${TAG}`, scopeType: "GROUP", teamId: ids.team })).status).toBe(201)
  })

  it("isolamento: outra organização não enxerga política nem intervenção; o operador não abre a própria", async () => {
    await expect(config.getPolicy(pool, "00000000-0000-4000-8000-0000000000e9", policyId)).rejects.toMatchObject({ code: "INTERVENTION_POLICY_NOT_FOUND" })
    const plano = (await pool.query<{ id: string }>(`select id from interventions where person_id = $1 and type_key = $2`, [ids.operator, `${KEY}_PLANO`])).rows[0]!.id
    const operatorAccount = await account(ids.operatorNoData, `operadora.${TAG}@inia.local`)
    expect(operatorAccount).toBeTruthy()
    const operator = await login(`operadora.${TAG}@inia.local`)
    expect((await operator.get(`/api/v1/interventions/${plano}`)).status).toBe(404)
    expect((await operator.get("/api/v1/admin/intervention-policies/policies")).status).toBe(403)
  })
})
