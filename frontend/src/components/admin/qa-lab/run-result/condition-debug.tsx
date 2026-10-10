"use client"

import { PERFORMANCE_METRIC_LABELS, type PerformanceMetric } from "@/schemas/admin/workflow-graph.schema"
import { evidenceLines, isOperationalEvidence } from "./operational-evidence"
import { AGGREGATION_LABELS, BRANCH_LABELS, comparatorLabel, scalar } from "./run-format"

type DebugSection = { title: string; lines: string[] }

/**
 * Debug da Condition (Parte 20-22, 30): os valores efetivamente resolvidos — valor, meta
 * resolvida e sua origem, período anterior e variação, cada fechamento/mês, cada snapshot de
 * quartil — nunca só TRUE/FALSE. Lê o MESMO payload (`evaluation`) que a prévia de massa
 * recebe, produzido pelo evaluator compartilhado do motor.
 */
export function ConditionDebug({ evaluation, branch }: { evaluation: Record<string, unknown>; branch: string | undefined }) {
  const kind = evaluation.kind
  const result = branch ? (BRANCH_LABELS[branch] ?? branch) : "—"
  const sections: DebugSection[] = []
  const rule = (subject: string, reference: unknown, suffix = "") =>
    `${subject} ${comparatorLabel(evaluation.comparator)} ${scalar(reference)}${suffix}`

  if (kind === "trigger_value") sections.push({ title: "Valor do gatilho", lines: [scalar(evaluation.value)] }, { title: "Regra", lines: [rule("valor", evaluation.threshold)] })

  if (kind === "historical_count") {
    sections.push({ title: "Ocorrências encontradas", lines: [scalar(evaluation.count)] }, { title: "Regra", lines: [rule(scalar(evaluation.count), evaluation.threshold)] })
  }

  if (kind === "historical_aggregate") {
    const aggregation = AGGREGATION_LABELS[String(evaluation.aggregation)] ?? String(evaluation.aggregation ?? "")
    const indicator = evaluation.indicatorCode ? String(evaluation.indicatorCode) : "indicador"
    const closures = evaluation.closures as { label: string; value: number | null; sampleCount: number }[] | undefined
    if (closures && closures.length > 0) {
      sections.push({
        title: `Período: últimos ${scalar(evaluation.closuresRequested)} ${evaluation.reason === "INSUFFICIENT_CLOSED_MONTHS" || evaluation.source === "MEASUREMENT" ? "meses fechados" : "fechamentos"}`,
        lines: closures.map((closure) => `${closure.label}: ${closure.value === null ? "sem medição" : scalar(closure.value)}${closure.sampleCount > 1 ? ` (${closure.sampleCount} medições)` : ""}`),
      })
    }
    if (evaluation.changeMode === "PERCENT") {
      sections.push(
        { title: `${indicator} — período atual`, lines: [scalar(evaluation.value)] },
        { title: "Período anterior", lines: [scalar(evaluation.previousValue)] },
        { title: "Variação", lines: [typeof evaluation.percentChange === "number" ? `${evaluation.percentChange >= 0 ? "+" : ""}${scalar(evaluation.percentChange)}%` : "—"] },
        { title: "Regra", lines: [rule("variação", evaluation.reference, "%")] },
      )
    } else if (evaluation.reason === undefined || evaluation.reason === null) {
      sections.push({ title: `${aggregation} de ${indicator}`, lines: [`${scalar(evaluation.value)} (amostras: ${scalar(evaluation.sampleCount)})`] })
      if (evaluation.referenceKind === "GOAL") {
        const source = evaluation.goalSource as { kind: string; name: string | null } | null | undefined
        sections.push({ title: "Meta resolvida", lines: [scalar(evaluation.reference)] })
        if (source) sections.push({ title: "Origem da meta", lines: [`${source.kind === "SUBTEAM" ? "Subgrupo" : "Time"}${source.name ? ` ${source.name}` : ""}`] })
        sections.push({ title: "Regra", lines: [rule(scalar(evaluation.value), evaluation.reference, " (meta)")] })
      } else if (evaluation.referenceKind === "PREVIOUS_PERIOD") {
        sections.push({ title: "Período anterior", lines: [scalar(evaluation.previousValue ?? evaluation.reference)] }, { title: "Regra", lines: [rule(scalar(evaluation.value), evaluation.reference, " (período anterior)")] })
      } else {
        sections.push({ title: "Regra", lines: [rule(scalar(evaluation.value), evaluation.reference)] })
      }
    } else {
      sections.push({ title: `${aggregation} de ${indicator}`, lines: [`${scalar(evaluation.value)} (amostras: ${scalar(evaluation.sampleCount)})`] })
      if (evaluation.previousValue !== undefined) sections.push({ title: "Período anterior", lines: [scalar(evaluation.previousValue)] })
      if (evaluation.closuresRequested !== undefined && !closures?.length) {
        sections.push({ title: "Fechamentos", lines: [`${scalar(evaluation.totalClosures)} de ${scalar(evaluation.closuresRequested)} esperados`] })
      }
    }
  }

  if (kind === "historical_aggregate" && isOperationalEvidence(evaluation.evidence)) {
    sections.push({ title: "Como o valor foi formado (medição operacional)", lines: evidenceLines(evaluation.evidence) })
    if (isOperationalEvidence(evaluation.previousEvidence)) sections.push({ title: "Janela anterior", lines: evidenceLines(evaluation.previousEvidence) })
  }

  if (kind === "operational_quartile") {
    // Quartil OPERACIONAL (Parte 38): população, com/sem dados, posição, quartil, janela, método — nunca "Q4" solto.
    const population = (evaluation.population as { evaluatedCount: number; eligibleCount?: number; ineligibleCount?: number; rankedCount: number; noDataCount: number; belowCoverageCount: number } | undefined) ?? { evaluatedCount: 0, rankedCount: 0, noDataCount: 0, belowCoverageCount: 0 }
    const eligibleCount = population.eligibleCount ?? population.evaluatedCount
    const direction = evaluation.direction === "LOWER" ? "menor é melhor" : evaluation.direction === "HIGHER" ? "maior é melhor" : "sem direção (TARGET)"
    sections.push({
      title: `Quartil operacional — ${String(evaluation.indicatorCode ?? "indicador")} (${String(evaluation.periodLabel ?? "")})`,
      lines: [
        `Janela: ${String(evaluation.windowLabel ?? "—")}`,
        `Quartil operacional calculado entre ${population.rankedCount} colaboradores com dados, de ${eligibleCount} elegíveis na população deste Workflow (${population.evaluatedCount} no total${population.ineligibleCount ? `, ${population.ineligibleCount} sem dia elegível — férias/afastamento/admissão` : ""}).`,
        `Sem dados: ${population.noDataCount}${population.belowCoverageCount > 0 ? ` (abaixo da cobertura mínima: ${population.belowCoverageCount})` : ""}`,
        `Direção oficial: ${direction} · método: ${String(evaluation.method ?? AGGREGATION_LABELS[String(evaluation.aggregation)] ?? evaluation.aggregation ?? "—")}`,
        evaluation.value === null
          ? "Posição/quartil: — (sem classificação)"
          : `Posição: ${scalar(evaluation.position)} de ${population.rankedCount} · valor do colaborador: ${scalar(evaluation.operationalValue)} · quartil operacional: ${String(evaluation.value)}`,
      ],
    })
    if (isOperationalEvidence(evaluation.evidence)) sections.push({ title: "Como o valor do colaborador foi formado", lines: evidenceLines(evaluation.evidence) })
    if (evaluation.value !== null) sections.push({ title: "Regra", lines: [rule(`quartil operacional ${String(evaluation.value)}`, evaluation.threshold)] })
  }

  if (kind === "performance") {
    const metric = (PERFORMANCE_METRIC_LABELS as Record<string, string>)[evaluation.metric as PerformanceMetric] ?? String(evaluation.metric)
    sections.push({ title: metric, lines: [`${scalar(evaluation.value)}${evaluation.referencePeriod ? ` (fechamento ${String(evaluation.referencePeriod)})` : ""}`] })
    if (evaluation.value !== null) sections.push({ title: "Regra", lines: [rule(scalar(evaluation.value), evaluation.threshold)] })
  }

  if (kind === "performance_recurrence") {
    const metric = (PERFORMANCE_METRIC_LABELS as Record<string, string>)[evaluation.metric as PerformanceMetric] ?? String(evaluation.metric)
    const snapshots = (evaluation.snapshots as { referencePeriod: string; quartile: string }[] | undefined) ?? []
    sections.push({
      title: `${metric} — últimos ${scalar(evaluation.periodsRequested)} fechamentos (${scalar(evaluation.totalPeriods)} encontrados)`,
      lines: snapshots.length > 0 ? snapshots.map((snapshot) => `${snapshot.referencePeriod}: ${snapshot.quartile}`) : ["nenhum fechamento"],
    })
    if ((evaluation.totalPeriods as number) >= (evaluation.periodsRequested as number)) {
      sections.push({ title: "Regra", lines: [rule(`${scalar(evaluation.matchCount)} em ${String(evaluation.matchQuartile)}`, evaluation.threshold)] })
    }
  }

  if (kind === "source_path") sections.push({ title: `Valor resolvido (${String(evaluation.sourcePath)})`, lines: [scalar(evaluation.value)] }, { title: "Regra", lines: [rule("valor", evaluation.threshold)] })
  if (kind === "group") {
    const rules = (evaluation.rules as { sourcePath: string | null; comparator: string; threshold: unknown; result: boolean }[]) ?? []
    sections.push({
      title: evaluation.operator === "ALL" ? "Todas as regras (E)" : "Qualquer regra (OU)",
      lines: rules.map((item) => `${item.sourcePath ?? "valor do gatilho"} ${comparatorLabel(item.comparator)} ${scalar(item.threshold)} → ${item.result ? "TRUE" : "FALSE"}`),
    })
  }

  // Motivo de Sem Dados (Parte 15): o mesmo texto que a prévia de massa mostra.
  if (typeof evaluation.reasonText === "string") sections.push({ title: "Sem dados — motivo", lines: [evaluation.reasonText] })

  return (
    <div className="mt-2 grid gap-2 rounded-md bg-muted/60 px-3 py-2 text-xs sm:grid-cols-2">
      {sections.map((section, index) => (
        <div key={`${section.title}-${index}`}>
          <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">{section.title}</p>
          {section.lines.map((line, lineIndex) => (
            <p key={`${line}-${lineIndex}`}>{line}</p>
          ))}
        </div>
      ))}
      <div className="sm:col-span-2">
        <p className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">Resultado</p>
        <p className="font-semibold">{result}</p>
      </div>
    </div>
  )
}
