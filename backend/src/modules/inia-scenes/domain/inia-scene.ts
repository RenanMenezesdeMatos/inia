import { inspectImage, type ProfileImageMime } from "../../profile-preferences/domain/profile-image.js"
import { addDays, localDateParts, zonedTimeToIso } from "../../workflows/application/schedule-recurrence.js"
import { findSlotOverlap, formatClock, resolveImageAt, slotBoundaries, type SlottedImage, type TimeSlot } from "./scene-time-slots.js"

/**
 * CENÁRIO DA INIA — o fundo atrás do avatar (palco da aplicação de feedback e painel da INIA). Só o Administrador geral
 * configura; o colaborador só vê o que vale AGORA. Regra única (`resolveSceneAt`), usada pela leitura do colaborador e pela
 * tela de administração, sempre no fuso da organização:
 *   1. o CENÁRIO pela data local: o AGENDADO cujo período (datas inclusivas) cobre hoje; senão o PADRÃO; senão nenhum (o
 *      palco roxo de sempre). Fora do último dia da campanha volta o padrão — uma faixa noturna nunca prolonga a campanha;
 *   2. a IMAGEM do cenário pelo horário local: a da faixa que cobre o minuto (início inclusivo, fim exclusivo, faixas que
 *      atravessam a meia-noite valem dos dois lados dela); senão a principal (`scene-time-slots.ts`).
 */

export const INIA_SCENE_IMAGE_LIMITS = { maxBytes: 8 * 1024 * 1024, minWidth: 1280, minHeight: 640, maxSide: 8000 } as const
export const INIA_SCENE_NAME_MAX = 80

export type SceneImage = { mimeType: ProfileImageMime; width: number; height: number }
export type SceneImageValidation = { ok: true; image: SceneImage } | { ok: false; code: SceneImageErrorCode }
export type SceneImageErrorCode = "SCENE_IMAGE_EMPTY" | "SCENE_IMAGE_TOO_LARGE" | "SCENE_IMAGE_UNSUPPORTED_TYPE" | "SCENE_IMAGE_UNREADABLE" | "SCENE_IMAGE_TOO_SMALL" | "SCENE_IMAGE_DIMENSIONS_TOO_LARGE" | "SCENE_IMAGE_NOT_LANDSCAPE"

/** Pelo CONTEÚDO (assinatura + cabeçalho), nunca pela extensão: JPEG/PNG/WebP, paisagem (o palco é horizontal), 1280×640 no mínimo. */
export function validateSceneImage(data: Buffer): SceneImageValidation {
  if (data.length === 0) return { ok: false, code: "SCENE_IMAGE_EMPTY" }
  if (data.length > INIA_SCENE_IMAGE_LIMITS.maxBytes) return { ok: false, code: "SCENE_IMAGE_TOO_LARGE" }
  const image = inspectImage(data)
  if (image === "UNSUPPORTED") return { ok: false, code: "SCENE_IMAGE_UNSUPPORTED_TYPE" }
  if (image === "UNREADABLE") return { ok: false, code: "SCENE_IMAGE_UNREADABLE" }
  if (image.width > INIA_SCENE_IMAGE_LIMITS.maxSide || image.height > INIA_SCENE_IMAGE_LIMITS.maxSide) return { ok: false, code: "SCENE_IMAGE_DIMENSIONS_TOO_LARGE" }
  if (image.width <= image.height) return { ok: false, code: "SCENE_IMAGE_NOT_LANDSCAPE" }
  if (image.width < INIA_SCENE_IMAGE_LIMITS.minWidth || image.height < INIA_SCENE_IMAGE_LIMITS.minHeight) return { ok: false, code: "SCENE_IMAGE_TOO_SMALL" }
  return { ok: true, image }
}

export const SCENE_IMAGE_ERROR_MESSAGES: Record<SceneImageErrorCode, string> = {
  SCENE_IMAGE_EMPTY: "A imagem enviada está vazia.",
  SCENE_IMAGE_TOO_LARGE: "A imagem é grande demais (máximo de 8 MB).",
  SCENE_IMAGE_UNSUPPORTED_TYPE: "Formato não suportado. Envie JPG, PNG ou WebP.",
  SCENE_IMAGE_UNREADABLE: "Não foi possível ler a imagem enviada.",
  SCENE_IMAGE_TOO_SMALL: "A imagem é pequena demais: use pelo menos 1280×640 (recomendado 1920×1080).",
  SCENE_IMAGE_DIMENSIONS_TOO_LARGE: "As dimensões da imagem são grandes demais (no máximo 8000 px de lado).",
  SCENE_IMAGE_NOT_LANDSCAPE: "Use uma imagem horizontal (paisagem), como 1920×1080.",
}

