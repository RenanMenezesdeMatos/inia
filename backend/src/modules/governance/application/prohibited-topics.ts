import type { Database } from "../../../infrastructure/database/pool.js"
import type { ProhibitedTopic } from "../domain/prohibited-topic.js"

/** Assuntos proibidos ativos da organização — valem para todos os Agents e para toda conversa com a INIA. */
export async function loadProhibitedTopics(db: Pick<Database, "query">, organizationId: string): Promise<ProhibitedTopic[]> {
  const result = await db.query<{ name: string; required_behavior: string }>(
    `select name, required_behavior from prohibited_topics where organization_id = $1 and active order by name, id`,
    [organizationId],
  )
  return result.rows.map((row) => ({ name: row.name, requiredBehavior: row.required_behavior }))
}
