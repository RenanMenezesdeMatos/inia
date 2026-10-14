"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { decodeSourcePath, decodeStructuredFieldPath, encodeSourcePath, encodeStructuredFieldPath, encodeVariableSourcePath, resolveContentSources, resolveStructuredFields } from "../content-sources"
import { TypedComparatorSelect, TypedValueInput, type TypedFieldKind } from "../typed-value-field"
import { WorkflowVariablePicker } from "../workflow-variable-picker"
import { useWorkflowVariablesQuery } from "@/queries/admin/use-workflow-variable-queries"
import type { Agent } from "@/schemas/admin/agent.schema"
import type { Orchestrator } from "@/schemas/admin/assistant.schema"
import type { FlatOutputSchemaField } from "@/schemas/admin/output-schema-fields"
import type { WorkflowVariable } from "@/schemas/admin/workflow-variable.schema"
import { COMPARATOR_LABELS, COMPARATORS_BY_FIELD_TYPE, type Comparator, type ConditionRule, type FlowGraph } from "@/schemas/admin/workflow-graph.schema"
import { applyTypedValue, currentTypedValue } from "./typed-threshold"
import { usePolicyResultCatalog } from "@/components/admin/workflows/use-policy-result-catalog"

/** Origem "Resultado de um nó anterior" ao selecionar um Field: EQUALS falha pra tipos que não o
 * suportam (nunca deveria acontecer, já que sempre pegamos o primeiro comparador válido), então
 * este helper existe só pra deixar isso explícito no call site. */
function firstComparatorFor(fieldType: TypedFieldKind): Comparator {
  return COMPARATORS_BY_FIELD_TYPE[fieldType][0]!
}

/**
 * Quando a origem escolhida tem `output_schema` conhecido (ver resolveStructuredFields), o
 * "Campo" técnico vira um Select agrupado ("Diagnóstico › Severidade") e o resto da UI é
 * inteiramente guiada pelo tipo declarado — nunca mais um path/valor digitado à mão.
 */
function StructuredFieldConditionForm({
  rule,
  nodeId,
  fields,
  onChange,
}: {
  rule: ConditionRule
  nodeId: string
  fields: FlatOutputSchemaField[]
  onChange: (next: ConditionRule) => void
}) {
  const decoded = decodeSourcePath(rule.sourcePath ?? "")
  const currentFieldPath = decoded?.kind === "node" && decoded.nodeId === nodeId ? decodeStructuredFieldPath(decoded.field) : null
  const selectedField = fields.find((field) => field.path === currentFieldPath)

  function selectField(fieldPath: string) {
    const field = fields.find((candidate) => candidate.path === fieldPath)
    if (!field) return
    onChange({
      comparator: firstComparatorFor(field.type),
      thresholdBoolean: null,
      thresholdNumeric: null,
      thresholdText: undefined,
      sourcePath: encodeStructuredFieldPath(nodeId, field.path),
    })
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label>Campo</Label>
        <Select value={selectedField?.path ?? ""} onValueChange={selectField}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione o campo" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((field) => (
              <SelectItem key={field.path} value={field.path}>
                {field.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {selectedField ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Operador</Label>
            <TypedComparatorSelect kind={selectedField.type} value={rule.comparator} onChange={(comparator) => onChange({ ...rule, comparator })} />
          </div>
          <div className="space-y-1.5">
            <Label>Valor</Label>
            <TypedValueInput
              kind={selectedField.type}
              comparator={rule.comparator}
              enumValues={selectedField.enumValues}
              enumOptions={selectedField.enumOptions}
              fieldType={selectedField.fieldType}
              value={currentTypedValue(rule)}
              onChange={(value) => onChange(applyTypedValue(rule, selectedField.type, value))}
            />
          </div>
        </div>
      ) : null}
    </>
  )
}

/** Fallback legado — path/valor livres, sem schema conhecido pra guiar a UI. Preserva 100% do
 * comportamento (e da persistência) de toda Condition publicada antes deste conceito existir. */
