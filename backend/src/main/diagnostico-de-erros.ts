/**
 * DIAGNÓSTICO DE ERROS PELO TERMINAL DA VM — funciona sem a interface administrativa, sem internet e sem nenhuma ferramenta
 * externa. Rode de dentro de `<pasta da INIA>\backend` (lê o `backend\.env` para achar o banco):
 *
 *   node dist\main\diagnostico-de-erros.js INIA-BANCO-INDISPONIVEL      explica o código (catálogo)
 *   node dist\main\diagnostico-de-erros.js 5f0c2a9e-…                   acha a ocorrência: banco + arquivos de log
 *   node dist\main\diagnostico-de-erros.js 5f0c2a9e-… --logs D:\INIA\logs   pasta de logs diferente da padrão (..\logs)
 *   node dist\main\diagnostico-de-erros.js --buscar BANCO                lista códigos que contêm o trecho
 *   … --json                                                             saída em JSON
 *
 * Em desenvolvimento: `npx tsx src/main/diagnostico-de-erros.ts <código|referência>`.
 * Banco fora do ar: avisa e segue só com os arquivos de log (a ocorrência está lá também).
 */
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { fileURLToPath } from "node:url"
import { explainCode, searchCodes, type CodeExplanation } from "../shared/domain/errors/error-lookup.js"
import { REFERENCE_PATTERN } from "../modules/error-diagnostics/domain/error-occurrence.js"

const argv = process.argv.slice(2)
const asJson = argv.includes("--json")
const logsIndex = argv.indexOf("--logs")
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const logsDir = logsIndex >= 0 ? argv[logsIndex + 1] ?? "" : path.resolve(backendRoot, "..", "logs")
const searchIndex = argv.indexOf("--buscar")
const optionValues = new Set([logsIndex, searchIndex].filter((index) => index >= 0).map((index) => index + 1))
const positional = argv.filter((value, index) => !value.startsWith("--") && !optionValues.has(index))

function printExplanation(explanation: CodeExplanation): void {
  if (asJson) return void console.log(JSON.stringify(explanation, null, 2))
  const out: string[] = []
  if (explanation.kind === "ENTRY") {
    const entry = explanation.entry
    out.push(`${entry.code}${explanation.viaAlias ? `  (pedido: ${explanation.requested}, alias)` : ""}  — catálogo ${explanation.catalogVersion}`)
    out.push(`Módulo: ${entry.module} | Origem: ${entry.origin} | HTTP: ${entry.httpStatus ?? "—"} | Severidade: ${entry.severity}`)
    out.push(`Quando: ${entry.trigger}`, `Para o usuário: ${entry.publicMessage}`, `Técnico: ${entry.technicalDescription}`, "", "Causas prováveis (hipótese → sinal que confirma):")
    for (const cause of entry.probableCauses) out.push(`  - ${cause.hypothesis}\n      sinal: ${cause.signal}`)
    out.push("", "Verificações, em ordem:", ...entry.checks.map((check, index) => `  ${index + 1}. ${check}`), "", "Evidência:")
    for (const evidence of entry.evidence) out.push(`  - ${evidence.where}${evidence.command ? `\n      ${evidence.command}` : ""}`)
    out.push("", `Recuperação: ${entry.recovery}`, `Escalar: ${entry.escalation}`, `Código-fonte: ${entry.codeRefs.join(", ")}`)
  } else {
    const { domain, family } = explanation
    out.push(`${domain.code}  — código do módulo "${domain.module}" (catálogo ${explanation.catalogVersion})`)
    out.push(`HTTP: ${domain.statuses.join(", ") || "—"} | Família: ${family.id} — ${family.title}`)
    for (const message of domain.messages) out.push(`Mensagem: ${message}`)
    out.push(`Onde nasce: ${domain.refs.join(", ")}`, "", family.meaning, "", "Causas prováveis (hipótese → sinal):")
    for (const cause of family.probableCauses) out.push(`  - ${cause.hypothesis}\n      sinal: ${cause.signal}`)
    out.push("", "Verificações:", ...family.checks.map((check, index) => `  ${index + 1}. ${check}`), "", `Recuperação: ${family.recovery}`, `Escalar: ${family.escalation}`)
  }
  console.log(out.join("\n"))
}

