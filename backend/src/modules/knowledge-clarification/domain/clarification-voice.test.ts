import { describe, expect, it } from "vitest"
import { KNOWLEDGE_CLARIFICATION_VERSION, optionIdFor, stepIdFor, type ClarificationState, type ClarificationStep } from "./clarification-state.js"
import { MAX_SPOKEN_OPTIONS, renderClarificationVoiceInstruction, spokenAlternatives } from "./clarification-voice.js"

/**
 * Como o esclarecimento é FALADO: a pergunta com os rótulos lidos de forma curta (nunca fontes), a resposta sem os marcadores de fonte,
 * o que falta sem procedimento — e a resposta falada volta pela ferramenta que trouxe a pergunta, com a pergunta original.
 */
const NOW = "2026-10-20T12:00:00.000Z"
const source = { documentId: "kb-1", documentTitle: "Base de teste", versionId: "kb-1-v1", heading: "1. Seção", chunkIndex: 0 }

function step(labels: string[], answered = false): ClarificationStep {
  const dimension = "Dimensão de teste"
  return { id: stepIdFor(1, dimension), dimension, question: "Qual cenário de teste?", selectionMode: "SINGLE", options: labels.map((label) => ({ id: optionIdFor(dimension, label), label, description: "descrição que não é lida", group: null, evidence: [source] })), answer: answered ? { optionIds: [optionIdFor(dimension, labels[0]!)], freeText: null, noneMatched: false, via: "FORM", answeredAt: NOW } : null }
}

function state(status: ClarificationState["status"], steps: ClarificationStep[]): ClarificationState {
  return { version: KNOWLEDGE_CLARIFICATION_VERSION, id: "11111111-1111-4111-8111-111111111111", originalQuestion: "Pergunta\n  genérica de teste?", status, steps, questionFacts: [], coverage: { consideredDocuments: 1, matchedDocuments: 1, presentedDocuments: 1, omittedDocuments: 0, complete: true }, sources: status === "ANSWERED" ? [source] : [], conflicts: [], notice: null, updatedAt: NOW }
}

describe("esclarecimento na voz", () => {
  it("lista falada natural: \"A, B ou C\"", () => {
    expect(spokenAlternatives(["A"])).toBe("A")
    expect(spokenAlternatives(["A", "B"])).toBe("A ou B")
    expect(spokenAlternatives(["A", "B", "C"])).toBe("A, B ou C")
  })

  it("etapa aberta: pergunta curta com os rótulos (sem fontes nem descrições) e a resposta falada volta pela ferramenta com a pergunta original", () => {
    const text = renderClarificationVoiceInstruction(state("OPEN", [step(["Cenário A", "Cenário B", "Cenário C"])]), { tool: "self_ask" })
    expect(text).toContain("só os rótulos: Cenário A, Cenário B ou Cenário C")
    expect(text).not.toContain("descrição que não é lida")
    expect(text).not.toContain("Base de teste")
    expect(text).toContain('acione self_ask de novo com a pergunta original ("Pergunta genérica de teste?")')
    expect(text).toContain("não responda o procedimento ainda")
  })

  it("sessão de voz sem ferramenta para encaminhar (aplicação de feedback): a escolha é só pela tela — nunca \"responda falando\"", () => {
    const text = renderClarificationVoiceInstruction(state("OPEN", [step(["Cenário A", "Cenário B"])]), { tool: null })
    expect(text).toContain("só os rótulos: Cenário A ou Cenário B")
    expect(text).toContain("Diga que a pessoa pode escolher a opção na tela.")
    expect(text).not.toContain("responder falando")
    expect(text).not.toContain("acione")
  })

  it("muitas opções: diz quantas há na tela e lê só as primeiras", () => {
    const labels = Array.from({ length: 9 }, (_, index) => `Cenário ${index + 1}`)
    const text = renderClarificationVoiceInstruction(state("OPEN", [step(labels)]), { tool: "leadership_ask" })
    expect(text).toContain(`há 9 opções na tela e leia só as ${MAX_SPOKEN_OPTIONS - 1} primeiras`)
    expect(text).toContain("Cenário 1, Cenário 2, Cenário 3, Cenário 4)")
    expect(text).not.toContain("Cenário 5")
    expect(text).toContain("acione leadership_ask de novo")
  })

  it("resposta com fontes: conteúdo fiel, sem ler os marcadores nem falar de fontes (conversa natural); o que falta: sem procedimento; com texto antes (liderança): resumo dele primeiro", () => {
    const answered = renderClarificationVoiceInstruction(state("ANSWERED", [step(["A", "B"], true)]), { tool: "self_ask" })
    expect(answered).toContain("Não leia os marcadores de fonte ([1], [2]…)")
    expect(answered).toContain("não fale de fontes")
    expect(answered).not.toContain("fontes estão na tela")
    expect(answered).not.toContain("Comece por um resumo")
    const insufficient = renderClarificationVoiceInstruction(state("INSUFFICIENT", []), { tool: "self_ask" })
    expect(insufficient).toContain("Não indique nenhum procedimento")
    const withLead = renderClarificationVoiceInstruction(state("OPEN", [step(["A", "B"])]), { tool: "leadership_ask", withLead: true })
    expect(withLead).toContain("Comece por um resumo de uma frase do que vem antes do esclarecimento")
  })
})
