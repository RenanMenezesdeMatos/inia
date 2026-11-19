import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

/**
 * ARQ-06 — nenhum ciclo de import entre a decisão de relevância das publicações e o bloco da estrutura de quem lidera. O ciclo
 * (`conversation-publications` → `leader-structure-context` → `communication-conversation-loader` → `conversation-publications`) era
 * contornado com `import()` adiado, que o esconde do verificador e do leitor.
 */
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8")
const importsOf = (name: string) => [...source(name).matchAll(/from "(\.\/[^"]+)"/g)].map((match) => match[1])

describe("resolução dos alinhamentos da estrutura (ARQ-06)", () => {
  it("a decisão de relevância não usa import adiado e não importa o bloco da estrutura", () => {
    expect(source("conversation-publications.ts")).not.toMatch(/\bimport\(\s*["'`]/)
    expect(importsOf("conversation-publications.ts")).not.toContain("./leader-structure-context.js")
    expect(importsOf("conversation-publications.ts")).toContain("./structure-alignment-resolution.js")
  })

  it("o arquivo compartilhado não depende de volta de nenhum arquivo do ciclo", () => {
    const imports = importsOf("structure-alignment-resolution.ts")
    for (const cyclic of ["./leader-structure-context.js", "./conversation-publications.js", "./communication-conversation-loader.js"]) expect(imports).not.toContain(cyclic)
  })

  it("o bloco da estrutura continua expondo as duas funções (mesma API para quem já importava dele)", async () => {
    const [shared, block] = await Promise.all([import("./structure-alignment-resolution.js"), import("./leader-structure-context.js")])
    expect(block.resolveAlignmentsForStructure).toBe(shared.resolveAlignmentsForStructure)
    expect(block.loadStructureSubjects).toBe(shared.loadStructureSubjects)
  })
})
