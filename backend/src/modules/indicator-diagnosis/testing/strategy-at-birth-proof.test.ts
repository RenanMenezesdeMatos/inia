/**
 * PROVA contra o banco de TESTE real (`STRATEGY_AT_BIRTH_V1`): a estratégia de diagnóstico de UMA execução é a que estava em vigor
 * quando ela NASCEU — por indicador — em todo caminho que chega a um diagnóstico de indicador, não só na matrícula por Indicador.
 * Origem: dev 05/10/2026, Workflow "Feedback de indicador" (Manual · Colaborador → Chamar agente com diagnóstico do fechamento do PRV):
 * a matrícula nasceu sem pino e a investigação rodou "sem estratégia de diagnóstico publicada" com a v4 do TMA publicada e ativa.
 *
 * O histórico das estratégias é gravado com datas EXPLÍCITAS no passado (numa transação só, `now()` não anda); ativação pelo serviço
 * real. Matrículas pelos caminhos reais (execução manual por colaborador, matrícula por Indicador) e nas formas da Agenda e do fan-out.
 * ZERO chamada de modelo. Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run strategy-at-birth-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import "../../feedback-engine/testing/no-external-ai.js"
import { env } from "../../../config/env.js"
import { createEngineDeps } from "../../feedback-engine/application/engine-wiring.js"
import { fakeEngineModel } from "../../feedback-engine/testing/fake-engine-model.js"
import { enrollIndicatorWorkflows } from "../../workflows/application/indicator-enrollment.js"
import { requestManualRun } from "../../workflows/application/manual-run.js"
import { loadEffectiveStrategy, resolveExecutionStrategy, setStrategyActive } from "../application/diagnostic-strategy-service.js"
import { emptyStrategyConfig, type DiagnosticStrategyConfig } from "../domain/diagnostic-strategy.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
let pool: pg.Pool
let client: pg.PoolClient

describe.skipIf(!ENABLED)("STRATEGY_AT_BIRTH_V1 — estratégia em vigor no nascimento, por indicador, em todo caminho de diagnóstico (prova Postgres)", () => {
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

  it("manual por colaborador, Agenda, fan-out e matrícula por Indicador: a versão do nascimento, por indicador", async () => {
    const org = (await client.query<{ id: string }>("select id from organizations order by created_at limit 1")).rows[0]!.id
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [org])).rows[0]!.id
    const team = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof birth Grupo') returning id", [org, operation])).rows[0]!.id
    const actorPerson = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Proof birth Admin', 'SUPERVISOR', $2) returning id", [org, team])).rows[0]!.id
    const actorAccount = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, 'proof-birth-admin@proof.inia.local', 'x') returning id", [org, actorPerson])).rows[0]!.id
    const operator = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id) values ($1, 'Proof birth Operadora', 'OPERATOR', $2) returning id", [org, team])).rows[0]!.id

    const stamp = Date.now()
    const indicator = async (code: string, unit: string) => {
      const row = (await client.query<{ id: string; code: string }>("insert into indicator_definitions (organization_id, code, name, unit, desired_direction) values ($1, $2, $3, $4, 'LOWER') returning id, code", [org, `PROOF_BIRTH_${code}_${stamp}`, `Proof ${code}`, unit])).rows[0]!
      return row
    }
    // A = o TMA do caso real (v1 → v2 com pares ligados); B = publicada e depois DESATIVADA; C = desativada e REATIVADA;
    // D = sem estratégia; E = desativada pelo serviço real agora (depois de todos os nascimentos).
    const [A, B, C, D, E] = [await indicator("TMA", "SECONDS"), await indicator("VOLUME", "COUNT"), await indicator("C", "SECONDS"), await indicator("D", "SECONDS"), await indicator("E", "SECONDS")]

    const at = (date: string) => `${date}T12:00:00Z`
    const config = (patch: Partial<DiagnosticStrategyConfig>): DiagnosticStrategyConfig => ({ ...emptyStrategyConfig(), ...patch })
    const peersOn = config({ segmentation: { enabled: true, dimensions: ["SUBJECT"], minimumSegmentInteractions: 3 }, interactionInvestigation: { enabled: true, maxInteractions: 8, minimumAnalyzed: 3, minimumCoveragePercent: null }, processAssessment: { enabled: true }, peerComparison: { enabled: true, minimumPopulation: 4, minimumContributors: 4, minimumObservedInteractions: 5 } })
    /** Histórico gravado como a aplicação o deixaria: cabeçalho, versões publicadas em ordem (só a última vigente) e eventos de ativação. */
    const history = async (indicatorId: string, input: { createdAt: string; updatedAt: string; active: boolean; versions: { publishedAt: string; config: DiagnosticStrategyConfig }[]; events?: { action: "ACTIVATED" | "DEACTIVATED"; at: string }[] }) => {
      const header = (await client.query<{ id: string }>("insert into indicator_diagnostic_strategies (organization_id, indicator_definition_id, active, created_by, created_at, updated_at) values ($1, $2, $3, $4, $5, $6) returning id", [org, indicatorId, input.active, actorAccount, input.createdAt, input.updatedAt])).rows[0]!.id
      const ids: string[] = []
      for (const [index, version] of input.versions.entries()) {
        const status = index === input.versions.length - 1 ? "PUBLISHED" : "SUPERSEDED"
        ids.push((await client.query<{ id: string }>("insert into indicator_diagnostic_strategy_versions (organization_id, strategy_id, version, status, config, created_by, created_at, published_by, published_at) values ($1, $2, $3, $4, $5, $6, $7, $6, $7) returning id", [org, header, index + 1, status, JSON.stringify(version.config), actorAccount, version.publishedAt])).rows[0]!.id)
      }
      for (const event of input.events ?? []) await client.query("insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload, created_at) values ($1, $2, $3, 'indicator_diagnostic_strategy', $4, $5, $6)", [org, actorPerson, `INDICATOR_DIAGNOSTIC_STRATEGY_${event.action}`, header, JSON.stringify({ indicatorId }), event.at])
      return ids
    }
    const [a1, a2] = await history(A.id, { createdAt: at("2026-08-01"), updatedAt: at("2026-09-01"), active: true, versions: [{ publishedAt: at("2026-08-01"), config: config({ noDiagnosisBehavior: "FACTUAL_ONLY" }) }, { publishedAt: at("2026-09-01"), config: peersOn }] })
    const [b1] = await history(B.id, { createdAt: at("2026-08-15"), updatedAt: at("2026-09-10"), active: false, versions: [{ publishedAt: at("2026-08-15"), config: config({ noDiagnosisBehavior: "NO_FEEDBACK" }) }], events: [{ action: "DEACTIVATED", at: at("2026-09-10") }] })
    const [c1] = await history(C.id, { createdAt: at("2026-08-01"), updatedAt: at("2026-09-05"), active: true, versions: [{ publishedAt: at("2026-08-01"), config: config({ noDiagnosisBehavior: "HOLD_FOR_QA" }) }], events: [{ action: "DEACTIVATED", at: at("2026-08-20") }, { action: "ACTIVATED", at: at("2026-09-05") }] })
    const [e1] = await history(E.id, { createdAt: at("2026-08-01"), updatedAt: at("2026-08-01"), active: true, versions: [{ publishedAt: at("2026-08-01"), config: config({}) }] })
    // Desativar pelo serviço real: mudança e evento na MESMA transação (o histórico que a dedução lê).
    await setStrategyActive(client as never, org, E.id, false, { userAccountId: actorAccount, personId: actorPerson })
    expect((await client.query("select action from audit_logs where entity_type = 'indicator_diagnostic_strategy' and payload->>'indicatorId' = $1", [E.id])).rows).toEqual([{ action: "INDICATOR_DIAGNOSTIC_STRATEGY_DEACTIVATED" }])

    const graph = { nodes: [{ id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} }, { id: "end", type: "end", label: "Fim", position: { x: 0, y: 1 }, config: {} }], edges: [{ id: "e1", source: "trigger", sourceHandle: "always", target: "end" }] }
    const workflow = async (name: string, trigger: unknown) => {
      const id = (await client.query<{ id: string }>("insert into workflows (organization_id, name, trigger_config, draft_graph) values ($1, $2, $3, $4) returning id", [org, name, JSON.stringify(trigger), JSON.stringify(graph)])).rows[0]!.id
      const version = (await client.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [id, JSON.stringify(graph)])).rows[0]!.id
      await client.query("update workflows set active = true, active_version_id = $2 where id = $1", [id, version])
      return { id, version }
    }
    const bornAt = (enrollmentId: string, date: string) => client.query("update workflow_enrollments set created_at = $2 where id = $1", [enrollmentId, at(date)])
    const resolve = async (enrollmentId: string | null, indicatorId: string) => (await resolveExecutionStrategy(client, org, { enrollmentId, indicatorId }))?.id ?? null

    // 1) EXECUÇÃO MANUAL POR COLABORADOR (o caso real): nasce sem pino — a versão vem do instante do nascimento, por indicador.
    const manual = await workflow("Proof birth manual", { kind: "manual", context: "COLLABORATOR" })
    const run = await requestManualRun(client as never, { organizationId: org, workflowId: manual.id, requestedBy: actorPerson, collaboratorId: operator, idempotencyKey: `proof-birth-${stamp}` }, () => true)
    expect((await client.query("select indicator_diagnostic_strategy_version_id pinned, scheduled_subject_id subject from workflow_enrollments where id = $1", [run.enrollmentId])).rows[0]).toEqual({ pinned: null, subject: operator })
    const expectations: [string, Record<string, string | null>][] = [
      ["2026-07-01", { A: null, B: null, C: null, D: null, E: null }],
      ["2026-08-10", { A: a1!, B: null, C: c1!, D: null, E: e1! }],
      ["2026-08-25", { A: a1!, B: b1!, C: null, D: null, E: e1! }],
      ["2026-09-20", { A: a2!, B: null, C: c1!, D: null, E: e1! }],
    ]
    for (const [date, expected] of expectations) {
      await bornAt(run.enrollmentId, date)
      const resolved: Record<string, string | null> = {}
      for (const [key, entry] of Object.entries({ A, B, C, D, E })) resolved[key] = await resolve(run.enrollmentId, entry.id)
      expect({ date, ...resolved }).toEqual({ date, ...expected })
    }
    // Agora: A v2, B inativa, C reativada, E desativada — o que vale para quem nasce HOJE e para a simulação (sem matrícula gravada).
    const effective: (string | null)[] = []
    for (const entry of [A, B, C, E]) effective.push((await loadEffectiveStrategy(client, org, { id: entry.id }))?.id ?? null)
    expect(effective).toEqual([a2, null, c1, null])
    expect([await resolve(null, A.id), await resolve(null, E.id)]).toEqual([a2, null])
    expect(await resolve("qa-lab-sem-matricula", A.id)).toBe(a2)

    // O motor de feedback lê pela MESMA função (engine-wiring): a matrícula do caso real recebe a estratégia com pares ligados.
    const engine = createEngineDeps({ db: client as never, model: fakeEngineModel().model, tools: null })
    expect(await engine.investigate.strategy(org, run.enrollmentId, A.id)).toMatchObject({ configured: true, strategyVersionId: a2, peer: { enabled: true } })
    await bornAt(run.enrollmentId, "2026-07-01")
    expect(await engine.investigate.strategy(org, run.enrollmentId, A.id)).toMatchObject({ configured: false, strategyVersionId: null })

    // 2) AGENDA (forma do schedule-check: colaborador + horário, sem pino) e 3) FILHO DE FAN-OUT: vale o nascimento do DISPARO (raiz).
    const schedule = await workflow("Proof birth agenda", { kind: "schedule", times: ["08:00"] })
    const scheduled = (await client.query<{ id: string }>("insert into workflow_enrollments (organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id, created_at) values ($1, $2, $3, $4, $5, 'trigger', $5) returning id", [org, schedule.id, schedule.version, operator, at("2026-08-10")])).rows[0]!.id
    expect(await resolve(scheduled, A.id)).toBe(a1)
    // Raiz consolidada (o "carregador técnico" da estrutura vai em scheduled_subject_id, como no schedule-check).
    const root = (await client.query<{ id: string }>("insert into workflow_enrollments (organization_id, workflow_id, version_id, scheduled_subject_id, scheduled_for, current_node_id, created_at) values ($1, $2, $3, $4, $5, 'fan', $5) returning id", [org, schedule.id, schedule.version, actorPerson, at("2026-08-11")])).rows[0]!.id
    const child = (await client.query<{ id: string }>("insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, parent_enrollment_id, fan_out_node_id, scheduled_subject_id, created_at) values ($1, $2, $3, 'end', $4, 'fan', $5, $6) returning id", [org, schedule.id, schedule.version, root, operator, at("2026-09-20")])).rows[0]!.id
    expect([await resolve(child, A.id), await resolve(child, B.id)]).toEqual([a1, null])

    // 4) MATRÍCULA POR INDICADOR: o pino vale para o indicador DA MEDIÇÃO (nascimento hoje → v2, mesmo com a data mudada depois);
    // outro indicador diagnosticado pela mesma execução segue a data de nascimento.
    const byIndicator = await workflow("Proof birth indicador", { kind: "indicator", indicatorCode: A.code })
    const measurement = (await client.query<{ id: string }>("insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, 700, '2026-08-01T03:00:00Z', '2026-09-01T03:00:00Z', 'PROOF', 'MONTHLY') returning id", [org, A.id, operator])).rows[0]!.id
    expect(await enrollIndicatorWorkflows(client, { organizationId: org, measurementId: measurement, operatorId: operator, indicatorCode: A.code, value: 700 })).toBe(1)
    const pinned = (await client.query<{ id: string; pinned: string }>("select id, indicator_diagnostic_strategy_version_id pinned from workflow_enrollments where workflow_id = $1", [byIndicator.id])).rows[0]!
    expect(pinned.pinned).toBe(a2)
    await bornAt(pinned.id, "2026-08-10")
    expect([await resolve(pinned.id, A.id), await resolve(pinned.id, C.id), await resolve(pinned.id, B.id)]).toEqual([a2, c1, null])

    // Matrícula por Indicador que nasceu SEM estratégia efetiva: o pino nulo vale para o indicador dela — uma versão que apareça
    // depois nunca entra "ao vivo", nem pela dedução por data (que vale para quem não tem pino daquele indicador).
    const byD = await workflow("Proof birth indicador D", { kind: "indicator", indicatorCode: D.code })
    const measurementD = (await client.query<{ id: string }>("insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity) values ($1, $2, 'PERSON', $3, 500, '2026-08-01T03:00:00Z', '2026-09-01T03:00:00Z', 'PROOF', 'MONTHLY') returning id", [org, D.id, operator])).rows[0]!.id
    expect(await enrollIndicatorWorkflows(client, { organizationId: org, measurementId: measurementD, operatorId: operator, indicatorCode: D.code, value: 500 })).toBe(1)
    const unpinned = (await client.query<{ id: string; pinned: string | null }>("select id, indicator_diagnostic_strategy_version_id pinned from workflow_enrollments where workflow_id = $1", [byD.id])).rows[0]!
    expect(unpinned.pinned).toBeNull()
    const [d1] = await history(D.id, { createdAt: at("2026-08-01"), updatedAt: at("2026-08-01"), active: true, versions: [{ publishedAt: at("2026-08-01"), config: config({}) }] })
    await bornAt(run.enrollmentId, "2026-09-20")
    expect([await resolve(unpinned.id, D.id), await resolve(run.enrollmentId, D.id)]).toEqual([null, d1])

    // Organização: matrícula de outra organização não existe para esta (vale a efetiva, como sem matrícula).
    const otherOrg = (await client.query<{ id: string }>("insert into organizations (name, slug) values ('Proof birth Outra', $1) returning id", [`proof-birth-${stamp}`])).rows[0]!.id
    expect(await resolveExecutionStrategy(client, otherOrg, { enrollmentId: run.enrollmentId, indicatorId: A.id })).toBeNull()
  })
})
