import { cleanSectionHeading } from "./process-items.js"
import type { FeedbackBestPractices } from "../../best-practices/domain/feedback-section.js"
import { NEUTRAL_INTERACTION_TITLE, type HeadingSubjectSource } from "../../feedbacks/domain/feedback-heading.js"
import { renderApplicabilityMarkdown, composeDevelopmentBlocks, developmentBlockLabelOf, escapeMarkdownQuote, feedbackKnowledgeOf, findingLabelOf, knowledgeGuidanceOf, processGuidanceBlocks, renderSuggestedResponse, supportMaterialLineageOf, type ConfirmedProduct, type EmittedItem, type FeedbackDocumentPart } from "./reliable-feedback-artifact.js"
import { aboutOf, fold, narrativeGapOf } from "./supervisor-narrative.js"
import { communicateClauseOf } from "./subitem-semantics.js"
import { speechIntroOf } from "./behavior-presentation.js"
import { ABSENCE_STATEMENTS } from "./verified-absence-display.js"
import { isAvoid, joinAnd, phaseOf, type AttendancePhase } from "./supervisor-presentation.js"
import type { CanonicalBehavior } from "./canonical-behavior.js"
import type { FeedbackPresentation } from "./feedback-presentation.js"

/**
 * FEEDBACK POR FLAG V2 — VIEW MODEL DA APRESENTAÇÃO (`FEEDBACK_VIEW_V1`, derivado; nunca uma segunda verdade).
 *
 *   CAMADA 1  narrativa de supervisor + card (o que o colaborador lê primeiro);
 *   CAMADA 2  detalhes (progressive disclosure): por ajuste — o que aconteceu, a fala (ou a ausência verificada), o que o processo
 *             orienta, de qual documento/seção, por que importa, como aplicar e o exemplo de condução; o que manter (resumo +
 *             evidências); materiais utilizados.
 *
 * Os detalhes são DETERMINÍSTICOS: saem do artefato validado (textos já validados dos itens, regras literais, falas verificadas).
 * Nenhum dado técnico (status, checkpointRef, comportamento, readiness, versão) entra aqui — o view model vai ao colaborador.
 */
export const FEEDBACK_VIEW_VERSION = "FEEDBACK_VIEW_V1" as const

/** `product`: campo da view do motor de feedback (`PRODUCT_IN_FEEDBACK_V1`) — o produto da solicitação da chamada de onde a fala veio. */
export type FeedbackViewQuote = { speaker: "OPERATOR" | "CUSTOMER" | "OTHER"; intro: string; text: string; truncated: boolean; product?: string | null }
/** `href`/`accessible`: resolvidos PARA QUEM LÊ na leitura (sem acesso = sem link, "Material indisponível para este perfil"). */
export type FeedbackViewSource = { documentId: string; documentTitle: string; section: string | null; href: string | null; accessible?: boolean }
/** `appliesTo`/`requirement`: campos da view do motor (`PRODUCT_IN_FEEDBACK_V1`, `ARGUMENT_REQUIREMENT_V1`) — "Vale para" e "deve/pode". */
export type FeedbackViewRule = { text: string; section: string | null; appliesTo?: string[]; requirement?: "REQUIRED" | "OPTIONAL" }
export type FeedbackViewCall =
  | { kind: "QUOTES"; quotes: FeedbackViewQuote[] }
  /** Ausência VERIFICADA (a análise da chamada inteira) — a fala do momento em que caberia é só contexto. */
  | { kind: "ABSENCE"; statement: string; verified: boolean; context: FeedbackViewQuote | null }
  | { kind: "NONE" }
