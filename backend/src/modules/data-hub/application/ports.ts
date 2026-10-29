import type { DatabaseEngine, ResolvedDatabaseConnection } from "../domain/database/database-engine.js"
import type { SqlStatement } from "../domain/database/sql-dialect.js"
import type { SecretPurpose } from "../domain/source-config.js"
import type { Database } from "../../../infrastructure/database/pool.js"

/**
 * Ports da Central de Dados — o domínio/aplicação só conhece estas interfaces. Implementações em
 * `infrastructure/` (Postgres + AES, fetch, ssh2) e fakes em `testing/` (mock HTTP, SFTP em
 * memória) — os testes nunca dependem de internet.
 */

/** Segredos cifrados em repouso; o valor em claro nunca sai por API, log ou trace. */
/** `db` = a transação de quem chama: a troca do destino e a da credencial entram no MESMO commit (achado N01 da 4ª auditoria). */
export type SecretWriteOptions = { db?: Pick<Database, "query"> }

export interface SecretStore {
  put(input: { organizationId: string; sourceId: string; purpose: SecretPurpose; value: string; actorId: string | null }, options?: SecretWriteOptions): Promise<void>
  get(input: { sourceId: string; purpose: SecretPurpose }): Promise<string | null>
  revoke(input: { sourceId: string; purpose: SecretPurpose }, options?: SecretWriteOptions): Promise<void>
  /** Só metadados (para a UI mostrar "configurado em…", nunca o valor). */
  describe(sourceId: string): Promise<{ purpose: SecretPurpose; createdAt: string; rotatedAt: string | null }[]>
}

export type RawObjectMeta = { id: string; filename: string | null; contentType: string; byteSize: number; checksumSha256: string; createdAt: string; expiresAt: string }

/** Objetos brutos (arquivos, payloads) — hoje Postgres (bytea), amanhã S3 sem tocar o domínio. */
export interface RawObjectStore {
  put(input: { organizationId: string; sourceId: string | null; feedId: string | null; filename: string | null; contentType: string; content: Uint8Array; retentionDays?: number }): Promise<RawObjectMeta>
  /** `organizationId` sempre que o id veio da requisição (nunca ler o arquivo de outra organização pelo id). */
  get(id: string, organizationId?: string): Promise<{ meta: RawObjectMeta; content: Uint8Array } | null>
  /** Remove objetos expirados; devolve quantos saíram. */
  purgeExpired(now?: Date): Promise<number>
}

export type HttpRequest = { url: string; method: "GET" | "POST"; headers: Record<string, string>; body?: string; timeoutMs: number }
export type HttpResponse = { status: number; headers: Record<string, string>; body: string }

export interface HttpClient {
  send(request: HttpRequest): Promise<HttpResponse>
}

export type SftpConnection = {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  hostKeyFingerprint?: string
  /** Chamado com a fingerprint (SHA-256) que o servidor apresentou — a aplicação fixa a primeira vista (TOFU). */
  onHostKey?: (fingerprint: string) => void
  timeoutMs: number
}
export type SftpFileEntry = { name: string; path: string; size: number; modifiedAt: string | null }

export interface SftpClient {
  list(connection: SftpConnection, directory: string): Promise<SftpFileEntry[]>
  download(connection: SftpConnection, path: string): Promise<Uint8Array>
}

/**
 * Banco EXTERNO do cliente (SQL Server, PostgreSQL, MariaDB, MySQL) — nunca o banco interno da INIA. A sessão só
 * executa o SQL gerado pelo dialeto (`domain/database/sql-dialect.ts`): SELECT de catálogo, amostra e páginas.
 * Implementações reais em `infrastructure/external-databases/`; fakes em `testing/`.
 */
export type ExternalDatabaseSession = {
  /** Banco realmente encontrado (um "MySQL" que responde como MariaDB é MariaDB). */
  readonly flavor: DatabaseEngine
  readonly serverVersion: string
  /** O tráfego está cifrado (TLS ativo). */
  readonly tlsActive: boolean
  /** O próprio servidor recusa escrita nesta sessão (transação somente leitura). SQL Server não tem esse modo. */
  readonly readOnlyEnforced: boolean
  query(statement: SqlStatement, options?: { timeoutMs?: number }): Promise<Record<string, unknown>[]>
  /** Aviso quando o usuário tem privilégios além de leitura (superusuário, dono do banco, escrita). */
  privilegeWarning(): Promise<string | null>
  close(): Promise<void>
}

export interface ExternalDatabaseConnector {
  open(connection: ResolvedDatabaseConnection): Promise<ExternalDatabaseSession>
}

// Relógio único do sistema (shared/domain/clock.ts) — reexportado para compatibilidade dos chamadores da Central.
export { systemClock, type Clock } from "../../../shared/domain/clock.js"
