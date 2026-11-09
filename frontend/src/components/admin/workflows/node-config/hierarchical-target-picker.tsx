"use client"

import { useId } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { resolveHumanReviewAncestors } from "../content-sources"
import { ESCALATION_ROLE_LABELS, type EscalationRole, type FlowGraph, type HierarchicalTarget } from "@/schemas/admin/workflow-graph.schema"
import { PersonPicker } from "./person-picker"

type HierarchicalTargetKind = "operator" | "previous" | "specific"

function hierarchicalTargetKindOf(target: HierarchicalTarget): HierarchicalTargetKind {
  if (target.type === "SPECIFIC_USER") return "specific"
  if (target.type === "ROLE_OF_PREVIOUS_REVIEWER") return "previous"
  return "operator"
}

/**
 * "Destino" — resolução hierárquica extensível (Parte 3/4/16/17 do pedido de Escalonamento):
 * cargo relativo ao OPERADOR, cargo relativo a QUEM DECIDIU uma revisão humana anterior nesta
 * mesma execução (só aparece quando existe pelo menos um node Human Review ancestral no grafo),
 * ou uma pessoa específica. Nunca pede cargo por combinação hardcoded — adicionar um cargo novo
 * (ex.: Coordenador) já aparece nas opções automaticamente. Reaproveitado pela Revisão Humana
 * (`reviewTarget`) e pela Action Escalonar (`target`) — mesma resolução, nunca duas
 * implementações (Parte 4/18 do pedido).
 */
export function HierarchicalTargetPicker({
  target,
  graph,
  fromNodeId,
  label = "Destino",
  onChange,
}: {
  target: HierarchicalTarget
  graph: FlowGraph
  fromNodeId: string
  label?: string
  onChange: (next: HierarchicalTarget) => void
}) {
  const kind = hierarchicalTargetKindOf(target)
  const fieldId = useId()
  const previousReviewers = resolveHumanReviewAncestors(graph, fromNodeId)
  const currentRole = target.type !== "SPECIFIC_USER" ? target.role : "SUPERVISOR"
  const currentPreviousNodeId = target.type === "ROLE_OF_PREVIOUS_REVIEWER" ? target.previousReviewNodeId : (previousReviewers[0]?.nodeId ?? "")

  function setKind(next: HierarchicalTargetKind) {
    if (next === "operator") onChange({ type: "ROLE_OF_OPERATOR", role: "SUPERVISOR" })
    else if (next === "specific") onChange({ type: "SPECIFIC_USER", userId: "" })
    else onChange({ type: "ROLE_OF_PREVIOUS_REVIEWER", role: "MANAGER", previousReviewNodeId: currentPreviousNodeId })
  }

  function setRole(role: EscalationRole) {
    if (kind === "previous") onChange({ type: "ROLE_OF_PREVIOUS_REVIEWER", role, previousReviewNodeId: currentPreviousNodeId })
    else onChange({ type: "ROLE_OF_OPERATOR", role })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-kind`}>{label}</Label>
        <Select value={kind} onValueChange={(value) => setKind(value as HierarchicalTargetKind)}>
          <SelectTrigger id={`${fieldId}-kind`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="operator">Cargo relativo ao operador</SelectItem>
            {previousReviewers.length > 0 ? <SelectItem value="previous">Cargo relativo a uma revisão anterior</SelectItem> : null}
            <SelectItem value="specific">Pessoa específica</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {kind === "specific" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-user`}>Pessoa</Label>
          <PersonPicker id={`${fieldId}-user`} value={target.type === "SPECIFIC_USER" ? target.userId : ""} onChange={(userId) => onChange({ type: "SPECIFIC_USER", userId })} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {kind === "previous" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-previous`}>Revisão anterior</Label>
              <Select
                value={currentPreviousNodeId}
                onValueChange={(previousReviewNodeId) => onChange({ type: "ROLE_OF_PREVIOUS_REVIEWER", role: currentRole, previousReviewNodeId })}
              >
                <SelectTrigger id={`${fieldId}-previous`} className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {previousReviewers.map((reviewer) => (
                    <SelectItem key={reviewer.nodeId} value={reviewer.nodeId}>
                      {reviewer.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-role`}>Cargo</Label>
            <Select value={currentRole} onValueChange={(role) => setRole(role as EscalationRole)}>
              <SelectTrigger id={`${fieldId}-role`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ESCALATION_ROLE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {kind === "operator"
          ? "Sobe a cadeia de gestão do OPERADOR (quem reporta pra quem) até achar o cargo escolhido."
          : kind === "previous"
            ? "Sobe a cadeia de gestão de QUEM DECIDIU a revisão anterior escolhida (não do operador) até achar o cargo."
            : "Notifica diretamente essa pessoa, sem navegar hierarquia nenhuma."}
      </p>
    </div>
  )
}
