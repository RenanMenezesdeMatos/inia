/**
 * PROJEÇÃO POR SUPERFÍCIE (Workflow Output → CHAT / AVATAR), determinística e sem LLM.
 *
 *   Artefato confiável ──► Acompanhamento (feedbackView publicado)
 *                     ├──► Chat   (primeira mensagem da INIA numa conversa NOVA)
 *                     └──► Avatar (fala curta, só depois do aceite)
 *
 * A projeção só ADAPTA A FORMA: reaproveita textos que já passaram pela validação do artefato (card e narrativa do
 * feedback V2, texto emitível do feedback confiável, síntese do Orquestrador/Agent) e acrescenta apenas frases fixas do
 * sistema, sem fato, número, causa, evidência ou orientação nova. Por isso não há redator nem fallback: nada aqui é gerado.
 *
 * A fala do avatar nunca lê marcação (títulos, marcadores, caixas de seleção, links, ids, constantes técnicas) e é curta
 * (recado de ~20–60 s); o texto completo fica escrito junto do convite.
 */
export const SURFACE_PROJECTION_VERSION = "WORKFLOW_SURFACE_PROJECTION_V1" as const

/** O que a projeção precisa do view model do feedback V2 (`FeedbackView`) — só os campos já validados da camada 1. */
export type FeedbackViewLike = {
  heading?: { title: string; subtitle: string | null; subjectSource?: string | undefined } | undefined
  card: string
  greeting: string | null
  narrative: string[]
  kind?: "MONITORING" | "INDICATOR" | undefined
  cycle?: { title: string } | null | undefined
}

export type ProjectionSource =
  /** Feedback confiável com a apresentação V2 (monitoria de processo, fechamento do PRV). */
  | { kind: "FEEDBACK_VIEW"; domain: "MONITORING" | "INDICATOR"; label: string; view: FeedbackViewLike; fullText: string }
  /** Feedback confiável sem view V2 (indicador por medição, monitoria legada): o card já validado (quando existe), o núcleo
   * validado de cada ponto (`observed`, na ordem do feedback) e o texto emitível completo. */
  | { kind: "FEEDBACK_TEXT"; domain: "MONITORING" | "INDICATOR"; label: string; card: string | null; points?: string[]; fullText: string }
  /** Qualquer outro conteúdo publicável (síntese de Orquestrador/Agent, resumo consolidado). */
  | { kind: "TEXT"; title: string | null; text: string }

export type SurfaceProjection = {
  version: typeof SURFACE_PROJECTION_VERSION
  /** Título curto da conversa/convite (nunca ids). */
  title: string
  /** Primeira mensagem da INIA na conversa nova (Markdown, renderizado pelo RichContent). */
  chatText: string
  /** O que o avatar FALA (texto puro, pronunciável). */
  speechText: string
  /** O recado por escrito junto do convite (acessibilidade; nunca some depois da fala). */
  displayText: string
  /** Contexto de origem para a IA quando a pessoa responde na conversa (dados, não instruções). */
  contextText: string
  /** A fala cobre só o começo de um conteúdo longo (o restante fica escrito na tela). */
  speechTruncated: boolean
}

/** ~2,6 palavras/s em pt-BR: 150 palavras ≈ 58 s — o teto do "primeiro recado". */
export const MAX_SPEECH_WORDS = 150

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const lowerFirst = (text: string) => (text ? text.charAt(0).toLowerCase() + text.slice(1) : text)
const endWithPeriod = (text: string) => (/[.!?…:]$/.test(text) ? text : `${text}.`)
export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length

/**
 * Texto → fala natural. Remove toda marcação e o que não se pronuncia (URLs, ids, constantes técnicas, caixas de seleção);
 * transforma linhas/itens de lista em frases; lê datas dd/mm/aaaa e a unidade "s" como fala. Nunca acrescenta conteúdo.
 */
/**
 * `SPOKEN_LISTS_V1`: uma lista apresentada por uma frase que termina em ":" é FALADA como enumeração ("…os seguintes pontos: o número a
 * portar, a próxima etapa e a data da janela"), não como frases soltas ("Número a portar. Próxima etapa."). Lista numerada vira
 * "primeiro, …; segundo, …; e por fim, …". Sem a frase de abertura, cada item continua sendo uma frase. Só forma: nada é acrescentado.
 */
