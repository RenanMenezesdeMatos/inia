import type { Database } from "../../../infrastructure/database/pool.js"
import { presentationFromRow, type PersonPresentation, type PresentationRow } from "../domain/person-presentation.js"

type Queryable = Pick<Database, "query">

/**
 * Leitura em LOTE da apresentação (nome cadastral × preferido, foto, capa) — uma consulta para N pessoas, sempre filtrada pela
 * organização da sessão. Pessoa de outra organização simplesmente não aparece no mapa.
 */
export async function loadPersonPresentations(db: Queryable, organizationId: string, personIds: readonly string[]): Promise<Map<string, PersonPresentation>> {
  const ids = [...new Set(personIds)]
  if (ids.length === 0) return new Map()
  const result = await db.query<PresentationRow>(
    `select p.id person_id, p.name registered_name, p.avatar_url corporate_avatar_url,
            pp.preferred_name, pp.avatar_image_id, pp.cover_kind, pp.cover_preset, pp.cover_image_id
     from people p
     left join person_profile_preferences pp on pp.organization_id = p.organization_id and pp.person_id = p.id
     where p.organization_id = $1 and p.id = any($2::uuid[])`,
    [organizationId, ids],
  )
  return new Map(result.rows.map((row) => [row.person_id, presentationFromRow(row)]))
}

export async function loadPersonPresentation(db: Queryable, organizationId: string, personId: string): Promise<PersonPresentation | null> {
  return (await loadPersonPresentations(db, organizationId, [personId])).get(personId) ?? null
}
