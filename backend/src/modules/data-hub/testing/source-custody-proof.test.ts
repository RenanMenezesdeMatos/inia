/**
 * PROVA contra o banco de TESTE real (item h19 da 4ª auditoria): a custódia da credencial vale em TODA carga que define o lugar
 * da pessoa — não só no registro que a liga, nem só na carga de Colaboradores.
 *   A) ligada SEM Grupo; a Estrutura a põe no Grupo B → acesso desabilitado, com aviso;
 *   B) ligada SEM Grupo; a Estrutura põe um operador do Grupo B sob ela → acesso desabilitado;
 *   C) a MESMA carga de Colaboradores traz o Grupo B só depois → acesso desabilitado;
 *   D) a carga confirma o Grupo do cadastro manual → acesso continua; transferência depois disso é a de sempre;
 *   E) senha temporária ainda não usada + carga muda o Grupo (ou promove a liderança) → a senha expira e as sessões caem;
 *   F) transferência de quem já usa a própria senha → nada muda;
 *   G–J) a Estrutura como PRIMEIRA carga sobre quem foi cadastrado à mão com matrícula (retestado pela preparação AppSec): mover
 *        para outro Grupo, pôr subordinado de outro Grupo (mesmo sem registro da pessoa na carga) ou só trocar o gestor e depois
 *        Colaboradores promover a liderança → acesso desabilitado; confirmar o mesmo Grupo → nada muda.
 * Organização própria, apagada no fim.
 *   INIA_DB_PROOF=1 npx vitest run source-custody-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../application/feed-service.js"
import type { DataFeedRow, DataRunRow } from "../application/records.js"
import { enqueueRun } from "../application/run-service.js"
import { executeRun } from "../application/run-pipeline.js"
import { createSource } from "../application/source-service.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, MockHttpClient } from "./fakes.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "de00ee00-0000-4000-8000-0000000c0190"
const OPERATION = "de00ee00-0000-4000-8000-0000000c0191"
const DOMAIN = "custodia-proof.test"
const NOW = new Date("2026-10-29T12:00:00-03:00")

let pool: pg.Pool
let ctx: DataHubContext
let teamA = ""
let teamB = ""
const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }
const EMPLOYEES = ["externalEmployeeId", "name", "role", "email"]
const EMPLOYEES_WITH_GROUP = [...EMPLOYEES, "groupExternalCode"]
const STRUCTURE = ["externalEmployeeId", "reportsToExternalId", "groupExternalCode"]

async function feedFor(contractKey: string, header: string[], key: string): Promise<DataFeedRow> {
  const source = await createSource(ctx, ORG, null, { name: `Custódia ${key}`, config: { kind: "FILE_UPLOAD" } })
  const created = await createFeed(ctx, ORG, null, source.id, { feedKey: key, name: key, contractKey, connectorConfig: fileFeedConfig, authoritative: false, sourceNamespace: `custodia-${key}`, cadence: { kind: "MANUAL" }, mapping: { fields: header.map((field) => ({ target: field, source: field, transforms: [] })) } })
  return setFeedStatus(ctx, ORG, null, created.id, "ACTIVATE")
}
async function run(feed: DataFeedRow, rows: string[][]): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: feed.sourceId, feedId: feed.id, filename: `${feed.feedKey}.csv`, contentType: "text/csv", content: csv(rows) })
  const { run: queued } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  const done = (await executeRun(ctx, queued.id))!
  expect(done.status).toBe("COMPLETED")
  return done
}
/** Cadastro manual no Grupo A, com conta cuja senha quem administra o Grupo A conhece. */
async function manual(name: string, email: string) {
  const person = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id) values ($1, $2, 'ADMIN', $3) returning id`, [ORG, name, teamA])).rows[0]!.id
  const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, person, email])).rows[0]!.id
  return { person, account }
}
/** Cadastro manual JÁ COM matrícula (a tela de Usuários aceita), no Grupo A, com conta — nenhuma carga a aplicou ainda. */
async function manualWithMatricula(name: string, matricula: string, email: string) {
  const person = (await pool.query<{ id: string }>(`insert into people (organization_id, name, role, team_id, matricula) values ($1, $2, 'OPERATOR', $3, $4) returning id`, [ORG, name, teamA, matricula])).rows[0]!.id
  const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, person, email])).rows[0]!.id
  return { person, account }
}
const accountOf = async (id: string) => (await pool.query<{ active: boolean; session_version: number; temp_valid: boolean }>(`select active, session_version, coalesce(temporary_password_expires_at > now(), false) temp_valid from user_accounts where id = $1`, [id])).rows[0]!
const pendingOf = async (person: string) => (await pool.query<{ pending_custody_team_id: string | null }>(`select pending_custody_team_id from people where id = $1`, [person])).rows[0]!.pending_custody_team_id
const auditOf = async (account: string) => (await pool.query<{ action: string; reason: string }>(`select action, payload->>'reason' reason from audit_logs where organization_id = $1 and entity_id = $2 and action like 'ACCESS_%' order by created_at`, [ORG, account])).rows
const warningsOf = async (runId: string) => (await pool.query<{ error_code: string }>(`select error_code from data_ingestion_rejections where run_id = $1 order by error_code`, [runId])).rows.map((row) => row.error_code)

async function cleanup() {
  await pool.query(`delete from user_accounts where organization_id = $1`, [ORG])
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from data_sources where organization_id = $1`, [ORG])
  await pool.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await pool.query(`update people set reports_to_id = null where organization_id = $1`, [ORG])
  await pool.query(`delete from people where organization_id = $1`, [ORG])
  await pool.query(`delete from teams where organization_id = $1`, [ORG])
  await pool.query(`delete from operations where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

describe.skipIf(!ENABLED)("Central de Dados — custódia da credencial em toda carga que define o lugar (h19)", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 3 })
    ctx = createDataHubContext(pool as unknown as Database, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => NOW } })
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova custódia', 'prova-custodia')`, [ORG])
    await pool.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'Prova custódia', 'America/Fortaleza')`, [OPERATION, ORG])
    teamA = (await pool.query<{ id: string }>(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo A', 'CUST-GA') returning id`, [ORG, OPERATION])).rows[0]!.id
    teamB = (await pool.query<{ id: string }>(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'Grupo B', 'CUST-GB') returning id`, [ORG, OPERATION])).rows[0]!.id
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("A) ligada sem Grupo, a Estrutura a põe no Grupo B: acesso desabilitado, com aviso na carga", async () => {
    const joana = await manual("Joana", `joana@${DOMAIN}`)
    await run(await feedFor("EMPLOYEES", EMPLOYEES, "a-colab"), [EMPLOYEES, ["CA-SB", "Supervisor B", "SUPERVISOR", ""], ["CA-J", "Joana", "OPERATOR", `joana@${DOMAIN}`]])
    expect(await accountOf(joana.account)).toMatchObject({ active: true })
    expect(await pendingOf(joana.person)).toBe(teamA)
    const structure = await run(await feedFor("ORGANIZATIONAL_STRUCTURE", STRUCTURE, "a-estrutura"), [STRUCTURE, ["CA-SB", "", "CUST-GB"], ["CA-J", "CA-SB", "CUST-GB"]])
    expect((await pool.query<{ team_id: string }>(`select team_id from people where id = $1`, [joana.person])).rows[0]!.team_id).toBe(teamB)
    expect(await accountOf(joana.account)).toMatchObject({ active: false, session_version: 1 })
    expect(await auditOf(joana.account)).toEqual([{ action: "ACCESS_DISABLED", reason: "LINKED_BY_SOURCE_NEW_PLACEMENT" }])
    expect(await warningsOf(structure.id)).toEqual(["DATA_PERSON_LINK_ACCESS_DISABLED"])
    expect(await pendingOf(joana.person)).toBeNull()
  })

  it("B) ligada sem Grupo, a Estrutura põe um operador do Grupo B sob ela: acesso desabilitado", async () => {
    const lia = await manual("Lia", `lia@${DOMAIN}`)
    await run(await feedFor("EMPLOYEES", EMPLOYEES, "b-colab"), [EMPLOYEES, ["CB-L", "Lia", "OPERATOR", `lia@${DOMAIN}`], ["CB-O", "Operador B", "OPERATOR", ""]])
    await run(await feedFor("ORGANIZATIONAL_STRUCTURE", STRUCTURE, "b-estrutura"), [STRUCTURE, ["CB-O", "CB-L", "CUST-GB"]])
    expect(await accountOf(lia.account)).toMatchObject({ active: false })
    expect(await auditOf(lia.account)).toEqual([{ action: "ACCESS_DISABLED", reason: "LINKED_BY_SOURCE_NEW_PLACEMENT" }])
  })

  it("C) a mesma carga de Colaboradores traz o Grupo B só na vez seguinte: acesso desabilitado", async () => {
    const rui = await manual("Rui", `rui@${DOMAIN}`)
    const feed = await feedFor("EMPLOYEES", EMPLOYEES_WITH_GROUP, "c-colab")
    await run(feed, [EMPLOYEES_WITH_GROUP, ["CC-R", "Rui", "OPERATOR", `rui@${DOMAIN}`, ""]])
    expect(await accountOf(rui.account)).toMatchObject({ active: true })
    await run(feed, [EMPLOYEES_WITH_GROUP, ["CC-R", "Rui", "OPERATOR", `rui@${DOMAIN}`, "CUST-GB"]])
    expect(await accountOf(rui.account)).toMatchObject({ active: false })
  })

  it("D) a carga confirma o Grupo do cadastro manual: acesso continua; transferência depois disso é a de sempre", async () => {
    const dora = await manual("Dora", `dora@${DOMAIN}`)
    await run(await feedFor("EMPLOYEES", EMPLOYEES, "d-colab"), [EMPLOYEES, ["CD-D", "Dora", "OPERATOR", `dora@${DOMAIN}`]])
    const structure = await feedFor("ORGANIZATIONAL_STRUCTURE", STRUCTURE, "d-estrutura")
    await run(structure, [STRUCTURE, ["CD-D", "", "CUST-GA"]])
    expect(await accountOf(dora.account)).toEqual({ active: true, session_version: 0, temp_valid: false })
    expect(await pendingOf(dora.person)).toBeNull()
    await run(structure, [STRUCTURE, ["CD-D", "", "CUST-GB"]])
    expect(await accountOf(dora.account)).toEqual({ active: true, session_version: 0, temp_valid: false })
  })

  it("E) senha temporária ainda não usada: mudar de Grupo ou virar liderança a expira (sessões caem); a conta continua habilitada", async () => {
    const feed = await feedFor("EMPLOYEES", EMPLOYEES_WITH_GROUP, "e-colab")
    await run(feed, [EMPLOYEES_WITH_GROUP, ["CE-T", "Teo", "OPERATOR", "", "CUST-GA"], ["CE-P", "Paula", "OPERATOR", "", "CUST-GA"]])
    const people = new Map((await pool.query<{ id: string; matricula: string }>(`select id, matricula from people where organization_id = $1 and matricula in ('CE-T', 'CE-P')`, [ORG])).rows.map((row) => [row.matricula, row.id]))
    const pending = async (matricula: string) => (await pool.query<{ id: string }>(
      `insert into user_accounts (organization_id, person_id, email, password_hash, password_change_required, temporary_password_issued_at, temporary_password_expires_at) values ($1, $2, $3, 'x', true, now(), now() + interval '3 days') returning id`,
      [ORG, people.get(matricula), `${matricula.toLowerCase()}@${DOMAIN}`],
    )).rows[0]!.id
    const teo = await pending("CE-T")
    const paula = await pending("CE-P")
    await run(feed, [EMPLOYEES_WITH_GROUP, ["CE-T", "Teo", "OPERATOR", "", "CUST-GB"], ["CE-P", "Paula", "SUPERVISOR", "", "CUST-GA"]])
    for (const account of [teo, paula]) {
      expect(await accountOf(account)).toEqual({ active: true, session_version: 1, temp_valid: false })
      expect(await auditOf(account)).toEqual([{ action: "ACCESS_TEMPORARY_PASSWORD_REVOKED", reason: "PLACEMENT_CHANGED_BY_SOURCE" }])
    }
  })

  it("F) transferência de quem já usa a própria senha: nada muda", async () => {
    const feed = await feedFor("EMPLOYEES", EMPLOYEES_WITH_GROUP, "f-colab")
    await run(feed, [EMPLOYEES_WITH_GROUP, ["CF-T", "Tiago", "OPERATOR", "", "CUST-GA"]])
    const person = (await pool.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = 'CF-T'`, [ORG])).rows[0]!.id
    const account = (await pool.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, person, `tiago@${DOMAIN}`])).rows[0]!.id
    await run(feed, [EMPLOYEES_WITH_GROUP, ["CF-T", "Tiago", "SUPERVISOR", "", "CUST-GB"]])
    expect(await accountOf(account)).toEqual({ active: true, session_version: 0, temp_valid: false })
    expect(await auditOf(account)).toEqual([])
  })

  describe("a Estrutura como primeira carga sobre quem foi cadastrado à mão", () => {
    let structure: DataFeedRow
    let employees: DataFeedRow
    beforeAll(async () => {
      employees = await feedFor("EMPLOYEES", [...EMPLOYEES_WITH_GROUP], "g-colab")
      structure = await feedFor("ORGANIZATIONAL_STRUCTURE", STRUCTURE, "g-estrutura")
      // Operador do Grupo B criado pela base.
      await run(employees, [EMPLOYEES_WITH_GROUP, ["CG-OTTO", "Otto", "OPERATOR", "", "CUST-GB"]])
    })

    it("G) a Estrutura move a pessoa para o Grupo B e põe um operador do Grupo B sob ela: acesso desabilitado", async () => {
      const nina = await manualWithMatricula("Nina", "CG-NINA", `nina@${DOMAIN}`)
      const done = await run(structure, [STRUCTURE, ["CG-OTTO", "CG-NINA", ""], ["CG-NINA", "", "CUST-GB"]])
      expect(await accountOf(nina.account)).toMatchObject({ active: false, session_version: 1 })
      expect(await warningsOf(done.id)).toContain("DATA_PERSON_LINK_ACCESS_DISABLED")
    })

    it("H) a Estrutura só troca o gestor; depois Colaboradores promove a Supervisora do Grupo B: acesso desabilitado", async () => {
      const rui = await manualWithMatricula("Rui", "CG-RUI", `rui.m@${DOMAIN}`)
      await run(structure, [STRUCTURE, ["CG-RUI", "CG-OTTO", ""]])
      expect(await accountOf(rui.account)).toMatchObject({ active: true })
      expect(await pendingOf(rui.person)).toBe(teamA)
      await run(employees, [EMPLOYEES_WITH_GROUP, ["CG-RUI", "Rui", "SUPERVISOR", "", "CUST-GB"]])
      expect(await accountOf(rui.account)).toMatchObject({ active: false })
    })

    it("I) a Estrutura põe um operador do Grupo B sob ela, sem registro dela na carga: acesso desabilitado", async () => {
      const lia = await manualWithMatricula("Lia", "CG-LIA", `lia.m@${DOMAIN}`)
      await run(employees, [EMPLOYEES_WITH_GROUP, ["CG-OPB", "Operador B2", "OPERATOR", "", "CUST-GB"]])
      await run(structure, [STRUCTURE, ["CG-OPB", "CG-LIA", "CUST-GB"]])
      expect(await accountOf(lia.account)).toMatchObject({ active: false })
    })

    it("J) a Estrutura confirma o Grupo do cadastro manual: acesso continua e a pendência acaba", async () => {
      const ivo = await manualWithMatricula("Ivo", "CG-IVO", `ivo@${DOMAIN}`)
      await run(structure, [STRUCTURE, ["CG-IVO", "", "CUST-GA"]])
      expect(await accountOf(ivo.account)).toEqual({ active: true, session_version: 0, temp_valid: false })
      expect(await pendingOf(ivo.person)).toBeNull()
    })
  })
})

