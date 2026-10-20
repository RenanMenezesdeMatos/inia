import express from "express"
import ExcelJS from "exceljs"
import pg from "pg"
import request from "supertest"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { createIndicatorDefinition, deleteIndicatorDefinition } from "../../indicators/application/indicator-definition-service.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, fetchSample, previewMapping, setFeedStatus, updateFeed } from "../application/feed-service.js"
import { buildOverview, buildQualityReport, lineageOf } from "../application/overview-service.js"
import { findFeed, findRun, findSource, listFeedsOfSource, type DataFeedRow, type DataRunRow, type DataSourceRow } from "../application/records.js"
import { enqueueRun, processQueuedRuns, requestManualSync, requestReprocess } from "../application/run-service.js"
import { createPushToken, createSource, rotateSourceSecrets, setSourceStatus, testSourceConnection } from "../application/source-service.js"
import { executeRun } from "../application/run-pipeline.js"
import { PgAesSecretStore } from "../infrastructure/aes-secret-store.js"
import { createDataHubRouter } from "../presentation/data-hub-router.js"
import { createDataIngestionRouter } from "../presentation/data-ingestion-router.js"
import { CapturingLogger, FakeSftpClient, json, MockHttpClient } from "./fakes.js"

/**
 * PROVA DE CONTRATO da Central de Dados contra o banco de TESTE real (migrations aplicadas):
 *   INIA_DB_PROOF=1 npx vitest run data-hub-proof
 * Cobre CSV, Excel, indicador dinâmico, API Pull (2 páginas + checkpoint), API Push
 * (Idempotency-Key), SFTP fake (dedup), quarentena, schema change → DEGRADED, segredos,
 * preview sem efeito × apply com efeito (Workflow), lineage e volume (100 mil medições).
 * Cria dados com prefixo TC-/TC_ e remove tudo ao final.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const ADMIN = { organizationId: ORG, personId: null as string | null }

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
/** Feeds autoritativos pré-existentes (fixture demo em inia_test) cedem a autoridade durante a prova e a recebem de volta. */
let previouslyAuthoritative: string[] = []
let http: MockHttpClient
let sftp: FakeSftpClient
let logger: CapturingLogger
let secretStore: PgAesSecretStore

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = (format: "CSV" | "XLSX" = "CSV") => ({ connector: "FILE_UPLOAD" as const, file: { format, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } })
const identity = (fields: string[]) => ({ fields: fields.map((field) => ({ target: field, source: field, transforms: [] })) })

async function uploadAndRun(feed: DataFeedRow, content: Uint8Array, filename: string, idempotencyKey?: string): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: feed.sourceId, feedId: feed.id, filename, contentType: filename.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv", content })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id, idempotencyKey: idempotencyKey ?? null })
  return (await executeRun(ctx, run.id))!
}

async function activeFeed(source: DataSourceRow, input: Record<string, unknown>): Promise<DataFeedRow> {
  const feed = await createFeed(ctx, ORG, null, source.id, input)
  return setFeedStatus(ctx, ORG, null, feed.id, "ACTIVATE")
}

async function rejectionsOf(runId: string): Promise<{ code: string; field: string | null; key: string | null }[]> {
  const result = await db.query<{ error_code: string; field: string | null; source_record_key: string | null }>(`select error_code, field, source_record_key from data_ingestion_rejections where run_id = $1 order by record_number`, [runId])
  return result.rows.map((row) => ({ code: row.error_code, field: row.field, key: row.source_record_key }))
}

async function xlsx(columns: string[], rows: (string | number | null)[][]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Medições")
  sheet.addRow(columns)
  for (const row of rows) sheet.addRow(row)
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}

