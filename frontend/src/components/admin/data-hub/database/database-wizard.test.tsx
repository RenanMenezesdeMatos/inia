/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import type { ConnectionTest, DatabaseObjectDescription } from "@/schemas/admin/data-hub.schema"

const service = vi.hoisted(() => ({
  fetchContracts: vi.fn(),
  createSource: vi.fn(),
  updateSource: vi.fn(),
  testDatabaseConnection: vi.fn(),
  fetchDatabaseObjects: vi.fn(),
  fetchDatabaseColumns: vi.fn(),
  fetchSourceSample: vi.fn(),
  previewSourceMapping: vi.fn(),
  createFeed: vi.fn(),
  setFeedStatus: vi.fn(),
  syncFeedNow: vi.fn(),
}))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))

import { DatabaseTestResult, databaseDraftProblems, draftSignature, emptyDatabaseDraft, switchEngine, toDatabaseConfig } from "./database-connection-fields"
import { DatabaseSyncSettings, suggestSync, toDatabaseSync } from "./database-sync-settings"
import { DatabaseWizard } from "./database-wizard"

afterEach(cleanup)

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  )
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
    { name: "foto", nativeType: "varbinary(max)", category: "BINARY", nullable: true, primaryKeyPosition: null, supported: false, cursorEligible: false, keyEligible: false },
  ],
}

describe("rascunho da conexão — banco externo", () => {
  it("conexão nova valida o certificado (qualquer banco), instância nomeada sem porta e problemas em linguagem simples", () => {
    const draft = { ...emptyDatabaseDraft("POSTGRESQL"), name: "RH", host: "db.cliente.local", database: "rh", username: "leitura", password: "x" }
    expect(toDatabaseConfig(draft)).toMatchObject({ engine: "POSTGRESQL", host: "db.cliente.local", tls: { mode: "VERIFY_FULL" }, connectTimeoutMs: 15_000 })
    expect(toDatabaseConfig(draft)).not.toHaveProperty("port")
    const sqlServer = { ...switchEngine(draft, "SQLSERVER"), port: "1433", instanceName: "SQLEXPRESS" }
    expect(toDatabaseConfig(sqlServer)).toMatchObject({ engine: "SQLSERVER", instanceName: "SQLEXPRESS", tls: { mode: "VERIFY_FULL" } })
    // Modo escolhido que o outro banco não tem ("quando oferecer" não existe no SQL Server) volta à validação do certificado.
    expect(switchEngine({ ...draft, tlsMode: "PREFERRED" }, "SQLSERVER").tlsMode).toBe("VERIFY_FULL")
    expect(switchEngine({ ...draft, tlsMode: "REQUIRED" }, "MYSQL").tlsMode).toBe("REQUIRED")
    expect(toDatabaseConfig(sqlServer)).not.toHaveProperty("port")
    expect(databaseDraftProblems({ ...draft, host: "postgres://u:p@host" }, true)[0]).toMatch(/sem protocolo/)
    expect(databaseDraftProblems({ ...draft, host: "host:5432" }, true)[0]).toMatch(/Porta/)
    expect(databaseDraftProblems({ ...draft, password: "" }, true)).toContain("Informe a senha.")
    expect(databaseDraftProblems({ ...draft, password: "" }, false)).toEqual([])
    // Qualquer mudança invalida o teste anterior.
    expect(draftSignature(draft)).not.toBe(draftSignature({ ...draft, database: "outro" }))
  })
})

describe("leitura sugerida", () => {
  it("incremental quando há data/hora de atualização; senão leitura completa pela chave primária", () => {
    expect(suggestSync(DESCRIPTION)).toMatchObject({ mode: "INCREMENTAL", cursorColumn: "atualizado_em", keyColumns: ["matricula"] })
    const noCursor = { ...DESCRIPTION, columns: DESCRIPTION.columns.filter((column) => column.name !== "atualizado_em") }
    expect(suggestSync(noCursor)).toMatchObject({ mode: "FULL", keyColumns: ["matricula"] })
    expect(toDatabaseSync({ mode: "INCREMENTAL", cursorColumn: "atualizado_em", keyColumns: ["atualizado_em", "matricula", ""], lookbackMinutes: 5, batchSize: 1000, maxRowsPerRun: 50000 })).toEqual({ mode: "INCREMENTAL", cursorColumn: "atualizado_em", keyColumns: ["matricula"], lookbackMinutes: 5 })
  })

  it("sem coluna elegível, explica a limitação e não oferece incremental", () => {
    const noCursor = { ...DESCRIPTION, columns: DESCRIPTION.columns.filter((column) => column.name !== "atualizado_em") }
    wrap(<DatabaseSyncSettings description={noCursor} value={suggestSync(noCursor)} onChange={() => {}} />)
    expect(screen.getByText(/não tem coluna de data\/hora ou número/)).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Incremental" })).toBeDisabled()
  })
})

