import { z } from "zod"

/**
 * PROCEDURAL SEMANTICS (V1.4.5 — Procedural & Semantic Interpretation).
 *
 * O H1 mostrou PROCEDURAL 0/5: o pipeline sabia TRANSPORTAR uma conclusão procedimental (lineage, binding, escopo), mas
 * não sabia decidir SE ELA FAZ SENTIDO. A pergunta "o operador afirmou uma regra; a base realmente diz isso; a regra se
 * aplica àquele contexto?" era respondida por linguagem livre do modelo — e por isso virava, indistintamente, silêncio
 * (nenhuma claim) ou julgamento sem base.
 *
 * Esta camada separa TRÊS COISAS que nunca se misturam (§2):
 *   FATO           — "o cliente perguntou se precisa enviar documento"; "o operador disse que não precisa" (observação verificada);
 *   INTERPRETAÇÃO  — "o operador afirmou a AUSÊNCIA de um requisito documental" (ProcedureAssertion estruturada);
 *   AVALIAÇÃO      — "coerente / divergente / indeterminada" frente a uma KnowledgeRule com trecho literal da base.
 *
 * DIVISÃO DE TRABALHO (§33): o LLM extrai SIGNIFICADO (sujeito, modalidade, condição, ação, valor) da fala e do trecho da
 * base; o runtime VALIDA refs, normaliza operadores/unidades, compara valores e modalidades, checa a aplicabilidade da
 * condição e decide o estado. A IA nunca faz o cálculo determinístico, e a aplicação nunca inventa a regra: sem trecho da
 * base que a sustente, o estado é INSUFFICIENT_KNOWLEDGE (§14) — nunca "conhecimento geral".
 *
 * ASSIMETRIAS DELIBERADAS:
 * - OPTIONAL/ALLOWED nunca vira erro por não ter sido feito (§36/§10): opcional não realizado é ausência de fato, não falha;
 * - condição da regra não sustentada pelo contexto = NOT_APPLICABLE (§11/§38) — comparar cenário C com atendimento D é o
 *   falso positivo procedimental mais comum, e ele é medido explicitamente (§49);
 * - aderência verificada é FORÇA (§18), mas nunca "aderência integral" (§19/§20): a cobertura é PARTIAL enquanto não houver
 *   checklist estruturado completo, e a linguagem de integralidade é rejeitada no gating.
 */
export const PROCEDURAL_SEMANTICS_VERSION = "PROCEDURAL_SEMANTICS_V1"

/** Modalidade da regra da BASE: o que o procedimento determina. */
export const KNOWLEDGE_MODALITIES = ["REQUIRED", "PROHIBITED", "OPTIONAL", "ALLOWED", "EXPECTED", "INFORMATIONAL"] as const
export type KnowledgeModality = (typeof KNOWLEDGE_MODALITIES)[number]

/** Modalidade da AFIRMAÇÃO do operador: o que ele disse ao cliente sobre a regra (nunca o que ele fez). */
export const ASSERTION_MODALITIES = ["ASSERTED_REQUIREMENT", "ASSERTED_ABSENCE_OF_REQUIREMENT", "ASSERTED_PROHIBITION", "ASSERTED_PERMISSION", "ASSERTED_FACT", "ASSERTED_COMMITMENT"] as const
export type AssertionModality = (typeof ASSERTION_MODALITIES)[number]

export const QUANTITY_UNITS = ["MINUTES", "HOURS", "DAYS", "MONTHS", "CURRENCY", "COUNT"] as const
export type QuantityUnit = (typeof QUANTITY_UNITS)[number]
export const QUANTITY_OPERATORS = ["EQ", "LTE", "GTE", "RANGE"] as const
export type QuantityOperator = (typeof QUANTITY_OPERATORS)[number]

