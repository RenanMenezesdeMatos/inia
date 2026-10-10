/**
 * PROVA contra o banco de TESTE real (V1.5.13): read model da aba "Resultados" — disparo = matrícula raiz, pessoas = filhos,
 * contadores por efeito persistido, tokens/custo do uso correlacionado (migration 084), escopo por pessoa, filtros e
 * paginação no banco. Fixture gravada direto nas tabelas (ZERO modelo, ZERO motor) e apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run workflow-results-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { loadDispatchDetail, loadResultsPage, loadResultsSummary, type ResultsFilters } from "../application/workflow-results-reader.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ALL: ManageableScopes = { unrestricted: false, allTeams: true, teamIds: new Set(), subteamIds: new Set() }
let pool: pg.Pool

const GRAPH = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
    { id: "agent", type: "action", label: "Analisar", position: { x: 0, y: 0 }, config: { actionType: "CALL_AGENT", agentId: "00000000-0000-4000-8000-00000000a9e1" } },
    { id: "gen", type: "action", label: "Gerar feedback", position: { x: 0, y: 0 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "MONITORING" } },
    { id: "out", type: "output", label: "Enviar", position: { x: 0, y: 0 }, config: { source: "nodeOutputs.gen", target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"] } },
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 0 }, config: {} },
  ],
  edges: [],
}

function artifact(disposition: "READY" | "HOLD_FOR_QA" | "BLOCKED", collaboratorId: string, interactionId: string) {
  return {
    contract: "RELIABLE_FEEDBACK_ARTIFACT_V1", domain: "MONITORING", sourceNodeId: "agent", sourceType: "AGENT",
    subject: { collaboratorId, interactionId, indicatorMeasurementId: null }, label: "Atendimento de prova", uncertainties: [], blockedReason: null, policyVersion: "P",
    writer: { invoked: true, skippedReason: null, error: null, promptVersion: "V1" },
    items: [{
      index: 0, claimRef: "c0", domain: "MONITORING", section: "OPPORTUNITY", kind: "MONITORING_DEVELOPMENT_POINT", polarity: "NEGATIVE", ownership: "AGENT", safeMeaning: "ponto",
      guidanceSource: "COACHING_SUGGESTION", facts: [{ role: "OPERADOR", text: "Aguarde.", truncated: false, masked: false }], withheldFacts: 0, analysisConflicts: [], structuralBlock: null,
      audit: { evidence: [], rejectedUnits: [] }, analysisUsed: false, slot: "ITEM_1",
      proposedWording: disposition === "BLOCKED" ? null : { observed: "proposto", whyItMatters: "importa", whatYouCanDo: "fazer" }, wordingSource: disposition === "BLOCKED" ? null : "WRITER", writerViolations: [],
      decision: { disposition, structural: disposition === "BLOCKED" ? "BLOCKED" : "STRUCTURALLY_EMITTABLE", reasons: [disposition === "BLOCKED" ? "EVIDENCE_NOT_VERIFIED" : disposition === "HOLD_FOR_QA" ? "PILOT_HOLD_ALL_FOR_QA" : "AUTONOMY_CRITERIA_MET"], policyVersion: "P", autonomyEligible: null, autonomyBlockers: [] },
    }],
  }
}

describe.skipIf(!ENABLED)("V1.5.13 — Resultados do Workflow: prova Postgres (read model, zero modelo)", () => {
  const created = { people: [] as string[], workflows: [] as string[], interactions: [] as string[], cases: [] as string[] }
  let teamIn: string
  let teamOut: string
  let workflowId: string
  let versionId: string
  let rootA: string
  let rootB: string
  let rootOld: string
  const filters = (overrides: Partial<ResultsFilters> = {}): ResultsFilters => ({ from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 86_400_000), ...overrides })

  async function personIn(team: string, name: string) {
    const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1,$2,'OPERATOR',$3) returning id", [ORG, name, team])).rows[0]!.id
    created.people.push(id)
    return id
  }
  async function enrollment(input: { parent: string | null; subject: string; status: string; createdAt?: Date }) {
    return (await pool.query<{ id: string }>(
      `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, parent_enrollment_id, fan_out_node_id, scheduled_subject_id, scheduled_for, created_at, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$10::timestamptz + interval '3 seconds') returning id`,
      [ORG, workflowId, versionId, input.status === "waiting" ? "gen" : "end", input.status, input.parent, input.parent ? "fan" : null, input.subject, input.parent ? null : (input.createdAt ?? new Date()), input.createdAt ?? new Date()],
    )).rows[0]!.id
  }
  /** Filho com artefato; READY + `send` = emissão persistida + feedback publicado; `edited` = texto final do QA. */
  async function child(root: string, subject: string, disposition: "READY" | "HOLD_FOR_QA" | "BLOCKED", options: { send?: boolean; edited?: boolean; tokens?: [number, number, number, string][] } = {}) {
    const id = await enrollment({ parent: root, subject, status: disposition === "HOLD_FOR_QA" ? "waiting" : "completed" })
    const interaction = (await pool.query<{ id: string }>("insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'prova',now() - interval '5 minutes',now(),$3) returning id", [ORG, subject, `PROOF-RESULTS-${id}`])).rows[0]!.id
    created.interactions.push(interaction)
    const itemDisposition = options.edited ? "HOLD_FOR_QA" : disposition
    const art = (await pool.query<{ id: string }>(
      `insert into reliable_feedback_artifacts (organization_id, artifact_key, enrollment_id, workflow_id, workflow_version_id, node_id, source_node_id, source_type, domain, collaborator_id, interaction_id, contract_version, status, disposition, artifact, created_at, updated_at, completed_at)
       values ($1,$2,$3,$4,$5,'gen','agent','AGENT','MONITORING',$6,$7,'V1','COMPLETED',$8,$9,now(),now(),now()) returning id`,
      [ORG, `WORKFLOW_NODE:${id}:gen:agent`, id, workflowId, versionId, subject, interaction, disposition, JSON.stringify(artifact(itemDisposition, subject, interaction))],
    )).rows[0]!.id
    if (options.edited) {
      await pool.query(
        `insert into reliable_feedback_item_reviews (organization_id, artifact_id, item_index, section, item_kind, subject_label, review_item, wording_source, proposed_wording, review_required_by, review_status, final_wording, reason_category, reviewed_by, reviewed_at, created_at)
         values ($1,$2,0,'OPPORTUNITY','MONITORING_DEVELOPMENT_POINT','x','{}','WRITER',$3,'{PILOT}','APPROVED_EDITED',$4,'TONE',$5,now(),now())`,
        [ORG, art, JSON.stringify({ observed: "proposto", whyItMatters: "importa", whatYouCanDo: "fazer" }), JSON.stringify({ observed: "FINAL EDITADO", whyItMatters: "importa", whatYouCanDo: "fazer" }), subject],
      )
    }
    if (options.send) {
      const caseId = (await pool.query<{ id: string }>("insert into supervision_cases (organization_id, operator_id, team_id, title, summary, priority, indicator_code, indicator_value, indicator_target) values ($1,$2,(select team_id from people where id = $2),'t','s','P2','MONITORIA','v','t') returning id", [ORG, subject])).rows[0]!.id
      created.cases.push(caseId)
      const feedbackId = (await pool.query<{ id: string }>("insert into feedbacks (organization_id, case_id, operator_id, status, feedback_kind, impacted_indicator, evidence_found, observed_behavior, related_procedure, recommendation, published_at) values ($1,$2,$3,'PUBLISHED','MONITORING','x','e','o','p','r',now()) returning id", [ORG, caseId, subject])).rows[0]!.id
      await pool.query("insert into workflow_output_emissions (organization_id, enrollment_id, node_id, surface, recipient_id, artifact_id, case_id, feedback_id, created_at) values ($1,$2,'out','FOLLOW_UP',$3,$4,$5,$6,now())", [ORG, id, subject, art, caseId, feedbackId])
      await pool.query("update workflow_enrollments set node_outputs = jsonb_build_object('out', jsonb_build_object('caseId', $2::text, 'feedbackId', $3::text)) where id = $1", [id, caseId, feedbackId])
      await pool.query("insert into workflow_enrollment_events (enrollment_id, node_id, event_type, payload, idempotency_key) values ($1,'out','output_dispatched',$2,'out:9')", [id, JSON.stringify({ surfaces: ["FOLLOW_UP"], recipients: [{ id: subject, name: "x", role: "OPERATOR" }] })])
    }
    for (const [input, output, total, cost] of options.tokens ?? []) {
      await pool.query(
        `insert into ai_usage_events (organization_id, occurred_at, use_case, origin, provider_key, model_name, correlation_id, input_tokens, output_tokens, total_tokens, cost, currency, cost_status, pricing_source, status, routing_mode, route_reason,
                                      workflow_id, workflow_version_id, enrollment_id, root_enrollment_id, workflow_node_id)
         values ($1,now(),'FEEDBACK_WRITER','RUNTIME','GOOGLE_GENAI','gemini-3.1-flash-lite',gen_random_uuid(),$2,$3,$4,$5,'USD','ESTIMATED','TABLE','SUCCESS','LEGACY','proof',$6,$7,$8,$9,'gen')`,
        [ORG, input, output, total, cost, workflowId, versionId, id, root],
      )
    }
    return id
  }

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 })
    const teams = (await pool.query<{ id: string }>("select id from teams where organization_id = $1 order by created_at limit 2", [ORG])).rows
    teamIn = teams[0]!.id
    teamOut = teams[1]!.id
    workflowId = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, consolidated_structure, trigger_config) values ($1, 'Proof Results WF', '{"kind":"PROOF"}', '{"kind":"schedule"}') returning id`, [ORG])).rows[0]!.id
    created.workflows.push(workflowId)
    versionId = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1,$2) returning id", [workflowId, JSON.stringify(GRAPH)])).rows[0]!.id
    await pool.query("update workflows set active_version_id = $2 where id = $1", [workflowId, versionId])
    const supervisor = await personIn(teamIn, "Proof Results Supervisora")
    const [ana, bia, caio, davi, eva, fabio, gil] = await Promise.all(["Ana", "Bia", "Caio", "Davi", "Eva", "Fabio"].map((name) => personIn(teamIn, `Proof Results ${name}`)).concat([personIn(teamOut, "Proof Results Gil Fora")]))

    // Disparo A: 1 raiz + 3 filhos — 2 READY entregues (um editado no QA) + 1 HOLD_FOR_QA.
    rootA = await enrollment({ parent: null, subject: supervisor, status: "waiting", createdAt: new Date(Date.now() - 2 * 86_400_000) })
    await child(rootA, ana!, "READY", { send: true, tokens: [[1000, 120, 1120, "0.0010"], [300, 120, 420, "0.0004"]] })
    await child(rootA, bia!, "READY", { send: true, edited: true, tokens: [[300, 120, 420, "0.0004"]] })
    await child(rootA, caio!, "HOLD_FOR_QA", { tokens: [[300, 120, 420, "0.0004"]] })
    // Disparo B: 3 entregues + 1 BLOCKED + 1 pessoa FORA do escopo restrito (outro Grupo), com tokens.
    rootB = await enrollment({ parent: null, subject: supervisor, status: "completed", createdAt: new Date(Date.now() - 86_400_000) })
    await pool.query("update workflow_enrollments set status = 'completed' where id = $1", [rootB])
    await child(rootB, davi!, "READY", { send: true })
    await child(rootB, eva!, "READY", { send: true })
    await child(rootB, fabio!, "READY", { send: true })
    await child(rootB, ana!, "BLOCKED")
    await child(rootB, gil!, "READY", { send: true, tokens: [[5000, 500, 5500, "0.0100"]] })
    // Disparo antigo (fora dos últimos 30 dias).
    rootOld = await enrollment({ parent: null, subject: supervisor, status: "completed", createdAt: new Date(Date.now() - 60 * 86_400_000) })
    await child(rootOld, ana!, "READY", { send: true })
  })

  afterAll(async () => {
    if (!pool) return
    const enrollments = (await pool.query<{ id: string }>("select id from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])).rows.map((row) => row.id)
    await pool.query("delete from ai_usage_events where enrollment_id = any($1::uuid[])", [enrollments])
    await pool.query("delete from workflow_output_emissions where enrollment_id = any($1::uuid[])", [enrollments])
    await pool.query("delete from feedbacks where case_id = any($1::uuid[])", [created.cases])
    await pool.query("delete from supervision_cases where id = any($1::uuid[])", [created.cases])
    await pool.query("delete from reliable_feedback_artifacts where enrollment_id = any($1::uuid[])", [enrollments])
    await pool.query("delete from workflow_enrollment_events where enrollment_id = any($1::uuid[])", [enrollments])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[]) and parent_enrollment_id is not null", [created.workflows])
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from interactions where id = any($1::uuid[])", [created.interactions])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.end()
  })

  it("A) 1 raiz + 3 filhos = 1 disparo / 3 pessoas (nunca 4 disparos); período padrão exclui o disparo antigo", async () => {
    const page = await loadResultsPage(pool, ORG, workflowId, ALL, filters(), 1, 20)
    expect(page.total).toBe(2)
    expect(page.items.map((item) => item.rootEnrollmentId)).toEqual([rootB, rootA])
    expect(page.items[1]).toMatchObject({ persons: 3, status: "RUNNING", trigger: { kind: "SCHEDULE" }, version: { number: 1, active: true }, consolidated: true })
  })

  it("B/C/D) contadores por efeito persistido: A = 2 enviados + 1 QA; B = 4 enviados + 1 bloqueado; tokens/custo somados sem multiplicar", async () => {
    const page = await loadResultsPage(pool, ORG, workflowId, ALL, filters(), 1, 20)
    const a = page.items.find((item) => item.rootEnrollmentId === rootA)!
    const b = page.items.find((item) => item.rootEnrollmentId === rootB)!
    expect(a).toMatchObject({ feedbacksProduced: 3, feedbacksSent: 2, awaitingQa: 1, blocked: 0 })
    expect(a.usage).toMatchObject({ calls: 4, inputTokens: 1900, outputTokens: 480, totalTokens: 2380, costs: [{ currency: "USD", amount: "0.0022" }] })
    expect(b).toMatchObject({ persons: 5, feedbacksSent: 4, blocked: 1, awaitingQa: 0, status: "COMPLETED" })
    const summary = await loadResultsSummary(pool, ORG, workflowId, ALL, filters())
    expect(summary).toMatchObject({ dispatches: 2, persons: 8, feedbacksSent: 6, awaitingQa: 1, blocked: 1 })
    expect(summary.usage).toMatchObject({ totalTokens: 7880, costs: [{ currency: "USD", amount: "0.0122" }] })
  })

  it("E) detalhe do disparo: texto FINAL editado no QA, HOLD sem Output, tokens por pessoa", async () => {
    const detail = (await loadDispatchDetail(pool, ORG, workflowId, ALL, rootA, 1, 50))!
    const byName = Object.fromEntries(detail.persons.items.map((person) => [person.person.name, person]))
    expect(detail.persons.total).toBe(3)
    expect(byName["Proof Results Bia"]!.feedbacks[0]!.items[0]!.wording.observed).toBe("FINAL EDITADO")
    expect(byName["Proof Results Bia"]!.feedbacks[0]).toMatchObject({ sent: true, disposition: "READY" })
    expect(byName["Proof Results Caio"]!).toMatchObject({ waitingForQa: true, outputs: [] })
    expect(byName["Proof Results Caio"]!.feedbacks[0]).toMatchObject({ disposition: "HOLD_FOR_QA", sent: false })
    expect(byName["Proof Results Ana"]!.usage).toMatchObject({ calls: 2, totalTokens: 1540 })
    expect(byName["Proof Results Ana"]!.outputs).toEqual([expect.objectContaining({ surface: "FOLLOW_UP", status: "SENT" })])
  })

  it("J) escopo restrito ao Grupo: a pessoa de outro Grupo some da lista, dos contadores e dos tokens; disparo fora do Workflow = 404", async () => {
    const scoped: ManageableScopes = { unrestricted: false, allTeams: false, teamIds: new Set([teamIn]), subteamIds: new Set() }
    const b = (await loadResultsPage(pool, ORG, workflowId, scoped, filters(), 1, 20)).items.find((item) => item.rootEnrollmentId === rootB)!
    expect(b).toMatchObject({ persons: 4, feedbacksSent: 3 })
    expect(b.usage.totalTokens).toBeNull()
    const detail = (await loadDispatchDetail(pool, ORG, workflowId, scoped, rootB, 1, 50))!
    expect(detail.persons.items.map((person) => person.person.name)).not.toContain("Proof Results Gil Fora")
    expect(JSON.stringify(detail)).not.toContain("Gil Fora")
    expect(await loadDispatchDetail(pool, ORG, workflowId, ALL, "00000000-0000-4000-8000-000000000000", 1, 50)).toBeNull()
    const otherOrg = "00000000-0000-4000-8000-0000000000ff"
    expect(await loadDispatchDetail(pool, otherOrg, workflowId, ALL, rootA, 1, 50)).toBeNull()
  })

  it("K) filtros e paginação no banco: status, colaborador, período e páginas", async () => {
    expect((await loadResultsPage(pool, ORG, workflowId, ALL, filters({ statuses: ["COMPLETED"] }), 1, 20)).items.map((item) => item.rootEnrollmentId)).toEqual([rootB])
    expect((await loadResultsPage(pool, ORG, workflowId, ALL, filters({ collaborator: "caio" }), 1, 20)).items.map((item) => item.rootEnrollmentId)).toEqual([rootA])
    expect((await loadResultsPage(pool, ORG, workflowId, ALL, filters({ triggerKinds: ["FLAG"] }), 1, 20)).total).toBe(0)
    const wide = filters({ from: new Date(Date.now() - 90 * 86_400_000) })
    const first = await loadResultsPage(pool, ORG, workflowId, ALL, wide, 1, 2)
    const second = await loadResultsPage(pool, ORG, workflowId, ALL, wide, 2, 2)
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 })
    expect(first.items).toHaveLength(2)
    expect(second.items.map((item) => item.rootEnrollmentId)).toEqual([rootOld])
    const persons = await loadDispatchDetail(pool, ORG, workflowId, ALL, rootB, 2, 2)
    expect(persons!.persons).toMatchObject({ total: 5, page: 2 })
    expect(persons!.persons.items).toHaveLength(2)
  })
})
