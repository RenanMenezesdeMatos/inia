/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { DataContract, Preview, UploadResult } from "@/schemas/admin/data-hub.schema"

const service = vi.hoisted(() => ({
  fetchContracts: vi.fn(),
  fetchSources: vi.fn(),
  uploadFile: vi.fn(),
  fetchSourceSample: vi.fn(),
  previewSourceMapping: vi.fn(),
  createFeed: vi.fn(),
  importFile: vi.fn(),
  fetchRun: vi.fn(),
}))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }))

import { FileImportFlow } from "./file-import-flow"

afterEach(cleanup)
// Radix Select pede APIs que o jsdom não tem; stubs mínimos só para abrir a lista.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})

function contract(key: string, label: string, fields: DataContract["fields"]): DataContract {
  return { key, version: 1, label, description: `${label}.`, category: "EVENT", targetEntity: key.toLowerCase(), fields, naturalKey: [fields[0]!.key], dependencies: [], writeSemantics: "UPSERT", writePolicy: "PARTIAL_ALLOWED", businessTimeField: null, examples: [] }
}
const EMPLOYEES = contract("EMPLOYEES", "Colaboradores", [{ key: "externalEmployeeId", label: "Matrícula", type: "STRING", required: true, description: "Matrícula.", example: "OP-1" }])
const INTERACTIONS = contract("INTERACTIONS", "Interações", [{ key: "externalInteractionId", label: "ID da interação", type: "STRING", required: true, description: "ID.", example: "INT-1" }])

function uploaded(filename: string, format: "CSV" | "XLSX" = "CSV"): UploadResult {
  return { rawObjectId: `raw-${filename}`, filename, byteSize: 10, checksumSha256: "x", format, columns: ["matricula"], records: [{ matricula: "OP-1" }], totalRecords: 1, detail: null, sheets: format === "XLSX" ? ["Planilha1"] : [], suggestedMapping: null }
}

const PREVIEW: Preview = { rows: [{ recordNumber: 1, sourceRecordKey: "OP-1", valid: true, record: { externalEmployeeId: "OP-1" }, errors: [], normalized: {} }], sampled: 1, valid: 1, rejected: 0, mappingProblems: [], schemaWarnings: [], fingerprint: { columns: ["matricula"], hash: "h" }, errorSummary: [] }

function renderFlow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <FileImportFlow />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const next = () => screen.getByRole("button", { name: /Continuar/ })
const feedName = () => screen.getByLabelText("Nome do novo feed")

async function upload(result: UploadResult) {
  service.uploadFile.mockResolvedValueOnce(result)
  fireEvent.change(screen.getByLabelText("Arquivo (.csv ou .xlsx)"), { target: { files: [new File(["matricula\nOP-1"], result.filename)] } })
  expect(await screen.findByText(result.filename)).toBeInTheDocument()
  fireEvent.click(next())
}

function chooseContract(label: RegExp) {
  fireEvent.click(screen.getByRole("combobox", { name: "Tipo de dado (contrato)" }))
  fireEvent.click(screen.getByRole("option", { name: label }))
}

describe("Importar arquivo — nome do novo feed", () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset())
    service.fetchContracts.mockResolvedValue({ contracts: [EMPLOYEES, INTERACTIONS], dependencies: [], errorCodes: { run: [], record: [] } })
    service.fetchSources.mockResolvedValue([{ id: "src-file", publicId: "f", name: "Importação manual", description: null, kind: "FILE_UPLOAD", status: "ACTIVE", config: {}, connectionHealth: "UNKNOWN", connectionCheckedAt: null, connectionError: null, createdAt: "", updatedAt: "", feedCount: 0, activeFeedCount: 0, freshness: "NEVER", lastRunAt: null, lastSuccessAt: null, lastDataAt: null, nextSyncAt: null, lastRecordsReceived: null, lastRecordsRejected: null, feeds: [] }])
    service.fetchSourceSample.mockResolvedValue({ columns: ["matricula"], records: [{ matricula: "OP-1" }], totalRecords: 1, detail: null, suggestedMapping: { fields: [{ target: "externalEmployeeId", source: "matricula", transforms: [] }] } })
    service.previewSourceMapping.mockResolvedValue(PREVIEW)
    service.createFeed.mockResolvedValue({ id: "feed-1" })
    service.importFile.mockResolvedValue({ id: "run-1", alreadyProcessedRunId: null })
    service.fetchRun.mockImplementation(async (id: string) => ({ id: id || "nenhuma", status: "COMPLETED", stages: [], recordsReceived: 1, recordsValid: 1, recordsInserted: 1, recordsUpdated: 0, recordsUnchanged: 0, recordsRejected: 0, errorMessage: null, durationMs: 1200 }))
  })

  it("sugere '<tipo de dado> (CSV)' ao escolher o contrato e acompanha a troca até a pessoa digitar o próprio nome", async () => {
    renderFlow()
    await upload(uploaded("colaboradores.csv"))
    expect(feedName()).toHaveValue("")
    chooseContract(/Colaboradores/)
    expect(feedName()).toHaveValue("Colaboradores (CSV)")
    chooseContract(/Interações/)
    expect(feedName()).toHaveValue("Interações (CSV)")
    fireEvent.change(feedName(), { target: { value: "Pessoas do RH" } })
    chooseContract(/Colaboradores/)
    expect(feedName()).toHaveValue("Pessoas do RH")
    // Apagar o nome digitado volta a aceitar a sugestão.
    fireEvent.change(feedName(), { target: { value: "" } })
    chooseContract(/Interações/)
    expect(feedName()).toHaveValue("Interações (CSV)")
  })

  it("planilha Excel recebe '(Excel)' na sugestão", async () => {
    renderFlow()
    await upload(uploaded("colaboradores.xlsx", "XLSX"))
    chooseContract(/Colaboradores/)
    expect(feedName()).toHaveValue("Colaboradores (Excel)")
  })

  it("'Importar outro arquivo' recomeça limpo: nada do arquivo anterior (nome, tipo de dado, separador) passa adiante", async () => {
    renderFlow()
    await upload(uploaded("colaboradores.csv"))
    chooseContract(/Colaboradores/)
    fireEvent.change(feedName(), { target: { value: "Pessoas do RH" } })
    fireEvent.click(next())

    // Configuração: separador escolhido à mão neste arquivo.
    fireEvent.click(screen.getByRole("combobox", { name: "Separador" }))
    fireEvent.click(screen.getByRole("option", { name: "Ponto e vírgula (;)" }))
    fireEvent.click(next())
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    fireEvent.click(screen.getByRole("button", { name: /Importar agora/ }))
    await screen.findByRole("button", { name: "Importar outro arquivo" })
    expect(service.createFeed).toHaveBeenCalledWith("src-file", expect.objectContaining({ name: "Pessoas do RH", contractKey: "EMPLOYEES", connectorConfig: expect.objectContaining({ file: expect.objectContaining({ csv: expect.objectContaining({ delimiter: ";" }) }) }) }))

    fireEvent.click(screen.getByRole("button", { name: "Importar outro arquivo" }))
    expect(screen.queryByText("colaboradores.csv")).not.toBeInTheDocument()
    await upload(uploaded("interacoes.csv"))
    expect(service.uploadFile).toHaveBeenLastCalledWith(expect.objectContaining({ delimiter: "auto" }))
    expect(feedName()).toHaveValue("")
    expect(screen.getByRole("combobox", { name: "Tipo de dado (contrato)" })).toHaveTextContent("Selecione")
    chooseContract(/Interações/)
    expect(feedName()).toHaveValue("Interações (CSV)")
  })
})
