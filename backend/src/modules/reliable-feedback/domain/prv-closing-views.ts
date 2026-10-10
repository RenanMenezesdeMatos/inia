import { createHash } from "node:crypto"
import { formatIndicatorValue } from "../../indicators/domain/indicator-definition.js"
import { INTERNAL_REF_PATTERN } from "../../investigation/domain/interaction-feedback.js"
import { detectPermanentTraitLanguage } from "../../investigation/domain/evidence-gating.js"
import type { BehaviorPattern } from "../../indicator-diagnosis/domain/operational-patterns.js"
import { TRIAGE_REASON_LABELS } from "../../indicator-diagnosis/domain/closing-triage.js"
import { formatPercent, referencePeriodLabel } from "../../indicator-diagnosis/domain/prv-closing.js"
import { CONCLUSION_LABELS, type ConclusionType, type IndicatorInvestigation, type PrvClosingDiagnosis } from "../../indicator-diagnosis/domain/prv-investigation.js"
import { causalIndicatorClaims, strategyProhibitedClaims } from "./indicator-diagnosis-claims.js"
import { detectUnsupportedEffectClaims } from "./effect-claims.js"
import { behaviorStatement, directOfficialFactEntries, howToImproveOf, officialFactTexts } from "./prv-closing-items.js"
import { INVESTIGATION_STEP_CATALOG, STEP_UNAVAILABLE_LABELS } from "../../indicator-diagnosis/domain/investigation-steps.js"
import { FEEDBACK_VIEW_VERSION, type FeedbackView, type FeedbackViewDevelopment, type FeedbackViewMaterial, type FeedbackViewQuote } from "./feedback-view.js"
import type { EmittedItem } from "./reliable-feedback-artifact.js"

/**
 * INDICATOR DIAGNOSIS V1 — PROJEÇÕES POR PÚBLICO (domínio puro). UMA verdade diagnóstica estruturada (`PrvClosingDiagnosis`),
 * várias apresentações — nunca um diagnóstico por persona:
 *
 *   COLABORADOR  narrativa natural primeiro (simples, pessoal, acionável) + "Entenda este feedback" (resultado do ciclo, o que
 *                trabalhar, exemplos das chamadas, o que o processo orienta, o que manter) + materiais fora dos detalhes. Só o que
 *                a população DELE sustenta; nada do grupo, nada de estatística que ele não precisa.
 *   SUPERVISOR   visão técnica: triagem, população, mix, amostra/reuso, padrões com denominadores, distribuição por dia/faixa,
 *                agregado do Subgrupo (padrão do grupo ≠ do colaborador), processos, evidências, interpretação e limitações.
 *
 * A narrativa e as notas de interpretação vêm do redator só se passarem na validação campo a campo (números da entrada, sem causa,
 * sem pressa, sem traço, sem culpa, sem equipe na mensagem ao colaborador, sem nome, sem termos internos, todo ajuste citado); senão
 * o texto do sistema. Sempre conferidas contra os itens que REALMENTE saem (QA pode ter mudado algo).
 */
export const PRV_FEEDBACK_VIEW_VERSION = "PRV_FEEDBACK_VIEW_V1" as const
export const PRV_SUPERVISOR_VIEW_VERSION = "PRV_SUPERVISOR_VIEW_V1" as const
export const PRV_NARRATIVE_VERSION = "PRV_NARRATIVE_V1" as const

/** Mapa item → origem no diagnóstico (guardado no artefato; o item emitido não carrega a prática). */
export type PrvItemRef = { index: number; indicatorCode: string; practiceKey: string | null }

export type PrvNarrativeBrief = {
  itemsKey: string
  cycle: string
  indicators: {
    code: string
    name: string
    result: string
    target: string | null
    position: "dentro da meta" | "fora da meta" | null
    quartile: string | null
    previous: string | null
    motive: string | null
    conclusion: ConclusionType
    mix: { motive: string; before: string; now: string; longerDuration: boolean; motiveAverage: string | null; othersAverage: string | null } | null
    adjust: { topic: string; happened: string; guidance: string | null; concentration: string | null; documentTitle: string | null; /** V1.0.2 — a ação humana derivada da regra verificada (nunca o item do checklist cru). */ howTo?: string | null }[]
    maintain: { topic: string; happened: string }[]
    cannotConclude: string[]
    /** V2 — população sinalizada (só os passos escolhidos) e se a evidência comportamental pedida pela estratégia não existe nos dados. */
    signal?: BriefSignal | null
    evidenceUnavailable?: boolean
    /** V2 — frases proibidas pela estratégia do indicador (aplicadas por código ao texto do redator; nunca enviadas ao modelo). */
    prohibitedClaims?: string[]
  }[]
  sharedTopics: string[]
  /** V2 — origem: ausente = fechamento do PRV; DIRECT_INDICATOR = diagnóstico direto de um indicador (sem PRV). */
  source?: "PRV_CLOSING" | "DIRECT_INDICATOR"
}
export type BriefSignal = {
  label: string
  interactions: number
  signaled: number
  rate: string | null
  status: string
  concentration: { motive: string; signaled: number; share: string; motiveInteractions: number; motiveRate: string; othersRate: string } | null
  previous: { period: string; signaled: number; interactions: number; rate: string | null } | null
  shift: { motive: string; before: string; now: string } | null
}
export type PrvNarrativeDraft = { paragraphs: string[]; card: string; supervisorNotes: string[] }
export type StoredPrvNarrative = { version: typeof PRV_NARRATIVE_VERSION; promptVersion: string; itemsKey: string; draft: PrvNarrativeDraft | null; error: string | null; provenance: unknown }
export type ResolvedPrvNarrative = { paragraphs: string[]; card: string; supervisorNotes: string[]; source: { paragraphs: "WRITER" | "SYSTEM"; card: "WRITER" | "SYSTEM"; supervisorNotes: "WRITER" | "SYSTEM" }; violations: { paragraphs: string[]; card: string[]; supervisorNotes: string[] } }