function LegacyNodeResultConditionForm({ rule, onChange }: { rule: ConditionRule; onChange: (next: ConditionRule) => void }) {
  function setValueFromText(text: string) {
    if (text === "true" || text === "false") {
      onChange({ ...rule, comparator: "EQUALS", thresholdBoolean: text === "true", thresholdNumeric: null, thresholdText: undefined })
      return
    }
    const numeric = Number(text)
    if (text.trim() !== "" && !Number.isNaN(numeric)) {
      onChange({ ...rule, thresholdNumeric: numeric, thresholdBoolean: null, thresholdText: undefined })
      return
    }
    onChange({ ...rule, comparator: "EQUALS", thresholdText: text, thresholdBoolean: null, thresholdNumeric: null })
  }

  const currentValueText =
    rule.thresholdBoolean !== undefined && rule.thresholdBoolean !== null
      ? String(rule.thresholdBoolean)
      : (rule.thresholdText ?? (rule.thresholdNumeric !== undefined && rule.thresholdNumeric !== null ? String(rule.thresholdNumeric) : ""))

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">Campo (opcional)</Label>
      <Input
        value={decodeSourcePath(rule.sourcePath ?? "")?.kind === "node" ? (decodeSourcePath(rule.sourcePath ?? "") as { field: string }).field : ""}
        onChange={(event) => {
          const decoded = decodeSourcePath(rule.sourcePath ?? "")
          const nodeId = decoded?.kind === "node" ? decoded.nodeId : ""
          onChange({ ...rule, sourcePath: encodeSourcePath(nodeId, event.target.value) })
        }}
        placeholder="ex.: feedback.text"
      />
      <div className="grid grid-cols-2 gap-2 pt-1.5">
        <div className="space-y-1.5">
          <Label>Operador</Label>
          <Select value={rule.comparator} onValueChange={(comparator) => onChange({ ...rule, comparator: comparator as Comparator })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(COMPARATOR_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Valor</Label>
          <Input value={currentValueText} onChange={(event) => setValueFromText(event.target.value)} placeholder="ex.: true, CRITICAL, 3" />
        </div>
      </div>
    </div>
  )
}

/** Origem "Resultado de um nó anterior" — escolhe o node de origem e delega o resto (campo/
 * operador/valor) pra `StructuredFieldConditionForm`/`LegacyNodeResultConditionForm`, que
 * operam em cima de um `ConditionRule` puro — por isso também são reaproveitáveis por cada
 * regra de um `ConditionGroup` (Parte 3), sem duplicar a lógica de seleção de campo. */
export function NodeResultConditionForm({
  rule,
  graph,
  fromNodeId,
  agentsById,
  orchestratorsById,
  onChange,
}: {
  rule: ConditionRule
  graph: FlowGraph
  fromNodeId: string
  agentsById: Map<string, Agent>
  orchestratorsById: Map<string, Orchestrator>
  onChange: (next: ConditionRule) => void
}) {
  const contentSources = resolveContentSources(graph, fromNodeId, agentsById, orchestratorsById)
  const decoded = decodeSourcePath(rule.sourcePath ?? "")
  const nodeId = decoded?.kind === "node" ? decoded.nodeId : ""
  const policies = usePolicyResultCatalog(graph)
  const structuredFields = nodeId ? resolveStructuredFields(graph, nodeId, orchestratorsById, policies) : undefined

  function selectOrigin(nextNodeId: string) {
    // Trocar a origem invalida completamente campo/comparador/valor anteriores — nunca deixa um
    // comparador/valor pensado pro tipo do campo antigo "vazar" pro novo (Part 5 do pedido).
    onChange({ comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, thresholdText: undefined, sourcePath: encodeSourcePath(nextNodeId, "") })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Origem</Label>
        {contentSources.length === 0 ? (
          <p className="rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Nenhum resultado disponível ainda — conecte este nó depois de um Agente, Orquestrador ou Avaliar política de acompanhamento.
          </p>
        ) : (
          <Select value={nodeId} onValueChange={selectOrigin}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {contentSources.map((source) => (
                <SelectItem key={source.nodeId} value={source.nodeId}>
                  {source.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {nodeId && structuredFields ? (
        <StructuredFieldConditionForm rule={rule} nodeId={nodeId} fields={structuredFields} onChange={onChange} />
      ) : nodeId ? (
        <LegacyNodeResultConditionForm rule={rule} onChange={onChange} />
      ) : null}
    </div>
  )
}

/** Origem "Variável do Workflow" — mesma UI tipada da Structured Output, só que contra a
 * definição de uma Workflow Variable (workflow_variables) em vez de um campo declarado num
 * orquestrador. Também opera em cima de um `ConditionRule` puro (ver NodeResultConditionForm). */
export function WorkflowVariableConditionForm({
  rule,
  workflowId,
  onChange,
}: {
  rule: ConditionRule
  workflowId: string
  onChange: (next: ConditionRule) => void
}) {
  const variablesQuery = useWorkflowVariablesQuery(workflowId)
  const decoded = decodeSourcePath(rule.sourcePath ?? "")
  const variableId = decoded?.kind === "variable" ? decoded.variableId : ""
  const variable = variablesQuery.data?.find((candidate) => candidate.id === variableId)
  const fieldType: TypedFieldKind | undefined = variable ? (variable.type === "NUMERIC" ? "NUMBER" : variable.type === "TEXT" ? "STRING" : "BOOLEAN") : undefined

  function selectVariable(next: WorkflowVariable) {
    const nextType: TypedFieldKind = next.type === "NUMERIC" ? "NUMBER" : next.type === "TEXT" ? "STRING" : "BOOLEAN"
    onChange({
      comparator: firstComparatorFor(nextType),
      thresholdBoolean: null,
      thresholdNumeric: null,
      thresholdText: undefined,
      sourcePath: encodeVariableSourcePath(next.id),
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Variável</Label>
        <WorkflowVariablePicker workflowId={workflowId} value={variableId} onChange={selectVariable} />
      </div>
      {variable && fieldType ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label>Operador</Label>
            <TypedComparatorSelect kind={fieldType} value={rule.comparator} onChange={(comparator) => onChange({ ...rule, comparator })} />
          </div>
          <div className="space-y-1.5">
            <Label>Valor</Label>
            <TypedValueInput
              kind={fieldType}
              comparator={rule.comparator}
              value={currentTypedValue(rule)}
              onChange={(value) => onChange(applyTypedValue(rule, fieldType, value))}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}
