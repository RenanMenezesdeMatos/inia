import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * PROVA da PEN-017 — conferência das respostas contra as regras já cadastradas. Banco de teste real, API e motor reais; só o PROVEDOR DE IA é simulado,
 * na fronteira do gateway: nenhuma chamada paga. Cada canal é exercitado com violação, resposta permitida e falha da própria conferência.
 *
 *   INIA_DB_PROOF=1 npx vitest run response-compliance-proof
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const control = vi.hoisted(() => ({
  /** O que a conferência simulada responde. `null` = o provedor falha. */
  verdict: '{"verdict":"ALLOW","violated":[]}' as string | null,
  /** Vereditos para as próximas conferências, nesta ordem, antes de `verdict`. */
  verdictQueue: [] as string[],
  /** Vereditos da conferência do limite de atuação, que é uma chamada à parte. Sem nenhum aqui, vale `verdict`. */
  limitVerdicts: [] as string[],
  /** O que a IA simulada escreve (e o especialista). */
  answer: "Resposta gerada pela IA.",
  routes: [] as string[][],
  /** O que cada conferência recebeu. */
  checks: [] as { system: string; user: string }[],
  /** Instruções que chegaram à IA que responde. */
  prompts: [] as string[],
}))
vi.mock("../../../shared/application/model-routing/llm-gateway.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../shared/application/model-routing/llm-gateway.js")>()
  const usage = { inputTokens: 10, outputTokens: 10, totalTokens: 20, cachedInputTokens: 0, thinkingTokens: 0 }
  const reply = { usage, durationMs: 1, model: "simulado", cache: { cacheable: false, hit: false } }
  const simulated = async (gatewayRequest: { tools?: unknown[]; systemPrompt?: string; contents?: { text?: string }[]; structuredOutput?: boolean; classification?: { purpose?: string } }) => {
    const purpose = gatewayRequest.classification?.purpose
    if (purpose === "RESPONSE_COMPLIANCE") {
      control.checks.push({ system: gatewayRequest.systemPrompt ?? "", user: gatewayRequest.contents?.[0]?.text ?? "" })
      const isLimit = (gatewayRequest.systemPrompt ?? "").includes("dentro do que o agente atende")
      const verdict = isLimit ? (control.limitVerdicts.shift() ?? control.verdict) : (control.verdictQueue.shift() ?? control.verdict)
      if (verdict === null) throw new Error("provedor fora")
      return { kind: "text", text: verdict, ...reply }
    }
    if (purpose === "KNOWLEDGE_CLARIFICATION") return { kind: "text", text: JSON.stringify({ decision: "NOT_APPLICABLE" }), ...reply }
    control.prompts.push(JSON.stringify({ system: gatewayRequest.systemPrompt, contents: gatewayRequest.contents }))
    if (gatewayRequest.tools?.length) {
      const names = control.routes.shift()
      if (names) return { kind: "functionCalls", calls: names.map((name) => ({ name, args: { query: "Em quem votar?" } })), ...reply }
    }
    const structured = JSON.stringify({ title: "Título", summary: control.answer, impactedIndicator: "Não se aplica", evidenceFound: "Preciso da segunda via.", observedBehavior: "Orientou.", relatedProcedure: "Segunda via", recommendation: "Confirme o e-mail." })
    return { kind: "text", text: gatewayRequest.structuredOutput ? structured : control.answer, ...reply }
  }
  return { ...original, generateForRoute: simulated, streamForRoute: simulated }
})

const { env } = await import("../../../config/env.js")
const { createApp } = await import("../../../main/app.js")
const { setProofAccountPassword } = await import("../../auth/testing/proof-account-password.js")
const { processEnrollment } = await import("../../workflows/application/engine.js")
const { RESPONSE_BLOCKED_TEXT, RESPONSE_CHECK_UNAVAILABLE_TEXT, SPOKEN_VIOLATION_NOTICE, SPECIALIST_BLOCKED_TEXT } = await import("../domain/response-compliance.js")

const ORG = "00000000-0000-4000-8000-000000000001"
const PREFIX = "Prova Conferência · "
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const ACCOUNTS = {
  group: { email: "prova-conf-g@proof.inia.local", password: "Prova@12345" },
  operator: { email: "prova-conf-o@proof.inia.local", password: "Prova@12345" },
  otherOrg: { email: "prova-conf-x@proof.inia.local", password: "Prova@12345" },
}
const TOPIC = `${PREFIX}Eleições`
const BEHAVIOR = "Não opine sobre eleições: diga que esse assunto não é tratado aqui."
const GENERATED = "Vote no candidato X: é a minha opinião."
const VIOLATES = (ref: string, excerpt = "candidato X") => JSON.stringify({ verdict: "VIOLATION", violated: [ref], excerpt, reason: "A resposta opinou sobre eleições." })

