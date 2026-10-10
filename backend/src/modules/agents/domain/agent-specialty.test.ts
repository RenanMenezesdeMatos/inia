import { describe, expect, it } from "vitest"
import { describeSpecialty, describeSpecialtyProblem, legacySpecialtyFor, resolveAgentSpecialty } from "./agent-specialty.js"

// Fixtures de domínio: códigos são DADOS do catálogo (business_domains) — a regra é a mesma para
// qualquer código, inclusive um que não existia quando este arquivo foi escrito.
const faturamento = { id: "11111111-1111-4111-8111-111111111111", code: "FATURAMENTO", name: "Faturamento", active: true }
const logistica = { id: "22222222-2222-4222-8222-222222222222", code: "LOGISTICA", name: "Logística e Entregas", active: true }

describe("agent-specialty — dual-read (novo primeiro, legado como fallback) e dual-write", () => {
  it("lê a forma nova: DOMAIN com domínio do catálogo (FK + join), CROSS_CUTTING com competência, PERFORMANCE, SYNTHESIS (sempre aceita consolidado)", () => {
    expect(resolveAgentSpecialty({ specialty_kind: "DOMAIN", business_domain_id: faturamento.id, business_domain_code: "FATURAMENTO", business_domain_name: "Faturamento", business_domain_active: true, domain: "FATURAMENTO", specialty: "RETENCAO" })).toEqual({ kind: "DOMAIN", domain: faturamento, capability: null, acceptsConsolidated: false })
    // Domínio criado pelo catálogo, sem nenhuma alteração no código-fonte.
    expect(resolveAgentSpecialty({ specialty_kind: "DOMAIN", business_domain_id: logistica.id, business_domain_code: "LOGISTICA", business_domain_name: "Logística e Entregas", business_domain_active: true, domain: "LOGISTICA" })).toEqual({ kind: "DOMAIN", domain: logistica, capability: null, acceptsConsolidated: false })
    expect(resolveAgentSpecialty({ specialty_kind: "CROSS_CUTTING", capability: "Qualidade" })).toMatchObject({ kind: "CROSS_CUTTING", capability: "Qualidade" })
    expect(resolveAgentSpecialty({ specialty_kind: "PERFORMANCE", consolidated_input: false })).toMatchObject({ kind: "PERFORMANCE", acceptsConsolidated: false })
    expect(resolveAgentSpecialty({ specialty_kind: "SYNTHESIS", consolidated_input: false })).toMatchObject({ kind: "SYNTHESIS", acceptsConsolidated: true })
  })

  it("dual-read sem a FK: `domain` (código legado) vira referência sem id, com o nome = código; o catálogo prevalece sobre a coluna legada quando os dois existem", () => {
    expect(resolveAgentSpecialty({ specialty_kind: "DOMAIN", domain: "FATURAMENTO" })).toEqual({ kind: "DOMAIN", domain: { id: null, code: "FATURAMENTO", name: "FATURAMENTO", active: true }, capability: null, acceptsConsolidated: false })
    expect(resolveAgentSpecialty({ specialty_kind: "DOMAIN", domain: "RETENCAO", business_domain_id: logistica.id, business_domain_code: "LOGISTICA", business_domain_name: "Logística e Entregas" }).domain?.code).toBe("LOGISTICA")
    // Domínio desativado continua resolvendo (referência existente sobrevive à desativação).
    expect(resolveAgentSpecialty({ specialty_kind: "DOMAIN", business_domain_id: logistica.id, business_domain_code: "LOGISTICA", business_domain_name: "Logística e Entregas", business_domain_active: false }).domain).toEqual({ ...logistica, active: false })
  })

  it("lê o legado quando não há forma nova: código de domínio → DOMAIN; CROSS_CUTTING; PERFORMANCE; null → sem especialidade", () => {
    expect(resolveAgentSpecialty({ specialty: "FATURAMENTO" })).toEqual({ kind: "DOMAIN", domain: { id: null, code: "FATURAMENTO", name: "FATURAMENTO", active: true }, capability: null, acceptsConsolidated: false })
    expect(resolveAgentSpecialty({ specialty: "CROSS_CUTTING" })).toMatchObject({ kind: "CROSS_CUTTING" })
    expect(resolveAgentSpecialty({ specialty: "PERFORMANCE" })).toMatchObject({ kind: "PERFORMANCE" })
    expect(resolveAgentSpecialty({ specialty: null, specialty_kind: null })).toEqual({ kind: null, domain: null, capability: null, acceptsConsolidated: false })
    // Qualquer código válido do catálogo é um domínio — não existe lista fechada no código.
    expect(resolveAgentSpecialty({ specialty: "QUALQUER" })).toMatchObject({ kind: "DOMAIN", domain: { code: "QUALQUER" } })
    expect(resolveAgentSpecialty({ specialty: "não-é-código" })).toMatchObject({ kind: null })
  })

  it("dual-write: o valor legado equivalente continua sendo escrito (código do domínio); coerência da especialidade", () => {
    expect(legacySpecialtyFor({ kind: "DOMAIN", domain: logistica })).toBe("LOGISTICA")
    expect(legacySpecialtyFor({ kind: "DOMAIN", domain: null })).toBeNull()
    expect(legacySpecialtyFor({ kind: "CROSS_CUTTING", domain: null })).toBe("CROSS_CUTTING")
    expect(legacySpecialtyFor({ kind: "SYNTHESIS", domain: null })).toBe("SYNTHESIS")
    expect(legacySpecialtyFor({ kind: null, domain: null })).toBeNull()
    expect(describeSpecialtyProblem({ kind: "DOMAIN", domain: null, capability: null, acceptsConsolidated: false })).toContain("domínio")
    expect(describeSpecialtyProblem({ kind: "PERFORMANCE", domain: faturamento, capability: null, acceptsConsolidated: false })).toContain("Só um especialista de domínio")
    expect(describeSpecialtyProblem({ kind: "SYNTHESIS", domain: null, capability: null, acceptsConsolidated: false })).toContain("consolidado")
    expect(describeSpecialtyProblem({ kind: "SYNTHESIS", domain: null, capability: null, acceptsConsolidated: true })).toBeNull()
  })

  it("apresentação usa o NOME do catálogo e marca domínio desativado", () => {
    expect(describeSpecialty({ kind: "DOMAIN", domain: logistica, capability: null, acceptsConsolidated: false })).toBe("Logística e Entregas")
    expect(describeSpecialty({ kind: "DOMAIN", domain: { ...logistica, active: false }, capability: null, acceptsConsolidated: false })).toBe("Logística e Entregas (desativado)")
    expect(describeSpecialty({ kind: "CROSS_CUTTING", domain: null, capability: "Qualidade", acceptsConsolidated: false })).toBe("Transversal · Qualidade")
  })
})
