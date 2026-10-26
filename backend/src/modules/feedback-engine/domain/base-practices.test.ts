import { describe, expect, it } from "vitest"
import "../testing/no-external-ai.js"
import { withCitedInText, type FeedbackBestPractices } from "../../best-practices/domain/feedback-section.js"
import { basePracticesOf, citedPracticeIdsOf, establishedProductsOfBrief } from "./base-practices.js"
import { applyVerdicts, parseWriterDraft, repairInstructionsOf, resolveDraftQuotes, usefulnessOf, type Verdict } from "./composition.js"
import { BASE_PRACTICES_VERIFIER_RULES, BASE_PRACTICES_WRITER_RULES, COMPOSITION_REMINDER, compositionPayloadOf, renderCompositionUserTurn, renderVerificationUserTurn, verificationFactsOf } from "./composition-prompt.js"
import type { BriefFinding, FeedbackBrief } from "./feedback-brief.js"
import { nonLiteralQuotesOf } from "./literal-quotes.js"

/**
 * `BASE_PRACTICES_IN_TEXT_V1` — zero IA. A prática da base escolhida para o caso chega ao redator como fato B-n (só quando existe: sem
 * prática, o turno é o de antes, palavra por palavra); a fala sugerida entra só por [[B1]], exata; B-n só orienta ou situa; prática não
 * usada é pedida na reescrita; o bloco marca o que o texto citou.
 */
const finding = (overrides: Partial<BriefFinding>): BriefFinding => ({ ref: "", findingKey: "k", kind: "DEVELOPMENT", origin: "CRITERION", title: "t", materiality: "HIGH", status: "NOT_MET", observed: "x", reading: null, quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [], ...overrides })
const EXPLICAR = finding({ ref: "A1", findingKey: "CALL:i:KC-explicar", title: "Explicar a cobrança", quotes: [{ speaker: "OPERATOR", text: "É isso aí, a fatura vem assim mesmo.", turn: "T8" }], rules: [{ text: "Explicar ao cliente cada item da fatura contestado.", section: "Explicação", documentId: "doc", documentTitle: "Procedimento — Segunda via" }] })
const PROTOCOLO = finding({ ref: "S1", findingKey: "CALL:i:KC-protocolo", kind: "STRENGTH", status: "MET", title: "Protocolo", quotes: [{ speaker: "OPERATOR", text: "Anota o protocolo, por favor.", turn: "T15" }], rules: [{ text: "Informar o número do protocolo.", section: "Protocolo", documentId: "doc", documentTitle: "Procedimento — Segunda via" }] })
const caseBrief = (overrides: Partial<FeedbackBrief> = {}): FeedbackBrief => ({ domain: "MONITORING", label: "Segunda via", heading: { title: "Segunda via", subtitle: "Atendimento de 21/10/2026" }, context: ["O cliente pediu a segunda via da fatura."], officialLines: [], developments: [EXPLICAR], strengths: [PROTOCOLO], limitations: [], materials: [], tone: "MIXED", suppressed: [], ...overrides }) as unknown as FeedbackBrief

