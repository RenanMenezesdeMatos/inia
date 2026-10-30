"use client"

import { useId } from "react"
import { AudioLines } from "lucide-react"

import { Slider } from "@/components/ui/slider"
import { AV_OFFSET_LIMIT_MS, setAvOffsetMs, useAvOffsetMs } from "@/lib/avatar/audio/av-sync"

/** Texto do valor: o que o ajuste faz com a boca (positivo = boca adiantada em relação à voz). */
export function describeAvOffset(ms: number): string {
  if (ms === 0) return "0 ms (padrão)"
  return ms > 0 ? `+${ms} ms · boca mais cedo` : `${ms} ms · boca mais tarde`
}

/**
 * Sincronia da boca da INIA com a voz, DESTE aparelho (salva no navegador). O navegador já desconta a latência de saída que
 * ele conhece; fones Bluetooth costumam informar menos do que têm, e aí a boca fica adiantada.
 */
export function AvSyncSection() {
  const value = useAvOffsetMs()
  const titleId = useId()
  return (
    <section className="space-y-3" aria-labelledby={titleId}>
      <div className="flex items-start gap-2">
        <AudioLines className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <h3 id={titleId} className="text-sm font-semibold text-foreground">
            Sincronia da boca da INIA
          </h3>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            Só neste aparelho. Se a boca dela parecer adiantada em relação à voz (comum em fones Bluetooth), puxe para “mais
            tarde”; se parecer atrasada, para “mais cedo”.
          </p>
        </div>
      </div>
      <div className="rounded-2xl border border-border/60 bg-background p-3">
        <p className="text-sm font-medium text-foreground" aria-live="polite">
          {describeAvOffset(value)}
        </p>
        <Slider
          className="mt-3"
          value={[value]}
          min={-AV_OFFSET_LIMIT_MS}
          max={AV_OFFSET_LIMIT_MS}
          step={10}
          onValueChange={([next]) => next !== undefined && setAvOffsetMs(next)}
          aria-labelledby={titleId}
          getAriaValueText={(ms) => describeAvOffset(ms)}
        />
        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>Boca mais tarde</span>
          <span>Boca mais cedo</span>
        </div>
      </div>
    </section>
  )
}
