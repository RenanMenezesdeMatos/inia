/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { AdminApiError } from "@/lib/admin/admin-api"
import type { ExplorerCatalog, ExplorerColumn, ExplorerDataset, ExplorerGroupRequest, ExplorerPage, ExplorerRequest } from "@/schemas/admin/data-explorer.schema"

import { DataExplorerTab } from "./data-explorer-tab"
import { addChild, countConditions, describeFilter, draftProblem, emptyCondition, emptyGroup, operatorLabel, removeNode, splitList, toFilterRequest, updateNode, type DraftCondition } from "./explorer-filter-model"
import { formatExplorerValue } from "./results-table"

const service = vi.hoisted(() => ({
  fetchExplorerCatalog: vi.fn(),
  fetchExplorerDataset: vi.fn(),
  runExplorerQuery: vi.fn(),
  runExplorerCount: vi.fn(),
  exportExplorerCsv: vi.fn(),
  previewRecordCancellation: vi.fn(),
  cancelRecords: vi.fn(),
  fetchCancellations: vi.fn(),
  previewReactivation: vi.fn(),
  reactivateRecords: vi.fn(),
  fetchDeletedItems: vi.fn(),
  previewRestoration: vi.fn(),
  restoreDeletedItem: vi.fn(),
}))
vi.mock("@/services/admin/data-explorer-service", () => service)

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => undefined
  Element.prototype.releasePointerCapture = () => undefined
  Element.prototype.scrollIntoView = () => undefined
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const LIMITS: ExplorerCatalog["limits"] = { cancelMaxRows: 10_000, cancelMaxKeys: 100, defaultPageSize: 25, maxPageSize: 100, maxSelectedColumns: 30, maxFilterConditions: 3, maxFilterDepth: 3, maxListValues: 3, minSearchLength: 2, maxSearchLength: 100, queryTimeoutSeconds: 5, countCap: 10_000, exportMaxRows: 20_000, exportMaxBytes: 20_971_520 }

const column = (overrides: Partial<ExplorerColumn> & Pick<ExplorerColumn, "key" | "label" | "type">): ExplorerColumn => ({ description: null, nullable: false, personal: false, filterable: true, sortable: false, searchable: false, operators: ["EQ"], options: null, defaultVisible: true, ...overrides })

const DATASET: ExplorerDataset = {
  code: "interactions",
  label: "Interações",
  description: "Atendimentos importados.",
  origin: "IMPORTED",
  cancellable: false,
  canCancel: false,
  defaultSort: { column: "started_at", direction: "DESC" },
  columns: [
    column({ key: "protocol", label: "Protocolo", type: "TEXT", sortable: true, searchable: true, operators: ["EQ", "NEQ", "IN"] }),
    column({ key: "operator_matricula", label: "Matrícula", type: "TEXT", nullable: true, personal: true, searchable: true, operators: ["EQ", "IN", "IS_EMPTY", "IS_NOT_EMPTY"] }),
    column({ key: "started_at", label: "Início", type: "DATETIME", sortable: true, operators: ["EQ", "GTE", "LTE", "BETWEEN"] }),
    column({ key: "value", label: "Valor", type: "NUMBER", operators: ["GT", "BETWEEN"] }),
    column({ key: "status", label: "Situação", type: "ENUM", options: [{ value: "OPEN", label: "Aberta" }], operators: ["EQ"] }),
    column({ key: "hidden_one", label: "Registrado em", type: "DATETIME", defaultVisible: false, filterable: false, operators: [] }),
  ],
}

const CATALOG: ExplorerCatalog = {
  limits: LIMITS,
  deletedItemTypes: [{ type: "AGENT", label: "Agent" }],
  datasets: [
    { code: "interactions", label: "Interações", description: "", origin: "IMPORTED" },
    { code: "feedbacks", label: "Feedbacks", description: "", origin: "GENERATED" },
  ],
}

const PAGE: ExplorerPage = { rowKeys: null, columns: ["protocol", "operator_matricula", "started_at", "value", "status"], rows: [["A-1", "M-1", "2026-03-05T12:00:00.000Z", "10.5", "OPEN"], ["A-2", null, "2026-03-04T12:00:00.000Z", "-2", "OPEN"]], nextCursor: "cursor-2", hasMore: true, pageSize: 25, sort: { column: "started_at", direction: "DESC" }, timeZone: "America/Fortaleza", durationMs: 12 }

const CANCEL_PREVIEW = { rows: 15, capped: false, maxRows: 10_000, scopeFingerprint: "impressao", executions: 0, runningExecutions: 0, stoppedExecutions: 0, evidences: 0, feedbacks: 0, workflowsOnReload: 0, wholeDataset: false, blockers: [], notices: ["Os registros continuam guardados e saem dos cálculos."], canCancel: true }

