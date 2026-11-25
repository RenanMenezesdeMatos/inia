import { CircleAlert, Clock, Info, ShieldAlert } from "lucide-react"

import { StatusChip, type Tone } from "@/components/ui/surface"
import type { NetworkSignal } from "@/lib/access/network-access-labels"

const ICONS: Partial<Record<Tone, typeof Info>> = { danger: ShieldAlert, warning: CircleAlert, info: Info }

/** Selos do login pela rede com a explicação ao lado (a cor nunca é a única informação). */
export function NetworkSignalList({ signals }: { signals: readonly NetworkSignal[] }) {
  if (signals.length === 0) return null
  return (
    <ul className="space-y-1 pt-0.5" aria-label="Situação do login pela rede">
      {signals.map((signal) => (
        <li key={signal.key} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusChip tone={signal.tone} icon={signal.key === "throttle" ? Clock : ICONS[signal.tone] ?? Info}>{signal.title}</StatusChip>
          <span className="text-xs text-muted-foreground">{signal.detail}</span>
        </li>
      ))}
    </ul>
  )
}
