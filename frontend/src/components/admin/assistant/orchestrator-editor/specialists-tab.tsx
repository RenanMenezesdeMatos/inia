"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

import { AgentPicker } from "@/components/admin/workflows/agent-picker"
import type { Agent } from "@/schemas/admin/agent.schema"

import { AgentDetailCard, buildSpecialistsGraph, SpecialistsMap } from "./specialists-map"

/**
 * Aba "Especialistas": a lista que é a autorização explícita (à esquerda) e o mapa só de leitura do
 * que o orquestrador pode acionar (à direita). Seleção e detalhes vivem aqui — a aba só fica montada
 * enquanto está aberta, então o Del/Backspace de remover especialista nunca age com outra aba à vista.
 */
export function SpecialistsTab({
  name,
  orchestratorAgentId,
  specialistAgentIds,
  onSpecialistAgentIdsChange,
  agentsById,
  specialistAgents,
  disabledReason,
  incompatibleSelected,
  renderAgentVersion,
}: {
  name: string
  orchestratorAgentId: string
  specialistAgentIds: string[]
  onSpecialistAgentIdsChange: (next: string[]) => void
  agentsById: Map<string, Agent>
  specialistAgents: Agent[]
  disabledReason: (agent: Agent) => string | null
  incompatibleSelected: { agent: Agent; reason: string }[]
  /** Versão vigente do agente (com que ele roda neste orquestrador), "Não publicado" e "Agente inativo" — sob cada especialista. */
  renderAgentVersion?: (agentId: string) => ReactNode
}) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null)

  const { nodes, edges } = useMemo(
    () =>
      buildSpecialistsGraph(
        name,
        agentsById.get(orchestratorAgentId)?.name ?? "",
        specialistAgentIds.map((agentId) => {
          const agent = agentsById.get(agentId)
          return { agentName: agent?.name ?? "", agentType: agent?.agentType ?? null }
        }),
        selectedNodeId,
      ),
    [name, orchestratorAgentId, specialistAgentIds, agentsById, selectedNodeId],
  )

  const detailAgent = useMemo(() => {
    if (!detailNodeId) return null
    if (detailNodeId === "orchestrator") return agentsById.get(orchestratorAgentId) ?? null
    const index = Number(detailNodeId.replace("specialist-", ""))
    return agentsById.get(specialistAgentIds[index] ?? "") ?? null
  }, [detailNodeId, orchestratorAgentId, specialistAgentIds, agentsById])

  function updateSpecialist(index: number, agentId: string) {
    onSpecialistAgentIdsChange(specialistAgentIds.map((id, i) => (i === index ? agentId : id)))
  }

  function removeSpecialist(index: number) {
    onSpecialistAgentIdsChange(specialistAgentIds.filter((_, i) => i !== index))
    setSelectedNodeId(null)
    setDetailNodeId(null)
  }

  // Del/Backspace com um especialista selecionado no mapa remove ele do orquestrador — não é o
  // ReactFlow que gerencia isso (os nós são derivados do formulário a cada render, não do estado
  // interno dele), então isso escuta no document inteiro, e ignora quando o foco está num campo de
  // texto (senão um Backspace normal ao digitar apagaria o especialista selecionado). O orquestrador
  // nunca é removido por essa tecla — só pelo botão de excluir no topo, com a própria confirmação.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return
      if (!selectedNodeId?.startsWith("specialist-")) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      event.preventDefault()
      const index = Number(selectedNodeId.replace("specialist-", ""))
      onSpecialistAgentIdsChange(specialistAgentIds.filter((_, i) => i !== index))
      setSelectedNodeId(null)
      setDetailNodeId(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedNodeId, specialistAgentIds, onSpecialistAgentIdsChange])

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle>Especialistas</CardTitle>
              <CardDescription>Agents que este orquestrador pode acionar — só os compatíveis com o grupo e com a política de roteamento.</CardDescription>
            </div>
            <Button variant="outline" size="sm" className="shrink-0" onClick={() => onSpecialistAgentIdsChange([...specialistAgentIds, ""])}>
              <Plus className="h-3.5 w-3.5" /> Adicionar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {specialistAgentIds.length === 0 ? <p className="py-2 text-sm text-muted-foreground">Nenhum especialista ainda — o orquestrador responde sozinho, sem tools.</p> : null}
          {specialistAgentIds.map((agentId, index) => (
            <div key={index} className="flex items-start gap-2 rounded-md border p-2">
              <div className="min-w-0 flex-1 space-y-1.5">
                <AgentPicker agents={specialistAgents} value={agentId} onChange={(value) => updateSpecialist(index, value)} disabledReason={disabledReason} />
                {agentId && renderAgentVersion ? renderAgentVersion(agentId) : null}
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" aria-label="Remover especialista" onClick={() => removeSpecialist(index)}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          {incompatibleSelected.length > 0 ? (
            <p className="text-xs text-destructive" role="alert">
              {incompatibleSelected.map(({ agent, reason }) => `${agent.name}: ${reason}`).join(" ")}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="min-w-0 space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>Mapa</CardTitle>
            <CardDescription>Clique duas vezes num agente para ver objetivo, descrição, prompt e bases consultadas.</CardDescription>
          </CardHeader>
          <CardContent>
            <SpecialistsMap nodes={nodes} edges={edges} onSelect={setSelectedNodeId} onOpenDetails={setDetailNodeId} />
          </CardContent>
        </Card>
        {detailAgent ? <AgentDetailCard agent={detailAgent} onClose={() => setDetailNodeId(null)} /> : null}
      </div>
    </div>
  )
}
