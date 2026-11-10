"use client"

import { useMemo, useState } from "react"
import { CircleCheck, CircleMinus, CirclePause, HeartHandshake, MessagesSquare, RefreshCw, UserCheck, UserX, WifiOff, type LucideIcon } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { ListNoResultsState } from "@/components/admin/shared/list/list-states"
import { ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { Skeleton } from "@/components/ui/skeleton"
import { SectionLabel, StatusChip, toneChip, type Tone } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { cn } from "@/lib/utils"
import { ANJOS_NOW_REFRESH_MS, useAnjosNowQuery } from "@/queries/human-support/use-human-support-admin"
import { PAUSE_REASON_LABELS } from "@/schemas/human-support/catalogs.schema"
import type { AnjoNowItem, AnjoNowStatus } from "@/schemas/human-support/monitoring.schema"

import { useClock } from "../anjo/use-clock"
import { PanelError } from "./panel-error"

/**
 * SITUAÇÃO DOS ANJOS AGORA (aba Anjos). Duas informações separadas: a situação CADASTRAL (ativo/inativo: pessoa e conta ativas,
 * acesso liberado) e o STATUS OPERACIONAL que o sistema registra — Disponível, Em atendimento (disponível com atendimento aberto),
 * Em pausa (com o motivo) ou Indisponível —, com "há quanto tempo" desde a transição real (o servidor calcula; a tela só conta pelo
 * relógio do servidor), sem contador para Indisponível. A área do Anjo fechada aparece à parte ("Sem conexão"): o Anjo declarado
 * Disponível ou Em pausa não recebe atendimento sem ela. Não depende do período do painel; atualiza sozinho a cada 15 s.
 */
type StatusLook = { label: string; icon: LucideIcon; tone: Tone }
const STATUS: Record<AnjoNowStatus, StatusLook> = {
  AVAILABLE: { label: "Disponível", icon: CircleCheck, tone: "success" },
  IN_ATTENDANCE: { label: "Em atendimento", icon: MessagesSquare, tone: "info" },
  PAUSED: { label: "Em pausa", icon: CirclePause, tone: "warning" },
  UNAVAILABLE: { label: "Indisponível", icon: CircleMinus, tone: "neutral" },
}
const STATUS_ORDER: AnjoNowStatus[] = ["AVAILABLE", "IN_ATTENDANCE", "PAUSED", "UNAVAILABLE"]

export function statusText(item: Pick<AnjoNowItem, "status" | "pauseReason">): string {
  const base = STATUS[item.status].label
  return item.status === "PAUSED" && item.pauseReason ? `${base} — ${PAUSE_REASON_LABELS[item.pauseReason]}` : base
}

/** "há menos de 1 min", "há 12 min", "há 1 h 5 min". */
export function agoText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "há menos de 1 min"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `há ${hours} h ${rest} min` : `há ${hours} h`
}

type Filters = { search: string; active?: "ACTIVE" | "INACTIVE" | undefined; status?: AnjoNowStatus | "DISCONNECTED" | undefined; group?: string | undefined }
const scopeKey = (scope: AnjoNowItem["scopes"][number]) => `${scope.type}:${scope.id ?? ""}`
const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

