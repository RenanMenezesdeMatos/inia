"use client"

import { Label } from "@/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { FlowNode, EmployeeSelectionCriterion } from "@/schemas/admin/workflow-graph.schema"
import { IndicatorConditionForm } from "./indicator-condition-form"
import { DEFAULT_RANKING_CONFIG, RankingSelectEmployeesForm } from "./ranking-select-employees-form"

const DEFAULT_SELECTION_CRITERION: EmployeeSelectionCriterion = {
  comparator: "GTE",
  thresholdNumeric: 1,
  thresholdBoolean: null,
  historicalQuery: {
    kind: "INDICATOR_THRESHOLD_COUNT",
    indicatorCode: "",
    aggregation: "COUNT",
    comparator: "LT",
    indicatorThreshold: 0,
    period: { kind: "ROLLING_DAYS", days: 7 },
  },
}

/** Modo de seleção de "Selecionar colaboradores" (evolução de Ranking) — "Por critério" é o
 * comportamento original ("quais atendem a esta condição?"); "Por ranking" é o novo ("quais são
 * os N primeiros depois de ordenar?"). Trocar de modo NUNCA deixa campos do outro modo
 * escondidos no payload (Parte 60 do pedido) — o config é substituído por um default limpo do
 * modo novo. Os dois continuam produzindo EMPLOYEE_COLLECTION; a população de origem (Estrutura
 * ∩ Abrangência, ou a coleção anterior) é a mesma pros dois modos. */
export function SelectEmployeesForm({
  node,
  onChange,
}: {
  node: Extract<FlowNode, { type: "select_employees" }>
  onChange: (next: FlowNode) => void
}) {
  const mode = node.config.selectionMode === "RANKING" ? "RANKING" : "CONDITION"

  function setMode(next: "CONDITION" | "RANKING") {
    if (next === mode) return
    onChange({
      ...node,
      config: next === "RANKING" ? { selectionMode: "RANKING", ranking: DEFAULT_RANKING_CONFIG } : { selectionMode: "CONDITION", criterion: DEFAULT_SELECTION_CRITERION },
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Modo de seleção</Label>
        <ToggleGroup type="single" value={mode} onValueChange={(value) => value && setMode(value as "CONDITION" | "RANKING")} className="justify-start">
          <ToggleGroupItem value="CONDITION">Por critério</ToggleGroupItem>
          <ToggleGroupItem value="RANKING">Por ranking</ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="space-y-1 rounded-md border p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">População de origem</p>
        <p className="text-sm text-muted-foreground">Herdada do contexto atual (Estrutura Consolidada ou coleção anterior, já filtrada pela Abrangência do Workflow).</p>
      </div>
      {mode === "RANKING" ? <RankingSelectEmployeesForm node={node} onChange={onChange} /> : <ConditionSelectEmployeesForm node={node} onChange={onChange} />}
    </div>
  )
}

/** "Por critério" reaproveita literalmente o builder de Condition (IndicatorConditionForm) pro
 * critério — mesmo formato de dados (historicalQuery/performanceQuery), zero adaptador de
 * lógica. O critério é sempre avaliado 1 candidato por vez (nunca agregado sobre a estrutura
 * toda), então o builder roda como se fosse modo Individual mesmo dentro de um Workflow
 * Consolidado — oferece Quartil/PRV normalmente (ex.: "Está em Q4 em 3 dos últimos 3
 * fechamentos", Parte 81 do pedido). Nunca reoferece Grupo/Time/Subgrupo — a Abrangência já vem
 * do Workflow (Parte 10 do pedido). */
function ConditionSelectEmployeesForm({
  node,
  onChange,
}: {
  node: Extract<FlowNode, { type: "select_employees" }>
  onChange: (next: FlowNode) => void
}) {
  const criterion = node.config.criterion ?? DEFAULT_SELECTION_CRITERION
  const conditionNode: Extract<FlowNode, { type: "condition" }> = {
    id: node.id,
    label: node.label,
    position: node.position,
    type: "condition",
    config: criterion,
  }

  function handleConditionChange(next: FlowNode) {
    if (next.type !== "condition") return
    const { comparator, thresholdBoolean, thresholdNumeric, thresholdText, historicalQuery, performanceQuery } = next.config
    onChange({
      ...node,
      config: { selectionMode: "CONDITION", criterion: { comparator, thresholdBoolean, thresholdNumeric, thresholdText, historicalQuery, performanceQuery } },
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Cria uma coleção apenas com os colaboradores que atendem ao critério. Esta etapa ainda não cria execuções individuais.
      </p>
      <IndicatorConditionForm node={conditionNode} onChange={handleConditionChange} />
    </div>
  )
}
