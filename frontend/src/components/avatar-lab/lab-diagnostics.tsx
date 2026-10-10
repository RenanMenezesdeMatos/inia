"use client"

import { useEffect, useRef } from "react"

import { FrameStats } from "@/lib/avatar/lab/frame-stats"
import type { AvatarLabController } from "@/lib/avatar/lab/lab-controller"
import { drawSpeechTimeline } from "@/lib/avatar/lab/speech-timeline"
import { accentShapeOf } from "@/lib/avatar/lipsync/prosody"
import { createSpeechFrame } from "@/lib/avatar/lipsync/types"
import { LabSection } from "./lab-fields"

const TEXT_INTERVAL_MS = 100
const TIMELINE_INTERVAL_MS = 150
const TIMELINE_HEIGHT = 150

const FIELDS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "phone", label: "Fone ouvido" },
  { key: "source", label: "Origem" },
  { key: "speaking", label: "Falando" },
  { key: "energy", label: "Energia" },
  { key: "accent", label: "Último acento" },
  { key: "lookahead", label: "Folga mín. (turno)" },
  { key: "heard", label: "Ouvido (s)" },
  { key: "scheduled", label: "Agendado até (s)" },
  { key: "buffer", label: "À frente do ouvido" },
  { key: "aligned", label: "Texto alinhado até" },
  { key: "fps", label: "FPS (rAF)" },
  { key: "frame", label: "Quadro p50 / p95" },
  { key: "renders", label: "Renders/s (WebGL)" },
  { key: "triangles", label: "Triângulos" },
  { key: "calls", label: "Draw calls" },
  { key: "memory", label: "Geometrias / texturas" },
  { key: "replay", label: "Servidor falso" },
]

/**
 * Painel de diagnóstico: lê os motores DIRETO (reprodução, lip-sync, `renderer.info`) num
 * `requestAnimationFrame` próprio e escreve no DOM a ≤ 10 Hz — nunca estado do React por quadro.
 * A amostra do lip-sync é a mesma que o avatar faz (`sample` no instante ouvido, sem alocar).
 */
