import { Duplex } from "node:stream"
import type { connect as tlsConnect } from "node:tls"
import { describe, expect, it } from "vitest"
import { createLdapDirectoryAuthenticator, directoryTlsOptions, parseLdapUrls, passwordMayHaveBeenSent } from "./ldap-directory-authenticator.js"

describe("configuração do AD", () => {
  it("só aceita ldaps:// (senha de rede nunca trafega aberta)", () => {
    expect(parseLdapUrls("ldaps://dc1.empresa.local:636, ldap://dc2.empresa.local:389 , https://x, ,ldaps://dc3.empresa.local")).toEqual(["ldaps://dc1.empresa.local:636", "ldaps://dc3.empresa.local"])
    expect(parseLdapUrls(undefined)).toEqual([])
  })
  it("sem servidores ou domínio: não configurado", () => {
    expect(createLdapDirectoryAuthenticator({ urls: [], domain: "empresa.local", ca: null, allowWeakKey: false, timeoutMs: 1000 }).configured).toBe(false)
    expect(createLdapDirectoryAuthenticator({ urls: ["ldaps://dc1"], domain: "", ca: null, allowWeakKey: false, timeoutMs: 1000 }).configured).toBe(false)
  })
  it("TLS sempre confere cadeia e nome; chave fraca só baixa o nível do OpenSSL", () => {
    expect(directoryTlsOptions({ ca: "PEM", allowWeakKey: false }, "dc1.empresa.local")).toEqual({ servername: "dc1.empresa.local", rejectUnauthorized: true, minVersion: "TLSv1.2", ca: "PEM" })
    expect(directoryTlsOptions({ ca: null, allowWeakKey: true }, "dc1")).toMatchObject({ rejectUnauthorized: true, ciphers: "DEFAULT@SECLEVEL=1" })
  })
})

describe("conferência da senha", () => {
  /** Conexão que falha na hora (servidor fora do ar) e anota em qual servidor tentou. */
  const failingConnections = (tried: string[]) =>
    ((...args: unknown[]) => {
      // ldapts chama (porta, host, opções TLS); a conferência dos servidores chama ({ host, ... }).
      tried.push(String(typeof args[1] === "string" ? args[1] : (args[0] as { host?: string }).host))
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
      setImmediate(() => socket.emit("error", Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })))
      return socket
    }) as unknown as typeof tlsConnect

  it("senha vazia nunca chega ao servidor (bind anônimo responderia sucesso)", async () => {
    const tried: string[] = []
    const directory = createLdapDirectoryAuthenticator({ urls: ["ldaps://dc1"], domain: "empresa.local", ca: null, allowWeakKey: false, timeoutMs: 1000, createSecureConnection: failingConnections(tried) })
    expect(await directory.verify("G0055350", "")).toEqual({ kind: "INVALID" })
    expect(tried).toEqual([])
  })
  it("servidor fora do ar: tenta o seguinte; todos fora = indisponível", async () => {
    const tried: string[] = []
    const directory = createLdapDirectoryAuthenticator({ urls: ["ldaps://dc1.empresa.local", "ldaps://dc2.empresa.local"], domain: "empresa.local", ca: null, allowWeakKey: false, timeoutMs: 1000, createSecureConnection: failingConnections(tried) })
    expect(await directory.verify("G0055350", "Rede#2026")).toMatchObject({ kind: "UNAVAILABLE" })
    expect(tried).toEqual(["dc1.empresa.local", "dc2.empresa.local"])
  })
  /** Conexão que abre, recebe o bind e nunca responde (AD lento depois de receber a senha). */
  const silentConnections = (tried: string[]) =>
    ((...args: unknown[]) => {
      tried.push(String(typeof args[1] === "string" ? args[1] : (args[0] as { host?: string }).host))
      const socket = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } })
      Object.assign(socket, { connecting: false, readyState: "open" })
      setImmediate(() => socket.emit("secureConnect"))
      setImmediate(() => socket.emit("connect"))
      return socket
    }) as unknown as typeof tlsConnect
  it("senha enviada sem resposta: indisponível marcado e NUNCA repete no servidor seguinte", async () => {
    const tried: string[] = []
    const directory = createLdapDirectoryAuthenticator({ urls: ["ldaps://dc1.empresa.local", "ldaps://dc2.empresa.local"], domain: "empresa.local", ca: null, allowWeakKey: false, timeoutMs: 1000, createSecureConnection: silentConnections(tried) })
    expect(await directory.verify("G0055350", "Rede#2026")).toMatchObject({ kind: "UNAVAILABLE", passwordSent: true })
    expect(tried).toEqual(["dc1.empresa.local"])
  })
  it("só falha de conexão prova que a senha não saiu", () => {
    expect(passwordMayHaveBeenSent(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(false)
    expect(passwordMayHaveBeenSent(Object.assign(new Error("certificate has expired"), { code: "CERT_HAS_EXPIRED" }))).toBe(false)
    expect(passwordMayHaveBeenSent(new Error("Connection timeout"))).toBe(false)
    expect(passwordMayHaveBeenSent(new Error("BindRequest: Operation timed out"))).toBe(true)
    expect(passwordMayHaveBeenSent(new Error("Connection closed before message response was received. Message type: BindRequest (0x60)"))).toBe(true)
    expect(passwordMayHaveBeenSent(new Error("algo desconhecido"))).toBe(true)
  })
})
