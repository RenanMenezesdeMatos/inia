import { useMemo } from "react"

import { usePublishedPolicySummariesQuery } from "@/queries/admin/use-intervention-policy-queries"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

import type { PolicyResultCatalog } from "./content-sources"

/** Políticas publicadas, por id — só busca quando o grafo tem um nó "Avaliar política de acompanhamento". */
export function usePolicyResultCatalog(graph: FlowGraph): PolicyResultCatalog {
  const enabled = graph.nodes.some((node) => node.type === "intervention_policy")
  const query = usePublishedPolicySummariesQuery(enabled)
  return useMemo(() => new Map((query.data ?? []).map((policy) => [policy.id, policy])), [query.data])
}
