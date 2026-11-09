import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * AUDITORIA DA CONSULTA (`audit_logs`, lida na aba Registro). Guarda quem, o escopo, o conjunto, a operação, a duração, a quantidade e o resultado;
 * das condições, só as COLUNAS. Valor de filtro, termo de busca, conteúdo de linha, identificador inventado e `x-request-id` nunca entram: vêm do cliente e podem ser dado
 * pessoal.
 */
export type ExplorerAuditAction = "DATA_HUB_EXPLORER_QUERY" | "DATA_HUB_EXPLORER_COUNT" | "DATA_HUB_EXPLORER_EXPORT_STARTED" | "DATA_HUB_EXPLORER_EXPORT_FINISHED" | "DATA_HUB_EXPLORER_DENIED" | "DATA_HUB_RECORDS_CANCEL_PREVIEW" | "DATA_HUB_RECORDS_CANCEL_LIST" | "DATA_HUB_RECORDS_CANCELLED" | "DATA_HUB_RECORDS_REACTIVATION_PREVIEW" | "DATA_HUB_RECORDS_REACTIVATED" | "DATA_HUB_DELETED_ITEMS_LIST" | "DATA_HUB_DELETED_ITEM_RESTORE_PREVIEW" | "DATA_HUB_DELETED_ITEM_RESTORED"

export type ExplorerAuditResult = "OK" | "REJECTED" | "FAILED" | "INTERRUPTED" | "DENIED"

export type ExplorerAuditEntry = {
  organizationId: string
  personId: string | null
  accountId: string
  action: ExplorerAuditAction
  result: ExplorerAuditResult
  /** Só código que existe no catálogo: nunca o texto enviado pelo cliente. */
  dataset: string | null
  durationMs: number | null
  rows?: number | null
  bytes?: number | null
  errorCode?: string | null
  interruption?: string | null
  columns?: readonly string[]
  personalColumns?: readonly string[]
  filterColumns?: readonly string[]
  filterConditions?: number
  searched?: boolean
  sort?: string
  hasMore?: boolean
  capped?: boolean
  recordStatus?: string
  /** Lote de cancelamento. O motivo fica nele, nunca aqui: foi escrito à mão. */
  cancellationId?: string
  byKeys?: boolean
  /** Item excluído. O nome só entra quando ele é restaurado: é o nome de uma configuração, igual ao registrado ao excluir. */
  itemType?: string
  itemId?: string
  itemName?: string
}

export async function recordExplorerAudit(db: Pick<Database, "query">, entry: ExplorerAuditEntry): Promise<void> {
  const { organizationId, personId, action, ...details } = entry
  await db.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'data_explorer', $1, $4)`, [organizationId, personId, action, JSON.stringify({ ...details, scope: "ORGANIZATION" })])
}

export const DENIED_AUDIT_WINDOW_MINUTES = 10

/**
 * Tentativa negada: uma linha por conta a cada janela. Qualquer conta autenticada chega aqui, e uma por tentativa deixaria um operador em laço encher a auditoria e empurrar os
 * eventos reais para fora das primeiras páginas do Registro. A condição usa o índice do ator.
 */
export async function recordExplorerDenied(db: Pick<Database, "query">, entry: { organizationId: string; personId: string | null; accountId: string }): Promise<void> {
  await db.query(
    `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload)
     select $1::uuid, $2::uuid, 'DATA_HUB_EXPLORER_DENIED', 'data_explorer', $1::uuid, $3::jsonb
      where not exists (select 1 from audit_logs a where a.actor_id = $2::uuid and a.created_at > now() - make_interval(mins => $4::int) and a.action = 'DATA_HUB_EXPLORER_DENIED')`,
    [entry.organizationId, entry.personId, JSON.stringify({ accountId: entry.accountId, result: "DENIED", scope: "ORGANIZATION" }), DENIED_AUDIT_WINDOW_MINUTES],
  )
}
