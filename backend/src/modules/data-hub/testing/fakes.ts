import type { DataHubLogger } from "../application/data-hub-context.js"
import type { HttpClient, HttpRequest, HttpResponse, SecretStore, SftpClient, SftpConnection, SftpFileEntry } from "../application/ports.js"
import { DataRunError } from "../domain/error-codes.js"
import type { SecretPurpose } from "../domain/source-config.js"

/** Fakes dos ports — os testes nunca dependem de internet, servidor SFTP ou vault. */

export type MockRoute = (request: HttpRequest, url: URL) => HttpResponse | Promise<HttpResponse>

export class MockHttpClient implements HttpClient {
  readonly requests: HttpRequest[] = []
  private readonly routes: { match: (url: URL, request: HttpRequest) => boolean; handler: MockRoute }[] = []

  on(pathPrefix: string, handler: MockRoute, method: "GET" | "POST" = "GET"): this {
    this.routes.push({ match: (url, request) => url.pathname.startsWith(pathPrefix) && request.method === method, handler })
    return this
  }

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request)
    const url = new URL(request.url)
    const route = this.routes.find((candidate) => candidate.match(url, request))
    if (!route) return { status: 404, headers: {}, body: JSON.stringify({ error: "not found" }) }
    return route.handler(request, url)
  }
}

export function json(status: number, body: unknown): HttpResponse {
  return { status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}

export class FakeSftpClient implements SftpClient {
  readonly files = new Map<string, { content: Uint8Array; modifiedAt: string }>()
  authFailure = false
  hostKeyMismatch = false
  readonly downloads: string[] = []

  put(path: string, content: string | Uint8Array, modifiedAt = "2026-09-15T10:00:00.000Z"): this {
    this.files.set(path, { content: typeof content === "string" ? new TextEncoder().encode(content) : content, modifiedAt })
    return this
  }

  private guard(connection: SftpConnection): void {
    if (this.authFailure || (!connection.password && !connection.privateKey)) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", "Usuário, senha ou chave privada recusados pelo servidor SFTP.")
    if (this.hostKeyMismatch) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", "A host key do servidor não confere com a fingerprint configurada.")
  }

  async list(connection: SftpConnection, directory: string): Promise<SftpFileEntry[]> {
    this.guard(connection)
    const prefix = directory.replace(/\/$/, "")
    return [...this.files.entries()]
      .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes("/"))
      .map(([path, file]) => ({ name: path.slice(prefix.length + 1), path, size: file.content.byteLength, modifiedAt: file.modifiedAt }))
  }

  async download(connection: SftpConnection, path: string): Promise<Uint8Array> {
    this.guard(connection)
    const file = this.files.get(path)
    if (!file) throw new DataRunError("DATA_SOURCE_UNREACHABLE", `Arquivo ${path} não existe.`)
    this.downloads.push(path)
    return file.content
  }
}

export class InMemorySecretStore implements SecretStore {
  readonly values = new Map<string, { value: string; createdAt: string; rotatedAt: string | null }>()

  private key(sourceId: string, purpose: SecretPurpose) {
    return `${sourceId}:${purpose}`
  }

  async put(input: { organizationId: string; sourceId: string; purpose: SecretPurpose; value: string; actorId: string | null }): Promise<void> {
    const existing = this.values.get(this.key(input.sourceId, input.purpose))
    this.values.set(this.key(input.sourceId, input.purpose), { value: input.value, createdAt: existing?.createdAt ?? new Date().toISOString(), rotatedAt: existing ? new Date().toISOString() : null })
  }

  async get(input: { sourceId: string; purpose: SecretPurpose }): Promise<string | null> {
    return this.values.get(this.key(input.sourceId, input.purpose))?.value ?? null
  }

  async revoke(input: { sourceId: string; purpose: SecretPurpose }): Promise<void> {
    this.values.delete(this.key(input.sourceId, input.purpose))
  }

  async describe(sourceId: string): Promise<{ purpose: SecretPurpose; createdAt: string; rotatedAt: string | null }[]> {
    return [...this.values.entries()].filter(([key]) => key.startsWith(`${sourceId}:`)).map(([key, entry]) => ({ purpose: key.split(":")[1] as SecretPurpose, createdAt: entry.createdAt, rotatedAt: entry.rotatedAt }))
  }
}

/** Logger que captura tudo — usado para provar que nenhum segredo aparece em log. */
export class CapturingLogger implements DataHubLogger {
  readonly entries: { level: string; payload: string }[] = []
  private capture(level: string, ...args: unknown[]) {
    this.entries.push({ level, payload: args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ") })
  }
  info = (...args: unknown[]) => this.capture("info", ...args)
  warn = (...args: unknown[]) => this.capture("warn", ...args)
  error = (...args: unknown[]) => this.capture("error", ...args)
  debug = (...args: unknown[]) => this.capture("debug", ...args)
  text(): string {
    return this.entries.map((entry) => entry.payload).join("\n")
  }
}