let pool: pg.Pool
let admin: ReturnType<typeof request.agent>
let group: ReturnType<typeof request.agent>
let operator: ReturnType<typeof request.agent>
let otherOrgAdmin: ReturnType<typeof request.agent>
let teamA = ""
let owner = ""
let orchestratorId = ""
let specialist = ""
let limited = ""
let tools = new Map<string, string>()

async function cleanup() {
  const workflows = (await pool.query<{ id: string }>(`select id from workflows where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from workflow_outputs where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows])
  await pool.query(`delete from workflow_enrollment_events where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflows])
  await pool.query(`update workflow_enrollments set retry_of_enrollment_id = null, parent_enrollment_id = null where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_enrollments where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_manual_runs where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`update workflows set active_version_id = null where id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflow_versions where workflow_id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from workflows where id = any($1::uuid[])`, [workflows])
  await pool.query(`delete from assistant_orchestrators where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from transcripts where interaction_id in (select id from interactions where organization_id = $1 and external_id like 'PROVA-CONF-%')`, [ORG])
  await pool.query(`delete from interactions where organization_id = $1 and external_id like 'PROVA-CONF-%'`, [ORG])
  const agents = (await pool.query<{ id: string }>(`select id from agents where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])).rows.map((row) => row.id)
  const conversations = (await pool.query<{ id: string }>(`select c.id from assistant_conversations c join people p on p.id = c.owner_person_id where p.name like $1`, [`${PREFIX}%`])).rows.map((row) => row.id)
  await pool.query(`delete from response_compliance_checks where organization_id = $1 and (agent_id = any($2::uuid[]) or conversation_id = any($3::uuid[]) or flagged_content like '%candidato X%' or flagged_content = 'Resposta gerada pela IA.')`, [ORG, agents, conversations])
  await pool.query(`delete from assistant_interaction_agents where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`delete from assistant_interactions where conversation_id = any($1::uuid[])`, [conversations])
  await pool.query(`delete from assistant_conversations where id = any($1::uuid[])`, [conversations])
  await pool.query(`delete from agent_runs where agent_id = any($1::uuid[])`, [agents])
  await pool.query(`update agents set current_version_id = null where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from agents where id = any($1::uuid[])`, [agents])
  await pool.query(`delete from audit_logs where organization_id = $1 and entity_type = 'prohibited_topic' and payload->>'name' like $2`, [ORG, `${PREFIX}%`])
  await pool.query(`delete from prohibited_topics where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  const emails = Object.values(ACCOUNTS).map((account) => account.email)
  await pool.query(`delete from access_role_assignments where user_account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from auth_login_attempts where account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from auth_session_activity where account_id in (select id from user_accounts where email = any($1))`, [emails])
  await pool.query(`delete from user_accounts where email = any($1)`, [emails])
  await pool.query(`delete from personal_data_access_log where subject_person_id in (select id from people where name like $1)`, [`${PREFIX}%`])
  await pool.query(`delete from people where name like $1`, [`${PREFIX}%`])
  await pool.query(`delete from organizations where name like $1`, [`${PREFIX}%`])
}

async function publishedAgent(name: string, extra: Record<string, unknown> = {}) {
  const created = await admin.post("/api/v1/admin/agents").send({ name: `${PREFIX}${name}`, agentType: "CUSTOM", specialtyKind: "PERFORMANCE", objective: "Orientar.", description: "Agente da prova.", contextPrompt: "Contexto da prova.", scopeType: "TEAM", teamId: teamA, ...extra })
  expect(created.status, created.text).toBe(201)
  const id = created.body.data.id as string
  const published = await admin.post(`/api/v1/admin/agents/${id}/publish`).send({})
  expect(published.status, published.text).toBe(201)
  return id
}
const rowsOf = async (where: string, params: unknown[]) => (await pool.query<{ surface: string; control: string; outcome: string; action: string; rules: { kind: string; name: string }[]; flagged_content: string | null; error_code: string | null; interaction_id: string | null; agent_run_id: string | null }>(`select surface, control, outcome, action, rules, flagged_content, error_code, interaction_id, agent_run_id from response_compliance_checks where ${where} order by created_at`, params)).rows
const lastCheckRow = async (surface: string) => (await pool.query<{ control: string; outcome: string; action: string; rules: { kind: string; name: string }[]; flagged_content: string | null; error_code: string | null; interaction_id: string | null; agent_run_id: string | null; workflow_enrollment_id: string | null }>(`select control, outcome, action, rules, flagged_content, error_code, interaction_id, agent_run_id, workflow_enrollment_id from response_compliance_checks where organization_id = $1 and surface = $2 order by created_at desc limit 1`, [ORG, surface])).rows[0]!
const chat = async (conversationId: string | null = null) => {
  const response = await operator.post("/api/v1/realtime/messages").send({ conversationId, text: "Em quem votar?", clientMessageId: `prova-conf-${Date.now()}-${Math.random()}`.replace(/\./g, "") })
  expect(response.status, response.text).toBe(200)
  const shown = [...response.text.matchAll(/event: chunk\ndata: (.*)\n/g)].map((match) => (JSON.parse(match[1]!) as { text: string }).text).join("")
  const saved = (await pool.query<{ id: string; content: string; conversation_id: string }>(`select id, content, conversation_id from assistant_interactions where operator_id = $1 and role = 'assistant' order by created_at desc limit 1`, [owner])).rows[0]!
  return { raw: response.text, shown, saved }
}

