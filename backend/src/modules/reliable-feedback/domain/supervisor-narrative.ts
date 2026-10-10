import { createHash } from "node:crypto"
import { unsupportedTypedNumbers } from "./typed-number-grounding.js"
import { detectComprehensionClaim } from "../../investigation/domain/interaction-feedback-writer.js"
import { presentationViolations, type PresentationContext } from "./feedback-presentation.js"
import { composeDevelopmentBlocks, developmentBlockLabelOf, findingLabelOf, type EmittedItem } from "./reliable-feedback-artifact.js"
import { communicateClauseOf } from "./subitem-semantics.js"
import { applyFactuality, factualityGroundingOf, factualityPayloadOf, type FactualityVerdict, type StoredFactuality } from "./narrative-factuality.js"
import { expectedRuleOf, gapClauseOf, isAvoid, isDeclared, joinAnd, maintainClauseOf, mergeDeclared, PHASE_OPENING, phaseOf, type AttendancePhase } from "./supervisor-presentation.js"

/**
 * FEEDBACK POR FLAG V2 — NARRATIVA DE SUPERVISOR (`SUPERVISOR_FEEDBACK_NARRATIVE_V1`, domínio puro).
 *
 *   DIAGNÓSTICO   o artefato confiável (itens, evidência, regra, status…) — intocado; nada aqui decide o que aconteceu.
 *   NARRATIVA     como um supervisor diria isso: reconhecimento → principal ajuste → como fazer na próxima → o que manter.
 *   DETALHES      a prova (fala, regra, processo, material) — renderizada pelo sistema a partir do artefato (feedback-view.ts).
 *
 * O redator (SUPERVISOR_FEEDBACK_NARRATIVE) recebe SÓ o `NarrativeBrief` — fatos já decididos, em linguagem de supervisor, sem
 * ids, sem nome, sem evidência bruta — e só decide COMO dizer. O texto dele é conferido aqui (`narrativeViolations`); qualquer
 * violação derruba o CAMPO (narrativa ou card) para a versão determinística (`deterministicNarrative`), que nunca volta ao
 * formato de relatório.
 */
export const SUPERVISOR_NARRATIVE_VERSION = "SUPERVISOR_FEEDBACK_NARRATIVE_V1" as const

export type NarrativeDraft = { paragraphs: string[]; card: string
  /** MONITORING V2 — composição V5: cada frase com postura e refs (S-n força, A-n ajuste); o card com as refs. Ausente = V1–V4. */
  sentences?: { paragraph: number; text: string; stance: "CONTEXT" | "STRENGTH" | "ADJUSTMENT" | "GUIDANCE"; refs: string[] }[]
  cardRefs?: string[] }
export type NarrativeEvidence = "OBSERVED_IN_CALL" | "VERIFIED_ABSENCE" | "NOT_OBSERVED"
export type NarrativeGap = {
  /** "a recapitulação final", "o protocolo" — o assunto em linguagem de supervisor (nunca o nome interno da etapa). */
  topic: string
  phase: AttendancePhase
  /** O que aconteceu, dito como supervisor ("a recapitulação ficou incompleta"). */
  happened: string
  /** O que faltou COMUNICAR (etapa composta parcial), em linguagem de comportamento, sem o que já é outro ajuste. */
  missingPoints: string[]
  /** Itens literais da regra comprovadamente ausentes (auditoria/brief; nunca viram orientação crua). */
  absentItems: string[]
  /** Índice do ajuste que já cobre tudo o que faltou aqui (ex.: recapitulação sem protocolo × o próprio protocolo). */
  coveredBy: number | null
  evidence: NarrativeEvidence
  /** Como fazer na próxima: contextual (nunca a regra inteira); null = sem orientação fundamentada. */
  guidance: string | null
  /** Regra oficial curta de uma linha (quando existe). */
  procedureSays: string | null
  /** Radicais (sem acento) que precisam aparecer na narrativa para o ajuste estar representado. */
  mention: string[]
  itemIndexes: number[]
  /** MONITORING V2 — o que aconteceu neste ponto, no contexto da chamada (especialista, V5). Contexto para a redação, nunca evidência. */
  context?: string[]
  /** FEEDBACK EXPERIENCE V2 — as falas VERIFICADAS do ponto (projeção de exibição), para o redator parafrasear o que aconteceu. */
  quotes?: string[]
}
export type NarrativePositive = { phase: AttendancePhase; clause: string; claim: "ACTION" | "DECLARED"; behavior: string | null; mention: string[]; itemIndexes: number[]; context?: string[]; quotes?: string[] }
export type NarrativeBrief = {
  version: typeof SUPERVISOR_NARRATIVE_VERSION
  about: { date: string | null; subject: string | null }
  positives: NarrativePositive[]
  gaps: NarrativeGap[]
  attention: string[]
  /** MONITORING V2 — contexto da chamada (motivo, situação, caminho) declarado pelo especialista (V5). */
  interaction?: { customerNeed: string | null; situation: string | null; path: string | null } | null
  /** Identidade dos itens que o brief descreve (índice + seção + texto): o rascunho do redator só vale para os MESMOS itens. */
  itemsKey: string
}

const PHASES: readonly AttendancePhase[] = ["INVESTIGATION", "TREATMENT", "CLOSING", "OTHER"]
const PHASE_NOUN: Record<Exclude<AttendancePhase, "OTHER">, string> = { INVESTIGATION: "a investigação do caso", TREATMENT: "a tratativa", CLOSING: "o encerramento" }

/**
 * Vocabulário FECHADO por comportamento canônico (lacuna em linguagem de supervisor). Comportamento fora do catálogo usa o
 * assunto do achado e a frase de lacuna já existente (`gapClauseOf`) — nunca exige código novo.
 */
type NarrativeBehavior = { topic: string; inTopic: string; gap: string; partialGap?: string; mention: string[] }
const NARRATIVE_BEHAVIOR: Readonly<Record<string, NarrativeBehavior>> = {
  VALIDATE_HOLDER: { topic: "a validação do titular", inTopic: "Na validação do titular", gap: "a validação do titular não seguiu o procedimento", mention: ["titular"] },
  IDENTIFY_CHARGE: { topic: "a identificação da cobrança", inTopic: "Na identificação da cobrança", gap: "a cobrança questionada não foi identificada com o cliente", mention: ["cobranc"] },
  CHECK_PAYMENT: { topic: "a verificação do pagamento", inTopic: "Na verificação do pagamento", gap: "não foi verificado se a conta já tinha sido paga", mention: ["pagament", "paga"] },
  OPEN_ANALYSIS: { topic: "a abertura da análise", inTopic: "Na abertura da análise", gap: "a abertura da análise não seguiu o procedimento", mention: ["abertura"] },
  REGISTER_DISPUTE: { topic: "o registro da contestação", inTopic: "No registro da contestação", gap: "o registro da contestação não seguiu o procedimento", mention: ["registr"] },
  CANCEL_RECURRING_SERVICE: { topic: "o cancelamento da recorrência", inTopic: "No cancelamento da recorrência", gap: "o cancelamento da recorrência não seguiu o procedimento", mention: ["cancel", "recorren"] },
  INFORM_DEADLINE: { topic: "o prazo da análise", inTopic: "No prazo da análise", gap: "o prazo da análise não foi informado ao cliente", mention: ["prazo"] },
  RECAPITULATE_INTERACTION: { topic: "a recapitulação final", inTopic: "Na recapitulação", gap: "a recapitulação não seguiu o que o procedimento prevê", partialGap: "a recapitulação ficou incompleta", mention: ["recapitul", "resum"] },
  CONFIRM_SOLUTION: { topic: "a confirmação da solução aplicada", inTopic: "Na confirmação da solução", gap: "a solução aplicada não foi retomada com o cliente", mention: ["solucao"] },
  PROVIDE_PROTOCOL: { topic: "o protocolo", inTopic: "No protocolo", gap: "o protocolo não foi informado ao cliente", mention: ["protocolo"] },
  CONFIRM_UNDERSTANDING: { topic: "a confirmação de entendimento", inTopic: "Na confirmação de entendimento", gap: "não foi verificado se o cliente tinha dúvidas", mention: ["duvida", "entend", "claro", "clara"] },
}