async function cleanup() {
  await db.query(`delete from workflows where organization_id = $1 and name like 'TC %'`, [ORG])
  await db.query(`delete from goals where indicator_definition_id in (select id from indicator_definitions where organization_id = $1 and code = 'TEST_CENTRAL_RATE')`, [ORG])
  await db.query(`delete from employee_indicator_performance where indicator_definition_id in (select id from indicator_definitions where organization_id = $1 and code = 'TEST_CENTRAL_RATE')`, [ORG])
  await db.query(`delete from indicator_measurements where indicator_definition_id in (select id from indicator_definitions where organization_id = $1 and code = 'TEST_CENTRAL_RATE')`, [ORG])
  await db.query(`delete from data_sources where organization_id = $1 and name like 'TC %'`, [ORG])
  await db.query(`delete from data_raw_objects where organization_id = $1 and (source_id is null or filename like 'tc-%')`, [ORG])
  await db.query(`delete from interactions where organization_id = $1 and external_id like 'TC-%'`, [ORG])
  await db.query(`delete from indicator_measurements where organization_id = $1 and (source like 'tc%' or subject_id in (select id from people where matricula like 'TC-%'))`, [ORG])
  await db.query(`delete from employee_indicator_performance where organization_id = $1 and source like 'tc%'`, [ORG])
  await db.query(`delete from employee_prv_performance where organization_id = $1 and source like 'tc%'`, [ORG])
  await db.query(`delete from goals where organization_id = $1 and subject_id in (select id from teams where external_code like 'TC_%')`, [ORG])
  await db.query(`delete from employee_status_periods where person_id in (select id from people where organization_id = $1 and matricula like 'TC-%')`, [ORG])
  await db.query(`delete from people where organization_id = $1 and matricula like 'TC-%'`, [ORG])
  await db.query(`delete from subteams where organization_id = $1 and external_code like 'TC_%'`, [ORG])
  await db.query(`delete from teams where organization_id = $1 and external_code like 'TC_%'`, [ORG])
  const indicator = await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TEST_CENTRAL_RATE'`, [ORG])
  if (indicator.rows[0]) await deleteIndicatorDefinition(db, ORG, indicator.rows[0].id)
  const snapshot = await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = 'TEST_CENTRAL_SNAPSHOT'`, [ORG])
  if (snapshot.rows[0]) await deleteIndicatorDefinition(db, ORG, snapshot.rows[0].id)
}

describe.skipIf(!ENABLED)("Central de Dados — prova de contrato contra o banco de teste", () => {
  let groupsSource: DataSourceRow
  let employeesFeed: DataFeedRow
  let supervisorId: string

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    http = new MockHttpClient()
    sftp = new FakeSftpClient()
    logger = new CapturingLogger()
    secretStore = new PgAesSecretStore(db)
    ctx = createDataHubContext(db, { http, sftp, logger, secrets: secretStore })
    await cleanup()
    previouslyAuthoritative = (await db.query<{ id: string }>(`update data_feeds set authoritative = false where organization_id = $1 and authoritative returning id`, [ORG])).rows.map((row) => row.id)
    groupsSource = await createSource(ctx, ORG, null, { name: "TC Importação manual", config: { kind: "FILE_UPLOAD" } })
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    if (previouslyAuthoritative.length) await db.query(`update data_feeds set authoritative = true where id = any($1::uuid[])`, [previouslyAuthoritative])
    await pool.end()
  })

  // ---------------------------------------------------------------------------------------
  it("GROUPS + SUBGROUPS por CSV: cria grupos/subgrupos por código externo (nome é só apresentação)", async () => {
    const groupsFeed = await activeFeed(groupsSource, { feedKey: "grupos", name: "Grupos", contractKey: "GROUPS", connectorConfig: fileFeedConfig(), mapping: identity(["externalCode", "name", "operationName"]) })
    const run = await uploadAndRun(groupsFeed, csv([["externalCode", "name", "operationName"], ["TC_RETENCAO", "TC · Retenção", "Atendimento B2C"], ["TC_FATURAS", "TC · Faturas", ""], ["TC_NOPE", "Sem operação", "Operação Inexistente"]]), "tc-grupos.csv")
    expect(run.status).toBe("PARTIAL")
    expect(run.recordsInserted).toBe(2)
    expect(await rejectionsOf(run.id)).toEqual([{ code: "DATA_REFERENCE_NOT_FOUND", field: "operationName", key: "TC_NOPE" }])

    const subgroupsFeed = await activeFeed(groupsSource, { feedKey: "subgrupos", name: "Subgrupos", contractKey: "SUBGROUPS", connectorConfig: fileFeedConfig(), mapping: identity(["externalCode", "groupExternalCode", "name"]) })
    const subRun = await uploadAndRun(subgroupsFeed, csv([["externalCode", "groupExternalCode", "name"], ["TC_RETENCAO/PREMIUM", "TC_RETENCAO", "Premium"], ["TC_RETENCAO/MASSIVO", "TC_RETENCAO", "Massivo"]]), "tc-subgrupos.csv")
    expect(subRun.status).toBe("COMPLETED")
    expect(subRun.recordsInserted).toBe(2)
    const again = await uploadAndRun(subgroupsFeed, csv([["externalCode", "groupExternalCode", "name"], ["TC_RETENCAO/PREMIUM", "TC_RETENCAO", "Premium"], ["TC_RETENCAO/MASSIVO", "TC_RETENCAO", "Massivo"]]), "tc-subgrupos-2.csv")
    expect(again.recordsUnchanged).toBe(2)
    expect(again.recordsInserted).toBe(0)
  })

  it("EMPLOYEES por CSV (25 colaboradores): insert, update, idempotência, gestor na mesma carga, quarentena por referência", async () => {
    employeesFeed = await activeFeed(groupsSource, {
      feedKey: "colaboradores",
      name: "Colaboradores",
      contractKey: "EMPLOYEES",
      connectorConfig: fileFeedConfig(),
      authoritative: true,
      mapping: {
        fields: [
          { target: "externalEmployeeId", source: "matricula", transforms: [{ kind: "TRIM" }] },
          { target: "name", source: "nome", transforms: [{ kind: "TRIM" }] },
          { target: "role", source: "perfil", transforms: [{ kind: "CODE_MAP", map: { Atendente: "OPERATOR", Supervisor: "SUPERVISOR" }, otherwise: "KEEP" }] },
          { target: "groupExternalCode", source: "grupo", transforms: [] },
          { target: "subgroupExternalCode", source: "subgrupo", transforms: [] },
          { target: "reportsToExternalId", source: "gestor", transforms: [] },
          { target: "hiredAt", source: "admissao", transforms: [{ kind: "PARSE_DATE", format: "dd/MM/yyyy" }] },
          { target: "active", source: "ativo", transforms: [] },
        ],
      },
    })
    const header = ["matricula", "nome", "perfil", "grupo", "subgrupo", "gestor", "admissao", "ativo"]
    const rows = [["TC-SUP-01", "Supervisora TC", "Supervisor", "TC_RETENCAO", "", "", "02/08/2021", "sim"]]
    for (let index = 1; index <= 24; index += 1) rows.push([`TC-OP-${String(index).padStart(2, "0")}`, `Operador TC ${index}`, "Atendente", "TC_RETENCAO", index % 2 ? "TC_RETENCAO/PREMIUM" : "TC_RETENCAO/MASSIVO", "TC-SUP-01", "11/03/2024", "sim"])
    const first = await uploadAndRun(employeesFeed, csv([header, ...rows]), "tc-colaboradores.csv")
    expect(first.status).toBe("COMPLETED")
    expect(first.recordsReceived).toBe(25)
    expect(first.recordsInserted).toBe(25)
    const people = await db.query<{ id: string; matricula: string; reports_to_id: string | null; subteam_id: string | null }>(`select id, matricula, reports_to_id, subteam_id from people where organization_id = $1 and matricula like 'TC-%' order by matricula`, [ORG])
    expect(people.rows).toHaveLength(25)
    supervisorId = people.rows.find((row) => row.matricula === "TC-SUP-01")!.id
    expect(people.rows.filter((row) => row.matricula.startsWith("TC-OP")).every((row) => row.reports_to_id === supervisorId)).toBe(true)

    // Mesmo arquivo de novo → nada muda; mesmo checksum com Idempotency-Key devolve o mesmo Run.
    const second = await uploadAndRun(employeesFeed, csv([header, ...rows]), "tc-colaboradores-2.csv")
    expect(second.status).toBe("COMPLETED")
    expect(second.recordsUnchanged).toBe(25)
    expect(second.recordsInserted + second.recordsUpdated).toBe(0)

    // Atualização de um nome + uma linha com grupo inexistente + uma com gestor desconhecido.
    rows[1]![1] = "Operador TC 1 (renomeado)"
    const third = await uploadAndRun(employeesFeed, csv([header, ...rows, ["TC-OP-99", "Sem grupo", "Atendente", "TC_INEXISTENTE", "", "TC-SUP-01", "01/01/2025", "sim"], ["TC-OP-98", "Sem gestor", "Atendente", "TC_RETENCAO", "", "TC-SUP-77", "01/01/2025", "sim"]]), "tc-colaboradores-3.csv")
    expect(third.status).toBe("PARTIAL")
    expect(third.recordsUpdated).toBe(1)
    expect(third.recordsUnchanged).toBe(24)
    expect(third.recordsRejected).toBe(2)
    expect(await rejectionsOf(third.id)).toEqual([
      { code: "DATA_GROUP_NOT_FOUND", field: "groupExternalCode", key: "TC-OP-99" },
      { code: "DATA_EMPLOYEE_NOT_FOUND", field: "reportsToExternalId", key: "TC-OP-98" },
    ])
    // Ausência NÃO é delete: TC-OP-24 fora de uma carga parcial continua ativo.
    const partial = await uploadAndRun(employeesFeed, csv([header, rows[1]!]), "tc-colaboradores-4.csv")
    expect(partial.status).toBe("COMPLETED")
    const stillActive = await db.query<{ active: boolean }>(`select active from people where organization_id = $1 and matricula = 'TC-OP-24'`, [ORG])
    expect(stillActive.rows[0]?.active).toBe(true)
    // Lineage responde "de onde veio" a pessoa renomeada.
    const renamed = people.rows.find((row) => row.matricula === "TC-OP-01")!
    const lineage = await lineageOf(ctx, ORG, "people", renamed.id)
    expect(lineage.map((entry) => entry.action)).toEqual(["UPDATED", "INSERTED"])
    expect(lineage[0]?.sourceRecordKey).toBe("TC-OP-01")
  })

  it("V1.5.7 — importar/alterar colaborador NUNCA mexe em acesso: 'ADMIN' vai para a quarentena; Atendente→Supervisor→Atendente não cria nem apaga papel", async () => {
    const header = ["matricula", "nome", "perfil", "grupo", "subgrupo", "gestor", "admissao", "ativo"]
    const person = await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = 'TC-OP-02'`, [ORG])
    const account = await db.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, 'tc-op-02-access@inia.local', 'x') returning id`, [ORG, person.rows[0]!.id])
    await db.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'QA_DE_FEEDBACK', 'MY_STRUCTURE', now())`, [ORG, account.rows[0]!.id])
    const accessRows = async () => (await db.query(`select a.role_code, a.scope_type, a.revoked_at is null active from access_role_assignments a join user_accounts ua on ua.id = a.user_account_id join people p on p.id = ua.person_id where p.organization_id = $1 and p.matricula like 'TC-%' order by p.matricula`, [ORG])).rows
    expect(await accessRows()).toEqual([{ role_code: "QA_DE_FEEDBACK", scope_type: "MY_STRUCTURE", active: true }])
    const row = (matricula: string, perfil: string) => [matricula, `Pessoa ${matricula}`, perfil, "TC_RETENCAO", "", "TC-SUP-01", "11/03/2024", "sim"]
    const withAdmin = await uploadAndRun(employeesFeed, csv([header, row("TC-OP-02", "Supervisor"), row("TC-ADM-01", "ADMIN")]), "tc-acesso-1.csv")
    expect(withAdmin.recordsRejected).toBe(1)
    expect(await rejectionsOf(withAdmin.id)).toEqual([{ code: "DATA_INVALID_ENUM", field: "role", key: "TC-ADM-01" }])
    expect((await db.query(`select role from people where organization_id = $1 and matricula = 'TC-OP-02'`, [ORG])).rows[0]).toEqual({ role: "SUPERVISOR" })
    expect(await accessRows()).toEqual([{ role_code: "QA_DE_FEEDBACK", scope_type: "MY_STRUCTURE", active: true }])
    await uploadAndRun(employeesFeed, csv([header, row("TC-OP-02", "Atendente")]), "tc-acesso-2.csv")
    expect(await accessRows()).toEqual([{ role_code: "QA_DE_FEEDBACK", scope_type: "MY_STRUCTURE", active: true }])
    expect((await db.query(`select count(*)::int n from people where organization_id = $1 and matricula = 'TC-ADM-01'`, [ORG])).rows[0]).toEqual({ n: 0 })
    await db.query(`delete from access_role_assignments where user_account_id = $1`, [account.rows[0]!.id])
    await db.query(`delete from user_accounts where id = $1`, [account.rows[0]!.id])
  })

  it("segundo feed autoritativo ativo para EMPLOYEES é bloqueado (uma fonte master por dataset)", async () => {
    await expect(createFeed(ctx, ORG, null, groupsSource.id, { feedKey: "colaboradores-2", name: "Outro", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig(), authoritative: true, mapping: identity(["externalEmployeeId", "name", "role"]) })).rejects.toMatchObject({ code: "DATA_FEED_AUTHORITATIVE_CONFLICT" })
  })

  // ---------------------------------------------------------------------------------------
  it("indicador dinâmico TEST_CENTRAL_RATE (PERCENT/HIGHER/RATE) recebe medições por Excel sem código específico; componentes vêm da estratégia", async () => {
    await createIndicatorDefinition(db, ORG, { code: "TEST_CENTRAL_RATE", name: "Taxa Central (teste)", unit: "PERCENT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "RATE", officialClosureSupported: true })
    const feed = await activeFeed(groupsSource, {
      feedKey: "medicoes",
      name: "Medições",
      contractKey: "INDICATOR_MEASUREMENTS",
      connectorConfig: fileFeedConfig("XLSX"),
      sourceNamespace: "tc-medicoes",
      mapping: identity(["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"]),
    })
    const content = await xlsx(
      ["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"],
      [
        ["TC-OP-01", "TEST_CENTRAL_RATE", "2026-09-14", 80, 16, 20],
        ["TC-OP-02", "TEST_CENTRAL_RATE", "2026-09-14", 50, 10, 20],
        ["TC-OP-03", "TEST_CENTRAL_RATE", "2026-09-14", 90, 9, 20], // valor incoerente com num/den
        ["TC-OP-04", "TEST_CENTRAL_RATE", "2026-09-14", 75, 15, null], // denominador exigido pela estratégia RATE
        ["TC-OP-05", "NAO_EXISTE", "2026-09-14", 10, 1, 10],
        ["TC-OP-77", "TEST_CENTRAL_RATE", "2026-09-14", 10, 1, 10],
        ["TC-OP-01", "TEST_CENTRAL_RATE", "2026-09-14", 80, 16, 20], // duplicado na carga
      ],
    )
    const run = await uploadAndRun(feed, content, "tc-medicoes.xlsx")
    expect(run.status).toBe("PARTIAL")
    expect(run.recordsInserted).toBe(2)
    expect(run.recordsRejected).toBe(5)
    expect(run.businessMaxEventTime).toBe("2026-09-15T03:00:00.000Z")
    expect((await rejectionsOf(run.id)).map((row) => row.code)).toEqual(["DATA_CONTRACT_VIOLATION", "DATA_COMPONENT_MISSING", "DATA_INDICATOR_NOT_FOUND", "DATA_EMPLOYEE_NOT_FOUND", "DATA_DUPLICATE"])
    const stored = await db.query<{ value: string; numerator: string; granularity: string; source: string }>(
      `select m.value, m.numerator, m.granularity, m.source from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id where i.code = 'TEST_CENTRAL_RATE' order by m.value`,
    )
    expect(stored.rows.map((row) => [Number(row.value), Number(row.numerator), row.granularity, row.source])).toEqual([[50, 10, "DAILY", "tc-medicoes"], [80, 16, "DAILY", "tc-medicoes"]])
    // Amostra de arquivo e sugestão de mapping por nome (sem IA).
    const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: groupsSource.id, feedId: feed.id, filename: "tc-amostra.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content })
    const sample = await fetchSample(ctx, ORG, { source: groupsSource, feed, connectorConfig: feed.connectorConfig, contractKey: "INDICATOR_MEASUREMENTS", rawObjectId: raw.id })
    expect(sample.sheets).toEqual(["Medições"])
    expect(sample.suggestedMapping.fields.map((field) => field.target)).toEqual(expect.arrayContaining(["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"]))
  })

  it("preview NUNCA dispara Workflow; apply matricula pelo mesmo caminho canônico; reprocesso não duplica", async () => {
    const workflowId = (await db.query<{ id: string }>(`insert into workflows (organization_id, name, scope_type, trigger_config, active) values ($1, 'TC Workflow indicador', 'ALL_TEAMS', $2, true) returning id`, [ORG, JSON.stringify({ kind: "indicator", indicatorCode: "TEST_CENTRAL_RATE" })])).rows[0]!.id
    const versionId = (await db.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id`, [workflowId, JSON.stringify({ nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: {} }], edges: [] })])).rows[0]!.id
    await db.query(`update workflows set active_version_id = $2 where id = $1`, [workflowId, versionId])
    const feed = (await listFeedsOfSource(db, ORG, groupsSource.id)).find((entry) => entry.feedKey === "medicoes")!
    const enrollments = async () => Number((await db.query<{ c: number }>(`select count(*)::int c from workflow_enrollments where workflow_id = $1`, [workflowId])).rows[0]!.c)

    const preview = await previewMapping(ctx, ORG, { source: groupsSource, feed, contractKey: "INDICATOR_MEASUREMENTS", mapping: feed.mapping, sample: { columns: ["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"], records: [{ externalEmployeeId: "TC-OP-06", indicatorCode: "TEST_CENTRAL_RATE", date: "2026-09-15", value: 60, numerator: 12, denominator: 20 }, { externalEmployeeId: "TC-OP-77", indicatorCode: "TEST_CENTRAL_RATE", date: "2026-09-15", value: 60, numerator: 12, denominator: 20 }] } })
    expect(preview.valid).toBe(1)
    expect(preview.rejected).toBe(1)
    expect(preview.rows[1]?.errors[0]?.code).toBe("DATA_EMPLOYEE_NOT_FOUND")
    expect(await enrollments()).toBe(0)
    expect(Number((await db.query<{ c: number }>(`select count(*)::int c from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id where i.code = 'TEST_CENTRAL_RATE' and m.source = 'tc-medicoes'`)).rows[0]!.c)).toBe(2)

    const content = await xlsx(["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"], [["TC-OP-06", "TEST_CENTRAL_RATE", "2026-09-15", 60, 12, 20]])
    const run = await uploadAndRun(feed, content, "tc-medicoes-wf.xlsx")
    expect(run.status).toBe("COMPLETED")
    expect(await enrollments()).toBe(1)
    const reprocess = await requestReprocess(ctx, ORG, run.id, null)
    const reprocessed = (await executeRun(ctx, reprocess.id))!
    expect(reprocessed.recordsUnchanged).toBe(1)
    expect(await enrollments()).toBe(1)
  }, 30_000)

  // ---------------------------------------------------------------------------------------
  it("API Pull: Bearer, 2 páginas, checkpoint por watermark; segunda sync não duplica; auth inválida vira erro claro sem vazar o token", async () => {
    const TOKEN = "tc-secret-token-XYZ123"
    const measurements = Array.from({ length: 5 }, (_, index) => ({ matricula: `TC-OP-${String(index + 1).padStart(2, "0")}`, indicador: "TEST_CENTRAL_RATE", dia: "2026-09-13", valor: 50 + index * 5, num: 10 + index, den: 20, atualizadoEm: `2026-09-13T10:0${index}:00Z` }))
    http.on("/medicoes", (req, url) => {
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: "unauthorized" })
      const since = url.searchParams.get("since")
      const page = Number(url.searchParams.get("page") ?? "1")
      const filtered = since ? measurements.filter((row) => row.atualizadoEm > since) : measurements
      const pageSize = 3
      return json(200, { data: filtered.slice((page - 1) * pageSize, page * pageSize), page })
    })
    http.on("/", () => json(200, { ok: true }))
    const source = await createSource(ctx, ORG, null, { name: "TC API Operacional", config: { kind: "API_PULL", api: { baseUrl: "https://api.tc.local", auth: { kind: "BEARER" }, headers: {}, timeoutMs: 5000 } }, secrets: { token: TOKEN } })
    expect(JSON.stringify(source)).not.toContain(TOKEN)
    const test = await testSourceConnection(ctx, ORG, null, source.id)
    expect(test.health).toBe("HEALTHY")
    await setSourceStatus(ctx, ORG, null, source.id, "ACTIVATE")
    const feed = await activeFeed(source, {
      feedKey: "medicoes",
      name: "Medições API",
      contractKey: "INDICATOR_MEASUREMENTS",
      sourceNamespace: "tc-api",
      cadence: { kind: "INTERVAL", minutes: 15 },
      connectorConfig: { connector: "API_PULL", api: { endpoint: "/medicoes", extractPath: "data", pagination: { kind: "PAGE_NUMBER", pageParam: "page", pageSize: 3, startPage: 1 }, checkpoint: { kind: "WATERMARK", sourceField: "atualizadoEm", requestParam: "since" } } },
      mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "indicatorCode", source: "indicador", transforms: [] }, { target: "date", source: "dia", transforms: [] }, { target: "value", source: "valor", transforms: [] }, { target: "numerator", source: "num", transforms: [] }, { target: "denominator", source: "den", transforms: [] }] },
    })
    expect(feed.nextSyncAt).not.toBeNull()
    const sample = await fetchSample(ctx, ORG, { source, feed, connectorConfig: feed.connectorConfig, contractKey: "INDICATOR_MEASUREMENTS" })
    expect(sample.records).toHaveLength(5)

    const queued = await requestManualSync(ctx, ORG, feed.id, null)
    const first = (await executeRun(ctx, queued.id))!
    expect(first.status).toBe("COMPLETED")
    expect(first.recordsReceived).toBe(5)
    expect(first.recordsInserted).toBe(5)
    expect(first.checkpointAfter).toMatchObject({ watermark: "2026-09-13T10:04:00Z" })
    const afterFirst = (await findFeed(db, ORG, feed.id))!
    expect(afterFirst.checkpoint).toMatchObject({ watermark: "2026-09-13T10:04:00Z" })
    expect(afterFirst.lastSuccessAt).not.toBeNull()
    expect(afterFirst.lastDataAt).toBe("2026-09-14T03:00:00.000Z")

    const second = (await executeRun(ctx, (await requestManualSync(ctx, ORG, feed.id, null)).id))!
    expect(second.status).toBe("COMPLETED")
    expect(second.recordsReceived).toBe(0)
    expect(http.requests.some((req) => new URL(req.url).searchParams.get("since") === "2026-09-13T10:04:00Z")).toBe(true)
    expect(Number((await db.query<{ c: number }>(`select count(*)::int c from indicator_measurements m join indicator_definitions i on i.id = m.indicator_definition_id where i.code = 'TEST_CENTRAL_RATE' and m.source = 'tc-api'`)).rows[0]!.c)).toBe(5)
    expect((await findSource(db, ORG, source.id))!.connectionHealth).toBe("HEALTHY")

    // Credencial errada: run FAILED com código estável, fonte em ERRO, log sem o segredo.
    await rotateSourceSecrets(ctx, ORG, null, source.id, { token: "tc-wrong-token-999" })
    const failed = (await executeRun(ctx, (await requestManualSync(ctx, ORG, feed.id, null)).id))!
    expect(failed.status).toBe("FAILED")
    expect(failed.errorCode).toBe("DATA_SOURCE_AUTH_FAILED")
    const erroredSource = (await findSource(db, ORG, source.id))!
    expect(erroredSource.connectionHealth).toBe("ERROR")
    expect(erroredSource.status).toBe("ERROR")
    const text = logger.text()
    expect(text).not.toContain(TOKEN)
    expect(text).not.toContain("tc-wrong-token-999")
    // Cifra em repouso: nenhuma linha de data_secrets contém o texto puro.
    const secretRows = await db.query<{ ciphertext: Buffer }>(`select ciphertext from data_secrets where source_id = $1`, [source.id])
    expect(secretRows.rows.length).toBeGreaterThan(0)
    for (const row of secretRows.rows) expect(row.ciphertext.toString("utf8")).not.toContain("tc-")
  })

  // ---------------------------------------------------------------------------------------
  it("API Push: token, Idempotency-Key (mesmo lote 2× → 1 aplicação), interações + transcrição + flags pelos mesmos efeitos do domínio", async () => {
    const source = await createSource(ctx, ORG, null, { name: "TC API Atendimento (push)", config: { kind: "API_PUSH" } })
    await setSourceStatus(ctx, ORG, null, source.id, "ACTIVATE")
    const interactions = await activeFeed(source, { feedKey: "interacoes", name: "Interações", contractKey: "INTERACTIONS", connectorConfig: { connector: "API_PUSH", push: { extractPath: "records" } }, mapping: identity(["externalInteractionId", "externalEmployeeId", "channel", "reason", "startedAt", "endedAt", "transcriptContent"]) })
    const flags = await activeFeed(source, { feedKey: "flags", name: "Flags", contractKey: "INTERACTION_FLAGS", connectorConfig: { connector: "API_PUSH", push: { extractPath: "records" } }, mapping: identity(["externalInteractionId", "flagName", "value"]) })
    const { token } = await createPushToken(ctx, ORG, null, source.id, { label: "Integração TC" })
    const app = express()
    app.use("/api/v1/data-ingestion", createDataIngestionRouter(db, { http, sftp, logger, secrets: secretStore }))
    app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next
      if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
    })

    const payload = { records: [{ externalInteractionId: "TC-CALL-1", externalEmployeeId: "TC-OP-01", channel: "VOICE", reason: "Cancelamento", startedAt: "2026-09-15T14:00:00-03:00", endedAt: "2026-09-15T14:10:00-03:00", transcriptContent: "Operador: bom dia. Cliente: quero cancelar o plano hoje mesmo." }] }
    const unauthorized = await request(app).post(`/api/v1/data-ingestion/${source.publicId}/interacoes`).send(payload)
    expect(unauthorized.status).toBe(401)
    const first = await request(app).post(`/api/v1/data-ingestion/${source.publicId}/interacoes`).set("authorization", `Bearer ${token}`).set("idempotency-key", "lote-001").send(payload)
    expect(first.status).toBe(202)
    const second = await request(app).post(`/api/v1/data-ingestion/${source.publicId}/interacoes`).set("authorization", `Bearer ${token}`).set("idempotency-key", "lote-001").send(payload)
    expect(second.status).toBe(202)
    expect(second.body.data.runId).toBe(first.body.data.runId)
    expect(second.body.data.deduplicated).toBe(true)
    // R-29: a mesma chave com OUTRO corpo é recusada (antes devolvia a carga antiga em silêncio e o lote novo se perdia);
    // sem token válido, nem o corpo é lido (JSON quebrado recebe 401, não 400).
    const ingest = (bearer: string) => request(app).post(`/api/v1/data-ingestion/${source.publicId}/interacoes`).set("authorization", `Bearer ${bearer}`)
    const changed = await ingest(token).set("idempotency-key", "lote-001").send({ records: [{ ...payload.records[0]!, reason: "Outro motivo" }] })
    expect(changed.status).toBe(422)
    expect(changed.body.error.code).toBe("DATA_PUSH_IDEMPOTENCY_CONFLICT")
    const garbage = await ingest("inia_push_inexistente").set("content-type", "application/json").send("{ isto não é json")
    expect(garbage.status).toBe(401)
    // R-28: token vencido ou chamado de fora das redes autorizadas recebe a mesma recusa de um token inexistente.
    const expiring = await createPushToken(ctx, ORG, null, source.id, { label: "TC vencido", expiresInDays: 1 })
    expect(Date.parse(expiring.view.expiresAt!)).toBeGreaterThan(Date.now())
    await db.query(`update data_push_tokens set expires_at = now() - interval '1 minute' where id = $1`, [expiring.view.id])
    expect((await ingest(expiring.token).set("idempotency-key", "lote-001").send(payload)).status).toBe(401)
    const elsewhere = await createPushToken(ctx, ORG, null, source.id, { label: "TC outra rede", allowedNetworks: ["203.0.113.0/24"] })
    expect(elsewhere.view.allowedNetworks).toEqual(["203.0.113.0/24"])
    expect((await ingest(elsewhere.token).set("idempotency-key", "lote-001").send(payload)).status).toBe(401)
    const local = await createPushToken(ctx, ORG, null, source.id, { label: "TC rede local", allowedNetworks: ["127.0.0.1", "::1"] })
    const fromLocal = await ingest(local.token).set("idempotency-key", "lote-001").send(payload)
    expect(fromLocal.status).toBe(202)
    expect(fromLocal.body.data).toMatchObject({ runId: first.body.data.runId, deduplicated: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    await processQueuedRuns(ctx)
    const run = (await findRun(db, ORG, first.body.data.runId))!
    expect(run.status).toBe("COMPLETED")
    expect(run.triggerKind).toBe("PUSH")
    expect(run.recordsInserted).toBe(1)
    const interaction = await db.query<{ id: string }>(`select id from interactions where organization_id = $1 and external_id = 'TC-CALL-1'`, [ORG])
    expect(interaction.rows).toHaveLength(1)
    expect((await db.query(`select 1 from transcripts where interaction_id = $1`, [interaction.rows[0]!.id])).rowCount).toBe(1)

    // Flags: Workflow por flag "rechamada" é matriculado exatamente como na ingestão em tempo real.
    const flagId = (await db.query<{ id: string }>(`select id from channel_flags where organization_id = $1 and channel = 'VOICE' and flag_name = 'rechamada'`, [ORG])).rows[0]!.id
    const workflowId = (await db.query<{ id: string }>(`insert into workflows (organization_id, name, scope_type, trigger_config, active) values ($1, 'TC Workflow flag', 'ALL_TEAMS', $2, true) returning id`, [ORG, JSON.stringify({ kind: "channel_flag", channelFlagId: flagId })])).rows[0]!.id
    const versionId = (await db.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id`, [workflowId, JSON.stringify({ nodes: [{ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: {} }], edges: [] })])).rows[0]!.id
    await db.query(`update workflows set active_version_id = $2 where id = $1`, [workflowId, versionId])
    const flagsRun = await request(app).post(`/api/v1/data-ingestion/${source.publicId}/${flags.feedKey}`).set("authorization", `Bearer ${token}`).send({ records: [{ externalInteractionId: "TC-CALL-1", flagName: "rechamada", value: "true" }, { externalInteractionId: "TC-CALL-1", flagName: "flag_inexistente", value: "1" }, { externalInteractionId: "TC-CALL-404", flagName: "rechamada", value: "true" }] })
    expect(flagsRun.status).toBe(202)
    await new Promise((resolve) => setTimeout(resolve, 50))
    await processQueuedRuns(ctx)
    const flagRunRow = (await findRun(db, ORG, flagsRun.body.data.runId))!
    expect(flagRunRow.status).toBe("PARTIAL")
    expect((await rejectionsOf(flagRunRow.id)).map((row) => row.code)).toEqual(["DATA_FLAG_NOT_FOUND", "DATA_INTERACTION_NOT_FOUND"])
    expect(Number((await db.query<{ c: number }>(`select count(*)::int c from workflow_enrollments where workflow_id = $1`, [workflowId])).rows[0]!.c)).toBe(1)
    expect(interactions.id).toBeTruthy()
  })

  // ---------------------------------------------------------------------------------------
  it("INTERACTIONS@2 por CSV: motivo + submotivo gravados; sem submotivo mantém o recebido; submotivo longo vai para a quarentena; feed @1 segue sem submotivo", async () => {
    const columns = ["externalInteractionId", "externalEmployeeId", "reason", "subReason", "startedAt", "endedAt"]
    const feed = await activeFeed(groupsSource, { feedKey: "interacoes-submotivo", name: "Interações com submotivo", contractKey: "INTERACTIONS", connectorConfig: fileFeedConfig(), mapping: identity(columns) })
    expect(feed.contractVersion).toBe(2)
    const first = await uploadAndRun(feed, csv([
      columns,
      ["TC-SUB-1", "TC-OP-01", "Fatura", "Segunda via", "2026-09-15T14:00:00-03:00", "2026-09-15T14:06:00-03:00"],
      ["TC-SUB-2", "TC-OP-01", "Fatura", "", "2026-09-15T15:00:00-03:00", "2026-09-15T15:04:00-03:00"],
      ["TC-SUB-3", "TC-OP-01", "Fatura", "x".repeat(201), "2026-09-15T16:00:00-03:00", "2026-09-15T16:04:00-03:00"],
    ]), "tc-interacoes-submotivo.csv")
    expect(first.status).toBe("PARTIAL")
    expect(first.recordsInserted).toBe(2)
    expect(await rejectionsOf(first.id)).toEqual([{ code: "DATA_TYPE_INVALID", field: "subReason", key: "TC-SUB-3" }])
    const stored = async () => (await db.query<{ external_id: string; reason: string; sub_reason: string | null }>(`select external_id, reason, sub_reason from interactions where organization_id = $1 and external_id like 'TC-SUB-%' order by external_id`, [ORG])).rows
    expect(await stored()).toEqual([{ external_id: "TC-SUB-1", reason: "Fatura", sub_reason: "Segunda via" }, { external_id: "TC-SUB-2", reason: "Fatura", sub_reason: null }])

    // Mesma carga sem o submotivo: nada muda (vazio mantém); submotivo novo atualiza.
    const second = await uploadAndRun(feed, csv([
      columns,
      ["TC-SUB-1", "TC-OP-01", "Fatura", "", "2026-09-15T14:00:00-03:00", "2026-09-15T14:06:00-03:00"],
      ["TC-SUB-2", "TC-OP-01", "Fatura", "Dúvidas sobre faturamento", "2026-09-15T15:00:00-03:00", "2026-09-15T15:04:00-03:00"],
    ]), "tc-interacoes-submotivo-2.csv")
    expect(second.status).toBe("COMPLETED")
    expect(second.recordsUnchanged).toBe(1)
    expect(second.recordsUpdated).toBe(1)
    expect(await stored()).toEqual([{ external_id: "TC-SUB-1", reason: "Fatura", sub_reason: "Segunda via" }, { external_id: "TC-SUB-2", reason: "Fatura", sub_reason: "Dúvidas sobre faturamento" }])

    // Feed criado na versão 1 continua nela: não conhece submotivo e não apaga o que a versão 2 gravou.
    const v1Columns = ["externalInteractionId", "externalEmployeeId", "reason", "startedAt", "endedAt"]
    const legacy = await activeFeed(groupsSource, { feedKey: "interacoes-v1", name: "Interações (v1)", contractKey: "INTERACTIONS", contractVersion: 1, connectorConfig: fileFeedConfig(), mapping: identity(v1Columns) })
    expect(legacy.contractVersion).toBe(1)
    const legacyRun = await uploadAndRun(legacy, csv([v1Columns, ["TC-SUB-1", "TC-OP-01", "Fatura", "2026-09-15T14:00:00-03:00", "2026-09-15T14:06:00-03:00"], ["TC-SUB-4", "TC-OP-01", "Cancelamento", "2026-09-15T17:00:00-03:00", "2026-09-15T17:05:00-03:00"]]), "tc-interacoes-v1.csv")
    expect(legacyRun.status).toBe("COMPLETED")
    expect(legacyRun.recordsUnchanged).toBe(1)
    expect(legacyRun.recordsInserted).toBe(1)
    expect((await stored()).map((row) => [row.external_id, row.sub_reason])).toEqual([["TC-SUB-1", "Segunda via"], ["TC-SUB-2", "Dúvidas sobre faturamento"], ["TC-SUB-4", null]])
  })

  // ---------------------------------------------------------------------------------------
  it("SFTP (fake): arquivo do pattern é processado uma vez; segunda poll não baixa nem duplica; senha errada é DATA_SOURCE_AUTH_FAILED", async () => {
    sftp.put("/in/employees_2026-09-15.csv", "matricula;nome;perfil\nTC-OP-30;Novo pelo SFTP;OPERATOR\n")
    sftp.put("/in/outro_arquivo.txt", "ignorar")
    const source = await createSource(ctx, ORG, null, { name: "TC SFTP Corporativo", config: { kind: "SFTP", sftp: { host: "sftp.tc.local", port: 22, username: "inia", remoteDirectory: "/in", authKind: "PASSWORD", timeoutMs: 5000 } }, secrets: { password: "tc-sftp-pass" } })
    expect((await testSourceConnection(ctx, ORG, null, source.id)).health).toBe("HEALTHY")
    await setSourceStatus(ctx, ORG, null, source.id, "ACTIVATE")
    const feed = await activeFeed(source, {
      feedKey: "colaboradores-sftp",
      name: "Colaboradores via SFTP",
      contractKey: "EMPLOYEES",
      cadence: { kind: "DAILY", time: "06:00" },
      connectorConfig: { connector: "SFTP", sftp: { filePattern: "employees_*.csv", format: "CSV", csv: { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } },
      mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "name", source: "nome", transforms: [] }, { target: "role", source: "perfil", transforms: [] }] },
    })
    const first = (await executeRun(ctx, (await requestManualSync(ctx, ORG, feed.id, null)).id))!
    expect(first.status).toBe("COMPLETED")
    expect(first.recordsInserted).toBe(1)
    expect(sftp.downloads).toEqual(["/in/employees_2026-09-15.csv"])
    const second = (await executeRun(ctx, (await requestManualSync(ctx, ORG, feed.id, null)).id))!
    expect(second.status).toBe("COMPLETED")
    expect(second.recordsReceived).toBe(0)
    expect(sftp.downloads).toHaveLength(1)
    expect((await db.query(`select 1 from data_processed_files where feed_id = $1`, [feed.id])).rowCount).toBe(1)

    sftp.authFailure = true
    const failed = (await executeRun(ctx, (await requestManualSync(ctx, ORG, feed.id, null)).id))!
    expect(failed.status).toBe("FAILED")
    expect(failed.errorCode).toBe("DATA_SOURCE_AUTH_FAILED")
    expect(logger.text()).not.toContain("tc-sftp-pass")
    sftp.authFailure = false
  })

  // ---------------------------------------------------------------------------------------
  it("mudança de esquema: coluna obrigatória some → Run FAILED DATA_SCHEMA_CHANGED e feed DEGRADED", async () => {
    const run = await uploadAndRun(employeesFeed, csv([["matricula", "perfil"], ["TC-OP-01", "Atendente"]]), "tc-schema.csv")
    expect(run.status).toBe("FAILED")
    expect(run.errorCode).toBe("DATA_SCHEMA_CHANGED")
    expect(run.errorMessage).toMatch(/"nome"/)
    const feed = (await findFeed(db, ORG, employeesFeed.id))!
    expect(feed.status).toBe("DEGRADED")
    expect(feed.schemaChangedAt).not.toBeNull()
    // Corrigir o mapeamento e reativar limpa a degradação.
    await updateFeed(ctx, ORG, null, employeesFeed.id, { mapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "name", source: "nome", transforms: [] }, { target: "role", source: "perfil", transforms: [] }] } })
    const reactivated = await setFeedStatus(ctx, ORG, null, employeesFeed.id, "ACTIVATE")
    expect(reactivated.status).toBe("ACTIVE")
    expect(reactivated.schemaChangedAt).toBeNull()
  })

  it("situação funcional: EMPLOYEES com status bruto e EMPLOYEE_ABSENCES entram pelo serviço canônico; status desconhecido vai para a quarentena", async () => {
    const statusFeed = await activeFeed(groupsSource, { feedKey: "situacao", name: "Situação funcional", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig(), sourceNamespace: "tc-rh", mapping: identity(["externalEmployeeId", "name", "role", "currentStatus", "statusEffectiveFrom"]) })
    const run = await uploadAndRun(statusFeed, csv([["externalEmployeeId", "name", "role", "currentStatus", "statusEffectiveFrom"], ["TC-OP-10", "Operador TC 10", "OPERATOR", "FERIAS", "2026-09-09"], ["TC-OP-11", "Operador TC 11", "OPERATOR", "EM PRODUÇÃO", ""], ["TC-OP-12", "Operador TC 12", "OPERATOR", "SABATICO", ""]]), "tc-situacao.csv")
    expect(run.status).toBe("PARTIAL")
    expect((await rejectionsOf(run.id))).toEqual([{ code: "DATA_EMPLOYMENT_STATUS_UNKNOWN", field: "currentStatus", key: "TC-OP-12" }])
    const periods = await db.query<{ status: string; effective_from: string; effective_from_inferred: boolean; source: string }>(
      `select s.status, s.effective_from::text effective_from, s.effective_from_inferred, s.source from employee_status_periods s join people p on p.id = s.person_id where p.matricula = 'TC-OP-10' order by s.effective_from`,
    )
    expect(periods.rows).toEqual([{ status: "FERIAS", effective_from: "2026-09-09", effective_from_inferred: false, source: "tc-rh" }])
    const current = await db.query<{ current_employment_status: string }>(`select current_employment_status from people where organization_id = $1 and matricula = 'TC-OP-10'`, [ORG])
    expect(current.rows[0]?.current_employment_status).toBe("FERIAS")
    // Snapshot repetido não cria período novo.
    const again = await uploadAndRun(statusFeed, csv([["externalEmployeeId", "name", "role", "currentStatus", "statusEffectiveFrom"], ["TC-OP-10", "Operador TC 10", "OPERATOR", "FERIAS", "2026-09-09"]]), "tc-situacao-2.csv")
    expect(again.recordsUnchanged).toBe(1)
    expect((await db.query(`select 1 from employee_status_periods s join people p on p.id = s.person_id where p.matricula = 'TC-OP-10'`)).rowCount).toBe(1)

    const absences = await activeFeed(groupsSource, { feedKey: "ausencias", name: "Ausências", contractKey: "EMPLOYEE_ABSENCES", connectorConfig: fileFeedConfig(), sourceNamespace: "tc-rh-ausencias", mapping: identity(["externalEmployeeId", "type", "startDate", "endDate"]) })
    const absenceRun = await uploadAndRun(absences, csv([["externalEmployeeId", "type", "startDate", "endDate"], ["TC-OP-11", "INSS", "2026-10-01", "2026-10-15"], ["TC-OP-11", "FOLGA_ESPECIAL", "2026-10-20", ""], ["TC-OP-99", "FERIAS", "2026-10-01", ""]]), "tc-ausencias.csv")
    expect(absenceRun.status).toBe("PARTIAL")
    expect(absenceRun.recordsInserted).toBe(1)
    expect((await rejectionsOf(absenceRun.id)).map((row) => row.code)).toEqual(["DATA_EMPLOYMENT_STATUS_UNKNOWN", "DATA_EMPLOYEE_NOT_FOUND"])
    const leave = await db.query<{ status: string; effective_to: string }>(`select s.status, s.effective_to::text effective_to from employee_status_periods s join people p on p.id = s.person_id where p.matricula = 'TC-OP-11' and s.status = 'INSS'`)
    expect(leave.rows).toEqual([{ status: "INSS", effective_to: "2026-10-15" }])
  })

  it("contrato ATÔMICO (estrutura): qualquer rejeição impede aplicar tudo", async () => {
    const feed = await activeFeed(groupsSource, { feedKey: "estrutura", name: "Estrutura", contractKey: "ORGANIZATIONAL_STRUCTURE", connectorConfig: fileFeedConfig(), mapping: identity(["externalEmployeeId", "reportsToExternalId"]) })
    const run = await uploadAndRun(feed, csv([["externalEmployeeId", "reportsToExternalId"], ["TC-OP-02", "TC-OP-01"], ["TC-OP-03", "TC-INEXISTENTE"]]), "tc-estrutura.csv")
    expect(run.status).toBe("FAILED")
    expect(run.errorCode).toBe("DATA_RUN_ATOMIC_REJECTED")
    expect(run.recordsInserted + run.recordsUpdated).toBe(0)
    const op2 = await db.query<{ reports_to_id: string }>(`select reports_to_id from people where organization_id = $1 and matricula = 'TC-OP-02'`, [ORG])
    expect(op2.rows[0]?.reports_to_id).toBe(supervisorId)
  })

  it("fechamento oficial, PRV, metas e jornadas entram pelos contratos genéricos", async () => {
    const official = await activeFeed(groupsSource, { feedKey: "fechamento", name: "Fechamento", contractKey: "OFFICIAL_INDICATOR_PERFORMANCE", connectorConfig: fileFeedConfig(), sourceNamespace: "tc-oficial", mapping: identity(["externalEmployeeId", "indicatorCode", "referencePeriod", "value", "targetValue", "achievementPercent", "weightPercent", "quartile"]) })
    const officialRun = await uploadAndRun(official, csv([["externalEmployeeId", "indicatorCode", "referencePeriod", "value", "targetValue", "achievementPercent", "weightPercent", "quartile"], ["TC-OP-01", "TEST_CENTRAL_RATE", "2026-08", "82,5", "80", "103,1", "25", "Q1"], ["TC-OP-02", "TEST_CENTRAL_RATE", "08/2026", "70", "80", "87,5", "25", "Q5"]]), "tc-fechamento.csv")
    expect(officialRun.status).toBe("PARTIAL")
    expect(officialRun.recordsInserted).toBe(1)
    expect((await rejectionsOf(officialRun.id))[0]?.code).toBe("DATA_INVALID_ENUM")
    const prv = await activeFeed(groupsSource, { feedKey: "prv", name: "PRV", contractKey: "PRV_PERFORMANCE", connectorConfig: fileFeedConfig(), sourceNamespace: "tc-prv", mapping: identity(["externalEmployeeId", "referencePeriod", "achievementPercent", "quartile"]) })
    const prvRun = await uploadAndRun(prv, csv([["externalEmployeeId", "referencePeriod", "achievementPercent", "quartile"], ["TC-OP-01", "2026-08", "97.8", "Q2"]]), "tc-prv.csv")
    expect(prvRun.status).toBe("COMPLETED")
    const goals = await activeFeed(groupsSource, { feedKey: "metas", name: "Metas", contractKey: "GOALS", connectorConfig: fileFeedConfig(), mapping: identity(["indicatorCode", "subjectType", "subjectExternalCode", "targetValue", "validFrom"]) })
    const goalsRun = await uploadAndRun(goals, csv([["indicatorCode", "subjectType", "subjectExternalCode", "targetValue", "validFrom"], ["TEST_CENTRAL_RATE", "GROUP", "TC_RETENCAO", "80", "2026-01-01"], ["TEST_CENTRAL_RATE", "EMPLOYEE", "TC-OP-01", "85", "2026-01-01"]]), "tc-metas.csv")
    expect(goalsRun.status).toBe("COMPLETED")
    expect(goalsRun.recordsInserted).toBe(2)
    const shifts = await activeFeed(groupsSource, { feedKey: "jornadas", name: "Jornadas", contractKey: "WORK_SCHEDULES", connectorConfig: fileFeedConfig(), mapping: identity(["externalEmployeeId", "startTime", "workMinutes", "effectiveFrom"]) })
    const shiftsRun = await uploadAndRun(shifts, csv([["externalEmployeeId", "startTime", "workMinutes", "effectiveFrom"], ["TC-OP-01", "08:00", "360", "2026-01-01"], ["TC-OP-01", "08:00", "9999", "2026-02-01"]]), "tc-jornadas.csv")
    expect(shiftsRun.status).toBe("PARTIAL")
    expect((await rejectionsOf(shiftsRun.id))[0]?.code).toBe("DATA_CONTRACT_VIOLATION")
  })

  // ---------------------------------------------------------------------------------------
  it("OFFICIAL_INDICATOR_PERFORMANCE@2: numerador e denominador validados pela estratégia, gravados como vieram e lidos pelo analytics; feed @1 convive", async () => {
    await createIndicatorDefinition(db, ORG, { code: "TEST_CENTRAL_SNAPSHOT", name: "Estoque Central (teste)", unit: "CASES", desiredDirection: "LOWER", dailySupported: false, operationalAggregation: "LATEST", officialClosureSupported: true })
    const columns = ["externalEmployeeId", "indicatorCode", "referencePeriod", "value", "numerator", "denominator", "targetValue", "achievementPercent", "weightPercent", "quartile"]
    const feed = await activeFeed(groupsSource, { feedKey: "fechamento-v2", name: "Fechamento com componentes", contractKey: "OFFICIAL_INDICATOR_PERFORMANCE", connectorConfig: fileFeedConfig(), sourceNamespace: "tc-oficial-comp", mapping: identity(columns) })
    expect(feed.contractVersion).toBe(2)
    const run = await uploadAndRun(feed, csv([
      columns,
      ["TC-OP-03", "TEST_CENTRAL_RATE", "2026-08", "82,5", "165", "200", "80", "103,1", "25", "Q1"],
      ["TC-OP-04", "TEST_CENTRAL_RATE", "2026-08", "90", "9", "20", "80", "112,5", "25", "Q1"], // 9 ÷ 20 = 45% ≠ 90%
      ["TC-OP-05", "TEST_CENTRAL_RATE", "2026-08", "70", "14", "", "80", "87,5", "25", "Q3"], // numerador sem denominador
      ["TC-OP-06", "TEST_CENTRAL_SNAPSHOT", "2026-08", "12", "12", "1", "10", "83,3", "", "Q2"], // Último valor não usa componentes
      ["TC-OP-07", "TEST_CENTRAL_SNAPSHOT", "2026-08", "12", "", "", "10", "83,3", "", "Q2"],
    ]), "tc-fechamento-componentes.csv")
    expect(run.status).toBe("PARTIAL")
    expect(run.recordsInserted).toBe(2)
    expect(run.recordsRejected).toBe(3)
    expect((await rejectionsOf(run.id)).map((row) => [row.key, row.code, row.field])).toEqual([["TC-OP-04", "DATA_CONTRACT_VIOLATION", "value"], ["TC-OP-05", "DATA_CONTRACT_VIOLATION", "denominator"], ["TC-OP-06", "DATA_CONTRACT_VIOLATION", "numerator"]])
    const message = (await db.query<{ message: string }>(`select message from data_ingestion_rejections where run_id = $1 and source_record_key = 'TC-OP-04'`, [run.id])).rows[0]!.message
    expect(message).toContain("não confere com numerador ÷ denominador (9 ÷ 20 × 100 = 45;")

    const people = new Map((await db.query<{ id: string; matricula: string }>(`select id, matricula from people where organization_id = $1 and matricula = any($2::text[])`, [ORG, ["TC-OP-03", "TC-OP-07"]])).rows.map((row) => [row.matricula, row.id]))
    const read = async () => {
      const rows = await new PgAnalyticsReadRepository(db).loadIndicatorPerformance(ORG, [...people.values()], ["2026-08"])
      return rows.filter((row) => row.indicatorCode.startsWith("TEST_CENTRAL_")).map((row) => ({ person: row.personId === people.get("TC-OP-03") ? "TC-OP-03" : "TC-OP-07", value: row.value, numerator: row.numerator, denominator: row.denominator, achievementPercent: row.achievementPercent, quartile: row.quartile })).sort((a, b) => a.person.localeCompare(b.person))
    }
    // O oficial é o da fonte (atingimento/quartil intocados); os componentes, como vieram.
    expect(await read()).toEqual([
      { person: "TC-OP-03", value: 82.5, numerator: 165, denominator: 200, achievementPercent: 103.1, quartile: "Q1" },
      { person: "TC-OP-07", value: 12, numerator: null, denominator: null, achievementPercent: 83.3, quartile: "Q2" },
    ])

    // Feed criado na versão 1 continua nela: não conhece os componentes e não apaga os do MESMO valor oficial;
    // valor oficial novo sem componentes apaga os antigos (nunca ficam incoerentes com o valor gravado).
    const v1Columns = ["externalEmployeeId", "indicatorCode", "referencePeriod", "value", "targetValue", "achievementPercent", "weightPercent", "quartile"]
    const legacy = await activeFeed(groupsSource, { feedKey: "fechamento-v1", name: "Fechamento (v1)", contractKey: "OFFICIAL_INDICATOR_PERFORMANCE", contractVersion: 1, connectorConfig: fileFeedConfig(), sourceNamespace: "tc-oficial-comp", mapping: identity(v1Columns) })
    expect(legacy.contractVersion).toBe(1)
    const same = await uploadAndRun(legacy, csv([v1Columns, ["TC-OP-03", "TEST_CENTRAL_RATE", "2026-08", "82,5", "80", "103,1", "25", "Q1"]]), "tc-fechamento-v1.csv")
    expect(same.status).toBe("COMPLETED")
    expect(same.recordsUnchanged).toBe(1)
    expect((await read())[0]).toMatchObject({ numerator: 165, denominator: 200 })
    const changed = await uploadAndRun(legacy, csv([v1Columns, ["TC-OP-03", "TEST_CENTRAL_RATE", "2026-08", "80", "80", "100", "25", "Q2"]]), "tc-fechamento-v1-ajuste.csv")
    expect(changed.recordsUpdated).toBe(1)
    expect((await read())[0]).toEqual({ person: "TC-OP-03", value: 80, numerator: null, denominator: null, achievementPercent: 100, quartile: "Q2" })
  })

  it("visão geral, qualidade e router admin: contagens, top erros, mapa de dados e nenhum segredo serializado", async () => {
    const overview = await buildOverview(ctx, ORG)
    expect(overview.cards.activeSources).toBeGreaterThanOrEqual(2)
    expect(overview.cards.sourcesWithError).toBeGreaterThanOrEqual(2)
    expect(overview.cards.receivedToday).toBeGreaterThan(0)
    expect(overview.dataMap.find((entry) => entry.contractKey === "EMPLOYEES")?.feeds.length).toBeGreaterThanOrEqual(1)
    const quality = await buildQualityReport(ctx, ORG)
    expect(quality.topErrors.map((entry) => entry.code)).toContain("DATA_EMPLOYEE_NOT_FOUND")

    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => {
      req.user = { sub: "x", personId: ADMIN.personId ?? "00000000-0000-4000-8000-000000000000", organizationId: ORG, role: "ADMIN", name: "Admin", email: "a@b", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
      next()
    })
    app.use("/api/v1/admin/data-hub", createDataHubRouter(db, { http, sftp, logger, secrets: secretStore }))
    app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next
      if (error instanceof DomainError) return res.status(error.statusCode).json({ error: { code: error.code, message: error.message } })
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: error.message } })
    })
    const sources = await request(app).get("/api/v1/admin/data-hub/sources")
    expect(sources.status).toBe(200)
    const serialized = JSON.stringify(sources.body)
    expect(serialized).not.toContain("tc-wrong-token-999")
    expect(serialized).not.toContain("tc-sftp-pass")
    const apiSource = sources.body.data.find((entry: { name: string }) => entry.name === "TC API Operacional")
    const detail = await request(app).get(`/api/v1/admin/data-hub/sources/${apiSource.id}`)
    expect(detail.body.data.secrets).toEqual([expect.objectContaining({ purpose: "API_AUTH" })])
    expect(JSON.stringify(detail.body)).not.toMatch(/tc-(wrong|secret)-token/)
    const runs = await request(app).get("/api/v1/admin/data-hub/runs?page=1&pageSize=5")
    expect(runs.body.data.total).toBeGreaterThan(5)
    const contracts = await request(app).get("/api/v1/admin/data-hub/contracts/INDICATOR_MEASUREMENTS")
    expect(contracts.body.data.pushPayloadExample.records.length).toBeGreaterThan(0)
    // Outra organização não enxerga nada da nossa.
    const other = express()
    other.use((req, _res, next) => {
      req.user = { sub: "y", personId: "00000000-0000-4000-8000-000000000000", organizationId: "00000000-0000-4000-8000-000000000999", role: "ADMIN", name: "Outro", email: "o@b", avatarUrl: null, jobTitle: null, teamId: null, teamName: null }
      next()
    })
    other.use("/api/v1/admin/data-hub", createDataHubRouter(db, { http, sftp, logger, secrets: secretStore }))
    other.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      void next
      res.status(error instanceof DomainError ? error.statusCode : 500).json({ error: { code: error instanceof DomainError ? error.code : "INTERNAL_ERROR" } })
    })
    expect((await request(other).get(`/api/v1/admin/data-hub/sources/${apiSource.id}`)).status).toBe(404)
  })

  // ---------------------------------------------------------------------------------------
  it("volume: 100 mil medições por CSV — parse, validação em lote e aplicação em batches sem N+1", async () => {
    // O Workflow de prova sai antes: 100 mil matrículas de Workflow não fazem parte da medição de volume.
    await db.query(`delete from workflows where organization_id = $1 and name = 'TC Workflow indicador'`, [ORG])
    const operators = (await db.query<{ matricula: string }>(`select matricula from people where organization_id = $1 and role = 'OPERATOR' and active and matricula like 'DEMO-OP-%' order by matricula limit 2000`, [ORG])).rows.map((row) => row.matricula)
    expect(operators.length).toBe(2000)
    const feed = await activeFeed(groupsSource, { feedKey: "medicoes-volume", name: "Medições (volume)", contractKey: "INDICATOR_MEASUREMENTS", connectorConfig: fileFeedConfig(), sourceNamespace: "tc-volume", mapping: identity(["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"]) })
    const lines = ["externalEmployeeId;indicatorCode;date;value;numerator;denominator"]
    for (let day = 0; day < 50; day += 1) {
      const date = `2026-07-${String((day % 28) + 1).padStart(2, "0")}`
      for (let index = 0; index < 2000; index += 1) {
        const den = 20 + (index % 10)
        const num = (index + day) % (den + 1)
        lines.push(`${operators[index]};TEST_CENTRAL_RATE;${day < 28 ? date : `2026-08-${String(day - 27).padStart(2, "0")}`};${((num / den) * 100).toFixed(2)};${num};${den}`)
      }
    }
    const content = new TextEncoder().encode(lines.join("\n"))
    const before = process.memoryUsage().heapUsed
    const started = Date.now()
    const run = await uploadAndRun(feed, content, "tc-volume.csv")
    const elapsed = Date.now() - started
    const heapDelta = (process.memoryUsage().heapUsed - before) / 1024 / 1024
    console.info(`[data-hub volume] 100k medições: ${elapsed} ms, heap Δ ${heapDelta.toFixed(0)} MB, stages=${run.stages.map((stage) => `${stage.stage}:${stage.finishedAt && stage.startedAt ? new Date(stage.finishedAt).getTime() - new Date(stage.startedAt).getTime() : "?"}ms`).join(" ")}`)
    expect(run.status).toBe("COMPLETED")
    expect(run.recordsReceived).toBe(100_000)
    expect(run.recordsInserted).toBe(100_000)
    expect(elapsed).toBeLessThan(180_000)
    const again = await uploadAndRun(feed, content, "tc-volume-2.csv")
    expect(again.recordsUnchanged).toBe(100_000)
    await db.query(`delete from indicator_measurements where indicator_definition_id in (select id from indicator_definitions where code = 'TEST_CENTRAL_RATE') and source = 'tc-volume'`)
  }, 600_000)
})
