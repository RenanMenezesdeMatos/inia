// Cópia de segurança do banco INTERNO da INIA — o que o `npm run db:backup` e o `npm run db:restore-check` usam em comum:
// endereço do banco (backend/.env), conexão para as ferramentas do PostgreSQL (pg_dump/pg_restore) e onde achá-las.
// A senha nunca vai na linha de comando (qualquer usuário da máquina veria na lista de processos): vai por PGPASSWORD.
import { spawnSync } from "node:child_process"
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const DEFAULT_DATABASE_URL = "postgresql://localhost:5432/inia"

export function readEnvFile(file) {
  if (!existsSync(file)) return null
  const values = {}
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "")
  }
  return values
}

/** DATABASE_URL do ambiente ou do backend/.env (o mesmo banco que a API usa). */
export function databaseUrlFrom(root) {
  return process.env.DATABASE_URL || readEnvFile(join(root, "backend/.env"))?.DATABASE_URL || DEFAULT_DATABASE_URL
}

// O driver do Node aceita sslmode=no-verify; as ferramentas do PostgreSQL (libpq) não — o equivalente delas é `require`.
const LIBPQ_SSLMODE = { "no-verify": "require" }

/** Variáveis de ambiente da libpq para o banco do endereço (outro banco do mesmo servidor com `database`). */
export function libpqEnvironment(connectionString, { database } = {}) {
  const url = new URL(connectionString)
  const env = {
    PGHOST: url.hostname || "localhost",
    PGPORT: url.port || "5432",
    PGDATABASE: database ?? decodeURIComponent(url.pathname.replace(/^\//, "") || "inia"),
  }
  if (url.username) env.PGUSER = decodeURIComponent(url.username)
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password)
  const sslmode = url.searchParams.get("sslmode")
  if (sslmode) env.PGSSLMODE = LIBPQ_SSLMODE[sslmode] ?? sslmode
  const rootCert = url.searchParams.get("sslrootcert")
  if (rootCert) env.PGSSLROOTCERT = rootCert
  return env
}

/** Endereço para o driver do Node apontando para outro banco do mesmo servidor. */
export function withDatabase(connectionString, database) {
  const url = new URL(connectionString)
  url.pathname = `/${database}`
  return url.toString()
}

/** "servidor:porta/banco" — sem usuário nem senha. */
export function describeTarget(connectionString) {
  const url = new URL(connectionString)
  return `${url.hostname}:${url.port || 5432}${url.pathname}`
}

function versionOf(binary) {
  const result = spawnSync(binary, ["--version"], { encoding: "utf8" })
  if (result.status !== 0) return null
  const match = /(\d+)(?:\.(\d+))?/.exec(result.stdout)
  return match ? Number(match[1]) : null
}

/**
 * Caminho de uma ferramenta do PostgreSQL (pg_dump, pg_restore), da mais nova para a mais velha: a pasta informada, o PATH,
 * as instalações comuns do Windows (C:\Program Files\PostgreSQL\<versão>\bin) e do Homebrew. `minMajor` = versão do servidor:
 * um pg_dump mais velho que o servidor recusa o backup, então ele é pulado.
 */
export function findPgTool(name, { binDir, minMajor = 0 } = {}) {
  const exe = process.platform === "win32" ? `${name}.exe` : name
  const candidates = []
  if (binDir) candidates.push(join(binDir, exe))
  candidates.push(exe)
  const versionDirs = (base, prefix = "") =>
    existsSync(base) ? readdirSync(base).filter((entry) => entry.startsWith(prefix)).sort((a, b) => Number(b.replace(/\D/g, "")) - Number(a.replace(/\D/g, ""))).map((entry) => join(base, entry)) : []
  if (process.platform === "win32") for (const dir of versionDirs("C:\\Program Files\\PostgreSQL")) candidates.push(join(dir, "bin", exe))
  for (const dir of versionDirs("/opt/homebrew/opt", "postgresql@")) candidates.push(join(dir, "bin", exe))
  for (const dir of versionDirs("/usr/local/opt", "postgresql@")) candidates.push(join(dir, "bin", exe))
  for (const dir of versionDirs("/usr/lib/postgresql")) candidates.push(join(dir, "bin", exe))
  for (const candidate of candidates) {
    const major = versionOf(candidate)
    if (major !== null && major >= minMajor) return { path: candidate, major }
  }
  return null
}

/** Versão principal do servidor (ex.: 17) pela conexão do driver do Node. */
export async function serverMajor(pg, connectionString) {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 8000 })
  await client.connect()
  try {
    const num = (await client.query("select current_setting('server_version_num')::int as num")).rows[0].num
    return Math.floor(num / 10000)
  } finally {
    await client.end().catch(() => {})
  }
}

