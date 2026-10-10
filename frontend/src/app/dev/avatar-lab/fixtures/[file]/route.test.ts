import { afterEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"

const call = (file: string) => GET(new Request(`http://localhost/dev/avatar-lab/fixtures/${file}`), { params: Promise.resolve({ file }) })

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("rota de capturas do laboratório do avatar", () => {
  it("serve o JSON e o WAV do catálogo, sem cache", async () => {
    const json = await call("frase-01-apresentacao.json")
    expect(json.status).toBe(200)
    expect(json.headers.get("content-type")).toMatch(/application\/json/)
    expect(json.headers.get("cache-control")).toBe("no-store")
    const body = (await json.json()) as { id: string; events: unknown[] }
    expect(body.id).toBe("frase-01-apresentacao")
    expect(body.events.length).toBeGreaterThan(10)

    const wav = await call("frase-01-apresentacao.wav")
    expect(wav.headers.get("content-type")).toBe("audio/wav")
    const bytes = new Uint8Array(await wav.arrayBuffer())
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe("RIFF")
    expect(Number(wav.headers.get("content-length"))).toBe(bytes.length)
  })

  it("404 para qualquer coisa fora da lista branca", async () => {
    for (const file of ["README.md", "..%2Fload-fixture.ts", "../load-fixture.ts", "frase-01-apresentacao.WAV", "outra.json"]) {
      expect((await call(file)).status).toBe(404)
    }
  })

  it("404 em produção, mesmo para um arquivo válido", async () => {
    vi.stubEnv("NODE_ENV", "production")
    expect((await call("frase-01-apresentacao.json")).status).toBe(404)
  })
})
