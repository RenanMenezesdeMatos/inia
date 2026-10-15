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

/** Só a foto a exibir (personalizada > corporativa > nenhuma) de N pessoas, em LOTE — para listas que já trazem o resto da pessoa. */
export type PersonAvatarLoader = (organizationId: string, personIds: string[]) => Promise<Map<string, string | null>>

export const personAvatarLoader =
  (db: Queryable): PersonAvatarLoader =>
  async (organizationId, personIds) =>
    new Map([...(await loadPersonPresentations(db, organizationId, personIds))].map(([personId, presentation]) => [personId, presentation.avatarUrl]))

/** Foto da apresentação quando a pessoa veio na leitura em lote; fora dela, a imagem do cadastro que a lista já trazia. */
export function presentedAvatar(avatars: ReadonlyMap<string, string | null>, personId: string, registeredAvatarUrl: string | null): string | null {
  return avatars.has(personId) ? (avatars.get(personId) ?? null) : registeredAvatarUrl
}

type PersonWithAvatar = { personId: string; avatarUrl: string | null }

/**
 * Lê em LOTE as fotos das pessoas de UMA resposta (uma consulta; nenhuma sem pessoas) e devolve quem troca, em cada pessoa, a
 * imagem do cadastro pela foto da apresentação. Aplicado depois de montar a resposta — nunca no grafo de pessoas em cache:
 * trocar a foto não sobe a versão STRUCTURE.
 */
export async function loadAvatarPresenter(load: PersonAvatarLoader, organizationId: string, personIds: string[]): Promise<<T extends PersonWithAvatar>(person: T) => T> {
  const avatars = personIds.length > 0 ? await load(organizationId, personIds) : new Map<string, string | null>()
  return (person) => ({ ...person, avatarUrl: presentedAvatar(avatars, person.personId, person.avatarUrl) })
}
