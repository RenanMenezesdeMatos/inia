/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

import type { IniaHumanoidAvatar3DProps } from "@/components/operator/inia-humanoid-avatar-3d"

// O avatar 3D real tem os próprios testes (Canvas renderiza uma vez). Aqui o que importa é o que o
// laboratório entrega a ele: o MESMO driver sempre, e nenhum controle além do modelo mudando props
// que recriam a cena.
const avatarProps: IniaHumanoidAvatar3DProps[] = []
vi.mock("@/components/operator/inia-humanoid-avatar-3d", () => ({
  IniaHumanoidAvatar3D: (props: IniaHumanoidAvatar3DProps) => {
    avatarProps.push(props)
    return <div data-testid="avatar" data-view={props.view} data-quality={props.quality} data-model={props.modelUrl} />
  },
}))

import { AvatarLab } from "./avatar-lab"

// O painel de sincronia usa o Slider do Radix (ResizeObserver).
beforeAll(installJsdomStubs)

beforeEach(() => {
  avatarProps.length = 0
  // HEAD da mentora → 404 (o GLB ainda não existe); capturas → 404 (não baixa nada no teste).
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })))
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => null)
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("AvatarLab", () => {
  it("mostra os controles e o avatar com o POC quando a mentora não existe", async () => {
    render(<AvatarLab />)
    await act(async () => {})
    expect(screen.getByRole("heading", { name: "Laboratório do avatar da INIA" })).toBeInTheDocument()
    for (const name of ["Play", "Interromper (barge-in no meio da palavra)", "Cancelar resposta", "Gravar demonstração", "Falar texto (Live real)"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
    expect(screen.getByRole("button", { name: /Rodar sequência/ })).toBeInTheDocument()
    expect(screen.getByTestId("avatar")).toHaveAttribute("data-model", "/models/inia-avatar-poc.glb")
    expect(screen.getByText(/mentora ainda não existe/)).toBeInTheDocument()
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/models/inia-mentora.glb", expect.objectContaining({ method: "HEAD" }))
  })

  it("vista, qualidade, ajustes e sobreposição de estado nunca trocam o driver nem o modelo", async () => {
    render(<AvatarLab />)
    await act(async () => {})
    const driver = avatarProps[0]!.driver
    fireEvent.change(screen.getByLabelText("Vista"), { target: { value: "profile" } })
    fireEvent.change(screen.getByLabelText("Qualidade"), { target: { value: "low" } })
    fireEvent.change(screen.getByLabelText("Sorriso"), { target: { value: "1.5" } })
    fireEvent.click(screen.getByRole("button", { name: "Pensando" }))
    const avatar = screen.getByTestId("avatar")
    expect(avatar).toHaveAttribute("data-view", "profile")
    expect(avatar).toHaveAttribute("data-quality", "low")
    expect(avatarProps.at(-1)?.state).toBe("thinking")
    expect(driver.state).toBe("thinking")
    expect(driver.tuning.smile).toBe(1.5)
    expect(new Set(avatarProps.map((props) => props.driver)).size).toBe(1)
    expect(new Set(avatarProps.map((props) => props.modelUrl)).size).toBe(1)
    expect(new Set(avatarProps.map((props) => props.onCanvasReady)).size).toBe(1)
  })

  it("Interromper fica desabilitado sem fala e a sessão real sem login explica o motivo", async () => {
    vi.stubGlobal("AudioContext", class {
      state = "running"
      currentTime = 0
      destination = {}
      resume = async () => {}
      close = async () => {}
      createGain = () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} })
    })
    render(<AvatarLab />)
    await act(async () => {})
    expect(screen.getByRole("button", { name: "Interromper (barge-in no meio da palavra)" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Falar texto (Live real)" }))
    expect(await screen.findByText(/Sessão real indisponível/, { selector: "p" })).toBeInTheDocument()
  })
})
