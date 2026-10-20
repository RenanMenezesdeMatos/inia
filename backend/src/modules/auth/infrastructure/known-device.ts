import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { derivedKey } from "./derived-keys.js"

/**
 * DISPOSITIVO CONHECIDO — cookie assinado que o navegador recebe depois de um login CERTO (achado AUTH-3 da auditoria de
 * 17/10/2026). Não é sessão nem dá acesso a nada: só diz ao login "esta conta já entrou deste navegador", para que a trava do
 * e-mail — que qualquer pessoa provoca digitando senhas erradas — não deixe o dono de fora; o dispositivo tem a própria trava.
 * Formato: `<conta>.<aleatório>.<HMAC>`; a chave é derivada do JWT_SECRET só para este uso (trocar o JWT_SECRET invalida todos).
 */
export const DEVICE_COOKIE_NAME = "inia_device"
export const DEVICE_COOKIE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000

const mac = (accountId: string, nonce: string) => createHmac("sha256", derivedKey("known-device")).update(`device:${accountId}:${nonce}`).digest("base64url")

export function issueDeviceToken(accountId: string): string {
  const nonce = randomBytes(18).toString("base64url")
  return `${accountId}.${nonce}.${mac(accountId, nonce)}`
}

/** Cookie válido = assinado por esta instalação; devolve a conta e o identificador da trava deste dispositivo. */
export function readDeviceToken(value: unknown): { accountId: string; identifierHash: string } | null {
  if (typeof value !== "string" || value.length > 300) return null
  const [accountId, nonce, signature, ...rest] = value.split(".")
  if (!accountId || !nonce || !signature || rest.length > 0 || !/^[0-9a-f-]{36}$/i.test(accountId)) return null
  const expected = Buffer.from(mac(accountId, nonce))
  const sent = Buffer.from(signature)
  if (expected.length !== sent.length || !timingSafeEqual(expected, sent)) return null
  return { accountId, identifierHash: createHmac("sha256", derivedKey("known-device")).update(`device:${nonce}`).digest("hex") }
}
