#!/usr/bin/env node
// `npm run security:scan` — varredura AppSec reproduzível (auditoria de 29/10/2026, docs/security/appsec-2026-10-29/).
// Complementa o `security:check` (segredos por padrão próprio + npm audit) com as ferramentas oficiais, em contêineres
// FIXADOS por digest e sem enviar código para fora:
//
//   1. Semgrep CE 1.181.0 — regras oficiais (semgrep/semgrep-rules no commit fixado), rede DESLIGADA, --metrics=off;
//   2. Gitleaks 8.30.1  — arquivos que podem ir para o Git (versionados + novos não ignorados) e TODO o histórico (--all),
//      sempre com --redact (valor nunca aparece no relatório), rede desligada;
//   3. OSV-Scanner 2.7.0 — lockfiles do backend e da interface contra a base OSV OFFLINE (baixa só a base pública do npm;
//      a lista de pacotes nunca sai da máquina), depois roda com a rede desligada;
//   4. Syft 1.54.1      — SBOM CycloneDX e SPDX (só dependências de produção), rede desligada, sem checagem de atualização.
//
// Saída em output/appsec-<data>/ (ignorada pelo Git). Sai com código 1 só quando aparece achado NOVO em relação à linha de
// base (scripts/security/appsec-baseline.json), que guarda as impressões dos alertas já triados — vulnerabilidade
// conhecida não some da lista, só deixa de barrar. Critério de bloqueio: qualquer segredo novo; Semgrep ERROR/WARNING
// novo; dependência de PRODUÇÃO com vulnerabilidade nova. Dependência só de desenvolvimento = aviso.
//
//   npm run security:scan                       roda tudo
//   npm run security:scan -- --so=semgrep,gitleaks
//   npm run security:scan -- --atualizar-base   regrava a linha de base (só depois de triar cada item novo!)
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..")
const IMAGES = {
  semgrep: "semgrep/semgrep:1.181.0@sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b",
  gitleaks: "ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f",
  osv: "ghcr.io/google/osv-scanner:v2.7.0@sha256:4f3b7e2c64b9d38a5febc5a7e4a3dfef1d1362f726dea7a2ef4762b46469fcd0",
  syft: "anchore/syft:v1.54.1@sha256:3eb5379ba7b409c3f4069b686110527af0c47df993fa5c10d13e7cf34f49b1aa",
}
const SEMGREP_RULES = { repo: "https://github.com/semgrep/semgrep-rules.git", commit: "16b9e6d45f10649f6a531ec4838ed9924372c3bc" }
// Diretórios de regras (sem segredos: o Gitleaks cobre; sem fixtures de teste das próprias regras).
const SEMGREP_RULE_DIRS = ["javascript", "typescript", "ai/typescript", "ai/generic", "ai/ai-best-practices", "generic/unicode", "generic/html-templates", "dockerfile", "yaml/docker-compose", "html/security", "bash", "problem-based-packs/insecure-transport/js-node"]
const SEMGREP_TARGETS = ["backend/src", "backend/scripts", "backend/migrations", "frontend/src", "frontend/next.config.ts", "frontend/public", "scripts", "deploy", "docker", "compose.yaml"]
// Regras de estilo/portabilidade que não são segurança: ficam fora do bloqueio (continuam no relatório bruto).
const SEMGREP_NOISE = /i18next|missing-template-string|react-props-spreading|detect-generic-ai|no-stringify-keys|no-replaceall|useless-ternary|useless-assignment|react-props-in-state|javascript-confirm/

const args = process.argv.slice(2)
const only = (args.find((arg) => arg.startsWith("--so="))?.slice(5).split(",") ?? ["semgrep", "gitleaks", "osv", "syft"]).map((name) => name.trim())
const updateBaseline = args.includes("--atualizar-base")
const stamp = new Date().toLocaleString("sv-SE").slice(0, 16).replace(/[: ]/g, "-")
const OUT = join(ROOT, "output", `appsec-${stamp}`)
const CACHE = join(ROOT, "output", "appsec-cache")
const BASELINE_FILE = join(ROOT, "scripts/security/appsec-baseline.json")
mkdirSync(OUT, { recursive: true })
mkdirSync(CACHE, { recursive: true })

const sh = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...options })
  if (result.error) throw result.error
  return result
}
const docker = (image, dockerArgs, commandArgs, { network = false } = {}) =>
  sh("docker", ["run", "--rm", ...(network ? [] : ["--network", "none"]), "--cpus", "3", "--memory", "4g", ...dockerArgs, image, ...commandArgs])
const sha = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16)
const log = (message) => console.log(message)

if (sh("docker", ["version", "--format", "{{.Server.Version}}"]).status !== 0) {
  console.error("Docker não está disponível — a varredura roda as ferramentas em contêineres fixados.")
  process.exit(2)
}

