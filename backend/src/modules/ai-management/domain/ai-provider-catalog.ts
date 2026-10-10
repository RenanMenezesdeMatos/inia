import type { AiCapability } from "./ai-capabilities.js"

/**
 * CATÁLOGO DE PROVIDERS (§3, §5, §6). Provider = TIPO de integração (metadata + adapter), nunca
 * uma conexão e nunca um modelo. Ele vive em código porque só existe se houver um adapter que fale
 * o protocolo — conexões e modelos são DADOS da organização (tabelas `ai_connections`/`ai_models`).
 *
 * Adicionar um provider novo = uma entrada aqui (+ um adapter novo SÓ se o protocolo for novo).
 * A UI é montada a partir desta metadata (campos, credencial, descoberta) — nenhum `if provider`
 * em tela. xAI, LM Studio e Ollama falam o protocolo OpenAI Chat Completions: reaproveitam o mesmo
 * adapter com outros padrões (§5: não duplicar adapter só por nome comercial).
 */
export const AI_ADAPTER_TYPES = ["GOOGLE_GENAI", "OPENAI_CHAT_COMPLETIONS", "ANTHROPIC_MESSAGES"] as const
export type AiAdapterType = (typeof AI_ADAPTER_TYPES)[number]

export type AiProviderDeployment = "REMOTE" | "LOCAL" | "REMOTE_OR_LOCAL"
export type AiCredentialRequirement = "REQUIRED" | "OPTIONAL" | "NONE"

export type AiProviderDefinition = {
  key: string
  name: string
  description: string
  adapterType: AiAdapterType
  deployment: AiProviderDeployment
  /** Ícone genérico (nome de ícone da UI) — nunca logo de marca embutido. */
  icon: "sparkles" | "brain" | "bot" | "server" | "cpu" | "plug"
  defaultBaseUrl: string | null
  /** true = o admin informa o endpoint (local, compatível); false = endpoint fixo do vendor (editável só em "avançado"). */
  baseUrlRequired: boolean
  credential: AiCredentialRequirement
  credentialLabel: string
  supportsModelDiscovery: boolean
  supportsCustomHeaders: boolean
  /** O que o PROTOCOLO do adapter consegue transportar — o modelo ainda precisa suportar. */
  protocolCapabilities: readonly AiCapability[]
  /** Observação exibida no formulário (ex.: o "localhost" é o servidor da INIA). */
  notes: string[]
  active: boolean
}

const LOCALHOST_NOTE = "\"localhost\" aqui é o SERVIDOR da INIA, não o computador de quem está no navegador. O endpoint precisa ser alcançável pelo backend da INIA (mesma máquina, rede interna/LAN ou VPN)."