export function LabDiagnostics({ controller }: { controller: AvatarLabController }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const root = rootRef.current
    const canvas = canvasRef.current
    if (!root || !canvas) return
    const fields = new Map<string, HTMLElement>()
    root.querySelectorAll<HTMLElement>("[data-diag]").forEach((element) => fields.set(element.dataset.diag ?? "", element))
    const write = (key: string, text: string) => {
      const element = fields.get(key)
      if (element && element.textContent !== text) element.textContent = text
    }
    const stats = new FrameStats()
    const frame = createSpeechFrame()
    let raf = 0
    let lastText = -Infinity
    let lastTimeline = -Infinity
    let lastRender: { at: number; frame: number } | null = null
    // Último acento de frase OUVIDO (o pulso dura ~150 ms: amostrado a cada quadro, mostrado a 10 Hz).
    const accentFrame = createSpeechFrame()
    let accentText = "—"
    let accentPulse = 0
    const ACCENT_LABEL = { fall: "↘ queda", rise: "↗ subida", peak: "∧ pico" } as const
    const trackAccent = (now: number) => {
      const heard = controller.rig.playback.heardTime(now)
      if (heard === null) return
      controller.rig.lipsync.sample(heard, accentFrame)
      const pulse = accentFrame.emphasis
      if (pulse > 0.3 && pulse >= accentPulse) {
        const direction = accentFrame.accentDirection
        accentText = `${ACCENT_LABEL[accentShapeOf(direction)]}${accentFrame.accentNuclear ? " · nuclear" : ""} ${direction >= 0 ? "+" : ""}${direction.toFixed(2)}`
      }
      accentPulse = pulse
    }

    const paintText = (now: number) => {
      const rig = controller.rig
      const heard = rig.playback.heardTime(now)
      if (heard !== null) rig.lipsync.sample(heard, frame)
      const scheduled = rig.playback.scheduledUntil
      write("phone", heard !== null && frame.debugPhone ? frame.debugPhone : "—")
      write("source", heard !== null && frame.debugSource ? (frame.debugSource === "aligned" ? "texto alinhado" : "só áudio") : "—")
      write("speaking", heard !== null && frame.speaking ? "sim" : "não")
      write("energy", heard !== null ? frame.energy.toFixed(2) : "—")
      write("accent", accentText)
      write("heard", heard !== null ? heard.toFixed(3) : "—")
      write("scheduled", scheduled > 0 ? scheduled.toFixed(3) : "—")
      write("buffer", heard !== null && scheduled > heard ? `${Math.round((scheduled - heard) * 1000)} ms` : "0 ms")
      const summary = stats.summary()
      write("fps", summary.count > 0 ? summary.fps.toFixed(0) : "—")
      write("frame", summary.count > 0 ? `${summary.p50Ms.toFixed(1)} / ${summary.p95Ms.toFixed(1)} ms` : "—")
      const info = controller.rendererInfo
      if (info) {
        if (lastRender && now > lastRender.at) write("renders", ((1000 * (info.render.frame - lastRender.frame)) / (now - lastRender.at)).toFixed(0))
        lastRender = { at: now, frame: info.render.frame }
        write("triangles", info.render.triangles.toLocaleString("pt-BR"))
        write("calls", String(info.render.calls))
        write("memory", `${info.memory.geometries} / ${info.memory.textures}`)
      }
      write("replay", rig.socket?.replaying ?? (rig.source === "live" ? "sessão real" : "parado"))
    }

    let timelineIdle = false
    const paintTimeline = (now: number) => {
      const rig = controller.rig
      const heard = rig.playback.heardTime(now)
      // Nada do turno cabe mais na janela: limpa uma vez e para de copiar o snapshot (a resposta
      // longa tem milhares de quadros de análise — não vale alocá-los ~7×/s com a INIA calada).
      const idle = heard === null || heard - 5 > rig.playback.scheduledUntil
      if (idle && timelineIdle) return
      timelineIdle = idle
      const snapshot = rig.lipsync.debugSnapshot()
      write("lookahead", snapshot.minLookahead !== null ? `${Math.round(snapshot.minLookahead * 1000)} ms` : "—")
      write("aligned", snapshot.alignedUntil > 0 ? `${snapshot.alignedUntil.toFixed(2)} s (${snapshot.pendingWords} palavra(s) pendente(s))` : "—")
      const dpr = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr)
      if (canvas.height !== Math.round(TIMELINE_HEIGHT * dpr)) canvas.height = Math.round(TIMELINE_HEIGHT * dpr)
      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawSpeechTimeline(ctx, idle || snapshot.turnId === null ? null : snapshot, heard, { width, height: TIMELINE_HEIGHT })
    }

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      stats.tick(now)
      trackAccent(now)
      if (now - lastText >= TEXT_INTERVAL_MS) {
        lastText = now
        paintText(now)
      }
      if (now - lastTimeline >= TIMELINE_INTERVAL_MS) {
        lastTimeline = now
        paintTimeline(now)
      }
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [controller])

  return (
    <LabSection title="Diagnóstico" description="Relógio do AudioContext de reprodução (o mesmo que o avatar amostra). Atualiza a ≤ 10 Hz direto no DOM.">
      <div ref={rootRef} className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {FIELDS.map((field) => (
          <div key={field.key} className="flex min-w-0 justify-between gap-2 border-b border-border/50 py-0.5">
            <span className="truncate text-muted-foreground">{field.label}</span>
            <span data-diag={field.key} className="truncate font-mono tabular-nums">
              —
            </span>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-slate-900 p-1">
        <canvas ref={canvasRef} className="block w-full" style={{ height: TIMELINE_HEIGHT }} aria-label="Linha do tempo: energia do áudio e fones alinhados, com o cursor no instante ouvido" />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Faixa de cima: energia do áudio analisado. Faixa de baixo: fones (roxo = texto alinhado ao áudio, âmbar = só áudio, cinza = pausa; ˈ = tônica). Linha vermelha: instante ouvido. A/T: até onde o áudio foi analisado / o texto foi alinhado.
      </p>
    </LabSection>
  )
}
