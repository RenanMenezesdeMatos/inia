import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

/**
 * POLÍTICA DE DESTINOS DE SAÍDA — para onde o SERVIDOR da INIA aceita abrir conexão a pedido de uma configuração feita na
 * tela (Central de Dados: API, SFTP, bancos externos; IA: endpoints de provedores). Protege contra SSRF: um administrador (ou
 * uma credencial dele roubada) apontar a INIA para serviços internos que só o servidor alcança.
 *
 * A INIA PRECISA alcançar bancos e APIs corporativos em redes privadas — por isso redes privadas (10/8, 172.16/12,
 * 192.168/16, fc00::/7) NÃO são bloqueadas por padrão. O que nunca é destino legítimo de integração fica fechado:
 *   - metadados de nuvem e link-local (169.254.0.0/16, fe80::/10, fd00:ec2::254, nomes `metadata*`);
 *   - endereços não roteáveis (0.0.0.0/8, ::, multicast, reservados);
 *   - o PRÓPRIO banco interno da INIA (host:porta do DATABASE_URL) — a Central nunca lê o banco da própria INIA;
 *   - loopback (127/8, ::1, localhost) EM PRODUÇÃO — a própria máquina roda a API, a interface e às vezes o banco.
 *     Em desenvolvimento/teste o loopback é aceito (bancos de exemplo no Docker, Ollama local).
 *
 * Configuração (variáveis do backend, decididas por quem administra o SERVIDOR, não pela tela):
 *   INIA_OUTBOUND_MODE = OPEN (padrão: tudo menos o bloqueado acima) | ALLOWLIST (só os destinos listados).
 *   INIA_OUTBOUND_ALLOWED_DESTINATIONS = lista separada por vírgula de `host`, `*.dominio`, `IP`, `CIDR`, com `:porta`
 *     opcional (ex.: `10.20.0.0/16, sqlprod.empresa.local:1433, 127.0.0.1:11434`). Um destino listado é aceito mesmo se
 *     cair numa faixa fechada (ex.: Ollama no próprio servidor em produção).
 *
 * Limitação: o nome é resolvido e conferido ANTES de conectar; o driver resolve de novo ao conectar (DNS rebinding com TTL
 * zero continua teoricamente possível). Ver docs/security/pendencias-e-riscos.md.
 */
export type OutboundPurpose = "DATA_HUB" | "AI_PROVIDER"

type AllowEntry = { kind: "CIDR"; family: "ipv4" | "ipv6"; address: string; prefix: number; port: number | null } | { kind: "HOST"; host: string; wildcard: boolean; port: number | null }

export type OutboundPolicy = {
  mode: "OPEN" | "ALLOWLIST"
  allowLoopback: boolean
  allow: readonly AllowEntry[]
  /** Destinos sempre negados além das faixas fixas (ex.: o banco interno). */
  deniedEndpoints: readonly { host: string; port: number }[]
}

export class OutboundDestinationDenied extends Error {
  constructor(readonly host: string, readonly port: number, readonly reason: string) {
    super(`Destino não permitido pela política de saída da INIA (${host}:${port}): ${reason}`)
    this.name = "OutboundDestinationDenied"
  }
}

const ALWAYS_DENIED = new BlockList()
ALWAYS_DENIED.addSubnet("0.0.0.0", 8, "ipv4")
ALWAYS_DENIED.addSubnet("169.254.0.0", 16, "ipv4")
ALWAYS_DENIED.addSubnet("224.0.0.0", 4, "ipv4")
ALWAYS_DENIED.addSubnet("240.0.0.0", 4, "ipv4")
ALWAYS_DENIED.addAddress("::", "ipv6")
ALWAYS_DENIED.addSubnet("fe80::", 10, "ipv6")
ALWAYS_DENIED.addSubnet("ff00::", 8, "ipv6")
ALWAYS_DENIED.addAddress("fd00:ec2::254", "ipv6")

const LOOPBACK = new BlockList()
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4")
LOOPBACK.addAddress("::1", "ipv6")

const DENIED_HOST_NAMES = new Set(["metadata", "metadata.google.internal", "instance-data", "instance-data.ec2.internal"])

/** Nome canônico: minúsculas, sem colchetes de IPv6, sem ponto final (`metadata.google.internal.`). */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.+$/, "")
}

/** `::ffff:a.b.c.d` / `::ffff:a9fe:a9fe` → IPv4 (senão a faixa IPv4 bloqueada seria contornada pela forma IPv6). */
export function unmapIpv4(address: string): string {
  const lower = address.toLowerCase()
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower)
  if (dotted) return dotted[1]!
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower)
  if (hex) {
    const high = parseInt(hex[1]!, 16)
    const low = parseInt(hex[2]!, 16)
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
  }
  return address
}

function familyOf(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 4 ? "ipv4" : "ipv6"
}

