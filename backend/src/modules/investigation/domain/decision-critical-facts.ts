import type { LedgerEntry } from "./evidence-ledger.js"
import type { InvestigationObjective } from "./investigation-objective.js"

/**
 * DECISION CRITICAL FACTS (V1.3.1 — §28–30): os fatos que, omitidos ou contraditos, mudariam a
 * decisão — valor × meta, tendência, comparação relevante, qualidade do dado, limitação de
 * representatividade. Extraídos por código dos RESULTADOS das Tools (sinais estruturados gravados
 * no trace), nunca do texto do modelo. A síntese declara `consideredCriticalFacts` e a aplicação
 * valida: todo fato crítico considerado, nenhuma contradição semântica, limitação crítica presente.
 * O texto NÃO precisa repetir todos os números ("houve melhora relevante" basta para IMPROVED).
 */
export type PerformanceSignal = "IMPROVED" | "DECLINED" | "STABLE" | "WORSE_THAN_REFERENCE" | "BETTER_THAN_REFERENCE" | "EQUAL_TO_REFERENCE"
export type DecisionSignals = {
  performance?: PerformanceSignal | null | undefined
  withinTarget?: boolean | null | undefined
  dataQuality?: string | null | undefined
  /** V1.3.2: cobertura temporal de uma amostra de interações (blocos da janela cobertos) — base da necessidade E_TEMPORAL_COVERAGE. */
  temporalCoverage?: { buckets: number; bucketsCovered: number } | null | undefined
  /** V1.3.2: contagens da análise de interações (analisadas × universo × achados por trecho verificado) — telemetria do QA Lab. */
  interactionAnalysis?: { analyzedTranscriptCount: number; recordedUniverseCount: number | null; universeRelationship: string | null; findings: number; verifiedExcerpts: number; evidenceVerification?: EvidenceVerificationSignal | null | undefined; /** V1.4.0: telemetria compacta da camada semântica (frames/findings/needs) — só contagens. */ semantic?: import("./interaction-semantic-frame.js").SemanticTelemetry | null | undefined; /** V1.4.0: kind derivado + suporte por pattern — base do gating de escopo por suporte. */ patterns?: import("./interaction-semantic-frame.js").PatternSupportSignal[] | undefined; /** V1.4.1: findings por interação (ref "I6/F1" + kind + atribuição) — base do binding de claims de interação. */ findingRefs?: { ref: string; /** V1.4.2: handle canônico de claim (SF-n). */ handle?: string | undefined; kind: import("./interaction-semantic-frame.js").InteractionFindingKind; attribution?: import("./interaction-semantic-frame.js").FindingAttribution | undefined; /** V1.4.5: lineage procedimental do finding (afirmação → regra da base → comparação determinística). */ procedural?: { status: import("./procedural-semantics.js").ProceduralComparisonStatus; hasRule: boolean; /** V1.4.9: lineage persistido até o InteractionFeedback (auditoria). */ assertionRef?: string | undefined; ruleRef?: string | null | undefined; documentTitle?: string | null | undefined } | undefined }[] | undefined; /** V1.4.5: avaliação procedimental desta análise (afirmações × regras verificadas × comparações) — base do gating procedimental. */ procedural?: { assertions: number; quantitiesParsed: number; excerptsAvailable: number; rulesDeclared: number; rulesVerified: number; rulesRejected: number; evaluations: number; byStatus: Record<import("./procedural-semantics.js").ProceduralComparisonStatus, number>; coverage: "PARTIAL" | "COMPLETE"; knowledgeSource: string; /** V1.4.5: uma linha por comparação — auditoria do falso positivo procedimental (§49). */ items?: { interactionRef: string; assertionRef: string; assertionModality: string; status: import("./procedural-semantics.js").ProceduralComparisonStatus; ruleModality: string | null; conditionMatch: string | null; /** V1.4.9: lineage da regra (handle da execução + handle do documento + título + trecho literal) — auditoria do InteractionFeedback; o mapa handle → id fica em `investigation.handles`. */ ruleRef?: string | null | undefined; documentRef?: string | null | undefined; documentTitle?: string | null | undefined; ruleQuote?: string | null | undefined }[] | undefined } | undefined; /** V1.4.6: RESULTADO × ATRIBUIÇÃO da análise — a base do gating de ownership e da métrica de falsa atribuição. */ outcome?: { needsTotal: number; needsOpen: number; attributionsDeclared: number; attributionsAccepted: number; byAttribution: Record<string, number>; agentAttributionRejected: number; bridges: Record<string, number>; findingsNeutralized: number; findingsAgentAttributed: number; patternsByOwnership: Record<string, number>; patternsScopeCappedByOwnership: number; sidecarStatus: string } | undefined } | null | undefined
  /** V1.3.4: comparação TEMPORAL validada pela aplicação (relação entre blocos) — distinta da cobertura; `behavioral` = veio de transcrições. */
  temporalComparison?: import("./temporal-semantics.js").TemporalComparisonSignal | null | undefined
}

