"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { DEFAULT_AVATAR_TUNING, type AvatarTuning } from "@/lib/avatar/animation/types"
import type { AvatarLabController } from "@/lib/avatar/lab/lab-controller"
import { LabRange, LabSection } from "./lab-fields"

const TUNING_LABELS: Record<keyof AvatarTuning, string> = {
  gestureIntensity: "Gestos (braços/mãos)",
  breathing: "Respiração",
  blinkRate: "Piscadas",
  smile: "Sorriso",
  lipsync: "Articulação da boca",
  headMotion: "Cabeça/pescoço",
  gaze: "Olhar",
}
const TUNING_KEYS = Object.keys(TUNING_LABELS) as Array<keyof AvatarTuning>

/** Ajustes ao vivo: vão direto ao driver (`setTuning`) e à reprodução (`setAvOffsetMs`) — nada re-renderiza o Canvas. */
export function LabTuningPanel({ controller }: { controller: AvatarLabController }) {
  const [tuning, setTuning] = useState<AvatarTuning>({ ...DEFAULT_AVATAR_TUNING })
  const [avOffsetMs, setAvOffsetMs] = useState(0)

  function change(key: keyof AvatarTuning, value: number) {
    setTuning((current) => ({ ...current, [key]: value }))
    controller.setTuning({ [key]: value })
  }

  function changeOffset(value: number) {
    setAvOffsetMs(value)
    controller.setAvOffsetMs(value)
  }

  function reset() {
    setTuning({ ...DEFAULT_AVATAR_TUNING })
    controller.setTuning(DEFAULT_AVATAR_TUNING)
    changeOffset(0)
  }

  return (
    <LabSection title="Ajustes" description="0 desliga, 1 = padrão, 2 = o dobro. A/V positivo = boca adiantada em relação ao áudio.">
      {TUNING_KEYS.map((key) => (
        <LabRange key={key} label={TUNING_LABELS[key]} value={tuning[key]} min={0} max={2} step={0.05} onChange={(value) => change(key, value)} />
      ))}
      <LabRange label="Sincronia A/V" value={avOffsetMs} min={-300} max={300} step={5} format={(value) => `${value > 0 ? "+" : ""}${value} ms`} onChange={changeOffset} />
      <Button size="xs" variant="outline" onClick={reset}>
        Restaurar padrões
      </Button>
    </LabSection>
  )
}
