"use client"

import { useMemo, useState, type ReactNode } from "react"
import { CalendarClock, CircleCheck, CircleMinus, CirclePause, Clock, HeartHandshake, Hourglass, KeyRound, MessagesSquare, RefreshCw, Unplug, UserCheck, UserRoundX, UserX, WifiOff, type LucideIcon } from "lucide-react"

import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { ListNoResultsState } from "@/components/admin/shared/list/list-states"
import { ListSearchInput, ListSelectFilter, ListToolbar } from "@/components/admin/shared/list/list-filters"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusChip, SURFACE_CARD, toneChip, type Tone } from "@/components/ui/surface"
import { TABLE_FRAME, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { GridSection } from "@/components/ui/customizable-grid/layout"
import { formatClockTime } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { PersonAvatar } from "@/components/profile/person-avatar"
import { ANJOS_NOW_REFRESH_MS, useAnjosNowQuery, useQueueWaitingQuery } from "@/queries/human-support/use-human-support-admin"
import { PAUSE_REASON_LABELS, PAUSE_REASONS } from "@/schemas/human-support/catalogs.schema"
import type { AnjoNowItem, QueueNow } from "@/schemas/human-support/monitoring.schema"

import { LiveTimer } from "./live-timer"
import { TermHint, type Term } from "../history/term-hint"
import { PanelError } from "./panel-error"

/**
 * SITUAÇÃO DOS ANJOS AGORA (aba Anjos). Duas informações separadas: a situação CADASTRAL (ativo/inativo: pessoa e conta ativas,
 * acesso liberado) e o STATUS OPERACIONAL que o sistema registra — Disponível, Em atendimento (disponível com atendimento aberto),
 * Em pausa (com o motivo) ou Indisponível —, com "há quanto tempo" desde a transição real (o servidor calcula; a tela só conta pelo
 * relógio do servidor), sem contador para Indisponível. A área do Anjo fechada aparece à parte ("Sem conexão"): o Anjo declarado
 * Disponível ou Em pausa não recebe atendimento sem ela. Não depende do período do painel; atualiza sozinho a cada 5 s e, ao voltar a
 * conexão ou o foco, relê o servidor na hora.
 *
 * Migration 191: Indisponível com a área aberta (voluntário, conta como tempo online) separado de OFFLINE (área fechada); sessão
 * encerrada (logout, prazo do login, inatividade) à parte da queda de rede; pausa ou indisponibilidade PROGRAMADA sinalizada; as pausas
 * por tipo; e a FILA — quantos operadores aguardam um Anjo, há quanto tempo o mais antigo (desde a entrada original) e quantos já
 * acolhidos esperam a primeira resposta (a atribuição é direta: não existe oferta pendente). Só da coordenação (Coordenador de Anjos
 * e Administrador geral): o Anjo não vê esta seção.
 */
type StatusLook = { label: string; icon: LucideIcon; tone: Tone }
/** Indisponível e offline são o MESMO estado (decisão do responsável em 11/11/2026): um rótulo, uma contagem, um filtro. */
type DisplayStatus = "AVAILABLE" | "IN_ATTENDANCE" | "PAUSED" | "UNAVAILABLE"
const STATUS: Record<DisplayStatus, StatusLook & { term?: Term }> = {
  AVAILABLE: { label: "Disponível", icon: CircleCheck, tone: "success", term: "available" },
  IN_ATTENDANCE: { label: "Em atendimento", icon: MessagesSquare, tone: "info", term: "attendance" },
  PAUSED: { label: "Em pausa", icon: CirclePause, tone: "warning" },
  UNAVAILABLE: { label: "Indisponível", icon: CircleMinus, tone: "neutral", term: "unavailable" },
}
const STATUS_ORDER: DisplayStatus[] = ["AVAILABLE", "IN_ATTENDANCE", "PAUSED", "UNAVAILABLE"]

export const displayStatusOf = (item: Pick<AnjoNowItem, "status">): DisplayStatus => item.status

export function statusText(item: Pick<AnjoNowItem, "status" | "pauseReason">): string {
  const base = STATUS[displayStatusOf(item)].label
  return item.status === "PAUSED" && item.pauseReason ? `${base} — ${PAUSE_REASON_LABELS[item.pauseReason]}` : base
}

const scheduledText = (scheduled: NonNullable<AnjoNowItem["scheduled"]>) =>
  scheduled.status === "OFFLINE" ? "Indisponível programado" : `Pausa programada${scheduled.pauseReason ? ` — ${PAUSE_REASON_LABELS[scheduled.pauseReason]}` : ""}`

/** "há menos de 1 min", "há 12 min", "há 1 h 5 min". */
export function agoText(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return "há menos de 1 min"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `há ${hours} h ${rest} min` : `há ${hours} h`
}

type Filters = { search: string; active?: "ACTIVE" | "INACTIVE" | undefined; status?: DisplayStatus | "DISCONNECTED" | undefined; group?: string | undefined }
const scopeKey = (scope: AnjoNowItem["scopes"][number]) => `${scope.type}:${scope.id ?? ""}`
const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()

/** Enquanto a situação não chega ou se falhar, cada card mostra o próprio estado (nunca some em silêncio). */
function NowState({ query, children, skeleton = "h-16" }: { query: ReturnType<typeof useAnjosNowQuery>; children: () => ReactNode; skeleton?: string }) {
  if (query.isPending) return <Skeleton className={cn(skeleton, "w-full rounded-xl")} aria-label="Carregando a situação dos Anjos" />
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  return <>{children()}</>
}

/**
 * ÁREA "OPERAÇÃO AGORA" do catálogo da Monitoria Online (grade personalizável — padrão do app): cinco cards que dividem a mesma leitura
 * (relida a cada 5 s) e o mesmo filtro — clicar num estado filtra a tabela de Anjos. Cards: fila, sem 1ª resposta, operadores na fila,
 * Anjos por estado e a tabela de Anjos.
 */
export function useOperationNowSection(filter: { teamId?: readonly string[] | null; subteamId?: readonly string[] | null }): GridSection {
  const scope = { teamId: filter.teamId ?? null, subteamId: filter.subteamId ?? null }
  const query = useAnjosNowQuery(scope)
  const [filters, setFilters] = useState<Filters>({ search: "" })
  // Relógio do servidor menos o desta tela no momento da resposta: os tempos contam pelo servidor, também depois de recarregar.
  const offset = query.data ? Date.parse(query.data.serverTime) - query.dataUpdatedAt : 0

  const items = useMemo(() => query.data?.items ?? [], [query.data])
  const groups = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items) for (const scopeItem of item.scopes) if (scopeItem.type !== "ORGANIZATION") map.set(scopeKey(scopeItem), scopeItem.name)
    return [...map.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, "pt-BR"))
  }, [items])
  const shown = items.filter((item) => {
    if (filters.search && !normalize(item.name).includes(normalize(filters.search))) return false
    if (filters.active && (filters.active === "ACTIVE") !== item.active) return false
    if (filters.status === "DISCONNECTED" && (item.connected || item.status === "UNAVAILABLE")) return false
    if (filters.status && filters.status !== "DISCONNECTED" && displayStatusOf(item) !== filters.status) return false
    if (filters.group && !item.scopes.some((scopeItem) => scopeItem.type === "ORGANIZATION" || scopeKey(scopeItem) === filters.group)) return false
    return true
  })
  const hasFilters = Boolean(filters.search || filters.active || filters.status || filters.group)
  const counts = STATUS_ORDER.map((status) => ({ status, count: items.filter((item) => item.active && displayStatusOf(item) === status).length }))
  const disconnected = items.filter((item) => item.active && !item.connected && item.status !== "UNAVAILABLE").length
  const sessionEnded = items.filter((item) => item.active && item.connection === "SESSION_ENDED").length
  const scheduled = items.filter((item) => item.active && item.scheduled).length
  const pausesByReason = PAUSE_REASONS.map((reason) => ({ reason, count: items.filter((item) => item.active && item.status === "PAUSED" && item.pauseReason === reason).length })).filter((entry) => entry.count > 0)
  const inactive = items.filter((item) => !item.active).length
  const queue = query.data?.queue ?? { waiting: 0, oldestWaitingSince: null, awaitingFirstResponse: 0, oldestAwaitingSince: null, awaitingOperator: 0 }

  return {
    id: "operacao-agora",
    title: "Operação agora",
    description: "O status de cada Anjo e a fila neste momento.",
    aside: (
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground" role="status">
        <RefreshCw className={cn("size-3.5", query.isFetching && "animate-spin motion-reduce:animate-none")} aria-hidden />
        Cronômetros ao vivo · dados relidos a cada {ANJOS_NOW_REFRESH_MS / 1000} s
      </p>
    ),
    cards: [
      { id: "fila", title: "Operadores aguardando", defaultWidth: 4, render: () => <NowState query={query}>{() => <QueueWaitingCard queue={queue} offsetMs={offset} />}</NowState> },
      { id: "sem-resposta", title: "Aguardando a 1ª resposta", defaultWidth: 4, render: () => <NowState query={query}>{() => <QueueAwaitingCard queue={queue} offsetMs={offset} />}</NowState> },
      { id: "aguardando-operador", title: "Aguardando o operador", defaultWidth: 4, render: () => <NowState query={query}>{() => <AwaitingOperatorCard queue={queue} />}</NowState> },
      { id: "operadores-na-fila", title: "Operadores na fila", defaultWidth: 12, widths: [6, 8, 9, 12], render: () => <QueueTableCard filter={scope} offsetMs={offset} /> },
      {
        id: "estados",
        title: "Anjos por estado",
        defaultWidth: 12,
        widths: [6, 8, 9, 12],
        render: () => (
          <NowState query={query}>
            {() =>
              items.length === 0 ? (
                <AnalyticsEmptyState icon={HeartHandshake} title="Nenhum Anjo no seu alcance" description="Aparecem aqui as pessoas com o papel de Anjo nos escopos que o seu papel cobre." />
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Quantos Anjos ativos em cada status (clique para filtrar)">
                    {counts.map(({ status, count }) => {
                      const look = STATUS[status]
                      const pressed = filters.status === status
                      return (
                        <div key={status} className="relative">
                          <button
                            type="button"
                            aria-pressed={pressed}
                            onClick={() => setFilters((current) => ({ ...current, status: pressed ? undefined : status }))}
                            className={cn("flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 text-left shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50", pressed ? "border-primary ring-1 ring-primary/40" : "border-border")}
                          >
                            <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(look.tone))}>
                              <look.icon className="size-4" aria-hidden />
                            </span>
                            <span className="leading-tight">
                              <span className="block text-xl font-semibold tabular-nums">{count}</span>
                              <span className="text-xs text-muted-foreground">{look.label}</span>
                            </span>
                          </button>
                          {/* O ⓘ fica fora do botão (nada clicável dentro de outro). */}
                          {look.term ? <TermHint term={look.term} label={look.label} className="absolute top-2 right-2" /> : null}
                        </div>
                      )
                    })}
                  </div>
                  {disconnected > 0 || inactive > 0 || sessionEnded > 0 || scheduled > 0 || pausesByReason.length > 0 ? (
                    <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {pausesByReason.length > 0 ? <span className="inline-flex items-center gap-1"><CirclePause className="size-3.5" aria-hidden />Em pausa: {pausesByReason.map((entry) => `${PAUSE_REASON_LABELS[entry.reason]} ${entry.count}`).join(" · ")}</span> : null}
                      {scheduled > 0 ? <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" aria-hidden />{scheduled} com pausa ou indisponibilidade programada</span> : null}
                      {sessionEnded > 0 ? <span className="inline-flex items-center gap-1"><KeyRound className="size-3.5" aria-hidden />{sessionEnded} com a sessão encerrada (precisa entrar de novo)</span> : null}
                      {disconnected > 0 ? <span className="inline-flex items-center gap-1"><WifiOff className="size-3.5 text-destructive" aria-hidden />{disconnected} {disconnected === 1 ? "Anjo declarado em serviço está" : "Anjos declarados em serviço estão"} sem a área do Anjo aberta</span> : null}
                      {inactive > 0 ? <span className="inline-flex items-center gap-1"><UserX className="size-3.5" aria-hidden />{inactive} {inactive === 1 ? "Anjo inativo" : "Anjos inativos"} no cadastro (fora das contagens acima)</span> : null}
                    </p>
                  ) : null}
                </div>
              )
            }
          </NowState>
        ),
      },
      {
        id: "anjos",
        title: "Anjos agora",
        defaultWidth: 12,
        widths: [8, 9, 12],
        render: () => (
          <NowState query={query} skeleton="h-40">
            {() =>
              items.length === 0 ? null : (
                <div className="space-y-3">
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
                            <AnjoNowRow key={item.personId} item={item} offsetMs={offset} />
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )
            }
          </NowState>
        ),
      },
    ],
  }
}

