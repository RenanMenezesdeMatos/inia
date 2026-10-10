"use client"

import { cn } from "@/lib/utils"
import type { QaRun } from "@/schemas/admin/qa-lab.schema"
import { formatNumber, personLabel } from "../qa-lab-format"
import type { OperationalEvidence } from "./operational-evidence"
import { AGGREGATION_LABELS } from "./run-format"

type EmployeeCollectionOutputCondition = {
  kind: "EMPLOYEE_COLLECTION"
  mode?: "CONDITION"
  memberIds: string[]
  evaluatedCount: number
  selectedCount: number
  notMatchedCount: number
  noDataCount: number
}

type RankedMemberExtras = { operationalQuartile?: "Q1" | "Q2" | "Q3" | "Q4"; evidence?: OperationalEvidence; previousEvidence?: OperationalEvidence }

type RankedMemberValue = { employeeId: string; value: number; position: number } & RankedMemberExtras

type RankedMemberChange = { employeeId: string; previousValue: number; currentValue: number; change: number; performanceChange: number; position: number } & RankedMemberExtras

type RankedMember = RankedMemberValue | RankedMemberChange

type RankingCalculation = {
  source: string
  indicatorCode: string | null
  aggregation: string
  periodLabel: string
  windowLabel: string | null
  previousWindowLabel: string | null
  direction: "HIGHER" | "LOWER" | "TARGET" | null
  quartileReason?: "OK" | "INSUFFICIENT_POPULATION" | "DIRECTION_UNSUPPORTED"
}

type RankingPartition = { id: string | null; name: string | null; evaluatedCount: number; rankedCount: number; noDataCount: number; selectedCount: number; members: RankedMember[]; calculation?: RankingCalculation }

type EmployeeCollectionOutputRanking = {
  kind: "EMPLOYEE_COLLECTION"
  mode: "RANKING"
  memberIds: string[]
  evaluatedCount: number
  selectedCount: number
  rankedCount: number
  noDataCount: number
  partitionBy?: "NONE" | "TEAM" | "SUBTEAM"
  requestedCountPerPartition?: number
  partitions?: RankingPartition[]
  // Formato anterior à evolução de Evolução/Grupo — só pra não quebrar traces de QA já
  // persistidos antes desta rodada (a feature de ranking nunca chegou a ser publicada em
  // produção, então isto é só uma cortesia pra histórico de QA, nunca uma garantia de domínio).
  requestedCount?: number
  ranked?: RankedMemberValue[]
}

type EmployeeCollectionOutput = EmployeeCollectionOutputCondition | EmployeeCollectionOutputRanking

export function isEmployeeCollectionOutput(value: unknown): value is EmployeeCollectionOutput {
  return Boolean(value) && typeof value === "object" && (value as { kind?: unknown }).kind === "EMPLOYEE_COLLECTION"
}

/** "Selecionar colaboradores" — nunca mostra o JSON cru do node como os outros nodes. Modo
 * ausente/"CONDITION" (legado): contagens Avaliados/Selecionados/Não atenderam/Sem dados + a
 * lista de membros selecionados, por nome (Parte 44/45 do pedido de EMPLOYEE_COLLECTION). Modo
 * "RANKING" (evolução): delega pra `RankingSummaryCard`, abaixo. */
