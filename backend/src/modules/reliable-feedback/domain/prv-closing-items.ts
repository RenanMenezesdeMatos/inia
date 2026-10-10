import { INDICATOR_CANONICAL_CONTEXT_CONTRACT, type IndicatorCanonicalContext, type IndicatorDirection } from "../../indicators/domain/indicator-canonical-context.js"
import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import { formatPercent, referencePeriodLabel } from "../../indicator-diagnosis/domain/prv-closing.js"
import type { BehaviorPattern } from "../../indicator-diagnosis/domain/operational-patterns.js"
import { signalFindingsOf, type IndicatorInvestigation, type PrvClosingDiagnosis } from "../../indicator-diagnosis/domain/prv-investigation.js"
import { buildKnowledgeMaterialHref } from "../../knowledge/domain/material-href.js"
import { BEHAVIOR_PHRASES } from "./supervisor-presentation.js"
import { ruleActionOf } from "./behavior-presentation.js"
import { imperativeOf, inflectAction } from "./portuguese-verbs.js"
import type { ReliableFact, ReliableItemDraft, ReliableKnowledgeRef, ReliableWording } from "./reliable-feedback-item.js"

/**
 * INDICATOR DIAGNOSIS V1 — ITENS DO FEEDBACK DO FECHAMENTO (domínio puro, ZERO modelo). O feedback de indicador do PRV é UM
 * artefato confiável por fechamento (nunca "1 indicador = 1 mensagem isolada"), com itens de tipos já existentes:
 *
 *   INDICATOR_TARGET_MET / INDICATOR_TARGET_NOT_MET   o resultado OFICIAL de cada indicador investigado (fatos da fonte oficial);
 *   INDICATOR_DEVELOPMENT_PATTERN                      padrão operacional sustentado NA POPULAÇÃO DO COLABORADOR;
 *   INDICATOR_STRENGTH_PATTERN                         prática seguida de forma consistente (o que manter/reconhecer).
 *
 * O texto de cada item é do SISTEMA (frases por comportamento canônico + contagens + regra literal da base), passa pelos MESMOS
 * validadores do feedback de indicador (números só dos fatos, sem causa, sem pressa) e é o que o QA de exceção vê. A interpretação
 * do conjunto (o que é relevante, o que não pode ser concluído) e a mensagem natural são do redator da narrativa, validadas à parte.
 * Nunca há "fale mais rápido", "encerre mais cedo" ou "reduza explicações": processo correto vem antes da eficiência.
 */
export const PRV_CLOSING_ITEMS_VERSION = "PRV_CLOSING_ITEMS_V1" as const
const MAX_QUOTES = 2

export const PRV_SAFE_MEANING = {
  met: "resultado oficial do indicador no fechamento, dentro da referência",
  notMet: "resultado oficial do indicador no fechamento, fora da referência",
  development: "comportamento de processo não seguido de forma recorrente nas chamadas analisadas do colaborador no fechamento; associação com o indicador não é causa",
  strength: "comportamento de processo seguido de forma consistente nas chamadas analisadas do colaborador no fechamento; associação com o indicador não é causa",
} as const

