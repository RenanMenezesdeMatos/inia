#!/usr/bin/env node
// `npm run security:check` — verificação automática de SEGURANÇA DO CÓDIGO, para rodar antes de cada entrega (e no
// `github:publish -- --verificar`). Não altera nada e não envia nada para fora; sai com código 1 se achar problema.
//
//   1. Segredos no código: arquivos de segredo pelo nome (.env, .pem, chaves), padrões de chave (Google, OpenAI/Anthropic,
//      GitHub, AWS, chave privada, JWT) e os VALORES dos .env locais — nos arquivos versionados e nos novos ainda não
//      versionados (o que o .gitignore ignora fica de fora). Usa a mesma conferência do `npm run github:publish`, com a
//      mesma lista de falsos positivos (scripts/github/padroes-permitidos.txt).
//   2. Dependências com falha conhecida (CVE): `npm audit` do backend e da interface, só o que vai para produção. Crítica
//      ou alta = problema; moderada/baixa = aviso.
//
//   npm run security:check                 as duas verificações
//   npm run security:check -- --sem-audit  só os segredos (sem rede)
//   npm run security:check -- --sem-segredos  só as dependências — para quem já conferiu os segredos por conta própria (o
//                                            `github:publish -- --verificar` confere no snapshot e roda isto numa cópia sem .git)
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { findEnvFiles, fingerprint, KEY_PATTERNS, MIN_SECRET_LENGTH, parseAllowedPatternHits, parseEnv, secretValues, sensitiveFiles } from "../github/publicar.mjs"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const skipAudit = process.argv.includes("--sem-audit")
const skipSecrets = process.argv.includes("--sem-segredos")
let problems = 0
let warnings = 0
const ok = (message) => console.log(`  ✓ ${message}`)
const warn = (message) => {
  warnings += 1
  console.log(`  ! ${message}`)
}
const bad = (message) => {
  problems += 1
  console.log(`  ✗ ${message}`)
}

const git = (args, input) => spawnSync("git", args, { cwd: ROOT, encoding: "utf8", input, maxBuffer: 256 * 1024 * 1024 })

// ----------------------------------------------------------------------------------------------------------- segredos
if (skipSecrets) {
  console.log("Segredos no código: pulados (--sem-segredos)")
} else {
  console.log("Segredos no código (versionados + novos não ignorados)")
  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"])
  if (listed.status !== 0) {
    bad(`git ls-files falhou: ${listed.stderr.trim()}`)
  } else {
    const paths = listed.stdout.split("\0").filter(Boolean).filter((path) => existsSync(join(ROOT, path)))
    const byName = sensitiveFiles(paths)
    if (byName.length) for (const { path, reason } of byName) bad(`${reason}: ${path} — tire do repositório (e do histórico, se já foi commitado)`)
    else ok(`nenhum arquivo de segredo pelo nome em ${paths.length} arquivos`)

    const allowedFile = join(ROOT, "scripts/github/padroes-permitidos.txt")
    const allowed = existsSync(allowedFile) ? parseAllowedPatternHits(readFileSync(allowedFile, "utf8")) : new Set()
    let keyHits = 0
    for (const { name, regex } of KEY_PATTERNS) {
      // Pasta de trabalho (com as mudanças ainda não commitadas) + arquivos novos não ignorados. -o: só o trecho casado.
      const result = git(["grep", "-a", "-o", "-z", "-E", "--untracked", "-e", regex])
      if (result.status > 1) {
        bad(`git grep falhou (${name}): ${result.stderr.trim()}`)
        continue
      }
      const hits = new Set()
      for (const line of result.stdout.split("\n")) {
        const separator = line.indexOf("\0")
        if (separator === -1) continue
        const token = line.slice(separator + 1).replace(/^[^A-Za-z0-9_-]/, "")
        hits.add(`${line.slice(0, separator)} ${fingerprint(token)}`)
      }
      for (const hit of [...hits].filter((entry) => !allowed.has(entry))) {
        keyHits += 1
        bad(`${name}: ${hit.split(" ")[0]} (se for chave inventada de teste, libere com a linha "${hit}" em scripts/github/padroes-permitidos.txt)`)
      }
    }
    if (keyHits === 0) ok("nenhum padrão de chave fora da lista de falsos positivos")

    // Valores dos .env locais: nunca impressos nem passados na linha de comando (vão pela entrada padrão do git grep).
    const secrets = findEnvFiles(ROOT).flatMap((file) => secretValues(parseEnv(readFileSync(file, "utf8"))).map((secret) => ({ ...secret, source: relative(ROOT, file) })))
    const values = [...new Set(secrets.map((secret) => secret.value).filter((value) => value.length >= MIN_SECRET_LENGTH))]
    if (values.length === 0) ok("nenhum .env local com segredo para procurar")
    else {
      const found = git(["grep", "-F", "-l", "-z", "--untracked", "-f", "-"], `${values.join("\n")}\n`)
      const files = found.status === 0 ? found.stdout.split("\0").filter(Boolean) : []
      if (found.status > 1) bad(`git grep falhou: ${found.stderr.trim()}`)
      else if (files.length) for (const file of files) bad(`um valor secreto dos .env locais aparece em ${file} — troque o valor (ele vazou) e tire do arquivo`)
      else ok(`os ${values.length} valores secretos dos .env locais não aparecem em nenhum arquivo do repositório`)
    }
  }
}

// -------------------------------------------------------------------------------------------------------- dependências
if (!skipAudit) {
  for (const project of ["backend", "frontend"]) {
    console.log(`\nDependências de produção — ${project} (npm audit)`)
    const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: join(ROOT, project), encoding: "utf8", shell: process.platform === "win32", maxBuffer: 64 * 1024 * 1024 })
    let report = null
    try {
      report = JSON.parse(audit.stdout)
    } catch {
      report = null
    }
    const counts = report?.metadata?.vulnerabilities
    if (!counts) {
      warn(`npm audit não respondeu (${(audit.stderr || "sem saída").trim().split("\n")[0]}) — sem rede ou registro fora do ar; rode de novo depois`)
      continue
    }
    const serious = (counts.critical ?? 0) + (counts.high ?? 0)
    const minor = (counts.moderate ?? 0) + (counts.low ?? 0)
    const names = Object.entries(report.vulnerabilities ?? {}).filter(([, item]) => ["critical", "high"].includes(item.severity)).map(([name, item]) => `${name} (${item.severity})`)
    if (serious > 0) bad(`${serious} falha(s) crítica(s)/alta(s) em dependências de produção: ${names.join(", ")} — npm audit --omit=dev para os detalhes`)
    else ok("nenhuma falha crítica ou alta em dependências de produção")
    if (minor > 0) warn(`${minor} falha(s) moderada(s)/baixa(s) — avalie em npm audit --omit=dev (docs/security/pendencias-e-riscos.md, R-14)`)
  }
}

console.log(problems ? `\n✗ ${problems} problema(s)${warnings ? ` e ${warnings} aviso(s)` : ""}.` : `\n✓ Nenhum problema${warnings ? ` (${warnings} aviso(s))` : ""}.`)
process.exit(problems ? 1 : 0)
