import { describe, expect, it } from "vitest"
import {
  businessDomainCodeSchema,
  businessDomainInputSchema,
  describeBusinessDomain,
  domainRefFromCode,
  domainRefsFromCodes,
  normalizeBusinessDomainCode,
  resolveDomainRef,
  resolveDomainRefs,
} from "./business-domain.js"

describe("business-domain — código: normalização, formato e unicidade por organização (a unicidade é do banco)", () => {
  it("normaliza como o catálogo de indicadores: maiúsculas, sem acento, separadores viram _", () => {
    expect(normalizeBusinessDomainCode("Logística e Entregas")).toBe("LOGISTICA_E_ENTREGAS")
    expect(normalizeBusinessDomainCode("  cobrança ")).toBe("COBRANCA")
    expect(normalizeBusinessDomainCode("back-office/2")).toBe("BACK_OFFICE_2")
    expect(businessDomainCodeSchema.parse("logística reversa")).toBe("LOGISTICA_REVERSA")
  })

  it("recusa formato inválido (começar por dígito, 1 caractere, mais de 40) e aceita qualquer código válido — não existe lista fechada", () => {
    expect(businessDomainCodeSchema.safeParse("1abc").success).toBe(false)
    expect(businessDomainCodeSchema.safeParse("A").success).toBe(false)
    expect(businessDomainCodeSchema.safeParse("A".repeat(41)).success).toBe(false)
    expect(businessDomainCodeSchema.safeParse("").success).toBe(false)
    for (const code of ["FATURAMENTO", "LOGISTICA", "BACKOFFICE", "PORTABILIDADE_2"]) expect(businessDomainCodeSchema.parse(code)).toBe(code)
  })

  it("entrada completa: nome obrigatório (2..120), descrição opcional vira null quando vazia, ativo por padrão", () => {
    expect(businessDomainInputSchema.parse({ code: "logistica", name: "Logística", description: "" })).toEqual({ code: "LOGISTICA", name: "Logística", description: null, active: true })
    expect(businessDomainInputSchema.safeParse({ code: "LOGISTICA", name: "L" }).success).toBe(false)
    expect(businessDomainInputSchema.parse({ code: "LOGISTICA", name: "Logística", active: false }).active).toBe(false)
  })
})

describe("business-domain — dual-read das referências (FK/relação nova primeiro; código legado como fallback)", () => {
  const catalog = { id: "11111111-1111-4111-8111-111111111111", code: "LOGISTICA", name: "Logística e Entregas", active: true }

  it("Agent: a FK + join do catálogo dá id/código/nome; sem FK, o código legado vira referência sem id com nome = código; código inválido → null", () => {
    expect(resolveDomainRef({ business_domain_id: catalog.id, business_domain_code: catalog.code, business_domain_name: catalog.name, business_domain_active: true, domain: "OUTRO" })).toEqual(catalog)
    expect(resolveDomainRef({ business_domain_id: catalog.id, domain: "LOGISTICA" })).toEqual({ id: catalog.id, code: "LOGISTICA", name: "LOGISTICA", active: true })
    expect(resolveDomainRef({ domain: "LOGISTICA" })).toEqual(domainRefFromCode("LOGISTICA"))
    expect(resolveDomainRef({ domain: "não-é-código" })).toBeNull()
    expect(resolveDomainRef({})).toBeNull()
  })

  it("Orquestrador: a relação nova prevalece e o legado só completa códigos que faltam; json fora do formato é ignorado", () => {
    expect(resolveDomainRefs({ routing_domains: ["FATURAMENTO", "RETENCAO"] })).toEqual([domainRefFromCode("FATURAMENTO"), domainRefFromCode("RETENCAO")])
    expect(resolveDomainRefs({ business_domains: [catalog], routing_domains: ["LOGISTICA", "FATURAMENTO"] })).toEqual([catalog, domainRefFromCode("FATURAMENTO")])
    expect(resolveDomainRefs({ business_domains: [{ id: "x" }, catalog] })).toEqual([catalog])
    expect(resolveDomainRefs({ policy_domains: ["SUPORTE"] }, "policy_domains")).toEqual([domainRefFromCode("SUPORTE")])
    expect(domainRefsFromCodes(["OK", "não", 3])).toEqual([domainRefFromCode("OK")])
  })

  it("apresentação: nome do catálogo, com '(desativado)' quando inativo", () => {
    expect(describeBusinessDomain(catalog)).toBe("Logística e Entregas")
    expect(describeBusinessDomain({ ...catalog, active: false })).toBe("Logística e Entregas (desativado)")
  })
})
