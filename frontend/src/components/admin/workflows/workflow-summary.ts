import { CONSOLIDATED_STRUCTURE_LABELS } from "@/schemas/admin/consolidated-structure-schema"
import { POPULATION_FILTER_LABELS } from "@/schemas/admin/population-filter-schema"
import {
  ESCALATION_ROLE_LABELS,
  nodeBranches,
  OUTPUT_SURFACE_LABELS,
  type FlowGraph,
  type FlowNode,
} from "@/schemas/admin/workflow-graph.schema"
import { describeManualTrigger, triggerLabel, type Workflow } from "@/schemas/admin/workflow.schema"
import { formatScopeLabel } from "@/lib/admin/scope-compatibility"

export type WorkflowSummary = {
  starts: string
  who: string
  steps: string
  recipients: string[]
  ends: string
  /** Etapas no canvas que nenhum caminho alcança: não rodam. */
  unreachable: number
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function reachableNodes(graph: FlowGraph): FlowNode[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const seen = new Set<string>()
  const queue = graph.nodes.filter((node) => node.type === "trigger").map((node) => node.id)
  while (queue.length > 0) {
    const id = queue.shift()!
    if (seen.has(id) || !byId.has(id)) continue
    seen.add(id)
    for (const edge of graph.edges) if (edge.source === id) queue.push(edge.target)
  }
  return graph.nodes.filter((node) => seen.has(node.id))
}

function describeStart(trigger: Workflow["trigger"]): string {
  if (trigger.kind === "channel_flag") return `Quando uma interação chega com a flag "${trigger.flagName}"`
  if (trigger.kind === "indicator") return `Quando chega uma nova medição de ${trigger.indicatorName}`
  if (trigger.kind === "manual") return `Quando alguém clica em Executar agora (${describeManualTrigger(trigger).toLowerCase()})`
  return triggerLabel(trigger)
}

function describeAudience(workflow: Workflow): string {
  const scope = formatScopeLabel(workflow)
  if (workflow.consolidatedStructure) return `${CONSOLIDATED_STRUCTURE_LABELS[workflow.consolidatedStructure.kind]} como uma única análise — ${scope}`
  // Manual roda para uma pessoa por vez, escolhida no diálogo: "todos os elegíveis" faria parecer que publicar dispara em massa.
  if (workflow.trigger.kind === "manual") return `Uma execução por clique, para o colaborador escolhido em Executar agora — ${scope}`
  const filter = workflow.populationFilter
  const population = filter && filter.kind !== "ALL" ? POPULATION_FILTER_LABELS[filter.kind] : "todos os colaboradores elegíveis"
  return `Uma execução por colaborador: ${population.toLowerCase()} — ${scope}`
}

function describeSteps(nodes: FlowNode[]): string {
  const count = (matches: (node: FlowNode) => boolean) => nodes.filter(matches).length
  const ai = count((node) => node.type === "orchestrator" || (node.type === "action" && node.config.actionType === "CALL_AGENT"))
  const feedback = count((node) => node.type === "action" && (node.config.actionType === "GENERATE_FEEDBACK" || node.config.actionType === "GENERATE_INTERACTION_FEEDBACK"))
  const conditions = count((node) => node.type === "condition")
  const reviews = count((node) => node.type === "human_review")
  const waits = count((node) => node.type === "wait")
  const policies = count((node) => node.type === "intervention_policy")
  const parts = [
    ai > 0 ? plural(ai, "análise com IA", "análises com IA") : null,
    feedback > 0 ? plural(feedback, "feedback gerado", "feedbacks gerados") : null,
    conditions > 0 ? plural(conditions, "condição", "condições") : null,
    policies > 0 ? plural(policies, "política de acompanhamento", "políticas de acompanhamento") : null,
    reviews > 0 ? plural(reviews, "revisão humana", "revisões humanas") : null,
    waits > 0 ? plural(waits, "espera", "esperas") : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(", ") : "Nenhuma etapa entre o início e o fim"
}

function describeSurfaces(surfaces: readonly (keyof typeof OUTPUT_SURFACE_LABELS)[]): string {
  return surfaces.map((surface) => OUTPUT_SURFACE_LABELS[surface]).join(", ") || "sem destino escolhido"
}

function describeRecipients(nodes: FlowNode[]): string[] {
  const recipients = new Set<string>()
  for (const node of nodes) {
    if (node.type === "output") {
      const target = node.config.target
      const who =
        target.type === "CURRENT_OPERATOR"
          ? "O próprio colaborador"
          : target.type === "SUPERVISOR_OF_OPERATOR"
            ? "Supervisor do colaborador"
            : target.type === "MANAGER_OF_OPERATOR"
              ? "Gerente do colaborador"
              : target.type === "ROLE"
                ? ESCALATION_ROLE_LABELS[target.role]
                : "Pessoa específica"
      recipients.add(`${who} — ${describeSurfaces(node.config.surfaces)}`)
    }
    if (node.type === "action" && node.config.actionType === "ESCALATE") {
      const target = node.config.target
      const who = target.type === "SPECIFIC_USER" ? "Pessoa específica" : ESCALATION_ROLE_LABELS[target.role]
      recipients.add(`${who}, se escalonado — ${describeSurfaces(node.config.surfaces)}`)
    }
  }
  return [...recipients]
}

function describeEnd(nodes: FlowNode[]): string {
  const hasEnd = nodes.some((node) => node.type === "end" || nodeBranches(node).length === 0)
  if (!hasEnd) return "Nenhum caminho chega ao fim"
  if (nodes.some((node) => node.type === "human_review")) return "Ao chegar ao fim. Pode ficar parado, sem prazo, até a revisão ser decidida"
  return "Ao chegar ao fim do caminho seguido"
}

/**
 * As cinco perguntas que a pessoa precisa responder antes de pôr um fluxo no ar: quando começa, para quem roda, o que
 * acontece, quem recebe e quando termina. Descreve o RASCUNHO recebido, só a partir do que está no grafo e na configuração.
 */
export function summarizeWorkflow(workflow: Workflow, graph: FlowGraph): WorkflowSummary {
  const nodes = reachableNodes(graph)
  return {
    starts: describeStart(workflow.trigger),
    who: describeAudience(workflow),
    steps: describeSteps(nodes),
    recipients: describeRecipients(nodes),
    ends: describeEnd(nodes),
    unreachable: graph.nodes.length - nodes.length,
  }
}
