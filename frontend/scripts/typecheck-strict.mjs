#!/usr/bin/env node
// `npm run typecheck:estrito` — adoção GRADUAL de `noUncheckedIndexedAccess` no frontend (o backend já usa a opção).
//
// Ligar a opção de uma vez dava 1.213 erros em 61 arquivos (29/10/2026). Em vez disso, uma catraca: o `tsc` roda com a opção
// e os erros são comparados, ARQUIVO A ARQUIVO, com a linha de base (scripts/typecheck-strict-baseline.json). Falha se um
// arquivo ganhar erro (código novo nasce com acesso indexado conferido) e avisa quando um arquivo melhorou, para a base
// encolher. Um `include` parcial no tsconfig não serve: o tsc checa também tudo o que os arquivos incluídos importam.
//
//   npm run typecheck:estrito                       compara com a base
//   npm run typecheck:estrito -- --atualizar-base   regrava a base (só para ENCOLHER — o diff mostra o que saiu)
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..")
const BASELINE_FILE = join(FRONTEND, "scripts/typecheck-strict-baseline.json")
const updateBaseline = process.argv.includes("--atualizar-base")

const tsc = spawnSync(process.execPath, [join(FRONTEND, "node_modules/typescript/bin/tsc"), "--noEmit", "--incremental", "false", "--pretty", "false", "--noUncheckedIndexedAccess", "-p", join(FRONTEND, "tsconfig.json")], { cwd: FRONTEND, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
if (tsc.error) {
  console.error(`tsc não rodou: ${tsc.error.message}`)
  process.exit(2)
}

/** Erros por arquivo (caminho relativo ao frontend). */
const current = {}
for (const line of `${tsc.stdout}\n${tsc.stderr}`.split("\n")) {
  const match = /^(.+?)\(\d+,\d+\): error TS\d+/.exec(line)
  if (!match) continue
  const file = relative(FRONTEND, join(FRONTEND, match[1])).split("\\").join("/")
  current[file] = (current[file] ?? 0) + 1
}
const total = (counts) => Object.values(counts).reduce((sum, count) => sum + count, 0)

if (updateBaseline) {
  const sorted = Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(BASELINE_FILE, `${JSON.stringify({ option: "noUncheckedIndexedAccess", files: sorted }, null, 2)}\n`)
  console.log(`Base regravada: ${total(current)} erro(s) em ${Object.keys(current).length} arquivo(s).`)
  process.exit(0)
}

const baseline = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, "utf8")).files : {}
const worse = Object.entries(current).filter(([file, count]) => count > (baseline[file] ?? 0))
const better = Object.entries(baseline).filter(([file, count]) => (current[file] ?? 0) < count)

console.log(`noUncheckedIndexedAccess: ${total(current)} erro(s) em ${Object.keys(current).length} arquivo(s) (base: ${total(baseline)} em ${Object.keys(baseline).length}).`)
for (const [file, count] of worse) console.log(`  ✗ ${file}: ${count} (base ${baseline[file] ?? 0}) — confira o acesso indexado (\`?.\`, guarda ou \`!\` justificado)`)
for (const [file, count] of better) console.log(`  ✓ ${file}: ${current[file] ?? 0} (base ${count}) — melhorou; rode com --atualizar-base para a base encolher`)
if (worse.length > 0) {
  console.log("Falhou: arquivo com mais erros de acesso indexado do que na base.")
  process.exit(1)
}
console.log("ok — nenhum arquivo piorou.")
