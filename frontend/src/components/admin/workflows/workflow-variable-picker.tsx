"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import { useCreateWorkflowVariableMutation, useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import { WORKFLOW_VARIABLE_TYPE_LABELS, type WorkflowVariable, type WorkflowVariableType } from "@/schemas/admin/workflow-variable.schema"

const CREATE_OPTION = "__create__"

/**
 * Select de Workflow Variables com criação inline ("+ Criar variável") — reaproveitado pela
 * Condition (origem "Variável do Workflow") e pela Action "Definir variável", pra nunca pedir ao
 * admin que saia do painel do nó pra cadastrar uma variável nova.
 */
export function WorkflowVariablePicker({
  workflowId,
  value,
  onChange,
  suggestedType,
}: {
  workflowId: string
  value: string
  onChange: (variable: WorkflowVariable) => void
  /** Tipo inferido da origem dinâmica que o admin acabou de escolher (Parte 11 do pedido de
   * variáveis dinâmicas — ex.: "Risco → Score" é NUMBER, sugere criar a variável já como
   * Número). Quando presente, o fluxo "+ Criar variável" abre com esse tipo pré-selecionado e
   * travado (nunca deixa criar com um tipo que já se sabe incompatível). Omitido = comportamento
   * de sempre (abre em Verdadeiro/Falso, editável). */
  suggestedType?: WorkflowVariableType
}) {
  const variablesQuery = useWorkflowVariablesQuery(workflowId)
  const createMutation = useCreateWorkflowVariableMutation(workflowId)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState<WorkflowVariableType>(suggestedType ?? "BOOLEAN")

  async function handleCreate() {
    const name = newName.trim()
    if (!name) return
    const variable = await createMutation.mutateAsync({ name, type: newType })
    setCreating(false)
    setNewName("")
    setNewType(suggestedType ?? "BOOLEAN")
    onChange(variable)
  }

  if (creating) {
    return (
      <div className="space-y-2 rounded-md border p-2">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Nome</Label>
          <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="ex.: URA baixa" autoFocus />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">Tipo</Label>
          <Select value={newType} onValueChange={(next) => setNewType(next as WorkflowVariableType)} disabled={Boolean(suggestedType)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(WORKFLOW_VARIABLE_TYPE_LABELS).map(([type, label]) => (
                <SelectItem key={type} value={type}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {suggestedType ? <p className="text-xs text-muted-foreground">Tipo sugerido pela origem escolhida.</p> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={!newName.trim() || createMutation.isPending} onClick={handleCreate}>
            {createMutation.isPending ? "Criando..." : "Criar"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next === CREATE_OPTION) {
          setCreating(true)
          return
        }
        const variable = variablesQuery.data?.find((candidate) => candidate.id === next)
        if (variable) onChange(variable)
      }}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Selecione uma variável" />
      </SelectTrigger>
      <SelectContent>
        {variablesQuery.data?.map((variable) => (
          <SelectItem key={variable.id} value={variable.id}>
            {variable.name} ({WORKFLOW_VARIABLE_TYPE_LABELS[variable.type]})
          </SelectItem>
        ))}
        <SelectItem value={CREATE_OPTION}>+ Criar variável</SelectItem>
      </SelectContent>
    </Select>
  )
}
