import { describe, expect, it } from "vitest"
import { CLASSIFICATION_REASON_LABELS, CLASSIFICATION_REASONS, CLASSIFICATION_REASONS_V1 } from "./catalogs.js"
import { classificationInputSchema } from "./classification.js"

const parse = (body: Record<string, unknown>) => classificationInputSchema.safeParse(body)

describe("classificação do atendimento", () => {
  it("título obrigatório quando a informação existia; opcional em pergunta mal formulada; descartado nos demais", () => {
    expect(parse({ reason: "FOUND_IN_PROCESS", outcome: "RESOLVED" }).success).toBe(false)
    expect(parse({ reason: "AVAILABLE_ELSEWHERE", referenceTitle: "ab", outcome: "RESOLVED" }).success).toBe(false)
    expect(parse({ reason: "FOUND_IN_PROCESS", referenceTitle: "  Cancelamento PJ  ", outcome: "GUIDED" }).data).toEqual({ reason: "FOUND_IN_PROCESS", referenceTitle: "Cancelamento PJ", referenceUrl: null, otherDescription: null, outcome: "GUIDED" })
    expect(parse({ reason: "QUESTION_UNCLEAR", referenceTitle: "Portabilidade", outcome: "RESOLVED" }).data!.referenceTitle).toBe("Portabilidade")
    expect(parse({ reason: "NO_PROCESS", referenceTitle: "Ignorado", outcome: "NOT_RESOLVED" }).data!.referenceTitle).toBeNull()
  })

  it("descrição obrigatória em Outro; link só http(s) até 500; resultado obrigatório; campo a mais recusado", () => {
    expect(parse({ reason: "OTHER", outcome: "FORWARDED" }).success).toBe(false)
    expect(parse({ reason: "OTHER", otherDescription: "Caso novo", outcome: "FORWARDED" }).success).toBe(true)
    expect(parse({ reason: "NO_GUIDANCE", referenceUrl: "javascript:alert(1)", outcome: "RESOLVED" }).success).toBe(false)
    expect(parse({ reason: "NO_GUIDANCE", referenceUrl: `https://x.com/${"a".repeat(500)}`, outcome: "RESOLVED" }).success).toBe(false)
    expect(parse({ reason: "NO_GUIDANCE", referenceUrl: "https://intranet.vivo/processo", outcome: "RESOLVED" }).data!.referenceUrl).toBe("https://intranet.vivo/processo")
    expect(parse({ reason: "NO_GUIDANCE" }).success).toBe(false)
    expect(parse({ reason: "NO_GUIDANCE", outcome: "RESOLVED", extra: 1 }).success).toBe(false)
  })

  it("impedimentos operacionais (V2): sem acesso e ferramenta indisponível são motivos separados, com ferramenta e detalhes opcionais", () => {
    expect(CLASSIFICATION_REASONS).toEqual(expect.arrayContaining([...CLASSIFICATION_REASONS_V1, "NO_TOOL_ACCESS", "TOOL_UNAVAILABLE"]))
    expect(CLASSIFICATION_REASON_LABELS.NO_TOOL_ACCESS).toBe("Sem acesso à ferramenta ou ao sistema")
    expect(CLASSIFICATION_REASON_LABELS.TOOL_UNAVAILABLE).toBe("Ferramenta ou sistema indisponível")
    expect(parse({ reason: "NO_TOOL_ACCESS", outcome: "GUIDED" }).data).toEqual({ reason: "NO_TOOL_ACCESS", referenceTitle: null, referenceUrl: null, otherDescription: null, outcome: "GUIDED" })
    expect(parse({ reason: "TOOL_UNAVAILABLE", referenceTitle: "  Siebel  ", otherDescription: " Tela de pedidos com erro 500 desde 9h ", outcome: "FORWARDED" }).data).toEqual({
      reason: "TOOL_UNAVAILABLE",
      referenceTitle: "Siebel",
      referenceUrl: null,
      otherDescription: "Tela de pedidos com erro 500 desde 9h",
      outcome: "FORWARDED",
    })
    expect(parse({ reason: "NO_TOOL_ACCESS", referenceTitle: "ab", outcome: "RESOLVED" }).success).toBe(false)
    // O resultado continua obrigatório e independente: o motivo nunca vira "resolvido" sozinho.
    expect(parse({ reason: "NO_TOOL_ACCESS", referenceTitle: "Siebel" }).success).toBe(false)
    // Detalhes só nos motivos que os pedem: nos demais, descartados (como o título).
    expect(parse({ reason: "NO_PROCESS", otherDescription: "Ignorada", outcome: "NOT_RESOLVED" }).data!.otherDescription).toBeNull()
  })
})
