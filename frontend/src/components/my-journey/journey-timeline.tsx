"use client"

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"

import { SURFACE_CARD } from "@/components/ui/surface"
import { cn } from "@/lib/utils"
import type { JourneyBlock } from "@/schemas/my-journey/my-journey.schema"

import { BLOCK_STYLE, minuteToClock } from "./journey-format"
import { momentAt, timelineTicks, timelineWindow, workBlocks } from "./journey-moments"

/**
 * BARRA DO DIA — proporcional ao tempo e focada na jornada (não no dia inteiro), com a pausa em cor própria e a linha do "Agora"
 * (padrão das ferramentas de escala e dos calendários). Ao passar o mouse, uma linha acompanha o ponteiro e o tooltip diz o que a
 * escala prevê naquele minuto e quanto falta para a próxima pausa (ou para o retorno). Toque: arrastar o dedo na barra faz o mesmo.
 * Teclado: a barra é um controle deslizante (setas andam 5 min, Shift+seta 30 min, Home/End vão às pontas). O tooltip só complementa:
 * os horários estão sempre escritos na agenda abaixo.
 */
const LEGEND: { kind: JourneyBlock["kind"]; label: string }[] = [
  { kind: "LOGGED_IN", label: "Logado" },
  { kind: "BREAK", label: "Pausa" },
  { kind: "OTHER", label: "Outra atividade" },
  { kind: "SHIFT", label: "Jornada prevista" },
]

export function JourneyTimeline({ blocks, nowMinute }: { blocks: JourneyBlock[]; nowMinute: number | null }) {
  const work = useMemo(() => workBlocks(blocks), [blocks])
  const range = useMemo(() => timelineWindow(blocks), [blocks])
  const trackRef = useRef<HTMLDivElement>(null)
  const [scrub, setScrub] = useState<number | null>(null)

  const minuteFromPointer = useCallback(
    (clientX: number): number | null => {
      const track = trackRef.current
      if (!track || !range || !Number.isFinite(clientX)) return null
      const rect = track.getBoundingClientRect()
      if (rect.width === 0) return null
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      return Math.min(range.end - 1, Math.round(range.start + ratio * (range.end - range.start)))
    },
    [range],
  )

  if (!range || work.length === 0) return null
  const span = range.end - range.start
  const percent = (minute: number) => `${((minute - range.start) / span) * 100}%`
  const nowVisible = nowMinute !== null && nowMinute >= range.start && nowMinute <= range.end
  const ticks = timelineTicks(range)
  const kinds = new Set(work.map((block) => block.kind))
  const moment = scrub !== null ? momentAt(blocks, scrub) : null

  // Mouse: a linha segue o ponteiro só de passar. Toque/caneta: só enquanto o dedo está na barra (tocar ou arrastar).
  const isTouch = (event: PointerEvent<HTMLDivElement>) => event.pointerType === "touch" || event.pointerType === "pen"
  const onPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (!isTouch(event) || event.buttons > 0 || event.type === "pointerdown") setScrub(minuteFromPointer(event.clientX))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const base = scrub ?? (nowVisible ? nowMinute : range.start)
    const step = event.shiftKey ? 30 : 5
    const target = event.key === "ArrowRight" ? base + step : event.key === "ArrowLeft" ? base - step : event.key === "Home" ? range.start : event.key === "End" ? range.end - 1 : event.key === "Escape" ? null : undefined
    if (target === undefined) return
    event.preventDefault()
    setScrub(target === null ? null : Math.min(range.end - 1, Math.max(range.start, target)))
  }
  const tooltipAlign = scrub === null ? "center" : (scrub - range.start) / span < 0.18 ? "start" : (scrub - range.start) / span > 0.82 ? "end" : "center"

  return (
    <div className={cn(SURFACE_CARD, "space-y-3 p-4 sm:p-5")}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Legenda da linha do tempo">
          {LEGEND.filter((item) => kinds.has(item.kind)).map((item) => (
            <li key={item.kind} className="flex items-center gap-1.5">
              <span className={cn("inline-block size-2.5 rounded-sm", BLOCK_STYLE[item.kind].bar)} aria-hidden />
              {item.label}
            </li>
          ))}
        </ul>
        <span className="text-xs text-muted-foreground">Passe o mouse ou arraste o dedo na barra</span>
      </div>

      <div className="relative pt-9">
        {/* Tooltip do minuto apontado (mouse, dedo ou teclado). */}
        {moment ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="journey-scrub-tooltip"
            className={cn(
              "pointer-events-none absolute top-9 z-10 w-max max-w-64 -translate-y-[calc(100%+0.75rem)] rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md",
              tooltipAlign === "center" && "-translate-x-1/2",
              tooltipAlign === "end" && "-translate-x-full",
            )}
            style={{ left: percent(moment.minute) }}
          >
            <p className="font-semibold tabular-nums">{moment.clock}</p>
            <p className="flex items-center gap-1.5">
              {moment.block ? <span className={cn("inline-block size-2 shrink-0 rounded-full", BLOCK_STYLE[moment.block.kind].bar)} aria-hidden /> : null}
              {moment.now}
            </p>
            <p className="text-muted-foreground">{moment.next}</p>
          </div>
        ) : null}

        <div
          ref={trackRef}
          role="slider"
          tabIndex={0}
          aria-label="Linha do tempo da jornada"
          aria-valuemin={range.start}
          aria-valuemax={range.end}
          aria-valuenow={scrub ?? (nowVisible ? nowMinute : range.start)}
          aria-valuetext={moment ? `${moment.clock}: ${moment.now}. ${moment.next}` : "Use as setas para percorrer a jornada"}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={(event) => !isTouch(event) && setScrub(null)}
          onKeyDown={onKeyDown}
          onBlur={() => setScrub(null)}
          className="relative h-10 cursor-crosshair touch-pan-y rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {work.map((block) => (
            <div
              key={`${block.kind}-${block.startMinute}`}
              aria-hidden
              className={cn("absolute", BLOCK_STYLE[block.kind].bar, block.kind === "BREAK" || block.kind === "OTHER" ? "inset-y-0 z-[1] min-w-1 rounded-sm" : "inset-y-1.5 first:rounded-l-md last:rounded-r-md")}
              style={{ left: percent(block.startMinute), width: `${((block.endMinute - block.startMinute) / span) * 100}%` }}
            />
          ))}
          {nowVisible ? (
            <div aria-hidden data-testid="journey-now-line" className="absolute -inset-y-1 z-[2] w-0.5 -translate-x-1/2 rounded bg-red-500" style={{ left: percent(nowMinute!) }}>
              <span className="absolute -top-5 left-1/2 -translate-x-1/2 rounded bg-red-500 px-1 text-[10px] font-semibold whitespace-nowrap text-white">Agora</span>
            </div>
          ) : null}
          {moment ? <div aria-hidden className="absolute -inset-y-1 z-[3] w-px -translate-x-1/2 border-l border-dashed border-foreground" style={{ left: percent(moment.minute) }} /> : null}
        </div>

        <div aria-hidden className="relative mt-1 h-4 text-[10px] text-muted-foreground tabular-nums">
          {ticks.map((minute) => (
            <span key={minute} className={cn("absolute", minute === range.start ? "" : minute === range.end ? "-translate-x-full" : "-translate-x-1/2")} style={{ left: percent(minute) }}>
              {minuteToClock(minute).replace("h00", "h")}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
