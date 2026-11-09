import { describe, expect, it } from "vitest"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { MASKED_VALUE, feedHasHiddenValues, maskConfigsInResponse, maskUrl, restoreMaskedFeedConnector, restoreMaskedSourceConfig, sameApiOrigin, sourceHiddenValues } from "./config-mask.js"
import { feedConnectorConfigSchema, sourceConfigSchema, type FeedConnectorConfig, type SourceConfig } from "./source-config.js"

const M = MASKED_VALUE
const source = (headers: Record<string, string>, baseUrl = "https://api.local/v1?chave=abc"): Extract<SourceConfig, { kind: "API_PULL" }> => ({ kind: "API_PULL", api: { baseUrl, auth: { kind: "BEARER" }, headers, timeoutMs: 30_000 } })
const feed = (queryParams: Record<string, string>, endpoint = "/dados?token=abc"): FeedConnectorConfig => ({ connector: "API_PULL", api: { format: "JSON", endpoint, method: "GET", queryParams, headers: {}, extractPath: "", pagination: { kind: "NONE" }, checkpoint: { kind: "NONE" }, maxPages: 500 } })

describe("esconder valores de URL", () => {
  it("esconde valor de parâmetro, senha embutida e fragmento; mantém o resto", () => {
    expect(maskUrl("https://api.local/v1")).toBe("https://api.local/v1")
    expect(maskUrl("https://api.local/v1?a=1&b=2&c")).toBe(`https://api.local/v1?a=${M}&b=${M}&${M}`)
    expect(maskUrl("https://api.local/v1?SEGREDO")).toBe(`https://api.local/v1?${M}`)
    expect(maskUrl("https://api.local/v1?")).toBe("https://api.local/v1?")
    expect(maskUrl("https://user:senha@api.local/v1")).toBe(`https://${M}@api.local/v1`)
    expect(maskUrl("https://TOKEN@api.local/v1")).toBe(`https://${M}@api.local/v1`)
    expect(maskUrl("https://api.local/v1#token")).toBe(`https://api.local/v1#${M}`)
    expect(maskUrl("/dados?token=abc")).toBe(`/dados?token=${M}`)
  })
})

describe("esconder configuração nas respostas", () => {
  it("acha config e connectorConfig em qualquer nível, sem mexer no resto", () => {
    const createdAt = "2026-11-05T12:00:00.000Z"
    const masked = maskConfigsInResponse({ data: [{ id: "s", createdAt, config: source({ "X-Tenant": "abc" }), feeds: [{ id: "f", connectorConfig: feed({ chave: "abc" }), mapping: { fields: ["x"] } }] }], total: 1 }) as { data: { createdAt: unknown; config: { api: { headers: unknown; baseUrl: string } }; feeds: { connectorConfig: { api: { queryParams: unknown; endpoint: string } }; mapping: unknown }[] }[]; total: number }
    const row = masked.data[0]!
    expect(row.createdAt).toBe(createdAt)
    expect(row.config.api.headers).toEqual({ "X-Tenant": M })
    expect(row.config.api.baseUrl).toBe(`https://api.local/v1?chave=${M}`)
    expect(row.feeds[0]!.connectorConfig.api).toMatchObject({ queryParams: { chave: M }, endpoint: `/dados?token=${M}` })
    expect(row.feeds[0]!.mapping).toEqual({ fields: ["x"] })
    expect(masked.total).toBe(1)
    expect(JSON.stringify(masked)).not.toContain("abc")
  })

  it("vê o que vai sair de fato: objeto sem protótipo, de classe ou com toJSON, e data vira texto como no JSON", () => {
    class SourceView {
      config = source({ "X-Tenant": "abc" })
    }
    const withoutPrototype = Object.assign(Object.create(null) as object, { config: source({ "X-Tenant": "abc" }) })
    const masked = maskConfigsInResponse({ a: withoutPrototype, b: new SourceView(), c: { toJSON: () => ({ connectorConfig: feed({ chave: "abc" }) }) }, at: new Date("2026-11-05T12:00:00.000Z"), nothing: undefined })
    expect(JSON.stringify(masked)).not.toContain("abc")
    expect(masked).toMatchObject({ at: "2026-11-05T12:00:00.000Z" })
    expect(maskConfigsInResponse(undefined)).toBeUndefined()
  })

  it("não inventa nada em banco, SFTP, arquivo nem em dados do cliente", () => {
    const database = { config: { kind: "DATABASE", database: { host: "h", username: "u" } }, connectorConfig: { connector: "DATABASE", database: { object: { name: "t" } } }, records: [{ config: "texto do cliente" }] }
    expect(maskConfigsInResponse(database)).toEqual(database)
    expect(maskConfigsInResponse(null)).toBeNull()
    expect(maskConfigsInResponse("texto")).toBe("texto")
  })

  it("não quebra sem os campos opcionais de configuração antiga", () => {
    expect(maskConfigsInResponse({ config: { kind: "API_PULL", api: { baseUrl: "https://api.local" } } })).toEqual({ config: { kind: "API_PULL", api: { baseUrl: "https://api.local", headers: {} } } })
  })
})

