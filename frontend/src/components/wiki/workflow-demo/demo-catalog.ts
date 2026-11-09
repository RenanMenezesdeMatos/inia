import type { FlowNode, FlowNodeType } from "@/schemas/admin/workflow-graph.schema"

import { DEMO_CELL, DEMO_GRAPHS, type DemoGraphDefinition } from "./demo-graphs"
import type { DemoExample, DemoExampleWithGraph, DemoObjective, DemoScene, DemoScenario } from "./demo-types"
import { DESTAQUES_DO_MES } from "./examples/destaques-do-mes"
import { DOIS_MOMENTOS_DO_DIA } from "./examples/dois-momentos-do-dia"
import { NOTA_URA_BAIXA } from "./examples/nota-ura-baixa"
import { ORIENTAR_E_REAVALIAR } from "./examples/orientar-e-reavaliar"
import { POLITICA_DE_ACOMPANHAMENTO } from "./examples/politica-de-acompanhamento"
import { REVISAO_ANTES_DA_ENTREGA } from "./examples/revisao-antes-da-entrega"

/** Catálogo das demonstrações: junta cada roteiro ao seu grafo. Só organiza dados; nada aqui executa ou avalia. */

const EXAMPLES: DemoExample[] = [DOIS_MOMENTOS_DO_DIA, NOTA_URA_BAIXA, ORIENTAR_E_REAVALIAR, REVISAO_ANTES_DA_ENTREGA, DESTAQUES_DO_MES, POLITICA_DE_ACOMPANHAMENTO]

function definitionOf(slug: string): DemoGraphDefinition {
  const definition = DEMO_GRAPHS.find((candidate) => candidate.slug === slug)
  if (!definition) throw new Error(`Exemplo sem grafo: ${slug}`)
  return definition
}

export const DEMO_EXAMPLES: DemoExampleWithGraph[] = EXAMPLES.map((example) => ({ ...example, definition: definitionOf(example.slug) }))

export const DEMO_OBJECTIVES: Record<DemoObjective, { label: string; description: string }> = {
  orientar: { label: "Orientar o colaborador", description: "Levar uma orientação útil a quem atendeu." },
  reconhecer: { label: "Reconhecer resultados", description: "Dar visibilidade a quem foi bem." },
  acompanhar: { label: "Acompanhar a evolução", description: "Voltar depois de um tempo e ver o que mudou." },
  liderar: { label: "Apoiar a liderança", description: "Colocar quem lidera na decisão certa." },
}

export function exampleBySlug(slug: string): DemoExampleWithGraph {
  const example = DEMO_EXAMPLES.find((candidate) => candidate.slug === slug)
  if (!example) throw new Error(`Exemplo inexistente: ${slug}`)
  return example
}

export function scenesOf(example: DemoExample, scenario: DemoScenario): DemoScene[] {
  return scenario.scenes.map((id) => {
    const scene = example.scenes[id]
    if (!scene) throw new Error(`Cena inexistente: ${example.slug}/${id}`)
    return scene
  })
}

/** Id da âncora de uma etapa na lista de etapas do exemplo (também abre a demonstração nessa etapa). */
export const stepAnchorOf = (slug: string, nodeId: string) => `${slug}--${nodeId}`

/** Onde a demonstração começa quando alguém chega pela âncora de uma etapa. Só procura a etapa na lista já escrita. */
export function locateStep(example: DemoExample, nodeId: string): { scenarioId: string; index: number } | null {
  for (const scenario of example.scenarios) {
    const index = scenario.scenes.findIndex((sceneId) => example.scenes[sceneId]?.nodeId === nodeId)
    if (index >= 0) return { scenarioId: scenario.id, index }
  }
  return null
}

/** Coluna e linha do nó no mapa. */
export const gridOf = (node: FlowNode) => ({ column: Math.round(node.position.x / DEMO_CELL.x), row: Math.round(node.position.y / DEMO_CELL.y) })

export type DemoNodeUse = { slug: string; title: string; nodeId: string; nodeLabel: string }

const USES: DemoNodeUse[] = DEMO_EXAMPLES.flatMap((example) => example.definition.graph.nodes.map((node) => ({ slug: example.slug, title: example.title, nodeId: node.id, nodeLabel: node.label })))

function usesWhere(match: (node: FlowNode, example: DemoExampleWithGraph) => boolean): DemoNodeUse[] {
  const seen = new Set<string>()
  const uses: DemoNodeUse[] = []
  for (const example of DEMO_EXAMPLES) {
    for (const node of example.definition.graph.nodes) {
      if (!match(node, example) || seen.has(example.slug)) continue
      seen.add(example.slug)
      uses.push(USES.find((use) => use.slug === example.slug && use.nodeId === node.id)!)
    }
  }
  return uses
}

/** Exemplos que ensinam um tipo de nó (um link por exemplo, na primeira etapa daquele tipo). */
export const examplesTeachingNode = (type: FlowNodeType): DemoNodeUse[] => usesWhere((node) => node.type === type)

export type ActionKind = Extract<FlowNode, { type: "action" }>["config"]["actionType"]

export const examplesTeachingAction = (actionType: ActionKind): DemoNodeUse[] => usesWhere((node) => node.type === "action" && node.config.actionType === actionType)

export const examplesTeachingTrigger = (kind: "channel_flag" | "indicator" | "schedule" | "manual"): DemoNodeUse[] => usesWhere((node, example) => node.type === "trigger" && example.definition.trigger.kind === kind)

/** Os rótulos de nó que um exemplo ensina, na ordem do fluxo, para os chips da galeria. */
export function nodeKindsOf(example: DemoExampleWithGraph): { key: string; type: FlowNodeType; actionType?: ActionKind }[] {
  const seen = new Set<string>()
  const kinds: { key: string; type: FlowNodeType; actionType?: ActionKind }[] = []
  for (const node of example.definition.graph.nodes) {
    const actionType = node.type === "action" ? node.config.actionType : undefined
    const key = actionType ?? node.type
    if (seen.has(key)) continue
    seen.add(key)
    kinds.push(actionType ? { key, type: node.type, actionType } : { key, type: node.type })
  }
  return kinds
}
