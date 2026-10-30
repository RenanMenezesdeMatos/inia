"use client"

import { useId } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { decodeSourcePath, decodeStructuredFieldPath, encodeSourcePath, encodeStructuredFieldPath, encodeVariableSourcePath, mapOutputFieldTypeToVariableType, resolveDynamicValueSources, resolveStructuredFields } from "../content-sources"
import { TypedValueInput, type TypedFieldKind } from "../typed-value-field"
import { WorkflowVariablePicker } from "../workflow-variable-picker"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { WorkflowVariable, WorkflowVariableType } from "@/schemas/admin/workflow-variable.schema"
import type { ActionConfig, FlowGraph, FlowNode } from "@/schemas/admin/workflow-graph.schema"
import { usePolicyResultCatalog } from "@/components/admin/workflows/use-policy-result-catalog"

/** As 3 fontes de valor dinâmico oferecidas hoje pra "Definir variável" (Parte 6 do pedido de
 * variáveis dinâmicas) — deliberadamente sem expression language: sempre uma referência a algo
 * que já existe no Execution Context, nunca uma fórmula. */
type DynamicFonteKind = "trigger" | "node" | "variable"

function dynamicFonteKindOf(sourcePath: string): DynamicFonteKind | "" {
  const decoded = decodeSourcePath(sourcePath)
  if (decoded?.kind === "variable") return "variable"
  if (decoded?.kind === "node") return decoded.nodeId === "trigger" ? "trigger" : "node"
  return ""
}

/**
 * Seletor de origem dinâmica pra "Definir variável" — "Fonte" (Gatilho/Nó anterior/Variável) e,
 * conforme a fonte, um segundo Select específico. Reaproveita EXATAMENTE o mesmo resolvedor de
 * Structured Output da Condition/Output/Human Review (`resolveDynamicValueSources`,
 * `resolveStructuredFields`, `encodeStructuredFieldPath`) — nunca um quarto sistema (Parte 9).
 * O Select de campo/variável só mostra opções COMPATÍVEIS com o tipo declarado da variável
 * (Parte 10 — impede, não só alerta); a própria variável sendo editada nunca aparece como opção
 * de "outra variável" (evita autoreferência trivial na UI — ciclos indiretos são pegos no
 * publish, Parte 12).
 */
