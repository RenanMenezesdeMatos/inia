/**
 * AVALIAÇÃO POR DIMENSÃO (módulo puro, usado por `score-battery.ts` e pelo ensaio focal). Nunca junta tudo num "mensagem
 * correta": status e tom certos NÃO comprovam diagnóstico nem utilidade. Cada dimensão declara COMO foi medida:
 *   STRUCTURAL        — comparação determinística com o gabarito (procedimento, caminho, critérios identificados pelo trecho
 *                       literal da regra, decisão de publicar/abster, tom);
 *   AUXILIARY_LEXICAL — sinal de palavras (consequência, repetição, frase genérica, relação com a regra esperada). Serve para
 *                       APONTAR o que inspecionar; nunca prova diagnóstico nem utilidade;
 *   HUMAN             — não automatizável aqui (a orientação é aplicável e sustentada? o texto ajuda?) — fica NEEDS_INSPECTION
 *                       com o material para a leitura humana.
 * Caso usado para AJUSTAR a implementação vira REGRESSÃO: aparece à parte e não entra em totais "independentes".
 */
export type Criterion = { text: string; heading: string | null; status: string; evidenceKind?: string | null; evidence: string[]; ruleConflict?: boolean }
export type MessageSentence = { text: string; stance: string; source?: string; basis?: string | null }
export type CaseResult = {
  id: string
  error: string | null
  analysis: { outcome: string; procedure: string | null; pathAssessment: string; criteria: Criterion[] } | null
  message: {
    kind: string
    reason: string | null
    tone: string | null
    card: string | null
    paragraphs: string[]
    sentences?: MessageSentence[]
    developments?: string[]
    developmentRules?: string[][]
    strengths?: string[]
    strengthRules?: string[][]
    composition?: { analysis?: { id: string; accepted: boolean; verdict: string | null }[]; leaksRemoved?: unknown[] } | null
  } | null
}
export type Truth = {
  scenario: string
  procedure: string
  path: string[]
  outcome?: string[]
  mustDeviate: string[][]
  mustNotAccuse: string[]
  mustNotCreditQuote: string[]
  message: { outcome: string[]; tone: string[]; mustMentionAny: string[] }
  /** Termos da regra que a orientação deveria refletir (AUXILIAR — relação lexical, nunca prova de orientação correta). */
  expectedGuidance?: string[][]
  usedForCalibration?: boolean
  calibrationNote?: string
  /** Caso só de ANÁLISE (sem mensagem planejada): as dimensões da mensagem não se aplicam. */
  analysisOnly?: boolean
}
export type Status = "PASS" | "FAIL" | "NOT_APPLICABLE" | "NEEDS_INSPECTION"
export type Method = "STRUCTURAL" | "AUXILIARY_LEXICAL" | "HUMAN"
export type Check = { status: Status; method: Method; detail: string }
export type CaseScore = {
  id: string
  independent: boolean
  calibrationNote: string | null
  error: string | null
  dimensions: {
    procedure: Check
    expectedDeviationsFound: Check & { expected: number; found: number }
    materialDeviationsMissed: Check & { missed: string[] }
    unsupportedAccusations: Check & { items: string[] }
    undueRecognitions: Check & { items: string[] }
    guidance: Check & { signals: string[] }
    addedConsequences: Check & { flagged: string[] }
    redundancyAndUtility: Check & { sentences: number; nearDuplicates: string[] }
    decision: Check
    toneAndForm: Check & { generic: string[] }
  }
}

const lower = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("pt-BR")
const deviation = (criterion: Criterion) => (criterion.status === "NOT_MET" || criterion.status === "PARTIAL") && !criterion.ruleConflict
const matches = (text: string, group: readonly string[]) => group.some((term) => lower(text).includes(lower(term)))
const terms = (text: string) => new Set((lower(text).match(/\p{L}{4,}/gu) ?? []).filter((word) => !["para", "como", "quando", "antes", "depois", "voce", "cliente", "chamada", "etapa", "essa", "esse", "isso", "mais", "sobre"].includes(word)))
const jaccard = (a: Set<string>, b: Set<string>) => {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const term of a) if (b.has(term)) shared += 1
  return shared / (a.size + b.size - shared)
}

