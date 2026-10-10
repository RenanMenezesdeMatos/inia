import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { clientCatalog } from "./client-catalog.js"

describe("catálogo do navegador", () => {
  it("a cópia do frontend é exatamente a gerada pelo backend (rodar scripts/usage-analytics/export-catalog.ts)", () => {
    const frontend = readFileSync(resolve(__dirname, "../../../../../frontend/src/lib/usage/usage-catalog.generated.json"), "utf8")
    expect(JSON.parse(frontend)).toEqual(JSON.parse(JSON.stringify(clientCatalog())))
  })
})
