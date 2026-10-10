import { cleanSectionHeading, itemTopicLabelOf } from "./process-items.js"
import { gerundOf, imperativeOf, inflectAction, isInfinitive, nominalizeAction, preteriteOf, toInfinitiveAction } from "./portuguese-verbs.js"
import { contentWords, sharedWords } from "./structured-anchor.js"
import { familyOfAction, type ActionFamily } from "./action-semantics.js"
import { communicateClauseOf } from "./subitem-semantics.js"

/** V1.7.1k — famílias que são ATO DE FALA (a própria conversa as mostra). */
const SPEECH_ACT_FAMILIES: readonly ActionFamily[] = ["INFORM", "CONFIRM", "ASK"]
import { LEADING_LIST_MARKER } from "../../knowledge/domain/knowledge-list.js"

/**
 * V1.7.1e — FEEDBACK BEHAVIOR-FIRST (domínio puro, sem modelo).
 *
 *   CHECKPOINT   linguagem INTERNA (nome canônico da etapa, `CHECKPOINT_LABEL_V2`) — continua no banco, no QA técnico e no analytics;
 *   COMPORTAMENTO linguagem do FEEDBACK — o que o operador fez ou deixou de fazer, com as falas e a regra;
 *   PROCESSO      a evidência que sustenta o comportamento (regra literal + documento + seção + link).
 *
 * Aqui ficam as peças determinísticas da apresentação: o RÓTULO do assunto do achado (título do bloco) e as frases de
 * comportamento do texto de segurança. Tudo derivado da regra literal verificada, das falas verificadas e do tipo da evidência —
 * nunca paráfrase livre. Sem suporte suficiente, a frase cai para uma formulação conservadora que só cita a regra.
 */
export const BEHAVIOR_PRESENTATION_VERSION = "BEHAVIOR_PRESENTATION_V1" as const

type KnowledgeLike = { quote: string; /** V1.7.1k — item de lista escolhido pela citação. */ step?: string | null; heading: string | null; leadIn?: string | null; contentKind?: string | null; detail?: { quote: string; contentKind?: string | null } | null; operativeRule?: { quote: string } | null } | null | undefined
export type BehaviorItemLike = { section: string; process?: { /** V1.7.1m */ behavior?: { title: string } | null; /** V1.7.3 — ausência verificada mostrada pela frase do sistema (não há "momento abaixo"). */ absenceShown?: boolean; stepTitle?: string | null; requirement?: string | null; evidenceType?: string | null; completeness?: { status: string; /** V1.7.1k */ family?: string; observed: readonly string[]; absent: readonly string[]; /** SUBITEM_APPLICABILITY_V1 */ notApplicable?: readonly string[] } | null } | null; knowledge?: KnowledgeLike }