function AnjoNowRow({ item, offsetMs }: { item: AnjoNowItem; offsetMs: number }) {
  const since = item.since ? Date.parse(item.since) : null
  const lost = !item.connected && item.status !== "UNAVAILABLE"
  const displayed = displayStatusOf(item)
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
          <StatusChip tone={STATUS[displayed].tone} icon={STATUS[displayed].icon} data-status={displayed}>{statusText(item)}</StatusChip>
          {item.connection === "SESSION_ENDED" ? (
            <StatusChip tone="danger" icon={KeyRound}>Sessão encerrada{lost && item.connectionLostSince ? <> · <LiveTimer since={item.connectionLostSince} offsetMs={offsetMs} /></> : null}</StatusChip>
          ) : lost ? (
            <StatusChip tone="danger" icon={WifiOff}>Sem conexão{item.connectionLostSince ? <> · <LiveTimer since={item.connectionLostSince} offsetMs={offsetMs} /></> : null}</StatusChip>
          ) : null}
          {item.scheduled ? <StatusChip tone="warning" icon={CalendarClock}>{scheduledText(item.scheduled)}</StatusChip> : null}
          {item.unresponsive ? (
            // Migration 195: o motivo de o sistema ter tirado o Anjo de serviço.
            <StatusChip tone="danger" icon={Unplug} data-testid="anjo-now-unresponsive">
              {item.unresponsive.kind === "PAUSED"
                ? `Sem responder ninguém${item.unresponsive.offlineAt ? ` · Indisponível às ${formatClockTime(item.unresponsive.offlineAt)}` : ""}`
                : `Indisponível pelo sistema: não respondia ninguém (${formatClockTime(item.unresponsive.since)})`}
            </StatusChip>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="tabular-nums" data-testid="anjo-now-since">
        {displayed === "UNAVAILABLE" ? (
          <span className="text-muted-foreground" aria-label="Sem contador para Indisponível">—</span>
        ) : since === null || Number.isNaN(since) ? (
          <span className="text-muted-foreground">Sem registro do horário</span>
        ) : (
          <LiveTimer since={item.since} offsetMs={offsetMs} />
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {item.attendances.active} de {item.attendances.capacity}
      </TableCell>
    </TableRow>
  )
}

/** Card da fila: quantos operadores aguardam um Anjo e a maior espera (desde a entrada original), em cronômetro. */
function QueueWaitingCard({ queue, offsetMs }: { queue: QueueNow; offsetMs: number }) {
  return (
    <div className={cn("flex h-full items-center gap-3 rounded-xl border bg-card px-3 py-2.5 shadow-xs", queue.waiting > 0 ? "border-amber-500/50" : "border-border")} data-testid="queue-waiting">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(queue.waiting > 0 ? "warning" : "neutral"))}>
        <Hourglass className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-sm font-medium">{queue.waiting === 0 ? "Sem fila" : `${queue.waiting} ${queue.waiting === 1 ? "operador aguarda" : "operadores aguardam"} um Anjo`}</span>
        <span className="text-xs text-muted-foreground">
          {queue.waiting > 0 && queue.oldestWaitingSince ? (
            <>
              Maior espera: <LiveTimer since={queue.oldestWaitingSince} offsetMs={offsetMs} testId="queue-oldest-timer" />
            </>
          ) : (
            "Ninguém aguardando agora"
          )}
        </span>
      </span>
    </div>
  )
}

/** Card dos pedidos cujo operador ficou sem responder: o Anjo foi liberado e o pedido aguarda o retorno dele (migration 193). */
function AwaitingOperatorCard({ queue }: { queue: QueueNow }) {
  return (
    <div className="flex h-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs" data-testid="queue-awaiting-operator">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(queue.awaitingOperator > 0 ? "warning" : "neutral"))}>
        <UserRoundX className="size-4" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-medium">
          {queue.awaitingOperator === 0 ? "Nenhum aguardando o operador" : `${queue.awaitingOperator} ${queue.awaitingOperator === 1 ? "pedido aguarda" : "pedidos aguardam"} o operador`}
        </span>
        <span className="text-xs text-muted-foreground">O operador ficou sem responder; o Anjo já foi liberado.</span>
      </span>
    </div>
  )
}

