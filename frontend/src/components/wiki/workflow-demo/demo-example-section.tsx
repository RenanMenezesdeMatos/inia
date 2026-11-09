import type { ReactNode } from "react"
import Link from "next/link"
import { CircleCheck, CircleSlash } from "lucide-react"

import { WikiSection } from "@/components/wiki/wiki-primitives"

import { DEMO_OBJECTIVES, stepAnchorOf } from "./demo-catalog"
import { NodeIcon } from "./demo-node-icon"
import { nodeKindText, nodeReferenceHref } from "./demo-node-meta"
import { DemoPlayer } from "./demo-player"
import type { DemoExampleWithGraph } from "./demo-types"

/**
 * A seção de um exemplo: tudo o que é essencial fica no HTML, legível sem animação e sem JavaScript (objetivo, jornada, etapas, limites).
 * A demonstração guiada é uma camada a mais, por cima disso.
 */
export function DemoExampleSection({ example, children }: { example: DemoExampleWithGraph; children?: ReactNode }) {
  return (
    <WikiSection id={example.slug} title={example.title} eyebrow={DEMO_OBJECTIVES[example.objective].label}>
      <p>{example.problem}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <span className="block font-semibold text-foreground">Objetivo</span>
          {example.goal}
        </p>
        <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <span className="block font-semibold text-foreground">Resultado esperado</span>
          {example.expectedResult}
        </p>
      </div>

      <DemoPlayer slug={example.slug} />

      <dl className="divide-y divide-border rounded-lg border border-border text-sm">
        {example.brief.map((item) => (
          <div key={item.question} className="grid grid-cols-1 gap-1 p-3 sm:grid-cols-[220px_1fr] sm:gap-4">
            <dt className="font-medium text-foreground">{item.question}</dt>
            <dd className="text-foreground/90">{item.answer}</dd>
          </div>
        ))}
      </dl>

      {example.support ? (
        <div className="space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4 text-sm">
          <div className="space-y-1">
            <p className="font-semibold text-foreground">{example.support.title}</p>
            <p>{example.support.intro}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300">
                <CircleCheck className="size-4" aria-hidden /> Funciona hoje
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {example.support.works.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="space-y-1.5">
              <p className="flex items-center gap-1.5 font-medium text-amber-800 dark:text-amber-300">
                <CircleSlash className="size-4" aria-hidden /> Limites a conhecer
              </p>
              <ul className="list-disc space-y-1 pl-5">
                {example.support.limits.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          {example.support.alternative ? <p className="text-muted-foreground">{example.support.alternative}</p> : null}
        </div>
      ) : null}

      {children}

      <div className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">As etapas desta jornada</p>
        <ol className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {example.definition.graph.nodes.map((node, index) => (
              <li key={node.id} id={stepAnchorOf(example.slug, node.id)} className="flex scroll-mt-24 items-start gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm">
                <span className="mt-0.5 font-mono text-xs text-muted-foreground">{index + 1}</span>
                <NodeIcon node={node} className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  {node.label}{" "}
                  <Link href={nodeReferenceHref(node)} className="text-xs font-medium whitespace-nowrap text-primary underline-offset-2 hover:underline">
                    {nodeKindText(node)}
                  </Link>
                </span>
              </li>
          ))}
        </ol>
      </div>
    </WikiSection>
  )
}
