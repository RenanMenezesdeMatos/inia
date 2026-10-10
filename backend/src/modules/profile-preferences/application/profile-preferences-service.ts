import { createHash } from "node:crypto"
import type { PoolClient } from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { COVER_PRESETS, normalizePreferredName, PREFERRED_NAME_MAX_LENGTH, type CoverPreset, type PersonPresentation } from "../domain/person-presentation.js"
import { IMAGE_ERROR_MESSAGES, validateProfileImage, type ProfileImageUsage } from "../domain/profile-image.js"
import { loadPersonPresentation } from "./person-presentation-loader.js"

/**
 * Preferências pessoais do perfil. A PESSOA editada é SEMPRE a da sessão (organização + pessoa do token verificado): não
 * existe parâmetro de pessoa, então ninguém altera as preferências de outra conta — nem um gestor, nem um administrador.
 * Dados profissionais (nome cadastral, matrícula, cargo, equipe, hierarquia, acesso) não passam por aqui.
 */

export type ProfileOwner = { organizationId: string; personId: string; accountId: string }

export type AvatarChange = { action: "KEEP" } | { action: "REMOVE" } | { action: "REPLACE"; data: Buffer }
export type CoverChange = { action: "KEEP" } | { action: "DEFAULT" } | { action: "PRESET"; preset: CoverPreset } | { action: "CUSTOM"; data: Buffer }
export type ProfileUpdate = { preferredName?: string | null | undefined; avatar: AvatarChange; cover: CoverChange }

export type MyProfile = PersonPresentation & {
  professional: { jobTitle: string | null; teamName: string | null; matricula: string | null }
  updatedAt: string | null
}

type Queryable = Pick<Database, "query">
type PreferencesRow = { preferred_name: string | null; avatar_image_id: string | null; cover_kind: "DEFAULT" | "PRESET" | "CUSTOM"; cover_preset: string | null; cover_image_id: string | null }