const SECTION: FeedbackBestPractices = {
  version: "BEST_PRACTICE_FEEDBACK_V3",
  title: "Oportunidades inspiradas em boas práticas",
  note: "…",
  items: [
    { patternId: "p-explica", name: "Checar compreensão oferecendo explicar de outra forma", indicatorName: "Nota da URA", context: "Segunda via", association: "Nas chamadas comparáveis de Segunda via analisadas (01/09/2026 a 31/10/2026), o comportamento apareceu em 72% das chamadas com resultado bom em Nota da URA em que a situação existiu (8 operadores, 32 chamadas) e em 22% das chamadas com resultado ruim (8 operadores, 32 chamadas).", strength: "Forte", you: "Suas chamadas não estavam nesta análise: não há evidência sobre como você faz isso hoje.", youKind: "NOT_ANALYZED", howTo: "Pergunte se ficou claro. (O diferencial é o que vai além da etapa obrigatória: oferecer explicar de outro jeito.)", guidance: "Ao terminar de explicar, pergunte se ficou claro e ofereça explicar de outro jeito.", differential: "oferecer explicar de outro jeito.", suggestedPhrasing: "Ficou claro? Se quiser, eu explico de outro jeito.", notApplicableWhen: null, comparison: { topRatePercent: 72, referenceRatePercent: 22 }, source: { population: "GROUP", populationName: "B2C · Atendimento Geral", context: "SUB_REASON", subjectLabel: "Segunda via", outcomeName: "Nota da URA", outcomeKind: "CALL_SIGNAL", text: "Das chamadas de Segunda via com resultado bom em Nota da URA, no seu grupo (B2C · Atendimento Geral)." } },
    { patternId: "p-tma", name: "Retomar resumindo o que foi verificado", indicatorName: "TMA", context: "Fatura", association: "Nas chamadas comparáveis de Fatura analisadas (01/09/2026 a 30/09/2026), o comportamento apareceu em 80% …", strength: "Moderada", you: "Nas suas chamadas analisadas, o comportamento apareceu em 1 de 4 em que a situação existiu.", youKind: "RARELY", howTo: "Ao voltar de uma verificação, diga o que conferiu.", suggestedPhrasing: null, notApplicableWhen: "Quando o cliente já encerrou.", source: { population: "SUBGROUP", populationName: "Célula A", context: "REASON", subjectLabel: "Fatura", outcomeName: "TMA", outcomeKind: "INDICATOR", text: "Dos operadores com melhor TMA do seu subgrupo (Célula A), em chamadas de Fatura." } },
  ],
}
const withPractices = (overrides: Partial<FeedbackBrief> = {}) => caseBrief({ basePractices: basePracticesOf(SECTION), ...overrides })
const ok = (id: string): [string, Verdict] => [id, { id, verdict: "SUPPORTED", specific: true, repeats: null, note: null }]
function decided(sentences: { text: string; stance: string; refs: string[] }[], brief: FeedbackBrief) {
  const parsed = parseWriterDraft(JSON.stringify({ sentences: sentences.map((sentence) => ({ ...sentence, paragraph: 1 })), card: { text: "Explique cada item da fatura.", refs: ["A1"] } }))
  if (!parsed.ok) throw new Error(parsed.error)
  return applyVerdicts(resolveDraftQuotes(parsed.draft, brief), brief, new Map([...sentences.map((_, index) => ok(`F${index + 1}`)), ok("CARD")]))
}
const ADJUST = { text: "Quando o cliente perguntou da cobrança, você respondeu [[Q1]], sem explicar o item.", stance: "ADJUSTMENT", refs: ["A1"] }

