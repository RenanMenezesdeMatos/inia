/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@/components/ui/tooltip"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { AuditEvent, DatabaseObjectDescription } from "@/schemas/admin/data-hub.schema"

const service = vi.hoisted(() => ({
  fetchSource: vi.fn(),
  fetchFeed: vi.fn(),
  fetchContracts: vi.fn(),
  fetchDatabaseObjects: vi.fn(),
  fetchDatabaseColumns: vi.fn(),
  fetchSourceSample: vi.fn(),
  previewSourceMapping: vi.fn(),
  unlockSourceConfiguration: vi.fn(),
  rotateSourceSecrets: vi.fn(),
  updateSource: vi.fn(),
  updateFeed: vi.fn(),
  setSourceStatus: vi.fn(),
  setFeedStatus: vi.fn(),
  testDatabaseConnection: vi.fn(),
  fetchAuditEventsPage: vi.fn(),
  fetchRunsPage: vi.fn(),
}))
const params = vi.hoisted(() => ({ value: new URLSearchParams("sourceId=src-1") }))
vi.mock("@/services/admin/data-hub-service", async (importOriginal) => ({ ...(await importOriginal<object>()), ...service }))
vi.mock("next/navigation", () => ({ useSearchParams: () => params.value, useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }), usePathname: () => "/admin/data-hub" }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { toast } from "sonner"

import { describeAuditEvent } from "../audit-log-labels"
import { AuditLogTab } from "../audit-log-tab"
import { FeedDetailPage } from "../feed-detail-page"
import { SourceDetailPage } from "../source-detail-page"
import { SourceWizard } from "../source-wizard"
import { credentialLabel } from "./config-unlock-form"

afterEach(cleanup)
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})

const LOCKED = { required: true, unlocked: false, expiresAt: null, fields: ["password"] }
const UNLOCKED = { required: true, unlocked: true, expiresAt: "2026-11-05T15:30:00.000Z", fields: ["password"] }
const LOCK_ERROR = () => new AdminApiError("Para configurar esta fonte, informe a senha dela de novo.", "DATA_SOURCE_CONFIG_LOCKED", { sourceId: "src-1", kind: "DATABASE", fields: ["password"] })

const SOURCE = {
  id: "src-1",
  publicId: "abc",
  name: "Banco do cliente",
  description: null,
  kind: "DATABASE",
  status: "DRAFT",
  config: { kind: "DATABASE", database: { engine: "SQLSERVER", host: "sql.cliente.local", port: 1433, database: "rh", username: "inia_leitura", tls: { mode: "VERIFY_FULL" }, connectTimeoutMs: 15000, queryTimeoutMs: 120000 } },
  connectionHealth: "HEALTHY",
  connectionCheckedAt: null,
  connectionError: null,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  feedCount: 0,
  activeFeedCount: 0,
  freshness: "NEVER",
  lastRunAt: null,
  lastSuccessAt: null,
  lastDataAt: null,
  nextSyncAt: null,
  lastRecordsReceived: null,
  lastRecordsRejected: null,
  feeds: [],
  secrets: [{ purpose: "DATABASE_PASSWORD", createdAt: "2026-11-05T10:00:00.000Z", rotatedAt: null }],
  tokens: [],
  transportWarning: null,
  configAccess: LOCKED,
  createdByName: "Gerente de Analytics",
  updatedByName: "Gerente de Analytics",
  lastChangedAt: "2026-11-05T10:05:00.000Z",
}

const DESCRIPTION: DatabaseObjectDescription = {
  schema: "dbo",
  name: "colaboradores",
  kind: "TABLE",
  primaryKey: ["matricula"],
  columns: [{ name: "matricula", nativeType: "varchar(20)", category: "TEXT", nullable: false, primaryKeyPosition: 1, supported: true, cursorEligible: false, keyEligible: true }],
}

const FEED = {
  id: "feed-1",
  sourceId: "src-1",
  feedKey: "colaboradores",
  name: "Colaboradores do RH",
  contractKey: "EMPLOYEES",
  contractVersion: 1,
  connectorConfig: { connector: "DATABASE", database: { object: { schema: "dbo", name: "colaboradores", kind: "TABLE" }, sync: { mode: "FULL", keyColumns: ["matricula"] }, batchSize: 500, maxRowsPerRun: 1000 } },
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
  configAccess: LOCKED,
  source: { id: "src-1", name: "Banco do cliente", kind: "DATABASE", publicId: "abc", status: "ACTIVE" },
}