export async function loadMyProfile(db: Queryable, owner: Pick<ProfileOwner, "organizationId" | "personId">): Promise<MyProfile> {
  const presentation = await loadPersonPresentation(db, owner.organizationId, owner.personId)
  if (!presentation) throw new DomainError("Perfil não encontrado.", "PROFILE_NOT_FOUND", 404)
  const extra = await db.query<{ job_title: string | null; team_name: string | null; matricula: string | null; updated_at: Date | null }>(
    `select p.job_title, t.name team_name, p.matricula, pp.updated_at
     from people p
     left join teams t on t.id = p.team_id
     left join person_profile_preferences pp on pp.organization_id = p.organization_id and pp.person_id = p.id
     where p.organization_id = $1 and p.id = $2`,
    [owner.organizationId, owner.personId],
  )
  const row = extra.rows[0]
  return { ...presentation, professional: { jobTitle: row?.job_title ?? null, teamName: row?.team_name ?? null, matricula: row?.matricula ?? null }, updatedAt: row?.updated_at ? row.updated_at.toISOString() : null }
}

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  // Já dentro de uma transação (cliente dedicado das provas contra o banco de teste): savepoint no lugar de begin/commit.
  if (typeof (db as Partial<PoolClient>).release === "function") {
    const client = db as unknown as PoolClient
    await client.query("savepoint profile_preferences")
    try {
      const result = await work(client)
      await client.query("release savepoint profile_preferences")
      return result
    } catch (error) {
      await client.query("rollback to savepoint profile_preferences").catch(() => {})
      throw error
    }
  }
  const client = await db.connect()
  try {
    await client.query("begin")
    const result = await work(client)
    await client.query("commit")
    return result
  } catch (error) {
    await client.query("rollback").catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

function checkedImage(data: Buffer, usage: ProfileImageUsage) {
  const validation = validateProfileImage(data, usage)
  if (!validation.ok) throw new DomainError(IMAGE_ERROR_MESSAGES[validation.code], validation.code, 422, { usage })
  return validation.image
}

async function storeImage(client: Queryable, owner: ProfileOwner, usage: ProfileImageUsage, data: Buffer): Promise<string> {
  const image = checkedImage(data, usage)
  const sha256 = createHash("sha256").update(data).digest("hex")
  const result = await client.query<{ id: string }>(
    `insert into person_profile_images (organization_id, person_id, usage, mime_type, byte_size, width, height, sha256, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [owner.organizationId, owner.personId, usage, image.mimeType, data.length, image.width, image.height, sha256, data],
  )
  return result.rows[0]!.id
}

export async function updateMyProfile(db: Database, owner: ProfileOwner, update: ProfileUpdate): Promise<MyProfile> {
  // Validação ANTES de abrir a transação: nome e imagens inválidos nunca gravam nada.
  let preferredName: string | null | undefined
  if (update.preferredName !== undefined) {
    const normalized = normalizePreferredName(update.preferredName)
    if (!normalized.ok) {
      throw normalized.code === "TOO_LONG"
        ? new DomainError(`Use no máximo ${PREFERRED_NAME_MAX_LENGTH} caracteres.`, "PROFILE_PREFERRED_NAME_TOO_LONG", 422)
        : new DomainError("Use apenas letras, espaços, apóstrofo, hífen ou ponto.", "PROFILE_PREFERRED_NAME_INVALID", 422)
    }
    preferredName = normalized.value
  }
  if (update.avatar.action === "REPLACE") checkedImage(update.avatar.data, "AVATAR")
  if (update.cover.action === "CUSTOM") checkedImage(update.cover.data, "COVER")
  if (update.cover.action === "PRESET" && !(COVER_PRESETS as readonly string[]).includes(update.cover.preset)) throw new DomainError("Capa inválida.", "PROFILE_COVER_INVALID", 422)

  await inTransaction(db, async (client) => {
    // A pessoa da sessão precisa existir na organização da sessão (conta ativa já foi verificada no login).
    const person = await client.query(`select 1 from people where organization_id = $1 and id = $2 for update`, [owner.organizationId, owner.personId])
    if (person.rowCount === 0) throw new DomainError("Perfil não encontrado.", "PROFILE_NOT_FOUND", 404)
    const current = (await client.query<PreferencesRow>(
      `select preferred_name, avatar_image_id, cover_kind, cover_preset, cover_image_id from person_profile_preferences where organization_id = $1 and person_id = $2`,
      [owner.organizationId, owner.personId],
    )).rows[0] ?? { preferred_name: null, avatar_image_id: null, cover_kind: "DEFAULT" as const, cover_preset: null, cover_image_id: null }

    const next: PreferencesRow = { ...current }
    if (preferredName !== undefined) next.preferred_name = preferredName
    if (update.avatar.action === "REMOVE") next.avatar_image_id = null
    if (update.avatar.action === "REPLACE") next.avatar_image_id = await storeImage(client, owner, "AVATAR", update.avatar.data)
    if (update.cover.action === "DEFAULT") Object.assign(next, { cover_kind: "DEFAULT", cover_preset: null, cover_image_id: null })
    if (update.cover.action === "PRESET") Object.assign(next, { cover_kind: "PRESET", cover_preset: update.cover.preset, cover_image_id: null })
    if (update.cover.action === "CUSTOM") Object.assign(next, { cover_kind: "CUSTOM", cover_preset: null, cover_image_id: await storeImage(client, owner, "COVER", update.cover.data) })

    await client.query(
      `insert into person_profile_preferences (organization_id, person_id, preferred_name, avatar_image_id, cover_kind, cover_preset, cover_image_id, updated_at, updated_by_account_id)
       values ($1, $2, $3, $4, $5, $6, $7, now(), $8)
       on conflict (organization_id, person_id) do update set
         preferred_name = excluded.preferred_name, avatar_image_id = excluded.avatar_image_id, cover_kind = excluded.cover_kind,
         cover_preset = excluded.cover_preset, cover_image_id = excluded.cover_image_id, updated_at = excluded.updated_at,
         updated_by_account_id = excluded.updated_by_account_id`,
      [owner.organizationId, owner.personId, next.preferred_name, next.avatar_image_id, next.cover_kind, next.cover_preset, next.cover_image_id, owner.accountId],
    )
    // Imagens substituídas ou removidas saem na MESMA transação (depois de a preferência deixar de apontar para elas).
    const released = [current.avatar_image_id, current.cover_image_id].filter((id): id is string => id !== null && id !== next.avatar_image_id && id !== next.cover_image_id)
    if (released.length > 0) await client.query(`delete from person_profile_images where organization_id = $1 and person_id = $2 and id = any($3::uuid[])`, [owner.organizationId, owner.personId, released])

    const changed = [
      preferredName !== undefined && preferredName !== current.preferred_name ? "preferredName" : null,
      update.avatar.action !== "KEEP" ? "avatar" : null,
      update.cover.action !== "KEEP" ? "cover" : null,
    ].filter(Boolean)
    // Auditoria sem o conteúdo (nome escolhido e imagens são dados pessoais): só o que mudou.
    if (changed.length > 0) {
      await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'PROFILE_PREFERENCES_UPDATED', 'person_profile_preferences', $2, $3)`, [owner.organizationId, owner.personId, JSON.stringify({ changed })])
    }
  })
  return loadMyProfile(db, owner)
}

export async function loadProfileImage(db: Queryable, organizationId: string, imageId: string): Promise<{ mimeType: string; data: Buffer; sha256: string } | null> {
  const result = await db.query<{ mime_type: string; data: Buffer; sha256: string }>(
    `select i.mime_type, i.data, i.sha256
     from person_profile_images i
     join person_profile_preferences pp on pp.organization_id = i.organization_id and pp.person_id = i.person_id
       and (pp.avatar_image_id = i.id or pp.cover_image_id = i.id)
     where i.organization_id = $1 and i.id = $2`,
    [organizationId, imageId],
  )
  const row = result.rows[0]
  return row ? { mimeType: row.mime_type, data: row.data, sha256: row.sha256 } : null
}