const lastDayOf = (endDateExclusive: string) => {
  const date = new Date(`${endDateExclusive}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}
const direction = (value: string): IndicatorDirection => (value === "LOWER" || value === "TARGET" ? value : "HIGHER")

/**
 * O fechamento OFICIAL representado como contexto canônico do indicador: valor e meta da fonte oficial, dentro/fora pela regra
 * ÚNICA da referência (atingimento oficial primeiro). Nenhum número derivado (sem distância até a meta). É o que a validação do
 * texto e a edição do QA usam.
 */
export function closingCanonicalContextOf(investigation: IndicatorInvestigation, personId: string, loadedAt: string): IndicatorCanonicalContext {
  const { official } = investigation
  const target = official.target
  return {
    contract: INDICATOR_CANONICAL_CONTEXT_CONTRACT,
    indicator: { id: investigation.indicatorId, code: investigation.indicatorCode, name: investigation.indicatorName, unit: investigation.unit, direction: direction(investigation.direction) },
    measurement: { id: investigation.snapshotId, subjectId: personId, value: official.value, periodStart: investigation.population.window.startDate, periodEnd: lastDayOf(investigation.population.window.endDate), granularity: "MONTHLY" },
    target: target === null ? null : { value: target, source: "OFFICIAL_CLOSURE", goalId: investigation.snapshotId },
    withinTarget: official.withinReference,
    position: target === null ? null : official.value > target ? "ABOVE" : official.value < target ? "BELOW" : "EQUAL",
    gapToTarget: null,
    provenance: { source: "employee_indicator_performance", loadedAt },
  }
}

const joinAnd = (values: readonly string[]) => (values.length <= 1 ? values.join("") : `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`)
/**
 * V1.0.2 — "COMO APLICAR" é AÇÃO HUMANA, nunca o item do checklist cru: a ação da regra VERIFICADA no imperativo (a mesma derivação
 * da monitoria — `ruleActionOf` + conjugação só de verbos conhecidos): "- [ ] Informei prazo e canal de retorno?" → "informe prazo
 * e canal de retorno"; "O operador deverá informar o prazo exibido na ferramenta" → "informe o prazo exibido na ferramenta". Nada
 * além do que a regra diz. Sem ação reconhecível → a regra literal entre aspas (nunca uma técnica inventada). A regra literal continua
 * em "O processo orienta".
 */
export function howToImproveOf(rule: string, segmentLabel: string): string {
  const action = ruleActionOf(rule)
  const imperative = action ? inflectAction(action.action, imperativeOf) : null
  if (!action || !imperative) {
    // A regra já é uma orientação em frase (ex.: "Antes de encerrar, recapitule…") → ela mesma; item de checklist/pergunta → citada.
    const checklistOrQuestion = /\[\s*[xX]?\s*\]|\?\s*$/u.test(rule.trim())
    return checklistOrQuestion ? `Nas próximas chamadas de ${lowerFirst(segmentLabel)}, siga o que o procedimento orienta: “${rule.trim()}”` : `Nas próximas chamadas de ${lowerFirst(segmentLabel)}: ${lowerFirst(rule.trim())}`
  }
  return `Nas próximas chamadas de ${lowerFirst(segmentLabel)}, ${action.condition ? `${action.condition}, ` : ""}${imperative}${action.items.length > 0 ? `: ${joinAnd(action.items)}` : ""}.`
}

const lowerFirst = (text: string) => (text.length > 1 && /^\p{Lu}(?:\p{Ll}|\s)/u.test(text) ? text[0]!.toLocaleLowerCase("pt-BR") + text.slice(1) : text)
const value = (investigation: IndicatorInvestigation, amount: number) => formatIndicatorValue(amount, investigation.unit)

/**
 * V2 — linhas OFICIAIS do diagnóstico DIRETO de um indicador (sem PRV): mesmos fatos da fonte, rótulos sem "fechamento do PRV" e sem
 * o peso no PRV (a execução não veio do PRV). Pares rótulo × valor, prontos para a tela.
 */
export function directOfficialFactEntries(investigation: IndicatorInvestigation): { label: string; value: string }[] {
  const { official } = investigation
  return [
    { label: "Resultado oficial", value: value(investigation, official.value) },
    ...(official.target !== null ? [{ label: "Meta oficial", value: value(investigation, official.target) }] : []),
    ...(official.withinReference !== null ? [{ label: "Situação oficial", value: official.withinReference ? "dentro da referência" : "fora da referência" }] : []),
    ...(official.quartile ? [{ label: "Quartil oficial", value: `${official.quartile} (Q1 = melhor, Q4 = pior)` }] : []),
    ...(official.achievementPercent !== null ? [{ label: "Atingimento oficial", value: formatPercent(official.achievementPercent) }] : []),
    ...(official.previous ? [{ label: `Período anterior (${referencePeriodLabel(official.previous.referencePeriod)})`, value: `${value(investigation, official.previous.value)}${official.previous.quartile ? `, quartil ${official.previous.quartile}` : ""}` }] : []),
  ]
}

/** Frases OFICIAIS (fatos da fonte, nunca recalculados). V2: `direct` = diagnóstico direto do indicador (sem PRV). */
export function officialFactTexts(investigation: IndicatorInvestigation, direct = false): string[] {
  if (direct) return [`${investigation.indicatorName} oficial em ${referencePeriodLabel(investigation.official.referencePeriod)}: ${value(investigation, investigation.official.value)}`, ...directOfficialFactEntries(investigation).slice(1).map((entry) => `${entry.label}: ${entry.value}`)]
  const { official } = investigation
  const period = referencePeriodLabel(official.referencePeriod)
  return [
    `${investigation.indicatorName} oficial no fechamento de ${period}: ${value(investigation, official.value)}`,
    ...(official.target !== null ? [`Meta oficial: ${value(investigation, official.target)}`] : []),
    ...(official.withinReference !== null ? [`Situação oficial: ${official.withinReference ? "dentro da referência" : "fora da referência"}`] : []),
    ...(official.quartile ? [`Quartil oficial: ${official.quartile} (Q1 = melhor, Q4 = pior)`] : []),
    ...(official.achievementPercent !== null ? [`Atingimento oficial: ${formatPercent(official.achievementPercent)}`] : []),
    ...(official.weightPercent !== null ? [`Peso no PRV: ${formatPercent(official.weightPercent)}`] : []),
    ...(official.previous ? [`Fechamento anterior (${referencePeriodLabel(official.previous.referencePeriod)}): ${value(investigation, official.previous.value)}${official.previous.quartile ? `, quartil ${official.previous.quartile}` : ""}`] : []),
  ]
}

/** Frase do sistema do comportamento no fechamento (contagem + recorte); a mesma que a visão do colaborador mostra. */
export function behaviorStatement(pattern: BehaviorPattern, segmentLabel: string): string {
  const phrases = pattern.behavior ? BEHAVIOR_PHRASES[pattern.behavior] : undefined
  if (pattern.classification === "STRENGTH") {
    const done = phrases?.declared ?? phrases?.done
    return done ? `Você ${done} em ${pattern.counts.followed} de ${pattern.eligible} chamadas analisadas de ${segmentLabel}.` : `O que o procedimento orienta em “${pattern.title}” foi seguido em ${pattern.counts.followed} de ${pattern.eligible} chamadas analisadas de ${segmentLabel}.`
  }
  const partial = pattern.counts.partial * 2 >= pattern.counts.notFollowed && pattern.counts.partial > 0
  const gap = partial ? phrases?.partialGap ?? phrases?.gap : phrases?.gap
  const text = gap ? `${gap[0]!.toLocaleUpperCase("pt-BR")}${gap.slice(1)}` : `O que o procedimento orienta em “${pattern.title}” não foi seguido`
  return `${text} em ${pattern.counts.notFollowed} de ${pattern.eligible} chamadas analisadas de ${segmentLabel}.`
}

export const patternCountText = (pattern: BehaviorPattern, segmentLabel: string) =>
  pattern.classification === "STRENGTH"
    ? `${pattern.title}: seguida em ${pattern.counts.followed} de ${pattern.eligible} chamadas analisadas de ${segmentLabel}.`
    : `${pattern.title}: não seguida em ${pattern.counts.notFollowed} de ${pattern.eligible} chamadas analisadas de ${segmentLabel}.`

function knowledgeOf(pattern: BehaviorPattern): ReliableKnowledgeRef | null {
  const rule = pattern.rule
  if (!rule) return null
  // Só observação ELEGÍVEL (regra ancorada, aplicabilidade verificada) conta no padrão: a regra que a sustenta é VERIFIED.
  return { documentId: rule.documentId, documentTitle: rule.documentTitle, heading: rule.heading, version: null, quote: rule.quote.trim(), applicability: "VERIFIED", href: buildKnowledgeMaterialHref(rule.documentId) }
}

export type PrvItemBuild = { items: ReliableItemDraft[]; wordings: Map<number, ReliableWording>; indicatorOf: Map<number, string> }

/**
 * Itens do fechamento. `developmentOnlyWhenSupported`: só os padrões DO COLABORADOR (atribuição individual) — padrão só do grupo
 * nunca vira item (fica na visão do supervisor).
 */
export function buildPrvClosingItems(diagnosis: PrvClosingDiagnosis): PrvItemBuild {
  const items: ReliableItemDraft[] = []
  const wordings = new Map<number, ReliableWording>()
  const indicatorOf = new Map<number, string>()
  const push = (item: Omit<ReliableItemDraft, "index" | "priority">, wording: ReliableWording, indicatorCode: string, basis: string[]) => {
    const index = items.length
    items.push({ ...item, index, priority: { rank: index + 1, policy: PRV_CLOSING_ITEMS_VERSION, basis } } as ReliableItemDraft)
    wordings.set(index, wording)
    indicatorOf.set(index, indicatorCode)
  }
  const audit = { evidence: [], rejectedUnits: [] }
  const direct = diagnosis.source?.kind === "DIRECT_INDICATOR"
  for (const investigation of diagnosis.investigations) {
    const { official } = investigation
    const within = official.withinReference
    const facts: ReliableFact[] = [
      ...officialFactTexts(investigation, direct).map((text): ReliableFact => ({ role: "DADO_OFICIAL", text, truncated: false, masked: false })),
      // V2 — fatos da população sinalizada (números do sistema; composição, nunca causa) acompanham o resultado oficial.
      ...(investigation.signal ? signalFindingsOf(investigation.signal, referencePeriodLabel(official.referencePeriod), { distribution: Boolean(investigation.steps?.selected.includes("SIGNAL_DISTRIBUTION")), evolution: Boolean(investigation.steps?.selected.includes("SIGNAL_EVOLUTION")) }).map((text): ReliableFact => ({ role: "ANALISE", text, truncated: false, masked: false })) : []),
    ]
    const resultText = direct
      ? `Neste período, o resultado oficial de ${investigation.indicatorName} foi ${value(investigation, official.value)}${official.target !== null && within !== null ? `, ${within ? "dentro" : "fora"} da meta de ${value(investigation, official.target)}` : ""}.`
      : `Neste fechamento, o resultado oficial de ${investigation.indicatorName} foi ${value(investigation, official.value)}${official.target !== null && within !== null ? `, ${within ? "dentro" : "fora"} da meta de ${value(investigation, official.target)}` : ""}.`
    push({
      claimRef: `${investigation.indicatorCode}:OFFICIAL`,
      domain: "INDICATOR",
      section: within === null ? "NEUTRAL_CONTEXT" : within ? "STRENGTH" : "OPPORTUNITY",
      kind: within ? "INDICATOR_TARGET_MET" : "INDICATOR_TARGET_NOT_MET",
      polarity: within ? "POSITIVE" : "NEGATIVE",
      ownership: "AGENT",
      safeMeaning: within ? PRV_SAFE_MEANING.met : PRV_SAFE_MEANING.notMet,
      guidanceSource: within ? "REINFORCEMENT" : "COACHING_SUGGESTION",
      grounding: "NO_GROUNDED_GUIDANCE",
      knowledge: null,
      process: null,
      facts,
      withheldFacts: 0,
      analysis: null,
      analysisConflicts: [],
      structuralBlock: within === null ? "CANONICAL_TARGET_MISSING" : null,
      audit,
    }, { observed: resultText, whyItMatters: "", whatYouCanDo: "" }, investigation.indicatorCode, ["OFFICIAL_RESULT"])

    const segmentLabel = investigation.population.selectedSegment?.label ?? "motivo investigado"
    const segment = investigation.population.segments.find((entry) => entry.key === investigation.population.selectedSegment?.key)
    const segmentText = segment ? `Motivo investigado: ${segment.label} — ${segment.interactions} de ${investigation.population.interactionsInPeriod} atendimentos do fechamento.` : null
    const behaviors = investigation.patterns?.behaviors ?? []
    const selected = [
      ...behaviors.filter((pattern) => investigation.conclusion.developmentPatterns.includes(pattern.practiceKey)),
      ...behaviors.filter((pattern) => investigation.conclusion.strengthPatterns.includes(pattern.practiceKey)),
    ]
    for (const pattern of selected) {
      const strength = pattern.classification === "STRENGTH"
      const quotes = pattern.evidenceCandidates.slice(0, MAX_QUOTES)
      const knowledge = knowledgeOf(pattern)
      const statement = behaviorStatement(pattern, segmentLabel)
      const itemFacts: ReliableFact[] = [
        ...(segmentText ? [{ role: "ANALISE" as const, topic: "SEGMENT" as const, text: segmentText, truncated: false, masked: false }] : []),
        { role: "ANALISE", topic: "PATTERN", text: patternCountText(pattern, segmentLabel), truncated: false, masked: false },
        ...quotes.map((quote): ReliableFact => ({ role: "OPERADOR", text: quote.text, truncated: quote.truncated, masked: false })),
      ]
      const grounding = knowledge ? "OFFICIAL_PROCEDURE" : "NO_GROUNDED_GUIDANCE"
      push({
        claimRef: `${investigation.indicatorCode}:${pattern.practiceKey}`,
        domain: "INDICATOR",
        section: strength ? "STRENGTH" : "OPPORTUNITY",
        kind: strength ? "INDICATOR_STRENGTH_PATTERN" : "INDICATOR_DEVELOPMENT_PATTERN",
        polarity: strength ? "POSITIVE" : "NEGATIVE",
        ownership: "AGENT",
        safeMeaning: strength ? PRV_SAFE_MEANING.strength : PRV_SAFE_MEANING.development,
        guidanceSource: strength ? "REINFORCEMENT" : "COACHING_SUGGESTION",
        grounding,
        knowledge,
        process: { title: pattern.documentTitle ?? pattern.title, requirement: pattern.requirement, status: strength ? "FOLLOWED" : "NOT_FOLLOWED", checkpointRef: pattern.practiceKey, stepTitle: pattern.title },
        facts: itemFacts,
        withheldFacts: 0,
        analysis: null,
        analysisConflicts: [],
        // Padrão de conduta sem nenhuma fala exibível do operador não é comunicado ao colaborador (mesma regra da monitoria).
        structuralBlock: quotes.length === 0 ? "INSUFFICIENT_DISPLAY_EVIDENCE" : null,
        audit,
      }, {
        observed: statement,
        whyItMatters: knowledge ? `O documento “${knowledge.documentTitle}” orienta: “${knowledge.quote}”.` : "",
        // A ação concreta É a regra oficial (literal): nunca "fale mais rápido", nunca uma dica que a base não sustenta.
        whatYouCanDo: !strength && knowledge ? howToImproveOf(knowledge.quote, segmentLabel) : "",
      }, investigation.indicatorCode, [strength ? "STRENGTH" : "DEVELOPMENT_FIRST", knowledge ? "RULE_VERIFIED" : "RULE_NOT_VERIFIED"])
    }
  }
  return { items, wordings, indicatorOf }
}
