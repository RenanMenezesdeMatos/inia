import { parseArgs } from "node:util"
import pg from "pg"
import { env } from "../../config/env.js"
import { resolveDemoPassword } from "../database/demo-mass/demo-constants.js"
import { runDemoSeed } from "../database/run-demo-seed.js"
import { runMigrations } from "../database/run-migrations.js"
import { runReferenceSeed } from "../database/run-reference-seed.js"
import { ask, confirm, fail, packageVersion, requirePostgresDatabaseUrl, say } from "./cli.js"
import { configureOrganization, createAdministrator, ensureDatabaseExists, inspectDatabase, isValidEmail, isValidTimeZone, purgeMigrationSeedData, recordInstallation } from "./installation.js"

/**
 * `npm run setup` — PRIMEIRA INSTALAÇÃO da INIA num banco interno VAZIO:
 *   1. cria o banco (se o usuário tiver permissão) e confere que está vazio;
 *   2. aplica todas as migrations;
 *   3. sem `--demo`: remove o que as migrations antigas semearam (organização e contas de demonstração) e cria só o
 *      essencial; com `--demo`: mantém e carrega a massa de demonstração (nunca em produção), com a senha das contas
 *      demo vinda de INIA_DEMO_PASSWORD (backend/.env);
 *   4. dados de referência (feriados);
 *   5. organização (nome e fuso) e PRIMEIRO ADMINISTRADOR com senha temporária aleatória, exibida uma única vez.
 * Banco que já tem tabelas → recusa (para atualizar uma instalação existente use `npm run update`).
 *
 * Sem terminal interativo, passe tudo por opção:
 *   npm run setup -- --org-name "Empresa" --timezone America/Sao_Paulo --admin-name "Nome" --admin-email a@b.com
 */
