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
 * separação de chave.
 *
 * VERSÕES DA CIFRA (R-12/R-25): 1 = sem dados associados (linhas antigas); 2 = com DADOS ASSOCIADOS (AAD) = onde o segredo
 * mora + organização + dono (fonte ou conexão de IA) + finalidade. Com a v2, um texto cifrado copiado para outra fonte, outra
 * organização ou outra finalidade não decifra. TROCA DA CHAVE: a chave nova vai em DATA_HUB_SECRET_KEY e a antiga em
 * DATA_HUB_SECRET_KEY_PREVIOUS; a leitura tenta a atual e, se falhar, a anterior; `npm run secrets:rotate` recifra tudo com a
 * atual (v2) e depois a anterior sai do .env. Passo a passo em docs/security/configuracao-segura.md.
 */
const DEV_FALLBACK_KEY = "inia-dev-data-hub-secret-key-change-me"

export const SECRET_KEY_VERSION_UNBOUND = 1
export const SECRET_KEY_VERSION_BOUND = 2
export const CURRENT_SECRET_KEY_VERSION = SECRET_KEY_VERSION_BOUND

/** Onde o segredo mora e a quem pertence — os dados associados da v2. */
export type SecretBinding = { store: "data_secrets" | "ai_connection_secrets"; organizationId: string; ownerId: string; purpose: string }
export type SecretKeys = { current: Buffer; previous: Buffer | null }
export type StoredSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer; keyVersion: number }

function keyFrom(configured: string): Buffer {
  if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, "hex")
  const base64 = Buffer.from(configured, "base64")
  if (base64.length === 32) return base64
  // Qualquer outra string vira chave por hash — aceita passphrases longas sem exigir formato.
  return createHash("sha256").update(configured).digest()
}

export function resolveSecretKey(): Buffer {
  const configured = env.DATA_HUB_SECRET_KEY
  if (!configured) {
    if (env.NODE_ENV === "production") throw new Error("DATA_HUB_SECRET_KEY ausente.")
    return createHash("sha256").update(DEV_FALLBACK_KEY).digest()
  }
  return keyFrom(configured)
}

/** Chave ANTERIOR, só durante uma troca de chave (DATA_HUB_SECRET_KEY_PREVIOUS); fora disso, null. */
export function resolvePreviousSecretKey(): Buffer | null {
  const configured = env.DATA_HUB_SECRET_KEY_PREVIOUS?.trim()
  return configured ? keyFrom(configured) : null
}

export function resolveSecretKeys(): SecretKeys {
  return { current: resolveSecretKey(), previous: resolvePreviousSecretKey() }
}

export function secretAad(binding: SecretBinding): Buffer {
  return Buffer.from(`inia-secret:v2:${binding.store}:${binding.organizationId}:${binding.ownerId}:${binding.purpose}`, "utf8")
}

export function encryptSecret(plain: string, key: Buffer, aad?: Buffer): { ciphertext: Buffer; iv: Buffer; authTag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  if (aad) cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return { ciphertext, iv, authTag: cipher.getAuthTag() }
}

export function decryptSecret(input: { ciphertext: Buffer; iv: Buffer; authTag: Buffer }, key: Buffer, aad?: Buffer): string {
  const decipher = createDecipheriv("aes-256-gcm", key, input.iv)
  if (aad) decipher.setAAD(aad)
  decipher.setAuthTag(input.authTag)
  return Buffer.concat([decipher.update(input.ciphertext), decipher.final()]).toString("utf8")
}

/** Cifra na versão atual (v2, presa ao lugar e ao dono). */
export function encryptBoundSecret(plain: string, binding: SecretBinding, key: Buffer): StoredSecret {
  return { ...encryptSecret(plain, key, secretAad(binding)), keyVersion: CURRENT_SECRET_KEY_VERSION }
}

/** Decifra um segredo gravado pela versão da linha; tenta a chave atual e, durante uma troca, a anterior. */
export function decryptStoredSecret(stored: StoredSecret, binding: SecretBinding, keys: SecretKeys): string {
  const aad = stored.keyVersion >= SECRET_KEY_VERSION_BOUND ? secretAad(binding) : undefined
  try {
    return decryptSecret(stored, keys.current, aad)
  } catch (error) {
    if (!keys.previous) throw error
    return decryptSecret(stored, keys.previous, aad)
  }
}

export type SecretRotation = { kind: "CURRENT" } | { kind: "ROTATED"; encrypted: StoredSecret } | { kind: "UNREADABLE" }

/**
 * Decisão da rotação para UMA credencial gravada: já está na versão e na chave atuais (nada a fazer); abre (com a atual ou a
 * anterior) e é recifrada na versão atual com a chave atual — conferida antes de devolver; ou nenhuma chave abre.
 */
export function rotateStoredSecret(stored: StoredSecret, binding: SecretBinding, keys: SecretKeys): SecretRotation {
  if (stored.keyVersion >= CURRENT_SECRET_KEY_VERSION) {
    try {
      decryptSecret(stored, keys.current, secretAad(binding))
      return { kind: "CURRENT" }
    } catch {
      // segue: pode estar na chave anterior
    }
  }
  let plain: string
  try {
    plain = decryptStoredSecret(stored, binding, keys)
  } catch {
    return { kind: "UNREADABLE" }
  }
  const encrypted = encryptBoundSecret(plain, binding, keys.current)
  if (decryptStoredSecret(encrypted, binding, { current: keys.current, previous: null }) !== plain) throw new Error("A credencial recifrada não confere com a original.")
  return { kind: "ROTATED", encrypted }
}

export class PgAesSecretStore implements SecretStore {
  private readonly keys: SecretKeys

  constructor(private readonly db: Database, key: Buffer = resolveSecretKey(), previous: Buffer | null = resolvePreviousSecretKey()) {
    this.keys = { current: key, previous }
  }

  async put(input: { organizationId: string; sourceId: string; purpose: SecretPurpose; value: string; actorId: string | null }): Promise<void> {
    const encrypted = encryptBoundSecret(input.value, { store: "data_secrets", organizationId: input.organizationId, ownerId: input.sourceId, purpose: input.purpose }, this.keys.current)
    const client = await this.db.connect()
    try {
      await client.query("begin")
      const existing = await client.query(`select 1 from data_secrets where source_id = $1 and purpose = $2 and revoked_at is null`, [input.sourceId, input.purpose])
      await client.query(`update data_secrets set revoked_at = now() where source_id = $1 and purpose = $2 and revoked_at is null`, [input.sourceId, input.purpose])
      await client.query(
        `insert into data_secrets (organization_id, source_id, purpose, key_version, ciphertext, iv, auth_tag, created_by, rotated_at)
         values ($1, $2, $3, $9, $4, $5, $6, $7, $8)`,
        [input.organizationId, input.sourceId, input.purpose, encrypted.ciphertext, encrypted.iv, encrypted.authTag, input.actorId, existing.rowCount ? new Date() : null, encrypted.keyVersion],
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
    const result = await this.db.query<{ organization_id: string; key_version: number; ciphertext: Buffer; iv: Buffer; auth_tag: Buffer }>(
      `select organization_id, key_version, ciphertext, iv, auth_tag from data_secrets where source_id = $1 and purpose = $2 and revoked_at is null`,
      [input.sourceId, input.purpose],
    )
    const row = result.rows[0]
    if (!row) return null
    return decryptStoredSecret({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag, keyVersion: row.key_version }, { store: "data_secrets", organizationId: row.organization_id, ownerId: input.sourceId, purpose: input.purpose }, this.keys)
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
