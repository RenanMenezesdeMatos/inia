"use client"

import { Fragment, useEffect, useId, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode } from "react"
import { Check, ChevronDown, Loader2, RotateCw, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "@/lib/utils"

const SEARCH_DEBOUNCE_MS = 250
/** O mesmo teto das rotas de opções: acima dele o servidor recusa a busca. */
const MAX_SEARCH_LENGTH = 100

export type RemoteComboboxState = {
  open: boolean
  setOpen: (open: boolean) => void
  search: string
  setSearch: (search: string) => void
  /** Termo que vai para o servidor (depois do debounce). */
  term: string
}

/** Estado de um seletor pesquisável: aberto/fechado e o termo com debounce curto. Fechar limpa a busca. */
export function useRemoteCombobox(): RemoteComboboxState {
  const [open, setOpenState] = useState(false)
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS)
  function setOpen(next: boolean) {
    setOpenState(next)
    if (!next) setSearch("")
  }
  // Busca apagada volta na hora para o primeiro lote (sem esperar o debounce).
  return { open, setOpen, search, setSearch, term: search.trim() ? debounced : "" }
}

/** O que o seletor precisa de uma lista carregada em lotes (`useInfiniteQuery` + `remoteListOf`). */
export type RemoteList<T> = {
  items: readonly T[]
  /** Primeiro lote ainda chegando (nada para mostrar). */
  isPending: boolean
  /** Falhou sem nenhum item carregado. */
  isError: boolean
  /** Mostrando o resultado do termo anterior enquanto o novo chega. */
  isStale: boolean
  isFetching: boolean
  hasMore: boolean
  isLoadingMore: boolean
  /** O próximo lote falhou (o que já apareceu continua na tela). */
  loadMoreFailed: boolean
  loadMore: () => void
  retry: () => void
}

type InfiniteQueryLike<P> = {
  data: { pages: P[] } | undefined
  isPending: boolean
  isError: boolean
  isFetching: boolean
  isPlaceholderData: boolean
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isFetchNextPageError: boolean
  fetchNextPage: () => unknown
  refetch: () => unknown
}

/** Lista em lotes a partir de uma `useInfiniteQuery` cujas páginas trazem `items`. */
export function remoteListOf<T>(query: InfiniteQueryLike<{ items: readonly T[] }>): RemoteList<T> {
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  return {
    items,
    isPending: query.isPending,
    isError: query.isError && query.data === undefined,
    isStale: query.isPlaceholderData,
    isFetching: query.isFetching,
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMoreFailed: query.isFetchNextPageError,
    loadMore: () => void query.fetchNextPage(),
    retry: () => void query.refetch(),
  }
}

export type RemoteOption = {
  id: string
  label: string
  /** Segunda linha (ex.: o Grupo de origem), para distinguir nomes iguais. */
  details?: string | null
  /** Nome lido pelo leitor de tela quando o rótulo sozinho não distingue (ex.: "Cobrança › Tarde"). */
  accessibleLabel?: string
  selected: boolean
  /** Motivo de não poder ser escolhida agora (aparece no lugar dos detalhes). */
  disabledReason?: string | null
}

/** Opção fixa no topo, fora da paginação (ex.: "Qualquer grupo", "Sem grupo"); some enquanto há busca. */
export type RemoteFixedOption = { id: string; label: string; selected: boolean; onSelect: () => void }

/**
 * SELETOR PESQUISÁVEL COM CARREGAMENTO EM LOTES — o campo padrão para conjuntos grandes (Grupos, Subgrupos, pessoas…). A busca roda no
 * servidor sobre tudo o que a conta pode escolher (nunca só sobre o que já apareceu) e a rolagem pede o próximo lote. O componente só
 * desenha: quem usa faz a consulta com `state.term` e `state.open` e entrega a `list`.
 *
 *  - Resposta antiga nunca sobrescreve a nova: a consulta é chaveada pelo termo; enquanto o novo termo não chega, o resultado anterior
 *    fica esmaecido e Enter não escolhe nada (o clique vale: a pessoa clicou no que está vendo).
 *  - Teclado: a busca é um combobox — ↑/↓ percorrem as opções (e pedem mais perto do fim), Enter escolhe, Esc fecha e devolve o foco ao
 *    gatilho. O `listbox` só contém `option`s; carregando, erro, vazio e "Carregar mais" ficam fora dele, na mesma área rolável.
 *  - A escolha atual mora em quem usa (gatilho/selos), então continua visível fora do lote carregado.
 */
