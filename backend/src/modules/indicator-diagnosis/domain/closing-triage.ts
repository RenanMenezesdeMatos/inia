import { z } from "zod"
import { officialDataComplete, previousSnapshotOf, quartileMovementOf, QUARTILES, withinReferenceOf, type OfficialIndicatorSnapshot, type PrvClosing, type Quartile } from "./prv-closing.js"

/**
 * INDICATOR DIAGNOSIS V1 — TRIAGEM DO FECHAMENTO (domínio puro, ZERO modelo). Antes de olhar uma chamada, decide QUAIS
 * indicadores do fechamento merecem investigação. A regra é da ESTRATÉGIA de cada indicador (configuração tipada, versionada,
 * presa à execução) — nunca uma lista de códigos no código:
 *
 *   developmentQuartiles     quartis oficiais que abrem investigação de desenvolvimento (ex.: TMA → Q3, Q4);
 *   belowTarget              fora da referência oficial abre investigação;
 *   quartileWorsened         piora de quartil em relação ao fechamento anterior abre investigação;
 *   recognitionQuartiles     quartis que abrem investigação de RECONHECIMENTO (ex.: Q1) — nunca procura gap.
 *
 * Um indicador fora da meta NÃO prova erro, falha ou causa: a triagem só decide ONDE olhar. Sem estratégia/regra = não
 * investigado (e dito por quê). Dado oficial incompleto = não investigado (nada é inferido).
 */
export const CLOSING_TRIAGE_VERSION = "CLOSING_TRIAGE_V1" as const

export const closingTriageSchema = z
  .object({
    enabled: z.boolean(),
    developmentQuartiles: z.array(z.enum(QUARTILES)).max(4),
    belowTarget: z.boolean(),
    quartileWorsened: z.boolean(),
    recognitionQuartiles: z.array(z.enum(QUARTILES)).max(4),
  })
  .strict()
export type ClosingTriageRule = z.infer<typeof closingTriageSchema>

/** Problemas de configuração (validação para publicar a estratégia). */
export function closingTriageIssues(rule: ClosingTriageRule | undefined): { code: string; field: string; message: string }[] {
  if (!rule || !rule.enabled) return []
  const issues: { code: string; field: string; message: string }[] = []
  const hasRule = rule.developmentQuartiles.length > 0 || rule.belowTarget || rule.quartileWorsened || rule.recognitionQuartiles.length > 0
  if (!hasRule) issues.push({ code: "STRATEGY_TRIAGE_WITHOUT_RULE", field: "closingTriage", message: "Escolha ao menos uma regra de triagem do fechamento." })
  if (new Set(rule.developmentQuartiles).size !== rule.developmentQuartiles.length || new Set(rule.recognitionQuartiles).size !== rule.recognitionQuartiles.length) issues.push({ code: "STRATEGY_TRIAGE_DUPLICATED", field: "closingTriage", message: "Quartil repetido na triagem." })
  const overlap = rule.developmentQuartiles.filter((quartile) => rule.recognitionQuartiles.includes(quartile))
  if (overlap.length > 0) issues.push({ code: "STRATEGY_TRIAGE_CONFLICT", field: "closingTriage.recognitionQuartiles", message: `O quartil ${overlap.join(", ")} não pode abrir investigação de desenvolvimento e de reconhecimento ao mesmo tempo.` })
  return issues
}

export type TriageDecisionKind = "INVESTIGATE" | "RECOGNIZE" | "SKIP"
export type TriageReason =
  | "QUARTILE_ELIGIBLE"
  | "BELOW_TARGET"
  | "QUARTILE_WORSENED"
  | "RECOGNITION_QUARTILE"
  | "STRATEGY_NOT_CONFIGURED"
  | "TRIAGE_NOT_CONFIGURED"
  | "NO_RULE_MATCHED"
  | "INCOMPLETE_OFFICIAL_DATA"
  | "RECOGNITION_OUTSIDE_TARGET"

