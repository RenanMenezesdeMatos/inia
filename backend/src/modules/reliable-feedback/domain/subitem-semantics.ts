import { operationalStateIn } from "./action-semantics.js"

/**
 * V1.7.1j — SEMÂNTICA DOS SUBITENS de uma etapa composta (`SUBITEM_SEMANTICS_V1`, detectores determinísticos, sem LLM).
 *
 * No smoke V1.7.1i o subitem "Valor" da recapitulação foi dado como COMPROVADAMENTE AUSENTE porque a palavra "valor" não foi dita
 * — mas a operadora disse "R$ 9,90 por mês". Presença é fácil de provar; ausência tem ônus maior. Cada subitem recebe um TIPO
 * (pela redação literal do item) e o tipo tem um detector POSITIVO sobre a fala; a ausência só vale para tipos cujo detector é
 * confiável (`reliableAbsence`) — os demais ficam UNKNOWN quando não encontrados, nunca "ausentes".
 *
 *   VALUE            dinheiro: "R$ 9,90", "9,90", "10 reais", "nove reais", "nove e noventa" (este só com contexto de cobrança);
 *   AMOUNT_DUE       dinheiro + pagamento na mesma fala ("o valor a pagar é R$ 50,00");
 *   DEADLINE         "prazo" (não negado) ou duração com marcador ("em até 5 dias", "dias úteis") — "dois meses" solto não é prazo;
 *   PROTOCOL         "protocolo" ou número longo em blocos;
 *   RETURN_CHANNEL   V1.7.1l — RELAÇÃO explícita retorno/acompanhamento + canal ("o retorno será enviado por SMS", "vamos
 *                    enviar por e-mail", "acompanhe pelo aplicativo", "vamos te ligar"). Canal solto não basta: "seu telefone
 *                    de contato continua sendo…" é CONTATO cadastral, nunca canal de retorno (`returnChannelEvidenceOf`); canal +
 *                    retorno sem relação reconhecida é AMBÍGUO — não é observado e impede afirmar ausência;
 *   ADJUSTED_ACCOUNT conta/fatura ajustada, corrigida, nova, reemitida, segunda via;
 *   (sem ausência confiável) CANCELED_SERVICE, CONTESTED_ITEM, ACTION_TAKEN, ACCOUNT, ACTIVATION_DATE, CONTRACT_CHANNEL,
 *   RECURRENCE, PRIOR_CHARGES — presença por detector; e LEXICAL (item sem tipo): presença pelas palavras do item.
 */
export const SUBITEM_SEMANTICS_VERSION = "SUBITEM_SEMANTICS_V1" as const

export type SubItemKind =
  | "VALUE" | "AMOUNT_DUE" | "DEADLINE" | "PROTOCOL" | "RETURN_CHANNEL" | "ADJUSTED_ACCOUNT"
  | "CANCELED_SERVICE" | "CONTESTED_ITEM" | "ACTION_TAKEN" | "ACCOUNT" | "ACTIVATION_DATE" | "CONTRACT_CHANNEL" | "RECURRENCE" | "PRIOR_CHARGES"
  | "LEXICAL"

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const NUMBER_WORDS = "um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos"
const TENS = "dez|onze|doze|treze|quatorze|catorze|quinze|dezesseis|dezessete|dezoito|dezenove|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa"
const MONTHS = "janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro"
const CHARGE_CONTEXT = /(?<!\p{L})(?:conta|cobranc\p{L}*|valor|fatura|pag\p{L}*|reais|mes|mensal\p{L}*|assinatura|mensalidade)(?!\p{L})/u

const MONEY: RegExp[] = [
  /r\$\s?\d/u,
  /(?<![\d,])\d{1,5},\d{2}(?![\d,])/u,
  /(?<!\p{L})\d+(?:,\d+)?\s*reais(?!\p{L})/u,
  new RegExp(`(?<!\\p{L})(?:${NUMBER_WORDS})\\s+reais(?!\\p{L})`, "u"),
]
const SPOKEN_CENTS = new RegExp(`(?<!\\p{L})(?:${NUMBER_WORDS})\\s+e\\s+(?:${TENS})(?!\\p{L})`, "u")
const hasMoney = (text: string) => MONEY.some((pattern) => pattern.test(text)) || (SPOKEN_CENTS.test(text) && CHARGE_CONTEXT.test(text))