/**
 * DESFOQUE do fundo, por cenário, em px — o mesmo no palco e no painel (só a prévia da Administração, miniatura do palco, encolhe).
 * 0 = nítido; 0,5 = foco de câmera leve (padrão). Centésimos de px (a coluna é numeric(3,2)).
 */
export const INIA_SCENE_BLUR = { min: 0, max: 3, step: 0.01, default: 0.5 } as const
export function normalizeBlur(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value.replace(",", ".")) : typeof value === "number" ? value : Number.NaN
  if (!Number.isFinite(number) || number < INIA_SCENE_BLUR.min || number > INIA_SCENE_BLUR.max) return null
  // Centésimos de px (a precisão da coluna), sem ruído de ponto flutuante (0,1 + 0,2 nunca vira 0,30000000000000004).
  return Math.round(number / INIA_SCENE_BLUR.step) / Math.round(1 / INIA_SCENE_BLUR.step)
}

/**
 * ESCURECIMENTO do fundo, por cenário, em % de uma máscara preta sobre a imagem (abaixo da INIA, dos textos e dos cards).
 * 0 = nenhuma máscara adicional (a aparência de antes); 100 = preto opaco. Inteiro (a coluna é smallint).
 */
export const INIA_SCENE_DIM = { min: 0, max: 100, step: 1, default: 0 } as const
export function normalizeDim(value: unknown): number | null {
  const text = typeof value === "string" ? value.trim().replace(/%$/, "").replace(",", ".") : null
  const number = text !== null && text !== "" ? Number(text) : typeof value === "number" ? value : Number.NaN
  if (!Number.isFinite(number) || number < INIA_SCENE_DIM.min || number > INIA_SCENE_DIM.max) return null
  return Math.round(number)
}

/** Nome sem espaços sobrando; vazio ou longo demais = inválido. */
export function normalizeSceneName(value: string): string | null {
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim()
  return name.length >= 1 && name.length <= INIA_SCENE_NAME_MAX ? name : null
}

/** Datas locais `YYYY-MM-DD` (inclusivas). */
export type ScenePeriod = { start: string; end: string }
const DATE = /^\d{4}-\d{2}-\d{2}$/
const isRealDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)

export type PeriodValidation = { ok: true; period: ScenePeriod | null } | { ok: false; code: "SCENE_PERIOD_INCOMPLETE" | "SCENE_PERIOD_INVALID" | "SCENE_PERIOD_INVERTED" }
/** Os dois ou nenhum; datas reais; fim ≥ início. */
export function validatePeriod(start: string | null | undefined, end: string | null | undefined): PeriodValidation {
  const from = start?.trim() || null
  const to = end?.trim() || null
  if (!from && !to) return { ok: true, period: null }
  if (!from || !to) return { ok: false, code: "SCENE_PERIOD_INCOMPLETE" }
  if (!isRealDate(from) || !isRealDate(to)) return { ok: false, code: "SCENE_PERIOD_INVALID" }
  if (to < from) return { ok: false, code: "SCENE_PERIOD_INVERTED" }
  return { ok: true, period: { start: from, end: to } }
}

export const overlaps = (a: ScenePeriod, b: ScenePeriod) => a.start <= b.end && b.start <= a.end

/** Data local (YYYY-MM-DD) de um instante no fuso IANA da organização. */
export function localDateOf(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant)
}

/** Data e minuto do dia LOCAIS de um instante no fuso da organização. */
export type LocalMoment = { date: string; minute: number }
export function localMomentOf(instant: Date, timeZone: string): LocalMoment {
  const parts = localDateParts(instant, timeZone)
  const [hour, minute] = parts.time.split(":").map(Number) as [number, number]
  return { date: parts.date, minute: hour * 60 + minute }
}
/** Instante de uma data + minuto locais no fuso da organização. */
export const instantOf = (moment: LocalMoment, timeZone: string) => new Date(zonedTimeToIso(moment.date, formatClock(moment.minute), timeZone))

