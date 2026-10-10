import { Router, type RequestHandler, type Response } from "express"
import multer from "multer"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { INIA_SCENE_IMAGE_LIMITS, INIA_SCENE_IMAGES, normalizeBlur, normalizeDim, validatePeriod, type ScenePeriod } from "../domain/inia-scene.js"
import { validateSlot, type TimeSlot } from "../domain/scene-time-slots.js"
import { createScene, deleteScene, loadCurrentScene, loadSceneImage, loadScenePrimaryImage, loadScenesOverview, setDefaultScene, updateScene, type SceneActor, type SceneImageInput } from "../application/inia-scene-service.js"

type Clock = () => Date
// Arquivos: `image` (contrato antigo: a imagem principal) ou `file-N`, referenciados pelo manifesto `images`.
const FILE_FIELD = /^file-\d{1,2}$/
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INIA_SCENE_IMAGE_LIMITS.maxBytes, files: INIA_SCENE_IMAGES.max, fields: 12, fieldSize: 64 * 1024 },
  fileFilter: (_request, file, accept) => {
    if (file.fieldname === "image" || FILE_FIELD.test(file.fieldname)) accept(null, true)
    else accept(new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname))
  },
}).any()

/** O erro do multer (tamanho, campo inesperado) vira o erro de domínio que a tela sabe mostrar. */
const receiveImage: RequestHandler = (request, response, next) => {
  upload(request, response, (error: unknown) => {
    if (!error) return next()
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") return next(new DomainError("A imagem é grande demais (máximo de 8 MB).", "SCENE_IMAGE_TOO_LARGE", 422))
      return next(new DomainError("Envio de imagem inválido.", "INIA_SCENE_UPLOAD_INVALID", 400, { reason: error.code }))
    }
    return next(error)
  })
}

const PERIOD_MESSAGES = {
  SCENE_PERIOD_INCOMPLETE: "Informe o início e o fim do período (ou deixe os dois em branco).",
  SCENE_PERIOD_INVALID: "Datas do período inválidas.",
  SCENE_PERIOD_INVERTED: "O fim do período precisa ser no mesmo dia ou depois do início.",
} as const
function periodFrom(start: string | undefined, end: string | undefined): ScenePeriod | null {
  const validation = validatePeriod(start, end)
  if (!validation.ok) throw new DomainError(PERIOD_MESSAGES[validation.code], validation.code, 422)
  return validation.period
}

// Estritos: nada de organização, pessoa ou id no corpo — a organização é a da sessão.
const createSchema = z.object({ name: z.string().max(400), scheduleStart: z.string().max(20).optional(), scheduleEnd: z.string().max(20).optional(), blur: z.string().max(10).optional(), dim: z.string().max(10).optional(), images: z.string().max(60_000).optional() }).strict()
// Atualização: `schedule` = "keep" (mantém) | "set" (usa as datas) | "clear" (tira o agendamento).
const updateSchema = z.object({ name: z.string().max(400).optional(), schedule: z.enum(["keep", "set", "clear"]).default("keep"), scheduleStart: z.string().max(20).optional(), scheduleEnd: z.string().max(20).optional(), blur: z.string().max(10).optional(), dim: z.string().max(10).optional(), images: z.string().max(60_000).optional() }).strict()

/**
 * MANIFESTO das imagens (JSON no campo `images`): o conjunto inteiro, em qualquer ordem. Cada item: `id` (imagem que já
 * existe no cenário) e/ou `file` (nome do campo `file-N` com o arquivo novo — substitui a existente ou cria outra),
 * identificação, faixa "HH:MM" opcional e se é a principal.
 */
const manifestSchema = z
  .array(z.object({ id: z.string().uuid().optional(), file: z.string().regex(FILE_FIELD).optional(), label: z.string().max(200), start: z.string().max(10).nullable().optional(), end: z.string().max(10).nullable().optional(), primary: z.boolean() }).strict())
  .min(1)
  .max(INIA_SCENE_IMAGES.max)

const SLOT_MESSAGES = {
  SCENE_SLOT_INCOMPLETE: "informe o início e o fim da faixa (ou deixe os dois em branco)",
  SCENE_SLOT_INVALID: "use horários no formato HH:MM",
  SCENE_SLOT_EMPTY: "o início e o fim da faixa precisam ser diferentes",
} as const

