"use client"

import { useId } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { nodeBranches, type FlowGraph, type FlowNode } from "@/schemas/admin/workflow-graph.schema"

import { nodeDisplayName } from "../node-visuals"

const NO_CONNECTION = "__none__"

/**
 * Para onde cada saída desta etapa segue. É a alternativa a arrastar no canvas — para teclado e para quem não consegue
 * arrastar com precisão (WCAG 2.1.1 e 2.5.7) — e deixa claro o que falta ligar. Edita as mesmas ligações do canvas.
 */
export function NextStepFields({ node, graph, onConnectBranch }: { node: FlowNode; graph: FlowGraph; onConnectBranch: (branchId: string, targetId: string | null) => void }) {
  const fieldId = useId()
  const branches = nodeBranches(node)
  if (branches.length === 0) return null
  const targets = graph.nodes.filter((candidate) => candidate.id !== node.id && candidate.type !== "trigger")

  return (
    <section className="space-y-2 border-t pt-3" aria-label="Próximo passo" data-testid="next-step-fields">
      <p className="text-sm font-medium">Próximo passo</p>
      {branches.map((branch) => {
        const current = graph.edges.find((edge) => edge.source === node.id && edge.sourceHandle === branch.id)?.target
        const fieldKey = `${fieldId}-${branch.id}`
        return (
          <div key={branch.id} className="space-y-1">
            {branches.length > 1 ? <Label htmlFor={fieldKey}>{`Se "${branch.label}"`}</Label> : null}
            <Select value={current ?? NO_CONNECTION} onValueChange={(value) => onConnectBranch(branch.id, value === NO_CONNECTION ? null : value)}>
              <SelectTrigger id={fieldKey} className="w-full" aria-label={branches.length > 1 ? undefined : "Próximo passo"}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONNECTION}>Sem ligação</SelectItem>
                {targets.map((target) => (
                  <SelectItem key={target.id} value={target.id}>
                    {nodeDisplayName(target)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )
      })}
    </section>
  )
}
