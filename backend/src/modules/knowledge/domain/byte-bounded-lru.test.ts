import { describe, expect, it } from "vitest"
import { ByteBoundedLru, megabytesFromEnv } from "./byte-bounded-lru.js"

describe("cache LRU limitado por quantidade e por bytes", () => {
  it("passou do teto em bytes: sai o usado há mais tempo; ler marca como usado", () => {
    const cache = new ByteBoundedLru<string, string>({ maxEntries: 100, maxBytes: () => 10, sizeOf: (value) => value.length })
    cache.set("a", "aaaa")
    cache.set("b", "bbbb")
    expect(cache.get("a")).toBe("aaaa")
    cache.set("c", "cccc")
    expect(cache.get("b")).toBeUndefined()
    expect([cache.get("a"), cache.get("c"), cache.bytes]).toEqual(["aaaa", "cccc", 8])
  })

  it("teto por quantidade continua valendo; o item mais novo fica mesmo maior que o teto", () => {
    const cache = new ByteBoundedLru<string, string>({ maxEntries: 2, maxBytes: () => 5, sizeOf: (value) => value.length })
    cache.set("a", "a")
    cache.set("b", "b")
    cache.set("c", "c")
    expect(cache.size).toBe(2)
    cache.set("enorme", "x".repeat(50))
    expect([cache.size, cache.get("enorme")?.length, cache.bytes]).toEqual([1, 50, 50])
  })

  it("teto em MB pela variável de ambiente; inválido = padrão", () => {
    expect(megabytesFromEnv("2", 128)).toBe(2 * 1_048_576)
    expect(megabytesFromEnv(undefined, 128)).toBe(128 * 1_048_576)
    expect(megabytesFromEnv("abc", 128)).toBe(128 * 1_048_576)
  })
})