const CONTRACT = { key: "EMPLOYEES", version: 1, label: "Colaboradores", description: "Cadastro.", category: "MASTER", targetEntity: "people", fields: [{ key: "externalEmployeeId", label: "Matrícula", type: "STRING", required: true, identity: true, description: "Identidade.", example: "OP-1" }], naturalKey: ["externalEmployeeId"], dependencies: [], writeSemantics: "UPSERT", writePolicy: "PARTIAL_ALLOWED", businessTimeField: null, examples: [] }

function wrap(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>{node}</TooltipProvider>
    </QueryClientProvider>,
  )
  return client
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.values(service).forEach((fn) => fn.mockReset())
  params.value = new URLSearchParams("sourceId=src-1")
  service.fetchSource.mockResolvedValue(SOURCE)
  service.fetchFeed.mockResolvedValue(FEED)
  service.fetchContracts.mockResolvedValue({ contracts: [CONTRACT], dependencies: [], errorCodes: { run: [], record: [] }, sourceKinds: [] })
  service.fetchDatabaseObjects.mockResolvedValue({ objects: [{ schema: "dbo", name: "colaboradores", kind: "TABLE", estimatedRows: 30 }], truncated: false })
  service.fetchDatabaseColumns.mockResolvedValue(DESCRIPTION)
  service.unlockSourceConfiguration.mockResolvedValue(UNLOCKED)
  service.fetchRunsPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
})

describe("campo certo para cada tipo de fonte", () => {
  it("nomeia a credencial pelo tipo", () => {
    expect(credentialLabel("password", "DATABASE")).toBe("Senha do banco de dados")
    expect(credentialLabel("password", "SFTP")).toBe("Senha do SFTP")
    expect(credentialLabel("password", "API_PULL")).toBe("Senha da API")
    expect(credentialLabel("token", "API_PULL")).toBe("Token de acesso")
    expect(credentialLabel("apiKey", "API_PULL")).toBe("Chave da API")
    expect(credentialLabel("clientSecret", "API_PULL")).toBe("Client secret")
    expect(credentialLabel("privateKey", "SFTP")).toBe("Chave privada (PEM)")
  })
})

