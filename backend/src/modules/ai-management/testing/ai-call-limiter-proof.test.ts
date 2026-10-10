import { randomUUID } from "node:crypto"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import { createApp } from "../../../main/app.js"
import { createAiCallLimiter, DEFAULT_AI_CALL_LIMITER_CONFIG, INTERACTIVE_RATE_LIMIT_MESSAGE, setAiCallLimiter, type AiCallLimiterConfig, type AiCallLimiterLogEvent } from "../../../shared/application/model-routing/ai-call-limiter.js"
import { registerAiRuntime, runWithAiOrganization, runWithAiWorkflowCorrelation } from "../../../shared/application/model-routing/ai-runtime.js"
import { createChatStreamer, generateForRoute, routeFor } from "../../../shared/application/model-routing/llm-gateway.js"
import { createAiRuntime } from "../application/ai-runtime-service.js"
import { startFakeOpenAiServer, type FakeServer } from "./fake-openai-compatible-server.js"
import { setProofAccountPassword } from "../../auth/testing/proof-account-password.js"

/**
 * DEMONSTRAÇÃO + PROVA do limitador de chamadas de IA contra o banco de TESTE, com o runtime REAL da organização (policy →
 * adapter → evento de uso) e um provider FALSO em 127.0.0.1 com latência e COTA (429 + Retry-After acima de N requests
 * simultâneas). Zero API paga.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run ai-call-limiter-proof
 *
 * Cenário (o mesmo nos dois braços): um LOTE de 12 matrículas de Workflow em paralelo, 4 chamadas cada (48), satura a cota do
 * provider (6 simultâneas, 300 ms por resposta); no meio dele, o CHAT de um operador manda 10 mensagens (uma a cada 200 ms).
 *   - limitador DESLIGADO (como antes): tudo sai direto — o lote estoura a cota e o chat recebe 429;
 *   - limitador LIGADO (6 vagas, 2 reservadas ao chat): o lote nunca passa de 4 simultâneas, espera e repete; o chat responde;
 *   - LIGADO mas ACIMA da cota (10 vagas, lote até 8 — ex.: dois processos dividindo a mesma chave): o provider devolve 429 com
 *     Retry-After; o lote espera o tempo pedido, pausa os próximos e repete até concluir — o caminho do backoff de ponta a ponta.
 * Os números vêm de `ai_usage_events` (classe, espera na fila, motivo, tentativa) — gravados pelo ponto único de registro.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { email: "carla.nunes@inia.com", password: "Inia@123" }
const PREFIX = "QA Limitador IA · "
const BATCH_WORKERS = 12
const CALLS_PER_WORKER = 4
const CHAT_MESSAGES = 10
const PROVIDER = { latencyMs: 300, capacity: { maxConcurrent: 6, retryAfterSeconds: 1 } }
const LIMITER = { maxConcurrent: 6, reservedInteractive: 2, batchBackoffBaseMs: 300, batchBackoffMaxMs: 3_000, batchMaxRetries: 8 }

let pool: pg.Pool
let api: ReturnType<typeof request.agent>
let fake: FakeServer
let connectionId = ""
let modelId = ""
const startedAt = new Date()

async function cleanup() {
  const connections = await pool.query<{ id: string }>(`select id from ai_connections where name like $1`, [`${PREFIX}%`])
  const ids = connections.rows.map((row) => row.id)
  await pool.query(`delete from ai_routing_policies where organization_id = $1 and use_case in ('SPECIALIST_RESPONSE', 'CHAT')`, [ORG])
  if (ids.length > 0) {
    await pool.query(`delete from ai_usage_events where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_model_pricing where model_id in (select id from ai_models where connection_id = any($1::uuid[]))`, [ids])
    await pool.query(`delete from ai_models where connection_id = any($1::uuid[])`, [ids])
    await pool.query(`delete from ai_connections where id = any($1::uuid[])`, [ids])
  }
  await pool.query(`delete from audit_logs where entity_type like 'ai_%' and created_at >= $1`, [startedAt])
}

async function activate(useCase: string) {
  const draft = await api.put(`/api/v1/admin/ai/routing/${useCase}/draft`).send({ mode: "PINNED", modelIds: [modelId] })
  expect(draft.status, JSON.stringify(draft.body)).toBe(200)
  const active = await api.post(`/api/v1/admin/ai/routing/${useCase}/activate`)
  expect(active.status, JSON.stringify(active.body)).toBe(200)
}

const specialistRequest = () => ({ classification: { phase: "SYNTHESIS" as const, purpose: "SPECIALIST_SYNTHESIS", source: "SPECIALIST" as const, semanticType: "TEXT" as const }, systemPrompt: "Prova de capacidade", contents: [{ role: "user" as const, text: "Avalie a chamada." }], route: routeFor({ purpose: "SPECIALIST_SYNTHESIS", phase: "SYNTHESIS" }, "CURRENT") })

type ScenarioResult = {
  limiter: string
  chat: { ok: number; failed: number; latenciesMs: number[]; errors: string[] }
  batch: { ok: number; failed: number; wallMs: number }
  provider: { served: number; rateLimited: number; peakInFlight: number }
  events: { call_priority: string | null; queue_reason: string | null; status: string; error_category: string | null; n: number; avg_wait: number | null; max_wait: number | null; max_attempt: number | null }[]
  logs: AiCallLimiterLogEvent[]
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!
}

async function runScenario(label: string, config: Partial<AiCallLimiterConfig>): Promise<ScenarioResult> {
  const logs: AiCallLimiterLogEvent[] = []
  setAiCallLimiter(createAiCallLimiter({ ...DEFAULT_AI_CALL_LIMITER_CONFIG, ...LIMITER, ...config }, { log: (event) => logs.push(event) }))
  const providerBefore = { ...fake.stats }
  fake.stats.peakInFlight = 0
  const scenarioStart = new Date()

  const batch = { ok: 0, failed: 0, wallMs: 0 }
  const batchStarted = Date.now()
  const workers = Array.from({ length: BATCH_WORKERS }, async () => {
    const enrollmentId = randomUUID()
    const correlation = { workflowId: randomUUID(), workflowVersionId: randomUUID(), enrollmentId, rootEnrollmentId: enrollmentId, nodeId: "proof-node" }
    for (let call = 0; call < CALLS_PER_WORKER; call++) {
      try {
        await runWithAiWorkflowCorrelation(ORG, correlation, () => generateForRoute(specialistRequest()))
        batch.ok++
      } catch {
        batch.failed++
      }
    }
  })

  const chat = { ok: 0, failed: 0, latenciesMs: [] as number[], errors: [] as string[] }
  const chatStream = createChatStreamer(async () => {
    throw new Error("o chat da prova sempre tem policy CHAT — o legado nunca deveria ser chamado")
  })
  const chats = (async () => {
    for (let message = 0; message < CHAT_MESSAGES; message++) {
      await new Promise((resolve) => setTimeout(resolve, message === 0 ? 100 : 200))
      const sent = Date.now()
      try {
        const chunks: string[] = []
        await runWithAiOrganization(ORG, () => chatStream([{ role: "user", text: `Mensagem ${message + 1}` }], "Você é a INIA.", (chunk) => chunks.push(chunk)), { origin: "USER_REQUEST" })
        expect(chunks.join("")).toContain("provider falso")
        chat.ok++
      } catch (error) {
        chat.failed++
        chat.errors.push(error instanceof Error ? `${(error as { code?: string }).code ?? error.name}: ${error.message}` : String(error))
      }
      chat.latenciesMs.push(Date.now() - sent)
    }
  })()

  await Promise.all([Promise.all(workers).then(() => (batch.wallMs = Date.now() - batchStarted)), chats])
  const events = await pool.query<ScenarioResult["events"][number]>(
    `select call_priority, queue_reason, status, error_category, count(*)::int as n, round(avg(queue_wait_ms))::int as avg_wait, max(queue_wait_ms) as max_wait, max(limiter_attempt)::int as max_attempt
       from ai_usage_events where connection_id = $1 and occurred_at >= $2
      group by 1, 2, 3, 4 order by 1, 2, 3, 4`,
    [connectionId, scenarioStart],
  )
  return {
    limiter: label,
    chat,
    batch,
    provider: { served: fake.stats.served - providerBefore.served, rateLimited: fake.stats.rateLimited - providerBefore.rateLimited, peakInFlight: fake.stats.peakInFlight },
    events: events.rows,
    logs,
  }
}

function report(result: ScenarioResult): string {
  const lines = [
    `── Limitador ${result.limiter} ──`,
    `chat (interativa): ${result.chat.ok}/${CHAT_MESSAGES} respondidas · latência p50 ${percentile(result.chat.latenciesMs, 50)} ms · p95 ${percentile(result.chat.latenciesMs, 95)} ms · máx ${Math.max(...result.chat.latenciesMs)} ms${result.chat.errors.length ? ` · erros: ${[...new Set(result.chat.errors)].join(" | ")}` : ""}`,
    `lote (Workflow): ${result.batch.ok}/${BATCH_WORKERS * CALLS_PER_WORKER} concluídas · ${result.batch.failed} falharam · ${result.batch.wallMs} ms no total`,
    `provider: ${result.provider.served} atendidas · ${result.provider.rateLimited} recusadas com 429 · pico de ${result.provider.peakInFlight} simultâneas (cota ${PROVIDER.capacity.maxConcurrent})`,
    "ai_usage_events (classe · motivo da fila · status → tentativas, espera média/máx, maior tentativa):",
    ...result.events.map((row) => `  ${row.call_priority ?? "—"} · ${row.queue_reason ?? "—"} · ${row.status}${row.error_category ? `/${row.error_category}` : ""} → ${row.n} · ${row.avg_wait ?? "—"}/${row.max_wait ?? "—"} ms · tentativa ${row.max_attempt ?? "—"}`),
  ]
  return lines.join("\n")
}

describe.skipIf(!ENABLED)("limitador de chamadas de IA — chat continua respondendo com o lote saturando a cota (provider falso, zero API paga)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    await cleanup()
    fake = await startFakeOpenAiServer(PROVIDER)
    api = request.agent(createApp(pool))
    await setProofAccountPassword(pool, ADMIN.email, ADMIN.password)
    expect((await api.post("/api/v1/auth/login").send(ADMIN)).status).toBe(200)
    const created = await api.post("/api/v1/admin/ai/connections").send({ providerKey: "OPENAI_COMPATIBLE", name: `${PREFIX}Fake com cota`, baseUrl: fake.url, isLocal: false })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    connectionId = created.body.data.id
    expect((await api.post(`/api/v1/admin/ai/connections/${connectionId}/sync-models`)).status).toBe(200)
    const models = await api.get(`/api/v1/admin/ai/models?connectionId=${connectionId}`)
    modelId = (models.body.data as { id: string; providerModelId: string }[]).find((model) => model.providerModelId === "fake-ok")!.id
    expect((await api.patch(`/api/v1/admin/ai/models/${modelId}`).send({ capabilities: { STRUCTURED_OUTPUT: { supported: true }, STREAMING: { supported: true } } })).status).toBe(200)
    await activate("SPECIALIST_RESPONSE")
    await activate("CHAT")
    registerAiRuntime(createAiRuntime(pool, { snapshotTtlMs: 5_000, spendTtlMs: 5_000, alertThrottleMs: 60_000 }))
  })

  afterAll(async () => {
    setAiCallLimiter(null)
    registerAiRuntime(null)
    await cleanup()
    await fake?.close()
    await pool.end()
  })

  it("DESLIGADO (como antes): o lote estoura a cota e o 429 chega ao chat", async () => {
    const off = await runScenario("DESLIGADO", { enabled: false })
    process.stdout.write(`\n${report(off)}\n`)
    expect(off.provider.rateLimited).toBeGreaterThan(0)
    expect(off.chat.failed).toBeGreaterThan(0)
    expect(off.batch.failed).toBeGreaterThan(0)
  }, 60_000)

  it("LIGADO: o chat responde tudo sem 429; o lote nunca passa das vagas dele, espera e conclui tudo; a fila fica gravada no uso", async () => {
    const on = await runScenario("LIGADO (6 vagas, 2 do chat)", {})
    process.stdout.write(`\n${report(on)}\n`)
    expect(on.chat).toMatchObject({ ok: CHAT_MESSAGES, failed: 0 })
    expect(on.batch).toMatchObject({ ok: BATCH_WORKERS * CALLS_PER_WORKER, failed: 0 })
    expect(on.provider.peakInFlight).toBeLessThanOrEqual(PROVIDER.capacity.maxConcurrent)
    expect(on.provider.rateLimited).toBe(0)
    // Toda tentativa tem classe e motivo da fila; o chat nunca esperou capacidade nem tomou 429.
    expect(on.events.every((row) => row.call_priority !== null && row.queue_reason !== null)).toBe(true)
    const interactive = on.events.filter((row) => row.call_priority === "INTERACTIVE")
    expect(interactive.reduce((sum, row) => sum + row.n, 0)).toBe(CHAT_MESSAGES)
    expect(interactive.every((row) => row.status === "SUCCESS" && row.queue_reason === "NONE")).toBe(true)
    const waited = on.events.filter((row) => row.call_priority === "BATCH" && row.queue_reason === "CAPACITY")
    expect(waited.reduce((sum, row) => sum + row.n, 0)).toBeGreaterThan(0)
    expect(Math.max(...on.chat.latenciesMs)).toBeLessThan(2_000)
  }, 60_000)

  it("LIGADO ACIMA da cota: 429 com Retry-After → o lote espera o tempo pedido, pausa os próximos e repete até concluir tudo", async () => {
    const over = await runScenario("LIGADO acima da cota (10 vagas, lote até 8)", { maxConcurrent: 10, reservedInteractive: 2 })
    process.stdout.write(`\n${report(over)}\n`)
    expect(over.provider.rateLimited).toBeGreaterThan(0)
    expect(over.batch).toMatchObject({ ok: BATCH_WORKERS * CALLS_PER_WORKER, failed: 0 })
    const retried = over.events.filter((row) => row.call_priority === "BATCH" && row.queue_reason === "RETRY_BACKOFF" && row.status === "SUCCESS")
    expect(retried.length).toBeGreaterThan(0)
    // Retry-After: 1 s — nenhuma repetição do lote antes do tempo pedido.
    const retryLogs = over.logs.filter((event) => event.event === "ai_call_retry" && event.priority === "BATCH")
    expect(retryLogs.length).toBeGreaterThan(0)
    expect(retryLogs.every((event) => event.retryAfterMs === 1_000 && (event.waitMs as number) >= 1_000)).toBe(true)
    // O chat nunca é pausado; se o 429 alcançá-lo, ele tenta uma vez a mais e, persistindo, recebe o erro claro.
    expect(over.chat.errors.every((error) => error.includes(INTERACTIVE_RATE_LIMIT_MESSAGE))).toBe(true)
  }, 60_000)
})
