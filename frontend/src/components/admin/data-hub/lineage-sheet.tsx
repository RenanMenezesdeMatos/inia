"use client"

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { ArrowRight, GitBranch } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useLineageQuery } from "@/queries/admin/use-data-hub-queries"
import { SOURCE_KIND_LABELS, type LineageEntry } from "@/schemas/admin/data-hub.schema"

import { formatRelative } from "./data-hub-format"

/**
 * "Origem do dado" — linhagem SIMPLES de uma entidade (período de situação funcional, dia de
 * escala, pessoa, medição…): Fonte → Feed → Carga → registro. Reaproveita a API de lineage que a
 * Central já tem (`GET /admin/data-hub/lineage`); é uma lista cronológica, não um grafo.
 * Entidade sem linhagem (registro manual, massa demo, anterior à Central) mostra isso em texto.
 */
export function LineageTrail({ entries }: { entries: LineageEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Sem linhagem na Central de Dados: este registro nasceu de um cadastro manual, da massa de demonstração ou é anterior à Central.</p>
  return (
    <ol className="space-y-3" aria-label="Linhagem">
      {entries.map((entry) => (
        <li key={`${entry.runId}-${entry.createdAt}`} className="rounded-lg border border-border p-3 text-sm" data-testid="lineage-entry">
          <p className="flex flex-wrap items-center gap-1.5">
            <Link href={`/admin/data-hub/sources/${entry.sourceId}`} className="font-medium underline-offset-2 hover:underline">
              {entry.sourceName}
            </Link>
            <span className="text-xs text-muted-foreground">({SOURCE_KIND_LABELS[entry.sourceKind]})</span>
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
            <Link href={`/admin/data-hub/feeds/${entry.feedId}`} className="underline-offset-2 hover:underline">
              {entry.feedName}
            </Link>
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden />
            <Link href={`/admin/data-hub/runs/${entry.runId}`} className="underline-offset-2 hover:underline">
              Carga {entry.runId.slice(0, 8)}
            </Link>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {entry.action === "INSERTED" ? "Criado" : "Atualizado"} {formatRelative(entry.createdAt)}
            {entry.sourceRecordKey ? ` · registro ${entry.sourceRecordKey}` : entry.recordNumber !== null ? ` · linha ${entry.recordNumber}` : ""}
            {` · contrato ${entry.contractKey}`}
          </p>
        </li>
      ))}
    </ol>
  )
}

export function LineageSheet({ entityType, entityId, title, description, open, onOpenChange }: { entityType: string; entityId: string | null; title: string; description?: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const query = useLineageQuery(entityType, open ? entityId : null)
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <GitBranch className="size-4" aria-hidden /> {title}
          </SheetTitle>
          <SheetDescription>{description ?? "De onde este dado veio: fonte, feed, carga e registro de origem, do mais recente ao mais antigo."}</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-4">
          {!entityId ? <p className="text-sm text-muted-foreground">Este registro não tem identificador rastreável.</p> : query.isLoading ? <Skeleton className="h-24 rounded-lg" /> : query.isError ? <p className="text-sm text-destructive">Não foi possível carregar a linhagem.</p> : <LineageTrail entries={query.data ?? []} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** Botão discreto "Origem" que abre o sheet — usado no perfil, no admin e na Central. */
export function LineageButton({ entityType, entityId, title, label = "Origem do dado", size = "sm" }: { entityType: string; entityId: string | null; title: string; label?: string; size?: "sm" | "xs" }) {
  return (
    <LineageDisclosure entityType={entityType} entityId={entityId} title={title}>
      {(openSheet) => (
        <Button type="button" variant="ghost" size="sm" className={size === "xs" ? "h-7 px-2 text-xs" : undefined} onClick={openSheet} disabled={!entityId} data-testid="lineage-button">
          <GitBranch aria-hidden /> {label}
        </Button>
      )}
    </LineageDisclosure>
  )
}

function LineageDisclosure({ entityType, entityId, title, children }: { entityType: string; entityId: string | null; title: string; children: (open: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {children(() => setOpen(true))}
      <LineageSheet entityType={entityType} entityId={entityId} title={title} open={open} onOpenChange={setOpen} />
    </>
  )
}
