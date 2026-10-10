import { describe, expect, it } from "vitest"
import { DataRunError } from "../domain/error-codes.js"
import type { SourceConfig } from "../domain/source-config.js"
import { FetchHttpClient } from "../infrastructure/fetch-http-client.js"
import { buildUrl } from "./connectors/api-pull-connector.js"
import { secretTargetOf } from "./source-service.js"

/**
 * Achado I-F2 da auditoria de segurança: credencial guardada da Central de Dados não pode ser levada para outro destino
 * (trocar host/usuário/URL e manter a senha; endpoint absoluto do feed; teste de rascunho contra outro servidor).
 */
const database = (overrides: Partial<Extract<SourceConfig, { kind: "DATABASE" }>["database"]> = {}): SourceConfig => ({
  kind: "DATABASE",
  database: { engine: "POSTGRESQL", host: "db.empresa.local", port: 5432, database: "crm", username: "inia_leitura", tls: { mode: "VERIFY_FULL" }, connectTimeoutMs: 15_000, queryTimeoutMs: 120_000, ...overrides },
})
const api = (baseUrl: string, auth: Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"] = { kind: "BEARER" }): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth, headers: {}, timeoutMs: 30_000 } })

describe("credencial vinculada ao destino", () => {
  it("banco: servidor, porta, usuário ou TLS diferente = outro destino; trocar só o banco/timeout não", () => {
    const base = secretTargetOf(database())
    expect(secretTargetOf(database({ database: "outro_banco", queryTimeoutMs: 60_000 }))).toBe(base)
    expect(secretTargetOf(database({ host: "DB.EMPRESA.LOCAL " }))).toBe(base)
    for (const changed of [database({ host: "atacante.example" }), database({ port: 6543 }), database({ username: "sa" }), database({ tls: { mode: "DISABLED" } }), database({ engine: "MYSQL" })]) {
      expect(secretTargetOf(changed)).not.toBe(base)
    }
  })

  it("API: origem da baseUrl, tipo de autenticação, URL do token OAuth e nome do cabeçalho fazem parte do destino", () => {
    const base = secretTargetOf(api("https://api.empresa.com/v1"))
    expect(secretTargetOf(api("https://api.empresa.com/v2/outro"))).toBe(base)
    expect(secretTargetOf(api("https://api.atacante.example/v1"))).not.toBe(base)
    expect(secretTargetOf(api("http://api.empresa.com/v1"))).not.toBe(base)
    const oauth = (tokenUrl: string) => secretTargetOf(api("https://api.empresa.com", { kind: "OAUTH2_CLIENT_CREDENTIALS", tokenUrl, clientId: "inia" }))
    expect(oauth("https://login.empresa.com/token")).not.toBe(oauth("https://login.atacante.example/token"))
  })

  it("SFTP: host, porta, usuário e forma de autenticação", () => {
    const sftp = (host: string, username = "inia"): SourceConfig => ({ kind: "SFTP", sftp: { host, port: 22, username, remoteDirectory: "/", authKind: "PASSWORD", timeoutMs: 30_000 } })
    expect(secretTargetOf(sftp("sftp.empresa.local"))).not.toBe(secretTargetOf(sftp("sftp.atacante.example")))
    expect(secretTargetOf(sftp("sftp.empresa.local"))).not.toBe(secretTargetOf(sftp("sftp.empresa.local", "root")))
  })

  it("endpoint do feed fica na origem da fonte (relativo ou absoluto na mesma origem)", () => {
    expect(buildUrl("https://api.empresa.com/v1", "pessoas", { page: "2" })).toBe("https://api.empresa.com/v1/pessoas?page=2")
    expect(buildUrl("https://api.empresa.com/v1", "https://api.empresa.com/v2/pessoas", {})).toBe("https://api.empresa.com/v2/pessoas")
    for (const endpoint of ["https://atacante.example/coleta", "http://api.empresa.com/v1/pessoas", "//atacante.example/x", "file:///etc/passwd"]) {
      if (endpoint.startsWith("//")) {
        expect(new URL(buildUrl("https://api.empresa.com/v1", endpoint, {})).origin).toBe("https://api.empresa.com")
        continue
      }
      expect(() => buildUrl("https://api.empresa.com/v1", endpoint, {})).toThrow(DataRunError)
    }
  })

  it("o cliente HTTP real recusa destino fora da política antes de abrir conexão", async () => {
    const client = new FetchHttpClient({ mode: "OPEN", allowLoopback: false, allow: [], deniedEndpoints: [] })
    for (const url of ["http://169.254.169.254/latest/meta-data/", "http://[::ffff:a9fe:a9fe]/", "http://127.0.0.1:5432/", "ftp://arquivos.empresa.com/x", "https://user:senha@api.empresa.com/"]) {
      const error = await client.send({ url, method: "GET", headers: {}, timeoutMs: 1000 }).catch((caught: unknown) => caught)
      expect(error).toBeInstanceOf(DataRunError)
      expect((error as DataRunError).code).toBe("DATA_SOURCE_DESTINATION_DENIED")
    }
  })
})
