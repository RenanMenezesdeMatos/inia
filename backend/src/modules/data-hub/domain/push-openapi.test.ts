import { describe, expect, it } from "vitest"
import { requireDataContract } from "./contract-registry.js"
import { buildPushOpenApi, pushRecordSchema, type PushOpenApiFeed } from "./push-openapi.js"

/** OpenAPI da API Push (B21): gerado do feed configurado — nomes de campo do CLIENTE, tipos do contrato, sem segredo. */
const interactions = requireDataContract("INTERACTIONS")
const feed = (overrides: Partial<PushOpenApiFeed> = {}): PushOpenApiFeed => ({
  feedKey: "interacoes",
  name: "Interações",
  status: "ACTIVE",
  extractPath: "records",
  contract: interactions,
  mapping: {
    fields: [
      { target: "externalInteractionId", source: "protocolo_id", transforms: [] },
      { target: "externalEmployeeId", source: "matricula", transforms: [{ kind: "TRIM" }] },
      { target: "startedAt", source: "inicio", transforms: [{ kind: "PARSE_DATE", format: "dd/MM/yyyy HH:mm" }] },
      { target: "channel", source: null, transforms: [{ kind: "CONSTANT", value: "VOICE" }] },
      { target: "reason", source: "dados.motivo", transforms: [] },
    ],
  },
  ...overrides,
})

describe("OpenAPI da API Push", () => {
  it("descreve o corpo com os nomes do cliente; constante fica fora; caminho aninhado vai para a descrição", () => {
    const schema = pushRecordSchema(feed())
    const properties = schema.properties as Record<string, { type: unknown; description: string }>
    expect(Object.keys(properties)).toEqual(["protocolo_id", "matricula", "inicio"])
    expect(properties.inicio!.type).toBe("string")
    expect(properties.inicio!.description).toContain("dd/MM/yyyy HH:mm")
    expect(schema.required).toEqual(expect.arrayContaining(["protocolo_id", "matricula"]))
    expect(schema.description).toContain("dados.motivo → reason")
  })

  it("um caminho por feed, token Bearer, Idempotency-Key, 401/422/429 documentados e o corpo dentro do extractPath", () => {
    const document = buildPushOpenApi({ serverUrl: "https://inia.cliente.com.br", source: { publicId: "rh01", name: "API RH" }, feeds: [feed(), feed({ feedKey: "lote-b", extractPath: "dados.itens", status: "PAUSED" })] }) as {
      openapi: string
      servers: { url: string }[]
      paths: Record<string, { post: { requestBody: { content: { "application/json": { schema: { properties: Record<string, unknown> }; example: unknown } } }; responses: Record<string, unknown>; description: string } }>
    }
    expect(document.openapi).toBe("3.1.0")
    expect(document.servers[0]!.url).toBe("https://inia.cliente.com.br")
    const first = document.paths["/api/v1/data-ingestion/rh01/interacoes"]!.post
    expect(Object.keys(first.requestBody.content["application/json"].schema.properties)).toEqual(["records"])
    expect(Object.keys(first.responses)).toEqual(expect.arrayContaining(["202", "401", "409", "422", "429"]))
    const second = document.paths["/api/v1/data-ingestion/rh01/lote-b"]!.post
    expect(second.requestBody.content["application/json"].example).toMatchObject({ dados: { itens: expect.any(Array) } })
    expect(second.description).toContain("PAUSED")
    expect(JSON.stringify(document)).not.toMatch(/inia_push_[A-Za-z0-9_-]{10,}/)
  })
})