export function RemoteCombobox<T>({
  state,
  list,
  optionOf,
  onSelect,
  trigger,
  multiple = false,
  fixedOptions = [],
  pinned = [],
  header,
  listLabel,
  searchLabel,
  searchPlaceholder,
  emptyText,
  footer,
  contentClassName,
  searchUsageElement,
}: {
  state: RemoteComboboxState
  list: RemoteList<T>
  optionOf: (item: T) => RemoteOption
  onSelect: (item: T) => void
  /** Botão que abre (use `RemoteComboboxTrigger` ou um próprio). */
  trigger: ReactNode
  multiple?: boolean
  fixedOptions?: readonly RemoteFixedOption[]
  /** Já escolhidas ao abrir: ficam no topo (mesmo fora do lote), sem repetir na lista. Somem enquanto há busca. */
  pinned?: readonly T[]
  /** Acima da busca (ex.: abas Grupos/Subgrupos). */
  header?: ReactNode
  listLabel: string
  searchLabel: string
  searchPlaceholder: string
  /** Vazio sem busca (com busca, a mensagem é "Nada encontrado…"). */
  emptyText: string
  footer?: ReactNode
  contentClassName?: string
  /** Elemento da coleta de uso no campo de busca (ex.: `list.search`). */
  searchUsageElement?: string
}) {
  const id = useId()
  const listId = `${id}-list`
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Dentro de um painel ou diálogo modal a lista só rola com o popover também modal (o Radix trava a rolagem fora do diálogo).
  const [insideDialog, setInsideDialog] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const { open, setOpen, search, setSearch, term } = state
  const { hasMore, isLoadingMore, loadMoreFailed, loadMore } = list
  const searching = search.trim() !== ""
  const fixed = searching ? [] : fixedOptions
  const stale = list.isStale || search.trim() !== term
  const top = searching ? [] : pinned
  const topIds = new Set(top.map((item) => optionOf(item).id))
  const rows = top.length > 0 ? [...top, ...list.items.filter((item) => !topIds.has(optionOf(item).id))] : list.items
  const count = fixed.length + rows.length
  const activeIndex = Math.min(active, Math.max(count - 1, 0))
  // Outra lista (aba Grupos/Subgrupos): recomeça da primeira opção, senão Enter escolheria a mesma posição da lista nova.
  const [activeList, setActiveList] = useState(listLabel)
  if (activeList !== listLabel) {
    setActiveList(listLabel)
    setActive(0)
  }

  // Carregamento progressivo: a sentinela no fim da lista pede o próximo lote quando aparece. Lote que falhou só volta a pedir no botão.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!open || !sentinel || !hasMore || isLoadingMore || loadMoreFailed || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore()
    }, { root: scrollRef.current, rootMargin: "80px" })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [open, hasMore, isLoadingMore, loadMoreFailed, loadMore, list.items.length])

  const optionId = (index: number) => `${id}-option-${index}`
  function move(index: number) {
    const next = Math.max(0, Math.min(index, count - 1))
    setActive(next)
    if (next >= count - 3 && hasMore && !isLoadingMore && !loadMoreFailed) loadMore()
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" })
  }
  function chooseItem(item: T) {
    if (optionOf(item).disabledReason) return
    onSelect(item)
    if (!multiple) setOpen(false)
  }
  function chooseFixed(option: RemoteFixedOption) {
    option.onSelect()
    setOpen(false)
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      move(activeIndex + 1)
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      move(activeIndex - 1)
    } else if (event.key === "Enter") {
      // Nunca envia o formulário em volta nem escolhe do resultado antigo enquanto a busca nova não chega.
      event.preventDefault()
      if (stale) return
      const fixedOption = fixed[activeIndex]
      if (fixedOption) return chooseFixed(fixedOption)
      const item = rows[activeIndex - fixed.length]
      if (item !== undefined) chooseItem(item)
    }
  }

  return (
    <Popover open={open} onOpenChange={(next) => { if (next) setInsideDialog(Boolean(triggerRef.current?.closest('[role="dialog"], [role="alertdialog"]'))); setOpen(next); setActive(0) }} modal={insideDialog}>
      <PopoverTrigger asChild ref={triggerRef}>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={12}
        aria-label={listLabel}
        // O foco começa sempre na busca (dentro de um diálogo o Radix iria para a primeira aba).
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus() }}
        // Tela baixa (celular deitado, teclado aberto): o popover cabe no espaço livre e rola, com o rodapé ao alcance.
        className={cn("max-h-(--radix-popover-content-available-height) w-[min(24rem,calc(100vw-2rem))] gap-0 overflow-y-auto p-0", contentClassName)}
      >
        {header ? <div className="shrink-0 border-b border-border p-2">{header}</div> : null}
        <div className="relative shrink-0 border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={count > 0 ? optionId(activeIndex) : undefined}
            aria-label={searchLabel}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(event) => { setSearch(event.target.value); setActive(0); if (scrollRef.current) scrollRef.current.scrollTop = 0 }}
            onKeyDown={onKeyDown}
            className="pl-8 pr-8"
            autoComplete="off"
            maxLength={MAX_SEARCH_LENGTH}
            data-usage-element={searchUsageElement}
          />
          {list.isFetching && !list.isPending && !isLoadingMore ? <Loader2 className="absolute right-4 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden /> : null}
        </div>
        <div ref={scrollRef} className="max-h-72 min-h-24 flex-1 overflow-y-auto overscroll-contain p-1" aria-busy={stale}>
          <ul id={listId} role="listbox" aria-multiselectable={multiple} aria-label={listLabel} className={cn(stale && "opacity-60")}>
            {fixed.map((option, index) => (
              <OptionRow key={`fixed:${option.id}`} id={optionId(index)} label={option.label} selected={option.selected} active={index === activeIndex} multiple={multiple} onHover={() => setActive(index)} onClick={() => chooseFixed(option)} />
            ))}
            {rows.map((item, position) => {
              const index = fixed.length + position
              const option = optionOf(item)
              return (
                <Fragment key={option.id}>
                  {position === top.length && position > 0 ? <li role="presentation" aria-hidden className="mx-2 my-1 border-t border-border" /> : null}
                  <OptionRow
                    id={optionId(index)}
                    label={option.label}
                    accessibleLabel={option.accessibleLabel}
                    details={option.disabledReason ?? option.details}
                    selected={option.selected}
                    disabled={Boolean(option.disabledReason)}
                    active={index === activeIndex}
                    multiple={multiple}
                    onHover={() => setActive(index)}
                    onClick={() => chooseItem(item)}
                  />
                </Fragment>
              )
            })}
          </ul>
          {list.isPending ? <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground" role="status"><Loader2 className="size-4 animate-spin" aria-hidden />Carregando…</p> : null}
          {list.isError ? (
            <div className="space-y-2 px-2 py-3 text-sm" role="alert">
              <p className="text-destructive">Não foi possível carregar as opções.</p>
              <Button type="button" size="sm" variant="outline" onClick={list.retry}><RotateCw aria-hidden />Tentar de novo</Button>
            </div>
          ) : null}
          {!list.isPending && !list.isError && rows.length === 0 && !stale ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground" role="status">{term ? `Nada encontrado para “${term}”.` : emptyText}</p>
          ) : null}
          <div ref={sentinelRef} aria-hidden className="h-px" />
          {loadMoreFailed ? <p className="px-2 pt-1 text-xs text-destructive" role="alert">Não foi possível carregar mais opções.</p> : null}
          {hasMore ? (
            <div className="p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full" disabled={isLoadingMore} onClick={loadMore}>
                {isLoadingMore ? <><Loader2 className="size-4 animate-spin" aria-hidden />Carregando mais…</> : loadMoreFailed ? <><RotateCw aria-hidden />Tentar de novo</> : "Carregar mais"}
              </Button>
            </div>
          ) : null}
        </div>
        {/* "Limpar" some ao ser usado: o foco fica na busca (mouse e toque nunca o tiram dela; pelo teclado, volta). */}
        {footer ? <div className="sticky bottom-0 shrink-0 border-t border-border bg-popover p-2" onMouseDown={(event) => event.preventDefault()} onClick={(event) => { if (event.detail === 0) inputRef.current?.focus() }}>{footer}</div> : null}
      </PopoverContent>
    </Popover>
  )
}

