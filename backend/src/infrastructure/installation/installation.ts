import pg from "pg"
import { generateTemporaryPassword, temporaryPasswordExpiry } from "../../modules/auth/domain/temporary-password.js"
import { hashPassword } from "../../modules/auth/infrastructure/password-hasher.js"
import { createPostgresAccountAccessRepository } from "../../modules/access/infrastructure/postgres-account-access-repository.js"

/**
 * INSTALAÇÃO da INIA (banco INTERNO — nunca os bancos externos que a Central de Dados lê).
 *
 *  - Uma instalação atende UMA organização, criada com o id fixo abaixo. Só a instalação e a massa demo usam esse id: o
 *    código funcional lê a organização da sessão (rotas) ou do registro (jobs e execução) — installation-organization-
 *    guard.test.ts falha se o id voltar a um módulo. O NOME é o do cliente.
 *  - As migrations antigas (002, 009, 019…) carregam uma organização de DEMONSTRAÇÃO com contas de senha pública.
 *    A primeira instalação SEM demonstração apaga, num banco recém-criado, tudo o que as migrations semearam —
 *    menos as tabelas de referência — e cria só o essencial: a organização (nome e fuso) e o primeiro administrador,
 *    com senha temporária aleatória que ele troca no primeiro acesso.
 */
export const INSTALLATION_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"

/** Tabelas que SOBREVIVEM à limpeza: controle de migrations, a organização e dados de referência globais. */
export const KEEP_TABLES = ["schema_migrations", "organizations", "brazilian_capitals", "holiday_catalog"] as const

type Client = pg.ClientBase

export type DatabaseState = { kind: "EMPTY" } | { kind: "INSTALLED"; organizationId: string; installedAt: string; demoData: boolean } | { kind: "NOT_INSTALLED_WITH_DATA"; tables: number }

/** O banco interno está vazio, já é uma instalação, ou tem tabelas de outra origem (desenvolvimento antigo)? */
export async function inspectDatabase(client: Client): Promise<DatabaseState> {
  const tables = await client.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)
  if ((tables.rows[0]?.n ?? 0) === 0) return { kind: "EMPTY" }
  const hasMarker = await client.query<{ exists: boolean }>(`select to_regclass('public.installation_info') is not null as exists`)
  if (hasMarker.rows[0]?.exists) {
    const marker = await client.query<{ organization_id: string; installed_at: Date; demo_data: boolean }>(`select organization_id, installed_at, demo_data from installation_info`)
    const row = marker.rows[0]
    if (row) return { kind: "INSTALLED", organizationId: row.organization_id, installedAt: row.installed_at.toISOString(), demoData: row.demo_data }
  }
  return { kind: "NOT_INSTALLED_WITH_DATA", tables: tables.rows[0]!.n }
}

/**
 * Apaga tudo o que as migrations semearam (organização de demonstração, contas com senha pública, casos, agentes…)
 * mantendo só KEEP_TABLES. Só pode rodar num banco que ACABOU de receber as migrations (quem chama garante isso a
 * partir de um banco vazio) — por segurança, ainda confere que não há marcador de instalação nem dado de uso real.
 */
export async function purgeMigrationSeedData(client: Client, log: (message: string) => void): Promise<number> {
  const guard = await client.query<{ installed: number; logins: number; sources: number; runs: number }>(
    `select (select count(*)::int from installation_info) installed,
            (select count(*)::int from user_accounts where last_login_at is not null) logins,
            (select count(*)::int from data_sources) sources,
            (select count(*)::int from workflow_enrollments) runs`,
  )
  const state = guard.rows[0]!
  if (state.installed > 0 || state.logins > 0 || state.sources > 0 || state.runs > 0) {
    throw new Error("Limpeza recusada: este banco já foi usado (há instalação, logins, fontes ou execuções). A limpeza só roda num banco recém-criado.")
  }
  const keep = new Set<string>(KEEP_TABLES)
  // Uma tabela mantida não pode depender de uma tabela que será esvaziada (o CASCADE a esvaziaria junto).
  const keptDependencies = await client.query<{ child: string; parent: string }>(
    `select c.conrelid::regclass::text child, c.confrelid::regclass::text parent from pg_constraint c where c.contype = 'f' and c.conrelid::regclass::text = any($1::text[])`,
    [[...keep]],
  )
  const unsafe = keptDependencies.rows.filter((row) => !keep.has(row.parent))
  if (unsafe.length) throw new Error(`Limpeza recusada: tabela mantida depende de tabela a esvaziar (${unsafe.map((row) => `${row.child} → ${row.parent}`).join(", ")}).`)
  const tables = await client.query<{ name: string }>(`select tablename name from pg_tables where schemaname = 'public' order by 1`)
  const targets = tables.rows.map((row) => row.name).filter((name) => !keep.has(name))
  if (targets.length === 0) return 0
  await client.query(`truncate table ${targets.map((name) => `public."${name.replace(/"/g, '""')}"`).join(", ")} restart identity cascade`)
  await client.query(`delete from organizations where id <> $1`, [INSTALLATION_ORGANIZATION_ID])
  log(`dados de demonstração das migrations removidos (${targets.length} tabelas esvaziadas; mantidas: ${KEEP_TABLES.join(", ")})`)
  return targets.length
}

export type OrganizationInput = { name: string; timeZone: string }

