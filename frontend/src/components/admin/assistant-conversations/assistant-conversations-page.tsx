"use client"

import { useEffect, useRef } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, Lock, MessagesSquare, Mic, SearchX } from "lucide-react"

import { ListDateRangeFilter, ListSearchInput, ListSelectFilter, ListToolbar, optionsFromLabels } from "@/components/admin/shared/list/list-filters"
import { AnalyticsEmptyState } from "@/components/analytics/analytics-states"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useAdminListState } from "@/hooks/use-admin-list-state"
import { ApiError } from "@/lib/api/api-client"
import type { DateRangeFilter } from "@/lib/admin/list-query"
import { dateSeparatorLabel, dayKey, lastActivityLabel } from "@/lib/realtime/conversation-format"
import { cn } from "@/lib/utils"
import {
  fetchMonitoredConversations,
  MONITORING_ORIGIN_LABELS,
  MONITORING_STATUS_LABELS,
  type MonitoredConversation,
  type MonitoringOrigin,
  type MonitoringStatus,
} from "@/services/admin/assistant-conversations-service"

import { ConversationStatus, conversationKindOf, conversationSubjectOf, messagesLabel, OwnerAvatar } from "./conversation-presentation"
import { ConversationThread } from "./conversation-thread"

/** A lista de conversas se atualiza nesse intervalo (conversas em andamento sobem com a última atividade). */
export const LIST_POLL_INTERVAL_MS = 20_000
const PAGE_SIZE = 25

type Filters = { search: string; origin: MonitoringOrigin | undefined; status: MonitoringStatus | undefined; teamId: string | undefined; subteamId: string | undefined; period: DateRangeFilter }
const DEFAULT_FILTERS: Filters = { search: "", origin: undefined, status: undefined, teamId: undefined, subteamId: undefined, period: {} }

/**
 * "Conversas com a INIA" — leitura da troca REAL de mensagens entre colaboradores e a INIA (nunca resumo de IA, log ou tabela de
 * eventos), como uma caixa de entrada: a lista à esquerda, agrupada pelo dia da última atividade, com o tipo da conversa (livre,
 * sessão de feedback, recado), o assunto e a última mensagem; a conversa aberta à direita. No celular, uma de cada vez. O recorte de
 * quem aparece é do backend (escopo das atribuições); esta tela só filtra dentro dele.
 */
