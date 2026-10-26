// PRIORIDADE DO CHAT DURANTE DISPAROS EM MASSA — operadores conversando com a INIA enquanto um administrador dispara monitorias
// (interações com a flag que aciona o Workflow de feedback), com a IA falsa e a cota do provedor COMPARTILHADA entre API e
// worker (fake-quota.mjs). Mede o que interessa à decisão:
//
//   chat:     tempo até o primeiro texto e total (p50/p95), erros — só depois do aquecimento;
//   lote:     matrículas criadas/concluídas na janela (vazão), chamadas de lote, 429s e espera na fila por classe;
//   provedor: chamadas admitidas e recusadas pela cota (chat × lote).
//
//   LT_API=http://127.0.0.1:3452 LT_LABEL=depois-pico LT_DISPATCH_BURST=150 LT_DISPATCH_PER_MIN=20 node tools/loadtest/chat-priority.mjs
//
// Nenhum conteúdo de conversa vai para o resultado (só tempos, contagens e nomes de evento).
import { mkdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ChatSession, demoPassword, percentile } from "./chat-client.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const OUT = path.join(HERE, "out")
mkdirSync(OUT, { recursive: true })
const cfg = {
  api: process.env.LT_API ?? "http://127.0.0.1:3452",
  workerHealth: process.env.LT_WORKER_HEALTH ?? null,
  origin: process.env.LT_ORIGIN ?? "http://127.0.0.1:3110",
  db: process.env.LT_DATABASE_URL ?? "postgresql://localhost:5432/inia_chatbench",
  quota: process.env.LT_QUOTA_URL ?? "http://127.0.0.1:3480",
  operators: Number(process.env.LT_OPERATORS ?? 12),
  chatMeanS: Number(process.env.LT_CHAT_MEAN_S ?? 45),
  durationS: Number(process.env.LT_DURATION_S ?? 300),
  warmupS: Number(process.env.LT_WARMUP_S ?? 30),
  burst: Number(process.env.LT_DISPATCH_BURST ?? 0),
  perMin: Number(process.env.LT_DISPATCH_PER_MIN ?? 0),
  adminEmail: process.env.LT_ADMIN_EMAIL ?? "carla.nunes@inia.com",
  label: process.env.LT_LABEL ?? "chat-priority",
}
if (/\/inia(\?|$)/.test(cfg.db)) throw new Error("o banco da medição nunca é o dev (inia)")
const pg = createRequire(path.join(ROOT, "backend/package.json"))("pg")
const PASSWORD = demoPassword()
const QUESTIONS = ["Como faço para registrar a contestação da fatura de um cliente?", "Qual é o prazo para responder uma reclamação de cobrança indevida?", "O que devo fazer quando o cliente pede segunda via da conta?", "Quais são os passos para um reparo técnico na casa do cliente?"]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const t0 = Date.now()
const deadline = t0 + cfg.durationS * 1000
const measuring = (at) => at >= t0 + cfg.warmupS * 1000
const turns = []
const dispatch = { sent: 0, accepted: 0, failed: 0 }

async function operator(email, index) {
  const session = new ChatSession({ api: cfg.api, origin: cfg.origin, email })
  if (!(await session.login(PASSWORD))) return
  await sleep(Math.random() * Math.min(cfg.chatMeanS, cfg.warmupS) * 1000)
  let conversationId = null
  let count = 0
  while (Date.now() < deadline) {
    // Conversa nova a cada 4 perguntas: o histórico fica no tamanho real de uma conversa (curta).
    if (count % 4 === 0) {
      await session.newConversation()
      conversationId = null
    }
    const startedAt = Date.now()
    const result = await session.ask(QUESTIONS[(index + count) % QUESTIONS.length], { conversationId })
    conversationId = result.conversationId ?? conversationId
    count += 1
    turns.push({ at: Math.round((startedAt - t0) / 1000), measured: measuring(startedAt), ok: result.ok, error: result.error, firstTextMs: result.firstTextMs, totalMs: result.totalMs, firstStatusMs: result.firstStatusMs, retracts: result.retracts })
    if (Date.now() >= deadline) break
    await sleep(Math.min(-Math.log(1 - Math.random()) * cfg.chatMeanS * 1000, Math.max(0, deadline - Date.now())))
  }
}

