import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { AuthTokenPayload } from "../../auth/infrastructure/jwt.js"
import { buildMyJourney } from "../../people/application/my-journey.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../application/feed-service.js"
import { type DataFeedRow, type DataRunRow, type DataSourceRow } from "../application/records.js"
import { enqueueRun } from "../application/run-service.js"
import { executeRun } from "../application/run-pipeline.js"
import { createSource } from "../application/source-service.js"
import { requireDataContract } from "../domain/contract-registry.js"
import { suggestMapping } from "../domain/mapping.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, MockHttpClient } from "./fakes.js"

/**
 * ATIVIDADES ESCALADAS pela Central de Dados (banco de teste real):
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run schedule-activities-proof
 * Prova, com colunas no formato da MIS (MIS_FAT_ATIVIDADE_ESCALADO): a sugestão de mapeamento reconhece as colunas; a MESMA coluna
 * SNOATIVIDADE vira nome (como veio) e tipo (por "Mapear códigos"); nome sem tipo vai para a quarentena; a carga do dia substitui o
 * dia (pausa remarcada desativa a antiga, nunca apaga); recarga igual não muda nada; e a "Minha jornada" do operador mostra login,
 * pausas e a outra atividade na linha do tempo.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000a7a0"
const OPERATION = "de00ee00-0000-4000-8000-00000000a7a1"
const TZ = "America/Sao_Paulo"
const NOW = new Date("2026-11-17T13:00:00Z") // 10h00 em São Paulo

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let source: DataSourceRow
let activitiesFeed: DataFeedRow

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }
const identity = (fields: string[]) => ({ fields: fields.map((field) => ({ target: field, source: field, transforms: [] })) })
const MIS_HEADER = ["SNOMAMATRCOMPL", "DDTDATA_ESCALADA", "SNOATIVIDADE", "SNOINICIO", "SNOFIM"]
/** "Mapear códigos" do feed: cada nome de atividade da fonte ganha um tipo. */
const ACTIVITY_TYPES = { Logado: "LOGADO", "Pausa NR17": "PAUSA", Lanche: "PAUSA", Feedback: "OUTRA" }

async function run(feed: DataFeedRow, content: Uint8Array, filename: string): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: feed.sourceId, feedId: feed.id, filename, contentType: "text/csv", content })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  return (await executeRun(ctx, run.id))!
}

async function cleanup() {
  await db.query(`delete from data_sources where organization_id = $1`, [ORG])
  await db.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await db.query(`delete from employee_schedule_activities where organization_id = $1`, [ORG])
  await db.query(`delete from employee_schedule_days where organization_id = $1`, [ORG])
  await db.query(`delete from employee_status_periods where organization_id = $1`, [ORG])
  await db.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await db.query(`delete from people where organization_id = $1`, [ORG])
  await db.query(`delete from operations where organization_id = $1`, [ORG])
  await db.query(`delete from organizations where id = $1`, [ORG])
}

async function activityRows() {
  return (await db.query<{ activity_name: string; activity_type: string; start_time: string; end_time: string; active: boolean }>(
    `select activity_name, activity_type, to_char(start_time, 'HH24:MI') start_time, to_char(end_time, 'HH24:MI') end_time, active from employee_schedule_activities where organization_id = $1 order by start_time, activity_name`,
    [ORG],
  )).rows
}

