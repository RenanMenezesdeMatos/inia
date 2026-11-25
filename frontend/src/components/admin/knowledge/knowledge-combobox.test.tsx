/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"

const api = vi.hoisted(() => ({ adminGet: vi.fn() }))
vi.mock("@/lib/admin/admin-api", async (original) => ({ ...(await original<typeof import("@/lib/admin/admin-api")>()), adminGet: api.adminGet }))

import { KnowledgeCombobox } from "./knowledge-combobox"

const doc = (id: string, title: string, operatingUniverse: "B2B" | "B2C") => ({ id, title, operatingUniverse, documentType: "PROCEDURE", sourceType: "TEXT", originalFilename: null, mimeType: null, fileSizeBytes: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: null, authorName: null, status: "ACTIVE", inUseVersion: 1, draftVersion: null, updateVersion: null, updateStatus: null, excerpt: null, orgScopes: [], subjectScopes: [] })
const page = (items: unknown[]) => ({ items, total: items.length, page: 1, pageSize: 30 })
const B2C = doc("k-b2c", "Cobrança B2C", "B2C")
const B2B = doc("k-b2b", "Cobrança B2B", "B2B")

installJsdomStubs()
beforeEach(() => {
  api.adminGet.mockReset()
})
afterEach(cleanup)

function Field({ saved = null }: { saved?: string | null }) {
  const [value, setValue] = useState<string | null>(saved)
  const [universe, setUniverse] = useState("B2C")
  return (
    <>
      <button type="button" onClick={() => setUniverse("B2B")}>Trocar universo</button>
      <KnowledgeCombobox value={value} onChange={(document) => setValue(document?.id ?? null)} universe={universe} emptyLabel="Nenhum" current={{ id: "k-salva", title: "Base salva" }} ariaLabel="Documento" />
      <output data-testid="value">{value}</output>
    </>
  )
}
const renderField = (props: Parameters<typeof Field>[0] = {}) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Field {...props} /></QueryClientProvider>)
const trigger = () => screen.getByRole("button", { name: /^Documento:/ })

describe("KnowledgeCombobox", () => {
  it("pede lotes de 30 por título e nunca deixa escolher a base do universo anterior enquanto o novo chega", async () => {
    const pending = Promise.withResolvers<unknown>()
    api.adminGet.mockImplementation((path: string) => (path.includes("ids=") ? Promise.resolve(page([])) : path.includes("B2B") ? pending.promise : Promise.resolve(page([B2C]))))
    renderField()
    fireEvent.click(trigger())
    await screen.findByRole("option", { name: "Cobrança B2C" })
    const params = new URLSearchParams(String(api.adminGet.mock.calls[0]![0]).split("?")[1])
    expect([params.get("sort"), params.get("pageSize")]).toEqual(["title", "30"])
    fireEvent.keyDown(screen.getByRole("combobox", { name: /Buscar base/ }), { key: "Escape" })
    fireEvent.click(screen.getByRole("button", { name: "Trocar universo" }))
    fireEvent.click(trigger())
    expect(screen.queryByRole("option", { name: "Cobrança B2C" })).not.toBeInTheDocument()
    pending.resolve(page([B2B]))
    expect(await screen.findByRole("option", { name: "Cobrança B2B" })).toBeInTheDocument()
  })

  it("escolher outra base mostra o título dela na hora, e não o da base salva, mesmo que a consulta por id falhe", async () => {
    api.adminGet.mockImplementation((path: string) => (path.includes("ids=") ? Promise.reject(new Error("rede")) : Promise.resolve(page([B2C]))))
    renderField({ saved: "k-salva" })
    expect(await screen.findByRole("button", { name: "Documento: Base salva" })).toBeInTheDocument()
    fireEvent.click(trigger())
    fireEvent.click(await screen.findByRole("option", { name: "Cobrança B2C" }))
    expect(screen.getByTestId("value")).toHaveTextContent("k-b2c")
    expect(trigger()).toHaveAccessibleName("Documento: Cobrança B2C")
  })

  it("falha ao buscar o título não vira \"fora do seu alcance\"", async () => {
    api.adminGet.mockRejectedValue(new Error("rede"))
    renderField({ saved: "k-outra" })
    await waitFor(() => expect(trigger()).toHaveAccessibleName("Documento: Base escolhida"))
  })
})
