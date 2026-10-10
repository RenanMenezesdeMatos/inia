import { describe, expect, it } from "vitest"
import { buildApplicationPresentation, FEEDBACK_PRESENTATION_CUE, renderApplicationInstruction } from "./application-presentation.js"
import { buildPublishedFeedbackContext, type PublishedFeedbackRecord } from "./historical-context.js"
import { consultationOf, consultedDocumentsOf, FEEDBACK_SESSION_EXCLUDED_CAPABILITIES, renderConsultationRelation, renderSpecialistFrame } from "./session-consultation.js"

/**
 * Consultas dentro da sessão de feedback: o registro continua sendo a fonte de tudo o que é dito sobre o feedback; o que ele não
 * responde (processo, resultado atual) vem de um especialista, sempre com origem e período, sem reavaliar o feedback e sem nova
 * análise de chamada. A relação com o feedback em tela é calculada pelo sistema — nunca uma causa inventada pelo modelo.
 */
const NOW = new Date("2026-10-06T15:00:00.000Z")
const DOC_PRAZO = "11111111-1111-4111-8111-111111111111"
const DOC_OUTRO = "22222222-2222-4222-8222-222222222222"

const VIEW = {
  version: "FEEDBACK_VIEW_V1",
  heading: { title: "TMA", subtitle: "Agosto de 2026" },
  card: "TMA de 452 s, fora da meta de 400 s em agosto de 2026.",
  greeting: null,
  narrative: ["Em agosto de 2026, o resultado oficial de TMA foi de 452 s, fora da meta de 400 s."],
  developments: [],
  maintain: null,
  attention: [],
  materials: [{ documentId: DOC_PRAZO, title: "Procedimento — Contestação de contas", sections: ["35. Prazo da análise"], usedIn: ["Prazo da análise"], href: null, accessible: true }],
  context: null,
  kind: "INDICATOR",
  cycle: { title: "Resultado do período · agosto de 2026", indicators: [{ name: "TMA", lines: [{ label: "Resultado oficial", value: "452 s" }, { label: "Meta oficial", value: "400 s" }], notes: [] }] },
}

const record = (overrides: Partial<PublishedFeedbackRecord> = {}): PublishedFeedbackRecord => ({
  feedbackId: "f1", version: 1, kind: "INDICATOR", publishedAt: new Date("2026-09-10T13:00:00.000Z"),
  impactedIndicator: "TMA", evidenceFound: "", observedBehavior: "", relatedProcedure: "", recommendation: "texto", suggestedApproach: null,
  caseId: null, caseTitle: null, caseSummary: null, snapshot: { feedbackEngine: { feedbackView: VIEW } }, supportMaterials: [],
  ...overrides,
})

const context = buildPublishedFeedbackContext(record(), NOW)
const consultation = consultationOf("app-1", context, "America/Sao_Paulo")

describe("instrução da sessão com consultas", () => {
  const presentation = buildApplicationPresentation({ context, view: VIEW as never, addressName: "Larissa", now: NOW })

  it("libera consultar o que o registro não responde, com origem e período, sem reavaliar o feedback", () => {
    const instruction = renderApplicationInstruction({ context, presentation, now: NOW, consultation: true })
    expect(instruction).not.toContain("NÃO tem acesso aos resultados atuais")
    expect(instruction).toContain("CONSULTAS: quando a pergunta for algo que o registro não responde")
    expect(instruction).toContain("Nunca use ferramenta para o que o registro já responde")
    expect(instruction).toContain("nunca diga que melhorou, piorou ou se manteve comparando um com o outro")
    expect(instruction).toContain("nunca analisa chamadas de novo")
    expect(instruction).toContain("RELAÇÃO COM O FEEDBACK")
    // A abertura ao vivo continua só o texto aprovado — nunca uma consulta.
    expect(instruction).toContain(`9. ABERTURA: quando a mensagem for exatamente ${FEEDBACK_PRESENTATION_CUE}`)
    expect(instruction).toContain("sem acionar ferramenta")
    // O registro continua inteiro na instrução.
    expect(instruction).toContain("Resultado oficial = 452 s")
  })

  it("sem especialistas disponíveis, as regras de sempre (só o registro) ficam idênticas", () => {
    const recordOnly = renderApplicationInstruction({ context, presentation, now: NOW })
    expect(recordOnly).toContain("NÃO tem acesso aos resultados atuais")
    expect(recordOnly).not.toContain("CONSULTAS:")
    expect(recordOnly).toContain(`7. ABERTURA: quando a mensagem for exatamente ${FEEDBACK_PRESENTATION_CUE}`)
    expect(recordOnly).not.toContain("sem acionar ferramenta")
    expect(renderApplicationInstruction({ context, presentation, now: NOW, consultation: false })).toBe(recordOnly)
  })

  it("dúvidas depois da conclusão também consultam, sem reapresentar o feedback", () => {
    const followUp = renderApplicationInstruction({ context, presentation, now: NOW, consultation: true, followUp: { completedDay: "05/10/2026", originalTurns: [] } })
    expect(followUp).toContain("CONSULTAS:")
    expect(followUp).toContain("9. Esta é uma conversa COMPLEMENTAR")
    expect(followUp).not.toContain(FEEDBACK_PRESENTATION_CUE)
  })
})

