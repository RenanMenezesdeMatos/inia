import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { composeFeedback } from "../application/compose-feedback.js"
import { fakeEngineModel } from "../testing/fake-engine-model.js"
import { applyVerdicts, assembleMessage, parseWriterDraft, resolveDraftQuotes, type Verdict } from "./composition.js"
import { COMPOSITION_REMINDER, COMPOSITION_RESPONSE_SCHEMA, COMPOSITION_SYSTEM_PROMPT, compositionPayloadOf, renderCompositionUserTurn, VERIFICATION_SYSTEM_PROMPT } from "./composition-prompt.js"
import type { BriefFinding, FeedbackBrief } from "./feedback-brief.js"
import { feedbackViewOf } from "./feedback-view.js"
import { nonLiteralQuotesOf, quoteIdsOf } from "./literal-quotes.js"

/**
 * `LITERAL_QUOTES_V1` — zero IA. O redator nunca digita uma fala: cita pelo id ([[Q1]]) e o sistema coloca o texto exato da chamada.
 * Todo trecho entre aspas tem de ser literal (chamada, regra ou argumentário), conferido por código. O redator não escreve exemplo de
 * como dizer: os detalhes mostram só a fraseologia do argumentário, como está, e nunca a orientação escrita pela análise.
 */
const finding = (overrides: Partial<BriefFinding>): BriefFinding => ({ ref: "", findingKey: "k", kind: "DEVELOPMENT", origin: "CRITERION", title: "t", materiality: "HIGH", status: "NOT_MET", observed: "x", reading: null, quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [], ...overrides })
const rule = (section: string, text: string) => ({ text, section, documentId: "doc", documentTitle: "Procedimento Operacional — Contestação de Contas Móvel" })

const PRAZO = finding({ ref: "A1", findingKey: "CALL:i:KC-prazo", title: "Prazo da análise", criterionKeys: ["KC-prazo"], quotes: [{ speaker: "OPERATOR", text: "É só aguardar que vai ser resolvido. Mais alguma coisa?", turn: "T13" }], rules: [rule("Prazo da análise", "O operador deverá informar o prazo exibido na ferramenta.")], guidance: { action: "tranquilizar o cliente de que tudo será resolvido", moment: "ao encerrar", condition: null } })
const EVITAR = finding({ ref: "A2", findingKey: "CALL:i:KC-evitar", title: "Expressões de descompromisso", materiality: "MEDIUM", criterionKeys: ["KC-evitar"], quotes: [{ speaker: "OPERATOR", text: "Isso não é comigo, vou te transferir.", turn: "T5" }], rules: [{ ...rule("Evitar", "- “Isso não é comigo.”"), avoid: true }] })
const PROTOCOLO = finding({ ref: "S1", findingKey: "CALL:i:KC-protocolo", kind: "STRENGTH", status: "MET", title: "Protocolo", criterionKeys: ["KC-protocolo"], quotes: [{ speaker: "OPERATOR", text: "Anota o protocolo, por favor.", turn: "T15" }], rules: [rule("Protocolo", "Informar o número do protocolo.")], whyItMatters: "o cliente fica tranquilo e não liga de novo" })

const brief = (): FeedbackBrief => ({ domain: "MONITORING", label: "Contestação de cobrança", heading: { title: "Contestação de cobrança", subtitle: "Atendimento de 25/09/2026" }, context: ["A cliente contestou uma cobrança de doze reais numa conta já paga."], officialLines: [], developments: [PRAZO, EVITAR], strengths: [PROTOCOLO], limitations: [], materials: [], tone: "DEVELOPMENT", suppressed: [] }) as unknown as FeedbackBrief
const ok = (id: string, overrides: Partial<Verdict> = {}): [string, Verdict] => [id, { id, verdict: "SUPPORTED", specific: true, repeats: null, note: null, ...overrides }]

function decided(sentences: { text: string; stance: string; refs: string[] }[], target: FeedbackBrief = brief()) {
  const parsed = parseWriterDraft(JSON.stringify({ sentences: sentences.map((sentence) => ({ ...sentence, paragraph: 1 })), card: { text: "Informe o prazo exibido na ferramenta.", refs: ["A1"] } }))
  if (!parsed.ok) throw new Error(parsed.error)
  const draft = resolveDraftQuotes(parsed.draft, target)
  return applyVerdicts(draft, target, new Map([...sentences.map((_, index) => ok(`F${index + 1}`)), ok("CARD")]))
}

