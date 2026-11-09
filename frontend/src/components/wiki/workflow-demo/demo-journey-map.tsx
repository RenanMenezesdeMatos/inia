"use client"

import { Check, XCircle } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"

import { NODE_COLORS } from "@/components/admin/workflows/node-visuals"
import { cn } from "@/lib/utils"
import { nodeBranches, type FlowEdge, type FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { gridOf } from "./demo-catalog"
import { NodeIcon } from "./demo-node-icon"
import { nodeKindText } from "./demo-node-meta"
import type { DemoExampleWithGraph, DemoScene } from "./demo-types"

/**
 * O mapa da jornada: os mesmos nós e as mesmas saídas do grafo do exemplo, desenhados de cima para baixo como no canvas.
 * Só apresentação: quem diz em que nó estamos é a lista de cenas do roteiro. As saídas (Sim, Não, Sem dados…) vêm de `nodeBranches`,
 * a mesma função do editor, para o mapa nunca mostrar uma saída que o nó não tem.
 */
const CELL = { width: 108, height: 66 } as const
const NODE = { width: 102, height: 48 } as const

type Point = { x: number; y: number }

function anchorsOf(edge: FlowEdge, source: FlowNode, target: FlowNode): { from: Point; to: Point; d: string } {
  const branches = nodeBranches(source)
  const branchIndex = Math.max(0, branches.findIndex((branch) => branch.id === edge.sourceHandle))
  const spread = (branchIndex - (branches.length - 1) / 2) * 26
  const sourceGrid = gridOf(source)
  const targetGrid = gridOf(target)
  const from = { x: sourceGrid.column * CELL.width + CELL.width / 2 + spread, y: sourceGrid.row * CELL.height + NODE.height }
  const to = { x: targetGrid.column * CELL.width + CELL.width / 2, y: targetGrid.row * CELL.height }
  const bend = Math.max(14, (to.y - from.y) * 0.5)
  return { from, to, d: `M ${from.x} ${from.y} C ${from.x} ${from.y + bend}, ${to.x} ${to.y - bend}, ${to.x} ${to.y}` }
}

type MapProps = {
  example: DemoExampleWithGraph
  /** As cenas do desfecho escolhido, na ordem. */
  scenes: DemoScene[]
  /** Índice da cena atual; `null` na introdução. */
  index: number | null
}

export function DemoJourneyMap({ example, scenes, index }: MapProps) {
  const reducedMotion = useReducedMotion()
  const { graph } = example.definition
  const columns = Math.max(...graph.nodes.map((node) => gridOf(node).column)) + 1
  const rows = Math.max(...graph.nodes.map((node) => gridOf(node).row)) + 1
  const width = columns * CELL.width
  const height = rows * CELL.height - (CELL.height - NODE.height)

  const pathNodeIds = scenes.map((scene) => scene.nodeId)
  const currentScene = index === null ? null : scenes[index]
  const currentNodeId = currentScene?.nodeId ?? null
  const donePath = index === null ? [] : pathNodeIds.slice(0, index + 1)
  const doneNodes = new Set(donePath.slice(0, -1).filter((id) => id !== currentNodeId))
  const onPath = new Set(pathNodeIds)

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  const previousDistinct = index === null ? null : [...donePath].reverse().find((id) => id !== currentNodeId) ?? null
  const walked = new Set<string>()
  for (let position = 1; position < donePath.length; position += 1) {
    if (donePath[position - 1] !== donePath[position]) walked.add(`${donePath[position - 1]}>${donePath[position]}`)
  }

  return (
    <div className="overflow-x-auto" data-slot="demo-journey-map">
      <div className="relative mx-auto" style={{ width, height }}>
        <svg aria-hidden className="absolute inset-0 overflow-visible" width={width} height={height}>
          {graph.edges.map((edge) => {
            const source = nodeById.get(edge.source)
            const target = nodeById.get(edge.target)
            if (!source || !target) return null
            const { from, d } = anchorsOf(edge, source, target)
            const isWalked = walked.has(`${edge.source}>${edge.target}`)
            const label = nodeBranches(source).length > 1 ? nodeBranches(source).find((branch) => branch.id === edge.sourceHandle)?.label : null
            const branchIndex = nodeBranches(source).findIndex((branch) => branch.id === edge.sourceHandle)
            return (
              <g key={edge.id}>
                <path d={d} fill="none" strokeWidth={isWalked ? 2 : 1.25} className={cn("transition-[stroke] duration-300 motion-reduce:transition-none", isWalked ? "stroke-primary" : "stroke-border")} />
                {label ? (
                  <text x={from.x} y={from.y + 9 + branchIndex * 9} textAnchor="middle" className={cn("text-[8.5px] font-medium [paint-order:stroke] [stroke-width:3px] stroke-background", isWalked ? "fill-primary" : "fill-muted-foreground")}>
                    {label}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>

        {/* A "viagem" até a etapa atual: chama a atenção para o avanço e some para quem prefere menos movimento. */}
        {!reducedMotion && previousDistinct && currentNodeId
          ? graph.edges
              .filter((edge) => edge.source === previousDistinct && edge.target === currentNodeId)
              .slice(0, 1)
              .map((edge) => (
                <motion.span
                  key={`${edge.id}-${index}`}
                  aria-hidden
                  className="pointer-events-none absolute top-0 left-0 size-2.5 rounded-full bg-primary shadow-[0_0_0_3px_var(--background)]"
                  style={{ offsetPath: `path("${anchorsOf(edge, nodeById.get(edge.source)!, nodeById.get(edge.target)!).d}")`, offsetRotate: "0deg" }}
                  initial={{ offsetDistance: "0%", opacity: 1 }}
                  animate={{ offsetDistance: "100%", opacity: 0 }}
                  transition={{ duration: 0.55, ease: "easeInOut", opacity: { delay: 0.45, duration: 0.1 } }}
                />
              ))
          : null}

        <ul aria-label={`Mapa da jornada: ${example.title}`}>
          {graph.nodes.map((node) => {
            const { column, row } = gridOf(node)
            const colors = NODE_COLORS[node.type]
            const current = node.id === currentNodeId
            const done = doneNodes.has(node.id)
            const stopped = current && currentScene?.stopsHere === "failed"
            const offPath = !onPath.has(node.id)
            const status = current ? (stopped ? "etapa atual, encerrada aqui" : "etapa atual") : done ? "etapa concluída" : offPath ? "fora deste caminho" : "próxima etapa"
            return (
              <li
                key={node.id}
                aria-current={current ? "step" : undefined}
                data-node={node.id}
                data-state={current ? "current" : done ? "done" : offPath ? "off-path" : "upcoming"}
                className={cn(
                  "absolute flex items-center gap-1 rounded-lg border bg-card px-1 shadow-xs transition-[opacity,box-shadow,transform] duration-300 motion-reduce:transition-none",
                  current ? "z-10 border-primary ring-2 ring-primary motion-safe:scale-[1.04]" : "border-border",
                  stopped && "border-destructive ring-destructive",
                  offPath && "border-dashed opacity-45",
                )}
                style={{ left: column * CELL.width + (CELL.width - NODE.width) / 2, top: row * CELL.height, width: NODE.width, height: NODE.height }}
              >
                <span className={cn("relative flex size-5 shrink-0 items-center justify-center rounded", colors.iconBg)}>
                  <NodeIcon node={node} className={cn("size-3", colors.icon)} />
                  {done ? (
                    <span className="absolute -right-1 -bottom-1 flex size-3 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-2" strokeWidth={3} aria-hidden />
                    </span>
                  ) : null}
                  {stopped ? <XCircle className="absolute -right-1 -bottom-1 size-3 rounded-full bg-background text-destructive" aria-hidden /> : null}
                </span>
                <span className={cn("min-w-0 text-[10.5px] leading-tight", current ? "font-semibold" : "font-medium")}>{example.mapLabels[node.id] ?? node.label}</span>
                <span className="sr-only">
                  {nodeKindText(node)}: {status}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
