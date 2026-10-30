/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest"
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { installJsdomStubs } from "@/components/analytics/testing/jsdom-stubs"
import { renderWithQuery } from "@/components/analytics/testing/render-with-query"
import { AdminApiError } from "@/lib/admin/admin-api"
import type { AiBudget, AiConnection, AiModel, AiOverview, AiProvider, UseCaseRouting } from "@/schemas/admin/ai-management.schema"

import { BudgetsTab } from "./budgets-tab"
import { ConnectionsTab } from "./connections-tab"
import { ModelsTab } from "./models-tab"
import { OverviewTab } from "./overview-tab"
import { RoutingTab } from "./routing-tab"

const service = vi.hoisted(() => ({
  fetchAiPermissions: vi.fn(),
  fetchAiProviders: vi.fn(),
  fetchAiUseCases: vi.fn(),
  fetchAiOverview: vi.fn(),
  fetchAiConnections: vi.fn(),
  createAiConnection: vi.fn(),
  updateAiConnection: vi.fn(),
  deleteAiConnection: vi.fn(),
  replaceAiConnectionSecret: vi.fn(),
  removeAiConnectionSecret: vi.fn(),
  replaceAiConnectionHeaders: vi.fn(),
  testAiConnection: vi.fn(),
  syncAiConnectionModels: vi.fn(),
  fetchAiModels: vi.fn(),
  createAiModel: vi.fn(),
  updateAiModel: vi.fn(),
  deleteAiModel: vi.fn(),
  testAiModel: vi.fn(),
  fetchAiModelPricing: vi.fn(),
  addAiModelPricing: vi.fn(),
  fetchAiRouting: vi.fn(),
  saveAiRoutingDraft: vi.fn(),
  discardAiRoutingDraft: vi.fn(),
  activateAiRoutingDraft: vi.fn(),
  deactivateAiRoutingPolicy: vi.fn(),
  testAiRouting: vi.fn(),
  fetchAiBudgets: vi.fn(),
  createAiBudget: vi.fn(),
  updateAiBudget: vi.fn(),
  deleteAiBudget: vi.fn(),
}))
vi.mock("@/services/admin/ai-management-service", () => service)
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const LOCALHOST_NOTE = "\"localhost\" aqui é o SERVIDOR da INIA, não o computador de quem está no navegador. O endpoint precisa ser alcançável pelo backend da INIA (mesma máquina, rede interna/LAN ou VPN)."

