import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { RESTORE_NOTE } from "@/lib/admin/logical-delete"

export type WorkflowRunStateKey = "DRAFT" | "LIVE" | "INACTIVE"

export type WorkflowRunState = { key: WorkflowRunStateKey; label: string; description: string }

/**
 * O que está rodando, em uma frase: "Publicado" sozinho não distingue um fluxo no ar de um desligado.
 * `active` só tem efeito depois de existir versão publicada — sem ela, nada roda, mesmo com o interruptor ligado.
 */
export function workflowRunState(workflow: { published: boolean; active: boolean }): WorkflowRunState {
  if (!workflow.published) return { key: "DRAFT", label: "Rascunho — ainda não roda", description: "Nada é executado até a primeira publicação." }
  if (workflow.active) return { key: "LIVE", label: "No ar", description: "A versão publicada está valendo para as próximas execuções." }
  return { key: "INACTIVE", label: "Desativado — não roda", description: "Não inicia novas execuções, e as que estão em andamento ficam paradas até reativar." }
}

/** O que Excluir leva junto. Os feedbacks já entregues ficam com os colaboradores, mas perdem o vínculo com o workflow. */
export function describeWorkflowDeletion(activeEnrollments: number): string {
  const running = activeEnrollments > 0 ? ` ${activeEnrollments === 1 ? "A execução em andamento será interrompida." : `As ${activeEnrollments} execuções em andamento serão interrompidas.`}` : ""
  return `O Workflow sai das telas e para de rodar.${running} ${RESTORE_NOTE} Versões, execuções e resultados continuam guardados, e os feedbacks e recados já entregues continuam com os colaboradores. Para apenas parar o fluxo, desative-o na lista.`
}

function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, sortedKeys(item)]),
    )
  }
  return value
}

/**
 * O que muda o COMPORTAMENTO do fluxo: mover uma etapa no canvas não é uma alteração a publicar, e o `orchestratorVersionId`
 * é gravado pela própria publicação, só na versão publicada. Ordem de campos e de elementos da lista não importam.
 */
function behaviorFingerprint(graph: FlowGraph): string {
  const nodes = graph.nodes
    .map((node) => {
      const { position: _position, config, ...rest } = node
      void _position
      const { orchestratorVersionId: _pinned, ...restConfig } = config as Record<string, unknown>
      void _pinned
      return sortedKeys({ ...rest, config: restConfig })
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const edges = graph.edges
    .map((edge) => `${edge.source}|${edge.sourceHandle}|${edge.target}`)
    .sort()
  return JSON.stringify({ nodes, edges })
}

/** O rascunho salvo difere da versão publicada em algo que muda o fluxo. Sem versão publicada, tudo é novo. */
export function hasUnpublishedGraphChanges(draft: FlowGraph, published: FlowGraph | null | undefined): boolean {
  if (!published) return true
  return behaviorFingerprint(draft) !== behaviorFingerprint(published)
}

/** Só Gatilho e Fim, sem nenhuma etapa entre eles: publicar não faria nada. */
export function isEmptyFlow(graph: FlowGraph): boolean {
  return graph.nodes.every((node) => node.type === "trigger" || node.type === "end")
}
