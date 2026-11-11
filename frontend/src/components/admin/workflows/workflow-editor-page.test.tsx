/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import type { FlowGraph } from "@/schemas/admin/workflow-graph.schema"

import { WorkflowEditorPage } from "./workflow-editor-page"

installJsdomStubs()

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/admin/workflows/wf-1", useSearchParams: () => navigation.searchParams }))
vi.mock("./workflow-enrollments-tab", () => ({ WorkflowEnrollmentsTab: () => <p>Conteúdo de Execuções</p> }))
vi.mock("./workflow-results-tab", () => ({ WorkflowResultsTab: () => <p>Conteúdo de Resultados</p> }))
vi.mock("./workflow-settings-sheet", () => ({ WorkflowSettingsSheet: () => null }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const position = { x: 0, y: 0 }
const STEP_GRAPH: FlowGraph = {
  nodes: [
    { id: "trigger", type: "trigger", label: "Início", position, config: {} },
    { id: "wait", type: "wait", label: "Dar um tempo", position: { x: 0, y: 150 }, config: { durationMs: 3_600_000 } },
    { id: "end", type: "end", label: "Fim", position: { x: 0, y: 300 }, config: {} },
  ],
  edges: [
    { id: "e1", source: "trigger", sourceHandle: "always", target: "wait" },
    { id: "e2", source: "wait", sourceHandle: "always", target: "end" },
  ],
}

type Overrides = Partial<{ published: boolean; active: boolean; draftGraph: FlowGraph; publishedGraph: FlowGraph | null }>

function workflowDetail(overrides: Overrides = {}) {
  return {
    id: "wf-1",
    name: "Avisar nota baixa",
    description: null,
    scopeType: "ALL_TEAMS",
    teamId: null,
    teamName: null,
    subteamId: null,
    subteamName: null,
    active: true,
    createdAt: "2026-11-01T10:00:00Z",
    published: false,
    trigger: { kind: "channel_flag", channelFlagId: "f", channel: "VOICE", flagName: "nota_ura", valueType: "BOOLEAN" },
    activeEnrollments: 0,
    blockedEnrollments: 0,
    consolidatedStructure: null,
    populationFilter: null,
    configurationChanges: [],
    draftGraph: STEP_GRAPH,
    publishedGraph: null,
    ...overrides,
  }
}

const IMPACT = { reason: "PUBLISH", triggerKind: "channel_flag", goesLive: true, firstPublication: true, configurationChanges: [], schedule: null, requiresConfirmation: false, reasons: [], threshold: 50, fingerprint: "fp" }

/** Rotas da tela em memória; o que o editor não precisa neste teste responde lista vazia. */
function stubApi(detail: ReturnType<typeof workflowDetail>, saveResponse?: { status: number; body: unknown }) {
  const calls: { method: string; path: string; body: unknown }[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://teste").pathname
      const method = init?.method ?? "GET"
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
      if (path.endsWith("/workflows/wf-1")) return json({ data: detail })
      if (path.endsWith("/validate")) return json({ data: { valid: true, error: null } })
      if (path.endsWith("/publish-impact")) return json({ data: { ...IMPACT, firstPublication: !detail.published } })
      if (path.endsWith("/publish")) return json({ data: detail })
      if (path.endsWith("/draft")) return saveResponse ? json(saveResponse.body, saveResponse.status) : json({ data: { id: "wf-1" } })
      return json({ data: [] })
    }),
  )
  return calls
}

const renderEditor = () => renderWithQuery(<WorkflowEditorPage workflowId="wf-1" />)
const addWait = async () => fireEvent.click(await screen.findByRole("button", { name: "Adicionar etapa Aguardar" }))
const saveState = () => screen.findByTestId("workflow-save-state")

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
  navigation.searchParams = new URLSearchParams()
  vi.unstubAllGlobals()
})

