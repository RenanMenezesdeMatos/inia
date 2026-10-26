import type { GuidanceItem } from "./guidance.js"
import type { SelectedFrom } from "./selection-levels.js"

/**
 * SEÇÃO DO FEEDBACK "Oportunidades inspiradas em boas práticas" (`BEST_PRACTICE_FEEDBACK_V1`) — montada pelo SISTEMA a partir da
 * base (nunca escrita pelo redator do feedback), separada do cumprimento do processo (que é o texto do feedback). Só padrões
 * disponíveis do indicador e do contexto do caso; o que a pessoa faz, só com evidência das chamadas dela; a fala é sugestão.
 * Na leitura, item cujo padrão deixou de estar disponível (desativado, rejeitado, evidência enfraquecida) some.
 * V2 (22/10/2026, `BEST_PRACTICE_SELECTION_V1`): cada item diz de onde veio (`source`: população, assunto, resultado); seção V1
 * gravada antes continua válida, sem `source`.
 * V3 (22/10/2026, `BASE_PRACTICES_IN_TEXT_V1`): a seção é escolhida ANTES da redação e o texto do feedback pode citar a prática; o item
 * que o texto citou leva `citedInText` (a aplicação do feedback não a repete na conclusão). V1 e V2 gravadas continuam válidas.
 * Campos opcionais da V3, sem mudar o formato: `product` (`BEST_PRACTICE_SELECTION_V2`) e `howItHelps` (`BEST_PRACTICE_HOW_IT_HELPS_V1`).
 */
export const BEST_PRACTICE_FEEDBACK_VERSION = "BEST_PRACTICE_FEEDBACK_V3" as const
const READABLE_VERSIONS: readonly string[] = ["BEST_PRACTICE_FEEDBACK_V1", "BEST_PRACTICE_FEEDBACK_V2", BEST_PRACTICE_FEEDBACK_VERSION]
export const MAX_FEEDBACK_PRACTICES = 2

export type FeedbackBestPracticeItem = {
  patternId: string
  name: string
  indicatorName: string
  context: string
  association: string
  strength: string
  you: string
  howTo: string
  suggestedPhrasing: string | null
  notApplicableWhen: string | null
  /** De onde veio (V2): "Dos operadores com melhor TMA do seu grupo (…), em chamadas de Segunda via." */
  source?: SelectedFrom
  /** Para a tela (V2): a orientação, o que vai além da etapa obrigatória e o tipo de evidência das chamadas da pessoa. */
  guidance?: string
  differential?: string | null
  youKind?: GuidanceItem["youKind"]
  /** V3: o texto do feedback citou esta prática. */
  citedInText?: boolean
  /** V3: as taxas do contexto principal (melhores × referência), para o texto dizer a comparação em palavras. */
  comparison?: GuidanceItem["comparison"]
  /** `BEST_PRACTICE_SELECTION_V2`: a prática foi vista só nas chamadas deste produto (nome do cadastro); ausente = geral. */
  product?: string
  /** `BEST_PRACTICE_HOW_IT_HELPS_V1`: como a prática ajuda no resultado, aprovado na revisão — o único fundamento para o texto do feedback
   * ligar a prática ao indicador ou ao sinal. Ausente = sem texto aprovado (ou seção gravada antes). */
  howItHelps?: string
}
export type FeedbackBestPractices = { version: string; title: string; note: string; items: FeedbackBestPracticeItem[] }

export function feedbackBestPracticesOf(practices: readonly { item: GuidanceItem; indicatorName: string; from?: SelectedFrom; product?: string | null }[]): FeedbackBestPractices | null {
  const items = practices.slice(0, MAX_FEEDBACK_PRACTICES).map(({ item, indicatorName, from, product }) => ({ patternId: item.patternId, name: item.name, indicatorName, context: item.contexts.join(" · "), association: item.association, strength: item.strength, you: item.you, howTo: item.howTo, suggestedPhrasing: item.suggestedPhrasing, notApplicableWhen: item.notApplicableWhen, guidance: item.guidance, differential: item.additionalBehavior, youKind: item.youKind, comparison: item.comparison, ...(from ? { source: from } : {}), ...(product ? { product } : {}), ...(item.howItHelps ? { howItHelps: item.howItHelps } : {}) }))
  if (items.length === 0) return null
  return {
    version: BEST_PRACTICE_FEEDBACK_VERSION,
    title: "Oportunidades inspiradas em boas práticas",
    note: "Não é cumprimento de processo: são comportamentos opcionais observados com mais frequência entre operadores com melhores resultados, em chamadas comparáveis. É associação, não garantia de resultado. A sugestão de fala é um exemplo para experimentar, não uma fala de nenhuma chamada.",
    items,
  }
}

/** V3: marca os itens que o texto publicado citou (padrões das frases mantidas com a ref B-n). Nenhum citado = a seção como está. */
export function withCitedInText(section: FeedbackBestPractices, citedPatternIds: readonly string[]): FeedbackBestPractices {
  if (citedPatternIds.length === 0) return section
  const cited = new Set(citedPatternIds)
  return { ...section, items: section.items.map((item) => (cited.has(item.patternId) ? { ...item, citedInText: true } : item)) }
}

export const isFeedbackBestPractices = (value: unknown): value is FeedbackBestPractices => Boolean(value) && typeof value === "object" && READABLE_VERSIONS.includes(String((value as { version?: unknown }).version)) && Array.isArray((value as { items?: unknown }).items)
