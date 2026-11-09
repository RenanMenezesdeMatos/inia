"use client"

import { Bot, ClipboardCheck, Clock, Flag, GitBranch, GitMerge, Send, ShieldCheck, Split, Sparkles, TrendingUp, UsersRound, Variable, Zap, type LucideIcon } from "lucide-react"

import type { FlowNode, FlowNodeType } from "@/schemas/admin/workflow-graph.schema"
import { cn } from "@/lib/utils"

import { NODE_COLORS } from "./node-visuals"

export type ActionPreset = Extract<FlowNode, { type: "action" }>["config"]["actionType"]

export type PaletteEntry = {
  /** Identificador do item na paleta: o tipo do nó, ou o tipo da ação (cada ação é um item próprio). */
  id: string
  type: FlowNodeType
  actionType?: ActionPreset
  label: string
  description: string
  icon: LucideIcon
}

type PaletteGroup = { title: string; entries: PaletteEntry[] }

const PALETTE_GROUPS: PaletteGroup[] = [
  {
    title: "Analisar com IA",
    entries: [
      { id: "CALL_AGENT", type: "action", actionType: "CALL_AGENT", label: "Chamar agente", description: "Quando você sabe qual especialista deve analisar", icon: Zap },
      { id: "orchestrator", type: "orchestrator", label: "Orquestrador", description: "Quando a IA deve escolher ou combinar especialistas", icon: Bot },
      { id: "GENERATE_FEEDBACK", type: "action", actionType: "GENERATE_FEEDBACK", label: "Gerar feedback", description: "Transforma a análise em feedback ao colaborador", icon: Sparkles },
      { id: "intervention_policy", type: "intervention_policy", label: "Avaliar política de acompanhamento", description: "Recomenda ou abre intervenções conforme a política", icon: ClipboardCheck },
    ],
  },
  {
    title: "Decidir e esperar",
    entries: [
      { id: "condition", type: "condition", label: "Condição", description: "Divide o caminho em Sim e Não", icon: GitBranch },
      { id: "human_review", type: "human_review", label: "Revisão humana", description: "Para o fluxo até alguém decidir", icon: ShieldCheck },
      { id: "wait", type: "wait", label: "Aguardar", description: "Pausa por um tempo definido", icon: Clock },
    ],
  },
  {
    title: "Entregar",
    entries: [
      { id: "output", type: "output", label: "Output", description: "Entrega o resultado a alguém", icon: Send },
      { id: "ESCALATE", type: "action", actionType: "ESCALATE", label: "Escalonar", description: "Encaminha para a liderança", icon: TrendingUp },
    ],
  },
  {
    title: "Organizar",
    entries: [
      { id: "SET_VARIABLE", type: "action", actionType: "SET_VARIABLE", label: "Definir variável", description: "Guarda um valor para usar depois", icon: Variable },
      { id: "end", type: "end", label: "Fim", description: "Encerra este caminho", icon: Flag },
    ],
  },
]

// "Selecionar colaboradores", "Aplicar individualmente" e "Consolidar resultados"
// (EMPLOYEE_COLLECTION + fan-in/JOIN) só existem dentro de um Workflow em modo Consolidado — fora
// disso não há "estrutura" nenhuma pra filtrar/repartir/consolidar, então nem aparecem arrastáveis.
const CONSOLIDATED_GROUP: PaletteGroup = {
  title: "Analisar uma estrutura",
  entries: [
    { id: "select_employees", type: "select_employees", label: "Selecionar colaboradores", description: "Escolhe quem da estrutura será analisado", icon: UsersRound },
    { id: "apply_individually", type: "apply_individually", label: "Aplicar individualmente", description: "Roda o caminho uma vez por colaborador", icon: Split },
    { id: "consolidate_results", type: "consolidate_results", label: "Consolidar resultados", description: "Reúne os resultados individuais", icon: GitMerge },
  ],
}

export const WORKFLOW_NODE_DRAG_MIME = "application/x-workflow-node-type"

/** O item da paleta que veio no arrasto (o `id`), para o drop criar a mesma etapa que o clique. */
export function paletteEntryById(id: string): PaletteEntry | undefined {
  return [...PALETTE_GROUPS, CONSOLIDATED_GROUP].flatMap((group) => group.entries).find((entry) => entry.id === id)
}

/**
 * `onAddNode` é opcional e reaproveita o MESMO `addNodeAt` que o drop no canvas já chama — nunca
 * uma segunda forma de criar nó. Existe por dois motivos que apareceram na mesma auditoria:
 * arrastar-e-soltar nativo (HTML5 DnD) não é operável por teclado (cada item só tinha
 * `draggable`, sem role/tabIndex/onKeyDown — falha de acessibilidade real, não só um
 * inconveniente de automação) e, em alguns ambientes de teste do editor, o gesto de arrastar não
 * chega a disparar `dragstart` do navegador. Clicar (ou Enter/Espaço com foco no item) adiciona o
 * nó abaixo da última etapa — a posição exata continua ajustável arrastando depois.
 */
export function NodePalette({ isConsolidatedMode, onAddNode }: { isConsolidatedMode: boolean; onAddNode?: (entry: PaletteEntry) => void }) {
  const groups = isConsolidatedMode ? [CONSOLIDATED_GROUP, ...PALETTE_GROUPS] : PALETTE_GROUPS
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Adicionar etapa</p>
        <p className="text-xs text-muted-foreground">Clique para adicionar abaixo da última etapa, ou arraste para o lugar certo.</p>
      </div>
      {groups.map((group) => (
        <div key={group.title} className="space-y-1.5" role="group" aria-label={group.title}>
          <p className="text-xs font-medium text-muted-foreground">{group.title}</p>
          {group.entries.map((entry) => {
            const Icon = entry.icon
            const colors = NODE_COLORS[entry.type]
            return (
              <div
                key={entry.id}
                draggable
                role="button"
                tabIndex={0}
                aria-label={`Adicionar etapa ${entry.label}`}
                aria-describedby={`palette-${entry.id}`}
                title={entry.description}
                onDragStart={(event) => {
                  event.dataTransfer.setData(WORKFLOW_NODE_DRAG_MIME, entry.id)
                  event.dataTransfer.effectAllowed = "move"
                }}
                onClick={() => onAddNode?.(entry)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return
                  event.preventDefault()
                  onAddNode?.(entry)
                }}
                className="flex w-full cursor-grab items-start gap-2 rounded-md border bg-background px-2.5 py-2 text-sm shadow-sm select-none hover:bg-muted active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded", colors.iconBg)}>
                  <Icon className={cn("h-3.5 w-3.5", colors.icon)} aria-hidden />
                </span>
                {/* Quebra só entre palavras: partir "Aguardar" em "Agu/ard/ar" (QA visual a 1024 px) era pior que a coluna mais larga. */}
                <span className="min-w-0 space-y-0.5">
                  <span className="block leading-tight font-medium">{entry.label}</span>
                  <span id={`palette-${entry.id}`} className="block text-xs leading-tight text-muted-foreground">
                    {entry.description}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