export const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const capitalize = (text: string) => (text.length > 0 ? text[0]!.toLocaleUpperCase("pt-BR") + text.slice(1) : text)
const lowerFirst = (text: string) => (text.length > 1 && /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLocaleLowerCase("pt-BR") + text.slice(1) : text)
const unique = (values: readonly string[]) => [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))]
/** Radicais de um rótulo livre (cauda longa): palavras de 5+ letras, sem acento, cortadas em 6. */
const labelStems = (label: string) => unique((fold(label).match(/\p{L}{5,}/gu) ?? []).map((word) => word.slice(0, 6)))
/** Orientação que reproduz a regra inteira ("informe: A, B, C, D, E…") não é orientação contextual. */
const isChecklistDump = (text: string) => (text.match(/[,;]/g)?.length ?? 0) >= 4

/** "Atendimento de 28/09/2026 · Contestação de cobrança" → data e assunto. */
export function aboutOf(label: string): NarrativeBrief["about"] {
  const [head, ...rest] = label.split(" · ")
  const date = head?.startsWith("Atendimento de ") ? head.slice("Atendimento de ".length).trim() : null
  const subject = rest.join(" · ").trim()
  return { date: date || null, subject: subject || null }
}

export function narrativeItemsKey(items: readonly EmittedItem[]): string {
  const identity = items.map((item) => [item.index, item.section, item.wording.observed, item.wording.whatYouCanDo, item.wording.whyItMatters].join("|")).join("\n")
  return createHash("sha256").update(identity).digest("hex").slice(0, 24)
}

export function narrativeGapOf(group: readonly EmittedItem[]): NarrativeGap {
  const main = group.find((item) => !isAvoid(item)) ?? group[0]!
  const behavior = NARRATIVE_BEHAVIOR[main.process?.behavior?.code ?? ""]
  const label = developmentBlockLabelOf(group) ?? findingLabelOf(main)
  const completeness = main.process?.completeness ?? null
  const partial = completeness?.status === "PARTIAL"
  const happened = isAvoid(main) ? "apareceu uma formulação que o procedimento pede para evitar" : partial && behavior?.partialGap ? behavior.partialGap : behavior?.gap ?? gapClauseOf(main)
  const evidenceType = main.process?.evidenceType
  return {
    topic: behavior?.topic ?? `“${label}”`,
    phase: phaseOf(main),
    happened,
    missingPoints: [],
    absentItems: partial ? unique(completeness!.absent) : [],
    coveredBy: null,
    evidence: evidenceType === "VERIFIED_OMISSION" ? "VERIFIED_ABSENCE" : evidenceType === "UNVERIFIED_OMISSION" ? "NOT_OBSERVED" : "OBSERVED_IN_CALL",
    guidance: null,
    procedureSays: expectedRuleOf(main),
    mention: behavior?.mention ?? (isAvoid(main) ? ["evit", ...labelStems(label)] : labelStems(label)),
    itemIndexes: group.map((item) => item.index),
  }
}

const RESTATES_RULE = /siga\s+o\s+que\s+o\s+procedimento\s+orienta|aplicando\s+o\s+que\s+o\s+procedimento\s+orienta/iu
const FORWARD_TIME_LEAD = /^(?:(?:na|nas)\s+pr[óo]xim[ao]s?\s+(?:chamadas?|liga[çc](?:ão|ões)|atendimentos?)|a\s+partir\s+de\s+agora|daqui\s+(?:para|pra)\s+frente|sempre\s+que\s+poss[íi]vel)\s*,?\s*/iu
/** Orientação contextual do ajuste: na etapa composta parcial, só o que faltou; senão a orientação JÁ VALIDADA do item. */
function guidanceOf(group: readonly EmittedItem[], gap: NarrativeGap): string | null {
  const main = group.find((item) => !isAvoid(item)) ?? group[0]!
  if (main.process?.completeness?.status === "PARTIAL") {
    if (gap.missingPoints.length === 0) return null
    // O que COMUNICAR (frase de comportamento por tipo de item), nunca o rótulo do checklist ("inclua “conta ajustada”").
    return main.process?.behavior?.code === "RECAPITULATE_INTERACTION" ? `inclua na recapitulação ${joinAnd(gap.missingPoints)}.` : `informe também ${joinAnd(gap.missingPoints)}.`
  }
  // FEEDBACK EXPERIENCE V2 — "siga o que o procedimento orienta: “…”" não é orientação: a regra já vai em `procedureSays`.
  const validated = group.map((item) => item.wording.whatYouCanDo.trim()).find((text) => text.length > 0 && text.length <= 260 && !isChecklistDump(text) && !RESTATES_RULE.test(text))
  // V1.7.4 — a narrativa acrescenta "Na próxima chamada, …": a orientação não pode trazer de novo o mesmo marcador de tempo
  // ("Na próxima chamada, nas próximas chamadas, evite…").
  return validated ? validated.replace(FORWARD_TIME_LEAD, "") : null
}

/** Até 3 falas verificadas do ponto (operador/cliente), já na projeção de exibição (privacidade aplicada). */
const SPEAKER: Partial<Record<string, string>> = { OPERADOR: "Operador", CLIENTE: "Cliente" }
const evidenceOf = (group: readonly EmittedItem[]) => unique(group.flatMap((item) => item.facts.filter((fact) => SPEAKER[fact.role]).map((fact) => `${SPEAKER[fact.role]}: ${fact.text}${fact.truncated ? "…" : ""}`))).slice(0, 3)

/**
 * O BRIEF: tudo o que a narrativa pode dizer, já decidido e em linguagem de supervisor. Só dos itens que SAEM.
 * Itens de ponto forte → o que manter (ação observada × ação DECLARADA ao cliente, nunca promovida); blocos de desenvolvimento
 * (a mesma composição dos detalhes) → ajustes; pontos de atenção → frase neutra (incerteza nunca vira erro).
 */
export function narrativeBriefOf(items: readonly EmittedItem[], label: string, options: { interaction?: NarrativeBrief["interaction"] } = {}): NarrativeBrief {
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  const blocks = composeDevelopmentBlocks(development)
  const gaps = blocks.map(narrativeGapOf)
  // O ponto que já é outro ajuste (ex.: "protocolo") não é repetido como item faltante da recapitulação; quando TUDO o que faltou
  // é outro ajuste, a recapitulação passa a ser dita junto dele ("…, nem mesmo na recapitulação").
  gaps.forEach((gap, index) => {
    const coveredBy = (point: string) => gaps.findIndex((other, position) => position !== index && other.mention.some((stem) => fold(point).includes(stem)))
    const remaining = gap.absentItems.filter((point) => coveredBy(point) < 0)
    gap.missingPoints = remaining.map(communicateClauseOf)
    if (gap.absentItems.length > 0 && remaining.length === 0) {
      gap.coveredBy = coveredBy(gap.absentItems[0]!)
      gap.happened = `${gap.topic} não incluiu ${joinAnd(gap.absentItems.map(communicateClauseOf))}`
    }
  })
  blocks.forEach((group, index) => { gaps[index]!.guidance = guidanceOf(group, gaps[index]!); const context = unique(group.map((item) => item.process?.summary ?? "")); if (context.length > 0) gaps[index]!.context = context; const quotes = evidenceOf(group); if (quotes.length > 0) gaps[index]!.quotes = quotes })
  const positives = items.filter((item) => item.section === "STRENGTH").map((item): NarrativePositive => {
    const behavior = item.process?.behavior?.code ?? null
    const quotes = evidenceOf([item])
    return { phase: phaseOf(item), clause: maintainClauseOf(item), claim: isDeclared(item) ? "DECLARED" : "ACTION", behavior, mention: NARRATIVE_BEHAVIOR[behavior ?? ""]?.mention ?? labelStems(findingLabelOf(item)), itemIndexes: [item.index], ...(item.process?.summary ? { context: [item.process.summary] } : {}), ...(quotes.length > 0 ? { quotes } : {}) }
  })
  const attention = items.some((item) => item.section === "ATTENTION") ? ["Em um ponto, o produto tratado ficou em aberto; os detalhes mostram o que conferir."] : []
  return { version: SUPERVISOR_NARRATIVE_VERSION, about: aboutOf(label), positives, gaps, attention, ...(options.interaction ? { interaction: options.interaction } : {}), itemsKey: narrativeItemsKey(items) }
}