/** Card dos acolhidos que ainda esperam a 1ª resposta do Anjo (o mais antigo em cronômetro). */
function QueueAwaitingCard({ queue, offsetMs }: { queue: QueueNow; offsetMs: number }) {
  return (
    <div className="flex h-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 shadow-xs" data-testid="queue-awaiting">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", toneChip(queue.awaitingFirstResponse > 0 ? "info" : "neutral"))}>
        <Clock className="size-4" aria-hidden />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-medium">{queue.awaitingFirstResponse === 0 ? "Todos já responderam" : `${queue.awaitingFirstResponse} ${queue.awaitingFirstResponse === 1 ? "atendimento aguarda" : "atendimentos aguardam"} a 1ª resposta`}</span>
        <span className="text-xs text-muted-foreground">
          {queue.awaitingFirstResponse > 0 && queue.oldestAwaitingSince ? (
            <>
              Sem resposta há <LiveTimer since={queue.oldestAwaitingSince} offsetMs={offsetMs} />
            </>
          ) : (
            "Acolhidos já com resposta do Anjo"
          )}
        </span>
      </span>
    </div>
  )
}

/** Card "Operadores na fila": a tabela de quem aguarda e há quanto tempo, sempre à vista. */
function QueueTableCard({ filter, offsetMs }: { filter: { teamId: readonly string[] | null; subteamId: readonly string[] | null }; offsetMs: number }) {
  return (
    <section aria-labelledby="queue-table-title" className="space-y-2">
      <h3 id="queue-table-title" className="text-sm font-medium">
        Operadores na fila
      </h3>
      <QueueTable filter={filter} offsetMs={offsetMs} />
    </section>
  )
}