describe("BASE_PRACTICES_IN_TEXT_V1/V2 — a prática da base vira fato do caso", () => {
  it("cada item da seção vira B-n com os textos do sistema: como fazer sem o detalhe técnico, o resultado em palavras e 'you' nulo sem análise", () => {
    const [signal, indicator] = basePracticesOf(SECTION)
    expect(signal).toEqual({ ref: "B1", patternId: "p-explica", name: "Checar compreensão oferecendo explicar de outra forma", howTo: "Ao terminar de explicar, pergunte se ficou claro e ofereça explicar de outro jeito.", subject: "Segunda via", outcome: "chamadas com resultado bom × ruim em Nota da URA", association: SECTION.items[0]!.association, whereItShowsUp: "Nas chamadas de Segunda via com resultado bom em nota da URA, isso aparece bem mais do que nas com resultado ruim.", strength: "Forte", you: null, youInWords: null, suggestedPhrasing: "Ficou claro? Se quiser, eu explico de outro jeito.", notApplicableWhen: null })
    // V2: a comparação e o que as chamadas da pessoa mostram vão EM PALAVRAS (sem as taxas, seção antiga: "mais").
    expect(indicator).toMatchObject({ ref: "B2", outcome: "operadores com melhor TMA × os demais", subject: "Fatura", whereItShowsUp: "Entre quem tem o melhor TMA em Fatura, isso aparece mais do que entre os demais.", you: "Nas suas chamadas analisadas, o comportamento apareceu em 1 de 4 em que a situação existiu.", youInWords: "Nas suas chamadas analisadas, isso quase não apareceu.", notApplicableWhen: "Quando o cliente já encerrou." })
    // Seção gravada antes da V2 (sem `guidance`/`youKind`): o como fazer perde o detalhe técnico e o aviso de fora da análise vira nulo.
    const v1Item = Object.fromEntries(Object.entries(SECTION.items[0]!).filter(([key]) => !["guidance", "youKind", "source"].includes(key))) as FeedbackBestPractices["items"][number]
    const legacy = basePracticesOf({ ...SECTION, items: [v1Item] })[0]!
    expect(legacy).toMatchObject({ howTo: "Pergunte se ficou claro.", you: null, subject: "Segunda via", outcome: "operadores com melhor Nota da URA × os demais" })
    expect(basePracticesOf(null)).toEqual([])
  })

  it("sem prática, o turno do redator e o do verificador são os de antes, palavra por palavra", () => {
    const brief = caseBrief()
    expect(renderCompositionUserTurn(brief, null)).toBe(["CASO (JSON):", JSON.stringify(compositionPayloadOf(brief), null, 1), "", COMPOSITION_REMINDER].join("\n"))
    expect(Object.keys(compositionPayloadOf(brief).facts)).not.toContain("basePractices")
    expect(Object.keys(verificationFactsOf(brief))).not.toContain("basePractices")
    expect(renderVerificationUserTurn(brief, [])).not.toContain("BOAS PRÁTICAS DA BASE")
    // Lista vazia é o mesmo que nenhuma prática.
    expect(renderCompositionUserTurn(caseBrief({ basePractices: [] }), null)).toBe(renderCompositionUserTurn(brief, null))
  })

  it("com prática, os fatos B-n e as regras entram no turno do redator e no do verificador", () => {
    const brief = withPractices()
    const facts = compositionPayloadOf(brief).facts as unknown as { basePractices: Record<string, unknown>[] }
    expect(facts.basePractices[0]).toEqual({ ref: "B1", howTo: "Ao terminar de explicar, pergunte se ficou claro e ofereça explicar de outro jeito.", subject: "Segunda via", whereItShowsUp: "Nas chamadas de Segunda via com resultado bom em nota da URA, isso aparece bem mais do que nas com resultado ruim.", you: null, suggestedPhrasing: "Ficou claro? Se quiser, eu explico de outro jeito." })
    expect(facts.basePractices[1]).toMatchObject({ ref: "B2", you: "Nas suas chamadas analisadas, isso quase não apareceu.", notApplicableWhen: "Quando o cliente já encerrou." })
    expect(facts.basePractices[1]).not.toHaveProperty("suggestedPhrasing")
    // V2 (pedido do usuário): ao redator nunca vão período, contagem, porcentagem, a frase técnica nem o nome do padrão.
    const writerFacts = JSON.stringify(facts.basePractices)
    for (const technical of ["01/09/2026", "operadores", "%", "chamadas comparáveis", "o comportamento apareceu", "Checar compreensão oferecendo explicar de outra forma", "1 de 4"]) expect(writerFacts).not.toContain(technical)
    // O verificador continua com a associação e os números, para conferir a comparação em palavras.
    expect(JSON.stringify(verificationFactsOf(brief))).toContain(SECTION.items[0]!.association)
    expect(renderCompositionUserTurn(brief, null)).toContain(BASE_PRACTICES_WRITER_RULES)
    expect(renderCompositionUserTurn(brief, null).endsWith(COMPOSITION_REMINDER)).toBe(true)
    expect(renderVerificationUserTurn(brief, [])).toContain(BASE_PRACTICES_VERIFIER_RULES)
    // Decisão do usuário (22/10/2026): sem ponto a ajustar, os parabéns primeiro e no máximo uma prática no fim.
    expect(BASE_PRACTICES_WRITER_RULES).toContain("os parabéns vêm primeiro e inteiros; no fim, no máximo UMA prática")
  })
})

