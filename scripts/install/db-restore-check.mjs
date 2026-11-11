#!/usr/bin/env node
// `npm run db:restore-check` — TESTE DE RESTAURAÇÃO: restaura uma cópia (a mais nova da pasta, ou --file) num banco
// TEMPORÁRIO do mesmo servidor, confere o que voltou e mede quanto tempo levou — esse é o tempo real de volta do banco
// (parte do RTO). Não toca no banco da INIA. Apaga o banco temporário no fim (--keep para mantê-lo e olhar).
//
//   npm run db:restore-check -- --dir D:\backup\inia
//   npm run db:restore-check -- --file D:\backup\inia\inia-2026-10-20_020000.dump
// Sem permissão para criar banco (usuário da INIA sem CREATEDB): peça à equipe do banco um banco VAZIO e use --target-db nome.
import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { backupStamp, databaseUrlFrom, describeTarget, findPgTool, libpqEnvironment, listBackups, serverMajor, withDatabase } from "./backup-tools.mjs"
import { loadPg } from "./internal-database.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const { values } = parseArgs({ options: { dir: { type: "string" }, file: { type: "string" }, "pg-bin": { type: "string" }, "target-db": { type: "string" }, keep: { type: "boolean", default: false } } })
const absolute = (value) => (isAbsolute(value) ? value : resolve(process.cwd(), value))
const dir = values.dir ? absolute(values.dir) : join(root, "backups")
const file = values.file ? absolute(values.file) : listBackups(dir)[0]
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}
if (!file || !existsSync(file)) fail(values.file ? `Arquivo não encontrado: ${file}` : `Nenhuma cópia inia-*.dump em ${dir}. Rode antes: npm run db:backup`)

const pg = loadPg(root)
const url = databaseUrlFrom(root)
const major = await serverMajor(pg, url).catch((error) => fail(`não conectou ao banco ${describeTarget(url)}: ${error.message}`))
let pgRestore
try {
  pgRestore = findPgTool("pg_restore", { binDir: values["pg-bin"], minMajor: major })
} catch (error) {
  fail(error.message)
}
if (!pgRestore) fail(`pg_restore ${major} ou mais novo não encontrado. Informe a pasta com --pg-bin.`)

const createdHere = !values["target-db"]
const scratch = values["target-db"] ?? `inia_restore_check_${backupStamp().replace(/\D/g, "")}`
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(scratch)) fail(`Nome de banco inválido: ${scratch}`)

const admin = new pg.Client({ connectionString: url })
await admin.connect()
if (createdHere) {
  try {
    await admin.query(`create database ${scratch}`)
  } catch (error) {
    await admin.end()
    fail(error.code === "42501"
      ? `o usuário do banco não pode criar bancos (sem CREATEDB). Peça à equipe do banco um banco VAZIO para o teste e rode com --target-db nome-do-banco.`
      : `não foi possível criar o banco temporário ${scratch}: ${error.message}`)
  }
}

console.log(`Restaurando ${file}\n  em ${describeTarget(withDatabase(url, scratch))} (temporário)…`)
const started = Date.now()
const restore = spawnSync(pgRestore.path, ["--no-owner", "--no-privileges", "--exit-on-error", "--no-password", "--dbname", scratch, file], {
  env: { ...process.env, ...libpqEnvironment(url, { database: scratch }) },
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
const restoreSeconds = Math.round((Date.now() - started) / 100) / 10

let summary = null
let problem = restore.status === 0 ? null : `pg_restore terminou com erro: ${(restore.stderr || restore.error?.message || "").trim().slice(0, 1500)}`
if (!problem) {
  const restored = new pg.Client({ connectionString: withDatabase(url, scratch) })
  await restored.connect()
  try {
    const migrations = (await restored.query(`select count(*)::int as n, max(name) as last from schema_migrations`)).rows[0]
    const counts = {}
    for (const table of ["organizations", "people", "user_accounts", "interactions", "feedbacks", "supervision_cases", "audit_logs"]) {
      const exists = (await restored.query(`select to_regclass($1) is not null as ok`, [`public.${table}`])).rows[0].ok
      counts[table] = exists ? (await restored.query(`select count(*)::int as n from ${table}`)).rows[0].n : null
    }
    summary = { migrations: migrations.n, lastMigration: migrations.last, counts }
    if (!migrations.n) problem = "o banco restaurado não tem as migrations da INIA (schema_migrations vazio)."
  } finally {
    await restored.end().catch(() => {})
  }
}

if (createdHere && !values.keep) {
  await admin.query(`drop database if exists ${scratch} with (force)`).catch((error) => console.error(`! Não apagou o banco temporário ${scratch}: ${error.message}`))
}
await admin.end()

console.log(JSON.stringify({ event: problem ? "restore_check_failed" : "restore_check_done", file, restoreSeconds, ...summary, ...(problem ? { problem } : {}) }))
if (problem) fail(problem)
console.log(`✓ A cópia restaura: ${summary.migrations} migrations (última ${summary.lastMigration}); o banco voltou em ${restoreSeconds} s.`)
console.log("  Esse é o tempo do banco. Para o RTO, some o tempo de reapontar a INIA (DATABASE_URL) e reiniciar os serviços.")
if (createdHere && values.keep) console.log(`  Banco mantido para inspeção: ${scratch} (apague depois: drop database ${scratch};)`)