const clausesOf = (positives: readonly NarrativePositive[]) => mergeDeclared(unique(positives.map((positive) => positive.clause)))
/** Pontos fortes por fase, na ordem do atendimento, até `perPhase` por fase (o excedente vai para "o que manter"). */
function byPhase(positives: readonly NarrativePositive[], phases: readonly AttendancePhase[], perPhase: number): { phase: AttendancePhase; positives: NarrativePositive[] }[] {
  return phases.map((phase) => ({ phase, positives: positives.filter((positive) => positive.phase === phase).slice(0, perPhase) })).filter((group) => group.positives.length > 0)
}

/**
 * NARRATIVA DETERMINÍSTICA (fallback do redator; sempre válida por construção): reconhecimento → principal ajuste → como fazer
 * na próxima → o que manter. Nunca placar, nunca formato de relatório, nunca a regra inteira, nunca a mesma conclusão duas vezes.
 */
export function deterministicNarrative(brief: NarrativeBrief): NarrativeDraft {
  const { positives, gaps } = brief
  const gapPhases = new Set(gaps.map((gap) => gap.phase))
  const conducted = PHASES.filter((phase) => phase !== "OTHER" && positives.some((positive) => positive.phase === phase) && !gapPhases.has(phase)) as Exclude<AttendancePhase, "OTHER">[]
  const subject = brief.about.subject ? ` sobre ${lowerFirst(brief.about.subject)}` : ""
  const paragraphs: string[] = []
  let highlighted: NarrativePositive[] = []

  if (gaps.length === 0 && positives.length > 0) {
    // Sem ajuste: reconhecimento por fase (até 2 por fase); o resto em "Você também…".
    const groups = byPhase(positives, PHASES.filter((phase) => phase !== "OTHER"), 2)
    highlighted = groups.flatMap((group) => group.positives)
    const phaseClauses = groups.map((group) => `${PHASE_OPENING[group.phase as Exclude<AttendancePhase, "OTHER">]}, ${joinAnd(clausesOf(group.positives))}`)
    // V1.7.4 — sem fase reconhecida (pontos só da cauda longa): o reconhecimento cita os próprios pontos na mesma frase — nunca
    // "Outros pontos…" sem um primeiro.
    if (phaseClauses.length === 0) highlighted = positives.slice(0, 3)
    const clauses = phaseClauses.length > 0 ? phaseClauses.join("; ") : joinAnd(clausesOf(highlighted))
    paragraphs.push(`Você conduziu bem este atendimento${subject}${clauses.length > 0 ? `: ${clauses}` : ""}.`)
  } else if (conducted.length > 0) {
    // Com ajuste: as fases bem conduzidas (nunca a fase do ajuste), até 3 exemplos por fase.
    const groups = byPhase(positives, conducted, 3)
    highlighted = groups.flatMap((group) => group.positives)
    const [first, ...others] = groups
    paragraphs.push(`Você conduziu bem ${joinAnd(conducted.map((phase) => PHASE_NOUN[phase]))}: ${joinAnd(clausesOf(first!.positives))}${others.map((group) => `; ${PHASE_OPENING[group.phase as Exclude<AttendancePhase, "OTHER">]}, ${joinAnd(clausesOf(group.positives))}`).join("")}.`)
  } else if (positives.length > 0) {
    highlighted = positives.slice(0, 3)
    paragraphs.push(`Neste atendimento, você ${joinAnd(clausesOf(highlighted))}.`)
  }
  const rest = positives.filter((positive) => !highlighted.includes(positive))

  if (gaps.length > 0) {
    const listed = shownGapsOf(gaps)
    const phases = unique(listed.map((gap) => gap.phase)) as AttendancePhase[]
    const lead = phases.length === 1 && phases[0] !== "OTHER"
      ? `O principal ajuste está ${PHASE_OPENING[phases[0] as Exclude<AttendancePhase, "OTHER">]}: `
      : phases.every((phase) => phase !== "OTHER")
        ? `Os ajustes estão ${joinAnd(phases.map((phase) => PHASE_OPENING[phase as Exclude<AttendancePhase, "OTHER">]))}: `
        : listed.length === 1 ? "O principal ajuste deste atendimento: " : "Os pontos a ajustar neste atendimento: "
    const sentences = [
      `${lead}${joinAnd(listed.map((gap) => gap.shown))}.`,
      // O que faltou só é listado aqui quando a orientação abaixo não o diz (nunca a mesma conclusão duas vezes).
      ...gaps.filter((gap) => gap.missingPoints.length > 0 && !gap.guidance).map((gap) => `${NARRATIVE_BEHAVIOR_IN_TOPIC(gap)}, faltou comunicar ${joinAnd(gap.missingPoints)}.`),
      ...(gaps[0]!.procedureSays ? [`O procedimento orienta: “${gaps[0]!.procedureSays}”${/[.!?]$/.test(gaps[0]!.procedureSays) ? "" : "."}`] : []),
      ...brief.attention,
    ]
    paragraphs.push(sentences.join(" "))
    const guidance = unique(gaps.map((gap) => gap.guidance ?? ""))
    if (guidance.length > 0) paragraphs.push(guidance.map((text, index) => (index === 0 ? `Na próxima chamada, ${lowerFirst(text)}` : capitalize(text))).join(" "))
    if (rest.length > 0) paragraphs.push(`Mantenha também o que você fez bem no restante da chamada: ${joinAnd(clausesOf(rest))}.`)
  } else {
    if (brief.attention.length > 0) paragraphs.push(brief.attention.join(" "))
    if (rest.length > 0) paragraphs.push(`${rest.length === 1 ? "Outro ponto que você conduziu bem" : "Outros pontos que você conduziu bem"}: ${joinAnd(clausesOf(rest))}.`)
    if (positives.length > 0) paragraphs.push("Mantenha essa forma de conduzir nas próximas chamadas.")
  }
  return { paragraphs, card: deterministicCard(brief, conducted) }
}
/** Ajustes como a narrativa os DIZ: o coberto por outro ajuste entra junto dele ("o protocolo não foi informado ao cliente, nem
 * mesmo na recapitulação"), nunca repetido. */
function shownGapsOf(gaps: readonly NarrativeGap[]): (NarrativeGap & { shown: string })[] {
  const shown = gaps.flatMap((gap, index) => {
    if (gap.coveredBy !== null && gap.coveredBy >= 0) return []
    const joined = gaps.filter((other) => other.coveredBy === index).map((other) => lowerFirst(NARRATIVE_BEHAVIOR_IN_TOPIC(other)))
    return [{ ...gap, shown: joined.length > 0 ? `${gap.happened}, nem mesmo ${joinAnd(joined)}` : gap.happened }]
  })
  // MONITORING V2 — dois ajustes da mesma seção ("o ponto “Reparo fixa” precisa de ajuste") são ditos uma vez só.
  return shown.filter((gap, index) => shown.findIndex((other) => other.shown === gap.shown) === index)
}
const NARRATIVE_BEHAVIOR_IN_TOPIC = (gap: NarrativeGap) => Object.values(NARRATIVE_BEHAVIOR).find((entry) => entry.topic === gap.topic)?.inTopic ?? `Em ${gap.topic}`

