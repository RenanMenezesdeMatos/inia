import { describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../config/env.js")>()
  return { env: { ...original.env, INIA_INTERACTION_FEEDBACK_PIPELINE: "ON" } }
})

import { fileURLToPath } from "node:url"
import { backendVerdict, editorIssues, type ParitySetup } from "../testing/publish-validation-parity.js"

/** Os grafos ficam no frontend, fora do `rootDir` deste pacote: entram por caminho em tempo de execução, como a validação do editor na paridade. */
const DEMO_GRAPHS_PATH = fileURLToPath(new URL("../../../../../frontend/src/components/wiki/workflow-demo/demo-graphs.ts", import.meta.url))
type DemoDefinition = {
  slug: string
  trigger: { kind: string; channelFlagId?: string; indicatorCode?: string; valueType?: "BOOLEAN" | "NUMERIC" }
  consolidatedStructure?: unknown
  graph: unknown
}
const { DEMO_GRAPHS, FICTIONAL_VARIABLE } = (await import(/* @vite-ignore */ DEMO_GRAPHS_PATH)) as { DEMO_GRAPHS: DemoDefinition[]; FICTIONAL_VARIABLE: string }

/**
 * Os exemplos da Wiki (`/wiki/workflows/exemplos`) ensinam só o que o módulo aceita: cada grafo passa na validação do botão
 * Publicar (backend) e na do editor. Se uma regra de publicação mudar e um exemplo deixar de valer, este teste falha, e a Wiki
 * precisa ser corrigida junto. Os dados nunca são executados: é só a validação, com o banco falso permissivo da paridade.
 */
function setupOf(definition: DemoDefinition): ParitySetup {
  const { trigger } = definition
  return {
    trigger: trigger.kind === "channel_flag" ? { kind: "channel_flag", channelFlagId: trigger.channelFlagId } : trigger.kind === "indicator" ? { kind: "indicator", indicatorCode: trigger.indicatorCode } : trigger,
    flagValueType: trigger.kind === "channel_flag" ? trigger.valueType : undefined,
    consolidated: Boolean(definition.consolidatedStructure),
    graph: definition.graph,
    operationalAggregation: { TMA: "WEIGHTED_AVERAGE" },
    variables: [{ id: FICTIONAL_VARIABLE, type: "TEXT", name: "Recado" }],
  } as ParitySetup
}

describe("exemplos da Wiki de Workflows — publicáveis nos dois lados", () => {
  it.each(DEMO_GRAPHS.map((definition) => [definition.slug, definition] as const))("%s", async (_slug, definition) => {
    const setup = setupOf(definition)
    const backend = await backendVerdict(setup)
    const editor = await editorIssues(setup)
    expect(backend, JSON.stringify({ backend, editor }, null, 2)).toBeNull()
    expect(editor, JSON.stringify({ backend, editor }, null, 2)).toEqual([])
  })
})

/**
 * O que a Wiki afirma que o módulo NÃO aceita. O exemplo "Orientação em dois momentos do dia" foi adaptado por causa destas regras: se
 * uma delas cair, o exemplo pode voltar à forma pedida, e o texto da Wiki (`dois-momentos-do-dia.ts › support`) precisa mudar junto.
 */
describe("limites que a Wiki ensina", () => {
  const schedule = DEMO_GRAPHS.find((definition) => definition.slug === "dois-momentos-do-dia")!
  const withNodes = (mutate: (graph: { nodes: unknown[]; edges: unknown[] }) => void): ParitySetup => {
    const graph = structuredClone(schedule.graph) as unknown as { nodes: unknown[]; edges: unknown[] }
    mutate(graph)
    return { ...setupOf(schedule), graph }
  }

  it("Agenda + \"Gerar feedback\" de monitoria não publica", async () => {
    const setup = withNodes((graph) => {
      graph.nodes.push({ id: "feedback", type: "action", label: "Gerar feedback", position: { x: 0, y: 0 }, config: { actionType: "GENERATE_FEEDBACK", sourceNodeId: "analise", feedbackDomain: "MONITORING" } })
      graph.edges = graph.edges.filter((edge) => (edge as { source: string }).source !== "analise")
      graph.edges.push({ id: "a", source: "analise", sourceHandle: "always", target: "feedback" }, { id: "b", source: "feedback", sourceHandle: "always", target: "entrega" })
      ;(graph.nodes.find((node) => (node as { id: string }).id === "entrega") as { config: { source: string } }).config.source = "nodeOutputs.feedback"
    })
    expect((await backendVerdict(setup))?.code).toBe("WORKFLOW_FEEDBACK_MONITORING_REQUIRES_INTERACTION")
  })

  it("Agenda + \"Avaliação de processo\" não publica", async () => {
    const setup = withNodes((graph) => {
      const node = graph.nodes.find((candidate) => (candidate as { id: string }).id === "analise") as { config: Record<string, unknown> }
      node.config.outputContract = "PROCESS_ASSESSMENT"
    })
    expect((await backendVerdict(setup))?.code).toBe("WORKFLOW_PROCESS_ASSESSMENT_REQUIRES_FLAG")
  })
})