export function AssistantConversationsPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const selectedId = searchParams.get("conversation")
  const list = useAdminListState<Filters>({ storageKey: "assistant-conversations", defaultFilters: DEFAULT_FILTERS, defaultPageSize: PAGE_SIZE })
  const params = {
    search: list.params.search,
    origin: list.filters.origin,
    status: list.filters.status,
    teamId: list.filters.teamId,
    subteamId: list.filters.subteamId,
    from: list.filters.period.from,
    to: list.filters.period.to,
    page: list.page,
    pageSize: list.pageSize,
  }
  const query = useQuery({
    queryKey: ["admin-assistant-conversations", params],
    queryFn: () => fetchMonitoredConversations(params),
    placeholderData: keepPreviousData,
    refetchInterval: LIST_POLL_INTERVAL_MS,
  })

  // No celular a conversa aparece abaixo dos filtros: ao escolher uma, a tela vai até ela.
  const threadRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedId || typeof window.matchMedia !== "function" || !window.matchMedia("(max-width: 1023px)").matches) return
    threadRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" })
  }, [selectedId])

  function select(id: string | null) {
    const next = new URLSearchParams(searchParams.toString())
    if (id) next.set("conversation", id)
    else next.delete("conversation")
    router.replace(`${pathname}${next.size > 0 ? `?${next}` : ""}`, { scroll: false })
  }

  const options = query.data?.filterOptions
  const subteamOptions = (options?.subteams ?? []).filter((subteam) => !list.filters.teamId || subteam.teamId === list.filters.teamId)
  const forbidden = query.error instanceof ApiError && query.error.status === 403
  const total = query.data?.total ?? 0

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Conversas com a INIA</h1>
          <p className="text-sm text-muted-foreground">Leia o que os colaboradores do seu escopo conversaram com a INIA — conversas livres, sessões de feedback e recados. Somente leitura.</p>
        </div>
        {query.data ? <p className="text-sm text-muted-foreground tabular-nums">{total.toLocaleString("pt-BR")} {total === 1 ? "conversa" : "conversas"}{list.hasActiveFilters ? " com esses filtros" : ""}</p> : null}
      </header>

      {forbidden ? (
        <div className="flex flex-col items-center rounded-xl border p-8 text-center" role="alert">
          <Lock className="size-8 text-muted-foreground/60" aria-hidden />
          <p className="mt-3 font-medium">Sem acesso às conversas com a INIA</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">Peça a um administrador o papel “Leitor de conversas da INIA”.</p>
        </div>
      ) : (
        <>
          <ListToolbar
            search={<ListSearchInput value={list.filters.search} onChange={(value) => list.setFilter("search", value)} placeholder="Buscar por colaborador ou assunto" ariaLabel="Buscar conversa por colaborador ou assunto" pending={list.isSearchPending} />}
            hasActiveFilters={list.hasActiveFilters}
            onClearFilters={list.resetFilters}
          >
            <ListSelectFilter value={list.filters.origin} onChange={(value) => list.setFilter("origin", value)} options={optionsFromLabels(MONITORING_ORIGIN_LABELS)} allLabel="Todos os tipos" ariaLabel="Filtrar por tipo de conversa" />
            <ListSelectFilter value={list.filters.status} onChange={(value) => list.setFilter("status", value)} options={optionsFromLabels(MONITORING_STATUS_LABELS)} allLabel="Todos os estados" ariaLabel="Filtrar por estado" />
            <ListSelectFilter value={list.filters.teamId} onChange={(value) => list.patchFilters({ teamId: value, subteamId: undefined })} options={(options?.teams ?? []).map((team) => ({ value: team.id, label: team.name }))} allLabel="Todos os grupos" ariaLabel="Filtrar por grupo" />
            <ListSelectFilter value={list.filters.subteamId} onChange={(value) => list.setFilter("subteamId", value)} options={subteamOptions.map((subteam) => ({ value: subteam.id, label: subteam.name }))} allLabel="Todos os subgrupos" ariaLabel="Filtrar por subgrupo" />
            <ListDateRangeFilter label="Última atividade" value={list.filters.period} onChange={(value) => list.setFilter("period", value)} />
          </ListToolbar>

          <div className="grid min-h-[34rem] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-xl border bg-card lg:h-[calc(100dvh-20rem)] lg:grid-cols-[minmax(19rem,25rem)_minmax(0,1fr)]">
            <div className={cn("flex min-h-0 flex-col border-b lg:border-r lg:border-b-0", selectedId ? "hidden lg:flex" : "flex")}>
              {query.isPending ? (
                <div className="space-y-2 p-3" aria-label="Carregando conversas">{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-lg" />)}</div>
              ) : query.isError ? (
                <div className="space-y-3 p-6 text-center" role="alert">
                  <p className="text-sm text-destructive">Não foi possível carregar as conversas.</p>
                  <Button variant="outline" size="sm" onClick={() => void query.refetch()}>Tentar novamente</Button>
                </div>
              ) : query.data.items.length === 0 ? (
                <div className="p-4"><AnalyticsEmptyState icon={list.hasActiveFilters ? SearchX : MessagesSquare} title={list.hasActiveFilters ? "Nenhuma conversa com esses filtros" : "Nenhuma conversa no seu escopo"} description={list.hasActiveFilters ? undefined : "As conversas aparecem aqui quando os colaboradores falarem com a INIA."} /></div>
              ) : (
                <>
                  <ConversationList items={query.data.items} selectedId={selectedId} onSelect={select} />
                  <CompactPager page={list.page} pageSize={list.pageSize} total={total} isFetching={query.isFetching} onPageChange={list.setPage} />
                </>
              )}
            </div>
            <div ref={threadRef} className={cn("min-h-[32rem] min-w-0 scroll-mt-4 lg:min-h-0", selectedId ? "block" : "hidden lg:block")}>
              {selectedId ? (
                <ConversationThread key={selectedId} conversationId={selectedId} onBack={() => select(null)} />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                  <span className="flex size-12 items-center justify-center rounded-full bg-muted"><MessagesSquare className="size-6 text-muted-foreground" aria-hidden /></span>
                  <div className="space-y-1">
                    <p className="font-medium">Escolha uma conversa</p>
                    <p className="max-w-sm text-sm text-muted-foreground">A troca de mensagens aparece aqui, como o colaborador viu — com os horários, o que foi falado por voz e os materiais que a INIA indicou.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

/** Lista agrupada pelo dia da última atividade ("Hoje", "Ontem", data), com o cabeçalho do dia fixo ao rolar. */
function ConversationList({ items, selectedId, onSelect }: { items: MonitoredConversation[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const groups: { key: string; label: string; items: MonitoredConversation[] }[] = []
  for (const conversation of items) {
    const key = dayKey(conversation.lastActivityAt)
    const current = groups.at(-1)
    if (current?.key === key) current.items.push(conversation)
    else groups.push({ key, label: dateSeparatorLabel(conversation.lastActivityAt), items: [conversation] })
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" aria-label="Conversas">
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <h2 className="sticky top-0 z-10 border-b bg-card/95 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur">{group.label}</h2>
          <ul className="divide-y">
            {group.items.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === selectedId} onSelect={() => onSelect(conversation.id)} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ConversationRow({ conversation, selected, onSelect }: { conversation: MonitoredConversation; selected: boolean; onSelect: () => void }) {
  const { owner, lastMessage } = conversation
  const kind = conversationKindOf(conversation)
  const voice = conversation.voiceMessageCount ?? 0
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-testid="monitored-conversation"
        className={cn(
          "relative flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none",
          selected && "bg-primary/5 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary hover:bg-primary/10",
        )}
      >
        <OwnerAvatar owner={owner} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{owner.name}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{lastActivityLabel(conversation.lastActivityAt)}</span>
          </span>
          <span className="flex items-center gap-1.5 text-sm">
            <Tooltip>
              <TooltipTrigger asChild><kind.icon className="size-3.5 shrink-0 text-primary" aria-label={kind.label} /></TooltipTrigger>
              <TooltipContent>{kind.label}</TooltipContent>
            </Tooltip>
            <span className="truncate">{conversationSubjectOf(conversation)}</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground">{lastMessage ? `${lastMessage.role === "assistant" ? "INIA: " : ""}${lastMessage.preview}` : "Sem mensagens"}</span>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 pt-0.5 text-xs text-muted-foreground">
            <ConversationStatus conversation={conversation} />
            <span className="tabular-nums">{messagesLabel(conversation.messageCount)}</span>
            {voice > 0 ? <span className="inline-flex items-center gap-0.5 tabular-nums" aria-label={`${voice} por voz`}><Mic className="size-3" aria-hidden />{voice}</span> : null}
          </span>
        </span>
      </button>
    </li>
  )
}

/** Paginação que cabe na coluna da lista: "26–43 de 43" e anterior/próxima. */
function CompactPager({ page, pageSize, total, isFetching, onPageChange }: { page: number; pageSize: number; total: number; isFetching: boolean; onPageChange: (page: number) => void }) {
  if (total <= pageSize && page === 1) return null
  const first = (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground tabular-nums">
      <span className={cn(isFetching && "opacity-60")}>{first}–{last} de {total}</span>
      <span className="flex gap-1">
        <Button variant="ghost" size="icon-sm" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label="Página anterior"><ChevronLeft /></Button>
        <Button variant="ghost" size="icon-sm" disabled={last >= total} onClick={() => onPageChange(page + 1)} aria-label="Próxima página"><ChevronRight /></Button>
      </span>
    </div>
  )
}