/** CARD do Acompanhamento: 2 frases, síntese humana (nunca contagem, código ou texto de auditoria). */
function deterministicCard(brief: NarrativeBrief, conducted: readonly Exclude<AttendancePhase, "OTHER">[]): string {
  const { gaps } = brief
  if (gaps.length === 0) {
    const subject = brief.about.subject ? ` sobre ${lowerFirst(brief.about.subject)}` : ""
    return `Você conduziu bem este atendimento${subject}. Veja no feedback o que manter nas próximas chamadas.`
  }
  const listed = shownGapsOf(gaps)
  const shown = listed.slice(0, 2).map((gap) => gap.shown)
  const gapPhrase = listed.length > 2 ? `${shown.join(", ")} e há outros ajustes` : joinAnd(shown)
  const phases = unique(listed.map((gap) => gap.phase)) as AttendancePhase[]
  // O assunto já dito na primeira frase não se repete ("…“2ª via” precisa de ajuste. Veja como ajustar esse ponto").
  const focus = phases.length === 1 && phases[0] !== "OTHER" ? PHASE_NOUN[phases[0] as Exclude<AttendancePhase, "OTHER">] : listed.length === 1 ? (gapPhrase.includes(listed[0]!.topic) ? "esse ponto" : listed[0]!.topic) : "esses pontos"
  const first = conducted.length > 0 ? `Você conduziu bem ${joinAnd(conducted.map((phase) => PHASE_NOUN[phase]))}, mas ${gapPhrase}.` : `Neste atendimento, ${gapPhrase}.`
  return `${first} Veja no feedback como ajustar ${focus} nas próximas chamadas.`
}

// ---------------------------------------------------------------------------------------------
// Validação do texto do redator (campo a campo: narrativa × card)
// ---------------------------------------------------------------------------------------------

/** Vocabulário de CONDUÇÃO da narrativa (não é fato): como um supervisor organiza a conversa com o colaborador. */
const NARRATIVE_VOCABULARY = [
  "fechamento encerrar encerramento finalizar finalização revisão revise revisar rápida rápido levar leve contato conversa ligação ligações cliente clientes",
  "informações informação essenciais essencial resolvido resolvida feito feita fez despedir despedida conduziu conduzir conduza condução investigação investigou",
  "investigar tratativa tratar explicou explicar explicação mantenha manter continue funcionou funcionaram restante próxima próximas chamadas incompleta incompleto",
  "faltou faltaram ficou ficaram fora completa completo pontos ponto ajuste ajustes ajustar principal cuidado atenção lembre lembrar antes depois durante momento",
  "final inclua incluir informe informar informou reforce reforçar retome retomar confirme confirmar parte partes certeza clareza claro claras forma jeito trecho",
  "detalhes abaixo procedimento prevê pede orienta orientação cada todas todos também ainda assim então porém caso tudo isso essa esse esses essas dele dela",
  "atendimento atendimentos chamada bem boa bons boas cobrou relação etapa etapas passos passo quando feedback veja entender entenda deixar além",
  "deixou revisar item itens ponto-chave seguinte seguintes combinado combinados fazer faça façam faz fará poderia pode podem precisa precisam cumpriu cumprir",
  "melhorar melhore melhor corretamente correta correto corretos objetiva objetivamente claramente naquele naquela daquele daquela aquele aquela deste desta neste nesta desse dessa nesse nessa",
  "outros outras outro outra aberto aberta conferir confira resumo resumir sempre início começo recapitular recapitule mostram mostra geral vale conduzido conduzida",
].join(" ")

const AUDIT_LANGUAGE = /(?<!\p{L})(?:checkpoint\p{L}*|ponto(?:s)?\s+de\s+desenvolvimento|pontos?\s+fortes?|foi\s+identificad[oa]\s+que|conforme\s+(?:a\s+)?análise|o\s+modelo|a\s+ia|inia|evid[êe]ncia\s+verificada|status|readiness|hold_for_qa|verified|needs_review|artefato|auditoria)(?!\p{L})/iu
/** V5 — só código/termo INTERNO do sistema (a palavra comum "status" fica de fora). */
const AUDIT_LANGUAGE_V5 = /(?<!\p{L})(?:checkpoint\p{L}*|ponto(?:s)?\s+de\s+desenvolvimento|pontos?\s+fortes?|foi\s+identificad[oa]\s+que|conforme\s+(?:a\s+)?análise|o\s+modelo|a\s+ia|inia|evid[êe]ncia\s+verificada|readiness|hold_for_qa|verified|needs_review|artefato|auditoria|CP-[0-9a-f]{4,})(?!\p{L})/iu
/** V5 — culpa DIRIGIDA ao colaborador (o prompt proíbe chamar a conduta de erro/falha/descuido). */
const OPERATOR_BLAME = /(?<!\p{L})(?:(?:seu|sua|teu|tua)\s+(?:erro|falha|descuido)|voc[êe]\s+(?:errou|falhou|se\s+descuidou|cometeu\s+(?:um\s+|uma\s+)?(?:erro|falha)|foi\s+descuidad\p{L}*)|(?:foi|houve)\s+(?:um\s+|uma\s+)?(?:erro|falha|descuido)\s+(?:seu|sua|de\s+sua\s+parte|na\s+sua\s+condução))(?!\p{L})/iu
const SCOREBOARD = /\d+\s+(?:pontos?|etapas?|itens?|comportamentos?|acertos?)(?!\p{L})/iu
const PLACEHOLDER_MARK = /\[[^\]]{1,60}\]|<[^>]{1,60}>|\{[^}]{0,60}\}|(?<!\p{L})X\s+dias(?!\p{L})/u
const PATTERN = /(?<!\p{L})(?:costum\p{L}*|frequentemente|com\s+frequ[êe]ncia|geralmente|normalmente|recorrente\p{L}*|recorrência\s+de\s+erros?|voc[êe]\s+sempre|sempre\s+(?:esquece|deixa|faz|erra))(?!\p{L})/iu
/** Frase que fala de um ajuste precisa dizer que é ajuste (negação, falta, prospectivo) — senão afirma o contrário do artefato. */
const GAP_MARKER = /(?<!\p{L})(?:n[ãa]o|faltou|faltaram|faltando|falta|incomplet\p{L}*|de\s+fora|ajust\p{L}*|sem|precis\p{L}*|próxim\p{L}*|inclu\p{L}*|informe|lembre|antes\s+de|revis\p{L}*|refor[çc]\p{L}*|aten[çc][ãa]o|orienta(?:r|[çc][ãa]o|[çc][õo]es)?|oriente|prev[êe]|pede|dev\p{L}*|fa[çc]a|mantenh\p{L}*|retom\p{L}*|confirme|garant\p{L}*|evit\p{L}*|cuidado|parte\s+d[oa])(?!\p{L})/iu
const NEGATIVE_FACT = /(?<!\p{L})(?:n[ãa]o\s+(?:foi|foram|fez|informou|verificou|validou|identificou|registrou|cancelou|perguntou|confirmou|forneceu|seguiu)|faltou|faltaram|deixou\s+de|ficou\s+incomplet\p{L}*|ficaram\s+de\s+fora|sem\s+(?:informar|verificar|validar|confirmar|registrar))(?!\p{L})/iu
/**
 * V1.7.4 — ELOGIO SÓ COM PONTO FORTE DO ARTEFATO (`NARRATIVE_STRENGTH_GROUNDING_V1`). O assessment é a única fonte de ponto forte:
 * frase de reconhecimento ("corretamente", "conduziu bem", "com clareza", "mantenha", "continue"…) precisa estar ligada a um ponto
 * forte do brief (radical do comportamento, termos da própria frase do ponto forte ou a fase bem conduzida); sem nenhum ponto forte,
 * nenhum elogio. Orientação prospectiva ("Na próxima chamada, explique de forma clara…") não é elogio — salvo "mantenha/continue",
 * que pressupõem algo feito bem.
 */
