import { z } from "zod"
import { findExplorerColumn } from "./explorer-catalog.js"
import { RECORD_STATUS_COLUMN } from "./explorer-datasets-imported.js"
import { OPERATORS_BY_TYPE, type ExplorerColumn, type ExplorerDataset, type ExplorerOperator } from "./explorer-catalog-types.js"
import { explorerErrors } from "./explorer-errors.js"
import type { ExplorerLimits } from "./explorer-limits.js"

/**
 * LEITURA DO PEDIDO: do JSON do navegador para uma consulta validada contra os metadados. Nada daqui chega ao SQL sem passar por esta validação
 * (`explorer-compiler.ts` só recebe o resultado). Campos desconhecidos são recusados (`organizationId`, `table`, `sql`…).
 */
export type ConditionValue = string | boolean

export type ExplorerCondition =
  | { type: "condition"; column: ExplorerColumn; operator: "IS_EMPTY" | "IS_NOT_EMPTY" }
  | { type: "condition"; column: ExplorerColumn; operator: "EQ" | "NEQ" | "GT" | "GTE" | "LT" | "LTE"; value: ConditionValue }
  | { type: "condition"; column: ExplorerColumn; operator: "IN"; values: string[] }
  | { type: "condition"; column: ExplorerColumn; operator: "BETWEEN"; from: string; to: string }

export type ExplorerFilterGroup = { type: "group"; logic: "AND" | "OR"; children: ExplorerFilterNode[] }
export type ExplorerFilterNode = ExplorerCondition | ExplorerFilterGroup

export type ExplorerQuery = {
  dataset: ExplorerDataset
  columns: ExplorerColumn[]
  filter: ExplorerFilterGroup | null
  conditionCount: number
  search: { term: string; columns: ExplorerColumn[] } | null
  sort: { column: ExplorerColumn; direction: "ASC" | "DESC" }
  /** Só em conjunto cancelável. Sem pedido, `ALL`: o registro cancelado continua à vista, marcado. */
  recordStatus: ExplorerRecordStatus
}

export const EXPLORER_RECORD_STATUSES = ["ALL", "ACTIVE", "CANCELLED"] as const
export type ExplorerRecordStatus = (typeof EXPLORER_RECORD_STATUSES)[number]

export const IDENTIFIER = /^[a-z][a-z0-9_]{0,62}$/

/** Forma do corpo, comum a consulta, contagem e exportação. `filter` é lido à parte, com profundidade controlada. */
export const explorerRequestSchema = z
  .object({
    dataset: z.string().regex(IDENTIFIER),
    columns: z.array(z.string().regex(IDENTIFIER)).max(200).optional(),
    filter: z.unknown().optional(),
    search: z.string().max(1_000).optional(),
    sort: z.object({ column: z.string().regex(IDENTIFIER), direction: z.enum(["ASC", "DESC"]) }).strict().optional(),
    pageSize: z.number().int().min(1).optional(),
    cursor: z.string().max(2_048).optional(),
    recordStatus: z.enum(EXPLORER_RECORD_STATUSES).optional(),
  })
  .strict()

export type ExplorerRequest = z.infer<typeof explorerRequestSchema>

