/**
 * LIMITES DA CONSULTA DE DADOS: lugar único. Valores iniciais conservadores, documentados em docs/dev/central-de-dados-consulta.md.
 * O cliente nunca os remove: quem pede além do limite recebe recusa, não uma resposta maior. Os principais são ajustáveis no
 * `.env` (`DATA_EXPLORER_*`) dentro de um teto próprio em `config/env.ts`, que impede "sem limite".
 */
export type ExplorerLimits = {
  /** Registros por página quando o pedido não diz. */
  defaultPageSize: number
  /** Maior página aceita. Acima disso a consulta é recusada. */
  maxPageSize: number
  /** Colunas por consulta. */
  maxSelectedColumns: number
  /** Condições somadas em toda a árvore de filtros. */
  maxFilterConditions: number
  /** Profundidade da árvore: 1 = só o grupo principal; 3 = grupo dentro de grupo dentro do principal. */
  maxFilterDepth: number
  /** Itens em "está na lista". */
  maxListValues: number
  /** Caracteres de um valor de filtro. */
  maxValueLength: number
  minSearchLength: number
  maxSearchLength: number
  /** Tempo de uma consulta ou contagem no banco. */
  queryTimeoutMs: number
  /** Espera por uma trava de linha ou tabela. Leitura comum não trava; um `ALTER TABLE` em andamento, sim. */
  lockTimeoutMs: number
  /** Transação aberta sem comando (cliente lento na exportação cai aqui). */
  queryIdleTimeoutMs: number
  exportIdleTimeoutMs: number
  /** Memória de trabalho por operação de ordenação ou hash desta sessão. */
  workMemKb: number
  /** A contagem para aqui e responde "mais de N": nunca conta a tabela inteira. */
  countCap: number
  exportMaxRows: number
  exportMaxBytes: number
  /** Tempo total da exportação, inclusive esperando o navegador baixar. */
  exportMaxDurationMs: number
  /** Tempo de cada lote da exportação no banco. */
  exportFetchTimeoutMs: number
  exportFetchRows: number
  /** Consultas e contagens executando ao mesmo tempo, somando todas as APIs. */
  maxConcurrentPerAccount: number
  maxConcurrentPerOrganization: number
  maxConcurrentExportsPerAccount: number
  maxConcurrentExportsPerOrganization: number
  /** Registros por cancelamento. Acima disso é recusado, nunca feito em parte. */
  cancelMaxRows: number
  /** Registros marcados na tela por cancelamento. */
  cancelMaxKeys: number
  /** Tempo de cada comando ao cancelar ou reativar. */
  cancelTimeoutMs: number
  /** Espera por linha travada, por exemplo por uma carga. */
  cancelLockTimeoutMs: number
}

export type ExplorerEnvironment = {
  DATA_EXPLORER_DEFAULT_PAGE_SIZE: number
  DATA_EXPLORER_MAX_PAGE_SIZE: number
  DATA_EXPLORER_QUERY_TIMEOUT_MS: number
  DATA_EXPLORER_COUNT_CAP: number
  DATA_EXPLORER_EXPORT_MAX_ROWS: number
  DATA_EXPLORER_EXPORT_MAX_BYTES: number
  DATA_EXPLORER_EXPORT_MAX_DURATION_MS: number
  DATA_EXPLORER_CANCEL_MAX_ROWS: number
}

export function explorerLimitsFrom(values: ExplorerEnvironment): ExplorerLimits {
  return {
    defaultPageSize: Math.min(values.DATA_EXPLORER_DEFAULT_PAGE_SIZE, values.DATA_EXPLORER_MAX_PAGE_SIZE),
    maxPageSize: values.DATA_EXPLORER_MAX_PAGE_SIZE,
    maxSelectedColumns: 30,
    maxFilterConditions: 12,
    maxFilterDepth: 3,
    maxListValues: 50,
    maxValueLength: 200,
    minSearchLength: 2,
    maxSearchLength: 100,
    queryTimeoutMs: values.DATA_EXPLORER_QUERY_TIMEOUT_MS,
    lockTimeoutMs: 1_000,
    queryIdleTimeoutMs: 10_000,
    exportIdleTimeoutMs: 30_000,
    workMemKb: 16_384,
    countCap: values.DATA_EXPLORER_COUNT_CAP,
    exportMaxRows: values.DATA_EXPLORER_EXPORT_MAX_ROWS,
    exportMaxBytes: values.DATA_EXPLORER_EXPORT_MAX_BYTES,
    exportMaxDurationMs: values.DATA_EXPLORER_EXPORT_MAX_DURATION_MS,
    exportFetchTimeoutMs: 15_000,
    exportFetchRows: 500,
    maxConcurrentPerAccount: 2,
    maxConcurrentPerOrganization: 4,
    maxConcurrentExportsPerAccount: 1,
    maxConcurrentExportsPerOrganization: 2,
    cancelMaxRows: values.DATA_EXPLORER_CANCEL_MAX_ROWS,
    cancelMaxKeys: 100,
    cancelTimeoutMs: 30_000,
    cancelLockTimeoutMs: 5_000,
  }
}