export function AnjosNowSection({ filter }: { filter: { teamId?: string | null; subteamId?: string | null } }) {
  const query = useAnjosNowQuery({ teamId: filter.teamId ?? null, subteamId: filter.subteamId ?? null })
  const [filters, setFilters] = useState<Filters>({ search: "" })
  const now = useClock(5_000)
  // Relógio do servidor menos o desta tela no momento da resposta: os tempos contam pelo servidor, também depois de recarregar.
  const offset = query.data ? Date.parse(query.data.serverTime) - query.dataUpdatedAt : 0

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const groups = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) for (const scope of item.scopes) if (scope.type !== "ORGANIZATION") map.set(scopeKey(scope), scope.name)
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
  }, [items])
  const shown = items.filter((item) => {
    if (filters.search && !normalize(item.name).includes(normalize(filters.search))) return false
    if (filters.active && (filters.active === "ACTIVE") !== item.active) return false
    if (filters.status === "DISCONNECTED" && (item.connected || item.status === "UNAVAILABLE")) return false
    if (filters.status && filters.status !== "DISCONNECTED" && item.status !== filters.status) return false
    if (filters.group && !item.scopes.some((scope) => scope.type === "ORGANIZATION" || scopeKey(scope) === filters.group)) return false
    return true
  })
  const hasFilters = Boolean(filters.search || filters.active || filters.status || filters.group)
  const counts = STATUS_ORDER.map((status) => ({ status, count: items.filter((item) => item.active && item.status === status).length }))
  const disconnected = items.filter((item) => item.active && !item.connected && item.status !== "UNAVAILABLE").length
  const inactive = items.filter((item) => !item.active).length

  return (
    <section aria-labelledby="anjos-now-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-0.5">
          <SectionLabel id="anjos-now-title">Situação agora</SectionLabel>
          <p className="text-sm text-muted-foreground">O status de cada Anjo neste momento. Não depende do período escolhido acima.</p>
        </div>
        <p className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
          <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden />
          Atualiza sozinho a cada {ANJOS_NOW_REFRESH_MS / 1000} s
        </p>
      </div>

      {query.isPending ? (
        <div className="space-y-3" aria-label="Carregando a situação dos Anjos" aria-busy>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{STATUS_ORDER.map((status) => <Skeleton key={status} className="h-16 rounded-xl" />)}</div>
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : query.isError ? (
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      ) : items.length === 0 ? (
        <AnalyticsEmptyState icon={HeartHandshake} title="Nenhum Anjo no seu alcance" description="Aparecem aqui as pessoas com o papel de Anjo nos escopos que o seu papel cobre." />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Quantos Anjos ativos em cada status (clique para filtrar)">
            {counts.map(({ status, count }) => {
              const look = STATUS[status]
              const pressed = filters.status === status
              return (
                <button
                  key={status}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setFilters((current) => ({ ...current, status: pressed ? undefined : status }))}
                  className={cn("flex items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50", pressed ? "border-primary ring-1 ring-primary/40" : "border-border")}
                >
                  <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(look.tone))}>
                    <look.icon className="size-4" aria-hidden />
                  </span>
                  <span className="leading-tight">
                    <span className="block text-xl font-semibold tabular-nums">{count}</span>
                    <span className="text-xs text-muted-foreground">{look.label}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {disconnected > 0 || inactive > 0 ? (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {disconnected > 0 ? <span className="inline-flex items-center gap-1"><WifiOff className="size-3.5 text-destructive" aria-hidden />{disconnected} {disconnected === 1 ? "Anjo declarado em serviço está" : "Anjos declarados em serviço estão"} sem a área do Anjo aberta</span> : null}
              {inactive > 0 ? <span className="inline-flex items-center gap-1"><UserX className="size-3.5" aria-hidden />{inactive} {inactive === 1 ? "Anjo inativo" : "Anjos inativos"} no cadastro (fora das contagens acima)</span> : null}
            </p>
          ) : null}

          <ListToolbar
            search={<ListSearchInput value={filters.search} onChange={(search) => setFilters((current) => ({ ...current, search }))} placeholder="Buscar Anjo pelo nome" ariaLabel="Buscar Anjo" />}
            hasActiveFilters={hasFilters}
            onClearFilters={() => setFilters({ search: "" })}
          >
            <ListSelectFilter value={filters.status} onChange={(status) => setFilters((current) => ({ ...current, status }))} allLabel="Todos os status" ariaLabel="Status operacional" options={[...STATUS_ORDER.map((status) => ({ value: status, label: STATUS[status].label })), { value: "DISCONNECTED" as const, label: "Sem conexão" }]} />
            <ListSelectFilter value={filters.active} onChange={(active) => setFilters((current) => ({ ...current, active }))} allLabel="Ativos e inativos" ariaLabel="Situação cadastral" options={[{ value: "ACTIVE", label: "Ativos" }, { value: "INACTIVE", label: "Inativos" }]} />
            {groups.length > 1 ? <ListSelectFilter value={filters.group} onChange={(group) => setFilters((current) => ({ ...current, group }))} allLabel="Todos os grupos" ariaLabel="Grupo atendido" options={groups} /> : null}
          </ListToolbar>

          {shown.length === 0 ? (
            <ListNoResultsState title="Nenhum Anjo com esses filtros" onClear={() => setFilters({ search: "" })} />
          ) : (
            <div className={TABLE_FRAME}>
              <Table aria-label="Situação dos Anjos agora">
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-48">Anjo</TableHead>
                    <TableHead>Cadastro</TableHead>
                    <TableHead className="min-w-52">Status agora</TableHead>
                    <TableHead>Há quanto tempo</TableHead>
                    <TableHead className="text-right">Atendimentos agora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((item) => (
                    <AnjoNowRow key={item.personId} item={item} now={now + offset} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function AnjoNowRow({ item, now }: { item: AnjoNowItem; now: number }) {
  const look = STATUS[item.status]
  const since = item.since ? Date.parse(item.since) : null
  const lost = !item.connected && item.status !== "UNAVAILABLE"
  return (
    <TableRow data-testid={`anjo-now-${item.personId}`} className={cn(!item.active && "text-muted-foreground")}>
      <TableCell className="whitespace-normal">
        <span className="block font-medium text-foreground">{item.name}</span>
        <span className="block text-xs text-muted-foreground">Atende: {item.scopes.map((scope) => scope.name).join(" · ") || "—"}</span>
      </TableCell>
      <TableCell>
        {item.active ? (
          <span className="inline-flex items-center gap-1.5 text-sm"><UserCheck className="size-4 text-emerald-700 dark:text-emerald-300" aria-hidden />Ativo</span>
        ) : (
          <StatusChip tone="neutral" icon={UserX}>Inativo</StatusChip>
        )}
      </TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusChip tone={look.tone} icon={look.icon} data-status={item.status}>{statusText(item)}</StatusChip>
          {lost ? <StatusChip tone="danger" icon={WifiOff}>Sem conexão{item.connectionLostSince ? ` ${agoText(now - Date.parse(item.connectionLostSince))}` : ""}</StatusChip> : null}
        </div>
      </TableCell>
      <TableCell className="tabular-nums" data-testid="anjo-now-since">
        {item.status === "UNAVAILABLE" ? (
          <span className="text-muted-foreground" aria-label="Sem contador para Indisponível">—</span>
        ) : since === null || Number.isNaN(since) ? (
          <span className="text-muted-foreground">Sem registro do horário</span>
        ) : (
          <time dateTime={item.since!} title={new Date(since).toLocaleString("pt-BR")}>{agoText(now - since)}</time>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.attendances.active} de {item.attendances.capacity}
      </TableCell>
    </TableRow>
  )
}