describe("salvar o valor escondido mantém o atual", () => {
  const code = (work: () => unknown) => {
    try {
      work()
    } catch (error) {
      return error instanceof DomainError ? error.code : "OUTRO"
    }
    return null
  }

  it("fonte: cabeçalho e URL escondidos voltam ao gravado; valor novo troca", () => {
    const current = source({ "X-Tenant": "abc", "X-Outro": "def" })
    const incoming = source({ "X-Tenant": M, "X-Outro": "novo" }, `https://api.local/v1?chave=${M}`)
    expect(restoreMaskedSourceConfig(incoming, current)).toMatchObject({ api: { headers: { "X-Tenant": "abc", "X-Outro": "novo" }, baseUrl: "https://api.local/v1?chave=abc" } })
  })

  it("marcador sem o que manter é recusado e nunca é gravado", () => {
    const current = source({ "X-Tenant": "abc" })
    expect(code(() => restoreMaskedSourceConfig(source({ "X-Novo": M }), current))).toBe("DATA_SOURCE_MASKED_VALUE")
    expect(code(() => restoreMaskedSourceConfig(source({}, `https://api.local/v2?chave=${M}`), current))).toBe("DATA_SOURCE_MASKED_VALUE")
    expect(code(() => restoreMaskedSourceConfig(source({ "X-Tenant": M }), null))).toBe("DATA_SOURCE_MASKED_VALUE")
    expect(code(() => restoreMaskedFeedConnector(feed({ chave: M }), null))).toBe("DATA_SOURCE_MASKED_VALUE")
  })

  it("conjunto: parâmetro e endpoint escondidos voltam ao gravado", () => {
    const restored = restoreMaskedFeedConnector(feed({ chave: M }, `/dados?token=${M}`), feed({ chave: "abc" }))
    expect(restored).toMatchObject({ api: { queryParams: { chave: "abc" }, endpoint: "/dados?token=abc" } })
  })

  it("a URL escondida continua válida para o esquema da tela e volta ao gravado", () => {
    for (const baseUrl of ["https://TOKEN@api.local/v1", "https://user:senha@api.local/v1?a=1", "https://api.local/v1?SEGREDO"]) {
      const incoming = sourceConfigSchema.parse(source({}, maskUrl(baseUrl)))
      expect(restoreMaskedSourceConfig(incoming, source({}, baseUrl))).toMatchObject({ api: { baseUrl } })
    }
  })

  it("outros tipos passam direto", () => {
    const file: SourceConfig = { kind: "FILE_UPLOAD" }
    expect(restoreMaskedSourceConfig(file, null)).toBe(file)
  })
})

