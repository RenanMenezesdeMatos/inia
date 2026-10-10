"use client"

/*
 * O Three.js é imperativo: câmera, ossos e morphs mudam a cada quadro. Toda essa mutação vive em
 * classes de `src/lib/avatar/animation` chamadas pelo `useFrame` — nada é mutado no render.
 */

import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode, type RefObject } from "react"
import { useProgress } from "@react-three/drei"
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber"
import type { Material, Mesh, Object3D, PerspectiveCamera, SkinnedMesh, Texture, WebGLRenderer } from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

import { AvatarRig, cloneAvatarScene } from "@/lib/avatar/animation/avatar-rig"
import { BehaviorController } from "@/lib/avatar/animation/behavior-controller"
import { autoQuality, detectQualityEnvironment, FrameTimeMonitor, lowerQuality, QUALITY_SETTINGS } from "@/lib/avatar/animation/quality"
import type { AvatarView } from "@/lib/avatar/animation/rig-framing"
import { CameraFramer, viewerFacingDeg } from "@/lib/avatar/animation/rig-framing"
import { applyStudioEnvironment, configureStudioRenderer, createStudioLights } from "@/lib/avatar/animation/studio-lighting"
import type { AvatarConversationState, AvatarDriver, AvatarQuality } from "@/lib/avatar/animation/types"
import { cn } from "@/lib/utils"

export type { AvatarView }

export type IniaHumanoidAvatar3DProps = {
  modelUrl: string
  /** Só para o rótulo acessível/chip de estado; a animação lê `driver.state`. */
  state: AvatarConversationState
  /** Objeto estável (nunca recriado por render) lido a cada quadro. */
  driver: AvatarDriver
  /** Padrão "auto". O antialias é decidido na criação; depois só DPR/cachos mudam. */
  quality?: AvatarQuality | "auto"
  /** Padrão "chat". Trocar a vista move a câmera por ref — o Canvas não re-renderiza. */
  view?: AvatarView
  /**
   * Padrão "forward": ela fica voltada para a frente do modelo (na vista "presenting", para o que ela apresenta, à direita da
   * imagem). "viewer": ela se vira de frente para quem a vê (olhos, cabeça e depois o corpo, ~1 s) — lido por ref, como a vista.
   */
  facing?: "forward" | "viewer"
  /** Sobrescreve o tamanho do palco (padrão: o componente é dono da altura, `h-64`). */
  className?: string
  /** Para o gravador e o diagnóstico do laboratório (`renderer.info`: triângulos, draw calls). */
  onCanvasReady?: (canvas: HTMLCanvasElement, renderer: WebGLRenderer) => void
  /** Padrão false: o crédito CC BY 4.0 do modelo base só aparece quando solicitado. */
  attribution?: boolean
  /** Onde fica o crédito do modelo: embaixo (padrão) ou em cima — no painel, embaixo ficam os controles da chamada. */
  attributionPlacement?: "bottom" | "top"
  /** Estado mostrado no selo quando não é um estado da conversa (ex.: "Preparando a voz…"). Padrão: o rótulo de `state`. */
  statusLabel?: string | null
  /** Padrão "studio" (fundo claro próprio). "none" = transparente: a INIA aparece sobre o palco de quem a exibe. */
  backdrop?: "studio" | "none"
  /** Padrão true: o selo de estado no canto. Falso quando a superfície mostra o estado de outro jeito. */
  showStatus?: boolean
}

/**
 * Tudo o que muda depois de montar e o loop precisa ler — atualizado por ref, NUNCA por re-render
 * do Canvas. Invariante (regressão do "1 Issue" `target.addEventListener` ao trocar de aba): o
 * `<Canvas>` do R3F re-executa uma configuração assíncrona a cada render seu e quebra se for
 * desmontado com ela em voo (o Radix Presence re-renderiza e desmonta no mesmo tick). Por isso a
 * subárvore do Canvas é memoizada e só renderiza ao montar (ou se o modelo mudar).
 */
type LiveInputs = {
  driver: AvatarDriver
  view: AvatarView
  facing: "forward" | "viewer"
  quality: AvatarQuality | "auto"
  reducedMotion: boolean
  onCanvasReady: ((canvas: HTMLCanvasElement, renderer: WebGLRenderer) => void) | undefined
}

