import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { flowGraphSchema, nodeBranches, resolveNodeContexts } from "./workflow-graph.schema"
import { validateWorkflowGraph } from "./workflow-validation"
import type { WorkflowTrigger } from "./workflow.schema"

/**
 * Os 22 Workflows-modelo oficiais, lidos da MESMA fixture que o backend usa
 * (backend/src/modules/workflows/testing/official-model-workflows.json — exportação literal dos
 * rascunhos persistidos). Aqui a pergunta é: o validador do EDITOR (o que aparece no rodapé
 * "Não é possível publicar — N problemas") concorda com o publish do backend e devolve 0
 * problemas pra cada modelo. Nunca uma 2ª cópia dos grafos "só pro frontend".
 */
type Fixture = {
  key: string
  name: string
  trigger: Record<string, unknown> & { kind: "channel_flag" | "indicator" | "schedule" }
  consolidatedStructure: { kind: string } | null
  graph: unknown
}

const FIXTURE_PATH = path.resolve(__dirname, "../../../../backend/src/modules/workflows/testing/official-model-workflows.json")
const MODELS = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture[]

const FLAG_VALUE_TYPES: Record<string, "BOOLEAN" | "NUMERIC"> = {
  "60c9cda8-63de-4443-b6b6-7f7c66e91931": "BOOLEAN",
  "383e42c6-898c-4c35-b94c-6e40ff696ab5": "NUMERIC",
  "de009d6c-decd-4a03-87cb-fbc7052289b0": "BOOLEAN",
}

/** O detalhe de Workflow do frontend enriquece o trigger com channel/flagName/valueType — aqui só
 * o que o validador de fato lê (kind, valueType, mode/times/frequency da agenda). */
function toFrontendTrigger(trigger: Fixture["trigger"]): WorkflowTrigger {
  if (trigger.kind === "channel_flag") {
    const flagId = String(trigger.channelFlagId)
    return { kind: "channel_flag", channelFlagId: flagId, channel: "VOICE", flagName: "flag", valueType: FLAG_VALUE_TYPES[flagId] ?? "NUMERIC" }
  }
  if (trigger.kind === "indicator") {
    return { kind: "indicator", indicatorCode: String(trigger.indicatorCode), indicatorName: String(trigger.indicatorCode), unit: "", valueType: "NUMERIC" }
  }
  return { ...(trigger as unknown as Extract<WorkflowTrigger, { kind: "schedule" }>), intervalDays: Number(trigger.intervalDays ?? 1) }
}

describe("Catálogo oficial — os 22 Workflows-modelo passam no validador do editor com 0 problemas", () => {
  it("fixture compartilhada com o backend está presente e completa", () => {
    expect(MODELS).toHaveLength(22)
  })

  it.each(MODELS.map((model) => [model.key, model] as const))("Modelo %s — 0 problemas no editor", (_key, model) => {
    const graph = flowGraphSchema.parse(model.graph)
    const issues = validateWorkflowGraph(graph, toFrontendTrigger(model.trigger), new Map(), new Map(), Boolean(model.consolidatedStructure))
    expect(issues, issues.map((issue) => issue.message).join("\n")).toEqual([])
  })

  it.each(MODELS.map((model) => [model.key, model] as const))("Modelo %s — todas as saídas de todos os nós têm aresta (handles do canvas ↔ arestas persistidas)", (_key, model) => {
    const graph = flowGraphSchema.parse(model.graph)
    for (const node of graph.nodes) {
      for (const branch of nodeBranches(node)) {
        expect(graph.edges.some((edge) => edge.source === node.id && edge.sourceHandle === branch.id), `${node.label} › ${branch.label}`).toBe(true)
      }
    }
  })

  it("destinatário × contexto: 'O próprio operador' nunca depois de 'Consolidar resultados' (matriz real, nunca leitura visual)", () => {
    for (const model of MODELS) {
      if (!model.consolidatedStructure) continue
      const graph = flowGraphSchema.parse(model.graph)
      const contexts = resolveNodeContexts(graph)
      for (const node of graph.nodes) {
        if (node.type !== "output") continue
        if (contexts.get(node.id) === "CONSOLIDATED_RESULT") expect(node.config.target.type, `${model.key}: ${node.label}`).not.toBe("CURRENT_OPERATOR")
        if (node.config.target.type === "CURRENT_OPERATOR") expect(contexts.get(node.id), `${model.key}: ${node.label}`).toBe("EMPLOYEE")
      }
    }
  })
})