describe("especialista consultado de dentro da sessão", () => {
  it("nenhuma nova análise de chamada: interações e transcrições ficam fora", () => {
    expect(FEEDBACK_SESSION_EXCLUDED_CAPABILITIES).toEqual(["INTERACTION_ANALYSIS"])
  })

  it("a moldura diz de onde veio a pergunta e o período a declarar — nunca leva o registro do feedback", () => {
    const frame = renderSpecialistFrame(consultation)
    expect(frame).toContain("sessão de feedback sobre “TMA” (período/atendimento avaliado: Agosto de 2026; publicado em 10/09/2026)")
    expect(frame).toContain("Não comente, não resuma e não reavalie o feedback")
    expect(frame).toContain("diga o período deles")
    expect(frame).not.toContain("452")
    expect(frame).not.toContain("Resultado oficial")
  })
})

describe("relação com o feedback em tela (calculada pelo sistema)", () => {
  it("documentos distintos dos trechos recuperados, com as seções na ordem (o título do documento não é seção)", () => {
    const documents = consultedDocumentsOf([
      { documentId: DOC_PRAZO, documentTitle: "Procedimento — Contestação de contas", heading: "Procedimento — Contestação de contas" },
      { documentId: DOC_PRAZO, documentTitle: "Procedimento — Contestação de contas", heading: "35. Prazo da análise" },
      { documentId: DOC_OUTRO, documentTitle: "Jeito Vivo de Atender", heading: "" },
      { documentId: DOC_PRAZO, documentTitle: "Procedimento — Contestação de contas", heading: "36. Retorno ao cliente" },
      { documentId: DOC_PRAZO, documentTitle: "Procedimento — Contestação de contas", heading: "35. Prazo da análise" },
    ])
    expect(documents).toEqual([
      { documentId: DOC_PRAZO, title: "Procedimento — Contestação de contas", sections: ["35. Prazo da análise", "36. Retorno ao cliente"] },
      { documentId: DOC_OUTRO, title: "Jeito Vivo de Atender", sections: [] },
    ])
  })

  it("mesmo documento do feedback (por id), documento sem relação e versão nova depois do feedback", () => {
    const relation = renderConsultationRelation(consultation, {
      documents: [
        { documentId: DOC_PRAZO, title: "Procedimento — Contestação de contas", sections: ["35. Prazo da análise"], updatedAfterFeedback: true },
        { documentId: DOC_OUTRO, title: "Jeito Vivo de Atender", sections: [], updatedAfterFeedback: false },
      ],
      indicatorWindowDays: 7,
    })
    expect(relation).toContain("Feedback em tela: “TMA” — Agosto de 2026 — publicado em 10/09/2026.")
    expect(relation).toContain("“Procedimento — Contestação de contas” (seções: 35. Prazo da análise): é o MESMO documento usado neste feedback. Este documento ganhou versão nova depois deste feedback")
    expect(relation).toContain("“Jeito Vivo de Atender”: não foi usado neste feedback.")
    expect(relation).not.toMatch(/Jeito Vivo de Atender”: não foi usado neste feedback\. Este documento ganhou/)
  })

  it("números atuais × números do feedback: cada um com o seu período, nunca evolução", () => {
    const relation = renderConsultationRelation(consultation, { documents: [], indicatorWindowDays: 30 })
    expect(relation).toContain("são dos últimos 30 dias até agora, pela medição diária. Os números do feedback são de Agosto de 2026 (fechamento oficial daquele período).")
    expect(relation).toContain("nunca \"melhorou\" ou \"piorou\" de um para o outro")
    expect(relation).toContain("Indicadores do feedback: TMA.")
    expect(renderConsultationRelation(consultation, { documents: [], indicatorWindowDays: 1 })).toContain("são do último dia até agora")
  })

  it("feedback de atendimento: números atuais nunca se ligam aos pontos dele, sem indicadores listados", () => {
    const monitoring = consultationOf("app-2", buildPublishedFeedbackContext(record({ kind: "MONITORING", snapshot: {} }), NOW), "America/Sao_Paulo")
    const relation = renderConsultationRelation(monitoring, { documents: [], indicatorWindowDays: 7 })
    expect(relation).toContain("Este feedback avaliou um atendimento")
    expect(relation).toContain("não ligue esses números aos pontos do feedback")
    expect(relation).not.toContain("Indicadores do feedback")
  })
})