const DEADLINE: RegExp[] = [
  new RegExp(`(?<!\\p{L})(?:em|ate|dentro\\s+de|prazo\\s+de|daqui\\s+a|no\\s+maximo)\\s+(?:\\d+|${NUMBER_WORDS})\\s+(?:dias?|horas?|semanas?|meses|mes)(?!\\p{L})`, "u"),
  /dias?\s+uteis/u,
  /(?<!\p{L})ate\s+(?:o\s+)?dia\s+\d{1,2}(?!\d)/u,
]
const DEADLINE_WORD = /(?<!\p{L})prazos?(?!\p{L})/u
const NEGATED_DEADLINE = /(?<!\p{L})(?:nao|sem)\s+(?:\p{L}+\s+){0,4}prazos?(?!\p{L})/u
const hasDeadline = (text: string) => DEADLINE.some((pattern) => pattern.test(text)) || (DEADLINE_WORD.test(text) && !NEGATED_DEADLINE.test(text))

const CHANNEL_TERMS = String.raw`sms|e-?mail|whatsapp|aplicativo|app|correio|mensagem(?:\s+de\s+texto)?|ligacao|telefone|celular|site|chat|area\s+(?:logada|do\s+cliente)`
const CHANNEL = new RegExp(`(?<!\\p{L})(?:${CHANNEL_TERMS})(?!\\p{L})`, "u")
/** Canal introduzido como MEIO ("por SMS", "pelo aplicativo", "no seu e-mail", "via WhatsApp"). */
const CHANNEL_AS_MEANS = new RegExp(`(?<!\\p{L})(?:por|pelo|pela|via|no|na|em)\\s+(?:(?:seu|sua|o|a|um|uma|nosso|nossa)\\s+)?(?:${CHANNEL_TERMS})(?!\\p{L})`, "u")
/** Retorno / acompanhamento / envio (a RELAÇÃO que o item "canal de retorno" pede). "contato" sozinho não é retorno. */
const RETURN_TERM = /(?<!\p{L})(?:retorn\p{L}*|resposta|resultado|avis\p{L}*|comunic\p{L}*|envi\p{L}*|mand\p{L}*|receb\p{L}*|acompanh\p{L}*|notific\p{L}*|disponi\p{L}*|entr\p{L}*\s+em\s+contato)(?!\p{L})/u
/** Ligação futura para o cliente ("vamos te ligar", "ligaremos", "eles te ligam") — o próprio verbo é canal + retorno. */
const CALLBACK = /(?<!\p{L})(?:(?:vamos|vao|vai|iremos|irao|vou|eles|ela|ele)\s+(?:te\s+|lhe\s+|pra\s+voce\s+)?ligar|(?:te|lhe)\s+ligam|ligaremos)(?!\p{L})/u
/** Dado cadastral de contato ("seu telefone de contato continua sendo o (11) 9…") — confirma cadastro, não informa retorno. */
const CONTACT_INFORMATION = /(?<!\p{L})(?:(?:seu|sua|teu|tua)\s+(?:telefone|celular|numero|e-?mail|whatsapp|endereco)|(?:telefone|celular|numero|e-?mail)\s+(?:de\s+)?contato|continua\s+(?:sendo|o\s+mesmo|a\s+mesma))(?!\p{L})/u

/** V1.7.1l — CONTACT_INFORMATION ≠ RETURN_CHANNEL: o que uma fala (já dobrada) prova sobre o canal de retorno. */
export type ReturnChannelEvidence = "RETURN_CHANNEL" | "CONTACT_INFORMATION" | "AMBIGUOUS" | null
export function returnChannelEvidenceOf(folded: string): ReturnChannelEvidence {
  if (CALLBACK.test(folded) || (RETURN_TERM.test(folded) && CHANNEL_AS_MEANS.test(folded))) return "RETURN_CHANNEL"
  if (!CHANNEL.test(folded)) return null
  if (CONTACT_INFORMATION.test(folded)) return "CONTACT_INFORMATION"
  return RETURN_TERM.test(folded) ? "AMBIGUOUS" : null
}