const findings = { semgrep: [], gitleaks: [], osv: [] }

if (only.includes("semgrep")) {
  log("Semgrep CE (rede desligada)…")
  const rules = join(CACHE, `semgrep-rules-${SEMGREP_RULES.commit.slice(0, 12)}`)
  if (!existsSync(rules)) {
    // Única etapa com rede: baixa as regras oficiais no commit fixado (nada do projeto é enviado).
    sh("git", ["clone", "--quiet", "--filter=blob:none", SEMGREP_RULES.repo, `${rules}.repo`])
    sh("git", ["-C", `${rules}.repo`, "checkout", "--quiet", SEMGREP_RULES.commit])
    for (const dir of SEMGREP_RULE_DIRS) if (existsSync(join(`${rules}.repo`, dir))) cpSync(join(`${rules}.repo`, dir), join(rules, dir), { recursive: true, filter: (path) => !/\.(test|fixed)\.|\.(js|ts|tsx|jsx|py|go|java|rb|php|cs|kt|swift|dart|sh|html|json|tf|Dockerfile)$|\/Dockerfile$/i.test(path) || !path.includes(".") })
  }
  const result = docker(IMAGES.semgrep, ["-v", `${ROOT}:/src:ro`, "-v", `${rules}:/rules:ro`, "-v", `${OUT}:/out`, "-w", "/src"], ["semgrep", "scan", "--config", "/rules", "--metrics=off", "--disable-version-check", "--timeout", "30", "--max-target-bytes", "1500000", "-j", "3", "--exclude", "node_modules", "--exclude", "dist", "--exclude", ".next", "--exclude", "*.test.ts", "--exclude", "*.test.tsx", "--exclude", "testing", "--exclude", "*.generated.json", "--json", "--output", "/out/semgrep.json", "--sarif-output=/out/semgrep.sarif", ...SEMGREP_TARGETS])
  if (!existsSync(join(OUT, "semgrep.json"))) throw new Error(`Semgrep falhou: ${result.stderr.slice(-800)}`)
  const report = JSON.parse(readFileSync(join(OUT, "semgrep.json"), "utf8"))
  for (const item of report.results) {
    if (SEMGREP_NOISE.test(item.check_id) || item.extra.severity === "INFO") continue
    // Impressão estável: regra + arquivo + conteúdo da linha (não o número, que muda com qualquer edição acima).
    const line = readFileSync(join(ROOT, item.path), "utf8").split("\n")[item.start.line - 1] ?? ""
    findings.semgrep.push({ id: `${item.check_id.split(".").slice(-1)[0]}|${item.path}|${sha(line.trim())}`, where: `${item.path}:${item.start.line}`, rule: item.check_id, severity: item.extra.severity, blocking: true })
  }
}

