"use client"

import { useEffect, useId } from "react"

import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

import {
  decodeSourcePath,
  encodeSourcePath,
  encodeStructuredFieldPath,
  encodeVariableSourcePath,
  decodeStructuredFieldPath,
  resolveContentSources,
  resolveReliableFeedbackSources,
  resolveStructuredFields,
} from "./content-sources"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { usePolicyResultCatalog } from "@/components/admin/workflows/use-policy-result-catalog"

const WHOLE_OBJECT_VALUE = "__whole__"
const VARIABLE_ORIGIN_PREFIX = "__var__"

/**
 * Seletor amigável de "de onde vem o conteúdo, e qual informação dele" — nunca mostra JSON path
 * nem pede o admin escrever nada (Parte 1 e 5 do pedido). Reaproveitado pelo Output ("Informação
 * a publicar") e pelo Human Review ("Conteúdo a revisar"), sempre em cima da MESMA infraestrutura
 * de schema já usada pela Condition (`resolveStructuredFields`/`flattenOutputSchema`).
 *
 * - Origem com Structured Output conhecido -> Select agrupado com "Resultado completo" +
 *   cada campo achatado ("Diagnóstico › Causa").
 * - Origem sem schema conhecido (CALL_AGENT, ou orquestrador sem output_schema) -> nenhum
 *   seletor de campo, cai automaticamente no resultado completo (nó só retorna algo simples —
 *   Parte 4 do pedido).
 * - `requireWholeObject` trava em "Resultado completo" com uma nota explicando o motivo — usado
 *   pelo Output quando Acompanhamento + Operador atual exige o objeto inteiro.
 * - `workflowId`, quando informado, soma "Variável: <nome>" às origens (Parte 26/27 do pedido de
 *   variáveis dinâmicas — Output e Human Review passam a poder publicar/revisar o valor atual de
 *   uma Workflow Variable, útil sobretudo pra convergência de branches). Uma variável já é um
 *   valor escalar — nunca tem etapa de "campo" depois.
 */
export function StructuredContentPicker({
  label,
  graph,
  fromNodeId,
  agentsById,
  orchestratorsById,
  path,
  onChange,
  requireWholeObject,
  requireWholeObjectReason,
  workflowId,
  sourceMode = "DEFAULT",
}: {
  label: string
  graph: FlowGraph
  fromNodeId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  path: string
  onChange: (path: string) => void
  requireWholeObject?: boolean
  requireWholeObjectReason?: string
  workflowId?: string
  /**
   * V1.5.12: WITH_FEEDBACK = soma os "Gerar feedback" anteriores às origens (Output/Revisão humana); FEEDBACK_ONLY = só
   * eles (feedback oficial no Acompanhamento do operador nunca sai do Agent/Orquestrador direto).
   */
  sourceMode?: "DEFAULT" | "WITH_FEEDBACK" | "FEEDBACK_ONLY"
}) {
  const reliableSources = sourceMode === "DEFAULT" ? [] : resolveReliableFeedbackSources(graph, fromNodeId)
  const sources = sourceMode === "FEEDBACK_ONLY" ? reliableSources : [...reliableSources, ...resolveContentSources(graph, fromNodeId, agentsById, orchestratorsById)]
  const variablesQuery = useWorkflowVariablesQuery(workflowId ?? "")
  // Uma variável é só um valor escalar — nunca satisfaz `requireWholeObject` (que pede o objeto
  // inteiro com formato de Feedback), então nem aparece como opção nesse caso.
  const variableOptions =
    workflowId && !requireWholeObject ? (variablesQuery.data ?? []).map((variable) => ({ value: `${VARIABLE_ORIGIN_PREFIX}${variable.id}`, label: `Variável: ${variable.name}` })) : []
  const decoded = decodeSourcePath(path)
  const nodeId = decoded?.kind === "node" ? decoded.nodeId : ""
  const variableId = decoded?.kind === "variable" ? decoded.variableId : ""
  const policies = usePolicyResultCatalog(graph)
  const structuredFields = nodeId ? resolveStructuredFields(graph, nodeId, orchestratorsById, policies) : undefined
  const currentFieldPath = decoded?.kind === "node" && decoded.field ? decodeStructuredFieldPath(decoded.field) : null

  useEffect(() => {
    if (sources.length === 1 && !nodeId && !variableId) onChange(encodeSourcePath(sources[0]!.nodeId, ""))
  }, [sources, nodeId, variableId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (requireWholeObject && nodeId && currentFieldPath) onChange(encodeSourcePath(nodeId, ""))
  }, [requireWholeObject, nodeId, currentFieldPath]) // eslint-disable-line react-hooks/exhaustive-deps

  function selectOrigin(next: string) {
    // Trocar a origem invalida o campo escolhido — nunca deixa um campo pensado pra origem
    // antiga "vazar" pra uma nova (mesmo princípio já aplicado em Condition).
    if (next.startsWith(VARIABLE_ORIGIN_PREFIX)) {
      onChange(encodeVariableSourcePath(next.slice(VARIABLE_ORIGIN_PREFIX.length)))
      return
    }
    onChange(encodeSourcePath(next, ""))
  }

  function selectField(value: string) {
    if (value === WHOLE_OBJECT_VALUE) {
      onChange(encodeSourcePath(nodeId, ""))
      return
    }
    onChange(encodeStructuredFieldPath(nodeId, value))
  }

  const originValue = variableId ? `${VARIABLE_ORIGIN_PREFIX}${variableId}` : nodeId
  const originLabel = variableId ? variableOptions.find((option) => option.value === originValue)?.label : sources.find((source) => source.nodeId === nodeId)?.label
  const fieldId = useId()

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={`${fieldId}-origin`}>{label}</Label>
        {sources.length === 0 && variableOptions.length === 0 ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            {sourceMode === "FEEDBACK_ONLY"
              ? "Feedback oficial para o Acompanhamento do operador passa pela camada de confiabilidade: conecte este nó depois de um \"Gerar feedback\"."
              : "Nenhum resultado disponível ainda — conecte este nó depois de um Agente, Orquestrador ou Avaliar política de acompanhamento."}
          </p>
        ) : (
          <Select value={originValue} onValueChange={selectOrigin}>
            <SelectTrigger id={`${fieldId}-origin`} className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((source) => (
                <SelectItem key={source.nodeId} value={source.nodeId}>
                  {source.label}
                </SelectItem>
              ))}
              {variableOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {variableId ? (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">Publicando o valor atual da variável.</p>
      ) : null}

      {nodeId && requireWholeObject ? (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          Publicando o resultado completo de {originLabel ?? "origem selecionada"}.{" "}
          {requireWholeObjectReason ?? "Esta combinação exige o resultado inteiro."}
        </p>
      ) : null}

      {nodeId && !requireWholeObject && structuredFields && structuredFields.length > 0 ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-field`}>Informação a publicar</Label>
          <Select value={currentFieldPath ?? WHOLE_OBJECT_VALUE} onValueChange={selectField}>
            <SelectTrigger id={`${fieldId}-field`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={WHOLE_OBJECT_VALUE}>Resultado completo</SelectItem>
              {structuredFields.map((field) => (
                <SelectItem key={field.path} value={field.path}>
                  {field.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {nodeId && !requireWholeObject && !structuredFields ? (
        <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
          Publicando o resultado completo de {originLabel ?? "origem selecionada"} — sem campos declarados pra escolher.
        </p>
      ) : null}
    </div>
  )
}