/** `blocksAbsence` (V1.7.1l): a fala não prova o item, mas deixa dúvida — a ausência não pode ser afirmada (fica UNKNOWN). */
type Detector = { matches: (text: string) => boolean; reliableAbsence: boolean; blocksAbsence?: (text: string) => boolean }
/** Objetos de um cancelamento de serviço (recorrência, renovação, assinatura, pacote, plano, serviço). */
const CANCELLATION_OBJECTS = ["recorrencia", "renovacao", "assinatura", "mensalidade", "servico", "pacote", "plano", "adicional"]
/** V1.7.1k — o cancelamento aparece na fala por AÇÃO do operador ou só como ESTADO descrito. */
export const cancellationEvidenceOf = (text: string) => operationalStateIn("CANCEL", CANCELLATION_OBJECTS, [fold(text)])
const DETECTORS: Record<Exclude<SubItemKind, "LEXICAL">, Detector> = {
  VALUE: { matches: hasMoney, reliableAbsence: true },
  AMOUNT_DUE: { matches: (text) => hasMoney(text) && /(?<!\p{L})(?:pagar|pague|pagamento|a\s+pagar|pago)(?!\p{L})/u.test(text), reliableAbsence: true },
  DEADLINE: { matches: hasDeadline, reliableAbsence: true },
  PROTOCOL: { matches: (text) => /(?<!\p{L})protocolo(?!\p{L})/u.test(text) || /(?<!\d)\d{4}\s?\d{4}\s?\d{4}(?!\d)/u.test(text), reliableAbsence: true },
  RETURN_CHANNEL: { matches: (text) => returnChannelEvidenceOf(text) === "RETURN_CHANNEL", reliableAbsence: true, blocksAbsence: (text) => returnChannelEvidenceOf(text) === "AMBIGUOUS" },
  ADJUSTED_ACCOUNT: { matches: (text) => /(?:conta|fatura)s?\s+(?:ajustad\p{L}*|corrigid\p{L}*|reemitid\p{L}*|nova)|nova\s+(?:conta|fatura)|segunda\s+via/u.test(text), reliableAbsence: true },
  // V1.7.1k — ação do operador ("desativei a renovação") OU estado descrito ("a renovação do pacote já foi tirada", "ficou
  // desativada"), com o objeto na mesma fala. O item é "Serviço cancelado" (um ESTADO): o estado basta para o item; quem executou
  // fica em `agency` (`cancellationEvidenceOf`).
  CANCELED_SERVICE: { matches: (text) => cancellationEvidenceOf(text).observed, reliableAbsence: false },
  CONTESTED_ITEM: { matches: (text) => /(?<!\p{L})(?:contest\p{L}*|reclama\p{L}*)/u.test(text), reliableAbsence: false },
  ACTION_TAKEN: { matches: (text) => /(?<!\p{L})(?:abri|registrei|desativei|cancelei|tirei|removi|solicitei|encaminhei|bloqueei|ajustei|lancei|protocolei|verifiquei|estornei)(?!\p{L})/u.test(text), reliableAbsence: false },
  ACCOUNT: { matches: (text) => new RegExp(`(?:conta|fatura)s?\\s+(?:de|do|da)\\s+(?:${MONTHS})`, "u").test(text), reliableAbsence: false },
  ACTIVATION_DATE: { matches: (text) => new RegExp(`(?<!\\p{L})dia\\s+\\d{1,2}(?!\\d)|\\d{1,2}/\\d{1,2}|\\d{1,2}\\s+de\\s+(?:${MONTHS})`, "u").test(text), reliableAbsence: false },
  CONTRACT_CHANNEL: { matches: (text) => /(?<!\p{L})(?:pel[oa]|por|via)\s+(?:site|aplicativo|app|sms|telefone|loja|mensagem|link|internet)/u.test(text), reliableAbsence: false },
  RECURRENCE: { matches: (text) => /(?<!\p{L})(?:por\s+mes|mensal\p{L}*|recorren\p{L}*|renova\p{L}*|assinatura)/u.test(text), reliableAbsence: false },
  PRIOR_CHARGES: { matches: (text) => new RegExp(`(?:conta|fatura|cobranca)s?\\s+(?:de|do|da)\\s+(?:${MONTHS})|anterior(?:es)?|mes\\s+passado`, "u").test(text), reliableAbsence: false },
}