/**
 * Quantidade normalizada pelo RUNTIME (§12/§13): "até 48h" (LTE 48h), "48 horas" (EQ), "24 a 48h" (RANGE), "mínimo 24h"
 * (GTE), "48h úteis" (businessUnit) NÃO são a mesma coisa — e a aplicação representa o operador em vez de deixar o modelo
 * decidir equivalência. `low`/`high` são o intervalo canônico na unidade base (minutos para tempo; o próprio valor senão).
 */
export type Quantity = { operator: QuantityOperator; value: number; valueMax: number | null; unit: QuantityUnit; businessUnit: boolean; low: number; high: number; text: string }

export type ProcedureAssertionSemantics = { subject: string; modality: AssertionModality; condition: string | null; action: string | null; valueText: string | null; value: Quantity | null }

/** Regra extraída da BASE com trecho LITERAL verificado contra o excerto apresentado (nunca do conhecimento do modelo). */
export type KnowledgeRule = { ruleRef: string; documentRef: string; documentTitle: string; subject: string; modality: KnowledgeModality; condition: string | null; action: string | null; valueText: string | null; value: Quantity | null; quote: string }

export const PROCEDURAL_COMPARISON_STATUSES = ["CONSISTENT", "POTENTIAL_DIVERGENCE", "CONTRADICTED", "INSUFFICIENT_KNOWLEDGE", "NOT_APPLICABLE"] as const
export type ProceduralComparisonStatus = (typeof PROCEDURAL_COMPARISON_STATUSES)[number]
export type ConditionMatch = "UNCONDITIONAL" | "MATCHED" | "UNSUPPORTED"
export type ModalityComparison = "ALIGNED" | "SOFT_CONFLICT" | "CONFLICT" | "NEUTRAL"
export type ValueComparison = "COMPATIBLE" | "INCOMPATIBLE" | "NOT_COMPARABLE" | "NO_VALUE"

export type ProceduralEvaluation = {
  interactionRef: string
  /** Observação PROCEDURE_ASSERTION do frame que originou a avaliação (provenance, §16). */
  assertionRef: string
  assertionSummary: string
  assertion: ProcedureAssertionSemantics
  rule: KnowledgeRule | null
  status: ProceduralComparisonStatus
  conditionMatch: ConditionMatch | null
  modalityComparison: ModalityComparison | null
  valueComparison: ValueComparison
  reason: string
  /** Aderência de sujeito entre afirmação e regra (0–1), só telemetria. */
  subjectScore: number
}

// ---------------------------------------------------------------------------------------------
// Normalização de texto (determinística, sem LLM)
// ---------------------------------------------------------------------------------------------

const STOPWORDS = new Set(["a", "o", "as", "os", "de", "da", "do", "das", "dos", "e", "em", "no", "na", "nos", "nas", "um", "uma", "para", "por", "com", "que", "se", "ao", "aos", "à", "às", "ou", "the", "of"])

export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim()
}

/** Tokens de conteúdo (sem acento, sem stopword, ≥ 3 letras) — a base de toda comparação lexical desta camada. */
export function contentTokens(text: string): string[] {
  return normalizeText(text).split(/[^a-z0-9]+/).filter((token) => token.length >= 3 && !STOPWORDS.has(token))
}

/** Radical simples pt-BR: corta plural e sufixos verbais comuns para que "documentos"/"documento" e "enviar"/"envio" casem. */
function stem(token: string): string {
  let out = token
  for (const suffix of ["coes", "oes", "aes", "ais", "eis", "res", "ns", "s"]) if (out.length > 4 && out.endsWith(suffix)) { out = out.slice(0, out.length - suffix.length); break }
  for (const suffix of ["ando", "endo", "indo", "ar", "er", "ir", "cao", "mento"]) if (out.length > 5 && out.endsWith(suffix)) { out = out.slice(0, out.length - suffix.length); break }
  return out.length >= 3 ? out : token
}

export function stemSet(text: string): Set<string> {
  return new Set(contentTokens(text).map(stem))
}