const PRAISE = /(?<!\p{L})(?:corretamente|adequadamente|acert\p{L}*|parab[ée]n\p{L}*|[óo]tim[oa]s?|excelente\p{L}*|bem\s+feit\p{L}*|(?:conduziu|conduzid[oa]|fez|feit[oa]|explicou|orientou|tratou|lidou|agiu|foi|trabalhou|seguiu|atendeu|resolveu|cuidou)\s+(?:muito\s+)?bem|mandou\s+bem|soube\s+\p{L}+|de\s+(?:forma|maneira)\s+(?:correta|adequada|clara|objetiva|precisa|cuidadosa|segura|eficaz)|com\s+(?:clareza|precis[ãa]o|seguran[çc]a|cuidado|aten[çc][ãa]o|objetividade)|claramente|bo[am]\s+(?:condu[çc][ãa]o|explica[çc][ãa]o|orienta[çc][ãa]o|forma|pr[áa]tica|trabalho)|ponto\s+positivo|destaque\s+positivo|funcionou\s+bem)(?!\p{L})/iu
const MAINTAIN = /(?<!\p{L})(?:mantenha|continue|siga\s+(?:assim|fazendo))(?!\p{L})/iu
const PRESCRIPTIVE_LEAD = /^(?:(?:na|nas)\s+pr[óo]xim\p{L}*|a\s+partir|daqui|informe|explique|oriente|evite|confirme|inclua|pergunte|procure|lembre|verifique|avalie|valide|antes\s+de|sempre\s+que|o\s+procedimento|vale\s|reveja|revise|retome|use|diga|fa[çc]a|registre|quando)/iu
const PHASE_STEM: Record<Exclude<AttendancePhase, "OTHER">, string> = { INVESTIGATION: "investiga", TREATMENT: "tratativa", CLOSING: "encerra" }
const isPraiseSentence = (sentence: string) => MAINTAIN.test(sentence) || (PRAISE.test(sentence) && !PRESCRIPTIVE_LEAD.test(sentence.trim()))
/** A frase de reconhecimento está ligada a um ponto forte do brief? */
function praiseAnchored(sentence: string, brief: NarrativeBrief, strengthOnly: readonly string[]): boolean {
  if (brief.positives.length === 0) return false
  const folded = fold(sentence)
  if (strengthOnly.some((stem) => folded.includes(stem))) return true
  // Termos da própria frase do ponto forte (≥ 2 em comum; 1 quando a frase só tem 1).
  if (brief.positives.some((positive) => { const stems = labelStems(positive.clause); const hits = stems.filter((stem) => folded.includes(stem)).length; return hits >= Math.min(2, stems.length) && hits > 0 })) return true
  const gapPhases = new Set(brief.gaps.map((gap) => gap.phase))
  const conducted = (Object.keys(PHASE_STEM) as Exclude<AttendancePhase, "OTHER">[]).filter((phase) => !gapPhases.has(phase) && brief.positives.some((positive) => positive.phase === phase))
  if (conducted.some((phase) => folded.includes(PHASE_STEM[phase]))) return true
  // Sem ajuste, o atendimento inteiro pode ser reconhecido.
  return brief.gaps.length === 0
}
const REPORTED = /(?<!\p{L})(?:informou|disse|comunicou|avisou|explicou|declarou|contou|garantiu\s+ao\s+cliente)(?!\p{L})/iu
/** Ação que o operador só DECLAROU ao cliente nunca vira execução afirmada (DECLARED_ACTION_ONLY). */
const EXECUTION_OF: Readonly<Record<string, RegExp>> = {
  REGISTER_DISPUTE: /(?<!\p{L})(?:registrou|fez\s+o\s+registro|realizou\s+o\s+registro|efetuou\s+o\s+registro|registro\s+(?:feito|realizado))(?!\p{L})/iu,
  OPEN_ANALYSIS: /(?<!\p{L})(?:abriu\s+(?:a|uma)\s+análise|fez\s+a\s+abertura|realizou\s+a\s+abertura|efetuou\s+a\s+abertura)(?!\p{L})/iu,
  CANCEL_RECURRING_SERVICE: /(?<!\p{L})(?:cancelou|fez\s+o\s+cancelamento|realizou\s+o\s+cancelamento|efetuou\s+o\s+cancelamento)(?!\p{L})/iu,
  VALIDATE_HOLDER: /(?<!\p{L})(?:validou|fez\s+a\s+validação|realizou\s+a\s+validação)(?!\p{L})/iu,
}
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+|\n+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0)

/** Textos que sustentam a narrativa: o brief (fatos já decididos) + o vocabulário de condução. */
export function narrativeGroundingOf(brief: NarrativeBrief): string[] {
  return [
    brief.about.date ?? "",
    brief.about.subject ?? "",
    ...brief.positives.map((positive) => positive.clause),
    ...brief.gaps.flatMap((gap) => [gap.topic, gap.happened, gap.guidance ?? "", gap.procedureSays ?? "", ...gap.missingPoints, ...gap.absentItems]),
    ...brief.attention,
    NARRATIVE_VOCABULARY,
  ]
}

/**
 * Checagens OBJETIVAS do texto (valem para a narrativa V1–V4 e para a composição V5): efeito garantido, causa, exemplo como fato,
 * nome/tratamento, culpa, linguagem de auditoria, placar, lacuna, padrão, compreensão não observada, número sem fonte do mesmo papel.
 * `lexicalGrounding` = a checagem de TERMO sem base contra um vocabulário fixo (V1–V4); a composição V5 não a usa — o vínculo
 * frase → ponto do assessment é conferido estruturalmente (`compositionViolations`).
 */
function objectiveViolations(text: string, items: readonly EmittedItem[], context: PresentationContext, grounding: readonly string[], lexicalGrounding: boolean): Set<string> {
  const violations = new Set<string>()
  // V5 (composição): sem a lista de termos permitidos; culpa só quando DIRIGIDA ao colaborador ("falha na internet" é o problema do
  // cliente, não culpa); linguagem interna sem a palavra comum "status" (o "status do reparo" é do procedimento).
  const v4Only = new Set(["PRESENTATION_UNSUPPORTED_CLAIM", "PRESENTATION_BLAME"])
  for (const code of presentationViolations({ introduction: text, closing: text }, items, { ...context, extraGrounding: [...grounding] })) if (code !== "PRESENTATION_EMPTY" && code !== "PRESENTATION_POLARITY_MISMATCH" && (lexicalGrounding || !v4Only.has(code))) violations.add(code)
  if (!lexicalGrounding && OPERATOR_BLAME.test(text)) violations.add("PRESENTATION_BLAME")
  if ((lexicalGrounding ? AUDIT_LANGUAGE : AUDIT_LANGUAGE_V5).test(text)) violations.add("NARRATIVE_AUDIT_LANGUAGE")
  if (SCOREBOARD.test(text)) violations.add("NARRATIVE_SCOREBOARD")
  if (PLACEHOLDER_MARK.test(text)) violations.add("NARRATIVE_PLACEHOLDER")
  if (PATTERN.test(text)) violations.add("PATTERN_LANGUAGE")
  if (detectComprehensionClaim(text).length > 0) violations.add("COMPREHENSION_UNOBSERVED")
  // TYPED_NUMBER_GROUNDING_V1 — número só com fonte do MESMO papel (prazo ≠ protocolo ≠ valor ≠ numeração de lista).
  const numberSources = [...grounding, ...items.flatMap((item) => [item.wording.observed, item.wording.whatYouCanDo, item.wording.whyItMatters, ...item.facts.map((fact) => fact.text)])]
  if (unsupportedTypedNumbers(text, numberSources).length > 0) violations.add("UNSUPPORTED_NUMBER")
  return violations
}

