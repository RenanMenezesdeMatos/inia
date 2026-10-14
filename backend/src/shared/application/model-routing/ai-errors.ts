import { DomainError } from "../../domain/domain-error.js"

/**
 * NORMALIZAÇÃO DE ERRO (§24, §92, §93). Todo adapter traduz o erro concreto do provider para uma
 * categoria comum; a UI e a telemetria só veem a categoria + mensagem SANITIZADA. O corpo cru do
 * provider fica no máximo no log interno — e mesmo lá passa por `redactSecrets`.
 */
export const AI_ERROR_CATEGORIES = ["AUTH", "RATE_LIMIT", "TIMEOUT", "NETWORK", "INVALID_REQUEST", "MODEL_UNAVAILABLE", "CONTEXT_LIMIT", "PROVIDER_ERROR", "BUDGET_EXCEEDED", "ROUTE_UNAVAILABLE", "UNKNOWN"] as const
export type AiErrorCategory = (typeof AI_ERROR_CATEGORIES)[number]

/**
 * Política de fallback (§24): só erros de DISPONIBILIDADE podem tentar o próximo modelo. AUTH é
 * opt-in explícito da policy (e sempre registrado); INVALID_REQUEST/CONTEXT_LIMIT não se resolvem
 * trocando de provider sem análise; falhas de validação/segurança da INIA (parse, Evidence Gating)
 * nem passam por aqui — acontecem DEPOIS da resposta e nunca viram "falha do provider".
 */
export const FALLBACK_ELIGIBLE_CATEGORIES = ["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE", "AUTH"] as const
export type FallbackEligibleCategory = (typeof FALLBACK_ELIGIBLE_CATEGORIES)[number]
export const DEFAULT_FALLBACK_ON: readonly FallbackEligibleCategory[] = ["RATE_LIMIT", "TIMEOUT", "NETWORK", "PROVIDER_ERROR", "MODEL_UNAVAILABLE"]

export function canFallbackOn(category: AiErrorCategory, fallbackOn: readonly string[]): boolean {
  return (FALLBACK_ELIGIBLE_CATEGORIES as readonly string[]).includes(category) && fallbackOn.includes(category)
}

const SAFE_MESSAGES: Record<AiErrorCategory, string> = {
  AUTH: "O provedor de IA recusou a credencial (verifique a API key da conexão).",
  RATE_LIMIT: "O provedor de IA limitou as requisições (rate limit).",
  TIMEOUT: "O provedor de IA demorou demais para responder.",
  NETWORK: "Não foi possível alcançar o provedor de IA.",
  INVALID_REQUEST: "O provedor de IA recusou a requisição.",
  MODEL_UNAVAILABLE: "O modelo não está disponível neste provedor.",
  CONTEXT_LIMIT: "A requisição excedeu a janela de contexto do modelo.",
  PROVIDER_ERROR: "O provedor de IA retornou um erro interno.",
  BUDGET_EXCEEDED: "O orçamento de IA da organização foi atingido.",
  ROUTE_UNAVAILABLE: "Nenhum modelo configurado pode atender esta função de IA.",
  UNKNOWN: "Erro inesperado ao chamar o provedor de IA.",
}

export function safeMessageFor(category: AiErrorCategory): string {
  return SAFE_MESSAGES[category]
}

/** HTTP do provider → categoria. O corpo só é consultado para distinguir janela de contexto de pedido inválido. */
export function categorizeHttpStatus(status: number, body = ""): AiErrorCategory {
  if (status === 401 || status === 403) return "AUTH"
  if (status === 429) return "RATE_LIMIT"
  if (status === 408 || status === 504) return "TIMEOUT"
  if (status === 404) return "MODEL_UNAVAILABLE"
  if (status === 400 || status === 413 || status === 422) {
    return /context|token.{0,20}(limit|exceed|maximum)|too long|maximum.{0,20}length/i.test(body) ? "CONTEXT_LIMIT" : "INVALID_REQUEST"
  }
  if (status >= 500) return "PROVIDER_ERROR"
  return "UNKNOWN"
}

/** Erro de fetch (não-HTTP) → categoria. */
export function categorizeFetchError(error: unknown): AiErrorCategory {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "TIMEOUT"
  if (error instanceof TypeError) return "NETWORK"
  return "UNKNOWN"
}

