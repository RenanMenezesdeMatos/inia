import { createHash } from "node:crypto"
import { stripImageMetadata } from "../../../shared/infrastructure/image-metadata.js"
import type { PoolClient } from "pg"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import {
  compareScenesForListing,
  INIA_SCENE_BLUR,
  INIA_SCENE_DIM,
  localMomentOf,
  nextSceneChange,
  normalizeImageLabel,
  normalizeSceneName,
  overlaps,
  resolveSceneAt,
  SCENE_IMAGE_ERROR_MESSAGES,
  sceneImageUrl,
  sceneStatusOf,
  validateImagePlan,
  validateSceneImage,
  type SceneStatus,
  type ScenePeriod,
} from "../domain/inia-scene.js"
import { compareImagesBySlot, describeSlot, formatClock, nextImageChange, resolveImageAt, type TimeSlot } from "../domain/scene-time-slots.js"

/**
 * Cenários da INIA por organização. Escrita = só o Administrador geral (o router exige `inia_experience.manage` na
 * organização inteira); leitura do que vale agora = qualquer pessoa autenticada da organização. A organização vem SEMPRE da
 * sessão — um id de outra organização é "não encontrado". As leituras nunca carregam os bytes das imagens: só a rota da
 * imagem lê `data`, e só da imagem pedida.
 */

type Queryable = Pick<Database, "query">
export type SceneActor = { organizationId: string; personId: string }

type SceneRow = { id: string; name: string; blur: number; dim: number; schedule_start: string | null; schedule_end: string | null; created_at: Date; updated_at: Date }
type ImageRow = { id: string; scene_id: string; label: string; is_primary: boolean; start_minute: number | null; end_minute: number | null; mime_type: string; byte_size: number; width: number; height: number; sha256: string }

export type SceneImageSummary = {
  id: string
  /** Identificação para quem administra (ex.: Dia, Noite). */
  label: string
  imageUrl: string
  width: number
  height: number
  byteSize: number
  /** Vale nos horários sem faixa (e o dia inteiro quando o cenário só tem ela). */
  isPrimary: boolean
  /** Faixa diária "HH:MM" no fuso da organização (início inclusivo, fim exclusivo); nulos = sem faixa. */
  start: string | null
  end: string | null
}
export type SceneSummary = {
  id: string
  name: string
  /** Imagem PRINCIPAL (miniatura e compatibilidade). */
  imageUrl: string
  width: number
  height: number
  byteSize: number
  /** Desfoque do fundo, em px (o mesmo no palco e no painel). */
  blur: number
  /** Escurecimento do fundo, em % (máscara preta sobre a imagem). */
  dim: number
  scheduleStart: string | null
  scheduleEnd: string | null
  isDefault: boolean
  status: SceneStatus
  /** Em ordem de horário (faixas pelo início; a principal sem faixa por último). */
  images: SceneImageSummary[]
  /** A imagem deste cenário no horário local de agora (vale se o cenário estiver no ar). */
  activeImageId: string
  /** Próxima troca de imagem dentro do cenário (pelo horário, sem olhar o período). */
  nextImageChange: { time: string; imageId: string; nextDay: boolean } | null
  createdAt: string
  updatedAt: string
}
export type ScenesOverview = {
  today: string
  timeZone: string
  /** Instante do servidor e hora local da organização usados na resolução. */
  now: string
  localTime: string
  defaultSceneId: string | null
  current: { sceneId: string; imageId: string; reason: "SCHEDULED" | "DEFAULT"; imageReason: "SLOT" | "PRIMARY" } | null
  /** Próxima troca do que o colaborador vê (cenário ou imagem); null = nada muda no horizonte. */
  nextChange: { at: string; date: string; time: string; sceneId: string | null; imageId: string | null } | null
  scenes: SceneSummary[]
}
export type CurrentScene = {
  id: string
  name: string
  imageId: string
  imageLabel: string
  imageUrl: string
  width: number
  height: number
  blur: number
  dim: number
  reason: "SCHEDULED" | "DEFAULT"
  imageReason: "SLOT" | "PRIMARY"
} | null
/** O que o colaborador vê agora + quando pedir de novo (`nextChangeAt`) e qual imagem vem depois (para pré-carregar). */
export type CurrentSceneState = { scene: CurrentScene; now: string; nextChangeAt: string | null; upcoming: { imageUrl: string } | null }