export type FeedbackViewDevelopment = {
  key: string
  title: string
  /** O que aconteceu, curto e factual (frase do sistema pelo comportamento; nunca texto do modelo). */
  whatHappened: string
  call: FeedbackViewCall
  /** O que precisa ser ajustado: o texto JÁ VALIDADO do item (redator, texto de segurança ou edição do QA). */
  adjustment: string[]
  guidance: { rules: FeedbackViewRule[]; avoid: string[]; examples: string[] }
  sources: FeedbackViewSource[]
  whyItMatters: string[]
  howToApply: string | null
  suggestedResponse: string | null
  /** Campos da view do motor de feedback: a origem e o produto da fala do argumentário e o produto do pedido do ponto (`PRODUCT_IN_FEEDBACK_V1`). */
  suggestedResponseSource?: { kind: "ARGUMENT_SCRIPT"; name: string }
  suggestedResponseProduct?: string | null
  product?: string | null
  itemIndexes: number[]
  /** Consolidação de APRESENTAÇÃO: os pontos (títulos) que este bloco reúne — os achados continuam separados no artefato. */
  consolidates?: string[]
}
/** `phase`: fase do atendimento (agrupa "Ver evidências"); ausente em feedbacks publicados antes. */
export type FeedbackViewPositive = { title: string; statement: string; quotes: FeedbackViewQuote[]; itemIndex: number; phase?: AttendancePhase }
export type FeedbackViewAttention = { title: string; markdown: string; itemIndex: number }
/** `sections`: as seções do documento que sustentaram os pontos (o que o colaborador procura ao abrir o material). */
export type FeedbackViewMaterial = { documentId: string; title: string; href: string | null; usedIn: string[]; sections?: string[]; accessible?: boolean }
/**
 * Cabeçalho do item no Acompanhamento: IDENTIDADE (o assunto do atendimento) separada do METADADO (quando aconteceu). Vem do
 * contexto real (rótulo do artefato), nunca de regra por assunto. Ausente em feedbacks publicados antes (a tela usa o título antigo).
 */
/** `subjectSource` (FEEDBACK_HEADING_V1): de onde veio o assunto do título; "NONE" = título neutro (sem assunto confiável). */
export type FeedbackViewHeading = { title: string; subtitle: string | null; subjectSource?: HeadingSubjectSource }
export type FeedbackView = {
  version: typeof FEEDBACK_VIEW_VERSION
  heading?: FeedbackViewHeading
  card: string
  /** "Olá, Larissa!" quando o nome não abre a narrativa; null quando a narrativa começa pelo nome ("Larissa, você…"). */
  greeting: string | null
  narrative: string[]
  developments: FeedbackViewDevelopment[]
  maintain: { summary: string; evidence: FeedbackViewPositive[] } | null
  attention: FeedbackViewAttention[]
  materials: FeedbackViewMaterial[]
  /** Produto confirmado (frase do sistema), quando a aplicabilidade foi resolvida. */
  context: string | null
  /** INDICATOR DIAGNOSIS V1 — origem do feedback (ausente = monitoria, como sempre foi). */
  kind?: "MONITORING" | "INDICATOR"
  /** INDICATOR DIAGNOSIS V1 — rótulos das seções de detalhes quando diferem da monitoria (ex.: "Exemplos das chamadas"). */
  sectionLabels?: { developments?: string; call?: string; maintain?: string; detailsHint?: string }
  /** INDICATOR DIAGNOSIS V1 — resultado OFICIAL do ciclo por indicador (linhas prontas do sistema) + notas de contexto. */
  cycle?: { title: string; indicators: { name: string; lines: { label: string; value: string }[]; notes: string[] }[] } | null
  /** Base de boas práticas (`BEST_PRACTICE_FEEDBACK_V1`) — ver best-practices/domain/feedback-section.ts. */
  bestPractices?: FeedbackBestPractices | null
}

const sectionLabelOf = (heading: string | null | undefined) => (heading ? cleanSectionHeading(heading) : null)
const unique = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
const lowerFirst = (text: string) => (text.length > 1 && /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLocaleLowerCase("pt-BR") + text.slice(1) : text)
const capitalizeFirst = (text: string) => (text.length > 0 ? text[0]!.toLocaleUpperCase("pt-BR") + text.slice(1) : text)
const isChecklistDump = (text: string) => (text.match(/[,;]/g)?.length ?? 0) >= 4
const quoteOf = (fact: EmittedItem["facts"][number]): FeedbackViewQuote | null =>
  fact.role === "OPERADOR" ? { speaker: "OPERATOR", intro: speechIntroOf(fact.text), text: fact.text, truncated: fact.truncated }
    : fact.role === "CLIENTE" ? { speaker: "CUSTOMER", intro: "O cliente disse", text: fact.text, truncated: fact.truncated }
      : fact.role === "EVENTO" || fact.role === "OUTRO" ? { speaker: "OTHER", intro: fact.role === "EVENTO" ? "Na chamada" : "Na conversa", text: fact.text, truncated: fact.truncated }
        : null
