import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { hashPassword } from "../../auth/infrastructure/password-hasher.js"
import { registerAiRuntime, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { registerProviderAdapter } from "../../../shared/application/model-routing/provider-adapter.js"
import { createAiRuntime } from "../application/ai-runtime-service.js"
import { startFakeOpenAiServer, type FakeServer } from "./fake-openai-compatible-server.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

const textOf = (response: { kind: string; text?: string }) => (response.kind === "text" ? response.text : "")

/**
 * PROVA DE PONTA A PONTA — AI Providers V1, contra o banco de TESTE real e um provider FALSO em
 * 127.0.0.1 (nenhuma API real/paga é chamada; o cliente legado Gemini é substituído por um fake).
 *
 *   INIA_DB_PROOF=1 npx vitest run ai-providers-proof
 *
 * Cobre (§97, §98): segredo criptografado e nunca devolvido/logado/auditado; teste de conexão;
 * descoberta; PINNED; FALLBACK_CHAIN com rate limit; AUTH e INVALID_REQUEST sem fallback; conexão e
 * modelo desabilitados não rodam (sem troca silenciosa); policy inválida não ativa; hard limit;
 * legado quando não há policy; custo decimal com versão de preço; isolamento entre organizações;
 * permissões do admin de grupo; exclusão bloqueada por dependência.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ORG_B = "0b0b0b0b-0000-4000-8000-00000000ab01"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const SCOPED = { email: "qa.ai.scoped@inia.local", password: "Inia@QA-123" }
const SECRET = "sk-qa-proof-SECRET-VALUE-0123456789"
const PREFIX = "QA Prova IA · "

let pool: pg.Pool
let api: ReturnType<typeof request.agent>
let fake: FakeServer
let connectionId = ""
const models: Record<string, string> = {}
const startedAt = new Date()

async function cleanup() {
  const connections = await pool.query<{ id: string }>(`select id from ai_connections where name like $1`, [`${PREFIX}%`])
  const ids = connections.rows.map((row) => row.id)
  await pool.query(`delete from ai_usage_events where organization_id = any($1::uuid[]) and occurred_at >= $2`, [[ORG, ORG_B], startedAt])
  await pool.query(`delete from ai_routing_policies where organization_id = any($1::uuid[])`, [[ORG, ORG_B]])
  await pool.query(`delete from ai_budgets where organization_id = any($1::uuid[])`, [[ORG, ORG_B]])
  if (ids.length > 0) {
    await pool.query(`delete from ai_model_pricing where model_id in (select id from ai_models where connection_id = any($1::uuid[]))`, [ids])
    await pool.query(`delete from ai_models where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_connections where id = any($1::uuid[])`, [ids])
  }
  await pool.query(`delete from alerts where alert_type = 'AI_BUDGET_THRESHOLD' and created_at >= $1`, [startedAt])
  await pool.query(`delete from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
  await pool.query(`delete from user_accounts where email = $1`, [SCOPED.email])
  await pool.query(`delete from people where organization_id = $1 and name = $2`, [ORG, `${PREFIX}Admin de grupo`])
  await pool.query(`delete from organizations where id = $1`, [ORG_B])
}

async function execute(purpose: "AGENT_SYNTHESIS" | "SPECIALIST_SYNTHESIS", source: "AGENT" | "SPECIALIST" = "AGENT") {
  return runWithAiOrganization(ORG, () =>
    generateForRoute({ classification: { phase: "SYNTHESIS", purpose, source, semanticType: "TEXT" }, systemPrompt: "Prova", contents: [{ role: "user", text: "Olá" }], structuredOutput: purpose === "AGENT_SYNTHESIS", route: routeFor({ purpose, phase: "SYNTHESIS" }, "CURRENT") }),
  )
}

async function activate(useCase: string, body: Record<string, unknown>) {
  const draft = await api.put(`/api/v1/admin/ai/routing/${useCase}/draft`).send(body)
  expect(draft.status, JSON.stringify(draft.body)).toBe(200)
  return api.post(`/api/v1/admin/ai/routing/${useCase}/activate`)
}

const legacyCalls: string[] = []

describe.skipIf(!ENABLED)("AI Providers V1 — prova contra o banco de teste (provider falso, zero API paga)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    fake = await startFakeOpenAiServer({ apiKey: SECRET })
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    const login = await api.post("/api/v1/auth/login").send(ADMIN)
    expect(login.status).toBe(200)
    // Runtime do gateway (cache desligado) + cliente legado FALSO: nenhum request sai para o Gemini real.
    registerAiRuntime(createAiRuntime(pool, { snapshotTtlMs: 0, spendTtlMs: 0, alertThrottleMs: 0 }))
    registerProviderAdapter({
      provider: "GEMINI",
      async generate(request) {
        legacyCalls.push(request.route.profile.model)
        return { kind: "text", text: "resposta legada (fake)", usage: { promptTokens: 50, outputTokens: 5, totalTokens: 55, cachedInputTokens: null, reasoningTokens: null }, durationMs: 2, model: request.route.profile.model, provider: "GEMINI" }
      },
    })
  })

  afterAll(async () => {
    registerAiRuntime(null)
    await cleanup()
    await fake.close()
    await pool.end()
  })

  it("cria a conexão sem ENV; a chave vai criptografada e NUNCA volta (API, lista, banco, auditoria)", async () => {
    const created = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI_COMPATIBLE", name: `${PREFIX}Fake`, baseUrl: fake.url, apiKey: SECRET, isLocal: false })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    connectionId = created.body.data.id
    expect(created.body.data.credential).toEqual({ configured: true, maskedValue: "••••••••6789", updatedAt: expect.any(String) })
    expect(JSON.stringify(created.body)).not.toContain(SECRET)
    const list = await api.get("/api/v1/admin/ai/connections")
    const detail = await api.get(`/api/v1/admin/ai/connections/${connectionId}`)
    expect(JSON.stringify(list.body) + JSON.stringify(detail.body)).not.toContain(SECRET)
    const stored = await pool.query<{ ciphertext: Buffer }>(`select ciphertext from ai_connection_secrets where connection_id = $1 and revoked_at is null`, [connectionId])
    expect(stored.rows[0]!.ciphertext.toString("utf8")).not.toContain("SECRET-VALUE")
    const audit = await pool.query<{ payload: unknown }>(`select payload from audit_logs where entity_id = $1`, [connectionId])
    expect(audit.rows.length).toBeGreaterThan(0)
    expect(JSON.stringify(audit.rows)).not.toContain(SECRET)
  })

  it("testar conexão: CONNECTED com a chave certa; AUTH_ERROR com a errada (mensagem segura, sem ecoar a chave)", async () => {
    const ok = await api.post(`/api/v1/admin/ai/connections/${connectionId}/test`)
    expect(ok.body.data).toMatchObject({ status: "CONNECTED", latencyMs: expect.any(Number) })
    const wrong = "sk-qa-WRONG-KEY-000000000000"
    await api.put(`/api/v1/admin/ai/connections/${connectionId}/secret`).send({ apiKey: wrong })
    const denied = await api.post(`/api/v1/admin/ai/connections/${connectionId}/test`)
    expect(denied.body.data.status).toBe("AUTH_ERROR")
    expect(JSON.stringify(denied.body)).not.toContain(wrong)
    const replaced = await api.put(`/api/v1/admin/ai/connections/${connectionId}/secret`).send({ apiKey: SECRET })
    expect(JSON.stringify(replaced.body)).not.toContain(SECRET)
    const revoked = await pool.query(`select 1 from ai_connection_secrets where connection_id = $1 and revoked_at is not null`, [connectionId])
    expect(revoked.rowCount).toBe(2)
  })

  it("sincroniza modelos (capacidades desconhecidas até o admin declarar) e cadastra preço versionado", async () => {
    const sync = await api.post(`/api/v1/admin/ai/connections/${connectionId}/sync-models`)
    expect(sync.body.data).toMatchObject({ discovered: 8, created: 8 })
    const list = await api.get(`/api/v1/admin/ai/models?connectionId=${connectionId}`)
    for (const model of list.body.data as { id: string; providerModelId: string; capabilities: unknown }[]) {
      models[model.providerModelId] = model.id
      expect(model.capabilities).toEqual({})
    }
    for (const id of Object.values(models)) {
      const patched = await api.patch(`/api/v1/admin/ai/models/${id}`).send({ capabilities: { STRUCTURED_OUTPUT: { supported: true } } })
      expect(patched.body.data.capabilities.STRUCTURED_OUTPUT).toEqual({ supported: true, source: "MANUAL" })
    }
    const priced = await api.post(`/api/v1/admin/ai/models/${models["fake-ok"]}/pricing`).send({ currency: "USD", inputPerMillion: "1", cachedInputPerMillion: "0.1", outputPerMillion: "4", effectiveFrom: new Date(Date.now() - 60_000).toISOString() })
    expect(priced.status, JSON.stringify(priced.body)).toBe(201)
    const overlap = await api.post(`/api/v1/admin/ai/models/${models["fake-ok"]}/pricing`).send({ currency: "USD", inputPerMillion: "9", outputPerMillion: "9", effectiveFrom: new Date(Date.now() - 3_600_000).toISOString() })
    expect(overlap.body.error.code).toBe("AI_PRICING_OVERLAP")
  })

  it("sem policy: o Use Case segue pelo LEGADO (zero troca silenciosa) e o uso é registrado", async () => {
    const response = await execute("AGENT_SYNTHESIS")
    expect(textOf(response)).toBe("resposta legada (fake)")
    expect(legacyCalls).toHaveLength(1)
    const event = await pool.query(`select routing_mode, use_case, provider_key from ai_usage_events where organization_id = $1 and occurred_at >= $2 order by id desc limit 1`, [ORG, startedAt])
    expect(event.rows[0]).toMatchObject({ routing_mode: "LEGACY", use_case: "AGENT_RESPONSE", provider_key: "GOOGLE_GENAI" })
  })

  it("policy inválida não ativa (Tools obrigatórias no planejamento, modelo sem a capacidade declarada)", async () => {
    const invalid = await activate("INVESTIGATION_PLANNING", { mode: "PINNED", modelIds: [models["fake-ok"]] })
    expect(invalid.status).toBe(422)
    expect(invalid.body.error.code).toBe("AI_POLICY_INVALID")
    await api.delete("/api/v1/admin/ai/routing/INVESTIGATION_PLANNING/draft")
  })

  it("PINNED: testar roteamento não chama o provider; a execução usa o modelo fixado e grava custo decimal com a versão do preço", async () => {
    expect((await activate("AGENT_RESPONSE", { mode: "PINNED", modelIds: [models["fake-ok"]] })).status).toBe(200)
    const before = fake.requests.length
    const test = await api.post("/api/v1/admin/ai/routing/AGENT_RESPONSE/test").send({})
    expect(test.body.data).toMatchObject({ source: "ACTIVE", selected: { providerModelId: "fake-ok", reason: "PINNED" } })
    expect(fake.requests.length).toBe(before)
    const response = await execute("AGENT_SYNTHESIS")
    expect(textOf(response)).toContain("provider falso")
    expect(response.resolvedRoute).toMatchObject({ requestedUseCase: "AGENT_RESPONSE", routingMode: "PINNED", modelName: "fake-ok", routeReason: "PINNED" })
    const event = await pool.query<{ cost: string; currency: string; cost_status: string; pricing_id: string | null; input_tokens: number; cached_tokens: number; reasoning_tokens: number }>(`select cost::text, currency, cost_status, pricing_id, input_tokens, cached_tokens, reasoning_tokens from ai_usage_events where organization_id = $1 and model_id = $2 order by id desc limit 1`, [ORG, models["fake-ok"]])
    // (1000 não cacheados × 1 + 200 cacheados × 0,1 + 300 × 4) / 1 milhão = 0,00222 USD — exato, sem float
    expect(event.rows[0]).toMatchObject({ cost: "0.002220000000", currency: "USD", cost_status: "ESTIMATED", input_tokens: 1200, cached_tokens: 200, reasoning_tokens: 50 })
    expect(event.rows[0]!.pricing_id).not.toBeNull()
  })

  it("FALLBACK_CHAIN: rate limit cai para o próximo com o MESMO correlation id; AUTH e INVALID_REQUEST não fazem fallback", async () => {
    expect((await activate("SPECIALIST_RESPONSE", { mode: "FALLBACK_CHAIN", modelIds: [models["fake-rate-limited"], models["fake-ok"]] })).status).toBe(200)
    const response = await execute("SPECIALIST_SYNTHESIS", "SPECIALIST")
    expect(response.resolvedRoute).toMatchObject({ modelName: "fake-ok", fallbackAttempt: 1, fallbackReason: "FALLBACK_RATE_LIMIT" })
    const events = await pool.query<{ status: string; error_category: string | null; fallback_index: number; correlation_id: string }>(`select status, error_category, fallback_index, correlation_id from ai_usage_events where organization_id = $1 and use_case = 'SPECIALIST_RESPONSE' order by id desc limit 2`, [ORG])
    const [second, first] = events.rows
    expect(first).toMatchObject({ status: "ERROR", error_category: "RATE_LIMIT", fallback_index: 0 })
    expect(second).toMatchObject({ status: "SUCCESS", fallback_index: 1 })
    expect(first!.correlation_id).toBe(second!.correlation_id)

    for (const failing of ["fake-unauthorized", "fake-bad-request"]) {
      expect((await activate("SPECIALIST_RESPONSE", { mode: "FALLBACK_CHAIN", modelIds: [models[failing], models["fake-ok"]] })).status).toBe(200)
      const calledBefore = fake.requests.filter((item) => item.model === "fake-ok").length
      await expect(execute("SPECIALIST_SYNTHESIS", "SPECIALIST")).rejects.toMatchObject({ code: failing === "fake-unauthorized" ? "AI_AUTH" : "AI_INVALID_REQUEST" })
      expect(fake.requests.filter((item) => item.model === "fake-ok").length).toBe(calledBefore)
    }
  })

  it("conexão desabilitada não roda: erro claro, nunca troca silenciosa para o legado", async () => {
    await api.patch(`/api/v1/admin/ai/connections/${connectionId}`).send({ enabled: false })
    const legacyBefore = legacyCalls.length
    await expect(execute("AGENT_SYNTHESIS")).rejects.toMatchObject({ code: "AI_ROUTE_UNAVAILABLE" })
    expect(legacyCalls.length).toBe(legacyBefore)
    await api.patch(`/api/v1/admin/ai/connections/${connectionId}`).send({ enabled: true })
  })

  it("modelo desabilitado: exige confirmação; a policy ativa aparece inválida e a execução falha claramente", async () => {
    const blocked = await api.patch(`/api/v1/admin/ai/models/${models["fake-ok"]}`).send({ enabled: false })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe("AI_MODEL_IN_USE_ACTIVE")
    await api.patch(`/api/v1/admin/ai/models/${models["fake-ok"]}`).send({ enabled: false, acknowledgeActivePolicyImpact: true })
    const routing = await api.get("/api/v1/admin/ai/routing")
    const agent = routing.body.data.find((item: { useCase: { key: string } }) => item.useCase.key === "AGENT_RESPONSE")
    expect(agent.active.valid).toBe(false)
    await expect(execute("AGENT_SYNTHESIS")).rejects.toMatchObject({ code: "AI_ROUTE_UNAVAILABLE" })
    await api.patch(`/api/v1/admin/ai/models/${models["fake-ok"]}`).send({ enabled: true })
  })

  it("hard limit do orçamento bloqueia chamada paga com AI_BUDGET_EXCEEDED, registra o bloqueio e avisa no Sino", async () => {
    const budget = await api.post("/api/v1/admin/ai/budgets").send({ scope: "GLOBAL", currency: "USD", monthlyAmount: "0.000001", hardLimit: true })
    expect(budget.status, JSON.stringify(budget.body)).toBe(201)
    expect(budget.body.data[0].evaluation).toMatchObject({ status: "EXCEEDED", hardLimitReached: true })
    await expect(execute("AGENT_SYNTHESIS")).rejects.toMatchObject({ code: "AI_BUDGET_EXCEEDED" })
    // Conexão LOCAL não tem custo de API: o hard limit não a bloqueia.
    await api.patch(`/api/v1/admin/ai/connections/${connectionId}`).send({ isLocal: true })
    expect(textOf(await execute("AGENT_SYNTHESIS"))).toContain("provider falso")
    await api.patch(`/api/v1/admin/ai/connections/${connectionId}`).send({ isLocal: false })
    const blocked = await pool.query(`select 1 from ai_usage_events where organization_id = $1 and status = 'BLOCKED' and error_category = 'BUDGET_EXCEEDED'`, [ORG])
    expect(blocked.rowCount).toBeGreaterThan(0)
    const alerts = await pool.query(`select 1 from alerts where organization_id = $1 and alert_type = 'AI_BUDGET_THRESHOLD' and created_at >= $2`, [ORG, startedAt])
    expect(alerts.rowCount).toBeGreaterThan(0)
    await api.delete(`/api/v1/admin/ai/budgets/${budget.body.data[0].id}`)
  })

  it("desativar a policy devolve o Use Case ao legado explicitamente", async () => {
    await api.post("/api/v1/admin/ai/routing/AGENT_RESPONSE/deactivate")
    const before = legacyCalls.length
    expect(textOf(await execute("AGENT_SYNTHESIS"))).toBe("resposta legada (fake)")
    expect(legacyCalls.length).toBe(before + 1)
  })

  it("uso LEGADO é precificado pela tabela da organização (mesmo provider + id do modelo) — rota inalterada; cadastro ambíguo = sem preço", async () => {
    const legacyModel = routeFor({ purpose: "AGENT_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT").profile.model
    const gemini = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "GOOGLE_GENAI", name: `${PREFIX}Gemini`, baseUrl: fake.url, apiKey: "AIza-qa-proof-000000000000", isLocal: false })
    expect(gemini.status, JSON.stringify(gemini.body)).toBe(201)
    const model = await api.post("/api/v1/admin/ai/models").send({ connectionId: gemini.body.data.id, providerModelId: legacyModel, displayName: "Legado da prova" })
    expect(model.status, JSON.stringify(model.body)).toBe(201)
    // Gemini informa o raciocínio FORA da saída (thoughtsTokenCount) e o cobra ao preço de saída.
    await api.post(`/api/v1/admin/ai/models/${model.body.data.id}/pricing`).send({ currency: "USD", inputPerMillion: "0.25", outputPerMillion: "1.5", reasoningPerMillion: "1.5", cachedInputPerMillion: "0.025", effectiveFrom: new Date(Date.now() - 60_000).toISOString() })
    const before = legacyCalls.length
    expect(textOf(await execute("AGENT_SYNTHESIS"))).toBe("resposta legada (fake)")
    expect(legacyCalls.length).toBe(before + 1)
    const priced = await pool.query(`select routing_mode, cost::text, currency, cost_status, pricing_source, pricing_id from ai_usage_events where organization_id = $1 and occurred_at >= $2 order by id desc limit 1`, [ORG, startedAt])
    // 50 × 0,25/1M + 5 × 1,5/1M (fake legado)
    expect(priced.rows[0]).toMatchObject({ routing_mode: "LEGACY", cost_status: "ESTIMATED", pricing_source: "TABLE", currency: "USD" })
    expect(Number(priced.rows[0].cost)).toBeCloseTo(0.00002, 10)
    const twin = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "GOOGLE_GENAI", name: `${PREFIX}Gemini 2`, baseUrl: fake.url, apiKey: "AIza-qa-proof-111111111111", isLocal: false })
    await api.post("/api/v1/admin/ai/models").send({ connectionId: twin.body.data.id, providerModelId: legacyModel })
    await execute("AGENT_SYNTHESIS")
    const ambiguous = await pool.query(`select cost, cost_status, pricing_source from ai_usage_events where organization_id = $1 and occurred_at >= $2 order by id desc limit 1`, [ORG, startedAt])
    expect(ambiguous.rows[0]).toMatchObject({ cost: null, cost_status: "UNKNOWN", pricing_source: "NONE" })
  })

  it("exclusão de conexão usada por policy é bloqueada com as dependências", async () => {
    const response = await api.delete(`/api/v1/admin/ai/connections/${connectionId}`)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe("AI_CONNECTION_IN_USE")
  })

  it("dashboard agrega por provider/modelo/Use Case com custo por moeda (sem conversão)", async () => {
    const overview = await api.get("/api/v1/admin/ai/overview?period=TODAY")
    const usage = overview.body.data.usage
    expect(usage.totals.requests).toBeGreaterThan(0)
    expect(usage.totals.costByCurrency.USD).toBeDefined()
    expect(usage.byUseCase.map((row: { key: string }) => row.key)).toEqual(expect.arrayContaining(["AGENT_RESPONSE", "SPECIALIST_RESPONSE"]))
    expect(usage.byProvider.map((row: { key: string }) => row.key)).toEqual(expect.arrayContaining(["OPENAI_COMPATIBLE", "GOOGLE_GENAI"]))
    expect(usage.byModel.some((row: { label: string }) => row.label === "fake-ok")).toBe(true)
    expect(JSON.stringify(overview.body)).not.toContain(SECRET)
  })

  it("isolamento: nada da organização B é visível, alterável, testável, roteável ou somado pela organização A", async () => {
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'QA Org B', 'qa-org-b-ai-proof')`, [ORG_B])
    const connB = await pool.query<{ id: string }>(`insert into ai_connections (organization_id, provider_key, name, base_url) values ($1, 'OPENAI', $2, 'https://api.openai.com/v1') returning id`, [ORG_B, `${PREFIX}Org B`])
    const idB = connB.rows[0]!.id
    const modelB = await pool.query<{ id: string }>(`insert into ai_models (organization_id, connection_id, provider_model_id, display_name) values ($1, $2, 'gpt-b', 'Modelo B') returning id`, [ORG_B, idB])
    await pool.query(`insert into ai_usage_events (organization_id, occurred_at, use_case, origin, provider_key, model_name, correlation_id, cost, currency, cost_status, pricing_source, status, routing_mode, route_reason) values ($1, now(), 'AGENT_RESPONSE', 'RUNTIME', 'OPENAI', 'gpt-b', gen_random_uuid(), 999, 'USD', 'ESTIMATED', 'TABLE', 'SUCCESS', 'PINNED', 'PINNED')`, [ORG_B])
    const list = await api.get("/api/v1/admin/ai/connections")
    expect(list.body.data.map((item: { id: string }) => item.id)).not.toContain(idB)
    expect((await api.get(`/api/v1/admin/ai/connections/${idB}`)).status).toBe(404)
    expect((await api.patch(`/api/v1/admin/ai/connections/${idB}`).send({ enabled: false })).status).toBe(404)
    expect((await api.post(`/api/v1/admin/ai/connections/${idB}/test`)).status).toBe(404)
    expect((await api.put(`/api/v1/admin/ai/connections/${idB}/secret`).send({ apiKey: "sk-qa-x-12345678" })).status).toBe(404)
    expect((await api.get(`/api/v1/admin/ai/models/${modelB.rows[0]!.id}`)).status).toBe(404)
    expect((await api.put("/api/v1/admin/ai/routing/CHAT/draft").send({ mode: "PINNED", modelIds: [modelB.rows[0]!.id] })).status).toBe(404)
    const usage = await api.get("/api/v1/admin/ai/usage?period=TODAY")
    expect(Number(usage.body.data.totals.costByCurrency.USD ?? "0")).toBeLessThan(999)
  })

  it("admin de GRUPO: só leitura (sem gravar conexão, segredo, roteamento ou orçamento)", async () => {
    const team = await pool.query<{ id: string }>(`select id from teams where organization_id = $1 limit 1`, [ORG])
    const person = await pool.query<{ id: string }>(`insert into people (organization_id, name, role, active) values ($1, $2, 'ADMIN', true) returning id`, [ORG, `${PREFIX}Admin de grupo`])
    const account = await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, $4) returning id`, [ORG, person.rows[0]!.id, SCOPED.email, await hashPassword(SCOPED.password)])
    // V1.5.7: "admin de grupo" = papel ADMINISTRADOR com escopo de Grupo (modelo geral de acesso), não mais people.role + user_role_assignments.
    await pool.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, team_id, granted_at) values ($1, $2, 'ADMINISTRADOR', 'GROUP', $3, now())`, [ORG, account.rows[0]!.id, team.rows[0]!.id])
    const scoped = request.agent(createApp(pool))
    expect((await scoped.post("/api/v1/auth/login").send(SCOPED)).status).toBe(200)
    expect((await scoped.get("/api/v1/admin/ai/me")).body.data.permissions).toEqual(["AI_CONFIG_READ", "AI_USAGE_READ"])
    expect((await scoped.get("/api/v1/admin/ai/connections")).status).toBe(200)
    expect((await scoped.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI", name: `${PREFIX}x`, apiKey: "sk-qa-1234567890" })).status).toBe(403)
    expect((await scoped.put(`/api/v1/admin/ai/connections/${connectionId}/secret`).send({ apiKey: "sk-qa-1234567890" })).status).toBe(403)
    expect((await scoped.put("/api/v1/admin/ai/routing/CHAT/draft").send({ mode: "PINNED", modelIds: [] })).status).toBe(403)
    expect((await scoped.post("/api/v1/admin/ai/budgets").send({ scope: "GLOBAL", currency: "USD", monthlyAmount: "1" })).status).toBe(403)
  })

  it("trocar o endereço da conexão revoga a chave guardada — ela nunca segue para o host novo (achado A-F12)", async () => {
    const created = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI_COMPATIBLE", name: `${PREFIX}Endpoint troca`, baseUrl: fake.url, apiKey: SECRET, isLocal: false })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string
    // Mesmo host, outro caminho: a chave continua.
    const samePath = await api.patch(`/api/v1/admin/ai/connections/${id}`).send({ baseUrl: `${fake.url}/v1` })
    expect(samePath.body.data.credential.configured).toBe(true)
    // Outro host: a chave guardada é revogada e precisa ser cadastrada de novo.
    const moved = await api.patch(`/api/v1/admin/ai/connections/${id}`).send({ baseUrl: "https://outro-servidor.example/v1" })
    expect(moved.status).toBe(200)
    expect(moved.body.data.credential.configured).toBe(false)
    const active = await pool.query(`select 1 from ai_connection_secrets where connection_id = $1 and revoked_at is null`, [id])
    expect(active.rowCount).toBe(0)
    const audit = await pool.query<{ action: string }>(`select action from audit_logs where entity_id = $1 and action = 'AI_CONNECTION_SECRET_REVOKED'`, [id])
    expect(audit.rowCount).toBe(1)
  })

  it("trocar o endereço e revogar a chave é um commit só: quem lê nunca vê o host novo com a chave antiga ativa (achado N01 da 4ª auditoria)", async () => {
    const created = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI_COMPATIBLE", name: `${PREFIX}Endpoint atômico`, baseUrl: fake.url, apiKey: SECRET, isLocal: false })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const id = created.body.data.id as string
    const NEW_HOST = "https://outro-servidor-atomico.example/v1"
    // Lê como a execução: primeiro a conexão, depois a chave ativa.
    const read = async () => {
      const connection = await pool.query<{ base_url: string }>(`select base_url from ai_connections where id = $1`, [id])
      const secret = await pool.query(`select 1 from ai_connection_secrets where connection_id = $1 and revoked_at is null`, [id])
      return connection.rows[0]!.base_url === NEW_HOST && (secret.rowCount ?? 0) > 0
    }
    let mixed = 0
    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect((await api.patch(`/api/v1/admin/ai/connections/${id}`).send({ baseUrl: fake.url })).status).toBe(200)
      expect((await api.put(`/api/v1/admin/ai/connections/${id}/secret`).send({ apiKey: SECRET })).status).toBe(200)
      // Lê sem parar enquanto a troca está em andamento (duas leitoras, como requisições simultâneas).
      let done = false
      const move = api.patch(`/api/v1/admin/ai/connections/${id}`).send({ baseUrl: NEW_HOST }).then((response) => ((done = true), response))
      const reader = async () => {
        while (!done) if (await read()) mixed += 1
      }
      const [moved] = await Promise.all([move, reader(), reader()])
      expect(moved.status).toBe(200)
    }
    expect(mixed).toBe(0)
  }, 60_000)

  it("o segredo não apareceu em nenhum evento de uso nem em auditoria gravados pela prova", async () => {
    const events = await pool.query(`select * from ai_usage_events where organization_id = $1 and occurred_at >= $2`, [ORG, startedAt])
    const audit = await pool.query(`select * from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
    expect(JSON.stringify(events.rows) + JSON.stringify(audit.rows)).not.toContain(SECRET)
  })
})
