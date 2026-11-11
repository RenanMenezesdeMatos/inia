"use client"

import { ArrowDown, ArrowUp, ArrowUpDown, ShieldAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatCivilDate, formatDateTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import type { ExplorerColumn, ExplorerPage, ExplorerSort } from "@/schemas/admin/data-explorer.schema"

import { COLUMN_TYPE_LABELS } from "./explorer-filter-model"

/** Valor exibido. Número segue em texto até aqui, para não perder casas decimais. */
export function formatExplorerValue(column: ExplorerColumn | undefined, value: string | null): string {
  if (value === null) return "—"
  switch (column?.type) {
    case "DATETIME":
      return formatDateTime(value)
    case "DATE":
      return formatCivilDate(value)
    case "BOOLEAN":
      return value === "true" ? "Sim" : "Não"
    case "NUMBER":
      return value.replace(".", ",")
    case "ENUM":
      return column.options?.find((option) => option.value === value)?.label ?? value
    case "MONTH": {
      const [year, month] = value.split("-")
      return `${month}/${year}`
    }
    case "TIME":
      return value.slice(0, 5)
    default:
      return value
  }
}

const RECORD_STATUS_COLUMN = "record_status"
const CANCELLED = "CANCELLED"

export type RowSelection = { selected: ReadonlySet<string>; onChange: (next: Set<string>) => void }

export function ResultsTable({ page, columns, sort, onSort, selection }: { page: ExplorerPage; columns: readonly ExplorerColumn[]; sort: ExplorerSort; onSort: (next: ExplorerSort) => void; selection?: RowSelection }) {
  const byKey = new Map(columns.map((column) => [column.key, column]))
  const statusIndex = page.columns.indexOf(RECORD_STATUS_COLUMN)
  const rowKeys = selection && page.rowKeys ? page.rowKeys : null
  const selectable = rowKeys?.filter((key): key is string => key !== null) ?? []
  const allSelected = selectable.length > 0 && selectable.every((key) => selection?.selected.has(key))
  const someSelected = selectable.some((key) => selection?.selected.has(key))
  const toggle = (key: string, checked: boolean) => {
    const next = new Set(selection?.selected)
    if (checked) next.add(key)
    else next.delete(key)
    selection?.onChange(next)
  }
  return (
    <div className={TABLE_FRAME} data-testid="explorer-results">
      <Table>
        <TableHeader>
          <TableRow>
            {rowKeys ? (
              <TableHead className="w-8">
                <Checkbox aria-label="Selecionar os registros desta página" checked={allSelected ? true : someSelected ? "indeterminate" : false} disabled={selectable.length === 0} onCheckedChange={(checked) => selection?.onChange(checked === true ? new Set(selectable) : new Set())} />
              </TableHead>
            ) : null}
            {page.columns.map((key) => {
              const column = byKey.get(key)
              const active = sort.column === key
              const Icon = active ? (sort.direction === "ASC" ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <TableHead key={key} className="whitespace-nowrap" aria-sort={active ? (sort.direction === "ASC" ? "ascending" : "descending") : undefined} title={column ? `${COLUMN_TYPE_LABELS[column.type]}${column.description ? `. ${column.description}` : ""}` : undefined}>
                  <span className="inline-flex items-center gap-1">
                    {column?.sortable ? (
                      <button type="button" className="inline-flex items-center gap-1 rounded-sm font-semibold underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2" onClick={() => onSort({ column: key, direction: active && sort.direction === "DESC" ? "ASC" : "DESC" })}>
                        {column.label}
                        <Icon className="size-3.5" aria-hidden />
                      </button>
                    ) : (
                      (column?.label ?? key)
                    )}
                    {column?.personal ? <ShieldAlert className="size-3.5 text-amber-600 dark:text-amber-400" aria-label="Dado pessoal" /> : null}
                  </span>
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.rows.map((row, rowIndex) => {
            const cancelled = statusIndex >= 0 && row[statusIndex] === CANCELLED
            const rowKey = rowKeys?.[rowIndex] ?? null
            return (
              <TableRow key={rowIndex} data-cancelled={cancelled || undefined} className={cn(cancelled && "text-muted-foreground")}>
                {rowKeys ? <TableCell className="w-8">{rowKey ? <Checkbox aria-label={`Selecionar o registro ${rowIndex + 1}`} checked={selection?.selected.has(rowKey) === true} onCheckedChange={(checked) => toggle(rowKey, checked === true)} /> : null}</TableCell> : null}
                {row.map((value, cellIndex) => {
                  const column = byKey.get(page.columns[cellIndex] ?? "")
                  return (
                    <TableCell key={cellIndex} className={cn(column?.type === "NUMBER" ? "text-right tabular-nums" : "max-w-md truncate", cancelled && cellIndex !== statusIndex && "line-through")} title={value ?? undefined}>
                      {value === null ? <span className="text-muted-foreground">—</span> : cancelled && cellIndex === statusIndex ? <Badge variant="destructive">{formatExplorerValue(column, value)}</Badge> : formatExplorerValue(column, value)}
                    </TableCell>
                  )
                })}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
