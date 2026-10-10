"use client"

import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  COMPARATOR_LABELS,
  COMPARATORS_BY_FIELD_TYPE,
  type Comparator,
} from "@/schemas/admin/workflow-graph.schema"

/** Os 4 tipos que todo campo tipado do builder pode assumir — Structured Output field, Workflow
 * Variable e o valor de uma Action "Definir variável" compartilham exatamente este vocabulário,
 * pra nunca ter três sistemas de tipagem diferentes no frontend (ver COMPARATORS_BY_FIELD_TYPE). */
export type TypedFieldKind = "BOOLEAN" | "NUMBER" | "STRING" | "ARRAY"

const NO_VALUE_COMPARATORS: Comparator[] = ["IS_EMPTY", "NOT_EMPTY"]

/** Select de comparador restrito ao que o motor sabe avaliar para esse tipo — nunca mostra um
 * operador incompatível (ver COMPARATORS_BY_FIELD_TYPE, espelhado do backend). */
export function TypedComparatorSelect({
  kind,
  value,
  onChange,
  options: optionsOverride,
  labels: labelsOverride,
}: {
  kind: TypedFieldKind
  value: Comparator
  onChange: (comparator: Comparator) => void
  // Restringe ainda mais o conjunto padrão de COMPARATORS_BY_FIELD_TYPE[kind] — ex.: quartil é
  // STRING, mas só "é igual a"/"é diferente de" fazem sentido (nunca CONTAINS/STARTS_WITH).
  options?: Comparator[]
  // Rótulo específico do contexto ("Está em"/"Não está em" pra quartil) em vez do genérico
  // COMPARATOR_LABELS — só sobrescreve o que for passado, o resto usa o padrão.
  labels?: Partial<Record<Comparator, string>>
}) {
  const options = optionsOverride ?? COMPARATORS_BY_FIELD_TYPE[kind]
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Comparator)}>
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((comparator) => (
          <SelectItem key={comparator} value={comparator}>
            {labelsOverride?.[comparator] ?? COMPARATOR_LABELS[comparator]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export type TypedValue = boolean | number | string

/**
 * Input do valor, inteiramente guiado pelo tipo (e, pro tipo texto, por um enum opcional) — Sim/
 * Não pra booleano, numérico pra número, select de opções fixas ou texto livre pra string, texto
 * livre (o item buscado) pra array. Comparadores que não usam valor nenhum (IS_EMPTY/NOT_EMPTY)
 * não renderizam nada — pedir um valor ali só confundiria o admin.
 */
export function TypedValueInput({
  kind,
  comparator,
  enumValues,
  enumOptions,
  fieldType,
  value,
  onChange,
}: {
  kind: TypedFieldKind
  comparator: Comparator
  enumValues?: string[]
  /** Opções com rótulo amigável (Lista de opções do resultado estruturado) — o select mostra o
   * rótulo ("Alta") e grava o valor técnico ("ALTA"). Sem isso, `enumValues` cru. */
  enumOptions?: { value: string; label: string }[]
  /** Tipo declarado no resultado estruturado — um campo "Sim/Não" mostra Sim/Não (não
   * Verdadeiro/Falso, que continua sendo o vocabulário de variáveis e flags). */
  fieldType?: "STRING" | "NUMBER" | "BOOLEAN" | "ENUM" | "ARRAY"
  value: TypedValue | undefined
  onChange: (value: TypedValue) => void
}) {
  if (NO_VALUE_COMPARATORS.includes(comparator)) return null

  if (kind === "BOOLEAN") {
    const yesNo = fieldType === "BOOLEAN"
    return (
      <Select value={value === true ? "true" : "false"} onValueChange={(next) => onChange(next === "true")}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{yesNo ? "Sim" : "Verdadeiro"}</SelectItem>
          <SelectItem value="false">{yesNo ? "Não" : "Falso"}</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  if (kind === "NUMBER") {
    return (
      <Input
        type="number"
        value={typeof value === "number" ? value : ""}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    )
  }

  // STRING e ARRAY (o "item" comparado num CONTAINS/NOT_CONTAINS) compartilham o mesmo input —
  // texto livre, ou um select quando o campo declara um conjunto fixo de valores (enum).
  const options = enumOptions && enumOptions.length > 0 ? enumOptions : enumValues && enumValues.length > 0 ? enumValues.map((option) => ({ value: option, label: option })) : []
  if (options.length > 0) {
    return (
      <Select value={typeof value === "string" ? value : ""} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return <Input value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />
}

export const TYPED_FIELD_KIND_LABELS: Record<TypedFieldKind, string> = {
  BOOLEAN: "Verdadeiro/Falso",
  NUMBER: "Número",
  STRING: "Texto",
  ARRAY: "Lista",
}
