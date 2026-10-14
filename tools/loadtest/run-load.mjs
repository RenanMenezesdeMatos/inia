// TESTE DE CARGA da INIA — usuários virtuais com o comportamento REGISTRADO no navegador (WebKit, 14/10/2026):
//
//   OPERADOR   login → tela inicial (SSR do /operator + JS/CSS + modelo 3D + imagem de cenário + foto, uma vez por navegador)
//              → 9 chamadas da tela (auth/me, avaliações, entregas, caixa da INIA, conversa atual, aplicações, convite,
//              cenário, sino) → polling (caixa a cada 30 s; sino e convite a cada 60 s) → mensagens ao chat da INIA
//              (intervalo exponencial com média LT_CHAT_MEAN_S).
//   SUPERVISOR login → /supervisor (SSR) + 6 chamadas (auth/me, conversa, caixa, sino, cenário, Acompanhamento) → polling →
//              a cada ~2 min uma aba: Equipe (resumo + membros), Indicadores, Calendário ou a próxima página do Acompanhamento.
//   ADMIN      Resultados do Workflow de monitoria (resumo + página) a cada 30 s, Conversas com a INIA a cada 20 s, visão
//              geral da Central de Dados a cada 30 s, e a INGESTÃO de chamadas com a flag que dispara a monitoria
//              (LT_INGEST_PER_MIN por minuto; LT_BURST de uma vez no início do patamar).
//
// Coleta: latência por rota (fases subida × patamar), erros, e a cada 5 s as métricas internas da API, o /health do worker,
// CPU/memória dos processos (ps) e conexões do PostgreSQL. Saída: tools/loadtest/out/result-<data>.json + resumo no terminal.
// A senha dos usuários de demonstração é lida do .env do backend em tempo de execução e nunca é impressa.
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { randomUUID } from "node:crypto"
import { loadavg } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, "../..")
const OUT = path.join(HERE, "out")
mkdirSync(OUT, { recursive: true })
const cfg = {
  operators: Number(process.env.LT_OPERATORS ?? 570),
  supervisors: Number(process.env.LT_SUPERVISORS ?? 30),
  admins: Number(process.env.LT_ADMINS ?? 1),
  rampS: Number(process.env.LT_RAMP_S ?? 180),
  steadyS: Number(process.env.LT_STEADY_S ?? 600),
  chatMeanS: Number(process.env.LT_CHAT_MEAN_S ?? 600),
  ingestPerMin: Number(process.env.LT_INGEST_PER_MIN ?? 8),
  burst: Number(process.env.LT_BURST ?? 0),
  apiPorts: (process.env.LT_API_PORTS ?? "3433").split(",").map(Number),
  web: process.env.LT_WEB ?? "http://127.0.0.1:3110",
  workerHealth: process.env.LT_WORKER_HEALTH ?? "http://127.0.0.1:3434/health",
  db: process.env.LT_DATABASE_URL ?? "postgresql://localhost:5432/inia_loadtest",
  envFile: process.env.LT_ENV_FILE ?? path.join(ROOT, "backend/.env"),
  adminEmail: process.env.LT_ADMIN_EMAIL ?? "carla.nunes@inia.com",
  label: process.env.LT_LABEL ?? "run",
}
const PASSWORD = /^INIA_DEMO_PASSWORD=(.*)$/m.exec(readFileSync(cfg.envFile, "utf8"))?.[1]?.trim()
if (!PASSWORD) throw new Error(`INIA_DEMO_PASSWORD ausente em ${cfg.envFile}`)
const pg = createRequire(path.join(ROOT, "backend/package.json"))("pg")

