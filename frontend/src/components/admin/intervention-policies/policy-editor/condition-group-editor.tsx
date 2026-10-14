"use client"

import { FolderPlus, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { isConditionGroup, type PolicyCondition, type PolicyConditionGroup } from "@/schemas/admin/intervention-policy.schema"

import { OptionSelect } from "../shared/fields"
import { CONDITION_KIND_LABELS, CONDITION_KINDS, GROUP_OPERATOR_LABELS, type ConditionKind } from "../shared/labels"
import { defaultCondition, MAX_GROUP_DEPTH, MAX_GROUP_ITEMS } from "./defaults"
import { usePolicyEditor } from "./editor-context"
import { IndicatorConditionEditor } from "./indicator-condition-editor"
import { EmploymentConditionEditor, InteractionFlagConditionEditor, PriorInterventionsConditionEditor, PublishedFeedbackConditionEditor, SupportedDiagnosisConditionEditor, TimeSinceInterventionConditionEditor } from "./other-condition-editors"

/**
 * "Quando" de uma regra: grupo de condições (todas / qualquer uma), com grupos aninhados até 3 níveis. Um grupo nunca fica
 * vazio — o último item não sai (remova o grupo inteiro). `canAddCondition` vem da regra (máximo de 30 condições).
 */
export function ConditionGroupEditor({ group, depth, canAddCondition, onChange, onRemove }: { group: PolicyConditionGroup; depth: number; canAddCondition: boolean; onChange: (next: PolicyConditionGroup) => void; onRemove?: () => void }) {
  const { readOnly, conditionContext: context } = usePolicyEditor()
  const setItem = (index: number, item: PolicyCondition | PolicyConditionGroup) => onChange({ ...group, items: group.items.map((current, position) => (position === index ? item : current)) })
  const removeItem = (index: number) => onChange({ ...group, items: group.items.filter((_, position) => position !== index) })
  const full = group.items.length >= MAX_GROUP_ITEMS

  return (
    <div className={cn("space-y-3 rounded-lg border p-3", depth > 1 && "border-dashed bg-muted/20")} data-testid={`condition-group-depth-${depth}`}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <OptionSelect className="min-w-56" label={depth === 1 ? "Quando" : "Grupo de condições"} value={group.operator} options={(["ALL", "ANY"] as const).map((value) => ({ value, label: GROUP_OPERATOR_LABELS[value] }))} onChange={(operator) => onChange({ ...group, operator })} />
        {onRemove && !readOnly ? (
          <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
            <Trash2 /> Remover grupo
          </Button>
        ) : null}
      </div>
      <ol className="space-y-3">
        {group.items.map((item, index) => (
          <li key={index}>
            {index > 0 ? <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{group.operator === "ALL" ? "e" : "ou"}</p> : null}
            {isConditionGroup(item) ? (
              <ConditionGroupEditor group={item} depth={depth + 1} canAddCondition={canAddCondition} onChange={(next) => setItem(index, next)} onRemove={group.items.length > 1 ? () => removeItem(index) : undefined} />
            ) : (
              <ConditionCard condition={item} onChange={(next) => setItem(index, next)} onRemove={group.items.length > 1 ? () => removeItem(index) : undefined} />
            )}
          </li>
        ))}
      </ol>
      {readOnly ? null : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={full || !canAddCondition} onClick={() => onChange({ ...group, items: [...group.items, defaultCondition("INDICATOR", context)] })}>
            <Plus /> Adicionar condição
          </Button>
          {depth < MAX_GROUP_DEPTH ? (
            <Button type="button" size="sm" variant="ghost" disabled={full || !canAddCondition} onClick={() => onChange({ ...group, items: [...group.items, { operator: group.operator === "ALL" ? "ANY" : "ALL", items: [defaultCondition("INDICATOR", context)] }] })}>
              <FolderPlus /> Adicionar grupo
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}

function ConditionCard({ condition, onChange, onRemove }: { condition: PolicyCondition; onChange: (next: PolicyCondition) => void; onRemove?: () => void }) {
  const { readOnly, conditionContext, flags } = usePolicyEditor()
  // Flag de atendimento só aparece quando há flag ativa no catálogo (ou quando a condição já é de flag).
  const kinds = CONDITION_KINDS.filter((kind) => kind !== "INTERACTION_FLAG" || condition.kind === "INTERACTION_FLAG" || flags.some((flag) => flag.active))
  return (
    <div className="space-y-3 rounded-md border bg-card p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <OptionSelect
          className="min-w-64"
          label="Tipo de condição"
          value={condition.kind}
          options={kinds.map((kind) => ({ value: kind, label: CONDITION_KIND_LABELS[kind] }))}
          onChange={(kind: ConditionKind) => (kind === condition.kind ? undefined : onChange(defaultCondition(kind, conditionContext)))}
        />
        {onRemove && !readOnly ? (
          <Button type="button" size="sm" variant="ghost" aria-label="Remover condição" onClick={onRemove}>
            <Trash2 /> Remover
          </Button>
        ) : null}
      </div>
      <ConditionFields condition={condition} onChange={onChange} />
    </div>
  )
}

function ConditionFields({ condition, onChange }: { condition: PolicyCondition; onChange: (next: PolicyCondition) => void }) {
  switch (condition.kind) {
    case "INDICATOR":
      return <IndicatorConditionEditor condition={condition} onChange={onChange} />
    case "EMPLOYMENT":
      return <EmploymentConditionEditor condition={condition} onChange={onChange} />
    case "PRIOR_INTERVENTIONS":
      return <PriorInterventionsConditionEditor condition={condition} onChange={onChange} />
    case "TIME_SINCE_INTERVENTION":
      return <TimeSinceInterventionConditionEditor condition={condition} onChange={onChange} />
    case "SUPPORTED_DIAGNOSIS":
      return <SupportedDiagnosisConditionEditor condition={condition} onChange={onChange} />
    case "PUBLISHED_FEEDBACK":
      return <PublishedFeedbackConditionEditor condition={condition} onChange={onChange} />
    case "INTERACTION_FLAG":
      return <InteractionFlagConditionEditor condition={condition} onChange={onChange} />
  }
}
