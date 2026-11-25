import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer, type TLSSocket } from "node:tls"

/**
 * AD DE MENTIRA (LDAPS de verdade): TLS com certificado próprio e bind simples no protocolo LDAP v3, para as provas exercitarem o
 * adaptador real (ldapts + TLS) sem o AD da empresa. Responde como o AD: sucesso ou resultado 49 com `data <código>` no texto.
 * Conta as senhas erradas por conta como o AD faria (`failures`) — é o que prova que a INIA não bloqueia a conta de rede.
 */
export type FakeDirectoryUser = {
  password: string
  /** Código devolvido mesmo com a senha certa (532, 533, 775…). */
  code?: string
  /** ID funcional (`employeeID`) da conta; ausente = sem o atributo. */
  employeeId?: string
  /** Login (sem domínio) do nome completo explícito (`userPrincipalName`) desta conta: o bind por ele entra NESTA conta. */
  upn?: string
  /** O AD não deixa esta conta ler a própria ficha. */
  searchDenied?: boolean
}
export type FakeLdapsServer = {
  url: string
  ca: string
  users: Map<string, FakeDirectoryUser>
  /** Binds recebidos, na ordem (só o login; a senha nunca é guardada). */
  binds: string[]
  /** Pesquisas recebidas, na ordem: quem pesquisou e o login procurado. */
  searches: { by: string; login: string; base: string }[]
  failures: Map<string, number>
  /** Não responde ao bind (AD lento): a INIA precisa tratar como "senha enviada sem resposta". */
  setSilent(value: boolean): void
  close(): Promise<void>
}

/** Cadeia de 1 certificado para `localhost`, gerada na hora (nada de chave privada no repositório). */
export function createLocalhostCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "inia-fake-ad-"))
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "key.pem"), "-out", join(dir, "cert.pem"), "-days", "2", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost"], { stdio: "ignore" })
    return { key: readFileSync(join(dir, "key.pem"), "utf8"), cert: readFileSync(join(dir, "cert.pem"), "utf8") }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const tlv = (tag: number, value: Buffer) => {
  const length = value.length < 128 ? Buffer.from([value.length]) : value.length < 256 ? Buffer.from([0x81, value.length]) : Buffer.from([0x82, value.length >> 8, value.length & 0xff])
  return Buffer.concat([Buffer.from([tag]), length, value])
}

/** Lê um elemento BER (tag, valor, resto); null = ainda não chegou inteiro. */
function readTlv(buffer: Buffer): { tag: number; value: Buffer; rest: Buffer } | null {
  if (buffer.length < 2) return null
  let length = buffer[1]!
  let offset = 2
  if (length & 0x80) {
    const bytes = length & 0x7f
    if (buffer.length < 2 + bytes) return null
    length = buffer.readUIntBE(2, bytes)
    offset = 2 + bytes
  }
  if (buffer.length < offset + length) return null
  return { tag: buffer[0]!, value: buffer.subarray(offset, offset + length), rest: buffer.subarray(offset + length) }
}

const BIND_REQUEST = 0x60
const UNBIND_REQUEST = 0x42
const SEARCH_REQUEST = 0x63
const text = (value: string) => tlv(0x04, Buffer.from(value, "utf8"))
const searchDone = (messageId: Buffer, resultCode: number) =>
  tlv(0x30, Buffer.concat([tlv(0x02, messageId), tlv(0x65, Buffer.concat([tlv(0x0a, Buffer.from([resultCode])), text(""), text("")]))]))
const searchEntry = (messageId: Buffer, dn: string, attributes: Record<string, string>) =>
  tlv(0x30, Buffer.concat([tlv(0x02, messageId), tlv(0x64, Buffer.concat([text(dn), tlv(0x30, Buffer.concat(Object.entries(attributes).map(([name, value]) => tlv(0x30, Buffer.concat([text(name), tlv(0x31, text(value))])))))]))]))
const bindResponse = (messageId: Buffer, resultCode: number, message: string) =>
  tlv(0x30, Buffer.concat([tlv(0x02, messageId), tlv(0x61, Buffer.concat([tlv(0x0a, Buffer.from([resultCode])), tlv(0x04, Buffer.alloc(0)), tlv(0x04, Buffer.from(message, "utf8"))]))]))

