"use client"

import { useState, type ReactNode } from "react"
import { CircleAlert, CircleSlash, Info, Lock, RefreshCw, type LucideIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { IconBadge, SectionLabel, SURFACE_CARD, toneSurface, type Tone } from "@/components/ui/surface"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import type { Definition } from "./success-definitions"
import { formatCount, formatPercent, SERIES_THEME, type SeriesKey } from "./success-format"

/**
 * Peças de apresentação dos Indicadores de sucesso (sem regra de cálculo). Toda dica de indicador diz definição, fórmula, base,
 * exclusões e data de referência; abre ao passar o mouse, com o teclado (foco) e com toque (clique alterna).
 */
export function InfoTip({ definition, className }: { definition: Definition; className?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label={`Como é calculado: ${definition.title}`}
          className={cn(
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Info className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="block max-w-sm space-y-1.5 p-3 text-left leading-relaxed">
        <p className="font-semibold">{definition.title}</p>
        <p>{definition.what}</p>
        <p>
          <span className="font-semibold">Fórmula: </span>
          {definition.formula}
        </p>
        <p>
          <span className="font-semibold">Base: </span>
          {definition.base}
        </p>
        <p>
          <span className="font-semibold">Fora da conta: </span>
          {definition.excludes}
        </p>
        <p>
          <span className="font-semibold">Referência: </span>
          {definition.reference}
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

/** Uma das seis partes da página: rótulo curto, título, explicação e o conteúdo num cartão. */
export function SuccessSection({ id, label, title, description, aside, children }: { id: string; label: string; title: string; description: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <SectionLabel as="p">{label}</SectionLabel>
          <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** Cartão de um bloco (um gráfico, uma lista, um conjunto de números). */
export function Panel({
  title,
  definition,
  description,
  children,
  className,
  footer,
}: {
  title: string
  definition?: Definition
  description?: ReactNode
  children: ReactNode
  className?: string
  footer?: ReactNode
}) {
  return (
    <div className={cn(SURFACE_CARD, "flex min-w-0 flex-col gap-3 p-4 sm:p-5", className)}>
      <div className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-snug">{title}</h3>
          {definition ? <InfoTip definition={definition} /> : null}
        </div>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
      {footer ? <div className="border-t border-border pt-2 text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  )
}

type StateKind = "loading" | "error" | "denied" | "empty" | "unavailable"
const STATE: Record<Exclude<StateKind, "loading">, { icon: LucideIcon; tone: Tone; title: string }> = {
  error: {
    icon: CircleAlert,
    tone: "danger",
    title: "Não foi possível carregar",
  },
  denied: { icon: Lock, tone: "neutral", title: "Fora do seu acesso" },
  empty: {
    icon: CircleSlash,
    tone: "neutral",
    title: "Nenhum registro no período",
  },
  unavailable: {
    icon: Info,
    tone: "warning",
    title: "Coleta ainda indisponível",
  },
}

/** Estados distintos de um bloco: carregando, erro (com tentar de novo), sem acesso, sem registros e coleta indisponível. */
export function BlockState({ kind, message, onRetry, className, lines = 3 }: { kind: StateKind; message?: ReactNode; onRetry?: () => void; className?: string; lines?: number }) {
  if (kind === "loading") {
    return (
      <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Carregando">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton key={index} className={cn("h-4", index === 0 ? "w-2/3" : index % 2 ? "w-full" : "w-5/6")} />
        ))}
      </div>
    )
  }
  const state = STATE[kind]
  return (
    <div role={kind === "error" ? "alert" : "status"} className={cn(toneSurface(state.tone), "flex items-start gap-3 p-3", className)}>
      <IconBadge icon={state.icon} tone={state.tone === "danger" ? "danger" : state.tone === "warning" ? "warning" : "neutral"} size="sm" />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium">{state.title}</p>
        {message ? <p className="text-muted-foreground">{message}</p> : null}
        {onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw data-icon="inline-start" /> Tentar de novo
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/** Número grande com a base logo abaixo ("82% · 164 de 200 respostas avaliadas"). */
export function BigNumber({ value, base, muted = false }: { value: string; base: ReactNode; muted?: boolean }) {
  return (
    <div className="space-y-1">
      <p className={cn("text-3xl font-semibold tracking-tight tabular-nums", muted && "text-xl text-muted-foreground")}>{value}</p>
      <p className="text-xs text-muted-foreground tabular-nums">{base}</p>
    </div>
  )
}

/** Par rótulo × valor em linha (detalhes de uma métrica). */
export function StatRow({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">
        {label}
        {hint ? <span className="block text-xs">{hint}</span> : null}
      </dt>
      <dd className="shrink-0 font-medium tabular-nums">{value}</dd>
    </div>
  )
}

export type BarItem = {
  key: string
  label: string
  detail?: string | null
  count: number
  share: number | null
}

/**
 * Ranking em barras horizontais: rótulo, quantidade e participação (a barra é proporcional à maior quantidade; a participação vem do
 * servidor e some com base pequena). Uma cor só (a da entidade); o texto nunca usa a cor da série.
 */
export function BarList({ items, series, unit, emptyText, maxItems }: { items: readonly BarItem[]; series: SeriesKey; unit: readonly [string, string]; emptyText: string; maxItems?: number }) {
  const shown = maxItems ? items.slice(0, maxItems) : items
  if (shown.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>
  const max = Math.max(1, ...shown.map((item) => item.count))
  return (
    <ol className="space-y-3">
      {shown.map((item) => (
        <li key={item.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{item.label}</span>
              {item.detail ? (
                <span className="block truncate text-xs text-muted-foreground" title={item.detail}>
                  {item.detail}
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              <span className="font-medium text-foreground">{formatCount(item.count)}</span> {item.count === 1 ? unit[0] : unit[1]}
              {item.share !== null ? ` · ${formatPercent(item.share)}` : ""}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div
              className="h-full rounded-full bg-(--bar-light) dark:bg-(--bar-dark)"
              style={{
                width: `${item.count === 0 ? 0 : Math.max(2, (item.count / max) * 100)}%`,
                ["--bar-light" as string]: SERIES_THEME[series].light,
                ["--bar-dark" as string]: SERIES_THEME[series].dark,
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Caixa do tooltip dos gráficos: o período do ponto e, por série, valor, quantidade e denominador. */
export function ChartTip({ title, rows }: { title: string; rows: { label: string; value: string; detail?: string; series?: SeriesKey }[] }) {
  return (
    <div className="grid min-w-44 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{title}</p>
      {rows.map((row) => (
        <div key={row.label} className="flex items-start gap-2">
          {row.series ? (
            <span
              aria-hidden
              className="mt-1 size-2.5 shrink-0 rounded-[2px] bg-(--tip-light) dark:bg-(--tip-dark)"
              style={{
                ["--tip-light" as string]: SERIES_THEME[row.series].light,
                ["--tip-dark" as string]: SERIES_THEME[row.series].dark,
              }}
            />
          ) : null}
          <div className="min-w-0">
            <p className="text-muted-foreground">{row.label}</p>
            <p className="font-medium tabular-nums">{row.value}</p>
            {row.detail ? <p className="text-muted-foreground tabular-nums">{row.detail}</p> : null}
          </div>
        </div>
      ))}
    </div>
  )
}
