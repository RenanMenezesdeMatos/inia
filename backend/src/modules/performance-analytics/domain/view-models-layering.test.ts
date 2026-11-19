import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * ARQ-09 — `domain/` guarda regras e contratos puros: os view models do analytics não importam a camada de aplicação do módulo
 * de intervenções (arquivo com SQL) para citar o tipo do resumo; o contrato vive no domínio de quem é dono dele.
 */
describe("view models do analytics — camadas (ARQ-09)", () => {
  it("o resumo da intervenção vem do domínio de intervenções, nunca de `interventions/application`", () => {
    const source = readFileSync(fileURLToPath(new URL("./view-models.ts", import.meta.url)), "utf8")
    expect(source).not.toMatch(/from "\.\.\/\.\.\/interventions\/application\//)
    expect(source).toContain('from "../../interventions/domain/leader-brief.js"')
  })
})