export function parseAllowList(value: string | undefined): AllowEntry[] {
  if (!value) return []
  const entries: AllowEntry[] = []
  for (const raw of value.split(",").map((item) => item.trim()).filter(Boolean)) {
    // Porta opcional no fim (`host:1433`, `10.0.0.0/8:5432`, `[::1]:11434`); IPv6 puro sem colchetes não leva porta.
    let target = raw
    let port: number | null = null
    const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(raw)
    if (bracketed) {
      target = bracketed[1]!
      port = bracketed[2] ? Number(bracketed[2]) : null
    } else if (raw.split(":").length === 2) {
      const [host, portText] = raw.split(":")
      if (/^\d+$/.test(portText!)) {
        target = host!
        port = Number(portText)
      }
    }
    const [address, prefixText] = target.split("/")
    const normalized = normalizeHost(address!)
    if (isIP(normalized)) {
      const family = familyOf(normalized)
      const prefix = prefixText === undefined ? (family === "ipv4" ? 32 : 128) : Number(prefixText)
      if (Number.isInteger(prefix) && prefix >= 0 && prefix <= (family === "ipv4" ? 32 : 128)) entries.push({ kind: "CIDR", family, address: normalized, prefix, port })
      continue
    }
    if (normalized.length > 0) entries.push({ kind: "HOST", host: normalized.replace(/^\*\./, ""), wildcard: normalized.startsWith("*."), port })
  }
  return entries
}

function hostMatches(entry: Extract<AllowEntry, { kind: "HOST" }>, host: string): boolean {
  return entry.wildcard ? host.endsWith(`.${entry.host}`) : host === entry.host
}

function addressMatches(entry: Extract<AllowEntry, { kind: "CIDR" }>, address: string): boolean {
  const list = new BlockList()
  list.addSubnet(entry.address, entry.prefix, entry.family)
  return list.check(address, familyOf(address))
}

/** O destino (nome pedido + endereços resolvidos + porta) foi liberado explicitamente? */
function explicitlyAllowed(policy: OutboundPolicy, host: string, addresses: readonly string[], port: number): boolean {
  return policy.allow.some((entry) => {
    if (entry.port !== null && entry.port !== port) return false
    if (entry.kind === "HOST") return hostMatches(entry, host)
    return addresses.length > 0 && addresses.every((address) => addressMatches(entry, address))
  })
}

/**
 * Decisão PURA (testável sem rede): `addresses` = todos os endereços que o nome resolve. Devolve o motivo da recusa ou null.
 * Um endereço ruim entre vários basta para recusar (o driver pode escolher qualquer um).
 */
export function destinationProblem(policy: OutboundPolicy, rawHost: string, port: number, rawAddresses: readonly string[]): string | null {
  const host = normalizeHost(rawHost)
  const addresses = rawAddresses.map((address) => unmapIpv4(normalizeHost(address)))
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return "porta inválida"
  if (explicitlyAllowed(policy, host, addresses, port)) return null
  if (DENIED_HOST_NAMES.has(host) || host.startsWith("metadata.")) return "serviço de metadados de nuvem"
  if (addresses.length === 0) return "o nome não resolveu para nenhum endereço"
  for (const address of addresses) {
    const family = familyOf(address)
    if (ALWAYS_DENIED.check(address, family)) return "endereço link-local, de metadados de nuvem ou não roteável"
    if (!policy.allowLoopback && (LOOPBACK.check(address, family) || host === "localhost" || host.endsWith(".localhost"))) return "a própria máquina do servidor (loopback) só com liberação explícita"
  }
  for (const denied of policy.deniedEndpoints) {
    if (denied.port === port && (normalizeHost(denied.host) === host || addresses.includes(unmapIpv4(normalizeHost(denied.host))))) return "o banco interno da própria INIA"
  }
  if (policy.mode === "ALLOWLIST") return "fora da lista de destinos permitidos (INIA_OUTBOUND_ALLOWED_DESTINATIONS)"
  return null
}

export type HostResolver = (host: string) => Promise<string[]>

export const systemResolver: HostResolver = async (host) => {
  const normalized = normalizeHost(host)
  if (isIP(normalized)) return [normalized]
  const results = await lookup(normalized, { all: true, verbatim: true })
  return results.map((result) => result.address)
}

/** Confere o destino ANTES de conectar; nome que não resolve = recusa (o driver falharia de qualquer forma). */
export async function assertOutboundDestination(policy: OutboundPolicy, host: string, port: number, resolve: HostResolver = systemResolver): Promise<void> {
  let addresses: string[] = []
  try {
    addresses = await resolve(host)
  } catch {
    addresses = []
  }
  const problem = destinationProblem(policy, host, port, addresses)
  if (problem) throw new OutboundDestinationDenied(normalizeHost(host), port, problem)
}

/** Porta efetiva de uma URL http(s) (a URL omite a porta padrão). */
export function urlPort(url: URL): number {
  if (url.port) return Number(url.port)
  return url.protocol === "https:" ? 443 : 80
}
