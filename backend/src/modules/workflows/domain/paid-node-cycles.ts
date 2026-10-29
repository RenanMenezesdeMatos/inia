import type { FlowGraph, FlowNode } from "./graph-schema.js"

/**
 * GASTO DE IA EM CICLOS (achado C06 da 4ª auditoria). O motor roda de novo cada nó a cada visita; estes chamam o modelo a cada
 * vez: "Chamar agente" (inclusive o Agent de síntese), "Gerar feedback", o feedback direto de atendimento e o Orquestrador.
 * A Revisão humana reaproveita a decisão já gravada numa nova visita — não segura um ciclo.
 */
const PAID_ACTION_TYPES: readonly string[] = ["CALL_AGENT", "GENERATE_FEEDBACK", "GENERATE_INTERACTION_FEEDBACK"]

export function callsModelOnEachVisit(node: FlowNode): boolean {
  if (node.type === "orchestrator") return true
  return node.type === "action" && PAID_ACTION_TYPES.includes(node.config.actionType)
}

/**
 * Primeiro nó que chama IA (na ordem do grafo) num ciclo alcançável a partir do Gatilho que NÃO passa por uma Espera — ou null.
 * Tira as Esperas do grafo alcançável e procura componentes fortemente conexos (Tarjan): um componente com mais de um nó, ou
 * com aresta para si mesmo, é um ciclo que roda sem pausa.
 */
export function findPaidCycleWithoutWait(graph: Pick<FlowGraph, "nodes" | "edges">): FlowNode | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const reachable = new Set<string>()
  const pending = graph.nodes.filter((node) => node.type === "trigger").map((node) => node.id)
  while (pending.length > 0) {
    const id = pending.pop()!
    if (reachable.has(id) || !byId.has(id)) continue
    reachable.add(id)
    for (const edge of graph.edges) if (edge.source === id) pending.push(edge.target)
  }
  const kept = (id: string) => reachable.has(id) && byId.get(id)!.type !== "wait"
  const next = new Map<string, string[]>()
  for (const edge of graph.edges) if (kept(edge.source) && kept(edge.target)) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target])

  const index = new Map<string, number>()
  const low = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const cyclic = new Set<string>()
  let counter = 0
  const visit = (id: string): void => {
    index.set(id, counter)
    low.set(id, counter)
    counter += 1
    stack.push(id)
    onStack.add(id)
    for (const target of next.get(id) ?? []) {
      if (!index.has(target)) {
        visit(target)
        low.set(id, Math.min(low.get(id)!, low.get(target)!))
      } else if (onStack.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!))
    }
    if (low.get(id) !== index.get(id)) return
    const component: string[] = []
    let member: string
    do {
      member = stack.pop()!
      onStack.delete(member)
      component.push(member)
    } while (member !== id)
    if (component.length > 1 || (next.get(id) ?? []).includes(id)) for (const item of component) cyclic.add(item)
  }
  for (const node of graph.nodes) if (kept(node.id) && !index.has(node.id)) visit(node.id)
  return graph.nodes.find((node) => cyclic.has(node.id) && callsModelOnEachVisit(node)) ?? null
}
