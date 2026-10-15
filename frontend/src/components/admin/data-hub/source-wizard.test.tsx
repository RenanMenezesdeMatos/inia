/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { DataContract, DatabaseObjectDescription, Preview } from "@/schemas/admin/data-hub.schema"

const service = vi.hoisted(() => ({
  fetchSource: vi.fn(),
  fetchContracts: vi.fn(),
  fetchDatabaseObjects: vi.fn(),
  fetchDatabaseColumns: vi.fn(),
  fetchSourceSample: vi.fn(),
  previewSourceMapping: vi.fn(),
  createFeed: vi.fn(),
  setFeedStatus: vi.fn(),
  syncFeedNow: vi.fn(),
}))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("sourceId=src-1"), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))

import { SourceWizard } from "./source-wizard"

afterEach(cleanup)
// Radix Select pede APIs que o jsdom não tem; stubs mínimos só para abrir a lista.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})

const CONTRACT: DataContract = {
  key: "EMPLOYEES",
  version: 1,
  label: "Colaboradores",
  description: "Cadastro de pessoas.",
  category: "MASTER",
  targetEntity: "people",
  fields: [
    { key: "externalEmployeeId", label: "Matrícula / ID externo", type: "STRING", required: true, identity: true, description: "Identidade.", example: "OP-1" },
    { key: "name", label: "Nome", type: "STRING", required: true, description: "Nome.", example: "Ana" },
  ],
  naturalKey: ["externalEmployeeId"],
  dependencies: [],
  writeSemantics: "UPSERT",
  writePolicy: "PARTIAL_ALLOWED",
  businessTimeField: null,
  examples: [],
}

const DESCRIPTION: DatabaseObjectDescription = {
  schema: "dbo",
  name: "colaboradores",
  kind: "TABLE",
  primaryKey: ["matricula"],
  columns: [
    { name: "matricula", nativeType: "varchar(20)", category: "TEXT", nullable: false, primaryKeyPosition: 1, supported: true, cursorEligible: false, keyEligible: true },
    { name: "nome", nativeType: "nvarchar(120)", category: "TEXT", nullable: false, primaryKeyPosition: null, supported: true, cursorEligible: false, keyEligible: true },
    { name: "atualizado_em", nativeType: "datetime2(7)", category: "DATETIME", nullable: false, primaryKeyPosition: null, supported: true, cursorEligible: true, keyEligible: true },
  ],
}

const PREVIEW: Preview = {
  rows: [{ recordNumber: 1, sourceRecordKey: "OP-1", valid: true, record: { externalEmployeeId: "OP-1", name: "Ana" }, errors: [], normalized: {} }],
  sampled: 1,
  valid: 1,
  rejected: 0,
  mappingProblems: [],
  schemaWarnings: [],
  fingerprint: { columns: ["matricula", "nome"], hash: "abc" },
  errorSummary: [],
}

function currentStep(): string | null {
  return document.querySelector('[aria-label="Etapas"] [aria-current="step"]')?.textContent ?? null
}

describe("Adicionar conjunto de dados a uma conexão de banco existente", () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset())
    service.fetchSource.mockResolvedValue({ id: "src-1", publicId: "abc", name: "RH", description: null, kind: "DATABASE", status: "ACTIVE", config: {}, connectionHealth: "HEALTHY", connectionCheckedAt: "2026-10-15T10:00:00Z", connectionError: null, createdAt: "", updatedAt: "", feedCount: 0, activeFeedCount: 0, freshness: "NEVER", lastRunAt: null, lastSuccessAt: null, lastDataAt: null, nextSyncAt: null, lastRecordsReceived: null, lastRecordsRejected: null, feeds: [], secrets: [], tokens: [] })
    service.fetchContracts.mockResolvedValue({ contracts: [CONTRACT], dependencies: [], errorCodes: { run: [], record: [] } })
    service.fetchDatabaseObjects.mockResolvedValue({ objects: [{ schema: "dbo", name: "colaboradores", kind: "TABLE", estimatedRows: 30 }], truncated: false })
    service.fetchDatabaseColumns.mockResolvedValue(DESCRIPTION)
    service.fetchSourceSample.mockResolvedValue({ columns: ["matricula", "nome"], records: [{ matricula: "OP-1", nome: "Ana" }], totalRecords: 1, detail: "Amostra de 1 linha", suggestedMapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }, { target: "name", source: "nome", transforms: [] }] } })
    service.previewSourceMapping.mockResolvedValue(PREVIEW)
    service.createFeed.mockResolvedValue({ id: "feed-1" })
    service.setFeedStatus.mockResolvedValue({ id: "feed-1" })
    service.syncFeedNow.mockResolvedValue({ id: "run-1" })
  })

  it("'Adicionar outro conjunto desta conexão' recomeça o assistente em 'Tabela ou visão' (antes: mesmo endereço, nada acontecia)", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <SourceWizard />
        </TooltipProvider>
      </QueryClientProvider>,
    )
    const next = () => screen.getByRole("button", { name: /Continuar/ })

    expect(await screen.findByText("Adicionar conjunto de dados — RH")).toBeInTheDocument()
    expect(currentStep()).toContain("Tabela ou visão")
    fireEvent.click(await screen.findByRole("option", { name: /colaboradores/ }))
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())

    fireEvent.click(screen.getByRole("combobox", { name: /Qual conjunto de dados da INIA/ }))
    fireEvent.click(screen.getByRole("option", { name: /Colaboradores/ }))
    expect(screen.getByLabelText("Nome deste conjunto de dados")).toHaveValue("Colaboradores · colaboradores")
    fireEvent.click(next())

    const reviewed = await screen.findByRole("switch", { name: "Conferi os campos obrigatórios" })
    await waitFor(() => expect(reviewed).toBeEnabled())
    fireEvent.click(reviewed)
    fireEvent.click(next())

    const activate = await screen.findByRole("button", { name: /Ativar/ })
    await waitFor(() => expect(activate).toBeEnabled())
    fireEvent.click(activate)
    expect(await screen.findByText("Conjunto de dados ativado")).toBeInTheDocument()
    expect(service.createFeed).toHaveBeenCalledWith("src-1", expect.objectContaining({ name: "Colaboradores · colaboradores", contractKey: "EMPLOYEES" }))

    fireEvent.click(screen.getByText("Adicionar outro conjunto desta conexão"))
    expect(screen.queryByText("Conjunto de dados ativado")).not.toBeInTheDocument()
    expect(currentStep()).toContain("Tabela ou visão")
    expect(screen.getByTestId("database-reuse-note")).toBeInTheDocument()
    // Nada da rodada anterior: nenhuma tabela escolhida, então ainda não dá para continuar.
    expect(await screen.findByRole("option", { name: /colaboradores/ })).toHaveAttribute("aria-selected", "false")
    expect(next()).toBeDisabled()
  })
})
