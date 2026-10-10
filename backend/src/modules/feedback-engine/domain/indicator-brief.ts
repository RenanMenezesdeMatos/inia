import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import { briefQuoteOf, cleanHeading, criterionTitleOf, materialsOf, type BriefFinding, type BriefReferencePractice, type BriefSubjects, type FeedbackBrief } from "./feedback-brief.js"
import { ATTRIBUTION_LIMIT, isAdverseFocus, PATTERN_MINIMUM_ELIGIBLE, type CriterionPattern, type IndicatorInvestigation, type ReferencePractice, type SegmentComparison, type SegmentEvidence } from "./indicator-investigation.js"
import { firmnessOf } from "./firmness.js"
import { COMPOSITION_VERSION } from "./versions.js"

/**
 * BRIEF DO INDICADOR (domínio puro). Fatos oficiais e números da localização são frases do SISTEMA (o redator nunca calcula);
 * pontos de desenvolvimento só nascem de padrão SUSTENTADO nas chamadas do recorte que piorou; reconhecimento do resultado
 * oficial nunca inventa a conduta que o produziu; prática do grupo de referência entra como comparação, nunca como causa.
 */
const fmt = (value: number, unit: string) => formatIndicatorValue(value, unit)
const sentenceEnd = (text: string) => (/[.!?…]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`)
const proxyValue = (value: number, kind: IndicatorInvestigation["localization"]["proxy"]["kind"]) => (kind === "DURATION_SECONDS" ? `${Math.round(value)} s` : kind === "SIGNAL_RATE" ? `${(value * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : `${Math.round(value)}`)

function segmentSentence(segment: SegmentComparison, investigation: IndicatorInvestigation): string | null {
  const kind = investigation.localization.proxy.kind
  if (!segment.current || !segment.previous || !kind) return null
  const label = investigation.localization.proxy.label
  return `No assunto ${segment.label}, ${label} passou de ${proxyValue(segment.previous.value, kind)} (${segment.previous.n} chamadas em ${investigation.localization.windows.previous.label}) para ${proxyValue(segment.current.value, kind)} (${segment.current.n} chamadas em ${investigation.localization.windows.current.label}).`
}

/** Quem é o grupo de referência, numa frase do sistema (nunca nomes; só a regra de escolha). Os números de cada prática dizem quantos
 * colegas contribuíram — o grupo inteiro nunca é apresentado como se todos tivessem chamadas avaliadas. */
function referenceGroupOf(investigation: IndicatorInvestigation): string | null {
  const reference = investigation.reference
  if (!reference || reference.basis === "UNAVAILABLE") return null
  return reference.basis === "SUBJECT_METRIC" ? "colegas com melhor resultado nesse mesmo assunto e período" : `colegas com melhor resultado oficial de ${investigation.official.name} em ${investigation.official.periodLabel}`
}
/** "nas chamadas já analisadas de N deles do assunto X em que essa etapa se aplicava, ela foi cumprida em A de B" — fato agregado. */
function practiceNumbersOf(practice: ReferencePractice, investigation: IndicatorInvestigation): string {
  const subject = investigation.reference?.segmentLabel ? ` do assunto ${investigation.reference.segmentLabel}` : ""
  const done = practice.contrast === "REFERENCE_ALSO_MISSES" ? "foi cumprida por completo em só" : "foi cumprida em"
  return `nas chamadas já analisadas de ${practice.reference.contributors} deles${subject} em que essa etapa se aplicava, ela ${done} ${practice.reference.met} de ${practice.reference.eligible}`
}

function referenceSentence(practice: ReferencePractice | undefined, investigation: IndicatorInvestigation): string | null {
  const who = referenceGroupOf(investigation)
  if (!practice || !who) return null
  const numbers = practiceNumbersOf(practice, investigation)
  if (practice.contrast === "REFERENCE_ALSO_MISSES") return `Para comparação, entre os ${who}, ${numbers} — não é uma diferença sua em relação a esse grupo.`
  if (practice.contrast === "BOTH_FOLLOW") return `Os colegas com melhor resultado também cumprem essa etapa: entre os ${who}, ${numbers}.`
  return `Para comparação, entre os ${who}, ${numbers}.`
}

/**
 * `INDICATOR_SUBJECTS_V1`: os assuntos da pessoa nos dois períodos, como a localização os mediu (aproximação pelas chamadas gravadas).
 * Ordem: onde a investigação localizou a mudança, depois os comparáveis, depois por volume do período atual. Chamadas lidas = as da
 * evidência com a chave do próprio assunto (o assunto localizado também é um recorte R-n; recortes por dia/horário têm outra chave).
 */
export function subjectsOf(investigation: IndicatorInvestigation): BriefSubjects | null {
  const { localization } = investigation
  if (!localization.proxy.kind || localization.segments.length === 0) return null
  const focus = new Set(localization.focus.map((entry) => entry.key))
  const read = new Map<string, { calls: number; universe: number }>()
  for (const entry of investigation.evidence) if (!read.has(entry.segmentKey)) read.set(entry.segmentKey, { calls: entry.analyzedCalls, universe: entry.universe })
  // `PERIOD_SAMPLE_V1`: a evidência do período traz, por assunto, as chamadas com transcrição e as analisadas.
  for (const entry of investigation.evidence) for (const subject of entry.periodSubjects ?? []) if (!read.has(subject.key)) read.set(subject.key, { calls: subject.analyzed, universe: subject.universe })
  const rows = localization.segments.map((segment) => ({
    key: segment.key,
    label: segment.label,
    previous: segment.previous ? { value: segment.previous.value, calls: segment.previous.n } : null,
    current: segment.current ? { value: segment.current.value, calls: segment.current.n } : null,
    direction: segment.changeDirection,
    comparable: segment.sufficient,
    focus: focus.has(segment.key),
    analyzed: read.get(segment.key) ?? null,
  }))
  rows.sort((a, b) => Number(b.focus) - Number(a.focus) || Number(b.comparable) - Number(a.comparable) || (b.current?.calls ?? 0) - (a.current?.calls ?? 0) || (b.previous?.calls ?? 0) - (a.previous?.calls ?? 0))
  return { proxyKind: localization.proxy.kind, description: localization.proxy.description, previousLabel: localization.windows.previous.label, currentLabel: localization.windows.current.label, rows }
}

const PRACTICE_ORDER: Record<BriefReferencePractice["contrast"], number> = { REFERENCE_FOLLOWS_PERSON_MISSES: 0, REFERENCE_ONLY: 1, BOTH_FOLLOW: 2, REFERENCE_ALSO_MISSES: 3 }
/** Práticas do grupo de referência que não estão presas a um ponto do brief (`REFERENCE_PRACTICES_V1`), como fatos agregados P-n.
 * Título repetido de um ponto do brief (mesma seção, outra regra) leva a frase que abre a regra, para não confundir as duas. */
function referencePracticesOf(investigation: IndicatorInvestigation, used: ReadonlySet<string>, usedTitles: ReadonlySet<string>): BriefReferencePractice[] {
  const who = referenceGroupOf(investigation)
  if (!who) return []
  return (investigation.reference?.practices ?? [])
    .filter((practice): practice is ReferencePractice & { contrast: BriefReferencePractice["contrast"] } => practice.contrast !== "INSUFFICIENT" && (!used.has(practice.criterionKey) || practice.contrast === "REFERENCE_FOLLOWS_PERSON_MISSES"))
    .sort((a, b) => PRACTICE_ORDER[a.contrast] - PRACTICE_ORDER[b.contrast] || b.reference.eligible - a.reference.eligible)
    .slice(0, 4)
    .map((practice, index) => {
      const base = practiceTitleOf(practice)
      const opening = (practice.text.split("\n")[0] ?? "").trim().replace(/:$/, "")
      return {
        ref: `P${index + 1}`,
        title: usedTitles.has(base) && opening && opening !== base ? `${base} — ${opening.charAt(0).toLowerCase()}${opening.slice(1)}` : base,
        rule: { text: practice.text, section: cleanHeading(practice.heading), documentId: "", documentTitle: practice.documentTitle },
        group: `Entre os ${who}, ${practiceNumbersOf(practice, investigation)}.`,
        you: practice.person ? `Nas suas chamadas analisadas do período, em ${practice.person.met} de ${practice.person.eligible}.` : null,
        contrast: practice.contrast,
      }
    })
}

/**
 * Título de uma prática agregada pela âncora (`PRACTICE_ANCHOR_V1`): quando a regra começa pela frase que abre uma lista ("Perguntar:",
 * "Antes de encerrar, informar:"), essa frase sozinha não diz qual é a prática — o título da seção diz ("Confirmação de entendimento").
 */
export const practiceTitleOf = (entry: { text: string; heading: string | null; practiceTitle?: string }) => {
  // `PRACTICE_IDENTITY_V1`: a prática organizada tem o título da conduta (rótulo; a regra literal continua nos fatos).
  if (entry.practiceTitle) return entry.practiceTitle
  const opening = (entry.text.split("\n")[0] ?? "").trim()
  const heading = cleanHeading(entry.heading)
  return opening.endsWith(":") && heading ? heading : criterionTitleOf(entry)
}

/** Como o recorte entra numa frase de fato: "No assunto X" ou "Nas chamadas do recorte dia 14/08" (recorte descoberto). */
const scopeOf = (entry: Pick<SegmentEvidence, "scope" | "segmentLabel">) => entry.scope ?? `No assunto ${entry.segmentLabel}`

function patternFinding(pattern: CriterionPattern, investigation: IndicatorInvestigation, scope: string, sampleNote: string, kind: "DEVELOPMENT" | "STRENGTH", priorOrientation: { dateLabel: string } | null = null): BriefFinding {
  const deviations = pattern.notMet + pattern.partial
  const example = pattern.examples.find((entry) => entry.rationale) ?? pattern.examples[0]
  // `observed` = só os NÚMEROS do sistema; a justificativa de um exemplo (leitura do modelo) fica em `reading`, fora dos fatos.
  const observed = kind === "DEVELOPMENT"
    ? `${scope}, em ${deviations} de ${pattern.eligible} chamadas analisadas em que esta etapa se aplicava, ela não foi cumprida${pattern.partial > 0 ? " ou foi cumprida só em parte" : ""}.`
    : `${scope}, esta etapa foi cumprida em ${pattern.met} de ${pattern.eligible} chamadas analisadas em que se aplicava.`
  const practice = investigation.reference?.practices.find((entry) => entry.criterionKey === pattern.criterionKey)
  // "Os colegas cumprem e você não" vira prática P-n (orientação concreta, pedida na reescrita se não for usada — validação V14C: estava
  // só como número anexo ao ponto e o redator não usou); aqui fica só o contexto que protege a pessoa ("o grupo também quase não cumpre").
  const reference = (kind === "DEVELOPMENT" && practice?.contrast === "REFERENCE_ALSO_MISSES") || (kind === "STRENGTH" && practice?.contrast === "BOTH_FOLLOW") ? referenceSentence(practice, investigation) : null
  return {
    ref: "",
    findingKey: `IND:${investigation.official.code}:${investigation.official.periodStart}:${investigation.official.periodEnd}:${pattern.criterionKey}`,
    kind,
    origin: "INDICATOR_PATTERN",
    title: practiceTitleOf(pattern),
    materiality: "HIGH",
    status: "PATTERN",
    observed,
    reading: example?.rationale ?? null,
    quotes: pattern.examples.flatMap((entry) => (entry.quote ? [briefQuoteOf(entry.quote)] : [])).slice(0, 2),
    absence: null,
    declaredOnly: false,
    rules: (pattern.memberRules ?? [{ documentId: pattern.documentId, documentTitle: pattern.documentTitle, heading: pattern.heading, text: pattern.text, ...(pattern.sourceKind ? { sourceKind: pattern.sourceKind } : {}) }]).map((rule) => ({ text: rule.text, section: cleanHeading(rule.heading), documentId: rule.documentId, documentTitle: rule.documentTitle, ...(rule.sourceKind ? { sourceKind: rule.sourceKind } : {}) })),
    ...((pattern.reevaluated ?? 0) > 0 ? { ruleBasis: "CURRENT_RULE_REEVALUATION" as const } : {}),
    guidance: kind === "DEVELOPMENT" && example?.guidance ? { moment: example.guidance.moment, condition: example.guidance.condition, action: example.guidance.action } : null,
    whyItMatters: null,
    history: null,
    criterionKeys: [pattern.criterionKey],
    stats: [sampleNote, ...(reference ? [reference] : [])],
    practiceKeys: [pattern.criterionKey],
    // Padrão do período = a mesma prática não cumprida em várias chamadas: a regra vigente decide entre corrigir e orientar.
    ...(kind === "DEVELOPMENT" ? { firmness: firmnessOf({ ruleBasis: (pattern.reevaluated ?? 0) > 0 ? "CURRENT_RULE_REEVALUATION" : null, materiality: "HIGH", recurrence: { assessed: pattern.eligible, notMet: deviations }, priorOrientation, scope: "PERIOD" }) } : {}),
  }
}

export function buildIndicatorBrief(investigation: IndicatorInvestigation, input: { documentVersions: ReadonlyMap<string, number>; delivered: ReadonlySet<string>; factualWhenInconclusive: boolean; priorOrientations?: ReadonlyMap<string, string>; argumentPhrasings?: ReadonlyMap<string, { name: string; text: string }> }): FeedbackBrief {
  const { official, localization } = investigation
  const officialLines = [
    { label: "Resultado oficial", value: `${fmt(official.value, official.unit)} (${official.periodLabel})` },
    ...(official.target !== null ? [{ label: "Meta", value: `${fmt(official.target, official.unit)}${official.withinTarget === null ? "" : official.withinTarget ? " — dentro da meta" : " — fora da meta"}` }] : []),
    ...(official.previous ? [{ label: "Período anterior", value: `${fmt(official.previous.value, official.unit)} (${official.previous.periodLabel})` }] : []),
  ]
  const suppressed: FeedbackBrief["suppressed"] = []
  const developments: BriefFinding[] = []
  const strengths: BriefFinding[] = []
  const changedRules: string[] = []
  const resultGood = official.withinTarget === true || official.movement === "IMPROVED"
  for (const entry of investigation.evidence) {
    for (const pattern of entry.patterns) {
      if (pattern.currentRule === "CHANGED" && (pattern.classification === "DEVELOPMENT_PATTERN" || pattern.classification === "STRENGTH_PATTERN")) {
        changedRules.push(practiceTitleOf(pattern))
        continue
      }
      if (isAdverseFocus(entry.focusReason) && pattern.classification === "DEVELOPMENT_PATTERN") {
        const prior = input.priorOrientations?.get(pattern.criterionKey)
        const finding = patternFinding(pattern, investigation, scopeOf(entry), entry.sampleNote, "DEVELOPMENT", prior ? { dateLabel: prior } : null)
        if (input.delivered.has(finding.findingKey)) suppressed.push({ findingKey: finding.findingKey, title: finding.title, reason: "ALREADY_DELIVERED" })
        else developments.push(finding)
      } else if (pattern.classification === "STRENGTH_PATTERN" && (entry.focusReason === "IMPROVED" || investigation.conclusion === "STRENGTH_PATTERN" || (resultGood && !isAdverseFocus(entry.focusReason)))) {
        // `STRENGTH_WITH_GOOD_RESULT_V1` (rodada real V13): com o resultado oficial bom, a conduta consistente nas chamadas analisadas
        // (fato com denominador) é reconhecível mesmo quando um dia fora do padrão foi examinado e a conclusão deixou de ser "padrão de
        // força" — antes ela sumia do brief e a mensagem ficava só com o número. Nunca como causa do resultado (o redator e o
        // verificador cuidam disso); recorte que piorou nunca gera reconhecimento.
        const finding = patternFinding(pattern, investigation, scopeOf(entry), entry.sampleNote, "STRENGTH")
        if (!input.delivered.has(finding.findingKey)) strengths.push(finding)
      }
    }
  }
  // O resultado oficial bom é FATO disponível ao redator mesmo quando um recorte (dia, assunto) pede ajuste — oferecer não obriga:
  // a composição decide se vale reconhecer (nunca para "equilibrar" uma correção).
  if (resultGood) {
    const findingKey = `IND:${official.code}:${official.periodStart}:${official.periodEnd}:RESULT`
    const observed = official.withinTarget === true && official.target !== null
      ? `O resultado oficial de ${official.name} em ${official.periodLabel} foi ${fmt(official.value, official.unit)}, dentro da meta de ${fmt(official.target, official.unit)}${official.previous && official.movement === "IMPROVED" ? `, melhor que ${fmt(official.previous.value, official.unit)} em ${official.previous.periodLabel}` : ""}.`
      : `O resultado oficial de ${official.name} passou de ${fmt(official.previous!.value, official.unit)} em ${official.previous!.periodLabel} para ${fmt(official.value, official.unit)} em ${official.periodLabel}.`
    if (!input.delivered.has(findingKey)) strengths.unshift({ ref: "", findingKey, kind: "STRENGTH", origin: "INDICATOR_RESULT", title: `Resultado de ${official.name}`, materiality: "HIGH", status: "RESULT", observed, reading: null, quotes: [], absence: null, declaredOnly: false, rules: [], guidance: null, whyItMatters: null, history: null, criterionKeys: [], stats: [] })
  }
  developments.slice(0, 3).forEach((finding, index) => (finding.ref = `A${index + 1}`))
  strengths.slice(0, 3).forEach((finding, index) => (finding.ref = `S${index + 1}`))
  // `ARGUMENT_PHRASING_V1`: regra de padrão que vem de um argumentário leva a fraseologia sugerida dele (modelo de como dizer, fato).
  for (const finding of developments) {
    finding.rules = finding.rules.map((rule) => {
      const phrasing = rule.sourceKind === "ARGUMENT_SCRIPT" ? input.argumentPhrasings?.get(rule.documentId) : undefined
      return phrasing ? { ...rule, phrasing: { scriptName: phrasing.name, text: phrasing.text } } : rule
    })
  }

  const context: string[] = []
  const overall = localization.overall
  if (localization.proxy.kind && overall.current && overall.previous && overall.direction !== "UNKNOWN") context.push(`No conjunto das suas chamadas, ${localization.proxy.label} passou de ${proxyValue(overall.previous.value, localization.proxy.kind)} (${overall.previous.n} chamadas) para ${proxyValue(overall.current.value, localization.proxy.kind)} (${overall.current.n} chamadas) — ${localization.proxy.description}`)
  for (const focus of localization.focus) {
    const segment = localization.segments.find((entry) => entry.key === focus.key)
    const text = segment ? segmentSentence(segment, investigation) : null
    if (text) context.push(focus.reason === "HIDDEN_DETERIORATION" ? `${text} Esse assunto piorou mesmo com o resultado geral melhor.` : text)
  }
  // `REFERENCE_DURATION_V1`: onde está a diferença de tempo no assunto, em relação a quem tem melhor resultado — agregado, nunca causa.
  const duration = investigation.reference?.durationComparison
  const durationGroup = referenceGroupOf(investigation)
  if (duration && durationGroup && investigation.reference?.segmentLabel) context.push(`Nas chamadas gravadas do assunto ${investigation.reference.segmentLabel} em ${official.periodLabel}, a duração registrada média das suas chamadas foi de ${duration.personAverage} s (${duration.personCalls} chamada(s)); entre os ${durationGroup}, foi de ${duration.referenceAverage} s (${duration.referenceCalls} chamada(s) de ${duration.contributors} colegas). É uma aproximação pelas chamadas gravadas, não o valor oficial, e não diz por que a diferença existe.`)
  if (localization.decomposition?.dominant === "MIX") context.push("A maior parte da variação veio da mudança no mix de assuntos atendidos, não de mudança dentro de um mesmo assunto.")
  for (const day of localization.daily.outliers.slice(0, 2)) context.push(`Dia fora do seu padrão no período: ${day.date.split("-").reverse().join("/")} (${fmt(day.value, official.unit)}).`)
  // Recortes que a INVESTIGAÇÃO revelou (dia, horário, concentração): o que foi observado e por qual consulta — fato, não causa.
  const investigated = new Set(investigation.evidence.map((entry) => entry.sliceRef).filter(Boolean))
  for (const slice of investigation.slices ?? []) if (slice.origin.kind === "TOOL" && slice.adverse && investigated.has(slice.ref)) context.push(sentenceEnd(slice.observation))
  // O que as FERRAMENTAS apuraram e é comunicável (com a origem: oficial × operacional × aproximação pelas chamadas × contexto).
  for (const fact of investigation.signals?.facts ?? []) context.push(sentenceEnd(`${fact.text.charAt(0).toUpperCase()}${fact.text.slice(1)}`))
  // `ABSENCE_OF_PATTERN_V1` (rodada real V8): "nenhum desvio recorrente" a partir de 2 análises (uma delas afetada por um defeito)
  // virou "os atendimentos transcorreram sem desvios" na mensagem. Ausência de padrão pode ser amostra pequena, análise parcial ou
  // falta de investigação — nunca é fato de boa execução: vai como LIMITE com universo, amostra e qualidade; só uma amostra
  // suficiente e completa vira uma frase de fato, e ainda assim restrita a essa amostra.
  const sampleLimits: string[] = []
  const contextPractices = new Set<string>()
  const developmentKeys = new Set(developments.flatMap((finding) => finding.criterionKeys))
  for (const entry of investigation.evidence) {
    if (entry.focusReason === "IMPROVED" || entry.analyzedCalls === 0) continue
    const recurring = entry.patterns.filter((pattern) => pattern.classification === "DEVELOPMENT_PATTERN" && pattern.currentRule !== "CHANGED")
    if (recurring.length === 0) {
      const statement = absenceOfPatternStatement(entry)
      if (statement.kind === "FACT") context.push(statement.text)
      else sampleLimits.push(statement.text)
    }
    // Sem localizar onde o resultado mudou, o que se viu nas chamadas é OBSERVAÇÃO do período (fato com denominador), nunca causa.
    // `PERIOD_SAMPLE_V1`: a amostra do período (todos os assuntos) entra com o próprio escopo, sem repetir a prática que um recorte
    // descoberto já trouxe como ponto de desenvolvimento.
    else if (entry.focusReason === "UNLOCATED") for (const pattern of (entry.sampleBasis === "PERIOD_SAMPLE" ? recurring.filter((candidate) => !developmentKeys.has(candidate.criterionKey)) : recurring).slice(0, 2)) {
      const practice = investigation.reference?.practices.find((candidate) => candidate.criterionKey === pattern.criterionKey && candidate.contrast !== "INSUFFICIENT" && candidate.contrast !== "REFERENCE_ONLY")
      if (practice) contextPractices.add(pattern.criterionKey)
      const done = pattern.partial === 0 ? "não foi cumprida" : pattern.notMet === 0 ? "foi cumprida só em parte" : "não foi cumprida ou foi cumprida só em parte"
      const where = entry.sampleBasis === "PERIOD_SAMPLE" ? scopeOf(entry) : `Nas chamadas já analisadas do assunto ${entry.segmentLabel} no período`
      context.push(`${where}, a etapa “${practiceTitleOf(pattern)}” ${done} em ${pattern.notMet + pattern.partial} de ${pattern.eligible} em que se aplicava (não foi possível ligar isso à variação do indicador).${practice ? ` ${referenceSentence(practice, investigation) ?? ""}` : ""}`.trim())
    }
    if ((entry.pendingReview ?? 0) > 0) context.push(`${scopeOf(entry)}, ${entry.pendingReview} chamada(s) ainda aguardam a revisão da análise e não entram nas contagens.`)
  }

  const unlocated = investigation.evidence.some((entry) => entry.focusReason === "UNLOCATED")
  const limitations = [...new Set([
    ...sampleLimits,
    ...localization.limitations,
    ...investigation.limitations,
    ...(investigation.reference?.limitations ?? []),
    ...(developments.length > 0 || unlocated ? [ATTRIBUTION_LIMIT] : []),
    ...changedRules.map((title) => `A etapa “${title}” mudou na base depois dessas chamadas: as avaliações da época ficam na memória, mas não orientam agora.`),
  ])]
  // Para o COLABORADOR (detalhes da tela): só o que ajuda a entender o retorno — limite de atribuição, comparação do mês com o grupo,
  // dado do período, regra que mudou, recorte que não foi examinado. Nunca o funcionamento da investigação (paradas, ferramentas,
  // orçamento, restrições do Workflow), que fica nas limitações técnicas.
  const readerNotes = [...new Set([
    ...(developments.length > 0 || unlocated ? [ATTRIBUTION_LIMIT] : []),
    ...sampleLimits,
    ...(investigation.signals?.attribution === "NO_INDIVIDUAL_GAP" ? ["No período, o seu resultado ficou igual ou melhor que o do grupo comparável: a variação não é tratada como deficiência individual."] : []),
    ...(investigation.signals?.dataQuality === "INSUFFICIENT" ? ["O dado operacional do período não é suficiente para uma leitura segura da variação."] : []),
    ...changedRules.map((title) => `A etapa “${title}” mudou no procedimento depois dessas chamadas: as avaliações da época não orientam agora.`),
    // Recorte não examinado: a nota própria para o leitor (sem o motivo técnico); investigações anteriores, a limitação de antes.
    ...(investigation.readerNotes ?? investigation.limitations.filter((limitation) => limitation.startsWith("As chamadas do recorte "))),
  ])]
  const usedPractices = new Set([...developments.slice(0, 3), ...strengths.slice(0, 3)].flatMap((finding) => finding.criterionKeys).concat([...contextPractices]))
  const referencePractices = referencePracticesOf(investigation, usedPractices, new Set([...developments.slice(0, 3), ...strengths.slice(0, 3)].map((finding) => finding.title)))
  const tone: FeedbackBrief["tone"] = developments.length > 0 ? (strengths.length > 0 ? "MIXED" : "DEVELOPMENT") : strengths.length > 0 ? "RECOGNITION" : "INFORMATIVE"
  const materials = materialsOf(developments.slice(0, 3), input.documentVersions)
  return {
    version: COMPOSITION_VERSION,
    domain: "INDICATOR",
    label: `${official.name} · ${official.periodLabel}`,
    heading: { title: official.name, subtitle: official.periodLabel },
    context,
    developments: developments.slice(0, 3),
    strengths: strengths.slice(0, 3),
    limitations,
    readerNotes,
    materials,
    officialLines,
    officialTable: [{ indicator: official.name, periodLabel: official.periodLabel, result: fmt(official.value, official.unit), target: official.target !== null ? fmt(official.target, official.unit) : null, withinTarget: official.withinTarget, previousLabel: official.previous?.periodLabel ?? null, previous: official.previous ? fmt(official.previous.value, official.unit) : null }],
    indicatorName: official.name,
    tone: tone === "INFORMATIVE" && !input.factualWhenInconclusive ? "INFORMATIVE" : tone,
    suppressed,
    ...([...developments, ...strengths].some((finding) => finding.ruleBasis === "CURRENT_RULE_REEVALUATION") ? { rulePerspective: "CURRENT_RULE_REEVALUATION" as const } : {}),
    ...((investigation.strategy.prohibitedClaims ?? []).length > 0 ? { prohibitedClaims: [...investigation.strategy.prohibitedClaims!] } : {}),
    ...(referencePractices.length > 0 ? { referencePractices } : {}),
    subjects: subjectsOf(investigation),
  }
}

/**
 * O que a ausência de padrão numa amostra permite dizer (`ABSENCE_OF_PATTERN_V1`): com amostra abaixo do mínimo de padrão, análises
 * parciais ou cobertura pequena do recorte → LIMITE ("não é possível afirmar padrão, nem ausência de desvio"); com amostra suficiente e
 * análises completas → FATO restrito à amostra (nunca "sem desvios", nunca o período inteiro).
 */
export function absenceOfPatternStatement(entry: Pick<SegmentEvidence, "scope" | "segmentLabel" | "analyzedCalls" | "universe" | "quality">): { kind: "LIMIT" | "FACT"; text: string } {
  const scope = scopeOf(entry)
  const partial = entry.quality?.partial ?? 0
  const confirmed = entry.quality?.confirmedCalls ?? entry.analyzedCalls
  const sample = `${entry.analyzedCalls} de ${entry.universe} chamada(s) gravada(s) no período ${entry.analyzedCalls === 1 ? "foi analisada" : "foram analisadas"}`
  const quality = partial > 0 ? ` (${partial} com análise parcial — nem todas as etapas puderam ser avaliadas)` : ""
  const enough = confirmed >= PATTERN_MINIMUM_ELIGIBLE && partial === 0 && entry.universe > 0 && entry.analyzedCalls / entry.universe >= 0.5
  if (!enough) return { kind: "LIMIT", text: `${scope}, ${sample}${quality}: é pouco para dizer se há ou não desvio recorrente — o que não foi visto nessa amostra não indica que as chamadas estejam sem problemas.` }
  return { kind: "FACT", text: `${scope}, nas ${entry.analyzedCalls} chamadas analisadas (de ${entry.universe} gravadas no período), nenhuma etapa do procedimento apareceu descumprida em mais de uma chamada — isso descreve essa amostra, não o atendimento do período inteiro.` }
}

/** Uma comunicação INFORMATIVE só é publicada quando há o que dizer: onde mudou, ou o que foi verificado. */
export const informativeHasContent = (brief: FeedbackBrief) => brief.tone !== "INFORMATIVE" || brief.context.length >= 2 || (brief.referencePractices ?? []).length > 0
