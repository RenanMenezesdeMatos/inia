import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { renderCatalogJson, renderCatalogMarkdown } from "../../infrastructure/errors/render-catalog-docs.js"
import { renderDomainCodesModule, scanDomainErrorCodes } from "../../infrastructure/errors/scan-error-codes.js"
import { ERROR_CATALOG, ERROR_FAMILIES } from "./error-catalog.js"
import { DOMAIN_ERROR_CODES } from "./domain-error-codes.generated.js"
import { explainCode, familyForStatus, severityFor } from "./error-lookup.js"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const repoRoot = path.resolve(backendRoot, "..")
const REGENERATE = "Rode `npm --prefix backend run errors:catalog` e confira o diff."

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name)
    if (name === "node_modules" || name === ".next") continue
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const catalogFiles = new Set(["error-catalog.ts", "domain-error-codes.generated.ts"])
const backendSources = sourceFiles(path.join(backendRoot, "src")).filter((file) => !catalogFiles.has(path.basename(file)))
const frontendSources = sourceFiles(path.join(repoRoot, "frontend/src"))
const corpus = [...backendSources, ...frontendSources].map((file) => readFileSync(file, "utf8")).join("\n")

describe("catálogo de erros — fonte de verdade", () => {
  it("o inventário gravado é o que o código-fonte devolve hoje (nenhum código de módulo sem catálogo)", () => {
    const scanned = scanDomainErrorCodes(backendRoot)
    expect(renderDomainCodesModule(scanned), REGENERATE).toBe(readFileSync(path.join(backendRoot, "src/shared/domain/errors/domain-error-codes.generated.ts"), "utf8"))
  })

  it("os documentos legíveis (docs/operacao) estão em dia com o catálogo", () => {
    expect(readFileSync(path.join(repoRoot, "docs/operacao/catalogo-de-erros.md"), "utf8"), REGENERATE).toBe(renderCatalogMarkdown(DOMAIN_ERROR_CODES))
    expect(readFileSync(path.join(repoRoot, "docs/operacao/catalogo-de-erros.json"), "utf8"), REGENERATE).toBe(renderCatalogJson(DOMAIN_ERROR_CODES))
  })

  it("nenhuma entrada órfã: todo código do catálogo é emitido em algum ponto do backend ou do frontend", () => {
    // Emitido = literal no código OU inventariado (ex.: `AI_${categoria}`, montado a partir da lista de categorias).
    const inventoried = new Set(DOMAIN_ERROR_CODES.map((domain) => domain.code))
    const orphans = ERROR_CATALOG.map((entry) => entry.code).filter((code) => !corpus.includes(`"${code}"`) && !inventoried.has(code))
    expect(orphans).toEqual([])
  })

  it("aliases que não seguem INIA-<MÓDULO>-<CAUSA> são códigos realmente devolvidos pelos módulos", () => {
    const inventoried = new Set(DOMAIN_ERROR_CODES.map((domain) => domain.code))
    const phantom = ERROR_CATALOG.flatMap((entry) => entry.aliases ?? []).filter((alias) => !alias.startsWith("INIA-") && !inventoried.has(alias) && !corpus.includes(`"${alias}"`))
    expect(phantom).toEqual([])
  })

  it("códigos, aliases e famílias são únicos e bem formados", () => {
    const names = ERROR_CATALOG.flatMap((entry) => [entry.code, ...(entry.aliases ?? [])])
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(name).toMatch(/^(INIA-[A-Z]+(-[A-Z]+)+|[A-Z][A-Z0-9_]{2,})$/)
    const statuses = ERROR_FAMILIES.flatMap((family) => family.statuses)
    expect(new Set(statuses).size).toBe(statuses.length)
  })

  it("toda entrada tem o diagnóstico completo e aponta arquivos que existem", () => {
    for (const entry of ERROR_CATALOG) {
      expect(entry.probableCauses.length, entry.code).toBeGreaterThan(0)
      for (const cause of entry.probableCauses) expect(cause.signal.length, entry.code).toBeGreaterThan(10)
      expect(entry.checks.length, entry.code).toBeGreaterThan(0)
      expect(entry.evidence.length, entry.code).toBeGreaterThan(0)
      expect(entry.publicMessage, entry.code).not.toMatch(/stack|sql|exception|undefined/i)
      for (const ref of entry.codeRefs) expect(existsSync(path.join(repoRoot, ref)), `${entry.code} → ${ref}`).toBe(true)
    }
  })

  it("todo código INIA-* usado pelo frontend existe no catálogo (sem divergência entre os lados)", () => {
    const used = new Set(frontendSources.flatMap((file) => [...readFileSync(file, "utf8").matchAll(/"(INIA-[A-Z]+(?:-[A-Z]+)+)"/g)].map((match) => match[1]!)))
    const unknown = [...used].filter((code) => !explainCode(code))
    expect(unknown).toEqual([])
  })

  it("resolve código, alias e código de módulo para a explicação certa", () => {
    expect(explainCode("inia-dados-timeout")).toMatchObject({ kind: "ENTRY", viaAlias: true, entry: { code: "DATA_SOURCE_TIMEOUT" } })
    expect(explainCode("UNAUTHENTICATED")).toMatchObject({ kind: "ENTRY", viaAlias: false })
    expect(explainCode("BUSINESS_DOMAIN_IN_USE")).toMatchObject({ kind: "DOMAIN", family: { id: "FAMILIA-CONFLITO" } })
    expect(explainCode("NAO_EXISTE_XYZ")).toBeNull()
    expect(familyForStatus(418).id).toBe("FAMILIA-DEPENDENCIA")
    expect(severityFor("INIA-BANCO-INDISPONIVEL", 500)).toBe("critical")
    expect(severityFor("ALGUM_CODIGO", 503)).toBe("error")
  })
})
