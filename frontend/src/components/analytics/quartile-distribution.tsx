import { formatCount } from "@/lib/analytics/format"
import type { QuartileDistribution } from "@/schemas/analytics/analytics.schema"
import { cn } from "@/lib/utils"

const SEGMENTS: { key: keyof QuartileDistribution; label: string; className: string }[] = [
  { key: "Q1", label: "Q1", className: "bg-primary" },
  { key: "Q2", label: "Q2", className: "bg-primary/60" },
  { key: "Q3", label: "Q3", className: "bg-accent/60" },
  { key: "Q4", label: "Q4", className: "bg-accent" },
]

/** Distribuição Q1–Q4 (Q1 = melhor) como barra segmentada + contagens em texto — legível sem
 * depender de cor, sem exigir um gráfico. */
export function QuartileDistributionBar({ distribution, title = "Distribuição por quartil" }: { distribution: QuartileDistribution; title?: string }) {
  const withQuartile = SEGMENTS.reduce((sum, segment) => sum + distribution[segment.key], 0)
  const total = withQuartile + distribution.NO_DATA
  if (total === 0) return null
  return (
    <div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">Q1 é o melhor quartil da referência oficial.</p>
      {withQuartile > 0 ? (
        <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={SEGMENTS.map((segment) => `${segment.label}: ${formatCount(distribution[segment.key], "pessoa", "pessoas")}`).join(", ")}>
          {SEGMENTS.map((segment) => distribution[segment.key] > 0 ? <span key={segment.key} className={segment.className} style={{ width: `${(distribution[segment.key] / withQuartile) * 100}%` }} /> : null)}
        </div>
      ) : null}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-5">
        {SEGMENTS.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2">
            <span className={cn("size-2.5 rounded-full", segment.className)} aria-hidden />
            <dt className="text-muted-foreground">{segment.label}</dt>
            <dd className="font-medium">{distribution[segment.key]}</dd>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border border-border bg-background" aria-hidden />
          <dt className="text-muted-foreground">Sem dados</dt>
          <dd className="font-medium">{distribution.NO_DATA}</dd>
        </div>
      </dl>
    </div>
  )
}
