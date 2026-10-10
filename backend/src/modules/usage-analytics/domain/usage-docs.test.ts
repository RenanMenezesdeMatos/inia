import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { renderUsageCatalogMarkdown } from "./usage-docs.js"

describe("documento do catálogo de usabilidade", () => {
  it("docs/dev/monitoria-usabilidade-catalogo.md está igual ao código (regenere com scripts/usage-analytics/export-docs.ts)", () => {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs/dev/monitoria-usabilidade-catalogo.md")
    expect(readFileSync(file, "utf8")).toBe(renderUsageCatalogMarkdown())
  })
})
