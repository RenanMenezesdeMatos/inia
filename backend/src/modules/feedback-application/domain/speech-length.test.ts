import { describe, expect, it } from "vitest"
import { buildPublishedFeedbackContext, type PublishedFeedbackRecord } from "./historical-context.js"
import { buildApplicationPresentation } from "./application-presentation.js"

/**
 * Titularidade (06/10/2026): a narrativa tinha 214 palavras e a fala parava em 150 — a recapitulação, o contato anterior e os acertos
 * nunca foram ditos pelo avatar. O feedback é falado inteiro; o teto (~3 min) só protege de um texto fora do normal.
 */
const NOW = new Date("2026-10-06T18:00:00.000Z")
const NARRATIVE = [
  "O cliente esclareceu no início do contato que estava falando em nome da Antunes Logística, a empresa que vai receber as linhas móveis. Nesta chamada, você relacionou documentos da empresa cedente, como termo de transferência e carta de autorização, e afirmou que o termo de aceite não era necessário. Para a empresa que vai receber as linhas, a documentação prevista é:\n\n- Comprovante de inscrição do CNPJ e documento do representante;\n- Contrato social ou alteração contratual;\n- **Termo de aceite**, formulário cadastral e dados de faturamento.",
  "Quando o cliente questionou os itens e demonstrou receio de travar o processo, você demonstrou impaciência ao dizer que já tinha lido a lista inteira e que o envio diferente travaria o pedido. Mesmo quando o cliente insistir ou trouxer inseguranças, mantenha uma **linguagem respeitosa e acolhedora**, esclarecendo as dúvidas com calma em vez de rebater o cliente.",
  "Nas próximas chamadas, quando o cliente relatar que já possui contato anterior ou chamado em andamento, reconheça esse histórico e passe a orientação sobre o acompanhamento disponível. Antes de encerrar a ligação, faça também a confirmação da **solução aplicada**, recapitulando as orientações passadas.",
  "Por outro lado, você orientou corretamente o canal de envio por **link seguro**, informou o prazo de validação de até cinco dias úteis e passou o número de protocolo.",
]
const view = { version: "FEEDBACK_VIEW_V1", heading: { title: "Troca de titularidade", subtitle: "Atendimento de 06/10/2026" }, card: "Informe a documentação correta.", greeting: "Olá, Larissa!", narrative: NARRATIVE, developments: [], maintain: null, attention: [], materials: [], context: null, kind: "MONITORING" }
const record: PublishedFeedbackRecord = {
  feedbackId: "f1", version: 1, kind: "MONITORING", publishedAt: new Date("2026-10-06T17:57:00.000Z"),
  impactedIndicator: "", evidenceFound: "", observedBehavior: "", relatedProcedure: "", recommendation: NARRATIVE.join("\n\n"), suggestedApproach: null,
  caseId: "c1", caseTitle: "Troca de titularidade", caseSummary: "Informe a documentação correta.", snapshot: { feedbackEngine: { feedbackView: view } }, supportMaterials: [],
}

describe("apresentação falada — o feedback inteiro", () => {
  it("uma narrativa de ~210 palavras é falada até o fim, sem marcas de formatação", () => {
    const presentation = buildApplicationPresentation({ context: buildPublishedFeedbackContext(record, NOW), view: view as never, addressName: "Larissa Monteiro", now: NOW })
    expect(presentation.speechTruncated).toBe(false)
    expect(presentation.speechText).toContain("recapitulando as orientações passadas")
    expect(presentation.speechText).toContain("Por outro lado, você orientou corretamente o canal de envio por link seguro")
    expect(presentation.speechText).not.toMatch(/\*\*|(?:^|\s)- /u)
  })
})

describe("apresentação falada — a tabela do resultado não é lida", () => {
  it("bloco de tabela fica no texto escrito e fora da fala", () => {
    const table = "| | TMA |\n|---|---|\n| Setembro/2026 (resultado oficial) | 452 s |\n| Meta | 400 s · fora da meta |"
    const withTable = { ...view, narrative: [NARRATIVE[0]!, table, ...NARRATIVE.slice(1)] }
    const presentation = buildApplicationPresentation({ context: buildPublishedFeedbackContext({ ...record, snapshot: { feedbackEngine: { feedbackView: withTable } } }, NOW), view: withTable as never, addressName: "Larissa Monteiro", now: NOW })
    expect(presentation.chatText).toContain(table)
    expect(presentation.speechText).not.toContain("resultado oficial")
    expect(presentation.speechText).not.toContain("|")
  })
})
