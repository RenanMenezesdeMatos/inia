#!/usr/bin/env node
// `npm run db:backup` — cópia de segurança do banco INTERNO da INIA (pg_dump, formato custom), CONFERIDA (a cópia é lida de
// volta pelo pg_restore antes de valer) e com retenção (apaga as cópias mais velhas que --keep-days, nunca a mais nova).
// No Windows, deploy/windows/backup/agendar-backup.ps1 agenda este comando todo dia.
//
//   npm run db:backup -- --dir D:\backup\inia --keep-days 14
// Opções: --dir (padrão: backups/ na pasta da INIA) · --keep-days (padrão 14; 0 = não apaga nada) · --pg-bin (pasta do pg_dump)
//
// A cópia tem TODOS os dados da INIA, inclusive dados pessoais: guarde a pasta com acesso restrito e uma cópia fora deste
// servidor. Código de saída 0 = cópia feita e conferida; 1 = falhou (o Agendador de Tarefas mostra "último resultado" ≠ 0).
import { spawnSync } from "node:child_process"
import { appendFileSync, chmodSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { backupStamp, databaseUrlFrom, describeTarget, findPgTool, libpqEnvironment, listBackups, serverMajor } from "./backup-tools.mjs"
import { loadPg } from "./internal-database.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "../..")
const { values } = parseArgs({ options: { dir: { type: "string" }, "keep-days": { type: "string", default: "14" }, "pg-bin": { type: "string" } } })
const dir = values.dir ? (isAbsolute(values.dir) ? values.dir : resolve(process.cwd(), values.dir)) : join(root, "backups")
const keepDays = Number(values["keep-days"])
const started = Date.now()

function log(event) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...event })
  console.log(line)
  try {
    appendFileSync(join(dir, "backup.log"), `${line}\n`)
  } catch {
    // pasta ainda não existe ou sem escrita: a saída do processo continua tendo o registro
  }
}

function fail(reason, extra = {}) {
  log({ event: "backup_failed", reason, ...extra })
  console.error(`✗ Backup NÃO foi feito: ${reason}`)
  process.exit(1)
}

if (!Number.isInteger(keepDays) || keepDays < 0) fail("--keep-days precisa ser um número inteiro de dias (0 = não apagar nada).")
mkdirSync(dir, { recursive: true })

const url = databaseUrlFrom(root)
const target = describeTarget(url)
let major
try {
  major = await serverMajor(loadPg(root), url)
} catch (error) {
  fail(`não conectou ao banco ${target}: ${error.message}`)
}
const pgDump = findPgTool("pg_dump", { binDir: values["pg-bin"], minMajor: major })
const pgRestore = findPgTool("pg_restore", { binDir: values["pg-bin"], minMajor: major })
if (!pgDump || !pgRestore) fail(`pg_dump/pg_restore ${major} ou mais novo não encontrado. Instale as ferramentas do PostgreSQL ${major} ou informe a pasta com --pg-bin.`)

const finalFile = join(dir, `inia-${backupStamp()}.dump`)
const partialFile = `${finalFile}.partial`
const env = { ...process.env, ...libpqEnvironment(url) }

const dump = spawnSync(pgDump.path, ["--format=custom", "--no-password", "--file", partialFile], { env, encoding: "utf8" })
if (dump.status !== 0) {
  rmSync(partialFile, { force: true })
  fail(`pg_dump terminou com erro: ${(dump.stderr || dump.error?.message || "").trim().slice(0, 800)}`)
}

// Conferência: a cópia precisa ser legível e ter os dados das tabelas — um arquivo cortado ou vazio não vale como backup.
const list = spawnSync(pgRestore.path, ["--list", partialFile], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
const tables = list.status === 0 ? list.stdout.split("\n").filter((line) => / TABLE DATA /.test(line)).length : 0
if (list.status !== 0 || tables === 0) {
  rmSync(partialFile, { force: true })
  fail(list.status !== 0 ? `a cópia gerada não pôde ser lida pelo pg_restore: ${list.stderr.trim().slice(0, 800)}` : "a cópia gerada não tem dados de nenhuma tabela.")
}
renameSync(partialFile, finalFile)
try {
  chmodSync(finalFile, 0o600)
} catch {
  // Windows: vale a permissão da pasta (o agendar-backup.ps1 restringe)
}

// Retenção: só cópias deste formato, mais velhas que o prazo — e nunca a que acabou de ser feita.
const removed = []
if (keepDays > 0) {
  const limit = Date.now() - keepDays * 86_400_000
  for (const file of listBackups(dir)) {
    if (file === finalFile) continue
    if (statSync(file).mtimeMs < limit) {
      rmSync(file, { force: true })
      removed.push(file)
    }
  }
}

const bytes = statSync(finalFile).size
log({ event: "backup_done", database: target, file: finalFile, megabytes: Math.round((bytes / 1_048_576) * 10) / 10, tables, seconds: Math.round((Date.now() - started) / 100) / 10, removedOld: removed.length, pgDump: pgDump.major })
console.log(`✓ Backup conferido: ${finalFile}`)
console.log("  Lembrete: mantenha uma cópia desta pasta FORA deste servidor (outro disco, outro servidor ou o armazenamento da empresa).")