describe("BASE_PRACTICES_IN_TEXT_V1 — no texto: fala exata, só orientação, pedida na reescrita", () => {
  it("[[B1]] coloca a fala sugerida exata, entre aspas, e ela vale como literal; a frase com B1 em GUIDANCE fica", () => {
    const brief = withPractices()
    const result = decided([ADJUST, { text: "Ao terminar de explicar, vale experimentar perguntar se ficou claro: nas chamadas de Segunda via com nota da URA boa, isso apareceu em 72% das chamadas, contra 22% nas de nota ruim. Por exemplo: [[B1]]", stance: "GUIDANCE", refs: ["B1"] }], brief)
    expect(result.sentences[1]).toMatchObject({ kept: true, text: "Ao terminar de explicar, vale experimentar perguntar se ficou claro: nas chamadas de Segunda via com nota da URA boa, isso apareceu em 72% das chamadas, contra 22% nas de nota ruim. Por exemplo: “Ficou claro? Se quiser, eu explico de outro jeito.”" })
    expect(nonLiteralQuotesOf(result.sentences[1]!.text, brief)).toEqual([])
    // Sem a prática no caso, a mesma fala entre aspas não é literal de nada.
    expect(nonLiteralQuotesOf(result.sentences[1]!.text, caseBrief())).toEqual(["Ficou claro? Se quiser, eu explico de outro jeito."])
  })

  it("B-n nunca é ajuste nem reconhecimento; referência sem fala, ref solta ou desconhecida = código interno, recusado", () => {
    const brief = withPractices()
    const [asAdjustment, asRecognition, noPhrasing, bare] = decided([
      { text: "Você deixou de perguntar se ficou claro.", stance: "ADJUSTMENT", refs: ["A1", "B1"] },
      { text: "Você perguntou se ficou claro.", stance: "RECOGNITION", refs: ["B1"] },
      { text: "Ao voltar de uma verificação, vale dizer o que conferiu: [[B2]]", stance: "GUIDANCE", refs: ["B2"] },
      { text: "Vale experimentar a prática B1 nas próximas chamadas.", stance: "GUIDANCE", refs: ["B1"] },
    ], brief).sentences
    expect(asAdjustment!.reasons).toContain("STANCE_REF_MISMATCH")
    expect(asRecognition!.reasons).toContain("STANCE_REF_MISMATCH")
    expect(noPhrasing!.reasons).toContain("INTERNAL_REFERENCE")
    expect(bare!.reasons).toContain("INTERNAL_REFERENCE")
    expect(decided([{ text: "Vale perguntar se ficou claro.", stance: "GUIDANCE", refs: ["B1"] }], caseBrief()).sentences[0]!.reasons).toContain("UNKNOWN_REF")
  })

  it("prática do caso que nenhuma frase usa é pedida na reescrita — com ajuste, ligada ao ponto; só parabéns, no fim, uma no máximo", () => {
    const brief = withPractices()
    const kept = decided([ADJUST], brief).sentences.filter((sentence) => sentence.kept)
    const usefulness = usefulnessOf(brief, kept)
    expect(usefulness.missingBasePractice).toEqual(["B1", "B2"])
    expect(repairInstructionsOf([], usefulness, brief).join("\n")).toContain("Inclua ao menos uma no momento da chamada em que ela cabia, depois do que a regra pede")
    expect(repairInstructionsOf([], usefulness, brief).join("\n")).not.toContain("Checar compreensão oferecendo explicar de outra forma")
    const recognition = withPractices({ developments: [], tone: "RECOGNITION" })
    const praised = decided([{ text: "Parabéns: você informou o protocolo, como a operação pede.", stance: "RECOGNITION", refs: ["S1"] }], recognition).sentences.filter((sentence) => sentence.kept)
    expect(repairInstructionsOf([], usefulnessOf(recognition, praised), recognition).join("\n")).toContain("Depois dos parabéns, no fim, inclua no máximo uma como um passo a mais")
    // Usada: nada a pedir. Sem prática no caso: nada a pedir.
    const used = decided([ADJUST, { text: "Ao terminar de explicar, vale experimentar perguntar se ficou claro.", stance: "GUIDANCE", refs: ["B1"] }], brief).sentences.filter((sentence) => sentence.kept)
    expect(usefulnessOf(brief, used).missingBasePractice).toBeUndefined()
    expect(usefulnessOf(caseBrief(), kept).missingBasePractice).toBeUndefined()
  })

  it("o bloco marca as práticas que o texto citou; nenhuma citada = a seção como está", () => {
    const brief = withPractices()
    expect(citedPracticeIdsOf(brief, ["A1", "b1", "S1"])).toEqual(["p-explica"])
    const marked = withCitedInText(SECTION, citedPracticeIdsOf(brief, ["A1", "B1"]))
    expect(marked.items.map((item) => item.citedInText ?? false)).toEqual([true, false])
    expect(withCitedInText(SECTION, [])).toBe(SECTION)
  })
})

