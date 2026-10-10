/**
 * Faixas de horário das imagens de um cenário da INIA — ESPELHO de `backend/src/modules/inia-scenes/domain/scene-time-slots.ts`
 * para o editor antecipar (o backend continua a autoridade: valida de novo e resolve o que o colaborador vê).
 *
 *  - minutos desde a meia-noite LOCAL da organização; início inclusivo, fim exclusivo (às 18:00 já vale a faixa seguinte);
 *  - fim antes do início = atravessa a meia-noite (18:00–06:00); início = fim não existe;
 *  - faixas não se sobrepõem no círculo das 24 h; horário sem faixa = a imagem principal.
 */

export const MINUTES_PER_DAY = 1440
export type TimeSlot = { start: number; end: number }

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/
export function parseClock(value: string): number | null {
  const match = CLOCK.exec(value.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
export const formatClock = (minute: number) => `${String(Math.floor(minute / 60) % 24).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`

export type SlotCheck = { ok: true; slot: TimeSlot | null } | { ok: false; message: string }
/** Os dois ou nenhum; horários reais; início ≠ fim. Mensagens como as do backend. */
export function checkSlot(start: string, end: string): SlotCheck {
  const from = start.trim()
  const to = end.trim()
  if (!from && !to) return { ok: true, slot: null }
  if (!from || !to) return { ok: false, message: "Informe o início e o fim da faixa (ou deixe os dois em branco)." }
  const startMinute = parseClock(from)
  const endMinute = parseClock(to)
  if (startMinute === null || endMinute === null) return { ok: false, message: "Use horários no formato HH:MM." }
  if (startMinute === endMinute) return { ok: false, message: "O início e o fim da faixa precisam ser diferentes." }
  return { ok: true, slot: { start: startMinute, end: endMinute } }
}

export const crossesMidnight = (slot: TimeSlot) => slot.end < slot.start

export function slotCovers(slot: TimeSlot, minute: number): boolean {
  return slot.start < slot.end ? slot.start <= minute && minute < slot.end : minute >= slot.start || minute < slot.end
}

function segmentsOf(slot: TimeSlot): Array<[number, number]> {
  if (slot.start < slot.end) return [[slot.start, slot.end]]
  return ([[slot.start, MINUTES_PER_DAY], [0, slot.end]] as Array<[number, number]>).filter(([from, to]) => to > from)
}

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

/** Ordem de exibição: faixas pelo horário de início; sem faixa por último (a principal primeiro). */
export function compareImagesBySlot(a: SlottedImage, b: SlottedImage): number {
  if (a.slot && b.slot) return a.slot.start - b.slot.start || a.slot.end - b.slot.end
  if (a.slot) return -1
  if (b.slot) return 1
  return Number(b.isPrimary) - Number(a.isPrimary)
}

export function resolveImageAt<T extends SlottedImage>(images: readonly T[], minute: number): { image: T; reason: "SLOT" | "PRIMARY" } | null {
  const covering = [...images].sort(compareImagesBySlot).find((image) => image.slot !== null && slotCovers(image.slot, minute))
  if (covering) return { image: covering, reason: "SLOT" }
  const primary = images.find((image) => image.isPrimary) ?? images[0]
  return primary ? { image: primary, reason: "PRIMARY" } : null
}

export function nextImageChange<T extends SlottedImage>(images: readonly T[], minute: number): { minute: number; nextDay: boolean; image: T } | null {
  const current = resolveImageAt(images, minute)?.image.id ?? null
  const boundaries = [...new Set(images.flatMap((image) => (image.slot ? [image.slot.start, image.slot.end] : [])))].sort((a, b) => a - b)
  const candidates = [...boundaries.filter((value) => value > minute).map((value) => ({ minute: value, nextDay: false })), ...boundaries.filter((value) => value <= minute).map((value) => ({ minute: value, nextDay: true }))]
  for (const candidate of candidates) {
    const resolved = resolveImageAt(images, candidate.minute)
    if (resolved && resolved.image.id !== current) return { ...candidate, image: resolved.image }
  }
  return null
}

/** Trechos do dia SEM faixa (onde vale a principal), pelo horário de início. Sem nenhuma faixa = []. */
export function uncoveredRanges(slots: readonly TimeSlot[]): TimeSlot[] {
  if (slots.length === 0) return []
  const covered = new Array<boolean>(MINUTES_PER_DAY).fill(false)
  for (const slot of slots) for (const [from, to] of segmentsOf(slot)) for (let minute = from; minute < to; minute++) covered[minute] = true
  const gaps: TimeSlot[] = []
  let start: number | null = null
  for (let minute = 0; minute <= MINUTES_PER_DAY; minute++) {
    const free = minute < MINUTES_PER_DAY && !covered[minute]
    if (free && start === null) start = minute
    if (!free && start !== null) {
      gaps.push({ start, end: minute % MINUTES_PER_DAY })
      start = null
    }
  }
  // Um trecho que termina à meia-noite e outro que começa nela são o mesmo (ex.: 20:00–06:00).
  if (gaps.length > 1 && gaps[0]!.start === 0 && gaps[gaps.length - 1]!.end === 0) {
    const last = gaps.pop()!
    gaps[0] = { start: last.start, end: gaps[0]!.end }
  }
  return gaps.sort((a, b) => a.start - b.start)
}

/** Minuto do dia AGORA no fuso da organização (a administração usa o fuso da organização, não o do navegador). */
export function localMinuteIn(timeZone: string, instant: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(instant)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0)
  return value("hour") * 60 + value("minute")
}
