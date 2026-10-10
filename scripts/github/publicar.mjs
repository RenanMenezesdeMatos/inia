#!/usr/bin/env node
// `npm run github:publish` — atualiza o repositório privado do GitHub com o código ATUAL sem nunca enviar o histórico
// local (que guarda manuais, fontes do avatar, transcrições, saídas de benchmark e, em commits antigos, senhas de demo).
//
// A árvore do HEAD (com a árvore de trabalho limpa) menos o que casa em scripts/github/exclusoes.txt vira UM commit
// novo cujo pai é o `main` atual do GitHub: lá existe um histórico próprio, feito só desses commits. Antes de enviar,
// barra arquivos de segredo pelo nome, procura no snapshot os valores dos .env locais (sem imprimi-los) e padrões de
// chave, mostra o resumo e pede confirmação. Fala com o GitHub por URL e com a credencial do `gh` (o repositório local
// não tem remote, de propósito) e nunca usa --force: se o `main` do GitHub andou no meio do caminho, o envio é
// recusado e basta rodar de novo.
//
//   npm run github:publish                     monta, confere, mostra o resumo, pergunta e envia
//   npm run github:publish -- --simular        monta, confere e mostra o resumo; não envia nada
//   npm run github:publish -- --verificar      antes de perguntar, roda typecheck, lint e testes numa cópia do snapshot
//   npm run github:publish -- -m "mensagem"    mensagem do commit no GitHub (padrão: "Atualiza o código da INIA (data)")
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, isAbsolute, join, relative } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const REPOSITORY = "RenanMenezesdeMatos/inia"
const REPOSITORY_URL = `https://github.com/${REPOSITORY}.git`
const BRANCH = "main"
const EXCLUSIONS_FILE = "scripts/github/exclusoes.txt"
const ALLOWED_PATTERN_HITS_FILE = "scripts/github/padroes-permitidos.txt"
// Só a credencial do gh: o `credential.helper=` vazio zera os helpers da configuração (chaveiro etc.) antes.
const GITHUB_AUTH = ["-c", "credential.helper=", "-c", "credential.helper=!gh auth git-credential"]

/** Valor de .env com nome de segredo; os demais (porta, URL pública, nível de log) não são procurados. */
const SECRET_NAME = /(PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY|PRIVATE|CREDENTIAL|SALT|_KEY$)/i
/** Abaixo disso a busca acharia o valor em qualquer lugar (a senha "inia" casa com o nome do produto). */
export const MIN_SECRET_LENGTH = 8
const ENV_FILE = /^\.env(\..+)?$/
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", "output"])

/** Padrões de chave procurados no snapshot (git grep -E). Achado bloqueia, salvo ocorrência em padroes-permitidos.txt. */
export const KEY_PATTERNS = [
  { name: "chave de API do Google (AIza…)", regex: "AIza[0-9A-Za-z_-]{35}" },
  { name: "chave de API no formato sk-… (OpenAI, Anthropic)", regex: "(^|[^A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}" },
  { name: "token do GitHub (ghp_, gho_, ghu_, ghs_, ghr_)", regex: "gh[pousr]_[A-Za-z0-9]{36}" },
  { name: "token do GitHub (github_pat_)", regex: "github_pat_[A-Za-z0-9_]{40,}" },
  { name: "chave privada (BEGIN … PRIVATE KEY)", regex: "-----BEGIN [A-Z ]*PRIVATE KEY" },
  { name: "JWT", regex: "eyJ[A-Za-z0-9_-]{8,}\\.eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}" },
  { name: "chave de acesso da AWS (AKIA…)", regex: "AKIA[0-9A-Z]{16}" },
  { name: "token do Slack (xox…)", regex: "xox[abprs]-[A-Za-z0-9-]{10,}" },
]

const SENSITIVE_FILE_NAMES = [
  { reason: "arquivo de ambiente", test: (name) => ENV_FILE.test(name) && !name.endsWith(".example") },
  { reason: "chave ou certificado", test: (name) => /\.(pem|key|p8|p12|pfx|jks|keystore|ppk|kdbx)$/i.test(name) },
  { reason: "chave SSH privada", test: (name) => /^id_(rsa|dsa|ecdsa|ed25519)$/.test(name) },
  {
    reason: "arquivo de credenciais",
    test: (name) => /^(\.npmrc|\.pypirc|\.netrc|\.git-credentials|\.htpasswd|credentials\.json)$/.test(name) || /^service-account.*\.json$/i.test(name),
  },
]