const DELETED_AGENT = { type: "AGENT", typeLabel: "Agent", id: "agent-1", name: "Agent antigo", deletedAt: "2026-11-06T12:00:00.000Z", deletedBy: "M-1" }

const lastRequest = () => service.runExplorerQuery.mock.lastCall?.[0] as ExplorerRequest

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DataExplorerTab />
    </QueryClientProvider>,
  )
}

async function chooseOption(trigger: HTMLElement, name: string) {
  fireEvent.keyDown(trigger, { key: "ArrowDown" })
  fireEvent.click(await screen.findByRole("option", { name }))
}

async function openDataset() {
  renderTab()
  await chooseOption(await screen.findByRole("combobox", { name: /Conjunto de dados/ }), "Interações")
  await screen.findByTestId("explorer-results")
}

beforeEach(() => {
  service.fetchExplorerCatalog.mockReset().mockResolvedValue(CATALOG)
  service.fetchExplorerDataset.mockReset().mockResolvedValue(DATASET)
  service.runExplorerQuery.mockReset().mockResolvedValue(PAGE)
  service.runExplorerCount.mockReset().mockResolvedValue({ count: 42, capped: false, durationMs: 3 })
  service.exportExplorerCsv.mockReset().mockResolvedValue({ blob: new Blob(["x"]), filename: "consulta.csv" })
  service.previewRecordCancellation.mockReset().mockResolvedValue(CANCEL_PREVIEW)
  service.cancelRecords.mockReset().mockResolvedValue({ cancellationId: "lote-1", rows: 15 })
  service.fetchCancellations.mockReset().mockResolvedValue({ items: [], hasMore: false })
  service.previewReactivation.mockReset()
  service.reactivateRecords.mockReset().mockResolvedValue({ rows: 2 })
  service.fetchDeletedItems.mockReset().mockResolvedValue({ items: [DELETED_AGENT], hasMore: false })
  service.previewRestoration.mockReset().mockResolvedValue({ item: DELETED_AGENT, problems: [], notices: ["Volta desativado."], canRestore: true })
  service.restoreDeletedItem.mockReset().mockResolvedValue({ type: "AGENT", id: "agent-1", name: "Agent antigo", notices: ["Volta desativado."] })
})
afterEach(cleanup)

