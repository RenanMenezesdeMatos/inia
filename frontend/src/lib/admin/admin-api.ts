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

export async function adminGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store", ...(signal ? { signal } : {}) })
  if (!response.ok) throw await parseError(response)
  const payload = (await response.json()) as { data: T }
  return payload.data
}

/** Como `adminGet`, mas devolve também o `meta` da resposta (ex.: lista cortada no limite do servidor). */
export async function adminGetWithMeta<T>(path: string): Promise<{ data: T; meta: unknown }> {
  const response = await fetch(`${API_URL}${path}`, { credentials: "include", cache: "no-store" })
  if (!response.ok) throw await parseError(response)
  const payload = (await response.json()) as { data: T; meta?: unknown }
  return { data: payload.data, meta: payload.meta ?? null }
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

/** Bytes do arquivo já enviados ao servidor (do `upload.onprogress` do navegador). `total` nulo = o navegador não informou o tamanho. */
export type UploadTransfer = { loaded: number; total: number | null }

/**
 * Como `adminUpload`, com o andamento real do ENVIO dos bytes (o `fetch` não informa o envio). Usa XMLHttpRequest com o cookie de sessão, como as
 * demais chamadas. O andamento vem do navegador; quando ele chega ao fim, o arquivo está no servidor e a resposta ainda espera o processamento.
 */
export function adminUploadWithProgress<T>(path: string, formData: FormData, options: { method?: "POST" | "PATCH"; onProgress?: (transfer: UploadTransfer) => void } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(options.method ?? "POST", `${API_URL}${path}`)
    xhr.withCredentials = true
    xhr.responseType = "text"
    xhr.upload.onprogress = (event) => options.onProgress?.({ loaded: event.loaded, total: event.lengthComputable ? event.total : null })
    xhr.onerror = () => reject(new AdminApiError("A conexão com o servidor caiu durante o envio do arquivo. Confira a rede e envie de novo.", "UPLOAD_NETWORK_ERROR"))
    xhr.onabort = () => reject(new AdminApiError("O envio do arquivo foi cancelado.", "UPLOAD_ABORTED"))
    xhr.onload = () => {
      const response = new Response(xhr.responseText, { status: xhr.status, headers: { "content-type": xhr.getResponseHeader("content-type") ?? "application/json" } })
      if (xhr.status < 200 || xhr.status >= 300) {
        void parseError(response).then(reject)
        return
      }
      void response
        .json()
        .then((payload: { data: T }) => resolve(payload.data))
        .catch(() => reject(new AdminApiError(`Resposta inválida do servidor (${xhr.status}).`)))
    }
    xhr.send(formData)
  })
}
