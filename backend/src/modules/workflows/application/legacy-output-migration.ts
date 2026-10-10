import { findEdge, type FlowGraph, type FlowNode } from "../domain/graph-schema.js"

/**
 * Compatibilidade com workflows publicados antes do node Output existir: CALL_AGENT nunca mais
 * publica sozinho (ver run-agent.ts/action-executors.ts), então um grafo legado (sem nenhum
 * node "output") pararia de gerar Feedback silenciosamente se rodasse como está. Esta função
 * religa, para cada CALL_AGENT terminal sem Output a jusante, um node Output(CURRENT_OPERATOR,
 * FOLLOW_UP) lendo exatamente o que aquele CALL_AGENT produziu — reproduzindo o comportamento
 * antigo (Trigger→Condition→Agent→Feedback) como dado, não como `if` permanente no motor.
 *
 * Roda 1x contra `draft_graph` e a versão publicada ativa de cada workflow (ver
 * `migrate-legacy-workflow-outputs.ts`) — nunca em runtime.
 */
export function appendMissingOutputNodes(graph: FlowGraph): { graph: FlowGraph; changed: boolean } {
  if (graph.nodes.some((node) => node.type === "output")) return { graph, changed: false }

  const callAgentNodes = graph.nodes.filter(
    (node): node is Extract<FlowNode, { type: "action" }> => node.type === "action" && node.config.actionType === "CALL_AGENT",
  )
  if (callAgentNodes.length === 0) return { graph, changed: false }

  const nodes = [...graph.nodes]
  const edges = [...graph.edges]
  let changed = false

  callAgentNodes.forEach((agentNode, index) => {
    const outgoing = findEdge(graph, agentNode.id, "always")
    if (!outgoing) return // grafo publicado sem aresta de saída no CALL_AGENT não deveria existir — pula defensivamente

    const outputNodeId = `output-legacy-${agentNode.id}-${index}`
    nodes.push({
      id: outputNodeId,
      type: "output",
      label: "Output (migrado)",
      position: { x: agentNode.position.x + 40, y: agentNode.position.y + 140 },
      config: {
        target: { type: "CURRENT_OPERATOR" },
        surfaces: ["FOLLOW_UP"],
        source: `nodeOutputs.${agentNode.id}`,
      },
    })

    const edgeIndex = edges.findIndex((edge) => edge.id === outgoing.id)
    edges[edgeIndex] = { id: outgoing.id, source: agentNode.id, sourceHandle: "always", target: outputNodeId }
    edges.push({ id: `e-${outputNodeId}-${outgoing.target}`, source: outputNodeId, sourceHandle: "always", target: outgoing.target })
    changed = true
  })

  return { graph: { nodes, edges }, changed }
}
