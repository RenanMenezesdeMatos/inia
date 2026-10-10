/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/** Caracterização: a aba ativa acompanha a URL (?tab=) e trocar de aba pela tela atualiza a URL na hora. */
const navigation = vi.hoisted(() => ({ search: new URLSearchParams(), replace: vi.fn() }))
vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.search,
  usePathname: () => "/admin/governance",
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
}))

const { GovernancePage } = await import("./governance-page")

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})))
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  navigation.search = new URLSearchParams()
  navigation.replace.mockReset()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return render(<GovernancePage />, { wrapper })
}
const selected = (name: string) => screen.getByRole("tab", { name }).getAttribute("aria-selected")

describe("GovernancePage — aba × URL", () => {
  it("?tab=glossary abre o Glossário; a URL mudar para sem aba volta para Assuntos proibidos", () => {
    navigation.search = new URLSearchParams("tab=glossary")
    const { rerender } = renderPage()
    expect(selected("Glossário geral")).toBe("true")
    navigation.search = new URLSearchParams()
    rerender(<GovernancePage />)
    expect(selected("Assuntos proibidos")).toBe("true")
  })

  it("trocar de aba pela tela mostra a aba na hora e grava ?tab= na URL", () => {
    renderPage()
    expect(selected("Assuntos proibidos")).toBe("true")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Glossário geral" }))
    expect(selected("Glossário geral")).toBe("true")
    expect(navigation.replace).toHaveBeenCalledWith("/admin/governance?tab=glossary", { scroll: false })
  })
})