export async function startFakeLdapsServer(options: { domain: string; users?: Record<string, FakeDirectoryUser>; port?: number; certificate?: { key: string; cert: string } }): Promise<FakeLdapsServer> {
  const { key, cert } = options.certificate ?? createLocalhostCertificate()
  const users = new Map(Object.entries(options.users ?? {}).map(([login, user]) => [login.toLowerCase(), user]))
  const binds: string[] = []
  const searches: FakeLdapsServer["searches"] = []
  const failures = new Map<string, number>()
  const sockets = new Set<TLSSocket>()
  let silent = false
  /** Como o AD: o nome completo explícito de alguém vale antes do login de outra conta. */
  const resolve = (account: string) => [...users.values()].find((user) => user.upn?.toLowerCase() === account) ?? users.get(account)
  const answer = (login: string, password: string): { code: number; message: string } => {
    const refuse = (data: string) => ({ code: 49, message: `80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${data}, v4563` })
    const suffix = `@${options.domain.toLowerCase()}`
    const account = login.toLowerCase().endsWith(suffix) ? login.toLowerCase().slice(0, -suffix.length) : null
    const user = account ? resolve(account) : undefined
    if (!account || !user) return refuse("52e")
    // Como o AD: conta bloqueada responde 775 antes de olhar a senha; senha errada conta no contador da conta.
    if (user.code === "775") return refuse("775")
    if (user.password !== password) {
      const owner = [...users.entries()].find(([, candidate]) => candidate === user)![0]
      failures.set(owner, (failures.get(owner) ?? 0) + 1)
      return refuse("52e")
    }
    return user.code ? refuse(user.code) : { code: 0, message: "" }
  }
  const server = createServer({ key, cert }, (socket) => {
    sockets.add(socket)
    socket.on("close", () => sockets.delete(socket))
    socket.on("error", () => undefined)
    let pending = Buffer.alloc(0)
    let bound: string | null = null
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk])
      for (let message = readTlv(pending); message; message = readTlv(pending)) {
        pending = Buffer.from(message.rest)
        const id = readTlv(message.value)
        const operation = id ? readTlv(id.rest) : null
        if (!id || !operation || operation.tag === UNBIND_REQUEST) return void socket.end()
        if (operation.tag === SEARCH_REQUEST) {
          const messageId = Buffer.from(id.value)
          const base = readTlv(operation.value)!
          // scope, deref, sizeLimit, timeLimit e typesOnly vêm antes do filtro (equalityMatch = 0xa3: atributo, valor).
          let cursor = base.rest
          for (let skip = 0; skip < 5; skip += 1) cursor = readTlv(cursor)!.rest
          // Filtro: equalityMatch (0xa3) ou um OR (0xa1) deles.
          const filter = readTlv(cursor)!
          const terms: [string, string][] = []
          const term = (value: Buffer) => { const name = readTlv(value)!; terms.push([name.value.toString("utf8"), readTlv(name.rest)!.value.toString("utf8").toLowerCase()]) }
          if (filter.tag === 0xa3) term(filter.value)
          else for (let part = readTlv(filter.value); part; part = readTlv(part.rest)) term(part.value)
          const login = (terms.find(([name]) => name === "sAMAccountName")?.[1] ?? "").toUpperCase()
          const owner = bound ? resolve(bound) : undefined
          searches.push({ by: bound ?? "", login, base: base.value.toString("utf8") })
          if (!owner || owner.searchDenied) {
            socket.write(searchDone(messageId, 50))
            continue
          }
          for (const [sam, found] of users) {
            const matches = terms.some(([name, value]) => (name === "sAMAccountName" ? sam === value : name === "userPrincipalName" && found.upn !== undefined && `${found.upn}@${options.domain}`.toLowerCase() === value))
            if (matches) socket.write(searchEntry(messageId, `CN=${sam},DC=empresa,DC=local`, { sAMAccountName: sam.toUpperCase(), ...(found.employeeId ? { employeeID: found.employeeId } : {}) }))
          }
          socket.write(searchDone(messageId, 0))
          continue
        }
        if (operation.tag !== BIND_REQUEST) return void socket.destroy()
        const version = readTlv(operation.value)!
        const name = readTlv(version.rest)!
        const credential = readTlv(name.rest)!
        const login = name.value.toString("utf8")
        binds.push(login)
        if (silent) return
        const result = answer(login, credential.value.toString("utf8"))
        bound = result.code === 0 ? login.toLowerCase().slice(0, -(options.domain.length + 1)) : null
        socket.write(bindResponse(Buffer.from(id.value), result.code, result.message))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "localhost", resolve))
  const address = server.address() as { port: number }
  return {
    url: `ldaps://localhost:${address.port}`, ca: cert, users, binds, searches, failures,
    setSilent(value) { silent = value },
    close: () => new Promise((resolve) => { for (const socket of sockets) socket.destroy(); server.close(() => resolve()) }),
  }
}
