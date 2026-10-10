import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

/**
 * PROVA contra o banco de TESTE real: a "Voz do recado do avatar" (Use Case SPEECH_SYNTHESIS) pela policy da organização, pela
 * rota HTTP de sempre (`GET /api/v1/inia-deliveries/avatar/:id/audio`, sessão real, cache real). Sem policy: a composição de sempre
 * (voz da conversa conferida + TTS de reserva) com os clientes Gemini FALSOS; com policy: o provider OpenAI FALSO em 127.0.0.1
 * (`/v1/audio/speech`) com a voz e a instrução de tom cadastradas no modelo. ZERO chamada de IA paga ou real.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run speech-synthesis-policy-proof
 */
const legacy = vi.hoisted(() => ({ live: [] as string[], tts: [] as string[] }))
vi.mock("../infrastructure/gemini-live-speech-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../infrastructure/gemini-live-speech-client.js")>()
  const { INIA_LIVE_MODEL, iniaVoiceName } = await import("../../../config/inia-voice.js")
  return { ...original, speakWithGeminiLive: async ({ text }: { text: string }) => (legacy.live.push(text), { pcm16: Buffer.alloc(2_400, 1), sampleRate: 24_000, model: INIA_LIVE_MODEL, voice: iniaVoiceName(), transcript: text, usage: null }) }
})
vi.mock("../infrastructure/gemini-tts-client.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../infrastructure/gemini-tts-client.js")>()
  return { ...original, synthesizeSpeechWithGemini: async ({ text }: { text: string }) => (legacy.tts.push(text), { pcm16: Buffer.alloc(2_400, 2), sampleRate: 24_000, model: "gemini-tts-fake", voice: "Kore", usage: null }) }
})

const { env } = await import("../../../config/env.js")
const { INIA_LIVE_MODEL, iniaVoiceName } = await import("../../../config/inia-voice.js")
const { createApp } = await import("../../../main/app.js")
const { registerAiRuntime } = await import("../../../shared/application/model-routing/ai-runtime.js")
const { createAiRuntime } = await import("../../ai-management/application/ai-runtime-service.js")
const { speechCacheModelKey } = await import("../../ai-management/domain/ai-speech.js")
const { FAKE_SPEECH_PCM, startFakeOpenAiServer } = await import("../../ai-management/testing/fake-openai-compatible-server.js")

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const SECRET = "sk-qa-speech-proof-0123456789abcdef"
const PREFIX = "QA Prova Voz · "
const TEXT = "Oi, Carla! Seu recado de hoje: confirme a data de nascimento antes de enviar a segunda via."
const TONE = "Fale como uma supervisora calorosa e animada, em português do Brasil."

let pool: pg.Pool
let api: ReturnType<typeof request.agent>
let fake: Awaited<ReturnType<typeof startFakeOpenAiServer>>
const created = { workflow: "", version: "", enrollment: "", output: "", connection: "", model: "" }
const startedAt = new Date()
const speechRequests = () => fake.requests.filter((item) => item.path.endsWith("/audio/speech"))
const audio = () => api.get(`/api/v1/inia-deliveries/avatar/${created.output}/audio`).buffer(true).parse((response, done) => {
  const chunks: Buffer[] = []
  response.on("data", (chunk: Buffer) => chunks.push(chunk))
  response.on("end", () => done(null, Buffer.concat(chunks)))
})
const stored = async () => (await pool.query<{ voice_name: string; model: string; audio: Buffer }>(`select voice_name, model, audio from workflow_output_speech_audio where output_id = $1`, [created.output])).rows[0]
const usageSince = async (since: Date) => (await pool.query<{ routing_mode: string; provider_key: string; model_name: string; status: string; cost_status: string }>(`select routing_mode, provider_key, model_name, status, cost_status from ai_usage_events where organization_id = $1 and use_case = 'SPEECH_SYNTHESIS' and occurred_at >= $2 order by id`, [ORG, since])).rows