describe("WorkflowEditorPage — não perder trabalho", () => {
  it("WF-02: trocar de aba mantém as alterações não salvas", async () => {
    stubApi(workflowDetail())
    renderEditor()
    await addWait()
    expect(await saveState()).toHaveTextContent("Alterações não salvas")
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Execuções" }))
    expect(await screen.findByText("Conteúdo de Execuções")).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Editor" }))
    expect(await saveState()).toHaveTextContent("Alterações não salvas")
    expect(screen.getByRole("button", { name: "Salvar rascunho" })).toBeEnabled()
  })

  it("WF-01: rascunho incompleto salva, e o que falta continua listado como problema de publicação", async () => {
    const calls = stubApi(workflowDetail())
    renderEditor()
    fireEvent.click(await screen.findByRole("button", { name: "Adicionar etapa Chamar agente" }))
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/draft"))).toBe(true))
    const graph = (calls.find((call) => call.path.endsWith("/draft"))!.body as { graph: FlowGraph }).graph
    expect(graph.nodes.at(-1)?.config).toEqual({ actionType: "CALL_AGENT", agentId: "" })
    await waitFor(() => expect(screen.getByTestId("workflow-issues-summary")).toHaveTextContent("Não é possível publicar"))
    expect(screen.queryByTestId("save-draft-failure")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled()
  })

  it("WF-01: reabre um rascunho com campos em branco, sem falhar ao carregar, e aponta o que falta", async () => {
    const blanks: FlowGraph = {
      nodes: [
        STEP_GRAPH.nodes[0]!,
        { id: "saida", type: "output", label: "Entregar", position, config: { target: { type: "USER", userId: "" }, surfaces: [], source: "" } },
        { id: "escala", type: "action", label: "Encaminhar", position, config: { actionType: "ESCALATE", target: { type: "SPECIFIC_USER", userId: "" }, surfaces: [], contentSource: "" } },
        { id: "cond", type: "condition", label: "Decidir", position, config: { comparator: "EQUALS", thresholdBoolean: null, thresholdNumeric: null, sourcePath: "" } },
        { id: "rank", type: "select_employees", label: "Selecionar", position, config: { selectionMode: "RANKING", ranking: { indicatorCode: "" } } },
        STEP_GRAPH.nodes[2]!,
      ],
      edges: [],
    } as FlowGraph
    stubApi(workflowDetail({ draftGraph: blanks }))
    renderEditor()
    expect(await screen.findByTestId("workflow-run-state")).toBeInTheDocument()
    expect(screen.queryByTestId("workflow-load-error")).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId("workflow-issues-summary")).toHaveTextContent("Não é possível publicar"))
    fireEvent.click(screen.getByRole("button", { name: "Ver problemas" }))
    const list = await screen.findByRole("list", { name: "Lista de problemas do fluxo" })
    expect(within(list).getAllByText("Escolha onde entregar o conteúdo.")).toHaveLength(2)
    expect(within(list).getByText("Escolha o conteúdo que será publicado.")).toBeInTheDocument()
  })

  it("dado inválido recusado ao salvar nomeia a etapa e o campo, e abre a etapa", async () => {
    const issue = { path: ["graph", "nodes", 1, "config", "agentId"], message: "Invalid UUID" }
    stubApi(workflowDetail({ draftGraph: { ...STEP_GRAPH, nodes: [STEP_GRAPH.nodes[0]!, { id: "agente", type: "action", label: "Analisar", position, config: { actionType: "CALL_AGENT", agentId: "" } }, STEP_GRAPH.nodes[2]!], edges: [] } }), { status: 400, body: { error: { code: "VALIDATION_ERROR", message: "Dados inválidos.", details: [issue] } } })
    renderEditor()
    await addWait()
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rascunho" }))
    const failure = await screen.findByTestId("save-draft-failure")
    expect(failure).toHaveTextContent('em "Analisar", escolha o agente')
    expect(failure).not.toHaveTextContent("Dados inválidos")
    expect(await screen.findByRole("textbox", { name: "Nome da etapa" })).toHaveValue("Analisar")
  })

  it("etapa nova nasce com nome; salvar não grava rótulo de ligação nem seta", async () => {
    const calls = stubApi(workflowDetail())
    renderEditor()
    await addWait()
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/draft"))).toBe(true))
    const graph = (calls.find((call) => call.path.endsWith("/draft"))!.body as { graph: FlowGraph }).graph
    expect(graph.nodes.at(-1)?.label).toBe("Aguardar")
    expect(Object.keys(graph.edges[0]!).sort()).toEqual(["id", "source", "sourceHandle", "target"])
  })
})