/** Tipo do subitem pela redação literal do item (ordem importa: "valor a pagar" antes de "valor"). */
export function subItemKindOf(itemText: string): SubItemKind {
  const text = fold(itemText)
  if (/valor\s+a\s+pagar/.test(text)) return "AMOUNT_DUE"
  if (/conta\s+ajustad/.test(text)) return "ADJUSTED_ACCOUNT"
  if (/canal\s+de\s+(?:retorno|disponibiliza)/.test(text)) return "RETURN_CHANNEL"
  if (/canal\s+de\s+contrata/.test(text)) return "CONTRACT_CHANNEL"
  if (/(?<!\p{L})prazo/u.test(text)) return "DEADLINE"
  if (/protocolo/.test(text)) return "PROTOCOL"
  if (/cancelad/.test(text)) return "CANCELED_SERVICE"
  if (/contestad|lancamento/.test(text)) return "CONTESTED_ITEM"
  if (/acao\s+realizada/.test(text)) return "ACTION_TAKEN"
  if (/data\s+de\s+ativa/.test(text)) return "ACTIVATION_DATE"
  if (/recorrencia/.test(text)) return "RECURRENCE"
  if (/cobrancas?\s+anteriores/.test(text)) return "PRIOR_CHARGES"
  if (/^conta(?!\p{L})/u.test(text)) return "ACCOUNT"
  if (/(?<!\p{L})valor(?!\p{L})/u.test(text)) return "VALUE"
  return "LEXICAL"
}

/** O detector do tipo encontra o subitem na fala? (null = tipo sem detector: LEXICAL). */
export function subItemMatches(kind: SubItemKind, text: string): boolean | null {
  return kind === "LEXICAL" ? null : DETECTORS[kind].matches(fold(text))
}
/** V1.7.1l — a fala deixa dúvida sobre o item (nem prova, nem permite afirmar ausência)? */
export const subItemBlocksAbsence = (kind: SubItemKind, text: string) => kind !== "LEXICAL" && (DETECTORS[kind].blocksAbsence?.(fold(text)) ?? false)
/** A ausência deste tipo pode ser afirmada (detector confiável)? */
export const reliableAbsenceOf = (kind: SubItemKind) => kind !== "LEXICAL" && DETECTORS[kind].reliableAbsence

// ---------------------------------------------------------------------------------------------
// APLICABILIDADE do subitem (SUBITEM_APPLICABILITY_V1) — antes de dizer que um item faltou, ele precisava EXISTIR naquele momento
// ---------------------------------------------------------------------------------------------

/**
 * Alguns tipos de subitem só existem DEPOIS de um RESULTADO da tratativa: a conta ajustada só existe se um ajuste foi feito (ou a
 * emissão foi registrada); o valor a pagar só está definido quando o resultado saiu. A base diz isso ("quando o processo permitir",
 * "conforme processamento") — a condição vem do TIPO do item (mesmo vocabulário fechado dos detectores), nunca de um rótulo avulso.
 * Tipos sem pré-condição: sem mudança (a ausência segue a regra de sempre).
 */
export type SubItemPrecondition = "RESOLUTION_OUTCOME"
const PRECONDITION: Partial<Record<SubItemKind, SubItemPrecondition>> = { ADJUSTED_ACCOUNT: "RESOLUTION_OUTCOME", AMOUNT_DUE: "RESOLUTION_OUTCOME" }
export const subItemPreconditionOf = (kind: SubItemKind): SubItemPrecondition | null => PRECONDITION[kind] ?? null

/**
 * Estado do RESULTADO da tratativa pelas falas do operador (determinístico, vocabulário fechado):
 *   CONCLUDED  houve ajuste/correção/estorno/crédito, ou a emissão da conta ajustada foi anunciada ("será emitida", "fica
 *              disponível") — mesmo com análise ainda correndo (retirada temporária);
 *   PENDING    o resultado depende de uma análise em aberto ("se for aprovada", "após a análise", "a análise leva…",
 *              "pra equipe analisar");
 *   UNKNOWN    a conversa não mostra nem um nem outro.
 * Conclusão observada vence pendência (ajuste parcial já feito + análise do resto).
 */
