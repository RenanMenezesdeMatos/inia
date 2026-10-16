/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
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

  it("o crédito CC BY 4.0 do modelo base fica escondido num \"i\" que abre pelo toque/teclado; `attribution={false}` o remove", () => {
    const { rerender } = render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} />)
    const trigger = screen.getByRole("button", { name: "Créditos do avatar 3D" })
    expect(screen.queryByText(/Black vizual/)).not.toBeInTheDocument()

    fireEvent.click(trigger)
    const credit = screen.getByText(/Black\s+vizual/)
    expect(credit).toHaveTextContent("Avatar 3D baseado em “Pixar style girl (rigging)”, de Black vizual, sob a licença CC BY 4.0. Modificado para a INIA.")
    expect(screen.getByRole("link", { name: "“Pixar style girl (rigging)”" })).toHaveAttribute("href", "https://sketchfab.com/3d-models/pixar-style-girl-rigging-c92355c9f57d467a9dfca2d05e52d376")
    expect(screen.getByRole("link", { name: "CC BY 4.0" })).toHaveAttribute("href", "https://creativecommons.org/licenses/by/4.0/")

    rerender(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} attribution={false} />)
    expect(screen.queryByRole("button", { name: "Créditos do avatar 3D" })).not.toBeInTheDocument()
    expect(screen.queryByText(/Black\s+vizual/)).not.toBeInTheDocument()
  })

  it("com o mouse, o crédito abre ao passar por cima e um clique não o fecha", () => {
    render(<IniaHumanoidAvatar3D modelUrl="/avatar.glb" state="idle" driver={fakeDriver()} attributionPlacement="top" />)
    const trigger = screen.getByRole("button", { name: "Créditos do avatar 3D" })
    expect(trigger).toHaveClass("top-2")

    // O jsdom não tem PointerEvent (o `pointerType` se perderia) e o React deriva o onPointerEnter do `pointerover`.
    fireEvent(trigger, Object.assign(new MouseEvent("pointerover", { bubbles: true }), { pointerType: "mouse" }))
    expect(screen.getByText(/Black\s+vizual/)).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.getByText(/Black\s+vizual/)).toBeInTheDocument()
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