if (only.includes("gitleaks")) {
  log("Gitleaks (arquivos que podem ir ao Git + histórico completo, valores redigidos)…")
  const snapshot = join(OUT, "gitleaks-snapshot")
  mkdirSync(snapshot, { recursive: true })
  const files = sh("git", ["-C", ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"]).stdout
  sh("rsync", ["-a", "--from0", `--files-from=-`, `${ROOT}/`, `${snapshot}/`], { input: files })
  docker(IMAGES.gitleaks, ["-v", `${snapshot}:/scan:ro`, "-v", `${OUT}:/out`], ["dir", "/scan", "--redact=100", "--no-banner", "--report-format", "json", "--report-path", "/out/gitleaks-dir.json", "--exit-code", "0"])
  docker(IMAGES.gitleaks, ["-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*", "-v", `${ROOT}:/repo:ro`, "-v", `${OUT}:/out`], ["git", "/repo", "--redact=100", "--no-banner", "--log-opts=--all", "--report-format", "json", "--report-path", "/out/gitleaks-git.json", "--exit-code", "0"])
  sh("rm", ["-rf", snapshot])
  for (const [mode, file] of [["arquivo", "gitleaks-dir.json"], ["histórico", "gitleaks-git.json"]]) {
    for (const item of JSON.parse(readFileSync(join(OUT, file), "utf8"))) {
      const path = item.File.replace(/^\/scan\//, "")
      // O relatório vem redigido, então a impressão do ARQUIVO usa o hash da própria linha lida aqui (um segredo novo no mesmo
      // arquivo, com o mesmo nome de chave, muda o hash); no HISTÓRICO vale a impressão do Gitleaks (commit:arquivo:regra:linha),
      // que nunca muda para um commit já existente.
      const line = mode === "arquivo" && existsSync(join(ROOT, path)) ? (readFileSync(join(ROOT, path), "utf8").split("\n")[item.StartLine - 1] ?? "") : ""
      const id = mode === "arquivo" ? `${item.RuleID}|${path}|${sha(line.trim())}` : `historico|${item.Fingerprint}`
      findings.gitleaks.push({ id, where: `${mode}: ${path}:${item.StartLine}${item.Commit ? ` @${item.Commit.slice(0, 10)}` : ""}`, rule: item.RuleID, blocking: true })
    }
  }
}

if (only.includes("osv")) {
  log("OSV-Scanner (base offline; a lista de pacotes não sai da máquina)…")
  const dbCache = join(CACHE, "osv-db")
  mkdirSync(dbCache, { recursive: true })
  const lockfiles = ["-L", "/src/backend/package-lock.json", "-L", "/src/frontend/package-lock.json"]
  const base = ["-e", "OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY=/cache", "-v", `${dbCache}:/cache`, "-v", `${ROOT}:/src:ro`, "-v", `${OUT}:/out`]
  // 1ª passada só para atualizar a base pública do ecossistema (GET); a análise que vale é a 2ª, com a rede desligada.
  docker(IMAGES.osv, base, ["scan", "source", "--offline-vulnerabilities", "--download-offline-databases", "--format", "json", "--output-file", "/out/osv-download.json", ...lockfiles], { network: true })
  docker(IMAGES.osv, base, ["scan", "source", "--offline-vulnerabilities", "--format", "json", "--output-file", "/out/osv.json", ...lockfiles])
  const report = JSON.parse(readFileSync(join(OUT, "osv.json"), "utf8"))
  for (const result of report.results ?? []) {
    const project = result.source.path.includes("frontend") ? "frontend" : "backend"
    const lock = JSON.parse(readFileSync(join(ROOT, project, "package-lock.json"), "utf8")).packages
    for (const pkg of result.packages) {
      const devOnly = Object.entries(lock).filter(([path, meta]) => path.endsWith(`node_modules/${pkg.package.name}`) && meta.version === pkg.package.version).every(([, meta]) => meta.dev === true)
      for (const vuln of pkg.vulnerabilities) findings.osv.push({ id: `${project}|${pkg.package.name}@${pkg.package.version}|${vuln.id}`, where: `${project}: ${pkg.package.name}@${pkg.package.version}`, rule: `${vuln.id} ${vuln.summary ?? ""}`.trim(), blocking: !devOnly, scope: devOnly ? "desenvolvimento" : "produção" })
    }
  }
}

if (only.includes("syft")) {
  log("Syft (SBOM CycloneDX + SPDX, só produção)…")
  for (const project of ["backend", "frontend"]) {
    docker(IMAGES.syft, ["-e", "SYFT_CHECK_FOR_APP_UPDATE=false", "-v", `${join(ROOT, project)}:/src:ro`, "-v", `${OUT}:/out`], ["scan", "dir:/src", "--source-name", `inia-${project}`, "--exclude", "./.next/**", "--exclude", "./dist/**", "-o", `cyclonedx-json=/out/sbom-${project}.cdx.json`, "-o", `spdx-json=/out/sbom-${project}.spdx.json`])
  }
}

const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")) : { semgrep: [], gitleaks: [], osv: [] }
let newBlocking = 0
for (const tool of Object.keys(findings)) {
  if (!only.includes(tool)) continue
  const known = new Set(baseline[tool] ?? [])
  const fresh = findings[tool].filter((item) => !known.has(item.id))
  const unique = [...new Map(fresh.map((item) => [item.id, item])).values()]
  log(`\n${tool}: ${new Set(findings[tool].map((item) => item.id)).size} item(ns), ${unique.length} novo(s) em relação à linha de base`)
  for (const item of unique) {
    log(`  ${item.blocking ? "✗" : "!"} ${item.rule} — ${item.where}${item.scope ? ` (${item.scope})` : ""}`)
    if (item.blocking) newBlocking += 1
  }
}
writeFileSync(join(OUT, "resumo.json"), JSON.stringify({ geradoEm: new Date().toISOString(), imagens: IMAGES, regrasSemgrep: SEMGREP_RULES, findings }, null, 1))
if (updateBaseline) {
  const next = { ...baseline, geradoEm: new Date().toISOString().slice(0, 10) }
  for (const tool of Object.keys(findings)) if (only.includes(tool)) next[tool] = [...new Set(findings[tool].map((item) => item.id))].sort()
  writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 1)}\n`)
  log(`\nLinha de base regravada em ${BASELINE_FILE} — confira no diff que cada item novo foi triado.`)
}
log(`\nRelatórios brutos: ${OUT}`)
log(newBlocking ? `✗ ${newBlocking} achado(s) novo(s) que barram a entrega.` : "✓ Nenhum achado novo que barre a entrega.")
process.exit(newBlocking && !updateBaseline ? 1 : 0)