// A UI de conexão é montada por esta metadata — nenhum provider é conhecido pela tela.
const PROVIDERS: AiProvider[] = [
  { key: "OPENAI", name: "OpenAI", description: "API OpenAI (Chat Completions).", adapterType: "OPENAI_CHAT_COMPLETIONS", deployment: "REMOTE", icon: "brain", defaultBaseUrl: "https://api.openai.com/v1", baseUrlRequired: false, credential: "REQUIRED", credentialLabel: "API key", supportsModelDiscovery: true, supportsCustomHeaders: false, protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS"], notes: [] },
  { key: "LM_STUDIO", name: "LM Studio", description: "Servidor local do LM Studio.", adapterType: "OPENAI_CHAT_COMPLETIONS", deployment: "LOCAL", icon: "cpu", defaultBaseUrl: "http://localhost:1234/v1", baseUrlRequired: true, credential: "NONE", credentialLabel: "", supportsModelDiscovery: true, supportsCustomHeaders: false, protocolCapabilities: ["STRUCTURED_OUTPUT"], notes: [LOCALHOST_NOTE] },
  { key: "OPENAI_COMPATIBLE", name: "Servidor compatível com OpenAI", description: "vLLM, LiteLLM…", adapterType: "OPENAI_CHAT_COMPLETIONS", deployment: "REMOTE_OR_LOCAL", icon: "plug", defaultBaseUrl: null, baseUrlRequired: true, credential: "OPTIONAL", credentialLabel: "API key / token (opcional)", supportsModelDiscovery: true, supportsCustomHeaders: true, protocolCapabilities: ["STRUCTURED_OUTPUT"], notes: [LOCALHOST_NOTE] },
]

const CONNECTION: AiConnection = {
  id: "c1",
  providerKey: "OPENAI",
  provider: { key: "OPENAI", name: "OpenAI", icon: "brain", deployment: "REMOTE", credential: "REQUIRED" },
  name: "OpenAI produção",
  baseUrl: null,
  effectiveBaseUrl: "https://api.openai.com/v1",
  apiVersion: null,
  isLocal: false,
  timeoutMs: 60_000,
  maxConcurrentCalls: null,
  enabled: true,
  credential: { configured: true, maskedValue: "••••••••abcd", updatedAt: "2026-09-20T10:00:00.000Z" },
  customHeaderNames: [],
  health: { status: null, checkedAt: null, latencyMs: null, message: null },
  modelCount: 3,
  enabledModelCount: 2,
  lastUsedAt: null,
  activePolicyUseCases: [],
  createdAt: "2026-09-20T10:00:00.000Z",
  updatedAt: "2026-09-20T10:00:00.000Z",
}

function model(overrides: Partial<AiModel>): AiModel {
  return {
    id: "m1",
    connectionId: "c1",
    connectionName: "OpenAI produção",
    connectionEnabled: true,
    providerKey: "OPENAI",
    providerName: "OpenAI",
    providerModelId: "gpt-a",
    displayName: "Modelo A",
    enabled: true,
    kind: "GENERATIVE",
    origin: "DISCOVERED",
    contextWindow: null,
    maxOutputTokens: null,
    capabilities: { STRUCTURED_OUTPUT: { supported: true, source: "MANUAL" } },
    qualityTier: null,
    timeoutMs: null,
    speech: null,
    isLocal: false,
    lastSeenAt: null,
    missingFromLastSync: false,
    currentPricing: null,
    costLabel: "NOT_LOCAL",
    usage30d: { requests: 0, errors: 0, costByCurrency: {} },
    policies: [],
    ...overrides,
  }
}

beforeAll(installJsdomStubs)
beforeEach(() => {
  service.fetchAiPermissions.mockResolvedValue(["AI_CONFIG_READ", "AI_CONFIG_WRITE", "AI_SECRETS_WRITE", "AI_USAGE_READ", "AI_BUDGET_WRITE"])
  service.fetchAiProviders.mockResolvedValue(PROVIDERS)
  service.fetchAiUseCases.mockResolvedValue([])
  service.fetchAiModels.mockResolvedValue([])
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("IA / Modelos — Conexões", () => {
  it("lista a conexão com a chave MASCARADA e nunca oferece o valor da chave (só substituir/remover)", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    renderWithQuery(<ConnectionsTab />)
    const row = await screen.findByTestId("connection-row-c1")
    expect(within(row).getByTestId("connection-masked-key")).toHaveTextContent("••••••••abcd")
    expect(row).toHaveTextContent("2/3")

    fireEvent.click(screen.getByRole("button", { name: "Configurar OpenAI produção" }))
    const credential = await screen.findByTestId("credential-section")
    expect(within(credential).getByTestId("credential-masked")).toHaveTextContent("••••••••abcd")
    expect(within(credential).getByRole("button", { name: "Substituir chave" })).toBeInTheDocument()
    expect(within(credential).getByRole("button", { name: "Remover chave" })).toBeInTheDocument()
    expect(within(credential).queryByRole("button", { name: /mostrar|revelar|exibir/i })).not.toBeInTheDocument()
    // Nenhum campo de senha vem preenchido: não existe valor da chave no cliente.
    fireEvent.click(within(credential).getByRole("button", { name: "Substituir chave" }))
    for (const input of document.querySelectorAll<HTMLInputElement>("input[type=password]")) expect(input.value).toBe("")
  })

  it("Nova conexão: os campos vêm da metadata do provider (REQUIRED pede API key, NONE esconde, nota do localhost em provider LOCAL)", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    service.createAiConnection.mockResolvedValue({ ...CONNECTION, id: "c2" })
    renderWithQuery(<ConnectionsTab />)
    await screen.findByTestId("connection-row-c1")
    fireEvent.click(screen.getByRole("button", { name: /Nova conexão/ }))

    fireEvent.click(await screen.findByRole("radio", { name: /OpenAI API OpenAI/ }))
    expect(screen.getByLabelText("API key *")).toHaveAttribute("type", "password")
    expect(screen.queryByText(LOCALHOST_NOTE)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: /LM Studio/ }))
    expect(screen.queryByLabelText(/API key/)).not.toBeInTheDocument()
    expect(screen.getByText("Este provider não usa credencial.")).toBeInTheDocument()
    expect(screen.getByText(LOCALHOST_NOTE)).toBeInTheDocument()
    expect(screen.getByLabelText("Endpoint")).toHaveAttribute("placeholder", "http://localhost:1234/v1")

    fireEvent.click(screen.getByRole("radio", { name: /Servidor compatível/ }))
    expect(screen.getByLabelText("API key / token (opcional)")).toBeInTheDocument()
    expect(screen.getByLabelText("Endpoint *")).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: /Endpoint local\?/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Adicionar cabeçalho" })).toBeInTheDocument()

    fireEvent.click(screen.getByRole("radio", { name: /OpenAI API OpenAI/ }))
    fireEvent.change(screen.getByLabelText("Nome *"), { target: { value: "OpenAI teste" } })
    expect(screen.getByRole("button", { name: "Criar conexão" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("API key *"), { target: { value: "sk-test-1234567890" } })
    // Vagas da conexão (limite por acesso do provedor, somando todas as instâncias): inválido trava o envio; em branco = sem limite.
    fireEvent.change(screen.getByLabelText("Chamadas simultâneas"), { target: { value: "0" } })
    expect(screen.getByText("Use um número inteiro de 1 a 1000, ou deixe em branco.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Criar conexão" })).toBeDisabled()
    fireEvent.change(screen.getByLabelText("Chamadas simultâneas"), { target: { value: "12" } })
    fireEvent.click(screen.getByRole("button", { name: "Criar conexão" }))
    await waitFor(() => expect(service.createAiConnection.mock.calls[0]?.[0]).toEqual({ providerKey: "OPENAI", name: "OpenAI teste", baseUrl: null, timeoutMs: 60_000, maxConcurrentCalls: 12, apiKey: "sk-test-1234567890" }))
  })

  it("Adicionar modelo local: só providers locais, com o LM Studio pré-selecionado", async () => {
    service.fetchAiConnections.mockResolvedValue([])
    renderWithQuery(<ConnectionsTab />)
    await screen.findByText("Nenhuma conexão de IA")
    fireEvent.click(screen.getByRole("button", { name: /Adicionar modelo local/ }))
    expect(await screen.findByRole("radio", { name: /LM Studio/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("radio", { name: /Servidor compatível/ })).toBeInTheDocument()
    expect(screen.queryByRole("radio", { name: /OpenAI API OpenAI/ })).not.toBeInTheDocument()
    expect(screen.getByText(LOCALHOST_NOTE)).toBeInTheDocument()
  })

  it("Testar conexão mostra status, latência, mensagem segura e horário", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    service.testAiConnection.mockResolvedValue({ status: "CONNECTED", latencyMs: 312, message: "O provider respondeu.", modelCount: 5, checkedAt: "2026-09-22T12:00:00.000Z" })
    renderWithQuery(<ConnectionsTab />)
    const row = await screen.findByTestId("connection-row-c1")
    expect(row).toHaveTextContent("Não testada")
    fireEvent.click(screen.getByRole("button", { name: "Testar OpenAI produção" }))
    await waitFor(() => expect(within(row).getByTestId("connection-test-result")).toHaveTextContent("Conectado"))
    const result = within(row).getByTestId("connection-test-result")
    expect(result).toHaveTextContent("Latência: 312 ms")
    expect(result).toHaveTextContent("O provider respondeu.")
    expect(result).toHaveTextContent("5 modelo(s)")
    expect(result).toHaveTextContent("Testado em")
  })

  it("Excluir conexão em uso mostra as dependências devolvidas pelo 409", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    service.deleteAiConnection.mockRejectedValue(new AdminApiError("A conexão é usada por política(s) de roteamento (AGENT_RESPONSE ativa).", "AI_CONNECTION_IN_USE", { policies: [{ useCase: "AGENT_RESPONSE", status: "ACTIVE" }] }))
    renderWithQuery(<ConnectionsTab />)
    await screen.findByTestId("connection-row-c1")
    fireEvent.click(screen.getByRole("button", { name: "Excluir OpenAI produção" }))
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("AGENT_RESPONSE ativa")
  })

  it("Sem AI_CONFIG_WRITE não há ações de escrita", async () => {
    service.fetchAiPermissions.mockResolvedValue(["AI_CONFIG_READ", "AI_USAGE_READ"])
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    renderWithQuery(<ConnectionsTab />)
    await screen.findByTestId("connection-row-c1")
    await waitFor(() => expect(service.fetchAiPermissions).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: /Nova conexão/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Testar OpenAI produção" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Excluir OpenAI produção" })).not.toBeInTheDocument()
  })
})