describe("DataExplorerTab", () => {
  it("só consulta depois de escolher o conjunto, separa importados de gerados e usa as colunas padrão", async () => {
    renderTab()
    const picker = await screen.findByRole("combobox", { name: /Conjunto de dados/ })
    expect(service.runExplorerQuery).not.toHaveBeenCalled()
    fireEvent.keyDown(picker, { key: "ArrowDown" })
    expect(await screen.findByText("Importados")).toBeInTheDocument()
    expect(screen.getByText("Gerados pela INIA")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("option", { name: "Interações" }))
    await screen.findByTestId("explorer-results")
    expect(lastRequest()).toEqual({ dataset: "interactions", columns: ["protocol", "operator_matricula", "started_at", "value", "status"], sort: { column: "started_at", direction: "DESC" }, pageSize: 25 })
  })

  it("trocar de conjunto nunca manda as colunas do conjunto anterior nem mostra as linhas dele", async () => {
    const other: ExplorerDataset = { ...DATASET, code: "feedbacks", label: "Feedbacks", defaultSort: { column: "created", direction: "DESC" }, columns: [column({ key: "created", label: "Criado em", type: "DATETIME", sortable: true })] }
    service.fetchExplorerDataset.mockImplementation((code: string) => Promise.resolve(code === "feedbacks" ? other : DATASET))
    let finish: (page: ExplorerPage) => void = () => undefined
    await openDataset()
    service.runExplorerQuery.mockImplementation(() => new Promise<ExplorerPage>((resolve) => (finish = resolve)))
    await chooseOption(screen.getByRole("combobox", { name: /Conjunto de dados/ }), "Feedbacks")
    await waitFor(() => expect(lastRequest().dataset).toBe("feedbacks"))
    for (const [request] of service.runExplorerQuery.mock.calls as [ExplorerRequest][]) {
      if (request.dataset === "feedbacks") expect(request.columns).toEqual(["created"])
    }
    expect(screen.queryByTestId("explorer-results")).toBeNull()
    finish({ ...PAGE, columns: ["created"], rows: [["2026-03-05T12:00:00.000Z"]], nextCursor: null, hasMore: false, sort: other.defaultSort })
    await screen.findByTestId("explorer-results")
  })

  it("mostra os registros formatados pelo tipo e marca o dado pessoal", async () => {
    await openDataset()
    const table = screen.getByTestId("explorer-results")
    expect(within(table).getByText("10,5")).toBeInTheDocument()
    expect(within(table).getAllByText("Aberta").length).toBe(2)
    expect(within(table).getAllByLabelText("Dado pessoal").length).toBe(1)
    expect(screen.getByText(/mostra dados pessoais/)).toBeInTheDocument()
  })

  it("página seguinte usa a posição do servidor; anterior volta sem recalcular nada", async () => {
    await openDataset()
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }))
    await waitFor(() => expect(lastRequest().cursor).toBe("cursor-2"))
    await screen.findByText(/página 2$/)
    const calls = service.runExplorerQuery.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }))
    await screen.findByText(/página 1$/)
    expect(service.runExplorerQuery.mock.calls.length).toBe(calls)
  })

  it("só as colunas ordenáveis têm botão, e ordenar volta para a primeira página", async () => {
    await openDataset()
    const table = screen.getByTestId("explorer-results")
    expect(within(table).queryByRole("button", { name: /Valor/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }))
    await waitFor(() => expect(lastRequest().cursor).toBe("cursor-2"))
    fireEvent.click(within(table).getByRole("button", { name: /Protocolo/ }))
    await waitFor(() => expect(lastRequest().sort).toEqual({ column: "protocol", direction: "DESC" }))
    expect(lastRequest().cursor).toBeUndefined()
  })

  it("filtro: nada sai antes de Aplicar; condição incompleta não gasta consulta; aplicado aparece e dá para limpar", async () => {
    await openDataset()
    const calls = service.runExplorerQuery.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Condição" }))
    await chooseOption(screen.getByRole("combobox", { name: "Coluna da condição" }), "Protocolo")
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    expect(screen.getByRole("alert")).toHaveTextContent('Informe o valor de "Protocolo"')
    expect(service.runExplorerQuery.mock.calls.length).toBe(calls)

    fireEvent.change(screen.getByRole("textbox", { name: "Valor de Protocolo" }), { target: { value: "A-1" } })
    expect(service.runExplorerQuery.mock.calls.length).toBe(calls)
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    await waitFor(() => expect(lastRequest().filter).toEqual({ type: "group", logic: "AND", children: [{ type: "condition", column: "protocol", operator: "EQ", value: "A-1" }] }))
    expect(within(screen.getByTestId("explorer-applied")).getByText("Protocolo é igual a A-1")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }))
    // Volta à consulta sem filtro, que já estava no cache de um minuto: nada novo vai ao servidor.
    await waitFor(() => expect(screen.queryByTestId("explorer-applied")).toBeNull())
    expect(screen.queryAllByTestId("explorer-condition")).toEqual([])
  })

  it("coluna sem filtro não aparece para escolher", async () => {
    await openDataset()
    fireEvent.click(screen.getByRole("button", { name: "Condição" }))
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Coluna da condição" }), { key: "ArrowDown" })
    await screen.findByRole("option", { name: "Protocolo" })
    expect(screen.queryByRole("option", { name: "Registrado em" })).toBeNull()
    fireEvent.keyDown(screen.getByRole("option", { name: "Protocolo" }), { key: "Escape" })
  })

  it("não deixa passar do limite de condições", async () => {
    await openDataset()
    const add = screen.getByRole("button", { name: "Condição" })
    fireEvent.click(add)
    fireEvent.click(add)
    fireEvent.click(add)
    expect(screen.getByRole("button", { name: "Condição" })).toBeDisabled()
    expect(screen.getByText("3 de 3 condições")).toBeInTheDocument()
  })

  it("busca: curta demais é recusada na tela; Enter aplica", async () => {
    await openDataset()
    const input = screen.getByRole("textbox", { name: "Buscar" })
    expect(input).toHaveAttribute("placeholder", "Buscar em Protocolo, Matrícula")
    fireEvent.change(input, { target: { value: "a" } })
    fireEvent.keyDown(input, { key: "Enter" })
    expect(screen.getByRole("alert")).toHaveTextContent("de 2 a 100 caracteres")
    fireEvent.change(input, { target: { value: "A-1" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(lastRequest().search).toBe("A-1"))
    expect(within(screen.getByTestId("explorer-applied")).getByText("Busca: A-1")).toBeInTheDocument()
  })

  it("contagem só a pedido, com teto; mudar o filtro apaga o número antigo", async () => {
    await openDataset()
    expect(service.runExplorerCount).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: /Contar registros/ }))
    expect(await screen.findByTestId("explorer-count")).toHaveTextContent("42 registros")
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    await waitFor(() => expect(screen.queryByTestId("explorer-count")).toBeNull())
    service.runExplorerCount.mockResolvedValue({ count: 10_000, capped: true, durationMs: 3 })
    fireEvent.click(screen.getByRole("button", { name: /Contar registros/ }))
    expect(await screen.findByTestId("explorer-count")).toHaveTextContent("Mais de 10.000 registros")
    expect(service.runExplorerCount.mock.lastCall?.[0]).not.toHaveProperty("pageSize")
  })

  it("exportação leva os filtros e as colunas, sem posição nem tamanho de página; erro do servidor aparece como veio", async () => {
    URL.createObjectURL = vi.fn(() => "blob:consulta")
    URL.revokeObjectURL = vi.fn()
    await openDataset()
    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }))
    await waitFor(() => expect(service.exportExplorerCsv).toHaveBeenCalled())
    const sent = service.exportExplorerCsv.mock.lastCall?.[0] as ExplorerRequest
    expect(sent).toEqual({ dataset: "interactions", columns: PAGE.columns, sort: { column: "started_at", direction: "DESC" } })
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled())

    service.exportExplorerCsv.mockRejectedValue(new AdminApiError("A exportação tem mais de 20.000 registros. Restrinja os filtros.", "DATA_EXPLORER_EXPORT_TOO_LARGE"))
    fireEvent.click(screen.getByRole("button", { name: /Exportar CSV/ }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Restrinja os filtros")
  })

  it("consulta interrompida mostra a mensagem do servidor e não insiste sozinha", async () => {
    service.runExplorerQuery.mockRejectedValue(new AdminApiError("A consulta passou do limite de 5 segundos. Restrinja os filtros.", "DATA_EXPLORER_QUERY_TIMEOUT"))
    renderTab()
    await chooseOption(await screen.findByRole("combobox", { name: /Conjunto de dados/ }), "Interações")
    expect(await screen.findByRole("alert")).toHaveTextContent("Restrinja os filtros")
    expect(service.runExplorerQuery).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("explorer-results")).toBeNull()
  })

  it("sem resultado com filtro convida a limpar; sem dado nenhum, não", async () => {
    service.runExplorerQuery.mockResolvedValue({ ...PAGE, rows: [], nextCursor: null, hasMore: false })
    renderTab()
    await chooseOption(await screen.findByRole("combobox", { name: /Conjunto de dados/ }), "Interações")
    expect(await screen.findByText("Nenhum registro neste conjunto")).toBeInTheDocument()
    fireEvent.change(screen.getByRole("textbox", { name: "Buscar" }), { target: { value: "A-1" } })
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    expect(await screen.findByText("Nenhum registro com estes filtros")).toBeInTheDocument()
  })
})

