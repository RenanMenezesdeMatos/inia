import { parseArgs } from "node:util"
import pg from "pg"
import { env } from "../../config/env.js"
import { ask, fail, requirePostgresDatabaseUrl, say } from "./cli.js"
import { createAdministrator, inspectDatabase, isValidEmail } from "./installation.js"

/**
 * `npm run admin:create` — cria OUTRO administrador geral (ex.: o primeiro perdeu o acesso ou a senha temporária
 * venceu). Mesmo fluxo do setup: senha temporária aleatória, exibida uma vez, troca obrigatória no primeiro login.
 *   npm run admin:create -- --name "Nome" --email pessoa@empresa.com
 */
const { values } = parseArgs({ options: { name: { type: "string" }, email: { type: "string" } } })
requirePostgresDatabaseUrl(env.activeDatabaseUrl)
const client = new pg.Client({ connectionString: env.activeDatabaseUrl })
await client.connect().catch((error: unknown) => fail(`Não foi possível acessar o banco interno: ${error instanceof Error ? error.message : String(error)} (confira com npm run doctor).`))
try {
  const state = await inspectDatabase(client)
  if (state.kind !== "INSTALLED") fail("Este banco não é uma instalação da INIA registrada (rode npm run setup primeiro).")
  const name = values.name ?? (await ask("Nome completo do administrador", { validate: (value) => (value.trim().length >= 3 ? null : "Informe o nome completo.") }))
  const email = values.email ?? (await ask("E-mail de login", { validate: (value) => (isValidEmail(value.trim()) ? null : "E-mail inválido.") }))
  await client.query("begin")
  try {
    const admin = await createAdministrator(client, { name, email, ttlHours: env.TEMPORARY_PASSWORD_TTL_HOURS })
    await client.query("commit")
    say(`✓ Administrador criado: ${name} <${admin.email}>`)
    say(`  Senha temporária (aparece SÓ agora): ${admin.temporaryPassword}`)
    say(`  Vale até ${admin.expiresAt.toISOString()} — no primeiro login a INIA pede para criar a própria senha.`)
  } catch (error) {
    await client.query("rollback")
    throw error
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await client.end().catch(() => {})
}
