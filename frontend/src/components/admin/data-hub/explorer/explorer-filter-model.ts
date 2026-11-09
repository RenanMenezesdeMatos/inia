import { formatCivilDate } from "@/lib/format/date"
import type { ExplorerColumn, ExplorerColumnType, ExplorerConditionRequest, ExplorerGroupRequest, ExplorerLimits, ExplorerOperator } from "@/schemas/admin/data-explorer.schema"

/**
 * Rascunho dos filtros na tela, separado do que foi aplicado: a consulta só vai ao servidor em "Aplicar". Lógica pura, sem React. Todo valor é texto enquanto
 * a pessoa digita; o servidor confere de novo cada tipo.
 */
export type DraftCondition = { kind: "condition"; id: string; column: string; operator: ExplorerOperator | ""; value: string; valueTo: string }
export type DraftGroup = { kind: "group"; id: string; logic: "AND" | "OR"; children: DraftNode[] }
export type DraftNode = DraftCondition | DraftGroup

let nextId = 0
const newId = () => `draft-${(nextId += 1)}`

export const emptyGroup = (logic: "AND" | "OR" = "AND"): DraftGroup => ({ kind: "group", id: newId(), logic, children: [] })
export const emptyCondition = (column = ""): DraftCondition => ({ kind: "condition", id: newId(), column, operator: "", value: "", valueTo: "" })

export const OPERATOR_LABELS: Record<ExplorerOperator, string> = {
  EQ: "é igual a",
  NEQ: "é diferente de",
  IN: "está na lista",
  GT: "é maior que",
  GTE: "é maior ou igual a",
  LT: "é menor que",
  LTE: "é menor ou igual a",
  BETWEEN: "está entre",
  IS_EMPTY: "está vazio",
  IS_NOT_EMPTY: "está preenchido",
}

const DATE_LIKE: readonly ExplorerColumnType[] = ["DATE", "DATETIME", "TIME", "MONTH"]

/** Em datas, "a partir de" e "até" dizem melhor o que o filtro faz: o dia informado entra. */
export function operatorLabel(operator: ExplorerOperator, type: ExplorerColumnType): string {
  if (DATE_LIKE.includes(type)) {
    if (operator === "GTE") return "a partir de"
    if (operator === "LTE") return "até"
    if (operator === "EQ") return "é em"
  }
  return OPERATOR_LABELS[operator]
}

export const COLUMN_TYPE_LABELS: Record<ExplorerColumnType, string> = {
  TEXT: "Texto",
  ENUM: "Lista fechada",
  NUMBER: "Número",
  DATE: "Data",
  DATETIME: "Data e hora",
  TIME: "Hora",
  MONTH: "Competência",
  BOOLEAN: "Sim ou não",
  UUID: "Identificador",
}

export function countConditions(node: DraftNode): number {
  return node.kind === "condition" ? 1 : node.children.reduce((total, child) => total + countConditions(child), 0)
}

export function updateNode(root: DraftGroup, id: string, change: (node: DraftNode) => DraftNode): DraftGroup {
  const visit = (node: DraftNode): DraftNode => {
    if (node.id === id) return change(node)
    return node.kind === "group" ? { ...node, children: node.children.map(visit) } : node
  }
  return visit(root) as DraftGroup
}

export function removeNode(root: DraftGroup, id: string): DraftGroup {
  const visit = (group: DraftGroup): DraftGroup => ({ ...group, children: group.children.filter((child) => child.id !== id).map((child) => (child.kind === "group" ? visit(child) : child)) })
  return visit(root)
}

export function addChild(root: DraftGroup, groupId: string, child: DraftNode): DraftGroup {
  return updateNode(root, groupId, (node) => (node.kind === "group" ? { ...node, children: [...node.children, child] } : node)) as DraftGroup
}

const isEmptiness = (operator: ExplorerOperator | "") => operator === "IS_EMPTY" || operator === "IS_NOT_EMPTY"

/** Lista digitada: um valor por linha, ou separados por ponto e vírgula. */
export function splitList(raw: string): string[] {
  return [...new Set(raw.split(/[\n;]/).map((item) => item.trim()).filter((item) => item.length > 0))]
}