export const AI_PROVIDERS: readonly AiProviderDefinition[] = [
  {
    key: "GOOGLE_GENAI",
    name: "Google Gemini",
    description: "API Gemini (Google AI Studio). Mesmo protocolo usado hoje pela configuração legada por ambiente.",
    adapterType: "GOOGLE_GENAI",
    deployment: "REMOTE",
    icon: "sparkles",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    baseUrlRequired: false,
    credential: "REQUIRED",
    credentialLabel: "API key",
    supportsModelDiscovery: true,
    supportsCustomHeaders: false,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING", "REASONING", "VISION", "AUDIO", "PROMPT_CACHE"],
    notes: [],
    active: true,
  },
  {
    key: "OPENAI",
    name: "OpenAI",
    description: "API OpenAI (Chat Completions).",
    adapterType: "OPENAI_CHAT_COMPLETIONS",
    deployment: "REMOTE",
    icon: "brain",
    defaultBaseUrl: "https://api.openai.com/v1",
    baseUrlRequired: false,
    credential: "REQUIRED",
    credentialLabel: "API key",
    supportsModelDiscovery: true,
    supportsCustomHeaders: false,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING", "REASONING", "VISION"],
    notes: ["A listagem de modelos da OpenAI não informa capacidades — declare-as em cada modelo antes de usá-lo num Use Case."],
    active: true,
  },
  {
    key: "XAI",
    name: "xAI (Grok)",
    description: "API xAI — protocolo compatível com OpenAI Chat Completions.",
    adapterType: "OPENAI_CHAT_COMPLETIONS",
    deployment: "REMOTE",
    icon: "bot",
    defaultBaseUrl: "https://api.x.ai/v1",
    baseUrlRequired: false,
    credential: "REQUIRED",
    credentialLabel: "API key",
    supportsModelDiscovery: true,
    supportsCustomHeaders: false,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING", "REASONING", "VISION"],
    notes: ["A listagem de modelos não informa capacidades — declare-as em cada modelo."],
    active: true,
  },
  {
    key: "ANTHROPIC",
    name: "Anthropic (Claude)",
    description: "API Anthropic (Messages).",
    adapterType: "ANTHROPIC_MESSAGES",
    deployment: "REMOTE",
    icon: "brain",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    baseUrlRequired: false,
    credential: "REQUIRED",
    credentialLabel: "API key",
    supportsModelDiscovery: true,
    supportsCustomHeaders: false,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "REASONING", "VISION"],
    notes: ["Saída estruturada é obtida por instrução (a API não tem modo JSON nativo) — declare a capacidade só depois de validar o modelo.", "Streaming ainda não implementado para este provider: o chat recebe a resposta inteira de uma vez."],
    active: true,
  },
  {
    key: "OPENAI_COMPATIBLE",
    name: "Servidor compatível com OpenAI",
    description: "Qualquer servidor que implemente /v1/models e /v1/chat/completions (vLLM, LiteLLM, gateways internos, modelos locais).",
    adapterType: "OPENAI_CHAT_COMPLETIONS",
    deployment: "REMOTE_OR_LOCAL",
    icon: "plug",
    defaultBaseUrl: null,
    baseUrlRequired: true,
    credential: "OPTIONAL",
    credentialLabel: "API key / token (opcional)",
    supportsModelDiscovery: true,
    supportsCustomHeaders: true,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING"],
    notes: [LOCALHOST_NOTE, "Capacidades não são informadas pelo protocolo — declare-as em cada modelo."],
    active: true,
  },
  {
    key: "LM_STUDIO",
    name: "LM Studio",
    description: "Servidor local do LM Studio (protocolo compatível com OpenAI).",
    adapterType: "OPENAI_CHAT_COMPLETIONS",
    deployment: "LOCAL",
    icon: "cpu",
    defaultBaseUrl: "http://localhost:1234/v1",
    baseUrlRequired: true,
    credential: "NONE",
    credentialLabel: "",
    supportsModelDiscovery: true,
    supportsCustomHeaders: false,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING"],
    notes: [LOCALHOST_NOTE],
    active: true,
  },
  {
    key: "OLLAMA",
    name: "Ollama",
    description: "Servidor Ollama pelo endpoint compatível com OpenAI (/v1).",
    adapterType: "OPENAI_CHAT_COMPLETIONS",
    deployment: "LOCAL",
    icon: "server",
    defaultBaseUrl: "http://localhost:11434/v1",
    baseUrlRequired: true,
    credential: "NONE",
    credentialLabel: "",
    supportsModelDiscovery: true,
    supportsCustomHeaders: false,
    protocolCapabilities: ["STRUCTURED_OUTPUT", "TOOLS", "STREAMING"],
    notes: [LOCALHOST_NOTE, "Nem todo modelo do Ollama suporta ferramentas — declare a capacidade só para os que suportam."],
    active: true,
  },
]

export function findAiProvider(key: string): AiProviderDefinition | null {
  return AI_PROVIDERS.find((provider) => provider.key === key && provider.active) ?? null
}

/** Provider "LOCAL" para fins de custo/dashboard: conexão LOCAL por definição ou marcada pelo admin. */
export function isLocalDeployment(provider: AiProviderDefinition, declaredLocal: boolean): boolean {
  return provider.deployment === "LOCAL" || (provider.deployment === "REMOTE_OR_LOCAL" && declaredLocal)
}