async function dispatcher(context) {
  if (!context.workflowId || (cfg.burst === 0 && cfg.perMin === 0)) return
  const session = new ChatSession({ api: cfg.api, origin: cfg.origin, email: cfg.adminEmail })
  if (!(await session.login(PASSWORD))) throw new Error("login do administrador recusado")
  const ingest = async () => {
    dispatch.sent += 1
    const operatorId = context.operatorIds[Math.floor(Math.random() * context.operatorIds.length)]
    const transcript = context.transcripts[Math.floor(Math.random() * context.transcripts.length)]
    const startedAt = new Date(Date.now() - 600_000)
    const response = await fetch(`${cfg.api}/api/v1/ingestion/interactions`, {
      method: "POST",
      headers: session.headers({ "content-type": "application/json" }),
      body: JSON.stringify({ externalId: `chatbench-${cfg.label}-${t0}-${dispatch.sent}`, operatorId, reason: "Contestação de fatura", channel: "VOICE", startedAt: startedAt.toISOString(), endedAt: new Date(startedAt.getTime() + 240_000).toISOString(), transcript: { content: transcript }, flags: { [context.flagName]: 1 } }),
    }).catch(() => null)
    if (response && response.status < 300) dispatch.accepted += 1
    else dispatch.failed += 1
    await response?.text().catch(() => null)
  }
  // Disparo em massa no início (como um Workflow manual ou uma carga grande da Central de Dados) + o ritmo contínuo.
  for (let index = 0; index < cfg.burst; index += 10) await Promise.all(Array.from({ length: Math.min(10, cfg.burst - index) }, () => ingest()))
  while (cfg.perMin > 0 && Date.now() < deadline) {
    await ingest()
    await sleep(60_000 / cfg.perMin)
  }
}

