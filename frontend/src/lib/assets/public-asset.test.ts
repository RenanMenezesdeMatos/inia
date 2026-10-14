import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { publicAsset } from "./public-asset"
import { computePublicAssetVersions } from "./public-asset-versions"

let dir: string | null = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

describe("versão de conteúdo dos estáticos imutáveis", () => {
  it("modelos 3D e imagens da raiz ganham o hash do conteúdo; trocar o arquivo muda o endereço; o resto fica de fora", () => {
    dir = mkdtempSync(path.join(tmpdir(), "inia-public-"))
    mkdirSync(path.join(dir, "models"))
    mkdirSync(path.join(dir, "worklets"))
    writeFileSync(path.join(dir, "inia-avatar.webp"), "imagem-1")
    writeFileSync(path.join(dir, "models", "inia-mentora.glb"), "modelo-1")
    writeFileSync(path.join(dir, "worklets", "pcm.js"), "código")
    const first = computePublicAssetVersions(dir)
    expect(Object.keys(first).sort()).toEqual(["/inia-avatar.webp", "/models/inia-mentora.glb"])
    expect(first["/inia-avatar.webp"]).toMatch(/^[0-9a-f]{12}$/)
    writeFileSync(path.join(dir, "inia-avatar.webp"), "imagem-2")
    const second = computePublicAssetVersions(dir)
    expect(second["/inia-avatar.webp"]).not.toBe(first["/inia-avatar.webp"])
    expect(second["/models/inia-mentora.glb"]).toBe(first["/models/inia-mentora.glb"])
    expect(publicAsset("/inia-avatar.webp", second)).toBe(`/inia-avatar.webp?v=${second["/inia-avatar.webp"]}`)
    expect(publicAsset("/sem-versao.png", second)).toBe("/sem-versao.png")
    expect(computePublicAssetVersions(path.join(dir, "nao-existe"))).toEqual({})
  })
})