describe("valor escondido só vale para o servidor em que foi digitado", () => {
  const current = source({ "X-Api-Token": "segredo" }, "https://api.local/v1")
  const refusal = (work: () => unknown) => {
    try {
      work()
    } catch (error) {
      return error instanceof DomainError ? { code: error.code, statusCode: error.statusCode, details: error.details } : "OUTRO"
    }
    return null
  }

  it("trocar esquema, servidor ou porta mantendo o valor escondido é recusado", () => {
    for (const baseUrl of ["https://atacante.example/v1", "http://api.local/v1", "https://api.local:8443/v1", "https://api.local.atacante.example/v1"]) {
      expect(refusal(() => restoreMaskedSourceConfig(source({ "X-Api-Token": M }, baseUrl), current)), baseUrl).toEqual({ code: "DATA_SOURCE_MASKED_VALUE", statusCode: 422, details: { field: "Cabeçalho: X-Api-Token", reason: "ORIGIN_CHANGED" } })
    }
  })

  it("mesmo servidor, com outro caminho, maiúsculas ou a porta padrão escrita, mantém o guardado", () => {
    for (const baseUrl of ["https://api.local/v2/outro", "https://API.LOCAL/v1", "https://api.local:443/v1"]) {
      expect(restoreMaskedSourceConfig(source({ "X-Api-Token": M }, baseUrl), current), baseUrl).toMatchObject({ api: { baseUrl, headers: { "X-Api-Token": "segredo" } } })
    }
  })

  it("servidor novo com o valor digitado de novo é aceito", () => {
    expect(restoreMaskedSourceConfig(source({ "X-Api-Token": "digitado" }, "https://outro.example/v1"), current)).toMatchObject({ api: { baseUrl: "https://outro.example/v1", headers: { "X-Api-Token": "digitado" } } })
  })

  it("comparação de origem: esquema + servidor + porta; endereço ilegível nunca é a mesma origem", () => {
    expect(sameApiOrigin("https://api.local/v1?a=1", "https://API.local:443/outro")).toBe(true)
    expect(sameApiOrigin("https://api.local/v1", "https://api.local:8443/v1")).toBe(false)
    expect(sameApiOrigin("https://api.local/v1", "http://api.local/v1")).toBe(false)
    expect(sameApiOrigin("não é url", "não é url")).toBe(false)
  })

  it("conjunto com cabeçalho, parâmetro fixo ou valor no endpoint guarda valor escondido; sem nada disso, não", () => {
    const api = (overrides: Record<string, unknown>) => feedConnectorConfigSchema.parse({ connector: "API_PULL", api: { endpoint: "/dados", ...overrides } })
    expect(feedHasHiddenValues(api({}))).toBe(false)
    expect(feedHasHiddenValues(api({ queryParams: { chave: "abc" } }))).toBe(true)
    expect(feedHasHiddenValues(api({ headers: { "X-Tenant": "abc" } }))).toBe(true)
    expect(feedHasHiddenValues(api({ endpoint: "/dados?token=abc" }))).toBe(true)
    expect(feedHasHiddenValues(api({ endpoint: "https://TOKEN@api.local/dados" }))).toBe(true)
    expect(feedHasHiddenValues(feedConnectorConfigSchema.parse({ connector: "FILE_UPLOAD" }))).toBe(false)
    // Configuração antiga, gravada antes dos campos opcionais.
    expect(feedHasHiddenValues({ connector: "API_PULL", api: { endpoint: "/dados" } } as unknown as FeedConnectorConfig)).toBe(false)
  })
})

describe("valores escondidos da própria fonte", () => {
  it("lista cabeçalhos, Base URL e URL do token que saem escondidos; banco e SFTP não têm nenhum além da credencial", () => {
    expect(sourceHiddenValues(source({}, "https://api.local/v1"))).toEqual([])
    expect(sourceHiddenValues(source({ "X-Tenant": "abc" }))).toEqual(["Base URL", "Cabeçalho: X-Tenant"])
    expect(sourceHiddenValues(source({}, "https://TOKEN@api.local/v1"))).toEqual(["Base URL"])
    const oauth: SourceConfig = { kind: "API_PULL", api: { baseUrl: "https://api.local", auth: { kind: "OAUTH2_CLIENT_CREDENTIALS", tokenUrl: "https://api.local/token?tenant=abc", clientId: "inia" }, headers: {}, timeoutMs: 30_000 } }
    expect(sourceHiddenValues(oauth)).toEqual(["URL do token"])
    const sftp: SourceConfig = { kind: "SFTP", sftp: { host: "s", port: 22, username: "u", remoteDirectory: "/", authKind: "PASSWORD", timeoutMs: 30_000 } }
    expect(sourceHiddenValues(sftp)).toEqual([])
    expect(sourceHiddenValues(sourceConfigSchema.parse({ kind: "DATABASE", database: { engine: "POSTGRESQL", host: "h", database: "d", username: "u" } }))).toEqual([])
  })

  it("comparando com a guardada, conta só o que segue igual: valor digitado de novo quem digitou conhece", () => {
    const stored = source({ "X-Tenant": "abc", "X-Outro": "def" })
    expect(sourceHiddenValues(source({ "X-Tenant": "abc", "X-Outro": "novo" }), stored)).toEqual(["Base URL", "Cabeçalho: X-Tenant"])
    expect(sourceHiddenValues(source({ "X-Novo": "abc" }, "https://api.local/v1?chave=nova"), stored)).toEqual([])
  })
})
