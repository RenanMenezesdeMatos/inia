import type { ReactNode } from "react"

import { AnalyticsCard } from "./analytics-states"
import { SectionLabel } from "@/components/ui/surface"

/**
 * Bloco de resultado principal (PRV do operador / consolidado da estrutura): hierarquia visual
 * 1) valor, 2) tendência, 3) comparação; o resto fica em `children`/`aside`.
 */
export function MetricHero({ eyebrow, title, value, valueLabel, trend, meta, aside, children }: { eyebrow: string; title: string; value: string; valueLabel?: string; trend?: ReactNode; meta?: ReactNode; aside?: ReactNode; children?: ReactNode }) {
  return (
    <AnalyticsCard>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <SectionLabel as="p" className="mb-1">{eyebrow}</SectionLabel>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight">{title}</h2>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-heading text-5xl font-semibold tracking-tight text-primary">{value}</span>
            {valueLabel ? <span className="text-sm text-muted-foreground">{valueLabel}</span> : null}
          </p>
          {trend ? <div className="mt-2">{trend}</div> : null}
          {meta ? <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">{meta}</div> : null}
        </div>
        {aside ? <div className="w-full lg:w-[min(100%,26rem)]">{aside}</div> : null}
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
    </AnalyticsCard>
  )
}