function conditionProblem(condition: DraftCondition, columns: ReadonlyMap<string, ExplorerColumn>, limits: ExplorerLimits): string | null {
  const column = columns.get(condition.column)
  if (!column) return "Escolha a coluna de cada condição."
  if (condition.operator === "") return `Escolha a condição de "${column.label}".`
  if (isEmptiness(condition.operator)) return null
  if (condition.operator === "IN") {
    const items = splitList(condition.value)
    if (items.length === 0) return `Informe ao menos um valor na lista de "${column.label}".`
    if (items.length > limits.maxListValues) return `A lista de "${column.label}" aceita no máximo ${limits.maxListValues} valores.`
    return null
  }
  if (condition.value.trim() === "") return `Informe o valor de "${column.label}".`
  if (condition.operator === "BETWEEN") {
    if (condition.valueTo.trim() === "") return `Informe o fim do intervalo de "${column.label}".`
    const inverted = column.type === "NUMBER" ? Number(condition.value) > Number(condition.valueTo) : condition.value > condition.valueTo
    if (inverted) return `O início do intervalo de "${column.label}" vem depois do fim.`
  }
  return null
}

/** Primeiro problema do rascunho, para mostrar antes de gastar uma consulta. */
export function draftProblem(root: DraftGroup, columns: ReadonlyMap<string, ExplorerColumn>, limits: ExplorerLimits): string | null {
  const total = countConditions(root)
  if (total > limits.maxFilterConditions) return `Use no máximo ${limits.maxFilterConditions} condições.`
  const visit = (node: DraftNode): string | null => {
    if (node.kind === "condition") return conditionProblem(node, columns, limits)
    if (node.id !== root.id && node.children.length === 0) return "Há um grupo sem condições: complete ou remova."
    for (const child of node.children) {
      const problem = visit(child)
      if (problem) return problem
    }
    return null
  }
  return visit(root)
}

function conditionRequest(condition: DraftCondition, column: ExplorerColumn): ExplorerConditionRequest {
  const operator = condition.operator as ExplorerOperator
  if (isEmptiness(operator)) return { type: "condition", column: column.key, operator }
  if (operator === "IN") return { type: "condition", column: column.key, operator, values: splitList(condition.value) }
  if (operator === "BETWEEN") return { type: "condition", column: column.key, operator, values: [condition.value.trim(), condition.valueTo.trim()] }
  return { type: "condition", column: column.key, operator, value: column.type === "BOOLEAN" ? condition.value === "true" : condition.value.trim() }
}

/** Rascunho validado → filtro do pedido. Sem condições, nada vai no pedido. */
export function toFilterRequest(root: DraftGroup, columns: ReadonlyMap<string, ExplorerColumn>): ExplorerGroupRequest | undefined {
  const visit = (group: DraftGroup): ExplorerGroupRequest => ({
    type: "group",
    logic: group.logic,
    children: group.children.map((child) => (child.kind === "condition" ? conditionRequest(child, columns.get(child.column)!) : visit(child))),
  })
  return countConditions(root) === 0 ? undefined : visit(root)
}

const display = (column: ExplorerColumn | undefined, value: string | boolean | undefined): string => {
  if (value === undefined) return ""
  if (typeof value === "boolean") return value ? "sim" : "não"
  if (column?.type === "DATE" || column?.type === "DATETIME") return formatCivilDate(value)
  if (column?.type === "MONTH") return value.split("-").reverse().join("/")
  return column?.options?.find((option) => option.value === value)?.label ?? value
}

/** Texto das condições aplicadas, para a pessoa saber o que está valendo. */
export function describeFilter(filter: ExplorerGroupRequest | undefined, columns: ReadonlyMap<string, ExplorerColumn>): string[] {
  if (!filter) return []
  const describe = (node: ExplorerConditionRequest | ExplorerGroupRequest): string => {
    if (node.type === "group") {
      const parts = node.children.map(describe)
      return parts.length > 1 ? `(${parts.join(node.logic === "AND" ? " e " : " ou ")})` : (parts[0] ?? "")
    }
    const column = columns.get(node.column)
    const label = column?.label ?? node.column
    const operator = operatorLabel(node.operator, column?.type ?? "TEXT")
    if (node.operator === "IS_EMPTY" || node.operator === "IS_NOT_EMPTY") return `${label} ${operator}`
    if (node.operator === "BETWEEN") return `${label} ${operator} ${display(column, node.values?.[0])} e ${display(column, node.values?.[1])}`
    if (node.operator === "IN") return `${label} ${operator}: ${(node.values ?? []).map((value) => display(column, value)).join(", ")}`
    return `${label} ${operator} ${display(column, node.value)}`
  }
  if (filter.logic === "AND") return filter.children.map(describe)
  const whole = filter.children.map(describe)
  return whole.length > 1 ? [`Qualquer uma: ${whole.join(" ou ")}`] : whole
}