// ---------------------------------------------------------------------------------------------
// Medição
// ---------------------------------------------------------------------------------------------
const t0 = Date.now()
const phaseOf = (at) => ((at - t0) / 1000 < cfg.rampS ? "ramp" : "steady")
const samples = new Map() // `${phase}|${label}` → { ms: number[], errors, client4xx, bytes }
/** Janelas de 30 s com a latência das requisições curtas (tudo menos chat e arquivos) — para ver QUANDO a latência sobe. */
const windows = new Map()
const SHORT = (label) => !/chat|\(SSR\)|_next\/static|models|images|ingestion/.test(label)
function record(label, startedAt, status, bytes, error) {
  if (SHORT(label)) {
    const slot = Math.floor((startedAt - t0) / 30_000)
    if (!windows.has(slot)) windows.set(slot, [])
    windows.get(slot).push(Date.now() - startedAt)
  }
  const key = `${phaseOf(startedAt)}|${label}`
  let entry = samples.get(key)
  if (!entry) samples.set(key, (entry = { ms: [], errors: 0, client4xx: 0, bytes: 0, lastError: null }))
  entry.ms.push(Date.now() - startedAt)
  entry.bytes += bytes ?? 0
  if (error || status >= 500 || status === 0) {
    entry.errors += 1
    entry.lastError = error ? String(error.message ?? error).slice(0, 160) : `HTTP ${status}`
  } else if (status >= 400) entry.client4xx += 1
}
let apiIndex = 0
const apiBase = () => `http://127.0.0.1:${cfg.apiPorts[apiIndex++ % cfg.apiPorts.length]}`
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const jitter = (ms) => ms * (0.8 + Math.random() * 0.4)
const deadline = t0 + (cfg.rampS + cfg.steadyS) * 1000
const running = () => Date.now() < deadline
/** Espera, mas nunca além do fim do teste (os laços conferem `running()` logo depois). */
const wait = (ms) => sleep(Math.max(0, Math.min(ms, deadline - Date.now())))

class Session {
  constructor(email) {
    this.email = email
    this.cookies = new Map()
    this.cache = new Set() // o que o "navegador" já baixou (cache imutável)
  }
  cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ")
  }
  absorb(response) {
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";")
      const index = pair.indexOf("=")
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }
  async request(label, url, { method = "GET", body, raw = false, headers = {} } = {}) {
    const startedAt = Date.now()
    try {
      const response = await fetch(url, {
        method,
        headers: { cookie: this.cookieHeader(), origin: cfg.web, "accept-encoding": "gzip, deflate, br", ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "manual",
        signal: AbortSignal.timeout(120_000),
      })
      this.absorb(response)
      const buffer = raw ? Buffer.from(await response.arrayBuffer()) : null
      const text = raw ? null : await response.text()
      record(label, startedAt, response.status, buffer?.length ?? text?.length ?? 0)
      return { status: response.status, text, buffer }
    } catch (error) {
      record(label, startedAt, 0, 0, error)
      return { status: 0, text: null, buffer: null }
    }
  }
  api(label, pathname, options) {
    return this.request(label, `${apiBase()}/api/v1${pathname}`, options)
  }
  async asset(label, url) {
    if (this.cache.has(url)) return
    this.cache.add(url)
    await this.request(label, url.startsWith("http") ? url : `${cfg.web}${url}`, { raw: true })
  }
  async login() {
    const result = await this.api("POST /auth/login", "/auth/login", { method: "POST", body: { email: this.email, password: PASSWORD } })
    return result.status === 200
  }
}

const json = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
const assetUrls = (text, prefix) => [...new Set((text ?? "").match(new RegExp(`${prefix.replace(/[/]/g, "\\/")}[A-Za-z0-9/_\\-.?=&%]+`, "g")) ?? [])]

/** O que o navegador baixa na primeira visita: página (SSR), JS/CSS, imagens da API e o modelo 3D (só depois de ocioso). */
async function firstVisit(session, page) {
  const document = await session.request(`GET ${page} (SSR)`, `${cfg.web}${page}`, { headers: { accept: "text/html" } })
  const statics = assetUrls(document.text, "/_next/static/").filter((url) => /\.(js|css)(\?|$)/.test(url))
  for (let index = 0; index < statics.length; index += 6) await Promise.all(statics.slice(index, index + 6).map((url) => session.asset("GET /_next/static (JS/CSS)", url)))
  return document
}
async function imagesFrom(session, ...texts) {
  for (const url of texts.flatMap((text) => assetUrls(text, "/api/v1/profile-images/").concat(assetUrls(text, "/api/v1/inia-scenes/images/")))) {
    await session.asset(url.includes("profile-images") ? "GET /profile-images (foto)" : "GET /inia-scenes/images (cenário)", `${apiBase()}${url}`)
  }
}

