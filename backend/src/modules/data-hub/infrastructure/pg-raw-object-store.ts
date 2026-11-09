import { createHash } from "node:crypto"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { RawObjectMeta, RawObjectStore } from "../application/ports.js"

/**
 * RawObjectStore em Postgres (bytea) — mesmo padrão dos arquivos de Base de Conhecimento
 * (`knowledge_files`). Nada fica no filesystem local; trocar por S3/objeto é trocar esta classe.
 * Retenção: `expires_at` = criação + DATA_HUB_RAW_RETENTION_DAYS (padrão 30 dias, conservador);
 * `purgeExpired` roda no tick da Central. Metadados do Run permanecem depois da purga.
 */
type MetaRow = { id: string; source_id: string | null; filename: string | null; content_type: string; byte_size: number; checksum_sha256: string; created_at: Date; expires_at: Date }

function toMeta(row: MetaRow): RawObjectMeta {
  return { id: row.id, sourceId: row.source_id, filename: row.filename, contentType: row.content_type, byteSize: row.byte_size, checksumSha256: row.checksum_sha256, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() }
}

/** Parâmetro bytea sem cópia: um Buffer já serve; um Uint8Array vira uma VISTA Buffer sobre a mesma memória (`Buffer.from(u8)` copiaria). */
export function asBuffer(content: Uint8Array): Buffer {
  return Buffer.isBuffer(content) ? content : Buffer.from(content.buffer, content.byteOffset, content.byteLength)
}

export class PgRawObjectStore implements RawObjectStore {
  constructor(private readonly db: Database) {}

  async put(input: { organizationId: string; sourceId: string | null; feedId: string | null; filename: string | null; contentType: string; content: Uint8Array; retentionDays?: number }): Promise<RawObjectMeta> {
    const checksum = createHash("sha256").update(input.content).digest("hex")
    const retentionDays = input.retentionDays ?? env.DATA_HUB_RAW_RETENTION_DAYS
    const result = await this.db.query<{ id: string; created_at: Date; expires_at: Date }>(
      `insert into data_raw_objects (organization_id, source_id, feed_id, filename, content_type, byte_size, checksum_sha256, content, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now() + make_interval(days => $9))
       returning id, created_at, expires_at`,
      [input.organizationId, input.sourceId, input.feedId, input.filename, input.contentType, input.content.byteLength, checksum, asBuffer(input.content), retentionDays],
    )
    const row = result.rows[0]!
    return { id: row.id, sourceId: input.sourceId, filename: input.filename, contentType: input.contentType, byteSize: input.content.byteLength, checksumSha256: checksum, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString() }
  }

  async get(id: string, organizationId?: string): Promise<{ meta: RawObjectMeta; content: Uint8Array } | null> {
    const result = await this.db.query<MetaRow & { content: Buffer }>(
      `select id, source_id, filename, content_type, byte_size, checksum_sha256, content, created_at, expires_at from data_raw_objects where id = $1 and ($2::uuid is null or organization_id = $2::uuid)`,
      [id, organizationId ?? null],
    )
    const row = result.rows[0]
    if (!row) return null
    // O Buffer do driver já é um Uint8Array: entregue como veio (copiar dobrava até 50 MB por leitura).
    return { meta: toMeta(row), content: row.content }
  }

  async getMeta(id: string, organizationId?: string): Promise<RawObjectMeta | null> {
    const result = await this.db.query<MetaRow>(
      `select id, source_id, filename, content_type, byte_size, checksum_sha256, created_at, expires_at from data_raw_objects where id = $1 and ($2::uuid is null or organization_id = $2::uuid)`,
      [id, organizationId ?? null],
    )
    const row = result.rows[0]
    return row ? toMeta(row) : null
  }

  async purgeExpired(now: Date = new Date()): Promise<number> {
    const result = await this.db.query(`delete from data_raw_objects where expires_at <= $1`, [now])
    return result.rowCount ?? 0
  }
}
