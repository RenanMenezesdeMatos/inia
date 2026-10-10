import { inlineEnumerationOf, isListLine, stripListMarker } from "../../knowledge/domain/knowledge-list.js"
import { closingSectionRoleOf } from "../../knowledge/domain/section-roles.js"
import { isUnderstandingCheckStep, stepActionOf } from "./action-semantics.js"

/**
 * V1.7.1m — IDENTIDADE CANÔNICA DO COMPORTAMENTO (`CANONICAL_BEHAVIOR_V1`, domínio puro, vocabulário FECHADO, sem LLM).
 *
 * SOURCE CHECKPOINT ≠ OPERATIONAL BEHAVIOR. O mesmo comportamento operacional aparece em várias fontes oficiais — "Forneci
 * protocolo?" (checklist do procedimento) e "(2) informe o número do protocolo" (checklist transversal) são UMA conduta:
 * PROVIDE_PROTOCOL. No smoke V1.7.1l cada fonte virou um ponto do feedback e uma observação analítica — a mesma chamada contava
 * duas vezes para o mesmo fato. Aqui cada etapa verificada recebe o comportamento que ela representa (ou nenhum, quando a
 * redação não bate com o catálogo — nada é adivinhado), e as fontes do mesmo comportamento convergem (`process-assessment.ts`).
 *
 *   PROVIDE_PROTOCOL          fornecer/informar/passar o protocolo ("Registrar protocolo" é outra coisa: registrar ≠ informar);
 *   CONFIRM_UNDERSTANDING     a ação canônica da V1.7.1l (`isUnderstandingCheckStep`);
 *   INFORM_DEADLINE           informar/explicar o prazo — FACETAS: DEADLINE sempre, RETURN_CHANNEL ("canal de retorno"),
 *                             NEXT_STEP ("próximo passo") — a faceta é preservada: fontes que acrescentam uma dimensão continuam
 *                             visíveis como suporte (nunca se perde informação para reduzir quantidade);
 *   RECAPITULATE_INTERACTION  recapitular ("Recapitulei as ações?") ou a lista da seção de recapitulação (etapa composta);
 *   CONFIRM_SOLUTION          confirmar a solução aplicada;
 *   CANCEL_RECURRING_SERVICE  ação CANCEL × objeto RECURRENCE (`action-semantics.ts`);
 *   VALIDATE_HOLDER · IDENTIFY_CHARGE · CHECK_PAYMENT · OPEN_ANALYSIS · REGISTER_DISPUTE.
 *
 * Conteúdo "evitar" não tem comportamento canônico aqui (é outra conduta: a formulação proibida), e uma lista composta só é
 * classificada pela SEÇÃO de recapitulação — nunca pelas palavras dos itens (a recapitulação cita "protocolo" e "prazo").
 */
export const CANONICAL_BEHAVIOR_VERSION = "CANONICAL_BEHAVIOR_V1" as const

export const CANONICAL_BEHAVIORS = [
  "PROVIDE_PROTOCOL", "CONFIRM_UNDERSTANDING", "INFORM_DEADLINE", "RECAPITULATE_INTERACTION", "CONFIRM_SOLUTION", "CANCEL_RECURRING_SERVICE",
  "VALIDATE_HOLDER", "IDENTIFY_CHARGE", "CHECK_PAYMENT", "OPEN_ANALYSIS", "REGISTER_DISPUTE",
] as const
export type CanonicalBehavior = (typeof CANONICAL_BEHAVIORS)[number]
export type BehaviorFacet = "DEADLINE" | "RETURN_CHANNEL" | "NEXT_STEP"

/** Título comportamental exibido ao colaborador (nunca "Checklist do operador"). */
export const BEHAVIOR_TITLES: Record<CanonicalBehavior, string> = {
  PROVIDE_PROTOCOL: "Protocolo",
  CONFIRM_UNDERSTANDING: "Confirmação de entendimento",
  INFORM_DEADLINE: "Prazo da análise",
  RECAPITULATE_INTERACTION: "Recapitulação",
  CONFIRM_SOLUTION: "Confirmação da solução aplicada",
  CANCEL_RECURRING_SERVICE: "Cancelamento da recorrência",
  VALIDATE_HOLDER: "Validação do titular",
  IDENTIFY_CHARGE: "Identificação da cobrança",
  CHECK_PAYMENT: "Verificação do pagamento",
  OPEN_ANALYSIS: "Abertura de análise",
  REGISTER_DISPUTE: "Registro da contestação",
}
/** Seção de fechamento cuja lista composta é a representação AUTORITATIVA do comportamento (completude, subitens). */
export const COMPOSITE_SECTION_ROLE: Partial<Record<CanonicalBehavior, "RECAP">> = { RECAPITULATE_INTERACTION: "RECAP" }

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim()
const PROVIDE = /(?<!\p{L})(?:forne\p{L}*|inform\p{L}*|pass\p{L}*|entreg\p{L}*|diga|dizer|dar|dei|deu|anot\p{L}*)(?!\p{L})/u
const EXPLAIN = /(?<!\p{L})(?:inform\p{L}*|explic\p{L}*|expliqu\p{L}*|comunic\p{L}*|orient\p{L}*|pass\p{L}*|diga|dizer)(?!\p{L})/u
const DEADLINE = /(?<!\p{L})prazos?(?!\p{L})/u

