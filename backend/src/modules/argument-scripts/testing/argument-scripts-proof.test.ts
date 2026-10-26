/**
 * PROVA contra o banco de TESTE real — Argumentários: conversão do cadastro antigo (migration 105), administração por escopo pela API
 * real (sessão, permissão `configuration.manage`, "todos os grupos" só para quem administra a organização), rascunho → publicação →
 * versão imutável → vigência sem retroatividade → encerramento, seleção pelo motor (versão vigente NA DATA DA CHAMADA e escopo do
 * colaborador) e memória do motor com critério de argumentário e regra composta. ZERO chamada de modelo (as leituras são simuladas).
 * Tudo numa transação desfeita no fim (banco intacto).
 *   INIA_DB_PROOF=1 npx vitest run argument-scripts-proof
 */
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { projectTranscript } from "../../investigation/domain/transcript-projection.js"
import { verifyCallAnalysis, type ModelCallAnalysis } from "../../feedback-engine/domain/call-analysis.js"
import { buildProcedureContext } from "../../feedback-engine/domain/procedure.js"
import { createPostgresFeedbackMemoryStore } from "../../feedback-engine/infrastructure/postgres-feedback-memory-store.js"
import { loadArgumentScriptPromptLines, loadArgumentScriptsInForce } from "../infrastructure/argument-script-loaders.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
let client: pg.PoolClient

/** O store do motor abre a própria transação: aqui ela vira savepoint dentro da transação da prova (nunca um commit de fora). */
function savepointDb(connection: pg.PoolClient): Database {
  const proxy = { query: (sql: string, params?: unknown[]) => (sql === "begin" ? connection.query("savepoint memory_tx") : sql === "commit" ? connection.query("release savepoint memory_tx") : sql === "rollback" ? connection.query("rollback to savepoint memory_tx") : connection.query(sql, params)), release: () => undefined }
  return { query: (sql: string, params?: unknown[]) => connection.query(sql, params), connect: async () => proxy } as unknown as Database
}

