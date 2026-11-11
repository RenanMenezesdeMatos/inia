import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import type { InventoriedDomainCode } from "../../domain/errors/error-catalog-types.js"

/**
 * INVENTÁRIO dos códigos de erro que os módulos devolvem — lido do código-fonte (nunca digitado à mão), para que o catálogo
 * cubra todo código que um usuário pode copiar da tela. Usado pelo gerador (`npm run errors:catalog`) e pelo teste que recusa
 * divergência entre o inventário gravado e o código atual.
 *
 * O que reconhece (heurística de texto, documentada como lacuna onde não alcança):
 * - `new DomainError(mensagem, "CODIGO", status?)` e `super(mensagem, "CODIGO", status?)` nas subclasses;
 * - objetos de erro com `code: "CODIGO"` seguido de `message:` (respostas `{ error: { code, message } }` e decisões de acesso);
 * - os mapas `DATA_RUN_ERROR_CODES`/`DATA_RECORD_ERROR_CODES` e as categorias `AI_<CATEGORIA>` dos provedores de IA.
 * Não reconhece código montado em variável (`code: someVar`) — esses caem no fallback por status (família).
 */

const CODE = "[A-Z][A-Z0-9_]{2,}"
const SKIP_PATH = /(\.test\.ts$|\/testing\/|\.generated\.ts$|\/shared\/domain\/errors\/|\/demo-mass\/|\.d\.ts$)/

function listSources(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (full.endsWith(".ts")) out.push(full)
    }
  }
  walk(root)
  return out.filter((file) => !SKIP_PATH.test(file.split(path.sep).join("/"))).sort()
}

function moduleOf(relative: string): string {
  const parts = relative.split("/")
  if (parts[0] === "src" && parts[1] === "modules" && parts[2]) return parts[2]
  return parts[1] ?? "src"
}

/** Trecho de uma chamada a partir do `(` — conta parênteses fora de strings simples. */
function callSlice(text: string, open: number): string {
  let depth = 0
  let quote: string | null = null
  for (let index = open; index < text.length && index < open + 2000; index++) {
    const char = text[index]!
    if (quote) {
      if (char === "\\") index++
      else if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === "`") quote = char
    else if (char === "(") depth++
    else if (char === ")") {
      depth--
      if (depth === 0) return text.slice(open, index + 1)
    }
  }
  return text.slice(open, open + 400)
}


type Accumulator = Map<string, { modules: Map<string, number>; statuses: Set<number>; messages: Set<string>; refs: Set<string> }>

function add(acc: Accumulator, code: string, module: string, ref: string, status: number | null, message: string | null) {
  const current = acc.get(code) ?? { modules: new Map<string, number>(), statuses: new Set<number>(), messages: new Set<string>(), refs: new Set<string>() }
  current.modules.set(module, (current.modules.get(module) ?? 0) + 1)
  if (status !== null) current.statuses.add(status)
  if (message && current.messages.size < 3) current.messages.add(message.length > 220 ? `${message.slice(0, 217)}…` : message)
  if (current.refs.size < 6) current.refs.add(ref)
  acc.set(code, current)
}

export function scanDomainErrorCodes(backendRoot: string): InventoriedDomainCode[] {
  const acc: Accumulator = new Map()
  const srcRoot = path.join(backendRoot, "src")
  for (const file of listSources(srcRoot)) {
    const text = readFileSync(file, "utf8")
    const relative = path.relative(backendRoot, file).split(path.sep).join("/")
    const module = moduleOf(relative)
    // A — new DomainError(...) e super(...) de subclasses.
    for (const match of text.matchAll(/(?:new\s+DomainError|\bsuper)\s*\(/g)) {
      const slice = callSlice(text, match.index! + match[0].length - 1)
      const codeMatch = new RegExp(`["'](${CODE})["']\\s*(?:,\\s*(\\d{3}))?`).exec(slice)
      if (!codeMatch) continue
      const isDomain = match[0].startsWith("new")
      const messageMatch = /^\(\s*(["'`])((?:\\.|(?!\1).)*)\1/s.exec(slice)
      const status = codeMatch[2] ? Number(codeMatch[2]) : isDomain ? 422 : null
      add(acc, codeMatch[1]!, module, `backend/${relative}`, status, messageMatch?.[2] ?? null)
    }
    // B — objetos de erro { code: "X", message: … } (respostas JSON e decisões).
    for (const match of text.matchAll(new RegExp(`\\bcode:\\s*["'](${CODE})["']\\s*,\\s*message:\\s*(?:(["'\`])((?:\\\\.|(?!\\2).)*)\\2)?`, "gs"))) {
      const before = text.slice(Math.max(0, match.index! - 200), match.index!)
      const statusMatch = /(?:status\(|status:\s*)(\d{3})\D*$/.exec(before)
      add(acc, match[1]!, module, `backend/${relative}`, statusMatch ? Number(statusMatch[1]) : null, match[3] ?? null)
    }
    // C — mapas de códigos da Central de Dados.
    if (relative.endsWith("modules/data-hub/domain/error-codes.ts")) {
      for (const match of text.matchAll(/^\s+(DATA_[A-Z0-9_]+):\s*"((?:\\.|[^"])*)"/gm)) {
        add(acc, match[1]!, module, `backend/${relative}`, null, match[2]!)
      }
    }
    // D — categorias dos provedores de IA (`AI_${category}`).
    if (relative.endsWith("shared/application/model-routing/ai-errors.ts")) {
      const list = /AI_ERROR_CATEGORIES\s*=\s*\[([^\]]+)\]/.exec(text)
      for (const category of list?.[1]?.match(/"([A-Z_]+)"/g) ?? []) {
        add(acc, `AI_${category.replaceAll('"', "")}`, module, `backend/${relative}`, null, null)
      }
    }
  }
  return [...acc.entries()]
    .map(([code, value]) => ({ code, module: [...value.modules.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0], statuses: [...value.statuses].sort((a, b) => a - b), messages: [...value.messages], refs: [...value.refs] }))
    .sort((a, b) => a.code.localeCompare(b.code))
}

/** Arquivo TypeScript gravado (determinístico). */
export function renderDomainCodesModule(codes: readonly InventoriedDomainCode[]): string {
  return [
    "// GERADO por `npm run errors:catalog` (backend/scripts/error-catalog.ts) — não edite à mão. O teste error-catalog.test.ts",
    "// recusa divergência entre este inventário e o código-fonte.",
    'import type { InventoriedDomainCode } from "./error-catalog-types.js"',
    "",
    `export const DOMAIN_ERROR_CODES: readonly InventoriedDomainCode[] = ${JSON.stringify(codes, null, 2)}`,
    "",
  ].join("\n")
}
