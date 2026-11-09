"use client"

import { useId, useState } from "react"
import { ArrowRight, CalendarClock, Inbox, Play } from "lucide-react"

import { ACTION_TYPE_LABELS, NODE_COLORS } from "@/components/admin/workflows/node-visuals"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"
import { NODE_TYPE_LABELS } from "@/schemas/admin/workflow-graph.schema"

import { DEMO_EXAMPLES, DEMO_OBJECTIVES, nodeKindsOf } from "./demo-catalog"
import type { DemoObjective } from "./demo-types"

const ALL = "todos"

/** Galeria por objetivo de negócio. O filtro é estado local de apresentação; "Ver exemplo na prática" é uma âncora para a seção do exemplo, que abre a demonstração. */
export function DemoGallery() {
  const [objective, setObjective] = useState<string>(ALL)
  const labelId = useId()
  const objectives = Object.keys(DEMO_OBJECTIVES) as DemoObjective[]
  const visible = DEMO_EXAMPLES.filter((example) => objective === ALL || example.objective === objective)

  return (
    <div className="space-y-4" data-slot="demo-gallery">
      <div className="space-y-1.5">
        <p id={labelId} className="text-xs font-medium text-muted-foreground">O que você quer resolver?</p>
        <ToggleGroup type="single" aria-labelledby={labelId} value={objective} onValueChange={(value) => setObjective(value || ALL)} className="flex-wrap justify-start">
          <ToggleGroupItem value={ALL} className="text-xs">Todos</ToggleGroupItem>
          {objectives.map((key) => (
            <ToggleGroupItem key={key} value={key} className="text-xs">{DEMO_OBJECTIVES[key].label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {visible.map((example) => (
          <li key={example.slug} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 shadow-xs transition-shadow hover:shadow-sm motion-reduce:transition-none" data-example={example.slug}>
            <div className="space-y-1">
              <p className="text-xs font-medium text-primary">{DEMO_OBJECTIVES[example.objective].label}</p>
              <h3 className="font-heading text-base leading-snug font-semibold">{example.title}</h3>
            </div>
            <p className="text-sm text-foreground/90">{example.problem}</p>
            <dl className="space-y-1.5 text-xs">
              <div>
                <dt className="font-medium text-foreground">Quando faz sentido</dt>
                <dd className="text-muted-foreground">{example.whenToUse}</dd>
              </div>
              <div className="flex gap-1.5">
                <CalendarClock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="font-medium text-foreground">O que inicia</dt>
                  <dd className="text-muted-foreground">{example.startsWith}</dd>
                </div>
              </div>
              <div className="flex gap-1.5">
                <Inbox className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <dt className="font-medium text-foreground">Quem recebe</dt>
                  <dd className="text-muted-foreground">{example.recipient}</dd>
                </div>
              </div>
            </dl>
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Nós ensinados</p>
              <ul className="flex flex-wrap gap-1">
                {nodeKindsOf(example).map((kind) => (
                  <li key={kind.key} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", NODE_COLORS[kind.type].iconBg, NODE_COLORS[kind.type].icon)}>
                    {kind.actionType ? ACTION_TYPE_LABELS[kind.actionType] : NODE_TYPE_LABELS[kind.type]}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-auto pt-1">
              <Button asChild size="sm" variant="outline">
                <a href={`#${example.slug}`}>
                  <Play className="size-3.5" aria-hidden /> Ver exemplo na prática <ArrowRight className="size-3.5" aria-hidden />
                </a>
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
