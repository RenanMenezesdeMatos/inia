// Senhas dos BANCOS EXTERNOS DE EXEMPLO (compose.yaml, perfis external-examples / external-example-sqlserver).
//
// Nenhuma senha fica no código: o Compose lê INIA_EXAMPLES_ADMIN_PASSWORD (superusuário dos contêineres de exemplo) e
// INIA_EXAMPLES_READER_PASSWORD (usuário somente leitura `inia_leitura`, o que a INIA usa) do .env da raiz. O
// `npm run env:init` gera as duas ao criar o .env; este script completa um .env antigo antes de `npm run examples:up`.
//
//   node scripts/install/example-databases.mjs   → gera as que faltarem no .env da raiz (as existentes ficam)
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const hex = (bytes) => randomBytes(bytes).toString("hex")

/** Maiúscula + minúsculas + dígito: atende à política de senha do `sa` do SQL Server; sem símbolos (vai em linha de comando). */
export const EXAMPLE_PASSWORD_GENERATORS = {
  INIA_EXAMPLES_ADMIN_PASSWORD: () => `Ex${hex(12)}9`,
  INIA_EXAMPLES_READER_PASSWORD: () => `Le${hex(12)}7`,
}

/** Completa o texto de um .env com as senhas de exemplo que faltarem (ou estiverem vazias). Devolve o texto e as chaves geradas. */
export function withExamplePasswords(text) {
  let next = text
  const generated = []
  for (const [key, generate] of Object.entries(EXAMPLE_PASSWORD_GENERATORS)) {
    const line = new RegExp(`^${key}=(.*)$`, "m")
    const current = line.exec(next)?.[1]?.trim() ?? ""
    if (current) continue
    next = line.test(next) ? next.replace(line, `${key}=${generate()}`) : `${next.trimEnd()}\n${key}=${generate()}\n`
    generated.push(key)
  }
  return { text: next, generated }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const envPath = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), ".env")
  if (!existsSync(envPath)) {
    console.error("Os bancos de exemplo usam o .env da raiz (Docker Compose), que não existe. Rode antes: npm run env:init")
    process.exit(1)
  }
  const { text, generated } = withExamplePasswords(readFileSync(envPath, "utf8"))
  if (generated.length > 0) {
    writeFileSync(envPath, text, { mode: 0o600 })
    console.log(`✓ senhas dos bancos de exemplo geradas no .env da raiz: ${generated.join(", ")}`)
  }
}
