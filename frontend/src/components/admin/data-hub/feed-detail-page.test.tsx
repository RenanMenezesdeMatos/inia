/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"

const service = vi.hoisted(() => ({ fetchFeed: vi.fn(), fetchContracts: vi.fn(), deleteFeed: vi.fn() }))
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => router }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { FeedDetailPage } from "./feed-detail-page"

afterEach(cleanup)
// As abas do kit medem o indicador com ResizeObserver, que o jsdom não tem.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const FEED = {
  id: "feed-1",
  sourceId: "src-file",
  feedKey: "colaboradores-csv",
  name: "Colaboradores (CSV)",
  contractKey: "EMPLOYEES",
  contractVersion: 1,
  connectorConfig: { connector: "FILE_UPLOAD", file: { format: "CSV", csv: { encoding: "utf-8", delimiter: "auto", hasHeader: true, skipRows: 0 } } },
  mapping: { fields: [] },
  loadMode: "DELTA",
  cadence: { kind: "MANUAL" },
  expectedIntervalMinutes: null,
  status: "ACTIVE",
  authoritative: false,
  failOnAnyRejection: false,
  sourceNamespace: null,
  availabilityPolicy: null,
  schemaFingerprint: null,
  schemaChangedAt: null,
  checkpoint: null,
  lastRunAt: null,
  lastSuccessAt: null,
  lastDataAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  nextSyncAt: null,
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T10:00:00Z",
  freshness: "NEVER",
  contractLabel: "Colaboradores",
  lastRun: null,
  source: { id: "src-file", name: "Importação manual", kind: "FILE_UPLOAD", publicId: "f", status: "ACTIVE" },
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <FeedDetailPage feedId="feed-1" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

describe("Remover um conjunto de dados sozinho", () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset())
    router.push.mockReset()
    service.fetchFeed.mockResolvedValue(FEED)
    service.fetchContracts.mockResolvedValue({ contracts: [], dependencies: [], errorCodes: { run: [], record: [] } })
    service.deleteFeed.mockResolvedValue(undefined)
  })

  it("pede confirmação explicando que dados aplicados e histórico ficam; cancelar não remove nada", async () => {
    renderPage()
    expect(await screen.findByRole("heading", { name: "Colaboradores (CSV)" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Remover conjunto de dados" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog).toHaveTextContent("Remover Colaboradores (CSV)?")
    expect(dialog).toHaveTextContent("a conexão Importação manual e os outros conjuntos dela continuam")
    expect(dialog).toHaveTextContent("histórico de cargas e a linhagem são preservados")
    expect(dialog).toHaveTextContent("Os dados já aplicados ao domínio continuam existindo")
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
    expect(service.deleteFeed).not.toHaveBeenCalled()
  })

  it("confirmar remove pelo DELETE /feeds/:id e volta para a conexão", async () => {
    renderPage()
    fireEvent.click(await screen.findByRole("button", { name: "Remover conjunto de dados" }))
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }))
    await waitFor(() => expect(service.deleteFeed).toHaveBeenCalledWith("feed-1"))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/admin/data-hub/sources/src-file"))
  })
})