class PublishError extends Error {}

export function git(cwd, args, { input, env, allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
  })
  if (result.error) throw new PublishError(`não foi possível rodar o git: ${result.error.message}`)
  if (result.status !== 0 && !allowFailure) {
    const command = args.filter((arg, index) => arg !== "-c" && args[index - 1] !== "-c")[0]
    throw new PublishError(`git ${command} falhou: ${result.stderr.trim()}`)
  }
  return result
}

const splitNul = (text) => text.split("\0").filter(Boolean)

/** Lê exclusoes.txt: regras (pathspec glob do git) e exceções ("!"). */
export function parseExclusions(text) {
  const rules = []
  const exceptions = []
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith("#")) return
    const exception = line.startsWith("!")
    const pattern = exception ? line.slice(1).trim() : line
    if (!pattern || pattern.startsWith("/") || pattern.startsWith(":") || pattern.split("/").includes("..")) {
      throw new PublishError(`${EXCLUSIONS_FILE}, linha ${index + 1}: regra inválida "${line}" (caminho relativo à raiz, sem "/" no início, ":" ou "..")`)
    }
    ;(exception ? exceptions : rules).push(pattern)
  })
  // Sem nenhuma regra, um pathspec só de exceções casaria com TODOS os arquivos.
  if (rules.length === 0) throw new PublishError(`${EXCLUSIONS_FILE} não tem nenhuma regra de exclusão`)
  return { rules, exceptions }
}

/**
 * Padrão de exclusoes.txt → RegExp do caminho inteiro. O casamento é feito aqui e não com pathspec do git porque o
 * `git ls-files` (2.54) devolve vazio para `:(glob)a/b/**` junto de um `:(exclude,glob)a/c/**` de prefixo comum — o que
 * deixaria passar arquivo que devia sair.
 */
