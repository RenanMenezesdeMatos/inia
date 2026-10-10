"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useIndicatorsWithRulesQuery } from "@/queries/admin/use-indicator-rule-queries"
import { aggregationOptionLabel, IndicatorSelect } from "../indicator-select"
import { describeCalendarPeriod, HISTORICAL_AGGREGATION_LABELS, MEASUREMENT_AGGREGATION_OPTION_LABELS, OPERATIONAL_QUARTILE_LABELS, defaultAggregationFor, type FlowNode, type RankingSource, type EmployeeRankingAggregation, type EmployeeRankingConfig, type EmployeeRankingSelection } from "@/schemas/admin/workflow-graph.schema"
import { HistoricalPeriodPicker, MinimumCoverageField, aggregationsFor } from "./indicator-query-fields"

export const DEFAULT_RANKING_CONFIG: EmployeeRankingConfig = {
  source: "MEASUREMENT",
  indicatorCode: "",
  aggregation: "AVERAGE",
  period: { kind: "ROLLING_DAYS", days: 90 },
  rankingBasis: "VALUE",
  selection: "LOWEST",
  count: 5,
  partitionBy: "NONE",
}

type RankingAnalysisKind = "VALUE" | "ACHIEVEMENT" | "PRV_ACHIEVEMENT"

const RANKING_ANALYSIS_LABELS: Record<RankingAnalysisKind, string> = {
  VALUE: "Valor do indicador",
  ACHIEVEMENT: "Atingimento do indicador",
  PRV_ACHIEVEMENT: "Atingimento do PRV",
}

const RANKING_SOURCE_BY_KIND: Record<RankingAnalysisKind, RankingSource> = {
  VALUE: "MEASUREMENT",
  ACHIEVEMENT: "INDICATOR_ACHIEVEMENT",
  PRV_ACHIEVEMENT: "PRV_ACHIEVEMENT",
}

function rankingAnalysisKindOf(ranking: EmployeeRankingConfig): RankingAnalysisKind {
  if (ranking.source === "PRV_ACHIEVEMENT") return "PRV_ACHIEVEMENT"
  if (ranking.source === "INDICATOR_ACHIEVEMENT") return "ACHIEVEMENT"
  return "VALUE"
}

const RANKING_BASIS_LABELS: Record<"VALUE" | "CHANGE", string> = { VALUE: "Valor", CHANGE: "Evolução" }

const RANKING_PARTITION_BY_LABELS: Record<"NONE" | "TEAM" | "SUBTEAM", string> = { NONE: "Nenhuma separação", TEAM: "Grupo", SUBTEAM: "Subgrupo" }

/** "Últimos 30 dias vs 30 dias imediatamente anteriores" (Parte 5/55 da evolução de Evolução) —
 * nunca dois seletores de data independentes: o período anterior é sempre o equivalente
 * IMEDIATAMENTE anterior, resolvido no backend pela mesma infraestrutura de
 * `compareTo: PREVIOUS_PERIOD` da Condition (nunca um 2º calendário aqui). */
function describeChangeComparison(period: EmployeeRankingConfig["period"]): string {
  if (!period) return "Período atual vs período anterior"
  if (period.kind === "ROLLING_DAYS") return `Últimos ${period.days} dias vs ${period.days} dias imediatamente anteriores`
  if (period.kind === "CALENDAR") return `${describeCalendarPeriod(period.unit, period.phase ?? "PREVIOUS")} vs o período equivalente imediatamente anterior`
  return "Período atual vs período anterior" // CLOSURES nunca chega aqui — bloqueado antes (Parte 7)
}

/** "Por ranking" — 100% determinístico, zero IA (Parte 4 do pedido original). Reaproveita
 * `useIndicatorsWithRulesQuery` (mesma fonte de indicadores que a Condition já usa) e
 * `HistoricalPeriodPicker`/`HISTORICAL_AGGREGATION_LABELS` (mesmo período/agregação, nunca um 2º
 * calendário). "Melhores"/"Piores" (VALUE) e "Maiores evoluções"/"Maiores quedas" (CHANGE) só
 * aparecem quando existe direção oficial confiável pro indicador escolhido
 * (`indicator_definitions.desired_direction`) — Atingimento/PRV sempre têm (maior é sempre
 * melhor); Valor bruto só quando o indicador não é "TARGET" (Parte 11/18: nunca inventa
 * Melhores/Piores/Evolução/Queda sem metadado confiável). CHANGE SEMPRE depende de direção (não
 * só Melhores/Piores como em VALUE) — sem ela, a seleção fica desabilitada com aviso, nunca um
 * fallback silencioso. */