describe("resultado do teste de conexão", () => {
  it("sucesso mostra versão, TLS, somente leitura e aviso de privilégio; erro mostra o motivo e o código", () => {
    const ok: ConnectionTest = { health: "HEALTHY", detail: "", errorCode: null, checkedAt: "2026-10-06T00:00:00Z", database: { serverVersion: "SQL Server 16.0", engineFound: "SQLSERVER", engineMismatch: null, tlsActive: true, readOnlyEnforced: false, privilegeWarning: "Este login é sysadmin", objectsVisible: 3 } }
    wrap(<DatabaseTestResult result={ok} />)
    expect(screen.getByText("Conexão OK")).toBeInTheDocument()
    expect(screen.getByText("Tráfego cifrado (TLS)")).toBeInTheDocument()
    expect(screen.getByText(/Somente leitura garantida pela INIA/)).toBeInTheDocument()
    expect(screen.getByText("Este login é sysadmin")).toBeInTheDocument()
    cleanup()
    wrap(<DatabaseTestResult result={{ health: "ERROR", detail: "O SQL Server recusou o usuário.", errorCode: "DATA_SOURCE_AUTH_FAILED", checkedAt: "2026-10-06T00:00:00Z" }} />)
    expect(screen.getByText("Não foi possível conectar")).toBeInTheDocument()
    expect(screen.getByText("DATA_SOURCE_AUTH_FAILED")).toBeInTheDocument()
  })
})

describe("assistente Conectar banco de dados", () => {
  beforeEach(() => {
    Object.values(service).forEach((fn) => fn.mockReset())
    service.fetchContracts.mockResolvedValue({ contracts: [], dependencies: [], errorCodes: { run: [], record: [] } })
  })

  it("banco → conexão: só continua depois de testar; salvar cria a conexão com a senha e abre a escolha da tabela", async () => {
    service.testDatabaseConnection.mockResolvedValue({ health: "HEALTHY", detail: "ok", errorCode: null, checkedAt: "2026-10-06T00:00:00Z", database: { serverVersion: "PostgreSQL 17", engineFound: "POSTGRESQL", engineMismatch: null, tlsActive: false, readOnlyEnforced: true, privilegeWarning: null, objectsVisible: 2 } })
    service.createSource.mockResolvedValue({ id: "src-1", publicId: "abc", name: "RH", description: null, kind: "DATABASE", status: "DRAFT", config: {}, connectionHealth: "UNKNOWN", connectionCheckedAt: null, connectionError: null, createdAt: "", updatedAt: "" })
    service.fetchDatabaseObjects.mockResolvedValue({ objects: [{ schema: "public", name: "colaboradores", kind: "TABLE", estimatedRows: 30 }, { schema: "public", name: "vw_ativos", kind: "VIEW", estimatedRows: null }], truncated: false })
    service.fetchDatabaseColumns.mockResolvedValue({ ...DESCRIPTION, schema: "public" })

    wrap(<DatabaseWizard />)
    const next = () => screen.getByRole("button", { name: /Continuar|Salvar e continuar/ })
    expect(next()).toBeDisabled()
    fireEvent.click(screen.getByRole("radio", { name: /PostgreSQL/ }))
    fireEvent.click(next())

    fireEvent.change(screen.getByLabelText("Nome da conexão"), { target: { value: "RH" } })
    fireEvent.change(screen.getByLabelText("Servidor"), { target: { value: "db.cliente.local" } })
    fireEvent.change(screen.getByLabelText("Banco de dados"), { target: { value: "rh" } })
    fireEvent.change(screen.getByLabelText("Usuário"), { target: { value: "leitura" } })
    fireEvent.change(screen.getByLabelText("Senha"), { target: { value: "S3nha" } })
    expect(screen.getByPlaceholderText("5432")).toBeInTheDocument()
    expect(next()).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: /Testar conexão/ }))
    await screen.findByText("Conexão OK")
    expect(service.testDatabaseConnection).toHaveBeenCalledWith({ config: expect.objectContaining({ engine: "POSTGRESQL", host: "db.cliente.local", database: "rh", username: "leitura" }), password: "S3nha", sourceId: undefined })
    // Mudar um campo depois do teste exige testar de novo.
    fireEvent.change(screen.getByLabelText("Banco de dados"), { target: { value: "rh2" } })
    expect(next()).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Banco de dados"), { target: { value: "rh" } })
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    await waitFor(() => expect(service.createSource).toHaveBeenCalledWith({ name: "RH", config: { kind: "DATABASE", database: expect.objectContaining({ engine: "POSTGRESQL" }) }, secrets: { password: "S3nha" } }))

    fireEvent.click(await screen.findByRole("option", { name: /colaboradores/ }))
    expect(await screen.findByText(/Tabela public.colaboradores · 4 coluna\(s\)/)).toBeInTheDocument()
    expect(screen.getByText("Binário (não importado)")).toBeInTheDocument()
    await waitFor(() => expect(next()).toBeEnabled())
  })
})
