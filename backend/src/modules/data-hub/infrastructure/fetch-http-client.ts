import { outboundPolicy } from "../../../config/outbound-policy.js"
import { assertOutboundDestination, OutboundDestinationDenied, urlPort, type OutboundPolicy } from "../../../shared/infrastructure/outbound-destination-policy.js"
import type { HttpClient, HttpRequest, HttpResponse } from "../application/ports.js"
import { DataRunError } from "../domain/error-codes.js"

/** Teto de uma resposta (uma página da API do cliente): acima disso a carga para em vez de esgotar a memória do processo. */
export const MAX_HTTP_RESPONSE_BYTES = 50 * 1024 * 1024

/**
 * HttpClient com `fetch` nativo do Node, timeout via AbortController. Nunca loga headers (podem carregar credencial).
 * Antes de conectar, o destino passa pela política de saída do servidor (SSRF — outbound-destination-policy.ts); redirecionamento
 * nunca é seguido (um 30x não leva a credencial para outro host).
 */
export class FetchHttpClient implements HttpClient {
  constructor(private readonly policy: OutboundPolicy = outboundPolicy, private readonly maxResponseBytes = MAX_HTTP_RESPONSE_BYTES) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    let target: URL
    try {
      target = new URL(request.url)
    } catch {
      throw new DataRunError("DATA_SOURCE_UNREACHABLE", "Endereço da fonte inválido.")
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new DataRunError("DATA_SOURCE_DESTINATION_DENIED", "Use http:// ou https:// no endereço da fonte.")
    if (target.username || target.password) throw new DataRunError("DATA_SOURCE_DESTINATION_DENIED", "Não inclua usuário/senha na URL — use o campo de credencial.")
    try {
      await assertOutboundDestination(this.policy, target.hostname, urlPort(target))
    } catch (error) {
      if (error instanceof OutboundDestinationDenied) throw new DataRunError("DATA_SOURCE_DESTINATION_DENIED", error.message)
      throw error
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), request.timeoutMs)
    try {
      const init: RequestInit = { method: request.method, headers: request.headers, signal: controller.signal, redirect: "manual" }
      if (request.body !== undefined) init.body = request.body
      const response = await fetch(target, init)
      const headers: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })
      if (request.statusOnly) {
        await response.body?.cancel().catch(() => undefined)
        return { status: response.status, headers, body: "" }
      }
      return { status: response.status, headers, body: await readCapped(response, this.maxResponseBytes, controller) }
    } catch (error) {
      if (error instanceof DataRunError) throw error
      if (error instanceof Error && error.name === "AbortError") throw new DataRunError("DATA_SOURCE_TIMEOUT", `A fonte não respondeu em ${request.timeoutMs} ms.`)
      throw new DataRunError("DATA_SOURCE_UNREACHABLE", `Não foi possível conectar à fonte (${error instanceof Error ? error.message : "erro de rede"}).`)
    } finally {
      clearTimeout(timer)
    }
  }
}

async function readCapped(response: Response, maxBytes: number, controller: AbortController): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? "")
  if (Number.isFinite(declared) && declared > maxBytes) {
    controller.abort()
    throw new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `A resposta da fonte passa de ${Math.round(maxBytes / 1024 / 1024)} MB por requisição — use paginação menor.`)
  }
  if (!response.body) return ""
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      controller.abort()
      throw new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `A resposta da fonte passa de ${Math.round(maxBytes / 1024 / 1024)} MB por requisição — use paginação menor.`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString("utf8")
}
