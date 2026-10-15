/**
 * PROVA contra o banco de TESTE real — configuração do Workflow em RASCUNHO × PUBLICADA (migration 144, incidente de
 * 2026-10-05: trocar o gatilho de um Workflow ATIVO e publicado de Manual para "Por agenda" passava a valer no minuto
 * seguinte e o checador criou 2.264 matrículas).
 *
 * Prova, pela API real + checador de agenda real + ingestão por Flag real:
 *   1. editar Gatilho, Modo de avaliação (Filtro Populacional) e Abrangência de um Workflow ativo e publicado grava só o
 *      rascunho — ZERO matrícula até Publicar, e o "Executar agora" continua rodando a configuração publicada;
 *   2. a prévia de impacto mostra o catch-up de hoje e a publicação exige a confirmação (409 sem o fingerprint, 409 com
 *      fingerprint velho); confirmada, a versão nasce COM a configuração e só então o checador matricula (uma vez);
 *   3. Flag: trocar a flag do gatilho não muda a ingestão até publicar; "Descartar alterações" volta ao publicado;
 *   4. publicar um Workflow INATIVO não põe a Agenda no ar, e ATIVAR exige a mesma confirmação do impacto.
 * ZERO chamada de modelo. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-draft-configuration-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { enrollFlagWorkflows } from "../application/flag-enrollment.js"
import { resolveOrganizationTimezone } from "../application/organization-timezone.js"
import { runScheduleCheck } from "../application/schedule-check.js"
import { localDateParts, zonedTimeToIso } from "../application/schedule-recurrence.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("Rascunho × publicada — gatilho/Abrangência/população só valem depois de Publicar (prova Postgres)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    client = await pool.connect()
    await client.query("begin")
  })
  afterAll(async () => {
    if (client) {
      await client.query("rollback")
      client.release()
    }
    if (pool) await pool.end()
  })

  it("edição de Workflow ativo não cria matrícula até Publicar; publicar/ativar com catch-up exige confirmação", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Draft Grupo A') returning id", [ORG, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (level: string, teamId: string | null, roleCode?: string) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, $3, $4) returning id", [ORG, `Proof Draft ${level} ${n}`, level, teamId])).rows[0]!.id
      const email = `proof-draft-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())", [ORG, accountId, roleCode])
      return { id, email }
    }
    const geral = await person("OPERATOR", null, "ADMINISTRADOR_GERAL")
    const op1 = await person("OPERATOR", teamA)
    const op2 = await person("OPERATOR", teamA)
    const op3 = await person("OPERATOR", teamA)

    const app = createApp(client as never)
    const admin = request.agent(app)
    expect((await admin.post("/api/v1/auth/login").send({ email: geral.email, password: "Proof@12345" })).status).toBe(200)
    const base = "/api/v1/admin/workflows"
    const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
    const scheduleEnrollments = async (workflowId: string) =>
      (await client.query<{ n: number }>("select count(*)::int n from workflow_enrollments where workflow_id = $1 and scheduled_for is not null", [workflowId])).rows[0]!.n
    const live = async (workflowId: string) =>
      (await client.query<{ trigger_config: { kind: string }; scope_type: string; population_filter: unknown; draft_trigger_config: { kind: string }; draft_scope_type: string; draft_population_filter: unknown; active_version_id: string | null }>(
        "select trigger_config, scope_type, population_filter, draft_trigger_config, draft_scope_type, draft_population_filter, active_version_id from workflows where id = $1",
        [workflowId],
      )).rows[0]!
    const timezone = await resolveOrganizationTimezone(client as never, ORG)
    const now = () => new Date()
    // "Todo dia às 00:00" — sempre já passou hoje: entrar no ar agora recupera o horário de hoje (o catch-up do incidente).
    const dailyMidnight = { kind: "schedule", mode: "CALENDAR", times: ["00:00"], intervalDays: 1, frequency: { type: "DAILY" } }
    const todayMidnight = zonedTimeToIso(localDateParts(now(), timezone).date, "00:00", timezone)

    // 1) Workflow Manual publicado e ATIVO (Grupo A).
    const created = await admin.post(base).send({ name: "Proof Draft Manual", scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "COLLABORATOR" } })
    expect(created.status).toBe(201)
    const workflowId = created.body.data.id as string
    expect(created.body.data).toMatchObject({ active: true, published: false, configurationChanges: [], draftConfiguration: { trigger: { kind: "manual" }, scopeType: "TEAM" } })
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph })).status).toBe(200)
    const firstPublish = await admin.post(`${base}/${workflowId}/publish`).send({})
    expect(firstPublish.status).toBe(200) // Manual nunca dispara ao publicar: sem confirmação
    const firstVersion = (await live(workflowId)).active_version_id!
    expect((await client.query("select trigger_config, scope_type, team_id from workflow_versions where id = $1", [firstVersion])).rows[0]).toEqual({ trigger_config: { kind: "manual", context: "COLLABORATOR" }, scope_type: "TEAM", team_id: teamA })

    // 2) O incidente: trocar o gatilho para Agenda num Workflow ativo e publicado — vai para o RASCUNHO.
    const switched = await admin.patch(`${base}/${workflowId}`).send({ trigger: dailyMidnight })
    expect(switched.status).toBe(200)
    expect(switched.body.data.trigger).toMatchObject({ kind: "manual" }) // o que o runtime usa
    expect(switched.body.data.draftConfiguration.trigger).toMatchObject({ kind: "schedule", times: ["00:00"] })
    expect(switched.body.data.configurationChanges).toEqual(["TRIGGER"])
    expect((await live(workflowId)).trigger_config.kind).toBe("manual")
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 0 })
    expect(await scheduleEnrollments(workflowId)).toBe(0)

    // Modo de avaliação e Abrangência também só no rascunho; o checador continua sem matricular nada.
    const filtered = await admin.put(`${base}/${workflowId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: { kind: "EMPLOYEE", employeeId: op1.id } })
    expect(filtered.status).toBe(200)
    expect(filtered.body.data.configurationChanges).toEqual(["TRIGGER", "ANALYSIS"])
    const widened = await admin.patch(`${base}/${workflowId}`).send({ scopeType: "ALL_TEAMS" })
    expect(widened.status).toBe(200)
    expect(widened.body.data).toMatchObject({ scopeType: "TEAM", teamId: teamA, configurationChanges: ["TRIGGER", "SCOPE", "ANALYSIS"] })
    expect(await live(workflowId)).toMatchObject({ trigger_config: { kind: "manual" }, scope_type: "TEAM", population_filter: null, draft_scope_type: "ALL_TEAMS", draft_population_filter: { kind: "EMPLOYEE", employeeId: op1.id } })
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 0 })
    expect(await scheduleEnrollments(workflowId)).toBe(0)

    // O "Executar agora" continua sendo o da versão PUBLICADA (Manual) enquanto o rascunho é Agenda.
    const manualInfo = (await admin.get(`${base}/${workflowId}/manual-run`)).body.data
    expect(manualInfo).toMatchObject({ context: "COLLABORATOR", published: true, blockers: [] })
    const manualRun = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: op2.id, idempotencyKey: `proof-draft-${Date.now()}` })
    expect(manualRun.status).toBe(201)
    expect(manualRun.body.data.run.versionId).toBe(firstVersion)

    // 3) Prévia do impacto: catch-up de hoje 00:00 para 1 pessoa (o filtro do rascunho).
    const impact = (await admin.get(`${base}/${workflowId}/publish-impact`)).body.data
    expect(impact).toMatchObject({
      reason: "PUBLISH",
      goesLive: true,
      configurationChanges: ["TRIGGER", "SCOPE", "ANALYSIS"],
      schedule: { population: 1, immediate: { enrollments: 1, scheduledFor: [todayMidnight] }, firstFireAt: todayMidnight, firesImmediately: true },
      requiresConfirmation: true,
      reasons: ["IMMEDIATE_CATCH_UP"],
    })

    // Sem confirmação: recusado, nada muda (versão, configuração viva, matrículas).
    const refused = await admin.post(`${base}/${workflowId}/publish`).send({})
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe("WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED")
    expect(refused.body.error.details.impact.fingerprint).toBe(impact.fingerprint)
    const stale = await admin.post(`${base}/${workflowId}/publish`).send({ confirmation: "0000000000000000" })
    expect(stale.status).toBe(409)
    expect(stale.body.error.message).toContain("mudou")
    expect(await live(workflowId)).toMatchObject({ trigger_config: { kind: "manual" }, active_version_id: firstVersion })
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 0 })

    // Confirmado: a versão nasce com a configuração do rascunho; o checador matricula UMA vez.
    const confirmed = await admin.post(`${base}/${workflowId}/publish`).send({ confirmation: impact.fingerprint })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.data).toMatchObject({ trigger: { kind: "schedule" }, scopeType: "ALL_TEAMS", configurationChanges: [] })
    const secondVersion = (await live(workflowId)).active_version_id!
    expect(secondVersion).not.toBe(firstVersion)
    expect((await client.query("select trigger_config ->> 'kind' kind, scope_type, population_filter from workflow_versions where id = $1", [secondVersion])).rows[0]).toEqual({ kind: "schedule", scope_type: "ALL_TEAMS", population_filter: { kind: "EMPLOYEE", employeeId: op1.id } })
    const audit = (await client.query("select payload from audit_logs where entity_id = $1 and action = 'WORKFLOW_PUBLISHED' and payload ->> 'versionId' = $2", [workflowId, secondVersion])).rows[0]!.payload
    expect(audit).toMatchObject({ versionId: secondVersion, configurationChanges: ["Gatilho", "Abrangência", "Alvo da avaliação / população"], confirmedImpact: { reasons: ["IMMEDIATE_CATCH_UP"], fingerprint: impact.fingerprint } })
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 1 })
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 0 })
    expect((await client.query("select scheduled_subject_id, version_id from workflow_enrollments where workflow_id = $1 and scheduled_for is not null", [workflowId])).rows).toEqual([{ scheduled_subject_id: op1.id, version_id: secondVersion }])

    // 4) Inativo: publicar uma população maior não põe nada no ar; ATIVAR exige a confirmação do catch-up.
    expect((await admin.patch(`${base}/${workflowId}`).send({ active: false })).status).toBe(200)
    expect((await admin.put(`${base}/${workflowId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: { kind: "TEAM", teamId: teamA } })).status).toBe(200)
    const inactiveImpact = (await admin.get(`${base}/${workflowId}/publish-impact`)).body.data
    expect(inactiveImpact).toMatchObject({ goesLive: false, schedule: null, requiresConfirmation: false })
    expect((await admin.post(`${base}/${workflowId}/publish`).send({})).status).toBe(200)
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 0 })
    const activate = await admin.patch(`${base}/${workflowId}`).send({ active: true })
    expect(activate.status).toBe(409)
    expect(activate.body.error.code).toBe("WORKFLOW_ACTIVATION_CONFIRMATION_REQUIRED")
    expect(activate.body.error.details.impact.schedule).toMatchObject({ population: 3, immediate: { enrollments: 2, alreadyEnrolled: 1 } })
    expect((await live(workflowId)).active_version_id).not.toBeNull()
    expect((await client.query<{ active: boolean }>("select active from workflows where id = $1", [workflowId])).rows[0]!.active).toBe(false)
    const activated = await admin.patch(`${base}/${workflowId}`).send({ active: true, confirmation: activate.body.error.details.impact.fingerprint })
    expect(activated.status).toBe(200)
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 2 })
    expect(await scheduleEnrollments(workflowId)).toBe(3)
    expect((await client.query<{ id: string }>("select scheduled_subject_id id from workflow_enrollments where workflow_id = $1 and scheduled_for is not null order by 1", [workflowId])).rows.map((row) => row.id)).toEqual([op1.id, op2.id, op3.id].sort())

    // 5) Flag: trocar a flag de um Workflow publicado não muda a ingestão até publicar; descartar volta ao publicado.
    const flagA = (await client.query<{ id: string }>("insert into channel_flags (organization_id, channel, flag_name, value_type) values ($1, 'VOICE', $2, 'BOOLEAN') returning id", [ORG, `proof_draft_a_${Date.now()}`])).rows[0]!.id
    const flagB = (await client.query<{ id: string }>("insert into channel_flags (organization_id, channel, flag_name, value_type) values ($1, 'VOICE', $2, 'BOOLEAN') returning id", [ORG, `proof_draft_b_${Date.now()}`])).rows[0]!.id
    const flagWorkflow = await admin.post(base).send({ name: "Proof Draft Flag", scopeType: "TEAM", teamId: teamA, trigger: { kind: "channel_flag", channelFlagId: flagA } })
    const flagWorkflowId = flagWorkflow.body.data.id as string
    await admin.put(`${base}/${flagWorkflowId}/draft`).send({ graph })
    expect((await admin.post(`${base}/${flagWorkflowId}/publish`).send({})).status).toBe(200)
    expect((await admin.patch(`${base}/${flagWorkflowId}`).send({ trigger: { kind: "channel_flag", channelFlagId: flagB } })).body.data.configurationChanges).toEqual(["TRIGGER"])
    const interaction = (await client.query<{ id: string }>(
      "insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1, $2, 'Proof', now() - interval '1 hour', now() - interval '50 minutes', $3) returning id",
      [ORG, op1.id, `PROOF-DRAFT-${Date.now()}`],
    )).rows[0]!.id
    const ingest = (channelFlagId: string, flagName: string) => enrollFlagWorkflows(client, { organizationId: ORG, interactionId: interaction, operatorId: op1.id, channelFlagId, flagName, value: true })
    expect(await ingest(flagA, "a")).toBe(1) // a flag PUBLICADA continua disparando
    expect(await ingest(flagB, "b")).toBe(0) // a do rascunho ainda não
    const discarded = await admin.post(`${base}/${flagWorkflowId}/configuration/discard`).send({})
    expect(discarded.status).toBe(200)
    expect(discarded.body.data).toMatchObject({ configurationChanges: [], draftConfiguration: { trigger: { kind: "channel_flag", channelFlagId: flagA } } })

    // Workflow nunca publicado: rascunho e vivo andam juntos (sem runtime), e "descartar" não se aplica.
    const unpublished = await admin.post(base).send({ name: "Proof Draft Nunca Publicado", scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "COLLABORATOR" } })
    const unpublishedId = unpublished.body.data.id as string
    const editedUnpublished = await admin.patch(`${base}/${unpublishedId}`).send({ trigger: dailyMidnight })
    expect(editedUnpublished.body.data).toMatchObject({ published: false, trigger: { kind: "schedule" }, configurationChanges: [] })
    expect(await live(unpublishedId)).toMatchObject({ trigger_config: { kind: "schedule" }, draft_trigger_config: { kind: "schedule" }, active_version_id: null })
    expect(await runScheduleCheck(client as never, now())).toEqual({ enrolled: 0 }) // sem versão publicada, nada roda
    expect((await admin.post(`${base}/${unpublishedId}/configuration/discard`).send({})).body.error.code).toBe("WORKFLOW_NOT_PUBLISHED")
  })
})
