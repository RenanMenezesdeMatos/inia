import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { analysis, briefOf, challenge, confirmAllClaims, line, T3, verified } from "../testing/cancellation-case.js"
import { applyVerdicts, assembleMessage, parseVerdicts, parseWriterDraft, repairInstructionsOf, trustedReadingsOf, usefulnessOf, type Verdict } from "./composition.js"
import { renderVerificationUserTurn } from "./composition-prompt.js"
import { composeFeedback } from "../application/compose-feedback.js"
import type { EngineModelPort, ModelCallMetric } from "../application/ports.js"

/**
 * VALOR DA MENSAGEM (`FEEDBACK_COMPOSITION_V4`, prompts V6/V5) — zero IA. O caso sintético de cobrança após cancelamento tem um ajuste
 * CENTRAL (o próximo passo do pedido pendente não foi dito no fechamento), reconhecimentos e dois pontos que a conversa não permite
 * concluir. Nenhum teste aqui obriga o redator a escrever uma frase: o que se prova são as regras de decisão (o que fica, o que sai,
 * qual versão vence, quando não há mensagem).
 */
function caseBrief() {
  const model = analysis()
  const result = verified(model, confirmAllClaims(model, [
    challenge(line("Próximo passo do pedido"), { proposedStatus: "NOT_MET", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", listReading: "CUMULATIVE", conditionEvidence: [T3], opportunityTurn: "T6" }),
    challenge(line("Corrigir o status"), { proposedStatus: "NOT_MET", itemNature: "INTERNAL_ACTION", scenarioRole: "CENTRAL", conditionEvidence: [T3], opportunityTurn: "T6" }),
    challenge(line("Serviço cancelado"), { proposedStatus: "NOT_OBSERVABLE", itemNature: "COMMUNICATION", scenarioRole: "CENTRAL", issues: ["DEPENDS_ON_INTERNAL_ACTION"], conditionEvidence: [T3], note: "Só vale se o cancelamento foi concluído — a conversa não mostra." }),
  ]))
  return briefOf(result)
}
const ok = (id: string, extra: Partial<Verdict> = {}): [string, Verdict] => [id, { id, verdict: "SUPPORTED", specific: true, repeats: null, note: null, ...extra }]
const draftOf = (sentences: { text: string; stance: string; refs: string[] }[], card = { text: "O fechamento não disse o que acontece com o cancelamento pendente.", refs: ["A1"] }) => {
  const parsed = parseWriterDraft(JSON.stringify({ sentences: sentences.map((sentence) => ({ ...sentence, paragraph: 1 })), card }))
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.draft
}
const ADJUST = { text: "No fechamento, você resumiu a contestação e o protocolo, mas não disse o que acontece com o pedido de cancelamento que estava aberto desde julho.", stance: "ADJUSTMENT", refs: ["A1"] }
const GUIDE = { text: "Antes de encerrar, diga à cliente qual é o próximo passo do pedido de cancelamento pendente, junto com o prazo da contestação.", stance: "GUIDANCE", refs: ["A1"] }
const REPEAT_WITH_DETAIL = { text: "Ela perguntou se ia continuar pagando: o próximo passo do cancelamento pendente era exatamente a resposta para essa pergunta.", stance: "GUIDANCE", refs: ["A1"] }

describe("o brief do caso sintético", () => {
  it("o ajuste central tem a lista inteira (abertura cumulativa e os itens cumpridos) e os pontos não concluíveis viram pontos em aberto", () => {
    const brief = caseBrief()
    expect(brief.developments.map((finding) => [finding.ref, finding.role])).toEqual([["A1", "CENTRAL"]])
    expect(brief.developments[0]!.sameList!.map((sibling) => [sibling.text, sibling.status])).toEqual(expect.arrayContaining([[expect.stringContaining("Ação realizada"), "MET"], [expect.stringContaining("Protocolo"), "MET"]]))
    // Ponto em aberto só de etapa DA CONVERSA ligada ao caso por fala (comunicar ao cliente o que houve com o serviço, quando valer);
    // "Corrigir o status" (execução no sistema) e o registro só DECLARADO são limites de cobertura — nunca chegam ao redator.
    expect(brief.openPoints!.map((point) => point.title)).toEqual(["Serviço cancelado, quando aplicável"])
    expect(brief.openPoints![0]!.why).toMatch(/não é falha nem acerto/)
    expect(brief.coverageLimits!.map((limit) => [limit.title, limit.reason, limit.executionClaim])).toEqual(expect.arrayContaining([["Corrigir o status", "OUTSIDE_CONVERSATION", "NONE"], ["Contestar cobranças posteriores", "OUTSIDE_CONVERSATION", "DECLARED"]]))
    expect(brief.strengths.map((finding) => finding.title)).not.toContain("Contestar cobranças posteriores")
  })
})

describe("repetição × detalhe concreto", () => {
  it("frase que repete a ideia SEM detalhe novo sai; a que repete trazendo detalhe concreto sustentado fica", () => {
    const brief = caseBrief()
    const draft = draftOf([ADJUST, GUIDE, REPEAT_WITH_DETAIL, { ...GUIDE, text: "Antes de encerrar, diga à cliente qual é o próximo passo do pedido de cancelamento pendente." }])
    const decisions = applyVerdicts(draft, brief, new Map([ok("F1"), ok("F2"), ok("F3", { repeats: "F2", addsInformation: true }), ok("F4", { repeats: "F2", addsInformation: false }), ok("CARD")]))
    expect(decisions.sentences.map((entry) => [entry.id, entry.kept, entry.reasons])).toEqual([["F1", true, []], ["F2", true, []], ["F3", true, []], ["F4", false, ["REDUNDANT"]]])
  })

  it("a reescrita pede para JUNTAR o detalhe da frase repetida e manter a informação das frases aprovadas — sem ditar o texto", () => {
    const brief = caseBrief()
    const draft = draftOf([ADJUST, GUIDE, REPEAT_WITH_DETAIL, { text: "Você foi excelente em todo o atendimento.", stance: "RECOGNITION", refs: ["S1"] }])
    const decisions = applyVerdicts(draft, brief, new Map([ok("F1"), ok("F2"), ok("F3", { repeats: "F2", addsInformation: true }), ok("F4", { verdict: "OVERREACH", note: "superlativo para rotina" }), ok("CARD")]))
    const instructions = repairInstructionsOf([...decisions.sentences, decisions.card], usefulnessOf(brief, decisions.sentences.filter((entry) => entry.kept), null), brief, trustedReadingsOf(brief, [decisions]))
    expect(instructions.join("\n")).toContain("Mantenha a informação destas frases aprovadas")
    expect(instructions.join("\n")).toContain("estava aberto desde julho")
    expect(instructions.join("\n")).toContain("OVERREACH")
  })
})

describe("a mensagem inteira precisa ter valor", () => {
  it("mensagem que só narra etapas (avaliação da verificação) → lacuna de valor; o que é dito na reescrita é o ponto principal, não uma frase pronta", () => {
    const brief = caseBrief()
    const parsed = parseVerdicts(JSON.stringify({ verdicts: [{ id: "F1", verdict: "SUPPORTED", specific: true }, { id: "CARD", verdict: "SUPPORTED" }], message: { conveysPrimary: false, valueBeyondNarration: false, note: "lista o que foi feito e não diz o que faltou no fechamento" } }), ["F1", "CARD"])
    if (!parsed.ok) throw new Error(parsed.error)
    const draft = draftOf([{ text: "Você registrou a contestação, informou o prazo e passou o protocolo.", stance: "CONTEXT", refs: [] }])
    const decisions = applyVerdicts(draft, brief, parsed.verdicts, { message: parsed.message })
    const usefulness = usefulnessOf(brief, decisions.sentences.filter((entry) => entry.kept), decisions.message)
    expect(usefulness.missingValue).toBe("lista o que foi feito e não diz o que faltou no fechamento")
    const instructions = repairInstructionsOf([...decisions.sentences, decisions.card], usefulness, brief, trustedReadingsOf(brief, [decisions]))
    expect(instructions.some((instruction) => instruction.includes("ainda não ajuda o suficiente") && instruction.includes("A1"))).toBe(true)
  })

  it("avaliação ausente (verificação antiga) não inventa lacuna: só as checagens por código decidem", () => {
    const brief = caseBrief()
    const decisions = applyVerdicts(draftOf([ADJUST, GUIDE]), brief, new Map([ok("F1"), ok("F2"), ok("CARD")]))
    expect(usefulnessOf(brief, decisions.sentences.filter((entry) => entry.kept), decisions.message)).toMatchObject({ primaryCovered: true, missingValue: null })
  })

  it("o pedido de verificação da reescrita leva o ponto principal e o que já estava aprovado (para medir a informação perdida)", () => {
    const brief = caseBrief()
    const turn = renderVerificationUserTurn(brief, [{ id: "F1", text: GUIDE.text, stance: "GUIDANCE", refs: ["A1"] }], { previousApproved: [ADJUST.text] })
    expect(turn).toContain("PONTO PRINCIPAL")
    expect(turn).toContain(ADJUST.text)
  })
})

describe("referências por postura", () => {
  it("ponto feito em parte pode ser reconhecido na parte feita; ponto em aberto só aparece como orientação, nunca como ajuste", () => {
    const brief = caseBrief()
    const draft = draftOf([
      { text: "No resumo final você incluiu a contestação e o protocolo.", stance: "RECOGNITION", refs: ["A1"] },
      { text: "Quando o cancelamento já estiver concluído, vale dizer isso à cliente no fechamento.", stance: "GUIDANCE", refs: ["O1"] },
      { text: "Você não disse à cliente que o serviço foi cancelado.", stance: "ADJUSTMENT", refs: ["O1"] },
    ])
    const decisions = applyVerdicts(draft, brief, new Map([ok("F1"), ok("F2"), ok("F3"), ok("CARD")]))
    expect(decisions.sentences.map((entry) => [entry.id, entry.kept])).toEqual([["F1", true], ["F2", true], ["F3", false]])
    expect(decisions.sentences[2]!.reasons).toContain("STANCE_REF_MISMATCH")
  })
})

describe("a escolha entre a versão e a reescrita", () => {
  /** Modelo falso que devolve, em ordem, rascunho/verificação/reescrita/verificação (zero IA). */
  const scripted = (responses: object[]): EngineModelPort => {
    let index = 0
    return { async generate() {
      const body = responses[index++]
      if (!body) throw new Error("UNEXPECTED_CALL")
      return { text: JSON.stringify(body), model: "fake", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, durationMs: 1, costUsd: 0, finishReason: "STOP" }
    } }
  }

  it("reescrita que PERDE informação aprovada não substitui a versão que já tinha o detalhe do caso", async () => {
    const brief = caseBrief()
    const first = { sentences: [{ ...ADJUST, paragraph: 1 }, { ...GUIDE, paragraph: 1 }, { text: "Ótimo trabalho!", stance: "RECOGNITION", refs: ["S1"], paragraph: 2 }], card: { text: "Faltou dizer o próximo passo do cancelamento pendente.", refs: ["A1"] } }
    const firstVerdicts = { verdicts: [{ id: "F1", verdict: "SUPPORTED", specific: true }, { id: "F2", verdict: "SUPPORTED", specific: true }, { id: "F3", verdict: "OVERREACH", specific: false, note: "genérico" }, { id: "CARD", verdict: "SUPPORTED" }], message: { conveysPrimary: true, valueBeyondNarration: true } }
    const second = { sentences: [{ text: "Antes de encerrar, diga o próximo passo do pedido.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Diga o próximo passo.", refs: ["A1"] } }
    const secondVerdicts = { verdicts: [{ id: "F1", verdict: "SUPPORTED", specific: true }, { id: "CARD", verdict: "SUPPORTED" }], message: { conveysPrimary: true, valueBeyondNarration: true }, lostInformation: ["o pedido estava aberto desde julho e a cliente perguntou se ia continuar pagando"] }
    const metrics: ModelCallMetric[] = []
    const { message, audit } = await composeFeedback(scripted([first, firstVerdicts, second, secondVerdicts, { coherent: true, problems: [] }]), brief, metrics)
    expect(audit.attempts.writer).toBe(2)
    expect(audit.lostInformation).toEqual([])
    expect(message?.text).toContain("aberto desde julho")
  })

  it("reescrita que não cabe no orçamento (com a sua verificação) nem começa: vale a primeira versão, e o motivo fica na auditoria (`ENGINE_BUDGET_V2`)", async () => {
    const brief = caseBrief()
    const first = { sentences: [{ ...ADJUST, paragraph: 1 }, { ...GUIDE, paragraph: 1 }, { text: "Ótimo trabalho!", stance: "RECOGNITION", refs: ["S1"], paragraph: 2 }], card: { text: "Faltou dizer o próximo passo do cancelamento pendente.", refs: ["A1"] } }
    const firstVerdicts = { verdicts: [{ id: "F1", verdict: "SUPPORTED", specific: true }, { id: "F2", verdict: "SUPPORTED", specific: true }, { id: "F3", verdict: "OVERREACH", specific: false, note: "genérico" }, { id: "CARD", verdict: "SUPPORTED" }], message: { conveysPrimary: true, valueBeyondNarration: true } }
    const asked: { stage: string }[][] = []
    const { message, audit } = await composeFeedback(scripted([first, firstVerdicts, { coherent: true, problems: [] }]), brief, [], { fitsAll: (requests) => (asked.push([...requests]), false) })
    expect(asked).toEqual([[expect.objectContaining({ stage: "COMPOSITION" }), expect.objectContaining({ stage: "VERIFICATION" })]])
    expect(audit.attempts.writer).toBe(1)
    expect(audit.errors).toContain("REPAIR_SKIPPED:FEEDBACK_ENGINE_BUDGET_EXHAUSTED")
    expect(message?.text).toContain("aberto desde julho")
    expect(message?.text).not.toContain("Ótimo trabalho")
  })

  it("mensagem sem valor nas duas versões = abstenção com motivo (nunca publica narração para não ficar sem retorno)", async () => {
    const brief = caseBrief()
    const narration = { sentences: [{ text: "Você registrou a contestação e informou o prazo.", stance: "CONTEXT", refs: [], paragraph: 1 }], card: { text: "Atendimento de contestação.", refs: [] } }
    const narrationVerdict = { verdicts: [{ id: "F1", verdict: "SUPPORTED", specific: true }, { id: "CARD", verdict: "SUPPORTED" }], message: { conveysPrimary: false, valueBeyondNarration: false, note: "só narra" } }
    const { message, audit } = await composeFeedback(scripted([narration, narrationVerdict, narration, narrationVerdict]), brief, [])
    expect(message).toBeNull()
    expect(audit.reason).toBe("NO_USEFUL_MESSAGE")
    expect(audit.messageAssessment).toMatchObject({ valueBeyondNarration: false })
  })
})

describe("o que o colaborador lê nos detalhes", () => {
  it("nada de linguagem de auditoria; ponto em aberto só aparece se a mensagem o comunicou", () => {
    const brief = caseBrief()
    const silent = applyVerdicts(draftOf([ADJUST, GUIDE]), brief, new Map([ok("F1"), ok("F2"), ok("CARD")]))
    const withoutOpen = assembleMessage(brief, silent)!
    expect(JSON.stringify(withoutOpen.view)).not.toMatch(/revis[ãa]o|confirmad[ao]s? pela|conclus(ão|ões) recusad/i)
    expect(withoutOpen.view.attention.map((entry) => entry.title)).not.toContain("Serviço cancelado, quando aplicável")

    const spoken = applyVerdicts(draftOf([ADJUST, GUIDE, { text: "Quando o cancelamento já estiver concluído, vale dizer isso à cliente no fechamento.", stance: "GUIDANCE", refs: ["O1"] }]), brief, new Map([ok("F1"), ok("F2"), ok("F3"), ok("CARD")]))
    const withOpen = assembleMessage(brief, spoken)!
    expect(withOpen.view.attention.map((entry) => entry.title)).toContain("Serviço cancelado, quando aplicável")
    // A execução no sistema nunca aparece como ponto de atenção para o colaborador.
    expect(withOpen.view.attention.map((entry) => entry.title)).not.toContain("Corrigir o status")
    expect(withOpen.communicatedRefs).toContain("O1")
  })
})
