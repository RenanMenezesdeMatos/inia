import type { Database } from "../../../infrastructure/database/pool.js"

/** LEITOR ANALÍTICO de materiais (Monitoria de usabilidade): o material existe na organização? (acesso é do leitor de material). */
type Queryable = Pick<Database, "query">

export async function existingMaterials(db: Queryable, organizationId: string, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const result = await db.query<{ id: string }>(`select id from knowledge_documents where organization_id = $1 and id = any($2::uuid[]) and deleted_at is null`, [organizationId, [...new Set(ids)]])
  return new Set(result.rows.map((row) => row.id))
}