/**
 * Quem pediu foi embora (fechou o chat, recarregou a página, a conexão caiu): a chamada de IA foi cancelada — saiu da fila do
 * limitador ou teve o fetch interrompido. Não é falha do provedor: nunca dispara fallback nem nova tentativa.
 */
export class AiCallCancelledError extends DomainError {
  constructor() {
    super("A solicitação à INIA foi cancelada.", "AI_CALL_CANCELLED", 499)
    this.name = "AiCallCancelledError"
  }
}

/**
 * Erro de provider para quem chama: categoria + mensagem segura. `details` nunca carrega corpo do
 * provider (o error handler HTTP devolve `details` ao navegador).
 */
export class AiProviderError extends DomainError {
  constructor(
    readonly category: AiErrorCategory,
    options: { message?: string; httpStatus?: number | null; statusCode?: number; retryAfterMs?: number | null } = {},
  ) {
    super(options.message ?? safeMessageFor(category), `AI_${category}`, options.statusCode ?? statusCodeFor(category), { category, providerStatus: options.httpStatus ?? null, ...(options.retryAfterMs != null ? { retryAfterMs: options.retryAfterMs } : {}) })
    this.name = "AiProviderError"
  }
}

/** Teto de uma dica de espera aceita do provider (dica maior = "cota esgotada por muito tempo" — quem decide é o limitador). */
const MAX_RETRY_HINT_MS = 24 * 60 * 60 * 1000

/**
 * Quanto o provider pediu para esperar antes de tentar de novo (429/503), em ms — null quando não disse. Fontes, nesta ordem:
 * cabeçalho `retry-after-ms` (OpenAI), `Retry-After` (segundos ou data HTTP) e o `RetryInfo.retryDelay` ("31s") que o Google
 * manda no CORPO do 429. Só a dica de tempo é lida do corpo — nada dele sai daqui.
 */
export function retryAfterMsFrom(headers: Pick<Headers, "get"> | null | undefined, body = "", now = Date.now()): number | null {
  const valid = (ms: number) => (Number.isFinite(ms) && ms >= 0 ? Math.min(Math.round(ms), MAX_RETRY_HINT_MS) : null)
  const millis = headers?.get("retry-after-ms")
  if (millis && /^\d+(\.\d+)?$/.test(millis.trim())) return valid(Number(millis.trim()))
  const header = headers?.get("retry-after")?.trim()
  if (header) {
    if (/^\d+(\.\d+)?$/.test(header)) return valid(Number(header) * 1000)
    const at = Date.parse(header)
    if (!Number.isNaN(at)) return valid(Math.max(0, at - now))
  }
  const delay = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body)
  return delay ? valid(Number(delay[1]) * 1000) : null
}

function statusCodeFor(category: AiErrorCategory): number {
  switch (category) {
    case "TIMEOUT":
    case "NETWORK":
      return 504
    case "BUDGET_EXCEEDED":
      return 402
    case "ROUTE_UNAVAILABLE":
      return 503
    case "RATE_LIMIT":
      return 429
    default:
      return 502
  }
}

/** Budget (§51): erro claro, nunca bloqueio silencioso. */
export class AiBudgetExceededError extends DomainError {
  constructor(message: string, details: { budgetId: string; scope: string; scopeKey: string | null; currency: string; limit: string; spent: string }) {
    super(message, "AI_BUDGET_EXCEEDED", 402, details)
    this.name = "AiBudgetExceededError"
  }
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, // OpenAI/compatíveis
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic
  /\bxai-[A-Za-z0-9_-]{8,}/g, // xAI
  /\bAIza[0-9A-Za-z_-]{20,}/g, // Google
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi,
]

/**
 * Remove segredos de um texto antes de logar (§10). Recebe os segredos conhecidos da conexão em uso
 * (removidos literalmente) e aplica padrões de chaves conhecidas como rede de segurança.
 */
export function redactSecrets(text: string, knownSecrets: readonly (string | null | undefined)[] = []): string {
  let result = text
  for (const secret of knownSecrets) {
    if (secret && secret.length >= 4) result = result.split(secret).join("[REDACTED]")
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, prefix?: string) => (typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]"))
  }
  return result
}