describe("IA / Modelos — Modelos", () => {
  it("desabilitar modelo de política ativa (409 AI_MODEL_IN_USE_ACTIVE) pede confirmação e reenvia com acknowledgeActivePolicyImpact", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    service.fetchAiModels.mockResolvedValue([model({ policies: [{ useCase: "AGENT_RESPONSE", status: "ACTIVE" }] })])
    service.updateAiModel
      .mockRejectedValueOnce(new AdminApiError("Este modelo atende política(s) ativa(s): AGENT_RESPONSE. Confirme para prosseguir.", "AI_MODEL_IN_USE_ACTIVE", { activeUseCases: ["AGENT_RESPONSE"] }))
      .mockResolvedValueOnce(model({ enabled: false }))
    renderWithQuery(<ModelsTab />)
    await screen.findByTestId("model-row-m1")
    fireEvent.click(await screen.findByRole("switch", { name: "Desabilitar Modelo A" }))
    expect(await screen.findByText("Desabilitar modelo em uso?")).toBeInTheDocument()
    expect(screen.getByText(/Este modelo atende política\(s\) ativa\(s\): AGENT_RESPONSE/)).toBeInTheDocument()
    expect(service.updateAiModel.mock.calls[0]?.[0]).toEqual({ id: "m1", enabled: false })
    fireEvent.click(screen.getByRole("button", { name: "Desabilitar mesmo assim" }))
    await waitFor(() => expect(service.updateAiModel.mock.calls[1]?.[0]).toEqual({ id: "m1", enabled: false, acknowledgeActivePolicyImpact: true }))
  })

  it("modelo de áudio: voz e instrução de tom aparecem no formulário e vão no PATCH só quando mudam; modelo de texto não mostra voz", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    service.fetchAiModels.mockResolvedValue([model({ id: "tts", displayName: "Voz OpenAI", providerModelId: "gpt-4o-mini-tts", capabilities: { AUDIO: { supported: true, source: "MANUAL" } } }), model({ id: "text", displayName: "Texto" })])
    service.fetchAiModelPricing.mockResolvedValue([])
    service.updateAiModel.mockResolvedValue(model({ id: "tts", speech: { voice: "marin", instructions: "Fale com calma." } }))
    renderWithQuery(<ModelsTab />)
    fireEvent.click(await screen.findByRole("button", { name: "Configurar Texto" }))
    expect(screen.queryByLabelText("Voz (síntese de voz)")).not.toBeInTheDocument()
    cleanup()
    renderWithQuery(<ModelsTab />)
    fireEvent.click(await screen.findByRole("button", { name: "Configurar Voz OpenAI" }))
    fireEvent.change(await screen.findByLabelText("Voz (síntese de voz)"), { target: { value: "marin" } })
    fireEvent.change(screen.getByLabelText("Instrução de tom (opcional)"), { target: { value: "Fale com calma." } })
    fireEvent.click(screen.getByRole("button", { name: "Salvar modelo" }))
    await waitFor(() => expect(service.updateAiModel.mock.calls[0]?.[0]).toMatchObject({ id: "tts", speech: { voice: "marin", instructions: "Fale com calma." } }))
    fireEvent.change(screen.getByLabelText("Voz (síntese de voz)"), { target: { value: "voz<inválida>" } })
    expect(screen.getByText(/Use só letras, números/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Salvar modelo" })).toBeDisabled()
  })

  it("modelo local com preço zero mostra o rótulo de custo de API (nunca 'grátis') e custo 30d por moeda", async () => {
    service.fetchAiConnections.mockResolvedValue([CONNECTION])
    service.fetchAiModels.mockResolvedValue([
      model({ id: "m-local", displayName: "Llama local", isLocal: true, costLabel: "API_COST_ZERO" }),
      model({ id: "m-paid", displayName: "Pago", currentPricing: { id: "p1", currency: "USD", inputPerMillion: "0.30", outputPerMillion: "2.50", cachedInputPerMillion: null, reasoningPerMillion: null, effectiveFrom: "2026-09-01T00:00:00.000Z", effectiveTo: null, note: null }, usage30d: { requests: 12, errors: 0, costByCurrency: { USD: "1.25", BRL: "3.10" } } }),
    ])
    renderWithQuery(<ModelsTab />)
    const local = await screen.findByTestId("model-row-m-local")
    expect(local).toHaveTextContent("Custo de API: 0 · custo computacional não medido")
    expect(local.textContent).not.toMatch(/grátis/i)
    const paid = screen.getByTestId("model-row-m-paid")
    expect(paid).toHaveTextContent("US$")
    expect(paid).toHaveTextContent("R$")
  })
})