/** Dados do fechamento guardados no artefato confiável (a verdade + o mapa dos itens + o rascunho do redator). */
export type PrvClosingArtifactData = {
  contract: "PRV_CLOSING_FEEDBACK_V1"
  idempotencyKey: string
  referencePeriod: string
  diagnosis: PrvClosingDiagnosis
  itemRefs: PrvItemRef[]
  recipient: { firstName: string } | null
  narrative: StoredPrvNarrative | null
  /** Custo por estágio (usage do provedor, quando informado): reanálise no nó de origem × narrativa aqui. */
  usage: { reanalysis: { agentRunId: string | null; assessedInteractions: number } ; narrative: unknown }
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()
const lowerFirst = (text: string) => (text.length > 1 && /^\p{Lu}(?:\p{Ll}|\s)/u.test(text) ? text[0]!.toLocaleLowerCase("pt-BR") + text.slice(1) : text)
const itemsKeyOf = (items: readonly EmittedItem[]) => createHash("sha256").update(items.map((item) => `${item.index}:${item.section}`).join("|")).digest("hex").slice(0, 16)
const formatDate = (iso: string) => {
  const [year, month, day] = iso.slice(0, 10).split("-")
  return year && month && day ? `${day}/${month}` : iso
}

type Context = { investigation: IndicatorInvestigation; pattern: BehaviorPattern | null; item: EmittedItem }
function contextsOf(items: readonly EmittedItem[], data: PrvClosingArtifactData): Context[] {
  return items.flatMap((item) => {
    const ref = data.itemRefs.find((entry) => entry.index === item.index)
    const investigation = ref ? data.diagnosis.investigations.find((entry) => entry.indicatorCode === ref.indicatorCode) : undefined
    if (!ref || !investigation) return []
    return [{ investigation, item, pattern: ref.practiceKey ? investigation.patterns?.behaviors.find((behavior) => behavior.practiceKey === ref.practiceKey) ?? null : null }]
  })
}
const value = (investigation: IndicatorInvestigation, amount: number) => formatIndicatorValue(amount, investigation.unit)
const segmentOf = (investigation: IndicatorInvestigation) => investigation.population.selectedSegment?.label ?? null

function concentrationText(pattern: BehaviorPattern): string | null {
  const concentration = pattern.concentration
  if (!concentration) return null
  const where = concentration.dimension === "WEEKDAY" ? `às ${concentration.label}s`.replace("às sábados", "aos sábados").replace("às domingos", "aos domingos") : `no período da ${concentration.label}`
  return `${concentration.notFollowed} das ${pattern.counts.notFollowed} ocorrências aconteceram ${where}`
}

/** Brief do redator: SÓ os itens que saem (desenvolvimento/força do colaborador) + fatos oficiais + mix + o que não se conclui. */
export function prvNarrativeBriefOf(items: readonly EmittedItem[], data: PrvClosingArtifactData): PrvNarrativeBrief {
  const contexts = contextsOf(items, data)
  const indicators = data.diagnosis.investigations
    .filter((investigation) => contexts.some((context) => context.investigation === investigation))
    .map((investigation) => {
      const { official } = investigation
      const own = contexts.filter((context) => context.investigation === investigation && context.pattern)
      const shift = investigation.conclusion.mixShift ? investigation.mix?.shifted ?? null : null
      const segment = segmentOf(investigation)
      return {
        code: investigation.indicatorCode,
        name: investigation.indicatorName,
        result: value(investigation, official.value),
        target: official.target === null ? null : value(investigation, official.target),
        position: official.withinReference === null ? null : official.withinReference ? "dentro da meta" as const : "fora da meta" as const,
        quartile: official.quartile,
        previous: official.previous ? `${value(investigation, official.previous.value)}${official.previous.quartile ? `, quartil ${official.previous.quartile}` : ""} (${referencePeriodLabel(official.previous.referencePeriod)})` : null,
        motive: segment,
        conclusion: investigation.conclusion.type,
        mix: shift ? { motive: shift.label, before: formatPercent(shift.previousSharePercent), now: formatPercent(shift.currentSharePercent), longerDuration: shift.longerDuration, motiveAverage: shift.longerDuration && shift.segmentAverageDurationSeconds !== null ? `${shift.segmentAverageDurationSeconds} s` : null, othersAverage: shift.longerDuration && shift.othersAverageDurationSeconds !== null ? `${shift.othersAverageDurationSeconds} s` : null } : null,
        adjust: own.filter((context) => context.item.section === "OPPORTUNITY").map((context) => ({ topic: context.pattern!.title, happened: behaviorStatement(context.pattern!, segment ?? "motivo investigado"), guidance: context.item.knowledge ? context.item.knowledge.quote : null, concentration: concentrationText(context.pattern!), documentTitle: context.item.knowledge?.documentTitle ?? null, howTo: context.item.knowledge ? howToImproveOf(context.item.knowledge.quote, segment ?? "motivo investigado") : null })),
        maintain: own.filter((context) => context.item.section === "STRENGTH").map((context) => ({ topic: context.pattern!.title, happened: behaviorStatement(context.pattern!, segment ?? "motivo investigado") })),
        cannotConclude: [...investigation.unsupportedHypotheses.filter((text) => !/Subgrupo/.test(text)).slice(-2)],
        ...(investigation.signal ? { signal: briefSignalOf(investigation) } : {}),
        ...(investigation.evidenceGap ? { evidenceUnavailable: true } : {}),
        ...(investigation.prohibitedClaims && investigation.prohibitedClaims.length > 0 ? { prohibitedClaims: investigation.prohibitedClaims } : {}),
      }
    })
  const shared = data.diagnosis.sharedPatterns.map((pattern) => pattern.title)
  return { itemsKey: itemsKeyOf(items), cycle: data.diagnosis.referencePeriodLabel, indicators, sharedTopics: shared, ...(data.diagnosis.source ? { source: data.diagnosis.source.kind } : {}) }
}

/** V2 — a população sinalizada no brief (só o que os passos ESCOLHIDOS calcularam; números prontos do sistema). */
function briefSignalOf(investigation: IndicatorInvestigation): BriefSignal | null {
  const signal = investigation.signal
  if (!signal) return null
  const selected = investigation.steps?.selected ?? []
  const distribution = selected.includes("SIGNAL_DISTRIBUTION") ? signal.distribution : null
  const evolution = selected.includes("SIGNAL_EVOLUTION") && signal.evolution?.status === "AVAILABLE" ? signal.evolution : null
  if (!distribution && !evolution) return null
  const label = signal.distribution?.signalLabel ?? signal.flagName
  const pct = (value: number | null | undefined) => (value === null || value === undefined ? null : formatPercent(value))
  return {
    label,
    interactions: distribution?.interactions ?? evolution?.current.interactions ?? 0,
    signaled: distribution?.signaled ?? evolution?.current.signaled ?? 0,
    rate: pct(distribution?.signalRatePercent ?? evolution?.current.signalRatePercent),
    status: distribution?.status ?? "NOT_SELECTED",
    concentration: distribution?.concentration ? { motive: distribution.concentration.label, signaled: distribution.concentration.signaled, share: formatPercent(distribution.concentration.shareOfSignalPercent), motiveInteractions: distribution.concentration.interactions, motiveRate: formatPercent(distribution.concentration.signalRatePercent), othersRate: formatPercent(distribution.concentration.othersSignalRatePercent) } : null,
    previous: evolution ? { period: investigation.official.previous ? referencePeriodLabel(investigation.official.previous.referencePeriod) : "período anterior", signaled: evolution.previous.signaled, interactions: evolution.previous.interactions, rate: pct(evolution.previous.signalRatePercent) } : null,
    shift: evolution?.shifted ? { motive: evolution.shifted.label, before: formatPercent(evolution.shifted.previousSharePercent), now: formatPercent(evolution.shifted.currentSharePercent) } : null,
  }
}

/** V2 — narrativa do SISTEMA do diagnóstico direto (texto de supervisor; composição nunca vira causa; sem ação sem base). */
function deterministicDirectNarrative(brief: PrvNarrativeBrief): { paragraphs: string[]; card: string } {
  const paragraphs: string[] = []
  const cardParts: string[] = []
  for (const indicator of brief.indicators) {
    const position = indicator.target && indicator.position ? `, ${indicator.position} de ${indicator.target}` : ""
    paragraphs.push(`Em ${brief.cycle}, o resultado oficial de ${indicator.name} foi de ${indicator.result}${position}${indicator.quartile ? ` (quartil oficial ${indicator.quartile})` : ""}.${indicator.previous ? ` No período anterior, foi de ${indicator.previous}.` : ""}`)
    const signal = indicator.signal
    if (signal) {
      if (signal.status !== "NOT_SELECTED") paragraphs.push(signal.signaled === 0
        ? `Nenhuma das ${signal.interactions} interações que você atendeu no período chegou marcada como ${signal.label}.`
        : `Das ${signal.interactions} interações que você atendeu no período, ${signal.signaled} chegaram marcadas como ${signal.label}${signal.rate ? ` (${signal.rate})` : ""}.${signal.concentration ? ` ${signal.concentration.motive} reuniu ${signal.concentration.signaled} delas: nesse motivo, ${signal.concentration.signaled} de ${signal.concentration.motiveInteractions} atendimentos vieram marcados (${signal.concentration.motiveRate}), contra ${signal.concentration.othersRate} nos demais motivos.` : signal.status === "SPREAD" ? " Elas ficaram distribuídas entre os motivos, sem concentração em um só." : signal.status === "INSUFFICIENT_DATA" ? " Foram poucas no período para falar de concentração por motivo." : ""}`)
      if (signal.previous) paragraphs.push(`No período anterior (${signal.previous.period}), ${signal.previous.signaled} de ${signal.previous.interactions} interações atendidas vieram marcadas${signal.previous.rate ? ` (${signal.previous.rate})` : ""}.${signal.shift ? ` ${signal.shift.motive} passou de ${signal.shift.before} para ${signal.shift.now} das interações marcadas.` : ""}`)
    }
    if (indicator.evidenceUnavailable) paragraphs.push(`Os dados que recebemos marcam o novo contato, mas não indicam qual atendimento anterior o originou nem quem atendeu. Por isso, esta análise não aponta um comportamento seu ligado a esse resultado.`)
    else if (indicator.adjust.length === 0 && indicator.maintain.length === 0 && indicator.conclusion !== "NOT_DECOMPOSABLE") paragraphs.push("Nas informações analisadas, não apareceu um ponto que se repetisse o suficiente para uma orientação específica neste período.")
    if (indicator.adjust.length > 0) {
      paragraphs.push(`O ponto que mais se repetiu nas suas chamadas analisadas: ${indicator.adjust.map((entry) => lowerFirst(entry.happened).replace(/\.$/, "")).join("; ")}.`)
      const withRule = indicator.adjust.filter((entry) => entry.documentTitle)
      if (withRule[0]?.howTo) paragraphs.push(withRule[0].howTo)
    }
    if (indicator.maintain.length > 0) paragraphs.push(`Mantenha o que já funciona: ${indicator.maintain.map((entry) => lowerFirst(entry.happened).replace(/\.$/, "")).join("; ")}.`)
    cardParts.push(`${indicator.name} de ${indicator.result}${indicator.position ? `, ${indicator.position}` : ""} em ${brief.cycle}.${signal?.concentration ? ` As interações marcadas se concentraram em ${lowerFirst(signal.concentration.motive)}.` : indicator.adjust[0] ? ` Principal ponto: ${lowerFirst(indicator.adjust[0].topic)}.` : ""}`)
  }
  return { paragraphs, card: cardParts.join(" ") }
}

/** Mensagem do SISTEMA (sempre válida): o que o redator não substitui com texto válido. */
export function deterministicPrvNarrative(brief: PrvNarrativeBrief): { paragraphs: string[]; card: string } {
  if (brief.source === "DIRECT_INDICATOR") return deterministicDirectNarrative(brief)
  const paragraphs: string[] = []
  const cardParts: string[] = []
  for (const indicator of brief.indicators) {
    const position = indicator.target && indicator.position ? `, ${indicator.position} de ${indicator.target}` : ""
    paragraphs.push(`No fechamento de ${brief.cycle}, seu ${indicator.name} oficial foi de ${indicator.result}${position}${indicator.quartile ? ` (quartil oficial ${indicator.quartile})` : ""}.`)
    if (indicator.mix) paragraphs.push(`Neste ciclo, as chamadas de ${indicator.mix.motive} passaram a representar uma parte maior dos seus atendimentos (de ${indicator.mix.before} para ${indicator.mix.now})${indicator.mix.longerDuration ? " e tiveram duração média registrada maior que as demais" : ""}.`)
    if (indicator.adjust.length > 0) {
      paragraphs.push(`O ponto que mais se repetiu nas suas chamadas analisadas: ${indicator.adjust.map((entry) => lowerFirst(entry.happened).replace(/\.$/, "")).join("; ")}.`)
      const withRule = indicator.adjust.filter((entry) => entry.documentTitle)
      paragraphs.push(withRule.length > 0
        ? withRule[0]!.howTo ?? `Nas próximas chamadas desse tipo, siga o que o procedimento orienta: “${withRule[0]!.guidance}”`
        : `Nas próximas chamadas desse tipo, vale rever ${lowerFirst(indicator.adjust.map((entry) => entry.topic).join(" e "))} nos detalhes deste feedback.`)
    } else if (indicator.conclusion === "INSUFFICIENT_SAMPLE" || indicator.conclusion === "INSUFFICIENT_OBSERVABILITY" || indicator.conclusion === "NO_ELIGIBLE_POPULATION") {
      paragraphs.push("Neste ciclo, não houve chamadas analisadas suficientes para identificar um ponto que se repetisse.")
    } else if (indicator.maintain.length === 0 && indicator.conclusion !== "NOT_DECOMPOSABLE") {
      paragraphs.push("Nas chamadas analisadas, não apareceu um ponto de processo que se repetisse o suficiente para uma orientação específica neste ciclo.")
    }
    if (indicator.maintain.length > 0) paragraphs.push(`Mantenha o que já funciona: ${indicator.maintain.map((entry) => lowerFirst(entry.happened).replace(/\.$/, "")).join("; ")}.`)
    cardParts.push(`${indicator.name} de ${indicator.result}${indicator.position ? `, ${indicator.position}` : ""} no fechamento de ${brief.cycle}.${indicator.adjust[0] ? ` Principal ponto: ${lowerFirst(indicator.adjust[0].topic)}.` : indicator.maintain[0] ? ` Destaque: ${lowerFirst(indicator.maintain[0].topic)}.` : ""}`)
  }
  return { paragraphs, card: cardParts.join(" ") }
}

export function deterministicSupervisorNotes(diagnosis: PrvClosingDiagnosis): string[] {
  return diagnosis.investigations.flatMap((investigation) => {
    const conclusion = CONCLUSION_LABELS[investigation.conclusion.type]
    const notes = [`${investigation.indicatorName}: ${conclusion.toLowerCase()}.`]
    if (investigation.conclusion.teamOnlyPatterns.length > 0) notes.push("Há comportamento recorrente no Subgrupo que não aparece na população deste colaborador — não é atribuído a ele.")
    if (investigation.conclusion.mixShift) notes.push("A mudança de mix coincidiu com o resultado do fechamento; composição não demonstra causa.")
    if (investigation.signal?.distribution?.concentration && investigation.steps?.selected.includes("SIGNAL_DISTRIBUTION")) notes.push(`As interações marcadas como ${investigation.signal.distribution.signalLabel} se concentraram em ${investigation.signal.distribution.concentration.label}; concentração não demonstra causa.`)
    if (investigation.evidenceGap) notes.push("A estratégia pede os atendimentos anteriores vinculados ao sinal, mas os dados não trazem esse vínculo: nenhum comportamento foi avaliado a partir do sinal.")
    return notes
  })
}

// ---------------------------------------------------------------------------------------------
// VALIDAÇÃO (campo a campo, determinística)
// ---------------------------------------------------------------------------------------------

const SPEED_ADVICE = /(?<!\p{L})(?:fal(?:e|ar|ando)\s+mais\s+r[áa]pido|encerr(?:e|ar|ando)\s+(?:mais\s+cedo|antes|mais\s+r[áa]pido)|reduz(?:a|ir|indo)\s+(?:as\s+|suas\s+)?explica\p{L}*|diminu(?:a|ir)\s+(?:o\s+)?tempo|reduz(?:a|ir)\s+(?:o\s+)?(?:tempo|tma)|seja\s+mais\s+r[áa]pid\p{L}*|agiliz(?:e|ar)|aceler(?:e|ar)|corr(?:a|er)\s+com)(?!\p{L})/iu
const TRAIT_WORDS = /(?<!\p{L})(?:sempre|nunca|costuma|costumam|normalmente|habitualmente|com\s+frequ[êe]ncia|frequentemente|geralmente)(?!\p{L})/iu
const BLAME_WORDS = /(?<!\p{L})(?:erros?|falhas?|falhou|culpa|descuido|neglig[êe]ncia|desaten[çc][ãa]o)(?!\p{L})/iu
const TEAM_WORDS = /(?<!\p{L})(?:equipe|time|grupo|subgrupo|colegas?|pares|outros\s+(?:operadores|colaboradores|atendentes)|demais\s+(?:operadores|colaboradores))(?!\p{L})/iu
/** Termos internos: na mensagem ao COLABORADOR nada de vocabulário de análise; nas notas do SUPERVISOR "amostra"/"triagem"/
 * "classificação" são o vocabulário da própria visão técnica — só códigos e nomes de sistema são proibidos. */
const INTERNAL_TERMS = /(?<!\p{L})(?:checkpoint|etapa|status|classifica[çc][ãa]o|amostra|triagem|practice|behavior|observa[çc](?:ão|ões)\s+de\s+processo)(?!\p{L})/iu
const SUPERVISOR_INTERNAL_TERMS = /(?<!\p{L})(?:checkpoint|status|practice|behavior)(?!\p{L})/iu
const GREETING = /^\s*(?:ol[áa]|oi|bom\s+dia|boa\s+tarde|boa\s+noite)(?!\p{L})/iu
const PLACEHOLDER = /\[[^\]]*\]|<[^>]*>|\.\.\.|…|(?<!\p{L})X\s+(?:dias|horas|minutos|segundos)(?!\p{L})/u
const MIX_CAUSAL = /(?<!\p{L})(?:por\s+causa|porque|devido|caus(?:ou|a|ando|aram)|provoc\p{L}*|explica\p{L}*|respons[áa]ve(?:l|is)|lev(?:ou|aram)\s+a|result(?:ou|aram)\s+em)(?!\p{L})/iu
const NUMBER = /\d+(?:[.,]\d+)*/g

