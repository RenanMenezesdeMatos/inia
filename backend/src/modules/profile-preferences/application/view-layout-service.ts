import type { Database } from "../../../infrastructure/database/pool.js"
import type { ViewLayout, ViewLayoutKey } from "../domain/view-layout.js"

type Queryable = Pick<Database, "query">

/** Disposição personalizada da pessoa da sessão (regra em `domain/view-layout.ts`). Sem linha = a tela usa o padrão. */
type Me = { organizationId: string; personId: string }

export async function loadViewLayout(db: Queryable, me: Me, viewKey: ViewLayoutKey): Promise<{ layout: ViewLayout | null; updatedAt: string | null }> {
  const row = (await db.query<{ layout: ViewLayout; updated_at: Date }>(`select layout, updated_at from person_view_layouts where organization_id = $1 and person_id = $2 and view_key = $3`, [me.organizationId, me.personId, viewKey])).rows[0]
  return { layout: row?.layout ?? null, updatedAt: row?.updated_at.toISOString() ?? null }
}

export async function saveViewLayout(db: Queryable, me: Me, viewKey: ViewLayoutKey, layout: ViewLayout): Promise<{ layout: ViewLayout; updatedAt: string }> {
  const row = (
    await db.query<{ updated_at: Date }>(
      `insert into person_view_layouts (organization_id, person_id, view_key, layout, updated_at) values ($1, $2, $3, $4, statement_timestamp())
       on conflict (organization_id, person_id, view_key) do update set layout = excluded.layout, updated_at = excluded.updated_at
       returning updated_at`,
      [me.organizationId, me.personId, viewKey, JSON.stringify(layout)],
    )
  ).rows[0]!
  return { layout, updatedAt: row.updated_at.toISOString() }
}

/** "Restaurar padrão": apaga a disposição da pessoa (a tela volta ao catálogo). Preferência pessoal, não objeto de negócio. */
export async function resetViewLayout(db: Queryable, me: Me, viewKey: ViewLayoutKey): Promise<void> {
  await db.query(`delete from person_view_layouts where organization_id = $1 and person_id = $2 and view_key = $3`, [me.organizationId, me.personId, viewKey])
}
