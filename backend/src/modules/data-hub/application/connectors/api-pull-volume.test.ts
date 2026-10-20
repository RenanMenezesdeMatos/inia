import { describe, expect, it } from "vitest"
import type { DataHubContext } from "../data-hub-context.js"
import type { DataFeedRow, DataSourceRow } from "../records.js"
import { MockHttpClient } from "../../testing/fakes.js"
import { fetchApiRecords } from "./api-pull-connector.js"

/** API do cliente com paginação que nunca esvazia: cada página cheia, sempre com o tamanho pedido (auditoria 17/10/2026, DATA-10). */
const source = { id: "s-1", kind: "API_PULL", config: { kind: "API_PULL", api: { baseUrl: "https://api.cliente.example", auth: { kind: "NONE" }, headers: {}, timeoutMs: 30_000 } } } as unknown as DataSourceRow
const feed = { id: "f-1", connectorConfig: { connector: "API_PULL", api: { endpoint: "/registros", pagination: { kind: "PAGE_NUMBER", pageParam: "page", pageSize: 100 }, maxPages: 10_000 } } } as unknown as DataFeedRow
const endless = () => {
  const http = new MockHttpClient().on("/registros", () => ({ status: 200, headers: {}, body: JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ id: index, texto: "x".repeat(1000) }))) }))
  return { http, ctx: { http, clock: { now: () => new Date() } } as unknown as DataHubContext }
}

describe("API Pull — teto da carga inteira, não só da página", () => {
  it("paginação que nunca termina para no teto da carga com DATA_SOURCE_VOLUME_LIMIT (antes acumulava até maxPages × 50 MB)", async () => {
    const { http, ctx } = endless()
    await expect(fetchApiRecords(ctx, source, feed, { checkpoint: null, maxRunBytes: 2 * 1024 * 1024 })).rejects.toMatchObject({ code: "DATA_SOURCE_VOLUME_LIMIT" })
    expect(http.requests.length).toBeLessThan(30)
  })

  it("amostra (limit) e cargas dentro do teto continuam iguais", async () => {
    const { ctx } = endless()
    const sample = await fetchApiRecords(ctx, source, feed, { checkpoint: null, limit: 20, maxRunBytes: 2 * 1024 * 1024 })
    expect(sample.records).toHaveLength(20)
  })
})