/** Manifesto + arquivos → conjunto de imagens. Arquivo enviado e não referenciado (ou referenciado duas vezes) = 400. */
function imagesFrom(raw: string, files: Express.Multer.File[], options: { allowIds: boolean }): SceneImageInput[] {
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(raw)
  } catch {
    throw new DomainError("Lista de imagens inválida.", "INIA_SCENE_IMAGES_INVALID", 400)
  }
  const manifest = manifestSchema.safeParse(parsedJson)
  if (!manifest.success) throw new DomainError(`Um cenário tem de 1 a ${INIA_SCENE_IMAGES.max} imagens, cada uma com identificação.`, "INIA_SCENE_IMAGES_INVALID", 400)
  const byField = new Map(files.filter((file) => FILE_FIELD.test(file.fieldname)).map((file) => [file.fieldname, file]))
  const referenced = manifest.data.flatMap((entry) => (entry.file ? [entry.file] : []))
  if (new Set(referenced).size !== referenced.length || referenced.some((field) => !byField.has(field)) || byField.size !== referenced.length) throw new DomainError("Os arquivos enviados não correspondem à lista de imagens.", "INIA_SCENE_IMAGES_INVALID", 400)
  return manifest.data.map((entry, index) => {
    if (entry.id && !options.allowIds) throw new DomainError("Lista de imagens inválida.", "INIA_SCENE_IMAGES_INVALID", 400)
    const slot = validateSlot(entry.start, entry.end)
    if (!slot.ok) throw new DomainError(`Imagem "${entry.label.trim() || index + 1}": ${SLOT_MESSAGES[slot.code]}.`, slot.code, 422, { imageIndex: index })
    return { id: entry.id, label: entry.label, slot: slot.slot as TimeSlot | null, isPrimary: entry.primary, data: entry.file ? byField.get(entry.file)!.buffer : undefined }
  })
}
const legacyImageOf = (files: Express.Multer.File[] | undefined) => files?.find((file) => file.fieldname === "image")?.buffer
const filesOf = (request: { files?: unknown }) => (Array.isArray(request.files) ? (request.files as Express.Multer.File[]) : [])
/** Escurecimento vindo do formulário (texto): ausente = mantém/padrão; fora de 0–100 % = 422. */
function dimFrom(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const dim = normalizeDim(value)
  if (dim === null) throw new DomainError("O escurecimento precisa estar entre 0% e 100%.", "INIA_SCENE_DIM_INVALID", 422)
  return dim
}
/** Desfoque vindo do formulário (multipart = texto): ausente = mantém/padrão; fora de 0–3 px = 422. */
function blurFrom(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const blur = normalizeBlur(value)
  if (blur === null) throw new DomainError("O desfoque precisa estar entre 0 e 3 px.", "INIA_SCENE_BLUR_INVALID", 422)
  return blur
}
const idSchema = z.string().uuid()

const actorOf = (request: { user?: { organizationId: string; personId: string } }): SceneActor => ({ organizationId: request.user!.organizationId, personId: request.user!.personId })
const sceneIdOf = (value: unknown) => {
  const parsed = idSchema.safeParse(value)
  if (!parsed.success) throw new DomainError("Cenário não encontrado.", "INIA_SCENE_NOT_FOUND", 404)
  return parsed.data
}