function textViolations(text: string, brief: NarrativeBrief, items: readonly EmittedItem[], context: PresentationContext, grounding: readonly string[]): string[] {
  // As guardas de sempre da apresentação (efeito garantido, causa, exemplo como fato, nome, tratamento, termo sem base…).
  // A polaridade da narrativa é conferida abaixo com mais precisão (frase a frase, contra o artefato): a heurística da abertura
  // antiga confundia "a cobrança que o cliente não reconhecia" (parte de um acerto) com crítica.
  const violations = objectiveViolations(text, items, context, grounding, true)
  // Contradição com o artefato: frase sobre um AJUSTE sem nenhum marcador de ajuste; frase sobre um ACERTO dita como falha.
  const gapStems = new Set(brief.gaps.flatMap((gap) => gap.mention))
  const strengthStems = new Set(brief.positives.flatMap((positive) => positive.mention))
  const gapOnly = [...gapStems].filter((stem) => !strengthStems.has(stem))
  const strengthOnly = [...strengthStems].filter((stem) => !gapStems.has(stem))
  for (const sentence of sentencesOf(text)) {
    const folded = fold(sentence)
    const aboutGap = gapOnly.some((stem) => folded.includes(stem))
    const aboutStrength = strengthOnly.some((stem) => folded.includes(stem))
    if (aboutGap && !GAP_MARKER.test(sentence)) violations.add("NARRATIVE_CONTRADICTS_ARTIFACT")
    if (aboutStrength && !aboutGap && NEGATIVE_FACT.test(sentence)) violations.add("NARRATIVE_CONTRADICTS_ARTIFACT")
    if (isPraiseSentence(sentence) && !praiseAnchored(sentence, brief, strengthOnly)) violations.add("NARRATIVE_UNSUPPORTED_STRENGTH")
    for (const positive of brief.positives.filter((entry) => entry.claim === "DECLARED" && entry.behavior && EXECUTION_OF[entry.behavior])) {
      if (EXECUTION_OF[positive.behavior!]!.test(sentence) && !REPORTED.test(sentence)) violations.add("DECLARED_ACTION_UPGRADE")
    }
  }
  return [...violations]
}

/**
 * Validação da NARRATIVA do redator: forma, guardas da apresentação, linguagem de auditoria/placar, lacunas, números, ação só
 * declarada, compreensão não observada, padrão — e TODO ajuste confiável representado (nenhum gap real escondido).
 */
export function narrativeViolations(paragraphs: readonly string[], brief: NarrativeBrief, items: readonly EmittedItem[], context: PresentationContext): string[] {
  const clean = paragraphs.map((paragraph) => paragraph.trim()).filter((paragraph) => paragraph.length > 0)
  if (clean.length === 0 || clean.length > 6 || clean.some((paragraph) => paragraph.length > 900) || clean.join(" ").length > 2800) return ["NARRATIVE_SHAPE"]
  const text = clean.join("\n\n")
  const violations = new Set(textViolations(text, brief, items, context, narrativeGroundingOf(brief)))
  const folded = fold(text)
  if (brief.gaps.some((gap) => !gap.mention.some((stem) => folded.includes(stem)))) violations.add("NARRATIVE_GAP_OMITTED")
  return [...violations]
}

/** Validação do CARD do redator: 1–3 frases, curto, ao menos um ajuste presente, as mesmas guardas da narrativa. */
export function cardViolations(card: string, brief: NarrativeBrief, items: readonly EmittedItem[], context: PresentationContext): string[] {
  const text = card.trim()
  const sentences = sentencesOf(text)
  if (text.length === 0 || text.length > 360 || sentences.length > 3) return ["NARRATIVE_SHAPE"]
  const violations = new Set(textViolations(text, brief, items, context, narrativeGroundingOf(brief)))
  // O card é síntese: precisa trazer ao menos um ajuste real (nunca um card só de elogio quando há ajuste).
  if (brief.gaps.length > 0 && !brief.gaps.some((gap) => gap.mention.some((stem) => fold(text).includes(stem)))) violations.add("NARRATIVE_GAP_OMITTED")
  return [...violations]
}

/**
 * MONITORING V2 — validação da COMPOSIÇÃO (redator V5). O redator escolhe estrutura, ordem e extensão; aqui se confere só o que é
 * verificável sem reinterpretar a chamada:
 *   VÍNCULO    toda ref existe; STRENGTH só com refs de força (S-n); ADJUSTMENT/GUIDANCE só com refs de ajuste (A-n); nenhuma ref de
 *              força fora de STRENGTH; todo ajuste aparece numa frase ADJUSTMENT; o card cita o principal ajuste (ou uma força, sem ajuste).
 *   ELOGIO     reconhecimento ("corretamente", "mantenha"…) só em frase STRENGTH — rede de segurança do bug real da chamada 4 (elogio
 *              inventado sobre um ajuste); frase STRENGTH não afirma falha.
 *   OBJETIVO   as checagens de sempre (efeito, causa, exemplo como fato, número, nome, culpa, auditoria, lacuna, padrão, ação só
 *              declarada escrita como feita) — nunca a lista de termos permitidos.
 * O redator não cria ponto: um ponto novo não tem ref; uma força sem S-n não existe.
 */
/**
 * MONITORING V2 (fase 4) — AJUSTE DITO COMO FEITO (`NARRATIVE_CONTRADICTS_FINDING`): o assessment diz que a etapa NÃO foi cumprida; a
 * frase não pode afirmar o contrário. Só duas formas objetivas, pela própria regra da etapa (nunca uma lista de temas):
 *   CHECAGEM não feita ("Avaliar se… está disponível") × frase que afirma a checagem ("confirmou", "após confirmar a disponibilidade");
 *   PROIBIÇÃO violada ("Não prometer…") × frase que afirma a abstenção ("não prometeu", "evitou prometer", "sem prometer").
 * Orientação (GUIDANCE, "só depois de confirmar", "o procedimento pede…") é prospectiva e nunca conta.
 */