export function CollectionSummaryCard({ output, people }: { output: EmployeeCollectionOutput; people: QaRun["trace"]["people"] }) {
  if (output.mode === "RANKING") return <RankingSummaryCard output={output} people={people} />
  const counts: { label: string; value: number; className?: string }[] = [
    { label: "Avaliados", value: output.evaluatedCount },
    { label: "Selecionados", value: output.selectedCount, className: "text-emerald-600 dark:text-emerald-400" },
    { label: "Não atenderam", value: output.notMatchedCount },
    { label: "Sem dados", value: output.noDataCount },
  ]
  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Coleção de colaboradores</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {counts.map((item) => (
          <div key={item.label}>
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={cn("font-semibold", item.className)}>{item.value}</p>
          </div>
        ))}
      </div>
      {output.memberIds.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Membros selecionados</p>
          <ul className="mt-1 flex flex-wrap gap-1">
            {output.memberIds.map((id) => (
              <li key={id} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {personLabel(people, id)}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">0 colaboradores selecionados — resultado legítimo, não é um erro.</p>
      )}
    </div>
  )
}

/** Uma linha "1º João — 72,1" (VALUE) ou "1º João — 90 → 72 (queda de 20%)" (CHANGE) — evidência
 * suficiente pra explicar a posição sem recalcular (Parte 23/47/48 do pedido de Evolução/Grupo). */
function RankedMemberRow({ member, people, rankedCount, direction }: { member: RankedMember; people: QaRun["trace"]["people"]; rankedCount?: number; direction?: RankingCalculation["direction"] }) {
  const evidence = member.evidence ? (
    <p className="text-xs text-muted-foreground">
      {member.evidence.method} · {member.evidence.daysWithData} dia(s) com dados{member.evidence.expectedDays ? ` de ${member.evidence.expectedDays}` : ""} · {member.evidence.windowLabel}
    </p>
  ) : null
  if ("value" in member) {
    return (
      <li className="text-sm">
        {member.operationalQuartile ? <span className="mr-1 rounded bg-muted px-1 font-semibold">{member.operationalQuartile} operacional</span> : null}
        {member.position}º{rankedCount ? `/${rankedCount}` : ""} {personLabel(people, member.employeeId)} — {formatNumber(member.value, 2)}
        {evidence}
      </li>
    )
  }
  const trend = member.performanceChange >= 0 ? "evolução" : "queda"
  return (
    <li className="text-sm">
      {member.position}º {personLabel(people, member.employeeId)} — {formatNumber(member.previousValue, 2)} → {formatNumber(member.currentValue, 2)} ({trend} de {formatNumber(Math.abs(member.performanceChange), 1)}%)
      <p className="text-xs text-muted-foreground">
        Variação matemática {member.change >= 0 ? "+" : ""}{formatNumber(member.change, 2)}%{direction ? ` · direção ${direction}` : ""} → variação de performance {member.performanceChange >= 0 ? "+" : ""}{formatNumber(member.performanceChange, 2)}%
        {member.evidence && member.previousEvidence ? ` · ${member.evidence.windowLabel} vs ${member.previousEvidence.windowLabel}` : ""}
      </p>
    </li>
  )
}

/** Cabeçalho de transparência do balde (Parte 86–90): fonte, indicador, janela, população, método —
 * nunca só "Q4". */
function RankingCalculationSummary({ partition }: { partition: RankingPartition }) {
  const calculation = partition.calculation
  if (!calculation) return null
  const sourceLabel = calculation.source === "MEASUREMENT" ? "medição operacional" : calculation.source === "PRV_ACHIEVEMENT" ? "atingimento oficial do PRV" : "atingimento oficial do indicador"
  const reason =
    calculation.quartileReason === "INSUFFICIENT_POPULATION"
      ? `Quartil operacional não classificado: só ${partition.rankedCount} colaborador(es) com dados (mínimo 4).`
      : calculation.quartileReason === "DIRECTION_UNSUPPORTED"
        ? "Quartil operacional não classificado: indicador sem direção HIGHER/LOWER."
        : null
  return (
    <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
      <p>
        Fonte: {sourceLabel}{calculation.indicatorCode ? ` · ${calculation.indicatorCode}` : ""} · {AGGREGATION_LABELS[calculation.aggregation] ?? calculation.aggregation} · {calculation.periodLabel}
        {calculation.windowLabel ? ` (${calculation.windowLabel})` : ""}{calculation.previousWindowLabel ? ` vs ${calculation.previousWindowLabel}` : ""}
      </p>
      <p>
        População elegível: {partition.evaluatedCount} · com dados: {partition.rankedCount} · sem dados: {partition.noDataCount}
        {calculation.direction ? ` · direção ${calculation.direction} (${calculation.direction === "LOWER" ? "menor é melhor" : "maior é melhor"})` : ""}
      </p>
      {reason ? <p className="text-amber-700 dark:text-amber-400">{reason}</p> : null}
    </div>
  )
}

/** "Selecionar colaboradores" em modo Ranking — Avaliados/Com dados/Sem dados/Solicitados/
 * Selecionados + a lista ordenada (posição, nome, valor ou anterior→atual/evolução) — nunca só
 * os nomes (Parte 46/47/48 do pedido original; Parte 58/59/60 da evolução de Evolução/Grupo).
 * Centenas de candidatos não viram uma lista gigante: só os SELECIONADOS aparecem (Parte 48),
 * nunca todos os avaliados. Sem separação (`partitionBy: "NONE"`) preserva o visual de sempre —
 * uma lista só; com separação, uma seção por Grupo/Subgrupo (Parte 58: "sem grouping preservar
 * visual atual; com grouping mostrar seções"). Aceita o formato antigo (`ranked` achatado, sem
 * `partitions`) pra não quebrar traces de QA já persistidos antes desta evolução. */
function RankingSummaryCard({ output, people }: { output: EmployeeCollectionOutputRanking; people: QaRun["trace"]["people"] }) {
  const partitionBy = output.partitionBy ?? "NONE"
  const requestedPerPartition = output.requestedCountPerPartition ?? output.requestedCount ?? 0
  const partitions: RankingPartition[] =
    output.partitions ??
    (output.ranked
      ? [{ id: null, name: null, evaluatedCount: output.evaluatedCount, rankedCount: output.rankedCount, noDataCount: output.noDataCount, selectedCount: output.selectedCount, members: output.ranked }]
      : [])
  const partitionLabel = partitionBy === "TEAM" ? "Grupo" : "Subgrupo"

  const counts: { label: string; value: number; className?: string }[] = [
    { label: "Avaliados", value: output.evaluatedCount },
    { label: "Com dados", value: output.rankedCount },
    { label: "Sem dados", value: output.noDataCount },
    { label: partitionBy === "NONE" ? "Solicitados" : `Solicitados por ${partitionLabel}`, value: requestedPerPartition },
    { label: "Selecionados", value: output.selectedCount, className: "text-emerald-600 dark:text-emerald-400" },
  ]

  return (
    <div className="rounded-lg border border-dashed border-border bg-card p-3">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Ranking de colaboradores</p>
      {partitionBy !== "NONE" ? <p className="mt-0.5 text-xs text-muted-foreground">Separado por {partitionLabel} — {partitions.length} baldes</p> : null}
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
        {counts.map((item) => (
          <div key={item.label}>
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={cn("font-semibold", item.className)}>{item.value}</p>
          </div>
        ))}
      </div>
      {partitions.length === 0 || partitions.every((partition) => partition.members.length === 0) ? (
        <div>
          {partitions[0] ? <RankingCalculationSummary partition={partitions[0]} /> : null}
          <p className="mt-2 text-xs text-muted-foreground">0 colaboradores selecionados — resultado legítimo, não é um erro.</p>
        </div>
      ) : partitionBy === "NONE" ? (
        <div className="mt-2">
          <RankingCalculationSummary partition={partitions[0]!} />
          <p className="mt-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Selecionados</p>
          <ol className="mt-1 space-y-0.5">
            {partitions[0]!.members.map((member) => (
              <RankedMemberRow key={member.employeeId} member={member} people={people} rankedCount={partitions[0]!.rankedCount} direction={partitions[0]!.calculation?.direction} />
            ))}
          </ol>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {partitions.map((partition) => (
            <div key={partition.id ?? "sem-balde"} className="rounded-md border border-border/60 p-2">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {partition.name ?? `Sem ${partitionLabel.toLowerCase()}`} — {partition.selectedCount} de {partition.evaluatedCount}
              </p>
              <RankingCalculationSummary partition={partition} />
              {partition.members.length > 0 ? (
                <ol className="mt-1 space-y-0.5">
                  {partition.members.map((member) => (
                    <RankedMemberRow key={member.employeeId} member={member} people={people} rankedCount={partition.rankedCount} direction={partition.calculation?.direction} />
                  ))}
                </ol>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">0 selecionados neste balde.</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