export function globToRegExp(pattern) {
  let source = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === "*" && pattern[index + 1] === "*") {
      // "**/" = zero ou mais pastas; "**" em outro lugar = qualquer coisa, inclusive "/".
      const folders = pattern[index + 2] === "/"
      source += folders ? "(?:.*/)?" : ".*"
      index += folders ? 2 : 1
    } else if (char === "*") source += "[^/]*"
    else if (char === "?") source += "[^/]"
    else if (char === "[" && pattern.indexOf("]", index + 2) !== -1) {
      const end = pattern.indexOf("]", index + 2)
      const body = pattern.slice(index + 1, end).replace(/\\/g, "\\\\")
      source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`
      index = end
    } else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
  }
  return new RegExp(`^${source}$`)
}

/** O caminho casa com o padrão, ou uma pasta dele casa (como no git, "docs/manuais" tira tudo de dentro da pasta). */
export function matchesPattern(regex, path) {
  if (regex.test(path)) return true
  for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) if (regex.test(path.slice(0, slash))) return true
  return false
}

/**
 * Monta a árvore publicada: o commit menos as regras de exclusão (respeitando as exceções), num índice temporário —
 * o índice e a árvore de trabalho do repositório não são tocados.
 */
export function buildSnapshot(cwd, commit, { rules, exceptions }) {
  const all = listTree(cwd, commit).map(({ path }) => path)
  const ruleMatchers = rules.map((rule) => ({ pattern: rule, regex: globToRegExp(rule) }))
  const exceptionMatchers = exceptions.map((exception) => ({ pattern: `!${exception}`, regex: globToRegExp(exception) }))
  const matching = (matchers, path) => matchers.filter(({ regex }) => matchesPattern(regex, path))
  const perRule = new Map(ruleMatchers.map(({ pattern }) => [pattern, 0]))
  const perException = new Map(exceptionMatchers.map(({ pattern }) => [pattern, 0]))
  const removed = []
  for (const path of all) {
    const rulesHit = matching(ruleMatchers, path)
    if (rulesHit.length === 0) continue
    const exceptionsHit = matching(exceptionMatchers, path)
    for (const { pattern } of exceptionsHit) perException.set(pattern, perException.get(pattern) + 1)
    if (exceptionsHit.length > 0) continue
    for (const { pattern } of rulesHit) perRule.set(pattern, perRule.get(pattern) + 1)
    removed.push(path)
  }

  const workdir = mkdtempSync(join(tmpdir(), "inia-publicar-"))
  let tree
  try {
    const env = { GIT_INDEX_FILE: join(workdir, "index") }
    git(cwd, ["read-tree", commit], { env })
    if (removed.length > 0) git(cwd, ["update-index", "--force-remove", "-z", "--stdin"], { env, input: `${removed.join("\0")}\0` })
    tree = git(cwd, ["write-tree"], { env }).stdout.trim()
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
  const files = listTree(cwd, tree)
  // Conferência independente: a árvore escrita tem exatamente o commit menos o que saiu.
  const removedSet = new Set(removed)
  if (files.length !== all.length - removed.length || files.some(({ path }) => removedSet.has(path))) {
    throw new PublishError("a árvore montada não bate com a lista de exclusões — nada foi enviado")
  }
  const counts = (map) => [...map].map(([pattern, count]) => ({ pattern, files: count }))
  return { tree, removed: removed.length, perRule: counts(perRule), perException: counts(perException), files }
}

/** Arquivos da árvore com tamanho (bytes). */
export function listTree(cwd, tree) {
  return splitNul(git(cwd, ["ls-tree", "-r", "-l", "-z", tree]).stdout).map((entry) => {
    const tab = entry.indexOf("\t")
    const [, , , size] = entry.slice(0, tab).split(/\s+/)
    return { path: entry.slice(tab + 1), size: Number(size) || 0 }
  })
}

export function sensitiveFiles(paths) {
  return paths.flatMap((path) => {
    const match = SENSITIVE_FILE_NAMES.find(({ test }) => test(basename(path)))
    return match ? [{ path, reason: match.reason }] : []
  })
}

/** Pares chave/valor de um .env (aceita `export`, aspas e comentário no fim da linha sem aspas). */
export function parseEnv(text) {
  const entries = []
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(raw)
    if (!match) continue
    let value = match[2].trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.indexOf(quote, 1) > 0) value = value.slice(1, value.indexOf(quote, 1))
    else value = value.replace(/\s+#.*$/, "").trim()
    entries.push({ key: match[1], value })
  }
  return entries
}

/** Valores secretos de um .env: os de nome de segredo e a senha embutida em URLs (postgres://usuário:senha@…). */
export function secretValues(entries) {
  const secrets = []
  for (const { key, value } of entries) {
    if (!value) continue
    if (SECRET_NAME.test(key)) secrets.push({ key, value })
    let url = null
    try {
      url = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? new URL(value) : null
    } catch {
      url = null
    }
    if (url?.password) {
      const password = safeDecode(url.password)
      secrets.push({ key: `${key} (senha da URL)`, value: password })
      if (password !== url.password) secrets.push({ key: `${key} (senha da URL)`, value: url.password })
    }
  }
  return secrets
}

const safeDecode = (text) => {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** .env locais (fora de node_modules e afins), inclusive os das worktrees em .claude/ — nenhum entra no snapshot. */
export function findEnvFiles(directory, found = []) {
  let entries = []
  try {
    entries = readdirSync(directory, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) findEnvFiles(join(directory, entry.name), found)
    else if (entry.isFile() && ENV_FILE.test(entry.name) && !entry.name.endsWith(".example")) found.push(join(directory, entry.name))
  }
  return found
}

/**
 * Procura os valores no snapshot sem nunca imprimi-los nem passá-los na linha de comando: vão pela entrada padrão do
 * `git grep -F -f -`. Devolve, por valor achado, as chaves de origem e os arquivos onde ele aparece.
 */
export function findValuesInTree(cwd, tree, secrets) {
  const byValue = new Map()
  for (const secret of secrets) {
    const sources = byValue.get(secret.value) ?? new Set()
    sources.add(secret.source ? `${secret.key} (${secret.source})` : secret.key)
    byValue.set(secret.value, sources)
  }
  const values = [...byValue.keys()]
  if (values.length === 0) return []
  const grep = (patterns, paths = []) => {
    const pathspecs = paths.map((path) => `:(literal)${path}`)
    const result = git(cwd, ["grep", "-F", "-l", "-z", "-f", "-", tree, "--", ...pathspecs], { input: `${patterns.join("\n")}\n`, allowFailure: true })
    if (result.status > 1) throw new PublishError(`git grep falhou: ${result.stderr.trim()}`)
    return splitNul(result.stdout).map((path) => path.slice(tree.length + 1))
  }
  const candidates = grep(values)
  if (candidates.length === 0) return []
  return values.flatMap((value) => {
    const paths = grep([value], candidates)
    return paths.length > 0 ? [{ sources: [...byValue.get(value)], paths }] : []
  })
}

/**
 * Ocorrências liberadas dos padrões de chave (padroes-permitidos.txt): "<caminho> sha256:<16 hex do trecho>". Cada
 * linha libera um trecho num arquivo — outra chave no mesmo arquivo continua barrada. Nunca vale para os valores dos .env.
 */
export function parseAllowedPatternHits(text) {
  return new Set(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  )
}

/** Identificador de um trecho casado que não revela o trecho. */
export const fingerprint = (token) => `sha256:${createHash("sha256").update(token).digest("hex").slice(0, 16)}`

export function findKeyPatterns(cwd, tree, allowed = new Set()) {
  return KEY_PATTERNS.flatMap(({ name, regex }) => {
    // -o devolve só o trecho casado ("árvore:caminho\0trecho" por linha); -a inclui arquivos binários.
    const result = git(cwd, ["grep", "-a", "-o", "-z", "-E", "-e", regex, tree], { allowFailure: true })
    if (result.status > 1) throw new PublishError(`git grep falhou: ${result.stderr.trim()}`)
    const hits = new Set()
    for (const line of result.stdout.split("\n")) {
      const separator = line.indexOf("\0")
      if (separator === -1) continue
      // O padrão sk-… casa também o caractere anterior (fronteira); o identificador é só do trecho da chave.
      const token = line.slice(separator + 1).replace(/^[^A-Za-z0-9_-]/, "")
      hits.add(`${line.slice(tree.length + 1, separator)} ${fingerprint(token)}`)
    }
    const blocked = [...hits].filter((hit) => !allowed.has(hit))
    return blocked.length > 0 ? [{ name, regex, hits: blocked }] : []
  })
}

/** Nomes alterados entre duas árvores (A, M, D, T). */
export function diffNames(cwd, fromTree, toTree) {
  const parts = splitNul(git(cwd, ["diff-tree", "-r", "-z", "--no-renames", "--name-status", fromTree, toTree]).stdout)
  const changes = []
  for (let index = 0; index + 1 < parts.length; index += 2) changes.push({ status: parts[index], path: parts[index + 1] })
  return changes
}

const numberFormat = new Intl.NumberFormat("pt-BR")
const formatCount = (value) => numberFormat.format(value)
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`
}