export function parseExplorerRequest(raw: unknown): ExplorerRequest {
  const parsed = explorerRequestSchema.safeParse(raw)
  if (!parsed.success) throw explorerErrors.invalidRequest()
  return parsed.data
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
export const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
/** Dentro de `numeric` sem arredondar: valor fora disso é erro do pedido, nunca um estouro no banco. */
const NUMERIC = /^-?\d{1,18}(\.\d{1,10})?$/

function isCivilDate(value: string): boolean {
  const match = CIVIL_DATE.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < 1900 || year > 2200) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Valor conferido contra o tipo da coluna, sempre devolvido como texto para ir de parâmetro (booleano segue booleano). */
function parseScalar(column: ExplorerColumn, raw: unknown, limits: ExplorerLimits): ConditionValue {
  switch (column.type) {
    case "BOOLEAN":
      if (typeof raw !== "boolean") throw explorerErrors.invalidValue()
      return raw
    case "NUMBER": {
      const text = typeof raw === "number" && Number.isFinite(raw) ? String(raw) : raw
      if (typeof text !== "string" || !NUMERIC.test(text)) throw explorerErrors.invalidValue()
      return text
    }
    case "DATE":
    case "DATETIME":
      if (typeof raw !== "string" || !isCivilDate(raw)) throw explorerErrors.invalidValue()
      return raw
    case "TIME":
      if (typeof raw !== "string" || !TIME_OF_DAY.test(raw)) throw explorerErrors.invalidValue()
      return raw
    case "MONTH":
      if (typeof raw !== "string" || !MONTH.test(raw)) throw explorerErrors.invalidValue()
      return raw
    case "UUID":
      if (typeof raw !== "string" || !UUID.test(raw)) throw explorerErrors.invalidValue()
      return raw.toLowerCase()
    case "ENUM":
      if (typeof raw !== "string" || !column.options?.some((option) => option.value === raw)) throw explorerErrors.invalidValue()
      return raw
    case "TEXT":
      // eslint-disable-next-line no-control-regex -- o PostgreSQL recusa o byte nulo: a recusa fica clara aqui, antes de abrir a sessão
      if (typeof raw !== "string" || raw.length === 0 || raw.length > limits.maxValueLength || /\u0000/.test(raw)) throw explorerErrors.invalidValue()
      return raw
  }
}

const asText = (value: ConditionValue): string => {
  if (typeof value !== "string") throw explorerErrors.invalidValue()
  return value
}

function parseCondition(raw: Record<string, unknown>, dataset: ExplorerDataset, limits: ExplorerLimits): ExplorerCondition {
  if (!hasOnlyKeys(raw, ["type", "column", "operator", "value", "values"])) throw explorerErrors.invalidRequest()
  if (typeof raw.column !== "string" || !IDENTIFIER.test(raw.column)) throw explorerErrors.columnNotAllowed()
  const column = findExplorerColumn(dataset, raw.column)
  if (!column) throw explorerErrors.columnNotAllowed()
  if (!column.filterable) throw explorerErrors.columnNotFilterable()
  const operator = raw.operator as ExplorerOperator
  if (typeof raw.operator !== "string" || !OPERATORS_BY_TYPE[column.type].includes(operator)) throw explorerErrors.operatorNotAllowed()

  switch (operator) {
    case "IS_EMPTY":
    case "IS_NOT_EMPTY":
      if (raw.value !== undefined || raw.values !== undefined) throw explorerErrors.invalidRequest()
      return { type: "condition", column, operator }
    case "IN": {
      if (!Array.isArray(raw.values) || raw.values.length === 0) throw explorerErrors.invalidValue()
      if (raw.values.length > limits.maxListValues) throw explorerErrors.listLimit(limits.maxListValues)
      return { type: "condition", column, operator, values: raw.values.map((value) => asText(parseScalar(column, value, limits))) }
    }
    case "BETWEEN": {
      if (!Array.isArray(raw.values) || raw.values.length !== 2) throw explorerErrors.invalidValue()
      const from = asText(parseScalar(column, raw.values[0], limits))
      const to = asText(parseScalar(column, raw.values[1], limits))
      if (column.type === "NUMBER" ? Number(from) > Number(to) : from > to) throw explorerErrors.invalidValue()
      return { type: "condition", column, operator, from, to }
    }
    default:
      if (raw.value === undefined) throw explorerErrors.invalidValue()
      return { type: "condition", column, operator, value: parseScalar(column, raw.value, limits) }
  }
}

type FilterState = { conditions: number }

function parseNode(raw: unknown, depth: number, state: FilterState, dataset: ExplorerDataset, limits: ExplorerLimits): ExplorerFilterNode {
  if (!isPlainObject(raw)) throw explorerErrors.invalidRequest()
  if (raw.type === "condition") {
    state.conditions += 1
    if (state.conditions > limits.maxFilterConditions) throw explorerErrors.filterLimit(limits.maxFilterConditions, limits.maxFilterDepth)
    return parseCondition(raw, dataset, limits)
  }
  if (raw.type !== "group") throw explorerErrors.invalidRequest()
  // A recursão só desce até a profundidade permitida: corpo aninhado de propósito é recusado sem estourar a pilha.
  if (depth > limits.maxFilterDepth) throw explorerErrors.filterLimit(limits.maxFilterConditions, limits.maxFilterDepth)
  if (!hasOnlyKeys(raw, ["type", "logic", "children"])) throw explorerErrors.invalidRequest()
  if (raw.logic !== "AND" && raw.logic !== "OR") throw explorerErrors.invalidRequest()
  if (!Array.isArray(raw.children) || raw.children.length === 0) throw explorerErrors.invalidRequest()
  if (raw.children.length > limits.maxFilterConditions) throw explorerErrors.filterLimit(limits.maxFilterConditions, limits.maxFilterDepth)
  return { type: "group", logic: raw.logic, children: raw.children.map((child) => parseNode(child, depth + 1, state, dataset, limits)) }
}

export function resolveExplorerQuery(request: ExplorerRequest, dataset: ExplorerDataset, limits: ExplorerLimits): ExplorerQuery {
  const requestedColumns = request.columns ?? dataset.columns.filter((column) => !column.hiddenByDefault).map((column) => column.key)
  if (requestedColumns.length === 0) throw explorerErrors.noColumns()
  if (requestedColumns.length > limits.maxSelectedColumns) throw explorerErrors.tooManyColumns(limits.maxSelectedColumns)
  const columns = [...new Set(requestedColumns)].map((key) => {
    const column = findExplorerColumn(dataset, key)
    if (!column) throw explorerErrors.columnNotAllowed()
    return column
  })

  if (request.recordStatus !== undefined && !dataset.cancellation) throw explorerErrors.invalidRequest()
  const recordStatus = request.recordStatus ?? "ALL"
  // Com cancelados na resposta, a situação nunca fica de fora: um CSV sem ela misturaria o que vale com o que não vale, sem nada que os separe.
  if (dataset.cancellation && recordStatus !== "ACTIVE" && !columns.some((column) => column.key === RECORD_STATUS_COLUMN)) columns.push(findExplorerColumn(dataset, RECORD_STATUS_COLUMN)!)

  const state: FilterState = { conditions: 0 }
  let filter: ExplorerFilterGroup | null = null
  if (request.filter !== undefined && request.filter !== null) {
    const node = parseNode(request.filter, 1, state, dataset, limits)
    if (node.type !== "group") throw explorerErrors.invalidRequest()
    filter = node
  }

  const sortKey = request.sort?.column ?? dataset.defaultSort.column
  const sortColumn = findExplorerColumn(dataset, sortKey)
  if (!sortColumn) throw explorerErrors.columnNotAllowed()
  if (!sortColumn.sortable) throw explorerErrors.sortNotAllowed()

  let search: ExplorerQuery["search"] = null
  const term = request.search?.trim()
  if (term) {
    if (term.length < limits.minSearchLength || term.length > limits.maxSearchLength) throw explorerErrors.searchLength(limits.minSearchLength, limits.maxSearchLength)
    // eslint-disable-next-line no-control-regex -- mesmo motivo do filtro de texto
    if (/\u0000/.test(term)) throw explorerErrors.invalidValue()
    const searchable = dataset.columns.filter((column) => column.search !== undefined)
    if (searchable.length === 0) throw explorerErrors.searchNotAvailable()
    search = { term, columns: searchable }
  }

  return { dataset, columns, filter, conditionCount: state.conditions, search, sort: { column: sortColumn, direction: request.sort?.direction ?? dataset.defaultSort.direction }, recordStatus }
}

export function resolvePageSize(request: ExplorerRequest, limits: ExplorerLimits): number {
  const size = request.pageSize ?? limits.defaultPageSize
  if (size > limits.maxPageSize) throw explorerErrors.pageSize(limits.maxPageSize)
  return size
}

/** Colunas usadas nas condições, sem os valores: é o que a auditoria pode guardar. */
export function filterColumnsOf(node: ExplorerFilterGroup | null): string[] {
  if (!node) return []
  const found = new Set<string>()
  const visit = (current: ExplorerFilterNode) => {
    if (current.type === "condition") found.add(current.column.key)
    else current.children.forEach(visit)
  }
  visit(node)
  return [...found]
}