// ---------------------------------------------------------------------------------------------
// Usuários virtuais
// ---------------------------------------------------------------------------------------------
const counters = { loginsOk: 0, loginsFailed: 0, chats: 0, chatsFailed: 0, ingested: 0 }

async function operator(email) {
  await sleep(Math.random() * cfg.rampS * 1000)
  const session = new Session(email)
  if (!(await session.login())) return void counters.loginsFailed++
  counters.loginsOk++
  await firstVisit(session, "/operator")
  const [me, , , , current, , , scene] = await Promise.all([
    session.api("GET /auth/me", "/auth/me"),
    session.api("GET /feedback-ratings", "/feedback-ratings"),
    session.api("GET /feedback-deliveries/mine", "/feedback-deliveries/mine"),
    session.api("GET /inia-deliveries/inbox", "/inia-deliveries/inbox"),
    session.api("GET /realtime/conversations/current", "/realtime/conversations/current"),
    session.api("GET /feedback-applications", "/feedback-applications"),
    session.api("GET /feedback-applications/invite", "/feedback-applications/invite"),
    session.api("GET /inia-scenes/current", "/inia-scenes/current"),
    session.api("GET /notifications", "/notifications"),
  ])
  await imagesFrom(session, me.text, scene.text)
  sleep(jitter(5_000)).then(() => session.asset("GET /models (modelo 3D)", process.env.LT_GLB ?? "/models/inia-mentora.glb?v=4cda1a780069"))
  let conversationId = json(current.text)?.data?.id ?? json(current.text)?.data?.conversation?.id ?? null
  const polls = [
    { every: 30_000, run: () => session.api("GET /inia-deliveries/inbox", "/inia-deliveries/inbox") },
    { every: 60_000, run: () => session.api("GET /notifications", "/notifications") },
    { every: 60_000, run: () => session.api("GET /feedback-applications/invite", "/feedback-applications/invite") },
  ]
  const loops = polls.map(async (poll) => {
    await wait(Math.random() * poll.every)
    while (running()) {
      await poll.run()
      await wait(poll.every)
    }
  })
  const chat = (async () => {
    while (running()) {
      await wait(-Math.log(1 - Math.random()) * cfg.chatMeanS * 1000)
      if (!running()) break
      const startedAt = Date.now()
      const result = await session.api("POST /realtime/messages (chat SSE)", "/realtime/messages", { method: "POST", body: { conversationId, text: "Como faço para registrar a contestação da fatura do cliente?", clientMessageId: randomUUID() } })
      counters.chats++
      if (result.status !== 200 || /event: error/.test(result.text ?? "")) {
        counters.chatsFailed++
        if (/event: error/.test(result.text ?? "")) record("chat: evento de erro no SSE", startedAt, 599, 0, new Error((/data: (.*)/.exec(result.text.split("event: error")[1] ?? "")?.[1] ?? "erro").slice(0, 150)))
      }
      conversationId = /"conversationId":"([0-9a-f-]{36})"/.exec(result.text ?? "")?.[1] ?? conversationId
    }
  })()
  await Promise.all([...loops, chat])
}