async function operator(): Promise<AuthTokenPayload> {
  const id = (await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = 'TA-OP-01'`, [ORG])).rows[0]!.id
  return { sub: "account-ta", personId: id, organizationId: ORG, role: "OPERATOR", name: "Operadora TA", email: "ta@inia.local", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
}

describe.skipIf(!ENABLED)("Atividades escaladas — Central de Dados → Minha jornada", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    ctx = createDataHubContext(db, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => NOW } })
    await cleanup()
    await db.query(`insert into organizations (id, name, slug) values ($1, 'TA Atividades', 'ta-atividades') on conflict (id) do nothing`, [ORG])
    await db.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'TA Operação', $3) on conflict (id) do nothing`, [OPERATION, ORG, TZ])
    source = await createSource(ctx, ORG, null, { name: "TA MIS", config: { kind: "FILE_UPLOAD" } })
    const employees = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "ta-rh", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: identity(["externalEmployeeId", "name", "role", "hiredAt"]) })).id, "ACTIVATE")
    expect((await run(employees, csv([["externalEmployeeId", "name", "role", "hiredAt"], ["TA-OP-01", "Operadora TA", "OPERATOR", "2024-01-08"]]), "ta-base.csv")).status).toBe("COMPLETED")
    const days = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "escalas", name: "Escalas", contractKey: "WORK_SCHEDULE_DAYS", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "ta-escalas", cadence: { kind: "INTERVAL", minutes: 60 }, mapping: identity(["externalEmployeeId", "scheduleDate", "scheduledToWork", "shiftStart", "shiftEnd"]) })).id, "ACTIVATE")
    expect((await run(days, csv([["externalEmployeeId", "scheduleDate", "scheduledToWork", "shiftStart", "shiftEnd"], ["TA-OP-01", "2026-11-17", "true", "08:00", "14:20"]]), "ta-escalas.csv")).status).toBe("COMPLETED")

    // O mapeamento que o administrador salva: o sugerido pela tela (colunas da MIS) + a mesma SNOATIVIDADE no tipo, com "Mapear códigos".
    const suggested = suggestMapping(requireDataContract("WORK_SCHEDULE_ACTIVITIES"), MIS_HEADER)
    expect(Object.fromEntries(suggested.fields.map((field) => [field.target, field.source]))).toEqual({ externalEmployeeId: "SNOMAMATRCOMPL", scheduleDate: "DDTDATA_ESCALADA", activityName: "SNOATIVIDADE", startTime: "SNOINICIO", endTime: "SNOFIM" })
    const mapping = { fields: [...suggested.fields, { target: "activityType", source: "SNOATIVIDADE", transforms: [{ kind: "TRIM" as const }, { kind: "CODE_MAP" as const, map: ACTIVITY_TYPES, otherwise: "KEEP" as const }] }] }
    activitiesFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "atividades", name: "Atividades escaladas (MIS)", contractKey: "WORK_SCHEDULE_ACTIVITIES", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "ta-mis-atividades", cadence: { kind: "INTERVAL", minutes: 60 }, mapping })).id, "ACTIVATE")
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  it("carga no formato da MIS: nome preservado, tipo pelo 'Mapear códigos', nome sem tipo na quarentena", async () => {
    const first = await run(activitiesFeed, csv([MIS_HEADER, ["TA-OP-01", "2026-11-17", "Logado", "08:00:00", "14:20:00"], ["TA-OP-01", "2026-11-17", "Pausa NR17", "10:20:00", "10:30:00"], ["TA-OP-01", "2026-11-17", "Lanche", "11:40:00", "12:00:00"], ["TA-OP-01", "2026-11-17", "Feedback", "13:00:00", "13:20:00"], ["TA-OP-01", "2026-11-17", "Ginástica laboral", "09:00:00", "09:10:00"]]), "ta-mis-1.csv")
    expect(first).toMatchObject({ status: "PARTIAL", recordsInserted: 4, recordsRejected: 1 })
    const rejected = (await db.query<{ error_code: string; message: string }>(`select error_code, message from data_ingestion_rejections where run_id = $1`, [first.id])).rows
    expect(rejected).toEqual([expect.objectContaining({ error_code: "DATA_INVALID_ENUM" })])
    expect(rejected[0]!.message).toMatch(/Ginástica laboral/)
    expect(await activityRows()).toEqual([
      { activity_name: "Logado", activity_type: "LOGGED_IN", start_time: "08:00", end_time: "14:20", active: true },
      { activity_name: "Pausa NR17", activity_type: "BREAK", start_time: "10:20", end_time: "10:30", active: true },
      { activity_name: "Lanche", activity_type: "BREAK", start_time: "11:40", end_time: "12:00", active: true },
      { activity_name: "Feedback", activity_type: "OTHER", start_time: "13:00", end_time: "13:20", active: true },
    ])

    const journey = await buildMyJourney(db, await operator(), { now: NOW })
    expect(journey.pauses.available).toBe(true)
    const today = journey.days.find((day) => day.date === "2026-11-17")!
    expect(today).toMatchObject({ kind: "WORK", shift: { start: "08:00", end: "14:20", source: "SCHEDULE_DAY" } })
    expect(today.blocks.map((block) => [block.kind, block.label, block.startMinute, block.endMinute])).toEqual([
      ["LOGGED_IN", "Logado para atendimento", 480, 620],
      ["BREAK", "Pausa NR17", 620, 630],
      ["LOGGED_IN", "Logado para atendimento", 630, 700],
      ["BREAK", "Lanche", 700, 720],
      ["LOGGED_IN", "Logado para atendimento", 720, 780],
      ["OTHER", "Feedback", 780, 800],
      ["LOGGED_IN", "Logado para atendimento", 800, 860],
    ])
  })

  it("nova carga do dia remarca a pausa: a antiga é desativada (não apagada) e a jornada mostra só a nova; recarga igual não muda nada", async () => {
    const rows = [MIS_HEADER, ["TA-OP-01", "2026-11-17", "Logado", "08:00:00", "14:20:00"], ["TA-OP-01", "2026-11-17", "Pausa NR17", "10:40:00", "10:50:00"], ["TA-OP-01", "2026-11-17", "Lanche", "11:40:00", "12:00:00"], ["TA-OP-01", "2026-11-17", "Feedback", "13:00:00", "13:20:00"]]
    const second = await run(activitiesFeed, csv(rows), "ta-mis-2.csv")
    expect(second).toMatchObject({ status: "COMPLETED", recordsInserted: 1, recordsUnchanged: 3, recordsDeactivated: 1 })
    const all = await activityRows()
    expect(all.filter((row) => row.activity_name === "Pausa NR17")).toEqual([
      { activity_name: "Pausa NR17", activity_type: "BREAK", start_time: "10:20", end_time: "10:30", active: false },
      { activity_name: "Pausa NR17", activity_type: "BREAK", start_time: "10:40", end_time: "10:50", active: true },
    ])
    const today = (await buildMyJourney(db, await operator(), { now: NOW })).days.find((day) => day.date === "2026-11-17")!
    expect(today.activities.filter((activity) => activity.type === "BREAK").map((activity) => activity.start)).toEqual(["10:40", "11:40"])

    const third = await run(activitiesFeed, csv(rows), "ta-mis-3.csv")
    expect(third).toMatchObject({ status: "COMPLETED", recordsInserted: 0, recordsUpdated: 0, recordsUnchanged: 4, recordsDeactivated: 0 })
    expect((await activityRows()).filter((row) => row.active)).toHaveLength(4)
  })

  it("dia com linha recusada veio incompleto: nada dele é desativado (run-6 JA-01)", async () => {
    // Lanche e Feedback não vieram, e "Ginástica laboral" (sem tipo) foi para a quarentena: o dia não é o dia inteiro.
    const partial = await run(activitiesFeed, csv([MIS_HEADER, ["TA-OP-01", "2026-11-17", "Logado", "08:00:00", "14:20:00"], ["TA-OP-01", "2026-11-17", "Pausa NR17", "10:40:00", "10:50:00"], ["TA-OP-01", "2026-11-17", "Ginástica laboral", "09:00:00", "09:10:00"]]), "ta-mis-4.csv")
    expect(partial).toMatchObject({ status: "PARTIAL", recordsRejected: 1, recordsDeactivated: 0 })
    expect((await activityRows()).filter((row) => row.active).map((row) => row.activity_name)).toEqual(["Logado", "Pausa NR17", "Lanche", "Feedback"])
  })
})
