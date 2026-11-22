import type { Database } from "../../../infrastructure/database/pool.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { DEFAULT_MINIMUM_QUALITY_CALL_SECONDS, QUALITY_CALL_RULE_VERSION } from "../domain/quality-call-rule.js"

type Queryable = Pick<Database, "query">

/** Duração mínima da organização para a análise de qualidade (segundos). Organização sem registro = padrão. */
export async function loadMinimumQualityCallSeconds(db: Queryable, organizationId: string): Promise<number> {
  const row = (await db.query<{ seconds: number }>(`select minimum_quality_call_seconds seconds from organizations where id = $1`, [organizationId])).rows[0]
  return row ? Number(row.seconds) : DEFAULT_MINIMUM_QUALITY_CALL_SECONDS
}

/** Troca a duração mínima e registra a mudança (antes → depois) em `audit_logs`, na mesma transação. */
export async function updateMinimumQualityCallSeconds(db: Database, input: { organizationId: string; actorPersonId: string | null; seconds: number }): Promise<number> {
  return inTransaction(db, async (client) => {
    const previous = (await client.query<{ seconds: number }>(`select minimum_quality_call_seconds seconds from organizations where id = $1 for update`, [input.organizationId])).rows[0]
    if (!previous) throw new Error("Organização não encontrada.")
    if (Number(previous.seconds) === input.seconds) return input.seconds
    await client.query(`update organizations set minimum_quality_call_seconds = $2 where id = $1`, [input.organizationId, input.seconds])
    await client.query(
      `insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'QUALITY_CALL_RULE_UPDATED', 'organization', $1, $3)`,
      [input.organizationId, input.actorPersonId, JSON.stringify({ rule: QUALITY_CALL_RULE_VERSION, from: Number(previous.seconds), to: input.seconds })],
    )
    return input.seconds
  })
}