const CHECK_STEP = /^(?:avaliar|verificar|confirmar|validar|checar|consultar|conferir)(?!\p{L})/u
const CHECK_CLAIMED = /(?<!\p{L})(?:(?:ap[óo]s|depois\s+de)\s+(?:ter\s+)?(?:confirmad\p{L}*|verificad\p{L}*|validad\p{L}*|avaliad\p{L}*|confirmar|verificar|validar|avaliar|checar|consultar|conferir)|confirmou|verificou|validou|avaliou|checou|consultou|conferiu)(?!\p{L})/iu
const NEGATED_BEFORE = /(?:n[ãa]o|nem|sem|nunca|s[óo]|somente|apenas)\s+(?:\p{L}+\s+)?$/iu
const PRESCRIPTIVE_MARK = /(?<!\p{L})(?:pede|orienta|precis\p{L}*|dev[ea]\p{L}*|vale|ideal|importante|lembre|pr[óo]xim\p{L}*|procedimento)(?!\p{L})/iu
const GENERIC_STEP_STEMS = new Set(["client", "operad", "atende", "chamad", "sempre", "quando", "antes", "depois"])
const stepTextOf = (item: EmittedItem) => (item.knowledge?.step ?? item.knowledge?.quote ?? item.process?.requirement ?? "").split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim()).find((line) => line.length > 0 && !line.endsWith(":")) ?? ""
function contradictsFinding(text: string, item: EmittedItem): boolean {
  const step = fold(stepTextOf(item)).replace(/^(?:o|a)\s+(?:operador|operadora|atendente)\s+(?:devera|deve|precisa)\s+/u, "").replace(/^(?:sempre|obrigatoriamente)\s+/u, "")
  const sentence = fold(text)
  if (CHECK_STEP.test(step)) {
    const object = (step.split(/[.;]/)[0]!.match(/\p{L}{5,}/gu) ?? []).slice(1).map((word) => word.slice(0, 6)).filter((stem) => !GENERIC_STEP_STEMS.has(stem))
    const words = new Set((sentence.match(/\p{L}{5,}/gu) ?? []).map((word) => word.slice(0, 6)))
    if (!object.some((stem) => words.has(stem))) return false
    for (const match of text.matchAll(new RegExp(CHECK_CLAIMED.source, "giu"))) if (!NEGATED_BEFORE.test(text.slice(0, match.index))) return true
    return false
  }
  const prohibited = /^(?:nao|nunca)\s+(\p{L}+)/u.exec(step)?.[1]
  if (!prohibited || prohibited.length < 5) return false
  const stem = prohibited.slice(0, -2)
  if (new RegExp(`(?<!\\p{L})(?:n[ãa]o|nunca|nem)\\s+(?:\\p{L}+\\s+)?${stem}\\p{L}*(?:ou|eu|iu)(?!\\p{L})`, "iu").test(sentence)) return true
  return !PRESCRIPTIVE_MARK.test(text) && new RegExp(`(?<!\\p{L})(?:evitou|sem)\\s+${stem}\\p{L}*`, "iu").test(sentence)
}

/**
 * FEEDBACK EXPERIENCE V2.1 — o que a verificação SEMÂNTICA já decide (e melhor): efeito/resultado novo, causa, hábito ("costuma"),
 * compreensão não observada, ação só declarada dita como feita, ajuste dito como feito, acerto dito como falha. Num rascunho com
 * veredito semântico estas checagens léxicas saem (erravam: "você garantiu que o desbloqueio seria imediato" é o relato fiel da
 * promessa; "o sinal não foi restabelecido" não é falha do colaborador). Rascunhos V5/V6 continuam com elas.
 */
const SEMANTICALLY_DECIDED: ReadonlySet<string> = new Set(["GUARANTEED_EFFECT", "CAUSAL_CLAIM", "PATTERN_LANGUAGE", "COMPREHENSION_UNOBSERVED", "DECLARED_ACTION_UPGRADE", "NARRATIVE_CONTRADICTS_FINDING", "NARRATIVE_CONTRADICTS_ARTIFACT"])
export function compositionViolations(draft: NarrativeDraft, brief: NarrativeBrief, items: readonly EmittedItem[], context: PresentationContext, options: { semanticallyVerified?: boolean } = {}): { narrative: string[]; card: string[] } {
  const result = lexicalCompositionViolations(draft, brief, items, context)
  if (!options.semanticallyVerified) return result
  return { narrative: result.narrative.filter((code) => !SEMANTICALLY_DECIDED.has(code)), card: result.card.filter((code) => !SEMANTICALLY_DECIDED.has(code)) }
}
function lexicalCompositionViolations(draft: NarrativeDraft, brief: NarrativeBrief, items: readonly EmittedItem[], context: PresentationContext): { narrative: string[]; card: string[] } {
  const sentences = draft.sentences ?? []
  const narrative = new Set<string>()
  const card = new Set<string>()
  const byIndex = new Map(items.map((item) => [item.index, item]))
  const gapItems = (gap: NarrativeGap) => gap.itemIndexes.map((index) => byIndex.get(index)).filter((item): item is EmittedItem => item !== undefined)
  const gapStems = new Set(brief.gaps.flatMap((gap) => gap.mention))
  const strengthOnly = [...new Set(brief.positives.flatMap((positive) => positive.mention))].filter((stem) => !gapStems.has(stem))
  if (sentences.length === 0 || sentences.some((sentence) => sentence.text.length > 500) || sentences.reduce((total, sentence) => total + sentence.text.length, 0) > 3200) narrative.add("NARRATIVE_SHAPE")
  const strengthRef = (ref: string) => /^S\d+$/.test(ref) && Number(ref.slice(1)) >= 1 && Number(ref.slice(1)) <= brief.positives.length
  const gapRef = (ref: string) => /^A\d+$/.test(ref) && Number(ref.slice(1)) >= 1 && Number(ref.slice(1)) <= brief.gaps.length
  for (const sentence of sentences) {
    if (sentence.refs.some((ref) => !strengthRef(ref) && !gapRef(ref))) narrative.add("NARRATIVE_REF_UNKNOWN")
    const hasStrength = sentence.refs.some(strengthRef)
    const hasGap = sentence.refs.some(gapRef)
    // Frase que só se refere a forças É reconhecimento, qualquer que seja o rótulo (o vínculo manda, não o nome da postura).
    if (sentence.stance === "STRENGTH" || (hasStrength && !hasGap)) {
      if (brief.positives.length === 0 || !hasStrength || hasGap) narrative.add("NARRATIVE_UNSUPPORTED_STRENGTH")
      if (NEGATIVE_FACT.test(sentence.text)) narrative.add("NARRATIVE_CONTRADICTS_ARTIFACT")
    } else {
      if (hasStrength) narrative.add("NARRATIVE_UNSUPPORTED_STRENGTH")
      // FEEDBACK EXPERIENCE V2 — reconhecimento dentro de uma frase de CONTEXTO vale quando está ligado a uma força do assessment
      // (a própria força, pelos seus termos) e a frase não fala de ajuste; o rótulo da frase não decide sozinho.
      const anchoredContextPraise = sentence.stance === "CONTEXT" && !hasGap && praiseAnchored(sentence.text, brief, strengthOnly)
      if (isPraiseSentence(sentence.text) && !anchoredContextPraise) narrative.add("NARRATIVE_UNSUPPORTED_STRENGTH")
      if ((sentence.stance === "ADJUSTMENT" || sentence.stance === "GUIDANCE") && !hasGap) narrative.add("NARRATIVE_REF_MISSING")
    }
    for (const positive of brief.positives.filter((entry) => entry.claim === "DECLARED" && entry.behavior && EXECUTION_OF[entry.behavior])) {
      if (EXECUTION_OF[positive.behavior!]!.test(sentence.text) && !REPORTED.test(sentence.text)) narrative.add("DECLARED_ACTION_UPGRADE")
    }
    if (sentence.stance !== "GUIDANCE" && brief.gaps.some((gap) => gapItems(gap).some((item) => contradictsFinding(sentence.text, item)))) narrative.add("NARRATIVE_CONTRADICTS_FINDING")
  }
  // FEEDBACK EXPERIENCE V2 — o redator PRIORIZA: o ajuste PRINCIPAL (A1, primeiro na ordem do processo) tem de ser dito como ajuste ou
  // orientação — nunca só como contexto neutro (o defeito real da chamada 4). Os demais podem ser consolidados ou ficar nos detalhes.
  const covered = new Set(sentences.filter((sentence) => sentence.stance === "ADJUSTMENT" || sentence.stance === "GUIDANCE").flatMap((sentence) => sentence.refs.filter(gapRef).map((ref) => Number(ref.slice(1)) - 1)))
  if (brief.gaps.length > 0 && !covered.has(0)) narrative.add("NARRATIVE_GAP_OMITTED")
  const grounding = narrativeGroundingOf(brief)
  for (const code of objectiveViolations(sentences.map((sentence) => sentence.text).join("\n"), items, context, grounding, false)) narrative.add(code)
  // Card. V6: o redator não escreve card (ele deriva do assessment) — nada a validar.
  if (draft.card.trim().length === 0 && (draft.cardRefs ?? []).length === 0) return { narrative: [...narrative], card: [] }
  const cardText = draft.card.trim()
  const cardRefs = draft.cardRefs ?? []
  if (cardText.length === 0 || cardText.length > 360 || sentencesOf(cardText).length > 3) card.add("NARRATIVE_SHAPE")
  if (cardRefs.some((ref) => !strengthRef(ref) && !gapRef(ref))) card.add("NARRATIVE_REF_UNKNOWN")
  if (brief.gaps.length > 0 && !cardRefs.some(gapRef)) card.add("NARRATIVE_GAP_OMITTED")
  const cardPraise = sentencesOf(cardText).some(isPraiseSentence)
  if (cardPraise && (brief.positives.length === 0 || !cardRefs.some(strengthRef))) card.add("NARRATIVE_UNSUPPORTED_STRENGTH")
  for (const code of objectiveViolations(cardText, items, context, grounding, false)) card.add(code)
  return { narrative: [...narrative], card: [...card] }
}

