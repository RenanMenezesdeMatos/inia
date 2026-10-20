import type { z } from "zod"
import { DataRunError } from "../../domain/error-codes.js"
import { extractPath, type SourceRecord } from "../../domain/mapping.js"
import { columnsFromRecords } from "../../domain/schema-fingerprint.js"
import { apiPullFeedConfigSchema, type ApiPullConfig, type SourceConfig } from "../../domain/source-config.js"
import type { DataHubContext } from "../data-hub-context.js"
import type { HttpResponse } from "../ports.js"
import type { DataFeedRow, DataSourceRow } from "../records.js"
import type { FetchedBatch } from "./file-connector.js"

/** Soma das respostas de uma carga da API Pull (as páginas ficam todas na memória até o mapeamento) — o mesmo teto do arquivo SFTP. */
export const MAX_API_PULL_RUN_BYTES = 200 * 1024 * 1024

/**
 * Conector API Pull: a INIA consulta a API do cliente. Autenticação (Bearer, API Key, Basic,
 * OAuth2 client credentials), headers, query params, timeout, paginação (página/offset/cursor),
 * extração por dot path e checkpoint por watermark. O segredo sai do SecretStore direto para o
 * header — nunca passa por log, trace ou resposta.
 */
type ApiFeedConfig = z.infer<typeof apiPullFeedConfigSchema>

function apiConfigOf(source: DataSourceRow): ApiPullConfig {
  const config = source.config as SourceConfig
  if (config.kind !== "API_PULL") throw new DataRunError("DATA_INTERNAL_ERROR", "A fonte não é API Pull.")
  return config.api
}

async function resolveAuthHeaders(ctx: DataHubContext, source: DataSourceRow, api: ApiPullConfig): Promise<Record<string, string>> {
  const auth = api.auth
  if (auth.kind === "NONE") return {}
  const secret = await ctx.secrets.get({ sourceId: source.id, purpose: "API_AUTH" })
  if (!secret) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", "Credencial da fonte não configurada (ou revogada). Rotacione a credencial.")
  switch (auth.kind) {
    case "BEARER":
      return { authorization: `Bearer ${secret}` }
    case "API_KEY":
      return { [auth.headerName]: secret }
    case "BASIC":
      return { authorization: `Basic ${Buffer.from(`${auth.username}:${secret}`).toString("base64")}` }
    case "OAUTH2_CLIENT_CREDENTIALS": {
      const body = new URLSearchParams({ grant_type: "client_credentials", client_id: auth.clientId, client_secret: secret })
      if (auth.scope) body.set("scope", auth.scope)
      const response = await ctx.http.send({ url: auth.tokenUrl, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString(), timeoutMs: api.timeoutMs })
      if (response.status === 401 || response.status === 403 || response.status === 400) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", `O servidor OAuth2 recusou as credenciais (HTTP ${response.status}).`)
      if (response.status >= 400) throw new DataRunError("DATA_SOURCE_UNREACHABLE", `Servidor OAuth2 respondeu HTTP ${response.status}.`)
      let token: string | undefined
      try {
        token = (JSON.parse(response.body) as { access_token?: string }).access_token
      } catch {
        token = undefined
      }
      if (!token) throw new DataRunError("DATA_SOURCE_RESPONSE_INVALID", "Resposta OAuth2 sem access_token.")
      return { authorization: `Bearer ${token}` }
    }
  }
}

/**
 * URL de uma página do feed. O endpoint é relativo à `baseUrl` da FONTE; uma URL absoluta só é aceita na MESMA origem
 * (achado I-F2): antes, `https://outro-host/...` substituía a base e o cabeçalho de autenticação ia junto para lá.
 */
export function buildUrl(baseUrl: string, endpoint: string, params: Record<string, string>): string {
  const base = new URL(baseUrl)
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(endpoint) ? endpoint : `${baseUrl.replace(/\/$/, "")}/${endpoint.replace(/^\/+/, "")}`)
  if (url.origin !== base.origin) throw new DataRunError("DATA_SOURCE_DESTINATION_DENIED", `O endpoint do feed precisa ficar no mesmo servidor da fonte (${base.origin}).`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

function assertOk(response: HttpResponse): void {
  if (response.status === 401 || response.status === 403) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", `A fonte recusou a credencial (HTTP ${response.status}).`)
  if (response.status === 429 || response.status >= 500) throw new DataRunError("DATA_SOURCE_UNREACHABLE", `A fonte respondeu HTTP ${response.status}.`)
  if (response.status >= 400) throw new DataRunError("DATA_SOURCE_RESPONSE_INVALID", `A fonte respondeu HTTP ${response.status}.`)
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body)
  } catch {
    throw new DataRunError("DATA_SOURCE_RESPONSE_INVALID", "A resposta da fonte não é JSON válido.")
  }
}

export function extractRecords(payload: unknown, path: string): SourceRecord[] {
  const root = path ? extractPath({ $: payload } as SourceRecord, `$.${path}`) : payload
  if (root === undefined || root === null) return []
  if (!Array.isArray(root)) throw new DataRunError("DATA_SOURCE_RESPONSE_INVALID", `O caminho "${path || "(raiz)"}" não aponta para uma lista de registros.`)
  return root.map((item) => (item && typeof item === "object" && !Array.isArray(item) ? (item as SourceRecord) : { value: item }))
}

