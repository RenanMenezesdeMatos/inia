"use client"

import { useMemo, useState } from "react"
import { ChevronsUpDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { KnowledgeContentComparison, KnowledgeTextDiffRow } from "@/schemas/admin/knowledge.schema"

import { versionLabel } from "../knowledge-visuals"
import { versionsPhrase } from "./version-rules"

/** Linhas iguais ao redor de cada diferença que continuam visíveis, para dar contexto. */
const CONTEXT_LINES = 2
/** Trecho igual só recolhe a partir daqui: esconder duas ou três linhas atrapalha mais do que ajuda. */
const MIN_COLLAPSED_LINES = 4

type Segment = { type: "rows"; rows: KnowledgeTextDiffRow[] } | { type: "collapsed"; id: number; rows: KnowledgeTextDiffRow[] }

/** Corta os trechos longos de linhas iguais. O começo e o fim do texto não precisam de contexto do lado de fora. */
export function diffSegments(rows: readonly KnowledgeTextDiffRow[]): Segment[] {
  const segments: Segment[] = []
  const pushRows = (slice: KnowledgeTextDiffRow[]) => {
    if (slice.length === 0) return
    const last = segments[segments.length - 1]
    if (last?.type === "rows") last.rows.push(...slice)
    else segments.push({ type: "rows", rows: slice })
  }
  let index = 0
  while (index < rows.length) {
    if (rows[index]!.kind !== "UNCHANGED") {
      pushRows([rows[index]!])
      index += 1
      continue
    }
    let end = index
    while (end < rows.length && rows[end]!.kind === "UNCHANGED") end += 1
    const before = index === 0 ? 0 : CONTEXT_LINES
    const after = end === rows.length ? 0 : CONTEXT_LINES
    const run = rows.slice(index, end)
    if (run.length - before - after < MIN_COLLAPSED_LINES) {
      pushRows(run)
    } else {
      pushRows(run.slice(0, before))
      segments.push({ type: "collapsed", id: index, rows: run.slice(before, run.length - after) })
      pushRows(run.slice(run.length - after))
    }
    index = end
  }
  return segments
}

function count(value: number, singular: string, plural: string) {
  return `${value} ${value === 1 ? singular : plural}`
}

const ROW_STYLES: Record<KnowledgeTextDiffRow["kind"], { label: string; left: string; right: string; tag: string }> = {
  UNCHANGED: { label: "", left: "", right: "", tag: "" },
  ADDED: { label: "Adicionada", left: "bg-muted/40", right: "bg-emerald-500/10", tag: "text-emerald-700 dark:text-emerald-300" },
  REMOVED: { label: "Removida", left: "bg-red-500/10", right: "bg-muted/40", tag: "text-red-700 dark:text-red-300" },
  CHANGED: { label: "Alterada", left: "bg-amber-500/10", right: "bg-amber-500/10", tag: "text-amber-800 dark:text-amber-200" },
}

function LineCells({ line, text, tone }: { line: number | null; text: string | null; tone: string }) {
  return (
    <>
      <td className={cn("w-10 select-none px-1.5 py-0.5 text-right align-top font-mono text-[11px] text-muted-foreground", tone)}>{line ?? ""}</td>
      <td className={cn("whitespace-pre-wrap break-words px-2 py-0.5 align-top font-mono text-xs", tone)}>{text ?? <span className="sr-only">Sem linha</span>}</td>
    </>
  )
}

function DiffRow({ row }: { row: KnowledgeTextDiffRow }) {
  const style = ROW_STYLES[row.kind]
  return (
    <tr data-kind={row.kind} className="border-b border-border/50 last:border-b-0">
      <td className={cn("w-20 px-1.5 py-0.5 align-top text-[11px] font-medium", style.tag)}>{style.label}</td>
      <LineCells line={row.kind === "ADDED" ? null : row.leftLine} text={row.kind === "ADDED" ? null : row.left} tone={style.left} />
      <LineCells line={row.kind === "REMOVED" ? null : row.rightLine} text={row.kind === "REMOVED" ? null : row.right} tone={style.right} />
    </tr>
  )
}

/** Texto lado a lado. A cor nunca fala sozinha: cada linha diferente diz em palavras o que aconteceu. Rola dentro do próprio painel. */
export function TextDiff({ content, fromNumber, toNumber }: { content: KnowledgeContentComparison; fromNumber: number; toNumber: number }) {
  const rows = content.comparable ? content.rows : null
  const segments = useMemo(() => (rows ? diffSegments(rows) : []), [rows])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())

  if (!content.comparable) {
    if (content.reason === "TOO_LARGE") return <p className="text-sm text-muted-foreground">As versões são grandes demais para comparar aqui</p>
    const phrase = versionsPhrase(content.versions)
    return <p className="text-sm text-muted-foreground">{`Não há texto extraído ${phrase.article} ${phrase.noun} ${phrase.list}: só dá para informar a troca do arquivo`}</p>
  }
  if (content.identical) return <p className="text-sm text-muted-foreground">Sem diferença no texto</p>

  return (
    <div className="min-w-0 space-y-2">
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-medium">
        <li className={ROW_STYLES.ADDED.tag}>{count(content.added, "linha adicionada", "linhas adicionadas")}</li>
        <li className={ROW_STYLES.REMOVED.tag}>{count(content.removed, "linha removida", "linhas removidas")}</li>
        <li className={ROW_STYLES.CHANGED.tag}>{count(content.changed, "linha alterada", "linhas alteradas")}</li>
      </ul>
      <div className="max-h-[60vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[40rem] table-fixed border-collapse">
          <colgroup>
            <col className="w-20" />
            <col className="w-10" />
            <col />
            <col className="w-10" />
            <col />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted text-left text-xs">
            <tr>
              <th scope="col" className="px-1.5 py-1 font-medium">
                <span className="sr-only">O que mudou</span>
              </th>
              <th scope="col" colSpan={2} className="px-2 py-1 font-medium">
                {versionLabel(fromNumber)}
              </th>
              <th scope="col" colSpan={2} className="px-2 py-1 font-medium">
                {versionLabel(toNumber)}
              </th>
            </tr>
          </thead>
          <tbody>
            {segments.flatMap((segment) => {
              if (segment.type === "rows") return segment.rows.map((row, index) => <DiffRow key={rowKey(row, index)} row={row} />)
              if (expanded.has(segment.id)) return segment.rows.map((row, index) => <DiffRow key={rowKey(row, index)} row={row} />)
              return [
                <tr key={`collapsed-${segment.id}`} className="border-b border-border/50 bg-muted/30">
                  <td colSpan={5} className="px-2 py-1 text-center">
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setExpanded((current) => new Set(current).add(segment.id))}>
                      <ChevronsUpDown /> {`Mostrar ${count(segment.rows.length, "linha igual", "linhas iguais")}`}
                    </Button>
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function rowKey(row: KnowledgeTextDiffRow, index: number) {
  return row.kind === "ADDED" ? `a-${row.rightLine}` : row.kind === "REMOVED" ? `r-${row.leftLine}` : `${row.kind}-${row.leftLine}-${row.rightLine}-${index}`
}