export type SceneForResolution = { id: string; period: ScenePeriod | null; updatedAt: Date }
export type ResolvedScene<T extends SceneForResolution> = { scene: T; reason: "SCHEDULED" | "DEFAULT" }

/** O cenário de uma DATA local (sem olhar o horário). */
export function resolveCurrentScene<T extends SceneForResolution>(scenes: readonly T[], defaultSceneId: string | null, today: string): ResolvedScene<T> | null {
  // Períodos não se sobrepõem por regra; se algum dado antigo sobrepuser, vale o período que começou por último (o mais específico).
  const scheduled = scenes
    .filter((scene) => scene.period && scene.period.start <= today && today <= scene.period.end)
    .sort((a, b) => b.period!.start.localeCompare(a.period!.start) || b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  if (scheduled) return { scene: scheduled, reason: "SCHEDULED" }
  const fallback = defaultSceneId ? scenes.find((scene) => scene.id === defaultSceneId) : undefined
  return fallback ? { scene: fallback, reason: "DEFAULT" } : null
}

export type SceneWithImages = SceneForResolution & { images: readonly SlottedImage[] }
export type ImageOf<S extends SceneWithImages> = S["images"][number]
export type ResolvedMoment<S extends SceneWithImages> = { scene: S; image: ImageOf<S>; reason: "SCHEDULED" | "DEFAULT"; imageReason: "SLOT" | "PRIMARY" }

/** O cenário E a imagem num momento local: o cenário pela data, a imagem pelo minuto do dia. */
export function resolveSceneAt<S extends SceneWithImages>(scenes: readonly S[], defaultSceneId: string | null, moment: LocalMoment): ResolvedMoment<S> | null {
  const scene = resolveCurrentScene(scenes, defaultSceneId, moment.date)
  if (!scene) return null
  const image = resolveImageAt<ImageOf<S>>(scene.scene.images, moment.minute)
  return image ? { scene: scene.scene, image: image.image, reason: scene.reason, imageReason: image.reason } : null
}

/** Quanto à frente procurar a próxima troca (cobre de um ano para o outro). */
export const NEXT_CHANGE_HORIZON_DAYS = 400

export type NextSceneChange<S extends SceneWithImages> = { at: Date; moment: LocalMoment; resolved: ResolvedMoment<S> | null }
/**
 * PRÓXIMA TROCA do que o colaborador vê (outro cenário ou outra imagem), depois de `now`. O cenário só muda à meia-noite local
 * e a imagem só num limite de faixa: basta olhar a meia-noite de cada dia e os limites das faixas do cenário daquele dia.
 * Nada muda no horizonte = null.
 */
export function nextSceneChange<S extends SceneWithImages>(scenes: readonly S[], defaultSceneId: string | null, now: Date, timeZone: string, horizonDays = NEXT_CHANGE_HORIZON_DAYS): NextSceneChange<S> | null {
  const start = localMomentOf(now, timeZone)
  const keyOf = (resolved: ResolvedMoment<S> | null) => (resolved ? `${resolved.scene.id}:${resolved.image.id}` : "none")
  const currentKey = keyOf(resolveSceneAt(scenes, defaultSceneId, start))
  for (let offset = 0; offset <= horizonDays; offset++) {
    const date = offset === 0 ? start.date : addDays(start.date, offset)
    const scene = resolveCurrentScene(scenes, defaultSceneId, date)
    const minutes = [...new Set([0, ...(scene ? slotBoundaries(scene.scene.images) : [])])].filter((minute) => offset > 0 || minute > start.minute).sort((a, b) => a - b)
    for (const minute of minutes) {
      const moment = { date, minute }
      const resolved = resolveSceneAt(scenes, defaultSceneId, moment)
      if (keyOf(resolved) !== currentKey) return { at: instantOf(moment, timeZone), moment, resolved }
    }
  }
  return null
}

/**
 * ORDEM da listagem: agendados pela data de início (ano completo: 29/12/2025 vem antes de 16/02/2026), depois data final,
 * nome e id (estável); os sem período depois, por nome e id. O destaque do cenário padrão é da tela, não da ordem.
 */
export function compareScenesForListing(a: { id: string; name: string; period: ScenePeriod | null }, b: { id: string; name: string; period: ScenePeriod | null }): number {
  if (a.period && !b.period) return -1
  if (!a.period && b.period) return 1
  if (a.period && b.period) {
    const byPeriod = a.period.start.localeCompare(b.period.start) || a.period.end.localeCompare(b.period.end)
    if (byPeriod) return byPeriod
  }
  return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }) || a.id.localeCompare(b.id)
}