export type BehaviorIdentity = { version: typeof CANONICAL_BEHAVIOR_VERSION; behavior: CanonicalBehavior; facets: BehaviorFacet[] }

export function canonicalBehaviorOf(input: {
  /** Item de lista escolhido pela citação (literal), quando a citação é um item. */
  step: string | null | undefined
  /** Regra verificada (a citação, só a parte normativa). */
  quote: string | null | undefined
  heading: string | null | undefined
  documentTitle?: string
  contentKind?: string | null
  /** A regra é uma lista composta (etapa com subitens)? */
  composite?: boolean
}): BehaviorIdentity | null {
  if (input.contentKind === "DO_NOT_CONTENT") return null
  const raw = (input.step ?? input.quote ?? "").trim()
  if (raw.length === 0) return null
  const identity = (behavior: CanonicalBehavior, facets: BehaviorFacet[] = []): BehaviorIdentity => ({ version: CANONICAL_BEHAVIOR_VERSION, behavior, facets })
  const sectionRole = closingSectionRoleOf(input.heading ?? "", input.documentTitle ?? "")
  // Lista composta: só a SEÇÃO decide (os itens da recapitulação citam protocolo e prazo e não são essas condutas).
  // Lista de vários itens citada inteira (em linhas ou achatada: "…explique: - Qual conta…; - Qual cobrança…") também: os itens
  // não são a conduta da etapa.
  // V1.7.1n — a enumeração EM LINHA ("…: (1) …; (2) …; (3) …; (4) …") também é lista: citada inteira, nenhum item decide (no smoke
  // V1.7.1m o "(4) confirme…dúvida" da mesma string reclassificou a etapa "(3) explique o próximo passo e o prazo").
  const listItems = (input.step ? 0 : raw.split(/\r?\n/).filter((line) => isListLine(line)).length + (raw.match(/[:;]\s*[-•*+]\s+\S/g) ?? []).length + raw.split(/\r?\n/).reduce((total, line) => total + (isListLine(line) ? 0 : inlineEnumerationOf(line)?.items.length ?? 0), 0))
  if (input.composite || listItems >= 2) return sectionRole === "RECAP" ? identity("RECAPITULATE_INTERACTION") : null
  const text = fold(stripListMarker(raw))
  if (isUnderstandingCheckStep(raw, { understandingSection: sectionRole === "UNDERSTANDING_CHECK" })) return identity("CONFIRM_UNDERSTANDING")
  if (/(?<!\p{L})recapitul\p{L}*/u.test(text)) return identity("RECAPITULATE_INTERACTION")
  if (/(?<!\p{L})protocolo(?!\p{L})/u.test(text) && PROVIDE.test(text) && !/(?<!\p{L})registr\p{L}*\s+(?:o\s+)?protocolo/u.test(text)) return identity("PROVIDE_PROTOCOL")
  if (DEADLINE.test(text) && EXPLAIN.test(text)) {
    const facets: BehaviorFacet[] = ["DEADLINE"]
    if (/canal(?:\s+de)?\s+(?:retorno|acompanhamento)|(?<!\p{L})retorno(?!\p{L})/u.test(text)) facets.push("RETURN_CHANNEL")
    if (/proximo\s+passo/u.test(text)) facets.push("NEXT_STEP")
    return identity("INFORM_DEADLINE", facets)
  }
  if (/solucao\s+aplicada/u.test(text) && /(?<!\p{L})confirm\p{L}*/u.test(text)) return identity("CONFIRM_SOLUTION")
  const action = stepActionOf(raw)
  if (action.family === "CANCEL" && action.objectClasses.includes("RECURRENCE")) return identity("CANCEL_RECURRING_SERVICE")
  if (/(?<!\p{L})(?:valid\p{L}*|confirm\p{L}*)\s+(?:o\s+|a\s+)?(?:titular|titularidade|identidade\s+do\s+titular)(?!\p{L})/u.test(text)) return identity("VALIDATE_HOLDER")
  if (/(?<!\p{L})identifi\p{L}*\s+(?:o\s+|a\s+)?(?:lancamento|cobranca)/u.test(text) || /(?<!\p{L})qual\s+cobranca\s+nao\s+reconhece/u.test(text)) return identity("IDENTIFY_CHARGE")
  if (/(?<!\p{L})(?:conta|fatura)s?\s+(?:ja\s+)?(?:foi|foram)\s+pag/u.test(text)) return identity("CHECK_PAYMENT")
  if (/(?<!\p{L})(?:abr\p{L}*|abertura\s+de)\s+(?:a\s+|uma\s+)?analise(?!\p{L})/u.test(text)) return identity("OPEN_ANALYSIS")
  if (/(?<!\p{L})registr\p{L}*\s+(?:a\s+)?contestac/u.test(text)) return identity("REGISTER_DISPUTE")
  return null
}