const { values } = parseArgs({
  options: {
    "org-name": { type: "string" },
    timezone: { type: "string" },
    "admin-name": { type: "string" },
    "admin-email": { type: "string" },
    demo: { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
  },
})

say("INIA — primeira instalação")
requirePostgresDatabaseUrl(env.activeDatabaseUrl)
say(`Banco INTERNO da INIA: ${redact(env.activeDatabaseUrl)}`)
say("(Os bancos EXTERNOS dos clientes são configurados depois, pela tela Central de Dados.)\n")

if (values.demo && env.NODE_ENV === "production") fail("Dados de demonstração nunca entram em produção (NODE_ENV=production). Rode sem --demo.")
if (values.demo) {
  try {
    resolveDemoPassword(process.env.INIA_DEMO_PASSWORD)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }
}
if (env.NODE_ENV === "production" && env.JWT_SECRET === "inia-dev-secret-change-me") fail("Defina JWT_SECRET no backend/.env (npm run env:init gera um valor aleatório).")

try {
  await ensureDatabaseExists(env.activeDatabaseUrl, say)
} catch (error) {
  fail(
    `Não foi possível acessar o banco interno: ${error instanceof Error ? error.message : String(error)}\n` +
      "Confira DATABASE_URL no backend/.env e se o PostgreSQL está no ar (npm run db:up, se usa o Docker Compose). " +
      "Banco em outro servidor: npm run db:connect confere a conexão e explica o que falta (o banco precisa existir, vazio, com o seu usuário como dono).",
  )
}

const client = new pg.Client({ connectionString: env.activeDatabaseUrl })
await client.connect()
try {
  const state = await inspectDatabase(client)
  if (state.kind === "INSTALLED") fail(`Este banco já é uma instalação da INIA (desde ${state.installedAt}). Para aplicar atualizações use: npm run update`)
  if (state.kind === "NOT_INSTALLED_WITH_DATA") fail(`Este banco já tem ${state.tables} tabela(s) e não é uma instalação registrada. A primeira instalação exige um banco vazio; para só aplicar migrations pendentes use: npm run update`)

  const orgName = values["org-name"] ?? (await ask("Nome da organização (ex.: o nome da empresa)", { validate: (value) => (value.trim().length >= 2 ? null : "Informe ao menos 2 caracteres.") }))
  const timeZone = values.timezone ?? (await ask("Fuso horário da operação (IANA)", { defaultValue: "America/Sao_Paulo", validate: (value) => (isValidTimeZone(value) ? null : "Fuso inválido (ex.: America/Sao_Paulo, America/Fortaleza, America/Manaus).") }))
  if (!isValidTimeZone(timeZone)) fail(`Fuso horário inválido: ${timeZone}`)
  const adminName = values["admin-name"] ?? (await ask("Nome completo do primeiro administrador", { validate: (value) => (value.trim().length >= 3 ? null : "Informe o nome completo.") }))
  const adminEmail = values["admin-email"] ?? (await ask("E-mail de login do primeiro administrador", { validate: (value) => (isValidEmail(value.trim()) ? null : "E-mail inválido.") }))
  if (!isValidEmail(adminEmail.trim())) fail(`E-mail inválido: ${adminEmail}`)
  if (!values.yes && process.stdin.isTTY) {
    const go = await confirm(`Instalar "${orgName}" (${timeZone}) com ${adminEmail}${values.demo ? " + DADOS DE DEMONSTRAÇÃO" : ""}?`, true)
    if (!go) fail("Instalação cancelada — nada foi alterado.")
  }

  say("\n1/4 Aplicando migrations…")
  const applied = await runMigrations(client as unknown as pg.PoolClient, () => {})
  say(`    ${applied.length} migration(s) aplicada(s).`)

  say("2/4 Dados de referência (feriados nacionais, estaduais e das capitais)…")
  const reference = await runReferenceSeed(client as unknown as pg.PoolClient)
  say(`    ${reference.holidays.total} feriados no catálogo · ${reference.capitals} capitais.`)

  say(values.demo ? "3/4 Mantendo os dados de demonstração e carregando a massa demo (pode levar alguns minutos)…" : "3/4 Removendo os dados de demonstração das migrations…")
  if (values.demo) {
    await runDemoSeed(client as unknown as pg.PoolClient, env.NODE_ENV, (message) => say(`    ${message}`))
  } else {
    await client.query("begin")
    try {
      await purgeMigrationSeedData(client, (message) => say(`    ${message}`))
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  }

  say("4/4 Organização e primeiro administrador…")
  await client.query("begin")
  let admin
  try {
    await configureOrganization(client, { name: orgName, timeZone })
    admin = await createAdministrator(client, { name: adminName, email: adminEmail, ttlHours: env.TEMPORARY_PASSWORD_TTL_HOURS })
    await recordInstallation(client, { version: packageVersion(), demoData: values.demo, firstAdminAccountId: admin.accountId })
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  }

  say("\n✓ INIA instalada.")
  say(`  Organização: ${orgName} · fuso ${timeZone}`)
  say(`  Administrador: ${adminName} <${admin.email}>`)
  say(`  Senha temporária (aparece SÓ agora): ${admin.temporaryPassword}`)
  say(`  Vale até ${admin.expiresAt.toLocaleString("pt-BR", { timeZone })} — no primeiro login a INIA pede para criar a sua própria senha.`)
  if (values.demo) say("  Dados de demonstração carregados: as contas demo usam a senha de INIA_DEMO_PASSWORD (backend/.env) — nunca use esta instalação com dados reais.")
  if (!env.GEMINI_API_KEY) say("  Aviso: GEMINI_API_KEY não está configurada — os recursos de IA ficam indisponíveis até configurar (backend/.env).")
  say("\nPróximo passo: num servidor, npm run build e os serviços (docs/instalacao); numa máquina de desenvolvimento, npm run dev (e abra http://localhost:3000)")
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await client.end().catch(() => {})
}

function redact(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = "***"
    return parsed.toString()
  } catch {
    return "(DATABASE_URL inválida)"
  }
}
