/**
 * FAIXAS DE HORÁRIO das imagens de um cenário da INIA — diárias, no fuso da organização, em minutos desde a meia-noite local.
 *
 * Regras (as mesmas na resolução, na validação e no editor):
 *  - início INCLUSIVO, fim EXCLUSIVO: 06:00–18:00 vale das 06:00 até 17:59; às 18:00 já vale a faixa seguinte;
 *  - fim antes do início = atravessa a meia-noite: 18:00–06:00 vale das 18:00 às 23:59 e das 00:00 às 05:59;
 *  - início = fim não existe (faixa vazia; o dia inteiro é "sem faixa");
 *  - as faixas de um cenário nunca se sobrepõem — no círculo das 24 h, inclusive depois da meia-noite;
 *  - horário sem faixa = a imagem PRINCIPAL do cenário.
 */

export const MINUTES_PER_DAY = 1440

/** Minutos desde a meia-noite local; `end` exclusivo; `end < start` atravessa a meia-noite. */
export type TimeSlot = { start: number; end: number }

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "HH:MM" (00:00–23:59) → minutos; qualquer outra coisa = null. */
export function parseClock(value: string): number | null {
  const match = CLOCK.exec(value.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export const formatClock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
export const describeSlot = (slot: TimeSlot) => `${formatClock(slot.start)}–${formatClock(slot.end)}`

export type SlotValidation = { ok: true; slot: TimeSlot | null } | { ok: false; code: "SCENE_SLOT_INCOMPLETE" | "SCENE_SLOT_INVALID" | "SCENE_SLOT_EMPTY" }
/** Os dois ou nenhum; horários reais; início ≠ fim. */
export function validateSlot(start: string | null | undefined, end: string | null | undefined): SlotValidation {
  const from = start?.trim() || null
  const to = end?.trim() || null
  if (!from && !to) return { ok: true, slot: null }
  if (!from || !to) return { ok: false, code: "SCENE_SLOT_INCOMPLETE" }
  const startMinute = parseClock(from)
  const endMinute = parseClock(to)
  if (startMinute === null || endMinute === null) return { ok: false, code: "SCENE_SLOT_INVALID" }
  if (startMinute === endMinute) return { ok: false, code: "SCENE_SLOT_EMPTY" }
  return { ok: true, slot: { start: startMinute, end: endMinute } }
}

export function slotCovers(slot: TimeSlot, minute: number): boolean {
  return slot.start < slot.end ? slot.start <= minute && minute < slot.end : minute >= slot.start || minute < slot.end
}

/** Trechos lineares [início, fim) do dia: um, ou dois quando atravessa a meia-noite. */
function segmentsOf(slot: TimeSlot): Array<[number, number]> {
  if (slot.start < slot.end) return [[slot.start, slot.end]]
  return [[slot.start, MINUTES_PER_DAY] as [number, number], [0, slot.end] as [number, number]].filter(([from, to]) => to > from)
}

/** Trecho em comum entre duas faixas (o primeiro do dia), ou null. */
export function slotIntersection(a: TimeSlot, b: TimeSlot): TimeSlot | null {
  for (const [aFrom, aTo] of segmentsOf(a)) {
    for (const [bFrom, bTo] of segmentsOf(b)) {
      const from = Math.max(aFrom, bFrom)
      const to = Math.min(aTo, bTo)
      if (from < to) return { start: from, end: to % MINUTES_PER_DAY }
    }
  }
  return null
}

export type SlotOverlap<K> = { a: K; b: K; overlap: TimeSlot }
/** Primeiro par de faixas que se sobrepõe (na ordem dada), com o trecho em comum. */
export function findSlotOverlap<K>(items: ReadonlyArray<{ key: K; slot: TimeSlot | null }>): SlotOverlap<K> | null {
  const slotted = items.filter((item): item is { key: K; slot: TimeSlot } => item.slot !== null)
  for (let i = 0; i < slotted.length; i++) {
    for (let j = i + 1; j < slotted.length; j++) {
      const overlap = slotIntersection(slotted[i]!.slot, slotted[j]!.slot)
      if (overlap) return { a: slotted[i]!.key, b: slotted[j]!.key, overlap }
    }
  }
  return null
}

export type SlottedImage = { id: string; isPrimary: boolean; slot: TimeSlot | null }

/** Ordem de exibição: faixas pelo horário de início; sem faixa (a principal) por último. */
export function compareImagesBySlot(a: SlottedImage, b: SlottedImage): number {
  if (a.slot && b.slot) return a.slot.start - b.slot.start || a.slot.end - b.slot.end || a.id.localeCompare(b.id)
  if (a.slot) return -1
  if (b.slot) return 1
  return Number(b.isPrimary) - Number(a.isPrimary) || a.id.localeCompare(b.id)
}

export type ResolvedImage<T extends SlottedImage> = { image: T; reason: "SLOT" | "PRIMARY" }
/** A imagem do cenário num minuto do dia: a da faixa que cobre o minuto; senão a principal. */
export function resolveImageAt<T extends SlottedImage>(images: readonly T[], minute: number): ResolvedImage<T> | null {
  // Faixas não se sobrepõem por regra; se um dado antigo sobrepuser, vence a que começa antes (ordem de exibição).
  const covering = [...images].sort(compareImagesBySlot).find((image) => image.slot !== null && slotCovers(image.slot, minute))
  if (covering) return { image: covering, reason: "SLOT" }
  const primary = images.find((image) => image.isPrimary) ?? images[0]
  return primary ? { image: primary, reason: "PRIMARY" } : null
}

/** Minutos do dia em que a imagem PODE mudar (início e fim de cada faixa), em ordem. */
export function slotBoundaries(images: readonly SlottedImage[]): number[] {
  const minutes = new Set<number>()
  for (const image of images) {
    if (!image.slot) continue
    minutes.add(image.slot.start)
    minutes.add(image.slot.end)
  }
  return [...minutes].sort((a, b) => a - b)
}

export type NextImageChange<T extends SlottedImage> = { minute: number; nextDay: boolean; image: T }
/**
 * Próxima troca de imagem DENTRO do cenário (sem olhar o período da campanha): o primeiro limite de faixa, depois de `minute`,
 * em que a imagem resolvida muda — no mesmo dia ou no seguinte. Sem faixas (uma imagem o dia inteiro) = null.
 */
export function nextImageChange<T extends SlottedImage>(images: readonly T[], minute: number): NextImageChange<T> | null {
  const current = resolveImageAt(images, minute)?.image.id ?? null
  const boundaries = slotBoundaries(images)
  const candidates = [...boundaries.filter((value) => value > minute).map((value) => ({ minute: value, nextDay: false })), ...boundaries.filter((value) => value <= minute).map((value) => ({ minute: value, nextDay: true }))]
  for (const candidate of candidates) {
    const resolved = resolveImageAt(images, candidate.minute)
    if (resolved && resolved.image.id !== current) return { ...candidate, image: resolved.image }
  }
  return null
}
