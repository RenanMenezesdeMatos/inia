import type { JourneyBlock } from "@/schemas/my-journey/my-journey.schema"

import { formatDuration, minuteToClock } from "./journey-format"

/**
 * MARCOS E MOMENTOS da "Minha jornada" — leitura pura dos blocos que o backend montou (nada é decidido aqui).
 *
 * Padrão das ferramentas de escala e de calendário (pesquisa de 17/11/2026): barra proporcional ao tempo com a pausa em cor própria e
 * a linha do "agora", e, para a própria pessoa, uma LISTA com os horários de cada mudança. Por isso a tela mostra os MARCOS — login,
 * pausa, retorno, logout — em texto, sempre visíveis; o tooltip da barra só complementa (nunca é o único lugar de uma informação).
 */
export type JourneyMilestoneKind = "LOGIN" | "SHIFT_START" | "BREAK" | "ACTIVITY" | "RETURN" | "LOGOUT" | "SHIFT_END" | "CONTINUES" | "OVERNIGHT"

export type JourneyMilestone = {
  minute: number
  kind: JourneyMilestoneKind
  title: string
  detail: string | null
  /** Bloco que começa (ou termina, em LOGOUT/SHIFT_END) neste marco. */
  block: JourneyBlock
}

const WORK_KINDS = new Set<JourneyBlock["kind"]>(["SHIFT", "LOGGED_IN", "BREAK", "OTHER"])

export function workBlocks(blocks: JourneyBlock[]): JourneyBlock[] {
  return blocks.filter((block) => WORK_KINDS.has(block.kind)).sort((a, b) => a.startMinute - b.startMinute)
}

function untilText(block: JourneyBlock): string {
  return block.endMinute === 1440 ? "até a meia-noite" : `até ${minuteToClock(block.endMinute)}`
}

/** Login, pausas (com retorno), outras atividades e logout, na ordem do dia. */
export function journeyMilestones(blocks: JourneyBlock[]): JourneyMilestone[] {
  const work = workBlocks(blocks)
  const milestones: JourneyMilestone[] = []
  work.forEach((block, index) => {
    const previous = work[index - 1]
    const next = work[index + 1]
    const joinedBefore = previous !== undefined && previous.endMinute === block.startMinute
    const joinedAfter = next !== undefined && next.startMinute === block.endMinute
    const duration = formatDuration(block.endMinute - block.startMinute)
    if (block.continuesFromPreviousDay && block.startMinute === 0) {
      milestones.push({ minute: 0, kind: "CONTINUES", title: block.kind === "BREAK" ? `${block.label} (começou ontem)` : "Jornada que começou ontem", detail: untilText(block), block })
    } else if (block.kind === "BREAK") {
      milestones.push({ minute: block.startMinute, kind: "BREAK", title: block.label, detail: `Pausa de ${duration} · volta às ${minuteToClock(block.endMinute)}`, block })
    } else if (block.kind === "OTHER") {
      milestones.push({ minute: block.startMinute, kind: "ACTIVITY", title: block.label, detail: `${duration} · ${untilText(block)}`, block })
    } else if (joinedBefore && (previous.kind === "BREAK" || previous.kind === "OTHER")) {
      milestones.push({ minute: block.startMinute, kind: "RETURN", title: "Retorno", detail: block.kind === "LOGGED_IN" ? "Volta a ficar logado para atendimento" : "Volta à jornada", block })
    } else if (!joinedBefore) {
      milestones.push({ minute: block.startMinute, kind: block.kind === "LOGGED_IN" ? "LOGIN" : "SHIFT_START", title: block.kind === "LOGGED_IN" ? "Login" : "Entrada", detail: block.kind === "LOGGED_IN" ? "Início do atendimento" : "Início da jornada prevista", block })
    }
    if (joinedAfter) return
    if (block.continuesNextDay) {
      milestones.push({ minute: 1440, kind: "OVERNIGHT", title: "Segue depois da meia-noite", detail: "A jornada continua no dia seguinte", block })
      return
    }
    if (block.kind === "LOGGED_IN") milestones.push({ minute: block.endMinute, kind: "LOGOUT", title: "Logout", detail: "Fim do atendimento", block })
    else if (block.kind === "SHIFT") milestones.push({ minute: block.endMinute, kind: "SHIFT_END", title: "Saída", detail: "Fim da jornada prevista", block })
    else milestones.push({ minute: block.endMinute, kind: "SHIFT_END", title: `Fim · ${block.label}`, detail: null, block })
  })
  return milestones
}

/** Janela da barra: do primeiro ao último minuto da jornada, com folga de 30 min, em horas cheias (nunca o dia inteiro à toa). */
export function timelineWindow(blocks: JourneyBlock[]): { start: number; end: number } | null {
  const work = workBlocks(blocks)
  if (work.length === 0) return null
  const first = Math.min(...work.map((block) => block.startMinute))
  const last = Math.max(...work.map((block) => block.endMinute))
  const start = Math.max(0, Math.floor((first - 30) / 60) * 60)
  const end = Math.min(1440, Math.ceil((last + 30) / 60) * 60)
  return { start, end: Math.max(end, start + 60) }
}

/** Horas marcadas no eixo: de hora em hora, ou de 2 em 2 / 3 em 3 quando a janela é longa. */
export function timelineTicks(window: { start: number; end: number }): number[] {
  const hours = (window.end - window.start) / 60
  const step = hours > 16 ? 180 : hours > 9 ? 120 : 60
  const ticks: number[] = []
  for (let minute = Math.ceil(window.start / step) * step; minute <= window.end; minute += step) ticks.push(minute)
  return ticks
}

export type JourneyMoment = {
  minute: number
  clock: string
  block: JourneyBlock | null
  /** "Pausa NR17 · até 15h40" / "Logado para atendimento · até 15h30" / "Sem atividade prevista". */
  now: string
  /** "Próxima pausa: Lanche às 17h00 · em 55 min" / "Retorno em 6 min (15h40)" / "Sem mais pausas no dia". */
  next: string
}

/** O que a escala prevê num minuto do dia e quanto falta para a próxima pausa (ou para o retorno, se estiver em pausa). */
export function momentAt(blocks: JourneyBlock[], minute: number): JourneyMoment {
  const work = workBlocks(blocks)
  const block = work.filter((item) => minute >= item.startMinute && minute < item.endMinute).sort((a, b) => priority(b) - priority(a))[0] ?? null
  const now = block ? `${block.label} · ${untilText(block)}` : "Sem atividade prevista"
  let next: string
  if (block?.kind === "BREAK") {
    next = `Retorno em ${formatDuration(block.endMinute - minute)} (${minuteToClock(block.endMinute)})`
  } else {
    const upcoming = work.find((item) => item.kind === "BREAK" && item.startMinute > minute)
    next = upcoming ? `Próxima pausa: ${upcoming.label} às ${minuteToClock(upcoming.startMinute)} · em ${formatDuration(upcoming.startMinute - minute)}` : "Sem mais pausas no dia"
  }
  return { minute, clock: minuteToClock(minute), block, now, next }
}

function priority(block: JourneyBlock): number {
  return block.kind === "BREAK" ? 4 : block.kind === "OTHER" ? 3 : block.kind === "LOGGED_IN" ? 2 : 1
}
