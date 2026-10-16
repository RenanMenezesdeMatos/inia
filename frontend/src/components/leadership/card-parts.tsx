"use client"

import { ChevronDown, Info, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { createContext, useContext } from "react"

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/** Moldura comum dos cartões de dados: título, escopo e competência sempre visíveis (nunca um número sem contexto). */
export function DataCard({ title, scope, period, children, className, label }: { title: string; scope: string; period: string | null; children: React.ReactNode; className?: string; label: string }) {
  return (
    <section aria-label={label} className={cn("@container w-full space-y-3 rounded-xl border bg-card p-3 text-card-foreground shadow-xs", className)}>
      <header className="space-y-0.5">
        <h3 className="text-sm font-semibold leading-snug">{title}</h3>
        <p className="text-xs text-muted-foreground">
          {scope}
          {period ? <> · {period}</> : null}
        </p>
      </header>
      {children}
    </section>
  )
}

/** Número principal com a base de cálculo ao lado ("9 de 23 com referência"). */
export function Stat({ value, label, base, tone = "default" }: { value: string; label: string; base?: string; tone?: "default" | "attention" | "positive" }) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
      <p className={cn("text-lg font-semibold tabular-nums leading-tight", tone === "attention" && "text-amber-700 dark:text-amber-300", tone === "positive" && "text-emerald-700 dark:text-emerald-300")}>{value}</p>
      <p className="text-xs font-medium">{label}</p>
      {base ? <p className="text-[11px] text-muted-foreground">{base}</p> : null}
    </div>
  )
}

/** Limitações que afetam a conclusão — sempre à vista (dados incompletos, não comparável, competência parcial). */
export function Limitations({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-100" aria-label="Limitações">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** "Como calculamos" — a regra aplicada, recolhida por padrão. */
export function Methods({ items }: { items: string[] }) {
  if (items.length === 0) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Info className="size-3" aria-hidden />
        Como calculamos
        <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Cartões só de leitura (painel de monitoramento do admin): sem links — lá eles levariam ao perfil de quem audita, não ao do líder. */
export const LeadershipLinksContext = createContext(true)

/**
 * Link de um cartão. Sem links (só leitura): o texto fica como texto; `action` (ex.: "Abrir", "Ver pessoas") some, porque só
 * existe para navegar.
 */
export function CardAnchor({ href, className, children, action = false, label }: { href: string; className?: string; children: React.ReactNode; action?: boolean; label?: string }) {
  const enabled = useContext(LeadershipLinksContext)
  if (!enabled) return action ? null : <span className={className?.replace(/hover:underline|text-primary|dark:text-chart-4/g, "")}>{children}</span>
  return (
    <Link href={href} className={className} {...(label ? { "aria-label": label } : {})}>
      {children}
    </Link>
  )
}

export function CardLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <CardAnchor action href={href} className="text-xs font-medium text-primary underline-offset-2 hover:underline dark:text-chart-4">
      {children}
    </CardAnchor>
  )
}
