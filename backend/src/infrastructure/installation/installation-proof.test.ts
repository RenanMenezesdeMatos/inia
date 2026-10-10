import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { verifyPassword } from "../../modules/auth/infrastructure/password-hasher.js"
import { runMigrations } from "../database/run-migrations.js"
import { runReferenceSeed } from "../database/run-reference-seed.js"
import { configureOrganization, createAdministrator, inspectDatabase, INSTALLATION_ORGANIZATION_ID, KEEP_TABLES, purgeMigrationSeedData, recordInstallation, recordUpdate } from "./installation.js"

/**
 * Prova da INSTALAÇÃO contra um PostgreSQL real (mesmo servidor do banco de teste, banco próprio criado e apagado aqui):
 * banco vazio → migrations → referência → limpeza do que as migrations semearam → organização + primeiro administrador
 * → marcador. Mesmas funções do `npm run setup` / `npm run update`.
 *
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run installation-proof
 */
const enabled = process.env.INIA_DB_PROOF === "1"
const baseUrl = process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/inia_test"
const PROOF_DATABASE = "inia_installation_proof"

function urlFor(database: string): string {
  const url = new URL(baseUrl)
  url.pathname = `/${database}`
  return url.toString()
}

describe.skipIf(!enabled)("instalação — banco vazio até o primeiro administrador", () => {
  let client: pg.Client

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: urlFor("postgres") })
    await admin.connect()
    await admin.query(`drop database if exists ${PROOF_DATABASE}`)
    await admin.query(`create database ${PROOF_DATABASE}`)
    await admin.end()
    client = new pg.Client({ connectionString: urlFor(PROOF_DATABASE) })
    await client.connect()
  }, 60_000)

  afterAll(async () => {
    await client?.end().catch(() => {})
    const admin = new pg.Client({ connectionString: urlFor("postgres") })
    await admin.connect()
    await admin.query(`drop database if exists ${PROOF_DATABASE}`)
    await admin.end()
  }, 60_000)

  it("primeira instalação: só o essencial, sem senha padrão, e não roda duas vezes", async () => {
    expect(await inspectDatabase(client)).toEqual({ kind: "EMPTY" })

    const applied = await runMigrations(client as unknown as pg.PoolClient, () => {})
    expect(applied.length).toBeGreaterThan(100)
    await runReferenceSeed(client as unknown as pg.PoolClient)

    // As migrations antigas semeiam uma organização de demonstração com contas de senha pública.
    const seeded = await client.query<{ n: number }>("select count(*)::int n from user_accounts")
    expect(seeded.rows[0]!.n).toBeGreaterThan(0)

    await client.query("begin")
    await purgeMigrationSeedData(client, () => {})
    await client.query("commit")

    await client.query("begin")
    await configureOrganization(client, { name: "Empresa da Prova", timeZone: "America/Fortaleza" })
    const created = await createAdministrator(client, { name: "Pessoa Administradora", email: "Admin.Prova@Empresa.com.br", ttlHours: 72 })
    await recordInstallation(client, { version: "0.0.0-prova", demoData: false, firstAdminAccountId: created.accountId })
    await client.query("commit")

    // Tabelas com linhas: só referência, a organização e o que o administrador precisa.
    const tables = await client.query<{ name: string }>(`select tablename name from pg_tables where schemaname = 'public' order by 1`)
    const nonEmpty: Record<string, number> = {}
    for (const { name } of tables.rows) {
      const count = await client.query<{ n: number }>(`select count(*)::int n from public."${name}"`)
      if (count.rows[0]!.n > 0) nonEmpty[name] = count.rows[0]!.n
    }
    expect(Object.keys(nonEmpty).sort()).toEqual(
      [...KEEP_TABLES, "access_role_assignments", "audit_logs", "installation_info", "operations", "people", "user_accounts"].sort(),
    )
    expect(nonEmpty).toMatchObject({ organizations: 1, people: 1, user_accounts: 1, access_role_assignments: 1, operations: 1, installation_info: 1, brazilian_capitals: 27 })

    // Organização, fuso e administrador com senha TEMPORÁRIA (só hash; troca obrigatória no primeiro acesso).
    const organization = await client.query<{ name: string; slug: string }>("select name, slug from organizations")
    expect(organization.rows).toEqual([{ name: "Empresa da Prova", slug: "empresa-da-prova" }])
    const operation = await client.query<{ timezone: string }>("select timezone from operations")
    expect(operation.rows[0]!.timezone).toBe("America/Fortaleza")
    const account = await client.query<{ email: string; password_hash: string; password_change_required: boolean; organization_id: string }>(
      "select email, password_hash, password_change_required, organization_id from user_accounts",
    )
    expect(account.rows[0]).toMatchObject({ email: "admin.prova@empresa.com.br", password_change_required: true, organization_id: INSTALLATION_ORGANIZATION_ID })
    expect(account.rows[0]!.password_hash).not.toContain(created.temporaryPassword)
    expect(await verifyPassword(created.temporaryPassword, account.rows[0]!.password_hash)).toBe(true)
    expect(await verifyPassword("Inia@123", account.rows[0]!.password_hash)).toBe(false)
    const role = await client.query<{ role_code: string; scope_type: string; source: string }>("select role_code, scope_type, source from access_role_assignments")
    expect(role.rows).toEqual([{ role_code: "ADMINISTRADOR_GERAL", scope_type: "ORGANIZATION", source: "INSTALLATION" }])
    const audit = await client.query<{ payload: unknown }>("select payload from audit_logs where action = 'INSTALLATION_ADMIN_CREATED'")
    expect(JSON.stringify(audit.rows)).not.toContain(created.temporaryPassword)

    // Instalado: a limpeza é recusada; o banco não é mais "vazio".
    expect(await inspectDatabase(client)).toMatchObject({ kind: "INSTALLED", organizationId: INSTALLATION_ORGANIZATION_ID, demoData: false })
    await expect(purgeMigrationSeedData(client, () => {})).rejects.toThrow(/Limpeza recusada/)
    // Mesmo e-mail não cria outra conta.
    await expect(createAdministrator(client, { name: "Outra Pessoa", email: "admin.prova@empresa.com.br", ttlHours: 72 })).rejects.toThrow(/Já existe uma conta/)
  }, 180_000)

  it("atualização: sem migration pendente, nada muda e a versão fica registrada", async () => {
    const before = await client.query<{ n: number }>("select count(*)::int n from schema_migrations")
    const applied = await runMigrations(client as unknown as pg.PoolClient, () => {})
    expect(applied).toEqual([])
    const reference = await runReferenceSeed(client as unknown as pg.PoolClient)
    expect(reference.holidays.inserted).toBe(0)
    expect(await recordUpdate(client, "0.0.1-prova")).toBe(true)
    const after = await client.query<{ n: number }>("select count(*)::int n from schema_migrations")
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n)
    const marker = await client.query<{ installed_version: string; last_update_version: string }>("select installed_version, last_update_version from installation_info")
    expect(marker.rows[0]).toEqual({ installed_version: "0.0.0-prova", last_update_version: "0.0.1-prova" })
    const people = await client.query<{ n: number }>("select count(*)::int n from people")
    expect(people.rows[0]!.n).toBe(1)
  }, 120_000)
})