function allowedNumbers(brief: PrvNarrativeBrief): Set<string> {
  const allowed = new Set<string>()
  for (const raw of JSON.stringify(brief).match(NUMBER) ?? []) {
    allowed.add(raw)
    allowed.add(raw.replace(",", "."))
    allowed.add(raw.replace(".", ","))
  }
  return allowed
}

export type PrvTextAudience = "COLLABORATOR" | "SUPERVISOR"
export function prvTextViolations(text: string, brief: PrvNarrativeBrief, audience: PrvTextAudience, context: { firstName: string | null }): string[] {
  const violations = new Set<string>()
  const numbers = allowedNumbers(brief)
  for (const raw of text.match(NUMBER) ?? []) if (!numbers.has(raw)) violations.add("UNSUPPORTED_NUMBER")
  for (const indicator of brief.indicators) {
    if (causalIndicatorClaims(text, { name: indicator.name, code: indicator.code }, indicator.signal ? [indicator.signal.label] : []).length > 0) violations.add("CAUSAL_CLAIM")
    if (strategyProhibitedClaims(text, indicator.prohibitedClaims ?? []).length > 0) violations.add("STRATEGY_PROHIBITED_CLAIM")
    const motives = [indicator.mix?.motive, indicator.motive].filter((entry): entry is string => Boolean(entry))
    for (const sentence of text.split(/(?<=[.!?;])\s+/u)) {
      if (motives.some((motive) => fold(sentence).includes(fold(motive))) && MIX_CAUSAL.test(sentence)) violations.add("CAUSAL_CLAIM")
    }
  }
  if (SPEED_ADVICE.test(text)) violations.add("SPEED_ADVICE")
  if (TRAIT_WORDS.test(text) || detectPermanentTraitLanguage(text).length > 0) violations.add("PATTERN_OR_TRAIT_LANGUAGE")
  if (BLAME_WORDS.test(text)) violations.add("BLAME_LANGUAGE")
  if (audience === "COLLABORATOR" && TEAM_WORDS.test(text)) violations.add("TEAM_REFERENCE")
  if (GREETING.test(text) || (context.firstName && new RegExp(`(?<!\\p{L})${context.firstName}(?!\\p{L})`, "iu").test(text))) violations.add("NAME_OR_GREETING")
  if ((audience === "COLLABORATOR" ? INTERNAL_TERMS : SUPERVISOR_INTERNAL_TERMS).test(text) || INTERNAL_REF_PATTERN.test(text)) violations.add("INTERNAL_TERMS")
  if (PLACEHOLDER.test(text)) violations.add("PLACEHOLDER")
  if (detectUnsupportedEffectClaims(text, []).length > 0) violations.add("GUARANTEED_EFFECT")
  for (const indicator of brief.indicators) {
    if (indicator.position === "fora da meta" && /(?<!\p{L})dentro\s+da\s+meta(?!\p{L})/iu.test(text) && new RegExp(fold(indicator.name), "i").test(fold(text))) violations.add("TARGET_POSITION_MISMATCH")
    if (indicator.position === "dentro da meta" && /(?<!\p{L})fora\s+da\s+meta(?!\p{L})/iu.test(text)) violations.add("TARGET_POSITION_MISMATCH")
  }
  return [...violations]
}