export function slugify(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "organizacao"
  )
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/** Organização da instalação: nome do cliente e fuso da operação (base de toda conta de calendário). */
export async function configureOrganization(client: Client, input: OrganizationInput): Promise<void> {
  if (!isValidTimeZone(input.timeZone)) throw new Error(`Fuso horário inválido: ${input.timeZone} (use um nome IANA, ex.: America/Sao_Paulo).`)
  const updated = await client.query(`update organizations set name = $2, slug = $3, holiday_fallback_policy = 'IGNORE' where id = $1`, [INSTALLATION_ORGANIZATION_ID, input.name.trim(), slugify(input.name)])
  if (!updated.rowCount) await client.query(`insert into organizations (id, name, slug) values ($1, $2, $3)`, [INSTALLATION_ORGANIZATION_ID, input.name.trim(), slugify(input.name)])
  const operation = await client.query<{ id: string }>(`select id from operations where organization_id = $1 order by created_at limit 1`, [INSTALLATION_ORGANIZATION_ID])
  if (operation.rows[0]) await client.query(`update operations set timezone = $2 where id = $1`, [operation.rows[0].id, input.timeZone])
  else await client.query(`insert into operations (organization_id, name, timezone) values ($1, 'Operação principal', $2)`, [INSTALLATION_ORGANIZATION_ID, input.timeZone])
}

export type AdministratorInput = { name: string; email: string; ttlHours: number; now?: Date }
export type CreatedAdministrator = { personId: string; accountId: string; email: string; temporaryPassword: string; expiresAt: Date }

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Administrador geral da organização: pessoa "fora da hierarquia" + conta com SENHA TEMPORÁRIA aleatória (gerada
 * aqui, mostrada uma vez, guardada só como hash) + papel ADMINISTRADOR_GERAL com escopo da organização. No primeiro
 * login a INIA exige que ele crie a própria senha. Nunca existe senha fixa compartilhada.
 */
export async function createAdministrator(client: Client, input: AdministratorInput): Promise<CreatedAdministrator> {
  const email = normalizeEmail(input.email)
  if (!isValidEmail(email)) throw new Error(`E-mail inválido: ${input.email}`)
  if (input.name.trim().length < 3) throw new Error("Informe o nome completo do administrador.")
  const taken = await client.query(`select 1 from user_accounts where lower(email) = $1`, [email])
  if (taken.rowCount) throw new Error(`Já existe uma conta com o e-mail ${email}.`)
  const now = input.now ?? new Date()
  const person = await client.query<{ id: string }>(
    `insert into people (organization_id, name, role, job_title, active) values ($1, $2, 'ADMIN', 'Administração da INIA', true) returning id`,
    [INSTALLATION_ORGANIZATION_ID, input.name.trim()],
  )
  const personId = person.rows[0]!.id
  const temporaryPassword = generateTemporaryPassword()
  const expiresAt = temporaryPasswordExpiry(now, input.ttlHours)
  const accounts = createPostgresAccountAccessRepository(client as unknown as Parameters<typeof createPostgresAccountAccessRepository>[0])
  const created = await accounts.createWithTemporaryPassword({ organizationId: INSTALLATION_ORGANIZATION_ID, personId, email, passwordHash: await hashPassword(temporaryPassword), issuedAt: now, expiresAt, actorPersonId: null, actorAccountId: null })
  if (!created.ok) throw new Error(`Não foi possível criar a conta (${created.error}).`)
  await client.query(
    `insert into access_role_assignments (organization_id, user_account_id, role_code, scope_type, source, granted_at) values ($1, $2, 'ADMINISTRADOR_GERAL', 'ORGANIZATION', 'INSTALLATION', $3)`,
    [INSTALLATION_ORGANIZATION_ID, created.accountId, now],
  )
  await client.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, null, 'INSTALLATION_ADMIN_CREATED', 'user_account', $2, $3)`,
    [INSTALLATION_ORGANIZATION_ID, created.accountId, JSON.stringify({ email, role: "ADMINISTRADOR_GERAL", temporaryPasswordExpiresAt: expiresAt.toISOString() })],
  )
  return { personId, accountId: created.accountId, email, temporaryPassword, expiresAt }
}

export async function recordInstallation(client: Client, input: { version: string; demoData: boolean; firstAdminAccountId: string }): Promise<void> {
  await client.query(`insert into installation_info (organization_id, installed_version, demo_data, first_admin_account_id) values ($1, $2, $3, $4)`, [INSTALLATION_ORGANIZATION_ID, input.version, input.demoData, input.firstAdminAccountId])
}

export async function recordUpdate(client: Client, version: string): Promise<boolean> {
  const exists = await client.query<{ exists: boolean }>(`select to_regclass('public.installation_info') is not null as exists`)
  if (!exists.rows[0]?.exists) return false
  const updated = await client.query(`update installation_info set last_update_at = now(), last_update_version = $1`, [version])
  return (updated.rowCount ?? 0) > 0
}

/** Cria o banco (no mesmo servidor) se ainda não existir — precisa de permissão CREATEDB; senão orienta. */
export async function ensureDatabaseExists(connectionString: string, log: (message: string) => void): Promise<void> {
  const target = new URL(connectionString)
  const database = decodeURIComponent(target.pathname.replace(/^\//, ""))
  if (!database) throw new Error("DATABASE_URL precisa terminar com o nome do banco (ex.: postgresql://usuario:senha@localhost:5432/inia).")
  const probe = new pg.Client({ connectionString })
  try {
    await probe.connect()
    await probe.end()
    return
  } catch (error) {
    await probe.end().catch(() => {})
    if ((error as { code?: string }).code !== "3D000") throw error
  }
  const maintenance = new URL(connectionString)
  maintenance.pathname = "/postgres"
  const admin = new pg.Client({ connectionString: maintenance.toString() })
  await admin.connect()
  try {
    await admin.query(`create database "${database.replace(/"/g, '""')}"`)
    log(`banco ${database} criado`)
  } finally {
    await admin.end()
  }
}