function OptionRow({ id, label, accessibleLabel, details, selected, disabled = false, active, multiple, onHover, onClick }: { id: string; label: string; accessibleLabel?: string | undefined; details?: string | null | undefined; selected: boolean; disabled?: boolean; active: boolean; multiple: boolean; onHover: () => void; onClick: () => void }) {
  return (
    <li
      id={id}
      role="option"
      aria-label={accessibleLabel ?? label}
      aria-describedby={details ? `${id}-details` : undefined}
      aria-selected={selected}
      aria-disabled={disabled ? true : undefined}
      // O clique não tira o foco da busca: setas e digitação continuam.
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onClick}
      className={cn("flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm", active && "bg-muted ring-2 ring-ring/50", disabled && "cursor-not-allowed opacity-60")}
    >
      {multiple ? (
        <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-muted-foreground/60 bg-card", selected && "border-primary bg-primary text-primary-foreground")} aria-hidden>{selected ? <Check className="size-3" /> : null}</span>
      ) : (
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center" aria-hidden>{selected ? <Check className="size-4 text-primary" /> : null}</span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate" title={label}>{label}</span>
        {details ? <span id={`${id}-details`} className="block truncate text-xs text-muted-foreground" title={details}>{details}</span> : null}
      </span>
    </li>
  )
}

/** Rodapé da escolha múltipla: quantos estão marcados, limpar e concluir (o seletor fica aberto enquanto se marca). */
export function RemoteSelectionFooter({ count, summary, emptyText, onClear, onDone }: { count: number; summary: string; emptyText: string; onClear?: () => void; onDone: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="min-w-0 truncate pl-1 text-xs text-muted-foreground" aria-live="polite">{count > 0 ? summary : emptyText}</p>
      <div className="flex shrink-0 gap-1">
        {count > 0 && onClear ? <Button type="button" variant="ghost" size="sm" onClick={onClear}>Limpar</Button> : null}
        <Button type="button" size="sm" onClick={onDone}>Concluir</Button>
      </div>
    </div>
  )
}

/**
 * Gatilho com a cara de um seletor do kit: mostra a escolha (mesmo fora do lote carregado). `variant="filter"` destaca a borda quando
 * há escolha, como os demais filtros de lista. Repassa as props do `PopoverTrigger` (asChild).
 */
export function RemoteComboboxTrigger({ label, placeholder, variant = "field", icon, className, "aria-label": ariaLabel, ...props }: Omit<ComponentProps<typeof Button>, "children" | "variant"> & { label: string | null; placeholder: string; variant?: "field" | "filter"; icon?: ReactNode }) {
  const selected = label !== null
  return (
    <Button
      {...props}
      type="button"
      variant="outline"
      aria-label={ariaLabel ? `${ariaLabel}: ${label ?? placeholder}` : undefined}
      className={cn("h-8 w-full min-w-0 justify-between gap-1.5 rounded-lg border-input bg-card pr-2 pl-2.5 font-normal dark:bg-input/30 dark:hover:bg-input/50", variant === "filter" && "sm:w-auto sm:max-w-72 sm:min-w-36", variant === "filter" && selected && "border-primary/50", className)}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className={cn("truncate", !selected && variant === "field" && "text-muted-foreground")} title={label ?? undefined}>{label ?? placeholder}</span>
      </span>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Button>
  )
}
