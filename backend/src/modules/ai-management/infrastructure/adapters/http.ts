import { AiProviderError, categorizeFetchError, categorizeHttpStatus, redactSecrets, retryAfterMsFrom, type AiErrorCategory } from "../../../../shared/application/model-routing/ai-errors.js"
import { outboundPolicy } from "../../../../config/outbound-policy.js"
import { assertOutboundDestination, normalizeHost, OutboundDestinationDenied, unmapIpv4, urlPort } from "../../../../shared/infrastructure/outbound-destination-policy.js"
import type { ConnectionTestResult, ConnectionTestStatus, FetchLike, ResolvedConnection } from "../../application/provider-adapter-port.js"

/**
 * HTTP comum dos adapters: timeout, categorização de erro, log interno REDIGIDO (§10, §93) e
 * proteção mínima de endpoint. O corpo cru do provider nunca sai daqui — nem na exceção.
 */
const BLOCKED_HOSTS = new Set(["metadata.google.internal", "metadata", "169.254.169.254", "[fd00:ec2::254]"])

/** Endpoint aceitável para o backend chamar: http(s), sem credencial embutida, sem serviço de metadados de nuvem. */
export function endpointProblem(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return "URL inválida."
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "Use http:// ou https://."
  if (url.username || url.password) return "Não inclua usuário/senha na URL — use o campo de credencial."
  // Forma canônica: sem ponto final (`metadata.google.internal.`), sem colchetes, IPv4 mapeado em IPv6 desembrulhado.
  const host = unmapIpv4(normalizeHost(url.hostname))
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOSTS.has(`[${host}]`) || host.startsWith("169.254.") || host.startsWith("metadata.")) return "Endereço de metadados de nuvem não é permitido."
  return null
}

/**
 * `fetch` de PRODUÇÃO dos adapters: o destino passa pela política de saída do servidor (o nome é resolvido e TODOS os
 * endereços conferidos — `169.254.169.254.nip.io` não passa) e redirecionamento nunca é seguido (a chave do provedor não
 * vai para outro host num 30x). Ollama/modelo local em produção = liberar o endereço em INIA_OUTBOUND_ALLOWED_DESTINATIONS.
 */
export const guardedFetch: FetchLike = async (input, init) => {
  const url = new URL(input)
  await assertOutboundDestination(outboundPolicy, url.hostname, urlPort(url))
  return fetch(url, { ...init, redirect: "manual" })
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`
}

function logProviderFailure(connection: ResolvedConnection, category: AiErrorCategory, status: number | null, body: string): void {
  // Log INTERNO seguro: categoria + status + trecho do corpo, com a credencial da conexão e padrões conhecidos redigidos.
  console.warn(JSON.stringify({ event: "ai_provider_error", connectionId: connection.id, providerKey: connection.providerKey, category, status, body: redactSecrets(body.slice(0, 500), [connection.apiKey, ...Object.values(connection.headers)]) }))
}

export async function requestJson<T>(fetchImpl: FetchLike, connection: ResolvedConnection, url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await rawRequest(fetchImpl, connection, url, init, timeoutMs)
  try {
    return (await response.json()) as T
  } catch {
    throw new AiProviderError("PROVIDER_ERROR", { message: "O provedor de IA devolveu uma resposta ilegível." })
  }
}

export async function rawRequest(fetchImpl: FetchLike, connection: ResolvedConnection, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const problem = endpointProblem(url)
  if (problem) throw new AiProviderError("INVALID_REQUEST", { message: `Endpoint inválido: ${problem}` })
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    if (error instanceof OutboundDestinationDenied) throw new AiProviderError("INVALID_REQUEST", { message: `Endpoint inválido: ${error.reason}.` })
    const category = categorizeFetchError(error)
    logProviderFailure(connection, category, null, error instanceof Error ? `${error.name}: ${error.message}` : "fetch failed")
    throw new AiProviderError(category)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    const category = categorizeHttpStatus(response.status, body)
    logProviderFailure(connection, category, response.status, body)
    // A dica de espera (Retry-After / RetryInfo) vai para o limitador de chamadas — o corpo continua só no log redigido.
    const retryAfterMs = response.status === 429 || response.status === 503 ? retryAfterMsFrom(response.headers, body) : null
    throw new AiProviderError(category, { httpStatus: response.status, retryAfterMs })
  }
  return response
}

const TEST_STATUS_BY_CATEGORY: Record<AiErrorCategory, ConnectionTestStatus> = {
  AUTH: "AUTH_ERROR",
  RATE_LIMIT: "RATE_LIMITED",
  TIMEOUT: "NETWORK_ERROR",
  NETWORK: "NETWORK_ERROR",
  INVALID_REQUEST: "INVALID_ENDPOINT",
  MODEL_UNAVAILABLE: "INVALID_ENDPOINT",
  CONTEXT_LIMIT: "UNKNOWN_ERROR",
  PROVIDER_ERROR: "UNKNOWN_ERROR",
  BUDGET_EXCEEDED: "UNKNOWN_ERROR",
  ROUTE_UNAVAILABLE: "UNKNOWN_ERROR",
  UNKNOWN: "UNKNOWN_ERROR",
}

const TEST_MESSAGES: Record<ConnectionTestStatus, string> = {
  CONNECTED: "Conexão estabelecida.",
  AUTH_ERROR: "Credencial recusada pelo provedor.",
  NETWORK_ERROR: "O endpoint não respondeu (rede, DNS, firewall ou tempo esgotado). Lembre: o endpoint precisa ser alcançável pelo SERVIDOR da INIA.",
  RATE_LIMITED: "O provedor limitou as requisições (rate limit). Tente novamente em instantes.",
  INVALID_ENDPOINT: "O endpoint não parece ser deste provedor (rota não encontrada ou URL inválida).",
  UNSUPPORTED: "Este provedor não oferece verificação automática de conexão.",
  UNKNOWN_ERROR: "O provedor retornou um erro inesperado.",
}

/** Teste de conexão por uma chamada SEM custo (listar modelos) — nunca gera texto. */
export async function testByListing(listing: () => Promise<number>): Promise<ConnectionTestResult> {
  const startedAt = Date.now()
  try {
    const modelCount = await listing()
    return { status: "CONNECTED", latencyMs: Date.now() - startedAt, message: TEST_MESSAGES.CONNECTED, modelCount }
  } catch (error) {
    const category: AiErrorCategory = error instanceof AiProviderError ? error.category : "UNKNOWN"
    const status = TEST_STATUS_BY_CATEGORY[category]
    const detail = error instanceof AiProviderError && error.message.startsWith("Endpoint inválido") ? ` ${error.message}` : ""
    return { status, latencyMs: status === "NETWORK_ERROR" ? null : Date.now() - startedAt, message: `${TEST_MESSAGES[status]}${detail}`, modelCount: null }
  }
}

export function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Lê um corpo SSE (`data: {...}` por linha) e entrega cada payload JSON. */
export async function readSse(response: Response, onPayload: (payload: Record<string, unknown>) => void): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith("data:")) continue
        const data = trimmed.slice(5).trim()
        if (!data || data === "[DONE]") continue
        onPayload(safeJsonParse(data))
      }
    }
  } finally {
    reader.releaseLock()
  }
}