export function RankingSelectEmployeesForm({
  node,
  onChange,
}: {
  node: Extract<FlowNode, { type: "select_employees" }>
  onChange: (next: FlowNode) => void
}) {
  const indicatorsQuery = useIndicatorsWithRulesQuery()
  const ranking = node.config.ranking ?? DEFAULT_RANKING_CONFIG
  const basis = ranking.rankingBasis === "CHANGE" ? "CHANGE" : "VALUE"
  const partitionBy = ranking.partitionBy ?? "NONE"
  const kind = rankingAnalysisKindOf(ranking)
  const isPrv = kind === "PRV_ACHIEVEMENT"
  const selectedIndicator = indicatorsQuery.data?.find((indicator) => indicator.code === ranking.indicatorCode)
  const availableAggregations = aggregationsFor(kind === "VALUE" ? "MEASUREMENT" : RANKING_SOURCE_BY_KIND[kind], selectedIndicator?.operationalAggregation).filter((value): value is EmployeeRankingAggregation => value !== "COUNT")
  const isQuartile = ranking.selection === "OPERATIONAL_QUARTILE"
  // Quartil operacional: só medição (Valor) com janela de período — nunca fechamentos oficiais.
  const quartileAvailable = basis === "VALUE" && kind === "VALUE" && ranking.period?.kind !== "CLOSURES"
  // Atingimento (indicador ou PRV) é sempre HIGHER (já normalizado pela fonte, maior=melhor);
  // Valor bruto depende da direção oficial do indicador escolhido — "TARGET"/indicador ainda não
  // selecionado não tem Melhores/Piores/Evolução/Queda disponível nesta V1.
  const directionAvailable = kind !== "VALUE" || (selectedIndicator !== undefined && selectedIndicator.desiredDirection !== "TARGET")

  function updateRanking(patch: Partial<EmployeeRankingConfig>) {
    onChange({ ...node, config: { selectionMode: "RANKING", ranking: { ...ranking, ...patch } } })
  }

  // Nunca deixa "Melhores"/"Piores"/"Evolução"/"Queda" persistido apontando pra uma combinação
  // sem direção disponível (Parte 60/61 original; Parte 72/73 desta evolução) — o reset acontece
  // no exato momento em que a disponibilidade muda.
  function clampSelectionIfNeeded(patch: Partial<EmployeeRankingConfig>, newDirectionAvailable: boolean) {
    const effectiveSelection = patch.selection ?? ranking.selection
    const effectiveBasis = patch.rankingBasis ?? ranking.rankingBasis ?? "VALUE"
    const stillUsesDirection = effectiveBasis === "CHANGE" || effectiveSelection === "BEST" || effectiveSelection === "WORST" || effectiveSelection === "OPERATIONAL_QUARTILE"
    if (!stillUsesDirection || newDirectionAvailable) return patch
    return { ...patch, selection: (effectiveBasis === "CHANGE" ? "DECLINED" : "LOWEST") as EmployeeRankingSelection }
  }

  function setKind(nextKind: RankingAnalysisKind) {
    const nextSource = RANKING_SOURCE_BY_KIND[nextKind]
    const nextDirectionAvailable = nextKind !== "VALUE"
    updateRanking(
      clampSelectionIfNeeded(
        { source: nextSource, indicatorCode: nextKind === "PRV_ACHIEVEMENT" ? undefined : ranking.indicatorCode },
        nextDirectionAvailable,
      ),
    )
  }

  function setIndicatorCode(indicatorCode: string) {
    const newIndicator = indicatorsQuery.data?.find((indicator) => indicator.code === indicatorCode)
    const newDirectionAvailable = newIndicator !== undefined && newIndicator.desiredDirection !== "TARGET"
    // Agregação segue a semântica operacional do novo indicador (média ponderada pra TMA, último
    // valor pra backlog…) quando a atual deixa de fazer sentido.
    const allowed = aggregationsFor(kind === "VALUE" ? "MEASUREMENT" : RANKING_SOURCE_BY_KIND[kind], newIndicator?.operationalAggregation)
    const aggregation = ranking.aggregation && allowed.includes(ranking.aggregation) ? ranking.aggregation : (defaultAggregationFor(newIndicator?.operationalAggregation) as EmployeeRankingAggregation)
    // Cobertura mínima PADRÃO do catálogo pré-preenche o Ranking operacional (explícita e editável).
    const minimumCoverage = kind === "VALUE" ? (newIndicator?.minimumCoverage ?? ranking.minimumCoverage) : undefined
    updateRanking(clampSelectionIfNeeded({ indicatorCode, aggregation, minimumCoverage }, newDirectionAvailable))
  }

  // Troca de "Ranquear por" preserva os campos compatíveis (source/indicatorCode/aggregation/
  // partitionBy/count — Parte 72/73 do pedido) e nunca deixa um `selection` do vocabulário
  // errado escondido no payload (Parte 60 original: "não deixar payload Frankenstein"). CHANGE
  // nunca aceita período CLOSURES (Parte 7) — troca pro default seguro se estava configurado
  // assim em VALUE.
  function setBasis(nextBasis: "VALUE" | "CHANGE") {
    if (nextBasis === basis) return
    const nextPeriod = nextBasis === "CHANGE" && ranking.period?.kind === "CLOSURES" ? DEFAULT_RANKING_CONFIG.period : ranking.period
    const nextSelection: EmployeeRankingSelection = nextBasis === "CHANGE" ? "DECLINED" : "LOWEST"
    updateRanking(clampSelectionIfNeeded({ rankingBasis: nextBasis, selection: nextSelection, period: nextPeriod }, directionAvailable))
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="space-y-1.5">
        <Label>Ranquear por</Label>
        <Select value={basis} onValueChange={(value) => setBasis(value as "VALUE" | "CHANGE")}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="VALUE">{RANKING_BASIS_LABELS.VALUE}</SelectItem>
            <SelectItem value="CHANGE">{RANKING_BASIS_LABELS.CHANGE}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>O que deseja analisar?</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as RankingAnalysisKind)}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["VALUE", "ACHIEVEMENT", "PRV_ACHIEVEMENT"] as const).map((option) => (
              <SelectItem key={option} value={option}>
                {RANKING_ANALYSIS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isPrv ? (
        <p className="text-xs text-muted-foreground">O PRV é consolidado — não depende de um indicador específico.</p>
      ) : (
        <div className="space-y-1.5">
          <Label>Indicador</Label>
          <IndicatorSelect
            value={ranking.indicatorCode ?? ""}
            requirement={kind === "VALUE" ? (ranking.selection === "OPERATIONAL_QUARTILE" ? "OPERATIONAL" : "ANY") : "OFFICIAL"}
            onValueChange={setIndicatorCode}
          />
        </div>
      )}

      <div className="space-y-1.5">
        <Label>Considerando</Label>
        <Select value={ranking.aggregation ?? "AVERAGE"} onValueChange={(value) => updateRanking({ aggregation: value as EmployeeRankingAggregation })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {availableAggregations.map((value) => (
              <SelectItem key={value} value={value}>
                {kind === "VALUE" ? aggregationOptionLabel(value, selectedIndicator) : MEASUREMENT_AGGREGATION_OPTION_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <HistoricalPeriodPicker
        period={ranking.period ?? DEFAULT_RANKING_CONFIG.period!}
        allowClosures={basis === "VALUE"}
        closuresSource={kind === "VALUE" ? "MEASUREMENT" : "ACHIEVEMENT"}
        operationalEnabled={selectedIndicator ? selectedIndicator.dailySupported : undefined}
        onChange={(next) => updateRanking({ period: next })}
      />
      {kind === "VALUE" && ranking.period?.kind !== "CLOSURES" ? (
        <MinimumCoverageField value={ranking.minimumCoverage} onChange={(minimumCoverage) => updateRanking({ minimumCoverage })} />
      ) : null}

      {basis === "CHANGE" ? (
        <div className="space-y-1 rounded-md border p-3">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Comparação</p>
          <p className="text-sm">{describeChangeComparison(ranking.period)}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 border-t pt-3">
        {isQuartile ? (
          <div className="space-y-1.5">
            <Label>Quartil operacional</Label>
            <Select value={ranking.operationalQuartile ?? "Q4"} onValueChange={(value) => updateRanking({ operationalQuartile: value as EmployeeRankingConfig["operationalQuartile"] })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["Q1", "Q2", "Q3", "Q4"] as const).map((quartile) => (
                  <SelectItem key={quartile} value={quartile}>
                    {OPERATIONAL_QUARTILE_LABELS[quartile]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Selecionar</Label>
            <Input
              type="number"
              min={1}
              value={ranking.count ?? 5}
              onChange={(event) => updateRanking({ count: Math.max(1, Math.round(Number(event.target.value) || 1)) })}
            />
            {!ranking.count || ranking.count <= 0 ? <p className="text-xs text-destructive">Quantidade deve ser maior que zero.</p> : null}
          </div>
        )}
        <div className="space-y-1.5">
          <Label>{basis === "CHANGE" ? "Direção" : "Posição"}</Label>
          {basis === "CHANGE" && !directionAvailable ? (
            <p className="text-xs text-destructive">
              {selectedIndicator?.desiredDirection === "TARGET"
                ? `"${selectedIndicator.name}" tem direção TARGET — Evolução/Queda exige HIGHER ou LOWER.`
                : "Selecione um indicador para habilitar Evolução/Queda."}
            </p>
          ) : (
            <Select value={ranking.selection ?? (basis === "CHANGE" ? "DECLINED" : "LOWEST")} onValueChange={(value) => updateRanking({ selection: value as EmployeeRankingSelection })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {basis === "CHANGE" ? (
                  <>
                    <SelectItem value="DECLINED">Maiores quedas</SelectItem>
                    <SelectItem value="IMPROVED">Maiores evoluções</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="LOWEST">Menores valores</SelectItem>
                    <SelectItem value="HIGHEST">Maiores valores</SelectItem>
                    {directionAvailable ? <SelectItem value="WORST">Piores desempenhos</SelectItem> : null}
                    {directionAvailable ? <SelectItem value="BEST">Melhores desempenhos</SelectItem> : null}
                    {directionAvailable && quartileAvailable ? <SelectItem value="OPERATIONAL_QUARTILE">Quartil operacional (Q1..Q4)</SelectItem> : null}
                  </>
                )}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
      {isQuartile ? (
        <p className="text-xs text-muted-foreground">
          Quartil OPERACIONAL: a INIA ordena os candidatos com dado pelo valor operacional da janela ({selectedIndicator?.desiredDirection === "LOWER" ? "menor é melhor" : "maior é melhor"}) e classifica Q1 = melhores 25% … Q4 = piores 25%,
          relativo a ESTA população{partitionBy !== "NONE" ? ` (por ${partitionBy === "TEAM" ? "Grupo" : "Subgrupo"})` : ""}. Empates ficam na mesma posição; com menos de 4 colaboradores com dado ninguém é classificado; quem não tem dado fica fora (nunca vira Q4).
          Não é o quartil oficial do fechamento mensal.
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label>Separar ranking por</Label>
        <Select value={partitionBy} onValueChange={(value) => updateRanking({ partitionBy: value as EmployeeRankingConfig["partitionBy"] })}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="NONE">{RANKING_PARTITION_BY_LABELS.NONE}</SelectItem>
            <SelectItem value="TEAM">{RANKING_PARTITION_BY_LABELS.TEAM}</SelectItem>
            <SelectItem value="SUBTEAM">{RANKING_PARTITION_BY_LABELS.SUBTEAM}</SelectItem>
          </SelectContent>
        </Select>
        {partitionBy !== "NONE" ? (
          <p className="text-xs text-muted-foreground">
            A quantidade é aplicada separadamente a cada {partitionBy === "TEAM" ? "Grupo" : "Subgrupo"} — nunca um total geral.
          </p>
        ) : null}
      </div>

      {kind === "VALUE" && selectedIndicator ? (
        <p className="text-xs text-muted-foreground">
          {selectedIndicator.desiredDirection === "TARGET"
            ? `"${selectedIndicator.name}" não tem uma direção de desempenho única (meta por faixa/alvo) — "Melhores"/"Piores"/Evolução/Queda não está disponível para ele; use Maiores/Menores valores.`
            : `"${selectedIndicator.name}": ${selectedIndicator.desiredDirection === "HIGHER" ? "maior valor representa melhor desempenho" : "menor valor representa melhor desempenho"}.`}
        </p>
      ) : null}

      <p className="border-t pt-3 text-sm text-muted-foreground">
        Selecionar {isQuartile ? `todos os colaboradores no ${ranking.operationalQuartile ?? "Q4"} operacional` : `${ranking.count ?? "?"} colaboradores`}{partitionBy !== "NONE" ? ` por ${partitionBy === "TEAM" ? "Grupo" : "Subgrupo"}` : ""}{isQuartile ? "" : " com"}{" "}
        {isQuartile
          ? ""
          : basis === "CHANGE"
          ? ranking.selection === "IMPROVED"
            ? "a maior evolução"
            : "a maior queda"
          : ranking.selection === "HIGHEST"
            ? "os maiores valores"
            : ranking.selection === "LOWEST"
              ? "os menores valores"
              : ranking.selection === "BEST"
                ? "o melhor desempenho"
                : "o pior desempenho"}{" "}
        {isPrv ? "no PRV" : ranking.indicatorCode ? `em "${selectedIndicator?.name ?? ranking.indicatorCode}"` : ""}
        {basis === "CHANGE" ? ` (${describeChangeComparison(ranking.period).toLowerCase()})` : ` (${(ranking.aggregation && HISTORICAL_AGGREGATION_LABELS[ranking.aggregation]) ?? "?"})`}.
      </p>
    </div>
  )
}