const ORDINALS = ["primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono", "décimo"]
const LIST_LINE = /^\s*(?:([-*+•])|(\d+)[.)])\s+(.*)$/u
/** Item como parte de uma frase: sem a pontuação final; a inicial maiúscula de uma palavra comum vira minúscula (sigla fica). */
const asEnumerationItem = (item: string) => {
  const clean = item.trim().replace(/[;.,:!]+$/u, "").trim()
  return /^\*{0,2}[A-ZÀ-Ý][a-zà-ÿ]/u.test(clean) ? clean.replace(/^(\*{0,2})(.)/u, (_, stars: string, first: string) => `${stars}${first.toLocaleLowerCase("pt-BR")}`) : clean
}
function spokenListsOf(markdown: string): string {
  const lines = markdown.split("\n")
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const previous = [...out].reverse().find((entry) => entry.trim().length > 0) ?? ""
    const start = LIST_LINE.exec(line)
    if (!start || !/:\s*$/u.test(previous)) {
      out.push(line)
      index += 1
      continue
    }
    const items: { ordered: boolean; text: string }[] = []
    while (index < lines.length) {
      const match = LIST_LINE.exec(lines[index]!)
      if (!match) break
      items.push({ ordered: Boolean(match[2]), text: asEnumerationItem(match[3] ?? "") })
      index += 1
    }
    const texts = items.map((item) => item.text).filter(Boolean)
    if (texts.length === 0) continue
    const ordered = items.every((item) => item.ordered)
    const spoken = ordered && texts.length <= ORDINALS.length
      ? texts.map((text, position) => `${position === texts.length - 1 && texts.length > 1 ? "e por fim" : ORDINALS[position]}, ${text}`).join("; ")
      : texts.length === 1 ? texts[0]! : `${texts.slice(0, -1).join(", ")} e ${texts[texts.length - 1]}`
    // A enumeração continua a frase de abertura (que termina em ":").
    const last = out.length - 1 - [...out].reverse().findIndex((entry) => entry.trim().length > 0)
    out[last] = `${out[last]!.trimEnd()} ${spoken}.`
  }
  return out.join("\n")
}

export function toSpeakable(markdown: string): string {
  let text = spokenListsOf(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\/materiais\/[0-9a-f-]+/gi, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/[☐☑✓✔↗]/g, " ")
    // Anotações entre colchetes ([fala sobreposta], [ ], [x]) não se pronunciam.
    .replace(/\[[^\]\n]*\](?!\()/g, " ")
  const lines = text.split(/\n+/).map((line) =>
    line
      .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)]\s+)/, "")
      .replace(/^\s*\|?\s*:?-{2,}.*$/, "")
      .replace(/\s*\|\s*/g, ", ")
      .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, "$2")
      .replace(/[*_#>|~]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^,\s*|,\s*$/g, ""),
  )
  text = lines.filter(Boolean).map(endWithPeriod).join(" ")
  return text
    // Constantes técnicas (READY, HOLD_FOR_QA…) nunca são lidas; siglas curtas (TMA, PRV) continuam.
    .replace(/\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, " ")
    .replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g, (_, day: string, month: string, year: string) => `${Number(day)} de ${MONTHS[Number(month) - 1] ?? month} de ${year}`)
    .replace(/\b(\d{1,2})\/(\d{1,2})\b(?!\/)/g, (match, day: string, month: string) => (Number(month) >= 1 && Number(month) <= 12 ? `${Number(day)} de ${MONTHS[Number(month) - 1]}` : match))
    .replace(/(\d)\s?s\b(?![-\w])/g, "$1 segundos")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.!?])\s*\.+/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

/** Primeiras frases até o teto de palavras (sempre frases inteiras). */
export function firstSentences(text: string, maxWords: number): { text: string; truncated: boolean } {
  if (wordCount(text) <= maxWords) return { text, truncated: false }
  const sentences = text.match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g) ?? [text]
  const kept: string[] = []
  let words = 0
  for (const sentence of sentences) {
    const count = wordCount(sentence)
    if (kept.length > 0 && words + count > maxWords) break
    kept.push(sentence.trim())
    words += count
  }
  return { text: kept.join(" "), truncated: kept.length < sentences.length }
}

/** Assunto do retorno, escrito e falado, a partir do cabeçalho REAL do artefato (nunca por regra de indicador/assunto). */
function subjectOf(source: Extract<ProjectionSource, { kind: "FEEDBACK_VIEW" | "FEEDBACK_TEXT" }>): { title: string; written: string } {
  const heading = source.kind === "FEEDBACK_VIEW" ? source.view.heading : undefined
  const labelParts = source.label.split(" · ").map((part) => part.trim()).filter(Boolean)
  // Rótulo "Atendimento de 14/09/2026 · Fatura": data do atendimento e assunto são coisas diferentes.
  const labelWhen = labelParts.find((part) => /^atendimento de /i.test(part)) ?? null
  const labelHead = labelParts.find((part) => part !== labelWhen) ?? labelParts[0] ?? source.label
  if (heading && /^fechamento de /i.test(heading.subtitle ?? "")) {
    const cycle = lowerFirst(heading.subtitle!)
    return { title: `Feedback do seu ${cycle}`, written: `o seu ${cycle} em ${heading.title}` }
  }
  if (source.domain === "MONITORING") {
    // Título neutro (sem assunto confiável, `FEEDBACK_HEADING_V1`) ou só a data não é assunto: o recado fala só da data.
    const headingTopic = heading && heading.subjectSource !== "NONE" && !/^atendimento de /i.test(heading.title) ? heading.title : null
    const topic = heading ? headingTopic : labelHead === labelWhen ? null : labelHead
    const whenSource = heading?.subtitle && /^atendimento de /i.test(heading.subtitle) ? heading.subtitle : labelWhen
    const when = whenSource ? lowerFirst(whenSource) : null
    return { title: topic ? `Retorno da monitoria · ${topic}` : "Retorno da monitoria", written: when ? `o seu ${when}${topic ? ` (${topic})` : ""}` : topic ? `a monitoria do seu atendimento (${topic})` : "a monitoria do seu atendimento" }
  }
  const indicator = heading?.title ?? labelHead
  return { title: indicator ? `Resultado do seu indicador · ${indicator}` : "Resultado do seu indicador", written: indicator ? `o seu resultado em ${indicator}` : "o seu resultado de indicador" }
}