export type StoredNarrative = {
  version: typeof SUPERVISOR_NARRATIVE_VERSION
  promptVersion: string | null
  /** Itens que o brief descreveu (o rascunho só vale para eles). */
  itemsKey: string
  draft: NarrativeDraft | null
  /** Violações do rascunho contra os itens previstos na geração (auditoria). */
  violations: { narrative: string[]; card: string[] }
  error: string | null
  /** Proveniência mínima da chamada (versão do prompt, hashes, modelo, uso) — nunca o texto do prompt. */
  provenance?: unknown
  /** FEEDBACK EXPERIENCE V2.1 — veredito semântico de cada frase/card (`NARRATIVE_FACTUALITY_V1`). */
  factuality?: StoredFactuality | null
}

export type ResolvedNarrative = { paragraphs: string[]; card: string; source: { narrative: "WRITER" | "SYSTEM"; card: "WRITER" | "SYSTEM" }; violations: { narrative: string[]; card: string[] }
  /** V2.1 — frases/card retirados (ou trocados pela reescrita contida) pela verificação semântica (auditoria; nunca exibido). */
  factualityRejected?: FactualityVerdict[]
  factualityRepaired?: FactualityVerdict[] }

/**
 * FEEDBACK EXPERIENCE V2.1 — a composição do redator a partir do V7 (paráfrase livre sobre as falas) só vale COM o veredito semântico
 * de fatualidade: sem ele (verificação ausente, falha ou texto diferente do verificado) nada do redator é entregue. V5/V6 = histórico.
 */
const FACTUALITY_REQUIRED_FROM = ["SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V7", "SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V8"]
export const requiresFactuality = (promptVersion: string | null | undefined) => promptVersion !== null && promptVersion !== undefined && (FACTUALITY_REQUIRED_FROM.includes(promptVersion) || /^SUPERVISOR_FEEDBACK_NARRATIVE_PROMPT_V(?:9|\d{2,})$/.test(promptVersion))

/**
 * A validação ÚNICA da composição (geração e emissão): as frases que a verificação semântica recusou saem (sem reescrita, sem laço);
 * o que sobra passa pelo vínculo e pelas checagens objetivas de sempre. Frase recusada que levava o ajuste principal = a composição
 * não cobre mais o principal → narrativa do sistema. Card recusado → card do sistema.
 */
export function compositionOutcome(draft: NarrativeDraft, stored: Pick<StoredNarrative, "promptVersion" | "factuality">, brief: NarrativeBrief, items: readonly EmittedItem[], context: PresentationContext): { draft: NarrativeDraft; violations: { narrative: string[]; card: string[] }; rejected: FactualityVerdict[]; repaired: FactualityVerdict[] } {
  if (!requiresFactuality(stored.promptVersion)) return { draft, violations: compositionViolations(draft, brief, items, context), rejected: [], repaired: [] }
  const payload = factualityPayloadOf(draft, brief, items)
  const applied = applyFactuality(draft, stored.factuality, (refs) => factualityGroundingOf(payload, refs))
  if (applied.unverified) return { draft: applied.draft, violations: { narrative: ["NARRATIVE_FACTUALITY_UNVERIFIED"], card: draft.card.trim().length > 0 ? ["NARRATIVE_FACTUALITY_UNVERIFIED"] : [] }, rejected: [], repaired: [] }
  const violations = (applied.draft.sentences ?? []).length === 0 ? { narrative: ["NARRATIVE_FACTUALITY_REJECTED"], card: [] } : compositionViolations(applied.draft, brief, items, context, { semanticallyVerified: true })
  const narrative = [...violations.narrative, ...(applied.rejected.some((verdict) => verdict.id !== "CARD") && violations.narrative.length > 0 && !violations.narrative.includes("NARRATIVE_FACTUALITY_REJECTED") ? ["NARRATIVE_FACTUALITY_REJECTED"] : [])]
  return { draft: applied.draft, violations: { narrative, card: [...violations.card, ...(applied.cardRejected ? ["NARRATIVE_FACTUALITY_REJECTED"] : [])] }, rejected: applied.rejected, repaired: applied.repaired }
}

/**
 * A NARRATIVA FINAL de uma emissão, campo a campo: o texto do redator quando descreve os MESMOS itens que saem e passa na
 * validação; senão a versão determinística (nunca o relatório antigo).
 */
export function resolveNarrative(stored: StoredNarrative | null | undefined, items: readonly EmittedItem[], context: PresentationContext): ResolvedNarrative {
  // O contexto da chamada (fato do assessment) entra na validação da emissão igual à da geração.
  const brief = narrativeBriefOf(items, context.label, { interaction: context.interaction ?? null })
  const system = deterministicNarrative(brief)
  const draft = stored?.draft ?? null
  if (!draft) return { paragraphs: system.paragraphs, card: system.card, source: { narrative: "SYSTEM", card: "SYSTEM" }, violations: { narrative: stored?.error ? [stored.error] : [], card: [] } }
  if (stored!.itemsKey !== brief.itemsKey) return { paragraphs: system.paragraphs, card: system.card, source: { narrative: "SYSTEM", card: "SYSTEM" }, violations: { narrative: ["ITEMS_CHANGED"], card: ["ITEMS_CHANGED"] } }
  // MONITORING V2 — composição V5 (frases com vínculo) é validada pelo vínculo; o histórico V1–V4 pelas regras da sua versão.
  // V2.1 — a partir do V7, só com o veredito semântico (frases recusadas saem antes do vínculo).
  const composed = draft.sentences ? compositionOutcome(draft, stored!, brief, items, context) : null
  const finalDraft = composed ? composed.draft : draft
  const narrative = composed ? composed.violations.narrative : narrativeViolations(draft.paragraphs, brief, items, context)
  const card = composed ? composed.violations.card : cardViolations(draft.card, brief, items, context)
  // V6 — o card é SEMPRE do sistema (deriva do assessment); o redator só escreve a narrativa.
  const writerCard = card.length === 0 && finalDraft.card.trim().length > 0
  return {
    paragraphs: narrative.length === 0 ? finalDraft.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean) : system.paragraphs,
    card: writerCard ? finalDraft.card.trim() : system.card,
    source: { narrative: narrative.length === 0 ? "WRITER" : "SYSTEM", card: writerCard ? "WRITER" : "SYSTEM" },
    violations: { narrative, card },
    ...(composed && composed.rejected.length > 0 ? { factualityRejected: composed.rejected } : {}),
    ...(composed && composed.repaired.length > 0 ? { factualityRepaired: composed.repaired } : {}),
  }
}
