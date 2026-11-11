import { signalUserActivity } from "@/lib/auth/idle-session"
import { CLIENT_ERROR_CODES, newReference } from "@/lib/errors/client-error-codes"

const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/** Onde a referência de uma falha pode ser procurada: no servidor (API registrou), só no proxy (IIS) ou só neste navegador. */
export type ReferenceScope = "server" | "proxy" | "local"

/** Erro de API com o código de domínio do backend (ex.: STRUCTURE_ACCESS_DENIED) — permite que a
 * UI distinga "sem acesso" de "falha de rede" sem inspecionar texto. */
export class ApiError extends Error {
  /** Referência da ocorrência (o `x-request-id` desta chamada) — o que a pessoa copia para o suporte. */
  readonly reference: string | null
  readonly referenceScope: ReferenceScope
  /** Versão da API que respondeu (`x-inia-release`), quando houve resposta. */
  readonly release: string | null

  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** `error.details` do backend quando existir (ex.: violações de uma edição, estado atual num 409). */
    readonly details: unknown = undefined,
    trace: { reference?: string | null; referenceScope?: ReferenceScope; release?: string | null } = {},
  ) {
    super(message)
    this.name = "ApiError"
    this.reference = trace.reference ?? null
    this.referenceScope = trace.referenceScope ?? "server"
    this.release = trace.release ?? null
  }
}

/** Status que um proxy (IIS/ARR) devolve com página própria quando não alcança a API. */
const PROXY_STATUSES = new Set([502, 503, 504])

function header(response: Response, name: string): string | null {
  return typeof response.headers?.get === "function" ? response.headers.get(name) : null
}

async function readPayload(response: Response): Promise<{ error?: { message?: string; code?: string; details?: unknown; reference?: string } } | null> {
  try {
    if (typeof response.text === "function") {
      const text = await response.text()
      return text ? (JSON.parse(text) as { error?: { message?: string; code?: string; details?: unknown; reference?: string } }) : null
    }
    return (await response.json()) as { error?: { message?: string; code?: string; details?: unknown; reference?: string } }
  } catch {
    return null
  }
}

async function parseError(response: Response, sentReference: string): Promise<ApiError> {
  const reference = header(response, "x-request-id") ?? sentReference
  const release = header(response, "x-inia-release")
  const payload = await readPayload(response)
  if (payload && typeof payload === "object" && payload.error && typeof payload.error === "object") {
    return new ApiError(payload.error.message ?? `Erro ${response.status}`, response.status, payload.error.code ?? null, payload.error.details, { reference: payload.error.reference ?? reference, referenceScope: "server", release })
  }
  // Sem o JSON da INIA: a resposta veio de outra peça do caminho. Sem `x-inia-release`, nunca passou pela API — a referência
  // (o x-request-id enviado) só está no log do proxy.
  if (PROXY_STATUSES.has(response.status) && !release) {
    return new ApiError("A INIA está temporariamente indisponível.", response.status, CLIENT_ERROR_CODES.proxyUnavailable, undefined, { reference, referenceScope: "proxy" })
  }
  return new ApiError(`Erro ${response.status}`, response.status, null, undefined, { reference, referenceScope: release ? "server" : "proxy", release })
}

/**
 * Toda chamada leva um `x-request-id` gerado aqui: a API o adota (é o mesmo id do log e da ocorrência) e o IIS o grava no log
 * dele. Se a chamada nem receber resposta, essa é a referência que a tela mostra — local se o navegador estiver offline.
 */
async function send(path: string, init: RequestInit): Promise<{ response: Response; reference: string }> {
  const reference = newReference()
  const headers = new Headers(init.headers)
  headers.set("x-request-id", reference)
  try {
    const response = await fetch(`${API_URL}${path}`, { ...init, headers, credentials: "include", cache: "no-store" })
    return { response, reference }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error
    const offline = typeof navigator !== "undefined" && navigator.onLine === false
    throw new ApiError(
      offline ? "Sem conexão com a internet." : "Não foi possível falar com a INIA.",
      0,
      offline ? CLIENT_ERROR_CODES.offline : CLIENT_ERROR_CODES.apiUnreachable,
      undefined,
      { reference, referenceScope: offline ? "local" : "proxy" },
    )
  }
}

/** Corpo de sucesso que não é o JSON da INIA (portal de rede, proxy corporativo, resposta cortada): falha com código próprio. */
async function readData<T>(response: Response, reference: string): Promise<T> {
  try {
    const payload = (await response.json()) as { data: T }
    return payload.data
  } catch {
    throw new ApiError("Resposta inesperada da INIA.", response.status, CLIENT_ERROR_CODES.invalidResponse, undefined, { reference, referenceScope: header(response, "x-inia-release") ? "server" : "proxy" })
  }
}

/** GET autenticado por cookie de sessão (client-side). Devolve o `data` do envelope da API. */
export async function apiGet<T>(path: string): Promise<T> {
  const { response, reference } = await send(path, {})
  if (!response.ok) throw await parseError(response, reference)
  return readData<T>(response, reference)
}

/** POST autenticado por cookie (client-side). Respostas 204 devolvem `undefined`. */
export async function apiPost<T = undefined>(path: string, body?: unknown): Promise<T> {
  const { response, reference } = await send(path, {
    method: "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await parseError(response, reference)
  // Ação que altera algo = a pessoa está usando a INIA (o servidor também conta; aqui é para o aviso de inatividade da tela).
  signalUserActivity()
  if (response.status === 204) return undefined as T
  return readData<T>(response, reference)
}

/** PUT/PATCH autenticado por cookie (client-side) — mesmo envelope do `apiPost`. */
export async function apiSend<T = undefined>(path: string, method: "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  const { response, reference } = await send(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await parseError(response, reference)
  // Ação que altera algo = a pessoa está usando a INIA (o servidor também conta; aqui é para o aviso de inatividade da tela).
  signalUserActivity()
  if (response.status === 204) return undefined as T
  return readData<T>(response, reference)
}

/** Serializa parâmetros de query ignorando vazios/undefined — evita `?x=undefined` na URL. */
export function toQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    search.set(key, String(value))
  }
  const serialized = search.toString()
  return serialized ? `?${serialized}` : ""
}

export { API_URL as API_BASE_URL }