export async function testApiConnection(ctx: DataHubContext, source: DataSourceRow): Promise<{ ok: true; detail: string }> {
  const api = apiConfigOf(source)
  const headers = { accept: "application/json", ...api.headers, ...(await resolveAuthHeaders(ctx, source, api)) }
  const response = await ctx.http.send({ url: api.baseUrl, method: "GET", headers, timeoutMs: api.timeoutMs })
  if (response.status === 401 || response.status === 403) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", `A fonte recusou a credencial (HTTP ${response.status}).`)
  if (response.status >= 500) throw new DataRunError("DATA_SOURCE_UNREACHABLE", `A fonte respondeu HTTP ${response.status}.`)
  return { ok: true, detail: `HTTP ${response.status} em ${api.baseUrl}` }
}

/** Busca todos os registros (paginando) ou uma amostra (`limit`). Checkpoint só é DEVOLVIDO — quem avança é o Run, após aplicar. */
export async function fetchApiRecords(ctx: DataHubContext, source: DataSourceRow, feed: DataFeedRow, options: { checkpoint: Record<string, unknown> | null; limit?: number; maxRunBytes?: number }): Promise<FetchedBatch> {
  const maxRunBytes = options.maxRunBytes ?? MAX_API_PULL_RUN_BYTES
  const api = apiConfigOf(source)
  const connector = feed.connectorConfig
  if (connector.connector !== "API_PULL") throw new DataRunError("DATA_INTERNAL_ERROR", "O feed não é API Pull.")
  const config: ApiFeedConfig = apiPullFeedConfigSchema.parse(connector.api)
  const headers = { accept: "application/json", ...api.headers, ...config.headers, ...(await resolveAuthHeaders(ctx, source, api)) }

  const baseParams: Record<string, string> = { ...config.queryParams }
  const watermarkBefore = config.checkpoint.kind === "WATERMARK" && options.checkpoint && typeof options.checkpoint.watermark === "string" ? options.checkpoint.watermark : null
  if (config.checkpoint.kind === "WATERMARK" && watermarkBefore) baseParams[config.checkpoint.requestParam] = watermarkBefore

  const records: SourceRecord[] = []
  let bytes = 0
  let pages = 0
  let cursor: string | null = null
  let page = config.pagination.kind === "PAGE_NUMBER" ? config.pagination.startPage : 0
  let offset = 0
  let watermark = watermarkBefore

  while (pages < config.maxPages) {
    const params = { ...baseParams }
    const pagination = config.pagination
    if (pagination.kind === "PAGE_NUMBER") {
      params[pagination.pageParam] = String(page)
      if (pagination.sizeParam) params[pagination.sizeParam] = String(pagination.pageSize)
    } else if (pagination.kind === "OFFSET") {
      params[pagination.offsetParam] = String(offset)
      params[pagination.limitParam] = String(pagination.limit)
    } else if (pagination.kind === "CURSOR" && cursor) {
      params[pagination.cursorParam] = cursor
    }
    const url = buildUrl(api.baseUrl, config.endpoint, params)
    const response = await ctx.http.send({ url, method: config.method, headers, timeoutMs: api.timeoutMs })
    assertOk(response)
    bytes += Buffer.byteLength(response.body)
    // Teto da CARGA inteira, não só da página (achado DATA-10): uma paginação que nunca esvazia acumulava gigabytes na memória.
    if (bytes > maxRunBytes) throw new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `A carga passou de ${Math.round(maxRunBytes / 1024 / 1024)} MB somando as páginas (${pages + 1} página(s)). Divida a carga (filtro de período no endpoint ou marca d'água) ou confira se a paginação termina.`)
    const payload = parseJson(response.body)
    const pageRecords = extractRecords(payload, config.extractPath)
    pages += 1
    for (const record of pageRecords) {
      records.push(record)
      if (config.checkpoint.kind === "WATERMARK") {
        const value = extractPath(record, config.checkpoint.sourceField)
        if (typeof value === "string" || typeof value === "number") {
          const text = String(value)
          if (watermark === null || text > watermark) watermark = text
        }
      }
      if (options.limit !== undefined && records.length >= options.limit) break
    }
    if (options.limit !== undefined && records.length >= options.limit) break
    if (pagination.kind === "NONE") break
    if (pageRecords.length === 0) break
    if (pagination.kind === "PAGE_NUMBER") {
      if (pageRecords.length < pagination.pageSize) break
      page += 1
    } else if (pagination.kind === "OFFSET") {
      if (pageRecords.length < pagination.limit) break
      offset += pageRecords.length
    } else if (pagination.kind === "CURSOR") {
      const next = extractPath({ $: payload } as SourceRecord, `$.${pagination.nextCursorPath}`)
      if (typeof next !== "string" || next.length === 0) break
      cursor = next
    }
  }

  const checkpointAfter = config.checkpoint.kind === "WATERMARK" ? { watermark, updatedAt: ctx.clock.now().toISOString() } : null
  const selected = options.limit === undefined ? records : records.slice(0, options.limit)
  return { columns: columnsFromRecords(selected), records: selected, bytes, totalRecords: records.length, detail: `${pages} página(s), ${records.length} registro(s)${watermarkBefore ? `, a partir de ${watermarkBefore}` : ""}`, checkpointAfter }
}
