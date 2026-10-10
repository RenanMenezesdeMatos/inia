import type { EmittedItem } from "./reliable-feedback-artifact.js"
import { composeDevelopmentBlocks, developmentBlockLabelOf, escapeMarkdownQuote, findingLabelOf } from "./reliable-feedback-artifact.js"

/**
 * V1.7.2 — APRESENTAÇÃO DE SUPERVISOR (`SUPERVISOR_PRESENTATION_V2`, domínio puro, sem modelo) do feedback de MONITORIA DE
 * PROCESSO. Três camadas que nunca se misturam:
 *
 *   DIAGNÓSTICO / MEMÓRIA   ProcessAssessment, checkpointRef, comportamento, evidência, ProcessObservation… — intocados;
 *   QA / AUDITORIA          granular e técnico (o artefato e as revisões por item continuam iguais);
 *   FEEDBACK                COMPOSIÇÃO humana dos itens que saem — é só isto que muda aqui.
 *
 * O que a composição faz (e só isto): abertura que diz O QUE aconteceu (o que foi bem conduzido, o principal ajuste com a frase
 * já validada do ponto e a regra oficial), "O que manter" em um parágrafo por fase do atendimento (nunca um bloco por obrigação
 * cumprida, nunca placar), destaque individual só com razão estrutural, fechamento que prioriza e card curto de 2–3 frases.
 * Nenhum fato novo: cada frase vem de (a) texto já validado do item (redator, texto de segurança ou edição do QA), (b) regra
 * literal verificada, ou (c) o vocabulário FECHADO abaixo, escolhido pelo comportamento canônico + status + tipo de evidência.
 */
export const SUPERVISOR_PRESENTATION_VERSION = "SUPERVISOR_PRESENTATION_V2" as const

/** Fase do atendimento (APRESENTAÇÃO: agrupa frases; nunca muda observação, comportamento ou analytics). */
export type AttendancePhase = "INVESTIGATION" | "TREATMENT" | "CLOSING" | "OTHER"
export const PHASE_OPENING: Record<Exclude<AttendancePhase, "OTHER">, string> = { INVESTIGATION: "na investigação do caso", TREATMENT: "na tratativa", CLOSING: "no encerramento" }
const PHASE_SENTENCE: Record<AttendancePhase, string> = { INVESTIGATION: "Na investigação do caso, você", TREATMENT: "Na tratativa, você", CLOSING: "No encerramento, você", OTHER: "Você também" }
const PHASES: readonly AttendancePhase[] = ["INVESTIGATION", "TREATMENT", "CLOSING", "OTHER"]

/**
 * Vocabulário FECHADO por comportamento canônico: fase, o que foi feito (ação observada), o que foi DITO (ação declarada — a
 * ação em sistema nunca é afirmada como executada, só como informada ao cliente) e a lacuna em linguagem de supervisor.
 * Comportamento fora do catálogo (cauda longa) usa a frase já validada do próprio item — nunca exige código novo.
 */
type BehaviorPhrases = { phase: AttendancePhase; done: string; declared?: string; gap?: string; partialGap?: string }
export const BEHAVIOR_PHRASES: Readonly<Record<string, BehaviorPhrases>> = {
  VALIDATE_HOLDER: { phase: "INVESTIGATION", done: "validou o titular da linha", gap: "a validação do titular não seguiu o procedimento" },
  IDENTIFY_CHARGE: { phase: "INVESTIGATION", done: "identificou a cobrança que o cliente não reconhecia", gap: "a cobrança questionada não foi identificada com o cliente" },
  CHECK_PAYMENT: { phase: "INVESTIGATION", done: "verificou se a conta já tinha sido paga", gap: "não foi verificado se a conta já tinha sido paga" },
  OPEN_ANALYSIS: { phase: "TREATMENT", done: "abriu a análise", declared: "informou ao cliente a abertura da análise", gap: "a abertura da análise não seguiu o procedimento" },
  REGISTER_DISPUTE: { phase: "TREATMENT", done: "registrou a contestação", declared: "informou ao cliente o registro da contestação", gap: "o registro da contestação não seguiu o procedimento" },
  CANCEL_RECURRING_SERVICE: { phase: "TREATMENT", done: "cancelou a recorrência do serviço", declared: "informou ao cliente o cancelamento da recorrência", gap: "o cancelamento da recorrência não seguiu o procedimento" },
  INFORM_DEADLINE: { phase: "CLOSING", done: "informou o prazo da análise", gap: "o prazo da análise não foi informado ao cliente" },
  RECAPITULATE_INTERACTION: { phase: "CLOSING", done: "recapitulou o atendimento", gap: "a recapitulação não seguiu o que o procedimento prevê", partialGap: "a recapitulação não trouxe todos os pontos previstos" },
  CONFIRM_SOLUTION: { phase: "CLOSING", done: "retomou a solução aplicada" },
  PROVIDE_PROTOCOL: { phase: "CLOSING", done: "informou o protocolo", gap: "o protocolo não foi informado" },
  CONFIRM_UNDERSTANDING: { phase: "CLOSING", done: "verificou se o cliente tinha dúvidas", gap: "o entendimento do cliente não foi confirmado" },
}

