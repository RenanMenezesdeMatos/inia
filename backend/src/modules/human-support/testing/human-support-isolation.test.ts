import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ISOLAMENTO DA IA — testes de estrutura do servidor (design_draft.md seção 10): a conversa humana operador ↔ Anjo nunca chega a um
 * caminho de modelo. Só o próprio módulo e o ciclo de vida dos dados citam as tabelas `human_support_*`; o módulo não importa
 * orquestração, roteamento de modelo, cliente de modelo, voz nem a Monitoria de usabilidade; e o `assistant` não sabe que o apoio existe.
 */
const SRC = join(__dirname, "..", "..", "..")
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : filesUnder(path)
    return path.endsWith(".ts") ? [path] : []
  })
}
const all = filesUnder(SRC).map((path) => ({ path: relative(SRC, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }))
const productionCode = all.filter((file) => !file.path.endsWith(".test.ts"))

describe("isolamento do Apoio com Anjo (servidor)", () => {
  it("só human-support/** e data-lifecycle/** citam as tabelas human_support_*", () => {
    const outside = productionCode.filter((file) => /human_support_[a-z]/.test(file.text) && !file.path.startsWith("modules/human-support/") && !file.path.startsWith("modules/data-lifecycle/"))
    expect(outside.map((file) => file.path)).toEqual([])
  })

  it("human-support não importa orquestração, roteamento ou cliente de modelo, voz, nem a Monitoria de usabilidade", () => {
    const forbidden = [/assistant\/application\/run-orchestrated-reply/, /shared\/application\/model-routing\//, /realtime\/infrastructure\//, /llm-gateway|gemini|openai|anthropic|ollama/i, /usage-analytics\//, /knowledge-clarification\/application\//]
    const offenders = all
      .filter((file) => file.path.startsWith("modules/human-support/"))
      .flatMap((file) => [...file.text.matchAll(/from\s+"([^"]+)"/g)].map((match) => ({ file: file.path, spec: match[1]! })))
      .filter((entry) => forbidden.some((pattern) => pattern.test(entry.spec)))
    expect(offenders).toEqual([])
  })

  it("nenhum arquivo do assistant cita human_support_* nem importa human-support", () => {
    const offenders = all.filter((file) => file.path.startsWith("modules/assistant/") && (/human_support_[a-z]/.test(file.text) || /human-support\//.test(file.text)))
    expect(offenders.map((file) => file.path)).toEqual([])
  })

  it("o módulo só lê de fora o que a especificação lista (cópia da troca, funil, quem tem o papel, nomes, LGPD)", () => {
    const allowedOutside = [
      /^\.\.\/\.\.\/assistant\/application\/support-context\.js$/,
      /^\.\.\/\.\.\/assistant\/application\/reply-funnel\.js$/,
      /^\.\.\/\.\.\/assistant\/domain\/assistant-interaction-rating\.js$/,
      /^\.\.\/\.\.\/access\/application\/permission-holders\.js$/,
      /^\.\.\/\.\.\/access\/domain\/access-scope\.js$/,
      /^\.\.\/\.\.\/profile-preferences\/application\/person-presentation-loader\.js$/,
      /^\.\.\/\.\.\/data-lifecycle\/application\/(personal-data-access-log|subject-data-export)\.js$/,
      /^\.\.\/\.\.\/\.\.\/(shared|infrastructure|config)\//,
    ]
    const imports = all
      .filter((file) => file.path.startsWith("modules/human-support/") && !file.path.endsWith(".test.ts"))
      .flatMap((file) => [...file.text.matchAll(/from\s+"(\.\.\/\.\.\/[^"]+)"/g)].map((match) => ({ file: file.path, spec: match[1]! })))
      .filter((entry) => !allowedOutside.some((pattern) => pattern.test(entry.spec)))
    expect(imports).toEqual([])
  })
})
