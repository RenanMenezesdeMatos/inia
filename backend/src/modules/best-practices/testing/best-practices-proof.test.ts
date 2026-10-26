/**
 * PROVA contra o banco de TESTE real — base de boas práticas: migration 153, dataset sintético separado, fila do worker com gravação
 * atômica, API real (sessão e permissões), revisão auditada, versão nova sem duplicata, corpus REAL (interações/transcrições/fechamento
 * oficial do Grupo), recomendação ao operador (ferramenta do chat) com evidência das chamadas dele, seção do feedback e sumiço do item
 * desativado na leitura. ZERO IA: o "modelo" é o simulado pelo gabarito (as mesmas transcrições nos dois corpora). Tudo numa
 * transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run best-practices-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import "../../feedback-engine/testing/no-external-ai.js"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { loadSelfChatContext } from "../../leadership-analytics/application/self-context.js"
import { processBestPracticeAnalyses } from "../application/analysis-service.js"
import { buildFeedbackBestPractices, withCurrentBestPractices } from "../application/feedback-section.js"
import { upsertSyntheticDataset } from "../application/synthetic-datasets.js"
import { syntheticCorpusSchema, syntheticAnswerKeySchema } from "../domain/synthetic-corpus.js"
import { createSimulatedAnswerKeyModel } from "../infrastructure/simulated-answer-key-model.js"
import { buildSyntheticDataset, SYNTHETIC_PERIOD } from "./synthetic-dataset.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

/** Os serviços abrem a própria transação: aqui ela vira savepoint dentro da transação da prova (nunca um commit de fora). */
function savepointDb(connection: pg.PoolClient): Database {
  const proxy = { query: (sql: string, params?: unknown[]) => (sql === "begin" ? connection.query("savepoint bp_tx") : sql === "commit" ? connection.query("release savepoint bp_tx") : sql === "rollback" ? connection.query("rollback to savepoint bp_tx") : connection.query(sql, params)), release: () => undefined }
  return { query: (sql: string, params?: unknown[]) => connection.query(sql, params), connect: async () => proxy } as unknown as Database
}

