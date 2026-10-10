import { describe, expect, it } from "vitest"

import { DOMAIN_ORCHESTRATORS, WORKFLOW_TEMPLATES } from "./ai-catalog-data"

/**
 * Anti-acoplamento (rodada de hardening 2026-09-16, Parte B): o catálogo CONCEITUAL da Wiki
 * descreve requisitos organizacionais ("um Grupo do domínio Retenção", "um(a) Diretor(a)"), nunca
 * a instância demo (UUID `de00…`, "B2C · Retenção", "João Lacerda"). A instância demo tem ids —
 * o template oficial não.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const DEMO_NAMES = ["João Lacerda", "Daniela Duarte Rocha", "Sueli Medeiros", "Patrícia Castro Reis", "Thaís Borges Pereira", "André Marques Vasconcelos"]

describe("Wiki — templates oficiais não dependem da massa demo", () => {
  it("nenhum template expõe UUID, prefixo demo, Grupo B2B/B2C da demo nem pessoa da demo", () => {
    const serialized = JSON.stringify(WORKFLOW_TEMPLATES)
    expect(serialized).not.toMatch(UUID)
    expect(serialized).not.toContain("de00")
    expect(serialized).not.toMatch(/B2[BC] ·/)
    for (const name of DEMO_NAMES) expect(serialized, name).not.toContain(name)
  })

  it("a Estrutura de cada template é o requisito conceitual: genérico, pessoa-âncora por cargo ou Grupo de um domínio, com a instrução de instalação", () => {
    const byNumber = new Map(WORKFLOW_TEMPLATES.map((template) => [template.number, template]))
    expect(byNumber.get(1)!.structure).toMatch(/^Genérico — Todos os grupos/)
    expect(byNumber.get(4)!.structure).toContain("Diretor(a)")
    expect(byNumber.get(16)!.structure).toContain("Supervisor(a)")
    expect(byNumber.get(20)!.structure).toContain("Gerente")
    expect(byNumber.get(17)!.structure).toContain("Grupo do domínio Retenção e Cancelamento")
    expect(byNumber.get(17)!.structure).toContain("escolha o Grupo correspondente da sua organização")
    expect(byNumber.get(18)!.structure).toContain("um Grupo por domínio")
    for (const template of WORKFLOW_TEMPLATES) expect(template.structure.length, template.name).toBeGreaterThan(40)
  })

  it("os quatro papéis de Orquestrador estão documentados com fronteira explícita", () => {
    const kinds = new Set(DOMAIN_ORCHESTRATORS.map((orchestrator) => orchestrator.kind))
    expect([...kinds].sort()).toEqual(["DOMAIN", "MANAGERIAL", "MULTIDOMAIN", "TRANSVERSAL"])
    const faturamento = DOMAIN_ORCHESTRATORS.find((orchestrator) => orchestrator.id === "orq-faturamento")!
    expect(faturamento.specialists).toEqual(["Especialista de Faturamento", "Especialista de Experiência do Cliente"])
    expect(faturamento.specialists).not.toContain("Especialista de Retenção e Cancelamento")
  })
})