const ATTRIBUTION_TEXT = "Base: “Pixar style girl (rigging)” por Black vizual (CC BY 4.0), modificada"

export function IniaHumanoidAvatar3D({
  modelUrl,
  state,
  driver,
  quality = "auto",
  view = "chat",
  facing = "forward",
  className,
  onCanvasReady,
  attribution = false,
  attributionPlacement = "bottom",
  statusLabel = null,
  backdrop = "studio",
  showStatus = true,
}: IniaHumanoidAvatar3DProps) {
  // Resolvido UMA vez: o antialias do WebGL só existe na criação do contexto.
  const [initialQuality] = useState<AvatarQuality>(() => (quality === "auto" ? autoQuality(detectQualityEnvironment()) : quality))
  const liveRef = useRef<LiveInputs>({ driver, view, facing, quality, reducedMotion: false, onCanvasReady })
  useLayoutEffect(() => {
    const live = liveRef.current
    live.driver = driver
    live.view = view
    live.facing = facing
    live.quality = quality
    live.onCanvasReady = onCanvasReady
  }, [driver, view, facing, quality, onCanvasReady])

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => {
      liveRef.current.reducedMotion = media.matches
    }
    apply()
    media.addEventListener?.("change", apply)
    return () => media.removeEventListener?.("change", apply)
  }, [])

  // O modelo avisa quando montou; "pronto" é por URL (trocar o modelo volta a mostrar o carregando).
  const [readyUrl, setReadyUrl] = useState<string | null>(null)
  // Sem WebGL (VDI/thin client sem GPU, GPU bloqueada, contextos esgotados) o R3F falha de forma
  // assíncrona, fora do alcance do error boundary — o avatar ficaria "Carregando…" para sempre.
  const [webgl] = useState(() => webglSupport.probe())

  return (
    <div
      className={cn(
        "relative h-64 overflow-hidden rounded-2xl",
        backdrop === "studio" && "bg-[radial-gradient(circle_at_50%_30%,rgba(255,255,255,.98),rgba(250,247,252,.96)_46%,rgba(236,230,243,.96)_100%)]",
        className,
      )}
      aria-label={`Avatar 3D da INIA: ${statusLabel ?? STATE_LABEL[state]}`}
    >
      {webgl ? (
        <AvatarErrorBoundary resetKey={modelUrl}>
          <AvatarCanvas modelUrl={modelUrl} liveRef={liveRef} initialQuality={initialQuality} onReady={setReadyUrl} />
          {readyUrl === modelUrl ? null : <AvatarLoadingOverlay />}
        </AvatarErrorBoundary>
      ) : (
        <AvatarFallback />
      )}

      {showStatus ? <span className="absolute top-3 left-3 whitespace-nowrap rounded-full bg-background/88 px-3 py-1 text-[11px] text-muted-foreground shadow-sm backdrop-blur-sm">
        <span className={`mr-1.5 inline-block size-1.5 rounded-full ${statusLabel ? "animate-pulse bg-amber-500 motion-reduce:animate-none" : state === "listening" ? "animate-pulse bg-emerald-500" : state === "speaking" ? "animate-pulse bg-primary" : "bg-emerald-500"}`} />
        {statusLabel ?? STATE_LABEL[state]}
      </span> : null}
      {attribution ? (
        attributionPlacement === "top" ? (
          <span className="absolute top-3 right-2.5 max-w-[38%] truncate rounded-full bg-black/30 px-2 py-0.5 text-right text-[9px] text-white/80 backdrop-blur-sm" title={ATTRIBUTION_TEXT}>{ATTRIBUTION_TEXT}</span>
        ) : (
          <span className="absolute right-3 bottom-2 max-w-[calc(100%-1.5rem)] truncate text-right text-[9px] text-muted-foreground/70">{ATTRIBUTION_TEXT}</span>
        )
      ) : null}
    </div>
  )
}

const STATE_LABEL: Record<AvatarConversationState, string> = {
  idle: "INIA está pronta",
  listening: "Ouvindo você",
  thinking: "Pensando",
  speaking: "Respondendo",
}

/**
 * Falha no GLB (404, arquivo corrompido) ou no WebGL (contexto indisponível) nunca derruba a
 * página: o R3F repassa o erro da cena para a árvore do DOM e ele para aqui, com um fallback
 * estático. Trocar o modelo tenta de novo.
 */
