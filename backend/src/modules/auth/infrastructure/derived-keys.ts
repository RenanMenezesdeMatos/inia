import { hkdfSync } from "node:crypto"
import { env } from "../../../config/env.js"

/**
 * CHAVES DERIVADAS DO JWT_SECRET (R-33 da auditoria): cada uso de HMAC fora da assinatura da sessão tem a própria chave,
 * derivada por HKDF-SHA256 com um rótulo. Um valor calculado para um propósito (ex.: o identificador da trava de login) nunca
 * serve de assinatura em outro (o cookie de dispositivo conhecido) nem revela nada sobre a chave da sessão. Trocar o
 * JWT_SECRET continua invalidando tudo de uma vez.
 */
export type DerivedKeyPurpose = "login-identifier" | "known-device"

const cache = new Map<string, Buffer>()

export function derivedKey(purpose: DerivedKeyPurpose): Buffer {
  const id = `${purpose}:${env.JWT_SECRET}`
  let key = cache.get(id)
  if (!key) {
    key = Buffer.from(hkdfSync("sha256", env.JWT_SECRET, "inia-session-keys-v1", `inia:${purpose}`, 32))
    cache.set(id, key)
  }
  return key
}
