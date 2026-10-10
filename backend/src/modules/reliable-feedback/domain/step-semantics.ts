import { stripListMarker } from "../../knowledge/domain/knowledge-list.js"

/**
 * V1.7.4 — SEMÂNTICA DA ETAPA: CONDICIONALIDADE E PRECEDÊNCIA (`STEP_SEMANTICS_V1`, domínio puro, sem LLM).
 *
 * Até a V1.7.3 a presença de "se", "caso", "quando" ou "desde que" em QUALQUER ponto da linha tornava a etapa inteira condicional
 * (regex). Na Golden Demo "Argumentário" isso descartou dois descumprimentos reais:
 *   "Confirmar se a solicitação é de segunda via da fatura ou do parcelamento antes de orientar…" — o "se" introduz O QUE confirmar
 *     (seletor do ramo), não uma condição: a confirmação é obrigatória, o resultado dela decide o caminho;
 *   "Realizar o suporte conforme o fluxo aplicável. Caso seja necessário abrir reparo, informar…" — a condição governa só a
 *     SEGUNDA frase; prestar o suporte continua obrigatório.
 *
 * Aqui a etapa é lida por ESTRUTURA — frases, posição do marcador e o verbo que o antecede —, nunca pela palavra solta:
 *
 *   SELETOR DE RAMO   marcador logo depois de um verbo de checagem/pergunta ("confirmar se", "verificar se", "avaliar se",
 *                     "perguntar qual"): a ação é obrigatória; o marcador é o objeto dela (`branchSelector`).
 *   CONDIÇÃO DA FRASE marcador no início da frase ("Se houver…", "Caso…", "Em caso positivo…", "Quando…"), ou "somente/apenas/só
 *                     se", ou "desde que": a frase inteira vale só na condição.
 *   CONDIÇÃO FINAL    ", quando aplicável" / ", se necessário" / ", caso necessário" no fim da frase: sem coordenação, a frase é
 *                     condicional ("Cancelar a recorrência, quando permitido"); com coordenação ("Indicar A e verificar B, caso
 *                     necessário") a condição alcança só o último termo — a ação principal continua obrigatória.
 *   CONTEÚDO A DIZER  condição dentro do complemento de um verbo de fala ("Informar que, quando a opção estiver disponível, …"): é o
 *                     que deve ser dito, não uma condição sobre dizer.
 *   PRONOME           "-se" enclítico e "se" sem forma de condição ("o cliente se sente") não são condição.
 *
 * A etapa só é CONDICIONAL quando TODAS as frases com ação são condicionais; senão a primeira frase incondicional é a obrigação
 * principal. PRECEDÊNCIA: "X antes de Y" e "X. <frase seguinte com Y>" registram Y como a ação SEGUINTE a X (`successors`) — a
 * prova do descumprimento observado de X é o operador ter feito Y sem X antes (`evidence-conduct.ts › prerequisiteSkipOf`).
 */
export const STEP_SEMANTICS_VERSION = "STEP_SEMANTICS_V1" as const

export type StepClause = {
  text: string
  /** A frase inteira só vale sob uma condição. */
  conditional: boolean
  /** Onde a condição foi reconhecida (auditoria). */
  conditionKind: "SENTENCE_START" | "RESTRICTIVE" | "TRAILING" | "COORDINATED_TRAILING" | null
  /** "se"/"qual" introduzindo o OBJETO de uma checagem ("confirmar se …"): a ação é obrigatória. */
  branchSelector: boolean
  /** Condição que é CONTEÚDO do que deve ser dito ("informar que, quando…"). */
  contentCondition: boolean
}
export type StepSemantics = {
  version: typeof STEP_SEMANTICS_VERSION
  clauses: StepClause[]
  /** Existe ao menos uma frase com ação obrigatória. */
  obligatory: boolean
  /** A primeira frase obrigatória (a obrigação principal da etapa). */
  primary: StepClause | null
  /** Ações que a etapa diz virem DEPOIS da obrigação principal ("antes de Y"; frases seguintes). */
  successors: string[]
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const CHECK_VERB = /^(?:confirm|verific|avali|pergunt|chec|cheq|confer|confir|question|identific|valid|consult|sab|entend|investig|certific|apur|descobr)\p{L}*$/u
const SPEECH_VERB = /^(?:inform|explic|esclarec|orient|diz|diga|dizer|mencion|comunic|avis|ressalt|destac)\p{L}*$/u
const RESTRICTIVE_LEAD = new Set(["somente", "apenas", "so", "exceto", "salvo", "unicamente"])
const NOUN_CASO_LEAD = new Set(["neste", "nesse", "no", "do", "o", "um", "cada", "qualquer", "esse", "este", "seu", "sua", "em"])
/** Cabeças típicas de uma condição introduzida por "se" fora do início da frase ("…, se houver"). */
const CONDITION_HEAD = /^(?:houver|for|forem|necessari\p{L}*|aplicavel|aplicaveis|possivel|disponivel|disponiveis|existir|existirem|tiver|tiverem|estiver|estiverem|precisar|precisarem|permitid\p{L}*|autorizad\p{L}*|solicitad\p{L}*|o|a|os|as|um|uma|nao)$/u
const TRAILING_CONDITION = /,\s*(?:(?:somente|apenas|s[óo])\s+)?(?:quando|se|caso|desde\s+que)\s+[^,.;]{1,60}[.;:]?\s*$/iu

type Token = { word: string; folded: string; start: number; afterPunct: boolean; enclitic: boolean }
function tokensOf(sentence: string): Token[] {
  const tokens: Token[] = []
  const pattern = /[\p{L}\p{N}]+(?:-[\p{L}]+)*/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(sentence))) {
    const before = sentence.slice(0, match.index).trimEnd()
    tokens.push({ word: match[0], folded: fold(match[0]), start: match.index, afterPunct: before.length === 0 || /[,;:(—–]$/.test(before), enclitic: false })
  }
  // "-se" enclítico ("certificar-se", "cadastrar-se") fica colado ao verbo: nunca é condição.
  return tokens.flatMap((token) => { const parts = token.folded.split("-"); return parts.length > 1 && parts.includes("se") ? [{ ...token, folded: parts[0]!, enclitic: true }] : [token] })
}

