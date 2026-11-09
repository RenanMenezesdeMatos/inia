/**
 * PROVA contra o banco de teste real: o agendador da Central de Dados (`enqueueDueFeeds`) dispara nos horários escolhidos, no
 * fuso da operação, com relógio fixo. Cobre virada de dia, fim de semana, atraso pela agenda, feed gravado nas formas antigas e
 * retomada de fonte.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run cadence-schedule-proof
 * O relógio fica em 2001: nenhum feed de outra organização do banco compartilhado está vencido nessa data, então o agendador só
 * enxerga os feeds desta prova. Organização própria, apagada no fim.
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, setFeedStatus, updateFeed } from "../application/feed-service.js"
import { listSourceSummaries } from "../application/overview-service.js"
import { cancelQueuedRun, enqueueDueFeeds } from "../application/run-service.js"
import { createSource, setSourceStatus } from "../application/source-service.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000ca01"
const silent = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
const mapping = { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "name", source: "nome", transforms: [] }, { target: "role", source: "perfil", transforms: [] }] }
const connectorConfig = { connector: "API_PULL", api: { endpoint: "/colaboradores", extractPath: "data" } }

/** 05/01/2001 foi sexta. Fuso da operação desta prova: Fortaleza (UTC-3). */
const local = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`)
const WORK_WEEK = { kind: "CALENDAR", times: ["06:00", "18:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } }

let pool: pg.Pool
let ctx: DataHubContext
let clockMs = local("2001-01-05", "12:00").getTime()
let sourceId: string

async function cleanup() {
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_sources where organization_id = $1`, [ORG])
  await pool.query(`delete from operations where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

async function activeFeed(key: string, cadence: unknown): Promise<string> {
  const created = await createFeed(ctx, ORG, null, sourceId, { feedKey: key, name: `Prova ${key}`, contractKey: "EMPLOYEES", connectorConfig, mapping, cadence })
  return (await setFeedStatus(ctx, ORG, null, created.id, "ACTIVATE")).id
}

async function nextSync(feedId: string): Promise<string | null> {
  const result = await pool.query<{ next_sync_at: Date | null }>(`select next_sync_at from data_feeds where id = $1`, [feedId])
  return result.rows[0]!.next_sync_at?.toISOString() ?? null
}

async function queuedRun(feedId: string): Promise<{ id: string; trigger_kind: string } | null> {
  const result = await pool.query<{ id: string; trigger_kind: string }>(`select id, trigger_kind from data_ingestion_runs where feed_id = $1 and status = 'QUEUED'`, [feedId])
  return result.rows[0] ?? null
}

/** Roda o agendador no instante dado e cancela o que entrou na fila (só interessa QUEM foi agendado e QUANDO). */
async function tickAt(instant: Date, feedId: string): Promise<boolean> {
  clockMs = instant.getTime()
  await enqueueDueFeeds(ctx, instant)
  const run = await queuedRun(feedId)
  if (!run) return false
  expect(run.trigger_kind).toBe("SCHEDULE")
  await cancelQueuedRun(ctx, ORG, run.id, null)
  return true
}

describe.skipIf(!ENABLED)("Central de Dados — agendador com periodicidade personalizada", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova periodicidade', 'prova-periodicidade')`, [ORG])
    await pool.query(`insert into operations (organization_id, name, timezone) values ($1, 'Operação', 'America/Fortaleza')`, [ORG])
    ctx = createDataHubContext(pool as unknown as Database, { logger: silent, clock: { now: () => new Date(clockMs) }, wakeWorker: () => undefined })
    const source = await createSource(ctx, ORG, null, { name: "Prova API", config: { kind: "API_PULL", api: { baseUrl: "https://api.prova.local", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 5000 } }, secrets: { token: "prova" } })
    sourceId = source.id
    await setSourceStatus(ctx, ORG, null, sourceId, "ACTIVATE")
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("seg a sex às 06:00 e 18:00: dispara nos horários, atravessa o fim de semana sem disparar e vira o dia certo", async () => {
    clockMs = local("2001-01-05", "12:00").getTime() // sexta, 12:00
    const feedId = await activeFeed("semana", WORK_WEEK)
    expect(await nextSync(feedId)).toBe(local("2001-01-05", "18:00").toISOString())

    expect(await tickAt(local("2001-01-05", "17:59"), feedId)).toBe(false)
    expect(await tickAt(local("2001-01-05", "18:00"), feedId)).toBe(true)
    expect(await nextSync(feedId)).toBe(local("2001-01-08", "06:00").toISOString()) // segunda: pulou sábado e domingo

    expect(await tickAt(local("2001-01-06", "06:00"), feedId)).toBe(false) // sábado no horário
    expect(await tickAt(local("2001-01-06", "18:00"), feedId)).toBe(false)
    expect(await tickAt(local("2001-01-07", "23:59"), feedId)).toBe(false) // domingo, já segunda em UTC
    expect(await tickAt(local("2001-01-08", "05:59"), feedId)).toBe(false)
    expect(await tickAt(local("2001-01-08", "06:00"), feedId)).toBe(true)
    expect(await nextSync(feedId)).toBe(local("2001-01-08", "18:00").toISOString())
    expect(await tickAt(local("2001-01-08", "18:00"), feedId)).toBe(true)
    expect(await nextSync(feedId)).toBe(local("2001-01-09", "06:00").toISOString()) // virada de dia
  })

  it("o horário segue o fuso da operação, não o do servidor", async () => {
    await pool.query(`update operations set timezone = 'Asia/Tokyo' where organization_id = $1`, [ORG])
    try {
      clockMs = local("2001-01-05", "12:00").getTime()
      const feedId = await activeFeed("toquio", { kind: "CALENDAR", times: ["09:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } })
      expect(await nextSync(feedId)).toBe(new Date("2001-01-08T00:00:00Z").toISOString()) // segunda 09:00 em Tóquio
    } finally {
      await pool.query(`update operations set timezone = 'America/Fortaleza' where organization_id = $1`, [ORG])
    }
  })

  it("a cada 3 dias e último dia do mês agendam pela data, editar pela API recalcula", async () => {
    clockMs = local("2001-01-05", "12:00").getTime()
    const feedId = await activeFeed("editada", { kind: "CALENDAR", times: ["06:00"], frequency: { type: "EVERY_N_DAYS", days: 3, startDate: "2001-01-01" } })
    expect(await nextSync(feedId)).toBe(local("2001-01-07", "06:00").toISOString()) // 01, 04, 07…
    await updateFeed(ctx, ORG, null, feedId, { cadence: { kind: "CALENDAR", times: ["23:00"], frequency: { type: "MONTHLY", mode: "LAST_DAY" } } })
    expect(await nextSync(feedId)).toBe(local("2001-01-31", "23:00").toISOString())
    const stored = await pool.query<{ expected_interval_minutes: number | null }>(`select expected_interval_minutes from data_feeds where id = $1`, [feedId])
    expect(stored.rows[0]!.expected_interval_minutes).toBeNull()
  })

  it("atraso pela agenda: sucesso na sexta segue em dia no fim de semana e só atrasa no segundo horário perdido", async () => {
    clockMs = local("2001-01-05", "12:00").getTime()
    const feedId = await activeFeed("atraso", { kind: "CALENDAR", times: ["06:00"], frequency: { type: "WEEKLY", weekdays: ["MON", "TUE", "WED", "THU", "FRI"] } })
    await pool.query(`update data_feeds set last_success_at = $2 where id = $1`, [feedId, local("2001-01-05", "06:05")])
    const freshnessAt = async (instant: Date) => {
      clockMs = instant.getTime()
      const summaries = await listSourceSummaries(ctx, ORG)
      return summaries[0]!.feeds.find((feed) => feed.id === feedId)!.freshness
    }
    expect(await freshnessAt(local("2001-01-06", "12:00"))).toBe("FRESH")
    expect(await freshnessAt(local("2001-01-07", "23:59"))).toBe("FRESH")
    expect(await freshnessAt(local("2001-01-08", "12:00"))).toBe("FRESH")
    expect(await freshnessAt(local("2001-01-09", "07:01"))).toBe("STALE")
  })

  it("feeds gravados nas formas antigas seguem agendando e salvando sem reconfigurar", async () => {
    clockMs = local("2001-01-05", "12:00").getTime()
    const daily = await activeFeed("antigo-diario", { kind: "DAILY", time: "06:00" })
    const hourly = await activeFeed("antigo-hora", { kind: "INTERVAL", minutes: 60 })
    const manual = await activeFeed("antigo-manual", { kind: "MANUAL" })
    // Como a API aceitava antes do mínimo de 15 minutos: gravado direto, sem passar pela regra de escrita.
    const tiny = await activeFeed("antigo-curto", { kind: "INTERVAL", minutes: 15 })
    await pool.query(`update data_feeds set cadence = '{"kind":"INTERVAL","minutes":5}'::jsonb, expected_interval_minutes = 5 where id = $1`, [tiny])

    expect(await nextSync(daily)).toBe(local("2001-01-06", "06:00").toISOString())
    expect(await nextSync(hourly)).toBe(local("2001-01-05", "13:00").toISOString())
    expect(await nextSync(manual)).toBeNull()

    const renamed = await updateFeed(ctx, ORG, null, tiny, { name: "Prova antigo curto" })
    expect(renamed.cadence).toEqual({ kind: "INTERVAL", minutes: 5 })
    expect(await nextSync(tiny)).toBe(local("2001-01-05", "12:05").toISOString())
    await expect(updateFeed(ctx, ORG, null, tiny, { cadence: { kind: "INTERVAL", minutes: 10 } })).rejects.toMatchObject({ code: "DATA_CADENCE_TOO_FREQUENT" })
  })

  it("retomar a fonte não dispara fora do horário escolhido", async () => {
    clockMs = local("2001-01-05", "12:00").getTime()
    const weekly = await activeFeed("retomada-semana", WORK_WEEK)
    const daily = await activeFeed("retomada-diario", { kind: "DAILY", time: "06:00" })
    const hourly = await activeFeed("retomada-hora", { kind: "INTERVAL", minutes: 60 })
    const manual = await activeFeed("retomada-manual", { kind: "MANUAL" })
    await setSourceStatus(ctx, ORG, null, sourceId, "PAUSE")
    clockMs = local("2001-01-06", "14:00").getTime() // sábado à tarde
    await setSourceStatus(ctx, ORG, null, sourceId, "RESUME")
    expect(await nextSync(weekly)).toBe(local("2001-01-08", "06:00").toISOString())
    expect(await nextSync(daily)).toBe(local("2001-01-07", "06:00").toISOString())
    expect(await nextSync(hourly)).toBe(local("2001-01-06", "14:00").toISOString()) // intervalo roda em seguida, como sempre foi
    expect(await nextSync(manual)).toBeNull()
  })
})
