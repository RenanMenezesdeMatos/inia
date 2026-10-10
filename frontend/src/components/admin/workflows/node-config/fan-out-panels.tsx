"use client"

import { type FlowGraph, type FlowNode, findPrecedingCollectionNode, findPrecedingFanOutNode } from "@/schemas/admin/workflow-graph.schema"

/** "Aplicar individualmente" não tem configuração própria (seção 40 do pedido) — só mostra de
 * qual coleção ele parte, resolvida do mesmo jeito que o runtime resolve
 * (`findPrecedingCollectionNode`, BFS pra trás até o "Selecionar colaboradores" mais próximo). */
export function ApplyIndividuallyPanel({ node, graph }: { node: Extract<FlowNode, { type: "apply_individually" }>; graph: FlowGraph }) {
  const source = findPrecedingCollectionNode(graph, node.id)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Cria uma execução separada para cada colaborador da coleção atual.</p>
      <div className="space-y-1 rounded-md border p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Origem</p>
        {source ? (
          <p className="text-sm">
            Coleção produzida por <strong>{source.label}</strong>
          </p>
        ) : (
          <p className="text-sm text-destructive">Nenhum &quot;Selecionar colaboradores&quot; encontrado antes deste nó — adicione um antes de publicar.</p>
        )}
      </div>
      <div className="space-y-1 rounded-md border p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Comportamento</p>
        <p className="text-sm">1 execução por colaborador</p>
      </div>
    </div>
  )
}

/** "Consolidar resultados" (fan-in/JOIN) não tem configuração própria (mesmo padrão de
 * ApplyIndividuallyPanel) — só mostra de qual "Aplicar individualmente" ele é a barreira,
 * resolvida do mesmo jeito que o runtime resolve (`findPrecedingFanOutNode`). */
export function ConsolidateResultsPanel({ node, graph }: { node: Extract<FlowNode, { type: "consolidate_results" }>; graph: FlowGraph }) {
  const source = findPrecedingFanOutNode(graph, node.id)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Aguarda todas as execuções individuais criadas pelo fan-out e continua com os resultados consolidados.
      </p>
      <div className="space-y-1 rounded-md border p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Origem</p>
        {source ? (
          <p className="text-sm">
            Aplicar individualmente <strong>{source.label}</strong>
          </p>
        ) : (
          <p className="text-sm text-destructive">Nenhum &quot;Aplicar individualmente&quot; encontrado antes deste nó — adicione um antes de publicar.</p>
        )}
      </div>
      <div className="space-y-1 rounded-md border p-3">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Aguardar</p>
        <p className="text-sm">Todas as execuções</p>
      </div>
    </div>
  )
}
