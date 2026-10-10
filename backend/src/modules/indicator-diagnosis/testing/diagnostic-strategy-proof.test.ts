/**
 * PROVA contra o banco de TESTE real (V1.6.2): estratégia de diagnóstico do indicador — versionamento (rascunho → v1 publicada
 * imutável → v2), validação na publicação, status na listagem, execução PRESA à versão do nascimento, permissões/organização
 * pela API real e a simulação "Testar diagnóstico" (somente leitura, sem Output, parada antes da IA). ZERO chamada de modelo.
 * Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run diagnostic-strategy-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { enrollIndicatorWorkflows } from "../../workflows/application/indicator-enrollment.js"
import { loadEffectiveStrategy, resolveExecutionStrategy } from "../application/diagnostic-strategy-service.js"
import { emptyStrategyConfig } from "../domain/diagnostic-strategy.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("V1.6.2 — estratégia de diagnóstico do indicador: prova Postgres (API real, versão presa, simulação sem efeito)", () => {
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

  it("ciclo completo: A–G, J, M, N, O", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof 162 Grupo A') returning id", [org, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof 162 Grupo B') returning id", [org, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (level: string, teamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, $2, $3, $4) returning id", [org, `Proof 162 ${level} ${n}`, level, teamId])).rows[0]!.id
      const email = `proof-162-${n}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [org, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [org, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person("OPERATOR", null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminA = await person("SUPERVISOR", teamA, "ADMINISTRADOR", { type: "GROUP", teamId: teamA })
    const semPapel = await person("SUPERVISOR", teamA)
    const operatorA = await person("OPERATOR", teamA)
    const operatorB = await person("OPERATOR", teamB)

    const indicator = async (code: string, unit: string) => (await client.query<{ id: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, $2, $3, $4, 'LOWER') returning id", [org, code, `Proof ${code}`, unit])).rows[0]!.id
    const tma = await indicator(`PROOF_162_TMA_${Date.now()}`, "SECONDS")
    const other = await indicator(`PROOF_162_OUT_${Date.now()}`, "COUNT")
    const tmaCode = (await client.query<{ code: string }>("select code from indicator_definitions where id = $1", [tma])).rows[0]!.code
    await client.query("insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1, $2, 'TEAM', $3, 600, '2026-01-01')", [org, tma, teamA])
    const measurement = (await client.query<{ id: string }>("insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, 700, '2026-06-01T03:00:00Z', '2026-07-01T03:00:00Z', 'PROOF', 'MONTHLY') returning id", [org, tma, operatorA.id])).rows[0]!.id
    for (const day of [3, 10, 17]) {
      const interaction = (await client.query<{ id: string }>("insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1, $2, 'Contestação Prova', $3, $4, $5) returning id", [org, operatorA.id, `2026-06-${String(day).padStart(2, "0")}T13:00:00Z`, `2026-06-${String(day).padStart(2, "0")}T13:15:00Z`, `PROOF-162-${day}-${Math.random()}`])).rows[0]!.id
      await client.query("insert into transcripts (organization_id, interaction_id, content) values ($1, $2, 'OPERADOR: Vou verificar.')", [org, interaction])
    }
    const agent = (await client.query<{ id: string }>("insert into agents (organization_id, name, agent_type, objective, description, context_prompt) values ($1, 'Proof 162 Agent', 'CALL_FEEDBACK', 'o', 'd', 'c') returning id", [org])).rows[0]!.id

    const app = createApp(client as never)
    const login = async (email: string) => {
      const agentHttp = request.agent(app)
      expect((await agentHttp.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return agentHttp
    }
    const admin = await login(geral.email)
    const base = `/api/v1/admin/indicator-diagnostic-strategies/indicators`
    const listStatus = async (id: string) => ((await admin.get(`/api/v1/admin/indicator-rules`)).body.data as { id: string; diagnosticStrategyStatus: string }[]).find((item) => item.id === id)!.diagnosticStrategyStatus

    // A) sem estratégia → Não configurado (na listagem e no detalhe); O) o indicador segue calculando normalmente.
    expect(await listStatus(tma)).toBe("NOT_CONFIGURED")
    expect((await admin.get(`${base}/${tma}`)).body.data).toMatchObject({ status: "NOT_CONFIGURED", published: null, draft: null, capabilities: { indicator: { decomposable: true } }, newDraftTemplate: emptyStrategyConfig() })
    // V1.6.2a: VISUALIZAR nunca escreve — nem cabeçalho, nem versão.
    const strategyRows = async (id: string) => (await client.query<{ n: string }>("select count(*) n from indicator_diagnostic_strategy_versions v join indicator_diagnostic_strategies s on s.id = v.strategy_id where s.indicator_definition_id = $1", [id])).rows[0]!.n
    await admin.get(`${base}/${tma}`)
    expect((await client.query("select 1 from indicator_diagnostic_strategies where indicator_definition_id = $1", [tma])).rowCount).toBe(0)
    expect((await client.query("select value from indicator_measurements where id = $1", [measurement])).rows[0].value).toBe("700")

    // B) rascunho: começa tudo desligado; salva a configuração tipada.
    const created = (await admin.put(`${base}/${tma}/draft`).send({})).body.data
    expect(created).toMatchObject({ status: "DRAFT", draft: { version: 1, status: "DRAFT", config: emptyStrategyConfig() } })
    const config = { ...emptyStrategyConfig(), segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 5, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true } }
    expect((await admin.put(`${base}/${tma}/draft`).send({ config })).body.data.draft).toMatchObject({ version: 1, config })
    expect(await listStatus(tma)).toBe("DRAFT")
    expect((await admin.put(`${base}/${tma}/draft`).send({ config: { ...config, allowCausalClaims: true } })).body.error.code).toBe("STRATEGY_INVALID")

    // C) publica v1.
    const v1 = (await admin.post(`${base}/${tma}/publish`)).body.data
    expect(v1).toMatchObject({ status: "PUBLISHED", published: { version: 1, status: "PUBLISHED" }, draft: null })
    expect(await listStatus(tma)).toBe("PUBLISHED")
    expect((await client.query("select action from audit_logs where entity_id = $1", [v1.published.id])).rows).toEqual([{ action: "INDICATOR_DIAGNOSTIC_STRATEGY_PUBLISHED" }])

    // F) a execução nasce presa à v1 (matrícula real por Indicador).
    const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }], edges: [] }
    const workflow = (await client.query<{ id: string }>("insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1, 'Proof 162 WF', $2, $3) returning id", [org, JSON.stringify({ kind: "indicator", indicatorCode: tmaCode }), JSON.stringify(graph)])).rows[0]!.id
    const wfVersion = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [workflow, JSON.stringify(graph)])).rows[0]!.id
    await client.query("update workflows set active = true, active_version_id = $2 where id = $1", [workflow, wfVersion])
    expect(await enrollIndicatorWorkflows(client, { organizationId: org, measurementId: measurement, operatorId: operatorA.id, indicatorCode: tmaCode, value: 700 })).toBe(1)
    const firstEnrollment = (await client.query<{ id: string; pinned: string }>("select id, indicator_diagnostic_strategy_version_id pinned from workflow_enrollments where workflow_id = $1", [workflow])).rows[0]!
    expect(firstEnrollment.pinned).toBe(v1.published.id)

    // D) editar a publicada → rascunho v2 (a partir da v1); v1 continua vigente.
    const v2Draft = (await admin.put(`${base}/${tma}/draft`).send({})).body.data
    expect(v2Draft).toMatchObject({ status: "PUBLISHED", published: { version: 1 }, draft: { version: 2, config } })
    const draftPending = async (id: string) => ((await admin.get(`/api/v1/admin/indicator-rules`)).body.data as { id: string; diagnosticStrategyDraftPending: boolean }[]).find((item) => item.id === id)!.diagnosticStrategyDraftPending
    // A listagem continua "Configurado" (a vigente não muda) e sinaliza o rascunho pendente.
    expect([await listStatus(tma), await draftPending(tma)]).toEqual(["PUBLISHED", true])
    // G) combinação impossível falha na PUBLICAÇÃO (processos sem atendimentos) — o rascunho continua rascunho.
    await admin.put(`${base}/${tma}/draft`).send({ config: { ...config, interactionInvestigation: { ...config.interactionInvestigation, enabled: false } } })
    const rejected = await admin.post(`${base}/${tma}/publish`)
    expect([rejected.status, rejected.body.error.code]).toEqual([422, "STRATEGY_INVALID_FOR_PUBLISH"])
    expect(rejected.body.error.details.issues.map((issue: { code: string }) => issue.code)).toContain("STRATEGY_PROCESS_WITHOUT_INTERACTIONS")
    const v2Config = { ...config, interactionInvestigation: { ...config.interactionInvestigation, maxInteractions: 8 }, noDiagnosisBehavior: "HOLD_FOR_QA" }
    await admin.put(`${base}/${tma}/draft`).send({ config: v2Config })
    const v2 = (await admin.post(`${base}/${tma}/publish`)).body.data
    expect(v2).toMatchObject({ published: { version: 2 }, history: [{ version: 2, status: "PUBLISHED" }, { version: 1, status: "SUPERSEDED" }] })
    expect(await draftPending(tma)).toBe(false)

    // V1.6.2a: abrir a PUBLICADA (várias vezes) não cria versão; o modelo do próximo rascunho é a vigente.
    const versionsBefore = await strategyRows(tma)
    for (let i = 0; i < 3; i += 1) expect((await admin.get(`${base}/${tma}`)).body.data).toMatchObject({ draft: null, newDraftTemplate: v2Config })
    expect(await strategyRows(tma)).toBe(versionsBefore)
    // Salvar cria o rascunho v3; descartar remove e AUDITA (quem, indicador, versão — nunca a configuração).
    const v3 = (await admin.put(`${base}/${tma}/draft`).send({ config: v2Config })).body.data.draft
    expect(v3).toMatchObject({ version: 3, status: "DRAFT" })
    expect((await admin.delete(`${base}/${tma}/draft`)).body.data).toMatchObject({ draft: null, published: { version: 2 } })
    expect(await strategyRows(tma)).toBe(versionsBefore)
    const discardAudit = (await client.query<{ action: string; actor_id: string; payload: Record<string, unknown> }>("select action, actor_id, payload from audit_logs where entity_id = $1", [v3.id])).rows
    expect(discardAudit).toEqual([{ action: "INDICATOR_DIAGNOSTIC_STRATEGY_DRAFT_DISCARDED", actor_id: geral.id, payload: { indicatorId: tma, strategyId: expect.any(String), version: 3 } }])
    // Descartar sem rascunho não audita nada.
    await admin.delete(`${base}/${tma}/draft`)
    expect((await client.query("select 1 from audit_logs where action = 'INDICATOR_DIAGNOSTIC_STRATEGY_DRAFT_DISCARDED' and payload->>'indicatorId' = $1", [tma])).rowCount).toBe(1)

    // E) v1 imutável (banco recusa alterar/apagar); F) a execução que nasceu com v1 continua com v1; a nova nasce com v2.
    await client.query("savepoint immutability")
    await expect(client.query("update indicator_diagnostic_strategy_versions set config = '{}'::jsonb where id = $1", [v1.published.id])).rejects.toThrow(/imutável/)
    await client.query("rollback to savepoint immutability")
    await expect(client.query("delete from indicator_diagnostic_strategy_versions where id = $1", [v1.published.id])).rejects.toThrow(/não pode ser apagada/)
    await client.query("rollback to savepoint immutability")
    expect((await resolveExecutionStrategy(client, org, { enrollmentId: firstEnrollment.id, indicatorId: tma }))!).toMatchObject({ id: v1.published.id, version: 1, config })
    await client.query("delete from workflow_enrollments where id = $1", [firstEnrollment.id])
    expect(await enrollIndicatorWorkflows(client, { organizationId: org, measurementId: measurement, operatorId: operatorA.id, indicatorCode: tmaCode, value: 700 })).toBe(1)
    const secondEnrollment = (await client.query<{ id: string }>("select id from workflow_enrollments where workflow_id = $1", [workflow])).rows[0]!.id
    expect(await resolveExecutionStrategy(client, org, { enrollmentId: secondEnrollment, indicatorId: tma })).toMatchObject({ version: 2, config: { noDiagnosisBehavior: "HOLD_FOR_QA", interactionInvestigation: { maxInteractions: 8 } } })

    // J) outro indicador, estratégia diferente (volume, sem investigação de atendimentos).
    await admin.put(`${base}/${other}/draft`).send({ config: { ...emptyStrategyConfig(), noDiagnosisBehavior: "NO_FEEDBACK" } })
    await admin.post(`${base}/${other}/publish`)
    expect(await loadEffectiveStrategy(client, org, { id: other })).toMatchObject({ version: 1, config: { noDiagnosisBehavior: "NO_FEEDBACK", segmentation: { enabled: false } } })
    expect(await loadEffectiveStrategy(client, org, { id: tma })).toMatchObject({ version: 2 })

    // Inativar → Inativo; nenhuma execução nova recebe estratégia (versões preservadas).
    expect((await admin.post(`${base}/${other}/active`).send({ active: false })).body.data.status).toBe("INACTIVE")
    expect(await listStatus(other)).toBe("INACTIVE")
    expect(await loadEffectiveStrategy(client, org, { id: other })).toBeNull()

    // Workflow não repete a estratégia, mas depende dela: sem estratégia publicada e ativa, o formato de diagnóstico não publica.
    const otherCode = (await client.query<{ code: string }>("select code from indicator_definitions where id = $1", [other])).rows[0]!.code
    const diagnosisGraph = { nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "agent", type: "action", label: "Diagnóstico", position: { x: 0, y: 1 }, config: { actionType: "CALL_AGENT", agentId: agent, outputContract: "INDICATOR_DIAGNOSIS" } },
      { id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 2 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "agent", feedbackDomain: "AUTO" } },
      { id: "output", type: "output", label: "Feedback ao operador", position: { x: 0, y: 3 }, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["FOLLOW_UP"], source: "nodeOutputs.feedback" } },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 4 }, config: {} },
    ], edges: [["trigger", "agent"], ["agent", "feedback"], ["feedback", "output"], ["output", "end"]].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })) }
    const draftWorkflow = async (code: string) => (await client.query<{ id: string }>("insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1, 'Proof 162 diagnóstico', $2, $3) returning id", [org, JSON.stringify({ kind: "indicator", indicatorCode: code }), JSON.stringify(diagnosisGraph)])).rows[0]!.id
    const missing = (await admin.post(`/api/v1/admin/workflows/${await draftWorkflow(otherCode)}/validate`)).body.data
    expect(missing).toMatchObject({ valid: false, error: { code: "WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING" } })
    const withStrategy = (await admin.post(`/api/v1/admin/workflows/${await draftWorkflow(tmaCode)}/validate`)).body.data
    expect(withStrategy.error?.code ?? null).not.toBe("WORKFLOW_INDICATOR_DIAGNOSIS_STRATEGY_MISSING")

    // M) permissões: sem papel = 403; administrador de Grupo lê, mas não altera nem testa colaborador de fora do escopo.
    const none = await login(semPapel.email)
    expect((await none.get(`${base}/${tma}`)).status).toBe(403)
    const scoped = await login(adminA.email)
    expect((await scoped.get(`${base}/${tma}`)).status).toBe(200)
    expect((await scoped.put(`${base}/${tma}/draft`).send({})).status).toBe(403)
    expect((await scoped.post(`${base}/${tma}/publish`)).status).toBe(403)
    const simulate = (collaboratorId: string) => ({ source: "PUBLISHED", collaboratorId, measurementId: measurement, agentId: agent, aiPolicy: "STOP_BEFORE_AI" })
    expect((await scoped.post(`${base}/${tma}/simulate`).send(simulate(operatorB.id))).status).toBe(404)
    // Regressão (QA 2026-09-25): as PESSOAS vêm antes das medições. Uma pessoa com centenas de medições diárias e nome
    // anterior no alfabeto não pode esconder as outras; cada período diz quantos atendimentos o plano encontraria.
    const volume = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'AAA Proof 162 Volume', 'OPERATOR', $2) returning id", [org, teamA])).rows[0]!.id
    await client.query(
      "insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) select $1, $2, 'PERSON', $3, 500, d, d + interval '1 day', 'PROOF', 'DAILY' from generate_series('2025-01-01T03:00:00Z'::timestamptz, '2026-03-01T03:00:00Z'::timestamptz, interval '1 day') d",
      [org, tma, volume],
    )
    const options = (await scoped.get(`${base}/${tma}/simulation-options`)).body.data
    expect(options.collaborators.map((entry: { id: string }) => entry.id)).toEqual([volume, operatorA.id])
    expect(options.collaborators[0].measurements).toHaveLength(6)
    expect(options.collaborators[1].measurements).toEqual([expect.objectContaining({ id: measurement, interactions: 3 })])
    expect((await scoped.get(`${base}/${tma}/simulation-options?search=Volume`)).body.data.collaborators.map((entry: { id: string }) => entry.id)).toEqual([volume])
    expect((await scoped.get(`${base}/${tma}/simulation-options?search=inexistente`)).body.data.collaborators).toEqual([])
    // Organização da SESSÃO: indicador de outra organização não existe para ela.
    const otherOrg = (await client.query<{ id: string }>("insert into organizations (name, slug) values ('Proof 162 Outra', 'proof-162-outra') returning id")).rows[0]!.id
    const foreign = (await client.query<{ id: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, 'PROOF_162_FOREIGN', 'Estrangeiro', 'SECONDS', 'LOWER') returning id", [otherOrg])).rows[0]!.id
    expect((await admin.get(`${base}/${foreign}`)).status).toBe(404)
    expect((await admin.put(`${base}/${foreign}/draft`).send({})).status).toBe(404)
    expect((await admin.get(`${base}/${foreign}/simulation-options`)).status).toBe(404)

    // N) simulação: o MESMO motor do Workflow, banco só-leitura, parada antes da IA — nada gravado, nenhum Output.
    const count = async () => (await client.query<{ n: string }>("select (select count(*) from reliable_feedback_artifacts) + (select count(*) from workflow_output_emissions) + (select count(*) from feedbacks) + (select count(*) from agent_runs) + (select count(*) from process_checkpoint_observations) + (select count(*) from feedback_analysis_runs) + (select count(*) from indicator_investigations) + (select count(*) from feedback_engine_messages) + (select count(*) from call_assessments) n")).rows[0]!.n
    const before = await count()
    const simulated = await scoped.post(`${base}/${tma}/simulate`).send(simulate(operatorA.id))
    expect(simulated.status).toBe(200)
    expect(simulated.body.data).toMatchObject({
      strategy: { version: 2, status: "PUBLISHED" },
      officialResult: { value: "700 s", target: "600 s" },
      aiExecuted: false,
      feedback: null,
      usage: { requests: 0 },
    })
    // Investigação determinística do motor: resultado oficial, localização por assunto e nenhuma chamada analisada.
    expect(simulated.body.data.investigation).toMatchObject({ official: { value: 700 }, budget: { maxCallAnalyses: 0, callAnalyses: 0 } })
    expect(simulated.body.data.investigation.localization.segments.map((segment: { label: string }) => segment.label)).toContain("Contestação Prova")
    expect(simulated.body.data.aiStoppedReason).toMatch(/parou antes da IA/)
    expect(JSON.stringify(simulated.body.data)).not.toMatch(/systemPrompt|Você escreve/)
    expect(await count()).toBe(before)
  })
})
