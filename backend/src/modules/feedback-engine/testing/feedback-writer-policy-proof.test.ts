import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { registerAiRuntime, runWithAiOrganization } from "../../../shared/application/model-routing/ai-runtime.js"
import { generateForRoute } from "../../../shared/application/model-routing/llm-gateway.js"
import { registerProviderAdapter, type AdapterRequest } from "../../../shared/application/model-routing/provider-adapter.js"
import { createAiRuntime } from "../../ai-management/application/ai-runtime-service.js"
import { toJsonSchema } from "../../ai-management/infrastructure/adapters/openai-chat-adapter.js"
import { startFakeOpenAiServer, type FakeServer } from "../../ai-management/testing/fake-openai-compatible-server.js"
import { FEEDBACK_WRITER_SYSTEM_PROMPT, feedbackWriterFingerprint } from "../../interaction-feedback/domain/feedback-writer-prompt.js"
import { callFeedbackWriterModel } from "../../interaction-feedback/infrastructure/gemini-feedback-writer.js"
import { composeFeedback } from "../application/compose-feedback.js"
import { STAGE_MAX_OUTPUT_TOKENS } from "../application/engine-meter.js"
import type { ModelCallMetric } from "../application/ports.js"
import { COHERENCE_SYSTEM_PROMPT, COMPOSITION_RESPONSE_SCHEMA, COMPOSITION_SYSTEM_PROMPT, VERIFICATION_RESPONSE_SCHEMA, VERIFICATION_SYSTEM_PROMPT } from "../domain/composition-prompt.js"
import { createGatewayEngineModel, ENGINE_MODEL } from "../infrastructure/gateway-engine-model.js"
import { analysis, briefOf, challenge, confirmAllClaims, line, T3, verified } from "./cancellation-case.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