/** Data/hora local no nome do arquivo (ordena certo e diz quando a cópia foi feita). */
export function backupStamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

export const BACKUP_FILE_PATTERN = /^inia-\d{4}-\d{2}-\d{2}_\d{6}\.dump$/

/** Cópias desta pasta, da mais nova para a mais velha. */
export function listBackups(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((entry) => BACKUP_FILE_PATTERN.test(entry)).sort().reverse().map((entry) => join(dir, entry))
}

/** SIDs fixos (valem no Windows em português): Administradores e SYSTEM — os mesmos do agendar-backup.ps1. */
const WINDOWS_BACKUP_SIDS = ["S-1-5-32-544", "S-1-5-18"]
const PARTIAL_FILE_PATTERN = /^inia-\d{4}-\d{2}-\d{2}_\d{6}\.dump\.partial$/

/** Argumentos do icacls que deixam o caminho só para Administradores, SYSTEM e quem roda a cópia, sem herdar da pasta-mãe. */
export function windowsRestrictArgs(path, { directory, userSid }) {
  const inherit = directory ? "(OI)(CI)" : ""
  return [path, "/inheritance:r", "/grant:r", ...[...new Set([...WINDOWS_BACKUP_SIDS, userSid])].map((sid) => `*${sid}:${inherit}(F)`)]
}

function currentUserSid(run) {
  const result = run("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8" })
  const sid = result.status === 0 ? /"(S-1-[\d-]+)"/.exec(result.stdout ?? "")?.[1] : undefined
  if (!sid) throw new Error("não identificou a conta que roda a cópia (whoami /user).")
  return sid
}

/**
 * ACESSO RESTRITO às cópias (item N03 da 4ª auditoria). Antes, a pasta nascia com a permissão herdada (no Windows, a do C:\ —
 * leitura para todos os usuários da máquina) e o arquivo só era fechado depois de pronto, com um chmod que no Windows não faz nada.
 * Agora, ANTES de qualquer escrita, a pasta fica só para o dono (POSIX 0700) ou só para Administradores, SYSTEM e quem roda a
 * cópia (Windows, sem herança) — e também as cópias e o registro da INIA que já estavam nela. Nada mais da pasta é tocado.
 * Não conseguiu restringir = erro: a cópia não é feita numa pasta aberta.
 */
export function restrictBackupDir(dir, { platform = process.platform, run = spawnSync } = {}) {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const own = readdirSync(dir).filter((entry) => BACKUP_FILE_PATTERN.test(entry) || PARTIAL_FILE_PATTERN.test(entry) || entry === "backup.log").map((entry) => join(dir, entry))
  if (platform !== "win32") {
    chmodSync(dir, 0o700)
    for (const file of own) chmodSync(file, 0o600)
    return
  }
  const userSid = currentUserSid(run)
  for (const [path, directory] of [[dir, true], ...own.map((file) => [file, false])]) {
    const result = run("icacls", windowsRestrictArgs(path, { directory, userSid }), { encoding: "utf8" })
    if (result.status !== 0) throw new Error(`icacls não restringiu ${path}: ${(result.stderr || result.stdout || result.error?.message || "").trim().slice(0, 300)}`)
  }
}

/** Arquivo novo já fechado para o dono (0600): o pg_dump escreve nele sem que ele fique legível por outros nem por um instante. */
export function createPrivateFile(path) {
  closeSync(openSync(path, "wx", 0o600))
}

