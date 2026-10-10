"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import type { AvatarConversationState } from "@/lib/avatar/animation/types"
import { LAB_FIXTURES, type LabFixtureId } from "@/lib/avatar/lab/fixture-catalog"
import type { LabTiming } from "@/lib/avatar/lab/fixture-store"
import type { AvatarLabController, LabSnapshot } from "@/lib/avatar/lab/lab-controller"
import { LabCheckbox, LabNumber, LabSection, LabSelect } from "./lab-fields"

const FIXTURE_OPTIONS = LAB_FIXTURES.map((fixture) => ({ value: fixture.id, label: fixture.label }))
const TIMING_OPTIONS = [
  { value: "original", label: "Latência original (como gravado)" },
  { value: "fast", label: "Sem espera inicial (1º áudio em ~150 ms)" },
] as const satisfies ReadonlyArray<{ value: LabTiming; label: string }>
const OVERRIDES: ReadonlyArray<{ value: AvatarConversationState | null; label: string }> = [
  { value: null, label: "Automático" },
  { value: "idle", label: "Ocioso" },
  { value: "listening", label: "Ouvindo" },
  { value: "thinking", label: "Pensando" },
]

type Props = {
  controller: AvatarLabController
  snapshot: LabSnapshot
  fixtureId: LabFixtureId
  onFixtureChange: (id: LabFixtureId) => void
}

export function LabPlaybackPanel({ controller, snapshot, fixtureId, onFixtureChange }: Props) {
  const [timing, setTiming] = useState<LabTiming>("original")
  const [autoInterrupt, setAutoInterrupt] = useState(false)
  const [interruptAtMs, setInterruptAtMs] = useState(1200)
  const [sequenceSecond, setSequenceSecond] = useState<LabFixtureId>("frase-02-proposta")
  const [recordSequence, setRecordSequence] = useState(false)
  const fixtureSource = snapshot.source === "fixture"
  const speaking = fixtureSource && snapshot.state === "speaking"
  const listening = fixtureSource && snapshot.state === "listening"

  return (
    <LabSection title="Reprodução das capturas reais" description="Transporte, reprodução, lip-sync e avatar de produção; só a WebSocket é um servidor falso que responde com a captura escolhida.">
      <div className="grid gap-3 sm:grid-cols-2">
        <LabSelect label="Captura (resposta da INIA)" value={fixtureId} options={FIXTURE_OPTIONS} onChange={onFixtureChange} />
        <LabSelect
          label="Tempo de chegada"
          value={timing}
          options={TIMING_OPTIONS}
          onChange={(value) => {
            setTiming(value)
            controller.setTiming(value)
          }}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={snapshot.sequenceRunning || snapshot.connecting} onClick={() => controller.play()}>
          {listening ? "Enviar fala simulada (activityEnd)" : "Play"}
        </Button>
        <Button size="sm" variant="secondary" disabled={!speaking || snapshot.sequenceRunning} onClick={() => controller.interrupt()}>
          Interromper (barge-in no meio da palavra)
        </Button>
        <Button size="sm" variant="outline" disabled={snapshot.state === "idle"} onClick={() => controller.cancelResponse()}>
          Cancelar resposta
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <LabCheckbox
          label="Interromper automaticamente"
          checked={autoInterrupt}
          onChange={(checked) => {
            setAutoInterrupt(checked)
            controller.setAutoInterrupt(checked, interruptAtMs)
          }}
        />
        <LabNumber
          label="após"
          suffix="ms de fala"
          value={interruptAtMs}
          min={0}
          max={60000}
          step={100}
          onChange={(value) => {
            setInterruptAtMs(value)
            controller.setAutoInterrupt(autoInterrupt, value)
          }}
        />
      </div>
      {listening ? (
        <p className="text-xs text-muted-foreground">
          Microfone simulado aberto (turno do usuário). &quot;Enviar fala simulada&quot; encerra o turno agora; sem clique, o próprio transporte encerra depois de 3,5 s de silêncio e a captura escolhida responde.
        </p>
      ) : null}

      <div className="rounded-lg border border-dashed p-3">
        <p className="text-xs font-semibold">Sequência: frase → interrupção no meio da palavra → próxima frase</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <LabSelect label="Primeira (a captura escolhida acima)" value={fixtureId} options={FIXTURE_OPTIONS} onChange={onFixtureChange} disabled={snapshot.sequenceRunning} />
          <LabSelect label="Depois da interrupção" value={sequenceSecond} options={FIXTURE_OPTIONS} onChange={setSequenceSecond} disabled={snapshot.sequenceRunning} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <LabCheckbox label="Gravar a sequência" checked={recordSequence} onChange={setRecordSequence} disabled={snapshot.sequenceRunning} />
          {snapshot.sequenceRunning ? (
            <Button size="sm" variant="destructive" onClick={() => controller.stopSequence()}>
              Parar sequência
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={snapshot.connecting} onClick={() => controller.runSequence(fixtureId, sequenceSecond, { interruptAtMs, record: recordSequence })}>
              Rodar sequência (interrompe em {interruptAtMs} ms)
            </Button>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium">Estado da conversa (fora da fala)</p>
        <div className="flex flex-wrap gap-1.5">
          {OVERRIDES.map((option) => (
            <Button
              key={option.label}
              size="xs"
              variant={snapshot.overrideState === option.value ? "default" : "outline"}
              disabled={snapshot.state === "speaking" && option.value !== null}
              onClick={() => controller.setOverride(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </LabSection>
  )
}