describe("WorkflowEditorPage — o que está rodando e o que acontece ao publicar", () => {
  it("WF-04: a primeira publicação por Flag abre o diálogo com o resumo, e nada é publicado antes de confirmar", async () => {
    const calls = stubApi(workflowDetail())
    renderEditor()
    expect(await screen.findByTestId("workflow-run-state")).toHaveTextContent("Rascunho — ainda não roda")
    await waitFor(() => expect(screen.getByRole("button", { name: "Publicar" })).toBeEnabled())
    fireEvent.click(screen.getByRole("button", { name: "Publicar" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(within(dialog).getByText("Quando começa")).toBeInTheDocument()
    expect(within(dialog).getByText(/flag "nota_ura"/)).toBeInTheDocument()
    expect(calls.some((call) => call.path.endsWith("/publish"))).toBe(false)
    fireEvent.click(within(dialog).getByRole("button", { name: "Publicar" }))
    await waitFor(() => expect(calls.some((call) => call.path.endsWith("/publish"))).toBe(true))
  })

  it("WF-05: publicado sem nada novo não oferece Publicar; o rodapé explica", async () => {
    stubApi(workflowDetail({ published: true, publishedGraph: STEP_GRAPH }))
    renderEditor()
    expect(await screen.findByTestId("workflow-run-state")).toHaveTextContent("No ar")
    await waitFor(() => expect(screen.getByTestId("workflow-issues-summary")).toHaveAttribute("data-status", "published"))
    expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled()
  })

  it("WF-05: fluxo salvo diferente do publicado aparece no cabeçalho e libera Publicar", async () => {
    const edited: FlowGraph = { ...STEP_GRAPH, nodes: STEP_GRAPH.nodes.map((node) => (node.id === "wait" ? { ...node, label: "Outro nome" } : node)) }
    stubApi(workflowDetail({ published: true, publishedGraph: STEP_GRAPH, draftGraph: edited }))
    renderEditor()
    expect(await screen.findByTestId("workflow-pending-flow")).toHaveTextContent("Fluxo não publicado")
    expect(await saveState()).toHaveTextContent("alterações ainda não publicadas")
    await waitFor(() => expect(screen.getByRole("button", { name: "Publicar" })).toBeEnabled())
  })

  it("WF-05: publicado e desativado diz que não roda", async () => {
    stubApi(workflowDetail({ published: true, active: false, publishedGraph: STEP_GRAPH }))
    renderEditor()
    expect(await screen.findByTestId("workflow-run-state")).toHaveTextContent("Desativado — não roda")
  })

  it("WF-26: Gatilho → Fim não habilita Publicar e orienta o próximo passo", async () => {
    const empty: FlowGraph = { nodes: [STEP_GRAPH.nodes[0]!, STEP_GRAPH.nodes[2]!], edges: [{ id: "e", source: "trigger", sourceHandle: "always", target: "end" }] }
    stubApi(workflowDetail({ draftGraph: empty }))
    renderEditor()
    await waitFor(() => expect(screen.getByTestId("workflow-issues-summary")).toHaveAttribute("data-status", "empty"))
    expect(screen.getByRole("button", { name: "Publicar" })).toBeDisabled()
  })
})

describe("WorkflowEditorPage — nomes acessíveis e falha ao abrir", () => {
  it("WF-34: voltar tem nome e os controles do canvas estão em português", async () => {
    stubApi(workflowDetail())
    renderEditor()
    expect(await screen.findByRole("link", { name: "Workflows" })).toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Ajustar à tela" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Fit View" })).not.toBeInTheDocument()
  })

  it("WF-31: falha ao abrir explica e oferece o caminho de volta, sem esqueleto eterno", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "WORKFLOW_NOT_FOUND", message: "Não encontrado." } }), { status: 404 })))
    renderEditor()
    const message = await screen.findByTestId("workflow-load-error")
    expect(within(message).getByRole("link", { name: "Voltar para a lista" })).toHaveAttribute("href", "/admin/workflows")
  })

  it("abre direto na aba indicada por ?tab=enrollments, para onde o aviso de execução bloqueada leva", async () => {
    navigation.searchParams = new URLSearchParams("tab=enrollments")
    stubApi(workflowDetail())
    renderEditor()
    expect(await screen.findByText("Conteúdo de Execuções")).toBeVisible()
  })

  it("aba desconhecida em ?tab= é ignorada: abre no Editor", async () => {
    navigation.searchParams = new URLSearchParams("tab=outra")
    stubApi(workflowDetail())
    renderEditor()
    expect(await screen.findByRole("button", { name: "Adicionar etapa Aguardar" })).toBeVisible()
    expect(screen.queryByText("Conteúdo de Execuções")).not.toBeInTheDocument()
  })
})
