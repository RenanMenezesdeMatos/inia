"use client"

import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCivilDate } from "@/lib/format/date"
import { interventionHref } from "@/lib/interventions/intervention-href"
import { usePersonInterventionsQuery } from "@/queries/interventions/use-intervention-queries"

/** Ficha do colaborador: reencontrar as intervenções (em andamento primeiro) — cada uma abre no caso de supervisão dela. */
export function PersonInterventions({ personId }: { personId: string }) {
  const query = usePersonInterventionsQuery(personId)
  const items = query.data ?? []
  if (query.isError) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Intervenções</CardTitle>
        <CardDescription>Abertas por políticas de acompanhamento ou pela liderança. O detalhe, o relatório e as ações ficam no caso.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {query.isPending ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
        {!query.isPending && items.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma intervenção registrada.</p> : null}
        {items.map((item) => (
          <Link key={item.id} href={interventionHref(item.caseId, item.id)} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 p-3 text-sm transition hover:bg-muted">
            <span>
              <span className="font-medium">{item.sensitive ? "Avaliação de continuidade" : item.type.name}</span>
              <span className="block text-xs text-muted-foreground">
                {item.indicatorCode ?? "Geral"} · responsável {item.responsible.name} · prazo {formatCivilDate(item.dueAt)}
              </span>
            </span>
            <span className="flex items-center gap-1">
              {item.overdue ? <Badge variant="outline" className="border-amber-500/40 text-amber-700">Atrasada</Badge> : null}
              <Badge variant="outline">{item.statusLabel}</Badge>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