describe("modelo dos filtros", () => {
  const columns = new Map(DATASET.columns.map((entry) => [entry.key, entry]))
  const condition = (overrides: Partial<DraftCondition>): DraftCondition => ({ ...emptyCondition(), ...overrides })

  it("monta grupos aninhados com AND e OR, sem levar o que é só da tela", () => {
    const inner = { ...emptyGroup("OR"), children: [condition({ column: "protocol", operator: "EQ", value: " A-1 " }), condition({ column: "operator_matricula", operator: "IS_EMPTY" })] }
    const root = { ...emptyGroup("AND"), children: [condition({ column: "value", operator: "BETWEEN", value: "1", valueTo: "9" }), inner] }
    expect(toFilterRequest(root, columns)).toEqual({
      type: "group",
      logic: "AND",
      children: [
        { type: "condition", column: "value", operator: "BETWEEN", values: ["1", "9"] },
        { type: "group", logic: "OR", children: [{ type: "condition", column: "protocol", operator: "EQ", value: "A-1" }, { type: "condition", column: "operator_matricula", operator: "IS_EMPTY" }] },
      ],
    })
    expect(toFilterRequest(emptyGroup(), columns)).toBeUndefined()
  })

  it("lista: um valor por linha ou com ponto e vírgula, sem repetidos", () => {
    expect(splitList("a\nb; c\n\na")).toEqual(["a", "b", "c"])
    const root = { ...emptyGroup(), children: [condition({ column: "protocol", operator: "IN", value: "a\nb" })] }
    expect(toFilterRequest(root, columns)?.children[0]).toEqual({ type: "condition", column: "protocol", operator: "IN", values: ["a", "b"] })
  })

  it.each([
    [condition({}), "Escolha a coluna"],
    [condition({ column: "protocol" }), "Escolha a condição"],
    [condition({ column: "protocol", operator: "EQ" }), "Informe o valor"],
    [condition({ column: "protocol", operator: "IN", value: " " }), "ao menos um valor"],
    [condition({ column: "protocol", operator: "IN", value: "a\nb\nc\nd" }), "no máximo 3"],
    [condition({ column: "value", operator: "BETWEEN", value: "1" }), "fim do intervalo"],
    [condition({ column: "value", operator: "BETWEEN", value: "9", valueTo: "10" }), null],
    [condition({ column: "value", operator: "BETWEEN", value: "10", valueTo: "9" }), "vem depois do fim"],
    [condition({ column: "started_at", operator: "BETWEEN", value: "2026-02-01", valueTo: "2026-01-01" }), "vem depois do fim"],
    [condition({ column: "operator_matricula", operator: "IS_EMPTY" }), null],
  ])("problema de %j", (draft, expected) => {
    const problem = draftProblem({ ...emptyGroup(), children: [draft] }, columns, LIMITS)
    if (expected === null) expect(problem).toBeNull()
    else expect(problem).toContain(expected)
  })

  it("grupo vazio e condições demais são apontados", () => {
    expect(draftProblem({ ...emptyGroup(), children: [emptyGroup()] }, columns, LIMITS)).toContain("grupo sem condições")
    const many = Array.from({ length: 4 }, () => condition({ column: "operator_matricula", operator: "IS_EMPTY" }))
    expect(draftProblem({ ...emptyGroup(), children: many }, columns, LIMITS)).toContain("no máximo 3 condições")
    expect(draftProblem(emptyGroup(), columns, LIMITS)).toBeNull()
  })

  it("adicionar, alterar e remover em qualquer nível", () => {
    const inner = emptyGroup("OR")
    let root = addChild(emptyGroup(), emptyGroup().id, emptyCondition())
    root = { ...emptyGroup(), children: [inner] }
    const added = emptyCondition("protocol")
    root = addChild(root, inner.id, added)
    expect(countConditions(root)).toBe(1)
    root = updateNode(root, added.id, (node) => ({ ...node, value: "x" } as DraftCondition))
    expect(((root.children[0] as typeof inner).children[0] as DraftCondition).value).toBe("x")
    root = removeNode(root, added.id)
    expect(countConditions(root)).toBe(0)
  })

  it("descreve o que está valendo com os rótulos da tela", () => {
    const filter: ExplorerGroupRequest = {
      type: "group",
      logic: "AND",
      children: [
        { type: "condition", column: "status", operator: "EQ", value: "OPEN" },
        { type: "condition", column: "started_at", operator: "BETWEEN", values: ["2026-01-01", "2026-01-31"] },
        { type: "group", logic: "OR", children: [{ type: "condition", column: "protocol", operator: "IN", values: ["a", "b"] }, { type: "condition", column: "operator_matricula", operator: "IS_EMPTY" }] },
      ],
    }
    expect(describeFilter(filter, columns)).toEqual(["Situação é igual a Aberta", "Início está entre 01/01/2026 e 31/01/2026", "(Protocolo está na lista: a, b ou Matrícula está vazio)"])
    expect(describeFilter({ type: "group", logic: "OR", children: [{ type: "condition", column: "status", operator: "EQ", value: "OPEN" }, { type: "condition", column: "protocol", operator: "EQ", value: "x" }] }, columns)).toEqual(["Qualquer uma: Situação é igual a Aberta ou Protocolo é igual a x"])
    expect(operatorLabel("GTE", "DATE")).toBe("a partir de")
    expect(operatorLabel("GTE", "NUMBER")).toBe("é maior ou igual a")
  })

  it("formata valores pelo tipo, sem perder casas e sem deslocar data civil", () => {
    expect(formatExplorerValue(column({ key: "a", label: "A", type: "NUMBER" }), "1234.5600")).toBe("1234,5600")
    expect(formatExplorerValue(column({ key: "a", label: "A", type: "DATE" }), "2026-03-09")).toBe("09/03/2026")
    expect(formatExplorerValue(column({ key: "a", label: "A", type: "MONTH" }), "2026-03")).toBe("03/2026")
    expect(formatExplorerValue(column({ key: "a", label: "A", type: "BOOLEAN" }), "false")).toBe("Não")
    expect(formatExplorerValue(column({ key: "a", label: "A", type: "TIME" }), "08:30:00")).toBe("08:30")
    expect(formatExplorerValue(undefined, null)).toBe("—")
  })
})

