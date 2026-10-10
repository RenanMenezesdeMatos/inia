import { TOOL_QUALITY_STATUS_LABELS, type ToolResult } from "../domain/tool-output.js"
import type { ToolKey } from "../domain/tool-catalog.js"

/** Uma linha legível por resultado — o que fica no trace e o que o QA Lab mostra. Determinístico. */
export function summarizeToolResult(key: ToolKey, result: ToolResult): string {
  const data = (result.data ?? {}) as Record<string, unknown>
  const quality = result.quality.status !== "SUFFICIENT" ? ` · ${TOOL_QUALITY_STATUS_LABELS[result.quality.status]}${result.quality.note ? ` (${result.quality.note})` : ""}` : ""
  try {
    switch (key) {
      case "get_indicator_snapshot": {
        const operational = data.operational as { formatted?: string | null; sampleCount?: number; coverage?: number | null } | null
        const target = data.target as { value?: number; withinTarget?: boolean | null; gap?: number | null; gapPercent?: number | null } | null
        const official = data.official as { latest?: { referencePeriod: string; value: number; quartile: string | null } } | null
        const parts = [operational?.formatted ? `${operational.formatted} no período` : "sem valor operacional", target ? `meta ${target.value}${target.withinTarget === null ? "" : target.withinTarget ? " (dentro" : " (fora"}${target.withinTarget !== null && target.gap !== null && target.gap !== undefined ? `, ${target.gap > 0 ? "+" : ""}${fmt(target.gap)}${target.gapPercent !== null && target.gapPercent !== undefined ? ` / ${target.gapPercent > 0 ? "+" : ""}${fmt(target.gapPercent)}%` : ""})` : target.withinTarget === null ? "" : ")"}` : "sem meta", operational ? `${operational.sampleCount} medição(ões), cobertura ${pct(operational.coverage)}` : null, official?.latest ? `oficial ${official.latest.referencePeriod}: ${official.latest.value}${official.latest.quartile ? ` ${official.latest.quartile}` : ""}` : null]
        return `${(data.indicator as { code: string }).code}: ${parts.filter(Boolean).join(" · ")}${quality}`
      }
      case "compare_periods": {
        const current = data.current as { value: number | null; period: string }
        const reference = data.reference as { value: number | null; period: string }
        return `${current.period}: ${fmt(current.value)} × ${reference.period}: ${fmt(reference.value)} → ${fmt(data.absoluteDifference as number | null)} (${fmt(data.relativeDifferencePercent as number | null)}%) · ${String(data.performanceDirection ?? "—")}${quality}`
      }
      case "get_available_dimensions": {
        const dimensions = data.dimensions as { dimension: string; available: boolean }[]
        return `disponíveis: ${dimensions.filter((item) => item.available).map((item) => item.dimension).join(", ") || "nenhuma"}; indisponíveis: ${dimensions.filter((item) => !item.available).map((item) => item.dimension).join(", ") || "nenhuma"}`
      }
      case "segment_indicator": {
        const buckets = data.buckets as { dimensionValue: string; indicatorValue?: number | null; value?: number; sampleCount: number }[] | undefined
        if (!buckets) return `${String(data.dimension)}: ${String(data.status ?? "")}${quality}`
        const top = [...buckets].sort((left, right) => right.sampleCount - left.sampleCount).slice(0, 4).map((bucket) => `${bucket.dimensionValue}=${fmt(bucket.indicatorValue ?? bucket.value ?? null)} (n=${bucket.sampleCount})`)
        return `${String(data.dimension)} (${String(data.metric).split(" — ")[0]}): ${buckets.length} bucket(s) — ${top.join(", ")}${quality}`
      }
      case "compare_population":
        return data.status ? `${String(data.reference)}: ${String(data.status)}${quality}` : `${String(data.reference)}: colaborador ${fmt(data.targetValue as number | null)} × população ${fmt(data.referenceValue as number | null)} (n=${String(data.referencePopulation)}) → ${fmt(data.difference as number | null)} (${fmt(data.differencePercent as number | null)}%) · ${String(data.performance ?? "—")}${quality}`
      case "inspect_indicator_composition": {
        const components = data.components as { label: string; value: number | null }[] | undefined
        return components ? `${String(data.status)}: ${components.map((component) => `${component.label}=${fmt(component.value)}`).join(", ")}${quality}` : `${String(data.status)}${quality}`
      }
      case "validate_data_quality":
        return `${String(data.analysisStatus)} — amostra ${String(data.sampleCount ?? "—")}/${String(data.minimumSample ?? "—")}, cobertura ${pct(data.coverage as number | null)}/${pct(data.minimumCoverage as number | null)}${data.note ? ` (${String(data.note)})` : ""}`
      case "detect_anomalies": {
        const anomalies = data.anomalies as { date: string; observedValue: number; performance: string }[]
        return `${String(data.pattern)} — baseline ${fmt(data.baseline as number | null)}, ${anomalies.length} ponto(s) fora em ${String(data.pointsAnalyzed)} dia(s)${data.anomalySharePercent !== null && data.anomalySharePercent !== undefined ? ` (${fmt(data.anomalySharePercent as number)}%)` : ""}${anomalies.length > 0 ? `: ${anomalies.slice(0, 3).map((point) => `${point.date}=${point.observedValue} (${point.performance})`).join(", ")}` : ""}${quality}`
      }
      case "get_employee_history": {
        const series = data.series as { value?: number | null; weekStart?: string; referencePeriod?: string; achievementPercent?: number | null; quartile?: string | null }[]
        const change = data.changeFirstToLast as { from: number; to: number; absolute: number; percent: number | null; performance: string | null } | null | undefined
        return `${String(data.layer)}: ${series.length} ponto(s) — ${series.slice(-4).map((point) => point.weekStart ? `${point.weekStart}=${fmt(point.value ?? null)}` : `${point.referencePeriod}=${fmt(point.value ?? null)}${point.quartile ? ` ${point.quartile}` : ""}`).join(", ")}${change ? ` · do 1º ao último ponto: ${fmt(change.from)} → ${fmt(change.to)} (${change.absolute > 0 ? "+" : ""}${fmt(change.absolute)}${change.percent !== null ? ` / ${change.percent > 0 ? "+" : ""}${fmt(change.percent)}%` : ""})${change.performance ? ` · ${change.performance}` : ""}` : ""}${quality}`
      }
      case "find_interactions":
        return `${String(data.returned)} de ${String(data.total)} interação(ões)${data.returnedSharePercent !== null && data.returnedSharePercent !== undefined ? ` (${fmt(data.returnedSharePercent as number)}%)` : ""} (${String(data.orderBy)})${quality}`
      case "get_interaction_context":
        return data ? `${String(data.localDate)} ${String(data.localTime)} · ${String(data.subject)} · ${String(data.durationSeconds)} s · flags: ${((data.flags as { flag: string }[]) ?? []).map((flag) => flag.flag).join(", ") || "nenhuma"}${quality}` : `sem interação${quality}`
      case "get_interaction_flags": {
        const flags = data.flags as { flag: string; count: number; sharePercent?: number | null }[]
        return `${String(data.interactionsInSet)} interação(ões): ${flags.map((flag) => `${flag.flag}×${flag.count}${flag.sharePercent !== null && flag.sharePercent !== undefined ? ` (${fmt(flag.sharePercent)}%)` : ""}`).join(", ") || "sem flags"}${quality}`
      }
      case "find_comparable_interactions":
        return data.status ? `${String(data.status)}${quality}` : `${String(data.comparableInteractions)} comparável(is) de ${String(data.distinctOperators)} operador(es) · média referência ${fmt(data.referenceAverageDurationSeconds as number | null)} s × própria ${fmt(data.ownAverageDurationSeconds as number | null)} s${(() => { const delta = data.ownVersusReference as { absolute: number; percent: number | null } | null | undefined; return delta ? ` → própria ${delta.absolute > 0 ? "+" : ""}${fmt(delta.absolute)} s${delta.percent !== null ? ` (${delta.percent > 0 ? "+" : ""}${fmt(delta.percent)}%)` : ""}` : "" })()}${quality}`
      case "analyze_interactions":
      case "analyze_peer_patterns": {
        // V1.3.2: contagem sem ambiguidade — "≥N de M analisadas" = transcrições com trecho verificado (limite inferior), nunca prevalência no período.
        const findings = (data.findings as { finding: string; matchedTranscriptCount: number; matchedShareOfAnalyzedPercent?: number | null; prevalenceInUniversePercent?: number | null; kind?: string; ownership?: string; support?: { level: string; reason: string; scope?: string; maximumClaimScope?: string }; findingRefs?: string[]; handle?: string }[]) ?? []
        // V1.4.0: resumo compacto da camada semântica (frames → findings) e, por pattern, kind derivado + nível de suporte —
        // a síntese lê "REPEATED_IN_SAMPLE" e sabe que não pode escrever "padrão do colaborador".
        const semantic = data.semantic as { frames?: { interactionRef: string; findings: { id: string; kind: string; summary: string; source?: string; handle?: string }[] }[]; telemetry: { semanticFramesCreated: number; interactionsWithFindings: number; strengthFindingsCount: number; riskFindingsCount: number; interactionFrictionFindingsCount?: number; unresolvedNeedsCount: number; partialNeedsCount: number; proceduralQuestionsCount: number; procedureAssertionsCount: number; crossInteractionPatternsCount: number; phaseBPromotedFindings?: number } } | null | undefined
        // V1.4.1: findings por interação (binding de claims INTERACTION_SPECIFIC) — resumo curto, sem trechos.
        // V1.4.2: o nome model-facing é o handle CANÔNICO SF-n ("SF3 [STRENGTH] I6: …"); a ref composta "I6/F1" só aparece em runs sem handle.
        const findingHandleOf = new Map<string, string>()
        for (const frame of semantic?.frames ?? []) for (const finding of frame.findings) if (finding.handle) findingHandleOf.set(`${frame.interactionRef}/${finding.id}`, finding.handle)
        const findingLines = semantic?.frames ? semantic.frames.flatMap((frame) => frame.findings.map((finding) => `${finding.handle ? `${finding.handle} [${finding.kind}] ${frame.interactionRef}:` : `${frame.interactionRef}/${finding.id} [${finding.kind}]`} ${finding.summary.length > 70 ? `${finding.summary.slice(0, 67)}…` : finding.summary}`)) : []
        const semanticNote = semantic ? ` · SEMÂNTICA: ${semantic.telemetry.semanticFramesCreated} frame(s), ${semantic.telemetry.interactionsWithFindings} com finding — ${semantic.telemetry.strengthFindingsCount} força(s), ${semantic.telemetry.riskFindingsCount} risco(s), ${semantic.telemetry.interactionFrictionFindingsCount ?? 0} atrito(s) sem atribuição, ${semantic.telemetry.unresolvedNeedsCount + semantic.telemetry.partialNeedsCount} necessidade(s) não resolvida(s)/parcial(is), ${semantic.telemetry.proceduralQuestionsCount} questão(ões) procedimental(is)${semantic.telemetry.procedureAssertionsCount > 0 ? ` (${semantic.telemetry.procedureAssertionsCount} afirmação(ões) normativa(s) a verificar na base — não conclua erro sem a base)` : ""}${(semantic.telemetry.phaseBPromotedFindings ?? 0) > 0 ? `; ${semantic.telemetry.phaseBPromotedFindings} promovido(s) na síntese` : ""}${findingLines.length > 0 ? `; findings: ${findingLines.join(" | ")}` : ""}` : ""
        const analyzed = Number(data.analyzedTranscriptCount ?? 0)
        const universe = data.recordedUniverseCount as number | null | undefined
        const relationship = data.universeRelationship as string | undefined
        const coverage = relationship === "FULL_COVERAGE" ? ` (= todas as ${String(universe)} do período)` : relationship === "PARTIAL_COVERAGE" ? ` de ${String(universe)} registradas no período (${fmt(data.analyzedShareOfUniversePercent as number | null)}%)` : ""
        const temporal = data.temporalCoverage as { buckets: number; bucketsCovered: number } | undefined
        const temporalNote = temporal && temporal.buckets > 1 ? ` · cobertura temporal ${temporal.bucketsCovered}/${temporal.buckets} bloco(s)` : ""
        // V1.3.4: COMPARAÇÃO temporal validada (≠ cobertura) — o que a síntese pode usar para sustentar relação entre momentos.
        const comparison = data.temporalComparison as { status: string; comparedBuckets: string[]; statusNormalization?: string; declaredStatus?: string; findings: { relation: string; subjectFindingIndex: number; earlierBucket: string; laterBucket: string; directionSupported: boolean | null; relationValidationStatus?: string; relationValidationReason?: string | null; shareDeltaPercentagePoints: number | null; supportScope?: string }[]; countsByFinding?: { bucketRef: string; analyzedTranscriptCount: number; matchedTranscriptCount: number; universeCount?: number | null }[][] } | null | undefined
        // V1.3.4.1: diferença SÓ NA AMOSTRA é dita como fato de amostra (analisadas × universo por bloco) — nunca como "deixou de ocorrer".
        const sampleFact = (item: NonNullable<typeof comparison>["findings"][number]) => {
          const row = comparison?.countsByFinding?.[item.subjectFindingIndex]
          const cell = (ref: string) => row?.find((count) => count.bucketRef === ref)
          const describe = (ref: string) => { const count = cell(ref); return count ? `${ref} ${count.matchedTranscriptCount} de ${count.analyzedTranscriptCount} analisada(s)${typeof count.universeCount === "number" ? ` (universo ${count.universeCount})` : ""}` : ref }
          return `achado ${item.subjectFindingIndex + 1} ${describe(item.earlierBucket)} × ${describe(item.laterBucket)}`
        }
        const comparisonNote = comparison
          ? comparison.status === "DIFFERENCE_OBSERVED"
            ? ` · COMPARAÇÃO TEMPORAL ${comparison.comparedBuckets.join("×")}: diferença sustentada — ${comparison.findings.filter((item) => item.directionSupported === true).map((item) => `achado ${item.subjectFindingIndex + 1} ${item.relation} ${item.earlierBucket}→${item.laterBucket}${item.shareDeltaPercentagePoints !== null ? ` (${item.shareDeltaPercentagePoints > 0 ? "+" : ""}${fmt(item.shareDeltaPercentagePoints)} p.p. na amostra)` : ""}${item.supportScope ? ` [escopo de suporte ${item.supportScope}${item.supportScope === "SAMPLE" ? ": vale só para as amostras comparadas — não afirme mudança do colaborador" : item.supportScope === "RECORDED_UNIVERSE" ? ": vale para as interações registradas, não como traço do colaborador" : ""}]` : ""}`).join(", ")}`
            : comparison.status === "SAMPLE_DIFFERENCE_ONLY"
              ? ` · COMPARAÇÃO TEMPORAL ${comparison.comparedBuckets.join("×")}: diferença SÓ NA AMOSTRA, não sustentada — ${comparison.findings.filter((item) => item.relationValidationStatus === "SAMPLE_DIFFERENCE_ONLY").map(sampleFact).join(", ") || "amostras diferem"} (ausência na amostra ≠ ausência no bloco: não afirme "deixou de ocorrer", mudança, tendência nem concentração no período; descreva só o fato da amostra)`
              : comparison.status === "NO_DIFFERENCE_SUPPORTED"
                // V1.3.4.2: "nenhuma diferença sustentada" ≠ "estável" — o ledger diz explicitamente o que pode ser escrito.
                ? ` · COMPARAÇÃO TEMPORAL ${comparison.comparedBuckets.join("×")}: nenhuma diferença sustentada entre os blocos${comparison.findings.some((item) => item.relation === "STABLE" && item.relationValidationStatus === "SUPPORTED") ? ` — estabilidade SUSTENTADA (${comparison.findings.filter((item) => item.relation === "STABLE" && item.relationValidationStatus === "SUPPORTED").map((item) => `achado ${item.subjectFindingIndex + 1} ${item.earlierBucket}→${item.laterBucket}`).join(", ")})` : ' (NÃO é "permaneceu estável": escreva "não foi encontrada diferença temporal sustentada nas evidências analisadas")'}`
                : ` · COMPARAÇÃO TEMPORAL: insuficiente${comparison.statusNormalization === "RELATION_AS_STATUS" ? ` (status declarado "${comparison.declaredStatus ?? ""}" é relação, não status — não promovido)` : ""} (não afirme mudança, tendência, estabilidade nem posição no período)`
          : ""
        // V1.4.2: patterns pelo handle CANÔNICO SP-n (binding `support.patternRef`), com nível ("quanto se repetiu") E escopo/teto de
        // claim ("até onde generaliza") separados; findings sustentadores por SF-n. Cap de 3 mantido; runs sem handle mostram P-n.
        const render = (item: (typeof findings)[number], index: number) => `${semantic ? `${item.handle ?? `P${index + 1}`} ` : ""}"${item.finding}" (${item.kind ? `${item.kind}; ` : ""}trecho verificado em ≥${item.matchedTranscriptCount} de ${analyzed} analisadas${item.prevalenceInUniversePercent !== null && item.prevalenceInUniversePercent !== undefined ? `; ${fmt(item.prevalenceInUniversePercent)}% do período` : ""}${item.support ? `; nível ${item.support.level}${item.support.scope ? `; escopo ${item.support.scope} → claim até ${item.support.maximumClaimScope}` : ""}` : ""}${item.ownership && item.ownership !== "AGENT" ? `; dono ${item.ownership} (não é conduta do operador)` : ""}${item.findingRefs && item.findingRefs.length > 0 && findingHandleOf.size > 0 ? `; findings ${item.findingRefs.map((ref) => findingHandleOf.get(ref) ?? ref).join(", ")}` : ""})`
        const legend = semantic && findings.length > 0 ? (findings.some((item) => item.handle) ? " [nível = quanto se repetiu; escopo = até onde generalizar: SAMPLE só \"nas interações analisadas\" (INTERACTION_SPECIFIC); PERIOD/RECORDED_UNIVERSE \"no período analisado\" (PERIOD_PATTERN); só EMPLOYEE_PATTERN sustenta \"o colaborador costuma/apresenta\" (EMPLOYEE_PATTERN). Claims citam support.patternRef = SP-n ou support.findingRef = SF-n — nunca F-n/P-n]" : " [suporte: OBSERVED/REPEATED_IN_SAMPLE sustentam só \"nas interações analisadas\"; RECURRENT_IN_SAMPLE sustenta padrão no período; só EMPLOYEE_PATTERN_SUPPORTED sustenta padrão do colaborador; claims citam o pattern por F-n/P-n]") : ""
        // V1.4.5: a avaliação PROCEDIMENTAL da execução entra no ledger como fato — afirmação normativa × regra da base com
        // trecho literal, comparada por código. "Nenhuma regra aplicável" é resultado legítimo, e é dito explicitamente.
        const procedural = data.procedural as { telemetry?: { assertionsDeclared: number; rulesVerified: number; byStatus: Record<string, number>; coverage: string; knowledgeSource: string } } | null | undefined
        const proceduralNote = procedural?.telemetry && procedural.telemetry.assertionsDeclared > 0
          ? ` · PROCEDIMENTO: ${procedural.telemetry.assertionsDeclared} afirmação(ões) normativa(s) × ${procedural.telemetry.rulesVerified} regra(s) da base com trecho literal → ${Object.entries(procedural.telemetry.byStatus).filter(([, count]) => count > 0).map(([status, count]) => `${count}× ${status}`).join(", ") || "nenhuma comparação"}${procedural.telemetry.rulesVerified === 0 ? " (sem regra aplicável na base recuperada: questão procedimental a verificar, nunca erro confirmado)" : ""} [cobertura ${procedural.telemetry.coverage}: a avaliação cobre só os pontos confrontados — nunca "seguiu integralmente o procedimento"]`
          : ""
        // V1.4.6: o RESULTADO das necessidades e de quê ele depende — dito explicitamente para que a síntese não confunda
        // "ficou em aberto" com "o colaborador falhou".
        const outcome = data.outcome as { telemetry?: { needsTotal: number; needsOpen: number; byAttribution: Record<string, number>; agentAttributionRejected: number; findingsAgentAttributed: number; sidecarStatus: string } } | null | undefined
        const outcomeNote = outcome?.telemetry && outcome.telemetry.needsOpen > 0
          ? ` · NECESSIDADES: ${outcome.telemetry.needsOpen} em aberto de ${outcome.telemetry.needsTotal} — ${Object.entries(outcome.telemetry.byAttribution).filter(([, count]) => count > 0).map(([kind, count]) => `${count}× ${kind}`).join(", ") || "nenhuma atribuição"}${outcome.telemetry.agentAttributionRejected > 0 ? ` (${outcome.telemetry.agentAttributionRejected} atribuição(ões) ao operador recusada(s) por falta de ponte)` : ""} [necessidade em aberto é RESULTADO da interação; só ${outcome.telemetry.findingsAgentAttributed} está ligada à conduta do operador — dependência externa, do cliente ou do processo não é falha dele]`
          : ""
        return `${analyzed} transcrição(ões) analisada(s)${coverage}${temporalNote}${semanticNote}${proceduralNote}${outcomeNote}: ${findings.length} ${semantic ? "pattern(s)" : "achado(s)"} com evidência${findings.length > 0 ? ` — ${findings.slice(0, 3).map(render).join("; ")}` : ""}${findings.length > 3 ? ` (+${findings.length - 3} pattern(s) não listado(s))` : ""}${findings.length > 0 && relationship !== "FULL_COVERAGE" ? " [contagem = transcrições analisadas com trecho citado, limite inferior; não é prevalência no período]" : ""}${legend}${comparisonNote}${quality}`
      }
      case "inspect_work_context":
        return `${String(data.eligibleDays)} dia(s) elegível(is) de ${String(data.calendarDays)} · ${String(data.observedWorkedDays)} com produção observada · situações: ${((data.functionalStatuses as { label: string; days: number }[]) ?? []).map((item) => `${item.label} ${item.days}d`).join(", ") || "só em produção"}${quality}`
      case "query_knowledge": {
        const evidence = data.knowledgeEvidence as { documentTitle: string; excerpts: unknown[] }[]
        return `${String(data.mode)}: ${evidence.map((document) => `"${document.documentTitle}" (${document.excerpts.length} trecho(s))`).join(", ") || "nenhum trecho"}${quality}`
      }
      case "recommend_support_materials": {
        const accepted = data.accepted as { title: string }[]
        return `${accepted.length} material(is) aceito(s)${accepted.length > 0 ? `: ${accepted.map((item) => `"${item.title}"`).join(", ")}` : ""}${quality}`
      }
      case "synthesize_evidence":
        return `${((data.facts as unknown[]) ?? []).length} fato(s), ${((data.supportedHypotheses as unknown[]) ?? []).length} hipótese(s) sustentada(s), ${((data.unsupportedHypotheses as unknown[]) ?? []).length} não sustentada(s)`
    }
  } catch {
    // resumo genérico abaixo
  }
  return `${TOOL_QUALITY_STATUS_LABELS[result.quality.status]}${result.quality.note ? ` (${result.quality.note})` : ""}`
}

function fmt(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`
}
