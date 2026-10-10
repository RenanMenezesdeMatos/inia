"use client"

import { useEffect, useRef, useState } from "react"

import { AvSyncSection } from "@/components/layout/user-menu/av-sync-section"
import { Button } from "@/components/ui/button"
import { createSpeechPlayback } from "@/lib/avatar/audio/speech-playback"
import type { SpeechPlayback } from "@/lib/avatar/audio/types"
import { AvClapper, CLAP_COUNT } from "@/lib/avatar/lab/av-clapper"
import { LabSection } from "./lab-fields"

type AudioInfo = { outputLatency: string; baseLatency: string; outputTimestamp: string; sampleRate: string }

function msOf(seconds: number | undefined): string {
  return typeof seconds === "number" && Number.isFinite(seconds) ? `${(seconds * 1000).toFixed(1)} ms` : "não informado"
}

/**
 * Teste de claque (`av-clapper.ts`): cliques na MESMA reprodução da INIA e um flash no instante ouvido do quadro que vai
 * aparecer — o mesmo caminho da boca. Filme a tela a 240 fps com o som do aparelho e meça flash × clique.
 */
export function LabAvSyncPanel() {
  const flashRef = useRef<HTMLDivElement>(null)
  const rig = useRef<{ playback: SpeechPlayback; clapper: AvClapper } | null>(null)
  const [running, setRunning] = useState(false)
  const [info, setInfo] = useState<AudioInfo | null>(null)
  const [leadMs, setLeadMs] = useState<number | null>(null)

  useEffect(() => {
    if (!running) return
    let frame = 0
    let raf = 0
    const tick = (now: number) => {
      const current = rig.current
      if (!current) return
      const on = current.clapper.frame(now)
      if (flashRef.current) flashRef.current.style.backgroundColor = on ? "#ffffff" : "#000000"
      if (++frame % 30 === 0) setLeadMs(current.clapper.state.leadMs)
      if (!current.clapper.state.running) {
        setRunning(false)
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [running])

  useEffect(() => () => void rig.current?.playback.close(), [])

  function start() {
    if (!rig.current) {
      const playback = createSpeechPlayback()
      rig.current = { playback, clapper: new AvClapper(playback) }
    }
    const { playback, clapper } = rig.current
    clapper.start(CLAP_COUNT)
    const context = playback.context
    if (context) {
      const stamp = typeof context.getOutputTimestamp === "function" ? context.getOutputTimestamp() : null
      setInfo({
        outputLatency: msOf(context.outputLatency),
        baseLatency: msOf(context.baseLatency),
        outputTimestamp: stamp ? "sim" : "não (Safari: usa outputLatency)",
        sampleRate: `${context.sampleRate} Hz`,
      })
    }
    setRunning(clapper.state.running)
  }

  function stop() {
    rig.current?.clapper.stop()
    setRunning(false)
  }

  return (
    <LabSection
      title="Teste de sincronia (claque)"
      description="Mede o erro boca × voz que sobra NESTE aparelho (Bluetooth, compositor, tela). Ajuste salvo vale para toda conversa com a INIA neste navegador."
    >
      <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
        <li>Som pela saída que vai medir (alto-falante, fone com fio, AirPods…), volume alto.</li>
        <li>Filme a tela em câmera lenta (240 fps), com o celular perto da saída de som.</li>
        <li>{`Iniciar: ${CLAP_COUNT} cliques, um por segundo; a área preta pisca branco.`}</li>
        <li>
          No vídeo, quadro a quadro: do 1º quadro claro até o início do clique na forma de onda (1 quadro = 4,17 ms). Flash ANTES do
          clique = boca adiantada → ajuste negativo desse tanto; depois repita até ficar em ±1 quadro.
        </li>
      </ol>
      <div ref={flashRef} className="h-28 rounded-lg bg-black" aria-label="Área do flash" role="img" />
      <div className="flex gap-2">
        <Button size="sm" onClick={start} disabled={running}>
          {running ? "Tocando…" : "Iniciar teste de claque"}
        </Button>
        <Button size="sm" variant="outline" onClick={stop} disabled={!running}>
          Parar
        </Button>
      </div>
      {info ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          <dt className="text-muted-foreground">outputLatency</dt>
          <dd>{info.outputLatency}</dd>
          <dt className="text-muted-foreground">baseLatency</dt>
          <dd>{info.baseLatency}</dd>
          <dt className="text-muted-foreground">getOutputTimestamp</dt>
          <dd>{info.outputTimestamp}</dd>
          <dt className="text-muted-foreground">Contexto</dt>
          <dd>{info.sampleRate}</dd>
          <dt className="text-muted-foreground">Antecipação de quadro</dt>
          <dd>{leadMs === null ? "—" : `${leadMs.toFixed(1)} ms`}</dd>
        </dl>
      ) : null}
      <AvSyncSection />
    </LabSection>
  )
}