describe("IA / Modelos — Roteamento", () => {
  const ROUTING: UseCaseRouting = {
    useCase: { key: "AGENT_RESPONSE", label: "Resposta do Agent", description: "Síntese final do Agent.", group: "RESPONSE", requiredCapabilities: ["STRUCTURED_OUTPUT"], preferredCapabilities: [], routable: true, internal: false, requiresSpeechVoice: false },
    active: null,
    draft: {
      id: "p-draft",
      status: "DRAFT",
      mode: "PINNED",
      strategy: null,
      fallbackOn: ["RATE_LIMIT"],
      maxEstimatedCostPerRequest: null,
      costCurrency: null,
      models: [{ modelId: "m2", displayName: "Modelo B", providerModelId: "gpt-b", connectionName: "OpenAI produção", providerKey: "OPENAI", enabled: true, available: true }],
      issues: [{ code: "AI_POLICY_MODEL_INCOMPATIBLE", message: "Modelo B não declara Saída estruturada (JSON).", modelId: "m2" }],
      valid: false,
      version: 1,
      updatedAt: "2026-09-22T10:00:00.000Z",
      activatedAt: null,
    },
    effective: "LEGACY",
    legacy: { providerKey: "GOOGLE_GENAI", model: "gemini-3.8-flash", tier: "STANDARD", mode: "CURRENT", reason: "STANDARD" },
  }

  it("modelo sem a capacidade exigida fica desabilitado com o motivo e Ativar continua desabilitado com rascunho inválido", async () => {
    service.fetchAiRouting.mockResolvedValue([ROUTING, { ...ROUTING, useCase: { ...ROUTING.useCase, key: "VOICE_REALTIME", label: "Voz em tempo real", routable: false, notes: "V1: usa a configuração legada por ambiente." }, draft: null, legacy: null }])
    service.fetchAiModels.mockResolvedValue([
      model({ id: "m1", displayName: "Modelo A" }),
      model({ id: "m2", displayName: "Modelo B", capabilities: {} }),
      model({ id: "m3", displayName: "Modelo C", capabilities: { TOOLS: { supported: true, source: "DISCOVERED" } } }),
    ])
    renderWithQuery(<RoutingTab />)
    const voice = await screen.findByTestId("routing-row-VOICE_REALTIME")
    expect(voice).toHaveTextContent("Não configurável nesta versão")
    expect(within(voice).queryByRole("button")).not.toBeInTheDocument()
    expect(screen.getByTestId("routing-row-AGENT_RESPONSE")).toHaveTextContent("Rascunho inválido")

    fireEvent.click(screen.getByRole("button", { name: "Configurar roteamento de Resposta do Agent" }))
    const incompatible = await screen.findByTestId("available-model-m3")
    expect(within(incompatible).getByRole("button", { name: "Adicionar Modelo C" })).toBeDisabled()
    expect(incompatible).toHaveTextContent("Incompatível: Capacidade ausente ou não declarada: Saída estruturada (JSON)")
    expect(screen.getByTestId("draft-issues")).toHaveTextContent("Modelo B não declara Saída estruturada (JSON).")
    expect(screen.getByRole("button", { name: "Ativar" })).toBeDisabled()
    expect(screen.getByTestId("legacy-route")).toHaveTextContent("gemini-3.8-flash")
    // O nome do campo é o rótulo visível (WCAG 2.5.3).
    expect(screen.getByRole("textbox", { name: "Limite de custo estimado por requisição (opcional)" })).toBeInTheDocument()

    // PINNED aceita 1 modelo: mesmo o compatível só entra depois de remover o incompatível.
    expect(within(screen.getByTestId("available-model-m1")).getByRole("button", { name: "Adicionar Modelo A" })).toBeDisabled()
    fireEvent.click(screen.getByRole("button", { name: "Remover Modelo B" }))
    fireEvent.click(within(screen.getByTestId("available-model-m1")).getByRole("button", { name: "Adicionar Modelo A" }))
    // Alteração não salva: nem testar nem ativar antes de salvar o rascunho.
    expect(screen.getByRole("button", { name: "Ativar" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Testar roteamento" })).toBeDisabled()
    service.saveAiRoutingDraft.mockResolvedValue({ ...ROUTING })
    fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }))
    await waitFor(() => expect(service.saveAiRoutingDraft.mock.calls[0]?.[0]).toEqual({ useCase: "AGENT_RESPONSE", mode: "PINNED", strategy: null, modelIds: ["m1"], fallbackOn: ["RATE_LIMIT"], maxEstimatedCostPerRequest: null, costCurrency: null }))
  })

  it("Voz do recado: modelo de áudio sem voz cadastrada aparece incompatível com o caminho para configurar; com voz, pode entrar", async () => {
    const speech: UseCaseRouting = { ...ROUTING, useCase: { ...ROUTING.useCase, key: "SPEECH_SYNTHESIS", label: "Voz do recado do avatar", group: "INTERACTIVE", requiredCapabilities: ["AUDIO"], requiresSpeechVoice: true }, draft: null }
    service.fetchAiRouting.mockResolvedValue([speech])
    const audio = { AUDIO: { supported: true, source: "MANUAL" } }
    service.fetchAiModels.mockResolvedValue([model({ id: "v1", displayName: "TTS sem voz", capabilities: audio }), model({ id: "v2", displayName: "TTS marin", capabilities: audio, speech: { voice: "marin", instructions: null } })])
    renderWithQuery(<RoutingTab />)
    fireEvent.click(await screen.findByRole("button", { name: "Configurar roteamento de Voz do recado do avatar" }))
    const withoutVoice = await screen.findByTestId("available-model-v1")
    expect(withoutVoice).toHaveTextContent("Incompatível: Voz não configurada no modelo (Modelos › Configurar)")
    expect(within(withoutVoice).getByRole("button", { name: "Adicionar TTS sem voz" })).toBeDisabled()
    expect(within(screen.getByTestId("available-model-v2")).getByRole("button", { name: "Adicionar TTS marin" })).toBeEnabled()
  })

  it("Testar roteamento mostra o plano sem chamada paga", async () => {
    const valid: UseCaseRouting = { ...ROUTING, draft: { ...ROUTING.draft!, models: [{ ...ROUTING.draft!.models[0]!, modelId: "m1", displayName: "Modelo A" }], issues: [], valid: true } }
    service.fetchAiRouting.mockResolvedValue([valid])
    service.fetchAiModels.mockResolvedValue([model({ id: "m1", displayName: "Modelo A" })])
    service.testAiRouting.mockResolvedValue({ useCase: "AGENT_RESPONSE", source: "DRAFT", selected: { modelId: "m1", displayName: "Modelo A", providerModelId: "gpt-a", connectionName: "OpenAI produção", providerKey: "OPENAI", reason: "PINNED" }, chain: [{ position: 0, modelId: "m1", displayName: "Modelo A", providerKey: "OPENAI", connectionName: "OpenAI produção", reason: "PINNED", capabilities: ["STRUCTURED_OUTPUT (MANUAL)"], pricing: null, recentLatencyMs: 420 }], skipped: [], notes: [], requiredCapabilities: ["STRUCTURED_OUTPUT"], fallbackOn: ["RATE_LIMIT"], legacy: null, budgetBlocked: false })
    renderWithQuery(<RoutingTab />)
    fireEvent.click(await screen.findByRole("button", { name: "Configurar roteamento de Resposta do Agent" }))
    const activate = await screen.findByRole("button", { name: "Ativar" })
    expect(activate).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Testar roteamento" }))
    const result = await screen.findByTestId("routing-test-result")
    expect(result).toHaveTextContent("Nenhuma chamada paga")
    expect(result).toHaveTextContent("Selecionado: Modelo A")
    expect(result).toHaveTextContent("420 ms")
    expect(service.testAiRouting.mock.calls[0]?.[0]).toEqual({ useCase: "AGENT_RESPONSE", source: "DRAFT" })
  })
})

