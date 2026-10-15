/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"

const service = vi.hoisted(() => ({ fetchFeed: vi.fn(), fetchContracts: vi.fn(), deleteFeed: vi.fn(), updateFeed: vi.fn() }))
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

describe("Conjunto de dados numa versão anterior do contrato", () => {
  const ABSENCES_V2 = {
    key: "EMPLOYEE_ABSENCES",
    version: 2,
    label: "Ausências (férias/afastamentos)",
    description: "Períodos explícitos.",
    category: "MASTER",
    targetEntity: "employee_status_periods",
    fields: [
      { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, description: "Matrícula.", example: "OP-1" },
      { key: "type", label: "Tipo (bruto)", type: "STRING", required: true, description: "Tipo.", example: "FERIAS" },
      { key: "startDate", label: "Início", type: "DATE", required: true, description: "Início.", example: "2026-10-05" },
      { key: "active", label: "Vigente?", type: "BOOLEAN", required: false, description: "false cancela a ausência.", example: true },
    ],
    naturalKey: ["externalEmployeeId", "type", "startDate"],
    dependencies: ["EMPLOYEES"],
    writeSemantics: "UPSERT",
    writePolicy: "PARTIAL_ALLOWED",
    businessTimeField: "startDate",
    examples: [],
  }
  const absencesFeed = (contractVersion: number) => ({
    ...FEED,
    name: "Ausências (CSV)",
    contractKey: "EMPLOYEE_ABSENCES",
    contractVersion,
    contractLabel: "Ausências (férias/afastamentos)",
    mapping: { fields: ["externalEmployeeId", "type", "startDate"].map((target) => ({ target, source: target, transforms: [] })) },
  })

  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset())
    service.fetchContracts.mockResolvedValue({ contracts: [ABSENCES_V2], dependencies: [], errorCodes: { run: [], record: [] } })
  })

  it("feed @1 avisa que o mapeamento já é o da versão 2 e, ao salvar, grava o feed na versão 2", async () => {
    service.fetchFeed.mockResolvedValue(absencesFeed(1))
    service.updateFeed.mockResolvedValue({ ...absencesFeed(2), updatedAt: "2026-10-15T11:00:00Z" })
    renderPage()
    expect(await screen.findByText(/Este conjunto lê os dados pela versão 1 do contrato\. O mapeamento abaixo já é o da versão 2/)).toBeInTheDocument()
    expect(screen.getAllByText("Vigente?").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("button", { name: /Salvar feed/ }))
    await waitFor(() => expect(service.updateFeed).toHaveBeenCalledWith("feed-1", expect.objectContaining({ contractVersion: 2 })))
  })

  it("feed já na versão atual não mostra aviso", async () => {
    service.fetchFeed.mockResolvedValue(absencesFeed(2))
    renderPage()
    expect(await screen.findByRole("heading", { name: "Ausências (CSV)" })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText("Vigente?").length).toBeGreaterThan(0))
    expect(screen.queryByText(/lê os dados pela versão/)).not.toBeInTheDocument()
  })
})