/** Consequência/certeza acrescentada — sinal AUXILIAR (apontar para inspeção), nunca veredito. */
const CONSEQUENCE = /\b(garant\p{L}*|assegur\p{L}*|evit[ae]\p{L}*|impede\p{L}*|imped\p{L}*|previne\p{L}*|gera\b|resulta\p{L}*|sempre|nunca mais|todas as etapas|efetividade|satisfa\p{L}*|fideliza\p{L}*)\b/iu

export function scoreCase(result: CaseResult, truth: Truth, forbiddenPhrases: readonly string[]): CaseScore {
  const independent = !truth.usedForCalibration
  const na = (method: Method, detail: string): Check => ({ status: "NOT_APPLICABLE", method, detail })
  if (result.error || !result.analysis) {
    const failed: Check = { status: "FAIL", method: "STRUCTURAL", detail: result.error ?? "sem análise" }
    return { id: result.id, independent, calibrationNote: truth.calibrationNote ?? null, error: result.error ?? "sem análise", dimensions: { procedure: failed, expectedDeviationsFound: { ...failed, expected: truth.mustDeviate.length, found: 0 }, materialDeviationsMissed: { ...failed, missed: truth.mustDeviate.map((group) => group[0]!) }, unsupportedAccusations: { ...na("STRUCTURAL", "sem análise"), items: [] }, undueRecognitions: { ...na("STRUCTURAL", "sem análise"), items: [] }, guidance: { ...na("HUMAN", "sem análise"), signals: [] }, addedConsequences: { ...na("AUXILIARY_LEXICAL", "sem análise"), flagged: [] }, redundancyAndUtility: { ...na("AUXILIARY_LEXICAL", "sem análise"), sentences: 0, nearDuplicates: [] }, decision: failed, toneAndForm: { ...failed, generic: [] } } }
  }
  const analysis = result.analysis
  const criterionText = (criterion: Criterion) => `${criterion.heading ?? ""} ${criterion.text}`

  // 1. Procedimento e cenário (estrutural).
  const procedureOk = lower(analysis.procedure ?? "").includes(lower(truth.procedure))
  const pathOk = truth.path.includes(analysis.pathAssessment)
  const procedure: Check = { status: procedureOk && pathOk ? "PASS" : "FAIL", method: "STRUCTURAL", detail: `procedimento ${procedureOk ? "certo" : `errado (${analysis.procedure ?? "nenhum"})`} · caminho ${analysis.pathAssessment}${pathOk ? "" : ` (esperado ${truth.path.join("/")})`}` }

  // 2–3. Desvios esperados × não encontrados (critério identificado pelo trecho literal da regra no gabarito).
  const found = truth.mustDeviate.map((group) => analysis.criteria.some((criterion) => deviation(criterion) && matches(criterionText(criterion), group)))
  const missed = truth.mustDeviate.filter((_, index) => !found[index]).map((group) => group[0]!)
  const expectedDeviationsFound = { status: (truth.mustDeviate.length === 0 ? "NOT_APPLICABLE" : missed.length === 0 ? "PASS" : "FAIL") as Status, method: "STRUCTURAL" as const, detail: `${found.filter(Boolean).length}/${found.length} (critério identificado pelo trecho da regra, não pela palavra do texto)`, expected: found.length, found: found.filter(Boolean).length }
  const materialDeviationsMissed = { status: (truth.mustDeviate.length === 0 ? "NOT_APPLICABLE" : missed.length === 0 ? "PASS" : "FAIL") as Status, method: "STRUCTURAL" as const, detail: missed.length === 0 ? "nenhum" : missed.join("; "), missed }

  // 4. Acusação sem suporte: desvio num critério que o gabarito diz que foi cumprido/não se aplicava.
  const accusations = analysis.criteria.filter((criterion) => deviation(criterion) && truth.mustNotAccuse.some((term) => lower(criterion.text).includes(lower(term)))).map((criterion) => criterion.text.slice(0, 100))
  const unexpected = analysis.criteria.filter((criterion) => deviation(criterion) && !truth.mustDeviate.some((group) => matches(criterionText(criterion), group)) && !truth.mustNotAccuse.some((term) => lower(criterion.text).includes(lower(term)))).map((criterion) => criterion.text.slice(0, 80))
  const unsupportedAccusations = { status: (accusations.length > 0 ? "FAIL" : unexpected.length > 0 ? "NEEDS_INSPECTION" : "PASS") as Status, method: "STRUCTURAL" as const, detail: accusations.length > 0 ? `${accusations.length} acusação(ões) contra o gabarito` : unexpected.length > 0 ? `${unexpected.length} desvio(s) fora do gabarito — ler antes de chamar de acerto ou erro` : "nenhuma", items: [...accusations, ...unexpected.map((text) => `(fora do gabarito) ${text}`)] }

  // 5. Reconhecimento indevido: fala do cliente/intenção creditada, ou ponto forte num desvio esperado.
  const credited = analysis.criteria.filter((criterion) => criterion.status === "MET" && criterion.evidence.some((quote) => truth.mustNotCreditQuote.some((fragment) => quote.includes(fragment)))).map((criterion) => criterion.text.slice(0, 80))
  const strengthRules = (result.message?.strengthRules ?? []).flat()
  const praisedDeviation = truth.mustDeviate.filter((group) => strengthRules.some((rule) => matches(rule, group))).map((group) => group[0]!)
  const undueRecognitions = { status: (credited.length + praisedDeviation.length > 0 ? "FAIL" : "PASS") as Status, method: "STRUCTURAL" as const, detail: `${credited.length} crédito(s) por fala do cliente/intenção · ${praisedDeviation.length} reconhecimento(s) de etapa que deveria ser desvio`, items: [...credited, ...praisedDeviation] }

  const publishable = result.message?.kind === "PUBLISHABLE"
  const sentences: MessageSentence[] = result.message?.sentences ?? (result.message?.paragraphs ?? []).flatMap((paragraph) => paragraph.split(/(?<=[.!?])\s+/).map((text) => ({ text, stance: "UNKNOWN" })))
  const text = result.message ? [result.message.card ?? "", ...result.message.paragraphs].join(" ") : ""

  // 6. Orientação aplicável e sustentada — HUMANA (sinais estruturais e auxiliares só apontam o que ler).
  const guidanceSentences = sentences.filter((sentence) => sentence.stance === "GUIDANCE" || sentence.stance === "ADJUSTMENT")
  const signals: string[] = []
  if (publishable && truth.mustDeviate.length > 0 && guidanceSentences.length === 0 && result.message?.sentences) signals.push("nenhuma frase de ajuste/orientação")
  const unverifiedAnalysis = (result.message?.composition?.analysis ?? []).filter((entry) => !entry.accepted).map((entry) => `${entry.id} ${entry.verdict ?? "não conferida"}`)
  if (unverifiedAnalysis.length > 0) signals.push(`leitura da análise recusada/não conferida (não usada): ${unverifiedAnalysis.join(", ")}`)
  if (truth.expectedGuidance && publishable) {
    const related = truth.expectedGuidance.map((group) => guidanceSentences.some((sentence) => matches(sentence.text, group)) || matches(text, group))
    if (related.some((ok) => !ok)) signals.push(`auxiliar: sem relação lexical aparente com ${truth.expectedGuidance.filter((_, index) => !related[index]).map((group) => group[0]).join(", ")}`)
  }
  const guidance = { status: (!publishable ? "NOT_APPLICABLE" : "NEEDS_INSPECTION") as Status, method: "HUMAN" as const, detail: !publishable ? "sem mensagem" : "a aplicabilidade e o fundamento da orientação exigem leitura contra a regra (sinais abaixo só apontam o que ler)", signals }

  // 7. Consequências e certezas acrescentadas — AUXILIAR.
  const flagged = publishable ? [result.message?.card ?? "", ...sentences.map((sentence) => sentence.text)].filter((sentence) => CONSEQUENCE.test(sentence)) : []
  const addedConsequences = { status: (!publishable ? "NOT_APPLICABLE" : flagged.length > 0 ? "NEEDS_INSPECTION" : "PASS") as Status, method: "AUXILIARY_LEXICAL" as const, detail: flagged.length > 0 ? `${flagged.length} frase(s) com marca de consequência/certeza — conferir contra a regra` : "nenhuma marca léxica (não prova ausência)", flagged }

  // 8. Redundância e utilidade — AUXILIAR (repetição por sobreposição de termos; tamanho).
  const nearDuplicates: string[] = []
  for (let i = 0; i < sentences.length; i++) for (let j = i + 1; j < sentences.length; j++) if (jaccard(terms(sentences[i]!.text), terms(sentences[j]!.text)) >= 0.6) nearDuplicates.push(`"${sentences[i]!.text.slice(0, 60)}" ≈ "${sentences[j]!.text.slice(0, 60)}"`)
  const redundancyAndUtility = { status: (!publishable ? "NOT_APPLICABLE" : nearDuplicates.length > 0 ? "NEEDS_INSPECTION" : "PASS") as Status, method: "AUXILIARY_LEXICAL" as const, detail: `${sentences.length} frase(s)${nearDuplicates.length > 0 ? ` · ${nearDuplicates.length} par(es) quase repetido(s)` : ""} — utilidade real exige leitura`, sentences: sentences.length, nearDuplicates }

  // 9. Decisão de publicar/limitar/abster (estrutural).
  const decisionOk = Boolean(result.message) && truth.message.outcome.includes(result.message!.kind)
  const decision: Check = { status: decisionOk ? "PASS" : "FAIL", method: "STRUCTURAL", detail: `${result.message?.kind ?? "—"}${result.message?.reason ? ` (${result.message.reason})` : ""}${decisionOk ? "" : ` · esperado ${truth.message.outcome.join("/")}`}` }

  // 10. Tom e forma (tom estrutural; frase genérica auxiliar).
  const generic = forbiddenPhrases.filter((phrase) => lower(text).includes(lower(phrase)))
  const toneOk = !publishable || truth.message.tone.includes(result.message?.tone ?? "")
  const toneAndForm = { status: (!publishable ? "NOT_APPLICABLE" : !toneOk ? "FAIL" : generic.length > 0 ? "NEEDS_INSPECTION" : "PASS") as Status, method: "STRUCTURAL" as const, detail: `tom ${result.message?.tone ?? "—"}${toneOk ? "" : ` (esperado ${truth.message.tone.join("/")})`}${generic.length > 0 ? ` · genérico: ${generic.join(", ")}` : ""}`, generic }

  if (truth.analysisOnly) {
    const skip = (method: Method) => ({ status: "NOT_APPLICABLE" as const, method, detail: "caso só de análise (sem mensagem planejada)" })
    return { id: result.id, independent, calibrationNote: truth.calibrationNote ?? null, error: null, dimensions: { procedure, expectedDeviationsFound, materialDeviationsMissed, unsupportedAccusations, undueRecognitions, guidance: { ...skip("HUMAN"), signals: [] }, addedConsequences: { ...skip("AUXILIARY_LEXICAL"), flagged: [] }, redundancyAndUtility: { ...skip("AUXILIARY_LEXICAL"), sentences: 0, nearDuplicates: [] }, decision: skip("STRUCTURAL"), toneAndForm: { ...skip("STRUCTURAL"), generic: [] } } }
  }
  return { id: result.id, independent, calibrationNote: truth.calibrationNote ?? null, error: null, dimensions: { procedure, expectedDeviationsFound, materialDeviationsMissed, unsupportedAccusations, undueRecognitions, guidance, addedConsequences, redundancyAndUtility, decision, toneAndForm } }
}