const SCENE_COLUMNS = `id, name, background_blur::float8 blur, background_dim::int dim, to_char(schedule_start, 'YYYY-MM-DD') schedule_start, to_char(schedule_end, 'YYYY-MM-DD') schedule_end, created_at, updated_at`
// Nunca `data`: a leitura do cenário não baixa imagens.
const IMAGE_COLUMNS = `id, scene_id, label, is_primary, start_minute, end_minute, mime_type, byte_size, width, height, sha256`
const periodOf = (row: SceneRow): ScenePeriod | null => (row.schedule_start && row.schedule_end ? { start: row.schedule_start, end: row.schedule_end } : null)
const slotOf = (row: ImageRow): TimeSlot | null => (row.start_minute !== null && row.end_minute !== null ? { start: row.start_minute, end: row.end_minute } : null)
const notFound = () => new DomainError("Cenário não encontrado.", "INIA_SCENE_NOT_FOUND", 404)

type ImageModel = { id: string; isPrimary: boolean; slot: TimeSlot | null; row: ImageRow }
type SceneModel = { id: string; name: string; period: ScenePeriod | null; updatedAt: Date; images: ImageModel[]; row: SceneRow }

async function inTransaction<T>(db: Database, work: (client: Queryable) => Promise<T>): Promise<T> {
  // Já dentro de uma transação (cliente dedicado das provas contra o banco de teste): savepoint no lugar de begin/commit.
  if (typeof (db as Partial<PoolClient>).release === "function") {
    const client = db as unknown as PoolClient
    await client.query("savepoint inia_scenes")
    try {
      const result = await work(client)
      await client.query("release savepoint inia_scenes")
      return result
    } catch (error) {
      await client.query("rollback to savepoint inia_scenes").catch(() => {})
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

async function loadModels(db: Queryable, organizationId: string): Promise<{ scenes: SceneModel[]; defaultSceneId: string | null }> {
  const [scenes, images, settings] = await Promise.all([
    db.query<SceneRow>(`select ${SCENE_COLUMNS} from inia_scenes where organization_id = $1`, [organizationId]),
    db.query<ImageRow>(`select ${IMAGE_COLUMNS} from inia_scene_images where organization_id = $1`, [organizationId]),
    db.query<{ default_scene_id: string | null }>(`select default_scene_id from inia_scene_settings where organization_id = $1`, [organizationId]),
  ])
  const imagesByScene = new Map<string, ImageModel[]>()
  for (const row of images.rows) {
    const list = imagesByScene.get(row.scene_id) ?? []
    list.push({ id: row.id, isPrimary: row.is_primary, slot: slotOf(row), row })
    imagesByScene.set(row.scene_id, list)
  }
  const models = scenes.rows
    .map((row) => ({ id: row.id, name: row.name, period: periodOf(row), updatedAt: row.updated_at, images: (imagesByScene.get(row.id) ?? []).sort(compareImagesBySlot), row }))
    // Cenário sem imagem não existe (o banco garante no fim da transação); por segurança nunca entra na resolução.
    .filter((scene) => scene.images.length > 0)
    .sort(compareScenesForListing)
  return { scenes: models, defaultSceneId: settings.rows[0]?.default_scene_id ?? null }
}

const imageUrlOf = (image: ImageModel) => sceneImageUrl(image.id, image.row.sha256)
const primaryOf = (scene: SceneModel) => scene.images.find((image) => image.isPrimary) ?? scene.images[0]!

/** O que o colaborador vê AGORA (cenário + imagem) e quando isso muda. */
export async function loadCurrentScene(db: Database, organizationId: string, now: Date): Promise<CurrentSceneState> {
  const [{ scenes, defaultSceneId }, timeZone] = await Promise.all([loadModels(db, organizationId), resolveOrganizationTimezone(db, organizationId)])
  const resolved = resolveSceneAt(scenes, defaultSceneId, localMomentOf(now, timeZone))
  const next = nextSceneChange(scenes, defaultSceneId, now, timeZone)
  const scene: CurrentScene = resolved
    ? {
        id: resolved.scene.id,
        name: resolved.scene.name,
        imageId: resolved.image.id,
        imageLabel: resolved.image.row.label,
        imageUrl: imageUrlOf(resolved.image),
        width: resolved.image.row.width,
        height: resolved.image.row.height,
        blur: resolved.scene.row.blur,
        dim: resolved.scene.row.dim,
        reason: resolved.reason,
        imageReason: resolved.imageReason,
      }
    : null
  return { scene, now: now.toISOString(), nextChangeAt: next ? next.at.toISOString() : null, upcoming: next?.resolved ? { imageUrl: imageUrlOf(next.resolved.image) } : null }
}

/** Tela de administração: todos os cenários (em ordem cronológica), o que está no ar e quando muda. */
export async function loadScenesOverview(db: Database, organizationId: string, now: Date): Promise<ScenesOverview> {
  const [{ scenes, defaultSceneId }, timeZone] = await Promise.all([loadModels(db, organizationId), resolveOrganizationTimezone(db, organizationId)])
  const moment = localMomentOf(now, timeZone)
  const resolved = resolveSceneAt(scenes, defaultSceneId, moment)
  const next = nextSceneChange(scenes, defaultSceneId, now, timeZone)
  return {
    today: moment.date,
    timeZone,
    now: now.toISOString(),
    localTime: formatClock(moment.minute),
    defaultSceneId,
    current: resolved ? { sceneId: resolved.scene.id, imageId: resolved.image.id, reason: resolved.reason, imageReason: resolved.imageReason } : null,
    nextChange: next ? { at: next.at.toISOString(), date: next.moment.date, time: formatClock(next.moment.minute), sceneId: next.resolved?.scene.id ?? null, imageId: next.resolved?.image.id ?? null } : null,
    scenes: scenes.map((scene) => {
      const primary = primaryOf(scene)
      const upcomingImage = nextImageChange(scene.images, moment.minute)
      return {
        id: scene.id,
        name: scene.name,
        imageUrl: imageUrlOf(primary),
        width: primary.row.width,
        height: primary.row.height,
        byteSize: primary.row.byte_size,
        blur: scene.row.blur,
        dim: scene.row.dim,
        scheduleStart: scene.row.schedule_start,
        scheduleEnd: scene.row.schedule_end,
        isDefault: scene.id === defaultSceneId,
        status: sceneStatusOf(scene, resolved?.scene ?? null, moment.date),
        images: scene.images.map((image) => ({
          id: image.id,
          label: image.row.label,
          imageUrl: imageUrlOf(image),
          width: image.row.width,
          height: image.row.height,
          byteSize: image.row.byte_size,
          isPrimary: image.isPrimary,
          start: image.slot ? formatClock(image.slot.start) : null,
          end: image.slot ? formatClock(image.slot.end) : null,
        })),
        activeImageId: resolveImageAt(scene.images, moment.minute)!.image.id,
        nextImageChange: upcomingImage ? { time: formatClock(upcomingImage.minute), imageId: upcomingImage.image.id, nextDay: upcomingImage.nextDay } : null,
        createdAt: scene.row.created_at.toISOString(),
        updatedAt: scene.row.updated_at.toISOString(),
      }
    }),
  }
}

type CheckedImage = { mimeType: string; width: number; height: number; sha256: string; byteSize: number; data: Buffer }
function checkedImage(data: Buffer, context?: { index: number; label: string }): CheckedImage {
  const validation = validateSceneImage(data)
  if (!validation.ok) {
    const message = SCENE_IMAGE_ERROR_MESSAGES[validation.code]
    throw new DomainError(context ? `Imagem "${context.label}": ${message}` : message, validation.code, 422, context ? { imageIndex: context.index } : undefined)
  }
  // Fundo visto por toda a organização: sem EXIF/GPS, XMP e afins (achado AUTH-11 da auditoria de 17/10/2026).
  const clean = stripImageMetadata(data, validation.image.mimeType)
  return { ...validation.image, sha256: createHash("sha256").update(clean).digest("hex"), byteSize: clean.length, data: clean }
}

function checkedName(value: string) {
  const name = normalizeSceneName(value)
  if (!name) throw new DomainError("Informe um nome de até 80 caracteres.", "INIA_SCENE_NAME_INVALID", 422)
  return name
}

/** Uma imagem do conjunto que vai ser salvo. `id` = imagem que já existe no cenário; sem `data` = mantém os bytes. */
export type SceneImageInput = { id?: string | undefined; label: string; slot: TimeSlot | null; isPrimary: boolean; data?: Buffer | undefined }
type CheckedPlanEntry = { id: string | null; label: string; slot: TimeSlot | null; isPrimary: boolean; image: CheckedImage | null }

/** Conjunto inteiro validado ANTES de abrir a transação: identificação, principal, faixas sem sobreposição e cada imagem. */
function checkedPlan(images: readonly SceneImageInput[], options: { requireData: boolean }): CheckedPlanEntry[] {
  const entries = images.map((input, index) => ({ key: String(index), label: normalizeImageLabel(input.label) ?? input.label, isPrimary: input.isPrimary, slot: input.slot }))
  const error = validateImagePlan(entries)
  if (error) {
    const details = error.code === "INIA_SCENE_IMAGE_SLOT_OVERLAP" ? { imageIndexes: error.keys.map(Number), overlap: error.overlap } : "key" in error ? { imageIndex: Number(error.key) } : undefined
    throw new DomainError(error.message, error.code, 422, details)
  }
  return images.map((input, index) => {
    const label = entries[index]!.label
    if (!input.id && !input.data) throw new DomainError(`Envie o arquivo da imagem "${label}".`, "INIA_SCENE_IMAGE_REQUIRED", 422, { imageIndex: index })
    if (options.requireData && input.id) throw new DomainError("Imagem desconhecida neste cenário.", "INIA_SCENE_IMAGES_CHANGED", 409)
    return { id: input.id ?? null, label, slot: input.slot, isPrimary: input.isPrimary, image: input.data ? checkedImage(input.data, { index, label }) : null }
  })
}

/** Dentro da transação, com a organização travada: nome único e períodos sem sobreposição (o conflito é nomeado). */
async function assertAvailable(client: Queryable, organizationId: string, input: { id: string | null; name: string; period: ScenePeriod | null }) {
  await client.query(`select pg_advisory_xact_lock(hashtext('inia_scenes:' || $1))`, [organizationId])
  const others = (await client.query<SceneRow>(`select ${SCENE_COLUMNS} from inia_scenes where organization_id = $1 and ($2::uuid is null or id <> $2::uuid)`, [organizationId, input.id])).rows
  if (others.some((row) => row.name.toLocaleLowerCase("pt-BR") === input.name.toLocaleLowerCase("pt-BR"))) throw new DomainError("Já existe um cenário com esse nome.", "INIA_SCENE_NAME_TAKEN", 409)
  if (input.period) {
    const conflict = others.find((row) => { const period = periodOf(row); return period !== null && overlaps(period, input.period!) })
    if (conflict) throw new DomainError(`O período coincide com o do cenário "${conflict.name}". Ajuste as datas para não se sobreporem.`, "INIA_SCENE_PERIOD_OVERLAP", 409, { conflictingSceneId: conflict.id, conflictingSceneName: conflict.name })
  }
}

const audit = (client: Queryable, actor: SceneActor, action: string, sceneId: string | null, payload: Record<string, unknown>) =>
  client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, $3, 'inia_scene', $4, $5)`, [actor.organizationId, actor.personId, action, sceneId, JSON.stringify(payload)])

const auditImage = (entry: { id: string; label: string; slot: TimeSlot | null; isPrimary: boolean; image: CheckedImage | null }) => ({
  id: entry.id,
  label: entry.label,
  slot: entry.slot ? describeSlot(entry.slot) : null,
  primary: entry.isPrimary,
  ...(entry.image ? { file: { width: entry.image.width, height: entry.image.height, byteSize: entry.image.byteSize, sha256: entry.image.sha256 } } : {}),
})

async function insertImage(client: Queryable, actor: SceneActor, sceneId: string, entry: CheckedPlanEntry & { image: CheckedImage }): Promise<string> {
  const image = entry.image
  const inserted = await client.query<{ id: string }>(
    `insert into inia_scene_images (organization_id, scene_id, label, is_primary, start_minute, end_minute, mime_type, byte_size, width, height, sha256, data, created_by_person_id, updated_by_person_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) returning id`,
    [actor.organizationId, sceneId, entry.label, entry.isPrimary, entry.slot?.start ?? null, entry.slot?.end ?? null, image.mimeType, image.byteSize, image.width, image.height, image.sha256, image.data, actor.personId],
  )
  return inserted.rows[0]!.id
}

export async function createScene(db: Database, actor: SceneActor, input: { name: string; period: ScenePeriod | null; images: readonly SceneImageInput[]; blur?: number | undefined; dim?: number | undefined }): Promise<string> {
  const name = checkedName(input.name)
  const plan = checkedPlan(input.images, { requireData: true })
  const blur = input.blur ?? INIA_SCENE_BLUR.default
  const dim = input.dim ?? INIA_SCENE_DIM.default
  return inTransaction(db, async (client) => {
    await assertAvailable(client, actor.organizationId, { id: null, name, period: input.period })
    const created = await client.query<{ id: string }>(
      `insert into inia_scenes (organization_id, name, schedule_start, schedule_end, background_blur, background_dim, created_by_person_id, updated_by_person_id)
       values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`,
      [actor.organizationId, name, input.period?.start ?? null, input.period?.end ?? null, blur, dim, actor.personId],
    )
    const id = created.rows[0]!.id
    const images = []
    for (const entry of plan) images.push(auditImage({ ...entry, id: await insertImage(client, actor, id, entry as CheckedPlanEntry & { image: CheckedImage }) }))
    await audit(client, actor, "INIA_SCENE_CREATED", id, { name, period: input.period, blur, dim, images })
    return id
  })
}

/**
 * `period: undefined` = mantém; `null` = tira o agendamento. `blur`/`dim: undefined` = mantém.
 * `images` = o CONJUNTO inteiro de imagens (as que não vierem são removidas); `undefined` = mantém. `primaryImage` (contrato
 * antigo, sem `images`) troca só o arquivo da imagem principal. Tudo numa transação: nada fica salvo pela metade.
 */
export async function updateScene(db: Database, actor: SceneActor, sceneId: string, input: { name?: string | undefined; period?: ScenePeriod | null | undefined; images?: readonly SceneImageInput[] | undefined; primaryImage?: Buffer | undefined; blur?: number | undefined; dim?: number | undefined }): Promise<void> {
  const name = input.name === undefined ? undefined : checkedName(input.name)
  const plan = input.images ? checkedPlan(input.images, { requireData: false }) : undefined
  const primaryImage = !plan && input.primaryImage ? checkedImage(input.primaryImage) : undefined
  await inTransaction(db, async (client) => {
    const current = (await client.query<SceneRow>(`select ${SCENE_COLUMNS} from inia_scenes where organization_id = $1 and id = $2 for update`, [actor.organizationId, sceneId])).rows[0]
    if (!current) throw notFound()
    const nextName = name ?? current.name
    const nextPeriod = input.period === undefined ? periodOf(current) : input.period
    await assertAvailable(client, actor.organizationId, { id: sceneId, name: nextName, period: nextPeriod })

    let imagesAudit: Record<string, unknown> = {}
    if (plan) {
      const existing = (await client.query<{ id: string; label: string }>(`select id, label from inia_scene_images where organization_id = $1 and scene_id = $2 for update`, [actor.organizationId, sceneId])).rows
      const existingIds = new Set(existing.map((row) => row.id))
      if (plan.some((entry) => entry.id && !existingIds.has(entry.id))) throw new DomainError("As imagens deste cenário foram alteradas em outra tela. Feche e abra o cenário de novo.", "INIA_SCENE_IMAGES_CHANGED", 409)
      const kept = plan.flatMap((entry) => (entry.id ? [entry.id] : []))
      const removed = existing.filter((row) => !kept.includes(row.id))
      await client.query(`delete from inia_scene_images where organization_id = $1 and scene_id = $2 and not (id = any($3::uuid[]))`, [actor.organizationId, sceneId, kept])
      // Primeiro passo: as mantidas saem da principal e ganham uma identificação provisória — trocar "Dia" ⇄ "Noite" ou a
      // principal não esbarra nos índices únicos no meio do caminho. O segundo passo grava os valores finais.
      await client.query(`update inia_scene_images set is_primary = false, label = '~' || id::text where scene_id = $1 and id = any($2::uuid[])`, [sceneId, kept])
      const saved = []
      for (const entry of plan) {
        if (!entry.id) {
          saved.push(auditImage({ ...entry, id: await insertImage(client, actor, sceneId, entry as CheckedPlanEntry & { image: CheckedImage }) }))
          continue
        }
        const image = entry.image
        await client.query(
          `update inia_scene_images set label = $3, is_primary = $4, start_minute = $5, end_minute = $6,
                  mime_type = coalesce($7, mime_type), byte_size = coalesce($8, byte_size), width = coalesce($9, width), height = coalesce($10, height),
                  sha256 = coalesce($11, sha256), data = coalesce($12, data), updated_at = now(), updated_by_person_id = $13
            where scene_id = $1 and id = $2`,
          [sceneId, entry.id, entry.label, entry.isPrimary, entry.slot?.start ?? null, entry.slot?.end ?? null, image?.mimeType ?? null, image?.byteSize ?? null, image?.width ?? null, image?.height ?? null, image?.sha256 ?? null, image?.data ?? null, actor.personId],
        )
        saved.push(auditImage({ ...entry, id: entry.id }))
      }
      imagesAudit = { images: saved, removedImages: removed.map((row) => ({ id: row.id, label: row.label })) }
    } else if (primaryImage) {
      await client.query(
        `update inia_scene_images set mime_type = $3, byte_size = $4, width = $5, height = $6, sha256 = $7, data = $8, updated_at = now(), updated_by_person_id = $9
          where scene_id = $1 and organization_id = $2 and is_primary`,
        [sceneId, actor.organizationId, primaryImage.mimeType, primaryImage.byteSize, primaryImage.width, primaryImage.height, primaryImage.sha256, primaryImage.data, actor.personId],
      )
      imagesAudit = { primaryImageChanged: true }
    }

    await client.query(
      `update inia_scenes set name = $3, schedule_start = $4, schedule_end = $5, background_blur = coalesce($6, background_blur), background_dim = coalesce($7, background_dim), updated_at = now(), updated_by_person_id = $8
        where organization_id = $1 and id = $2`,
      [actor.organizationId, sceneId, nextName, nextPeriod?.start ?? null, nextPeriod?.end ?? null, input.blur ?? null, input.dim ?? null, actor.personId],
    )
    await audit(client, actor, "INIA_SCENE_UPDATED", sceneId, {
      name: nextName,
      period: nextPeriod,
      ...(input.blur === undefined ? {} : { blur: input.blur }),
      ...(input.dim === undefined ? {} : { dim: input.dim }),
      ...imagesAudit,
    })
  })
}

/** Excluir o cenário padrão volta o padrão para "nenhum" (o palco de sempre). As imagens saem junto. */
export async function deleteScene(db: Database, actor: SceneActor, sceneId: string): Promise<void> {
  await inTransaction(db, async (client) => {
    const deleted = await client.query<{ name: string }>(`delete from inia_scenes where organization_id = $1 and id = $2 returning name`, [actor.organizationId, sceneId])
    if (!deleted.rows[0]) throw notFound()
    await audit(client, actor, "INIA_SCENE_DELETED", sceneId, { name: deleted.rows[0].name })
  })
}

/** Cenário que vale fora dos períodos agendados (`null` = palco padrão, sem imagem). */
export async function setDefaultScene(db: Database, actor: SceneActor, sceneId: string | null): Promise<void> {
  await inTransaction(db, async (client) => {
    if (sceneId) {
      const exists = await client.query(`select 1 from inia_scenes where organization_id = $1 and id = $2`, [actor.organizationId, sceneId])
      if (exists.rowCount === 0) throw notFound()
    }
    await client.query(
      `insert into inia_scene_settings (organization_id, default_scene_id, updated_at, updated_by_person_id) values ($1, $2, now(), $3)
       on conflict (organization_id) do update set default_scene_id = excluded.default_scene_id, updated_at = now(), updated_by_person_id = excluded.updated_by_person_id`,
      [actor.organizationId, sceneId, actor.personId],
    )
    await audit(client, actor, "INIA_SCENE_DEFAULT_CHANGED", sceneId, { defaultSceneId: sceneId })
  })
}

type ImageFile = { mimeType: string; data: Buffer; sha256: string }
/** UMA imagem de cenário da MESMA organização (é um fundo decorativo: qualquer pessoa autenticada da organização pode ver). */
export async function loadSceneImage(db: Queryable, organizationId: string, imageId: string): Promise<ImageFile | null> {
  const row = (await db.query<{ mime_type: string; data: Buffer; sha256: string }>(`select mime_type, data, sha256 from inia_scene_images where organization_id = $1 and id = $2`, [organizationId, imageId])).rows[0]
  return row ? { mimeType: row.mime_type, data: row.data, sha256: row.sha256 } : null
}

/** Endereço antigo (`/:sceneId/image`): a imagem PRINCIPAL do cenário. */
export async function loadScenePrimaryImage(db: Queryable, organizationId: string, sceneId: string): Promise<ImageFile | null> {
  const row = (await db.query<{ mime_type: string; data: Buffer; sha256: string }>(`select mime_type, data, sha256 from inia_scene_images where organization_id = $1 and scene_id = $2 and is_primary`, [organizationId, sceneId])).rows[0]
  return row ? { mimeType: row.mime_type, data: row.data, sha256: row.sha256 } : null
}
