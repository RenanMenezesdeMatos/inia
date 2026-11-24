import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext, type DataHubContext } from "../../data-hub/application/data-hub-context.js"
import { createFeed, previewMapping, setFeedStatus } from "../../data-hub/application/feed-service.js"
import type { DataFeedRow, DataRunRow, DataSourceRow } from "../../data-hub/application/records.js"
import { executeRun } from "../../data-hub/application/run-pipeline.js"
import { enqueueRun, requestReprocess } from "../../data-hub/application/run-service.js"
import { createSource } from "../../data-hub/application/source-service.js"
import { employeesWriter } from "../../data-hub/application/writers/master-data-writers.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, MockHttpClient } from "../../data-hub/testing/fakes.js"
import { loadAnalyticsVersion } from "../../performance-analytics/infrastructure/analytics-versions.js"
import { createJobPosition, listJobPositions, listUnknownJobPositions, loadJobPositionCatalog, updateJobPosition } from "../application/job-position-service.js"
import { jobPositionKey } from "../domain/job-position.js"

/**
 * CARGOS (migration 252), banco de teste real:  INIA_DB_PROOF=1 NODE_ENV=test npx vitest run job-positions-proof
 * Com os valores da base do cliente (24/11/2026): os nomes em português entram sem "Mapear códigos", Assistente de Relacionamento é
 * Operador e aparece com o próprio nome, Apoio fica fora da liderança, cargo novo vai para a quarentena, é cadastrado e reprocessado.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-00000000ca60"
const OTHER_ORG = "de00ee00-0000-4000-8000-00000000ca61"
const OPERATION = "de00ee00-0000-4000-8000-00000000ca62"
const ACTOR = { organizationId: ORG, personId: null }

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let source: DataSourceRow
let feed: DataFeedRow

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const HEADER = ["matricula", "nome", "nivel", "cargo", "gestor"]
const mapping = { fields: [["externalEmployeeId", "matricula"], ["name", "nome"], ["role", "nivel"], ["jobTitle", "cargo"], ["reportsToExternalId", "gestor"]].map(([target, column]) => ({ target: target!, source: column!, transforms: [] })) }
const fileConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }

async function run(rows: string[][]): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: source.id, feedId: feed.id, filename: "colaboradores.csv", contentType: "text/csv", content: csv([HEADER, ...rows]) })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  return (await executeRun(ctx, run.id))!
}
const people = async () => new Map((await db.query<{ matricula: string; role: string; job_title: string | null; position: string | null; manager: string | null }>(
  `select p.matricula, p.role, p.job_title, jp.name "position", m.matricula manager from people p left join job_positions jp on jp.id = p.job_position_id left join people m on m.id = p.reports_to_id where p.organization_id = $1`, [ORG])).rows.map((row) => [row.matricula, row]))
const rejections = async (runId: string) => (await db.query<{ source_record_key: string; error_code: string; message: string }>(`select source_record_key, error_code, message from data_ingestion_rejections where run_id = $1 order by record_number`, [runId])).rows

async function cleanup() {
  for (const org of [ORG, OTHER_ORG]) {
    for (const table of ["data_sources", "data_raw_objects", "employee_status_periods", "audit_logs", "people", "job_positions", "operations"]) await db.query(`delete from ${table} where organization_id = $1`, [org])
    await db.query(`delete from organizations where id = $1`, [org])
  }
}

describe.skipIf(!ENABLED)("Cargos — da base do cliente ao cadastro da pessoa", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    ctx = createDataHubContext(db, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore() })
    await cleanup()
    await db.query(`insert into organizations (id, name, slug) values ($1, 'CA Cargos', 'ca-cargos'), ($2, 'CA Outra', 'ca-outra')`, [ORG, OTHER_ORG])
    await db.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'CA Operação', 'America/Sao_Paulo')`, [OPERATION, ORG])
    await db.query(`select seed_default_job_positions($1)`, [ORG])
    await db.query(`select seed_default_job_positions($1)`, [ORG])
    source = await createSource(ctx, ORG, null, { name: "CA RH", config: { kind: "FILE_UPLOAD" } })
    feed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig: fileConfig, authoritative: true, sourceNamespace: "ca-rh", mapping })).id, "ACTIVATE")
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  it("os nove cargos da base do cliente entram sem tradução; Assistente de Relacionamento é Operador com o próprio nome", async () => {
    expect(await listJobPositions(db, ORG)).toHaveLength(11)
    const result = await run([
      ["G1", "Gisele", "GERENTE SR", "", ""],
      ["G2", "Gil", "GERENTE", "", "G1"],
      ["C1", "Caio", "COORDENADOR", "", "G2"],
      ["S1", "Sônia", "SUPERVISOR", "", "C1"],
      ["O1", "Otto", "OPERADOR", "", "S1"],
      ["A1", "Ana", "ASSISTENTE RELACIONAMENTO", "", "S1"],
      ["A2", "Alba", "assistente de relacionamento", "Assistente Pleno", "S1"],
      ["E1", "Eva", "ESTAGIÁRIO", "", "S1"],
      ["N1", "Nina", "ANALISTA", "", "G2"],
      ["K1", "Kai", "CONSULTOR", "", "G2"],
      ["D1", "Davi", "ASSISTENTE ADMINISTRATIVO", "", "G2"],
      ["O2", "Olga", "OPERATOR", "", "S1"],
    ])
    expect(result).toMatchObject({ status: "COMPLETED", recordsInserted: 12, recordsRejected: 0 })
    const all = await people()
    expect(Object.fromEntries([...all].map(([key, row]) => [key, [row.role, row.position, row.job_title]]))).toEqual({
      G1: ["SENIOR_MANAGER", "Gerente Sênior", "Gerente Sênior"],
      G2: ["MANAGER", "Gerente", "Gerente"],
      C1: ["COORDINATOR", "Coordenador", "Coordenador"],
      S1: ["SUPERVISOR", "Supervisor", "Supervisor"],
      O1: ["OPERATOR", "Operador", "Operador"],
      A1: ["OPERATOR", "Assistente de Relacionamento", "Assistente de Relacionamento"],
      A2: ["OPERATOR", "Assistente de Relacionamento", "Assistente Pleno"],
      E1: ["STAFF", "Estagiário", "Estagiário"],
      N1: ["STAFF", "Analista", "Analista"],
      K1: ["STAFF", "Consultor", "Consultor"],
      D1: ["STAFF", "Assistente Administrativo", "Assistente Administrativo"],
      O2: ["OPERATOR", null, null],
    })
    expect(all.get("O1")!.manager).toBe("S1")
  })

  it("recarga igual não muda nada; código do nível depois mantém o cargo do mesmo nível e tira o de outro nível", async () => {
    const rows = [["A1", "Ana", "ASSISTENTE RELACIONAMENTO", "", "S1"]]
    expect(await run(rows)).toMatchObject({ status: "COMPLETED", recordsUnchanged: 1, recordsUpdated: 0 })
    expect(await run([["A1", "Ana", "OPERATOR", "", "S1"]])).toMatchObject({ recordsUnchanged: 1 })
    expect((await people()).get("A1")).toMatchObject({ role: "OPERATOR", position: "Assistente de Relacionamento" })
    await run([["A1", "Ana", "SUPERVISOR", "", "C1"]])
    expect((await people()).get("A1")).toMatchObject({ role: "SUPERVISOR", position: "Supervisor" })
    await run(rows)
    expect((await people()).get("A1")).toMatchObject({ role: "OPERATOR", position: "Assistente de Relacionamento" })
  })

  it("cargo novo: só ele vai para a quarentena, a tela mostra, cadastrar e reprocessar resolve — e o subordinado dele não entra sem gestor", async () => {
    const first = await run([["T1", "Téo", "TRAINEE PL", "", "S1"], ["T2", "Tito", "LÍDER DE CÉLULA", "", "S1"], ["O9", "Otávia", "OPERADOR", "", "T2"]])
    expect(first).toMatchObject({ status: "FAILED", recordsRejected: 3 })
    expect((await rejections(first.id)).map((row) => [row.source_record_key, row.error_code])).toEqual([["T1", "DATA_JOB_POSITION_UNKNOWN"], ["T2", "DATA_JOB_POSITION_UNKNOWN"], ["O9", "DATA_EMPLOYEE_NOT_FOUND"]])
    expect((await people()).has("O9")).toBe(false)
    const unknown = async () => (await listUnknownJobPositions(db, ORG, await loadJobPositionCatalog(db, ORG), jobPositionKey)).map((row) => [row.term, row.records])
    expect(await unknown()).toEqual([["LÍDER DE CÉLULA", 1], ["TRAINEE PL", 1]])
    await createJobPosition(db, ACTOR, { name: "Trainee", level: "STAFF", terms: ["TRAINEE PL"] })
    await createJobPosition(db, ACTOR, { name: "Líder de Célula", level: "SUPERVISOR" })
    expect(await unknown()).toEqual([])
    const again = await executeRun(ctx, (await requestReprocess(ctx, ORG, first.id, null)).id)
    expect(again).toMatchObject({ status: "COMPLETED", recordsInserted: 3 })
    expect((await people()).get("O9")).toMatchObject({ role: "OPERATOR", manager: "T2" })
  })

  it("cargo desativado manda a linha para a quarentena e não mexe em quem já tem; a validação da amostra mostra cargo e perfil", async () => {
    const trainee = (await listJobPositions(db, ORG)).find((position) => position.name === "Trainee")!
    await updateJobPosition(db, ACTOR, trainee.id, { active: false })
    const result = await run([["T1", "Téo Nome Novo", "TRAINEE PL", "", "S1"], ["T8", "Nova", "TRAINEE PL", "", "S1"]])
    expect((await rejections(result.id))[0]).toMatchObject({ error_code: "DATA_JOB_POSITION_UNKNOWN", message: expect.stringContaining("está desativado") })
    // Quem já tem o cargo desativado segue atualizado (inclusive o desligamento); gente nova com ele, não.
    expect(result).toMatchObject({ status: "PARTIAL", recordsUpdated: 1, recordsRejected: 1 })
    expect((await people()).get("T1")).toMatchObject({ role: "STAFF", position: "Trainee" })
    expect((await db.query(`select name from people where organization_id = $1 and matricula = 'T1'`, [ORG])).rows[0].name).toBe("Téo Nome Novo")
    const preview = await previewMapping(ctx, ORG, { source, feed, contractKey: "EMPLOYEES", mapping, sample: { columns: HEADER, records: [{ matricula: "P1", nome: "P", nivel: "ASSISTENTE RELACIONAMENTO" }, { matricula: "P2", nome: "Q", nivel: "OPERADOR" }, { matricula: "P3", nome: "R", nivel: "PILOTO" }] } })
    expect(preview.rows.map((row) => [row.valid, row.normalized.role])).toEqual([[true, "Assistente de Relacionamento (perfil Operador)"], [true, "Operador"], [false, null]])
  })

  it("mudança de perfil: Operador ↔ Apoio vale na hora; liderança em uso é recusada; termo de outro cargo é recusado; renomear acompanha e invalida o grafo", async () => {
    const byName = async (name: string) => (await listJobPositions(db, ORG)).find((position) => position.name === name)!
    const consultor = await byName("Consultor")
    await updateJobPosition(db, ACTOR, consultor.id, { level: "OPERATOR" })
    expect((await people()).get("K1")).toMatchObject({ role: "OPERATOR" })
    await expect(updateJobPosition(db, ACTOR, consultor.id, { level: "MANAGER" })).rejects.toMatchObject({ code: "JOB_POSITION_LEVEL_LOCKED", statusCode: 409 })
    await expect(createJobPosition(db, ACTOR, { name: "Operador", level: "STAFF" })).rejects.toMatchObject({ code: "JOB_POSITION_TERM_TAKEN" })
    await expect(updateJobPosition(db, ACTOR, consultor.id, { terms: ["gerente-sr"] })).rejects.toMatchObject({ code: "JOB_POSITION_TERM_TAKEN" })
    const before = await loadAnalyticsVersion(db, ORG, "STRUCTURE")
    await updateJobPosition(db, ACTOR, consultor.id, { name: "Consultor de Negócios", terms: ["CONSULTOR"] })
    expect((await people()).get("K1")).toMatchObject({ position: "Consultor de Negócios", job_title: "Consultor de Negócios" })
    expect(await loadAnalyticsVersion(db, ORG, "STRUCTURE")).not.toBe(before)
    expect((await byName("Consultor de Negócios")).terms.sort()).toEqual(["CONSULTOR", "Consultor de Negócios"])
  })

  it("renomear como a tela manda (sem o nome antigo na lista) não derruba a base; código de nível é reservado", async () => {
    const operador = (await listJobPositions(db, ORG)).find((position) => position.name === "Operador")!
    await updateJobPosition(db, ACTOR, operador.id, { name: "Operador de Atendimento", level: "OPERATOR", terms: operador.terms.filter((term) => term !== "Operador") })
    expect(await run([["O1", "Otto", "OPERADOR", "", "S1"]])).toMatchObject({ status: "COMPLETED", recordsRejected: 0 })
    expect((await people()).get("O1")).toMatchObject({ position: "Operador de Atendimento", job_title: "Operador de Atendimento" })
    await updateJobPosition(db, ACTOR, operador.id, { name: "Operador" })
    await expect(createJobPosition(db, ACTOR, { name: "Chefia", level: "STAFF", terms: ["MANAGER"] })).rejects.toMatchObject({ code: "JOB_POSITION_TERM_RESERVED", statusCode: 422 })
    await expect(createJobPosition(db, ACTOR, { name: "Senior Manager", level: "MANAGER" })).rejects.toMatchObject({ code: "JOB_POSITION_TERM_RESERVED" })
  })

  it("cargo exibido: o da base nunca é trocado pelo cadastro quando a linha vem sem ele; o que veio do cadastro acompanha", async () => {
    await run([["A2", "Alba", "ASSISTENTE RELACIONAMENTO", "", "S1"]])
    expect((await people()).get("A2")!.job_title).toBe("Assistente Pleno")
    await run([["A2", "Alba", "OPERADOR", "", "S1"]])
    expect((await people()).get("A2")).toMatchObject({ position: "Operador", job_title: "Assistente Pleno" })
    await run([["E1", "Eva", "OPERADOR", "", "S1"]])
    expect((await people()).get("E1")).toMatchObject({ position: "Operador", job_title: "Operador" })
    await run([["E1", "Eva", "COORDINATOR", "", "C1"]])
    expect((await people()).get("E1")).toMatchObject({ role: "COORDINATOR", position: null, job_title: null })
    await run([["E1", "Eva", "ESTAGIÁRIO", "", "S1"]])
  })

  it("cargo e nível nunca se contradizem: quem muda só o nível tira o cargo de outro perfil", async () => {
    await db.query(`update people set role = 'SUPERVISOR' where organization_id = $1 and matricula = 'N1'`, [ORG])
    expect((await people()).get("N1")).toMatchObject({ role: "SUPERVISOR", position: null })
    await run([["N1", "Nina", "ANALISTA", "", "G2"]])
    expect((await people()).get("N1")).toMatchObject({ role: "STAFF", position: "Analista" })
  })

  it("perfil mudado entre a validação e a gravação: a pessoa fica com o de agora", async () => {
    const before = await loadJobPositionCatalog(db, ORG)
    const analista = before.get("ANALISTA")!
    const context = { ctx, organizationId: ORG, timeZone: "America/Sao_Paulo", feed, runId: "00000000-0000-4000-8000-000000000000", sourceNamespace: "ca-rh" }
    const { ready } = await employeesWriter.prepare(context, [{ recordNumber: 1, sourceRecordKey: "N9", record: { externalEmployeeId: "N9", name: "Nara", role: "ANALISTA", reportsToExternalId: "G2" } as never }])
    await updateJobPosition(db, ACTOR, analista.id, { level: "OPERATOR" })
    const client = await pool.connect()
    try {
      await client.query("begin")
      await employeesWriter.apply(context, client, ready)
      await client.query("commit")
    } finally {
      client.release()
    }
    expect((await people()).get("N9")).toMatchObject({ role: "OPERATOR", position: "Analista" })
    await updateJobPosition(db, ACTOR, analista.id, { level: "STAFF" })
  })

  it("cadeia longa com a raiz recusada: todo mundo recusado, em tempo linear", async () => {
    const context = { ctx, organizationId: ORG, timeZone: "America/Sao_Paulo", feed, runId: "00000000-0000-4000-8000-000000000000", sourceNamespace: "ca-rh" }
    const total = 40_000
    const records = Array.from({ length: total }, (_, index) => ({ recordNumber: index + 1, sourceRecordKey: `L${index}`, record: { externalEmployeeId: `L${index}`, name: "P", role: index === 0 ? "CARGO QUE NAO EXISTE" : "OPERADOR", reportsToExternalId: index === 0 ? null : `L${index - 1}` } as never }))
    const startedAt = Date.now()
    const { ready, rejections: refused } = await employeesWriter.prepare(context, records)
    expect(ready).toHaveLength(0)
    expect(refused).toHaveLength(total)
    expect(Date.now() - startedAt).toBeLessThan(5_000)
  }, 30_000)

  it("universo exigido: Apoio não precisa de universo e não vira Operador sem ele", async () => {
    await db.query(`update organizations set operating_universe_enforced_at = now() where id = $1`, [ORG])
    try {
      expect(await run([["E2", "Enzo", "ESTAGIARIO", "", "S1"]])).toMatchObject({ status: "COMPLETED", recordsInserted: 1 })
      const result = await run([["A9", "Aline", "ASSISTENTE RELACIONAMENTO", "", "S1"]])
      expect((await rejections(result.id))[0]!.error_code).toBe("DATA_OPERATING_UNIVERSE_REQUIRED")
      const intern = (await listJobPositions(db, ORG)).find((position) => position.name === "Estagiário")!
      await expect(updateJobPosition(db, ACTOR, intern.id, { level: "OPERATOR" })).rejects.toMatchObject({ code: "JOB_POSITION_UNIVERSE_REQUIRED" })
    } finally {
      await db.query(`update organizations set operating_universe_enforced_at = null where id = $1`, [ORG])
    }
  })

  it("outra organização não vê, não edita e não usa os cargos desta; fica no registro quem mudou", async () => {
    const own = (await listJobPositions(db, ORG)).find((position) => position.level === "OPERATOR")!
    expect(await listJobPositions(db, OTHER_ORG)).toEqual([])
    await expect(updateJobPosition(db, { organizationId: OTHER_ORG, personId: null }, own.id, { name: "Invadido" })).rejects.toMatchObject({ code: "JOB_POSITION_NOT_FOUND" })
    await expect(db.query(`insert into people (organization_id, name, role, job_position_id) values ($1, 'X', 'OPERATOR', $2)`, [OTHER_ORG, own.id])).rejects.toMatchObject({ code: "23503" })
    await Promise.allSettled([createJobPosition(db, ACTOR, { name: "Corrida", level: "STAFF" }), createJobPosition(db, ACTOR, { name: "CORRIDA", level: "STAFF" })]).then((results) => expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]))
    const audit = await db.query(`select 1 from audit_logs where organization_id = $1 and action in ('DATA_HUB_JOB_POSITION_CREATED', 'DATA_HUB_JOB_POSITION_UPDATED')`, [ORG])
    expect(audit.rowCount).toBeGreaterThan(4)
  })
})