/** Quem está na fila agora, do que espera há mais tempo; a espera conta da entrada original (o pedido devolvido à fila mantém o horário). */
function QueueTable({ filter, offsetMs }: { filter: { teamId: readonly string[] | null; subteamId: readonly string[] | null }; offsetMs: number }) {
  const query = useQueueWaitingQuery(filter, true)
  if (query.isPending) return <Skeleton className="h-24 w-full rounded-xl" aria-label="Carregando a fila" />
  if (query.isError) return <PanelError error={query.error} onRetry={() => void query.refetch()} />
  if (query.data.length === 0)
    return (
      <p className={cn(SURFACE_CARD, "border-dashed px-3 py-3 text-center text-sm text-muted-foreground")} data-testid="queue-empty">
        Ninguém aguardando atendimento agora.
      </p>
    )
  return (
    <div className={TABLE_FRAME} id="queue-waiting-table">
      <Table aria-label="Operadores na fila">
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-44">Operador</TableHead>
            <TableHead>Grupo › Subgrupo</TableHead>
            <TableHead>Pedido</TableHead>
            <TableHead className="text-right">Na fila há</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {query.data.map((item) => (
            <TableRow key={item.requestId} data-testid={`queue-row-${item.requestId}`}>
              <TableCell>
                <span className="flex items-center gap-2 font-medium">
                  <PersonAvatar name={item.operatorName} avatarUrl={item.operatorAvatarUrl} className="size-7" />
                  {item.operatorName}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{[item.teamName ?? "Sem Grupo", item.subteamName].filter(Boolean).join(" › ")}</TableCell>
              <TableCell className="text-sm">
                <span className="font-mono">{item.protocol}</span>
                {item.requeued ? <span className="ml-1.5 text-xs text-muted-foreground">(voltou à fila)</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                <LiveTimer since={item.waitingSince} offsetMs={offsetMs} testId={`queue-timer-${item.requestId}`} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