describe("BEST_PRACTICE_SELECTION_V2 no motor — produto do caso e da prática", () => {
  it("os produtos estabelecidos do caso saem da análise da chamada, do ponto e das falas de exemplo; nada estabelecido = vazio", () => {
    const brief = caseBrief({
      productScope: { identified: [{ request: "Q1", name: "Banda Larga", kind: "PRODUCT" }], undetermined: 0, rulesNotEstablished: [] },
      developments: [{ ...EXPLICAR, product: "IP Dedicado", quotes: [{ speaker: "OPERATOR", text: "O prazo é de 24 horas.", turn: "T3", call: { product: "banda larga", rule: { text: "Prazo", documentId: "d" } as never } }] }],
    })
    expect(establishedProductsOfBrief(brief)).toEqual(["Banda Larga", "IP Dedicado"])
    expect(establishedProductsOfBrief(caseBrief())).toEqual([])
  })

  it("a prática 'deste produto' chega ao redator e ao verificador com product, e as regras dizem que ela só se liga a esse produto", () => {
    const section: FeedbackBestPractices = { ...SECTION, items: [{ ...SECTION.items[0]!, product: "Banda Larga" }, SECTION.items[1]!] }
    const brief = caseBrief({ basePractices: basePracticesOf(section) })
    const writer = compositionPayloadOf(brief).facts as unknown as { basePractices: { ref: string; product?: string }[] }
    const verifier = verificationFactsOf(brief) as unknown as { basePractices: { ref: string; product?: string }[] }
    for (const facts of [writer, verifier]) expect(facts.basePractices.map((practice) => practice.product ?? null)).toEqual(["Banda Larga", null])
    expect(BASE_PRACTICES_WRITER_RULES).toMatch(/product: .*nunca de outro/)
    expect(BASE_PRACTICES_VERIFIER_RULES).toMatch(/product ligada a um ponto, fala ou chamada de outro produto é CONTRADICTION/)
  })
})

describe("BASE_PRACTICES_IN_TEXT_V4 — ligar a prática ao resultado só com o texto aprovado na revisão", () => {
  it("o 'como ajuda no resultado' aprovado chega ao redator e ao verificador; sem ele, nada (e nada de outro fato no lugar)", () => {
    const howItHelps = "O cliente não precisa ficar anotando o protocolo na linha, e esse tempo sai da chamada."
    const section: FeedbackBestPractices = { ...SECTION, items: [{ ...SECTION.items[0]!, howItHelps }, SECTION.items[1]!] }
    const brief = caseBrief({ basePractices: basePracticesOf(section) })
    const writer = compositionPayloadOf(brief).facts as unknown as { basePractices: Record<string, unknown>[] }
    const verifier = verificationFactsOf(brief) as unknown as { basePractices: Record<string, unknown>[] }
    for (const facts of [writer, verifier]) {
      expect(facts.basePractices.map((practice) => practice.howItHelps ?? null)).toEqual([howItHelps, null])
      expect(facts.basePractices.every((practice) => !("result" in practice))).toBe(true)
    }
  })

  it("o redator só liga a prática ao resultado com howItHelps e nunca promete; o verificador trata howItHelps como fato", () => {
    expect(BASE_PRACTICES_WRITER_RULES).toMatch(/Sem howItHelps, nunca ligue a prática ao resultado/)
    expect(BASE_PRACTICES_WRITER_RULES).toMatch(/Nunca prometa o resultado/)
    expect(BASE_PRACTICES_WRITER_RULES).not.toMatch(/efeito DIRETO/)
    expect(BASE_PRACTICES_VERIFIER_RULES).toMatch(/howItHelps é FATO aprovado por quem revisou a prática.*SUPPORTED/)
    expect(BASE_PRACTICES_VERIFIER_RULES).toMatch(/ligar a prática ao resultado sem howItHelps, ou prometer o resultado .* é OVERREACH/)
    // A regra geral não contradiz a nova: "vai melhorar" segue recusado; "como ajuda, como em howItHelps" não.
    expect(BASE_PRACTICES_VERIFIER_RULES).toMatch(/vai melhorar o resultado .* é OVERREACH — dizer como ela ajuda, como em howItHelps, não é/)
  })
})