/** V1.3.3: contagens da verificação literal por unidade (candidatas × validadas × descartadas por motivo; achados antes × depois). Só números. */
export type EvidenceVerificationSignal = { candidateExcerptCount: number; verifiedExcerptCount: number; rejectedExcerptCount: number; findingsBeforeVerification: number; findingsAfterVerification: number; rejectionReasons: Record<string, number>; turnRefMismatchResolved?: number; /** V1.3.4.2 (§28): referências ordinais traduzidas × rejeitadas. */ ordinalResolvedCount?: number; ordinalResolutionRejectedCount?: number }

/** Sinais determinísticos extraídos do `data` de uma Tool (só o que pode virar contradição). */
export function extractDecisionSignals(tool: string, data: unknown): DecisionSignals | null {
  const record = (data ?? {}) as Record<string, unknown>
  switch (tool) {
    case "get_indicator_snapshot": {
      const target = record.target as { withinTarget?: boolean | null } | null | undefined
      return target ? { withinTarget: target.withinTarget ?? null } : null
    }
    case "compare_periods":
      return typeof record.performanceDirection === "string" ? { performance: record.performanceDirection as PerformanceSignal } : null
    case "compare_population":
      return typeof record.performance === "string" ? { performance: record.performance as PerformanceSignal } : null
    case "get_employee_history": {
      const change = record.changeFirstToLast as { performance?: string | null } | null | undefined
      return change?.performance ? { performance: change.performance as PerformanceSignal } : null
    }
    case "validate_data_quality":
      return typeof record.analysisStatus === "string" ? { dataQuality: record.analysisStatus } : null
    case "analyze_interactions": {
      const coverage = record.temporalCoverage as { buckets?: number; bucketsCovered?: number } | null | undefined
      const findings = (record.findings as { verifiedExcerpts?: unknown[]; kind?: string; ownership?: string; handle?: string; support?: { level?: string; scope?: string; maximumClaimScope?: string; matchedTranscriptCount?: number; analyzedTranscriptCount?: number } }[] | undefined) ?? []
      const verification = record.evidenceVerification as EvidenceVerificationSignal | null | undefined
      const semantic = (record.semantic as { telemetry?: import("./interaction-semantic-frame.js").SemanticTelemetry } | null | undefined)?.telemetry ?? null
      // V1.4.0: suporte por pattern (kind derivado + nível) — só quando a camada semântica produziu o pattern.
      // V1.4.1: refs de BINDING — patterns "P{n}" (ordem do fato) e findings "I-ref/F-id" (frames) com o kind — base do claim ↔ pattern binding.
      // V1.4.2: handle canônico (SP-n/SF-n) + escopo de suporte e teto de claim por pattern — base do binding canônico e do cap de escopo.
      const patterns = findings.filter((item) => item.kind && item.support?.level).map((item, index) => ({ ref: `P${index + 1}`, ...(item.handle ? { handle: item.handle } : {}), ...(item.ownership ? { ownership: item.ownership as import("./outcome-attribution.js").Ownership } : {}), kind: item.kind as import("./interaction-semantic-frame.js").PatternKind, supportLevel: item.support!.level as import("./interaction-semantic-frame.js").PatternSupportLevel, ...(item.support!.scope ? { supportScope: item.support!.scope as import("./support-scope.js").SupportScope } : {}), ...(item.support!.maximumClaimScope ? { maximumClaimScope: item.support!.maximumClaimScope as import("./tool-trace.js").ClaimScope } : {}), matchedTranscriptCount: item.support!.matchedTranscriptCount ?? 0, analyzedTranscriptCount: item.support!.analyzedTranscriptCount ?? 0 }))
      const frames = (record.semantic as { frames?: { interactionRef: string; findings?: { id: string; kind: string; attribution?: string; handle?: string; procedural?: { status: string; assertionRef?: string; ruleRef: string | null; documentTitle?: string | null } }[] }[] } | null | undefined)?.frames ?? []
      const findingRefs = frames.flatMap((frame) => (frame.findings ?? []).map((finding) => ({ ref: `${frame.interactionRef}/${finding.id}`, ...(finding.handle ? { handle: finding.handle } : {}), kind: finding.kind as import("./interaction-semantic-frame.js").InteractionFindingKind, ...(finding.attribution ? { attribution: finding.attribution as import("./interaction-semantic-frame.js").FindingAttribution } : {}), ...(finding.procedural ? { procedural: { status: finding.procedural.status as import("./procedural-semantics.js").ProceduralComparisonStatus, hasRule: Boolean(finding.procedural.ruleRef), ...(finding.procedural.assertionRef ? { assertionRef: finding.procedural.assertionRef } : {}), ruleRef: finding.procedural.ruleRef ?? null, documentTitle: finding.procedural.documentTitle ?? null } } : {}) })))
      // V1.4.5: a avaliação procedimental da execução (o que a base REALMENTE sustenta) vira sinal — o gating deixa de depender
      // só de um fato `query_knowledge` no ledger para reconhecer evidência normativa verificada.
      const proceduralRecord = record.procedural as { evaluations?: { interactionRef: string; assertionRef: string; assertion?: { modality?: string }; status: string; rule?: { modality?: string; ruleRef?: string; documentRef?: string; documentTitle?: string; quote?: string } | null; conditionMatch?: string | null }[] } | null | undefined
      const proceduralItems = (proceduralRecord?.evaluations ?? []).map((item) => ({ interactionRef: item.interactionRef, assertionRef: item.assertionRef, assertionModality: item.assertion?.modality ?? "ASSERTED_FACT", status: item.status as import("./procedural-semantics.js").ProceduralComparisonStatus, ruleModality: item.rule?.modality ?? null, conditionMatch: item.conditionMatch ?? null, ruleRef: item.rule?.ruleRef ?? null, documentRef: item.rule?.documentRef ?? null, documentTitle: item.rule?.documentTitle ?? null, ruleQuote: item.rule?.quote ? item.rule.quote.slice(0, 400) : null }))
      const proceduralTelemetry = (record.procedural as { telemetry?: { assertionsDeclared?: number; quantitiesParsedAssertion?: number; knowledgeExcerptsAvailable?: number; rulesDeclared?: number; rulesVerified?: number; rulesRejected?: number; evaluations?: number; byStatus?: Record<string, number>; coverage?: string; knowledgeSource?: string } } | null | undefined)?.telemetry
      const procedural = proceduralTelemetry && typeof proceduralTelemetry.evaluations === "number" ? { assertions: proceduralTelemetry.assertionsDeclared ?? 0, quantitiesParsed: proceduralTelemetry.quantitiesParsedAssertion ?? 0, excerptsAvailable: proceduralTelemetry.knowledgeExcerptsAvailable ?? 0, rulesDeclared: proceduralTelemetry.rulesDeclared ?? 0, rulesVerified: proceduralTelemetry.rulesVerified ?? 0, rulesRejected: proceduralTelemetry.rulesRejected ?? 0, evaluations: proceduralTelemetry.evaluations, knowledgeSource: proceduralTelemetry.knowledgeSource ?? "NONE", ...(proceduralItems.length > 0 ? { items: proceduralItems } : {}), byStatus: (proceduralTelemetry.byStatus ?? {}) as Record<import("./procedural-semantics.js").ProceduralComparisonStatus, number>, coverage: (proceduralTelemetry.coverage === "COMPLETE" ? "COMPLETE" : "PARTIAL") as "PARTIAL" | "COMPLETE" } : null
      // V1.4.6: o sidecar de resultado × atribuição vira sinal do fato (telemetria + ownership dos patterns).
      const outcomeRecord = (record.outcome as { telemetry?: Record<string, unknown> } | null | undefined)?.telemetry
      const outcome = outcomeRecord && typeof outcomeRecord.needsTotal === "number" ? { needsTotal: outcomeRecord.needsTotal as number, needsOpen: (outcomeRecord.needsOpen as number) ?? 0, attributionsDeclared: (outcomeRecord.attributionsDeclared as number) ?? 0, attributionsAccepted: (outcomeRecord.attributionsAccepted as number) ?? 0, byAttribution: (outcomeRecord.byAttribution as Record<string, number>) ?? {}, agentAttributionRejected: (outcomeRecord.agentAttributionRejected as number) ?? 0, bridges: (outcomeRecord.bridges as Record<string, number>) ?? {}, findingsNeutralized: (outcomeRecord.findingsNeutralized as number) ?? 0, findingsAgentAttributed: (outcomeRecord.findingsAgentAttributed as number) ?? 0, patternsByOwnership: ((semantic as { patternsByOwnership?: Record<string, number> } | null)?.patternsByOwnership) ?? {}, patternsScopeCappedByOwnership: ((semantic as { patternsScopeCappedByOwnership?: number } | null)?.patternsScopeCappedByOwnership) ?? 0, sidecarStatus: (outcomeRecord.sidecarStatus as string) ?? "SKIPPED" } : null
      const analysis = typeof record.analyzedTranscriptCount === "number" ? { analyzedTranscriptCount: record.analyzedTranscriptCount, recordedUniverseCount: typeof record.recordedUniverseCount === "number" ? record.recordedUniverseCount : null, universeRelationship: typeof record.universeRelationship === "string" ? record.universeRelationship : null, findings: findings.length, verifiedExcerpts: findings.reduce((sum, item) => sum + (item.verifiedExcerpts?.length ?? 0), 0), ...(verification && typeof verification.candidateExcerptCount === "number" ? { evidenceVerification: verification } : {}), ...(semantic ? { semantic, patterns, findingRefs } : {}), ...(procedural ? { procedural } : {}), ...(outcome ? { outcome } : {}) } : null
      const temporal = coverage && typeof coverage.buckets === "number" && typeof coverage.bucketsCovered === "number" ? { buckets: coverage.buckets, bucketsCovered: coverage.bucketsCovered } : null
      const comparison = record.temporalComparison as { status?: string; comparedBuckets?: string[]; analyzedBuckets?: string[]; bucketCount?: number; countsByFinding?: { absenceEstablished?: boolean }[][]; findings?: { relation: string; earlierBucket: string; laterBucket: string; directionSupported: boolean | null; relationValidationStatus?: string; relationValidationReason?: string | null; sampleDifference?: boolean; trendSupported?: boolean; supportScope?: string }[] } | null | undefined
      // V1.3.4.1: o sinal carrega o status de validação POR RELAÇÃO (sustentada × só na amostra) e os blocos analisados — base do gating por relação.
      const temporalComparison = comparison && typeof comparison.status === "string" ? { status: comparison.status as import("./temporal-semantics.js").TemporalComparisonStatus, comparedBuckets: comparison.comparedBuckets ?? [], behavioral: true, ...(Array.isArray(comparison.analyzedBuckets) ? { analyzedBuckets: comparison.analyzedBuckets } : {}), ...(typeof comparison.bucketCount === "number" ? { bucketCount: comparison.bucketCount } : {}), ...(Array.isArray(comparison.countsByFinding) ? { absenceEstablished: comparison.countsByFinding.some((row) => row.some((count) => count.absenceEstablished === true)) } : {}), findings: (comparison.findings ?? []).map((item) => ({ relation: item.relation as import("./temporal-semantics.js").TemporalFindingRelation, earlierBucket: item.earlierBucket, laterBucket: item.laterBucket, directionSupported: item.directionSupported, ...(item.relationValidationStatus ? { relationValidationStatus: item.relationValidationStatus as import("./temporal-semantics.js").RelationValidationStatus } : {}), ...(item.relationValidationReason !== undefined ? { relationValidationReason: item.relationValidationReason } : {}), ...(typeof item.sampleDifference === "boolean" ? { sampleDifference: item.sampleDifference } : {}), ...(typeof item.trendSupported === "boolean" ? { trendSupported: item.trendSupported } : {}), ...(item.supportScope ? { supportScope: item.supportScope as import("./temporal-semantics.js").TemporalSupportScope } : {}) })) } : null
      return temporal || analysis || temporalComparison ? { ...(temporal ? { temporalCoverage: temporal } : {}), ...(analysis ? { interactionAnalysis: analysis } : {}), ...(temporalComparison ? { temporalComparison } : {}) } : null
    }
    case "find_interactions": {
      const sampling = record.sampling as { periodBuckets?: unknown[]; selectedPerBucket?: number[] } | null | undefined
      return sampling && Array.isArray(sampling.selectedPerBucket) && sampling.selectedPerBucket.length > 0 ? { temporalCoverage: { buckets: sampling.selectedPerBucket.length, bucketsCovered: sampling.selectedPerBucket.filter((count) => count > 0).length } } : null
    }
    default:
      return null
  }
}