describe.skipIf(!ENABLED)("PEN-017 — conferência das respostas (banco de teste real, provedor simulado)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    teamA = (await pool.query<{ id: string }>(`select id from teams where organization_id = $1 order by name limit 1`, [ORG])).rows[0]!.id
    const person = async (name: string, role: string, teamId: string | null, organizationId = ORG) => (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1,$2,$3,$4) returning id`, [organizationId, `${PREFIX}${name}`, role, teamId])).rows[0]!.id
    const account = async (email: string, personId: string, organizationId = ORG) => (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1,$2,$3,'x') returning id`, [organizationId, personId, email])).rows[0]!.id
    const grant = (organizationId: string, accountId: string, role: string, scope: string, teamId: string | null) => pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1,$2,$3,$4,$5,now())`, [organizationId, accountId, role, scope, teamId])
    await grant(ORG, await account(ACCOUNTS.group.email, await person("Admin do Grupo", "ADMIN", teamA)), "ADMINISTRADOR", "GROUP", teamA)
    owner = await person("Operador", "OPERATOR", teamA)
    await account(ACCOUNTS.operator.email, owner)
    const otherOrg = (await pool.query<{ id: string }>(`insert into organizations (name, slug) values ($1,$2) returning id`, [`${PREFIX}Outra organização`, `prova-conf-${Date.now()}`])).rows[0]!.id
    await grant(otherOrg, await account(ACCOUNTS.otherOrg.email, await person("Admin outra org", "ADMIN", null, otherOrg), otherOrg), "ADMINISTRADOR_GERAL", "ORGANIZATION", null)
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    for (const value of Object.values(ACCOUNTS)) await setProofAccountPassword(pool, value.email, value.password)
    const app = createApp(pool)
    admin = request.agent(app)
    group = request.agent(app)
    operator = request.agent(app)
    otherOrgAdmin = request.agent(app)
    expect((await admin.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    expect((await group.post("/api/v1/auth/login").send(ACCOUNTS.group)).status).toBe(200)
    expect((await operator.post("/api/v1/auth/login").send(ACCOUNTS.operator)).status).toBe(200)
    expect((await otherOrgAdmin.post("/api/v1/auth/login").send(ACCOUNTS.otherOrg)).status).toBe(200)
    // O cadastro é o de sempre: nada específico para a conferência.
    const topic = await admin.post("/api/v1/admin/prohibited-topics").send({ name: TOPIC, requiredBehavior: BEHAVIOR })
    expect(topic.status, topic.text).toBe(201)
    specialist = await publishedAgent("Especialista")
    limited = await publishedAgent("Especialista com limites", { actionLimitsEnabled: true, actionLimits: "Só faturamento.", specialtyKind: "CROSS_CUTTING", capability: "Faturamento." })
    const coordinator = await publishedAgent("Coordenador", { agentType: "ORCHESTRATOR", specialtyKind: undefined })
    const orchestrator = await admin.post("/api/v1/admin/assistant-orchestrators").send({ name: `${PREFIX}Orquestrador`, scopeType: "TEAM", teamId: teamA, orchestratorAgentId: coordinator, specialistAgentIds: [specialist, limited], invocationMode: "BOTH", routingPolicy: "OPEN" })
    expect(orchestrator.status, orchestrator.text).toBe(201)
    orchestratorId = orchestrator.body.data.id as string
    tools = new Map((await pool.query<{ agent_id: string; tool_name: string }>(`select agent_id, tool_name from assistant_orchestrator_specialists where orchestrator_id = $1`, [orchestratorId])).rows.map((row) => [row.agent_id, row.tool_name]))
  })
  afterAll(async () => {
    await cleanup()
    await pool.end()
  })
  beforeEach(() => {
    control.verdict = '{"verdict":"ALLOW","violated":[]}'
    control.answer = GENERATED
    control.routes = []
    control.verdictQueue = []
    control.limitVerdicts = []
    control.checks.length = 0
    control.prompts.length = 0
  })
  /** A regra da prova, com a referência que ela recebeu na conferência (a ordem depende dos outros assuntos do banco). */
  const refOfTopic = async () => {
    const topics = (await pool.query<{ name: string }>(`select name from prohibited_topics where organization_id = $1 and active order by name, id`, [ORG])).rows.map((row) => row.name)
    return `R${topics.indexOf(TOPIC) + 1}`
  }

  it("as regras chegam à IA pelo cadastro, nos dois lugares: na instrução de quem responde e na conferência", async () => {
    await chat()
    expect(control.prompts.some((prompt) => prompt.includes(TOPIC) && prompt.includes(BEHAVIOR))).toBe(true)
    const check = control.checks.at(-1)!
    expect(check.system).toContain(`${TOPIC}: ${BEHAVIOR}`)
    expect(check.user).toContain("<pergunta>\nEm quem votar?\n</pergunta>")
    expect(check.user).toContain(GENERATED)
    // Assunto inativo sai das duas, sem cadastro à parte.
    const id = (await pool.query<{ id: string }>(`select id from prohibited_topics where organization_id = $1 and name = $2`, [ORG, TOPIC])).rows[0]!.id
    await pool.query(`update prohibited_topics set active = false where id = $1`, [id])
    control.checks.length = 0
    await chat()
    expect(control.checks.at(-1)!.system).not.toContain(TOPIC)
    await pool.query(`update prohibited_topics set active = true where id = $1`, [id])
  })

  it("chat, violação: o texto gerado não sai nem fica na conversa; o registro guarda o original; monitoramento e Governança mostram", async () => {
    control.verdict = VIOLATES(await refOfTopic())
    const { raw, shown, saved } = await chat()
    expect(raw).not.toContain(GENERATED)
    // O provedor simulado escreveu o texto indevido: é a conferência que o barra, e não uma recusa do modelo. O progresso vem antes de qualquer texto.
    expect(control.answer).toBe(GENERATED)
    expect(raw.indexOf('"stage":"RESPONSE_CHECK"')).toBeGreaterThan(-1)
    expect(raw.indexOf('"stage":"RESPONSE_CHECK"')).toBeLessThan(raw.indexOf("event: chunk"))
    expect(shown).toBe(RESPONSE_BLOCKED_TEXT)
    expect(saved.content).toBe(RESPONSE_BLOCKED_TEXT)
    expect(await lastCheckRow("CHAT")).toMatchObject({ control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", rules: [{ kind: "PROHIBITED_TOPIC", name: TOPIC }], flagged_content: GENERATED, interaction_id: saved.id })
    // Quem audita a conversa vê o que aconteceu, com o texto original; quem conversa, não.
    const monitored = await admin.get(`/api/v1/admin/assistant-conversations/${saved.conversation_id}/messages`).query({ limit: 30 })
    expect(monitored.status, monitored.text).toBe(200)
    const message = (monitored.body.data.messages as { id: string; content: string; responseCheck?: unknown }[]).find((item) => item.id === saved.id)!
    expect(message.content).toBe(RESPONSE_BLOCKED_TEXT)
    expect(message.responseCheck).toMatchObject({ outcome: "VIOLATION", control: "PREVENTIVE", action: "BLOCKED", flaggedContent: GENERATED, rules: [{ name: TOPIC }] })
    const own = await operator.get(`/api/v1/realtime/conversations/${saved.conversation_id}/messages`)
    const ownMessage = (own.body.data.messages as { id: string; content: string; responseCheck?: unknown; toolCalls?: unknown }[]).find((item) => item.id === saved.id)!
    expect(ownMessage.content).toBe(RESPONSE_BLOCKED_TEXT)
    expect(ownMessage.responseCheck).toBeUndefined()
    expect(JSON.stringify(ownMessage)).not.toContain(GENERATED)
    // PEN-078: quem conversa não recebe o conteúdo barrado por caminho nenhum: nem o trecho apontado, nem o nome da regra.
    for (const restricted of ["candidato X", TOPIC]) {
      expect(raw).not.toContain(restricted)
      expect(JSON.stringify(ownMessage)).not.toContain(restricted)
    }
    // Registro da organização: só quem a alcança inteira; outra organização não vê nada.
    const list = await admin.get("/api/v1/admin/response-checks").query({ page: 1, pageSize: 50 })
    expect(list.status, list.text).toBe(200)
    expect((list.body.data.items as { flaggedContent: string }[]).some((item) => item.flaggedContent === GENERATED)).toBe(true)
    const summary = (await admin.get("/api/v1/admin/response-checks/summary")).body.data
    expect(summary.blocked).toBeGreaterThan(0)
    // Sem configuração, vale a prevenção.
    expect(summary.mode).toBe("ENFORCE")
    const groupOnly = await group.get("/api/v1/admin/response-checks").query({ page: 1, pageSize: 50 })
    expect(groupOnly.status).toBe(403)
    expect(groupOnly.body.error.code).toBe("ORGANIZATION_SCOPE_REQUIRED")
    expect((await group.get("/api/v1/admin/response-checks/summary")).status).toBe(403)
    expect((await operator.get("/api/v1/admin/response-checks").query({ page: 1, pageSize: 50 })).status).toBe(403)
    const other = await otherOrgAdmin.get("/api/v1/admin/response-checks").query({ page: 1, pageSize: 50 })
    expect(other.status).toBe(200)
    expect(other.body.data.items).toEqual([])
  })

  it("chat, violação: o texto barrado não volta ao contexto da IA no turno seguinte da mesma conversa", async () => {
    // Texto só deste cenário: os outros deixam respostas permitidas na mesma conversa.
    const barred = "Vote no candidato Z: texto barrado só neste turno."
    control.answer = barred
    control.verdict = VIOLATES(await refOfTopic(), "candidato Z")
    const { raw, saved } = await chat()
    expect(raw).not.toContain(barred)
    expect(saved.content).toBe(RESPONSE_BLOCKED_TEXT)
    control.verdict = '{"verdict":"ALLOW","violated":[]}'
    control.answer = "Resposta permitida do turno seguinte."
    control.prompts.length = 0
    await chat(saved.conversation_id)
    const prompts = control.prompts.join("\n")
    expect(prompts).toContain(RESPONSE_BLOCKED_TEXT)
    expect(prompts).not.toContain(barred)
  })

  it("chat, permitida: entrega o que a IA escreveu, sem guardar o texto no registro", async () => {
    const { shown, saved } = await chat()
    expect(shown).toBe(GENERATED)
    expect(saved.content).toBe(GENERATED)
    expect(await lastCheckRow("CHAT")).toMatchObject({ control: "PREVENTIVE", outcome: "ALLOWED", action: "DELIVERED", flagged_content: null, interaction_id: saved.id })
  })

  it("chat, a conferência falha (provedor fora, e fora do contrato): uma nova tentativa e, sem resposta, nada do texto sai", async () => {
    control.verdict = null
    const down = await chat()
    expect(down.raw).not.toContain(GENERATED)
    expect(down.shown).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    expect(control.checks).toHaveLength(2)
    expect(await lastCheckRow("CHAT")).toMatchObject({ outcome: "CHECK_FAILED", action: "BLOCKED", error_code: "RESPONSE_CHECK_PROVIDER_ERROR", flagged_content: GENERATED })
    control.verdict = "isto não é JSON"
    const invalid = await chat()
    expect(invalid.shown).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    expect(await lastCheckRow("CHAT")).toMatchObject({ outcome: "CHECK_FAILED", error_code: "RESPONSE_CHECK_INVALID_OUTPUT" })
    control.verdict = VIOLATES("R999")
    expect((await chat()).shown).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    control.verdict = VIOLATES(await refOfTopic(), "um trecho que a resposta não tem")
    expect((await chat()).shown).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    expect(await lastCheckRow("CHAT")).toMatchObject({ outcome: "CHECK_FAILED", error_code: "RESPONSE_CHECK_INVALID_OUTPUT" })
  })

  it("voz, especialista pelo servidor: conferido ANTES de voltar ao modelo de voz, nos três casos", async () => {
    const speak = (key: string) => operator.post("/api/v1/realtime/tool-call").send({ toolName: tools.get(specialist), query: "Em quem votar?", conversationId: null, turnId: `prova-conf-${key}-${Date.now()}`, callId: "chamada-1" })
    control.verdict = VIOLATES(await refOfTopic())
    const blocked = await speak("a")
    expect(blocked.status, blocked.text).toBe(200)
    expect(blocked.text).not.toContain(GENERATED)
    expect(blocked.text).not.toContain("candidato X")
    expect(blocked.text).not.toContain(TOPIC)
    expect(blocked.body.data.text).toBe(RESPONSE_BLOCKED_TEXT)
    expect(blocked.body.data.modelText).toContain("fale exatamente o texto acima")
    expect(await lastCheckRow("VOICE_TOOL")).toMatchObject({ control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", flagged_content: GENERATED, interaction_id: blocked.body.data.interactionId })
    control.verdict = '{"verdict":"ALLOW","violated":[]}'
    const allowed = await speak("b")
    expect(allowed.body.data.text).toBe(GENERATED)
    expect(await lastCheckRow("VOICE_TOOL")).toMatchObject({ outcome: "ALLOWED", action: "DELIVERED", flagged_content: null })
    control.verdict = null
    const failed = await speak("c")
    expect(failed.text).not.toContain(GENERATED)
    expect(failed.body.data.text).toBe(RESPONSE_CHECK_UNAVAILABLE_TEXT)
    expect(await lastCheckRow("VOICE_TOOL")).toMatchObject({ outcome: "CHECK_FAILED", action: "BLOCKED" })
  })

  it("voz, o que já foi falado: só DETECÇÃO; o texto sai da conversa, e o registro diz que chegou a ser falado", async () => {
    const voiceTurn = (body: Record<string, unknown>) => operator.post("/api/v1/realtime/voice-turn").send({ conversationId: null, turnId: `prova-conf-${Math.random()}`.replace(".", ""), ...body })
    control.verdict = VIOLATES(await refOfTopic())
    const flagged = await voiceTurn({ userText: "Em quem votar?", assistantText: GENERATED })
    expect(flagged.status, flagged.text).toBe(200)
    expect(flagged.body.data.responseCheck).toEqual({ outcome: "VIOLATION", notice: SPOKEN_VIOLATION_NOTICE })
    const row = await lastCheckRow("VOICE_SPOKEN")
    expect(row).toMatchObject({ control: "DETECTIVE", outcome: "VIOLATION", action: "RECORDED", flagged_content: GENERATED, interaction_id: flagged.body.data.assistantInteractionId })
    const saved = (await pool.query<{ content: string }>(`select content from assistant_interactions where id = $1`, [flagged.body.data.assistantInteractionId])).rows[0]!
    expect(saved.content).toBe(SPOKEN_VIOLATION_NOTICE)
    // Turno com especialista: a fala não vira mensagem, mas é conferida.
    const withSpecialist = await voiceTurn({ userText: "Em quem votar?", spokenText: `${GENERATED} (falado)` })
    expect(withSpecialist.body.data.responseCheck.notice).toBe(SPOKEN_VIOLATION_NOTICE)
    expect(withSpecialist.body.data.assistantInteractionId).toBeNull()
    expect(await lastCheckRow("VOICE_SPOKEN")).toMatchObject({ outcome: "VIOLATION", flagged_content: `${GENERATED} (falado)` })
    control.verdict = null
    const failed = await voiceTurn({ userText: "Oi", assistantText: "Olá, em que ajudo? candidato X" })
    expect(failed.body.data.responseCheck).toBeUndefined()
    expect(await lastCheckRow("VOICE_SPOKEN")).toMatchObject({ control: "DETECTIVE", outcome: "CHECK_FAILED", action: "RECORDED" })
  })

  it("especialista com limites: responde pelos limites dele antes de o orquestrador usar a resposta; sem limites, nenhuma conferência a mais", async () => {
    // O limite é conferido à parte, e é a única regra dessa chamada. A resposta final, que não tem esse limite, é permitida.
    control.limitVerdicts = [VIOLATES("R1", "frete")]
    control.routes = [[tools.get(limited)!]]
    const outOfLimit = "O frete do pedido é grátis, fora do que este especialista atende."
    control.answer = outOfLimit
    await chat()
    expect(await lastCheckRow("SPECIALIST")).toMatchObject({ control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", rules: [{ kind: "ACTION_LIMIT" }], flagged_content: outOfLimit })
    expect(control.checks.some((check) => check.system.includes("Só faturamento."))).toBe(true)
    // A síntese recebeu o aviso, e não o texto do especialista.
    const synthesis = control.prompts.at(-1)!
    expect(synthesis).toContain(SPECIALIST_BLOCKED_TEXT)
    expect(synthesis).not.toContain(outOfLimit)
    // Especialista sem limites: só a conferência da resposta final.
    control.checks.length = 0
    control.routes = [[tools.get(specialist)!]]
    await chat()
    expect(control.checks).toHaveLength(1)
  })

  it("execução de agente: violação interrompe e guarda a resposta rejeitada; permitida conclui; falha da conferência não entrega", async () => {
    const agent = await publishedAgent("Executor", { actionLimitsEnabled: true, actionLimits: "Só procedimentos." })
    const run = async () => {
      const response = await admin.post(`/api/v1/admin/agents/${agent}/test`).send({ input: "Em quem votar?", target: "VERSION" })
      expect(response.status, response.text).toBe(201)
      return (await pool.query<{ id: string; status: string; output_text: string | null; error_message: string | null }>(`select id, status, output_text, error_message from agent_runs where id = $1`, [response.body.data.id])).rows[0]!
    }
    control.verdict = VIOLATES(await refOfTopic())
    const blocked = await run()
    expect(blocked.status).toBe("FAILED")
    expect(blocked.error_message).toContain("bloqueada pela conferência")
    expect(blocked.error_message).toContain(TOPIC)
    expect(blocked.output_text).toContain("candidato X")
    expect(await lastCheckRow("AGENT_RUN")).toMatchObject({ control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", agent_run_id: blocked.id })
    expect(control.checks.at(-1)!.system).toContain("Só procedimentos.")
    control.verdict = '{"verdict":"ALLOW","violated":[]}'
    const allowed = await run()
    expect(allowed.status).toBe("COMPLETED")
    expect(await lastCheckRow("AGENT_RUN")).toMatchObject({ outcome: "ALLOWED", action: "DELIVERED", agent_run_id: allowed.id, flagged_content: null })
    control.verdict = null
    const failed = await run()
    expect(failed.status).toBe("FAILED")
    expect(failed.error_message).toContain("não pôde ser concluída")
    expect(await lastCheckRow("AGENT_RUN")).toMatchObject({ outcome: "CHECK_FAILED", action: "BLOCKED", agent_run_id: failed.id })
  })

  it("Workflow completo com orquestrador: violação encerra sem saída e sem nova tentativa; permitida conclui; falha da conferência volta para nova tentativa, sem saída", async () => {
    const position = { x: 0, y: 0 }
    const graph = {
      nodes: [
        { id: "trigger", type: "trigger", label: "Gatilho", position, config: {} },
        { id: "orch", type: "orchestrator", label: "Análise", position, config: { orchestratorId, instruction: "Analise a conversa." } },
        { id: "out", type: "output", label: "Recado", position, config: { target: { type: "CURRENT_OPERATOR" }, surfaces: ["INBOX"], source: "nodeOutputs.orch" } },
        { id: "end", type: "end", label: "Fim", position, config: {} },
      ],
      edges: [["trigger", "orch"], ["orch", "out"], ["out", "end"]].map(([source, target]) => ({ id: `${source}-${target}`, source, target, sourceHandle: "always" })),
    }
    const base = "/api/v1/admin/workflows"
    const workflow = await admin.post(base).send({ name: `${PREFIX}Workflow`, scopeType: "TEAM", teamId: teamA, trigger: { kind: "manual", context: "INTERACTION" } })
    expect(workflow.status, workflow.text).toBe(201)
    const workflowId = workflow.body.data.id as string
    expect((await admin.put(`${base}/${workflowId}/draft`).send({ graph })).status).toBe(200)
    const published = await admin.post(`${base}/${workflowId}/publish`).send({})
    expect(published.status, published.text).toBe(200)
    const call = async () => {
      const interaction = (await pool.query<{ id: string }>(`insert into interactions (organization_id, operator_id, reason, started_at, ended_at, external_id) values ($1,$2,'Segunda via',now() - interval '2 days',now() - interval '2 days' + interval '9 minutes',$3) returning id`, [ORG, owner, `PROVA-CONF-${Math.random()}`])).rows[0]!.id
      await pool.query(`insert into transcripts (organization_id, interaction_id, content) values ($1,$2,'OPERADOR: Bom dia. CLIENTE: Preciso da segunda via.')`, [ORG, interaction])
      return interaction
    }
    type Claimed = Parameters<typeof processEnrollment>[1]
    const claimed = async (id: string) => (await pool.query<Claimed>(
      `select we.id, we.organization_id, we.workflow_id, we.version_id, we.interaction_id, we.indicator_measurement_id, we.scheduled_subject_id, we.scheduled_for, we.current_node_id,
              we.matched_flag_name, we.matched_value_boolean, we.matched_value_numeric, we.status, we.attempts, we.revision, we.node_outputs, we.variables, we.parent_enrollment_id, we.retry_of_enrollment_id,
              w.scope_type, w.team_id workflow_team_id, w.subteam_id workflow_subteam_id, w.consolidated_structure, w.population_filter, now()::text claimed_until
         from workflow_enrollments we join workflows w on w.id = we.workflow_id where we.id = $1`,
      [id],
    )).rows[0]!
    const stateOf = async (id: string) => (await pool.query<{ status: string; current_node_id: string; attempts: number }>(`select status, current_node_id, attempts from workflow_enrollments where id = $1`, [id])).rows[0]!
    const run = async (key: string) => {
      const started = await admin.post(`${base}/${workflowId}/manual-runs`).send({ collaboratorId: owner, interactionId: await call(), idempotencyKey: `prova-conf-${key}-${Date.now()}` })
      expect(started.status, started.text).toBe(201)
      const id = (await pool.query<{ id: string }>(`select id from workflow_enrollments where manual_run_id = $1`, [started.body.data.run.id])).rows[0]!.id
      for (let step = 0; step < 6; step += 1) {
        const before = await stateOf(id)
        if (before.status !== "active") break
        await processEnrollment(pool, await claimed(id))
        const after = await stateOf(id)
        if (after.attempts > before.attempts) break
      }
      return { id, state: await stateOf(id), outputs: (await pool.query(`select 1 from workflow_outputs where enrollment_id = $1`, [id])).rows.length, events: (await pool.query<{ event_type: string; payload: { errorCode?: string; willRetry?: boolean } }>(`select event_type, payload from workflow_enrollment_events where enrollment_id = $1 order by created_at`, [id])).rows }
    }
    control.verdict = VIOLATES(await refOfTopic())
    control.routes = [[tools.get(specialist)!]]
    const blocked = await run("violacao")
    expect(blocked.outputs).toBe(0)
    expect(blocked.state.status).not.toBe("completed")
    expect(blocked.events.find((event) => event.event_type === "flow_dead")?.payload).toMatchObject({ errorCode: "RESPONSE_BLOCKED_BY_RULES", willRetry: false })
    expect(await lastCheckRow("WORKFLOW_ORCHESTRATOR")).toMatchObject({ control: "PREVENTIVE", outcome: "VIOLATION", action: "BLOCKED", workflow_enrollment_id: blocked.id })
    control.verdict = '{"verdict":"ALLOW","violated":[]}'
    control.routes = [[tools.get(specialist)!]]
    const allowed = await run("permitida")
    expect(allowed.state.status).toBe("completed")
    expect(allowed.outputs).toBe(1)
    expect(await lastCheckRow("WORKFLOW_ORCHESTRATOR")).toMatchObject({ outcome: "ALLOWED", action: "DELIVERED", workflow_enrollment_id: allowed.id })
    control.verdict = null
    control.routes = [[tools.get(specialist)!]]
    const failed = await run("falha")
    expect(failed.outputs).toBe(0)
    expect(failed.state).toMatchObject({ status: "active", current_node_id: "orch", attempts: 1 })
    expect(await lastCheckRow("WORKFLOW_ORCHESTRATOR")).toMatchObject({ outcome: "CHECK_FAILED", action: "BLOCKED", workflow_enrollment_id: failed.id })
  })

  it("desligado por configuração: confere nada e registra nada; em AUDIT, entrega e só detecta", async () => {
    const before = await rowsOf(`organization_id = $1 and surface = 'CHAT'`, [ORG])
    vi.stubEnv("INIA_RESPONSE_CHECK", "OFF")
    control.verdict = VIOLATES(await refOfTopic())
    expect((await chat()).shown).toBe(GENERATED)
    expect(control.checks).toEqual([])
    expect(await rowsOf(`organization_id = $1 and surface = 'CHAT'`, [ORG])).toHaveLength(before.length)
    expect((await admin.get("/api/v1/admin/response-checks/summary")).body.data.mode).toBe("OFF")
    vi.stubEnv("INIA_RESPONSE_CHECK", "AUDIT")
    expect((await admin.get("/api/v1/admin/response-checks/summary")).body.data.mode).toBe("AUDIT")
    const audited = await chat()
    expect(audited.raw).toContain(GENERATED)
    expect(audited.raw).toContain("event: retract")
    expect(audited.saved.content).toBe(SPOKEN_VIOLATION_NOTICE)
    expect(await lastCheckRow("CHAT")).toMatchObject({ control: "DETECTIVE", outcome: "VIOLATION", action: "RECORDED", flagged_content: GENERATED })
    vi.unstubAllEnvs()
  })
})
