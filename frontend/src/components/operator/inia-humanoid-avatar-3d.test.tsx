/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AvatarDriver } from "@/lib/avatar/animation/types"
import { DEFAULT_AVATAR_TUNING } from "@/lib/avatar/animation/types"

// Regressão do "1 Issue" do Next ao trocar Acompanhamento → Indicadores: o Canvas do R3F
// re-executa uma configuração assíncrona a cada render seu e quebra se for desmontado com ela em
// voo. A garantia estrutural é que o Canvas NÃO re-renderiza quando só estado/vista/qualidade/
// driver mudam — tudo isso vai por ref. O WebGL real não roda no jsdom, então o Canvas vira um
// contador de renders (ou, sob demanda, lança — para provar o fallback do error boundary).
const canvasRenders = vi.fn()
const canvasMode = { throws: false }
vi.mock("@react-three/fiber", () => ({
  Canvas: (props: { children?: unknown }) => {
    canvasRenders(props)
    if (canvasMode.throws) throw new Error("WebGL indisponível")
    return null
  },
  useFrame: () => {},
  useLoader: Object.assign(() => ({ scene: {} }), { clear: vi.fn() }),
  useThree: () => undefined,
}))
vi.mock("@react-three/drei", () => ({ useProgress: () => ({ progress: 42, active: true }) }))

import { IniaHumanoidAvatar3D, webglSupport } from "./inia-humanoid-avatar-3d"

// jsdom não tem WebGL; o R3F é simulado acima.
const realProbe = webglSupport.probe
beforeEach(() => {
  webglSupport.probe = () => true
})

afterEach(() => {
  cleanup()
  canvasRenders.mockClear()
  canvasMode.throws = false
  webglSupport.probe = realProbe
})

function fakeDriver(): AvatarDriver {
  return {
    state: "idle",
    sampleSpeech: () => {},
    drainCues: () => [],
    tuning: { ...DEFAULT_AVATAR_TUNING },
  }
}

describe("IniaHumanoidAvatar3D — Canvas estável", () => {
  it("trocar estado, vista, qualidade, classe ou crédito não re-renderiza o Canvas do R3F", () => {
    const driver = fakeDriver()
    const { rerender, getByLabelText } = render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={driver} />)
    expect(canvasRenders).toHaveBeenCalledTimes(1)

    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="speaking" driver={driver} view="front" quality="low" />)
    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="thinking" driver={driver} view="profile" quality="high" className="h-96" attribution />)
    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="listening" driver={fakeDriver()} view="chat" onCanvasReady={() => {}} />)

    expect(canvasRenders).toHaveBeenCalledTimes(1)
    // O rótulo acessível continua acompanhando o estado (o wrapper renderiza; só o Canvas não).
    expect(getByLabelText("Avatar 3D da INIA: Ouvindo você")).toBeInTheDocument()
  })

  it("trocar o modelo é o único motivo para o Canvas renderizar de novo", () => {
    const driver = fakeDriver()
    const { rerender } = render(<IniaHumanoidAvatar3D modelUrl="/a.glb" state="idle" driver={driver} />)
    rerender(<IniaHumanoidAvatar3D modelUrl="/b.glb" state="idle" driver={driver} />)
    expect(canvasRenders).toHaveBeenCalledTimes(2)
  })

  it("mostra o carregamento (fora do Canvas) até o modelo montar", () => {
    render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} />)
    expect(screen.getByText("Carregando avatar… 42%")).toBeInTheDocument()
  })

  it("o palco tem altura própria (h-64) e aceita outra pelo className", () => {
    const { rerender, getByLabelText } = render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} />)
    expect(getByLabelText("Avatar 3D da INIA: INIA está pronta")).toHaveClass("h-64")
    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} className="h-[520px]" />)
    const stage = getByLabelText("Avatar 3D da INIA: INIA está pronta")
    expect(stage).toHaveClass("h-[520px]")
    expect(stage).not.toHaveClass("h-64")
  })

  it("esconde o crédito do modelo base por padrão; `attribution` permite exibi-lo", () => {
    const { rerender } = render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} />)
    expect(screen.queryByText(/Black vizual/)).not.toBeInTheDocument()
    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} attribution />)
    expect(screen.getByText(/Pixar style girl \(rigging\).*Black vizual \(CC BY 4\.0\), modificada/)).toBeInTheDocument()
    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} attribution={false} />)
    expect(screen.queryByText(/Black vizual/)).not.toBeInTheDocument()
  })

  it("entrega o <canvas> criado para o gravador do laboratório (onCanvasReady)", () => {
    const onCanvasReady = vi.fn()
    render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} onCanvasReady={onCanvasReady} />)
    const props = canvasRenders.mock.calls[0][0] as { onCreated: (state: { gl: unknown }) => void }
    const canvas = document.createElement("canvas")
    const gl = { domElement: canvas, outputColorSpace: "", toneMapping: 0, toneMappingExposure: 1 }
    props.onCreated({ gl })
    // O renderer vai junto: o diagnóstico do laboratório lê `renderer.info` (triângulos, draw calls).
    expect(onCanvasReady).toHaveBeenCalledWith(canvas, gl)
  })

  it("falha de WebGL/GLB vira um fallback estático — a página não quebra", () => {
    canvasMode.throws = true
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<IniaHumanoidAvatar3D modelUrl="/quebrado.glb" state="speaking" driver={fakeDriver()} />)
    expect(screen.getByText("Avatar indisponível agora. A conversa continua normalmente.")).toBeInTheDocument()
    expect(screen.getByLabelText("Avatar 3D da INIA: Respondendo")).toBeInTheDocument()
    warn.mockRestore()
    error.mockRestore()
  })

  it("sem WebGL mostra o fallback estático e nem monta o Canvas (a falha do R3F seria assíncrona)", () => {
    webglSupport.probe = () => false
    const { getByRole } = render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} />)
    expect(canvasRenders).not.toHaveBeenCalled()
    expect(getByRole("status").textContent).toContain("Avatar indisponível")
  })
})