export const joinAnd = (values: readonly string[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`)
const unique = (values: readonly string[]) => [...new Set(values.filter((value) => value.trim().length > 0))]
const capitalize = (text: string) => (text.length > 0 ? text[0]!.toLocaleUpperCase("pt-BR") + text.slice(1) : text)
const lowerFirst = (text: string) => (text.length > 1 && /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLocaleLowerCase("pt-BR") + text.slice(1) : text)
const quoted = (text: string) => `“${escapeMarkdownQuote(text)}”`
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0)

const behaviorOf = (item: EmittedItem) => item.process?.behavior?.code ?? null
export const isAvoid = (item: EmittedItem) => item.knowledge?.contentKind === "DO_NOT_CONTENT"
export const isDeclared = (item: EmittedItem) => item.process?.evidenceType === "OBSERVED_DECLARATION"

/** Fase do ponto: pelo comportamento canônico; lista de conferência ("Verificar:") = investigação; resto = OTHER. */
export function phaseOf(item: EmittedItem): AttendancePhase {
  const phrases = BEHAVIOR_PHRASES[behaviorOf(item) ?? ""]
  if (phrases) return phrases.phase
  if (item.process?.completeness?.family === "VERIFY") return "INVESTIGATION"
  return "OTHER"
}

/**
 * Oração do que foi feito (sem sujeito): catálogo do comportamento → lista de conferência (só os itens que a fala mostra) →
 * a frase JÁ VALIDADA do item quando é uma frase só começando por "Você" → referência ao assunto (nunca inventa ação).
 */
export function maintainClauseOf(item: EmittedItem): string {
  const phrases = BEHAVIOR_PHRASES[behaviorOf(item) ?? ""]
  if (phrases) return isDeclared(item) && phrases.declared ? phrases.declared : phrases.done
  const completeness = item.process?.completeness
  if (completeness?.family === "VERIFY" && completeness.status === "UNKNOWN" && completeness.observed.length > 0) {
    return `conferiu dados como ${joinAnd(completeness.observed.map((text) => lowerFirst(text.replace(/,\s*(?:quando|se|caso)\b.*$/iu, "").trim())))}`
  }
  const sentences = sentencesOf(item.wording.observed)
  const single = sentences.length === 1 ? sentences[0]! : null
  if (single && /^Você\s+\p{Ll}/u.test(single) && single.length <= 180) return single.replace(/^Você\s+/u, "").replace(/[.!]+$/u, "")
  return `seguiu o que o procedimento orienta em ${quoted(findingLabelOf(item))}`
}

/** Lacuna em linguagem de supervisor (card/fechamento): catálogo do comportamento; "evitar" e cauda longa pelo assunto. */
export function gapClauseOf(item: EmittedItem): string {
  const label = findingLabelOf(item)
  if (isAvoid(item)) return `apareceu uma formulação que o procedimento pede para evitar (${quoted(label)})`
  const phrases = BEHAVIOR_PHRASES[behaviorOf(item) ?? ""]
  if (phrases?.partialGap && item.process?.completeness?.status === "PARTIAL") return phrases.partialGap
  if (phrases?.gap) return phrases.gap
  // V1.7.4 — cauda longa (sem frase de comportamento do vocabulário fechado): a frase JÁ VALIDADA do próprio item ("você informou ao
  // cliente que…") diz o que aconteceu; "o ponto “X” precisa de ajuste" só quando ela não existe.
  const observed = item.wording.observed.trim().replace(/[.!]+$/u, "")
  if (/^Voc[êe]\s/u.test(observed) && observed.length <= 240 && !/\n/.test(observed)) return `v${observed.slice(1)}`
  // MONITORING V2 (fase 4) — texto do SISTEMA (projeção do assessment): "Nesse momento da chamada, faltou X." diz a lacuna concreta; a
  // regra curta não seguida vem literal da base. Nada de redação intermediária.
  const missing = /^(?:Nesse momento da chamada|Nesta chamada),\s+(faltou\s+[^.]+?)(?:\.|:|$)/u.exec(item.wording.observed.trim())
  if (missing && missing[1]!.length <= 200) return missing[1]!
  const listStep = (item.knowledge?.step ?? "").replace(/^\s*(?:[-*•]|\d+[.)])\s*/u, "").trim()
  const rule = expectedRuleOf(item) ?? (listStep.length > 0 && listStep.length <= 180 && !/\n/.test(listStep) ? listStep : null)
  if (rule && item.process?.status === "NOT_FOLLOWED") return `não foi seguida a orientação ${quoted(rule.replace(/[.!]+$/u, ""))}`
  return `o ponto ${quoted(label)} precisa de ajuste`
}

/**
 * DESTAQUE INDIVIDUAL de um ponto cumprido — só com razão ESTRUTURAL: a etapa é OBRIGATÓRIA na cobertura da análise, ou o
 * administrador marcou o checkpoint como "destaque" no Checkpoint Registry.
 * Cumprimento comum vai para "O que manter".
 */
export function isHighlightedStrength(item: EmittedItem): boolean {
  if (item.section !== "STRENGTH") return false
  // Obrigatória NO PROCESSO (V1.7.3 `processRequirement`; artefatos anteriores: `coverageRequirement` REQUIRED) — nunca o plano da avaliação.
  const source = item.process?.sourceCheckpoint
  return source?.processRequirement === "REQUIRED" || source?.coverageRequirement === "REQUIRED" || item.process?.registry?.highlight === true
}

/** "O que manter": um parágrafo com uma frase por fase do atendimento (ordem do atendimento; dentro da fase, ordem dos itens). */
export function maintainParagraphOf(strengths: readonly EmittedItem[]): string | null {
  const byPhase = new Map<AttendancePhase, string[]>()
  for (const item of strengths) byPhase.set(phaseOf(item), [...(byPhase.get(phaseOf(item)) ?? []), maintainClauseOf(item)])
  const present = PHASES.filter((phase) => (byPhase.get(phase) ?? []).length > 0)
  if (present.length === 0) return null
  const onlyOther = present.length === 1 && present[0] === "OTHER"
  return present.map((phase) => `${onlyOther ? "Você" : PHASE_SENTENCE[phase]} ${joinAnd(mergeDeclared(unique(byPhase.get(phase)!)))}.`).join(" ")
}
/** "informou ao cliente o cancelamento… e informou ao cliente o registro…" → "informou ao cliente o cancelamento… e o registro…". */
const DECLARED_PREFIX = "informou ao cliente "
export function mergeDeclared(clauses: readonly string[]): string[] {
  const declared = clauses.filter((clause) => clause.startsWith(DECLARED_PREFIX))
  if (declared.length < 2) return [...clauses]
  const merged = `${DECLARED_PREFIX}${joinAnd(declared.map((clause) => clause.slice(DECLARED_PREFIX.length)))}`
  const first = clauses.indexOf(declared[0]!)
  return clauses.flatMap((clause, index) => (index === first ? [merged] : clause.startsWith(DECLARED_PREFIX) ? [] : [clause]))
}

/** "foi bem conduzido na investigação do caso e na tratativa" — as fases com pontos cumpridos E sem ajuste (a fase em que está o
 * ajuste nunca é chamada de "bem conduzida"). */
function conductedPhrase(strengths: readonly EmittedItem[], development: readonly EmittedItem[] = []): string | null {
  const phases = PHASES.filter((phase) => phase !== "OTHER" && strengths.some((item) => phaseOf(item) === phase) && !development.some((item) => phaseOf(item) === phase)) as Exclude<AttendancePhase, "OTHER">[]
  return phases.length > 0 ? joinAnd(phases.map((phase) => PHASE_OPENING[phase])) : null
}

/** "Atendimento de 25/09/2026 · Contestação de cobrança" → "de 25/09/2026 sobre contestação de cobrança". */
function aboutPhrase(label: string): string {
  const [head, ...rest] = label.split(" · ")
  const date = head?.startsWith("Atendimento de ") ? head.slice("Atendimento de ".length) : null
  const subject = rest.join(" · ")
  return `${date ? ` de ${date}` : ""}${subject ? ` sobre ${lowerFirst(subject)}` : ""}`
}

/** A regra oficial curta que diz o que o processo esperava (regra operacional > regra de uma linha); null = trecho longo. */
export function expectedRuleOf(item: EmittedItem): string | null {
  const knowledge = item.knowledge
  if (!knowledge) return null
  const candidate = knowledge.operativeRule?.quote ?? (knowledge.contentKind === "RULE_CONTENT" || !knowledge.contentKind ? knowledge.quote : null)
  const value = (candidate ?? "").replace(/^[“"«\s]+|[”"»\s]+$/gu, "").trim()
  return value.length > 0 && value.length <= 180 && !/\n/.test(value) && !/^[-*•]|^\d+[.)]/u.test(value) ? value : null
}

export type SupervisorPresentation = { version: typeof SUPERVISOR_PRESENTATION_VERSION; introduction: string; closing: string; card: string }

/**
 * Abertura, fechamento e card do feedback de monitoria de processo — só dos itens que SAEM (se o QA rejeita um ponto, ele some
 * daqui também). Sem contagem, sem "pontos fortes", sem motivação genérica.
 */
export function supervisorPresentationOf(items: readonly EmittedItem[], label: string): SupervisorPresentation {
  const development = items.filter((item) => item.section === "OPPORTUNITY")
  const strengths = items.filter((item) => item.section === "STRENGTH")
  const attention = items.filter((item) => item.section === "ATTENTION")
  const blocks = composeDevelopmentBlocks(development)
  const titles = blocks.map((group) => developmentBlockLabelOf(group) ?? findingLabelOf(group[0]!))
  const conducted = conductedPhrase(strengths, development)
  const about = aboutPhrase(label)
  const attentionSentence = attention.length > 0 ? "Há também um ponto em que não foi possível confirmar o produto tratado; ele está explicado abaixo." : null

  if (blocks.length === 0) {
    const introduction = [
      `Seu atendimento${about} foi conduzido conforme o procedimento${conducted ? `, ${conducted}` : ""}.`,
      ...(attentionSentence ? [attentionSentence] : []),
      ...(strengths.length > 0 ? ["Abaixo está o que manter nas próximas chamadas."] : []),
    ].join(" ")
    return {
      version: SUPERVISOR_PRESENTATION_VERSION,
      introduction,
      closing: strengths.length > 0 ? "Continue conduzindo os atendimentos dessa forma." : "Os detalhes estão acima.",
      card: `Seu atendimento foi conduzido conforme o procedimento${conducted ? `, ${conducted}` : ""}. No feedback completo você encontra o que manter nas próximas chamadas.`,
    }
  }

  // O principal ajuste = o primeiro bloco na ordem de prioridade: a frase JÁ VALIDADA do ponto (o que aconteceu) + a regra oficial.
  const main = blocks[0]!
  const mainObserved = main.find((item) => !isAvoid(item))?.wording.observed ?? main[0]!.wording.observed
  const expected = main.map(expectedRuleOf).find((rule): rule is string => rule !== null) ?? null
  const others = titles.slice(1)
  const introduction = [
    conducted ? `Seu atendimento${about} foi bem conduzido ${conducted}.` : `Analisei seu atendimento${about}.`,
    `O principal ajuste está em ${quoted(titles[0]!)}. ${mainObserved.trim()}${expected ? ` O procedimento orienta: ${quoted(expected)}` : ""}`,
    ...(others.length > 0 ? [`Também vale ajustar ${joinAnd(others.map(quoted))}, detalhado${others.length > 1 ? "s" : ""} abaixo.`] : []),
    ...(attentionSentence ? [attentionSentence] : []),
  ].join("\n\n")
  const focus = titles.length === 1
    ? `Para as próximas chamadas, o ajuste é em ${quoted(titles[0]!)}.`
    : titles.length === 2
      ? `Para as próximas chamadas, concentre-se primeiro em ${quoted(titles[0]!)} e, depois, em ${quoted(titles[1]!)}.`
      : `Para as próximas chamadas, concentre-se primeiro em ${quoted(titles[0]!)} e, depois, nos demais ajustes acima.`
  const closing = [...(strengths.length >= development.length && conducted ? ["No geral, a tratativa foi bem conduzida."] : []), focus].join(" ")
  const gaps = blocks.map((group) => gapClauseOf(group.find((item) => !isAvoid(item)) ?? group[0]!))
  const gapPhrase = gaps.length <= 2 ? joinAnd(gaps) : `${gaps.slice(0, 2).join(", ")} e há outros ajustes`
  const card = `${conducted ? `Seu atendimento foi bem conduzido ${conducted}, mas ${gapPhrase}` : capitalize(gapPhrase)}. No feedback completo você encontra a evidência, a orientação do processo e como ajustar.`
  return { version: SUPERVISOR_PRESENTATION_VERSION, introduction, closing, card }
}