const topicStem = (topic: string) => fold(topic).split(/\s+/).find((word) => word.length >= 5)?.slice(0, 6) ?? fold(topic).slice(0, 6)
/**
 * V1.0.2 — PRECISÃO DO DENOMINADOR: a frase que afirma que um ponto de ajuste NÃO aconteceu precisa dizer o ESCOPO que foi
 * verificado ("nas chamadas analisadas", "em parte", "em 7 de 10"…). Sem escopo ("Nesses atendimentos, o prazo não foi
 * informado") ela generaliza para todas as chamadas do motivo — além do que as observações VERIFIED sustentam. Estrutural (tema do
 * ajuste + afirmação de ausência + nenhum marcador de escopo), nunca um juízo de sentido; o campo cai no texto do sistema.
 */
const DEFICIENCY = /(?<!\p{L})(?:n[ãa]o\s+(?:foi|foram|era|eram|houve|informou|informava|deu|apareceu|aparece)|faltou|faltaram|sem\s+(?:informar|dizer|explicar)|deixou\s+de|ficou\s+sem)(?!\p{L})/iu
const SCOPE_QUALIFIER = /(?<!\p{L})(?:(?:nas|das|em)\s+(?:suas\s+)?(?:chamadas|atendimentos)\s+(?:analisad|avaliad)\p{L}*|em\s+parte|em\s+(?:algumas|v[áa]rias|boa\s+parte|parte\s+relevante|muitas)|de\s+forma\s+recorrente|\d+\s+(?:de|das)\s+\d+)(?!\p{L})/iu
export function unqualifiedGeneralizations(text: string, brief: PrvNarrativeBrief): string[] {
  const stems = brief.indicators.flatMap((indicator) => indicator.adjust.map((entry) => topicStem(entry.topic)))
  return text.split(/(?<=[.!?;])\s+/u).filter((sentence) => DEFICIENCY.test(sentence) && stems.some((stem) => fold(sentence).includes(stem)) && !SCOPE_QUALIFIER.test(sentence))
}
export function prvNarrativeViolations(paragraphs: readonly string[], brief: PrvNarrativeBrief, context: { firstName: string | null }): string[] {
  const text = paragraphs.join("\n")
  const violations = new Set(prvTextViolations(text, brief, "COLLABORATOR", context))
  if (paragraphs.length === 0 || text.trim().length === 0) violations.add("EMPTY")
  for (const indicator of brief.indicators) for (const entry of indicator.adjust) if (!fold(text).includes(topicStem(entry.topic))) violations.add("ADJUSTMENT_OMITTED")
  if (unqualifiedGeneralizations(text, brief).length > 0) violations.add("UNQUALIFIED_GENERALIZATION")
  return [...violations]
}

