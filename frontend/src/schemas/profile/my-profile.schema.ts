import { z } from "zod"

/**
 * Apresentação da pessoa (preferências pessoais × cadastro profissional). O backend é a fonte ÚNICA da resolução entre nome
 * cadastral e nome preferido: a tela só lê `displayName` (identificação) e `addressName` (saudação), nunca deriva de novo.
 */
export const COVER_PRESETS = ["inia", "aurora", "nature", "neutral"] as const
export type CoverPreset = (typeof COVER_PRESETS)[number]
export const DEFAULT_COVER_PRESET: CoverPreset = "inia"

export const PREFERRED_NAME_MAX_LENGTH = 60

export const coverPresentationSchema = z.object({
  kind: z.enum(["DEFAULT", "PRESET", "CUSTOM"]),
  preset: z.enum(COVER_PRESETS),
  imageUrl: z.string().nullable(),
})
export type CoverPresentation = z.infer<typeof coverPresentationSchema>
export const DEFAULT_COVER: CoverPresentation = { kind: "DEFAULT", preset: DEFAULT_COVER_PRESET, imageUrl: null }

export const personPresentationSchema = z.object({
  personId: z.string(),
  registeredName: z.string(),
  preferredName: z.string().nullable(),
  displayName: z.string(),
  addressName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  avatarSource: z.enum(["CUSTOM", "CORPORATE", "NONE"]),
  cover: coverPresentationSchema,
})
export type PersonPresentation = z.infer<typeof personPresentationSchema>

export const myProfileSchema = personPresentationSchema.extend({
  professional: z.object({ jobTitle: z.string().nullable(), teamName: z.string().nullable(), matricula: z.string().nullable() }),
  updatedAt: z.string().nullable(),
})
export type MyProfile = z.infer<typeof myProfileSchema>

/**
 * Espelho da regra do backend (`normalizePreferredName`) para validar ANTES de enviar — o backend continua sendo a
 * autoridade. Preserva composto, acentos e a forma escolhida; só normaliza espaços.
 */
const PREFERRED_NAME_PATTERN = /^[\p{L}\p{M}]+(?:[ '’.-]+[\p{L}\p{M}]+)*\.?$/u
export function normalizePreferredName(input: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = input.normalize("NFC").replace(/\s+/gu, " ").trim()
  if (!value) return { ok: true, value: null }
  if ([...value].length > PREFERRED_NAME_MAX_LENGTH) return { ok: false, message: `Use no máximo ${PREFERRED_NAME_MAX_LENGTH} caracteres.` }
  if (!PREFERRED_NAME_PATTERN.test(value)) return { ok: false, message: "Use apenas letras, espaços, apóstrofo, hífen ou ponto." }
  return { ok: true, value }
}

/** Primeiro nome do cadastro — o fallback de saudação quando a pessoa não escolheu um nome (mesma regra do backend). */
export function registeredFirstNameOf(registeredName: string): string {
  return registeredName.trim().split(/\s+/u)[0] ?? registeredName
}

/** Iniciais para o avatar sem foto — do nome EXIBIDO (o que a pessoa escolheu). */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("pt-BR") ?? "")
    .join("")
}

/** Linha profissional (cargo · equipe) sem repetir a equipe quando o cargo do cadastro já a traz. */
export function professionalLineOf(jobTitle: string | null | undefined, teamName: string | null | undefined): string {
  const teamInTitle = Boolean(teamName && jobTitle?.includes(teamName))
  return [jobTitle, teamInTitle ? null : teamName].filter(Boolean).join(" · ")
}
