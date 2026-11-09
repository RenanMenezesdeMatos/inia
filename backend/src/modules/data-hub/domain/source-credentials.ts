import { createHash, timingSafeEqual } from "node:crypto"
import { resolveDatabaseConnection } from "./database/database-engine.js"
import type { SecretPurpose, SourceConfig, SourceSecrets } from "./source-config.js"

/** Quais segredos a configuração exige e onde guardar cada um. */
export function requiredSecretPurposes(config: SourceConfig): { purpose: SecretPurpose; field: keyof SourceSecrets; required: boolean }[] {
  if (config.kind === "API_PULL") {
    switch (config.api.auth.kind) {
      case "NONE":
        return []
      case "BEARER":
        return [{ purpose: "API_AUTH", field: "token", required: true }]
      case "API_KEY":
        return [{ purpose: "API_AUTH", field: "apiKey", required: true }]
      case "BASIC":
        return [{ purpose: "API_AUTH", field: "password", required: true }]
      case "OAUTH2_CLIENT_CREDENTIALS":
        return [{ purpose: "API_AUTH", field: "clientSecret", required: true }]
    }
  }
  if (config.kind === "DATABASE") return [{ purpose: "DATABASE_PASSWORD", field: "password", required: true }]
  if (config.kind === "SFTP") {
    return config.sftp.authKind === "PASSWORD"
      ? [{ purpose: "SFTP_PASSWORD", field: "password", required: true }]
      : [
          { purpose: "SFTP_PRIVATE_KEY", field: "privateKey", required: true },
          { purpose: "SFTP_PASSPHRASE", field: "passphrase", required: false },
        ]
  }
  return []
}

/** Campos que a pessoa precisa digitar para provar que conhece a credencial desta fonte. Vazio = não há senha a exigir. */
export function credentialFields(config: SourceConfig): (keyof SourceSecrets)[] {
  return requiredSecretPurposes(config)
    .filter((entry) => entry.required)
    .map((entry) => entry.field)
}

/**
 * DESTINO A QUE UMA CREDENCIAL GUARDADA PERTENCE (achado I-F2). Segredo nunca volta pela API — mas, se bastasse trocar o
 * host/usuário/URL e manter a senha guardada, um administrador apontaria a fonte para um servidor próprio e a receberia em
 * claro na próxima conexão. Por isso, quando este destino muda, as credenciais precisam ser digitadas de novo.
 * Inclui o modo de TLS: rebaixar a criptografia também exige a senha de novo. Inclui o nome do banco: com a senha guardada, outro
 * banco do mesmo servidor seria lido sem que ninguém provasse conhecer a senha.
 */
export function secretTargetOf(config: SourceConfig): string | null {
  if (config.kind === "API_PULL") {
    const auth = config.api.auth
    return JSON.stringify({ origin: safeOrigin(config.api.baseUrl), auth: auth.kind, tokenUrl: auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.tokenUrl : null, headerName: auth.kind === "API_KEY" ? auth.headerName.toLowerCase() : null, username: auth.kind === "BASIC" ? auth.username : null })
  }
  if (config.kind === "DATABASE") {
    const database = config.database
    // A CA também: trocar a autoridade que valida o servidor é trocar quem pode se passar por ele (achado DATA-6).
    const ca = database.tls?.caCertificate ? createHash("sha256").update(database.tls.caCertificate.trim()).digest("hex") : null
    return JSON.stringify({ engine: database.engine, host: database.host.trim().toLowerCase(), port: database.port ?? null, instance: database.instanceName?.toLowerCase() ?? null, database: database.database, username: database.username, tls: database.tls?.mode ?? null, ca })
  }
  // A chave do servidor SFTP também: apagá-la ou trocá-la faria a próxima conexão aceitar qualquer servidor com a senha guardada.
  if (config.kind === "SFTP") return JSON.stringify({ host: config.sftp.host.trim().toLowerCase(), port: config.sftp.port, username: config.sftp.username, auth: config.sftp.authKind, hostKey: config.sftp.hostKeyFingerprint?.trim() ?? null })
  return null
}

/**
 * Quem responde pela credencial: servidor + usuário. É a chave do limite de tentativas, então ficam de fora banco, criptografia e
 * tipo do banco: mudar qualquer um deles não pode zerar a conta de quem está tentando senhas.
 */
export function credentialTargetKey(config: SourceConfig): string | null {
  let target: unknown = null
  if (config.kind === "DATABASE") {
    const connection = resolveDatabaseConnection(config.database, "")
    target = { host: connection.host.trim().toLowerCase(), port: connection.port, instance: connection.instanceName?.toLowerCase() ?? null, username: connection.username.toLowerCase() }
  } else if (config.kind === "SFTP") {
    target = { host: config.sftp.host.trim().toLowerCase(), port: config.sftp.port, username: config.sftp.username.toLowerCase() }
  } else if (config.kind === "API_PULL" && config.api.auth.kind !== "NONE") {
    const auth = config.api.auth
    target = { origin: safeOrigin(auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.tokenUrl : config.api.baseUrl), username: auth.kind === "BASIC" ? auth.username : auth.kind === "OAUTH2_CLIENT_CREDENTIALS" ? auth.clientId : null }
  }
  return target ? createHash("sha256").update(JSON.stringify(target)).digest("hex") : null
}

export function safeOrigin(value: string): string {
  try {
    return new URL(value).origin
  } catch {
    return value
  }
}

/** Chave colada de outro lugar pode vir com fim de linha do Windows ou uma linha em branco no fim; é a mesma chave. */
function comparableCredential(field: keyof SourceSecrets, value: string): string {
  return field === "privateKey" ? value.replace(/\r\n/g, "\n").trim() : value
}

/** Comparação em tempo constante: o tempo da resposta não diz quantos caracteres acertaram nem o tamanho da senha guardada. */
export function sameCredential(field: keyof SourceSecrets, typed: string, stored: string): boolean {
  const digest = (value: string) => createHash("sha256").update(comparableCredential(field, value)).digest()
  return timingSafeEqual(digest(typed), digest(stored))
}
