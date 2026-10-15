import { formatScopeLabel } from "@/lib/admin/scope-compatibility"
import { CONSOLIDATED_STRUCTURE_LABELS } from "@/schemas/admin/consolidated-structure-schema"
import { POPULATION_FILTER_LABELS } from "@/schemas/admin/population-filter-schema"
import {
  triggerBadgeText,
  WORKFLOW_CONFIGURATION_CHANGE_LABELS,
  withDraftConfiguration,
  type Workflow,
  type WorkflowConfigurationChange,
} from "@/schemas/admin/workflow.schema"

export type ConfigurationChangeSummary = { change: WorkflowConfigurationChange; label: string; published: string; draft: string }

function describeAnalysis(workflow: Pick<Workflow, "consolidatedStructure" | "populationFilter">): string {
  if (workflow.consolidatedStructure) return `Consolidado · ${CONSOLIDATED_STRUCTURE_LABELS[workflow.consolidatedStructure.kind]}`
  const filter = workflow.populationFilter
  return `Individual · ${filter && filter.kind !== "ALL" ? POPULATION_FILTER_LABELS[filter.kind] : POPULATION_FILTER_LABELS.ALL}`
}

/**
 * "Publicado → Rascunho" de cada parte da configuração que mudou — o que passa a valer ao Publicar. Os campos de topo do
 * Workflow são a configuração publicada; `draftConfiguration`, a do rascunho.
 */
export function describeConfigurationChanges(workflow: Workflow, changes: WorkflowConfigurationChange[] = workflow.configurationChanges ?? []): ConfigurationChangeSummary[] {
  const draft = withDraftConfiguration(workflow)
  return changes.map((change) => {
    const label = WORKFLOW_CONFIGURATION_CHANGE_LABELS[change]
    if (change === "TRIGGER") return { change, label, published: triggerBadgeText(workflow.trigger), draft: triggerBadgeText(draft.trigger) }
    if (change === "SCOPE") return { change, label, published: formatScopeLabel(workflow), draft: formatScopeLabel(draft) }
    return { change, label, published: describeAnalysis(workflow), draft: describeAnalysis(draft) }
  })
}
