import { ArrowDownRight, ArrowUpRight, HelpCircle, Minus } from "lucide-react"

import { formatPp, TREND_LABELS } from "@/lib/analytics/format"
import { cn } from "@/lib/utils"
import type { Trend } from "@/schemas/analytics/analytics.schema"

/**
 * Tendência do fechamento oficial entre períodos — SEMPRE ícone + texto (nunca só cor) e a variação
 * em p.p. quando existe. Fora de tabelas vira um selo com fundo ("Em alta +4 p.p."), pra evolução,
 * queda e estabilidade serem lidas de relance; em tabelas (`compact`) fica só o número.
 */
const TREND_STYLES: Record<Trend, { icon: typeof ArrowUpRight; text: string; badge: string }> = {
  UP: { icon: ArrowUpRight, text: "text-emerald-700 dark:text-emerald-300", badge: "border-emerald-500/30 bg-emerald-500/10" },
  DOWN: { icon: ArrowDownRight, text: "text-amber-700 dark:text-amber-300", badge: "border-amber-500/30 bg-amber-500/10" },
  FLAT: { icon: Minus, text: "text-muted-foreground", badge: "border-border bg-muted/60" },
  UNKNOWN: { icon: HelpCircle, text: "text-muted-foreground", badge: "border-dashed border-border bg-transparent" },
}

export function TrendIndicator({
  trend,
  deltaPp,
  comparisonLabel = "vs. período anterior",
  compact = false,
  className,
  size = "sm",
}: {
  trend: Trend
  deltaPp: number | null
  comparisonLabel?: string
  /** Em tabelas: só o número (ou "—" sem comparação); o rótulo completo fica no aria-label. */
  compact?: boolean
  className?: string
  size?: "sm" | "md"
}) {
  const { icon: Icon, text: tone, badge } = TREND_STYLES[trend]
  const fullText = trend === "UNKNOWN" ? "Sem comparação com o período anterior" : `${formatPp(deltaPp)} ${comparisonLabel}`.trim()
  const ariaLabel = `${TREND_LABELS[trend]}: ${fullText}`
  if (compact) {
    return (
      <span className={cn("inline-flex items-center gap-1 font-medium tabular-nums", size === "md" ? "text-sm" : "text-xs", tone, className)} aria-label={ariaLabel}>
        {trend === "UNKNOWN" ? null : <Icon className={size === "md" ? "size-4" : "size-3.5"} aria-hidden />}
        <span>{trend === "UNKNOWN" ? "—" : formatPp(deltaPp)}</span>
      </span>
    )
  }
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5", size === "md" ? "text-sm" : "text-xs", className)} aria-label={ariaLabel}>
      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold tabular-nums", tone, badge)} data-trend={trend}>
        <Icon className={size === "md" ? "size-4" : "size-3.5"} aria-hidden />
        <span>{TREND_LABELS[trend]}</span>
        {trend === "UNKNOWN" ? null : <span>{formatPp(deltaPp)}</span>}
      </span>
      {trend === "UNKNOWN" ? null : <span className="text-muted-foreground">{comparisonLabel}</span>}
    </span>
  )
}