describe.skipIf(!ENABLED)("Base de boas práticas — prova Postgres", () => {
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

  it("sintético e real: fila, permissões, revisão, nova versão sem duplicata, chat do operador, feedback e desativação", async () => {
    const db = savepointDb(client)
    const app = createApp(db as never)
    const dataset = buildSyntheticDataset()
    const indicator = async (code: string) => (await client.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = $2`, [ORG, code])).rows[0]!.id
    const tma = await indicator("TMA")
    const ura = await indicator("NOTA_URA")
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof BP Grupo A') returning id", [ORG, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof BP Grupo B') returning id", [ORG, operation])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const account = async (personId: string, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const email = `proof-bp-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, personId, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { email, accountId }
    }
    const person = async (name: string, teamId: string | null, role = "OPERATOR", reportsTo: string | null = null) => (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, reports_to_id) values ($1, $2, $3, $4, $5) returning id", [ORG, name, role, teamId, reportsTo])).rows[0]!.id
    const geralId = await person("Proof BP Geral", null, "MANAGER")
    const adminAId = await person("Proof BP Admin A", teamA, "MANAGER")
    const adminBId = await person("Proof BP Admin B", teamB, "MANAGER")
    const leaderId = await person("Proof BP Supervisora", teamA, "SUPERVISOR")
    const geral = await account(geralId, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminA = await account(adminAId, "ADMINISTRADOR", { type: "GROUP", teamId: teamA })
    const adminB = await account(adminBId, "ADMINISTRADOR", { type: "GROUP", teamId: teamB })
    const leader = await account(leaderId)

    // Corpus REAL no Grupo A: as MESMAS pessoas/chamadas/transcrições/quartis do dataset sintético, em interactions/transcripts/fechamento.
    const corpus = syntheticCorpusSchema.parse(dataset.corpus)
    const peopleByRef = new Map<string, string>()
    for (const operator of corpus.operators) peopleByRef.set(operator.ref, await person(`${operator.name} Proof`, teamA, "OPERATOR", leaderId))
    for (const call of corpus.calls) {
      const started = new Date(call.occurredAt)
      const interactionId = (await client.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, sub_reason, channel, started_at, ended_at, external_id) values ($1, $2, $3, $4, 'VOICE', $5, $6, $7) returning id`, [ORG, peopleByRef.get(call.operatorRef), call.reason, call.subReason, started, new Date(started.getTime() + (call.durationSeconds ?? 300) * 1000), `PROOF-BP-${call.ref}`])).rows[0]!.id
      await client.query(`insert into transcripts (organization_id, interaction_id, version, content, language) values ($1, $2, 1, $3, 'pt-BR')`, [ORG, interactionId, call.transcript])
    }
    for (const result of corpus.results) await client.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, quartile, source) values ($1, $2, $3, $4, $5, $6, 'PROOF_BP')`, [ORG, peopleByRef.get(result.operatorRef), result.indicatorCode === "TMA" ? tma : ura, result.referencePeriod, result.value, result.quartile])

    const login = async (email: string) => {
      const agent = request.agent(app)
      expect((await agent.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return agent
    }
    const asGeral = await login(geral.email)
    const asAdminA = await login(adminA.email)
    const asAdminB = await login(adminB.email)
    const asLeader = await login(leader.email)
    const operatorRef = "SINT-OP-01"
    const operatorLogin = await account(peopleByRef.get(operatorRef)!)
    const asOperator = await login(operatorLogin.email)

    // Capacidades no /auth/me.
    expect((await asLeader.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canViewBestPractices: true, canManageBestPractices: false })
    expect((await asOperator.get("/api/v1/auth/me")).body.data.access.capabilities).toMatchObject({ canViewBestPractices: false })

    // 1) Sintético: só quem administra a organização inteira roda; operador não abre a base.
    const { id: datasetId } = await upsertSyntheticDataset(db, ORG, dataset)
    const syntheticBody = { origin: "SYNTHETIC", syntheticDatasetId: datasetId, indicatorDefinitionId: tma, referencePeriods: [SYNTHETIC_PERIOD], contextLevel: "SUB_REASON", modelMode: "SIMULATED_ANSWER_KEY" }
    expect((await asAdminA.post("/api/v1/best-practices/analyses").send(syntheticBody)).status).toBe(403)
    expect((await asOperator.get("/api/v1/best-practices/patterns")).status).toBe(403)
    expect((await asGeral.post("/api/v1/best-practices/analyses").send({ ...syntheticBody, modelMode: "SIMULATED_ANSWER_KEY", origin: "REAL", teamId: teamA })).status).toBe(422)
    const synthetic = await asGeral.post("/api/v1/best-practices/analyses").send(syntheticBody)
    expect(synthetic.status).toBe(201)
    expect((await asGeral.post("/api/v1/best-practices/analyses").send(syntheticBody)).body.error.code).toBe("BEST_PRACTICE_ANALYSIS_IN_PROGRESS")
    expect(await processBestPracticeAnalyses(db)).toBe(1)
    const syntheticAnalysis = (await asLeader.get(`/api/v1/best-practices/analyses/${synthetic.body.data.id}`)).body.data
    expect(syntheticAnalysis).toMatchObject({ status: "COMPLETED", outcome: "PATTERNS_FOUND", dataOrigin: "SYNTHETIC" })
    const syntheticPatterns = (await asLeader.get(`/api/v1/best-practices/patterns?origin=SYNTHETIC&indicatorId=${tma}&page=1&pageSize=20`)).body.data
    expect(syntheticPatterns.items.map((item: { name: string }) => item.name).sort()).toEqual(["Explicar o motivo da espera e combinar o retorno", "Retomar resumindo o que foi verificado e o próximo passo"])
    const resumeSynthetic = syntheticPatterns.items.find((item: { name: string }) => item.name.startsWith("Retomar"))
    const detail = (await asLeader.get(`/api/v1/best-practices/patterns/${resumeSynthetic.id}`)).body.data
    expect(detail.current.contexts.find((context: { reason: string }) => context.reason === "Fatura").assessment).toMatchObject({ outcome: "SUPPORTED", strength: "MODERATE" })
    expect(detail.evidence.length).toBeGreaterThan(0)
    expect(detail.evidence.every((item: { operatorLabel: string; excerpt: string; interactionId: string | null }) => /^Operador [A-Z]/.test(item.operatorLabel) && item.interactionId === null && !/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(item.excerpt))).toBe(true)
    expect(detail.canManage).toBe(false)
    // Revisão do sintético: só a organização inteira; aprovado continua FORA das recomendações de produção.
    expect((await asAdminA.post(`/api/v1/best-practices/patterns/${resumeSynthetic.id}/review`).send({ action: "APPROVE" })).status).toBe(403)
    expect((await asGeral.post(`/api/v1/best-practices/patterns/${resumeSynthetic.id}/review`).send({ action: "APPROVE" })).body.data.reviewStatus).toBe("APPROVED")
    expect((await asGeral.get(`/api/v1/best-practices/patterns/${resumeSynthetic.id}`)).body.data).toMatchObject({ available: false, unavailabilityReasons: [expect.stringMatching(/sintético/)] })
    const preview = (await asGeral.get(`/api/v1/best-practices/preview?datasetId=${datasetId}&operatorRef=SINT-OP-02&indicatorId=${tma}`)).body.data
    expect(preview.text).toMatch(/DADO SINTÉTICO/)
    expect(preview.items[0]).toMatchObject({ name: resumeSynthetic.name, youKind: "OFTEN" })

    // 2) REAL no Grupo A: o admin do Grupo B não pede; o do A pede; a nova análise vira versão 2 (sem duplicata, codificações reaproveitadas).
    const realBody = { origin: "REAL", teamId: teamA, indicatorDefinitionId: tma, referencePeriods: [SYNTHETIC_PERIOD], contextLevel: "SUB_REASON" }
    expect((await asAdminB.post("/api/v1/best-practices/analyses").send(realBody)).status).toBe(403)
    const simulated = { model: () => createSimulatedAnswerKeyModel(corpus, syntheticAnswerKeySchema.parse(dataset.answerKey)) }
    const realAnalyses: string[] = []
    for (let round = 0; round < 2; round += 1) {
      const created = await asAdminA.post("/api/v1/best-practices/analyses").send(realBody)
      expect(created.status).toBe(201)
      realAnalyses.push(created.body.data.id)
      expect(await processBestPracticeAnalyses(db, simulated)).toBe(1)
    }
    const realPatterns = (await asAdminA.get(`/api/v1/best-practices/patterns?origin=REAL&teamId=${teamA}&page=1&pageSize=20`)).body.data
    expect(realPatterns.items).toHaveLength(2)
    expect(realPatterns.items.every((item: { currentVersion: number }) => item.currentVersion === 2)).toBe(true)
    const reused = (await client.query<{ reused: number; total: number }>(`select count(*) filter (where reused_from_analysis_id is not null)::int reused, count(*)::int total from best_practice_call_codings where analysis_id = $1`, [realAnalyses[1]])).rows[0]!
    expect(reused.reused).toBeGreaterThan(reused.total * 0.9)
    const resume = realPatterns.items.find((item: { name: string }) => item.name.startsWith("Retomar"))
    const realDetail = (await asLeader.get(`/api/v1/best-practices/patterns/${resume.id}`)).body.data
    // A supervisora lidera os operadores: a evidência real tem o link para a chamada; a revisão registra a atualização da análise.
    expect(realDetail.evidence.some((item: { interactionId: string | null }) => item.interactionId !== null)).toBe(true)
    expect(realDetail.reviews.filter((review: { action: string }) => review.action === "ANALYSIS_UPDATE")).toHaveLength(2)
    // Aprovação pelo admin do Grupo (obrigação pendente exige a confirmação antes).
    if (realDetail.obligationStatus === "UNDETERMINED") {
      expect((await asAdminA.post(`/api/v1/best-practices/patterns/${resume.id}/review`).send({ action: "APPROVE" })).body.error.code).toBe("BEST_PRACTICE_OBLIGATION_PENDING")
      expect((await asAdminA.post(`/api/v1/best-practices/patterns/${resume.id}/review`).send({ action: "CONFIRM_NOT_OBLIGATION", reason: "Procedimentos revisados: retomar com resumo não é exigido." })).status).toBe(200)
    }
    expect((await asAdminA.post(`/api/v1/best-practices/patterns/${resume.id}/review`).send({ action: "APPROVE" })).body.data.reviewStatus).toBe("APPROVED")
    expect((await client.query(`select 1 from audit_logs where entity_id = $1 and action = 'BEST_PRACTICE_PATTERN_APPROVED'`, [resume.id])).rowCount).toBe(1)

    // 3) Diagnóstico: orientação relevante para o contexto e para a pessoa visível.
    const relevant = (await asLeader.get(`/api/v1/best-practices/relevant?indicatorId=${tma}&reason=Fatura&personId=${peopleByRef.get("SINT-OP-06")}`)).body.data
    expect(relevant).toHaveLength(1)
    expect(relevant[0]).toMatchObject({ name: resume.name, youKind: "SOMETIMES" })
    expect((await asLeader.get(`/api/v1/best-practices/relevant?indicatorId=${ura}&reason=Fatura`)).body.data).toEqual([])
    expect((await asLeader.get(`/api/v1/best-practices/relevant?indicatorId=${tma}&reason=Suporte técnico`)).body.data).toEqual([])

    // 4) Chat do operador: resultado + prática + evidência das chamadas DELE (Bruno: 2 de 3 em Fatura).
    const bruno = peopleByRef.get("SINT-OP-02")!
    const brunoAccount = await account(bruno)
    const user = { sub: brunoAccount.accountId, personId: bruno, organizationId: ORG, role: "OPERATOR", name: "Bruno Teste Proof", email: brunoAccount.email, avatarUrl: null, jobTitle: null, teamId: teamA, teamName: "Proof BP Grupo A" } as unknown as AuthTokenPayload
    const self = await loadSelfChatContext(db, user, { now: new Date("2026-10-20T12:00:00Z") })
    expect(self!.toolset.handles("my_best_practices")).toBe(true)
    const answer = await self!.toolset.execute("my_best_practices", { indicador: "TMA", motivo: "Fatura" })
    expect(answer.text).toMatch(/Retomar resumindo o que foi verificado/)
    expect(answer.text).toMatch(/Nas suas chamadas: Nas suas chamadas analisadas, o comportamento apareceu em 2 de 3/)
    expect(answer.text).toMatch(/nunca causa/)
    expect(answer.text).not.toMatch(/SINTÉTICO/)
    const none = await self!.toolset.execute("my_best_practices", { indicador: "NOTA_URA", motivo: "Fatura" })
    expect(none.text).toMatch(/ainda não tem boa prática aprovada e sustentada para Nota da Pesquisa na URA/)

    // 5) Feedback: seção montada pelo sistema; desativado some na leitura.
    const section = await buildFeedbackBestPractices(db, { organizationId: ORG, personId: bruno, domain: "INDICATOR", interactionId: null, indicators: [{ indicatorId: tma, periodStart: "2026-09-01", periodEnd: "2026-09-30" }] })
    expect(section?.items.map((item) => item.name)).toEqual([resume.name])
    expect((await withCurrentBestPractices(db, ORG, [{ bestPractices: section }]))[0]?.bestPractices).toEqual(section)
    expect((await asAdminA.post(`/api/v1/best-practices/patterns/${resume.id}/review`).send({ action: "DEACTIVATE" })).body.error.code).toBe("BEST_PRACTICE_REVIEW_REASON_REQUIRED")
    expect((await asAdminA.post(`/api/v1/best-practices/patterns/${resume.id}/review`).send({ action: "DEACTIVATE", reason: "Orientação em revisão pela qualidade." })).status).toBe(200)
    expect((await withCurrentBestPractices(db, ORG, [{ bestPractices: section }]))[0]?.bestPractices).toBeNull()
    expect((await self!.toolset.execute("my_best_practices", { indicador: "TMA", motivo: "Fatura" })).text).toMatch(/ainda não tem boa prática/)

    // 6) SUBGRUPO + SINAL DA CHAMADA (BEST_PRACTICE_ANALYSIS_V3 / BEST_PRACTICE_SELECTION_V1): o sinal só compara chamadas com o
    //    critério cadastrado; a análise do Subgrupo pelo sinal vira padrão do SINAL e do Subgrupo; o feedback de monitoria disparado
    //    pelo sinal traz a prática do subgrupo, dizendo de onde veio.
    const subteam = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof BP Célula') returning id", [ORG, teamA])).rows[0]!.id
    await client.query("update people set subteam_id = $1 where id = any($2::uuid[])", [subteam, [...peopleByRef.values()]])
    const flagBody = { channel: "VOICE", flagName: `proof_nota_ura_${Date.now()}`, valueType: "NUMERIC", label: "Nota Proof", callOutcome: { kind: "NUMERIC", good: { operator: "GTE", value: 3 }, bad: { operator: "LTE", value: 3 } } }
    expect((await asGeral.post("/api/v1/admin/channel-flags").send(flagBody)).status).toBe(400)
    expect((await asGeral.post("/api/v1/admin/channel-flags").send({ ...flagBody, callOutcome: { kind: "BOOLEAN", badValue: true } })).body.error.code).toBe("CHANNEL_FLAG_OUTCOME_TYPE")
    const flag = await asGeral.post("/api/v1/admin/channel-flags").send({ ...flagBody, callOutcome: { kind: "NUMERIC", good: { operator: "GTE", value: 4 }, bad: { operator: "LTE", value: 2 } }, relatedIndicatorId: ura })
    expect(flag.status).toBe(201)
    const flagId = flag.body.data.id as string
    for (const call of corpus.calls) {
      const value = call.signals?.nota_ura
      if (typeof value === "number") await client.query(`insert into interaction_flags (organization_id, interaction_id, channel_flag_id, value_numeric) select $1, id, $2, $3 from interactions where organization_id = $1 and external_id = $4`, [ORG, flagId, value, `PROOF-BP-${call.ref}`])
    }
    expect((await asLeader.get("/api/v1/best-practices/meta")).body.data.signals).toEqual(expect.arrayContaining([{ id: flagId, name: "Nota Proof", good: "Nota Proof ≥ 4", bad: "Nota Proof ≤ 2" }]))
    const signalBody = { origin: "REAL", teamId: teamA, subteamId: subteam, outcomeSource: "CALL_SIGNAL", channelFlagId: flagId, referencePeriods: [SYNTHETIC_PERIOD], contextLevel: "SUB_REASON" }
    expect((await asAdminB.post("/api/v1/best-practices/analyses").send(signalBody)).status).toBe(403)
    const signalAnalysis = await asAdminA.post("/api/v1/best-practices/analyses").send(signalBody)
    expect(signalAnalysis.status).toBe(201)
    expect(await processBestPracticeAnalyses(db, simulated)).toBe(1)
    const signalReport = (await asLeader.get(`/api/v1/best-practices/analyses/${signalAnalysis.body.data.id}`)).body.data
    expect(signalReport).toMatchObject({ status: "COMPLETED", outcome: "PATTERNS_FOUND" })
    expect(signalReport.report.population.label).toBe("Subgrupo Proof BP Célula (Grupo Proof BP Grupo A)")
    const signalPatterns = (await asAdminA.get(`/api/v1/best-practices/patterns?origin=REAL&subteamId=${subteam}&page=1&pageSize=20`)).body.data.items as { id: string; name: string; outcomeSource: string; channelFlagId: string; indicatorId: string | null; subteamName: string; obligationStatus: string }[]
    const adapt = signalPatterns.find((item) => item.name === "Explicar com as palavras do próprio cliente")!
    expect(adapt).toMatchObject({ outcomeSource: "CALL_SIGNAL", channelFlagId: flagId, indicatorId: null, subteamName: "Proof BP Célula", indicatorName: "Nota Proof" })
    if (adapt.obligationStatus === "UNDETERMINED") expect((await asAdminA.post(`/api/v1/best-practices/patterns/${adapt.id}/review`).send({ action: "CONFIRM_NOT_OBLIGATION", reason: "Adaptar o vocabulário não é exigido pelos procedimentos." })).status).toBe(200)
    expect((await asAdminA.post(`/api/v1/best-practices/patterns/${adapt.id}/review`).send({ action: "APPROVE" })).body.data.reviewStatus).toBe("APPROVED")
    const faturaCall = (await client.query<{ id: string; operator_id: string }>(`select i.id, i.operator_id from interactions i where i.organization_id = $1 and i.external_id like 'PROOF-BP-%' and i.reason = 'Fatura' order by i.external_id limit 1`, [ORG])).rows[0]!
    const monitoring = await buildFeedbackBestPractices(db, { organizationId: ORG, personId: faturaCall.operator_id, domain: "MONITORING", interactionId: faturaCall.id, signalFlagName: flagBody.flagName, indicators: [] })
    expect(monitoring?.items.map((item) => item.name)).toContain(adapt.name)
    expect(monitoring?.items.find((item) => item.name === adapt.name)?.source).toMatchObject({ population: "SUBGROUP", context: "SUB_REASON", outcomeKind: "CALL_SIGNAL", text: "Das chamadas de Cobrança proporcional com resultado bom em Nota Proof, no seu subgrupo (Proof BP Célula)." })
    // Feedback disparado por OUTRO sinal (sem prática e sem indicador relacionado): nada — nunca recua para o resultado de outro sinal.
    const other = await asGeral.post("/api/v1/admin/channel-flags").send({ channel: "VOICE", flagName: `proof_outro_${Date.now()}`, valueType: "BOOLEAN", callOutcome: { kind: "BOOLEAN", badValue: true } })
    expect(other.status).toBe(201)
    const otherFlagName = (await client.query<{ flag_name: string }>("select flag_name from channel_flags where id = $1", [other.body.data.id])).rows[0]!.flag_name
    expect(await buildFeedbackBestPractices(db, { organizationId: ORG, personId: faturaCall.operator_id, domain: "MONITORING", interactionId: faturaCall.id, signalFlagName: otherFlagName, indicators: [] })).toBeNull()
  })
})