export const TRIAGE_REASON_LABELS: Record<TriageReason, string> = {
  QUARTILE_ELIGIBLE: "quartil oficial dentro dos quartis que a estratégia investiga",
  BELOW_TARGET: "resultado oficial fora da referência",
  QUARTILE_WORSENED: "quartil oficial piorou em relação ao fechamento anterior",
  RECOGNITION_QUARTILE: "quartil oficial dentro dos quartis de reconhecimento",
  STRATEGY_NOT_CONFIGURED: "o indicador não tem estratégia de diagnóstico publicada e ativa",
  TRIAGE_NOT_CONFIGURED: "a estratégia do indicador não define triagem do fechamento",
  NO_RULE_MATCHED: "nenhuma regra de triagem da estratégia se aplica a este fechamento",
  INCOMPLETE_OFFICIAL_DATA: "dados oficiais incompletos para decidir (sem quartil nem referência)",
  RECOGNITION_OUTSIDE_TARGET: "quartil de reconhecimento, mas o resultado oficial está fora da referência",
}

export type TriageDecision = {
  indicatorCode: string
  indicatorName: string
  snapshotId: string
  decision: TriageDecisionKind
  reasons: TriageReason[]
  strategyVersionId: string | null
  strategyVersion: number | null
  official: { value: number; target: number | null; achievementPercent: number | null; weightPercent: number | null; quartile: Quartile | null; withinReference: boolean | null; previousQuartile: Quartile | null }
}

export type PrvTriage = { version: typeof CLOSING_TRIAGE_VERSION; referencePeriod: string; decisions: TriageDecision[] }

export type StrategyForTriage = { versionId: string; version: number; closingTriage: ClosingTriageRule | undefined } | null

/** Decisão para UM indicador do fechamento. Q1 = melhor, Q4 = pior (a posição vem da fonte oficial). */
export function triageIndicator(snapshot: OfficialIndicatorSnapshot, previous: OfficialIndicatorSnapshot | null, strategy: StrategyForTriage): TriageDecision {
  const withinReference = withinReferenceOf(snapshot)
  const base = {
    indicatorCode: snapshot.indicatorCode,
    indicatorName: snapshot.indicatorName,
    snapshotId: snapshot.snapshotId,
    strategyVersionId: strategy?.versionId ?? null,
    strategyVersion: strategy?.version ?? null,
    official: { value: snapshot.value, target: snapshot.target, achievementPercent: snapshot.achievementPercent, weightPercent: snapshot.weightPercent, quartile: snapshot.quartile, withinReference, previousQuartile: previous?.quartile ?? null },
  }
  const skip = (reason: TriageReason): TriageDecision => ({ ...base, decision: "SKIP", reasons: [reason] })
  if (!strategy) return skip("STRATEGY_NOT_CONFIGURED")
  const rule = strategy.closingTriage
  if (!rule || !rule.enabled) return skip("TRIAGE_NOT_CONFIGURED")
  if (!officialDataComplete(snapshot)) return skip("INCOMPLETE_OFFICIAL_DATA")
  const reasons: TriageReason[] = []
  if (snapshot.quartile && rule.developmentQuartiles.includes(snapshot.quartile)) reasons.push("QUARTILE_ELIGIBLE")
  if (rule.belowTarget && withinReference === false) reasons.push("BELOW_TARGET")
  if (rule.quartileWorsened && quartileMovementOf(previous?.quartile, snapshot.quartile) === "WORSENED") reasons.push("QUARTILE_WORSENED")
  if (reasons.length > 0) return { ...base, decision: "INVESTIGATE", reasons }
  if (snapshot.quartile && rule.recognitionQuartiles.includes(snapshot.quartile)) {
    // Reconhecimento nunca contradiz o resultado oficial: fora da referência não é elogiado.
    if (withinReference === false) return skip("RECOGNITION_OUTSIDE_TARGET")
    return { ...base, decision: "RECOGNIZE", reasons: ["RECOGNITION_QUARTILE"] }
  }
  return skip("NO_RULE_MATCHED")
}

/** Triagem do fechamento inteiro. `strategies` = estratégia EFETIVA por indicador (presa à execução). */
export function triageClosing(closing: PrvClosing, strategies: ReadonlyMap<string, StrategyForTriage>): PrvTriage {
  return {
    version: CLOSING_TRIAGE_VERSION,
    referencePeriod: closing.referencePeriod,
    decisions: closing.indicators.map((snapshot) => triageIndicator(snapshot, previousSnapshotOf(closing, snapshot.indicatorCode), strategies.get(snapshot.indicatorId) ?? null)),
  }
}

export const selectedForInvestigation = (triage: PrvTriage) => triage.decisions.filter((decision) => decision.decision !== "SKIP")