export type ResolutionOutcomeState = "CONCLUDED" | "PENDING" | "UNKNOWN"
const OUTCOME_CONCLUDED: RegExp[] = [
  /(?<!\p{L})(?:ajustei|corrigi|estornei|creditei|retirei|abati|descontei|reembolsei|devolvi)(?!\p{L})/u,
  /(?:conta|fatura)s?\s+(?:ajustad\p{L}*|corrigid\p{L}*|reemitid\p{L}*)\s+(?:\p{L}+\s+){0,4}(?:foi|sera|vai\s+ser|esta|fica|ficara|saira|chega)(?!\p{L})/u,
  /(?:nova|segunda)\s+(?:conta|fatura|via)\s+(?:\p{L}+\s+){0,3}(?:foi|sera|vai\s+ser|esta|fica|ficara|chega)(?!\p{L})/u,
  /(?<!\p{L})valor\s+(?:ja\s+)?(?:foi\s+)?(?:retirad|abatid|estornad|creditad|devolvid|corrigid)\p{L}*/u,
]
const OUTCOME_PENDING: RegExp[] = [
  /(?<!\p{L})se\s+(?:a\s+(?:contestacao|analise|solicitacao)\s+)?(?:for|forem|ficar)\s+(?:aprovad|procedent|aceit|deferid)\p{L}*/u,
  /(?<!\p{L})(?:apos|depois\s+d[aeo]s?|quando\s+(?:sair|terminar|concluir|finalizar)\s+(?:a|o))\s+(?:a\s+|o\s+)?(?:analise|resultado)/u,
  /(?<!\p{L})aguard\p{L}*\s+(?:a\s+|o\s+)?(?:analise|resultado|retorno)/u,
  /(?<!\p{L})(?:a\s+)?analise\s+(?:leva|demora|sera\s+concluida|vai\s+levar|fica\s+pronta)/u,
  /(?<!\p{L})(?:pra|para)\s+(?:a\s+)?(?:equipe|area|setor|time)\s+(?:\p{L}+\s+){0,3}(?:analisar|avaliar|verificar)(?!\p{L})/u,
]
export function resolutionOutcomeStateOf(operatorTexts: readonly string[]): { state: ResolutionOutcomeState; evidence: string | null } {
  const concluded = operatorTexts.find((text) => OUTCOME_CONCLUDED.some((pattern) => pattern.test(fold(text))))
  if (concluded) return { state: "CONCLUDED", evidence: concluded }
  const pending = operatorTexts.find((text) => OUTCOME_PENDING.some((pattern) => pattern.test(fold(text))))
  return pending ? { state: "PENDING", evidence: pending } : { state: "UNKNOWN", evidence: null }
}

/**
 * O que o operador deveria COMUNICAR, em linguagem de comportamento (nunca o rótulo do checklist): uma frase por TIPO, a partir do
 * mesmo vocabulário fechado dos detectores. Tipo sem frase (LEXICAL e afins) = o próprio texto da regra entre aspas.
 */
const COMMUNICATE: Partial<Record<SubItemKind, string>> = {
  VALUE: "o valor contestado",
  AMOUNT_DUE: "o valor que o cliente deverá pagar",
  DEADLINE: "o prazo",
  PROTOCOL: "o número do protocolo",
  RETURN_CHANNEL: "por onde o cliente receberá o retorno",
  ADJUSTED_ACCOUNT: "como ficou a conta após o ajuste",
  CANCELED_SERVICE: "qual serviço foi cancelado",
  CONTESTED_ITEM: "qual lançamento foi contestado",
  ACTION_TAKEN: "o que foi feito no atendimento",
  ACCOUNT: "qual conta foi analisada",
}
export function communicateClauseOf(itemText: string): string {
  return COMMUNICATE[subItemKindOf(itemText)] ?? `“${itemText.replace(/,\s*(?:quando|se|caso|desde\s+que)(?!\p{L}).*$/iu, "").trim()}”`
}