export const DIMENSION_LABELS: Record<keyof CaseScore["dimensions"], string> = {
  procedure: "Procedimento e cenário",
  expectedDeviationsFound: "Desvios esperados encontrados",
  materialDeviationsMissed: "Desvios materiais não encontrados",
  unsupportedAccusations: "Acusações sem suporte",
  undueRecognitions: "Reconhecimentos indevidos",
  guidance: "Orientação aplicável e sustentada",
  addedConsequences: "Consequências e certezas acrescentadas",
  redundancyAndUtility: "Redundância e utilidade",
  decision: "Decisão (publicar/limitar/abster)",
  toneAndForm: "Tom e forma",
}

/** Totais por dimensão, separando casos INDEPENDENTES de REGRESSÃO. Nenhum total agregado de "qualidade". */
export function summarize(scores: readonly CaseScore[]) {
  const dims = Object.keys(DIMENSION_LABELS) as (keyof CaseScore["dimensions"])[]
  const group = (subset: readonly CaseScore[]) => Object.fromEntries(dims.map((dim) => [dim, { PASS: 0, FAIL: 0, NEEDS_INSPECTION: 0, NOT_APPLICABLE: 0, ...subset.reduce<Record<string, number>>((acc, score) => ({ ...acc, [score.dimensions[dim].status]: (acc[score.dimensions[dim].status] ?? 0) + 1 }), {}) }])) as Record<keyof CaseScore["dimensions"], Record<Status, number>>
  return { independent: group(scores.filter((score) => score.independent)), regression: group(scores.filter((score) => !score.independent)), cases: { independent: scores.filter((score) => score.independent).length, regression: scores.filter((score) => !score.independent).length } }
}
