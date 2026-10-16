"use client"


import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import type { QueryTableCard as Card } from "@/schemas/leadership/leadership.schema"

import { CardAnchor, CardLink, DataCard, Limitations, Methods } from "./card-parts"
import { indicatorHref, personHref, teamHref } from "./leadership-links"

/** Resultado da consulta flexível: a tabela calculada no backend, com a primeira coluna levando ao detalhe (unidade ou ficha). */
export function QueryTableCard({ card }: { card: Card }) {
  const linkFor = (row: Card["rows"][number]) => {
    if (row.personId) return personHref(row.personId, card.period)
    if (row.subject) return card.indicatorCode ? indicatorHref(row.subject, card.period, card.indicatorCode) : teamHref(row.subject, card.period)
    return null
  }
  return (
    <DataCard label={card.title} title={card.title} scope={`${card.structure.label}${card.structure.description ? ` · ${card.structure.description}` : ""}`} period={card.scopeNote}>
      {card.highlights && card.highlights.length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-4 text-xs" aria-label="Destaques">
          {card.highlights.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {card.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nenhuma linha para os filtros pedidos.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table className="text-xs">
            <TableHeader>
              <TableRow>
                {card.columns.map((column) => (
                  <TableHead key={column.key} className={cn("h-8 whitespace-nowrap px-2", column.numeric && "text-right")}>
                    {column.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {card.rows.map((row, index) => {
                const href = linkFor(row)
                return (
                  <TableRow key={`${row.personId ?? row.cells[card.columns[0]!.key]}-${index}`}>
                    {card.columns.map((column, position) => (
                      <TableCell key={column.key} className={cn("px-2 py-1.5", column.numeric ? "text-right tabular-nums whitespace-nowrap" : "min-w-28")}>
                        {position === 0 && href ? (
                          <CardAnchor href={href} className="font-medium hover:underline">
                            {row.cells[column.key] ?? "—"}
                          </CardAnchor>
                        ) : (
                          (row.cells[column.key] ?? "—")
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {card.totalRows > card.rows.length ? <p className="text-xs text-muted-foreground">Mostrando {card.rows.length} de {card.totalRows} linhas.</p> : null}
      <Limitations items={card.limitations} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Methods items={card.methods} />
        {card.indicatorCode && card.period ? <CardLink href={indicatorHref(card.structure.subject, card.period, card.indicatorCode)}>Abrir no painel</CardLink> : null}
      </div>
    </DataCard>
  )
}
