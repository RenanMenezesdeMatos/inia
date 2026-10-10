"use client"

import { useEffect, useMemo, useState } from "react"
import { Menu, Search, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

export type WikiTocEntry = { id: string; label: string }

/**
 * `variant`: "auto" renderiza a coluna (xl) e a barra fixa (< xl) — comportamento original;
 * "list"/"bar" renderizam só uma das duas, pra WikiArticle colocar a barra DENTRO da coluna de
 * conteúdo (sticky precisa de um pai alto: como item de grid numa linha própria, ela nunca
 * "grudava" ao rolar).
 */
export function WikiTableOfContents({ entries, variant = "auto" }: { entries: WikiTocEntry[]; variant?: "auto" | "list" | "bar" }) {
  const [activeId, setActiveId] = useState(entries[0]?.id)
  const [query, setQuery] = useState("")
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    const sections = entries.map((entry) => document.getElementById(entry.id)).filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (observedEntries) => {
        const visible = observedEntries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: [0, 1] },
    )
    for (const section of sections) observer.observe(section)
    return () => observer.disconnect()
  }, [entries])

  const filtered = useMemo(() => {
    if (!query.trim()) return entries
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => entry.label.toLowerCase().includes(needle))
  }, [entries, query])

  const list = (
    <nav aria-label="Índice da Wiki" className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar nesta página..."
          className="h-8 pl-8 text-xs"
          aria-label="Buscar seção da Wiki"
        />
      </div>
      <ul className="space-y-0.5 text-sm">
        {filtered.map((entry) => (
          <li key={entry.id}>
            <a
              href={`#${entry.id}`}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "block rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                activeId === entry.id && "bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary",
              )}
            >
              {entry.label}
            </a>
          </li>
        ))}
        {filtered.length === 0 ? <li className="px-2.5 py-1.5 text-xs text-muted-foreground">Nenhuma seção encontrada.</li> : null}
      </ul>
    </nav>
  )

  return (
    <>
      {/* Coluna própria só a partir de xl — em lg a sidebar de áreas (WikiShell) já ocupa a esquerda,
       * e três colunas em 1024px espremeriam tabelas e diagramas. */}
      {variant !== "bar" ? <div className="hidden xl:sticky xl:top-16 xl:block xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto xl:pr-2">{list}</div> : null}

      {variant !== "list" ? (
      <div className="sticky top-12 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm xl:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-sm font-medium"
          aria-expanded={mobileOpen}
        >
          <span className="flex items-center gap-2">
            <Menu className="size-4" /> Nesta página
          </span>
          <span className="text-xs text-muted-foreground">{entries.find((entry) => entry.id === activeId)?.label}</span>
        </button>
        {mobileOpen ? (
          <div className="mt-2 max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card p-3 shadow-md">
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={() => setMobileOpen(false)} aria-label="Fechar índice" className="text-muted-foreground">
                <X className="size-4" />
              </button>
            </div>
            {list}
          </div>
        ) : null}
      </div>
      ) : null}
    </>
  )
}
