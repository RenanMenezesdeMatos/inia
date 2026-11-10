import type pg from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction, type TransactionSource } from "../../../shared/infrastructure/database/transaction.js"

/**
 * TRAVAS do Apoio com Anjo (design_draft.md seção 8). Ordem única em qualquer transação: trava consultiva da organização (quando
 * houver) → linha do pedido → linha do atendimento → linha da presença → versões por pessoa, sempre por último e em ordem de
 * `person_id`. Comandos que mudam estado (criar, cancelar, encerrar, presença, liga/desliga, capacidade) e a distribuição usam a
 * mesma chave: um de cada vez por organização, em todos os processos.
 */
export type Queryable = Pick<Database, "query">
export const organizationLockKey = (organizationId: string) => `human_support:${organizationId}`

/** Transação com a trava da organização (espera a vez). */
export function withOrganizationLock<T>(db: TransactionSource, organizationId: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(
    db,
    async (client) => {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [organizationLockKey(organizationId)])
      return work(client)
    },
    { savepoint: "human_support_command" },
  )
}

/** Tenta a trava da organização sem esperar (distribuição: se outro processo já distribui, pula). */
export async function tryOrganizationLock(client: Queryable, organizationId: string): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>("select pg_try_advisory_xact_lock(hashtext($1)) locked", [organizationLockKey(organizationId)])
  return result.rows[0]?.locked === true
}

/** Transação simples (mensagens, avaliação, classificação: travam a própria linha, sem a trava da organização). */
export function inSupportTransaction<T>(db: TransactionSource, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return inTransaction(db, work, { savepoint: "human_support_write" })
}
