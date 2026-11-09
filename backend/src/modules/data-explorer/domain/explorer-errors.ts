import { DomainError } from "../../../shared/domain/domain-error.js"

/**
 * Recusas da consulta de dados. As mensagens são fixas e nunca repetem o que o cliente enviou: um valor de filtro pode ser dado pessoal,
 * e um nome de coluna inventado não precisa voltar para ninguém.
 */
export const explorerErrors = {
  invalidRequest: () => new DomainError("A consulta não está no formato esperado.", "DATA_EXPLORER_INVALID_REQUEST", 400),
  datasetNotFound: () => new DomainError("Este conjunto de dados não existe ou não está liberado para consulta.", "DATA_EXPLORER_DATASET_NOT_FOUND", 404),
  columnNotAllowed: () => new DomainError("A consulta usa uma coluna que não está liberada neste conjunto de dados.", "DATA_EXPLORER_COLUMN_NOT_ALLOWED", 422),
  columnNotFilterable: () => new DomainError("Esta coluna não pode ser usada em filtros. Escolha outra coluna.", "DATA_EXPLORER_FILTER_NOT_ALLOWED", 422),
  operatorNotAllowed: () => new DomainError("Esta condição não vale para o tipo desta coluna.", "DATA_EXPLORER_OPERATOR_NOT_ALLOWED", 422),
  invalidValue: () => new DomainError("Um dos valores do filtro não é válido para o tipo da coluna.", "DATA_EXPLORER_INVALID_VALUE", 422),
  sortNotAllowed: () => new DomainError("Não é possível ordenar por esta coluna. Escolha uma das colunas marcadas como ordenáveis.", "DATA_EXPLORER_SORT_NOT_ALLOWED", 422),
  searchNotAvailable: () => new DomainError("Este conjunto de dados não tem campos de busca. Use os filtros.", "DATA_EXPLORER_SEARCH_NOT_AVAILABLE", 422),
  searchLength: (min: number, max: number) => new DomainError(`A busca precisa ter de ${min} a ${max} caracteres.`, "DATA_EXPLORER_SEARCH_LENGTH", 422),
  tooManyColumns: (max: number) => new DomainError(`Escolha no máximo ${max} colunas.`, "DATA_EXPLORER_TOO_MANY_COLUMNS", 422),
  noColumns: () => new DomainError("Escolha ao menos uma coluna.", "DATA_EXPLORER_NO_COLUMNS", 422),
  pageSize: (max: number) => new DomainError(`Cada página mostra no máximo ${max} registros.`, "DATA_EXPLORER_PAGE_SIZE_EXCEEDED", 422),
  filterLimit: (conditions: number, depth: number) => new DomainError(`Os filtros aceitam até ${conditions} condições e ${depth} níveis de grupo. Simplifique os filtros.`, "DATA_EXPLORER_FILTER_LIMIT", 422),
  listLimit: (max: number) => new DomainError(`Uma lista de valores aceita no máximo ${max} itens.`, "DATA_EXPLORER_LIST_LIMIT", 422),
  invalidCursor: () => new DomainError("A posição da página não vale mais para esta consulta. Volte para a primeira página.", "DATA_EXPLORER_INVALID_CURSOR", 400),
  queryTimeout: (timeoutMs: number) => new DomainError(`A consulta passou do limite de ${Math.round(timeoutMs / 1000)} segundos e foi interrompida. Restrinja os filtros, por exemplo com um período menor, e tente de novo.`, "DATA_EXPLORER_QUERY_TIMEOUT", 422),
  busy: () => new DomainError("Já há consultas em andamento no limite permitido. Aguarde terminarem e tente de novo.", "DATA_EXPLORER_BUSY", 429),
  exportBusy: () => new DomainError("Já há uma exportação em andamento. Aguarde terminar e tente de novo.", "DATA_EXPLORER_EXPORT_BUSY", 429),
  exportTooLarge: (maxRows: number) => new DomainError(`A exportação tem mais de ${maxRows.toLocaleString("pt-BR")} registros, o limite por arquivo. Restrinja os filtros e tente de novo.`, "DATA_EXPLORER_EXPORT_TOO_LARGE", 422),
  failed: () => new DomainError("Não foi possível executar a consulta. Tente de novo; se continuar, avise o administrador.", "DATA_EXPLORER_QUERY_FAILED", 500),

  cancelNotAvailable: () => new DomainError("Os registros deste conjunto não podem ser cancelados por aqui.", "DATA_CANCEL_NOT_AVAILABLE", 422),
  cancelScopeRequired: () => new DomainError("Escolha os registros ou aplique ao menos um filtro: um cancelamento nunca vale para o conjunto inteiro.", "DATA_CANCEL_SCOPE_REQUIRED", 422),
  cancelTooManyKeys: (max: number) => new DomainError(`Selecione no máximo ${max} registros de uma vez, ou use um filtro.`, "DATA_CANCEL_TOO_MANY_KEYS", 422),
  cancelTooMany: (max: number) => new DomainError(`O cancelamento alcança mais de ${max.toLocaleString("pt-BR")} registros, o limite por vez. Restrinja os filtros e faça por partes.`, "DATA_CANCEL_TOO_MANY", 422),
  cancelNothing: () => new DomainError("Nenhum registro ativo foi encontrado: eles podem já ter sido cancelados.", "DATA_CANCEL_NOTHING", 409),
  cancelScopeChanged: () => new DomainError("A quantidade de registros mudou desde a prévia. Confira de novo antes de confirmar.", "DATA_CANCEL_SCOPE_CHANGED", 409),
  cancelInFlight: (count: number) => new DomainError(`${count === 1 ? "Uma execução de Workflow em andamento usa" : `${count.toLocaleString("pt-BR")} execuções de Workflow em andamento usam`} estes registros. Aguarde terminar, ou decida a revisão em Pendências, antes de cancelar.`, "DATA_CANCEL_IN_FLIGHT", 409),
  /** Mesmo código para cancelar e reativar: ninguém decide se os próprios resultados valem. */
  cancelOwnRecords: (action: "cancelar" | "reativar" = "cancelar") => new DomainError(`Estes registros incluem os seus próprios resultados. Peça a outro administrador para ${action}.`, "DATA_CANCEL_OWN_RECORDS", 403),
  cancelLocked: () => new DomainError("Estes registros estão em uso por outra operação, como uma carga. Aguarde e tente de novo.", "DATA_CANCEL_LOCKED", 409),
  cancelRunInProgress: () => new DomainError("Há uma carga deste tipo de dado em andamento. Aguarde terminar para não misturar os dois.", "DATA_CANCEL_RUN_IN_PROGRESS", 409),
  cancelInvalidReason: () => new DomainError("Escreva o motivo, com 10 a 500 caracteres, sem caracteres invisíveis.", "DATA_CANCEL_INVALID_REASON", 422),
  cancelBusy: () => new DomainError("Já há um cancelamento em andamento nesta organização. Aguarde terminar e tente de novo.", "DATA_CANCEL_BUSY", 429),
  cancelTimeout: () => new DomainError("O cancelamento passou do limite de tempo e nada foi alterado. Restrinja os filtros e faça por partes.", "DATA_CANCEL_TIMEOUT", 422),
  cancelFailed: () => new DomainError("Não foi possível concluir e nada foi alterado. Tente de novo; se continuar, avise o administrador.", "DATA_CANCEL_FAILED", 500),
  cancellationNotFound: () => new DomainError("Este cancelamento não existe ou não está disponível.", "DATA_CANCELLATION_NOT_FOUND", 404),
  reactivationNothing: () => new DomainError("Não há mais registros cancelados neste lote. Uma carga pode já tê-los reativado.", "DATA_REACTIVATION_NOTHING", 409),
  reactivationBlocked: (problems: readonly { code: string; count: number }[]) => new DomainError("Estes registros não passam na regra atual do indicador. Corrija o indicador ou envie uma carga nova: nada foi reativado.", "DATA_REACTIVATION_BLOCKED", 409, { problems }),
}

/** Motivo interrompido de uma exportação já iniciada: vai para a auditoria, nunca para o conteúdo do arquivo. */
export type ExportInterruption = "BYTES_LIMIT" | "DURATION_LIMIT" | "CLIENT_DISCONNECTED" | "CLIENT_STALLED" | "QUERY_FAILED"

/** A exportação parou por um limite ou pelo cliente, não por falha do banco: atravessa a sessão com o motivo intacto. */
export class ExportInterrupted extends Error {
  constructor(readonly interruption: Exclude<ExportInterruption, "QUERY_FAILED">) {
    super(interruption)
    this.name = "ExportInterrupted"
  }
}