const quotesOf = (items: readonly EmittedItem[]) => {
  const seen = new Set<string>()
  return items.flatMap((item) => item.facts.map(quoteOf)).filter((quote): quote is FeedbackViewQuote => {
    if (!quote) return false
    const key = `${quote.speaker}|${quote.text.replace(/\s+/g, " ").trim()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Ausência: a CONCLUSÃO primeiro (análise da chamada inteira); a fala do momento em que caberia é só contexto opcional. */
function callOf(group: readonly EmittedItem[]): FeedbackViewCall {
  const quotes = quotesOf(group)
  const omission = group.find((item) => item.process?.evidenceType === "VERIFIED_OMISSION" || item.process?.evidenceType === "UNVERIFIED_OMISSION")
  if (omission) {
    const verified = omission.process?.evidenceType === "VERIFIED_OMISSION"
    const behavior = omission.process?.behavior?.code as CanonicalBehavior | undefined
    const statement = omission.process?.absenceDisplay?.statement
      ?? (verified && behavior && ABSENCE_STATEMENTS[behavior] ? ABSENCE_STATEMENTS[behavior] : `Não foi identificado, durante esta chamada, o que o procedimento orienta em “${findingLabelOf(omission)}”.`)
    return { kind: "ABSENCE", statement, verified, context: quotes.find((quote) => quote.speaker === "OPERATOR") ?? null }
  }
  return quotes.length > 0 ? { kind: "QUOTES", quotes } : { kind: "NONE" }
}

/**
 * COMO APLICAR contextual: na etapa composta parcial, o que faltou COMUNICAR em linguagem de comportamento (nunca a lista de rótulos
 * do checklist); o que já é outro ajuste aponta para ele em vez de repetir a orientação ("veja como no ponto “Protocolo”"). Fora
 * disso, a orientação JÁ validada do item (sem a que só repete a regra inteira).
 */
type Sibling = { title: string; mention: readonly string[] }
const RESTATES_RULE = /siga\s+o\s+que\s+o\s+procedimento\s+orienta|aplicando\s+o\s+que\s+o\s+procedimento\s+orienta/iu
function howToApplyOf(group: readonly EmittedItem[], siblings: readonly Sibling[]): string | null {
  const main = group.find((item) => !isAvoid(item)) ?? group[0]!
  const completeness = main.process?.completeness
  if (completeness?.status === "PARTIAL" && completeness.absent.length > 0) {
    const recap = main.process?.behavior?.code === "RECAPITULATE_INTERACTION"
    const coveredBy = (point: string) => siblings.find((sibling) => sibling.mention.some((stem) => fold(point).includes(stem))) ?? null
    const remaining = completeness.absent.filter((point) => !coveredBy(point))
    const covered = completeness.absent.filter((point) => coveredBy(point))
    return [
      ...(remaining.length > 0 ? [`Na próxima chamada, ${recap ? "antes de encerrar, inclua na recapitulação" : "informe também"} ${joinAnd(remaining.map(communicateClauseOf))}.`] : []),
      ...(covered.length > 0 ? [`${remaining.length > 0 ? "Inclua também" : "Na próxima chamada, inclua"} ${joinAnd(covered.map(communicateClauseOf))} ${recap ? "na recapitulação" : "neste momento"} — veja como no ponto “${coveredBy(covered[0]!)!.title}”.`] : []),
    ].join(" ")
  }
  // FEEDBACK EXPERIENCE V2 — "siga o que o procedimento orienta: “…”" só repete a regra que já aparece em "O processo orienta": não é
  // orientação acionável e sai dos detalhes.
  const guidance = unique(group.map((item) => item.wording.whatYouCanDo)).filter((text) => !isChecklistDump(text) && !RESTATES_RULE.test(text))
  const withoutPrefixed = guidance.filter((value, index) => !guidance.some((other, position) => position !== index && other.length > value.length && other.startsWith(value.replace(/[.!\s]+$/, ""))))
  return withoutPrefixed.length > 0 ? withoutPrefixed.join(" ") : null
}

function developmentOf(group: readonly EmittedItem[], siblings: readonly Sibling[] = []): FeedbackViewDevelopment {
  // Primeiro o que FAZER (regra) e depois o que EVITAR (a ordem de prioridade continua registrada nos itens).
  const ordered = [...group].sort((left, right) => Number(isAvoid(left)) - Number(isAvoid(right)))
  const knowledge = ordered.flatMap(feedbackKnowledgeOf)
  const guidance = knowledgeGuidanceOf(knowledge)
  const suggested = ordered.map((item) => item.suggestedResponse?.text ?? item.wording.suggestedResponse ?? "").map((text) => text.trim().replace(/^[“"«]+|[”"»]+$/g, "")).find((text) => text.length > 0) ?? null
  // FEEDBACK EXPERIENCE V2 — a narrativa já diz o que aconteceu; nos detalhes a própria chamada mostra (fala ou ausência verificada).
  // "O que aconteceu" só aparece quando não há fala a mostrar.
  const call = callOf(ordered)
  const showHappened = call.kind === "NONE"
  return {
    key: `dev-${ordered.map((item) => item.index).join("-")}`,
    title: developmentBlockLabelOf(ordered) ?? findingLabelOf(ordered[0]!),
    whatHappened: showHappened ? `${capitalizeFirst(narrativeGapOf(ordered).happened)}.` : "",
    call,
    adjustment: showHappened ? unique(ordered.map((item) => item.wording.observed)) : [],
    guidance: { rules: guidance.rules.map((rule) => ({ text: rule.text, section: rule.otherSection })), avoid: guidance.avoid, examples: guidance.examples },
    sources: guidance.sources.map((source) => ({ documentId: source.documentId, documentTitle: source.documentTitle, section: sectionLabelOf(source.heading), href: source.href })),
    whyItMatters: unique(ordered.map((item) => item.wording.whyItMatters)),
    howToApply: howToApplyOf(ordered, siblings),
    suggestedResponse: suggested,
    itemIndexes: ordered.map((item) => item.index),
  }
}

/**
 * CONSOLIDAÇÃO DE APRESENTAÇÃO (`FEEDBACK_VIEW_CONSOLIDATION_V1`): uma etapa COMPOSTA parcial cujo ÚNICO motivo de estar
 * incompleta é outro ajuste que já tem orientação própria (ex.: a recapitulação que só não trouxe o protocolo, e o protocolo
 * que não foi informado) vira UM bloco — o colaborador não lê a mesma orientação duas vezes. Regra genérica (nada por assunto):
 *   - a composta tem completude PARCIAL e TODOS os itens ausentes cobertos pelo MESMO outro ajuste;
 *   - a composta é um único item (sem "evitar" junto) e o outro ajuste não é ele mesmo uma composta;
 *   - vários itens ausentes cobertos por ajustes diferentes, ou algum ausente sem outro ajuste → nada é consolidado.
 * Só a apresentação muda: itens, observações, linhagem e analytics continuam separados no artefato.
 */
const PHASE_TITLE: Record<Exclude<AttendancePhase, "OTHER">, string> = { INVESTIGATION: "Investigação do caso", TREATMENT: "Tratativa do caso", CLOSING: "Encerramento da chamada" }
const isPartialComposite = (group: readonly EmittedItem[]) => group.length === 1 && group[0]!.process?.completeness?.status === "PARTIAL" && group[0]!.process.completeness.absent.length > 0
type Consolidation = { composite: number; into: number }
function consolidationsOf(groups: readonly EmittedItem[][]): Consolidation[] {
  const mentions = groups.map((group) => narrativeGapOf(group).mention)
  const found: Consolidation[] = []
  groups.forEach((group, index) => {
    if (!isPartialComposite(group)) return
    const coverers = group[0]!.process!.completeness!.absent.map((point) => groups.findIndex((_, position) => position !== index && mentions[position]!.some((stem) => fold(point).includes(stem))))
    const into = coverers[0]!
    if (into < 0 || coverers.some((position) => position !== into) || isPartialComposite(groups[into]!) || found.some((entry) => entry.into === index || entry.composite === into)) return
    found.push({ composite: index, into })
  })
  return found
}

function consolidatedDevelopment(child: readonly EmittedItem[], composite: readonly EmittedItem[], childDetail: FeedbackViewDevelopment, compositeDetail: FeedbackViewDevelopment): FeedbackViewDevelopment {
  const recap = composite[0]!.process?.behavior?.code === "RECAPITULATE_INTERACTION"
  const phase = phaseOf(child[0]!)
  const sameSection = phase !== "OTHER" && phaseOf(composite[0]!) === phase
  const topic = recap ? "recapitulação final" : lowerFirst(compositeDetail.title)
  const childHappened = narrativeGapOf(child).happened.replace(/[.\s]+$/, "")
  const compositeQuote = compositeDetail.call.kind === "QUOTES" ? compositeDetail.call.quotes.find((quote) => quote.speaker === "OPERATOR") ?? null : null
  // A fala da etapa composta É o momento em que o ponto caberia (ex.: a recapitulação onde o protocolo deveria aparecer).
  const call: FeedbackViewCall = childDetail.call.kind === "ABSENCE" && compositeQuote ? { ...childDetail.call, context: compositeQuote } : childDetail.call
  const covered = composite[0]!.process!.completeness!.absent
  const howToApply = [childDetail.howToApply, `Inclua também ${joinAnd(covered.map(communicateClauseOf))} ${recap ? "na recapitulação final" : `em “${compositeDetail.title}”`}.`].filter((text): text is string => Boolean(text)).join(" ")
  const sourceKey = (source: FeedbackViewSource) => `${source.documentId}|${source.section ?? ""}`
  return {
    ...childDetail,
    key: `${childDetail.key}+${compositeDetail.key}`,
    title: sameSection ? PHASE_TITLE[phase as Exclude<AttendancePhase, "OTHER">] : childDetail.title,
    whatHappened: call.kind === "NONE" ? `${capitalizeFirst(childHappened)} e, por isso, também ficou de fora da ${topic}.` : "",
    call,
    // O texto validado do ponto principal; o da composta (lista do checklist) não se repete aqui — continua no artefato e no QA.
    adjustment: call.kind === "NONE" ? [`${capitalizeFirst(childHappened)} e, por isso, também ficou de fora da ${topic}.`] : [],
    guidance: {
      rules: [...childDetail.guidance.rules, ...compositeDetail.guidance.rules.filter((rule) => !childDetail.guidance.rules.some((other) => other.text === rule.text))],
      avoid: unique([...childDetail.guidance.avoid, ...compositeDetail.guidance.avoid]),
      examples: unique([...childDetail.guidance.examples, ...compositeDetail.guidance.examples]),
    },
    sources: [...childDetail.sources, ...compositeDetail.sources.filter((source) => !childDetail.sources.some((other) => sourceKey(other) === sourceKey(source)))],
    howToApply,
    itemIndexes: [...childDetail.itemIndexes, ...compositeDetail.itemIndexes],
    consolidates: [childDetail.title, compositeDetail.title],
  }
}

/** Cada ajuste conhece os outros (título + radicais): o que já é outro ajuste nunca tem a orientação repetida. */
function developmentsOf(groups: readonly EmittedItem[][]): FeedbackViewDevelopment[] {
  const siblings = groups.map((group) => ({ title: developmentBlockLabelOf(group) ?? findingLabelOf(group[0]!), mention: narrativeGapOf(group).mention }))
  const details = groups.map((group, index) => developmentOf(group, siblings.filter((_, position) => position !== index)))
  const consolidations = consolidationsOf(groups)
  return details.flatMap((detail, index) => {
    if (consolidations.some((entry) => entry.composite === index)) return []
    const merge = consolidations.find((entry) => entry.into === index)
    return [merge ? consolidatedDevelopment(groups[index]!, groups[merge.composite]!, detail, details[merge.composite]!) : detail]
  })
}

/**
 * "Atendimento de 29/09/2026 · Contestação de cobrança" → título = assunto, subtítulo = "Atendimento de 29/09/2026"
 * (`FEEDBACK_HEADING_V1`). Rótulo só com a data (atendimento sem assunto confiável) → título NEUTRO e a data continua separada —
 * antes a data inteira virava o título.
 */
export function headingOf(label: string): FeedbackViewHeading {
  const about = aboutOf(label)
  if (about.date && !about.subject) return { title: NEUTRAL_INTERACTION_TITLE, subtitle: `Atendimento de ${about.date}`, subjectSource: "NONE" }
  // Sem a data do atendimento o rótulo não é "data · assunto" (ex.: indicador "TMA · Fechamento setembro"): fica inteiro.
  if (!about.subject || !about.date) return { title: label, subtitle: null }
  return { title: about.subject, subtitle: `Atendimento de ${about.date}` }
}

/** Vocativo natural: "Você conduziu…" → "Larissa, você conduziu…" (o nome é do cadastro, nunca do modelo). */
/** FEEDBACK EXPERIENCE V2 — aberturas em que o nome entra como vocativo sem mudar o sentido ("Larissa, nesta chamada o cliente…"). */
const VOCATIVE_OPENERS = /^(?:Você|Nesta|Neste|Nessa|Nesse|Nestas|Nestes|Durante|Na|No|Nas|Nos|Ao|Quando|Hoje|Aqui|Sobre|Em|Antes|Depois|Pelo|Pela|O|A|Os|As)\s/u
function withVocative(paragraphs: readonly string[], firstName: string | null | undefined): { greeting: string | null; narrative: string[] } {
  const [first, ...rest] = paragraphs
  // A palavra de abertura é da lista (nunca nome próprio): a inicial vira minúscula, inclusive o artigo de uma letra ("O cliente…").
  if (firstName && first && VOCATIVE_OPENERS.test(first)) return { greeting: null, narrative: [`${firstName}, ${first[0]!.toLocaleLowerCase("pt-BR")}${first.slice(1)}`, ...rest] }
  return { greeting: firstName ? `Olá, ${firstName}!` : null, narrative: [...paragraphs] }
}

/** O view model de uma emissão (itens que SAEM + a apresentação final). Null fora da monitoria de processo V2. */
export function feedbackViewOf(items: readonly EmittedItem[], presentation: FeedbackPresentation | null | undefined, options: { confirmedProducts?: readonly ConfirmedProduct[]; label?: string | null } = {}): FeedbackView | null {
  if (!presentation?.narrative || items.length === 0) return null
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  const strengths = items.filter((item) => item.section === "STRENGTH")
  const attention = items.filter((item) => item.section === "ATTENTION" && item.applicability)
  const { greeting, narrative } = withVocative(presentation.narrative, presentation.firstName)
  const confirmed = options.confirmedProducts ?? []
  return {
    version: FEEDBACK_VIEW_VERSION,
    ...(options.label ? { heading: headingOf(options.label) } : {}),
    card: presentation.card ?? narrative[0] ?? "",
    greeting,
    narrative,
    developments: developmentsOf(composeDevelopmentBlocks(development)),
    // FEEDBACK EXPERIENCE V2 — "O que manter" nos detalhes = as EVIDÊNCIAS (a narrativa já reconheceu; nada de resumo-modelo repetindo-a).
    // A frase do ponto forte só aparece quando descreve a conduta ("Você …"), nunca a formulação genérica.
    maintain: strengths.length > 0 ? { summary: "", evidence: strengths.map((item) => ({ title: findingLabelOf(item), statement: /^Você\s/u.test(item.wording.observed.trim()) ? item.wording.observed.trim() : "", quotes: quotesOf([item]), itemIndex: item.index, phase: phaseOf(item) })) } : null,
    attention: attention.map((item) => ({ title: item.sectionLabel, markdown: renderApplicabilityMarkdown(item), itemIndex: item.index })),
    materials: supportMaterialLineageOf(items).map((material) => ({ documentId: material.documentId, title: material.title, href: material.href, usedIn: unique(material.usedIn.map((use) => use.step)), sections: unique(items.flatMap(feedbackKnowledgeOf).filter((knowledge) => knowledge.documentId === material.documentId).map((knowledge) => sectionLabelOf(knowledge.heading) ?? "")) })),
    context: confirmed.length > 0 ? `Produto identificado: ${confirmed.map((entry) => `${entry.product} (confirmado ${entry.source === "SYSTEM_DATA" ? "pelo assunto registrado do atendimento" : "pela fala da chamada"})`).join(", ")}.` : null,
  }
}

// ---------------------------------------------------------------------------------------------
// Markdown derivado (texto publicado no campo recomendação, texto do nó, prévia do QA e leitores antigos)
// ---------------------------------------------------------------------------------------------

export const DETAILS_HEADING = "Entenda este feedback"
/** Rótulo do exemplo presente no material (os detalhes não explicam arquitetura regra × exemplo ao colaborador). */
export const PROCEDURE_EXAMPLE_LABEL = "Exemplo do procedimento (ilustrativo)"
const part = (kind: FeedbackDocumentPart["kind"], markdown: string, itemIndexes: number[] = [], label: string | null = null, section: FeedbackDocumentPart["section"] = null): FeedbackDocumentPart => ({ kind, markdown, itemIndexes, label, section })
const quoteLine = (quote: FeedbackViewQuote) => `> ${quote.intro}: “${escapeMarkdownQuote(`${quote.text}${quote.truncated ? "…" : ""}`)}”`

function developmentMarkdown(detail: FeedbackViewDevelopment, items: readonly EmittedItem[]): string {
  const group = items.filter((item) => detail.itemIndexes.includes(item.index))
  const call = detail.call.kind === "QUOTES"
    ? detail.call.quotes.map(quoteLine).join("\n>\n")
    : detail.call.kind === "ABSENCE"
      ? [`_${escapeMarkdownQuote(detail.call.statement)}_`, ...(detail.call.context ? [`_Momento em que caberia:_\n\n${quoteLine(detail.call.context)}`] : [])].join("\n\n")
      : null
  // Estrutura enxuta (V2): o que aconteceu → na chamada → o processo orienta → (por que importa, só com base) → como melhorar
  // (+ exemplo, só quando seguro). O container já diz que são ajustes: nada de "O que precisa ser ajustado" dentro dele.
  const happened = (detail.adjustment.length > 0 ? detail.adjustment : [detail.whatHappened]).filter((text) => text.trim().length > 0)
  const example = detail.suggestedResponse ? group.map(renderSuggestedResponse).find((blocks) => blocks.length > 0) ?? [] : []
  return [
    `### ${escapeMarkdownQuote(detail.title)}`,
    ...(happened.length > 0 ? [`**O que aconteceu**\n\n${happened.length > 1 ? happened.map((text) => `- ${text}`).join("\n") : happened[0]}`] : []),
    ...(call ? [`**Na chamada**\n\n${call}`] : []),
    ...processGuidanceBlocks([...group].sort((left, right) => Number(isAvoid(left)) - Number(isAvoid(right))).flatMap(feedbackKnowledgeOf), "O processo orienta", { exampleLabel: PROCEDURE_EXAMPLE_LABEL }),
    ...detail.whyItMatters.map((text) => `**Por que importa:** ${text}`),
    ...(detail.howToApply ? [`**Como melhorar:** ${detail.howToApply}`] : []),
    ...example,
  ].join("\n\n")
}

/** "Ver evidências" por fase do atendimento (a ordem dos pontos é preservada dentro da fase); sem fase = uma lista só. */
const PHASE_LABEL: Record<AttendancePhase, string> = { INVESTIGATION: "Investigação", TREATMENT: "Tratativa", CLOSING: "Encerramento", OTHER: "Outros pontos" }
export function evidenceByPhase(evidence: readonly FeedbackViewPositive[]): { label: string | null; entries: FeedbackViewPositive[] }[] {
  if (evidence.some((entry) => !entry.phase)) return [{ label: null, entries: [...evidence] }]
  const order: AttendancePhase[] = ["INVESTIGATION", "TREATMENT", "CLOSING", "OTHER"]
  const groups = order.map((phase) => ({ label: PHASE_LABEL[phase], entries: evidence.filter((entry) => entry.phase === phase) })).filter((group) => group.entries.length > 0)
  return groups.length > 1 ? groups : [{ label: null, entries: [...evidence] }]
}

/** Partes do documento V2 (cada parte diz de quais itens nasceu — é assim que o QA destaca o ponto que está avaliando). */
export function feedbackViewParts(view: FeedbackView, items: readonly EmittedItem[]): FeedbackDocumentPart[] {
  const evidenceLine = (entry: FeedbackViewPositive) => [`- **${escapeMarkdownQuote(entry.title)}**${entry.statement ? `: ${entry.statement}` : ""}`, ...entry.quotes.map((quote) => `  ${quoteLine(quote)}`)].join("\n")
  const maintainEvidence = view.maintain ? evidenceByPhase(view.maintain.evidence).map((group) => [...(group.label ? [`_${group.label}_`] : []), group.entries.map(evidenceLine).join("\n")].join("\n\n")).join("\n\n") : ""
  return [
    ...(view.greeting ? [part("GREETING", view.greeting)] : []),
    part("INTRODUCTION", view.narrative.join("\n\n")),
    part("GROUP", `---\n\n**${DETAILS_HEADING}**`),
    ...(view.context ? [part("OVERVIEW", escapeMarkdownQuote(view.context), items.map((item) => item.index))] : []),
    ...(view.developments.length > 0 ? [part("GROUP", "## O que precisa ser ajustado", [], null, "OPPORTUNITY"), ...view.developments.map((detail) => part("FINDING", developmentMarkdown(detail, items), detail.itemIndexes, detail.title, "OPPORTUNITY"))] : []),
    ...(view.maintain ? [part("GROUP", "## O que manter", [], null, "STRENGTH"), part("FINDING", view.maintain.summary ? `${view.maintain.summary}\n\n_Evidências:_\n\n${maintainEvidence}` : maintainEvidence, view.maintain.evidence.map((entry) => entry.itemIndex), "O que manter", "STRENGTH")] : []),
    ...(view.attention.length > 0 ? [part("GROUP", "## Pontos de atenção", [], null, "ATTENTION"), ...view.attention.map((entry) => part("FINDING", entry.markdown, [entry.itemIndex], entry.title, "ATTENTION"))] : []),
    ...(view.materials.length > 0 ? [part("MATERIALS", `**Materiais utilizados**\n\n${view.materials.map((material) => `- ${material.href ? `[${escapeMarkdownQuote(material.title)} ↗](${material.href})` : escapeMarkdownQuote(material.title)} — utilizado em: ${material.usedIn.map(escapeMarkdownQuote).join(" · ")}`).join("\n")}`, [...new Set(view.maintain?.evidence.map((entry) => entry.itemIndex) ?? [])].concat(view.developments.flatMap((detail) => detail.itemIndexes)))] : []),
  ]
}

export const isFeedbackView = (value: unknown): value is FeedbackView => Boolean(value) && typeof value === "object" && (value as { version?: unknown }).version === FEEDBACK_VIEW_VERSION && Array.isArray((value as { narrative?: unknown }).narrative)
/** Documentos citados pelo view model (fontes dos ajustes + materiais). */
export const feedbackViewDocumentIds = (view: FeedbackView) => [...new Set([...view.developments.flatMap((detail) => detail.sources.map((source) => source.documentId)), ...view.materials.map((material) => material.documentId)])]
/** O view model para QUEM LÊ: link só para o material que ele pode abrir (a referência não concede acesso). */
export function withMaterialAccess(view: FeedbackView, accessible: ReadonlySet<string>, hrefOf: (documentId: string) => string): FeedbackView {
  const resolve = <T extends { documentId: string }>(entry: T) => ({ ...entry, accessible: accessible.has(entry.documentId), href: accessible.has(entry.documentId) ? hrefOf(entry.documentId) : null })
  return { ...view, developments: view.developments.map((detail) => ({ ...detail, sources: detail.sources.map(resolve) })), materials: view.materials.map(resolve) }
}
