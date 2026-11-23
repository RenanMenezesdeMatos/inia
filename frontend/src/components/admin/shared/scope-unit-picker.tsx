"use client"

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react"
import { Check, ChevronDown, Loader2, Plus, RotateCw, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { cn } from "@/lib/utils"
import { useScopeUnitOptions } from "@/queries/scope-units/use-scope-units"
import type { ScopePickerPermission, ScopeUnitKind, ScopeUnitOption } from "@/schemas/scope-units/scope-units.schema"

const KIND_LABEL: Record<ScopeUnitKind, { tab: string; one: string; empty: string }> = {
  TEAM: { tab: "Grupos", one: "Grupo", empty: "Nenhum Grupo com operadores em produção" },
  SUBTEAM: { tab: "Subgrupos", one: "Subgrupo", empty: "Nenhum Subgrupo com operadores em produção" },
}

/**
 * SELETOR PESQUISÁVEL DE GRUPOS E SUBGRUPOS (23/11/2026) — o mesmo em todos os cadastros de alcance. Busca no servidor (sem maiúsculas
 * nem acentos; o Subgrupo também pelo nome do Grupo-pai), universo, escopo de quem edita e elegibilidade (só Grupo/Subgrupo com ao menos
 * um operador "Em produção") aplicados ANTES da paginação; a lista carrega mais ao rolar (cursor). As escolhas ficam com quem usa o
 * seletor (`isSelected`/`onToggle`), então buscar de novo, rolar ou trocar de aba nunca perde o que já foi marcado.
 *
 * Teclado: o campo de busca é um combobox — ↑/↓ percorrem as opções, Enter marca/desmarca, Esc fecha; "Carregar mais" também é botão.
 * O `listbox` só contém `option`s (QA-15): carregando/erro/vazio, a sentinela e "Carregar mais" ficam fora dele, na mesma área rolável.
 * Sem virtualização: cada página tem 30 itens e a rolagem só busca a próxima perto do fim, então a lista renderizada fica pequena
 * mesmo em estruturas grandes.
 */
export function ScopeUnitPicker({
  permission,
  universes,
  kinds = ["TEAM", "SUBTEAM"],
  isSelected,
  disabledReason,
  onToggle,
  multiple = true,
  triggerLabel = "Adicionar Grupo ou Subgrupo",
  disabled = false,
}: {
  permission: ScopePickerPermission
  universes?: readonly string[] | undefined
  kinds?: readonly ScopeUnitKind[]
  isSelected: (option: ScopeUnitOption) => boolean
  /** Opção que não pode ser marcada agora (ex.: Subgrupo de um Grupo já escolhido inteiro): o motivo aparece na linha. */
  disabledReason?: (option: ScopeUnitOption) => string | null
  onToggle: (option: ScopeUnitOption) => void
  multiple?: boolean
  triggerLabel?: string
  disabled?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ScopeUnitKind>(kinds[0] ?? "TEAM")
  const [search, setSearch] = useState("")
  const debounced = useDebouncedValue(search, 250)
  const [active, setActive] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const query = useScopeUnitOptions({ kind, permission, search: debounced, universes }, open)
  const options = query.data?.pages.flatMap((page) => page.items) ?? []
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query

  // Carregamento progressivo: a sentinela no fim da lista pede a próxima página quando aparece.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!open || !sentinel || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && hasNextPage && !isFetchingNextPage) void fetchNextPage()
    }, { root: scrollRef.current, rootMargin: "80px" })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [open, hasNextPage, isFetchingNextPage, fetchNextPage, options.length])

  const choose = (option: ScopeUnitOption | undefined) => {
    if (!option || disabledReason?.(option)) return
    onToggle(option)
    if (!multiple) setOpen(false)
  }
  const optionId = (index: number) => `${id}-option-${index}`
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault()
      const next = Math.min(active + 1, Math.max(options.length - 1, 0))
      setActive(next)
      if (next >= options.length - 3 && hasNextPage && !isFetchingNextPage) void fetchNextPage()
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" })
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      const next = Math.max(active - 1, 0)
      setActive(next)
      document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" })
    } else if (event.key === "Enter") {
      event.preventDefault()
      choose(options[active])
    }
  }
  const labels = KIND_LABEL[kind]
  const listId = `${id}-list`

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setSearch(""); setActive(0) } }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full max-w-96 justify-between font-normal" disabled={disabled}>
          <span className="flex items-center gap-2 truncate"><Plus className="size-4" aria-hidden />{triggerLabel}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        {kinds.length > 1 ? (
          <div className="border-b border-border p-2">
            <ToggleGroup type="single" value={kind} onValueChange={(next) => { if (next) { setKind(next as ScopeUnitKind); setActive(0) } }} aria-label="Tipo de unidade" className="w-full">
              {kinds.map((entry) => <ToggleGroupItem key={entry} value={entry} className="flex-1">{KIND_LABEL[entry].tab}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
        ) : null}
        <div className="relative border-b border-border p-2">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={options[active] ? optionId(active) : undefined}
            aria-label={`Buscar ${labels.one.toLocaleLowerCase("pt-BR")} pelo nome`}
            placeholder={kind === "SUBTEAM" ? "Buscar Subgrupo ou Grupo-pai" : "Buscar Grupo"}
            value={search}
            onChange={(event) => { setSearch(event.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
            className="pl-8"
          />
        </div>
        <div ref={scrollRef} className="max-h-72 overflow-y-auto p-1">
          {query.isPending ? <p className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden />Carregando…</p> : null}
          {query.isError ? (
            <div className="space-y-2 px-2 py-3 text-sm" role="alert">
              <p className="text-destructive">Não foi possível carregar as opções.</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}><RotateCw aria-hidden />Tentar de novo</Button>
            </div>
          ) : null}
          {!query.isPending && !query.isError && options.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">{debounced.trim() ? `Nada encontrado para “${debounced.trim()}”.` : `${labels.empty}${universes?.length ? ` em ${universes.join(", ")}` : ""} no seu escopo.`}</p>
          ) : null}
          <ul id={listId} role="listbox" aria-multiselectable={multiple} aria-label={labels.tab} aria-busy={query.isFetching}>
            {options.map((option, index) => {
              const checked = isSelected(option)
              const reason = disabledReason?.(option) ?? null
              const details = [option.kind === "SUBTEAM" ? `Grupo ${option.teamName}` : null, option.operatingUniverse, `${option.productionOperators.toLocaleString("pt-BR")} em produção`].filter(Boolean).join(" · ")
              return (
                <li
                  key={`${option.kind}:${option.id}`}
                  id={optionId(index)}
                  role="option"
                  aria-label={option.kind === "SUBTEAM" ? `${option.teamName ?? "Grupo"} › ${option.name}` : option.name}
                  aria-describedby={`${optionId(index)}-details`}
                  aria-selected={checked}
                  aria-disabled={reason ? true : undefined}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(option)}
                  className={cn("flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm", index === active && "bg-muted ring-2 ring-ring/50", reason && "cursor-not-allowed opacity-60")}
                >
                  <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border border-border", checked && "border-primary bg-primary text-primary-foreground")} aria-hidden>{checked ? <Check className="size-3" /> : null}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{option.name}</span>
                    <span id={`${optionId(index)}-details`} className="block truncate text-xs text-muted-foreground">{reason ?? details}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          <div ref={sentinelRef} aria-hidden className="h-px" />
          {hasNextPage ? (
            <div className="p-1">
              <Button type="button" variant="ghost" size="sm" className="w-full" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()}>
                {isFetchingNextPage ? <><Loader2 className="size-4 animate-spin" aria-hidden />Carregando mais…</> : "Carregar mais"}
              </Button>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  )
}
