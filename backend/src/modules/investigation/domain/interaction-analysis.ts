import { bucketIndexOf } from "./temporal-semantics.js"
import type { ClaimScope } from "./tool-trace.js"
import { INVESTIGATION_OBJECTIVE_LABELS, type InvestigationObjective, type InvestigationObjectiveKind } from "./investigation-objective.js"
import { percentOf } from "./tool-output.js"

/**
 * ANÁLISE DE INTERAÇÕES CONSCIENTE DO OBJETIVO (V1.3.2 — Partes 2 e 3 do pedido).
 *
 * 1. `InteractionAnalysisObjective`: o contexto INVESTIGATIVO compacto que `analyze_interactions` recebe
 *    além do texto livre do Agent — objetivo derivado pelo runtime, escopo exigido, intenção do período,
 *    necessidades/perguntas/hipóteses MATERIAIS ainda abertas e contradições declaradas na própria
 *    investigação. Nada aqui é lista de "o que procurar": só o que nasceu do objetivo ou do estado
 *    declarado pelo modelo. Ground truth nunca entra (não existe caminho de dados para ele).
 *
 * 2. Semântica de contagem SEM ambiguidade: `matchedTranscriptCount` é o número de transcrições ANALISADAS
 *    em que o achado tem trecho literal VERIFICADO — um limite inferior do que a análise citou, nunca
 *    "quantas vezes aconteceu no período". Percentual sobre o universo só existe quando a amostra é o
 *    universo inteiro (cobertura total); caso contrário é null e o contexto diz por quê. Tudo calculado aqui.
 */
export type PeriodIntent = "SINGLE_INTERACTION" | "PERIOD_PATTERN" | "PERIOD_EVOLUTION"

export type InteractionAnalysisObjective = {
  investigationObjective: InvestigationObjectiveKind
  question: string
  requiredClaimScope: ClaimScope | null
  periodIntent: PeriodIntent
  periodLabel: string
  /** Necessidades materiais ainda abertas (id + pergunta) — do controlador de suficiência. */
  openEvidenceNeeds: { id: string; question: string }[]
  /** Perguntas materiais declaradas pelo modelo e ainda sem resposta. */
  materialQuestions: string[]
  /** Hipóteses materiais declaradas pelo modelo com o status atual. */
  materialHypotheses: { hypothesis: string; status: string }[]
  /** Evidência contraditória declarada e ainda OPEN. */
  contradictoryEvidenceSummary: string[]
  /** O que o Agent pediu nesta chamada (argumento `objective` da Tool). */
  analysisPurpose: string
  /** Interações registradas do colaborador no período (universo REGISTRADO) — null = desconhecido. */
  recordedUniverseCount: number | null
}

/** Intenção do período: uma interação em foco → específica; janela curta → padrão; janela longa (≥ 2 blocos) → evolução também importa. */
export function periodIntentOf(objective: InvestigationObjective, periodDays: number, transcriptInFocus: boolean): PeriodIntent {
  if (transcriptInFocus || objective.kind === "FEEDBACK_SINGLE_INTERACTION" || objective.kind === "PROCESS_AUDIT") return "SINGLE_INTERACTION"
  return periodDays > LONG_PERIOD_DAYS ? "PERIOD_EVOLUTION" : "PERIOD_PATTERN"
}

/** Acima disto a janela tem mais de um bloco temporal e "evolução" vira pergunta legítima (~5 semanas). */
export const LONG_PERIOD_DAYS = 35

const PERIOD_INTENT_TEXT: Record<PeriodIntent, string> = {
  SINGLE_INTERACTION: "UMA interação específica — o que aconteceu nela; não generalize para o colaborador.",
  PERIOD_PATTERN: "padrão no período — o que se repete entre as interações analisadas e o que aparece só uma vez.",
  PERIOD_EVOLUTION: "padrão E evolução no período (janela longa) — além do que se repete, o que muda entre interações de momentos diferentes.",
}

/** Bloco que a Tool coloca no prompt da análise semântica (compacto; sem ids técnicos; sem gabarito). */
export function renderInteractionAnalysisObjective(objective: InteractionAnalysisObjective): string {
  const lines = [
    `CONTEXTO INVESTIGATIVO (por que esta análise existe):`,
    `- Objetivo: ${INVESTIGATION_OBJECTIVE_LABELS[objective.investigationObjective]} — ${objective.question}`,
    `- Escopo de afirmação que a conclusão exige: ${objective.requiredClaimScope ?? "nenhum específico (afirmações só no escopo que a evidência sustenta)"}.`,
    `- Período: ${objective.periodLabel} — ${PERIOD_INTENT_TEXT[objective.periodIntent]}`,
    `- Pedido do Agent nesta análise: ${objective.analysisPurpose}`,
  ]
  if (objective.openEvidenceNeeds.length > 0) lines.push(`- Necessidades de evidência ainda abertas: ${objective.openEvidenceNeeds.map((need) => `${need.id} (${need.question})`).join("; ")}`)
  if (objective.materialQuestions.length > 0) lines.push(`- Perguntas materiais em aberto: ${objective.materialQuestions.join(" | ")}`)
  if (objective.materialHypotheses.length > 0) lines.push(`- Hipóteses materiais: ${objective.materialHypotheses.map((item) => `${item.hypothesis} [${item.status}]`).join(" | ")}`)
  if (objective.contradictoryEvidenceSummary.length > 0) lines.push(`- Evidência contraditória ainda sem contexto: ${objective.contradictoryEvidenceSummary.join(" | ")}`)
  lines.push(
    "O QUE DEVOLVER: achados que respondem, refutam ou complicam o objetivo e as perguntas acima — e também fatos relevantes que elas não previram (inconsistências literais entre o que foi dito e o que foi feito, eventos registrados na transcrição, diferenças entre interações de momentos ou assuntos diferentes, fatores de contexto observáveis). Cada achado com trecho LITERAL. Zero achados sustentados é uma resposta válida; um achado inventado nunca é.",
  )
  return lines.join("\n")
}

