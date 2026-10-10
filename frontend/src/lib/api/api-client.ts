const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/** Erro de API com o código de domínio do backend (ex.: STRUCTURE_ACCESS_DENIED) — permite que a
 * UI distinga "sem acesso" de "falha de rede" sem inspecionar texto. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
    /** `error.details` do backend quando existir (ex.: violações de uma edição, estado atual num 409). */
    readonly details: unknown = undefined,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const payload = (await response.json()) as { error?: { message?: string; code?: string; details?: unknown } }
    return new ApiError(payload?.error?.message ?? `Erro ${response.status}`, response.status, payload?.error?.code ?? null, payload?.error?.details)
  } catch {
    return new ApiError(`Erro ${response.status}`, response.status, null)
  }
}

/** GET autenticado por cookie de sessão (client-side). Devolve o `data` do envelope da API. */
export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store" })
  if (!response.ok) throw await parseError(response)
  const payload = (await response.json()) as { data: T }
  return payload.data
}

/** POST autenticado por cookie (client-side). Respostas 204 devolvem `undefined`. */
export async function apiPost<T = undefined>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const payload = (await response.json()) as { data: T }
  return payload.data
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
