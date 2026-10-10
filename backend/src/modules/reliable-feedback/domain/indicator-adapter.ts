import type { FeedbackInvestigationResultV1 } from "./feedback-investigation-result.js"
import { canonicalFactsOf, type IndicatorCanonicalContext } from "../../indicators/domain/indicator-canonical-context.js"
import { indicatorClaimViolations } from "./indicator-claims.js"
import type { ReliableFact, ReliableItemDraft } from "./reliable-feedback-item.js"

/**
 * V1.5.12 — INDICATOR FEEDBACK ADAPTER (domínio puro): interpretação do Agent + CONTEXTO CANÔNICO do sistema → item
 * confiável. Fonte da verdade dos números = o SISTEMA (`IndicatorCanonicalContext`); o texto do Agent NUNCA muda valor,
 * meta, período nem a comparação. A seção vem só da comparação oficial (dentro da meta → ponto positivo; fora → ponto de
 * desenvolvimento). Sem meta canônica não há afirmação sobre meta possível → BLOCKED (CANONICAL_TARGET_MISSING).
 *
 * A interpretação do Agent (resumo + recomendação) só segue ao redator se respeitar as fronteiras de afirmação do indicador
 * (números canônicos, comparação oficial, sem tendência, período correto). Conflito → a interpretação é DESCARTADA do
 * pedido ao redator (ele escreve só a partir dos fatos canônicos) e o item vai a QA com o motivo registrado.
 */
export const INDICATOR_ADAPTER_VERSION = "INDICATOR_FEEDBACK_ADAPTER_V1" as const

export const INDICATOR_SAFE_MEANING = { met: "resultado oficial do indicador dentro da meta no período", notMet: "resultado oficial do indicador fora da meta no período" } as const

export function buildIndicatorItems(input: { result: FeedbackInvestigationResultV1; canonical: IndicatorCanonicalContext }): ReliableItemDraft[] {
  const { canonical } = input
  const facts = canonicalFactsOf(canonical)
  const claim = input.result.claims[0] ?? null
  const shownFacts: ReliableFact[] = [
    { role: "DADO_OFICIAL", text: `${canonical.indicator.name} no período ${facts.periodLabel}: ${facts.valueText}`, truncated: false, masked: false },
    ...(facts.targetText ? [{ role: "DADO_OFICIAL" as const, text: `Meta vigente: ${facts.targetText} (${facts.directionLabel})`, truncated: false, masked: false }] : []),
    ...(facts.comparisonLabel ? [{ role: "DADO_OFICIAL" as const, text: `Resultado oficial: ${facts.comparisonLabel}`, truncated: false, masked: false }] : []),
  ]
  const analysisTexts = [claim?.summary, claim?.recommendation, claim?.observation].filter((value): value is string => Boolean(value))
  const conflicts = [...new Set(analysisTexts.flatMap((value) => indicatorClaimViolations(value, canonical, "analysis")))]
  const met = canonical.withinTarget === true
  const base = {
    index: 0,
    claimRef: claim?.ref ?? "C1",
    domain: "INDICATOR" as const,
    ownership: "AGENT" as const,
    facts: shownFacts,
    withheldFacts: 0,
    // Conflito com o canônico: a interpretação não vai ao redator (nunca "corrigida" por código).
    analysis: conflicts.length > 0 || !claim ? null : { observation: null, summary: claim.summary, recommendation: claim.recommendation },
    analysisConflicts: conflicts,
    audit: { evidence: [], rejectedUnits: [] },
    // V1.6.0 — o indicador mostra O QUE está acontecendo, nunca POR QUÊ: sem processo/base verificados não há orientação.
    grounding: "NO_GROUNDED_GUIDANCE" as const,
    knowledge: null,
    process: null,
  }
  if (canonical.withinTarget === null || !canonical.target) {
    return [{ ...base, section: "NEUTRAL_CONTEXT", kind: "INDICATOR_TARGET_NOT_MET", polarity: "NEGATIVE", safeMeaning: "resultado oficial do indicador sem meta vigente para comparar", guidanceSource: "COACHING_SUGGESTION", structuralBlock: "CANONICAL_TARGET_MISSING" }]
  }
  return [{
    ...base,
    section: met ? "STRENGTH" : "OPPORTUNITY",
    kind: met ? "INDICATOR_TARGET_MET" : "INDICATOR_TARGET_NOT_MET",
    polarity: met ? "POSITIVE" : "NEGATIVE",
    safeMeaning: met ? INDICATOR_SAFE_MEANING.met : INDICATOR_SAFE_MEANING.notMet,
    guidanceSource: met ? "REINFORCEMENT" : "COACHING_SUGGESTION",
    structuralBlock: null,
  }]
}
