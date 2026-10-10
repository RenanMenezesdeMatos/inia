import { Router, type RequestHandler } from "express"
import multer from "multer"
import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { COVER_PRESETS } from "../domain/person-presentation.js"
import { PROFILE_IMAGE_LIMITS } from "../domain/profile-image.js"
import { loadMyProfile, loadProfileImage, updateMyProfile, type AvatarChange, type CoverChange } from "../application/profile-preferences-service.js"

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PROFILE_IMAGE_LIMITS.COVER.maxBytes, files: 2, fields: 8 } }).fields([
  { name: "avatar", maxCount: 1 },
  { name: "cover", maxCount: 1 },
])

/** Multer devolve o próprio erro (tamanho, campo inesperado); aqui ele vira o erro de domínio que a tela sabe mostrar. */
const receiveImages: RequestHandler = (request, response, next) => {
  upload(request, response, (error: unknown) => {
    if (!error) return next()
    if (error instanceof multer.MulterError) {
      if (error.code === "LIMIT_FILE_SIZE") return next(new DomainError("A imagem é grande demais.", "IMAGE_TOO_LARGE", 422))
      return next(new DomainError("Envio de imagem inválido.", "PROFILE_UPLOAD_INVALID", 400, { reason: error.code }))
    }
    return next(error)
  })
}

// Estrito: nome cadastral, matrícula, cargo, equipe, hierarquia, permissões ou qualquer id de pessoa são RECUSADOS (400) —
// este formulário só altera as preferências pessoais de quem está na sessão.
const updateSchema = z
  .object({
    preferredName: z.string().max(400).optional(),
    avatar: z.enum(["keep", "remove", "replace"]).default("keep"),
    cover: z.enum(["keep", "default", "preset", "custom"]).default("keep"),
    coverPreset: z.enum(COVER_PRESETS).optional(),
  })
  .strict()

/** `/api/v1/me/profile` — só a pessoa da sessão (não há parâmetro de pessoa). */
export function createMyProfileRouter(db: Database) {
  const router = Router()
  const ownerOf = (request: { user?: { organizationId: string; personId: string; sub: string } }) => ({ organizationId: request.user!.organizationId, personId: request.user!.personId, accountId: request.user!.sub })

  router.get("/", async (request, response) => {
    response.json({ data: await loadMyProfile(db, ownerOf(request)) })
  })

  router.put("/", receiveImages, async (request, response) => {
    const input = updateSchema.parse(request.body ?? {})
    const files = (request.files ?? {}) as Record<string, Express.Multer.File[] | undefined>
    const avatarFile = files.avatar?.[0]
    const coverFile = files.cover?.[0]

    let avatar: AvatarChange = { action: "KEEP" }
    if (input.avatar === "remove") avatar = { action: "REMOVE" }
    if (input.avatar === "replace") {
      if (!avatarFile) throw new DomainError("Envie a foto para substituir a atual.", "PROFILE_AVATAR_FILE_REQUIRED", 422)
      avatar = { action: "REPLACE", data: avatarFile.buffer }
    }
    let cover: CoverChange = { action: "KEEP" }
    if (input.cover === "default") cover = { action: "DEFAULT" }
    if (input.cover === "preset") {
      if (!input.coverPreset) throw new DomainError("Escolha uma das capas.", "PROFILE_COVER_INVALID", 422)
      cover = { action: "PRESET", preset: input.coverPreset }
    }
    if (input.cover === "custom") {
      if (!coverFile) throw new DomainError("Envie a imagem da capa.", "PROFILE_COVER_FILE_REQUIRED", 422)
      cover = { action: "CUSTOM", data: coverFile.buffer }
    }
    // Arquivo sem a ação correspondente é ambíguo: recusado, nunca gravado "por engano".
    if ((avatarFile && input.avatar !== "replace") || (coverFile && input.cover !== "custom")) throw new DomainError("Envio de imagem inválido.", "PROFILE_UPLOAD_INVALID", 400)

    response.json({ data: await updateMyProfile(db, ownerOf(request), { preferredName: input.preferredName, avatar, cover }) })
  })

  return router
}

/**
 * `/api/v1/profile-images/:id` — foto e capa de qualquer pessoa da MESMA organização (a foto aparece para quem vê o perfil).
 * Só imagens EM USO por uma preferência são servidas; ids são imutáveis (trocar a foto cria outro id), por isso o cache longo.
 */
export function createProfileImageRouter(db: Database) {
  const router = Router()
  router.get("/:id", async (request, response) => {
    const id = z.string().uuid().safeParse(request.params.id)
    const image = id.success ? await loadProfileImage(db, request.user!.organizationId, id.data) : null
    if (!image) return response.status(404).json({ error: { code: "PROFILE_IMAGE_NOT_FOUND", message: "Imagem não encontrada." } })
    response.setHeader("content-type", image.mimeType)
    response.setHeader("content-length", image.data.length)
    response.setHeader("cache-control", "private, max-age=31536000, immutable")
    response.setHeader("x-content-type-options", "nosniff")
    response.setHeader("content-security-policy", "default-src 'none'")
    // O helmet fixa `same-origin`; a interface roda em outra porta/subdomínio do MESMO site e exibe a imagem num <img>.
    response.setHeader("cross-origin-resource-policy", "same-site")
    response.setHeader("etag", `"${image.sha256}"`)
    return response.send(image.data)
  })
  return router
}
