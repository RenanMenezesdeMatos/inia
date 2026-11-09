import { createHash } from "node:crypto"
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2"
import { outboundPolicy } from "../../../config/outbound-policy.js"
import { assertOutboundDestination, OutboundDestinationDenied } from "../../../shared/infrastructure/outbound-destination-policy.js"
import type { SftpClient, SftpConnection, SftpFileEntry } from "../application/ports.js"
import { DataRunError, NOT_A_CREDENTIAL_REFUSAL } from "../domain/error-codes.js"

/** Teto de um arquivo baixado por SFTP (ele vai inteiro para a memória e para o armazenamento bruto). */
export const MAX_SFTP_DOWNLOAD_BYTES = 200 * 1024 * 1024

/**
 * SftpClient real (ssh2). Verificação de host key: se a fonte informa `hostKeyFingerprint`
 * (SHA-256 base64, formato do OpenSSH), a conexão só é aceita se bater; sem fingerprint
 * configurada a conexão é aceita e a fingerprint observada volta no erro/telemetria para o admin
 * fixá-la (TOFU explícito, nunca "desligado silenciosamente").
 */
export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`
}

async function withSftp<T>(connection: SftpConnection, work: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  try {
    await assertOutboundDestination(outboundPolicy, connection.host, connection.port)
  } catch (error) {
    if (error instanceof OutboundDestinationDenied) throw new DataRunError("DATA_SOURCE_DESTINATION_DENIED", error.message)
    throw error
  }
  const client = new Client()
  const config: ConnectConfig = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
    readyTimeout: connection.timeoutMs,
    hostVerifier: (key: Buffer) => {
      const observed = hostKeyFingerprint(key)
      connection.onHostKey?.(observed)
      // Sem fingerprint fixada: primeira conexão (TOFU) — a aplicação grava a observada e as próximas passam a exigir a mesma.
      if (!connection.hostKeyFingerprint) return true
      const expected = connection.hostKeyFingerprint.startsWith("SHA256:") ? connection.hostKeyFingerprint : `SHA256:${connection.hostKeyFingerprint}`
      return observed.replace(/=+$/, "") === expected.replace(/=+$/, "")
    },
  }
  if (connection.password !== undefined) config.password = connection.password
  if (connection.privateKey !== undefined) config.privateKey = connection.privateKey
  if (connection.passphrase !== undefined) config.passphrase = connection.passphrase

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const fail = (error: DataRunError) => {
      if (settled) return
      settled = true
      client.end()
      reject(error)
    }
    client.on("ready", () => {
      client.sftp((error, sftp) => {
        if (error) return fail(new DataRunError("DATA_SOURCE_UNREACHABLE", `Não foi possível abrir a sessão SFTP (${error.message}).`))
        work(sftp)
          .then((result) => {
            settled = true
            client.end()
            resolve(result)
          })
          .catch((workError: unknown) => fail(workError instanceof DataRunError ? workError : new DataRunError("DATA_SOURCE_UNREACHABLE", workError instanceof Error ? workError.message : "Erro no SFTP.")))
      })
    })
    client.on("error", (error: Error & { level?: string }) => {
      if (error.level === "client-authentication") return fail(new DataRunError("DATA_SOURCE_AUTH_FAILED", "Usuário, senha ou chave privada recusados pelo servidor SFTP."))
      if (/host.*verif|hostVerifier/i.test(error.message)) return fail(new DataRunError("DATA_SOURCE_AUTH_FAILED", "A host key do servidor não confere com a fingerprint configurada.", NOT_A_CREDENTIAL_REFUSAL))
      if (/timeout/i.test(error.message)) return fail(new DataRunError("DATA_SOURCE_TIMEOUT", `O servidor SFTP não respondeu em ${connection.timeoutMs} ms.`))
      fail(new DataRunError("DATA_SOURCE_UNREACHABLE", `Não foi possível conectar ao SFTP (${error.message}).`))
    })
    client.connect(config)
  })
}

export class Ssh2SftpClient implements SftpClient {
  async list(connection: SftpConnection, directory: string): Promise<SftpFileEntry[]> {
    return withSftp(connection, (sftp) =>
      new Promise<SftpFileEntry[]>((resolve, reject) => {
        sftp.readdir(directory, (error, entries) => {
          if (error) return reject(new DataRunError("DATA_SOURCE_UNREACHABLE", `Não foi possível listar "${directory}" (${error.message}).`))
          resolve(
            entries
              .filter((entry) => !entry.attrs.isDirectory())
              .map((entry) => ({
                name: entry.filename,
                path: `${directory.replace(/\/$/, "")}/${entry.filename}`,
                size: entry.attrs.size,
                modifiedAt: entry.attrs.mtime ? new Date(entry.attrs.mtime * 1000).toISOString() : null,
              })),
          )
        })
      }),
    )
  }

  async download(connection: SftpConnection, path: string): Promise<Uint8Array> {
    return withSftp(connection, (sftp) =>
      new Promise<Uint8Array>((resolve, reject) => {
        const chunks: Buffer[] = []
        let total = 0
        const stream = sftp.createReadStream(path)
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length
          if (total > MAX_SFTP_DOWNLOAD_BYTES) {
            stream.destroy()
            reject(new DataRunError("DATA_SOURCE_VOLUME_LIMIT", `O arquivo "${path}" passa de ${MAX_SFTP_DOWNLOAD_BYTES / 1024 / 1024} MB — divida a exportação em arquivos menores.`))
            return
          }
          chunks.push(chunk)
        })
        stream.on("error", (error: Error) => reject(new DataRunError("DATA_SOURCE_UNREACHABLE", `Não foi possível baixar "${path}" (${error.message}).`)))
        stream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))))
      }),
    )
  }
}
