import pg from "pg"
import { env } from "../../config/env.js"
import { runMigrations } from "../database/run-migrations.js"
import { runReferenceSeed } from "../database/run-reference-seed.js"
import { fail, packageVersion, requirePostgresDatabaseUrl, say } from "./cli.js"
import { inspectDatabase, recordUpdate } from "./installation.js"

/**
 * `npm run update` — ATUALIZA uma instalação existente: aplica SÓ as migrations pendentes (cada uma na própria
 * transação; as já aplicadas são puladas pelo controle `schema_migrations`) e atualiza os dados de referência
 * (idempotente). Nunca apaga nem recria dados. Faça backup do banco antes de atualizar em produção.
 */
say("INIA — atualização")
requirePostgresDatabaseUrl(env.activeDatabaseUrl)
const client = new pg.Client({ connectionString: env.activeDatabaseUrl })
try {
  await client.connect()
} catch (error) {
  fail(`Não foi possível acessar o banco interno: ${error instanceof Error ? error.message : String(error)}`)
}
try {
  const state = await inspectDatabase(client)
  if (state.kind === "EMPTY") fail("O banco interno está vazio — isto é uma primeira instalação: use npm run setup.")
  if (state.kind === "NOT_INSTALLED_WITH_DATA") say("Banco sem marcador de instalação (criado antes do comando setup) — aplicando só as migrations pendentes.")
  const applied = await runMigrations(client as unknown as pg.PoolClient, (message) => say(`  ${message}`))
  say(applied.length ? `✓ ${applied.length} migration(s) aplicada(s).` : "✓ Nenhuma migration pendente — o banco já está na versão atual.")
  const reference = await runReferenceSeed(client as unknown as pg.PoolClient)
  say(`✓ Dados de referência conferidos (${reference.holidays.inserted} feriado(s) novo(s), ${reference.holidays.updated} atualizado(s)).`)
  if (await recordUpdate(client, packageVersion())) say(`✓ Instalação atualizada para a versão ${packageVersion()}.`)
} catch (error) {
  fail(`A atualização parou: ${error instanceof Error ? error.message : String(error)}\nA migration que falhou foi desfeita; as anteriores continuam aplicadas. Corrija e rode de novo.`)
} finally {
  await client.end().catch(() => {})
}
