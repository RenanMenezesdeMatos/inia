import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import type { SecretStore } from "../application/ports.js"
import type { SecretPurpose } from "../domain/source-config.js"

/**
 * SecretStore em Postgres com AES-256-GCM e chave FORA do banco (`DATA_HUB_SECRET_KEY`).
 *
 * Não existe vault externo no projeto; esta é a segurança real que temos: quem tem acesso só ao
 * banco (dump, réplica, backup) não lê o segredo; quem tem a chave E o banco lê. Documentado na
 * Wiki (Central de Dados › Segurança) — não é "falsa segurança", é criptografia em repouso com
 * separação de chave. Rotação de chave (key_version) fica preparada, não automatizada.
 */
const DEV_FALLBACK_KEY = "inia-dev-data-hub-secret-key-change-me"

export function resolveSecretKey(): Buffer {
  const configured = env.DATA_HUB_SECRET_KEY
  if (!configured) {
    if (env.NODE_ENV === "production") throw new Error("DATA_HUB_SECRET_KEY ausente.")
    return createHash("sha256").update(DEV_FALLBACK_KEY).digest()
  }
  if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, "hex")
  const base64 = Buffer.from(configured, "base64")
  if (base64.length === 32) return base64
  // Qualquer outra string vira chave por hash — aceita passphrases longas sem exigir formato.
  return createHash("sha256").update(configured).digest()
}

export function encryptSecret(plain: string, key: Buffer): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

export function decryptSecret(input: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }, key: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, input.iv)
  decipher.setAuthTag(input.authTag)
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8")
}

export class PgAesSecretStore implements SecretStore {
  private readonly key: Buffer

  constructor(private readonly db: Database, key: Buffer = resolveSecretKey()) {
    this.key = key
  }

  async put(input: { organizationId: string; sourceId: string; purpose: SecretPurpose; value: string; actorId: string | null }): Promise<void> {
    const encrypted = encryptSecret(input.value, this.key)
    const client = await this.db.connect()
    try {
      await client.query("begin")
      const existing = await client.query(`select 1 from data_secrets where source_id = $1 and purpose = $2 and revoked_at is null`, [input.sourceId, input.purpose])
      await client.query(`update data_secrets set revoked_at = now() where source_id = $1 and purpose = $2 and revoked_at is null`, [input.sourceId, input.purpose])
      await client.query(
        `insert into data_secrets (organization_id, source_id, purpose, key_version, ciphertext, iv, auth_tag, created_by, rotated_at)
         values ($1, $2, $3, 1, $4, $5, $6, $7, $8)`,
        [input.organizationId, input.sourceId, input.purpose, encrypted.ciphertext, encrypted.iv, encrypted.authTag, input.actorId, existing.rowCount ? new Date() : null],
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  async get(input: { sourceId: string; purpose: SecretPurpose }): Promise<string | null> {
    const result = await this.db.query<{ ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }>(
      `select ciphertext, iv, auth_tag from data_secrets where source_id = $1 and purpose = $2 and revoked_at is null`,
      [input.sourceId, input.purpose],
    )
    const row = result.rows[0]
    if (!row) return null
    return decryptSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag }, this.key)
  }

  async revoke(input: { sourceId: string; purpose: SecretPurpose }): Promise<void> {
    await this.db.query(`update data_secrets set revoked_at = now() where source_id = $1 and purpose = $2 and revoked_at is null`, [input.sourceId, input.purpose])
  }

  async describe(sourceId: string): Promise<{ purpose: SecretPurpose; createdAt: string; rotatedAt: string | null }[]> {
    const result = await this.db.query<{ purpose: SecretPurpose; created_at: Date; rotated_at: Date | null }>(
      `select purpose, created_at, rotated_at from data_secrets where source_id = $1 and revoked_at is null order by purpose`,
      [sourceId],
    )
    return result.rows.map((row) => ({ purpose: row.purpose, createdAt: row.created_at.toISOString(), rotatedAt: row.rotated_at?.toISOString() ?? null }))
  }
}