export type CriticalFactKind = "INDICATOR_STATE" | "TREND" | "COMPARISON" | "DATA_QUALITY"
export type CriticalFact = { ref: string; kind: CriticalFactKind; label: string; signals: DecisionSignals }

const KIND_LABELS: Record<CriticalFactKind, string> = { INDICATOR_STATE: "valor × meta", TREND: "tendência", COMPARISON: "comparação com a referência", DATA_QUALITY: "qualidade do dado" }

/** Fatos críticos = primeiro fato de cada tipo relevante ao objetivo (o modelo cita as refs em `consideredCriticalFacts`). */
export function criticalFactsOf(ledger: LedgerEntry[], objective: InvestigationObjective | null | undefined): CriticalFact[] {
  if (!objective) return []
  const indicatorObjective = objective.kind !== "FEEDBACK_SINGLE_INTERACTION" && objective.kind !== "PROCESS_AUDIT"
  if (!indicatorObjective) return []
  const facts: CriticalFact[] = []
  const pick = (tool: string, kind: CriticalFactKind) => {
    const entry = ledger.find((item) => item.tool === tool && item.signals && item.qualityStatus !== "NO_DATA" && item.qualityStatus !== "NOT_SUPPORTED")
    if (entry && !facts.some((fact) => fact.kind === kind)) facts.push({ ref: entry.ref, kind, label: KIND_LABELS[kind], signals: entry.signals! })
  }
  pick("get_indicator_snapshot", "INDICATOR_STATE")
  pick("compare_periods", "TREND")
  pick("get_employee_history", "TREND")
  pick("compare_population", "COMPARISON")
  const quality = ledger.find((item) => item.tool === "validate_data_quality" && item.signals?.dataQuality && item.signals.dataQuality !== "SUFFICIENT")
  if (quality) facts.push({ ref: quality.ref, kind: "DATA_QUALITY", label: KIND_LABELS.DATA_QUALITY, signals: quality.signals! })
  return facts
}