describe.skipIf(!ENABLED)("Argumentários — prova Postgres (conversão, escopo, versões, vigência, motor, memória)", () => {
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

  it("cadastro antigo convertido sem inventar campos; a rota antiga só lê", async () => {
    const legacy = (await client.query<{ name: string; conversion: string; status: string; content: Record<string, unknown>; expectation: string; active: boolean; scope_type: string; ce_scope: string }>(
      `select s.name, s.conversion, s.status, v.content, ce.expectation, ce.active, s.scope_type, ce.scope_type ce_scope from argument_scripts s join call_expectations ce on ce.id = s.legacy_call_expectation_id join argument_script_versions v on v.script_id = s.id where s.organization_id = $1`,
      [ORG],
    )).rows
    const converted = (await client.query<{ n: number }>("select count(*)::int n from call_expectations where organization_id = $1", [ORG])).rows[0]!.n
    expect(legacy).toHaveLength(converted)
    for (const row of legacy) {
      expect(row).toMatchObject({ conversion: "LEGACY_UNSTRUCTURED", status: row.active ? "ACTIVE" : "ARCHIVED", scope_type: row.ce_scope })
      expect(row.content).toMatchObject({ trigger: null, requiredPoints: [], avoid: [], legacyExpectation: row.expectation, operatorGuidance: [expect.objectContaining({ modality: "UNSPECIFIED", text: row.expectation.trim() })] })
    }
  })

  it("escopo no backend (inclusive 'todos'), rascunho → publicação imutável → nova versão com vigência futura → encerramento; motor lê a versão da data da chamada", async () => {
    const operation = (await client.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const teamA = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof AG Grupo A') returning id", [ORG, operation])).rows[0]!.id
    const teamB = (await client.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof AG Grupo B') returning id", [ORG, operation])).rows[0]!.id
    const subA = (await client.query<{ id: string }>("insert into subteams (organization_id, team_id, name) values ($1, $2, 'Proof AG Sub A1') returning id", [ORG, teamA])).rows[0]!.id
    const domain = (await client.query<{ id: string }>("insert into business_domains (organization_id, code, name) values ($1, $2, 'Cobrança (prova)') returning id", [ORG, `PROOF_AG_${Date.now() % 100000}`])).rows[0]!.id
    const hash = await hashPassword("Proof@12345")
    let n = 0
    const person = async (teamId: string | null, subteamId: string | null, roleCode?: string, scope?: { type: string; teamId?: string }) => {
      n += 1
      const id = (await client.query<{ id: string }>("insert into people (organization_id, name, role, team_id, subteam_id) values ($1, $2, 'OPERATOR', $3, $4) returning id", [ORG, `Proof AG ${n}`, teamId, subteamId])).rows[0]!.id
      const email = `proof-ag-${n}-${Date.now()}@proof.inia.local`
      const accountId = (await client.query<{ id: string }>("insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id", [ORG, id, email, hash])).rows[0]!.id
      if (roleCode && scope) await client.query("insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, $3, $4, $5, now())", [ORG, accountId, roleCode, scope.type, scope.teamId ?? null])
      return { id, email }
    }
    const geral = await person(null, null, "ADMINISTRADOR_GERAL", { type: "ORGANIZATION" })
    const adminA = await person(teamA, null, "ADMINISTRADOR", { type: "GROUP", teamId: teamA })
    const nobody = await person(teamA, null)
    const operatorA = await person(teamA, subA)

    const app = createApp(client as never)
    const login = async (email: string) => {
      const agentHttp = request.agent(app)
      expect((await agentHttp.post("/api/v1/auth/login").send({ email, password: "Proof@12345" })).status).toBe(200)
      return agentHttp
    }
    const org = await login(geral.email)
    const area = await login(adminA.email)
    const none = await login(nobody.email)
    const base = "/api/v1/admin/argument-scripts"

    // Permissão e escopo (backend): sem papel = 403; admin de Grupo não escolhe "todos" nem outro Grupo; no próprio, cria.
    expect((await none.get(base)).status).toBe(403)
    expect((await area.get(`${base}/scope-options`)).body.data).toMatchObject({ allTeams: false, teamIds: [teamA] })
    const content = { trigger: "O cliente tem contas em atraso no momento da ligação.", operatorGuidance: [{ text: "Indicar o Vivo em Dia para consultar os valores em aberto.", modality: "MUST" }], requiredPoints: [{ mode: "ALL", items: [{ text: "Orientar o acesso ao Vivo em Dia e mencionar a consulta de débitos e o parcelamento.", condition: null }] }], avoid: [{ text: "Não garantir aprovação do parcelamento antes da consulta." }], suggestedScript: "Você pode acessar o Vivo em Dia…" }
    expect((await area.post(base).send({ name: "Contas em atraso (prova)", businessDomainId: domain, scope: { scopeType: "ALL_TEAMS" }, content })).body.error.code).toBe("ARGUMENT_SCRIPT_SCOPE_FORBIDDEN")
    expect((await area.post(base).send({ name: "Contas em atraso (prova)", businessDomainId: domain, scope: { scopeType: "TEAM", teamId: teamB }, content })).status).toBe(403)
    const created = await area.post(base).send({ name: "Contas em atraso (prova)", businessDomainId: domain, scope: { scopeType: "TEAM", teamId: teamA }, content })
    expect(created.status).toBe(201)
    const id = created.body.data.id as string
    expect(created.body.data).toMatchObject({ canEdit: true, draft: { version: 1, status: "DRAFT" }, current: null, draftIssues: [] })
    const keys = created.body.data.draft.content.operatorGuidance.map((item: { key: string }) => item.key)
    expect(keys[0]).toMatch(/^[0-9a-f]{12}$/)

    // Publicação nunca retroativa; publicada = imutável (gatilho no banco).
    expect((await area.post(`${base}/${id}/publish`).send({ effectiveFrom: new Date(Date.now() - 86_400_000).toISOString() })).body.error.code).toBe("ARGUMENT_SCRIPT_RETROACTIVE")
    const published = await area.post(`${base}/${id}/publish`).send({})
    expect(published.body.data).toMatchObject({ current: { version: 1, status: "PUBLISHED" }, draft: null })
    await client.query("savepoint immutability")
    await expect(client.query(`update argument_script_versions set content = '{}'::jsonb where script_id = $1 and version = 1`, [id])).rejects.toThrow(/imutável/)
    await client.query("rollback to savepoint immutability")
    expect((await area.patch(`${base}/${id}`).send({ scope: { scopeType: "TEAM", teamId: teamA } })).status).toBe(200)

    // Nova versão (o item editado mantém a chave) com vigência FUTURA: a anterior vale até ela começar.
    const editedContent = { ...content, operatorGuidance: [{ key: keys[0], text: "Indicar o Vivo em Dia para consultar valores em aberto e parcelamento.", modality: "MUST" }] }
    expect((await area.patch(`${base}/${id}`).send({ content: editedContent })).body.data.draft.version).toBe(2)
    const start = new Date(Date.now() + 3_600_000)
    const v2 = await area.post(`${base}/${id}/publish`).send({ effectiveFrom: start.toISOString() })
    expect(v2.body.data.current).toMatchObject({ version: 2 })
    expect(v2.body.data.history.map((version: { version: number; status: string }) => [version.version, version.status])).toEqual([[2, "PUBLISHED"], [1, "SUPERSEDED"]])
    expect(new Date(v2.body.data.history[1].effectiveUntil).getTime()).toBe(start.getTime())

    // Motor: versão vigente NA DATA DA CHAMADA, no escopo do colaborador (Grupo A + Subgrupo A1); outro Grupo não recebe.
    const inForce = async (at: Date, person: { teamId: string | null; subteamId: string | null }) => (await loadArgumentScriptsInForce(client, ORG, person, at)).filter((script) => script.scriptId === id).map((script) => script.version)
    expect(await inForce(new Date(), { teamId: teamA, subteamId: subA })).toEqual([1])
    expect(await inForce(new Date(start.getTime() + 60_000), { teamId: teamA, subteamId: subA })).toEqual([2])
    expect(await inForce(new Date(Date.now() - 86_400_000), { teamId: teamA, subteamId: subA })).toEqual([])
    expect(await inForce(new Date(), { teamId: teamB, subteamId: null })).toEqual([])
    const [source] = (await loadArgumentScriptsInForce(client, ORG, { teamId: teamA, subteamId: subA }, new Date(start.getTime() + 60_000))).filter((script) => script.scriptId === id)
    expect(source!.identities.get(keys[0])).toMatchObject({ basis: "MODIFIED" })

    // Regra da organização inteira: o admin de Grupo VÊ (vale para ele), mas não administra.
    const global = await org.post(base).send({ name: "Bloqueio após pagamento (prova)", businessDomainId: domain, scope: { scopeType: "ALL_TEAMS" }, content: { trigger: "O cliente diz que pagou e o serviço continua bloqueado.", requiredPoints: [{ mode: "ALL", items: [{ text: "Condicionar a orientação à disponibilidade da funcionalidade.", condition: null }] }] } })
    expect(global.status).toBe(201)
    const listed = (await area.get(`${base}?page=1&pageSize=50`)).body.data.items as { id: string; canEdit: boolean }[]
    expect(listed.find((item) => item.id === global.body.data.id)).toMatchObject({ canEdit: false })
    expect((await area.post(`${base}/${global.body.data.id}/archive`)).status).toBe(403)
    expect((await area.delete(`${base}/${global.body.data.id}`)).status).toBe(403)

    // Encerrar: deixa de valer agora; chamadas de antes continuam com a versão da época (história preservada, nada apagado).
    const archived = await area.post(`${base}/${id}/archive`)
    expect(archived.status).toBe(409)
    expect(archived.body.error.code).toBe("ARGUMENT_SCRIPT_NOT_STARTED")

    // Encerrar uma regra já em vigor: deixa de valer a partir de agora (a chamada de antes do encerramento continua com ela).
    const globalId = global.body.data.id as string
    expect((await org.post(`${base}/${globalId}/publish`).send({})).status).toBe(200)
    const beforeArchive = new Date()
    expect((await org.post(`${base}/${globalId}/archive`)).body.data).toMatchObject({ status: "ARCHIVED" })
    const globalAt = async (at: Date) => (await loadArgumentScriptsInForce(client, ORG, { teamId: teamB, subteamId: null }, at)).some((script) => script.scriptId === globalId)
    expect(await globalAt(new Date(Date.now() + 60_000))).toBe(false)
    expect(await globalAt(new Date(beforeArchive.getTime() - 1))).toBe(true)
    expect((await org.post(`${base}/${globalId}/reactivate`)).body.data).toMatchObject({ status: "ACTIVE", current: { version: 2 } })

    // Excluir: publicado e nunca usado por uma análise sai de vez — versões pela cascata (o gatilho de imutabilidade só deixa
    // por ela), conteúdo da última versão no audit_logs.
    expect((await org.delete(`${base}/${globalId}`)).status).toBe(204)
    expect((await client.query<{ n: number }>(`select count(*)::int n from argument_script_versions where script_id = $1`, [globalId])).rows[0]!.n).toBe(0)
    const deletedAudit = (await client.query<{ payload: Record<string, unknown> }>(`select payload from audit_logs where entity_id = $1 and action = 'ARGUMENT_SCRIPT_DELETED'`, [globalId])).rows[0]!
    expect(deletedAudit.payload).toMatchObject({ name: "Bloqueio após pagamento (prova)", lastVersion: { version: 2, status: "PUBLISHED" } })

    // Rota antiga só leitura; o caminho legado dos Agents lê argumentários (texto antigo preservado + resumo dos estruturados).
    expect((await org.post("/api/v1/admin/call-expectations").send({})).status).toBe(410)
    const promptLines = await loadArgumentScriptPromptLines(client, ORG, new Date(), { teamId: teamA, subteamId: subA })
    expect(promptLines.some((line) => line.expectation.startsWith('Argumentário "Contas em atraso (prova)"'))).toBe(true)
    // D3 (20/10/2026): argumentário do Grupo A nunca entra no prompt de quem avalia o Grupo B nem num Agent de todos os grupos.
    const otherGroupLines = await loadArgumentScriptPromptLines(client, ORG, new Date(), { teamId: teamB, subteamId: null })
    expect(otherGroupLines.some((line) => line.expectation.startsWith('Argumentário "Contas em atraso (prova)"'))).toBe(false)
    expect((await loadArgumentScriptPromptLines(client, ORG, new Date(), { teamId: null, subteamId: null })).some((line) => line.expectation.startsWith('Argumentário "Contas em atraso (prova)"'))).toBe(false)

    // Memória do motor: critério de ARGUMENTÁRIO + regra COMPOSTA persistidos com fonte, versão, aplicabilidade, onde acontece,
    // execução declarada e escopo considerado (leituras simuladas; integridade pelo código).
    const interaction = (await client.query<{ id: string }>("insert into interactions (organization_id, operator_id, channel, reason, started_at, ended_at, external_id) values ($1, $2, 'VOICE', 'Cobrança', now() - interval '5 minutes', now(), $3) returning id", [ORG, operatorA.id, `PROOF-AG-${Date.now()}`])).rows[0]!.id
    const transcript = ["Cliente: Estou com duas contas atrasadas.", "Operador: Já consultei aqui no sistema. Pelo Vivo em Dia você vê o que está em aberto e pode parcelar.", "Cliente: Obrigado.", "Operador: Até mais."].join("\n")
    const [script] = (await loadArgumentScriptsInForce(client, ORG, { teamId: teamA, subteamId: subA }, new Date())).filter((entry) => entry.scriptId === id)
    const context = buildProcedureContext([], [script!])
    const line = (text: string) => [...context.lines.values()].find((entry) => entry.text.includes(text))!.handle
    const T1 = { turn: "T1", speaker: "CLIENTE", quote: "Estou com duas contas atrasadas." }
    const T2a = { turn: "T2", speaker: "OPERADOR", quote: "Já consultei aqui no sistema." }
    const T2b = { turn: "T2", speaker: "OPERADOR", quote: "Pelo Vivo em Dia você vê o que está em aberto e pode parcelar." }
    const model: ModelCallAnalysis = {
      scenario: { customerNeed: "Regularizar contas em atraso", conditions: [{ text: "Contas em atraso", evidence: [T1] }], procedure: null, procedureRationale: null, pathSections: [], correctPath: "", pathTaken: "", pathAssessment: "UNDETERMINED", pathRationale: "", pathEvidence: [] },
      criteria: [
        { line: line("Orientar o acesso"), status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [T2b], opportunityTurn: null, rationale: "Paráfrase do ponto obrigatório.", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", applicability: "APPLIES", observability: "IN_CONVERSATION" },
        { line: line("Indicar o Vivo em Dia"), status: "PARTIAL", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [T2b], opportunityTurn: null, rationale: "x", materiality: "HIGH", guidance: null, whyItMatters: null, itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", applicability: "APPLIES", observability: "IN_CONVERSATION", obligations: [
          { part: "Indicar o Vivo em Dia", requiredAction: null, applicability: "APPLIES", condition: null, applicabilityEvidence: [], observability: "IN_CONVERSATION", evidenceNeeded: null, status: "MET", evidenceKind: "CONDUCT_OBSERVED", declaredActionTense: null, evidence: [T2b], opportunityTurn: null, rationale: "Indicou.", itemNature: "COMMUNICATION" },
          { part: "consultar os valores em aberto", requiredAction: null, applicability: "APPLIES", condition: null, applicabilityEvidence: [], observability: "OUTSIDE_CONVERSATION", evidenceNeeded: "registro do sistema", status: "MET", evidenceKind: "DECLARED_ACTION", declaredActionTense: "COMPLETED", evidence: [T2a], opportunityTurn: null, rationale: "Disse que consultou.", itemNature: "INTERNAL_ACTION" },
        ] },
      ],
      sectionDispositions: [],
      groupDispositions: [],
      sourceConflicts: [],
      limitations: [],
      contractViolations: [],
      argumentScripts: [{ script: "G1", applicability: "APPLIES", situation: "Contas em atraso", evidence: [T1], rationale: "Cliente disse." }],
    }
    const analysis = verifyCallAnalysis({ model, context, projection: projectTranscript(transcript), transcriptStatus: "COMPLETE", interactionId: interaction, subjectAnchoredDocumentIds: [], repairAttempted: false, review: { attempted: true, review: { claims: new Map([[line("Orientar o acesso"), { id: line("Orientar o acesso"), verdict: "CONFIRMED", issues: [], listReading: null, conditionEvidence: [T1], counterEvidence: [], note: null }], [`${line("Indicar o Vivo em Dia")}.1`, { id: `${line("Indicar o Vivo em Dia")}.1`, verdict: "CONFIRMED", issues: [], listReading: null, conditionEvidence: [T1], counterEvidence: [], note: null }]]), path: null, lines: [], exclusions: new Map(), violations: [] }, error: null } })
    const store = createPostgresFeedbackMemoryStore(savepointDb(client))
    const claim = await store.claimAnalysis({ organizationId: ORG, kind: "CALL_ANALYSIS", analysisKey: `proof-ag-${Date.now()}`, personId: operatorA.id, interactionId: interaction, indicatorDefinitionId: null, periodStart: null, periodEnd: null, agentId: null, trigger: { kind: "EVALUATION", selectionReason: "prova" }, logicVersion: analysis.logicVersion, asOf: new Date() }, new Date(), 300)
    if (claim.kind !== "CLAIMED") throw new Error("claim")
    const identities = new Map([...context.lines.values()].map((entry) => [entry.lineKey, { lineKey: entry.lineKey, criterionKey: entry.argument!.criterionKey, basis: entry.argument!.identityBasis, previousCriterionKey: entry.argument!.previousCriterionKey }]))
    await store.completeCallAnalysis(ORG, claim.runId, { snapshot: { interactionId: interaction, personId: operatorA.id, occurredAt: new Date(), timeZone: "America/Sao_Paulo", subjectRaw: "Cobrança", subjectCanonical: null, channel: "VOICE", teamId: teamA, subteamId: subA, supervisorId: null, transcriptChecksum: null, selectionReason: "prova" }, analysis, identities, documentVersions: new Map([[id, { version: script!.version, perspective: "RULE_IN_FORCE_AT_CALL" }]]), provenance: {}, metrics: {} }, new Date())
    const rows = (await client.query<{ criterion_key: string; status: string; source_kind: string; document_id: string | null; argument_script_id: string; argument_script_version: number; applicability: string | null; observability: string | null; execution_claim: string | null; parent_criterion_key: string | null; obligation: { part: string } | null; scope: Record<string, unknown> | null; verification: { confirmation: string } }>(
      `select criterion_key, status, source_kind, document_id, argument_script_id, argument_script_version, applicability, observability, execution_claim, parent_criterion_key, obligation, scope, verification from call_criterion_assessments where analysis_run_id = $1 order by criterion_text`,
      [claim.runId],
    )).rows
    expect(rows.every((row) => row.source_kind === "ARGUMENT_SCRIPT" && row.document_id === null && row.argument_script_id === id && row.argument_script_version === 1 && /^AG-[0-9a-f]{12}$/.test(row.criterion_key))).toBe(true)
    const byPart = new Map(rows.map((row) => [row.obligation?.part ?? "linha", row]))
    expect(byPart.get("consultar os valores em aberto")).toMatchObject({ status: "NOT_OBSERVABLE", observability: "OUTSIDE_CONVERSATION", execution_claim: "DECLARED" })
    expect(byPart.get("Indicar o Vivo em Dia")).toMatchObject({ status: "MET", observability: "IN_CONVERSATION", verification: expect.objectContaining({ confirmation: "CONFIRMED" }) })
    expect(byPart.get("Indicar o Vivo em Dia")!.parent_criterion_key).toBe(byPart.get("consultar os valores em aberto")!.parent_criterion_key)
    expect(byPart.get("linha")).toMatchObject({ status: "MET", applicability: "APPLIES", scope: expect.objectContaining({ collaboratorTeamId: teamA, collaboratorSubteamId: subA }) })
    const assessment = (await client.query<{ argument_scripts: { scriptId: string; applicability: string }[] }>("select argument_scripts from call_assessments where analysis_run_id = $1", [claim.runId])).rows[0]!
    expect(assessment.argument_scripts).toEqual([expect.objectContaining({ scriptId: id, applicability: "APPLIES" })])

    // Usado por uma análise = origem de feedbacks e diagnósticos: nunca se apaga (409); o caminho é desativar.
    const inUse = await area.delete(`${base}/${id}`)
    expect(inUse.status).toBe(409)
    expect(inUse.body.error.code).toBe("ARGUMENT_SCRIPT_IN_USE")
    expect((await client.query(`select 1 from argument_scripts where id = $1`, [id])).rowCount).toBe(1)
  })
})
