const API_URL = process.env.INIA_API_URL ?? process.env.NEXT_PUBLIC_INIA_API_URL ?? "http://localhost:3333"

/** Erro da API administrativa com o código de domínio e os detalhes do backend — a UI pode
 * reagir a um código específico (ex.: STRUCTURED_OUTPUT_IN_USE_DRAFT pede confirmação) sem
 * inspecionar texto. `code`/`details` são opcionais: chamadas antigas continuam usando só a mensagem. */
export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
    readonly details: unknown = undefined,
  ) {
    super(message)
    this.name = "AdminApiError"
  }
}

async function parseError(response: Response): Promise<AdminApiError> {
  try {
    const payload = (await response.json()) as { error?: { message?: string; code?: string; details?: unknown } }
    return new AdminApiError(payload?.error?.message ?? `Erro ${response.status}`, payload?.error?.code ?? null, payload?.error?.details)
  } catch {
    return new AdminApiError(`Erro ${response.status}`)
  }
}

export async function adminGet<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store" })
  if (!response.ok) throw await parseError(response)
  const payload = (await response.json()) as { data: T }
  return payload.data
}

// Nome do arquivo vindo do Content-Disposition: prefere o `filename*` (UTF-8, com acentos) e
// cai para o `filename` simples.
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1])
    } catch {
      // cai para o filename simples abaixo
    }
  }
  const plain = /filename="([^"]+)"/i.exec(header)
  return plain?.[1] ?? null
}

export async function adminGetBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store" })
  if (!response.ok) throw await parseError(response)
  return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get("content-disposition")) }
}

/** POST que devolve arquivo (filtros no corpo, sem ir para a URL). Erro antes de o arquivo começar chega como `AdminApiError`. */
export async function adminPostForBlob(path: string, body: unknown): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(`${API_URL}${path}`, { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  if (!response.ok) throw await parseError(response)
  return { blob: await response.blob(), filename: filenameFromDisposition(response.headers.get("content-disposition")) }
}

export async function adminSend<T>(path: string, method: "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) throw await parseError(response)
  if (response.status === 204) return undefined as T
  const payload = (await response.json()) as { data: T }
  return payload.data
}

export async function adminUpload<T>(path: string, formData: FormData, method: "POST" | "PATCH" = "POST"): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { method, credentials: "include", body: formData })
  if (!response.ok) throw await parseError(response)
  const payload = (await response.json()) as { data: T }
  return payload.data
}