/** Padrões lexicais que CONTRADIZEM o sinal (conservadores — só afirmações inequívocas). */
const CONTRADICTIONS: { when: (signals: DecisionSignals) => boolean; pattern: RegExp; reason: string }[] = [
  { when: (s) => s.performance === "IMPROVED", pattern: /\b(piorou|piora(?:ndo)?|deteriorou|regrediu|vem aumentando|tend[êe]ncia de (?:alta|piora|aumento)|aumento (?:gradual|consistente|progressivo))\b/i, reason: "o fato indica MELHORA em relação ao período anterior, mas o texto afirma piora" },
  { when: (s) => s.performance === "DECLINED", pattern: /\b(melhorou|melhora(?:ndo)?|evolu[çc][ãa]o positiva|tend[êe]ncia de (?:queda|melhora|redu[çc][ãa]o)|redu[çc][ãa]o (?:consistente|progressiva))\b/i, reason: "o fato indica PIORA em relação ao período anterior, mas o texto afirma melhora" },
  { when: (s) => s.performance === "WORSE_THAN_REFERENCE", pattern: /\b(abaixo da m[ée]dia (?:do|da|dos) (?:subgrupo|grupo|pares|equipe)|melhor (?:que|do que) (?:o|a|os) (?:subgrupo|grupo|pares|equipe)|dentro da m[ée]dia (?:do|da|dos) (?:subgrupo|grupo|pares))\b/i, reason: "o fato indica resultado PIOR que a referência, mas o texto afirma o contrário" },
  { when: (s) => s.performance === "BETTER_THAN_REFERENCE", pattern: /\b(acima da m[ée]dia (?:do|da|dos) (?:subgrupo|grupo|pares|equipe)|pior (?:que|do que) (?:o|a|os) (?:subgrupo|grupo|pares|equipe))\b/i, reason: "o fato indica resultado MELHOR que a referência, mas o texto afirma o contrário" },
  { when: (s) => s.withinTarget === false, pattern: /\b(dentro da meta|atingiu a meta|meta atingida|bateu a meta)\b/i, reason: "o indicador está FORA da meta, mas o texto afirma que a meta foi atingida" },
  { when: (s) => s.withinTarget === true, pattern: /\b(fora da meta|abaixo da meta|n[ãa]o atingiu a meta|acima da meta)\b/i, reason: "o indicador está DENTRO da meta, mas o texto afirma o contrário" },
]