function parseArgs(argv) {
  const options = { dryRun: false, verify: false, full: false, message: null, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--simular" || arg === "--dry-run") options.dryRun = true
    else if (arg === "--verificar") options.verify = true
    else if (arg === "--completo") options.full = true
    else if (arg === "-h" || arg === "--ajuda" || arg === "--help") options.help = true
    else if (arg === "-m" || arg === "--mensagem") {
      options.message = argv[index + 1]
      index += 1
      if (!options.message?.trim()) throw new PublishError(`${arg} precisa de um texto`)
    } else throw new PublishError(`opção desconhecida: ${arg} (veja --ajuda)`)
  }
  return options
}

const HELP = `Publica o código atual no repositório privado ${REPOSITORY} (${BRANCH}) sem o histórico local.

  npm run github:publish                     monta, confere, mostra o resumo, pergunta e envia
  npm run github:publish -- --simular        só monta, confere e mostra o resumo (nada é enviado)
  npm run github:publish -- --verificar      também roda typecheck, lint e testes numa cópia do snapshot
  npm run github:publish -- --completo       lista todas as mudanças no resumo, sem cortar
  npm run github:publish -- -m "mensagem"    mensagem do commit no GitHub

O que fica de fora: ${EXCLUSIONS_FILE}.`

function requireCleanTree() {
  const dirty = git(ROOT, ["status", "--porcelain", "--untracked-files=no"]).stdout.trim()
  if (dirty) {
    throw new PublishError(`há mudanças não commitadas — o GitHub recebe exatamente o HEAD, então commite ou guarde (git stash) antes:\n${dirty}`)
  }
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply"]) {
    const path = git(ROOT, ["rev-parse", "--git-path", marker]).stdout.trim()
    if (existsSync(isAbsolute(path) ? path : join(ROOT, path))) throw new PublishError("há um merge, rebase ou cherry-pick em andamento — termine-o antes")
  }
}

