import { OPERATORS_BY_TYPE, type ExplorerColumn, type ExplorerDataset } from "./explorer-catalog-types.js"
import { GENERATED_DATASETS } from "./explorer-datasets-generated.js"
import { IMPORTED_DATASETS } from "./explorer-datasets-imported.js"

/** A lista permitida inteira. `Map` em vez de objeto: `__proto__` ou `constructor` vindos do cliente nunca resolvem para nada. */
export const EXPLORER_DATASETS: readonly ExplorerDataset[] = [...IMPORTED_DATASETS, ...GENERATED_DATASETS]

const DATASETS_BY_CODE = new Map(EXPLORER_DATASETS.map((dataset) => [dataset.code, dataset]))

export function findExplorerDataset(code: string): ExplorerDataset | undefined {
  return DATASETS_BY_CODE.get(code)
}

const COLUMNS_BY_DATASET = new Map(EXPLORER_DATASETS.map((dataset) => [dataset.code, new Map(dataset.columns.map((column) => [column.key, column]))]))

export function findExplorerColumn(dataset: ExplorerDataset, key: string): ExplorerColumn | undefined {
  return COLUMNS_BY_DATASET.get(dataset.code)?.get(key)
}

export const defaultExplorerColumns = (dataset: ExplorerDataset): string[] => dataset.columns.filter((column) => !column.hiddenByDefault).map((column) => column.key)

/** O que a tela recebe: rótulos, tipos e capacidades. Nunca `sql` nem `from`: nome de tabela e coluna do banco não saem do servidor. */
export function describeExplorerDataset(dataset: ExplorerDataset) {
  return {
    code: dataset.code,
    label: dataset.label,
    description: dataset.description,
    origin: dataset.origin,
    cancellable: dataset.cancellation !== undefined,
    defaultSort: dataset.defaultSort,
    columns: dataset.columns.map((column) => ({
      key: column.key,
      label: column.label,
      description: column.description ?? null,
      type: column.type,
      nullable: column.nullable,
      personal: column.personal === true,
      filterable: column.filterable === true,
      sortable: column.sortable === true,
      searchable: column.search !== undefined,
      operators: column.filterable ? OPERATORS_BY_TYPE[column.type].filter((operator) => column.nullable || (operator !== "IS_EMPTY" && operator !== "IS_NOT_EMPTY")) : [],
      options: column.options ?? null,
      defaultVisible: !column.hiddenByDefault,
    })),
  }
}

export const summarizeExplorerDataset = (dataset: ExplorerDataset) => ({ code: dataset.code, label: dataset.label, description: dataset.description, origin: dataset.origin })
