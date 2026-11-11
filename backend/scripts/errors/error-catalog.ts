/**
 * Gera o inventário dos códigos dos módulos e os documentos legíveis do catálogo de erros:
 *   backend/src/shared/domain/errors/domain-error-codes.generated.ts
 *   docs/operacao/catalogo-de-erros.md
 *   docs/operacao/catalogo-de-erros.json
 * Uso: npm --prefix backend run errors:catalog   (o teste error-catalog.test.ts acusa quando falta rodar)
 */
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { renderDomainCodesModule, scanDomainErrorCodes } from "../../src/shared/infrastructure/errors/scan-error-codes.js"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const repoRoot = path.resolve(backendRoot, "..")
const codes = scanDomainErrorCodes(backendRoot)
writeFileSync(path.join(backendRoot, "src/shared/domain/errors/domain-error-codes.generated.ts"), renderDomainCodesModule(codes))
// Os renderizadores leem o inventário GRAVADO: importados depois da gravação.
const { renderCatalogJson, renderCatalogMarkdown } = await import("../../src/shared/infrastructure/errors/render-catalog-docs.js")
const docs = path.join(repoRoot, "docs/operacao")
mkdirSync(docs, { recursive: true })
writeFileSync(path.join(docs, "catalogo-de-erros.json"), renderCatalogJson(codes))
writeFileSync(path.join(docs, "catalogo-de-erros.md"), renderCatalogMarkdown(codes))
console.log(`Catálogo gerado: ${codes.length} códigos de módulos inventariados.`)
