import { formatPercent } from "@/lib/analytics/format"
import type { PrvCompositionEntry } from "@/schemas/analytics/analytics.schema"

/** Composição oficial do PRV: cada indicador com peso persistido no período. Serve pra explicar
 * o valor oficial — nunca é somada/recomposta aqui. */
export function PrvComposition({ entries }: { entries: PrvCompositionEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">Sem composição oficial disponível para este período.</p>
  return (
    <ul className="space-y-3" aria-label="Composição do PRV">
      {entries.map((entry) => (
        <li key={entry.indicatorCode} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-1 text-sm">
          <span className="min-w-0 truncate font-medium">{entry.indicatorName}</span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Atingimento <strong className="text-sm text-foreground tabular-nums">{formatPercent(entry.achievementPercent)}</strong>
          </span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            Peso <strong className="text-sm text-foreground tabular-nums">{formatPercent(entry.weightPercent)}</strong>
          </span>
          <div className="col-span-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.min(entry.weightPercent ?? 0, 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  )
}
