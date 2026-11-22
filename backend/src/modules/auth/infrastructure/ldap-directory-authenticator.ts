import { readFileSync } from "node:fs"
import { connect as tlsConnect, type ConnectionOptions, type PeerCertificate } from "node:tls"
import { Client, InvalidCredentialsError } from "ldapts"
import { env } from "../../../config/env.js"
import { classifyInvalidCredentials, type DirectoryVerdict } from "../domain/network-login.js"
import { unconfiguredDirectory, type DirectoryAuthenticator, type DirectoryServerProbe } from "../application/directory-authenticator.js"

export type LdapDirectoryConfig = {
  urls: readonly string[]
  domain: string
  /** PEM da autoridade (lido uma vez); null = só o repositório padrão do Node. */
  ca: string | null
  allowWeakKey: boolean
  timeoutMs: number
  /** Troca a conexão TLS nos testes. */
  createSecureConnection?: typeof tlsConnect
}

/** `ldaps://host:636` válidos (LDAP sem TLS é recusado: a senha de rede nunca trafega aberta). */
export function parseLdapUrls(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .filter((item) => {
      try {
        const url = new URL(item)
        return url.protocol === "ldaps:" && url.hostname.length > 0
      } catch {
        return false
      }
    })
}

/**
 * TLS da conexão com o AD: cadeia e nome do servidor SEMPRE conferidos (`rejectUnauthorized` nunca desligado). Com
 * `allowWeakKey`, o nível de segurança do OpenSSL cai para 1 SÓ nesta conexão — aceita a chave RSA de 1024 bits que o AD ainda
 * usa (risco aceito e documentado); TLS 1.2 no mínimo.
 */
export function directoryTlsOptions(config: Pick<LdapDirectoryConfig, "ca" | "allowWeakKey">, hostname: string): ConnectionOptions {
  return {
    servername: hostname,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    ...(config.ca ? { ca: config.ca } : {}),
    ...(config.allowWeakKey ? { ciphers: "DEFAULT@SECLEVEL=1" } : {}),
  }
}

/**
 * A senha pode ter chegado ao AD? Só as falhas da CONEXÃO (antes do pedido de bind) provam que não: erro de socket/TLS com
 * código (`ECONNREFUSED`, `CERT_…`, `ERR_TLS_…`) ou o tempo limite da conexão do ldapts ("Connection timeout"). Qualquer outra
 * coisa — tempo limite da resposta ("BindRequest: Operation timed out"), conexão fechada antes da resposta, erro desconhecido —
 * conta como enviada (na dúvida, a trava da INIA conta a falha; nunca o contrário).
 */
export function passwordMayHaveBeenSent(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/Request/.test(message)) return true
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === "string" && code.length > 0) return false
  return message !== "Connection timeout"
}

const describeError = (error: unknown) => (error instanceof Error ? (error as Error & { code?: unknown }).code ? `${String((error as Error & { code?: unknown }).code)}: ${error.message}` : error.message : String(error)).slice(0, 200)

export function createLdapDirectoryAuthenticator(config: LdapDirectoryConfig): DirectoryAuthenticator {
  if (config.urls.length === 0 || !config.domain) return unconfiguredDirectory
  return {
    configured: true,
    domain: config.domain,

    async verify(networkLogin, password) {
      // Senha vazia faria o LDAP cair em bind anônimo, que responde SUCESSO: nunca chega ao servidor.
      if (!networkLogin || !password) return { kind: "INVALID" }
      let lastProblem = "NO_SERVER"
      for (const url of config.urls) {
        const hostname = new URL(url).hostname
        const client = new Client({ url, timeout: config.timeoutMs, connectTimeout: config.timeoutMs, tlsOptions: directoryTlsOptions(config, hostname), ...(config.createSecureConnection ? { createSecureConnection: config.createSecureConnection } : {}) })
        try {
          await client.bind(`${networkLogin}@${config.domain}`, password)
          return { kind: "OK" } satisfies DirectoryVerdict
        } catch (error) {
          // Senha recusada é a resposta do AD: NUNCA tenta o próximo servidor (seriam duas falhas no bloqueio da conta de rede).
          if (error instanceof InvalidCredentialsError || (error as { code?: unknown })?.code === 49) return classifyInvalidCredentials((error as Error).message)
          // Falha DEPOIS de enviar a senha (tempo limite da resposta, conexão caída no meio): o AD pode ter contado a senha errada.
          // Nunca repete no próximo servidor — seriam duas falhas no contador do AD por uma tentativa da pessoa.
          if (passwordMayHaveBeenSent(error)) return { kind: "UNAVAILABLE", reason: `${hostname}: ${describeError(error)}`, passwordSent: true }
          lastProblem = `${hostname}: ${describeError(error)}`
        } finally {
          await client.unbind().catch(() => undefined)
        }
      }
      return { kind: "UNAVAILABLE", reason: lastProblem }
    },

    async probe() {
      const connectFn = config.createSecureConnection ?? tlsConnect
      return Promise.all(
        config.urls.map(
          (url) =>
            new Promise<DirectoryServerProbe>((resolve) => {
              const parsed = new URL(url)
              const port = parsed.port ? Number(parsed.port) : 636
              const finish = (probe: Omit<DirectoryServerProbe, "url">) => resolve({ url, ...probe })
              const socket = connectFn({ host: parsed.hostname, port, ...directoryTlsOptions(config, parsed.hostname) }, () => {
                const certificate = socket.getPeerCertificate() as PeerCertificate & { bits?: number }
                finish({ reachable: true, trusted: socket.authorized, keyBits: certificate.bits ?? null, validUntil: certificate.valid_to ? new Date(certificate.valid_to).toISOString() : null, error: null })
                socket.end()
              })
              socket.setTimeout(config.timeoutMs, () => {
                finish({ reachable: false, trusted: false, keyBits: null, validUntil: null, error: "Sem resposta no tempo limite." })
                socket.destroy()
              })
              socket.on("error", (error) => finish({ reachable: !/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/.test(String((error as { code?: string }).code)), trusted: false, keyBits: null, validUntil: null, error: describeError(error) }))
            }),
        ),
      )
    },
  }
}

let cached: DirectoryAuthenticator | null = null

/** AD da instalação, a partir do ambiente (AD_*). Configuração errada (PEM ilegível) derruba a subida com a causa. */
export function directoryFromEnv(): DirectoryAuthenticator {
  if (cached) return cached
  const urls = parseLdapUrls(env.AD_LDAP_URLS)
  const ca = env.AD_CA_FILE ? readFileSync(env.AD_CA_FILE, "utf8") : null
  cached = createLdapDirectoryAuthenticator({ urls, domain: env.AD_DOMAIN ?? "", ca, allowWeakKey: env.AD_TLS_ALLOW_WEAK_KEY === "true", timeoutMs: env.AD_TIMEOUT_MS })
  return cached
}