/** Fração dos tokens de `needle` presentes em `haystack` (0–1) — 1 quando `needle` não tem token de conteúdo. */
export function tokenCoverage(needle: string, haystack: string): number {
  const need = [...stemSet(needle)]
  if (need.length === 0) return 1
  const have = stemSet(haystack)
  return need.filter((token) => have.has(token)).length / need.length
}

// ---------------------------------------------------------------------------------------------
// Quantidades: parser determinístico (§12/§13) — o LLM NUNCA calcula prazo
// ---------------------------------------------------------------------------------------------

const UNIT_PATTERNS: { unit: QuantityUnit; pattern: RegExp; toBase: number }[] = [
  { unit: "MINUTES", pattern: /\b(?:min|mins|minuto|minutos)\b/, toBase: 1 },
  { unit: "HOURS", pattern: /\b(?:h|hs|hora|horas)\b/, toBase: 60 },
  { unit: "DAYS", pattern: /\b(?:dia|dias)\b/, toBase: 1440 },
  { unit: "MONTHS", pattern: /\b(?:mes|meses)\b/, toBase: 43200 },
]

/** Unidade base de comparação: minutos para tempo; o próprio valor para dinheiro/contagem. */
function baseFactor(unit: QuantityUnit): number {
  return UNIT_PATTERNS.find((item) => item.unit === unit)?.toBase ?? 1
}

/**
 * Interpreta uma expressão de valor em quantidade estruturada. Reconhece apenas formas EXPLÍCITAS; qualquer coisa fora
 * disso devolve null (e a comparação vira NOT_COMPARABLE, nunca um palpite).
 */
