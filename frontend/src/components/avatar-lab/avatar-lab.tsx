"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import type { WebGLRenderer } from "three"

import { IniaHumanoidAvatar3D, type AvatarView } from "@/components/operator/inia-humanoid-avatar-3d"
import type { AvatarQuality } from "@/lib/avatar/animation/types"
import { parseUploadTarget } from "@/lib/avatar/lab/demo-recorder"
import type { LabFixtureId } from "@/lib/avatar/lab/fixture-catalog"
import { AvatarLabController } from "@/lib/avatar/lab/lab-controller"
import { MENTORA_MODEL_URL, modelExists, POC_MODEL_URL, type LabModelUrl } from "@/lib/avatar/lab/lab-models"
import { LabAppearancePanel } from "./lab-appearance-panel"
import { LabAvSyncPanel } from "./lab-av-sync-panel"
import { LabDiagnostics } from "./lab-diagnostics"
import { LabLivePanel } from "./lab-live-panel"
import { LabLogPanel } from "./lab-log-panel"
import { LabPlaybackPanel } from "./lab-playback-panel"
import { LabRecorderPanel } from "./lab-recorder-panel"
import { LabTuningPanel } from "./lab-tuning-panel"

const INITIAL_FIXTURE: LabFixtureId = "frase-01-apresentacao"

// A query da página não muda sem navegação: lida uma vez no cliente (no servidor, vazia).
const subscribeNever = () => () => {}
const readSearch = () => window.location.search
const readServerSearch = () => ""

/**
 * Laboratório do avatar (só desenvolvimento): o `IniaHumanoidAvatar3D` real, alimentado pelo motor
 * de voz de produção com capturas reais do Gemini Live (ou com a sessão real, se logado). O
 * controlador é criado UMA vez e o avatar recebe sempre o MESMO driver — nenhum controle desta
 * tela re-renderiza o `<Canvas>` (só trocar o modelo, que recria a cena por definição).
 */
export function AvatarLab() {
  const [controller] = useState(() => new AvatarLabController())
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [fixtureId, setFixtureId] = useState<LabFixtureId>(INITIAL_FIXTURE)
  const [modelUrl, setModelUrl] = useState<LabModelUrl>(POC_MODEL_URL)
  const userPickedModelRef = useRef(false)
  const [mentoraAvailable, setMentoraAvailable] = useState<boolean | null>(null)
  const [view, setView] = useState<AvatarView>("chat")
  const [quality, setQuality] = useState<AvatarQuality | "auto">("auto")
  const search = useSyncExternalStore(subscribeNever, readSearch, readServerSearch)
  const uploadTarget = useMemo(() => parseUploadTarget(search), [search])

  // Desmontagem (e o ciclo extra do StrictMode): cala e desconecta; o controlador continua utilizável.
  useEffect(() => {
    controller.selectFixture(INITIAL_FIXTURE)
    return () => controller.dispose()
  }, [controller])

  // A mentora é o padrão quando o GLB já existe; senão, o POC.
  useEffect(() => {
    let cancelled = false
    void modelExists(MENTORA_MODEL_URL).then((exists) => {
      if (cancelled) return
      setMentoraAvailable(exists)
      // Escolha manual feita antes do HEAD responder vence o padrão.
      if (exists && !userPickedModelRef.current) setModelUrl(MENTORA_MODEL_URL)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => controller.setUploadTarget(uploadTarget), [controller, uploadTarget])

  const handleCanvasReady = useCallback((canvas: HTMLCanvasElement, renderer: WebGLRenderer) => controller.setCanvas(canvas, renderer), [controller])

  function changeFixture(id: LabFixtureId) {
    setFixtureId(id)
    controller.selectFixture(id)
  }

  const displayState = snapshot.state !== "speaking" && snapshot.overrideState ? snapshot.overrideState : snapshot.state

  return (
    <main className="mx-auto max-w-[1500px] space-y-4 p-4 lg:p-6">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Laboratório do avatar da INIA</h1>
          <p className="text-sm text-muted-foreground">Capturas reais do Gemini Live pelo motor de produção — sem login, sem custo de API. Só em desenvolvimento.</p>
        </div>
        <p className="text-xs text-muted-foreground">
          {snapshot.source === "fixture" ? "Fonte: capturas" : "Fonte: sessão real"} · {snapshot.connected ? "conectado" : snapshot.connecting ? "conectando…" : "desconectado"} · estado: {displayState}
          {mentoraAvailable === false ? " · mentora ainda não existe (usando o POC)" : ""}
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="min-w-0 space-y-4">
          <IniaHumanoidAvatar3D
            modelUrl={modelUrl}
            state={displayState}
            driver={controller.driver}
            quality={quality}
            view={view}
            className="h-[min(72vh,640px)]"
            onCanvasReady={handleCanvasReady}
          />
          <LabDiagnostics controller={controller} />
          <LabLogPanel snapshot={snapshot} />
        </div>
        <div className="min-w-0 space-y-4">
          <LabPlaybackPanel controller={controller} snapshot={snapshot} fixtureId={fixtureId} onFixtureChange={changeFixture} />
          <LabAppearancePanel
            modelUrl={modelUrl}
            mentoraAvailable={mentoraAvailable}
            onModelUrl={(url) => {
              userPickedModelRef.current = true
              setModelUrl(url)
            }}
            view={view}
            onView={setView}
            quality={quality}
            onQuality={setQuality}
          />
          <LabTuningPanel controller={controller} />
          <LabRecorderPanel controller={controller} snapshot={snapshot} uploadTarget={uploadTarget?.href ?? null} />
          <LabLivePanel controller={controller} snapshot={snapshot} />
          <LabAvSyncPanel />
        </div>
      </div>
    </main>
  )
}