/** Limites do conjunto de imagens de um cenário. */
export const INIA_SCENE_IMAGES = { min: 1, max: 8, labelMax: 40 } as const

export function normalizeImageLabel(value: string): string | null {
  const label = value.normalize("NFC").replace(/\s+/g, " ").trim()
  return label.length >= 1 && label.length <= INIA_SCENE_IMAGES.labelMax ? label : null
}

export type ImagePlanEntry = { key: string; label: string; isPrimary: boolean; slot: TimeSlot | null }
export type ImagePlanError =
  | { code: "INIA_SCENE_IMAGES_COUNT"; message: string }
  | { code: "INIA_SCENE_IMAGE_LABEL_INVALID"; message: string; key: string }
  | { code: "INIA_SCENE_IMAGE_LABEL_TAKEN"; message: string; key: string }
  | { code: "INIA_SCENE_PRIMARY_IMAGE_REQUIRED"; message: string }
  | { code: "INIA_SCENE_IMAGE_SLOT_OVERLAP"; message: string; keys: [string, string]; overlap: { start: string; end: string } }

/**
 * O conjunto de imagens que vai ser salvo: 1..8 imagens, identificação única (sem diferenciar maiúsculas), exatamente uma
 * principal e faixas sem sobreposição. A mensagem nomeia o conflito ("Dia" e "Noite" se sobrepõem das 17:00 às 18:00).
 */
export function validateImagePlan(entries: readonly ImagePlanEntry[]): ImagePlanError | null {
  if (entries.length < INIA_SCENE_IMAGES.min || entries.length > INIA_SCENE_IMAGES.max) return { code: "INIA_SCENE_IMAGES_COUNT", message: `Um cenário tem de 1 a ${INIA_SCENE_IMAGES.max} imagens.` }
  const seen = new Map<string, string>()
  for (const entry of entries) {
    if (normalizeImageLabel(entry.label) !== entry.label) return { code: "INIA_SCENE_IMAGE_LABEL_INVALID", message: `Identifique cada imagem com até ${INIA_SCENE_IMAGES.labelMax} caracteres (ex.: Dia, Noite).`, key: entry.key }
    const folded = entry.label.toLocaleLowerCase("pt-BR")
    if (seen.has(folded)) return { code: "INIA_SCENE_IMAGE_LABEL_TAKEN", message: `Duas imagens estão identificadas como "${entry.label}". Use nomes diferentes.`, key: entry.key }
    seen.set(folded, entry.key)
  }
  if (entries.filter((entry) => entry.isPrimary).length !== 1) return { code: "INIA_SCENE_PRIMARY_IMAGE_REQUIRED", message: "Escolha exatamente uma imagem principal (ela vale nos horários sem faixa)." }
  const overlap = findSlotOverlap(entries.map((entry) => ({ key: entry, slot: entry.slot })))
  if (overlap) {
    const range = { start: formatClock(overlap.overlap.start), end: formatClock(overlap.overlap.end) }
    return { code: "INIA_SCENE_IMAGE_SLOT_OVERLAP", message: `Os horários de "${overlap.a.label}" e "${overlap.b.label}" se sobrepõem das ${range.start} às ${range.end}. Ajuste as faixas para não coincidirem.`, keys: [overlap.a.key, overlap.b.key], overlap: range }
  }
  return null
}

/** Situação de cada cenário na tela de administração (o que o colaborador vê hoje, o que vem depois, o que já passou). */
export type SceneStatus = "LIVE" | "UPCOMING" | "ENDED" | "STANDBY"
export function sceneStatusOf(scene: SceneForResolution, current: SceneForResolution | null, today: string): SceneStatus {
  if (current && current.id === scene.id) return "LIVE"
  if (scene.period && scene.period.start > today) return "UPCOMING"
  if (scene.period && scene.period.end < today) return "ENDED"
  return "STANDBY"
}

/** URL de UMA imagem (o hash vai na URL: cache longo sem servir a imagem antiga). */
export const sceneImageUrl = (imageId: string, sha256: string) => `/api/v1/inia-scenes/images/${imageId}?v=${sha256.slice(0, 16)}`