async function cleanup() {
  const connections = await pool.query<{ id: string }>(`select id from ai_connections where organization_id = $1 and name like $2`, [ORG, `${PREFIX}%`])
  const ids = connections.rows.map((row) => row.id)
  await pool.query(`delete from ai_usage_events where organization_id = $1 and use_case = 'SPEECH_SYNTHESIS' and occurred_at >= $2`, [ORG, startedAt])
  await pool.query(`delete from ai_routing_policies where organization_id = $1 and use_case = 'SPEECH_SYNTHESIS'`, [ORG])
  if (ids.length > 0) {
    await pool.query(`delete from ai_usage_events where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_model_pricing where model_id in (select id from ai_models where connection_id = any($1::uuid[]))`, [ids])
    await pool.query(`delete from ai_models where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_connections where id = any($1::uuid[])`, [ids])
  }
  await pool.query(`delete from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
  const workflows = await pool.query<{ id: string }>(`select id from workflows where organization_id = $1 and name = $2`, [ORG, `${PREFIX}Workflow`])
  const workflowIds = workflows.rows.map((row) => row.id)
  if (workflowIds.length > 0) {
    await pool.query(`delete from workflow_outputs where enrollment_id in (select id from workflow_enrollments where workflow_id = any($1::uuid[]))`, [workflowIds])
    await pool.query(`delete from workflow_enrollments where workflow_id = any($1::uuid[])`, [workflowIds])
    await pool.query(`delete from workflow_versions where workflow_id = any($1::uuid[])`, [workflowIds])
    await pool.query(`delete from workflows where id = any($1::uuid[])`, [workflowIds])
  }
}

describe.skipIf(!ENABLED)("Voz do recado pela policy da organização — prova contra o banco de teste (provider falso, zero IA paga)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    fake = await startFakeOpenAiServer({ apiKey: SECRET })
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    expect((await api.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    registerAiRuntime(createAiRuntime(pool, { snapshotTtlMs: 0, spendTtlMs: 0, alertThrottleMs: 0 }))
    // O recado: uma entrega AVATAR para a pessoa da sessão (o destinatário é sempre o usuário autenticado).
    const person = (await pool.query<{ person_id: string }>(`select person_id from user_accounts where email = $1`, [ADMIN.email])).rows[0]!.person_id
    created.workflow = (await pool.query<{ id: string }>(`insert into workflows (organization_id, name, trigger_config) values ($1, $2, '{"kind":"channel_flag"}') returning id`, [ORG, `${PREFIX}Workflow`])).rows[0]!.id
    created.version = (await pool.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1, '{"nodes":[],"edges":[]}') returning id`, [created.workflow])).rows[0]!.id
    created.enrollment = (await pool.query<{ id: string }>(`insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, scheduled_subject_id, scheduled_for) values ($1, $2, $3, 'out', 'completed', $4, now()) returning id`, [ORG, created.workflow, created.version, person])).rows[0]!.id
    created.output = (await pool.query<{ id: string }>(`insert into workflow_outputs (organization_id, enrollment_id, node_id, recipient_id, surface, speech_text, display_text) values ($1, $2, 'out', $3, 'AVATAR', $4, $4) returning id`, [ORG, created.enrollment, person, TEXT])).rows[0]!.id
  })

  afterAll(async () => {
    registerAiRuntime(null)
    await cleanup()
    await fake.close()
    await pool.end()
  })

  it("SEM policy: o recado sai pela voz da conversa (Gemini falso, conferida pela transcrição), fica no cache e nada vai à OpenAI", async () => {
    const since = new Date()
    const first = await audio()
    expect(first.status).toBe(200)
    expect(first.headers).toMatchObject({ "x-audio-format": "pcm16le", "x-sample-rate": "24000" })
    expect((first.body as Buffer).length).toBe(2_400)
    expect(legacy.live).toEqual([TEXT])
    expect(legacy.tts).toEqual([])
    expect(await stored()).toMatchObject({ voice_name: iniaVoiceName(), model: INIA_LIVE_MODEL })
    expect((await audio()).status).toBe(200)
    expect(legacy.live).toHaveLength(1)
    expect(speechRequests()).toHaveLength(0)
    expect(await usageSince(since)).toEqual([expect.objectContaining({ routing_mode: "LEGACY", provider_key: "GOOGLE_GENAI", model_name: INIA_LIVE_MODEL, status: "SUCCESS" })])
  })

  it("modelo de voz SEM voz cadastrada não ativa a policy; com a voz (e a instrução de tom) salva no modelo, ativa", async () => {
    const connection = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI", name: `${PREFIX}OpenAI`, baseUrl: fake.url, apiKey: SECRET, isLocal: false })
    expect(connection.status, JSON.stringify(connection.body)).toBe(201)
    created.connection = connection.body.data.id
    const model = await api.post("/api/v1/admin/ai/models").send({ connectionId: created.connection, providerModelId: "gpt-4o-mini-tts", displayName: "Voz da INIA (OpenAI)", capabilities: { AUDIO: { supported: true } } })
    expect(model.status, JSON.stringify(model.body)).toBe(201)
    created.model = model.body.data.id
    expect(model.body.data.speech).toBeNull()
    expect((await api.put("/api/v1/admin/ai/routing/SPEECH_SYNTHESIS/draft").send({ mode: "PINNED", modelIds: [created.model] })).status).toBe(200)
    const invalid = await api.post("/api/v1/admin/ai/routing/SPEECH_SYNTHESIS/activate")
    expect(invalid.status).toBe(422)
    expect(JSON.stringify(invalid.body)).toContain("voz não configurada no modelo")
    expect((await api.patch(`/api/v1/admin/ai/models/${created.model}`).send({ speech: { voice: "bad<voice>" } })).status).toBe(400)
    const withVoice = await api.patch(`/api/v1/admin/ai/models/${created.model}`).send({ speech: { voice: "marin", instructions: TONE } })
    expect(withVoice.status, JSON.stringify(withVoice.body)).toBe(200)
    expect(withVoice.body.data.speech).toEqual({ voice: "marin", instructions: TONE })
    // A sincronização de modelos não apaga a voz (metadata.speech fica fora do que ela regrava).
    expect((await api.post(`/api/v1/admin/ai/connections/${created.connection}/sync-models`)).status).toBe(200)
    expect((await api.get(`/api/v1/admin/ai/models/${created.model}`)).body.data.speech).toEqual({ voice: "marin", instructions: TONE })
    const activated = await api.post("/api/v1/admin/ai/routing/SPEECH_SYNTHESIS/activate")
    expect(activated.status, JSON.stringify(activated.body)).toBe(200)
  })

  it("COM policy: o áudio do Gemini guardado deixa de servir; o recado é lido pela OpenAI falsa com a voz e o tom do modelo, fica no cache e o uso é PINNED", async () => {
    const since = new Date()
    const response = await audio()
    expect(response.status).toBe(200)
    expect(response.headers).toMatchObject({ "x-audio-format": "pcm16le", "x-sample-rate": "24000", "x-duration-ms": "1000" })
    expect(Buffer.compare(response.body as Buffer, FAKE_SPEECH_PCM)).toBe(0)
    expect(legacy.live).toHaveLength(1)
    expect(speechRequests()).toHaveLength(1)
    expect(speechRequests()[0]!.body).toEqual({ model: "gpt-4o-mini-tts", input: TEXT, voice: "marin", response_format: "pcm", instructions: TONE })
    expect(await stored()).toMatchObject({ voice_name: "marin", model: speechCacheModelKey("gpt-4o-mini-tts", { voice: "marin", instructions: TONE }) })
    expect((await audio()).status).toBe(200)
    expect(speechRequests()).toHaveLength(1)
    // Resposta binária: o provider não informa tokens — custo desconhecido, nunca inventado.
    expect(await usageSince(since)).toEqual([expect.objectContaining({ routing_mode: "PINNED", provider_key: "OPENAI", model_name: "gpt-4o-mini-tts", status: "SUCCESS", cost_status: "UNKNOWN" })])
  })

  it("trocar a instrução de tom (ou a voz) gera áudio novo — nunca serve o de antes como se fosse o novo", async () => {
    await api.patch(`/api/v1/admin/ai/models/${created.model}`).send({ speech: { voice: "marin", instructions: "Fale devagar." } })
    expect((await audio()).status).toBe(200)
    expect(speechRequests()).toHaveLength(2)
    expect(speechRequests()[1]!.body).toMatchObject({ instructions: "Fale devagar." })
    await api.patch(`/api/v1/admin/ai/models/${created.model}`).send({ speech: { voice: "cedar", instructions: "Fale devagar." } })
    expect((await audio()).status).toBe(200)
    expect(speechRequests()).toHaveLength(3)
    expect(await stored()).toMatchObject({ voice_name: "cedar" })
  })

  it("desativar a policy volta à voz da conversa (Gemini) — o áudio da OpenAI guardado não é servido", async () => {
    expect((await api.post("/api/v1/admin/ai/routing/SPEECH_SYNTHESIS/deactivate")).status).toBe(200)
    expect((await audio()).status).toBe(200)
    expect(legacy.live).toHaveLength(2)
    expect(speechRequests()).toHaveLength(3)
    expect(await stored()).toMatchObject({ voice_name: iniaVoiceName(), model: INIA_LIVE_MODEL })
  })

  it("a chave nunca aparece no uso nem na auditoria gravados pela prova", async () => {
    const events = await pool.query(`select * from ai_usage_events where organization_id = $1 and occurred_at >= $2`, [ORG, startedAt])
    const audit = await pool.query(`select * from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
    expect(JSON.stringify(events.rows) + JSON.stringify(audit.rows)).not.toContain(SECRET)
  })
})