function sentencesOf(text: string): string[] {
  return stripListMarker(text).replace(/\s+/g, " ").trim().split(/(?<=[.;!?])\s+(?=\p{Lu})/u).map((sentence) => sentence.trim()).filter((sentence) => /\p{L}{3,}/u.test(sentence))
}

function clauseOf(sentence: string): StepClause {
  const tokens = tokensOf(sentence)
  let conditionKind: StepClause["conditionKind"] = null
  let branchSelector = false
  let contentCondition = false
  const speechVerbAt = tokens.findIndex((token, index) => index <= 1 && SPEECH_VERB.test(token.folded))
  const thatAt = speechVerbAt >= 0 ? tokens.findIndex((token, index) => index > speechVerbAt && index <= speechVerbAt + 3 && token.folded === "que") : -1
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!
    const previous = tokens[index - 1]
    const isMarker = token.folded === "se" || token.folded === "quando" || token.folded === "caso" || (token.folded === "desde" && tokens[index + 1]?.folded === "que") || (token.folded === "em" && tokens[index + 1]?.folded === "caso")
    if (!isMarker) continue
    if (token.folded === "caso" && previous && NOUN_CASO_LEAD.has(previous.folded) && previous.folded !== "em") continue
    if (token.folded === "caso" && previous?.folded === "em") continue // tratado pelo "em" ("em caso positivo")
    // Seletor de ramo: "confirmar se", "verificar se", "avaliar se" — o marcador é o objeto da checagem.
    if (token.folded === "se" && previous && CHECK_VERB.test(previous.folded)) { branchSelector = true; continue }
    // Condição que é conteúdo de uma fala ("informar que, quando …").
    if (thatAt >= 0 && index > thatAt) { contentCondition = true; continue }
    const atStart = index === 0 || token.afterPunct || (previous !== undefined && ["e", "ou", "mas"].includes(previous.folded) && (index === 1 || previous.afterPunct))
    if (previous && RESTRICTIVE_LEAD.has(previous.folded)) { conditionKind = "RESTRICTIVE"; break }
    if (token.folded === "desde") { conditionKind = "RESTRICTIVE"; break }
    if (index === 0 || (atStart && index <= 1)) { conditionKind = "SENTENCE_START"; break }
    if (token.folded === "se" && !atStart && !CONDITION_HEAD.test(tokens[index + 1]?.folded ?? "")) continue // "o cliente se sente"
    if (atStart && TRAILING_CONDITION.test(sentence.slice(Math.max(0, token.start - 2)))) {
      const head = sentence.slice(0, token.start)
      // Coordenação antes da condição final: "Indicar A e verificar B, caso necessário" — a condição alcança só o último termo.
      const coordinated = /\s(?:e|ou)\s+\p{L}+(?:ar|er|ir)(?:\s|$)/u.test(` ${fold(head)} `)
      conditionKind = coordinated ? "COORDINATED_TRAILING" : "TRAILING"
      break
    }
    if (atStart) { conditionKind = "SENTENCE_START"; break }
  }
  const conditional = conditionKind !== null && conditionKind !== "COORDINATED_TRAILING"
  return { text: sentence, conditional, conditionKind, branchSelector, contentCondition }
}

export function stepSemanticsOf(stepText: string): StepSemantics {
  const clauses = sentencesOf(stepText).map(clauseOf)
  const primaryIndex = clauses.findIndex((clause) => !clause.conditional)
  const primary = primaryIndex >= 0 ? clauses[primaryIndex]! : null
  const successors: string[] = []
  if (primary) {
    const before = /(?<!\p{L})antes\s+de\s+([^.;,]{3,160})/iu.exec(primary.text)
    if (before) successors.push(before[1]!.trim())
    successors.push(...clauses.slice(primaryIndex + 1).map((clause) => clause.text))
  }
  return { version: STEP_SEMANTICS_VERSION, clauses, obligatory: primary !== null, primary, successors }
}

/** A etapa só vale sob condição (TODAS as frases com ação são condicionais). */
export const isConditionalStepText = (stepText: string) => { const semantics = stepSemanticsOf(stepText); return semantics.clauses.length > 0 && !semantics.obligatory }
/** Texto da obrigação principal sem a ação seguinte ("X antes de Y" → X). */
export function primaryObligationOf(stepText: string): string | null {
  const primary = stepSemanticsOf(stepText).primary
  if (!primary) return null
  return primary.text.replace(/[.;:]+$/u, "").replace(/\s*(?<!\p{L})antes\s+de\s+[^.;]*$/iu, "").trim()
}
