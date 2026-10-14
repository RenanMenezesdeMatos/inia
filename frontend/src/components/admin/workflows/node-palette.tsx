"use client"

import { NODE_TYPE_LABELS, type FlowNodeType } from "@/schemas/admin/workflow-graph.schema"
import { cn } from "@/lib/utils"
import { NODE_COLORS, NODE_ICONS } from "./node-visuals"

const ADDABLE_TYPES: FlowNodeType[] = ["wait", "condition", "action", "orchestrator", "intervention_policy", "human_review", "output", "end"]

// "Selecionar colaboradores", "Aplicar individualmente" e "Consolidar resultados"
// (EMPLOYEE_COLLECTION + fan-in/JOIN) só existem dentro de um Workflow em modo Consolidado — fora
// disso não há "estrutura" nenhuma pra filtrar/repartir/consolidar, então nem aparecem arrastáveis
// (primeira vez que a paleta é condicional, ver plano aprovado).
const CONSOLIDATED_ONLY_TYPES: FlowNodeType[] = ["select_employees", "apply_individually", "consolidate_results"]

export const WORKFLOW_NODE_DRAG_MIME = "application/x-workflow-node-type"

/**
 * `onAddNode` é opcional e reaproveita o MESMO `addNodeAt` que o drop no canvas já chama — nunca
 * uma segunda forma de criar nó. Existe por dois motivos que apareceram na mesma auditoria:
 * arrastar-e-soltar nativo (HTML5 DnD) não é operável por teclado (cada item só tinha
 * `draggable`, sem role/tabIndex/onKeyDown — falha de acessibilidade real, não só um
 * inconveniente de automação) e, em alguns ambientes de teste do editor, o gesto de arrastar não
 * chega a disparar `dragstart` do navegador. Clicar (ou Enter/Espaço com foco no item) adiciona o
 * nó num ponto padrão do canvas — a posição exata continua sendo ajustável arrastando o node
 * depois, exatamente como um nó solto pelo drag já era.
 */
export function NodePalette({ isConsolidatedMode, onAddNode }: { isConsolidatedMode: boolean; onAddNode?: (type: FlowNodeType) => void }) {
  const addableTypes = isConsolidatedMode ? [...ADDABLE_TYPES, ...CONSOLIDATED_ONLY_TYPES] : ADDABLE_TYPES
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Adicionar nó</p>
      <p className="text-xs text-muted-foreground">Arraste um nó para o canvas — ou clique para adicionar no centro — no lugar onde ele deve entrar.</p>
      {addableTypes.map((type) => {
        const Icon = NODE_ICONS[type]
        const colors = NODE_COLORS[type]
        return (
          <div
            key={type}
            draggable
            role="button"
            tabIndex={0}
            aria-label={`Adicionar nó ${NODE_TYPE_LABELS[type]}`}
            onDragStart={(event) => {
              event.dataTransfer.setData(WORKFLOW_NODE_DRAG_MIME, type)
              event.dataTransfer.effectAllowed = "move"
            }}
            onClick={() => onAddNode?.(type)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return
              event.preventDefault()
              onAddNode?.(type)
            }}
            className="flex w-full cursor-grab items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm shadow-sm select-none active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded", colors.iconBg)}>
              <Icon className={cn("h-3.5 w-3.5", colors.icon)} />
            </span>
            {/* min-w-0 + quebra de linha: em 1024px o painel da paleta fica com ~130px e
             * "Orquestrador" era cortado sem reticência (QA visual). */}
            <span className="min-w-0 break-words">{NODE_TYPE_LABELS[type]}</span>
          </div>
        )
      })}
    </div>
  )
}
