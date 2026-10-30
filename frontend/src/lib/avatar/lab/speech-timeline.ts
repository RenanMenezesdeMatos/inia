import type { AlignedPhone, AudioFeatureFrame, LipsyncDebugSnapshot } from "@/lib/avatar/lipsync/types"

/**
 * Linha do tempo do diagnóstico do laboratório: energia do áudio analisado + fones alinhados (texto
 * × áudio) nos últimos segundos, com o cursor no instante OUVIDO. Tudo no relógio do AudioContext
 * de reprodução — o mesmo que o avatar amostra. Funções puras + um desenho em Canvas 2D (sem React).
 */

export type TimelineWindow = { start: number; end: number; cursor: number }

/** Janela que termina um pouco à frente do ouvido: dá para ver o que já foi alinhado adiante. */
export function timelineWindow(heard: number, pastSeconds = 5, futureSeconds = 1): TimelineWindow {
  return { start: heard - pastSeconds, end: heard + futureSeconds, cursor: heard }
}

export function timeToX(time: number, span: TimelineWindow, width: number): number {
  return ((time - span.start) / (span.end - span.start)) * width
}

/** dBFS → 0..1 para desenhar (−60 dB = 0). */
export function energyLevel(energyDb: number): number {
  return Math.min(1, Math.max(0, (energyDb + 60) / 60))
}

/** Fone que cobre `time` (a lista vem ordenada por início: consolidados e depois provisórios). */
export function alignedPhoneAt(phones: readonly AlignedPhone[], time: number): AlignedPhone | null {
  for (let i = phones.length - 1; i >= 0; i--) {
    const phone = phones[i]!
    if (phone.start <= time) return time < phone.end ? phone : null
  }
  return null
}

/**
 * "No meio da palavra": o fone ouvido não é pausa e a MESMA palavra tem fone antes e depois dele.
 * Usado para cortar a INIA num ponto em que a boca está articulando (o pior caso para o barge-in).
 */
export function isMidWord(phones: readonly AlignedPhone[], time: number): boolean {
  for (let i = phones.length - 1; i >= 0; i--) {
    const phone = phones[i]!
    if (phone.start > time) continue
    if (time >= phone.end || phone.phone === "_") return false
    const before = phones[i - 1]
    const after = phones[i + 1]
    return Boolean(before && after && before.wordIndex === phone.wordIndex && after.wordIndex === phone.wordIndex && before.phone !== "_" && after.phone !== "_")
  }
  return false
}

/** Energia no instante (quadro de análise mais próximo, sem interpolar). `null` fora do analisado. */
export function energyAt(frames: readonly AudioFeatureFrame[], time: number): number | null {
  if (frames.length === 0 || time < frames[0]!.time || time > frames[frames.length - 1]!.time) return null
  let low = 0
  let high = frames.length - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if (frames[mid]!.time < time) low = mid + 1
    else high = mid
  }
  const previous = frames[Math.max(0, low - 1)]!
  const chosen = Math.abs(previous.time - time) < Math.abs(frames[low]!.time - time) ? previous : frames[low]!
  return energyLevel(chosen.energyDb)
}

export type TimelineColors = {
  energy: string
  aligned: string
  audioOnly: string
  pause: string
  text: string
  cursor: string
  marker: string
}

export const DEFAULT_TIMELINE_COLORS: TimelineColors = {
  energy: "rgba(56, 189, 248, 0.45)",
  aligned: "rgba(139, 92, 246, 0.75)",
  audioOnly: "rgba(245, 158, 11, 0.75)",
  pause: "rgba(148, 163, 184, 0.35)",
  text: "#f8fafc",
  cursor: "#ef4444",
  marker: "rgba(148, 163, 184, 0.9)",
}

/**
 * Desenha a janela: área de energia (topo), fones (faixa de baixo, rótulo quando cabe), marcas de
 * até onde o áudio foi analisado (A) e o texto alinhado (T), segundos e o cursor do ouvido.
 * `snapshot` nulo ou `heard` nulo = fundo vazio (nada tocando).
 */
export function drawSpeechTimeline(
  ctx: CanvasRenderingContext2D,
  snapshot: LipsyncDebugSnapshot | null,
  heard: number | null,
  size: { width: number; height: number },
  colors: TimelineColors = DEFAULT_TIMELINE_COLORS,
): void {
  const { width, height } = size
  ctx.clearRect(0, 0, width, height)
  if (!snapshot || heard === null) return
  const span = timelineWindow(heard)
  const energyHeight = Math.round(height * 0.58)
  const phoneTop = energyHeight + 6
  const phoneHeight = height - phoneTop - 14

  // Energia: um ponto por pixel no máximo (a resposta longa tem milhares de quadros).
  ctx.fillStyle = colors.energy
  ctx.beginPath()
  ctx.moveTo(0, energyHeight)
  let drawn = false
  let lastX = -1
  for (const frame of snapshot.frames) {
    if (frame.time < span.start || frame.time > span.end) continue
    const x = timeToX(frame.time, span, width)
    if (x - lastX < 1) continue
    lastX = x
    ctx.lineTo(x, energyHeight - energyLevel(frame.energyDb) * (energyHeight - 4))
    drawn = true
  }
  if (drawn) {
    ctx.lineTo(lastX, energyHeight)
    ctx.closePath()
    ctx.fill()
  }

  ctx.font = "10px ui-monospace, monospace"
  ctx.textBaseline = "middle"
  for (const phone of snapshot.phones) {
    if (phone.end < span.start || phone.start > span.end) continue
    const x0 = Math.max(0, timeToX(phone.start, span, width))
    const x1 = Math.min(width, timeToX(phone.end, span, width))
    ctx.fillStyle = phone.phone === "_" ? colors.pause : phone.source === "aligned" ? colors.aligned : colors.audioOnly
    ctx.fillRect(x0, phoneTop, Math.max(1, x1 - x0 - 1), phoneHeight)
    if (phone.phone !== "_" && x1 - x0 >= 12) {
      ctx.fillStyle = colors.text
      ctx.fillText(phone.stressed ? `${phone.phone}ˈ` : phone.phone, x0 + 2, phoneTop + phoneHeight / 2)
    }
  }

  ctx.fillStyle = colors.marker
  ctx.textBaseline = "alphabetic"
  for (let second = Math.ceil(span.start); second <= span.end; second++) {
    ctx.fillRect(timeToX(second, span, width), height - 10, 1, 4)
    ctx.fillText(`${second}s`, timeToX(second, span, width) + 2, height - 2)
  }
  const marks: Array<[number, string]> = [
    [snapshot.analyzedUntil, "A"],
    [snapshot.alignedUntil, "T"],
  ]
  ctx.setLineDash([3, 3])
  ctx.strokeStyle = colors.marker
  for (const [time, name] of marks) {
    if (time < span.start || time > span.end) continue
    const x = timeToX(time, span, width)
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height - 12)
    ctx.stroke()
    ctx.fillText(name, x + 2, 10)
  }
  ctx.setLineDash([])
  ctx.fillStyle = colors.cursor
  ctx.fillRect(timeToX(span.cursor, span, width) - 1, 0, 2, height)
}
