"use client"

import Link from "next/link"
import { AlertTriangle, ArrowRight, ListChecks } from "lucide-react"

import { NODE_COLORS } from "@/components/admin/workflows/node-visuals"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { DemoPreviewCard } from "./demo-previews"
import { NodeIcon } from "./demo-node-icon"
import { nodeKindText, nodeReferenceHref } from "./demo-node-meta"
import { DemoShotFigure } from "./demo-shot-figure"
import { DEMO_SHOTS } from "./demo-shots"
import type { DemoPanel, DemoScene } from "./demo-types"

function DataList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/20 p-3">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="space-y-1 text-sm text-foreground/90">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

/** A configuração ilustrativa: parece o painel do editor, mas é só leitura e está identificada como ilustração. */
function ConfigPanel({ panel }: { panel: DemoPanel }) {
  return (
    <section aria-label={`Configuração ilustrativa: ${panel.title}`} className="rounded-lg border border-border" data-slot="demo-config">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-sm font-semibold">{panel.title}</p>
        <Badge variant="outline" className="font-normal">Ilustração da configuração</Badge>
      </header>
      <dl className="space-y-2.5 p-3">
        {panel.fields.map((field) => (
          <div key={field.label} className="space-y-1">
            <dt className="text-xs font-medium text-foreground">{field.label}</dt>
            <dd className="space-y-1">
              <span className="flex min-h-8 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 py-1 text-sm break-words">
                <span className="min-w-0">{field.value}</span>
                {field.illustrative ? <span className="shrink-0 rounded bg-amber-500/15 px-1.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">exemplo</span> : null}
              </span>
              {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Onde encontrar:</span> {panel.where}
      </p>
    </section>
  )
}

export function DemoSceneView({ scene, node, onDecision }: { scene: DemoScene; node: FlowNode; onDecision?: (decision: string) => void }) {
  const colors = NODE_COLORS[node.type]
  const shots = (scene.shots ?? []).map((id) => DEMO_SHOTS[id]).filter((shot) => shot !== undefined)
  return (
    <div key={scene.id} className="min-w-0 space-y-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none" data-scene={scene.id}>
      <header className="space-y-2">
        <Link href={nodeReferenceHref(node)} className="inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-primary underline-offset-2 hover:underline">
          <span className={cn("flex size-5 items-center justify-center rounded", colors.iconBg)}>
            <NodeIcon node={node} className={cn("size-3", colors.icon)} />
          </span>
          {nodeKindText(node)}
          <span className="sr-only">: ver a referência deste nó</span>
        </Link>
        <h4 className="font-heading text-lg leading-snug font-semibold text-balance">{scene.title}</h4>
        <p className="text-sm leading-relaxed text-foreground/90">{scene.summary}</p>
      </header>

      <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <DataList title="Entrada" items={scene.input} />
        <ArrowRight className="hidden size-4 self-center text-muted-foreground sm:block" aria-hidden />
        <DataList title="Resultado" items={scene.output} />
      </div>

      {scene.preview ? <DemoPreviewCard preview={scene.preview} {...(onDecision ? { onDecision } : {})} /> : null}
      {scene.panel ? <ConfigPanel panel={scene.panel} /> : null}

      <section aria-label="Como reproduzir no módulo real" className="space-y-2 rounded-lg border border-border p-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ListChecks className="size-4 text-primary" aria-hidden /> Como fazer no módulo real
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-foreground/90">
          {scene.howTo.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {shots.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 pt-1">
            {shots.map((shot) => (
              <DemoShotFigure key={shot.id} shot={shot} />
            ))}
          </div>
        ) : null}
      </section>

      {scene.caution ? (
        <p className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Cuidado: </span>
            {scene.caution}
          </span>
        </p>
      ) : null}
    </div>
  )
}
