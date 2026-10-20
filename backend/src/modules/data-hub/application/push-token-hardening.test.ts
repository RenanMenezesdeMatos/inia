import express from "express"
import request from "supertest"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { insecureCredentialTransportWarning, type SourceConfig } from "../domain/source-config.js"
import { createDataIngestionRouter } from "../presentation/data-ingestion-router.js"
import { clientInNetworks } from "./push-ingestion.js"
import { normalizeAllowedNetwork, pushTokenInputSchema } from "./source-service.js"

/** API Push endurecida (R-28/R-29): redes autorizadas do token, autenticação antes do corpo e aviso de credencial por http://. */
describe("token de push — redes autorizadas", () => {
  it("aceita IP e CIDR (v4 e v6) e recusa o resto", () => {
    expect(normalizeAllowedNetwork(" 10.0.0.5 ")).toBe("10.0.0.5")
    expect(normalizeAllowedNetwork("10.0.0.0/24")).toBe("10.0.0.0/24")
    expect(normalizeAllowedNetwork("2001:db8::/32")).toBe("2001:db8::/32")
    for (const invalid of ["10.0.0.0/33", "10.0.0/24", "intranet.local", "10.0.0.0/2/4", "10.0.0.0/abc", ""]) expect(normalizeAllowedNetwork(invalid)).toBeNull()
  })

  it("o esquema normaliza, remove repetidos, trata lista vazia como 'qualquer origem' e recusa rede inválida", () => {
    expect(pushTokenInputSchema.parse({ label: "RH", allowedNetworks: ["10.0.0.5", "10.0.0.5", "192.168.0.0/16"] }).allowedNetworks).toEqual(["10.0.0.5", "192.168.0.0/16"])
    expect(pushTokenInputSchema.parse({ label: "RH", allowedNetworks: [] }).allowedNetworks).toBeNull()
    expect(pushTokenInputSchema.safeParse({ label: "RH", allowedNetworks: ["intranet.local"] }).success).toBe(false)
    expect(pushTokenInputSchema.safeParse({ label: "RH", expiresInDays: 0 }).success).toBe(false)
    expect(pushTokenInputSchema.safeParse({ label: "RH", expiresInDays: 731 }).success).toBe(false)
  })

  it("confere o IP do cliente (inclusive IPv4 mapeado em IPv6) contra as redes", () => {
    expect(clientInNetworks("::ffff:10.0.0.7", ["10.0.0.0/24"])).toBe(true)
    expect(clientInNetworks("10.0.1.7", ["10.0.0.0/24", "10.0.2.9"])).toBe(false)
    expect(clientInNetworks("10.0.2.9", ["10.0.0.0/24", "10.0.2.9"])).toBe(true)
    expect(clientInNetworks("2001:db8::1", ["2001:db8::/32"])).toBe(true)
    expect(clientInNetworks(null, ["10.0.0.0/24"])).toBe(false)
  })
})

describe("API Push — ordem: token antes do corpo", () => {
  it("token inexistente com JSON quebrado recebe 401 (o corpo nem chegou a ser lido), não 400", async () => {
    const db = { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }), connect: vi.fn() } as unknown as Database
    const app = express()
    app.use("/ingest", createDataIngestionRouter(db, { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }))
    app.use((error: Error, _request: express.Request, response: express.Response, next: express.NextFunction) => {
      void next
      if (error instanceof DomainError) return response.status(error.statusCode).json({ error: { code: error.code } })
      return response.status(400).json({ error: { code: "PARSE" } })
    })
    const result = await request(app).post("/ingest/abcd1234/feed-x").set("authorization", "Bearer inia_push_qualquer").set("content-type", "application/json").send("{ quebrado")
    expect(result.status).toBe(401)
    expect(result.body.error.code).toBe("DATA_PUSH_UNAUTHORIZED")
  })
})

describe("fonte API Pull por http:// com credencial", () => {
  const api = (baseUrl: string, auth: Extract<SourceConfig, { kind: "API_PULL" }>["api"]["auth"]): SourceConfig => ({ kind: "API_PULL", api: { baseUrl, auth, headers: {}, timeoutMs: 30_000 } })

  it("avisa só quando há credencial e alguma URL é http://", () => {
    expect(insecureCredentialTransportWarning(api("http://api.interna/rh", { kind: "BEARER" }))).toMatch(/http:\/\//)
    expect(insecureCredentialTransportWarning(api("https://api.cliente/rh", { kind: "OAUTH2_CLIENT_CREDENTIALS", tokenUrl: "http://sso.interno/token", clientId: "inia" }))).not.toBeNull()
    expect(insecureCredentialTransportWarning(api("http://api.interna/rh", { kind: "NONE" }))).toBeNull()
    expect(insecureCredentialTransportWarning(api("https://api.cliente/rh", { kind: "BASIC", username: "inia" }))).toBeNull()
    expect(insecureCredentialTransportWarning({ kind: "API_PUSH" })).toBeNull()
  })
})