describe("IA / Modelos — Orçamentos", () => {
  it("mostra moeda, limite rígido, status e moedas não comparáveis (sem conversão)", async () => {
    const budget: AiBudget = { id: "b1", scope: "GLOBAL", scopeKey: null, scopeLabel: "Global (todos os usos)", currency: "BRL", monthlyAmount: "500.00", warningThresholds: [70, 90, 100], hardLimit: true, enabled: true, evaluation: { budgetId: "b1", status: "WARNING", spent: "400.000000", limit: "500.000000", currency: "BRL", percent: 80, reachedThresholds: [70], notComparableCurrencies: ["USD"], unknownCostCalls: 3, hardLimitReached: false } }
    service.fetchAiBudgets.mockResolvedValue([budget])
    renderWithQuery(<BudgetsTab />)
    const row = await screen.findByTestId("budget-row-b1")
    expect(row).toHaveTextContent("BRL")
    expect(row).toHaveTextContent("R$")
    expect(within(row).getAllByText("Limite rígido").length).toBeGreaterThan(0)
    expect(row).toHaveTextContent("Alerta")
    expect(row).toHaveTextContent("Gasto em USD não é comparável a este orçamento em BRL (sem conversão).")
    expect(row).toHaveTextContent("3 chamada(s) sem custo conhecido")
  })

  it("Novo orçamento envia moeda, valor decimal em texto, limiares e limite rígido", async () => {
    service.fetchAiBudgets.mockResolvedValue([])
    service.createAiBudget.mockResolvedValue([])
    renderWithQuery(<BudgetsTab />)
    await screen.findByText("Nenhum orçamento")
    fireEvent.click(screen.getAllByRole("button", { name: /Novo orçamento/ })[0]!)
    fireEvent.change(await screen.findByLabelText("Moeda"), { target: { value: "brl" } })
    fireEvent.change(screen.getByLabelText("Valor mensal"), { target: { value: "1200,50" } })
    fireEvent.click(screen.getByRole("switch", { name: "Limite rígido" }))
    expect(screen.getByText(/AI_BUDGET_EXCEEDED/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Salvar orçamento" }))
    await waitFor(() => expect(service.createAiBudget.mock.calls[0]?.[0]).toEqual({ scope: "GLOBAL", scopeKey: null, currency: "BRL", monthlyAmount: "1200.50", warningThresholds: [70, 90, 100], hardLimit: true, enabled: true }))
  })
})

describe("IA / Modelos — Visão geral", () => {
  const EMPTY_METRICS = { requests: 0, attempts: 0, errors: 0, blocked: 0, fallbacks: 0, tokens: { input: null, output: null, reasoning: null, cached: null, total: null, reported: { input: 0, output: 0, reasoning: 0, cached: 0, total: 0 } }, costByCurrency: {}, unknownCostCalls: 0, localCalls: 0, latencyAvgMs: null, latencyP50Ms: null, latencyP95Ms: null, errorRate: null }
  const OVERVIEW: AiOverview = {
    usage: { period: { from: "2026-08-24T03:00:00.000Z", to: "2026-09-22T12:00:00.000Z", label: "Últimos 30 dias", timezone: "America/Sao_Paulo" }, totals: EMPTY_METRICS, daily: [], byProvider: [], byModel: [], byUseCase: [], currencies: [] },
    health: [],
    budgets: [],
    counts: { connections: 0, activeConnections: 0, models: 0, activeModels: 0, activePolicies: 0 },
    onboarding: { hasConnection: false, hasCredential: false, hasTestedConnection: false, hasModel: false, hasActivePolicy: false },
    legacy: { credentialConfigured: true, routingMode: "CURRENT", profiles: [{ id: "standard", providerKey: "GOOGLE_GENAI", model: "gemini-3.8-flash", tier: "STANDARD", enabled: true }], pricingConfigured: false, profilesOverridden: false },
  }

  it("sem conexão: onboarding em 6 passos com CTA para a aba certa, tokens 'Não informado' e sem custo conhecido", async () => {
    service.fetchAiOverview.mockResolvedValue(OVERVIEW)
    const onOpenTab = vi.fn()
    renderWithQuery(<OverviewTab onOpenTab={onOpenTab} />)
    const onboarding = await screen.findByTestId("ai-onboarding")
    for (const [index, title] of ["Adicionar provider", "Informar API key", "Testar", "Selecionar modelo", "Atribuir a Use Cases", "Pronto"].entries()) {
      const step = within(onboarding).getByTestId(`onboarding-step-${index + 1}`)
      expect(step).toHaveTextContent(title)
      expect(step).toHaveAttribute("data-complete", "false")
    }
    fireEvent.click(within(onboarding).getByRole("button", { name: /Ir para Conexões/ }))
    expect(onOpenTab).toHaveBeenCalledWith("connections")
    expect(screen.getByTestId("kpi-spend")).toHaveTextContent("Sem custo conhecido")
    expect(screen.getByTestId("kpi-tokens")).toHaveTextContent("Não informado")
    expect(screen.getByTestId("kpi-tokens")).not.toHaveTextContent(/\b0\b/)
    const legacy = screen.getByTestId("ai-legacy")
    expect(legacy).toHaveTextContent("Credencial do ambiente: configurada")
    expect(legacy).toHaveTextContent("gemini-3.8-flash")
    expect(service.fetchAiOverview.mock.calls[0]?.[0]).toEqual({ period: "30D" })
  })

  it("com gasto em duas moedas: um KPI por moeda, sem somar", async () => {
    service.fetchAiOverview.mockResolvedValue({
      ...OVERVIEW,
      onboarding: { hasConnection: true, hasCredential: true, hasTestedConnection: true, hasModel: true, hasActivePolicy: true },
      usage: { ...OVERVIEW.usage, totals: { ...EMPTY_METRICS, requests: 10, attempts: 11, costByCurrency: { USD: "1.500000", BRL: "2.000000" }, tokens: { ...EMPTY_METRICS.tokens, input: 1200, reported: { ...EMPTY_METRICS.tokens.reported, input: 8 } } }, currencies: ["USD", "BRL"] },
    })
    renderWithQuery(<OverviewTab onOpenTab={vi.fn()} />)
    expect(await screen.findByTestId("kpi-spend-USD")).toHaveTextContent("US$")
    expect(screen.getByTestId("kpi-spend-BRL")).toHaveTextContent("R$")
    expect(screen.queryByTestId("ai-onboarding")).not.toBeInTheDocument()
    expect(screen.getByTestId("kpi-tokens")).toHaveTextContent("informado em 8 chamada(s)")
  })
})