async function grepLogs(reference: string): Promise<{ file: string; line: string }[]> {
  if (!logsDir || !existsSync(logsDir)) return []
  const files = readdirSync(logsDir).filter((name) => name.toLowerCase().endsWith(".log") || /\.log\.\d+$/i.test(name)).map((name) => path.join(logsDir, name)).filter((file) => statSync(file).isFile())
  const hits: { file: string; line: string }[] = []
  for (const file of files) {
    const reader = readline.createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity })
    for await (const line of reader) if (line.includes(reference)) hits.push({ file: path.basename(file), line: line.length > 4000 ? `${line.slice(0, 4000)}…` : line })
  }
  return hits
}

async function findInDatabase(reference: string): Promise<{ ok: true; rows: unknown[] } | { ok: false; reason: string }> {
  try {
    const { pool } = await import("../infrastructure/database/pool.js")
    try {
      const result = await pool.query(`select reference, code, source, http_status, severity, service, release, method, route, authenticated, occurred_at, details from error_occurrences where reference = $1 order by occurred_at limit 20`, [reference])
      return { ok: true, rows: result.rows }
    } finally {
      await pool.end()
    }
  } catch (error) {
    return { ok: false, reason: `${(error as { code?: string }).code ?? ""} ${(error as Error).message ?? String(error)}`.trim() }
  }
}

async function main(): Promise<number> {
  if (searchIndex >= 0) {
    const results = searchCodes(argv[searchIndex + 1] ?? "", 100)
    if (asJson) console.log(JSON.stringify(results, null, 2))
    else for (const result of results) console.log(`${result.code.padEnd(48)} ${result.module} — ${result.title}`)
    return 0
  }
  const input = positional[0]?.trim()
  if (!input) {
    console.log("Uso: node dist\\main\\diagnostico-de-erros.js <código|referência> [--logs <pasta>] [--json]   |   --buscar <trecho>")
    return 2
  }
  const explanation = explainCode(input)
  if (explanation) {
    printExplanation(explanation)
    return 0
  }
  if (!REFERENCE_PATTERN.test(input)) {
    console.log(`"${input}" não é um código do catálogo nem uma referência válida. Tente --buscar <trecho>.`)
    return 1
  }
  const [database, logs] = await Promise.all([findInDatabase(input), grepLogs(input)])
  if (asJson) {
    console.log(JSON.stringify({ reference: input, database, logsDir, logs }, null, 2))
    return 0
  }
  console.log(`Referência ${input}`)
  if (database.ok) {
    console.log(`\nBanco (error_occurrences): ${database.rows.length} ocorrência(s)`)
    for (const row of database.rows) console.log(JSON.stringify(row, null, 2))
  } else console.log(`\nBanco indisponível para consulta (${database.reason}) — seguindo só com os arquivos de log.`)
  console.log(`\nLogs em ${logsDir}: ${logs.length} linha(s)`)
  for (const hit of logs) console.log(`[${hit.file}] ${hit.line}`)
  const codes = new Set<string>()
  if (database.ok) for (const row of database.rows as { code: string }[]) codes.add(row.code)
  for (const hit of logs) {
    const match = /"code":"([A-Za-z0-9_-]+)"/.exec(hit.line)
    if (match) codes.add(match[1]!)
  }
  if (codes.size === 0 && (!database.ok || database.rows.length === 0) && logs.length === 0) {
    console.log("\nNada encontrado. Veja o runbook (docs/operacao/runbook-diagnostico-de-erros.md, seção \"Referência sem registro\"): referência local do navegador, falha no proxy (log do IIS) ou fora da retenção.")
  }
  for (const code of codes) {
    const explained = explainCode(code)
    if (explained) {
      console.log(`\n================ ${code} ================`)
      printExplanation(explained)
    }
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error)
    process.exit(1)
  },
)
