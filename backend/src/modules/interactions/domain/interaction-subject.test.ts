import { describe, expect, it } from "vitest"
import { canonicalSubjectSql, isInteractionSubjectCode, normalizeRawSubject, subjectFilterSql } from "./interaction-subject.js"

describe("assunto de interação — bruto × canônico (domínio puro)", () => {
  it("normaliza só caixa e espaços do bruto; o código canônico tem formato fechado", () => {
    expect(normalizeRawSubject("  Segunda via de Fatura ")).toBe("segunda via de fatura")
    expect(isInteractionSubjectCode("segunda_via")).toBe(true)
    expect(isInteractionSubjectCode("Segunda via")).toBe(false)
    expect(isInteractionSubjectCode("2via")).toBe(false)
  })

  it("filtro por assunto: canônico quando resolvido (todas as interações com alias para o código), senão igualdade exata do bruto — nunca aproximação", () => {
    const canonical = subjectFilterSql({ requested: "Segunda via de fatura", canonical: { code: "segunda_via", name: "Segunda via" }, mode: "CANONICAL" }, 3)
    expect(canonical.param).toBe("segunda_via")
    expect(canonical.clause).toContain(canonicalSubjectSql("i"))
    expect(canonical.clause).toContain("= $3")
    const raw = subjectFilterSql({ requested: "Linha sem sinal", canonical: null, mode: "RAW_EXACT" }, 3)
    expect(raw).toEqual({ clause: " and i.reason = $3", param: "Linha sem sinal" })
    expect(canonicalSubjectSql("x")).toContain("x.reason")
    expect(canonicalSubjectSql("x")).toContain("d.active")
  })
})
