/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import type { ReactNode } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
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

const TOPIC = { id: "t-1", name: "Política", requiredBehavior: "Não opine sobre política.", active: true }
const TERM = { id: "g-1", term: "TMA", definition: "Tempo médio de atendimento.", feedbackApplication: "Tempo médio de atendimento.", active: true }

/** API falsa: as listas devolvem um item; PATCH/DELETE ficam registrados. */
function stubApi() {
  const calls: { method: string; url: string; body: unknown }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET"
      calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      if (method === "DELETE") return new Response(null, { status: 204 })
      const items = url.includes("/glossary") ? [TERM] : [TOPIC]
      const data = method === "GET" ? { items, total: 1, page: 1, pageSize: 10 } : { ...items[0], active: false }
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } })
    }),
  )
  return calls
}

describe("GovernancePage — desativar e excluir", () => {
  it.each([
    ["Assuntos proibidos", "Política", "assunto", "/api/v1/admin/prohibited-topics/t-1"],
    ["Glossário geral", "TMA", "termo", "/api/v1/admin/glossary/g-1"],
  ])("%s: o switch desativa (PATCH active=false) e Excluir só apaga depois de confirmar", async (tab, name, label, path) => {
    const calls = stubApi()
    navigation.search = new URLSearchParams(tab === "Glossário geral" ? "tab=glossary" : "")
    renderPage()
    const panel = screen.getByRole("tabpanel", { name: tab })
    await within(panel).findAllByText(name)

    fireEvent.click(within(panel).getByRole("switch", { name: `Desativar ${label}` }))
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && call.url.endsWith(path))).toBe(true))
    expect(calls.find((call) => call.method === "PATCH")!.body).toEqual({ active: false })

    fireEvent.click(within(panel).getByRole("button", { name: `Excluir ${label}` }))
    const dialog = await screen.findByRole("alertdialog")
    expect(calls.some((call) => call.method === "DELETE")).toBe(false)
    fireEvent.click(within(dialog).getByRole("button", { name: "Excluir" }))
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.url.endsWith(path))).toBe(true))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  })
})