function requireGh() {
  const result = spawnSync("gh", ["auth", "status", "--hostname", "github.com"], { stdio: "ignore" })
  if (result.error) throw new PublishError("o gh (GitHub CLI) não foi encontrado — instale-o e rode gh auth login")
  if (result.status !== 0) throw new PublishError("o gh não está autenticado no github.com — rode gh auth login")
}

/** O `main` do GitHub, buscado por URL (sem remote no repositório local). null = repositório vazio. */
function fetchRemoteMain() {
  const listed = git(ROOT, [...GITHUB_AUTH, "ls-remote", "--refs", REPOSITORY_URL, `refs/heads/${BRANCH}`]).stdout.trim()
  if (!listed) return null
  const commit = listed.split(/\s+/)[0]
  git(ROOT, [...GITHUB_AUTH, "fetch", "--quiet", "--no-tags", "--no-write-fetch-head", REPOSITORY_URL, `refs/heads/${BRANCH}`])
  // O histórico do GitHub não pode ter nada em comum com o local: se tiver, alguém já enviou o histórico local.
  const shared = git(ROOT, ["merge-base", "HEAD", commit], { allowFailure: true }).stdout.trim()
  if (shared) throw new PublishError(`o main do GitHub compartilha histórico com o repositório local (commit ${shared.slice(0, 8)}) — pare e investigue antes de enviar qualquer coisa`)
  return {
    commit,
    tree: git(ROOT, ["rev-parse", `${commit}^{tree}`]).stdout.trim(),
    date: git(ROOT, ["log", "-1", "--format=%cd", "--date=format:%d/%m/%Y %H:%M", commit]).stdout.trim(),
  }
}

function localSecrets() {
  const secrets = []
  const files = findEnvFiles(ROOT)
  for (const file of files) {
    const source = relative(ROOT, file)
    for (const secret of secretValues(parseEnv(readFileSync(file, "utf8")))) secrets.push({ ...secret, source })
  }
  const searchable = secrets.filter(({ value }) => value.length >= MIN_SECRET_LENGTH)
  const short = [...new Set(secrets.filter(({ value }) => value.length < MIN_SECRET_LENGTH).map(({ key, source }) => `${key} (${source})`))]
  return { files, searchable, short }
}

