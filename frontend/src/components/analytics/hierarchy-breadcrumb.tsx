"use client"

import { ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { breadcrumbToRef, type SubjectRef } from "@/lib/analytics/subject-params"
import type { BreadcrumbEntry } from "@/schemas/analytics/analytics.schema"

/** Trilha da estrutura em análise — o usuário nunca fica sem saber "de quem" são os números.
 * O último item é o sujeito atual; os anteriores navegam de volta pela cadeia. Sem `onNavigate` a trilha só informa a
 * cadeia: nenhum item vira botão (quem não tem estrutura própria não tem para onde subir). */
export function HierarchyBreadcrumb({ entries, onNavigate }: { entries: BreadcrumbEntry[]; onNavigate?: (subject: SubjectRef | null) => void }) {
  if (entries.length <= 1) return null
  return (
    <nav aria-label="Estrutura em análise" className="flex flex-wrap items-center gap-1 text-sm">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1
        return (
          <span key={`${entry.kind}:${entry.id}`} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden /> : null}
            {isLast ? (
              <span className="rounded-md px-1.5 py-0.5 font-medium" aria-current="location">
                {entry.label}
              </span>
            ) : onNavigate ? (
              <Button type="button" variant="ghost" size="sm" className="h-7 px-1.5 text-muted-foreground" onClick={() => onNavigate(index === 0 ? null : breadcrumbToRef(entry))}>
                {entry.label}
              </Button>
            ) : (
              <span className="px-1.5 py-0.5 text-muted-foreground">{entry.label}</span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
