import { z } from "zod"

/**
 * Validação no navegador ANTES de processar (o backend revalida pelo conteúdo). O arquivo original nunca é enviado: o
 * editor reencoda a capa (reduzida) e o recorte da foto em WebP/JPEG, e só isso vai para a API.
 */
export const PROFILE_COVER_MAX_BYTES = 10 * 1024 * 1024
export const PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const PROFILE_COVER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const
export const PROFILE_IMAGE_ACCEPT = PROFILE_COVER_MIME_TYPES.join(",")

const imageFile = (maxBytes: number) =>
  z
    .custom<File>((value) => typeof File !== "undefined" && value instanceof File, "Arquivo inválido.")
    .refine((file) => PROFILE_COVER_MIME_TYPES.includes(file.type as (typeof PROFILE_COVER_MIME_TYPES)[number]), "Use uma imagem JPEG, PNG, WebP ou AVIF.")
    .refine((file) => file.size <= maxBytes, `A imagem deve ter no máximo ${Math.round(maxBytes / (1024 * 1024))} MB.`)

export const profileCoverFileSchema = imageFile(PROFILE_COVER_MAX_BYTES)
export const profilePhotoFileSchema = imageFile(PROFILE_PHOTO_MAX_BYTES)

/** Dimensões mínimas, conferidas depois de ler a imagem (o backend aplica os mesmos mínimos ao resultado). */
export const PROFILE_PHOTO_MIN_SIDE = 128
export const PROFILE_COVER_MIN = { width: 600, height: 150 }