class AvatarErrorBoundary extends Component<{ resetKey: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn("[INIA avatar] falha ao renderizar o avatar 3D", error, info.componentStack)
    // O `useLoader` guarda também a FALHA por URL: sem limpar, nem remontar tentaria de novo.
    useLoader.clear(GLTFLoader, this.props.resetKey)
  }

  private readonly retry = () => {
    useLoader.clear(GLTFLoader, this.props.resetKey)
    this.setState({ failed: false })
  }

  componentDidUpdate(previous: { resetKey: string }): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) this.setState({ failed: false })
  }

  render(): ReactNode {
    return this.state.failed ? <AvatarFallback onRetry={this.retry} /> : this.props.children
  }
}

function AvatarFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center" role="status">
      <div aria-hidden className="flex size-16 items-center justify-center rounded-full bg-primary/12 text-sm font-semibold tracking-wide text-primary">INIA</div>
      <p className="max-w-56 text-xs text-muted-foreground">Avatar indisponível agora. A conversa continua normalmente.</p>
      {onRetry ? <button type="button" onClick={onRetry} className="text-[11px] font-medium text-primary underline-offset-2 hover:underline">Tentar novamente</button> : null}
    </div>
  )
}

/**
 * Sonda de WebGL (uma vez por página). Exportada como objeto para os testes em jsdom — que não tem
 * WebGL e simulam o R3F — poderem trocá-la.
 */
export const webglSupport = {
  probe(): boolean {
    if (webglProbeResult !== null) return webglProbeResult
    if (typeof document === "undefined") return true
    try {
      const canvas = document.createElement("canvas")
      const context = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null
      webglProbeResult = context !== null
      context?.getExtension("WEBGL_lose_context")?.loseContext()
    } catch {
      webglProbeResult = false
    }
    return webglProbeResult
  },
}
let webglProbeResult: boolean | null = null

/**
 * Libera os recursos de GPU do clone ao desmontar. Geometrias, materiais e texturas são
 * COMPARTILHADOS com o GLTF do cache: `dispose()` só apaga os buffers na GPU (quem renderizar de
 * novo reenvia), mas é o que remove os ouvintes que cada renderer pendura nesses objetos — sem
 * isso, cada remontagem (recolher o chat, câmera, encerrar/reativar) prendia o renderer antigo e
 * ~12 MB de buffers de morph na memória.
 */
function releaseGpuResources(root: Object3D): void {
  const textures = new Set<Texture>()
  root.traverse((object) => {
    const mesh = object as Mesh
    if (!mesh.isMesh) return
    mesh.geometry?.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials as Material[]) {
      if (!material) continue
      for (const value of Object.values(material)) if ((value as Texture | null)?.isTexture) textures.add(value as Texture)
      material.dispose()
    }
    ;(object as SkinnedMesh).skeleton?.dispose()
  })
  for (const texture of textures) texture.dispose()
}

/** Fora do Canvas: re-renderiza com o progresso sem tocar no Canvas. */
function AvatarLoadingOverlay() {
  const { progress } = useProgress()
  const percent = Math.max(0, Math.min(100, Math.round(progress)))
  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2" role="status" aria-live="polite">
      <div aria-hidden className="size-10 animate-pulse rounded-full bg-primary/15" />
      <p className="text-[11px] text-muted-foreground">Carregando avatar{percent > 0 ? `… ${percent}%` : "…"}</p>
    </div>
  )
}

type AvatarCanvasProps = {
  modelUrl: string
  liveRef: RefObject<LiveInputs>
  initialQuality: AvatarQuality
  onReady: (modelUrl: string) => void
}

