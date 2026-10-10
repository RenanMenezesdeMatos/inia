import { describe, expect, it } from "vitest"
import { verifyProcessAudit } from "./process-audit.js"

const TRANSCRIPT = [
  "Operador: Bom dia, para começar preciso confirmar o CPF do titular.",
  "Cliente: É 123.",
  "Operador: Obrigado. Vi aqui a cobrança de roaming que o senhor questiona.",
  "Cliente: Isso, eu não usei.",
  "Operador: Vou registrar o protocolo da contestação, o prazo de análise é de cinco dias úteis.",
].join("\n")

describe("verifyProcessAudit — regras aplicadas por código", () => {
  it("etapa sem evidência suficiente fica NAO_FOI_POSSIVEL_CONFIRMAR, nunca vira NAO_CONFORME", () => {
    const verified = verifyProcessAudit(
      {
        procedureTitle: "Procedimento Operacional — Contestação de Contas Móvel",
        steps: [
          { step: "Validar o titular", status: "CONFORME", evidence: "preciso confirmar o CPF do titular", knowledgeReference: "Seção 3", note: null },
          { step: "Identificar a cobrança contestada", status: "CONFORME", evidence: "Vi aqui a cobrança de roaming que o senhor questiona", knowledgeReference: "Seção 3", note: null },
          { step: "Explicar a composição da conta", status: "NAO_FOI_POSSIVEL_CONFIRMAR", evidence: null, knowledgeReference: "Seção 3", note: "Não há trecho sobre isso." },
          { step: "Registrar protocolo e informar prazo", status: "CONFORME", evidence: "Vou registrar o protocolo da contestação", knowledgeReference: "Seção 3", note: null },
        ],
      },
      TRANSCRIPT,
    )
    expect(verified.steps.map((step) => step.status)).toEqual(["CONFORME", "CONFORME", "NAO_FOI_POSSIVEL_CONFIRMAR", "CONFORME"])
    expect(verified.downgradedCount).toBe(0)
    expect(verified.summary).toEqual({ CONFORME: 3, NAO_CONFORME: 0, NAO_FOI_POSSIVEL_CONFIRMAR: 1, NAO_APLICAVEL: 0 })
  })

  it("CONFORME/NAO_CONFORME com evidência parafraseada (não literal) é rebaixado e a evidência descartada", () => {
    const verified = verifyProcessAudit(
      {
        procedureTitle: "Procedimento",
        steps: [
          { step: "Validar o titular", status: "CONFORME", evidence: "o operador pediu o CPF do cliente", knowledgeReference: null, note: null },
          { step: "Oferecer parcelamento", status: "NAO_CONFORME", evidence: "o operador não ofereceu parcelamento", knowledgeReference: null, note: null },
        ],
      },
      TRANSCRIPT,
    )
    expect(verified.steps[0]).toMatchObject({ status: "NAO_FOI_POSSIVEL_CONFIRMAR", evidence: null, downgraded: true })
    expect(verified.steps[1]).toMatchObject({ status: "NAO_FOI_POSSIVEL_CONFIRMAR", evidence: null, downgraded: true })
    expect(verified.downgradedCount).toBe(2)
  })

  it("comparação literal tolera diferenças de espaçamento/quebra de linha", () => {
    const verified = verifyProcessAudit(
      { procedureTitle: "P", steps: [{ step: "Validar", status: "CONFORME", evidence: "preciso   confirmar o CPF\ndo titular", knowledgeReference: null, note: null }] },
      TRANSCRIPT,
    )
    expect(verified.steps[0]!.status).toBe("CONFORME")
    expect(verified.steps[0]!.downgraded).toBe(false)
  })

  it("NAO_APLICAVEL não exige evidência", () => {
    const verified = verifyProcessAudit(
      { procedureTitle: "P", steps: [{ step: "Roaming internacional", status: "NAO_APLICAVEL", evidence: null, knowledgeReference: null, note: "Cliente não viajou." }] },
      TRANSCRIPT,
    )
    expect(verified.steps[0]).toMatchObject({ status: "NAO_APLICAVEL", downgraded: false })
  })
})