/**
 * PROVA contra o banco de TESTE real: o Use Case FEEDBACK_WRITER (redação e verificação do feedback) roteado pela policy da
 * organização para um provider compatível com OpenAI — o servidor FALSO em 127.0.0.1 — e, sem policy, a rota fixa de sempre
 * (gemini-3.8-flash no motor, com um adapter Gemini FALSO no lugar do cliente real). ZERO chamada de IA paga ou real.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run feedback-writer-policy-proof
 *
 * O runtime, os adapters, a policy (criada pela API do admin), o limitador e o registro de uso são os de produção.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const SECRET = "sk-qa-writer-proof-0123456789abcdef"
const PREFIX = "QA Prova Redator · "
const WRITER_MODEL = "gpt-fake-writer"

/** Respostas roteirizadas pelo prompt de sistema — as MESMAS pelo legado falso e pelo provider falso. */
const DRAFT = {
  sentences: [
    { text: "No fechamento, você resumiu a contestação e o protocolo, mas não disse o que acontece com o pedido de cancelamento que estava aberto desde julho.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 },
    { text: "Antes de encerrar, diga à cliente qual é o próximo passo do pedido de cancelamento pendente, junto com o prazo da contestação.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 },
  ],
  card: { text: "Faltou dizer o próximo passo do cancelamento pendente.", refs: ["A1"] },
}
function scriptedReply(systemPrompt: string, userText: string): string | null {
  if (systemPrompt === COMPOSITION_SYSTEM_PROMPT) return JSON.stringify(DRAFT)
  if (systemPrompt === VERIFICATION_SYSTEM_PROMPT) {
    const claims = JSON.parse(userText.split("ITENS A CONFERIR (JSON):")[1]!) as { id: string; stance: string }[]
    return JSON.stringify({ verdicts: claims.map((claim) => ({ id: claim.id, verdict: "SUPPORTED", specific: ["GUIDANCE", "RECOGNITION", "ADJUSTMENT", "EXAMPLE"].includes(claim.stance) ? true : null })), message: { conveysPrimary: true, valueBeyondNarration: true }, lostInformation: [] })
  }
  if (systemPrompt === COHERENCE_SYSTEM_PROMPT) return JSON.stringify({ coherent: true, problems: [] })
  if (systemPrompt === FEEDBACK_WRITER_SYSTEM_PROMPT) return JSON.stringify({ items: [{ itemRef: "ITEM_1", observed: "Nesta conversa você apresentou um resumo do que foi combinado.", whyItMatters: "Isso pode ajudar o cliente a acompanhar os próximos passos.", whatYouCanDo: "Você pode repetir essa prática em conversas parecidas." }] })
  return null
}
const textOfMessage = (message: unknown) => (typeof message === "object" && message && "content" in message ? String((message as { content: unknown }).content ?? "") : "")

function caseBrief() {
  const model = analysis()
  return briefOf(verified(model, confirmAllClaims(model, [
    challenge(line("Próximo passo do pedido"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", listReading: "CUMULATIVE", conditionEvidence: [T3], opportunityTurn: "T6" }),
    challenge(line("Corrigir o status"), { proposedStatus: "NOT_MET", itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL", conditionEvidence: [T3], opportunityTurn: "T6" }),
    challenge(line("Serviço cancelado"), { proposedStatus: "NOT_OBSERVABLE", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", issues: ["DEPENDS_ON_INTERNAL_ACTION"], conditionEvidence: [T3], note: "Só vale se o cancelamento foi concluído — a conversa não mostra." }),
  ])))
}
const compose = () => runWithAiOrganization(ORG, async () => {
  const metrics: ModelCallMetric[] = []
  const result = await composeFeedback(createGatewayEngineModel(), caseBrief(), metrics, null)
  return { ...result, metrics }
})

let pool: pg.Pool
let api: ReturnType<typeof request.agent>
let fake: FakeServer
const legacyCalls: AdapterRequest[] = []
const models: Record<string, string> = {}
const startedAt = new Date()
const chatRequests = (model?: string) => fake.requests.filter((item) => item.path.endsWith("/chat/completions") && (!model || item.model === model))

async function cleanup() {
  const connections = await pool.query<{ id: string }>(`select id from ai_connections where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  const ids = connections.rows.map((row) => row.id)
  await pool.query(`delete from ai_usage_events where organization_id = $1 and use_case = 'FEEDBACK_WRITER' and occurred_at >= $2`, [ORG, startedAt])
  await pool.query(`delete from ai_routing_policies where organization_id = $1 and use_case = 'FEEDBACK_WRITER'`, [ORG])
  if (ids.length > 0) {
    await pool.query(`delete from ai_usage_events where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_model_pricing where model_id in (select id from ai_models where connection_id = any($1::uuid[]))`, [ids])
    await pool.query(`delete from ai_models where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_connections where id = any($1::uuid[])`, [ids])
  }
  await pool.query(`delete from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
}

async function usageSince(since: Date) {
  return (await pool.query<{ use_case: string; routing_mode: string; provider_key: string; model_name: string; status: string; call_priority: string | null }>(
    `select use_case, routing_mode, provider_key, model_name, status, call_priority from ai_usage_events where organization_id = $1 and use_case = 'FEEDBACK_WRITER' and occurred_at >= $2 order by id`,
    [ORG, since],
  )).rows
}

describe.skipIf(!ENABLED)("Feedback Writer pela policy da organização — prova contra o banco de teste (provider falso, zero IA paga)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    fake = await startFakeOpenAiServer({ apiKey: SECRET, respond: (body) => (body.model === WRITER_MODEL ? scriptedReply(textOfMessage((body.messages as unknown[])[0]), textOfMessage((body.messages as unknown[])[1])) : null) })
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    expect((await api.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    // Runtime real da organização (cache desligado) + adapter Gemini FALSO no caminho legado: nenhum request sai para o Gemini.
    registerAiRuntime(createAiRuntime(pool, { snapshotTtlMs: 0, spendTtlMs: 0, alertThrottleMs: 0 }))
    registerProviderAdapter({
      provider: "GEMINI",
      async generate(adapterRequest) {
        legacyCalls.push(adapterRequest)
        const user = adapterRequest.contents[0] && "text" in adapterRequest.contents[0] ? adapterRequest.contents[0].text : ""
        const text = scriptedReply(adapterRequest.systemPrompt, user)
        if (text === null) throw new Error("pedido inesperado ao legado")
        return { kind: "text", text, usage: { promptTokens: 100, outputTokens: 50, totalTokens: 150, cachedInputTokens: null, reasoningTokens: null }, durationMs: 2, model: adapterRequest.route.profile.model, provider: "GEMINI", finishReason: "STOP" }
      },
    })
  })

  afterAll(async () => {
    registerAiRuntime(null)
    await cleanup()
    await fake.close()
    await pool.end()
  })

  let legacyMessage = ""

  it("SEM policy: a composição e a verificação do motor saem pela rota fixa do Gemini (3.8 Flash, 120 s, zero retry) e nada vai ao provider OpenAI", async () => {
    const since = new Date()
    const { message, audit } = await compose()
    expect(audit.outcome).toBe("MESSAGE")
    legacyMessage = message!.text
    expect(legacyMessage).toContain("aberto desde julho")
    expect(chatRequests()).toHaveLength(0)
    expect(legacyCalls.length).toBeGreaterThanOrEqual(2)
    for (const call of legacyCalls) expect(call).toMatchObject({ structuredOutput: true, transport: { timeoutMs: 120_000, retries: 0 }, route: { profile: { provider: "GEMINI", model: ENGINE_MODEL } } })
    expect(legacyCalls[0]).toMatchObject({ systemPrompt: COMPOSITION_SYSTEM_PROMPT, responseSchema: COMPOSITION_RESPONSE_SCHEMA, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.COMPOSITION })
    expect(legacyCalls[1]).toMatchObject({ systemPrompt: VERIFICATION_SYSTEM_PROMPT, responseSchema: VERIFICATION_RESPONSE_SCHEMA, maxOutputTokens: STAGE_MAX_OUTPUT_TOKENS.VERIFICATION })
    const events = await usageSince(since)
    expect(events.length).toBe(legacyCalls.length)
    for (const event of events) expect(event).toMatchObject({ use_case: "FEEDBACK_WRITER", routing_mode: "LEGACY", provider_key: "GOOGLE_GENAI", model_name: ENGINE_MODEL, status: "SUCCESS" })
  })

  it("conexão OpenAI (endpoint do provider falso) + modelo SEM saída estruturada declarada: a policy FEEDBACK_WRITER não ativa", async () => {
    const created = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI", name: `${PREFIX}OpenAI`, baseUrl: fake.url, apiKey: SECRET, isLocal: false })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    for (const providerModelId of [WRITER_MODEL, "fake-down"]) {
      const model = await api.post("/api/v1/admin/ai/models").send({ connectionId: created.body.data.id, providerModelId, displayName: providerModelId })
      expect(model.status, JSON.stringify(model.body)).toBe(201)
      models[providerModelId] = model.body.data.id
    }
    const draft = await api.put("/api/v1/admin/ai/routing/FEEDBACK_WRITER/draft").send({ mode: "PINNED", modelIds: [models[WRITER_MODEL]] })
    expect(draft.status, JSON.stringify(draft.body)).toBe(200)
    const invalid = await api.post("/api/v1/admin/ai/routing/FEEDBACK_WRITER/activate")
    expect(invalid.status).toBe(422)
    expect(invalid.body.error.code).toBe("AI_POLICY_INVALID")
    for (const id of Object.values(models)) expect((await api.patch(`/api/v1/admin/ai/models/${id}`).send({ capabilities: { STRUCTURED_OUTPUT: { supported: true } } })).status).toBe(200)
  })

  it("COM policy PINNED: a composição e a verificação saem pela OpenAI falsa (json_schema da etapa, max_completion_tokens), a mesma mensagem, uso PINNED — o Gemini nem é chamado", async () => {
    const activated = await api.post("/api/v1/admin/ai/routing/FEEDBACK_WRITER/activate")
    expect(activated.status, JSON.stringify(activated.body)).toBe(200)
    const since = new Date()
    const legacyBefore = legacyCalls.length
    const { message, audit, metrics } = await compose()
    expect(audit.outcome).toBe("MESSAGE")
    expect(message!.text).toBe(legacyMessage)
    expect(legacyCalls.length).toBe(legacyBefore)
    expect(metrics.every((metric) => metric.model === WRITER_MODEL)).toBe(true)

    const sent = chatRequests(WRITER_MODEL)
    expect(sent.length).toBeGreaterThanOrEqual(2)
    const composition = sent.find((item) => textOfMessage((item.body.messages as unknown[])[0]) === COMPOSITION_SYSTEM_PROMPT)!
    const verification = sent.find((item) => textOfMessage((item.body.messages as unknown[])[0]) === VERIFICATION_SYSTEM_PROMPT)!
    expect(composition.body).toMatchObject({ response_format: { type: "json_schema", json_schema: { name: "inia_response", strict: false, schema: toJsonSchema(COMPOSITION_RESPONSE_SCHEMA) } }, max_completion_tokens: STAGE_MAX_OUTPUT_TOKENS.COMPOSITION })
    expect(verification.body).toMatchObject({ response_format: { type: "json_schema", json_schema: { schema: toJsonSchema(VERIFICATION_RESPONSE_SCHEMA) } }, max_completion_tokens: STAGE_MAX_OUTPUT_TOKENS.VERIFICATION })
    expect(composition.body).not.toHaveProperty("max_tokens")

    const events = await usageSince(since)
    expect(events.length).toBe(sent.length)
    for (const event of events) expect(event).toMatchObject({ use_case: "FEEDBACK_WRITER", routing_mode: "PINNED", provider_key: "OPENAI", model_name: WRITER_MODEL, status: "SUCCESS", call_priority: "BATCH" })
  })

  it("o redator (mesma chamada dos redatores do feedback confiável) também segue a policy, e a proveniência registra a rota", async () => {
    const before = chatRequests(WRITER_MODEL).length
    const result = await runWithAiOrganization(ORG, () => callFeedbackWriterModel(generateForRoute, { systemPrompt: FEEDBACK_WRITER_SYSTEM_PROMPT, buildUserTurn: () => "ENTRADA (JSON): {\"items\":[{\"itemRef\":\"ITEM_1\"}]}", expectedRefs: ["ITEM_1"], fingerprint: feedbackWriterFingerprint() }))
    expect(result.provenance).toMatchObject({ provider: "OPENAI", requestedModel: WRITER_MODEL, responseModel: WRITER_MODEL, route: { routingMode: "PINNED", providerKey: "OPENAI", connectionName: `${PREFIX}OpenAI`, modelName: WRITER_MODEL, fallbackAttempt: 0 }, validation: { status: "VALID", itemCount: 1 } })
    const sent = chatRequests(WRITER_MODEL).slice(before)
    expect(sent).toHaveLength(1)
    // Sem schema da etapa (o redator do piloto só pede JSON): modo JSON; sem teto de saída pedido, nenhum.
    expect(sent[0]!.body).toMatchObject({ response_format: { type: "json_object" } })
    expect(sent[0]!.body).not.toHaveProperty("max_completion_tokens")
  })

  it("COM policy: 503 do provider = UMA chamada só (a etapa pede retries 0 — nem o limitador nem o fallback repetem)", async () => {
    await api.put("/api/v1/admin/ai/routing/FEEDBACK_WRITER/draft").send({ mode: "PINNED", modelIds: [models["fake-down"]] })
    expect((await api.post("/api/v1/admin/ai/routing/FEEDBACK_WRITER/activate")).status).toBe(200)
    const before = chatRequests("fake-down").length
    const error = await runWithAiOrganization(ORG, () => createGatewayEngineModel().generate({ stage: "COMPOSITION", systemPrompt: COMPOSITION_SYSTEM_PROMPT, contents: [{ role: "user", text: "CASO (JSON): {}" }], responseSchema: COMPOSITION_RESPONSE_SCHEMA })).then(() => null, (caught: unknown) => caught)
    expect(error).toMatchObject({ code: expect.stringMatching(/^AI_/) })
    expect(chatRequests("fake-down").length).toBe(before + 1)
  })

  it("desativar a policy devolve a redação à rota fixa do Gemini, explicitamente", async () => {
    expect((await api.post("/api/v1/admin/ai/routing/FEEDBACK_WRITER/deactivate")).status).toBe(200)
    const legacyBefore = legacyCalls.length
    const openAiBefore = chatRequests().length
    const { message } = await compose()
    expect(message!.text).toBe(legacyMessage)
    expect(legacyCalls.length).toBeGreaterThan(legacyBefore)
    expect(chatRequests().length).toBe(openAiBefore)
  })

  it("a chave nunca aparece no uso nem na auditoria gravados pela prova", async () => {
    const events = await pool.query(`select * from ai_usage_events where organization_id = $1 and occurred_at >= $2`, [ORG, startedAt])
    const audit = await pool.query(`select * from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
    expect(JSON.stringify(events.rows) + JSON.stringify(audit.rows)).not.toContain(SECRET)
  })
})
