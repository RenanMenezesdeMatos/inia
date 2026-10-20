import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { linkPersonToSourcePerson, loadPersonLink } from "../../people/application/person-source-link.js"
import { createDataHubContext, type DataHubContext } from "../application/data-hub-context.js"
import { createFeed, setFeedStatus } from "../application/feed-service.js"
import { loadPersonFieldControl } from "../application/person-field-control.js"
import { type DataFeedRow, type DataRunRow } from "../application/records.js"
import { enqueueRun } from "../application/run-service.js"
import { executeRun } from "../application/run-pipeline.js"
import { createSource } from "../application/source-service.js"
import type { DataFeedRow as FeedRow } from "../application/records.js"
import { CapturingLogger, FakeSftpClient, InMemorySecretStore, MockHttpClient } from "./fakes.js"

/**
 * IDENTIDADE — cadastro manual × base do cliente (banco de teste real, INIA_DB_PROOF=1):
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run person-identity-proof
 * Prova: matrícula nova com o e-mail da conta de uma pessoa cadastrada à mão vira a MESMA pessoa (login e papéis ficam,
 * auditoria + linhagem + aviso); mesmo nome sem e-mail NÃO junta (aviso de possível duplicado com os dois ids); recarga não
 * repete nada; "Vincular à pessoa da base" move a conta (papéis juntos), derruba sessões, inativa a avulsa e a marca.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
/** Organização PRÓPRIA da prova (nada interfere na demo nem em outras provas). */
const ORG = "de00ee00-0000-4000-8000-00000000f3f0"
const OPERATION = "de00ee00-0000-4000-8000-00000000f3f1"
const NOW = new Date("2026-10-15T15:00:00-03:00")
const DOMAIN = "pil-proof.test"

let pool: pg.Pool
let db: Database
let ctx: DataHubContext
let feed: DataFeedRow
const manual: Record<"ana" | "bruno" | "celia" | "eva", { personId: string; accountId: string | null }> = {} as never

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map((row) => row.join(";")).join("\n"))
const fileFeedConfig = { connector: "FILE_UPLOAD" as const, file: { format: "CSV" as const, csv: { encoding: "utf-8" as const, delimiter: "auto" as const, hasHeader: true, skipRows: 0 }, excel: { hasHeader: true, skipRows: 0 } } }
const identity = (fields: string[]) => ({ fields: fields.map((field) => ({ target: field, source: field, transforms: [] })) })
const HEADER = ["externalEmployeeId", "name", "role", "email"]
const LOAD = csv([HEADER, ["PIL-01", "Ana Lima", "OPERATOR", `ana.lima@${DOMAIN}`], ["PIL-02", "Bruno Souza", "OPERATOR", ""], ["PIL-03", "Célia Prado", "SUPERVISOR", ""], ["PIL-04", "Dora Nunes", "OPERATOR", `dora@${DOMAIN}`]])