/** Resolve o rascunho contra os itens que SAEM: só vale para os mesmos itens; cada campo inválido cai no texto do sistema. */
export function resolvePrvNarrative(stored: StoredPrvNarrative | null, items: readonly EmittedItem[], data: PrvClosingArtifactData): ResolvedPrvNarrative {
  const brief = prvNarrativeBriefOf(items, data)
  const system = deterministicPrvNarrative(brief)
  const systemNotes = deterministicSupervisorNotes(data.diagnosis)
  const context = { firstName: data.recipient?.firstName ?? null }
  const draft = stored && stored.itemsKey === brief.itemsKey ? stored.draft : null
  const paragraphViolations = draft ? prvNarrativeViolations(draft.paragraphs, brief, context) : []
  const cardViolations = draft ? prvTextViolations(draft.card, brief, "COLLABORATOR", context).concat(draft.card.trim() ? [] : ["EMPTY"], unqualifiedGeneralizations(draft.card, brief).length > 0 ? ["UNQUALIFIED_GENERALIZATION"] : []) : []
  const notesViolations = draft ? prvTextViolations(draft.supervisorNotes.join("\n"), brief, "SUPERVISOR", context).concat(draft.supervisorNotes.length > 0 ? [] : ["EMPTY"]) : []
  const useParagraphs = Boolean(draft) && paragraphViolations.length === 0
  const useCard = Boolean(draft) && cardViolations.length === 0
  const useNotes = Boolean(draft) && notesViolations.length === 0
  return {
    paragraphs: useParagraphs ? draft!.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean) : system.paragraphs,
    card: useCard ? draft!.card.trim() : system.card,
    supervisorNotes: useNotes ? draft!.supervisorNotes.map((note) => note.trim()).filter(Boolean) : systemNotes,
    source: { paragraphs: useParagraphs ? "WRITER" : "SYSTEM", card: useCard ? "WRITER" : "SYSTEM", supervisorNotes: useNotes ? "WRITER" : "SYSTEM" },
    violations: { paragraphs: paragraphViolations, card: cardViolations, supervisorNotes: notesViolations },
  }
}

// ---------------------------------------------------------------------------------------------
// VISÃO DO COLABORADOR (FeedbackView com o resultado do ciclo)
// ---------------------------------------------------------------------------------------------

function quotesOf(pattern: BehaviorPattern): FeedbackViewQuote[] {
  return pattern.evidenceCandidates.map((candidate) => ({ speaker: "OPERATOR", intro: `Em uma chamada de ${formatDate(candidate.localDate)}, você disse`, text: candidate.text, truncated: candidate.truncated }))
}