function DynamicVariableSourceForm({
  sourcePath,
  variableType,
  currentVariableId,
  graph,
  fromNodeId,
  workflowId,
  agentsById,
  orchestratorsById,
  onChange,
}: {
  sourcePath: string
  variableType: WorkflowVariableType
  currentVariableId: string
  graph: FlowGraph
  fromNodeId: string
  workflowId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  onChange: (nextSourcePath: string) => void
}) {
  const variablesQuery = useWorkflowVariablesQuery(workflowId)
  const dynamicSources = resolveDynamicValueSources(graph, fromNodeId, agentsById, orchestratorsById)
  const nodeOptions = dynamicSources.filter((source) => source.nodeId !== "trigger")

  const decoded = decodeSourcePath(sourcePath)
  const nodeId = decoded?.kind === "node" && decoded.nodeId !== "trigger" ? decoded.nodeId : ""
  const variableId = decoded?.kind === "variable" ? decoded.variableId : ""
  const fonte = dynamicFonteKindOf(sourcePath)

  const policies = usePolicyResultCatalog(graph)
  const structuredFields = nodeId ? resolveStructuredFields(graph, nodeId, orchestratorsById, policies) : undefined
  const compatibleFields = structuredFields?.filter((field) => mapOutputFieldTypeToVariableType(field.type) === variableType)
  const currentFieldPath = decoded?.kind === "node" && decoded.field ? decodeStructuredFieldPath(decoded.field) : null
  const compatibleVariables = (variablesQuery.data ?? []).filter((candidate) => candidate.type === variableType && candidate.id !== currentVariableId)
  const fieldId = useId()

  function selectFonte(next: DynamicFonteKind) {
    if (next === "trigger") onChange(encodeSourcePath("trigger", ""))
    else onChange("") // "nó anterior"/"variável" — espera a próxima escolha, evita origem incompleta
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-fonte`}>Fonte</Label>
        <Select value={fonte || undefined} onValueChange={(value) => selectFonte(value as DynamicFonteKind)}>
          <SelectTrigger id={`${fieldId}-fonte`} className="w-full">
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="trigger">Valor do gatilho</SelectItem>
            <SelectItem value="node">Resultado de um nó anterior</SelectItem>
            <SelectItem value="variable">Outra variável do Workflow</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {fonte === "trigger" ? (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Vai usar o valor bruto recebido pelo gatilho deste Workflow.</p>
      ) : null}

      {fonte === "node" ? (
        <div className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-node`}>Resultado de</Label>
            {nodeOptions.length === 0 ? (
              <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
                Nenhum resultado disponível ainda — conecte este nó depois de um Agente, Orquestrador ou Avaliar política de acompanhamento.
              </p>
            ) : (
              <Select value={nodeId} onValueChange={(next) => onChange(encodeSourcePath(next, ""))}>
                <SelectTrigger id={`${fieldId}-node`} className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {nodeOptions.map((source) => (
                    <SelectItem key={source.nodeId} value={source.nodeId}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {nodeId && structuredFields ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${fieldId}-field`}>Informação</Label>
              <Select value={currentFieldPath ?? undefined} onValueChange={(fieldPath) => onChange(encodeStructuredFieldPath(nodeId, fieldPath))}>
                <SelectTrigger id={`${fieldId}-field`} className="w-full">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {(compatibleFields ?? []).map((field) => (
                    <SelectItem key={field.path} value={field.path}>
                      {field.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {compatibleFields && compatibleFields.length === 0 ? (
                <p className="text-xs text-destructive">Nenhuma informação deste resultado é compatível com o tipo da variável.</p>
              ) : null}
            </div>
          ) : null}
          {nodeId && !structuredFields ? (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Sem campos declarados — vai usar o resultado completo.</p>
          ) : null}
        </div>
      ) : null}

      {fonte === "variable" ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-variable`}>Variável</Label>
          {compatibleVariables.length === 0 ? (
            <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Nenhuma outra variável do mesmo tipo disponível ainda.</p>
          ) : (
            <Select value={variableId} onValueChange={(next) => onChange(encodeVariableSourcePath(next))}>
              <SelectTrigger id={`${fieldId}-variable`} className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {compatibleVariables.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      ) : null}
    </div>
  )
}

export function SetVariableForm({
  config,
  graph,
  fromNodeId,
  workflowId,
  agentsById,
  orchestratorsById,
  onChange,
}: {
  config: Extract<ActionConfig, { actionType: "SET_VARIABLE" }>
  graph: FlowGraph
  fromNodeId: string
  workflowId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  onChange: (next: Extract<FlowNode, { type: "action" }>["config"]) => void
}) {
  const variablesQuery = useWorkflowVariablesQuery(workflowId)
  const variable = variablesQuery.data?.find((candidate) => candidate.id === config.variableId)
  const fieldType: TypedFieldKind | undefined = variable
    ? variable.type === "NUMERIC"
      ? "NUMBER"
      : variable.type === "TEXT"
        ? "STRING"
        : "BOOLEAN"
    : undefined
  // `sourcePath !== undefined` (não `Boolean(sourcePath)`) — sourcePath vazio é o estado
  // transitório "acabou de trocar pra Dinâmico, ainda não escolheu a Fonte" e PRECISA continuar
  // contando como dinâmico, senão o Select "Origem do valor" volta sozinho pra Fixo assim que o
  // admin troca de modo (bug encontrado testando no navegador).
  const isDynamic = config.sourcePath !== undefined
  const fieldId = useId()

  function selectVariable(next: WorkflowVariable) {
    // Trocar de variável invalida a origem/valor anteriores — o tipo pode não bater mais com o
    // que estava escolhido (mesmo princípio já usado em Condition ao trocar de origem).
    if (isDynamic) onChange({ actionType: "SET_VARIABLE", variableId: next.id, sourcePath: "" })
    else onChange({ actionType: "SET_VARIABLE", variableId: next.id, value: next.type === "BOOLEAN" ? true : next.type === "NUMERIC" ? 0 : "" })
  }

  function setOrigin(mode: "fixed" | "dynamic") {
    if (!variable) return
    if (mode === "fixed") onChange({ actionType: "SET_VARIABLE", variableId: variable.id, value: variable.type === "NUMERIC" ? 0 : variable.type === "TEXT" ? "" : true })
    else onChange({ actionType: "SET_VARIABLE", variableId: variable.id, sourcePath: "" })
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-variable`}>Variável</Label>
        <WorkflowVariablePicker id={`${fieldId}-variable`} workflowId={workflowId} value={config.variableId} onChange={selectVariable} />
      </div>

      {variable ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-origin`}>Origem do valor</Label>
          <Select value={isDynamic ? "dynamic" : "fixed"} onValueChange={(value) => setOrigin(value as "fixed" | "dynamic")}>
            <SelectTrigger id={`${fieldId}-origin`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Valor fixo</SelectItem>
              <SelectItem value="dynamic">Valor dinâmico</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {variable && !isDynamic && fieldType ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-value`}>Valor</Label>
          <TypedValueInput id={`${fieldId}-value`} kind={fieldType} comparator="EQUALS" value={config.value} onChange={(value) => onChange({ ...config, value })} />
        </div>
      ) : null}

      {variable && isDynamic ? (
        <DynamicVariableSourceForm
          sourcePath={config.sourcePath ?? ""}
          variableType={variable.type}
          currentVariableId={variable.id}
          graph={graph}
          fromNodeId={fromNodeId}
          workflowId={workflowId}
          agentsById={agentsById}
          orchestratorsById={orchestratorsById}
          onChange={(next) => onChange({ ...config, sourcePath: next })}
        />
      ) : null}
    </div>
  )
}
