/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, render, renderHook, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Caracterização dos hooks que leem o navegador ou a URL (gravada ANTES de trocarem o efeito com setState por
 * `useSyncExternalStore`/ajuste durante a renderização): o valor que a tela enxerga depois de montar e quando a fonte muda.
 */

const navigation = vi.hoisted(() => ({ search: new URLSearchParams(), pathname: "/admin/workflows", replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.search,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
}))
const theme = vi.hoisted(() => ({ resolvedTheme: "dark" as string | undefined }))
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: theme.resolvedTheme }) }))

const { useIsMobile } = await import("./use-mobile")
const { useAutoOpenFromQuery } = await import("./use-auto-open-from-query")
const { useReactFlowColorMode } = await import("./use-react-flow-color-mode")

type MediaListener = () => void
let mediaListeners: MediaListener[] = []
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width })
}
beforeEach(() => {
  mediaListeners = []
  setViewport(1024)
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: window.innerWidth < 768,
      media: query,
      addEventListener: (_: string, listener: MediaListener) => mediaListeners.push(listener),
      removeEventListener: (_: string, listener: MediaListener) => { mediaListeners = mediaListeners.filter((item) => item !== listener) },
    }),
  })
  navigation.search = new URLSearchParams()
  navigation.replace.mockReset()
  theme.resolvedTheme = "dark"
})
afterEach(cleanup)

describe("useIsMobile", () => {
  it("largura de desktop → false; atravessar o limite de 768 px atualiza; desmontar para de ouvir", () => {
    const { result, unmount } = renderHook(() => useIsMobile())
    expect(result.current).toBe(false)
    act(() => {
      setViewport(500)
      for (const listener of mediaListeners) listener()
    })
    expect(result.current).toBe(true)
    unmount()
    expect(mediaListeners).toHaveLength(0)
  })

  it("montado já no celular → true depois de montar", () => {
    setViewport(390)
    const { result } = renderHook(() => useIsMobile())
    expect(result.current).toBe(true)
  })
})

describe("useAutoOpenFromQuery", () => {
  it("sem o parâmetro: fechado e a URL não muda", () => {
    const { result } = renderHook(() => useAutoOpenFromQuery("new"))
    expect(result.current[0]).toBe(false)
    expect(navigation.replace).not.toHaveBeenCalled()
  })

  it("com o parâmetro: abre e limpa a URL uma vez; fechar pela tela fica fechado", () => {
    navigation.search = new URLSearchParams("new=1")
    const { result, rerender } = renderHook(() => useAutoOpenFromQuery("new"))
    expect(result.current[0]).toBe(true)
    expect(navigation.replace).toHaveBeenCalledTimes(1)
    expect(navigation.replace).toHaveBeenCalledWith("/admin/workflows", { scroll: false })
    act(() => result.current[1](false))
    rerender()
    expect(result.current[0]).toBe(false)
    expect(navigation.replace).toHaveBeenCalledTimes(1)
  })

  it("pedido consumido pela tela: um segundo ?new (nova navegação) abre de novo", () => {
    navigation.search = new URLSearchParams("new=1")
    const { result, rerender } = renderHook(() => useAutoOpenFromQuery("new"))
    expect(result.current[0]).toBe(true)
    act(() => result.current[1](false))
    navigation.search = new URLSearchParams()
    rerender()
    expect(result.current[0]).toBe(false)
    navigation.search = new URLSearchParams("new=1")
    rerender()
    expect(result.current[0]).toBe(true)
    expect(navigation.replace).toHaveBeenCalledTimes(2)
  })

  it("o parâmetro chega depois (nova URL) → abre", () => {
    const { result, rerender } = renderHook(() => useAutoOpenFromQuery("new"))
    expect(result.current[0]).toBe(false)
    navigation.search = new URLSearchParams("new=1")
    rerender()
    expect(result.current[0]).toBe(true)
    expect(navigation.replace).toHaveBeenCalledTimes(1)
  })
})

describe("useReactFlowColorMode", () => {
  function Probe() {
    return <span data-testid="mode">{useReactFlowColorMode()}</span>
  }

  it("depois de montar segue o tema resolvido (escuro → dark; claro → light)", () => {
    const { rerender } = render(<Probe />)
    expect(screen.getByTestId("mode")).toHaveTextContent("dark")
    theme.resolvedTheme = "light"
    rerender(<Probe />)
    expect(screen.getByTestId("mode")).toHaveTextContent("light")
  })

  it("tema ainda não resolvido → light", () => {
    theme.resolvedTheme = undefined
    render(<Probe />)
    expect(screen.getByTestId("mode")).toHaveTextContent("light")
  })
})