describe("assistente com conexão existente", () => {
  it("pede a senha antes de continuar e não lê nada do banco do cliente até liberar", async () => {
    wrap(<SourceWizard />)
    const field = await screen.findByLabelText("Senha do banco de dados")
    expect(field).toHaveAttribute("type", "password")
    expect(screen.queryByText(/nada precisa ser digitado/)).not.toBeInTheDocument()
    expect(service.fetchDatabaseObjects).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: /Continuar/ })).toBeDisabled()

    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    fireEvent.change(field, { target: { value: "senha-certa" } })
    fireEvent.click(screen.getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(service.unlockSourceConfiguration).toHaveBeenCalledWith("src-1", { password: "senha-certa" }))
    expect(await screen.findByRole("option", { name: /colaboradores/ })).toBeInTheDocument()
    expect(service.fetchDatabaseObjects).toHaveBeenCalled()
  })

  it("senha errada: mostra o erro ao lado do campo e limpa o que foi digitado", async () => {
    service.unlockSourceConfiguration.mockRejectedValue(new AdminApiError("A senha informada não confere com a guardada nesta fonte.", "DATA_SOURCE_SECRET_INCORRECT"))
    wrap(<SourceWizard />)
    const field = await screen.findByLabelText("Senha do banco de dados")
    fireEvent.change(field, { target: { value: "errada" } })
    fireEvent.click(screen.getByRole("button", { name: /Liberar configuração/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("não confere")
    expect(field).toHaveValue("")
    expect(service.fetchDatabaseObjects).not.toHaveBeenCalled()
  })

  it("bloqueio por tentativas diz a partir de quando tentar", async () => {
    service.unlockSourceConfiguration.mockRejectedValue(new AdminApiError("Muitas tentativas com a senha errada nesta fonte.", "DATA_SOURCE_UNLOCK_TOO_MANY_ATTEMPTS", { retryAt: "2026-11-05T15:30:00.000Z" }))
    wrap(<SourceWizard />)
    fireEvent.change(await screen.findByLabelText("Senha do banco de dados"), { target: { value: "errada" } })
    fireEvent.click(screen.getByRole("button", { name: /Liberar configuração/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent(/Nova tentativa às \d{2}:\d{2}/)
  })

  it("a senha mudou no servidor: troca sem pedir a antiga, mas pelo teste real", async () => {
    service.rotateSourceSecrets.mockResolvedValue({ ...SOURCE })
    wrap(<SourceWizard />)
    await screen.findByLabelText("Senha do banco de dados")
    fireEvent.click(screen.getByRole("button", { name: /A senha mudou no servidor/ }))
    expect(screen.getByText(/a INIA conecta com a nova e só grava se funcionar/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Nova: senha do banco de dados/), { target: { value: "senha-nova" } })
    fireEvent.click(screen.getByRole("button", { name: /Testar e trocar/ }))
    await waitFor(() => expect(service.rotateSourceSecrets).toHaveBeenCalledWith("src-1", { password: "senha-nova" }))
    expect(service.unlockSourceConfiguration).not.toHaveBeenCalled()
  })

  it("troca recusada: o erro aparece uma vez só, ao lado do campo", async () => {
    service.rotateSourceSecrets.mockRejectedValue(new AdminApiError("Esta API responde igual com e sem credencial.", "DATA_SOURCE_CREDENTIAL_UNPROVEN"))
    wrap(<SourceWizard />)
    await screen.findByLabelText("Senha do banco de dados")
    fireEvent.click(screen.getByRole("button", { name: /A senha mudou no servidor/ }))
    fireEvent.change(screen.getByLabelText(/Nova: senha do banco de dados/), { target: { value: "senha-nova" } })
    fireEvent.click(screen.getByRole("button", { name: /Testar e trocar/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("responde igual com e sem credencial")
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("liberação vencida na lista de tabelas: pede a senha ali mesmo e volta a listar", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    service.fetchDatabaseObjects.mockRejectedValueOnce(LOCK_ERROR())
    wrap(<SourceWizard />)
    fireEvent.change(await screen.findByLabelText("Senha do banco de dados"), { target: { value: "senha-certa" } })
    fireEvent.click(screen.getByRole("button", { name: /Liberar configuração/ }))
    expect(await screen.findByRole("option", { name: /colaboradores/ })).toBeInTheDocument()
  })

  it("liberação vencida ao ler a amostra: abre o pedido de senha, repete a leitura e mantém o que foi preenchido", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    service.fetchSourceSample.mockRejectedValueOnce(LOCK_ERROR()).mockResolvedValue({ columns: ["matricula"], records: [{ matricula: "OP-1" }], totalRecords: 1, detail: "Amostra de 1 linha", suggestedMapping: { fields: [] } })
    wrap(<SourceWizard />)
    fireEvent.click(await screen.findByRole("option", { name: /colaboradores/ }))
    const next = () => screen.getByRole("button", { name: /Continuar/ })
    await waitFor(() => expect(next()).toBeEnabled())
    fireEvent.click(next())
    fireEvent.click(screen.getByRole("combobox", { name: /Qual conjunto de dados da INIA/ }))
    fireEvent.click(screen.getByRole("option", { name: /Colaboradores/ }))
    fireEvent.change(screen.getByLabelText("Nome deste conjunto de dados"), { target: { value: "Nome escrito à mão" } })
    fireEvent.click(next())

    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Informe a senha para continuar")).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText("Senha do banco de dados"), { target: { value: "senha-certa" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(service.fetchSourceSample).toHaveBeenCalledTimes(2))
    expect(await screen.findByText("Amostra de 1 linha")).toBeInTheDocument()
    expect(service.fetchSourceSample.mock.calls[1]).toEqual(service.fetchSourceSample.mock.calls[0])
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})

describe("detalhes da fonte", () => {
  it("sem liberação: mostra os dados, deixa testar, trava a edição e diz quem cadastrou", async () => {
    wrap(<SourceDetailPage sourceId="src-1" />)
    expect(await screen.findByTestId("source-authorship")).toHaveTextContent("cadastrada por Gerente de Analytics")
    expect(screen.getByTestId("source-authorship")).toHaveTextContent("última alteração por Gerente de Analytics")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuração" }))
    expect(await screen.findByTestId("config-locked")).toBeInTheDocument()
    const fields = screen.getByTestId("source-config-fields")
    expect(fields).toBeDisabled()
    expect(within(fields).getByLabelText(/Servidor/)).toHaveValue("sql.cliente.local")
    expect(screen.getByRole("button", { name: /Salvar conexão/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /^Testar$/ })).toBeEnabled()
    // Excluir e testar continuam na página.
    expect(screen.getByRole("button", { name: "Remover fonte" })).toBeEnabled()
    expect(screen.getByRole("button", { name: /Testar conexão/ })).toBeEnabled()
  })

  it("liberado: edita, e mostra até quando vale", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    wrap(<SourceDetailPage sourceId="src-1" />)
    await screen.findByTestId("source-authorship")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuração" }))
    expect(await screen.findByTestId("config-unlocked")).toHaveTextContent(/Configuração liberada para você até \d{2}:\d{2}/)
    expect(screen.getByTestId("source-config-fields")).toBeEnabled()
    expect(screen.queryByTestId("config-locked")).not.toBeInTheDocument()
  })

  it("SFTP: a chave privada fica mascarada e fora do corretor ortográfico também no formulário", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, kind: "SFTP", secrets: [], configAccess: { ...UNLOCKED, fields: ["privateKey"] }, config: { kind: "SFTP", sftp: { host: "sftp.cliente.local", port: 22, username: "inia", remoteDirectory: "/", authKind: "PRIVATE_KEY", timeoutMs: 30000 } } })
    wrap(<SourceDetailPage sourceId="src-1" />)
    await screen.findByTestId("source-authorship")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuração" }))
    const field = await screen.findByLabelText("Chave privada (PEM)")
    expect(field.className).toContain("[-webkit-text-security:disc]")
    expect(field).toHaveAttribute("spellcheck", "false")
  })

  it("Ativar sem liberação pede a senha e repete a ação", async () => {
    service.setSourceStatus.mockRejectedValueOnce(LOCK_ERROR()).mockResolvedValue({ ...SOURCE, status: "ACTIVE" })
    wrap(<SourceDetailPage sourceId="src-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Ativar/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText("Senha do banco de dados"), { target: { value: "senha-certa" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(service.setSourceStatus).toHaveBeenCalledTimes(2))
  })

  it("Cancelar o pedido de senha não repete a ação", async () => {
    service.setSourceStatus.mockRejectedValue(LOCK_ERROR())
    wrap(<SourceDetailPage sourceId="src-1" />)
    fireEvent.click(await screen.findByRole("button", { name: /Ativar/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(service.setSourceStatus).toHaveBeenCalledTimes(1)
    expect(service.unlockSourceConfiguration).not.toHaveBeenCalled()
  })
})

describe("a tela se atualiza sozinha enquanto a pessoa usa o formulário", () => {
  const LATER = "2026-11-05T10:10:00.000Z"
  const openConfiguration = async () => {
    await screen.findByTestId("source-authorship")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuração" }))
    return screen.findByLabelText(/Nome da conexão/)
  }
  /** Outra pessoa mudou a fonte: só confere depois que a página já mostra o que veio do servidor. */
  const changedBySomeoneElse = { updatedAt: LATER, updatedByName: "Outra Pessoa" }
  const refresh = async (client: QueryClient) => {
    await act(() => client.invalidateQueries())
    await screen.findByText(/última alteração por Outra Pessoa/)
  }

  it("o que foi preenchido não some quando alguém muda a fonte; depois de salvar, volta a ler do servidor", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    const client = wrap(<SourceDetailPage sourceId="src-1" />)
    fireEvent.change(await openConfiguration(), { target: { value: "Nome em edição" } })
    service.fetchSource.mockResolvedValue({ ...SOURCE, ...changedBySomeoneElse, configAccess: UNLOCKED })
    await refresh(client)
    expect(screen.getByLabelText(/Nome da conexão/)).toHaveValue("Nome em edição")

    service.updateSource.mockResolvedValue({ ...SOURCE })
    service.fetchSource.mockResolvedValue({ ...SOURCE, name: "Nome salvo pelo servidor", updatedAt: "2026-11-05T10:20:00.000Z", configAccess: UNLOCKED })
    fireEvent.click(screen.getByRole("button", { name: /Salvar conexão/ }))
    await waitFor(() => expect(screen.getByLabelText(/Nome da conexão/)).toHaveValue("Nome salvo pelo servidor"))
  })

  it("sem nada preenchido, a mudança no servidor aparece no formulário", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    const client = wrap(<SourceDetailPage sourceId="src-1" />)
    await openConfiguration()
    service.fetchSource.mockResolvedValue({ ...SOURCE, ...changedBySomeoneElse, name: "Renomeada por outra pessoa", configAccess: UNLOCKED })
    await refresh(client)
    await waitFor(() => expect(screen.getByLabelText(/Nome da conexão/)).toHaveValue("Renomeada por outra pessoa"))
  })

  it("o pedido de senha continua aberto quando a fonte muda, e a ação repetida leva o que foi preenchido", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    service.updateSource.mockRejectedValueOnce(LOCK_ERROR()).mockResolvedValue({ ...SOURCE })
    const client = wrap(<SourceDetailPage sourceId="src-1" />)
    fireEvent.change(await openConfiguration(), { target: { value: "Nome em edição" } })
    fireEvent.click(screen.getByRole("button", { name: /Salvar conexão/ }))
    await screen.findByRole("dialog")

    // Outra pessoa trocou a senha: a fonte mudou e a liberação caiu, e a atualização automática traz isso com a caixa aberta.
    service.fetchSource.mockResolvedValue({ ...SOURCE, ...changedBySomeoneElse, configAccess: LOCKED })
    await refresh(client)
    const dialog = screen.getByRole("dialog")
    expect(screen.getByLabelText(/Nome da conexão/)).toHaveValue("Nome em edição")
    fireEvent.change(within(dialog).getByLabelText("Senha do banco de dados"), { target: { value: "senha-certa" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(service.updateSource).toHaveBeenCalledTimes(2))
    expect(service.updateSource.mock.calls[1]![1]).toMatchObject({ name: "Nome em edição" })
  })

  it("sem nada preenchido, o pedido de senha também sobrevive à atualização", async () => {
    service.fetchSource.mockResolvedValue({ ...SOURCE, configAccess: UNLOCKED })
    service.updateSource.mockRejectedValueOnce(LOCK_ERROR()).mockResolvedValue({ ...SOURCE })
    const client = wrap(<SourceDetailPage sourceId="src-1" />)
    await openConfiguration()
    fireEvent.click(screen.getByRole("button", { name: /Salvar conexão/ }))
    await screen.findByRole("dialog")
    service.fetchSource.mockResolvedValue({ ...SOURCE, ...changedBySomeoneElse, configAccess: LOCKED })
    await refresh(client)
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("API Pull: ao liberar, o formulário troca os valores ocultos pelos reais; ao salvar, leva os reais", async () => {
    const api = (baseUrl: string, tenant: string, configAccess: typeof LOCKED | typeof UNLOCKED) => ({ ...SOURCE, kind: "API_PULL", configAccess: { ...configAccess, fields: ["token"] }, secrets: [], config: { kind: "API_PULL", api: { baseUrl, auth: { kind: "BEARER" }, headers: { "X-Tenant": tenant }, timeoutMs: 30000 } } })
    service.fetchSource.mockResolvedValue(api("https://api.cliente.local/v1?chave=••••••", "••••••", LOCKED))
    wrap(<SourceDetailPage sourceId="src-1" />)
    await screen.findByTestId("source-authorship")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuração" }))
    expect(await screen.findByLabelText("Base URL")).toHaveValue("https://api.cliente.local/v1?chave=••••••")

    service.fetchSource.mockResolvedValue(api("https://api.cliente.local/v1?chave=real", "tenant-real", UNLOCKED))
    fireEvent.change(screen.getByLabelText("Token de acesso"), { target: { value: "token-certo" } })
    fireEvent.click(screen.getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.cliente.local/v1?chave=real"))
    expect(screen.getByLabelText(/Headers adicionais/)).toHaveValue("X-Tenant: tenant-real")
  })

  it("conjunto de API: ao liberar, mostra os valores reais e continua na mesma aba", async () => {
    const apiFeed = (value: string, configAccess: typeof LOCKED | typeof UNLOCKED) => ({ ...FEED, configAccess: { ...configAccess, fields: ["token"] }, source: { ...FEED.source, kind: "API_PULL" }, connectorConfig: { connector: "API_PULL", api: { endpoint: "/colaboradores", method: "GET", queryParams: { chave: value }, headers: {}, extractPath: "data", format: "JSON", maxPages: 500, checkpoint: { kind: "NONE" }, pagination: { kind: "NONE" } } } })
    service.fetchFeed.mockResolvedValue(apiFeed("••••••", LOCKED))
    wrap(<FeedDetailPage feedId="feed-1" />)
    await screen.findByTestId("config-locked")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Conector e frequência" }))
    expect(await screen.findByLabelText(/Query params fixos/)).toHaveValue("chave=••••••")

    service.fetchFeed.mockResolvedValue(apiFeed("valor-real", UNLOCKED))
    fireEvent.change(screen.getByLabelText("Token de acesso"), { target: { value: "token-certo" } })
    fireEvent.click(screen.getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(screen.getByLabelText(/Query params fixos/)).toHaveValue("chave=valor-real"))
    expect(screen.getByRole("tab", { name: "Conector e frequência" })).toHaveAttribute("aria-selected", "true")
  })

  it("conjunto: o pedido de senha sobrevive à atualização, e o conjunto se atualiza depois de salvar", async () => {
    service.fetchFeed.mockResolvedValue({ ...FEED, configAccess: UNLOCKED })
    service.updateFeed.mockRejectedValueOnce(LOCK_ERROR()).mockResolvedValue({ ...FEED })
    const client = wrap(<FeedDetailPage feedId="feed-1" />)
    await screen.findByTestId("config-unlocked")
    fireEvent.click(screen.getByRole("button", { name: /Salvar feed/ }))
    await screen.findByRole("dialog")
    service.fetchFeed.mockResolvedValue({ ...FEED, updatedAt: LATER, lastErrorCode: "ERRO_NOVO", lastErrorMessage: "veio do servidor", configAccess: LOCKED })
    await act(() => client.invalidateQueries())
    await screen.findByText(/ERRO_NOVO/)
    const dialog = screen.getByRole("dialog")
    service.fetchFeed.mockResolvedValue({ ...FEED, updatedAt: LATER, configAccess: UNLOCKED })
    fireEvent.change(within(dialog).getByLabelText("Senha do banco de dados"), { target: { value: "senha-certa" } })
    fireEvent.click(within(dialog).getByRole("button", { name: /Liberar configuração/ }))
    await waitFor(() => expect(service.updateFeed).toHaveBeenCalledTimes(2))
  })
})

describe("detalhes do conjunto", () => {
  it("sem liberação: não consulta o banco, trava mapeamento e configurações, e pausar segue livre", async () => {
    wrap(<FeedDetailPage feedId="feed-1" />)
    expect(await screen.findByTestId("config-locked")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Salvar feed/ })).toBeDisabled()
    expect(await screen.findByRole("button", { name: /Buscar amostra da fonte/ })).toBeDisabled()
    expect(await screen.findByTestId("feed-mapping-fields")).toBeDisabled()
    expect(screen.getByRole("button", { name: /Pausar/ })).toBeEnabled()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Conector e frequência" }))
    expect(await screen.findByText(/Leitura salva:/)).toBeInTheDocument()
    expect(screen.getByTestId("feed-settings-fields")).toBeDisabled()
    expect(service.fetchDatabaseColumns).not.toHaveBeenCalled()
  })

  it("liberado: consulta as colunas e permite salvar", async () => {
    service.fetchFeed.mockResolvedValue({ ...FEED, configAccess: UNLOCKED })
    wrap(<FeedDetailPage feedId="feed-1" />)
    await screen.findByTestId("config-unlocked")
    expect(screen.getByRole("button", { name: /Salvar feed/ })).toBeEnabled()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Conector e frequência" }))
    await waitFor(() => expect(service.fetchDatabaseColumns).toHaveBeenCalled())
  })
})

describe("registro", () => {
  const event = (action: string, payload: Record<string, unknown>, overrides: Partial<AuditEvent> = {}): AuditEvent => ({ id: action, action, actorId: "p-1", actorName: "Bruno Geral", entityType: "data_source", entityId: "src-1", payload, createdAt: "2026-11-05T12:00:00.000Z", sourceId: "src-1", sourceName: "Banco do cliente", sourceKind: "DATABASE", sourceDeletedAt: null, feedId: null, feedName: null, feedDeletedAt: null, ...overrides })

  it("descreve em linguagem de gente, com antes e depois", () => {
    expect(describeAuditEvent(event("DATA_HUB_SOURCE_UPDATED", { changes: [{ field: "database", before: "rh", after: "financeiro" }], changedFields: ["queryTimeoutMs"], secretsRotated: ["DATABASE_PASSWORD"] }))).toEqual(["Banco: rh → financeiro", "Também mudou: Tempo limite de consulta", "Senha trocada, depois de testada"])
    expect(describeAuditEvent(event("DATA_HUB_SOURCE_CREATED", { target: { host: "sql.cliente.local", port: 1433, instance: null, database: "rh", username: "inia", tls: "VERIFY_FULL" } }))).toEqual(["Servidor: sql.cliente.local", "Porta: 1433", "Banco: rh", "Usuário: inia", "Criptografia: Obrigatória e validando o certificado"])
    expect(describeAuditEvent(event("DATA_HUB_SAMPLE_READ", { object: "dbo.colaboradores", rows: 20 }))).toEqual(["dbo.colaboradores", "20 linhas"])
    expect(describeAuditEvent(event("DATA_HUB_SAMPLE_READ", { object: "dbo.colaboradores", outcome: "FAILED", errorCode: "DATA_SOURCE_PERMISSION_DENIED" }))).toEqual(["dbo.colaboradores", "Falhou: DATA_SOURCE_PERMISSION_DENIED"])
    expect(describeAuditEvent(event("DATA_HUB_CONFIG_ACCESS_DENIED", { route: "GET /sources/:id/database/objects" }))).toEqual(["Rota: GET /sources/:id/database/objects"])
    expect(describeAuditEvent(event("DATA_HUB_FEED_UPDATED", { name: "Novo", previousName: "Antigo", changedFields: ["name", "mapping"] }))).toEqual(["Nome: Antigo → Novo", "Mudou: Mapeamento"])
    expect(describeAuditEvent(event("DATA_HUB_SOURCE_CREATE_REFUSED", { name: "RH", target: { host: "sql.cliente.local" }, errorCode: "DATA_SOURCE_AUTH_FAILED" }))).toEqual(['"RH": o servidor recusou a credencial, nada foi gravado', "Servidor: sql.cliente.local"])
    expect(describeAuditEvent(event("DATA_HUB_REJECTIONS_EXPORTED", { rows: 1 }))).toEqual(["1 linha"])
    expect(describeAuditEvent(event("DATA_HUB_SECRET_ROTATION_FAILED", { errorCode: "DATA_SOURCE_CREDENTIAL_UNPROVEN" }))).toEqual(["A API responde igual com e sem credencial: a nova não pôde ser provada"])
    expect(describeAuditEvent(event("DATA_HUB_CONFIG_UNLOCK_BLOCKED", { retryAt: "2026-11-05T15:30:00.000Z", target: { host: "sql.cliente.local" } }))[1]).toBe("Servidor: sql.cliente.local")
    expect(describeAuditEvent(event("DATA_HUB_DATABASE_TESTED", { health: "HEALTHY", usedStoredPassword: true, target: "PostgreSQL db:5432/rh" }))).toEqual(["Conexão OK", "Usou a senha guardada", "PostgreSQL db:5432/rh"])
  })

  it("mostra quem fez, e marca a fonte excluída sem perder o nome", async () => {
    service.fetchAuditEventsPage.mockResolvedValue({ items: [event("DATA_HUB_SOURCE_DELETED", { target: { host: "sql.cliente.local" } }, { sourceDeletedAt: "2026-11-05T12:00:00.000Z" }), event("DATA_HUB_RUN_CANCELLED", {}, { actorId: null, actorName: null })], total: 2, page: 1, pageSize: 20 })
    wrap(<AuditLogTab />)
    expect(await screen.findByText("Fonte excluída")).toBeInTheDocument()
    expect(screen.getByText("Bruno Geral")).toBeInTheDocument()
    expect(screen.getAllByText("Banco do cliente").length).toBeGreaterThan(0)
    expect(screen.getByText("Excluída")).toBeInTheDocument()
    expect(screen.getByText("Sistema")).toBeInTheDocument()
    expect(service.fetchAuditEventsPage).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: 20 }))
  })

  it("na fonte, filtra pela fonte", async () => {
    service.fetchAuditEventsPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
    wrap(<AuditLogTab sourceId="src-1" />)
    await waitFor(() => expect(service.fetchAuditEventsPage).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "src-1" })))
  })
})
