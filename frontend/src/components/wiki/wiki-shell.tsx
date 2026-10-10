"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState, type ReactNode } from "react"
import { ArrowLeft, ArrowRight, ChevronRight, Menu, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { WIKI_HOME, WIKI_SECTIONS, findWikiPage, wikiBreadcrumbs, wikiNeighbors } from "./wiki-nav"

/**
 * Shell da Wiki: sidebar de navegação (sitemap único de wiki-nav.ts), breadcrumbs e
 * "anterior/próximo". Um só shell pra TODAS as páginas — a Home inclusive — pra Wiki parecer um
 * produto de documentação, não páginas soltas. Pública e sem sessão (ver app/wiki/layout.tsx).
 */
export function WikiShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isHome = pathname === WIKI_HOME.href
  // Fecha o menu ao navegar (clique num link fecha na hora; a rota muda em seguida).
  const closeMobile = () => setMobileOpen(false)

  const nav = (
    <nav aria-label="Áreas da Wiki" className="space-y-5 text-sm">
      <Link
        href={WIKI_HOME.href}
        onClick={closeMobile}
        className={cn(
          "block rounded-md px-2.5 py-1.5 font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          isHome && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
        )}
      >
        {WIKI_HOME.shortTitle}
      </Link>
      {WIKI_SECTIONS.map((section) => {
        const sectionActive = section.pages.some((page) => page.href === pathname)
        return (
          <div key={section.id} className="space-y-0.5">
            <p className="flex items-center gap-2 px-2.5 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <span className="font-mono text-primary/70">{section.number}</span>
              <span className={cn(sectionActive && "text-foreground")}>{section.title}</span>
            </p>
            <ul className="space-y-0.5">
              {section.pages.map((page) => {
                const active = page.href === pathname
                return (
                  <li key={page.href}>
                    <Link
                      href={page.href}
                      onClick={closeMobile}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                        active && "bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary",
                      )}
                    >
                      {page.shortTitle ?? page.title}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </nav>
  )

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6">
      {/* Barra superior: identidade da Wiki + navegação em telas < lg. */}
      <div className="sticky top-0 z-40 -mx-4 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur-sm sm:-mx-6 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <Link href={WIKI_HOME.href} className="font-heading text-sm font-bold tracking-tight">
            INIA
          </Link>
          <Badge variant="outline" className="font-mono text-[10px]">
            Wiki
          </Badge>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">Documentação oficial da plataforma</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="wiki-mobile-nav"
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium lg:hidden"
        >
          {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />} Áreas
        </button>
      </div>
      {mobileOpen ? (
        <div id="wiki-mobile-nav" className="sticky top-12 z-30 -mx-4 max-h-[70vh] overflow-y-auto border-b border-border bg-card px-4 py-3 shadow-md sm:-mx-6 sm:px-6 lg:hidden">
          {nav}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-8 py-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-10 lg:py-8">
        <aside className="hidden lg:block">
          <div className="sticky top-16 max-h-[calc(100vh-5rem)] overflow-y-auto pr-2 pb-6">{nav}</div>
        </aside>
        <div className="min-w-0">
          {!isHome ? <WikiBreadcrumbs pathname={pathname} /> : null}
          {children}
          {!isHome ? <WikiPagination pathname={pathname} /> : null}
        </div>
      </div>
    </div>
  )
}

function WikiBreadcrumbs({ pathname }: { pathname: string }) {
  const crumbs = wikiBreadcrumbs(pathname)
  if (crumbs.length <= 1) return null
  return (
    <nav aria-label="Trilha de navegação" className="mb-5">
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
            {index > 0 ? <ChevronRight className="size-3" aria-hidden /> : null}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-foreground hover:underline">
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function WikiPagination({ pathname }: { pathname: string }) {
  if (!findWikiPage(pathname)) return null
  const { previous, next } = wikiNeighbors(pathname)
  if (!previous && !next) return null
  return (
    <>
      <Separator className="mt-12" />
      <nav aria-label="Página anterior e próxima" className="grid grid-cols-1 gap-3 py-6 sm:grid-cols-2">
        {previous ? (
          <Link href={previous.href} className="group rounded-lg border border-border p-3.5 transition-colors hover:bg-muted/50">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ArrowLeft className="size-3" /> Anterior
            </span>
            <span className="mt-1 block text-sm font-medium group-hover:text-primary">{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={next.href} className="group rounded-lg border border-border p-3.5 text-right transition-colors hover:bg-muted/50">
            <span className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              Próximo <ArrowRight className="size-3" />
            </span>
            <span className="mt-1 block text-sm font-medium group-hover:text-primary">{next.title}</span>
          </Link>
        ) : null}
      </nav>
    </>
  )
}
