import { env } from "./env.js"
import { parseAllowList, type OutboundPolicy } from "../shared/infrastructure/outbound-destination-policy.js"

/** Host:porta do banco INTERNO (DATABASE_URL) — nunca destino de uma integração configurada na tela. */
function internalDatabaseEndpoint(): { host: string; port: number }[] {
  try {
    const url = new URL(env.activeDatabaseUrl)
    return [{ host: url.hostname || "localhost", port: url.port ? Number(url.port) : 5432 }]
  } catch {
    return []
  }
}

/** Política de saída deste processo, a partir das variáveis do servidor (lida uma vez na subida). */
export const outboundPolicy: OutboundPolicy = {
  mode: env.INIA_OUTBOUND_MODE,
  allowLoopback: env.NODE_ENV !== "production",
  allow: parseAllowList(env.INIA_OUTBOUND_ALLOWED_DESTINATIONS),
  deniedEndpoints: internalDatabaseEndpoint(),
}