async function run(content: Uint8Array, filename: string): Promise<DataRunRow> {
  const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: feed.sourceId, feedId: feed.id, filename, contentType: "text/csv", content })
  const { run } = await enqueueRun(ctx, { organizationId: ORG, feed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
  return (await executeRun(ctx, run.id))!
}

async function manualPerson(name: string, role: string, email: string | null) {
  const person = await db.query<{ id: string }>(`insert into people (organization_id, name, role) values ($1, $2, $3) returning id`, [ORG, name, role])
  if (!email) return { personId: person.rows[0]!.id, accountId: null }
  const account = await db.query<{ id: string }>(`insert into user_accounts (organization_id, person_id, email, password_hash) values ($1, $2, $3, 'x') returning id`, [ORG, person.rows[0]!.id, email])
  return { personId: person.rows[0]!.id, accountId: account.rows[0]!.id }
}

async function cleanup() {
  await db.query(`delete from access_role_assignments where organization_id = $1`, [ORG])
  await db.query(`delete from user_accounts where organization_id = $1`, [ORG])
  await db.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await db.query(`delete from data_sources where organization_id = $1`, [ORG])
  await db.query(`delete from data_raw_objects where organization_id = $1`, [ORG])
  await db.query(`delete from people where organization_id = $1`, [ORG])
  await db.query(`delete from teams where organization_id = $1`, [ORG])
  await db.query(`delete from operations where organization_id = $1`, [ORG])
  await db.query(`delete from organizations where id = $1`, [ORG])
}

describe.skipIf(!ENABLED)("Identidade — cadastro manual × carga de Colaboradores", () => {
  let first: DataRunRow

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    ctx = createDataHubContext(db, { http: new MockHttpClient(), sftp: new FakeSftpClient(), logger: new CapturingLogger(), secrets: new InMemorySecretStore(), clock: { now: () => NOW } })
    await cleanup()
    await db.query(`insert into organizations (id, name, slug) values ($1, 'PIL Identidade', 'pil-identidade')`, [ORG])
    await db.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'PIL Operação', 'America/Fortaleza')`, [OPERATION, ORG])
    const source = await createSource(ctx, ORG, null, { name: "PIL RH", config: { kind: "FILE_UPLOAD" } })
    feed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "colaboradores", name: "Colaboradores", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, authoritative: true, sourceNamespace: "pil-rh", cadence: { kind: "MANUAL" }, mapping: identity(HEADER) })).id, "ACTIVATE")
    manual.ana = await manualPerson("Ana Lima", "OPERATOR", `ana.lima@${DOMAIN}`)
    manual.bruno = await manualPerson("  bruno  SOUZA ", "OPERATOR", null)
    manual.celia = await manualPerson("Celia Prado", "OPERATOR", `celia@${DOMAIN}`)
    manual.eva = await manualPerson("Eva Rocha", "ADMIN", `eva@${DOMAIN}`)
    await db.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'QA_DE_FEEDBACK', 'ORGANIZATION', now()), ($1, $3, 'QA_DE_FEEDBACK', 'ORGANIZATION', now())`, [ORG, manual.ana.accountId, manual.celia.accountId])
    first = await run(LOAD, "pil-1.csv")
  }, 60_000)

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  it("chave forte: matrícula nova com o e-mail da conta da pessoa cadastrada à mão vira a MESMA pessoa — login e papéis ficam", async () => {
    expect(first.status).toBe("COMPLETED")
    expect(first.recordsRejected).toBe(0)
    const anas = await db.query<{ id: string; matricula: string | null }>(`select id, matricula from people where organization_id = $1 and name = 'Ana Lima'`, [ORG])
    expect(anas.rows).toEqual([{ id: manual.ana.personId, matricula: "PIL-01" }])
    const account = await db.query<{ person_id: string; roles: number }>(`select ua.person_id, (select count(*)::int from access_role_assignments a where a.user_account_id = ua.id and a.revoked_at is null) roles from user_accounts ua where ua.id = $1`, [manual.ana.accountId])
    expect(account.rows[0]).toEqual({ person_id: manual.ana.personId, roles: 1 })
    // Rastro: auditoria (sem dado pessoal além de id e matrícula), linhagem da carga e aviso na quarentena.
    const audit = await db.query<{ payload: Record<string, unknown> }>(`select payload from audit_logs where organization_id = $1 and action = 'PERSON_LINKED_TO_SOURCE' and entity_id = $2`, [ORG, manual.ana.personId])
    expect(audit.rows.map((row) => row.payload)).toEqual([{ mode: "ACCOUNT_EMAIL", personId: manual.ana.personId, matricula: "PIL-01", runId: first.id, feedId: feed.id }])
    const lineage = await db.query(`select 1 from data_lineage where run_id = $1 and entity_type = 'people' and entity_id = $2`, [first.id, manual.ana.personId])
    expect(lineage.rows).toHaveLength(1)
    const warnings = await db.query<{ record_number: number; error_code: string }>(`select record_number, error_code from data_ingestion_rejections where run_id = $1 and error_code = 'DATA_PERSON_LINKED_BY_EMAIL'`, [first.id])
    expect(warnings.rows).toEqual([{ record_number: 1, error_code: "DATA_PERSON_LINKED_BY_EMAIL" }])
    // A base passa a mandar nos campos dela.
    expect((await loadPersonFieldControl(db, ORG, [manual.ana.personId])).get(manual.ana.personId)!.name).toEqual({ sourceName: "PIL RH", feedName: "Colaboradores" })
  })

  it("chave fraca: mesmo nome (sem e-mail) NÃO junta — insere e avisa de possível duplicado com os dois ids", async () => {
    const brunos = await db.query<{ id: string; matricula: string | null }>(`select id, matricula from people where organization_id = $1 and lower(trim(name)) like '%bruno%souza%' order by matricula nulls first`, [ORG])
    expect(brunos.rows.map((row) => row.matricula)).toEqual([null, "PIL-02"])
    const warning = await db.query<{ message: string }>(`select message from data_ingestion_rejections where run_id = $1 and error_code = 'DATA_POSSIBLE_DUPLICATE_PERSON' and record_number = 2`, [first.id])
    expect(warning.rows[0]!.message).toContain(manual.bruno.personId)
    expect(warning.rows[0]!.message).toContain(brunos.rows[1]!.id)
    // "Célia Prado" × "Celia Prado": acento não esconde o possível duplicado; Dora (e-mail sem conta) entra sem aviso.
    const codes = await db.query<{ record_number: number; error_code: string }>(`select record_number, error_code from data_ingestion_rejections where run_id = $1 order by record_number, error_code`, [first.id])
    expect(codes.rows).toEqual([
      { record_number: 1, error_code: "DATA_PERSON_LINKED_BY_EMAIL" },
      { record_number: 2, error_code: "DATA_POSSIBLE_DUPLICATE_PERSON" },
      { record_number: 3, error_code: "DATA_POSSIBLE_DUPLICATE_PERSON" },
    ])
  })

  it("recarga igual não liga nem avisa de novo", async () => {
    const second = await run(LOAD, "pil-2.csv")
    expect(second.status).toBe("COMPLETED")
    expect((await db.query(`select 1 from data_ingestion_rejections where run_id = $1`, [second.id])).rows).toHaveLength(0)
    expect((await db.query(`select 1 from audit_logs where organization_id = $1 and action = 'PERSON_LINKED_TO_SOURCE'`, [ORG])).rows).toHaveLength(1)
    expect((await db.query(`select 1 from people where organization_id = $1`, [ORG])).rows).toHaveLength(7)
  })

  it("Vincular à pessoa da base: conta e papéis vão para a pessoa da base, sessões caem, a avulsa fica inativa e marcada", async () => {
    const target = await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = 'PIL-03'`, [ORG])
    const toPersonId = target.rows[0]!.id
    const before = await db.query<{ session_version: number }>(`select session_version from user_accounts where id = $1`, [manual.celia.accountId])
    const result = await linkPersonToSourcePerson(db, { organizationId: ORG, fromPersonId: manual.celia.personId, toPersonId, actorPersonId: manual.eva.personId, actorAccountId: manual.eva.accountId! })
    expect(result).toEqual({ fromPersonId: manual.celia.personId, toPersonId, matricula: "PIL-03", accountId: manual.celia.accountId, sessionsRevoked: true })
    const account = await db.query<{ person_id: string; session_version: number; roles: number }>(`select ua.person_id, ua.session_version, (select count(*)::int from access_role_assignments a where a.user_account_id = ua.id and a.revoked_at is null) roles from user_accounts ua where ua.id = $1`, [manual.celia.accountId])
    expect(account.rows[0]).toEqual({ person_id: toPersonId, session_version: before.rows[0]!.session_version + 1, roles: 1 })
    expect((await db.query<{ active: boolean }>(`select active from people where id = $1`, [manual.celia.personId])).rows[0]!.active).toBe(false)
    expect(await loadPersonLink(db, ORG, manual.celia.personId)).toMatchObject({ id: toPersonId, name: "Célia Prado", matricula: "PIL-03" })
    // Uma vez só.
    await expect(linkPersonToSourcePerson(db, { organizationId: ORG, fromPersonId: manual.celia.personId, toPersonId, actorPersonId: manual.eva.personId, actorAccountId: manual.eva.accountId! })).rejects.toMatchObject({ code: "PERSON_ALREADY_LINKED" })
  })

  it("destino que já tem conta, destino sem matrícula e origem da base são recusados sem mexer em nada", async () => {
    const ana = manual.ana.personId // agora da base, com conta
    const dora = (await db.query<{ id: string }>(`select id from people where organization_id = $1 and matricula = 'PIL-04'`, [ORG])).rows[0]!.id
    const attempt = (fromPersonId: string, toPersonId: string) => linkPersonToSourcePerson(db, { organizationId: ORG, fromPersonId, toPersonId, actorPersonId: manual.eva.personId, actorAccountId: manual.eva.accountId! }).then(() => null, (error: DomainError) => error.code)
    expect(await attempt(manual.eva.personId, ana)).toBe("PERSON_LINK_TARGET_HAS_ACCOUNT")
    expect(await attempt(manual.eva.personId, manual.bruno.personId)).toBe("PERSON_LINK_TARGET_NOT_FROM_SOURCE")
    expect(await attempt(ana, dora)).toBe("PERSON_LINK_SOURCE_HAS_MATRICULA")
    const eva = await db.query<{ person_id: string }>(`select person_id from user_accounts where id = $1`, [manual.eva.accountId])
    expect(eva.rows[0]!.person_id).toBe(manual.eva.personId)
  })

  describe("credencial da pessoa ligada ou desligada pela base (auditoria de segurança 17/10/2026, AUTH-13/AUTH-7)", () => {
    const PLACEMENT_HEADER = ["externalEmployeeId", "name", "role", "email", "groupExternalCode", "active"]
    let placementFeed: FeedRow
    let teamA: string
    let teamB: string
    const placementRun = async (rows: string[][], filename: string) => {
      const raw = await ctx.rawObjects.put({ organizationId: ORG, sourceId: placementFeed.sourceId, feedId: placementFeed.id, filename, contentType: "text/csv", content: csv([PLACEMENT_HEADER, ...rows]) })
      const { run: queued } = await enqueueRun(ctx, { organizationId: ORG, feed: placementFeed, triggerKind: "FILE_UPLOAD", requestedBy: null, rawObjectId: raw.id })
      return (await executeRun(ctx, queued.id))!
    }
    const accountOf = async (accountId: string | null) => (await db.query<{ active: boolean; session_version: number }>(`select active, session_version from user_accounts where id = $1`, [accountId])).rows[0]!
    const inTeam = async (name: string, teamId: string, email: string) => {
      const person = await manualPerson(name, "OPERATOR", email)
      await db.query(`update people set team_id = $2 where id = $1`, [person.personId, teamId])
      return person
    }

    beforeAll(async () => {
      teamA = (await db.query<{ id: string }>(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'PIL Grupo A', 'PIL-GA') returning id`, [ORG, OPERATION])).rows[0]!.id
      teamB = (await db.query<{ id: string }>(`insert into teams (organization_id, operation_id, name, external_code) values ($1, $2, 'PIL Grupo B', 'PIL-GB') returning id`, [ORG, OPERATION])).rows[0]!.id
      const source = await createSource(ctx, ORG, null, { name: "PIL RH 2", config: { kind: "FILE_UPLOAD" } })
      placementFeed = await setFeedStatus(ctx, ORG, null, (await createFeed(ctx, ORG, null, source.id, { feedKey: "colaboradores-lugar", name: "Colaboradores com Grupo", contractKey: "EMPLOYEES", connectorConfig: fileFeedConfig, authoritative: false, sourceNamespace: "pil-rh-2", cadence: { kind: "MANUAL" }, mapping: identity(PLACEMENT_HEADER) })).id, "ACTIVATE")
    }, 60_000)

    it("pré-cadastrada no Grupo A e posta pela base como Supervisora do Grupo B: ligada, mas o acesso cai até quem tem custódia liberar", async () => {
      const joana = await inTeam("Joana Silva", teamA, `joana@${DOMAIN}`)
      const before = await accountOf(joana.accountId)
      const result = await placementRun([["PIL-10", "Joana Silva", "SUPERVISOR", `joana@${DOMAIN}`, "PIL-GB", "true"]], "pil-lugar-1.csv")
      expect(result.status).toBe("COMPLETED")
      expect((await db.query<{ matricula: string; team_id: string; role: string }>(`select matricula, team_id, role from people where id = $1`, [joana.personId])).rows[0]).toEqual({ matricula: "PIL-10", team_id: teamB, role: "SUPERVISOR" })
      expect(await accountOf(joana.accountId)).toEqual({ active: false, session_version: before.session_version + 1 })
      const codes = (await db.query<{ error_code: string }>(`select error_code from data_ingestion_rejections where run_id = $1 order by error_code`, [result.id])).rows.map((row) => row.error_code)
      expect(codes.sort()).toEqual(["DATA_PERSON_LINKED_BY_EMAIL", "DATA_PERSON_LINK_ACCESS_DISABLED"].sort())
      const audit = await db.query<{ payload: { reason: string } }>(`select payload from audit_logs where organization_id = $1 and action = 'ACCESS_DISABLED' and entity_id = $2`, [ORG, joana.accountId])
      expect(audit.rows.map((row) => row.payload.reason)).toEqual(["LINKED_BY_SOURCE_NEW_PLACEMENT"])
    })

    it("pré-cadastrada no MESMO Grupo e nível: ligada e o acesso continua (o fluxo de cadastrar antes da carga segue)", async () => {
      const gil = await inTeam("Gil Torres", teamA, `gil@${DOMAIN}`)
      const before = await accountOf(gil.accountId)
      const result = await placementRun([["PIL-11", "Gil Torres", "OPERATOR", `gil@${DOMAIN}`, "PIL-GA", "true"]], "pil-lugar-2.csv")
      expect(result.status).toBe("COMPLETED")
      expect(await accountOf(gil.accountId)).toEqual(before)
    })

    it("desligada pela base: a conta é desabilitada (reativar não devolve a senha nem os tokens); Administrador geral só perde as sessões", async () => {
      const hugo = await inTeam("Hugo Reis", teamA, `hugo@${DOMAIN}`)
      const iris = await inTeam("Iris Melo", teamA, `iris@${DOMAIN}`)
      await db.query(`insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', now())`, [ORG, iris.accountId])
      await placementRun([["PIL-12", "Hugo Reis", "OPERATOR", `hugo@${DOMAIN}`, "PIL-GA", "true"], ["PIL-13", "Iris Melo", "OPERATOR", `iris@${DOMAIN}`, "PIL-GA", "true"]], "pil-lugar-3.csv")
      const hugoBefore = await accountOf(hugo.accountId)
      const irisBefore = await accountOf(iris.accountId)
      expect(hugoBefore.active && irisBefore.active).toBe(true)
      await placementRun([["PIL-12", "Hugo Reis", "OPERATOR", `hugo@${DOMAIN}`, "PIL-GA", "false"], ["PIL-13", "Iris Melo", "OPERATOR", `iris@${DOMAIN}`, "PIL-GA", "false"]], "pil-lugar-4.csv")
      expect(await accountOf(hugo.accountId)).toEqual({ active: false, session_version: hugoBefore.session_version + 1 })
      expect(await accountOf(iris.accountId)).toEqual({ active: true, session_version: irisBefore.session_version + 1 })
      // Reativada pela base: a pessoa volta, a conta de quem não é Administrador geral continua desabilitada.
      await placementRun([["PIL-12", "Hugo Reis", "OPERATOR", `hugo@${DOMAIN}`, "PIL-GA", "true"]], "pil-lugar-5.csv")
      expect((await db.query<{ active: boolean }>(`select active from people where id = $1`, [hugo.personId])).rows[0]!.active).toBe(true)
      expect((await accountOf(hugo.accountId)).active).toBe(false)
    })
  })
})