/** `/api/v1/admin/inia-scenes` — montado atrás de `inia_experience.manage` na organização inteira (só o Administrador geral). */
export function createIniaSceneAdminRouter(db: Database, clock: Clock = () => new Date()) {
  const router = Router()

  router.get("/", async (request, response) => {
    response.json({ data: await loadScenesOverview(db, request.user!.organizationId, clock()) })
  })

  router.post("/", receiveImage, async (request, response) => {
    const input = createSchema.parse(request.body ?? {})
    const files = filesOf(request)
    const legacy = legacyImageOf(files)
    // Sem manifesto (contrato antigo): uma imagem só, principal, o dia inteiro.
    const images: SceneImageInput[] = input.images !== undefined ? imagesFrom(input.images, files, { allowIds: false }) : legacy ? [{ label: "Principal", slot: null, isPrimary: true, data: legacy }] : []
    if (images.length === 0) throw new DomainError("Envie a imagem do cenário.", "INIA_SCENE_IMAGE_REQUIRED", 422)
    const id = await createScene(db, actorOf(request), { name: input.name, period: periodFrom(input.scheduleStart, input.scheduleEnd), images, blur: blurFrom(input.blur), dim: dimFrom(input.dim) })
    response.status(201).json({ data: { id, overview: await loadScenesOverview(db, request.user!.organizationId, clock()) } })
  })

  router.patch("/:id", receiveImage, async (request, response) => {
    const sceneId = sceneIdOf(request.params.id)
    const input = updateSchema.parse(request.body ?? {})
    const files = filesOf(request)
    const period = input.schedule === "keep" ? undefined : input.schedule === "clear" ? null : periodFrom(input.scheduleStart, input.scheduleEnd)
    if (input.schedule === "set" && period === null) throw new DomainError(PERIOD_MESSAGES.SCENE_PERIOD_INCOMPLETE, "SCENE_PERIOD_INCOMPLETE", 422)
    const images = input.images !== undefined ? imagesFrom(input.images, files, { allowIds: true }) : undefined
    await updateScene(db, actorOf(request), sceneId, { name: input.name, period, images, primaryImage: images ? undefined : legacyImageOf(files), blur: blurFrom(input.blur), dim: dimFrom(input.dim) })
    response.json({ data: await loadScenesOverview(db, request.user!.organizationId, clock()) })
  })

  router.delete("/:id", async (request, response) => {
    await deleteScene(db, actorOf(request), sceneIdOf(request.params.id))
    response.json({ data: await loadScenesOverview(db, request.user!.organizationId, clock()) })
  })

  router.put("/default", async (request, response) => {
    const { sceneId } = z.object({ sceneId: idSchema.nullable() }).strict().parse(request.body ?? {})
    await setDefaultScene(db, actorOf(request), sceneId)
    response.json({ data: await loadScenesOverview(db, request.user!.organizationId, clock()) })
  })

  return router
}

type ImageFile = { mimeType: string; data: Buffer; sha256: string }
function sendImage(response: Response, image: ImageFile | null) {
  if (!image) return response.status(404).json({ error: { code: "INIA_SCENE_NOT_FOUND", message: "Cenário não encontrado." } })
  response.setHeader("content-type", image.mimeType)
  response.setHeader("content-length", image.data.length)
  response.setHeader("cache-control", "private, max-age=31536000, immutable")
  response.setHeader("x-content-type-options", "nosniff")
  response.setHeader("content-security-policy", "default-src 'none'")
  // O helmet fixa `same-origin`; a interface roda em outra porta/subdomínio do MESMO site e exibe a imagem como fundo.
  response.setHeader("cross-origin-resource-policy", "same-site")
  response.setHeader("etag", `"${image.sha256}"`)
  return response.send(image.data)
}

/**
 * `/api/v1/inia-scenes` — qualquer pessoa autenticada: o que vale AGORA na organização dela (`/current`: cenário, imagem do
 * horário e quando muda) e as imagens dos cenários da MESMA organização (fundo decorativo). A URL leva o hash da imagem:
 * cache longo sem servir imagem antiga.
 */
export function createIniaSceneRouter(db: Database, clock: Clock = () => new Date()) {
  const router = Router()

  router.get("/current", async (request, response) => {
    response.setHeader("cache-control", "private, no-store")
    response.json({ data: await loadCurrentScene(db, request.user!.organizationId, clock()) })
  })

  router.get("/images/:imageId", async (request, response) => {
    const id = idSchema.safeParse(request.params.imageId)
    return sendImage(response, id.success ? await loadSceneImage(db, request.user!.organizationId, id.data) : null)
  })

  // Endereço antigo: a imagem principal do cenário.
  router.get("/:id/image", async (request, response) => {
    const id = idSchema.safeParse(request.params.id)
    return sendImage(response, id.success ? await loadScenePrimaryImage(db, request.user!.organizationId, id.data) : null)
  })

  return router
}
