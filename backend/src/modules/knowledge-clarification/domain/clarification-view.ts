import { scenarioOf, type ClarificationState, type KnowledgeSourceRef, type ScenarioFact } from "./clarification-state.js"

/**
 * O que a TELA recebe: o estado do esclarecimento com cada fonte marcada como disponível ou não para QUEM LÊ (a referência gravada
 * não concede acesso — mesma regra dos materiais de apoio) e o cenário já montado. Fonte indisponível vai sem título nem seção.
 * Nenhum texto das bases sai daqui: só título da base, seção e posição.
 */
export type SourceView = KnowledgeSourceRef & { available: boolean }

export type ClarificationView = Omit<ClarificationState, "steps" | "sources" | "conflicts"> & {
  steps: (Omit<ClarificationState["steps"][number], "options"> & { options: (Omit<ClarificationState["steps"][number]["options"][number], "evidence"> & { evidence: SourceView[] })[] })[]
  sources: SourceView[]
  conflicts: { description: string; sources: SourceView[] }[]
  scenario: ScenarioFact[]
}

/** Bases citadas em qualquer parte do estado (opções, fontes da resposta, conflitos). */
export function referencedDocumentIds(state: ClarificationState): string[] {
  const ids = new Set<string>()
  for (const step of state.steps) for (const option of step.options) for (const source of option.evidence) ids.add(source.documentId)
  for (const source of state.sources) ids.add(source.documentId)
  for (const conflict of state.conflicts) for (const source of conflict.sources) ids.add(source.documentId)
  return [...ids]
}

export function toClarificationView(state: ClarificationState, accessibleDocumentIds: ReadonlySet<string>): ClarificationView {
  const view = (source: KnowledgeSourceRef): SourceView => {
    if (accessibleDocumentIds.has(source.documentId)) return { ...source, available: true }
    const hidden: SourceView = { ...source, documentTitle: "", heading: "", available: false }
    delete hidden.images
    return hidden
  }
  return {
    ...state,
    steps: state.steps.map((step) => ({ ...step, options: step.options.map((option) => ({ ...option, evidence: option.evidence.map(view) })) })),
    sources: state.sources.map(view),
    conflicts: state.conflicts.map((conflict) => ({ description: conflict.description, sources: conflict.sources.map(view) })),
    scenario: scenarioOf(state),
  }
}
