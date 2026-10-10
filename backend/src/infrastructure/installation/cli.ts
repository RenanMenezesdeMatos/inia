import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

/** Utilidades de linha de comando da instalação (perguntas no terminal, versão, saída). */
export function packageVersion(): string {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json")
  return (JSON.parse(readFileSync(path, "utf8")) as { version: string }).version
}

export async function ask(question: string, options: { defaultValue?: string; validate?: (value: string) => string | null } = {}): Promise<string> {
  if (!process.stdin.isTTY) throw new Error(`Falta informar: ${question} (sem terminal interativo, passe a opção correspondente na linha de comando).`)
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    for (;;) {
      const answer = (await rl.question(`${question}${options.defaultValue ? ` [${options.defaultValue}]` : ""}: `)).trim() || options.defaultValue || ""
      const problem = options.validate?.(answer) ?? (answer ? null : "Campo obrigatório.")
      if (!problem) return answer
      process.stdout.write(`  ${problem}\n`)
    }
  } finally {
    rl.close()
  }
}

export async function confirm(question: string, defaultYes = false): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes
  const answer = (await ask(`${question} (s/n)`, { defaultValue: defaultYes ? "s" : "n", validate: (value) => (/^[sn]$/i.test(value) ? null : "Responda s ou n.") })).toLowerCase()
  return answer === "s"
}

export const say = (message = "") => process.stdout.write(`${message}\n`)

/** O banco INTERNO da INIA é sempre PostgreSQL: SQL Server/MySQL/MariaDB entram só como bancos EXTERNOS (Central de Dados). */
export function requirePostgresDatabaseUrl(url: string): void {
  if (/^postgres(ql)?:\/\//i.test(url.trim())) return
  fail(
    "DATABASE_URL não é um endereço de PostgreSQL. O banco interno da INIA é sempre PostgreSQL (15 ou mais novo); " +
      "SQL Server, MySQL e MariaDB são conectados como bancos EXTERNOS pela tela Central de Dados.\n" +
      "PostgreSQL em outro servidor (ex.: na área de dados): npm run db:connect",
  )
}

export function fail(message: string): never {
  process.stderr.write(`\n✗ ${message}\n`)
  process.exit(1)
}