/** Subárvore memoizada: todas as props são estáveis — só renderiza de novo se o modelo mudar. */
const AvatarCanvas = memo(function AvatarCanvas({ modelUrl, liveRef, initialQuality, onReady }: AvatarCanvasProps) {
  const settings = QUALITY_SETTINGS[initialQuality]
  return (
    <Canvas
      camera={{ fov: 24, near: 0.05, far: 40, position: [0, 1.5, 2.4] }}
      dpr={[1, settings.maxDpr]}
      // Tamanho pelo LAYOUT (offsetWidth/Height), nunca pelo getBoundingClientRect: a animação de voo (avatar-host.tsx) usa
      // transform, e uma medida no meio dela deixava o Canvas preso no tamanho reduzido.
      resize={{ offsetSize: true }}
      gl={{ antialias: settings.antialias, alpha: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        configureStudioRenderer(gl)
        liveRef.current.onCanvasReady?.(gl.domElement, gl)
      }}
    >
      <FrameloopGate />
      <StudioLighting />
      {/* Suspense DENTRO do Canvas: enquanto o GLB baixa, o Canvas continua montado (sem colapsar o
          layout nem desmontar com configuração em voo); o progresso aparece no overlay HTML. */}
      <Suspense fallback={null}>
        <AvatarModel modelUrl={modelUrl} liveRef={liveRef} initialQuality={initialQuality} onReady={onReady} />
      </Suspense>
    </Canvas>
  )
})

/**
 * Pausa o loop quando o canvas sai da tela (rolagem, painel recolhido, o chat duplicado escondido
 * por CSS no outro breakpoint) ou a aba fica oculta: sem isso o WebGL desenha 60 fps para ninguém.
 */
function FrameloopGate() {
  const gl = useThree((state) => state.gl)
  const setFrameloop = useThree((state) => state.setFrameloop)
  useEffect(() => {
    let onScreen = true
    let pageVisible = typeof document === "undefined" || document.visibilityState !== "hidden"
    const apply = () => setFrameloop(onScreen && pageVisible ? "always" : "never")
    const observer = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting)
        apply()
      })
    observer?.observe(gl.domElement)
    const onVisibility = () => {
      pageVisible = document.visibilityState !== "hidden"
      apply()
    }
    document.addEventListener("visibilitychange", onVisibility)
    apply()
    return () => {
      observer?.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [gl, setFrameloop])
  return null
}

function StudioLighting() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const lights = useMemo(() => createStudioLights(), [])
  useEffect(() => applyStudioEnvironment(gl, scene), [gl, scene])
  return <primitive object={lights} />
}

type AvatarModelProps = AvatarCanvasProps

function AvatarModel({ modelUrl, liveRef, initialQuality, onReady }: AvatarModelProps) {
  const gltf = useLoader(GLTFLoader, modelUrl)
  const setDpr = useThree((state) => state.setDpr)
  // Um clone por montagem: o GLTF do cache (por URL) nunca é reparentado nem descartado aqui.
  const rig = useMemo(() => new AvatarRig(cloneAvatarScene(gltf.scene)), [gltf])
  const controller = useMemo(() => new BehaviorController(), [])
  const framer = useMemo(() => new CameraFramer(rig.anchors), [rig])
  const monitor = useMemo(() => new FrameTimeMonitor(), [])
  const qualityRef = useRef<{ current: AvatarQuality; applied: AvatarQuality | null }>({ current: initialQuality, applied: null })

  // Layout effect: o mixer começa antes do primeiro quadro. start/stop são idempotentes e
  // reversíveis (o StrictMode faz montar → desmontar → montar com o mesmo rig).
  useLayoutEffect(() => {
    rig.start()
    controller.reset()
    monitor.reset()
    onReady(modelUrl)
    return () => {
      rig.stop()
      releaseGpuResources(rig.root)
    }
  }, [rig, controller, monitor, onReady, modelUrl])

  useFrame((state, rawDelta) => {
    const live = liveRef.current
    const dt = Math.min(Math.max(rawDelta, 0), 0.1)

    const quality = qualityRef.current
    if (live.quality !== "auto") quality.current = live.quality
    else if (monitor.sample(rawDelta)) quality.current = lowerQuality(quality.current) ?? quality.current
    if (quality.applied !== quality.current) {
      quality.applied = quality.current
      rig.setQuality(quality.current)
      setDpr(Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, QUALITY_SETTINGS[quality.current].maxDpr))
    }

    controller.setFacing(live.facing === "viewer" ? viewerFacingDeg(live.view) : 0)
    const frame = controller.update(live.driver, dt, performance.now(), live.reducedMotion)
    rig.applyGesture(frame.gesture)
    rig.update(dt, frame)
    framer.update(state.camera as PerspectiveCamera, live.view, state.size.width / Math.max(1, state.size.height), dt)
  })

  return <primitive object={rig.root} />
}