describe("`LITERAL_QUOTES_V1` — fala citada por referência, texto sempre o da chamada", () => {
  it("cada fala do caso vai ao redator com um id; a referência vira a fala exata, entre aspas", () => {
    const ids = quoteIdsOf(brief())
    expect([...ids.values()]).toEqual(["Q1", "Q2", "Q3"])
    const facts = compositionPayloadOf(brief()).facts as unknown as { developments: { quotes: { id: string; who: string; text: string }[] }[] }
    expect(facts.developments[0]!.quotes[0]).toMatchObject({ id: "Q1", who: "você", text: "É só aguardar que vai ser resolvido. Mais alguma coisa?" })
    const [sentence] = decided([{ text: "Quando a cliente perguntou da análise, você respondeu [[Q1]], sem o prazo.", stance: "ADJUSTMENT", refs: ["A1"] }]).sentences
    expect(sentence).toMatchObject({ kept: true, text: "Quando a cliente perguntou da análise, você respondeu “É só aguardar que vai ser resolvido. Mais alguma coisa?”, sem o prazo." })
  })

  it("fala digitada diferente da chamada é recusada; a fala inteira, uma frase inteira dela, a linha da regra e o argumentário passam", () => {
    const altered = decided([{ text: "Você disse “É só esperar que resolve”, sem o prazo.", stance: "ADJUSTMENT", refs: ["A1"] }]).sentences[0]!
    expect(altered).toMatchObject({ kept: false })
    expect(altered.reasons).toContain("QUOTE_NOT_LITERAL")
    // Recorte no meio da frase também não vale (pode mudar o sentido): só frases inteiras.
    expect(nonLiteralQuotesOf("Você disse “aguardar que vai ser resolvido”.", brief())).toEqual(["aguardar que vai ser resolvido"])
    expect(nonLiteralQuotesOf("Você disse “É só aguardar que vai ser resolvido”, sem o prazo.", brief())).toEqual([])
    expect(nonLiteralQuotesOf("Não use “isso não é comigo”: a operação pede para evitar.", brief())).toEqual([])
    expect(nonLiteralQuotesOf("Você disse 'É só aguardar, já resolvo'.", brief())).toEqual(["É só aguardar, já resolvo"])
    const phrased = { ...brief(), developments: [{ ...PRAZO, rules: [{ ...PRAZO.rules[0]!, sourceKind: "ARGUMENT_SCRIPT" as const, phrasing: { scriptName: "Prazo da análise", text: "O prazo da análise é de [prazo]. Você recebe o retorno por SMS." } }] }, EVITAR] } as FeedbackBrief
    expect(nonLiteralQuotesOf("A operação orienta dizer “Você recebe o retorno por SMS”.", phrased)).toEqual([])
  })

  it("referência a uma fala que não existe nunca chega ao colaborador", () => {
    const [sentence] = decided([{ text: "Você respondeu [[Q9]] e encerrou.", stance: "ADJUSTMENT", refs: ["A1"] }]).sentences
    expect(sentence).toMatchObject({ kept: false })
    expect(sentence!.reasons).toContain("INTERNAL_REFERENCE")
  })

  it("composição: a referência é resolvida antes da verificação — o verificador e a mensagem veem a fala exata", async () => {
    const verified: string[] = []
    const { model } = fakeEngineModel({
      composition: { sentences: [{ text: "Você respondeu [[Q1]] e não informou o prazo da análise.", stance: "ADJUSTMENT", refs: ["A1"], paragraph: 1 }, { text: "Nas próximas contestações, informe o prazo exibido na ferramenta antes de encerrar.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "Informe o prazo exibido na ferramenta.", refs: ["A1"] } },
      verification: (claims) => {
        verified.push(...claims.map((claim) => claim.text))
        return { verdicts: claims.map((claim) => ({ id: claim.id, verdict: "SUPPORTED", specific: true })) }
      },
    })
    const { message } = await composeFeedback(model, { ...brief(), developments: [PRAZO] }, [], null)
    expect(verified).toContain("Você respondeu “É só aguardar que vai ser resolvido. Mais alguma coisa?” e não informou o prazo da análise.")
    expect(message?.text).toContain("“É só aguardar que vai ser resolvido. Mais alguma coisa?”")
    expect(message?.text).not.toContain("[[Q1]]")
  })
})

describe("`LITERAL_QUOTES_V1` — detalhes só com o literal: fraseologia do argumentário e regra, nunca leitura da análise", () => {
  const phrasing = { scriptName: "Prazo da análise", text: "O prazo da análise é de [prazo]. Você recebe o retorno por SMS." }
  const phrasedBrief = () => ({ ...brief(), developments: [{ ...PRAZO, rules: [{ ...PRAZO.rules[0]!, sourceKind: "ARGUMENT_SCRIPT" as const, phrasing }] }] }) as FeedbackBrief

  it("'como dizer' é a fraseologia como está cadastrada, lacunas incluídas, com o nome do argumentário", () => {
    const target = phrasedBrief()
    const decisions = decided([{ text: "Você respondeu [[Q1]] e não informou o prazo.", stance: "ADJUSTMENT", refs: ["A1"] }], target)
    const message = assembleMessage(target, decisions, { trusted: { guidance: { A1: "Na próxima vez, ao encerrar: tranquilizar o cliente." }, why: {} } })!
    expect(message.view.developments[0]).toMatchObject({ suggestedResponse: phrasing.text, suggestedResponseSource: { kind: "ARGUMENT_SCRIPT", name: "Prazo da análise" } })
  })

  it("'como aplicar' e o 'por que importa' escritos pela análise nunca vão para os detalhes, mesmo aprovados", () => {
    const target = brief()
    const decisions = decided([{ text: "Você respondeu [[Q1]] e não informou o prazo.", stance: "ADJUSTMENT", refs: ["A1"] }, { text: "Você informou o protocolo ao encerrar.", stance: "RECOGNITION", refs: ["S1"] }], target)
    const message = assembleMessage(target, decisions, { trusted: { guidance: { A1: "Na próxima vez, ao encerrar: tranquilizar o cliente de que tudo será resolvido." }, why: { S1: "O cliente fica tranquilo e não liga de novo." } } })!
    expect(message.view.developments[0]!.howToApply).toBeNull()
    expect(message.view.maintain?.evidence[0]?.statement).toBe(PROTOCOLO.observed)
    expect(JSON.stringify(message.view)).not.toContain("tranquilizar o cliente")
    expect(JSON.stringify(message.view)).not.toContain("não liga de novo")
  })

  it("o redator não tem mais exemplo de como dizer: rascunho, prompts e schema", () => {
    const parsed = parseWriterDraft(JSON.stringify({ sentences: [{ text: "Informe o prazo.", stance: "GUIDANCE", refs: ["A1"], paragraph: 1 }], card: { text: "c", refs: [] }, examples: [{ ref: "A1", text: "O prazo é de cinco dias." }] }))
    expect(parsed.ok && "examples" in parsed.draft).toBe(false)
    expect(COMPOSITION_SYSTEM_PROMPT).not.toContain("EXEMPLO DE COMO DIZER")
    expect((COMPOSITION_RESPONSE_SCHEMA as { properties: Record<string, unknown> }).properties.examples).toBeUndefined()
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("escreva só a referência entre colchetes duplos")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("não a reescreva, não a adapte e não escreva outra fala ao cliente")
    expect(VERIFICATION_SYSTEM_PROMPT).not.toContain("E-…")
    expect(VERIFICATION_SYSTEM_PROMPT).toContain("As falas entre aspas no texto foram colocadas pelo SISTEMA")
    expect(renderCompositionUserTurn(brief(), null).endsWith(COMPOSITION_REMINDER)).toBe(true)
    const repair = renderCompositionUserTurn(brief(), ["A frase F2 foi recusada."])
    expect(repair.indexOf(COMPOSITION_REMINDER)).toBeLessThan(repair.indexOf("A frase F2 foi recusada."))
  })
})

describe("`CALL_IDENTIFIER_INTEGRITY_V1` — protocolo, telefone e documento só das falas da chamada", () => {
  const withRule = (): FeedbackBrief => {
    const protocolo = finding({ ref: "A1", findingKey: "CALL:i:KC-prot", title: "Protocolo", criterionKeys: ["KC-prot"], quotes: [{ speaker: "CUSTOMER", text: "Pode me passar o protocolo? Anota aí: meu telefone é (11) 98765-4321.", turn: "T20" }], rules: [rule("Exemplos de encerramento", "A contestação será analisada em até 5 dias úteis. Seu protocolo é 202609130184.")] })
    return { ...brief(), developments: [protocolo] } as FeedbackBrief
  }
  const reasonsOf = (text: string) => decided([{ text, stance: "GUIDANCE", refs: ["A1"] }], withRule()).sentences[0]!.reasons

  it("o número de protocolo do EXEMPLO da regra nunca vai para a frase, mesmo que o verificador aceite", () => {
    expect(reasonsOf("Ao encerrar, informe o protocolo, como 202609130184.")).toContain("IDENTIFIER_NOT_FROM_CALL")
    expect(reasonsOf("Ao encerrar, informe o protocolo, como 2026 0913 0184.")).toContain("IDENTIFIER_NOT_FROM_CALL")
  })

  it("identificador que está numa fala da chamada vale; prazo da regra também", () => {
    expect(reasonsOf("Retorne no telefone que o cliente passou, o (11) 98765-4321.")).toEqual([])
    expect(reasonsOf("Ao encerrar, informe o número do protocolo e que a análise leva até 5 dias úteis.")).toEqual([])
  })
})

describe("`CURRENT_PRACTICE_TITLE_V1` — o nome da prática que vai ao redator é o atual", () => {
  it("padrões e práticas dos colegas trocam só o rótulo; contagens e regras ficam como apuradas", async () => {
    const { withCurrentPracticeTitles } = await import("./indicator-investigation.js")
    const pattern = { criterionKey: "KP-1", practiceTitle: "Confirmar o entendimento da solicitação de contestação do cliente", text: "Confirmar o entendimento;", eligible: 3, notMet: 3 }
    const investigation = { evidence: [{ patterns: [pattern, { criterionKey: "KC-2", text: "linha sem prática", eligible: 1 }] }], reference: { practices: [{ criterionKey: "KP-1", practiceTitle: pattern.practiceTitle, reference: { eligible: 9 } }] } } as never
    const renamed = withCurrentPracticeTitles(investigation, new Map([["KP-1", "Confirmar o entendimento da solicitação do cliente"]])) as unknown as { evidence: { patterns: { practiceTitle?: string; eligible: number }[] }[]; reference: { practices: { practiceTitle: string }[] } }
    expect(renamed.evidence[0]!.patterns[0]).toMatchObject({ practiceTitle: "Confirmar o entendimento da solicitação do cliente", eligible: 3 })
    expect(renamed.evidence[0]!.patterns[1]!.practiceTitle).toBeUndefined()
    expect(renamed.reference.practices[0]!.practiceTitle).toBe("Confirmar o entendimento da solicitação do cliente")
  })
})

describe("`ANALYSIS_CONTEXT_ONLY_V1` — da análise, o redator recebe só o contexto", () => {
  it("a explicação do que aconteceu vai; a orientação sugerida e o 'por que importa' não; a linha de seleção da chamada também não", () => {
    const target = { ...brief(), context: ["Como a chamada chegou à análise: Chamada selecionada pela execução do Workflow.", "Procedimento aplicado: Contestação de Contas Móvel"], developments: [{ ...PRAZO, reading: "A operadora encerrou sem informar o prazo." }] } as FeedbackBrief
    const payload = compositionPayloadOf(target)
    const points = (payload.analysisReading as { points: Record<string, unknown>[] }).points
    expect(points).toEqual([{ ref: "A1", explanation: "A operadora encerrou sem informar o prazo." }])
    expect(JSON.stringify(payload)).not.toContain("tranquilizar o cliente")
    expect(JSON.stringify(payload)).not.toContain("não liga de novo")
    expect(payload.facts.context).toEqual(["Procedimento aplicado: Contestação de Contas Móvel"])
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Ele não diz o que fazer: o que fazer vem só da regra do ponto")
  })
})

describe("`LITERAL_QUOTES_V1` — parte de uma fala longa e a fala como fala de quem disse", () => {
  it("fala com mais de uma frase vai ao redator com as partes; [[Q1.1]] e [[Q1.1-2]] colocam só essas frases, exatas", () => {
    const facts = compositionPayloadOf(brief()).facts as unknown as { developments: { quotes: { id: string; parts?: { id: string; text: string }[] }[] }[] }
    expect(facts.developments[0]!.quotes[0]!.parts).toEqual([{ id: "Q1.1", text: "É só aguardar que vai ser resolvido." }, { id: "Q1.2", text: "Mais alguma coisa?" }])
    expect(facts.developments[1]!.quotes[0]!.parts).toBeUndefined()
    const [part, range] = decided([
      { text: "Você respondeu [[Q1.1]] e não informou o prazo.", stance: "ADJUSTMENT", refs: ["A1"] },
      { text: "Depois você disse [[Q1.1-2]] e encerrou.", stance: "ADJUSTMENT", refs: ["A1"] },
    ]).sentences
    expect(part).toMatchObject({ kept: true, text: "Você respondeu “É só aguardar que vai ser resolvido.” e não informou o prazo." })
    expect(range).toMatchObject({ kept: true, text: "Depois você disse “É só aguardar que vai ser resolvido. Mais alguma coisa?” e encerrou." })
  })

  it("parte que a fala não tem fica de fora (código interno)", () => {
    const [sentence] = decided([{ text: "Você respondeu [[Q1.3]].", stance: "ADJUSTMENT", refs: ["A1"] }]).sentences
    expect(sentence!.reasons).toContain("INTERNAL_REFERENCE")
  })

  it("o redator é orientado a pôr o verbo de quem falou antes da referência e a citar só o trecho que importa", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("o verbo de quem falou vem logo antes da referência")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("numa fala longa, a parte dela")
    expect(COMPOSITION_REMINDER).toContain("logo depois do verbo de quem falou")
  })
})

describe("`LITERAL_QUOTES_V1` — ponto final depois da fala colada", () => {
  it("a fala que já termina com pontuação fecha a frase: o ponto do redator logo depois dela não se repete", () => {
    const [period, question, open, middle] = decided([
      { text: "Você respondeu [[Q2]].", stance: "ADJUSTMENT", refs: ["A2"] },
      { text: "Depois você perguntou [[Q1.2]].", stance: "ADJUSTMENT", refs: ["A1"] },
      { text: "Você disse [[Q1.1]], sem o prazo.", stance: "ADJUSTMENT", refs: ["A1"] },
      { text: "Você disse [[Q2]]. Faltou acolher o cliente.", stance: "ADJUSTMENT", refs: ["A2"] },
    ]).sentences
    expect(period!.text).toBe("Você respondeu “Isso não é comigo, vou te transferir.”")
    expect(question!.text).toBe("Depois você perguntou “Mais alguma coisa?”")
    expect(open!.text).toBe("Você disse “É só aguardar que vai ser resolvido.”, sem o prazo.")
    expect(middle!.text).toBe("Você disse “Isso não é comigo, vou te transferir.” Faltou acolher o cliente.")
  })
})

describe("`ALL_STRENGTHS_SHOWN_V1` — acerto confirmado aparece em 'O que manter' mesmo fora do texto", () => {
  it("o texto fala só do ajuste; o acerto vem nos detalhes com a fala exata e a afirmação do sistema — o só declarado, não", () => {
    const declared = finding({ ref: "S2", findingKey: "CALL:i:KC-registro", kind: "STRENGTH", status: "MET", title: "Registro do atendimento", criterionKeys: ["KC-registro"], declaredOnly: true, quotes: [{ speaker: "OPERATOR", text: "Já registrei aqui.", turn: "T16" }] })
    const target = { ...brief(), developments: [PRAZO], strengths: [PROTOCOLO, declared] } as FeedbackBrief
    const decisions = decided([{ text: "Você respondeu [[Q1.1]] e não informou o prazo.", stance: "ADJUSTMENT", refs: ["A1"] }], target)
    const message = assembleMessage(target, decisions)!
    expect(message.text).not.toContain("protocolo, por favor")
    expect(message.view.maintain?.evidence).toEqual([expect.objectContaining({ title: "Protocolo", statement: PROTOCOLO.observed, quotes: [expect.objectContaining({ text: "Anota o protocolo, por favor." })] })])
    expect(message.communicatedRefs).toEqual(["A1"])
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("acerto de rotina (validação, saudação, despedida) fica nos detalhes")
  })
})

describe("`RECOGNITION_MATERIALS_V1` — retorno sem ponto a ajustar mostra os documentos dos acertos", () => {
  it("sem ajuste, 'Materiais utilizados' traz os documentos da base dos acertos confirmados (argumentário, não); com ajuste, nada muda", () => {
    const titular = finding({ ref: "S2", findingKey: "CALL:i:KC-titular", kind: "STRENGTH", status: "MET", title: "Validação do titular", criterionKeys: ["KC-titular"], quotes: [{ speaker: "OPERATOR", text: "Pode confirmar o CPF do titular?", turn: "T3" }], rules: [
      { text: "Confirmar o CPF do titular.", section: "Validação", documentId: "doc-cadastro", documentTitle: "Procedimento — Cadastro" },
      rule("Protocolo", "Informar o número do protocolo."),
      { text: "Pode confirmar o CPF?", section: "Pontos obrigatórios na fala", documentId: "script", documentTitle: "Argumentário: Validação", sourceKind: "ARGUMENT_SCRIPT" },
    ] })
    const recognition = { ...brief(), developments: [], strengths: [PROTOCOLO, titular], materials: [], tone: "RECOGNITION" } as FeedbackBrief
    expect(feedbackViewOf(recognition, { card: "", paragraphs: ["Parabéns."], sentences: [], communicatedRefs: ["S1"] }).materials).toEqual([
      { documentId: "doc", title: "Procedimento Operacional — Contestação de Contas Móvel", href: null, usedIn: ["Protocolo", "Validação do titular"], sections: ["Protocolo"] },
      { documentId: "doc-cadastro", title: "Procedimento — Cadastro", href: null, usedIn: ["Validação do titular"], sections: ["Validação"] },
    ])
    // Com ponto a ajustar, o material continua sendo só o que sustenta o ajuste (aqui o brief não tem nenhum): o acerto não entra.
    expect(feedbackViewOf({ ...brief(), strengths: [PROTOCOLO, titular] } as FeedbackBrief, { card: "", paragraphs: ["x"], sentences: [], communicatedRefs: ["A1", "S1"] }).materials).toEqual([])
  })
})

describe("introdução curta do retorno (redator V31)", () => {
  it("o redator abre com o que o cliente precisava e o ponto principal, sem frase genérica sobre o retorno", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Comece com uma introdução curta, de uma ou duas frases, que situe a pessoa")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("qual é o ponto principal deste retorno (primaryPoint)")
    expect(COMPOSITION_SYSTEM_PROMPT).not.toMatch(/\d+\s*palavras/)
  })
})

describe("parágrafo que se entende sozinho (redator V32)", () => {
  it("cada parágrafo abre dizendo de que momento da chamada fala — exemplos só do jeito certo", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Cada parágrafo abre dizendo de que momento da chamada ele fala")
    expect(COMPOSITION_SYSTEM_PROMPT).not.toContain("Esse resumo")
  })
})

describe("retorno sem ponto a ajustar (redator V33)", () => {
  it("vira reconhecimento: abre dizendo que seguiu o que a operação pede (parabéns) e destaca o que fez diferença, com a fala", () => {
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Retorno sem ponto a ajustar (nenhum A-n; whatTheFactsContain RECOGNITION): o retorno é um reconhecimento")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("pode dar os parabéns")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("Isso vale quando há o que ajustar")
    expect(COMPOSITION_SYSTEM_PROMPT).toContain("o título do ponto é rótulo interno")
  })
})