const CHAT_CLOSING = "Se quiser, me pergunte sobre qualquer um desses pontos — posso explicar de onde veio cada um."
const SPEECH_CLOSING = "Se quiser, posso te explicar os detalhes aqui no chat."

export function projectForSurfaces(source: ProjectionSource, input: { addressName: string | null; outputLabel?: string | null }): SurfaceProjection {
  const spokenGreeting = input.addressName ? `Oi, ${input.addressName}.` : "Oi!"
  const writtenGreeting = input.addressName ? `Olá, ${input.addressName}!` : "Olá!"

  if (source.kind === "TEXT") {
    const title = source.title?.trim() || input.outputLabel?.trim() || "Recado da INIA"
    const text = source.text.trim()
    const spoken = firstSentences(toSpeakable(text), MAX_SPEECH_WORDS - 25)
    const speechText = [spokenGreeting, `Tenho um recado para você: ${toSpeakable(title)}`, spoken.text, spoken.truncated ? "O recado completo está escrito aqui no painel da INIA." : SPEECH_CLOSING].map(endWithPeriod).join(" ")
    return {
      version: SURFACE_PROJECTION_VERSION,
      title,
      chatText: [`${writtenGreeting} Tenho um recado novo para você: **${title}**.`, text, "Se quiser conversar sobre isso, é só responder por aqui."].join("\n\n"),
      speechText,
      displayText: text,
      contextText: text,
      speechTruncated: spoken.truncated,
    }
  }

  const subject = subjectOf(source)
  if (source.kind === "FEEDBACK_VIEW") {
    const { view } = source
    const opening = `Tenho um retorno novo para você sobre ${subject.written}. Separei os principais pontos e podemos conversar sobre eles por aqui.`
    const chatText = [[view.greeting ?? "", opening].filter(Boolean).join(" "), ...view.narrative, CHAT_CLOSING].join("\n\n")
    const card = firstSentences(toSpeakable(view.card), MAX_SPEECH_WORDS - 40)
    const speechText = [spokenGreeting, `Tenho um retorno sobre ${toSpeakable(subject.written)}`, card.text, SPEECH_CLOSING].map(endWithPeriod).join(" ")
    return {
      version: SURFACE_PROJECTION_VERSION,
      title: subject.title,
      chatText,
      speechText,
      displayText: [view.greeting ?? "", ...view.narrative].filter(Boolean).join("\n\n"),
      contextText: source.fullText,
      speechTruncated: card.truncated,
    }
  }

  const opening = `Tenho um retorno novo para você sobre ${subject.written}. Podemos conversar sobre ele por aqui.`
  // Fala: o card validado quando existe; senão o NÚCLEO validado dos pontos (o que aconteceu) — nunca rótulos, orientações
  // longas ou trechos de transcrição. O retorno completo continua escrito junto do convite.
  const points = (source.points ?? []).map((point) => point.trim()).filter(Boolean)
  const spokenSource = source.card?.trim() || points.slice(0, 2).join(" ") || source.fullText
  const spokenBody = firstSentences(toSpeakable(spokenSource), MAX_SPEECH_WORDS - 50)
  const countNote = !source.card?.trim() && points.length > 1 ? `São ${points.length} pontos neste retorno.` : null
  const truncated = spokenBody.truncated || (!source.card?.trim() && points.length > 2) || (!source.card?.trim() && points.length === 0)
  return {
    version: SURFACE_PROJECTION_VERSION,
    title: subject.title,
    chatText: [`${writtenGreeting} ${opening}`, source.fullText, CHAT_CLOSING].join("\n\n"),
    speechText: [spokenGreeting, `Tenho um retorno sobre ${toSpeakable(subject.written)}`, countNote, spokenBody.text, truncated ? "O retorno completo está escrito aqui no painel da INIA." : SPEECH_CLOSING].filter((part): part is string => Boolean(part)).map(endWithPeriod).join(" "),
    displayText: source.fullText,
    contextText: source.fullText,
    speechTruncated: truncated,
  }
}
