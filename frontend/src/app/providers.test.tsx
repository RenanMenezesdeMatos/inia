/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { renderToString } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useQueryClient } from "@tanstack/react-query"
import { useTheme } from "next-themes"

/**
 * Providers da raiz: cada um existe UMA vez (antes o RootLayout e ./providers.tsx montavam ThemeProvider e AccessibilityProvider
 * cada um — duas instâncias de acessibilidade no mesmo localStorage/<html>). As contagens abaixo seriam 2 com a duplicação.
 */
const renders = vi.hoisted(() => ({ theme: 0, accessibility: 0, themeNonce: undefined as string | undefined }))
vi.mock("@/components/theme-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/theme-provider")>()
  return { ThemeProvider: (props: Parameters<typeof actual.ThemeProvider>[0]) => { renders.theme++; renders.themeNonce = props.nonce; return actual.ThemeProvider(props) } }
})
vi.mock("@/lib/accessibility/accessibility-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/accessibility/accessibility-provider")>()
  return { ...actual, AccessibilityProvider: (props: Parameters<typeof actual.AccessibilityProvider>[0]) => { renders.accessibility++; return actual.AccessibilityProvider(props) } }
})
vi.mock("next/font/google", () => ({ Atkinson_Hyperlegible: () => ({ variable: "font-atkinson" }), Atkinson_Hyperlegible_Next: () => ({ variable: "font-atkinson-next" }), IBM_Plex_Mono: () => ({ variable: "font-plex-mono" }) }))
vi.mock("./globals.css", () => ({}))
// Nonce da CSP que o proxy repassa ao RootLayout (src/proxy.ts).
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-nonce": "bm9uY2UtZGEtcmVxdWlzaWNhbw==" }) }))

const { default: RootLayout } = await import("./layout")
const { Providers } = await import("./providers")
const { ACCESSIBILITY_STORAGE_KEY } = await import("@/lib/accessibility/accessibility-provider")
const { useAccessibility } = await import("@/lib/accessibility/accessibility-context")
const { Tooltip, TooltipContent, TooltipTrigger } = await import("@/components/ui/tooltip")

function Probe() {
  const accessibility = useAccessibility()
  const theme = useTheme()
  useQueryClient() // lança sem QueryProvider
  return (
    <div>
      <span data-testid="high-contrast">{String(accessibility.preferences.highContrast)}</span>
      <button type="button" onClick={accessibility.toggleHighContrast}>alternar contraste</button>
      <button type="button" onClick={() => theme.setTheme("dark")}>tema escuro</button>
      {/* Radix Tooltip lança sem TooltipProvider. */}
      <Tooltip><TooltipTrigger>dica</TooltipTrigger><TooltipContent>conteúdo</TooltipContent></Tooltip>
    </div>
  )
}

beforeEach(() => {
  renders.theme = 0
  renders.accessibility = 0
  renders.themeNonce = undefined
  window.localStorage.clear()
  document.documentElement.className = ""
  Object.defineProperty(window, "matchMedia", { configurable: true, value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }) })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("Providers da raiz — uma instância de cada", () => {
  it("A) a composição do RootLayout monta exatamente 1 ThemeProvider e 1 AccessibilityProvider — o tema recebe o nonce da CSP", async () => {
    renderToString(await RootLayout({ children: <p>página</p> }))
    expect(renders).toEqual({ theme: 1, accessibility: 1, themeNonce: "bm9uY2UtZGEtcmVxdWlzaWNhbw==" })
  })

  it("B/C) preferência alterada → localStorage e <html>; remontagem (reload) preserva — o padrão nunca sobrescreve o que está salvo", () => {
    const first = render(<Providers><Probe /></Providers>)
    expect(screen.getByTestId("high-contrast")).toHaveTextContent("false")
    fireEvent.click(screen.getByRole("button", { name: "alternar contraste" }))
    expect(JSON.parse(window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)!)).toMatchObject({ highContrast: true })
    expect(document.documentElement).toHaveClass("a11y-high-contrast")
    first.unmount()

    document.documentElement.classList.remove("a11y-high-contrast")
    const writes = vi.spyOn(Storage.prototype, "setItem")
    render(<Providers><Probe /></Providers>)
    expect(screen.getByTestId("high-contrast")).toHaveTextContent("true")
    expect(document.documentElement).toHaveClass("a11y-high-contrast")
    const accessibilityWrites = writes.mock.calls.filter(([key]) => key === ACCESSIBILITY_STORAGE_KEY).map(([, value]) => JSON.parse(value) as { highContrast: boolean })
    expect(accessibilityWrites.every((value) => value.highContrast)).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(ACCESSIBILITY_STORAGE_KEY)!)).toMatchObject({ highContrast: true })
  })

  it("D/E) tema continua funcionando e os demais providers (Query, Tooltip, Toaster) estão presentes", () => {
    render(<Providers><Probe /></Providers>)
    act(() => fireEvent.click(screen.getByRole("button", { name: "tema escuro" })))
    expect(document.documentElement).toHaveClass("dark")
    expect(window.localStorage.getItem("theme")).toBe("dark")
    expect(screen.getByText("dica")).toBeInTheDocument()
    expect(document.querySelector("section[aria-label^='Notifications']")).not.toBeNull()
  })

  it("F) Zod sem a sonda de eval: a CSP não tem 'unsafe-eval' e o teste de `Function(\"\")` virava violação em toda página", async () => {
    const { z } = await import("zod")
    expect(z.config().jitless).toBe(true)
  })
})