/** V1.7.1k — marcador da representação canônica de lista ("-", "•", "1.", "2)", "(3)"). */
const LIST_LINE = LEADING_LIST_MARKER
const CONDITION_TAIL = /,\s*(?:quando|se|caso|desde\s+que)\b.*$/iu
const capitalize = (text: string) => (text.length > 0 ? text[0]!.toLocaleUpperCase("pt-BR") + text.slice(1) : text)
const lowerFirst = (text: string) => (text.length > 1 && /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLocaleLowerCase("pt-BR") + text.slice(1) : text)
// V1.7.1m — "?" final também sai: item de checklist ("Confirmei se restaram dúvidas?") vira ação, nunca "…dúvidas?.".
const clean = (text: string) => text.replace(/[*_`]/g, "").replace(LIST_LINE, "").replace(/[“”"«»]/g, "").replace(/\s+/g, " ").trim().replace(/[;:.,!?]+$/, "").trim()
const linesOf = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0 && line !== "…" && line !== "...")
const joinAnd = (values: readonly string[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`)

/** Tira do começo da regra quem faz ("O operador deverá") e advérbios de frequência — o resto é a AÇÃO no infinitivo. */
const SUBJECT_PREFIX = /^(?:o|a)\s+(?:operador|operadora|atendente|colaborador|colaboradora)\s+(?:dever[áa]|deve|precisa|precisar[áa])\s+/iu
const ADVERB_PREFIX = /^(?:sempre|obrigatoriamente|também)\s+/iu

/** `condition` (V1.7.1f): circunstância literal que abre a regra ("antes de encerrar") — o momento de aplicar. */
export type RuleAction = { action: string; items: string[]; interrogativeItems: boolean; condition: string | null; /** V1.7.1p — todos os itens são PERGUNTAS DIRETAS da base ("“As informações ficaram claras?”"). */ directQuestions?: boolean }
const LEADING_CONDITION = /^((?:antes|depois)\s+de\s+[^,:]+|ao\s+[^,:]+|quando\s+[^,:]+),\s*(.+)$/iu
const INTERROGATIVE = /^(?:qual|quais|quando|como|onde|quanto|quantos|quantas|o\s+que|por\s+que|se)\b/iu
/** V1.7.1p — item que é PERGUNTA DIRETA (termina em "?", com ou sem aspas). */
const DIRECT_QUESTION = /\?\s*[”"»]?\s*[;.,]?\s*$/u
/**
 * V1.7.1p — itens depois da ação. Pergunta direta da base vira pergunta INDIRETA (a mesma pergunta, sem inventar nada):
 * sim/não → "se as informações ficaram claras"; com palavra interrogativa → "qual cobrança…". Nunca "perguntando as
 * informações ficaram claras".
 */
function itemsAfterAction(rule: RuleAction, separator: string): string {
  if (rule.items.length === 0) return ""
  if (!rule.directQuestions) return `${separator}${joinAnd(rule.items)}`
  return ` ${joinAnd(rule.items.map((item) => (INTERROGATIVE.test(item) ? item : `se ${item}`)))}`
}

/**
 * AÇÃO de uma regra literal: "O operador deverá informar o prazo exibido na ferramenta." → "informar o prazo exibido na
 * ferramenta"; "O operador deverá permitir que o cliente explique: - Qual conta…; - Qual cobrança…" → ação "permitir que o
 * cliente explique" + itens; "1. Cancelar a recorrência, quando permitido;" → "cancelar a recorrência, quando permitido".
 * Nenhuma ação reconhecível (não começa com verbo no infinitivo) → null.
 */
export function ruleActionOf(text: string | null | undefined): RuleAction | null {
  if (!text) return null
  const lines = linesOf(text)
  const listLines = lines.filter((line) => LIST_LINE.test(line))
  const leadLines = lines.filter((line) => !LIST_LINE.test(line))
  const head = listLines.length > 0 && leadLines.length > 0 ? leadLines[0]! : lines.length === 1 || listLines.length === 0 ? lines.join(" ") : listLines.length === 1 ? listLines[0]! : null
  if (!head) return null
  let body = clean(head).replace(SUBJECT_PREFIX, "").replace(ADVERB_PREFIX, "")
  // V1.7.1f — lista ACHATADA numa linha ("Antes de encerrar, informar: Conta analisada; Lançamento contestado; …").
  let inlineItems: string[] = []
  let inlineRaw: string[] = []
  const inline = listLines.length === 0 ? /^([^:]+):\s*(.+;.+)$/u.exec(body) : null
  if (inline) { body = inline[1]!.trim(); inlineRaw = inline[2]!.split(";").filter((item) => clean(item).length > 0); inlineItems = inlineRaw.map((item) => lowerFirst(clean(item))) }
  // V1.7.1f — circunstância literal no começo ("Antes de encerrar, informar") = QUANDO aplicar; a ação é o que vem depois.
  let condition: string | null = null
  const leading = LEADING_CONDITION.exec(body)
  if (leading && isInfinitive(leading[2]!.split(/\s+/)[0])) { condition = lowerFirst(leading[1]!.trim()); body = leading[2]! }
  // V1.7.1k — etapa de checklist no IMPERATIVO ("confirme a solução aplicada") = a mesma ação no infinitivo (só verbo conhecido).
  const action = toInfinitiveAction(lowerFirst(body))
  if (!action) return null
  const rawItems = listLines.length > 0 && leadLines.length > 0 ? listLines.filter((line) => clean(line).length > 0) : inlineRaw
  const items = listLines.length > 0 && leadLines.length > 0 ? rawItems.map((line) => lowerFirst(clean(line))) : inlineItems
  const directQuestions = items.length > 0 && rawItems.every((line) => DIRECT_QUESTION.test(line))
  return { action, items, interrogativeItems: items.length > 0 && items.every((item) => INTERROGATIVE.test(item)), condition, ...(directQuestions ? { directQuestions } : {}) }
}

/**
 * RÓTULO DO ASSUNTO do achado (título do bloco no feedback) — nunca "Ponto forte", "Etapa 1" nem o texto cru da etapa:
 *   1. etapa que é UM item de lista de procedimento começando por verbo conhecido → substantivo ("Cancelar a recorrência" →
 *      "Cancelamento da recorrência");
 *   2. senão o título da SEÇÃO do documento, sem numeração ("35. Prazo da análise" → "Prazo da análise");
 *   3. senão o nome canônico da etapa; senão null.
 */
export function presentationLabelOf(item: BehaviorItemLike): string | null {
  // V1.7.1m — comportamento canônico: o título comportamental ("Protocolo", "Prazo da análise"), nunca "Checklist do operador".
  if (item.process?.behavior?.title) return item.process.behavior.title
  const knowledge = item.knowledge ?? null
  const step = item.process?.stepTitle ?? null
  const quoteLines = knowledge ? linesOf(knowledge.quote) : []
  const singleListStep = quoteLines.filter((line) => LIST_LINE.test(line)).length === 1 && quoteLines.every((line) => LIST_LINE.test(line) || line.endsWith(":") || line === "…")
  // Item de lista citado sem o marcador ("Explicar prazo;"), reconhecido pela frase de abertura da lista no documento.
  const leadInStep = quoteLines.length === 1 && !quoteLines[0]!.endsWith(":") && Boolean(knowledge?.leadIn)
  // V1.7.4 — etapa longa ou com oração ("Informar que o consumo… e que…") não vira título: fragmento de regra nunca é assunto
  // quando a seção tem nome — o título da seção ("Reparo móvel") é o assunto humano.
  // V1.7.4 — item com rótulo próprio ("Promessas: Não garanta…"): o rótulo é o assunto.
  const topic = step ? itemTopicLabelOf(step) : null
  if (topic) return topic
  const actionText = step ? clean(step).replace(CONDITION_TAIL, "") : ""
  const shortAction = actionText.split(/\s+/).length <= 7 && !/(?<!\p{L})que(?!\p{L})/iu.test(actionText) && !/^(?:n[ãa]o|nunca)\s/iu.test(actionText)
  if (step && (singleListStep || leadInStep) && shortAction) {
    // Nome gravado antes da V1.7.1d pode trazer a numeração da lista ("1. Cancelar…"): limpa antes de nomear o assunto.
    const action = lowerFirst(clean(step).replace(CONDITION_TAIL, ""))
    const nominal = nominalizeAction(toInfinitiveAction(action) ?? action)
    if (nominal) return capitalize(nominal.phrase)
  }
  const heading = knowledge?.heading ? cleanSectionHeading(knowledge.heading) : ""
  if (heading.length > 0) return capitalize(heading)
  return step
}

/** Como a fala do operador é apresentada: pergunta ("Você perguntou") ou fala ("Você disse") — pela pontuação da própria fala. */
export const speechIntroOf = (text: string) => (/\?/.test(text) ? "Você perguntou" : "Você disse")

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim()
/**
 * Frases da lista "Evitar" (literal da base) que aparecem LITERALMENTE na fala do operador (comparação sem acento/pontuação).
 * Devolve a frase como está na base, sem aspas/ponto final — "É só aguardar".
 */
export function avoidedPhrasesIn(operatorTexts: readonly string[], avoidTexts: readonly string[]): string[] {
  const speech = operatorTexts.map(fold)
  const phrases = avoidTexts.flatMap((text) => linesOf(text).filter((line) => LIST_LINE.test(line)).map(clean)).filter((phrase) => fold(phrase).split(" ").length >= 2)
  return [...new Set(phrases.filter((phrase) => speech.some((value) => ` ${value} `.includes(` ${fold(phrase)} `))))]
}

const quoted = (text: string) => `“${text}”`

export type BehaviorWording = { observed: string | null; whatYouCanDo: string | null }

/**
 * FRASES DE COMPORTAMENTO (texto de segurança V5). `operatorTexts` = falas verificadas do operador; `official` = há regra
 * verificada e orientação oficial. `null` = sem suporte para a frase (quem chama usa a formulação conservadora).
 */
export function behaviorWordingOf(item: BehaviorItemLike, operatorTexts: readonly string[], official: boolean): BehaviorWording {
  const knowledge = item.knowledge ?? null
  if (!knowledge) return { observed: null, whatYouCanDo: null }
  const evidenceType = item.process?.evidenceType ?? null
  // V1.7.1k — citação "abertura + item" (checklist em linha): a ação é a do ITEM escolhido, nunca a abertura.
  const citedQuote = knowledge.contentKind === "DO_NOT_CONTENT" || knowledge.contentKind === "EXAMPLE_CONTENT" ? null : knowledge.step ?? knowledge.quote
  // V1.7.1f — item de lista citado SOZINHO ("Se a conta já foi paga;"): a frase de abertura da lista (literal, do documento) dá a
  // ação ("permitir que o cliente explique") e o item vira o objeto — nunca o nome cru da etapa.
  const cited = ruleActionOf(citedQuote) ?? (citedQuote && knowledge.leadIn ? ruleActionOf(`${knowledge.leadIn}\n- ${citedQuote}`) : null)
  const operative = ruleActionOf(knowledge.operativeRule?.quote) ?? (knowledge.detail && (knowledge.detail.contentKind ?? "RULE_CONTENT") === "RULE_CONTENT" ? ruleActionOf(knowledge.detail.quote) : null) ?? cited

  if (item.section === "STRENGTH") {
    // V1.7.1k — lista de conferência com completude desconhecida: só o que a fala mostra; o resto não é avaliado (nem elogiado).
    const verifyList = item.process?.completeness
    if (verifyList && verifyList.status === "UNKNOWN" && verifyList.family === "VERIFY" && verifyList.observed.length > 0) {
      const label = presentationLabelOf(item)
      const shown = verifyList.observed.map((text) => quoted(capitalize(text.replace(CONDITION_TAIL, ""))))
      return { observed: `${label ? `Em “${label}”, a sua fala` : "A sua fala"} mostra a conferência de ${joinAnd(shown)}. Os demais itens da lista não puderam ser confirmados pela gravação e não foram avaliados.`, whatYouCanDo: null }
    }
    let observed: string | null = null
    // V1.7.1f — itens a perguntar: SÓ os que uma fala-pergunta do operador sustenta (termo do item na pergunta); nenhuma ação
    // além do que a fala mostra. Nenhum item sustentado → formulação conservadora.
    if (cited && cited.items.length > 0 && cited.interrogativeItems) {
      const questions = operatorTexts.filter((text) => text.includes("?"))
      const askedItems = cited.items.filter((item) => questions.some((question) => sharedWords(contentWords(item), contentWords(question)).length > 0))
      observed = askedItems.length > 0 ? `Você perguntou ao cliente ${joinAnd(askedItems)}.` : null
    }
    else if (cited && cited.items.length === 0) {
      const core = cited.action.replace(CONDITION_TAIL, "")
      const nominal = nominalizeAction(core)
      // MONITORING V2 — "informar que" (oração cortada na condição) não é frase: sem complemento, formulação conservadora.
      const past = /\sque(?:\s|$)/.test(core) ? null : inflectAction(core, preteriteOf)
      // V1.7.1k — ato de FALA (informar, confirmar, perguntar…) acontece na própria conversa: o pretérito descreve o que a fala
      // mostra. Ação em sistema (cancelar, registrar…) declarada pelo operador continua só "informou ao cliente".
      const speechAct = SPEECH_ACT_FAMILIES.includes(familyOfAction(core) ?? "CANCEL")
      observed = evidenceType === "OBSERVED_DECLARATION" && !speechAct ? (nominal ? `Você informou ao cliente ${nominal.article} ${nominal.phrase}.` : null) : past ? `Você ${past}.` : null
    }
    const keep = cited ? inflectAction(cited.action, gerundOf) : null
    const whatYouCanDo = official && keep ? `Continue ${keep}${cited ? itemsAfterAction(cited, " ") : ""}.` : null
    return { observed, whatYouCanDo }
  }

  const imperative = operative ? inflectAction(operative.action.replace(CONDITION_TAIL, ""), imperativeOf) : null
  const howTo = imperative ? `${operative?.condition ? `${operative.condition}, ` : ""}${imperative}${operative ? itemsAfterAction(operative, ": ") : ""}` : null
  if (knowledge.contentKind === "DO_NOT_CONTENT") {
    const avoided = avoidedPhrasesIn(operatorTexts, [knowledge.quote, ...(knowledge.detail?.contentKind === "DO_NOT_CONTENT" ? [knowledge.detail.quote] : [])])
    const observed = avoided.length > 0
      ? `Você usou ${avoided.length === 1 ? "a formulação" : "as formulações"} ${joinAnd(avoided.map(quoted))}, que o procedimento pede para evitar.`
      : "Nesse momento, sua fala usou uma formulação que o procedimento pede para evitar."
    const whatYouCanDo = official && howTo ? `Na próxima chamada, ${howTo}${avoided.length > 0 ? `, em vez de dizer ${quoted(avoided[0]!)}` : ""}.` : null
    return { observed, whatYouCanDo }
  }
  const missing = cited ? `${cited.action.replace(CONDITION_TAIL, "")}${itemsAfterAction(cited, " ")}` : null
  // V1.7.1g — etapa com LISTA de itens e ação observada (ex.: recapitulação feita pela metade): a fala mostra parte dos itens, e
  // listar todos como "faltou" acusaria o que foi dito (o protocolo, o serviço cancelado). Nunca enumera — o "Como aplicar" traz
  // a lista completa da regra.
  const label = presentationLabelOf(item)
  // V1.7.1i — etapa COMPOSTA parcial: só os itens OBSERVADOS e os VERIFICADAMENTE ausentes (item desconhecido nunca vira acusação).
  const completeness = item.process?.completeness ?? null
  if (completeness?.status === "PARTIAL") {
    const shown = (text: string) => quoted(capitalize(text.replace(CONDITION_TAIL, "")))
    const observedItems = completeness.observed.map(shown)
    const absentItems = completeness.absent.map(shown)
    // SUBITEM_APPLICABILITY_V1 — item que dependia de um resultado ainda pendente é dito como tal (nunca como falta).
    const notApplicable = (completeness.notApplicable ?? []).map(shown)
    const partial = `${label ? `Em “${label}”, você` : "Você"} fez parte do que o procedimento prevê${observedItems.length > 0 ? `, incluindo ${joinAnd(observedItems)}` : ""}, mas não todos os itens previstos.${absentItems.length > 0 ? ` Nesta chamada não ${absentItems.length === 1 ? "apareceu" : "apareceram"} ${joinAnd(absentItems)}.` : ""}${notApplicable.length > 0 ? ` ${joinAnd(notApplicable)} não ${notApplicable.length === 1 ? "se aplicava" : "se aplicavam"} neste momento, porque o resultado ainda estava pendente.` : ""}`
    // Como aplicar = o que COMUNICAR (frase de comportamento por tipo do item), nunca a lista inteira de rótulos do checklist.
    const condition = operative?.condition ? `${operative.condition.charAt(0).toLocaleLowerCase("pt-BR")}${operative.condition.slice(1)}, ` : ""
    const communicate = completeness.absent.map(communicateClauseOf)
    return { observed: partial, whatYouCanDo: official && communicate.length > 0 ? `Na próxima chamada, ${condition}informe também ${joinAnd(communicate)}.` : official && howTo ? `Na próxima chamada, ${howTo}.` : null }
  }
  const observed = !missing
    ? null
    : evidenceType === "OBSERVED_ACTION" && cited && cited.items.length > 1
      ? `Nesse momento da chamada, faltaram pontos que o procedimento pede${label ? ` em “${label}”` : ""}.`
      : evidenceType === "VERIFIED_OMISSION"
      // V1.7.3 — sem fala exibível (ausência verificada mostrada pela frase do sistema) nunca aponta para "o momento abaixo".
      ? item.process?.absenceShown ? `Nesta chamada, faltou ${missing}.` : `Nesta chamada, faltou ${missing}: no momento mostrado abaixo, isso não apareceu.`
      : evidenceType === "UNVERIFIED_OMISSION"
        // V1.7.1f — omissão NÃO verificada nunca lista o que "faltou" (parte pode ter acontecido — no smoke o protocolo foi dado):
        // fica a formulação conservadora pelo assunto, e o QA decide.
        ? null
        : `Nesse momento da chamada, faltou ${missing}.`
  return { observed, whatYouCanDo: official && howTo ? `Na próxima chamada, ${howTo}.` : null }
}
