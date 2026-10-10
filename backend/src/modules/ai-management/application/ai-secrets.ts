import { decryptSecret, encryptSecret, resolveSecretKey } from "../../data-hub/infrastructure/aes-secret-store.js"

/**
 * SEGREDOS DAS CONEXÕES DE IA (§8, §9). Reaproveita a MESMA criptografia da Central de Dados
 * (AES-256-GCM, chave `DATA_HUB_SECRET_KEY` fora do banco) — nenhuma segunda implementação
 * criptográfica. O valor só existe decifrado dentro do runtime, no instante da chamada/teste.
 * A API devolve apenas `configured` + máscara ("••••abcd"); não existe rota de leitura do valor.
 */
export type EncryptedSecret = { ciphertext: Buffer; iv: Buffer; authTag: Buffer }

export const SECRET_KEY_VERSION = 1

let cachedKey: Buffer | null = null
function key(): Buffer {
  if (!cachedKey) cachedKey = resolveSecretKey()
  return cachedKey
}

export function encryptAiSecret(plain: string): EncryptedSecret {
  return encryptSecret(plain, key())
}

export function decryptAiSecret(secret: EncryptedSecret): string {
  return decryptSecret(secret, key())
}

/** "••••abcd" — os 4 últimos caracteres só quando a chave é longa o bastante para não se revelar. */
export function maskSecret(plain: string): string {
  const trimmed = plain.trim()
  return trimmed.length >= 16 ? `••••••••${trimmed.slice(-4)}` : "••••••••"
}

export type SecretView = { configured: boolean; maskedValue: string | null; updatedAt: string | null }

/** Cabeçalhos personalizados: nomes permitidos (sem sobrescrever autenticação/transporte). */
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "content-type", "authorization", "x-api-key", "x-goog-api-key", "cookie", "connection", "transfer-encoding"])
export function customHeaderProblem(name: string): string | null {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) return `Nome de cabeçalho inválido: ${name}`
  if (FORBIDDEN_HEADERS.has(name.toLowerCase())) return `O cabeçalho ${name} é controlado pela INIA e não pode ser personalizado.`
  return null
}
