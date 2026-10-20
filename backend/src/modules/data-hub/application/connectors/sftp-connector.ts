import { createHash } from "node:crypto"
import { DataRunError } from "../../domain/error-codes.js"
import { matchesGlob, sftpFeedConfigSchema, type SftpConfig, type SourceConfig } from "../../domain/source-config.js"
import type { DataHubContext } from "../data-hub-context.js"
import type { SftpConnection, SftpFileEntry } from "../ports.js"
import type { DataFeedRow, DataSourceRow } from "../records.js"

/**
 * Conector SFTP: a INIA busca arquivos no servidor do cliente. Cada feed tem um pattern
 * (`employees_*.csv`); a cada carga o conector escolhe o arquivo mais antigo AINDA NÃO
 * processado (dedup por checksum em `data_processed_files`) — nunca reprocessa o mesmo conteúdo.
 */
function sftpConfigOf(source: DataSourceRow): SftpConfig {
  const config = source.config as SourceConfig
  if (config.kind !== "SFTP") throw new DataRunError("DATA_INTERNAL_ERROR", "A fonte não é SFTP.")
  return config.sftp
}

export async function resolveSftpConnection(ctx: DataHubContext, source: DataSourceRow): Promise<SftpConnection> {
  const config = sftpConfigOf(source)
  const connection: SftpConnection = { host: config.host, port: config.port, username: config.username, timeoutMs: config.timeoutMs }
  if (config.hostKeyFingerprint) connection.hostKeyFingerprint = config.hostKeyFingerprint
  else connection.onHostKey = (fingerprint) => void pinSftpHostKey(ctx, source, fingerprint)
  if (config.authKind === "PASSWORD") {
    const password = await ctx.secrets.get({ sourceId: source.id, purpose: "SFTP_PASSWORD" })
    if (!password) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", "Senha do SFTP não configurada (ou revogada).")
    connection.password = password
  } else {
    const privateKey = await ctx.secrets.get({ sourceId: source.id, purpose: "SFTP_PRIVATE_KEY" })
    if (!privateKey) throw new DataRunError("DATA_SOURCE_AUTH_FAILED", "Chave privada do SFTP não configurada (ou revogada).")
    connection.privateKey = privateKey
    const passphrase = await ctx.secrets.get({ sourceId: source.id, purpose: "SFTP_PASSPHRASE" })
    if (passphrase) connection.passphrase = passphrase
  }
  return connection
}

/**
 * TOFU (achado I-F4): sem fingerprint configurada, a PRIMEIRA host key vista é gravada na fonte — dali em diante uma chave
 * diferente (servidor trocado ou interceptação) derruba a conexão. Só grava se ainda não houver fingerprint (corrida segura).
 */
async function pinSftpHostKey(ctx: DataHubContext, source: DataSourceRow, fingerprint: string): Promise<void> {
  try {
    const result = await ctx.db.query(
      `update data_sources set config = jsonb_set(config, '{sftp,hostKeyFingerprint}', to_jsonb($2::text)), updated_at = now()
       where id = $1 and kind = 'SFTP' and coalesce(config->'sftp'->>'hostKeyFingerprint', '') = ''`,
      [source.id, fingerprint],
    )
    if (result.rowCount) ctx.logger.info({ sourceId: source.id }, "sftp host key pinned (TOFU)")
  } catch (error) {
    ctx.logger.error({ sourceId: source.id, error: error instanceof Error ? error.message : String(error) }, "sftp host key pin failed")
  }
}

export async function testSftpConnection(ctx: DataHubContext, source: DataSourceRow): Promise<{ ok: true; detail: string }> {
  const config = sftpConfigOf(source)
  const connection = await resolveSftpConnection(ctx, source)
  const entries = await ctx.sftp.list(connection, config.remoteDirectory)
  return { ok: true, detail: `${entries.length} arquivo(s) em ${config.remoteDirectory}` }
}

export async function listSftpFiles(ctx: DataHubContext, source: DataSourceRow, feed: DataFeedRow): Promise<(SftpFileEntry & { matches: boolean })[]> {
  const config = sftpConfigOf(source)
  if (feed.connectorConfig.connector !== "SFTP") throw new DataRunError("DATA_INTERNAL_ERROR", "O feed não é SFTP.")
  const feedConfig = sftpFeedConfigSchema.parse(feed.connectorConfig.sftp)
  const directory = feedConfig.remoteDirectory ?? config.remoteDirectory
  const connection = await resolveSftpConnection(ctx, source)
  const entries = await ctx.sftp.list(connection, directory)
  return entries.map((entry) => ({ ...entry, matches: matchesGlob(feedConfig.filePattern, entry.name) })).sort((a, b) => (a.modifiedAt ?? "").localeCompare(b.modifiedAt ?? "") || a.name.localeCompare(b.name))
}

export type SftpFetchedFile = { entry: SftpFileEntry; content: Uint8Array; checksum: string }

/** Próximo arquivo do pattern ainda não processado (mais antigo primeiro); `null` = nada novo. */
export async function fetchNextSftpFile(ctx: DataHubContext, source: DataSourceRow, feed: DataFeedRow): Promise<SftpFetchedFile | null> {
  const candidates = (await listSftpFiles(ctx, source, feed)).filter((entry) => entry.matches)
  if (candidates.length === 0) return null
  const processed = await ctx.db.query<{ checksum_sha256: string; remote_path: string; byte_size: number; remote_modified_at: Date | null }>(
    `select checksum_sha256, remote_path, byte_size, remote_modified_at from data_processed_files where feed_id = $1`,
    [feed.id],
  )
  // Pré-filtro barato por (caminho, tamanho, mtime) evita baixar de novo o que já foi visto; a
  // decisão final é sempre pelo checksum do conteúdo.
  const seenByPath = new Map(processed.rows.map((row) => [`${row.remote_path}|${row.byte_size}|${row.remote_modified_at?.toISOString() ?? ""}`, row.checksum_sha256]))
  const seenChecksums = new Set(processed.rows.map((row) => row.checksum_sha256))
  const connection = await resolveSftpConnection(ctx, source)
  for (const entry of candidates) {
    if (seenByPath.has(`${entry.path}|${entry.size}|${entry.modifiedAt ?? ""}`)) continue
    const content = await ctx.sftp.download(connection, entry.path)
    const checksum = createHash("sha256").update(content).digest("hex")
    if (seenChecksums.has(checksum)) continue
    return { entry, content, checksum }
  }
  return null
}

export async function fetchSftpSample(ctx: DataHubContext, source: DataSourceRow, feed: DataFeedRow): Promise<{ entry: SftpFileEntry; content: Uint8Array }> {
  const candidates = (await listSftpFiles(ctx, source, feed)).filter((entry) => entry.matches)
  const entry = candidates[candidates.length - 1]
  if (!entry) throw new DataRunError("DATA_SOURCE_RESPONSE_INVALID", "Nenhum arquivo do SFTP corresponde ao padrão configurado.")
  const connection = await resolveSftpConnection(ctx, source)
  return { entry, content: await ctx.sftp.download(connection, entry.path) }
}
