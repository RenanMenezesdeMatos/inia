import { describe, expect, it } from "vitest"
import { assertOutboundDestination, destinationProblem, OutboundDestinationDenied, parseAllowList, unmapIpv4, type OutboundPolicy } from "./outbound-destination-policy.js"

/**
 * Política de destinos de saída (achados I-F3 e A-F11 da auditoria de segurança): redes privadas corporativas continuam
 * alcançáveis; metadados de nuvem, link-local, o banco interno e — em produção — a própria máquina, não.
 */
const production: OutboundPolicy = { mode: "OPEN", allowLoopback: false, allow: [], deniedEndpoints: [{ host: "10.9.9.9", port: 5432 }] }
const development: OutboundPolicy = { ...production, allowLoopback: true, deniedEndpoints: [{ host: "localhost", port: 5432 }] }

describe("política de destinos de saída", () => {
  it("bancos e APIs corporativos em redes privadas e públicas passam (requisito do produto)", () => {
    for (const address of ["10.20.30.40", "172.16.5.4", "192.168.0.10", "fd12:3456::1", "200.160.2.3"]) expect(destinationProblem(production, address, 1433, [address])).toBeNull()
    expect(destinationProblem(production, "sqlprod.empresa.local", 1433, ["10.1.2.3"])).toBeNull()
  })

  it("metadados de nuvem e link-local nunca passam — inclusive disfarçados (IPv6 mapeado, ponto final, DNS)", () => {
    expect(destinationProblem(production, "169.254.169.254", 80, ["169.254.169.254"])).toMatch(/metadados|link-local/)
    expect(destinationProblem(production, "[::ffff:a9fe:a9fe]", 80, ["::ffff:a9fe:a9fe"])).not.toBeNull()
    expect(destinationProblem(production, "::ffff:169.254.169.254", 80, ["::ffff:169.254.169.254"])).not.toBeNull()
    expect(destinationProblem(production, "metadata.google.internal.", 80, ["169.254.169.254"])).not.toBeNull()
    expect(destinationProblem(production, "169.254.169.254.nip.io", 80, ["169.254.169.254"])).not.toBeNull()
    expect(destinationProblem(production, "fd00:ec2::254", 80, ["fd00:ec2::254"])).not.toBeNull()
    expect(destinationProblem(production, "0.0.0.0", 5432, ["0.0.0.0"])).not.toBeNull()
    // Um endereço ruim entre vários basta (o driver pode escolher qualquer um).
    expect(destinationProblem(production, "misto.example", 443, ["200.1.1.1", "169.254.1.1"])).not.toBeNull()
  })

  it("loopback: recusado em produção; aceito em desenvolvimento, menos o banco interno", () => {
    expect(destinationProblem(production, "localhost", 11434, ["127.0.0.1"])).toMatch(/loopback/)
    expect(destinationProblem(production, "127.0.0.2", 5432, ["127.0.0.2"])).toMatch(/loopback/)
    expect(destinationProblem(development, "127.0.0.1", 55432, ["127.0.0.1"])).toBeNull()
    expect(destinationProblem(development, "localhost", 5432, ["127.0.0.1"])).toMatch(/banco interno/)
    expect(destinationProblem(production, "10.9.9.9", 5432, ["10.9.9.9"])).toMatch(/banco interno/)
    expect(destinationProblem(production, "10.9.9.9", 5433, ["10.9.9.9"])).toBeNull()
  })

  it("liberação explícita (por host, CIDR e porta) e modo lista de permissões", () => {
    const allowLocalOllama: OutboundPolicy = { ...production, allow: parseAllowList("127.0.0.1:11434") }
    expect(destinationProblem(allowLocalOllama, "localhost", 11434, ["127.0.0.1"])).toBeNull()
    expect(destinationProblem(allowLocalOllama, "localhost", 5432, ["127.0.0.1"])).not.toBeNull()
    const allowlist: OutboundPolicy = { ...production, mode: "ALLOWLIST", allow: parseAllowList("10.20.0.0/16, *.empresa.local:1433, [fd12::1]:5432") }
    expect(destinationProblem(allowlist, "10.20.1.1", 5432, ["10.20.1.1"])).toBeNull()
    expect(destinationProblem(allowlist, "10.21.1.1", 5432, ["10.21.1.1"])).toMatch(/lista/)
    expect(destinationProblem(allowlist, "sql.empresa.local", 1433, ["10.99.0.1"])).toBeNull()
    expect(destinationProblem(allowlist, "sql.empresa.local", 3306, ["10.99.0.1"])).toMatch(/lista/)
    expect(destinationProblem(allowlist, "fd12::1", 5432, ["fd12::1"])).toBeNull()
  })

  it("nome que não resolve e porta inválida são recusados; a recusa é um erro tipado", async () => {
    expect(destinationProblem(production, "nao-existe.invalid", 443, [])).toMatch(/resolveu/)
    expect(destinationProblem(production, "10.0.0.1", 0, ["10.0.0.1"])).toMatch(/porta/)
    await expect(assertOutboundDestination(production, "metadata", 80, async () => ["169.254.169.254"])).rejects.toBeInstanceOf(OutboundDestinationDenied)
    await expect(assertOutboundDestination(production, "db.empresa.local", 5432, async () => ["10.1.1.1"])).resolves.toBeUndefined()
    await expect(assertOutboundDestination(production, "falha.dns", 5432, async () => { throw new Error("ENOTFOUND") })).rejects.toBeInstanceOf(OutboundDestinationDenied)
  })

  it("desembrulha IPv4 mapeado em IPv6", () => {
    expect(unmapIpv4("::ffff:a9fe:a9fe")).toBe("169.254.169.254")
    expect(unmapIpv4("::ffff:10.0.0.1")).toBe("10.0.0.1")
    expect(unmapIpv4("fd12::1")).toBe("fd12::1")
  })
})
