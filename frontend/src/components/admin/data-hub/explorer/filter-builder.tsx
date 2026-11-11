"use client"

import { ListFilter, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SectionLabel } from "@/components/ui/surface"
import { Textarea } from "@/components/ui/textarea"
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-xs" data-testid="explorer-condition">
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
      <Button type="button" variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Remover condição" onClick={onRemove}>
        <Trash2 />
      </Button>
    </div>
  )
}

/** Conector entre duas linhas do mesmo grupo: diz em palavras como elas se combinam (E = todas valem; OU = basta uma). */
function LogicConnector({ logic }: { logic: "AND" | "OR" }) {
  return (
    <div className="flex items-center gap-2 pl-3" aria-hidden>
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-primary">{logic === "AND" ? "E" : "OU"}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

function LogicSelect({ value, onChange }: { value: "AND" | "OR"; onChange: (logic: "AND" | "OR") => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground">Combinar</span>
      <Select value={value} onValueChange={(logic) => onChange(logic as "AND" | "OR")}>
        <SelectTrigger size="sm" className="w-52 bg-card" aria-label="Como combinar as condições">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="AND">Todas as condições (E)</SelectItem>
          <SelectItem value="OR">Qualquer condição (OU)</SelectItem>
        </SelectContent>
      </Select>
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
  const isRoot = depth === 1
  const setLogic = (logic: "AND" | "OR") => onChange(updateNode(root, group.id, (node) => ({ ...node, logic })))
  const empty = group.children.length === 0

  const addButtons = (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="bg-card" disabled={atConditionLimit} onClick={() => onChange(addChild(root, group.id, emptyCondition()))}>
        <Plus data-icon="inline-start" /> Condição
      </Button>
      {depth < limits.maxFilterDepth ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="bg-card"
          disabled={atConditionLimit}
          onClick={() => onChange(addChild(root, group.id, { ...emptyGroup(group.logic === "AND" ? "OR" : "AND"), children: [emptyCondition()] }))}
        >
          <Plus data-icon="inline-start" /> Grupo
        </Button>
      ) : null}
    </div>
  )

  const rows = group.children.map((child, index) => (
    <div key={child.id} className="space-y-2">
      {index > 0 ? <LogicConnector logic={group.logic} /> : null}
      {child.kind === "condition" ? (
        <ConditionRow condition={child} columns={columns} onChange={(next) => onChange(updateNode(root, child.id, () => next))} onRemove={() => onChange(removeNode(root, child.id))} />
      ) : (
        <GroupEditor group={child} root={root} depth={depth + 1} columns={columns} limits={limits} onChange={onChange} />
      )}
    </div>
  ))

  if (isRoot) {
    return (
      <div className="space-y-2" role="group" aria-label="Condições">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
          <SectionLabel as="p">Condições</SectionLabel>
          {group.children.length > 1 ? <LogicSelect value={group.logic} onChange={setLogic} /> : null}
        </div>
        <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-3">
          {empty ? (
            <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-card px-3 py-3 text-sm text-muted-foreground">
              <ListFilter className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>Nenhuma condição. Sem condições, a consulta traz todos os registros do conjunto (respeitando a busca). Adicione uma condição para filtrar por coluna.</p>
            </div>
          ) : (
            <div className="space-y-2">{rows}</div>
          )}
          {addButtons}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-primary/25 bg-primary/[0.03] p-3" role="group" aria-label="Grupo de condições">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wider text-primary uppercase">Grupo</span>
        {group.children.length > 1 ? <LogicSelect value={group.logic} onChange={setLogic} /> : null}
        <Button type="button" variant="ghost" size="sm" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => onChange(removeNode(root, group.id))}>
          <Trash2 data-icon="inline-start" /> Remover grupo
        </Button>
      </div>
      <div className="space-y-2">{rows}</div>
      {addButtons}
    </div>
  )
}

export function FilterBuilder({ draft, columns, limits, onChange }: { draft: DraftGroup; columns: readonly ExplorerColumn[]; limits: ExplorerLimits; onChange: (next: DraftGroup) => void }) {
  const filterable = columns.filter((column) => column.filterable)
  return <GroupEditor group={draft} root={draft} depth={1} columns={filterable} limits={limits} onChange={onChange} />
}
