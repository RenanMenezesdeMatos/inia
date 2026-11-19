/**
 * PROVA contra o banco de TESTE real — "Somente quem tem acesso ativo à INIA" (migration 225).
 *
 * Cenário do piloto: um Subgrupo com 5 operadores, dos quais 2 têm conta de acesso ativa, 1 tem a conta DESATIVADA e 2 nunca
 * tiveram conta. Prova, pela API real + ingestão por Flag real + checador de agenda real + "Executar agora" real:
 *   1. por padrão (opção desligada) todos os operadores ativos entram — o comportamento de sempre;
 *   2. ligar a opção grava só o RASCUNHO: nada muda no runtime até Publicar;
 *   3. publicada, só entra quem tem conta ativa — por Flag (onde o Filtro Populacional não existe), por Agenda e no
 *      "Executar agora"; a prévia de impacto diz "2 de 5";
 *   4. liberar o acesso de mais uma pessoa a faz entrar sozinha; desativar uma conta a tira (sem republicar);
 *   5. a população de COMPARAÇÃO (quartil, ranking) continua sendo o Subgrupo inteiro;
 *   6. desligar a opção com o Workflow no ar exige a confirmação do impacto (409 sem o fingerprint), mesmo por Flag;
 *   7. Consolidado não aceita a opção (a rota a desliga; escrita direta é barrada ao publicar).
 * ZERO chamada de modelo. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run src/modules/workflows/testing/workflow-active-access-proof.test.ts
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { enrollFlagWorkflows } from "../application/flag-enrollment.js"
import { runScheduleCheck } from "../application/schedule-check.js"
import { comparisonPopulationOf, resolveEligibleOperatorIds } from "../application/workflow-eligibility.js"
import { confirmWorkflowRetry, previewWorkflowRetry } from "../application/workflow-retry.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)('"Somente quem tem acesso ativo à INIA" — quem entra no Workflow × com quem a pessoa é comparada (prova Postgres)', () => {
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

  it("piloto: só quem tem conta ativa entra (Flag, Agenda, Executar agora); comparação e rascunho intactos; desligar exige confirmação", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Acesso Grupo') returning id", [ORG, operation])).rows[0]!.id
    const subteam = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof Acesso Subgrupo') returning id", [ORG, team])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (options: { subteamId?: string | null; account?: "ACTIVE" | "DISABLED" | "NONE"; roleCode?: string } = {}) => {
      n += 1
      const inSubteam = options.subteamId !== null
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [ORG, `Proof Acesso ${n}`, inSubteam ? team : null, inSubteam ? subteam : null])).rows[0]!.id
      const email = `proof-acesso-${n}-${Date.now()}@proof.inia.local`
      let accountId: string | null = null
      if ((options.account ?? "ACTIVE") !== "NONE") {
        accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash, active) values ($1, $2, $3, $4, $5) returning id", [ORG, id, email, hash, options.account !== "DISABLED"])).rows[0]!.id
        if (options.roleCode) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, $3, 'ORGANIZATION', now())", [ORG, accountId, options.roleCode])
      }
      return { id, email, accountId }
    }
    const geral = await person({ subteamId: null, roleCode: "ADMINISTRADOR_GERAL" })
    const comAcesso1 = await person()
    const comAcesso2 = await person()
    const contaDesativada = await person({ account: "DISABLED" })
    const semConta1 = await person({ account: "NONE" })
    const semConta2 = await person({ account: "NONE" })
    const todos = [comAcesso1, comAcesso2, contaDesativada, semConta1, semConta2].map((p) => p.id).sort()
    const piloto = [comAcesso1.id, comAcesso2.id].sort()

    const app = createApp(client as never)
    const admin = request.agent(app)
    expect((await admin.post("/api/v1/auth/login").send({ email: geral.email, password: "Proof@12345" })).status).toBe(200)
    const base = "/api/v1/admin/workflows"
    const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 160 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
    const columns = async (workflowId: string) =>
      (await client.query<{ require_active_access: boolean; draft_require_active_access: boolean; active_version_id: string | null }>("select require_active_access, draft_require_active_access, active_version_id from workflows where id = $1", [workflowId])).rows[0]!
    const enrolledPeople = async (workflowId: string) =>
      (await client.query<{ id: string }>(
        "select distinct coalesce(e.scheduled_subject_id, i.operator_id) id from workflow_enrollments e left join interactions i on i.id = e.interaction_id where e.workflow_id = $1",
        [workflowId],
      )).rows.map((row) => row.id).sort()

    // ── Flag (monitoria): o Filtro Populacional não existe aqui — a opção é o único corte além da Abrangência. ──
    const flag = (await client.query<{ id: string }>("insert into channel_flags (organization_id, channel, flag_name, value_type) values ($1, 'VOICE', $2, 'BOOLEAN') returning id", [ORG, `proof_acesso_${Date.now()}`])).rows[0]!.id
    const created = await admin.post(base).send({ name: "Proof Acesso Flag", scopeType: "SUBTEAM", teamId: team, subteamId: subteam, trigger: { kind: "channel_flag", channelFlagId: flag } })
    expect(created.status).toBe(201)
    const flagWorkflowId = created.body.data.id as string
    expect((await admin.put(`${base}/${flagWorkflowId}/draft`).send({ graph })).status).toBe(200)
    expect((await admin.post(`${base}/${flagWorkflowId}/publish`).send({})).status).toBe(200)
    expect(await columns(flagWorkflowId)).toMatchObject({ require_active_access: false, draft_require_active_access: false })

    let call = 0
    const ingest = async (operatorId: string) => {
      call += 1
      const interaction = (await client.query<{ id: string }>(
        "insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1, $2, 'Proof', now() - interval '1 hour', now() - interval '50 minutes', $3) returning id",
        [ORG, operatorId, `PROOF-ACESSO-${Date.now()}-${call}`],
      )).rows[0]!.id
      return enrollFlagWorkflows(client, { organizationId: ORG, interactionId: interaction, operatorId, channelFlagId: flag, flagName: "proof_acesso", value: true })
    }

    // 1) Opção desligada (padrão): quem não tem login também entra — o comportamento de sempre.
    expect(await ingest(semConta1.id)).toBe(1)
    expect(await ingest(contaDesativada.id)).toBe(1)

    // 2) Ligar a opção num Workflow publicado grava só o RASCUNHO: o runtime continua igual até Publicar.
    const switched = await admin.put(`${base}/${flagWorkflowId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: null, requireActiveAccess: true })
    expect(switched.status).toBe(200)
    expect(switched.body.data).toMatchObject({ requireActiveAccess: false, configurationChanges: ["ANALYSIS"], draftConfiguration: { requireActiveAccess: true } })
    expect(await columns(flagWorkflowId)).toMatchObject({ require_active_access: false, draft_require_active_access: true })
    expect(await ingest(semConta2.id)).toBe(1) // ainda entra: a opção está só no rascunho

    // 3) A prévia de impacto diz quantos entram hoje ("2 de 5") — por Flag não há impacto de agenda, o número só aparece aqui.
    const impact = (await admin.get(`${base}/${flagWorkflowId}/publish-impact`)).body.data
    expect(impact).toMatchObject({ triggerKind: "channel_flag", schedule: null, requiresConfirmation: false, configurationChanges: ["ANALYSIS"], access: { required: true, removed: false, population: 5, withAccess: 2, withoutAccess: 3 } })
    expect((await admin.post(`${base}/${flagWorkflowId}/publish`).send({})).status).toBe(200)
    const published = await columns(flagWorkflowId)
    expect(published).toMatchObject({ require_active_access: true, draft_require_active_access: true })
    expect((await client.query<{ require_active_access: boolean }>("select require_active_access from workflow_versions where id = $1", [published.active_version_id])).rows[0]).toEqual({ require_active_access: true })

    // 4) Publicada: só quem tem conta ATIVA entra. Conta desativada e quem nunca teve conta ficam fora.
    expect(await ingest(comAcesso1.id)).toBe(1)
    expect(await ingest(comAcesso2.id)).toBe(1)
    expect(await ingest(contaDesativada.id)).toBe(0)
    expect(await ingest(semConta1.id)).toBe(0)

    // 5) Quem ENTRA × com quem a pessoa é COMPARADA: a mesma Abrangência, com e sem o corte de acesso.
    const population = { scopeType: "SUBTEAM", teamId: team, subteamId: subteam, populationFilter: null, operatingUniverse: null, requireActiveAccess: true }
    expect((await resolveEligibleOperatorIds(client as never, ORG, population)).sort()).toEqual(piloto)
    expect((await resolveEligibleOperatorIds(client as never, ORG, comparisonPopulationOf(population))).sort()).toEqual(todos)

    // 6) Liberar o acesso de mais uma pessoa a faz entrar sozinha (sem republicar); desativar uma conta a tira.
    await client.query("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4)", [ORG, semConta1.id, `proof-acesso-novo-${Date.now()}@proof.inia.local`, hash])
    expect(await ingest(semConta1.id)).toBe(1)
    await client.query("update user_accounts set active = false where id = $1", [comAcesso2.accountId])
    expect(await ingest(comAcesso2.id)).toBe(0)
    await client.query("update user_accounts set active = true where id = $1", [comAcesso2.accountId])
    await client.query("delete from user_accounts where person_id = $1", [semConta1.id])

    // 7) Desligar a opção com o Workflow no ar: 3 pessoas sem acesso passam a entrar — exige a confirmação, mesmo por Flag.
    expect((await admin.put(`${base}/${flagWorkflowId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: null, requireActiveAccess: false })).status).toBe(200)
    const refused = await admin.post(`${base}/${flagWorkflowId}/publish`).send({})
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe("WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED")
    expect(refused.body.error.details.impact).toMatchObject({ reasons: ["ACCESS_REQUIREMENT_REMOVED"], access: { required: false, removed: true, population: 5, withAccess: 2, withoutAccess: 3 } })
    expect(await ingest(semConta2.id)).toBe(0) // recusada: a opção continua valendo
    expect((await admin.post(`${base}/${flagWorkflowId}/publish`).send({ confirmation: "0000000000000000" })).status).toBe(409)
    expect((await admin.post(`${base}/${flagWorkflowId}/publish`).send({ confirmation: refused.body.error.details.impact.fingerprint })).status).toBe(200)
    expect(await ingest(semConta2.id)).toBe(1)

    // ── Agenda: a opção soma com o Filtro Populacional e a prévia conta só quem entra. ──
    const daily = { kind: "schedule", mode: "CALENDAR", times: ["00:00"], intervalDays: 1, frequency: { type: "DAILY" } }
    const schedule = await admin.post(base).send({ name: "Proof Acesso Agenda", scopeType: "SUBTEAM", teamId: team, subteamId: subteam, trigger: daily })
    const scheduleId = schedule.body.data.id as string
    expect((await admin.put(`${base}/${scheduleId}/draft`).send({ graph })).status).toBe(200)
    expect((await admin.put(`${base}/${scheduleId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: null, requireActiveAccess: true })).status).toBe(200)
    const scheduleImpact = (await admin.get(`${base}/${scheduleId}/publish-impact`)).body.data
    expect(scheduleImpact).toMatchObject({ schedule: { population: 2, enrollmentsPerOccurrence: 2, immediate: { enrollments: 2 } }, access: { required: true, population: 5, withAccess: 2, withoutAccess: 3 } })
    expect((await admin.post(`${base}/${scheduleId}/publish`).send({ confirmation: scheduleImpact.fingerprint })).status).toBe(200)
    await runScheduleCheck(client as never, new Date())
    expect(await enrolledPeople(scheduleId)).toEqual(piloto)

    // ── Executar agora: só quem tem acesso pode ser escolhido. ──
    const manual = await admin.post(base).send({ name: "Proof Acesso Manual", scopeType: "SUBTEAM", teamId: team, subteamId: subteam, trigger: { kind: "manual", context: "COLLABORATOR" } })
    const manualId = manual.body.data.id as string
    expect((await admin.put(`${base}/${manualId}/draft`).send({ graph })).status).toBe(200)
    expect((await admin.put(`${base}/${manualId}/analysis-config`).send({ mode: "INDIVIDUAL", populationFilter: null, requireActiveAccess: true })).status).toBe(200)
    expect((await admin.post(`${base}/${manualId}/publish`).send({})).status).toBe(200)
    const collaborators = (await admin.get(`${base}/${manualId}/manual-run/collaborators`)).body.data as { items: { id: string }[]; total: number }
    expect(collaborators.total).toBe(2)
    expect(collaborators.items.map((row) => row.id).sort()).toEqual(piloto)
    const refusedRun = await admin.post(`${base}/${manualId}/manual-runs`).send({ collaboratorId: semConta2.id, idempotencyKey: `proof-acesso-${Date.now()}-a` })
    expect(refusedRun.status).toBeGreaterThanOrEqual(400)
    expect((await admin.post(`${base}/${manualId}/manual-runs`).send({ collaboratorId: comAcesso1.id, idempotencyKey: `proof-acesso-${Date.now()}-b` })).status).toBeLessThan(300)

    // ── Nova tentativa (AL-04): a execução bloqueada de quem perdeu o acesso não renasce; com o acesso de volta, renasce. ──
    const blockedId = (await client.query<{ id: string }>("select id from workflow_enrollments where workflow_id = $1 order by created_at desc limit 1", [manualId])).rows[0]!.id
    await client.query("update workflow_enrollments set status = 'blocked', blocked_node_id = 'end', blocked_reason = 'AGENT_INACTIVE' where id = $1", [blockedId])
    expect((await previewWorkflowRetry(client as never, ORG, blockedId)).blockers).toEqual([])
    await client.query("update user_accounts set active = false where id = $1", [comAcesso1.accountId])
    const withoutAccess = await previewWorkflowRetry(client as never, ORG, blockedId)
    expect(withoutAccess.blockers.map((blocker) => blocker.code)).toEqual(["WORKFLOW_RETRY_NO_ACTIVE_ACCESS"])
    await expect(confirmWorkflowRetry(client as never, ORG, blockedId, { fingerprint: withoutAccess.fingerprint }, { personId: geral.id, name: "Proof" })).rejects.toMatchObject({ code: "WORKFLOW_RETRY_NO_ACTIVE_ACCESS", statusCode: 409 })
    expect((await client.query("select 1 from workflow_enrollments where retry_of_enrollment_id = $1", [blockedId])).rowCount).toBe(0)
    await client.query("update user_accounts set active = true where id = $1", [comAcesso1.accountId])
    const withAccess = await previewWorkflowRetry(client as never, ORG, blockedId)
    expect(withAccess.blockers).toEqual([])
    expect((await confirmWorkflowRetry(client as never, ORG, blockedId, { fingerprint: withAccess.fingerprint }, { personId: geral.id, name: "Proof" })).enrollmentId).toBeTruthy()

    // ── Consolidado: a rota desliga a opção ao trocar o modo; uma escrita direta é barrada ao publicar. ──
    const consolidated = await admin.put(`${base}/${scheduleId}/analysis-config`).send({ mode: "CONSOLIDATED", consolidatedStructure: { kind: "SUBTEAM", subteamId: subteam } })
    expect(consolidated.status).toBe(200)
    expect(consolidated.body.data.draftConfiguration).toMatchObject({ requireActiveAccess: false })
    await client.query("update workflows set draft_require_active_access = true where id = $1", [scheduleId])
    const invalid = await admin.post(`${base}/${scheduleId}/validate`).send({})
    expect(invalid.body.data).toMatchObject({ valid: false, error: { code: "WORKFLOW_ACCESS_REQUIREMENT_INVALID_MODE" } })
  })
})
