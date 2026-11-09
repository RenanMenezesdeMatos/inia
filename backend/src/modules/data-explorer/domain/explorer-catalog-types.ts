import type { Permission } from "../../access/domain/permissions.js"

/**
 * METADADOS DA LISTA PERMITIDA. Só o que está declarado aqui pode ser consultado: nada é descoberto no banco (`information_schema`) e
 * nenhum identificador do navegador chega ao SQL. `sql` e `from` são trechos fixos do código; valores do cliente vão sempre como parâmetro.
 */
export const EXPLORER_COLUMN_TYPES = ["TEXT", "ENUM", "NUMBER", "DATE", "DATETIME", "TIME", "MONTH", "BOOLEAN", "UUID"] as const
export type ExplorerColumnType = (typeof EXPLORER_COLUMN_TYPES)[number]

export const EXPLORER_OPERATORS = ["EQ", "NEQ", "IN", "GT", "GTE", "LT", "LTE", "BETWEEN", "IS_EMPTY", "IS_NOT_EMPTY"] as const
export type ExplorerOperator = (typeof EXPLORER_OPERATORS)[number]

/** Operadores por tipo: a mesma tabela valida o pedido no servidor e monta a tela. */
export const OPERATORS_BY_TYPE: Readonly<Record<ExplorerColumnType, readonly ExplorerOperator[]>> = {
  TEXT: ["EQ", "NEQ", "IN", "IS_EMPTY", "IS_NOT_EMPTY"],
  ENUM: ["EQ", "NEQ", "IN", "IS_EMPTY", "IS_NOT_EMPTY"],
  NUMBER: ["EQ", "NEQ", "GT", "GTE", "LT", "LTE", "BETWEEN", "IN", "IS_EMPTY", "IS_NOT_EMPTY"],
  DATE: ["EQ", "GTE", "LTE", "BETWEEN", "IS_EMPTY", "IS_NOT_EMPTY"],
  DATETIME: ["EQ", "GTE", "LTE", "BETWEEN", "IS_EMPTY", "IS_NOT_EMPTY"],
  TIME: ["EQ", "GTE", "LTE", "BETWEEN", "IS_EMPTY", "IS_NOT_EMPTY"],
  MONTH: ["EQ", "IN", "GTE", "LTE", "BETWEEN", "IS_EMPTY", "IS_NOT_EMPTY"],
  BOOLEAN: ["EQ", "IS_EMPTY", "IS_NOT_EMPTY"],
  UUID: ["EQ", "IN", "IS_EMPTY", "IS_NOT_EMPTY"],
}

export type ExplorerSearchMode = "EXACT" | "CONTAINS"

export type ExplorerColumn = {
  /** Identificador público. Nunca é nome de tabela nem de coluna do banco repassado ao SQL. */
  key: string
  label: string
  description?: string
  type: ExplorerColumnType
  /** Expressão fixa. Usada em SELECT, WHERE e ORDER BY, então uma máscara vale também para filtros, busca, ordenação e CSV. */
  sql: string
  nullable: boolean
  /** Dado que identifica ou descreve uma pessoa: aparece na tela e entra na auditoria da consulta. */
  personal?: boolean
  filterable?: boolean
  sortable?: boolean
  search?: ExplorerSearchMode
  options?: readonly { value: string; label: string }[]
  /** Fora da seleção inicial de colunas. */
  hiddenByDefault?: boolean
  /** Teto de caracteres devolvidos (TEXT). Sem valor próprio, `DEFAULT_TEXT_MAX_CHARS`. */
  maxChars?: number
}

export type ExplorerDatasetOrigin = "IMPORTED" | "GENERATED"

/** Regra conferida ao reativar um lote: a mesma da carga para aquele tipo de registro, com o indicador como ele está agora. */
export type ExplorerReactivationRule = "MEASUREMENT" | "OFFICIAL_CLOSURE" | "GOAL" | "NONE"

/**
 * Conjunto em que um registro importado pode ser cancelado (fica no banco, sai da lógica). `table` é a tabela real, fixa no código. Só entra aqui o que a
 * carga consegue reativar e que não é decisão humana restrita nem histórico (ver docs/dev/central-de-dados-cancelamento-varredura.md).
 */
export type ExplorerCancellation = {
  table: string
  /** Contrato do feed que grava esta tabela: não se cancela com uma carga dele em andamento. */
  contractKey: string
  rule: ExplorerReactivationRule
  /** Workflow por Indicador guarda o id da medição e o lê durante a execução. */
  tracksExecutions: boolean
  /** Tipos de evidência que citam este registro em `source_id`: o id sozinho ou vários ids separados por vírgula. */
  evidenceSourceTypes: readonly string[]
  /** Condição fixa, sobre a linha `r`, que diz se o registro é da pessoa do parâmetro `$1`. Ninguém cancela os próprios resultados. */
  ownerSql: string
  /** A PRV vem fechada da origem: cancelar o fechamento de um indicador não a recalcula. */
  affectsOfficialResult: boolean
}

export type ExplorerDataset = {
  code: string
  label: string
  description: string
  origin: ExplorerDatasetOrigin
  /**
   * LARGE cresce sem teto natural (eventos, medições): ordenação só por coluna obrigatória com índice e busca só exata. SMALL é limitado pelo
   * tamanho da organização: pode ordenar e buscar sem índice, porque varrer alguns milhares de linhas é barato.
   */
  volume: "SMALL" | "LARGE"
  /** `<tabela> t` + junções N:1 fixas, sempre conferindo a organização. Sempre com o apelido `t` na tabela principal. */
  from: string
  /** Chave de desempate da paginação, única na tabela. */
  key: { sql: string; cast: "uuid" | "bigint" }
  defaultSort: { column: string; direction: "ASC" | "DESC" }
  /** Permissão adicional: uma área com permissão própria não se abre pela consulta (ex.: custo de IA exige `ai.view`). */
  requiresPermission?: Permission
  cancellation?: ExplorerCancellation
  columns: readonly ExplorerColumn[]
}

export const DEFAULT_TEXT_MAX_CHARS = 500

export const ORGANIZATION_COLUMN = "t.organization_id"