export type FactPreservationInput = {
  criticalFacts: CriticalFact[]
  consideredCriticalFacts: string[]
  /** Texto que o colaborador lê (title + summary + recommendation ou a resposta de texto). */
  text: string
  /** Limitação crítica exigida (ex.: representatividade anedótica num objetivo causal) e se foi declarada. */
  criticalLimitationRequired: boolean
  limitationsDeclared: number
}

export type FactPreservationRejection = { kind: "CRITICAL_FACT"; text: string; reason: string }

/** Omissão da DECLARAÇÃO (não uma contradição): corrige uma vez; persistindo, a resposta passa com a omissão registrada — só contradição/limitação crítica descartam. */
export const UNDECLARED_CRITICAL_FACTS_REASON = "fato crítico à decisão não declarado em consideredCriticalFacts — liste as refs consideradas (não é preciso repetir todos os números)"
export function isUndeclaredCriticalFacts(rejection: { kind: string; reason: string }): boolean {
  return rejection.kind === "CRITICAL_FACT" && rejection.reason === UNDECLARED_CRITICAL_FACTS_REASON
}

/** FACT PRESERVATION CONTRACT (§29): validação por código, sem LLM juiz. */
export function checkFactPreservation(input: FactPreservationInput): FactPreservationRejection[] {
  const rejections: FactPreservationRejection[] = []
  const considered = new Set(input.consideredCriticalFacts.map((ref) => ref.trim().toUpperCase()))
  const missing = input.criticalFacts.filter((fact) => !considered.has(fact.ref.toUpperCase()))
  if (missing.length > 0) rejections.push({ kind: "CRITICAL_FACT", text: missing.map((fact) => `${fact.ref} (${fact.label})`).join(", "), reason: UNDECLARED_CRITICAL_FACTS_REASON })
  for (const fact of input.criticalFacts) {
    for (const rule of CONTRADICTIONS) {
      if (rule.when(fact.signals) && rule.pattern.test(input.text)) rejections.push({ kind: "CRITICAL_FACT", text: `${fact.ref} (${fact.label})`, reason: rule.reason })
    }
  }
  if (input.criticalLimitationRequired && input.limitationsDeclared === 0) rejections.push({ kind: "CRITICAL_FACT", text: "limitações", reason: "a evidência de interações é insuficiente/anedótica para o objetivo — a limitação precisa ser declarada em limitations e refletida no texto" })
  return rejections
}
