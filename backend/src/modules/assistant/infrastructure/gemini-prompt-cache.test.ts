import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../config/env.js", () => ({ env: { INIA_PROMPT_CACHE: "EXPLICIT", INIA_PROMPT_CACHE_TTL_SECONDS: 600, GEMINI_API_KEY: "k" } }))
const { ensureCachedPrefix, promptCacheKey, resetPromptCacheForTests } = await import("./gemini-prompt-cache.js")

const bigPrompt = "regra estática ".repeat(600) // ≈ 2.2k tokens estimados (acima do mínimo de 1.024)

// V1.3 — §23–26/§56: chave por modelo + versão + conteúdo; prefixo pequeno/sem cache/falha → request normal.
describe("prompt cache explícito (adapter Gemini)", () => {
  afterEach(() => {
    resetPromptCacheForTests()
    vi.unstubAllGlobals()
  })

  it("a chave muda com o modelo, com a versão dos componentes e com o conteúdo (system ou tools)", () => {
    const base = { model: "m1", systemPrompt: "S", tools: [{ name: "a" }], cacheKeyVersion: "v1" }
    expect(promptCacheKey(base)).toBe(promptCacheKey({ ...base }))
    expect(promptCacheKey({ ...base, model: "m2" })).not.toBe(promptCacheKey(base))
    expect(promptCacheKey({ ...base, cacheKeyVersion: "v2" })).not.toBe(promptCacheKey(base))
    expect(promptCacheKey({ ...base, systemPrompt: "S2" })).not.toBe(promptCacheKey(base))
    expect(promptCacheKey({ ...base, tools: [{ name: "b" }] })).not.toBe(promptCacheKey(base))
  })

  it("cria o cache uma vez (tokens cobrados como criação) e reaproveita o nome enquanto válido; prefixo pequeno nunca vai ao cache", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "cachedContents/abc", expireTime: new Date(Date.now() + 600_000).toISOString(), usageMetadata: { totalTokenCount: 2200 } }), { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const prefix = { model: "gemini-3.8-flash", systemPrompt: bigPrompt, tools: [], cacheKeyVersion: "v1" }
    expect(await ensureCachedPrefix(prefix)).toEqual({ name: "cachedContents/abc", created: true, tokens: 2200 })
    expect(await ensureCachedPrefix(prefix)).toEqual({ name: "cachedContents/abc", created: false, tokens: 2200 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body) as { model: string; ttl: string; systemInstruction: unknown }
    expect(body).toMatchObject({ model: "models/gemini-3.8-flash", ttl: "600s" })
    expect(await ensureCachedPrefix({ ...prefix, systemPrompt: "curto" })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("falha da API do cache → null (a request segue sem cache, nunca bloqueia); cache vencido é recriado", async () => {
    const fetchMock = vi.fn(async () => new Response("erro", { status: 400 }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await ensureCachedPrefix({ model: "m", systemPrompt: bigPrompt, tools: [], cacheKeyVersion: "v1" })).toBeNull()
    const expiring = vi.fn(async () => new Response(JSON.stringify({ name: "cachedContents/x", expireTime: new Date(Date.now() + 30_000).toISOString(), usageMetadata: { totalTokenCount: 2200 } }), { status: 200 }))
    vi.stubGlobal("fetch", expiring)
    const prefix = { model: "m2", systemPrompt: bigPrompt, tools: [], cacheKeyVersion: "v1" }
    expect((await ensureCachedPrefix(prefix))?.created).toBe(true)
    // Vence em 30 s (< margem de 60 s): a próxima chamada recria em vez de usar um cache que expira durante a request.
    expect((await ensureCachedPrefix(prefix))?.created).toBe(true)
    expect(expiring).toHaveBeenCalledTimes(2)
  })
})
