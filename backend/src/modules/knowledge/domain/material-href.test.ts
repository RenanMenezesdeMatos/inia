import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { buildKnowledgeMaterialHref } from "./material-href.js"

describe("buildKnowledgeMaterialHref (backend) = rota canônica do frontend", () => {
  it("monta /materiais/:id com o id codificado, igual ao helper do frontend", () => {
    expect(buildKnowledgeMaterialHref("0f0e0d0c-0000-4000-8000-000000000006")).toBe("/materiais/0f0e0d0c-0000-4000-8000-000000000006")
    expect(buildKnowledgeMaterialHref("a/b")).toBe("/materiais/a%2Fb")
    const frontend = readFileSync(resolve(__dirname, "../../../../../frontend/src/lib/knowledge/material-href.ts"), "utf8")
    expect(frontend).toContain("return `/materiais/${encodeURIComponent(materialId)}`")
  })
})