export function parseQuantity(raw: string | null | undefined): Quantity | null {
  if (!raw) return null
  const text = raw.trim()
  const normalized = normalizeText(text)
  if (normalized.length === 0) return null
  const businessUnit = /\b(?:util|uteis)\b/.test(normalized)
  const currency = /r\$|\breais?\b/.test(normalized)
  const unit: QuantityUnit = currency ? "CURRENCY" : (UNIT_PATTERNS.find((item) => item.pattern.test(normalized))?.unit ?? "COUNT")
  const numbers = [...normalized.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((match) => Number(match[1]!.replace(",", ".")))
  if (numbers.length === 0 || numbers.some((value) => !Number.isFinite(value))) return null
  const factor = baseFactor(unit)
  const build = (operator: QuantityOperator, value: number, valueMax: number | null): Quantity => {
    const low = operator === "GTE" ? value * factor : operator === "LTE" ? 0 : value * factor
    const high = operator === "LTE" ? value * factor : operator === "GTE" ? Number.POSITIVE_INFINITY : (valueMax ?? value) * factor
    return { operator, value, valueMax, unit, businessUnit, low, high, text }
  }
  const range = /(\d+(?:[.,]\d+)?)\s*(?:a|ate|até|-|–|—|e)\s*(\d+(?:[.,]\d+)?)/.exec(normalized)
  if (range && numbers.length >= 2 && !/\b(?:ate|até)\s*\d/.test(normalized.slice(0, range.index + 1))) {
    const min = Number(range[1]!.replace(",", "."))
    const max = Number(range[2]!.replace(",", "."))
    if (min < max) return build("RANGE", min, max)
  }
  if (/\b(?:ate|até|no maximo|máximo de|maximo de|em ate|no prazo de|dentro de|inferior a|menos de)\b/.test(normalized)) return build("LTE", numbers[0]!, null)
  if (/\b(?:no minimo|mínimo de|minimo de|minimo|pelo menos|a partir de|superior a|mais de)\b/.test(normalized)) return build("GTE", numbers[0]!, null)
  return build("EQ", numbers[0]!, null)
}

/**
 * Compatibilidade entre o valor AFIRMADO e o valor da REGRA: contenção de intervalos na unidade base.
 * "48h" dentro de "até 48h" é COMPATIBLE (§39); "72h" contra "até 48h" é INCOMPATIBLE; unidades de natureza diferente ou
 * marcação de dias úteis divergente é NOT_COMPARABLE — a aplicação não converte "48h úteis" em "48h" (§13).
 */
export function compareQuantities(asserted: Quantity | null, rule: Quantity | null): ValueComparison {
  if (!asserted || !rule) return "NO_VALUE"
  const timeUnits: QuantityUnit[] = ["MINUTES", "HOURS", "DAYS", "MONTHS"]
  const sameFamily = (timeUnits.includes(asserted.unit) && timeUnits.includes(rule.unit)) || asserted.unit === rule.unit
  if (!sameFamily) return "NOT_COMPARABLE"
  if (asserted.businessUnit !== rule.businessUnit) return "NOT_COMPARABLE"
  const contained = asserted.low >= rule.low && asserted.high <= rule.high
  if (contained) return "COMPATIBLE"
  const disjoint = asserted.low > rule.high || asserted.high < rule.low
  if (disjoint) return "INCOMPATIBLE"
  return "NOT_COMPARABLE"
}

// ---------------------------------------------------------------------------------------------
// Modalidade (§10) — a matriz é o coração do "não deixar o LLM inverter modalidade"
// ---------------------------------------------------------------------------------------------

const MODALITY_MATRIX: Record<KnowledgeModality, Record<AssertionModality, ModalityComparison>> = {
  REQUIRED: { ASSERTED_REQUIREMENT: "ALIGNED", ASSERTED_ABSENCE_OF_REQUIREMENT: "CONFLICT", ASSERTED_PROHIBITION: "CONFLICT", ASSERTED_PERMISSION: "SOFT_CONFLICT", ASSERTED_FACT: "NEUTRAL", ASSERTED_COMMITMENT: "NEUTRAL" },
  PROHIBITED: { ASSERTED_REQUIREMENT: "CONFLICT", ASSERTED_ABSENCE_OF_REQUIREMENT: "ALIGNED", ASSERTED_PROHIBITION: "ALIGNED", ASSERTED_PERMISSION: "CONFLICT", ASSERTED_FACT: "NEUTRAL", ASSERTED_COMMITMENT: "NEUTRAL" },
  // OPTIONAL nunca produz erro por omissão (§36): dizer que NÃO é obrigatório está correto; dizer que é obrigatório é, no
  // máximo, uma divergência potencial (pode haver contexto em que a empresa exige) — nunca CONTRADICTED.
  OPTIONAL: { ASSERTED_REQUIREMENT: "SOFT_CONFLICT", ASSERTED_ABSENCE_OF_REQUIREMENT: "ALIGNED", ASSERTED_PROHIBITION: "SOFT_CONFLICT", ASSERTED_PERMISSION: "ALIGNED", ASSERTED_FACT: "NEUTRAL", ASSERTED_COMMITMENT: "NEUTRAL" },
  ALLOWED: { ASSERTED_REQUIREMENT: "SOFT_CONFLICT", ASSERTED_ABSENCE_OF_REQUIREMENT: "ALIGNED", ASSERTED_PROHIBITION: "CONFLICT", ASSERTED_PERMISSION: "ALIGNED", ASSERTED_FACT: "NEUTRAL", ASSERTED_COMMITMENT: "NEUTRAL" },
  EXPECTED: { ASSERTED_REQUIREMENT: "ALIGNED", ASSERTED_ABSENCE_OF_REQUIREMENT: "SOFT_CONFLICT", ASSERTED_PROHIBITION: "SOFT_CONFLICT", ASSERTED_PERMISSION: "NEUTRAL", ASSERTED_FACT: "NEUTRAL", ASSERTED_COMMITMENT: "NEUTRAL" },
  INFORMATIONAL: { ASSERTED_REQUIREMENT: "NEUTRAL", ASSERTED_ABSENCE_OF_REQUIREMENT: "NEUTRAL", ASSERTED_PROHIBITION: "NEUTRAL", ASSERTED_PERMISSION: "NEUTRAL", ASSERTED_FACT: "NEUTRAL", ASSERTED_COMMITMENT: "NEUTRAL" },
}

export function compareModality(assertion: AssertionModality, rule: KnowledgeModality): ModalityComparison {
  return MODALITY_MATRIX[rule][assertion]
}

// ---------------------------------------------------------------------------------------------
// Comparação procedimental (determinística)
// ---------------------------------------------------------------------------------------------

/** Aderência mínima de sujeito para considerar que a regra fala DA MESMA COISA que a afirmação. */
export const SUBJECT_MATCH_THRESHOLD = 0.5
/** Fração mínima da condição da regra que precisa estar sustentada pelo contexto da interação (§11). */
export const CONDITION_MATCH_THRESHOLD = 0.5

/** A regra da base fala do mesmo assunto da afirmação? Score = cobertura dos tokens da afirmação pela regra (e vice-versa). */
export function subjectMatchScore(assertionSubject: string, rule: Pick<KnowledgeRule, "subject" | "action" | "quote">): number {
  const ruleText = [rule.subject, rule.action ?? "", rule.quote].join(" ")
  const forward = tokenCoverage(assertionSubject, ruleText)
  const backward = tokenCoverage(rule.subject, assertionSubject)
  return Math.max(forward, (forward + backward) / 2)
}

/**
 * A CONDIÇÃO da regra é sustentada pelo contexto observado? (§11/§38) Sem condição → UNCONDITIONAL. Com condição cujos
 * tokens não aparecem no contexto → UNSUPPORTED: a regra existe, mas não é sobre este atendimento — e comparar assim mesmo
 * é o falso positivo procedimental que esta versão mede (§49).
 */
export function evaluateCondition(rule: KnowledgeRule, contextText: string): ConditionMatch {
  if (!rule.condition || contentTokens(rule.condition).length === 0) return "UNCONDITIONAL"
  return tokenCoverage(rule.condition, contextText) >= CONDITION_MATCH_THRESHOLD ? "MATCHED" : "UNSUPPORTED"
}

export type ProceduralComparison = { status: ProceduralComparisonStatus; conditionMatch: ConditionMatch | null; modalityComparison: ModalityComparison | null; valueComparison: ValueComparison; reason: string }

/** Compara UMA afirmação com UMA regra já escolhida. Só o runtime decide o estado — o modelo nunca declara divergência. */
export function compareProcedure(assertion: ProcedureAssertionSemantics, rule: KnowledgeRule | null, contextText: string): ProceduralComparison {
  if (!rule) return { status: "INSUFFICIENT_KNOWLEDGE", conditionMatch: null, modalityComparison: null, valueComparison: "NO_VALUE", reason: "nenhum trecho da base recuperada sustenta uma regra sobre este assunto — questão procedimental a verificar, nunca erro confirmado" }
  const conditionMatch = evaluateCondition(rule, contextText)
  if (conditionMatch === "UNSUPPORTED") return { status: "NOT_APPLICABLE", conditionMatch, modalityComparison: null, valueComparison: "NO_VALUE", reason: `a regra vale sob a condição "${rule.condition}", que não está sustentada pelo contexto desta interação — regra inaplicável, não divergência` }
  const modalityComparison = compareModality(assertion.modality, rule.modality)
  const valueComparison = compareQuantities(assertion.value, rule.value)
  if (modalityComparison === "CONFLICT") return { status: "CONTRADICTED", conditionMatch, modalityComparison, valueComparison, reason: `a base registra ${rule.modality} e o operador afirmou ${assertion.modality}` }
  if (modalityComparison === "SOFT_CONFLICT") return { status: "POTENTIAL_DIVERGENCE", conditionMatch, modalityComparison, valueComparison, reason: `a base registra ${rule.modality} e o operador afirmou ${assertion.modality} — divergência possível, não confirmada` }
  if (valueComparison === "INCOMPATIBLE") return { status: "CONTRADICTED", conditionMatch, modalityComparison, valueComparison, reason: `valor afirmado (${assertion.value?.text}) fora do que a base registra (${rule.value?.text})` }
  if (valueComparison === "NOT_COMPARABLE") return { status: "POTENTIAL_DIVERGENCE", conditionMatch, modalityComparison, valueComparison, reason: `valor afirmado (${assertion.value?.text}) e valor da base (${rule.value?.text}) não são diretamente comparáveis (unidade/base de contagem diferente)` }
  if (modalityComparison === "ALIGNED" || valueComparison === "COMPATIBLE") return { status: "CONSISTENT", conditionMatch, modalityComparison, valueComparison, reason: valueComparison === "COMPATIBLE" ? `valor afirmado (${assertion.value?.text}) compatível com a base (${rule.value?.text})` : `afirmação coerente com o que a base registra (${rule.modality})` }
  return { status: "INSUFFICIENT_KNOWLEDGE", conditionMatch, modalityComparison, valueComparison, reason: `o trecho da base é ${rule.modality} e não decide a afirmação (${assertion.modality}) — questão procedimental a verificar` }
}

export type AssertionInput = { interactionRef: string; assertionRef: string; summary: string; semantics: ProcedureAssertionSemantics; contextText: string }

/**
 * Avalia TODAS as afirmações normativas contra as regras extraídas da base. Para cada afirmação escolhe a regra de maior
 * aderência de sujeito (§15: um documento qualquer não é autoridade genérica — a regra precisa falar do mesmo assunto);
 * sem regra acima do limiar, o estado é INSUFFICIENT_KNOWLEDGE (§14).
 */
export function evaluateProcedureAssertions(assertions: AssertionInput[], rules: KnowledgeRule[]): ProceduralEvaluation[] {
  return assertions.map((item) => {
    const scored = rules.map((rule) => ({ rule, score: subjectMatchScore(item.semantics.subject || item.summary, rule) })).sort((a, b) => b.score - a.score)
    const best = scored[0] && scored[0].score >= SUBJECT_MATCH_THRESHOLD ? scored[0] : null
    const comparison = compareProcedure(item.semantics, best?.rule ?? null, item.contextText)
    return { interactionRef: item.interactionRef, assertionRef: item.assertionRef, assertionSummary: item.summary, assertion: item.semantics, rule: best?.rule ?? null, subjectScore: best ? Math.round(best.score * 100) / 100 : 0, ...comparison }
  })
}

/**
 * COBERTURA PROCEDIMENTAL (§20): sem checklist estruturado completo do procedimento, a avaliação cobre apenas as regras
 * efetivamente verificadas — "cumpriu os requisitos verificados", nunca "seguiu integralmente o procedimento" (§19).
 */
export type ProceduralCoverage = { coverage: "PARTIAL" | "COMPLETE"; assertionsEvaluated: number; rulesMatched: number; checklistAvailable: boolean; note: string }

export function proceduralCoverageOf(evaluations: ProceduralEvaluation[], checklistAvailable = false): ProceduralCoverage {
  const rulesMatched = new Set(evaluations.map((item) => item.rule?.ruleRef).filter((ref): ref is string => Boolean(ref))).size
  return { coverage: checklistAvailable ? "COMPLETE" : "PARTIAL", assertionsEvaluated: evaluations.length, rulesMatched, checklistAvailable, note: checklistAvailable ? "checklist estruturado disponível: avaliação do procedimento completo" : "sem checklist estruturado do procedimento: a avaliação cobre apenas as regras verificadas nesta execução" }
}

export type ProceduralTelemetry = {
  version: string
  assertionsDeclared: number
  assertionsWithSemantics: number
  knowledgeExcerptsAvailable: number
  rulesDeclared: number
  rulesVerified: number
  rulesRejected: number
  rulesRejectionReasons: Record<KnowledgeRuleRejectionReason, number>
  evaluations: number
  byStatus: Record<ProceduralComparisonStatus, number>
  quantitiesParsedAssertion: number
  quantitiesParsedRule: number
  coverage: "PARTIAL" | "COMPLETE"
  knowledgeSource: "TOOL_RESULTS" | "TARGETED_RETRIEVAL" | "NONE"
}

export function emptyProceduralTelemetry(): ProceduralTelemetry {
  return { version: PROCEDURAL_SEMANTICS_VERSION, assertionsDeclared: 0, assertionsWithSemantics: 0, knowledgeExcerptsAvailable: 0, rulesDeclared: 0, rulesVerified: 0, rulesRejected: 0, rulesRejectionReasons: { UNKNOWN_DOCUMENT: 0, QUOTE_NOT_LITERAL: 0, EMPTY_SUBJECT: 0 }, evaluations: 0, byStatus: { CONSISTENT: 0, POTENTIAL_DIVERGENCE: 0, CONTRADICTED: 0, INSUFFICIENT_KNOWLEDGE: 0, NOT_APPLICABLE: 0 }, quantitiesParsedAssertion: 0, quantitiesParsedRule: 0, coverage: "PARTIAL", knowledgeSource: "NONE" }
}

// ---------------------------------------------------------------------------------------------
// FASE K — extração de KnowledgeRule a partir dos trechos recuperados (LLM extrai; runtime verifica)
// ---------------------------------------------------------------------------------------------

export const KNOWLEDGE_RULE_REJECTION_REASONS = ["UNKNOWN_DOCUMENT", "QUOTE_NOT_LITERAL", "EMPTY_SUBJECT"] as const
export type KnowledgeRuleRejectionReason = (typeof KNOWLEDGE_RULE_REJECTION_REASONS)[number]

const enumOr = <T extends string>(values: readonly T[], fallback: T) => z.string().catch(fallback).transform((value): T => { const upper = value.trim().toUpperCase(); return (values as readonly string[]).includes(upper) ? (upper as T) : fallback })
const nullableText = z.string().trim().max(240).nullable().optional().catch(null).transform((value) => (value && value.length > 0 ? value : null))

const knowledgeRuleSchema = z.object({
  documentRef: z.string().trim(),
  subject: z.string().trim().max(160),
  modality: enumOr(KNOWLEDGE_MODALITIES, "INFORMATIONAL"),
  condition: nullableText,
  action: nullableText,
  value: nullableText,
  quote: z.string().trim().min(10).max(600),
})
export const knowledgeRuleExtractionSchema = z.object({ rules: z.array(knowledgeRuleSchema.nullable().catch(null)).default([]).transform((items) => items.filter((item): item is z.infer<typeof knowledgeRuleSchema> => item !== null).slice(0, 16)) })

/** Trecho da base apresentado ao modelo com handle (Zero-ID: nunca o UUID do documento). */
export type KnowledgeExcerptView = { documentRef: string; documentId: string; documentTitle: string; heading: string; excerpt: string }

/**
 * Verifica as regras declaradas: o documento precisa ser um dos apresentados e o `quote` precisa ser LITERAL dentro do
 * trecho daquele documento (mesma exigência do verifier de transcrição — a base também é evidência). Regra sem trecho
 * literal é descartada: sem isso, "a base diz X" seria conhecimento do modelo (§14).
 */
export function verifyKnowledgeRules(declared: z.infer<typeof knowledgeRuleExtractionSchema>["rules"], excerpts: KnowledgeExcerptView[], telemetry: ProceduralTelemetry): KnowledgeRule[] {
  const byRef = new Map<string, KnowledgeExcerptView[]>()
  for (const excerpt of excerpts) byRef.set(excerpt.documentRef, [...(byRef.get(excerpt.documentRef) ?? []), excerpt])
  const verified: KnowledgeRule[] = []
  telemetry.rulesDeclared = declared.length
  for (const item of declared) {
    const ref = item.documentRef.trim().toUpperCase()
    const candidates = byRef.get(ref)
    const reject = (reason: KnowledgeRuleRejectionReason) => { telemetry.rulesRejected += 1; telemetry.rulesRejectionReasons[reason] += 1 }
    if (!candidates || candidates.length === 0) { reject("UNKNOWN_DOCUMENT"); continue }
    if (contentTokens(item.subject).length === 0) { reject("EMPTY_SUBJECT"); continue }
    const needle = normalizeText(item.quote)
    const source = candidates.find((excerpt) => normalizeText(excerpt.excerpt).includes(needle))
    if (!source) { reject("QUOTE_NOT_LITERAL"); continue }
    const value = parseQuantity(item.value)
    if (value) telemetry.quantitiesParsedRule += 1
    verified.push({ ruleRef: `KR${verified.length + 1}`, documentRef: ref, documentTitle: source.documentTitle, subject: item.subject, modality: item.modality, condition: item.condition, action: item.action, valueText: item.value, value, quote: item.quote })
  }
  telemetry.rulesVerified = verified.length
  return verified
}

/** Trechos da base MODEL-FACING (sem UUID) para a extração de regras. */
export function renderKnowledgeExcerpts(excerpts: KnowledgeExcerptView[]): string {
  return excerpts.map((excerpt) => `=== ${excerpt.documentRef} · "${excerpt.documentTitle}"${excerpt.heading ? ` · ${excerpt.heading}` : ""} ===\n${excerpt.excerpt}`).join("\n\n")
}

/** Afirmações normativas MODEL-FACING para a extração dirigida de regras (o que precisa ser confrontado com a base). */
export function renderAssertionsForKnowledge(assertions: AssertionInput[]): string {
  return assertions.map((item) => `- ${item.assertionRef} (${item.interactionRef}): ${item.summary}${item.semantics.subject ? ` [assunto: ${item.semantics.subject}]` : ""}${item.semantics.valueText ? ` [valor afirmado: ${item.semantics.valueText}]` : ""}`).join("\n")
}

export function renderKnowledgeRuleExtractionInstructions(): string {
  return `Você recebe TRECHOS de procedimentos internos (cada um com uma referência "K1", "K2"…) e uma lista de AFIRMAÇÕES NORMATIVAS feitas por um operador durante atendimentos. Sua tarefa é traduzir o que os TRECHOS determinam sobre esses assuntos em REGRAS estruturadas — nada mais.

Responda SOMENTE com JSON válido:
{"rules":[{"documentRef":"K1","subject":"assunto da regra em poucas palavras (ex.: prazo de reenvio da segunda via)","modality":"REQUIRED|PROHIBITED|OPTIONAL|ALLOWED|EXPECTED|INFORMATIONAL","condition":"a condição em que a regra vale, ou null","action":"o que deve/pode ser feito, ou null","value":"prazo/valor EXATAMENTE como o texto escreve (ex.: \\"até 48 horas\\", \\"24 a 48 horas\\", \\"no mínimo 24 horas\\"), ou null","quote":"trecho LITERAL e EXATO copiado do documento referenciado"}]}

Regras: (1) o campo quote precisa ser uma cópia LITERAL de um pedaço do trecho K referenciado — regra sem trecho literal é descartada por código; (2) NÃO use conhecimento geral nem o que você sabe sobre o setor: se os trechos não determinam nada sobre um assunto, não invente regra para ele (lista vazia é resposta válida e correta); (3) modality é o que o TEXTO determina: "deve/é obrigatório/é necessário" = REQUIRED; "não deve/não pode/é vedado" = PROHIBITED; "pode/é facultativo/quando desejar" = OPTIONAL ou ALLOWED; "espera-se/recomenda-se" = EXPECTED; texto puramente descritivo = INFORMATIONAL — nunca transforme uma possibilidade em obrigação; (4) copie o valor/prazo como está escrito, com as palavras "até", "a partir de", "no mínimo", "úteis" — NÃO calcule, não converta unidade, não arredonde; (5) condition só quando o texto condiciona a regra ("quando o cliente for titular", "para contas vencidas há mais de 30 dias"); (6) uma regra por determinação; no máximo 16.`
}