describe("cancelar registros", () => {
  const CANCELLABLE: ExplorerDataset = {
    ...DATASET,
    cancellable: true,
    canCancel: true,
    columns: [column({ key: "record_status", label: "Situação do registro", type: "ENUM", filterable: false, operators: [], options: [{ value: "ACTIVE", label: "Ativo" }, { value: "CANCELLED", label: "Cancelado" }] }), ...DATASET.columns],
  }
  const CANCELLABLE_PAGE: ExplorerPage = { ...PAGE, columns: ["record_status", "protocol"], rows: [["ACTIVE", "A-1"], ["CANCELLED", "A-2"]], rowKeys: ["chave-1", null] }

  async function openCancellable() {
    service.fetchExplorerDataset.mockResolvedValue(CANCELLABLE)
    service.runExplorerQuery.mockResolvedValue(CANCELLABLE_PAGE)
    await openDataset()
  }

  it("sem a permissão, nada de ação nem de seletor: a tela é a da consulta", async () => {
    await openDataset()
    expect(screen.queryByTestId("explorer-cancel-actions")).toBeNull()
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(screen.queryByText("Cancelamentos deste conjunto")).toBeNull()
    expect(lastRequest()).not.toHaveProperty("recordStatus")
  })

  it("registro cancelado aparece marcado e sem caixa de seleção; o seletor de situação vai no pedido", async () => {
    await openCancellable()
    expect(within(screen.getByTestId("explorer-results")).getByText("Cancelado")).toBeInTheDocument()
    expect(screen.getByRole("checkbox", { name: "Selecionar o registro 1" })).toBeInTheDocument()
    expect(screen.queryByRole("checkbox", { name: "Selecionar o registro 2" })).toBeNull()
    expect(lastRequest().recordStatus).toBe("ALL")
    await chooseOption(screen.getByRole("combobox", { name: "Situação do registro" }), "Só os cancelados")
    await waitFor(() => expect(lastRequest().recordStatus).toBe("CANCELLED"))
  })

  it("nada marcado nem filtrado: os dois botões ficam desligados, porque o conjunto inteiro nunca é alcançado", async () => {
    await openCancellable()
    expect(screen.getByRole("button", { name: /Cancelar selecionados/ })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Cancelar todos do filtro/ })).toBeDisabled()
  })

  it("marcados: mostra a prévia, exige o motivo e confirma com a quantidade vista", async () => {
    await openCancellable()
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar o registro 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar selecionados (1)" }))
    expect(await screen.findByTestId("cancel-preview-rows")).toHaveTextContent("15 registros")
    expect(service.previewRecordCancellation).toHaveBeenCalledWith({ dataset: "interactions", keys: ["chave-1"] })
    const confirm = screen.getByRole("button", { name: "Cancelar 15 registros" })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "  Indicador cadastrado errado  " } })
    fireEvent.click(confirm)
    await waitFor(() => expect(service.cancelRecords).toHaveBeenCalledWith({ dataset: "interactions", keys: ["chave-1"], reason: "Indicador cadastrado errado", expectedFingerprint: "impressao" }))
    await waitFor(() => expect(screen.queryByTestId("cancel-preview-rows")).toBeNull())
    expect(screen.getByRole("button", { name: "Cancelar selecionados" })).toBeDisabled()
  })

  it("com filtro aplicado: vale para o que atende ao filtro, e a prévia diz que inclui outras páginas", async () => {
    await openCancellable()
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "A-1" } })
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    await waitFor(() => expect(lastRequest().search).toBe("A-1"))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar todos do filtro" }))
    expect(await screen.findByText(/inclusive os de outras páginas/)).toBeInTheDocument()
    await waitFor(() => expect(service.previewRecordCancellation).toHaveBeenCalledWith({ dataset: "interactions", search: "A-1" }))
  })

  it("com impedimento, mostra o motivo e não oferece a confirmação", async () => {
    service.previewRecordCancellation.mockResolvedValue({ ...CANCEL_PREVIEW, canCancel: false, runningExecutions: 2, blockers: [{ code: "DATA_CANCEL_IN_FLIGHT", message: "2 execuções de Workflow em andamento usam estes registros." }] })
    await openCancellable()
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar o registro 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar selecionados (1)" }))
    expect(await screen.findByText(/2 execuções de Workflow/)).toBeInTheDocument()
    expect(screen.queryByLabelText("Motivo")).toBeNull()
    expect(screen.getByRole("button", { name: "Cancelar registros" })).toBeDisabled()
  })

  it("se a quantidade mudou, mostra a recusa do servidor e refaz a prévia", async () => {
    service.cancelRecords.mockRejectedValue(new AdminApiError("A quantidade de registros mudou desde a prévia.", "DATA_CANCEL_SCOPE_CHANGED"))
    await openCancellable()
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar o registro 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar selecionados (1)" }))
    await screen.findByTestId("cancel-preview-rows")
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Indicador cadastrado errado" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancelar 15 registros" }))
    expect(await screen.findByText("A quantidade de registros mudou desde a prévia.")).toBeInTheDocument()
    await waitFor(() => expect(service.previewRecordCancellation).toHaveBeenCalledTimes(2))
  })

  it("em \"Só os cancelados\", cancelar pelo filtro fica desligado: alcançaria ativos que não estão à vista", async () => {
    await openCancellable()
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "A-1" } })
    fireEvent.click(screen.getByRole("button", { name: "Aplicar" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar todos do filtro" })).toBeEnabled())
    await chooseOption(screen.getByRole("combobox", { name: "Situação do registro" }), "Só os cancelados")
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar todos do filtro" })).toBeDisabled())
  })

  it("depois de cancelar, volta à primeira página, porque a atual pode ter ficado vazia", async () => {
    service.fetchExplorerDataset.mockResolvedValue(CANCELLABLE)
    service.runExplorerQuery.mockResolvedValue({ ...CANCELLABLE_PAGE, nextCursor: "cursor-2", hasMore: true })
    await openDataset()
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }))
    await waitFor(() => expect(lastRequest().cursor).toBe("cursor-2"))
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar o registro 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Cancelar selecionados (1)" }))
    await screen.findByTestId("cancel-preview-rows")
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Indicador cadastrado errado" } })
    fireEvent.click(screen.getByRole("button", { name: "Cancelar 15 registros" }))
    await waitFor(() => expect(lastRequest().cursor).toBeUndefined())
  })

  it("a marcação não sobrevive à troca de página", async () => {
    service.fetchExplorerDataset.mockResolvedValue(CANCELLABLE)
    service.runExplorerQuery.mockResolvedValue({ ...CANCELLABLE_PAGE, nextCursor: "cursor-2", hasMore: true })
    await openDataset()
    fireEvent.click(screen.getByRole("checkbox", { name: "Selecionar o registro 1" }))
    fireEvent.click(screen.getByRole("button", { name: "Próxima página" }))
    await waitFor(() => expect(screen.getByRole("button", { name: "Cancelar selecionados" })).toBeDisabled())
  })

  it("lista os lotes só ao abrir e reativa pelo que a conferência mostrou", async () => {
    const item = { id: "lote-1", reason: "Indicador errado na carga", rows: 2, remaining: 2, createdAt: "2026-11-06T12:00:00.000Z", cancelledBy: "Pessoa", reactivatedAt: null, reactivatedBy: null, reactivatedRows: null }
    service.fetchCancellations.mockResolvedValue({ items: [item], hasMore: false })
    service.previewReactivation.mockResolvedValue({ rows: 2, problems: [], blockers: [], notices: ["Nenhum Workflow roda por causa disso."], canReactivate: true })
    await openCancellable()
    expect(service.fetchCancellations).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Cancelamentos deste conjunto" }))
    expect(await screen.findByText("Indicador errado na carga")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Reativar" }))
    fireEvent.click(await screen.findByRole("button", { name: "Reativar 2 registros" }))
    await waitFor(() => expect(service.reactivateRecords).toHaveBeenCalledWith("lote-1", 2))
  })

  it("regra do indicador mudou: explica e não oferece reativar", async () => {
    service.fetchCancellations.mockResolvedValue({ items: [{ id: "lote-1", reason: "Indicador errado na carga", rows: 2, remaining: 2, createdAt: "2026-11-06T12:00:00.000Z", cancelledBy: null, reactivatedAt: null, reactivatedBy: null, reactivatedRows: null }], hasMore: true })
    service.previewReactivation.mockResolvedValue({ rows: 2, problems: [{ code: "INDICATOR_RULE_CHANGED", count: 2, message: "a estratégia do indicador mudou depois do cancelamento" }], blockers: [], notices: [], canReactivate: false })
    await openCancellable()
    fireEvent.click(screen.getByRole("button", { name: "Cancelamentos deste conjunto" }))
    fireEvent.click(await screen.findByRole("button", { name: "Reativar" }))
    expect(await screen.findByText(/a estratégia do indicador mudou/)).toBeInTheDocument()
    expect(screen.getByText(/Mostrando 50 lotes/)).toBeInTheDocument()
    const buttons = screen.getAllByRole("button", { name: "Reativar" })
    expect(buttons[buttons.length - 1]).toBeDisabled()
    expect(service.reactivateRecords).not.toHaveBeenCalled()
  })
})

