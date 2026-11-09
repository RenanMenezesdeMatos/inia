"use client"

import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { ExplorerColumn, ExplorerLimits, ExplorerOperator } from "@/schemas/admin/data-explorer.schema"

import { addChild, countConditions, emptyCondition, emptyGroup, operatorLabel, removeNode, updateNode, type DraftCondition, type DraftGroup } from "./explorer-filter-model"

const INPUT_TYPE: Partial<Record<ExplorerColumn["type"], string>> = { NUMBER: "number", DATE: "date", DATETIME: "date", TIME: "time", MONTH: "month" }

function ValueInput({ column, value, onChange, label }: { column: ExplorerColumn; value: string; onChange: (value: string) => void; label: string }) {
  if (column.type === "BOOLEAN") {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-28" aria-label={label}>
          <SelectValue placeholder="Escolha" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">Sim</SelectItem>
          <SelectItem value="false">Não</SelectItem>
        </SelectContent>
      </Select>
    )
  }
  if (column.type === "ENUM" && column.options) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="min-w-40" aria-label={label}>
          <SelectValue placeholder="Escolha" />
        </SelectTrigger>
        <SelectContent>
          {column.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return <Input aria-label={label} type={INPUT_TYPE[column.type] ?? "text"} step={column.type === "NUMBER" ? "any" : undefined} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-44" />
}

function ConditionRow({ condition, columns, onChange, onRemove }: { condition: DraftCondition; columns: readonly ExplorerColumn[]; onChange: (next: DraftCondition) => void; onRemove: () => void }) {
  const column = columns.find((candidate) => candidate.key === condition.column)
  const operators = column?.operators ?? []
  const needsValue = condition.operator !== "" && condition.operator !== "IS_EMPTY" && condition.operator !== "IS_NOT_EMPTY"
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="explorer-condition">
      <Select
        value={condition.column}
        onValueChange={(key) => {
          const next = columns.find((candidate) => candidate.key === key)
          onChange({ ...condition, column: key, operator: (next?.operators[0] ?? "") as ExplorerOperator | "", value: "", valueTo: "" })
        }}
      >
        <SelectTrigger size="sm" className="min-w-44" aria-label="Coluna da condição">
          <SelectValue placeholder="Coluna" />
        </SelectTrigger>
        <SelectContent>
          {columns.map((candidate) => (
            <SelectItem key={candidate.key} value={candidate.key}>
              {candidate.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {column ? (
        <Select value={condition.operator} onValueChange={(operator) => onChange({ ...condition, operator: operator as ExplorerOperator, value: "", valueTo: "" })}>
          <SelectTrigger size="sm" className="min-w-40" aria-label={`Condição de ${column.label}`}>
            <SelectValue placeholder="Condição" />
          </SelectTrigger>
          <SelectContent>
            {operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operatorLabel(operator, column.type)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {column && needsValue && condition.operator === "IN" ? (
        <Textarea aria-label={`Lista de valores de ${column.label}`} rows={2} placeholder="Um valor por linha" value={condition.value} onChange={(event) => onChange({ ...condition, value: event.target.value })} className="min-h-8 w-56 text-sm" />
      ) : null}
      {column && needsValue && condition.operator !== "IN" ? <ValueInput column={column} label={condition.operator === "BETWEEN" ? `Início do intervalo de ${column.label}` : `Valor de ${column.label}`} value={condition.value} onChange={(value) => onChange({ ...condition, value })} /> : null}
      {column && condition.operator === "BETWEEN" ? (
        <>
          <span className="text-sm text-muted-foreground">e</span>
          <ValueInput column={column} label={`Fim do intervalo de ${column.label}`} value={condition.valueTo} onChange={(valueTo) => onChange({ ...condition, valueTo })} />
        </>
      ) : null}
      <Button type="button" variant="ghost" size="icon-sm" aria-label="Remover condição" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}

function GroupEditor({
  group,
  root,
  depth,
  columns,
  limits,
  onChange,
}: {
  group: DraftGroup
  root: DraftGroup
  depth: number
  columns: readonly ExplorerColumn[]
  limits: ExplorerLimits
  onChange: (next: DraftGroup) => void
}) {
  const atConditionLimit = countConditions(root) >= limits.maxFilterConditions
  return (
    <div className={cn("space-y-2", depth > 1 && "rounded-lg border border-border bg-muted/30 p-3")} role="group" aria-label={depth === 1 ? "Condições" : "Grupo de condições"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Vale</span>
        <Select value={group.logic} onValueChange={(logic) => onChange(updateNode(root, group.id, (node) => ({ ...node, logic: logic as "AND" | "OR" })))}>
          <SelectTrigger size="sm" className="w-52" aria-label="Como combinar as condições">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">Todas as condições (E)</SelectItem>
            <SelectItem value="OR">Qualquer condição (OU)</SelectItem>
          </SelectContent>
        </Select>
        {depth > 1 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(removeNode(root, group.id))}>
            <Trash2 data-icon="inline-start" /> Remover grupo
          </Button>
        ) : null}
      </div>
      {group.children.map((child) =>
        child.kind === "condition" ? (
          <ConditionRow key={child.id} condition={child} columns={columns} onChange={(next) => onChange(updateNode(root, child.id, () => next))} onRemove={() => onChange(removeNode(root, child.id))} />
        ) : (
          <GroupEditor key={child.id} group={child} root={root} depth={depth + 1} columns={columns} limits={limits} onChange={onChange} />
        ),
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={atConditionLimit} onClick={() => onChange(addChild(root, group.id, emptyCondition()))}>
          <Plus data-icon="inline-start" /> Condição
        </Button>
        {depth < limits.maxFilterDepth ? (
          <Button type="button" variant="outline" size="sm" disabled={atConditionLimit} onClick={() => onChange(addChild(root, group.id, { ...emptyGroup(group.logic === "AND" ? "OR" : "AND"), children: [emptyCondition()] }))}>
            <Plus data-icon="inline-start" /> Grupo
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function FilterBuilder({ draft, columns, limits, onChange }: { draft: DraftGroup; columns: readonly ExplorerColumn[]; limits: ExplorerLimits; onChange: (next: DraftGroup) => void }) {
  const filterable = columns.filter((column) => column.filterable)
  return <GroupEditor group={draft} root={draft} depth={1} columns={filterable} limits={limits} onChange={onChange} />
}