async function main() {
  const pool = new pg.Pool({ connectionString: cfg.db, max: 2 })
  const operators = (await pool.query(`select email from user_accounts where email like 'operador%.demo@inia.local' and active and not password_change_required and access_disabled_at is null order by email limit $1`, [cfg.operators])).rows.map((row) => row.email)
  const trigger = (await pool.query(`select w.id, cf.flag_name from workflows w join channel_flags cf on cf.id::text = w.trigger_config->>'channelFlagId' where w.active and w.active_version_id is not null and w.trigger_config->>'kind' = 'channel_flag' and w.scope_type = 'ALL_TEAMS' order by w.created_at limit 1`)).rows[0]
  const context = {
    workflowId: trigger?.id ?? null,
    flagName: trigger?.flag_name ?? "nota_ura",
    operatorIds: (await pool.query(`select p.id from people p join user_accounts ua on ua.person_id = p.id where ua.email like 'operador%.demo@inia.local' and p.active limit 300`)).rows.map((row) => row.id),
    transcripts: (await pool.query(`select content from transcripts where length(content) between 800 and 12000 order by random() limit 40`)).rows.map((row) => row.content),
  }
  await fetch(`${cfg.quota}/reset`, { method: "POST" }).catch(() => null)
  const since = new Date(t0).toISOString()
  process.stdout.write(`[${cfg.label}] ${operators.length} operadores (pergunta a cada ~${cfg.chatMeanS} s) · disparo ${cfg.burst} + ${cfg.perMin}/min no Workflow ${context.workflowId ?? "—"} · ${cfg.durationS} s (aquecimento ${cfg.warmupS} s)\n`)
  const progress = setInterval(() => {
    const done = turns.filter((turn) => turn.measured)
    process.stdout.write(`[t+${Math.round((Date.now() - t0) / 1000)}s] chat ${turns.length} (falhas ${turns.filter((t) => !t.ok).length}) · 1º texto p50 ${percentile(done.filter((t) => t.ok).map((t) => t.firstTextMs), 50)} ms · disparos ${dispatch.accepted}/${dispatch.sent}\n`)
  }, 30_000)
  await Promise.all([...operators.map((email, index) => operator(email, index)), dispatcher(context)])
  clearInterval(progress)
  const until = new Date().toISOString()
  const measuredFrom = new Date(t0 + cfg.warmupS * 1000).toISOString()

  const [batch, ai, queue, completions] = await Promise.all([
    pool.query(`select count(*)::int created, count(*) filter (where status = 'completed')::int completed, count(*) filter (where status in ('active','waiting'))::int in_flight, count(*) filter (where status in ('failed','dead'))::int failed from workflow_enrollments where created_at >= $1`, [since]),
    pool.query(`select coalesce(call_priority, '—') priority, count(*)::int calls, count(*) filter (where status = 'SUCCESS')::int ok, count(*) filter (where error_category = 'RATE_LIMIT')::int rate_limited, count(*) filter (where status <> 'SUCCESS' and coalesce(error_category, '') <> 'RATE_LIMIT')::int other_errors from ai_usage_events where occurred_at between $1 and $2 group by 1 order by 1`, [measuredFrom, until]),
    pool.query(`select coalesce(call_priority, '—') priority, percentile_cont(0.5) within group (order by queue_wait_ms) p50, percentile_cont(0.95) within group (order by queue_wait_ms) p95, max(queue_wait_ms) max from ai_usage_events where occurred_at between $1 and $2 and queue_wait_ms is not null group by 1`, [measuredFrom, until]),
    // Vazão do lote: nós de Workflow concluídos por minuto (eventos do motor) na janela medida.
    pool.query(`select count(*) filter (where event_type = 'action_executed')::int completed_nodes, count(*) filter (where event_type = 'node_failed')::int failed_nodes from workflow_enrollment_events where created_at between $1 and $2`, [measuredFrom, until]).catch(() => ({ rows: [{ completed_nodes: null, failed_nodes: null }] })),
  ])
  const quota = await fetch(`${cfg.quota}/stats`).then((response) => response.json()).catch(() => null)
  const apiMetrics = await fetch(`${cfg.api}/internal/metrics`).then((response) => response.json()).catch(() => null)
  const workerHealth = cfg.workerHealth ? await fetch(cfg.workerHealth).then((response) => response.json()).catch(() => null) : null
  await pool.end()

  const measured = turns.filter((turn) => turn.measured)
  const ok = measured.filter((turn) => turn.ok)
  const minutes = (cfg.durationS - cfg.warmupS) / 60
  const summary = {
    label: cfg.label,
    chat: { turns: measured.length, failed: measured.length - ok.length, errors: [...new Set(measured.filter((t) => !t.ok).map((t) => t.error))], firstText: { p50: percentile(ok.map((t) => t.firstTextMs), 50), p95: percentile(ok.map((t) => t.firstTextMs), 95), max: Math.max(0, ...ok.map((t) => t.firstTextMs)) }, total: { p50: percentile(ok.map((t) => t.totalMs), 50), p95: percentile(ok.map((t) => t.totalMs), 95), max: Math.max(0, ...ok.map((t) => t.totalMs)) }, firstStatus: { p50: percentile(ok.map((t) => t.firstStatusMs), 50) } },
    batch: { dispatch, enrollments: batch.rows[0], actionsPerMin: completions.rows[0].completed_nodes === null ? null : +(completions.rows[0].completed_nodes / minutes).toFixed(2), failedNodes: completions.rows[0].failed_nodes },
    ai: ai.rows,
    queueWaitMs: queue.rows.map((row) => ({ priority: row.priority, p50: Math.round(row.p50), p95: Math.round(row.p95), max: row.max })),
    provider: quota && { tpm: quota.tpm, rpm: quota.rpm, totals: quota.totals },
    server: { chat: apiMetrics?.chat ?? null, aiCalls: apiMetrics?.aiCalls ?? null, apiGate: apiMetrics?.aiConnections ?? null, workerGate: workerHealth?.aiConnections ?? null, workerAiCalls: workerHealth?.aiCalls ?? null },
  }
  const file = path.join(OUT, `chat-priority-${cfg.label}-${new Date(t0).toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify({ config: cfg, summary, turns }, null, 1))
  process.stdout.write(`\n${JSON.stringify(summary, null, 1)}\n${file}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