describe("Itens excluídos", () => {
  async function openDeleted() {
    renderTab()
    await chooseOption(await screen.findByRole("combobox", { name: /Conjunto de dados/ }), "Itens excluídos")
    return screen.findByTestId("deleted-item")
  }

  it("só entra no seletor se o servidor liberar algum tipo, e nunca vai ao servidor como código de conjunto", async () => {
    service.fetchExplorerCatalog.mockResolvedValue({ ...CATALOG, deletedItemTypes: [] })
    renderTab()
    fireEvent.keyDown(await screen.findByRole("combobox", { name: /Conjunto de dados/ }), { key: "ArrowDown" })
    await screen.findByRole("option", { name: "Interações" })
    expect(screen.queryByRole("option", { name: "Itens excluídos" })).not.toBeInTheDocument()
    cleanup()
    service.fetchExplorerCatalog.mockResolvedValue(CATALOG)
    await openDeleted()
    expect(service.fetchExplorerDataset).not.toHaveBeenCalled()
    expect(service.runExplorerQuery).not.toHaveBeenCalled()
  })

  it("mostra o que saiu, quando e por quem, e restaura depois de mostrar como o item volta", async () => {
    const row = await openDeleted()
    expect(within(row).getByText("Agent antigo")).toBeInTheDocument()
    expect(within(row).getByText("M-1")).toBeInTheDocument()
    fireEvent.click(within(row).getByRole("button", { name: /Restaurar/ }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Volta desativado.")
    expect(service.previewRestoration).toHaveBeenCalledWith("AGENT", "agent-1")
    expect(service.restoreDeletedItem).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar" }))
    await waitFor(() => expect(service.restoreDeletedItem).toHaveBeenCalledWith("AGENT", "agent-1"))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(service.previewRestoration, "o item já voltou: não há prévia para refazer").toHaveBeenCalledTimes(1)
    await waitFor(() => expect(service.fetchDeletedItems).toHaveBeenCalledTimes(2))
  })

  it("o que barra aparece com o motivo, e o botão não deixa confirmar", async () => {
    service.previewRestoration.mockResolvedValue({ item: DELETED_AGENT, problems: [{ code: "DELETED_ITEM_NAME_IN_USE", message: "Já existe um Agent com o nome \"Agent antigo\"." }], notices: ["Volta desativado."], canRestore: false })
    const row = await openDeleted()
    fireEvent.click(within(row).getByRole("button", { name: /Restaurar/ }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText(/Já existe um Agent/)
    expect(within(dialog).queryByText("Volta desativado.")).not.toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Restaurar" })).toBeDisabled()
  })

  it("recusa do servidor na confirmação aparece como veio, e a prévia é refeita", async () => {
    service.restoreDeletedItem.mockRejectedValue(new AdminApiError("Outro registro ativo já usa este nome.", "DELETED_ITEM_RESTORE_BLOCKED"))
    const row = await openDeleted()
    fireEvent.click(within(row).getByRole("button", { name: /Restaurar/ }))
    const dialog = await screen.findByRole("dialog")
    await within(dialog).findByText("Volta desativado.")
    fireEvent.click(within(dialog).getByRole("button", { name: "Restaurar" }))
    await within(dialog).findByText("Outro registro ativo já usa este nome.")
    await waitFor(() => expect(service.previewRestoration).toHaveBeenCalledTimes(2))
  })

  it("a busca só sai quando a pessoa pede, e o tipo filtra no servidor", async () => {
    await openDeleted()
    expect(service.fetchDeletedItems).toHaveBeenCalledTimes(1)
    const search = screen.getByLabelText("Nome")
    fireEvent.change(search, { target: { value: "  antigo " } })
    expect(service.fetchDeletedItems).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: /Buscar/ }))
    await waitFor(() => expect(service.fetchDeletedItems).toHaveBeenLastCalledWith({ search: "antigo" }))
    await chooseOption(screen.getByRole("combobox", { name: /Tipo/ }), "Agent")
    await waitFor(() => expect(service.fetchDeletedItems).toHaveBeenLastCalledWith({ type: "AGENT", search: "antigo" }))
  })

  it("lista vazia explica o que vai aparecer aqui", async () => {
    service.fetchDeletedItems.mockResolvedValue({ items: [], hasMore: false })
    renderTab()
    await chooseOption(await screen.findByRole("combobox", { name: /Conjunto de dados/ }), "Itens excluídos")
    await screen.findByText("Nenhum item excluído")
  })
})
