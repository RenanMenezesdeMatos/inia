import type { FeedbackBestPractices } from "../../best-practices/domain/feedback-section.js"
import type { BriefBasePractice, FeedbackBrief } from "./feedback-brief.js"

/**
 * BOAS PRÁTICAS DA BASE NO TEXTO DO FEEDBACK (`BASE_PRACTICES_IN_TEXT_V1`, 22/10/2026). A mesma seção que vira o bloco "Oportunidades
 * inspiradas em boas práticas" é escolhida ANTES da redação e chega ao redator e ao verificador como fatos B-n: o texto pode ligar o
 * ponto daquele assunto (ou o resultado do indicador) à prática de quem tem melhor resultado, sempre como sugestão opcional. Os textos
 * são do sistema (nome, como fazer, associação com os números, o que as chamadas da pessoa mostram); a fala sugerida só entra por [[B-n]].
 */
/** V2 (22/10/2026, pedido do usuário depois da 1ª monitoria real): o redator recebe a comparação EM PALAVRAS (`whereItShowsUp`) e o que
 * as chamadas da pessoa mostram em palavras (`youInWords`) — nunca a frase técnica (período, operadores, chamadas, porcentagens), que
 * fica para o verificador e para o bloco. */
/** V3 (22/10/2026, pedido do usuário no TMA da Larissa): o fato B-n leva o que o resultado mede (`result`, do cadastro) e o texto pode
 * ligar a prática ao indicador pelo efeito DIRETO da ação ("esse tempo sai da chamada, que é o que o TMA mede") — nunca prometendo o
 * resultado ("melhora seu TMA", "o tempo vai cair"). A aprovação da prática não muda. */
/** V4 (22/10/2026, `BEST_PRACTICE_HOW_IT_HELPS_V1`, decisão do usuário): substitui a V3. O texto só liga a prática ao resultado com o
 * "Como isso ajuda no resultado" aprovado na revisão (`howItHelps`); sem ele, só o que a ação faz pelo cliente. Na 1ª rodada real da V3
 * (TMA da Larissa) o verificador recusou a ligação "pelo efeito direto", que não tinha fato que a sustentasse. */
export const BASE_PRACTICES_IN_TEXT_VERSION = "BASE_PRACTICES_IN_TEXT_V4" as const

type Item = FeedbackBestPractices["items"][number]
const lowerFirst = (text: string) => text.replace(/^\p{Lu}(?!\p{Lu})/u, (letter) => letter.toLowerCase())

/** "Melhor resultado" desta prática, em palavras: operadores do 1º quartil do indicador ou chamadas boas × ruins do sinal. */
function outcomeOf(item: Item): string {
  if (item.source?.outcomeKind === "CALL_SIGNAL") return `chamadas com resultado bom × ruim em ${item.source.outcomeName}`
  return `operadores com melhor ${item.source?.outcomeName ?? item.indicatorName} × os demais`
}

/** "bem mais" quando os melhores fazem pelo menos o dobro (ou a referência quase não faz); senão "mais". Sem as taxas (seção antiga): "mais". */
function howMuchMoreOf(item: Item): string {
  const top = item.comparison?.topRatePercent ?? null
  const reference = item.comparison?.referenceRatePercent ?? null
  if (top === null || reference === null) return "mais"
  return reference <= 5 || top >= reference * 2 ? "bem mais" : "mais"
}

/** `BASE_PRACTICES_IN_TEXT_V2`: onde a prática aparece mais, em palavras — sem período, contagem nem porcentagem (o bloco mostra os números). */
function whereItShowsUpOf(item: Item, subject: string): string {
  const more = howMuchMoreOf(item)
  const outcome = item.source?.outcomeName ?? item.indicatorName
  if (item.source?.outcomeKind === "CALL_SIGNAL") return `Nas chamadas de ${subject} com resultado bom em ${lowerFirst(outcome)}, isso aparece ${more} do que nas com resultado ruim.`
  return `Entre quem tem o melhor ${outcome} em ${subject}, isso aparece ${more} do que entre os demais.`
}

/** O que as chamadas da pessoa mostram, em palavras (sem "1 de 4"); sem análise delas ou sem a situação, nada. */
function youInWordsOf(item: Item): string | null {
  if (item.youKind === "OFTEN") return "Nas suas chamadas analisadas, você já faz isso na maior parte das vezes."
  if (item.youKind === "SOMETIMES") return "Nas suas chamadas analisadas, isso apareceu só em parte das vezes."
  if (item.youKind === "RARELY") return "Nas suas chamadas analisadas, isso quase não apareceu."
  return null
}

/** Seção da base → fatos B-n (B1, B2…), na ordem da seção. Sem seção = nenhum fato (o caso do redator fica como antes). */
export function basePracticesOf(section: FeedbackBestPractices | null | undefined): BriefBasePractice[] {
  return (section?.items ?? []).map((item, index) => {
    const subject = item.source?.subjectLabel ?? item.context
    return {
      ref: `B${index + 1}`,
      patternId: item.patternId,
      name: item.name,
      howTo: item.guidance ?? item.howTo.replace(/\s*\(O diferencial é[^)]*\)\s*$/u, "").trim(),
      subject,
      outcome: outcomeOf(item),
      association: item.association,
      whereItShowsUp: whereItShowsUpOf(item, subject),
      strength: item.strength,
      you: item.youKind === "NOT_ANALYZED" || (!item.youKind && /não estavam nesta análise/u.test(item.you)) ? null : item.you,
      youInWords: youInWordsOf(item),
      suggestedPhrasing: item.suggestedPhrasing,
      notApplicableWhen: item.notApplicableWhen,
      ...(item.product ? { product: item.product } : {}),
      ...(item.howItHelps ? { howItHelps: item.howItHelps } : {}),
    }
  })
}

/**
 * Produtos ESTABELECIDOS no caso (`PRODUCT_IN_FEEDBACK_V1`, para a escolha das práticas — `BEST_PRACTICE_SELECTION_V2`): na monitoria, os
 * produtos que a análise da chamada identificou e o de cada ponto; no indicador, o produto da solicitação de cada fala de exemplo dos
 * padrões. Nada estabelecido = lista vazia (só práticas gerais).
 */
export function establishedProductsOfBrief(brief: Pick<FeedbackBrief, "productScope" | "developments" | "strengths">): string[] {
  const findings = [...brief.developments, ...brief.strengths]
  const names = [
    ...(brief.productScope?.identified ?? []).map((entry) => entry.name),
    ...findings.flatMap((finding) => (finding.product ? [finding.product] : [])),
    ...findings.flatMap((finding) => finding.quotes.flatMap((quote) => (quote.call?.product ? [quote.call.product] : []))),
  ]
  const byKey = new Map<string, string>()
  for (const name of names.map((entry) => entry.trim()).filter((entry) => entry.length > 0)) if (!byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name)
  return [...byKey.values()]
}

/** Padrões que o texto publicado CITOU (frases mantidas com a ref B-n): a aplicação do feedback não os repete na conclusão. */
export function citedPracticeIdsOf(brief: Pick<FeedbackBrief, "basePractices">, communicatedRefs: readonly string[]): string[] {
  const refs = new Set(communicatedRefs.map((ref) => ref.trim().toUpperCase()))
  return (brief.basePractices ?? []).filter((practice) => refs.has(practice.ref)).map((practice) => practice.patternId)
}
