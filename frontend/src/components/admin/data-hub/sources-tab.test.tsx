/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { SourceSummary } from "@/schemas/admin/data-hub.schema"

const service = vi.hoisted(() => ({ fetchSources: vi.fn() }))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))

import { SourcesTab } from "./sources-tab"

afterEach(cleanup)

function source(id: string, name: string, kind: SourceSummary["kind"], connectionHealth: SourceSummary["connectionHealth"]): SourceSummary {
  return { id, publicId: id, name, description: null, kind, status: "ACTIVE", config: {}, connectionHealth, connectionCheckedAt: "2026-10-15T10:00:00Z", connectionError: null, createdAt: "", updatedAt: "", feedCount: 0, activeFeedCount: 0, freshness: "NEVER", lastRunAt: null, lastSuccessAt: null, lastDataAt: null, nextSyncAt: null, lastRecordsReceived: null, lastRecordsRejected: null, feeds: [] }
}

describe("lista de Fontes — coluna Conexão", () => {
  it("banco externo mostra a saúde da conexão (antes: '—' mesmo com 'Conexão OK' no detalhe); arquivo continua sem conexão", async () => {
    service.fetchSources.mockResolvedValue([source("src-db", "SQL Server RH", "DATABASE", "HEALTHY"), source("src-file", "Importação manual", "FILE_UPLOAD", "UNKNOWN")])
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SourcesTab />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole("link", { name: "SQL Server RH" })).toBeInTheDocument()
    const connectionColumn = screen.getAllByRole("columnheader").findIndex((header) => header.textContent === "Conexão")
    const cell = (name: string) => within(screen.getByRole("link", { name }).closest("tr")!).getAllByRole("cell")[connectionColumn]!
    expect(cell("SQL Server RH")).toHaveTextContent("Conexão OK")
    expect(cell("Importação manual")).toHaveTextContent("—")
  })
})