async function supervisor(email) {
  await sleep(Math.random() * cfg.rampS * 1000)
  const session = new Session(email)
  if (!(await session.login())) return void counters.loginsFailed++
  counters.loginsOk++
  await firstVisit(session, "/supervisor")
  const [me, , , , scene, followUps] = await Promise.all([
    session.api("GET /auth/me", "/auth/me"),
    session.api("GET /realtime/conversations/current", "/realtime/conversations/current"),
    session.api("GET /inia-deliveries/inbox", "/inia-deliveries/inbox"),
    session.api("GET /notifications", "/notifications"),
    session.api("GET /inia-scenes/current", "/inia-scenes/current"),
    session.api("GET /analytics/follow-ups (página)", "/analytics/follow-ups?limit=8"),
  ])
  await imagesFrom(session, me.text, scene.text)
  sleep(jitter(5_000)).then(() => session.asset("GET /models (modelo 3D)", process.env.LT_GLB ?? "/models/inia-mentora.glb?v=4cda1a780069"))
  const period = process.env.LT_PERIOD ?? new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 7)
  const today = new Date()
  const monday = new Date(today.getTime() - ((today.getDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10)
  const sunday = new Date(new Date(monday).getTime() + 6 * 86_400_000).toISOString().slice(0, 10)
  let cursor = json(followUps.text)?.data?.nextCursor ?? null
  const tabs = [
    async () => Promise.all([session.api("GET /analytics/team", `/analytics/team?period=${period}`), session.api("GET /analytics/team/members", `/analytics/team/members?period=${period}&sort=situation&order=asc&page=1&pageSize=10`)]),
    async () => session.api("GET /analytics/indicators", `/analytics/indicators?period=${period}`),
    async () => session.api("GET /team-calendar", `/team-calendar?from=${monday}&to=${sunday}&page=1&pageSize=10`),
    async () => {
      const page = await session.api("GET /analytics/follow-ups (página)", `/analytics/follow-ups?limit=8${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      cursor = json(page.text)?.data?.nextCursor ?? null
    },
  ]
  const polls = [
    { every: 30_000, run: () => session.api("GET /inia-deliveries/inbox", "/inia-deliveries/inbox") },
    { every: 60_000, run: () => session.api("GET /notifications", "/notifications") },
    { every: 120_000, run: () => tabs[Math.floor(Math.random() * tabs.length)]() },
  ]
  await Promise.all(polls.map(async (poll) => {
    await wait(Math.random() * poll.every)
    while (running()) {
      await poll.run()
      await wait(jitter(poll.every))
    }
  }))
}

async function admin(email, context) {
  const session = new Session(email)
  if (!(await session.login())) return void counters.loginsFailed++
  counters.loginsOk++
  const ingest = async () => {
    const operatorId = context.operatorIds[Math.floor(Math.random() * context.operatorIds.length)]
    const transcript = context.transcripts[Math.floor(Math.random() * context.transcripts.length)]
    const startedAt = new Date(Date.now() - 600_000)
    const result = await session.api("POST /ingestion/interactions", "/ingestion/interactions", { method: "POST", body: {
      externalId: `loadtest-${cfg.label}-${t0}-${counters.ingested}`, operatorId, reason: "Contestação de fatura", channel: "VOICE",
      startedAt: startedAt.toISOString(), endedAt: new Date(startedAt.getTime() + 240_000).toISOString(),
      transcript: { content: transcript }, flags: { [context.flagName]: context.flagValue },
    } })
    if (result.status < 300) counters.ingested++
  }
  const loops = [
    { every: 30_000, run: () => Promise.all([session.api("GET /admin/workflows/:id/results/summary", `/admin/workflows/${context.workflowId}/results/summary`), session.api("GET /admin/workflows/:id/results", `/admin/workflows/${context.workflowId}/results?page=1&pageSize=20`)]) },
    { every: 20_000, run: () => session.api("GET /admin/assistant-conversations", "/admin/assistant-conversations?page=1&pageSize=20") },
    { every: 30_000, run: () => session.api("GET /admin/data-hub/overview", "/admin/data-hub/overview") },
  ]
  const ingestion = (async () => {
    if (!context.workflowId) return
    await sleep(cfg.rampS * 1000)
    if (cfg.burst > 0) await Promise.all(Array.from({ length: cfg.burst }, () => ingest()))
    while (running() && cfg.ingestPerMin > 0) {
      await ingest()
      await wait(jitter(60_000 / cfg.ingestPerMin))
    }
  })()
  await Promise.all([ingestion, ...loops.map(async (loop) => {
    while (running()) {
      await loop.run()
      await wait(jitter(loop.every))
    }
  })])
}

// ---------------------------------------------------------------------------------------------
// Amostragem dos processos
// ---------------------------------------------------------------------------------------------
const series = []
function pidsByRole() {
  const roles = {}
  for (const file of readdirSync(OUT).filter((name) => name.endsWith(".pid"))) {
    const pid = Number(readFileSync(path.join(OUT, file), "utf8").trim())
    // Todos os descendentes: o PID gravado é o invólucro (nohup/sh) e o node pode estar dois níveis abaixo.
    const childrenOf = (parent) => {
      try {
        return execFileSync("pgrep", ["-P", String(parent)], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map(Number)
      } catch {
        return []
      }
    }
    const all = [pid]
    for (let index = 0; index < all.length; index++) all.push(...childrenOf(all[index]))
    roles[file.replace(".pid", "")] = all
  }
  return roles
}
function processUsage(pids) {
  if (pids.length === 0) return { cpu: 0, rssMb: 0 }
  try {
    const lines = execFileSync("ps", ["-o", "%cpu=,rss=", "-p", pids.join(",")], { encoding: "utf8" }).trim().split("\n")
    return lines.reduce((sum, line) => {
      const [cpu, rss] = line.trim().split(/\s+/).map(Number)
      return { cpu: sum.cpu + cpu, rssMb: sum.rssMb + rss / 1024 }
    }, { cpu: 0, rssMb: 0 })
  } catch {
    return { cpu: 0, rssMb: 0 }
  }
}
function postgresUsage() {
  try {
    const lines = execFileSync("ps", ["-A", "-o", "%cpu=,rss=,comm="], { encoding: "utf8" }).split("\n").filter((line) => /postgres|postmaster/.test(line))
    return lines.reduce((sum, line) => {
      const [cpu, rss] = line.trim().split(/\s+/).map(Number)
      return { cpu: sum.cpu + cpu, rssMb: sum.rssMb + rss / 1024 }
    }, { cpu: 0, rssMb: 0 })
  } catch {
    return { cpu: 0, rssMb: 0 }
  }
}
async function sampler(pool) {
  const roles = pidsByRole()
  while (Date.now() < deadline + 5_000) {
    const at = Date.now()
    const apis = await Promise.all(cfg.apiPorts.map((port) => fetch(`http://127.0.0.1:${port}/internal/metrics`).then((response) => response.json()).catch(() => null)))
    const worker = await fetch(cfg.workerHealth).then((response) => response.json()).catch(() => null)
    const connections = await pool.query(`select coalesce(application_name, '') app, count(*)::int n, count(*) filter (where state = 'active')::int active from pg_stat_activity where datname = current_database() group by 1`).then((result) => result.rows).catch(() => [])
    const usage = Object.fromEntries(Object.entries(roles).map(([role, pids]) => [role, processUsage(pids)]))
    series.push({
      t: Math.round((at - t0) / 1000),
      hostLoad1m: +loadavg()[0].toFixed(1),
      usage: { ...usage, postgres: postgresUsage() },
      apis: apis.map((metrics) => metrics && { loopP99: metrics.eventLoop?.lastWindow?.delay?.p99Ms ?? null, loopMax: metrics.eventLoop?.currentWindow?.maxMs ?? null, utilization: metrics.eventLoop?.lastWindow?.utilization ?? null, pool: metrics.pool, rssMb: metrics.memoryMb?.rss, inFlight: metrics.http?.inFlight }),
      worker: worker && { running: worker.workflowRunning, aiCalls: worker.aiCalls },
      connections,
    })
    await sleep(5_000)
  }
}

// ---------------------------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------------------------
const percentile = (values, p) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function main() {
  const pool = new pg.Pool({ connectionString: cfg.db, max: 2 })
  const operatorEmails = (await pool.query(`select email from user_accounts where email like 'operador%.demo@inia.local' and active and not password_change_required and access_disabled_at is null order by email limit $1`, [cfg.operators])).rows.map((row) => row.email)
  const supervisorEmails = (await pool.query(`select email from user_accounts where email like 'supervisor%.demo@inia.local' and active and not password_change_required and access_disabled_at is null order by email limit $1`, [cfg.supervisors])).rows.map((row) => row.email)
  const trigger = (await pool.query(`select w.id, cf.flag_name from workflows w join channel_flags cf on cf.id::text = w.trigger_config->>'channelFlagId' where w.active and w.active_version_id is not null and w.trigger_config->>'kind' = 'channel_flag' order by w.created_at limit 1`)).rows[0]
  const context = {
    workflowId: trigger?.id ?? null,
    flagName: trigger?.flag_name ?? "nota_ura",
    flagValue: Number(process.env.LT_FLAG_VALUE ?? 1),
    operatorIds: (await pool.query(`select p.id from people p join user_accounts ua on ua.person_id = p.id where ua.email like 'operador%.demo@inia.local' and p.active limit 500`)).rows.map((row) => row.id),
    transcripts: (await pool.query(`select content from transcripts where length(content) between 800 and 12000 order by random() limit 60`)).rows.map((row) => row.content),
  }
  const since = new Date().toISOString()
  process.stdout.write(`[loadtest] ${operatorEmails.length} operadores + ${supervisorEmails.length} supervisores + ${cfg.admins} admin; subida ${cfg.rampS} s, patamar ${cfg.steadyS} s; APIs ${cfg.apiPorts.join(",")}; Workflow ${context.workflowId ?? "—"} (flag ${context.flagName})\n`)
  const progress = setInterval(() => {
    const s = series.at(-1)
    process.stdout.write(`[t+${Math.round((Date.now() - t0) / 1000)}s] logins ${counters.loginsOk}/${counters.loginsOk + counters.loginsFailed} · chats ${counters.chats} (falhas ${counters.chatsFailed}) · ingeridas ${counters.ingested}${s ? ` · API cpu ${Object.entries(s.usage).filter(([k]) => k.startsWith("api")).map(([, v]) => v.cpu.toFixed(0)).join("+")}% loop p99 ${s.apis.map((a) => a?.loopP99?.toFixed?.(0)).join("/")} ms pool espera ${s.apis.map((a) => a?.pool?.waiting).join("/")} · worker ${s.worker?.running ?? "?"}` : ""}\n`)
  }, 30_000)
  await Promise.all([
    sampler(pool),
    ...operatorEmails.map((email) => operator(email)),
    ...supervisorEmails.map((email) => supervisor(email)),
    ...Array.from({ length: cfg.admins }, () => admin(cfg.adminEmail, context)),
  ])
  clearInterval(progress)
  const background = (await pool.query(`select
      (select count(*)::int from workflow_enrollments where created_at >= $1) enrollments,
      (select count(*)::int from workflow_enrollments where created_at >= $1 and status = 'completed') completed,
      (select count(*)::int from workflow_enrollments where created_at >= $1 and status in ('active', 'waiting')) in_flight,
      (select count(*)::int from workflow_enrollments where created_at >= $1 and status in ('failed', 'dead')) failed,
      (select count(*)::int from ai_usage_events where occurred_at >= $1) ai_calls,
      (select count(*)::int from ai_usage_events where occurred_at >= $1 and status <> 'SUCCESS') ai_failed,
      (select count(*)::int from feedbacks where created_at >= $1) feedbacks`, [since])).rows[0]
  await pool.end()

  const routes = [...samples].map(([key, entry]) => {
    const [phase, label] = key.split("|")
    return { phase, label, count: entry.ms.length, errors: entry.errors, client4xx: entry.client4xx, p50: percentile(entry.ms, 50), p95: percentile(entry.ms, 95), p99: percentile(entry.ms, 99), max: Math.max(...entry.ms), mbTotal: +(entry.bytes / 1e6).toFixed(1), lastError: entry.lastError }
  }).sort((a, b) => a.phase.localeCompare(b.phase) || b.count - a.count)
  const peak = (pick) => Math.max(0, ...series.map(pick).filter((value) => Number.isFinite(value)))
  const avgSteady = (pick) => {
    const values = series.filter((s) => s.t >= cfg.rampS).map(pick).filter((value) => Number.isFinite(value))
    return values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : null
  }
  const roleNames = Object.keys(series[0]?.usage ?? {})
  const resources = Object.fromEntries(roleNames.map((role) => [role, { cpuPeakPct: +peak((s) => s.usage[role]?.cpu).toFixed(0), cpuAvgSteadyPct: avgSteady((s) => s.usage[role]?.cpu), rssPeakMb: +peak((s) => s.usage[role]?.rssMb).toFixed(0) }]))
  const apiHealth = cfg.apiPorts.map((port, index) => ({ port, loopP99PeakMs: peak((s) => s.apis[index]?.loopP99), loopMaxPeakMs: peak((s) => s.apis[index]?.loopMax), utilizationPeak: peak((s) => s.apis[index]?.utilization), poolTotalPeak: peak((s) => s.apis[index]?.pool?.total), poolWaitingPeak: peak((s) => s.apis[index]?.pool?.waiting), inFlightPeak: peak((s) => s.apis[index]?.inFlight) }))
  const timeline = [...windows].sort((a, b) => a[0] - b[0]).map(([slot, ms]) => {
    const at = slot * 30
    const near = series.filter((s) => s.t >= at && s.t < at + 30)
    return { fromS: at, requests: ms.length, p50: percentile(ms, 50), p95: percentile(ms, 95), p99: percentile(ms, 99), hostLoad1m: near.length ? Math.max(...near.map((s) => s.hostLoad1m)) : null, pgCpu: near.length ? Math.max(...near.map((s) => s.usage.postgres?.cpu ?? 0)) : null }
  })
  const result = { label: cfg.label, startedAt: new Date(t0).toISOString(), config: { ...cfg, envFile: undefined }, counters, background, resources, apiHealth, timeline, routes, series }
  const file = path.join(OUT, `result-${cfg.label}-${new Date(t0).toISOString().replace(/[:.]/g, "-")}.json`)
  writeFileSync(file, JSON.stringify(result, null, 1))

  const steady = routes.filter((route) => route.phase === "steady")
  const allSteady = steady.flatMap((route) => samples.get(`steady|${route.label}`).ms)
  process.stdout.write(`\n=== RESULTADO (${cfg.label}) — ${file}\n`)
  process.stdout.write(`logins ${counters.loginsOk} ok / ${counters.loginsFailed} falhas · chats ${counters.chats} (falhas ${counters.chatsFailed}) · ingeridas ${counters.ingested}\n`)
  process.stdout.write(`patamar: ${allSteady.length} requisições · p50 ${percentile(allSteady, 50)} ms · p95 ${percentile(allSteady, 95)} ms · p99 ${percentile(allSteady, 99)} ms · erros ${steady.reduce((sum, route) => sum + route.errors, 0)}\n`)
  process.stdout.write(`recursos: ${JSON.stringify(resources)}\nAPI: ${JSON.stringify(apiHealth)}\nprocessamento: ${JSON.stringify(background)}\n\n`)
  process.stdout.write("linha do tempo (requisições curtas da API, janelas de 30 s):\n")
  for (const w of timeline) process.stdout.write(`  t+${String(w.fromS).padStart(4)}s n=${String(w.requests).padStart(5)} p50=${String(w.p50).padStart(4)} p95=${String(w.p95).padStart(5)} p99=${String(w.p99).padStart(5)} carga da máquina=${w.hostLoad1m} pg cpu=${w.pgCpu?.toFixed?.(0)}%\n`)
  for (const route of routes) process.stdout.write(`${route.phase.padEnd(6)} ${route.label.padEnd(44)} n=${String(route.count).padStart(6)} p50=${String(route.p50).padStart(6)} p95=${String(route.p95).padStart(6)} p99=${String(route.p99).padStart(6)} max=${String(route.max).padStart(6)} err=${route.errors}${route.client4xx ? ` 4xx=${route.client4xx}` : ""}${route.lastError ? ` (${route.lastError})` : ""}\n`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
