"use client"

import Link from "next/link"
import { HeartHandshake, SearchX, ShieldPlus } from "lucide-react"
import { toast } from "sonner"

import { AnalyticsEmptyState, AnalyticsErrorState } from "@/components/analytics/analytics-states"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { useSaveAnjoCapacityMutation, useSupportAnjosQuery, useSupportScopesQuery, useSupportSettingsQuery } from "@/queries/human-support/use-human-support-admin"
import { NOT_ELIGIBLE_LABELS, type AnjoRow } from "@/schemas/human-support/admin.schema"
import { PRESENCE_STATUS_LABELS } from "@/schemas/human-support/catalogs.schema"

import { ScopeFilter, scopeFilterName, type ScopeFilterValue } from "./scope-filter"
import { CAPACITY_OPTIONS } from "./settings-tab"

/** Rota do editor de papéis que já existe (Usuários e acessos): é lá que se concede Anjo e Coordenador de Anjos. */
export const GRANT_ROLE_HREF = "/admin/users"
const DEFAULT = "default"

/**
 * Anjos › quem tem o papel Anjo, com os escopos do papel, a situação agora (estado declarado, conexão e vagas usadas) e a capacidade
 * própria (vazia = padrão da organização). Filtrando por Grupo/Subgrupo, a lista mostra só quem atende aquele escopo e, para cada um,
 * se pode receber um pedido agora — e por que não.
 */
export function AnjosTab({ filter, onFilterChange, canGrantRoles }: { filter: ScopeFilterValue; onFilterChange: (filter: ScopeFilterValue) => void; canGrantRoles: boolean }) {
  const scopes = useSupportScopesQuery()
  const settings = useSupportSettingsQuery()
  const query = useSupportAnjosQuery({ teamId: filter.teamId ?? null, subteamId: filter.subteamId ?? null })
  const filtered = Boolean(filter.teamId || filter.subteamId)
  const scopeName = scopeFilterName(scopes.data ?? [], filter)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ScopeFilter nodes={scopes.data ?? []} value={filter} onChange={onFilterChange} />
          {filtered ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onFilterChange({})}>
              Limpar filtro
            </Button>
          ) : null}
        </div>
        {canGrantRoles ? (
          <Button asChild variant="outline" size="sm">
            <Link href={GRANT_ROLE_HREF}>
              <ShieldPlus data-icon="inline-start" aria-hidden />
              Conceder papel
            </Link>
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">Os papéis Anjo e Coordenador de Anjos, com o escopo de cada um, são concedidos em Usuários e acessos.</p>

      {query.isPending ? (
        <Skeleton className="h-48 w-full rounded-xl" aria-label="Carregando os Anjos" />
      ) : query.isError ? (
        <AnalyticsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.length === 0 ? (
        <AnalyticsEmptyState
          icon={filtered ? SearchX : HeartHandshake}
          title={filtered ? `Ninguém atende ${scopeName ?? "este escopo"}` : "Nenhuma pessoa com o papel Anjo"}
          description={filtered ? "Conceda o papel Anjo com um escopo que cubra este Grupo ou Subgrupo." : "Conceda o papel Anjo em Usuários e acessos para alguém atender os pedidos de apoio."}
        />
      ) : (
        <div className={TABLE_FRAME}>
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Anjo</TableHead>
                <TableHead>Escopos do papel</TableHead>
                <TableHead>Agora</TableHead>
                <TableHead>Atendimentos</TableHead>
                <TableHead className="w-52">Capacidade</TableHead>
                {filtered ? <TableHead>Pode receber agora?</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.map((row) => (
                <AnjoTableRow key={row.personId} row={row} filtered={filtered} defaultCapacity={settings.data?.defaultCapacity ?? null} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

function AnjoTableRow({ row, filtered, defaultCapacity }: { row: AnjoRow; filtered: boolean; defaultCapacity: number | null }) {
  const save = useSaveAnjoCapacityMutation()
  const value = row.maxConcurrent === null ? DEFAULT : String(row.maxConcurrent)
  return (
    <TableRow data-testid={`anjo-${row.personId}`}>
      <TableCell className="font-medium whitespace-normal">{row.name}</TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap gap-1">
          {row.scopes.map((scope) => (
            <Badge key={`${scope.type}:${scope.id ?? "org"}`} variant="outline" className="font-normal">
              {scope.name}
            </Badge>
          ))}
        </div>
      </TableCell>
      <TableCell className="whitespace-normal">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <span aria-hidden className={cn("size-2 shrink-0 rounded-full", row.connected && row.status === "AVAILABLE" ? "bg-emerald-500" : row.connected && row.status === "PAUSED" ? "bg-amber-500" : "bg-muted-foreground/40")} />
          {PRESENCE_STATUS_LABELS[row.status]}
          <span className="text-muted-foreground">· {row.connected ? "conectado" : "sem conexão"}</span>
        </span>
      </TableCell>
      <TableCell className="tabular-nums">
        {row.used} de {row.effectiveCapacity}
      </TableCell>
      <TableCell>
        <Select
          value={value}
          disabled={save.isPending}
          onValueChange={(next) =>
            save.mutate(
              { personId: row.personId, maxConcurrent: next === DEFAULT ? null : Number(next) },
              { onSuccess: (saved) => toast.success(`Capacidade de ${saved.name}: ${saved.effectiveCapacity}.`), onError: (error) => toast.error(error.message) },
            )
          }
        >
          <SelectTrigger className="w-full" aria-label={`Capacidade de ${row.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT}>Padrão da organização{defaultCapacity !== null ? ` (${defaultCapacity})` : ""}</SelectItem>
            {CAPACITY_OPTIONS.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option} {option === 1 ? "atendimento" : "atendimentos"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      {filtered ? (
        <TableCell className="whitespace-normal">
          {row.canReceiveAssignment ? (
            <span className="text-sm text-emerald-700 dark:text-emerald-400">Sim</span>
          ) : (
            <span className="text-sm">
              Não{row.reasonNotEligible ? <span className="text-muted-foreground"> — {NOT_ELIGIBLE_LABELS[row.reasonNotEligible]}</span> : null}
            </span>
          )}
        </TableCell>
      ) : null}
    </TableRow>
  )
}