/** Relação entre a amostra analisada e o universo registrado — decide se algum percentual de prevalência é matematicamente válido. */
export type AnalysisUniverseRelationship = "FULL_COVERAGE" | "PARTIAL_COVERAGE" | "UNKNOWN"

export type FindingCounts = {
  /** Transcrições ANALISADAS em que o achado tem ≥ 1 trecho literal verificado (limite inferior — não é ocorrência no período). */
  matchedTranscriptCount: number
  /** Trechos literais verificados (pode haver mais de um por transcrição). */
  verifiedExcerptCount: number
  /** matched / analisadas — participação DENTRO DA AMOSTRA ANALISADA (nunca do período). */
  matchedShareOfAnalyzedPercent: number | null
  /** Só com cobertura TOTAL (amostra = universo registrado): matched / universo. Senão null. */
  prevalenceInUniversePercent: number | null
}

export type AnalysisCoverage = {
  analyzedTranscriptCount: number
  recordedUniverseCount: number | null
  universeRelationship: AnalysisUniverseRelationship
  /** analisadas / universo (quando conhecido). */
  analyzedShareOfUniversePercent: number | null
  /** Frase pronta para o modelo: o que os números permitem e o que NÃO permitem inferir. */
  countingNote: string
}

export function analysisCoverageOf(analyzedTranscriptCount: number, recordedUniverseCount: number | null): AnalysisCoverage {
  const universeRelationship: AnalysisUniverseRelationship = recordedUniverseCount === null ? "UNKNOWN" : analyzedTranscriptCount >= recordedUniverseCount ? "FULL_COVERAGE" : "PARTIAL_COVERAGE"
  const analyzedShareOfUniversePercent = recordedUniverseCount === null ? null : percentOf(Math.min(analyzedTranscriptCount, recordedUniverseCount), recordedUniverseCount)
  const countingNote =
    universeRelationship === "FULL_COVERAGE"
      ? `${analyzedTranscriptCount} transcrição(ões) analisada(s) = todas as interações registradas no período; "N de ${analyzedTranscriptCount}" é o número de transcrições com trecho literal verificado — um limite inferior (a análise pode não ter citado todas em que o achado ocorre), nunca "só N tiveram".`
      : universeRelationship === "PARTIAL_COVERAGE"
        ? `${analyzedTranscriptCount} de ${recordedUniverseCount} interação(ões) registrada(s) no período foram analisadas. "N de ${analyzedTranscriptCount}" é o número de transcrições ANALISADAS com trecho literal verificado (limite inferior) — NÃO representa N de ${recordedUniverseCount} interações do período nem "só N tiveram".`
        : `${analyzedTranscriptCount} transcrição(ões) analisada(s); o universo do período é desconhecido — "N de ${analyzedTranscriptCount}" vale só dentro da amostra e não sustenta prevalência no período.`
  return { analyzedTranscriptCount, recordedUniverseCount, universeRelationship, analyzedShareOfUniversePercent, countingNote }
}

export function findingCountsOf(matchedTranscriptCount: number, verifiedExcerptCount: number, coverage: AnalysisCoverage): FindingCounts {
  return {
    matchedTranscriptCount,
    verifiedExcerptCount,
    matchedShareOfAnalyzedPercent: coverage.analyzedTranscriptCount > 0 ? percentOf(matchedTranscriptCount, coverage.analyzedTranscriptCount) : null,
    prevalenceInUniversePercent: coverage.universeRelationship === "FULL_COVERAGE" && coverage.recordedUniverseCount ? percentOf(matchedTranscriptCount, coverage.recordedUniverseCount) : null,
  }
}

/** Cobertura TEMPORAL das transcrições analisadas: em quantos blocos da janela elas caem (evolução exige ≥ 2). */
export function temporalCoverageOf(analyzedStartedAt: Date[], period: { start: Date; end: Date }, bucketCount: number, dateLabelOf: (date: Date) => string): { buckets: number; bucketsCovered: number; perBucket: number[] } {
  const buckets = Math.max(1, bucketCount)
  const perBucket = new Array<number>(buckets).fill(0)
  for (const startedAt of analyzedStartedAt) {
    // Mesma divisão de blocos da amostra estratificada e da semântica temporal (V1.3.4; dias locais desde a V1.3.4.1).
    const index = bucketIndexOf(startedAt, period, buckets, dateLabelOf)
    if (index === null) continue
    perBucket[index] = (perBucket[index] ?? 0) + 1
  }
  return { buckets, bucketsCovered: perBucket.filter((count) => count > 0).length, perBucket }
}

/** Blocos temporais de uma janela: ~30 dias cada, mínimo 1, sem hardcode de calendário. */
export function temporalBucketCountOf(periodDays: number): number {
  return periodDays <= LONG_PERIOD_DAYS ? 1 : Math.max(2, Math.round(periodDays / 30))
}
