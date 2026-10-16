import { describe, expect, it } from "vitest"
import { canonicalReasonSql, canonicalSubjectSql, isInteractionSubjectCode, levelKeySql, normalizeRawSubject, rawSubjectOf, rawSubjectSql, reasonKeySql, subjectFilterSql, subjectKeySql, SUBJECT_RESOLUTION_VERSION } from "./interaction-subject.js"

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
    expect(raw).toEqual({ clause: ` and ${rawSubjectSql("i")} = $3`, param: "Linha sem sinal" })
    expect(canonicalSubjectSql("x")).toContain("x.reason")
    expect(canonicalSubjectSql("x")).toContain("d.active")
  })
})

describe("SUBJECT_RESOLUTION_V2 — submotivo preferencial, motivo como segundo nível", () => {
  it("assunto bruto preferencial: o submotivo quando a fonte informou; vazio ou ausente = o motivo", () => {
    expect(SUBJECT_RESOLUTION_VERSION).toBe("SUBJECT_RESOLUTION_V2")
    expect(rawSubjectOf({ reason: "Fatura", subReason: "Segunda via de fatura" })).toBe("Segunda via de fatura")
    expect(rawSubjectOf({ reason: "Fatura", subReason: "   " })).toBe("Fatura")
    expect(rawSubjectOf({ reason: "Contestação de cobrança", subReason: null })).toBe("Contestação de cobrança")
    expect(rawSubjectOf({ reason: "Contestação de cobrança" })).toBe("Contestação de cobrança")
    expect(rawSubjectSql("i")).toBe("coalesce(nullif(btrim(i.sub_reason), ''), i.reason)")
  })

  it("canônico do assunto: par (motivo + submotivo) antes do texto do submotivo; sem submotivo, o texto do motivo — nunca o canônico do motivo para um submotivo sem alias", () => {
    const sql = canonicalSubjectSql("i")
    const pair = sql.indexOf("a.raw_reason is not null")
    const subText = sql.indexOf("a.raw_reason is null and lower(btrim(a.raw_subject)) = lower(btrim(i.sub_reason))")
    const reasonText = sql.indexOf("a.raw_reason is null and lower(btrim(a.raw_subject)) = lower(btrim(i.reason))")
    expect(sql.startsWith("(case when nullif(btrim(i.sub_reason), '') is not null then coalesce(")).toBe(true)
    expect(pair).toBeGreaterThan(-1)
    expect(subText).toBeGreaterThan(pair)
    expect(reasonText).toBeGreaterThan(subText)
    expect(sql.slice(sql.indexOf(" else "))).toContain("lower(btrim(i.reason))")
    expect(sql.slice(0, sql.indexOf(" else "))).not.toContain("lower(btrim(a.raw_subject)) = lower(btrim(i.reason))")
  })

  it("canônico do motivo: só o alias do texto do motivo (um alias de par nunca vale para o motivo sozinho)", () => {
    const sql = canonicalReasonSql("i")
    expect(sql).toContain("a.raw_reason is null and lower(btrim(a.raw_subject)) = lower(btrim(i.reason))")
    expect(sql).not.toContain("sub_reason")
  })

  it("chaves de recorte: assunto = canônico do assunto ou bruto preferencial; motivo = canônico do motivo ou motivo bruto", () => {
    expect(subjectKeySql("i")).toBe(`coalesce(${canonicalSubjectSql("i")}, nullif(btrim(${rawSubjectSql("i")}), ''))`)
    expect(reasonKeySql("i")).toBe(`coalesce(${canonicalReasonSql("i")}, nullif(btrim(i.reason), ''))`)
    expect(levelKeySql("SUBJECT", "i")).toBe(subjectKeySql("i"))
    expect(levelKeySql("REASON", "i")).toBe(reasonKeySql("i"))
  })

  it("filtro no nível MOTIVO: canônico do motivo ou igualdade exata do motivo bruto", () => {
    expect(subjectFilterSql({ requested: "Fatura", canonical: { code: "fatura", name: "Fatura" }, mode: "CANONICAL" }, 5, "i", "REASON")).toEqual({ clause: ` and ${canonicalReasonSql("i")} = $5`, param: "fatura" })
    expect(subjectFilterSql({ requested: "Cobrança", canonical: null, mode: "RAW_EXACT" }, 5, "i", "REASON")).toEqual({ clause: " and i.reason = $5", param: "Cobrança" })
  })
})