function runVerification(tree) {
  const workdir = mkdtempSync(join(tmpdir(), "inia-verificar-"))
  try {
    console.log(`\nVerificação numa cópia exportada do snapshot (${workdir})`)
    const exported = spawnSync("sh", ["-c", 'git archive --format=tar "$1" | tar -xf - -C "$2"', "sh", tree, workdir], { cwd: ROOT, stdio: ["ignore", "inherit", "inherit"] })
    if (exported.status !== 0) throw new PublishError("não foi possível exportar o snapshot (git archive)")
    for (const project of ["backend", "frontend"]) {
      const modules = join(ROOT, project, "node_modules")
      if (!existsSync(modules)) throw new PublishError(`${project}/node_modules não existe — rode npm run install:all antes de --verificar`)
      symlinkSync(modules, join(workdir, project, "node_modules"), "dir")
    }
    const steps = [
      ["backend", "typecheck"],
      ["backend", "typecheck:scripts"],
      ["backend", "lint"],
      ["backend", "test"],
      ["frontend", "typecheck"],
      ["frontend", "lint"],
      ["frontend", "test"],
    ]
    const failed = []
    for (const [project, script] of steps) {
      console.log(`\n▶ ${project}: npm run ${script}`)
      const result = spawnSync("npm", ["run", script], { cwd: join(workdir, project), stdio: "inherit" })
      if (result.status !== 0) failed.push(`${project}: npm run ${script}`)
    }
    if (failed.length > 0) throw new PublishError(`a verificação falhou em:\n${failed.map((step) => `  ✗ ${step}`).join("\n")}`)
    console.log("\n  ✓ typecheck, lint e testes do backend e do frontend passaram na cópia do snapshot")
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

function ask(question) {
  return new Promise((resolve) => {
    const readline = createInterface({ input: process.stdin, output: process.stdout })
    let answered = false
    readline.question(question, (answer) => {
      answered = true
      readline.close()
      resolve(answer)
    })
    readline.on("close", () => {
      if (!answered) resolve("")
    })
  })
}

function printList(lines, limit, full) {
  const shown = full ? lines : lines.slice(0, limit)
  for (const line of shown) console.log(`    ${line}`)
  if (shown.length < lines.length) console.log(`    … e mais ${formatCount(lines.length - shown.length)} (--completo lista tudo)`)
}

async function main(argv) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(HELP)
    return
  }
  console.log(`Publicar no GitHub — ${REPOSITORY} (${BRANCH})${options.dryRun ? " · simulação" : ""}\n`)

  requireCleanTree()
  const head = git(ROOT, ["rev-parse", "HEAD"]).stdout.trim()
  const branch = git(ROOT, ["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim()
  const untracked = splitNul(git(ROOT, ["ls-files", "-z", "--others", "--exclude-standard"]).stdout).length
  const exclusions = parseExclusions(readFileSync(join(ROOT, EXCLUSIONS_FILE), "utf8"))
  const snapshot = buildSnapshot(ROOT, head, exclusions)

  requireGh()
  const remote = fetchRemoteMain()

  const totalSize = snapshot.files.reduce((sum, file) => sum + file.size, 0)
  console.log(`Origem   HEAD ${head.slice(0, 8)} (${branch})${untracked > 0 ? ` · ${formatCount(untracked)} arquivo(s) não rastreado(s) ficam de fora` : ""}`)
  console.log(`Destino  ${remote ? `main do GitHub em ${remote.commit.slice(0, 8)} (${remote.date})` : "repositório vazio — o primeiro envio será um commit sem pai"}`)
  console.log(`Snapshot ${formatCount(snapshot.files.length)} arquivos · ${formatBytes(totalSize)} · árvore ${snapshot.tree.slice(0, 8)}`)

  console.log(`\nExclusões (${EXCLUSIONS_FILE}) — ${formatCount(snapshot.removed)} arquivo(s) do HEAD ficam de fora`)
  const staleLines = []
  for (const { pattern, files } of [...snapshot.perRule, ...snapshot.perException]) {
    const removed = !pattern.startsWith("!")
    console.log(`  ${removed ? "−" : "+"} ${String(files).padStart(5)}  ${pattern}`)
    if (files === 0) staleLines.push(pattern)
  }
  for (const pattern of staleLines) console.log(`  ! "${pattern}" não casa com nenhum arquivo do HEAD — a lista está desatualizada?`)

  console.log("\nMaiores arquivos")
  for (const file of [...snapshot.files].sort((left, right) => right.size - left.size).slice(0, 5)) console.log(`  ${formatBytes(file.size).padStart(9)}  ${file.path}`)

  const changes = remote ? diffNames(ROOT, remote.tree, snapshot.tree) : snapshot.files.map(({ path }) => ({ status: "A", path }))
  const byStatus = (status) => changes.filter((change) => change.status === status).map(({ path }) => `${status}  ${path}`)
  const added = byStatus("A")
  const removedFiles = byStatus("D")
  const modified = changes.filter(({ status }) => status !== "A" && status !== "D").map(({ status, path }) => `${status}  ${path}`)
  console.log(`\nMudanças em relação ao main do GitHub: ${formatCount(added.length)} novo(s), ${formatCount(modified.length)} alterado(s), ${formatCount(removedFiles.length)} removido(s)`)
  printList(added, 100, options.full)
  printList(removedFiles, 100, options.full)
  printList(modified, 40, options.full)

  console.log("\nConferência de segredos")
  const problems = []
  const sensitive = sensitiveFiles(snapshot.files.map(({ path }) => path))
  if (sensitive.length === 0) console.log("  ✓ nenhum arquivo de segredo pelo nome (.env, chaves, certificados, credenciais)")
  for (const { path, reason } of sensitive) problems.push(`${reason} no snapshot: ${path}`)

  const secrets = localSecrets()
  const leaked = findValuesInTree(ROOT, snapshot.tree, secrets.searchable)
  if (leaked.length === 0) {
    const distinct = new Set(secrets.searchable.map(({ value }) => value)).size
    console.log(`  ✓ nenhum valor dos .env locais no snapshot (${formatCount(distinct)} valor(es) de ${formatCount(secrets.files.length)} arquivo(s) .env)`)
  }
  for (const { sources, paths } of leaked) {
    problems.push(`o valor de ${sources.join(", ")} aparece em: ${paths.join(", ")} — tire-o do código; se era um valor de exemplo, troque-o no .env (npm run env:init gera um aleatório)`)
  }
  if (secrets.short.length > 0) console.log(`  ! valores curtos demais para procurar (menos de ${MIN_SECRET_LENGTH} caracteres): ${secrets.short.join(", ")}`)

  const allowedFile = join(ROOT, ALLOWED_PATTERN_HITS_FILE)
  const allowed = existsSync(allowedFile) ? parseAllowedPatternHits(readFileSync(allowedFile, "utf8")) : new Set()
  const patternHits = findKeyPatterns(ROOT, snapshot.tree, allowed)
  if (patternHits.length === 0) console.log(`  ✓ nenhum padrão de chave fora dos liberados em ${ALLOWED_PATTERN_HITS_FILE} (AIza…, sk-…, ghp_…, chave privada, JWT, AKIA…, xox…)`)
  for (const { name, regex, hits } of patternHits) {
    problems.push(
      `${name} — confira com git grep -nE '${regex}' HEAD -- <arquivo>; se a chave for inventada (fixture de teste), cole a linha em ${ALLOWED_PATTERN_HITS_FILE}:\n${hits.map((hit) => `      ${hit}`).join("\n")}`,
    )
  }

  if (problems.length > 0) {
    throw new PublishError(`nada foi enviado — a conferência de segredos barrou o snapshot:\n${problems.map((problem) => `  ✗ ${problem}`).join("\n")}`)
  }

  if (remote && remote.tree === snapshot.tree) {
    console.log("\nO main do GitHub já tem exatamente este código — nada a publicar.")
    return
  }

  if (options.verify) runVerification(snapshot.tree)

  if (options.dryRun) {
    console.log("\nSimulação: nada foi enviado. Rode sem --simular para publicar.")
    return
  }

  const answer = await ask(`\nCriar 1 commit sobre ${remote ? remote.commit.slice(0, 8) : "um repositório vazio"} e enviar para o main de ${REPOSITORY}? [s/N] `)
  if (!/^(s|sim)$/i.test(answer.trim())) {
    console.log("Cancelado: nada foi enviado.")
    return
  }

  const today = new Date().toLocaleDateString("pt-BR")
  const message =
    options.message ??
    `Atualiza o código da INIA (${today})\n\nCópia do código do commit local ${head.slice(0, 8)}, sem o histórico local e sem o que ${EXCLUSIONS_FILE} exclui.\n`
  const commit = git(ROOT, ["commit-tree", snapshot.tree, ...(remote ? ["-p", remote.commit] : []), "-F", "-"], { input: message }).stdout.trim()
  // Garantia de que só vai um commit: os pais dele são exatamente o main do GitHub (ou nenhum, no primeiro envio).
  const parents = git(ROOT, ["rev-list", "--parents", "-n", "1", commit]).stdout.trim().split(" ").slice(1)
  if (parents.join(" ") !== (remote ? remote.commit : "")) throw new PublishError(`o commit ${commit.slice(0, 8)} não tem o pai esperado — nada foi enviado`)

  const pushed = spawnSync("git", [...GITHUB_AUTH, "push", REPOSITORY_URL, `${commit}:refs/heads/${BRANCH}`], {
    cwd: ROOT,
    stdio: "inherit",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  })
  if (pushed.status !== 0) throw new PublishError("o GitHub recusou o envio (se o main andou enquanto isso, rode de novo — nunca com --force)")
  const published = git(ROOT, [...GITHUB_AUTH, "ls-remote", "--refs", REPOSITORY_URL, `refs/heads/${BRANCH}`]).stdout.trim().split(/\s+/)[0]
  if (published !== commit) throw new PublishError(`o main do GitHub está em ${published?.slice(0, 8)}, não no commit enviado ${commit.slice(0, 8)}`)
  console.log(`\n  ✓ publicado: https://github.com/${REPOSITORY}/commit/${commit}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    if (!(error instanceof PublishError)) throw error
    console.error(`\n✗ ${error.message}`)
    process.exitCode = 1
  })
}
