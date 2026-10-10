/**
 * Scripts CONGELADOS — evidência histórica de rodadas pagas e benchmarks: nunca são editados, por isso ficam fora do lint
 * (`eslint.config.js`) e da checagem de tipos (`tsconfig.scripts.json`, cuja lista estática o teste ao lado mantém igual a
 * esta). Congelado = caminho de `scripts/` nas chaves `files` de algum `*-freeze.json` (derivado aqui) ou pasta/rodada com
 * "nunca reexecutar/repetir" na documentação (listas abaixo). Critério: docs/dev/refatoracao-progressiva.md, seção 7.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const BACKEND_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const CODE_FILE = /\.(c|m)?[jt]s$/

/** Pastas inteiras: o README de cada uma proíbe reexecutar (holdout V2: "nunca reexecutar H1"; benchmarks cegos V1–V4). */
export const FROZEN_SCRIPT_DIRECTORIES = ["scripts/poc-tools/benchmarks", "scripts/poc-tools/holdout-v2"]

/** Rodadas sem manifesto de hash, mas com "nunca repetir" (CLAUDE.md, docs/dev/feedback-engine.md). */
export const FROZEN_SCRIPT_FILES_BY_DOCUMENTATION = [
  "scripts/feedback-engine/evaluation/larissa/compare-contracts-v10.ts",
  "scripts/feedback-engine/evaluation/larissa/evaluate-round-v10.ts",
  "scripts/feedback-engine/evaluation/larissa/evaluate-round-v9.ts",
  "scripts/feedback-engine/evaluation/larissa/round-v10-budget.ts",
]

/**
 * Scripts com hash registrado: chaves `files` dos `*-freeze.json` sob `scripts/` (entradas de `src/` nunca entram).
 * @param {string} [backendDir]
 * @returns {string[]}
 */
export function frozenScriptFilesFromManifests(backendDir = BACKEND_DIR) {
  /** @type {Set<string>} */
  const files = new Set()
  for (const entry of readdirSync(join(backendDir, "scripts"), { recursive: true })) {
    if (!String(entry).endsWith("freeze.json")) continue
    const manifest = JSON.parse(readFileSync(join(backendDir, "scripts", String(entry)), "utf8"))
    const hashed = manifest?.files && typeof manifest.files === "object" && !Array.isArray(manifest.files) ? Object.keys(manifest.files) : []
    for (const path of hashed) if (path.startsWith("scripts/") && CODE_FILE.test(path)) files.add(path)
  }
  return [...files].sort()
}

/**
 * Todos os arquivos congelados fora das pastas inteiras (manifestos + documentação), sem repetição.
 * @param {string} [backendDir]
 * @returns {string[]}
 */
export function frozenScriptFiles(backendDir = BACKEND_DIR) {
  return [...new Set([...frozenScriptFilesFromManifests(backendDir), ...FROZEN_SCRIPT_FILES_BY_DOCUMENTATION])].sort()
}