export function prvCollaboratorViewOf(items: readonly EmittedItem[], data: PrvClosingArtifactData, narrative: ResolvedPrvNarrative): FeedbackView {
  const contexts = contextsOf(items, data)
  const investigations = data.diagnosis.investigations.filter((investigation) => contexts.some((context) => context.investigation === investigation))
  const developments: FeedbackViewDevelopment[] = contexts.filter((context) => context.item.section === "OPPORTUNITY" && context.pattern).map((context) => {
    const pattern = context.pattern!
    const knowledge = context.item.knowledge
    return {
      key: `${context.investigation.indicatorCode}-${context.item.index}`,
      title: pattern.title,
      whatHappened: behaviorStatement(pattern, segmentOf(context.investigation) ?? "motivo investigado"),
      call: pattern.evidenceCandidates.length > 0 ? { kind: "QUOTES", quotes: quotesOf(pattern) } : { kind: "NONE" },
      adjustment: [],
      guidance: { rules: knowledge ? [{ text: knowledge.quote, section: knowledge.heading?.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").trim() ?? null }] : [], avoid: [], examples: [] },
      sources: knowledge ? [{ documentId: knowledge.documentId, documentTitle: knowledge.documentTitle, section: knowledge.heading?.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").trim() ?? null, href: knowledge.href }] : [],
      whyItMatters: [],
      howToApply: context.item.wording.whatYouCanDo.trim() || null,
      suggestedResponse: null,
      itemIndexes: [context.item.index],
    }
  })
  const strengths = contexts.filter((context) => context.item.section === "STRENGTH" && context.pattern)
  const materials = new Map<string, FeedbackViewMaterial>()
  for (const context of contexts) {
    const knowledge = context.item.knowledge
    if (!knowledge) continue
    const entry = materials.get(knowledge.documentId) ?? { documentId: knowledge.documentId, title: knowledge.documentTitle, href: knowledge.href, usedIn: [], sections: [] }
    if (context.pattern && !entry.usedIn.includes(context.pattern.title)) entry.usedIn.push(context.pattern.title)
    const section = knowledge.heading?.replace(/^\s*\d+(?:\.\d+)*\.?\s+/, "").trim()
    if (section && !entry.sections!.includes(section)) entry.sections!.push(section)
    materials.set(knowledge.documentId, entry)
  }
  const direct = data.diagnosis.source?.kind === "DIRECT_INDICATOR"
  const directSignalNotes = (investigation: IndicatorInvestigation) => {
    const signal = briefSignalOf(investigation)
    if (!signal) return []
    return [
      ...(signal.status !== "NOT_SELECTED" ? [`${signal.signaled} de ${signal.interactions} interações atendidas vieram marcadas como ${signal.label}${signal.rate ? ` (${signal.rate})` : ""}.`] : []),
      ...(signal.concentration ? [`${signal.concentration.motive}: ${signal.concentration.signaled} das ${signal.signaled} interações marcadas; ${signal.concentration.motiveRate} dos atendimentos desse motivo, contra ${signal.concentration.othersRate} nos demais.`] : []),
      ...(signal.previous ? [`Período anterior (${signal.previous.period}): ${signal.previous.signaled} de ${signal.previous.interactions} interações marcadas${signal.previous.rate ? ` (${signal.previous.rate})` : ""}.`] : []),
      ...(signal.shift ? [`${signal.shift.motive} passou de ${signal.shift.before} para ${signal.shift.now} das interações marcadas.`] : []),
    ]
  }
  return {
    version: FEEDBACK_VIEW_VERSION,
    kind: "INDICATOR",
    // Cabeçalho do item no Acompanhamento: o(s) indicador(es) investigado(s) e o fechamento (nunca "Feedback de…"). V2 — diagnóstico
    // direto: o indicador e o PERÍODO (nunca "Fechamento do PRV").
    heading: { title: investigations.map((investigation) => investigation.indicatorName).join(", ") || "Indicadores", subtitle: direct ? data.diagnosis.referencePeriodLabel.replace(/^./u, (letter) => letter.toLocaleUpperCase("pt-BR")) : `Fechamento de ${data.diagnosis.referencePeriodLabel}` },
    sectionLabels: direct
      ? { developments: "O que trabalhar", call: "Exemplos das chamadas", maintain: "O que manter", detailsHint: "O resultado do período, onde o indicador aparece nas suas interações e o que a análise não pode concluir." }
      : { developments: "O que trabalhar no próximo ciclo", call: "Exemplos das chamadas", maintain: "O que manter", detailsHint: "O resultado do ciclo, o padrão encontrado, exemplos das chamadas e o que o processo orienta." },
    card: narrative.card,
    greeting: data.recipient?.firstName ? `Olá, ${data.recipient.firstName}!` : "Olá!",
    narrative: narrative.paragraphs,
    cycle: direct ? {
      title: `Resultado do período · ${data.diagnosis.referencePeriodLabel}`,
      indicators: investigations.map((investigation) => ({ name: investigation.indicatorName, lines: directOfficialFactEntries(investigation), notes: directSignalNotes(investigation) })),
    } : {
      title: `Resultado do ciclo · ${data.diagnosis.referencePeriodLabel}`,
      indicators: investigations.map((investigation) => ({
        name: investigation.indicatorName,
        lines: officialFactTexts(investigation).map((text) => {
          const [label, ...rest] = text.split(": ")
          return { label: label!.replace(`${investigation.indicatorName} oficial no fechamento de ${referencePeriodLabel(investigation.official.referencePeriod)}`, "Resultado oficial"), value: rest.join(": ") }
        }),
        notes: [
          ...(investigation.conclusion.mixShift && investigation.mix?.shifted ? [`As chamadas de ${investigation.mix.shifted.label} passaram de ${formatPercent(investigation.mix.shifted.previousSharePercent)} para ${formatPercent(investigation.mix.shifted.currentSharePercent)} dos seus atendimentos${investigation.mix.shifted.longerDuration && investigation.mix.shifted.segmentAverageDurationSeconds !== null && investigation.mix.shifted.othersAverageDurationSeconds !== null ? `, com duração média registrada de ${investigation.mix.shifted.segmentAverageDurationSeconds} s (as demais: ${investigation.mix.shifted.othersAverageDurationSeconds} s)` : ""}.`] : []),
          ...(investigation.sample.analyzedCount > 0 && investigation.population.selectedSegment ? [`Foram analisadas ${investigation.sample.analyzedCount} das suas chamadas de ${investigation.population.selectedSegment.label} deste fechamento.`] : []),
        ],
      })),
    },
    developments,
    maintain: strengths.length > 0 ? { summary: strengths.map((context) => behaviorStatement(context.pattern!, segmentOf(context.investigation) ?? "motivo investigado")).join(" "), evidence: strengths.map((context) => ({ title: context.pattern!.title, statement: behaviorStatement(context.pattern!, segmentOf(context.investigation) ?? "motivo investigado"), quotes: quotesOf(context.pattern!), itemIndex: context.item.index })) } : null,
    attention: [],
    materials: [...materials.values()],
    context: null,
  }
}

// ---------------------------------------------------------------------------------------------
// VISÃO DO SUPERVISOR (técnica; só para quem lidera — nunca na leitura do próprio colaborador)
// ---------------------------------------------------------------------------------------------

const ATTRIBUTION_LABELS = { INDIVIDUAL: "do colaborador", INDIVIDUAL_AND_TEAM: "do colaborador e do Subgrupo", TEAM_ONLY: "só do Subgrupo — não atribuído ao colaborador", NONE: "sem padrão" } as const
const CLASSIFICATION_LABELS = { DEVELOPMENT: "a desenvolver", STRENGTH: "consistente", INCONCLUSIVE: "inconclusivo" } as const

/** V2 — passos escolhidos (estratégia × IA × disponibilidade) e população sinalizada, prontos para a tela (sem id). */
export type SupervisorSteps = { mode: string; planner: string; selected: { label: string; purpose: string | null }[]; notSelected: string[]; unavailable: { label: string; reason: string }[]; rejected: { step: string; reason: string }[] }
export type SupervisorSignal = {
  label: string
  status: string
  interactions: number
  signaled: number
  signalRatePercent: number | null
  concentration: string | null
  reasons: { label: string; interactions: number; signaled: number; signalRatePercent: number | null; shareOfSignalPercent: number | null }[]
  evolution: { status: string; previous: { interactions: number; signaled: number; signalRatePercent: number | null }; shifted: string | null } | null
}

export type PrvSupervisorView = {
  version: typeof PRV_SUPERVISOR_VIEW_VERSION
  /** V2 — origem do diagnóstico (ausente = fechamento do PRV). */
  source?: { kind: "PRV_CLOSING" | "DIRECT_INDICATOR"; label: string }
  cycle: string
  prv: { achievementPercent: number; quartile: string; previous: { achievementPercent: number; quartile: string } | null } | null
  interpretation: string[]
  triage: { indicator: string; decision: string; reasons: string[] }[]
  indicators: {
    name: string
    conclusion: string
    official: string[]
    population: { interactionsInPeriod: number; selectedSegment: string | null; selectionReason: string | null; segments: { label: string; interactions: number; sharePercent: number; averageDurationSeconds: number | null }[] }
    sample: { eligible: number; analyzed: number; reused: number; reanalyzed: number; newObservations: number; reusedObservations: number; selectionReason: string }
    /** V1.0.1 — cobertura da avaliação (primeira resposta × revisão única por chamada). null = diagnóstico anterior ou sem chamadas avaliadas. */
    coverage: {
      status: string
      interactionCount: number
      mustAssessPlanned: number
      missingInitial: number
      inconsistentInitial: number
      repairInteractions: number
      repairTargets: number
      missingAfterRepair: number
      inconsistentAfterRepair: number
      budgetSkipped: number
      interactions: { planned: number; returned: number; missingInitial: number; inconsistentInitial: number; repaired: boolean; accepted: number; missingAfter: number; inconsistentAfter: number; status: string }[]
    } | null
    mix: { status: string; statement: string | null; rows: { label: string; previousSharePercent: number | null; currentSharePercent: number; averageDurationSeconds: number | null }[] } | null
    patterns: { title: string; classification: string; attribution: string; eligible: number; followed: number; notFollowed: number; partial: number; notObservable: number; notApplicable: number; ineligible: number; notFollowedRatePercent: number | null; concentration: string | null; byWeekday: { label: string; eligible: number; notFollowed: number }[] }[]
    team: { status: string; contributors: number; behaviors: { title: string; classification: string; notFollowed: number; eligible: number }[] }
    processes: { documentTitle: string; eligible: number; notFollowed: number }[]
    evidence: { title: string; date: string; text: string }[]
    findings: string[]
    unsupportedHypotheses: string[]
    limitations: string[]
    /** V2 — versão da estratégia que conduziu, passos e população sinalizada (ausentes em diagnósticos anteriores). */
    strategy?: { versionId: string | null; version: number | null }
    steps?: SupervisorSteps | null
    signal?: SupervisorSignal | null
    evidenceGap?: string | null
  }[]
}

const PLANNER_LABELS = { NOT_APPLICABLE: "passos fixos da estratégia (sem IA)", SKIPPED_NO_CHOICE: "sem escolha real (um passo ou nenhum)", SELECTED: "escolhidos pela IA a partir da estratégia", FALLBACK_DEFAULT: "resposta da IA fora do contrato — todos os passos permitidos e disponíveis" } as const
const REJECTED_LABELS = { UNKNOWN_STEP: "passo inexistente", NOT_ALLOWED: "fora da estratégia", UNAVAILABLE: "indisponível nos dados", DUPLICATE: "repetido" } as const
function supervisorStepsOf(investigation: IndicatorInvestigation): SupervisorSteps | null {
  const steps = investigation.steps
  if (!steps) return null
  return {
    mode: steps.mode === "FIXED" ? "Fixo (chaves da estratégia)" : "Orientado pela IA",
    planner: PLANNER_LABELS[steps.planner.status],
    selected: steps.selected.map((step) => ({ label: INVESTIGATION_STEP_CATALOG[step].label, purpose: steps.purposes.find((entry) => entry.step === step)?.purpose ?? null })),
    notSelected: steps.notSelected.map((step) => INVESTIGATION_STEP_CATALOG[step].label),
    unavailable: steps.availability.filter((entry) => !entry.available && entry.reason !== "NOT_CONFIGURED").map((entry) => ({ label: INVESTIGATION_STEP_CATALOG[entry.step].label, reason: STEP_UNAVAILABLE_LABELS[entry.reason!] })),
    rejected: steps.rejected.map((entry) => ({ step: entry.step, reason: REJECTED_LABELS[entry.reason] })),
  }
}
function supervisorSignalOf(investigation: IndicatorInvestigation): SupervisorSignal | null {
  const signal = investigation.signal
  const distribution = signal?.distribution
  if (!signal || !distribution) return null
  const evolution = signal.evolution
  return {
    label: distribution.signalLabel,
    status: { CONCENTRATED: "concentrado em um motivo", SPREAD: "distribuído entre motivos", INSUFFICIENT_DATA: "poucas interações marcadas para falar de distribuição", NO_SIGNAL: "nenhuma interação marcada" }[distribution.status],
    interactions: distribution.interactions,
    signaled: distribution.signaled,
    signalRatePercent: distribution.signalRatePercent,
    concentration: distribution.concentration ? `${distribution.concentration.label}: ${distribution.concentration.signaled} de ${distribution.signaled} marcadas (${formatPercent(distribution.concentration.shareOfSignalPercent)}); ${formatPercent(distribution.concentration.signalRatePercent)} dos atendimentos do motivo × ${formatPercent(distribution.concentration.othersSignalRatePercent)} nos demais` : null,
    reasons: distribution.reasons.slice(0, 10).map((reason) => ({ label: reason.label, interactions: reason.interactions, signaled: reason.signaled, signalRatePercent: reason.signalRatePercent, shareOfSignalPercent: reason.shareOfSignalPercent })),
    evolution: evolution ? { status: evolution.status === "AVAILABLE" ? "comparável" : "dados insuficientes no período anterior", previous: evolution.previous, shifted: evolution.shifted ? `${evolution.shifted.label}: ${formatPercent(evolution.shifted.previousSharePercent)} → ${formatPercent(evolution.shifted.currentSharePercent)} das interações marcadas` : null } : null,
  }
}

const TEAM_STATUS_LABELS = { AVAILABLE: "disponível", INSUFFICIENT_POPULATION: "população insuficiente para agregado", NOT_AVAILABLE: "sem observações do Subgrupo no período" } as const

const COVERAGE_STATUS_LABELS = { COMPLETE: "completa", PARTIAL: "parcial" } as const
function coverageViewOf(investigation: PrvClosingArtifactData["diagnosis"]["investigations"][number]): PrvSupervisorView["indicators"][number]["coverage"] {
  const coverage = investigation.coverage ?? null
  if (!coverage) return null
  return {
    status: COVERAGE_STATUS_LABELS[coverage.status],
    interactionCount: coverage.interactionCount,
    mustAssessPlanned: coverage.mustAssessPlanned,
    missingInitial: coverage.missingInitial,
    inconsistentInitial: coverage.inconsistentInitial,
    repairInteractions: coverage.repairInteractions,
    repairTargets: coverage.repairTargets,
    missingAfterRepair: coverage.missingAfterRepair,
    inconsistentAfterRepair: coverage.inconsistentAfterRepair,
    budgetSkipped: coverage.repairBudget.skipped,
    // Por chamada, na ordem da amostra e sem identificador (as chamadas não são nomeadas na visão de gestão).
    interactions: coverage.interactions.map((entry) => ({ planned: entry.plannedMustAssess.length, returned: entry.returnedMustAssess.length, missingInitial: entry.missingAfterInitial.length, inconsistentInitial: entry.inconsistentAfterInitial.length, repaired: entry.repairTriggered, accepted: entry.repairAccepted.length, missingAfter: entry.missingAfterRepair.length, inconsistentAfter: entry.inconsistentAfterRepair.length, status: COVERAGE_STATUS_LABELS[entry.status] })),
  }
}

export function prvSupervisorViewOf(data: PrvClosingArtifactData, narrative: ResolvedPrvNarrative): PrvSupervisorView {
  const diagnosis = data.diagnosis
  const direct = diagnosis.source?.kind === "DIRECT_INDICATOR"
  return {
    version: PRV_SUPERVISOR_VIEW_VERSION,
    ...(diagnosis.source ? { source: { kind: diagnosis.source.kind, label: direct ? "Diagnóstico direto do indicador (sem PRV)" : "Fechamento do PRV" } } : {}),
    cycle: diagnosis.referencePeriodLabel,
    prv: diagnosis.prv ? { achievementPercent: diagnosis.prv.achievementPercent, quartile: diagnosis.prv.quartile, previous: diagnosis.previousPrv ? { achievementPercent: diagnosis.previousPrv.achievementPercent, quartile: diagnosis.previousPrv.quartile } : null } : null,
    interpretation: narrative.supervisorNotes,
    triage: diagnosis.triage.decisions.map((decision) => ({ indicator: decision.indicatorName, decision: decision.decision === "INVESTIGATE" ? "investigado (desenvolvimento)" : decision.decision === "RECOGNIZE" ? "investigado (reconhecimento)" : "não investigado", reasons: decision.reasons.map((reason) => TRIAGE_REASON_LABELS[reason]) })),
    indicators: diagnosis.investigations.map((investigation) => {
      const behaviors = investigation.patterns?.behaviors ?? []
      return {
        name: investigation.indicatorName,
        conclusion: CONCLUSION_LABELS[investigation.conclusion.type],
        official: officialFactTexts(investigation, direct),
        population: {
          interactionsInPeriod: investigation.population.interactionsInPeriod,
          selectedSegment: investigation.population.selectedSegment?.label ?? null,
          selectionReason: investigation.population.selectedSegment?.reason ?? null,
          segments: investigation.population.segments.slice(0, 8).map((segment) => ({ label: segment.label, interactions: segment.interactions, sharePercent: segment.sharePercent, averageDurationSeconds: segment.averageDurationSeconds })),
        },
        sample: { eligible: investigation.sample.eligibleCount, analyzed: investigation.sample.analyzedCount, reused: investigation.sample.analyzedCount - investigation.sample.reanalyzedInteractionCount, reanalyzed: investigation.sample.reanalyzedInteractionCount, newObservations: investigation.sample.newObservationCount, reusedObservations: investigation.sample.reusedObservationCount, selectionReason: investigation.sample.selectionReason },
        coverage: coverageViewOf(investigation),
        mix: investigation.mix ? { status: investigation.mix.status, statement: investigation.conclusion.mixShift ? investigation.supportedFindings[0] ?? null : null, rows: investigation.mix.segments.slice(0, 8).map((segment) => ({ label: segment.label, previousSharePercent: segment.previous?.sharePercent ?? null, currentSharePercent: segment.current.sharePercent, averageDurationSeconds: segment.current.averageDurationSeconds })) } : null,
        patterns: behaviors.map((pattern) => {
          const attribution = investigation.attribution.find((entry) => entry.practiceKey === pattern.practiceKey)?.attribution ?? "NONE"
          return { title: pattern.title, classification: CLASSIFICATION_LABELS[pattern.classification], attribution: ATTRIBUTION_LABELS[attribution], eligible: pattern.eligible, followed: pattern.counts.followed, notFollowed: pattern.counts.notFollowed, partial: pattern.counts.partial, notObservable: pattern.counts.notObservable, notApplicable: pattern.counts.notApplicable, ineligible: pattern.counts.ineligible, notFollowedRatePercent: pattern.notFollowedRatePercent, concentration: concentrationText(pattern), byWeekday: pattern.byWeekday.map((bucket) => ({ label: bucket.label, eligible: bucket.eligible, notFollowed: bucket.notFollowed })) }
        }),
        team: { status: TEAM_STATUS_LABELS[investigation.team.status], contributors: investigation.team.contributors, behaviors: investigation.team.behaviors.map((behavior) => ({ title: behavior.title, classification: CLASSIFICATION_LABELS[behavior.classification], notFollowed: behavior.notFollowed, eligible: behavior.eligible })) },
        processes: investigation.patterns?.processDistribution.map((process) => ({ documentTitle: process.documentTitle, eligible: process.eligible, notFollowed: process.notFollowed })) ?? [],
        evidence: behaviors.filter((pattern) => pattern.classification !== "INCONCLUSIVE").flatMap((pattern) => pattern.evidenceCandidates.map((candidate) => ({ title: pattern.title, date: formatDate(candidate.localDate), text: candidate.text }))),
        findings: investigation.supportedFindings,
        unsupportedHypotheses: investigation.unsupportedHypotheses,
        limitations: investigation.limitations,
        ...(investigation.steps || investigation.signal ? { strategy: investigation.strategy, steps: supervisorStepsOf(investigation), signal: supervisorSignalOf(investigation), evidenceGap: investigation.evidenceGap ? STEP_UNAVAILABLE_LABELS[investigation.evidenceGap.reason] : null } : {}),
      }
    }),
  }
}

/** Texto em Markdown do feedback (nó do Workflow, campo `recommendation`, chat): derivado da MESMA visão do colaborador. */
export function renderPrvFeedbackText(view: FeedbackView, limitations: readonly string[]): string {
  const lines: string[] = []
  if (view.greeting) lines.push(view.greeting, "")
  lines.push(...view.narrative.flatMap((paragraph) => [paragraph, ""]))
  if (view.cycle) {
    lines.push(`## ${view.cycle.title}`)
    for (const indicator of view.cycle.indicators) {
      lines.push(...indicator.lines.map((line) => `- ${line.label}: ${line.value}`), ...indicator.notes.map((note) => `- ${note}`))
    }
    lines.push("")
  }
  if (view.developments.length > 0) {
    lines.push(`## ${view.sectionLabels?.developments ?? "O que trabalhar"}`)
    for (const development of view.developments) {
      lines.push(`### ${development.title}`, development.whatHappened)
      if (development.call.kind === "QUOTES") lines.push(...development.call.quotes.map((quote) => `> ${quote.intro}: “${quote.text}${quote.truncated ? "…" : ""}”`))
      for (const rule of development.guidance.rules) lines.push(`**O processo orienta:** “${rule.text}”${development.sources[0] ? ` — ${development.sources[0].documentTitle}` : ""}`)
      if (development.howToApply) lines.push(`**Como aplicar:** ${development.howToApply}`)
      lines.push("")
    }
  }
  if (view.maintain) lines.push(`## ${view.sectionLabels?.maintain ?? "O que manter"}`, view.maintain.summary, "")
  if (limitations.length > 0) lines.push("**Limitações da análise:**", ...limitations.map((limitation) => `- ${limitation}`))
  return lines.join("\n").trim()
}
