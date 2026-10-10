// Gera a cópia do catálogo de uso para o frontend (fonte: backend/src/modules/usage-analytics/domain). Rodar após mudar telas/elementos.
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { clientCatalog } from "../../src/modules/usage-analytics/domain/client-catalog.js"

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../../frontend/src/lib/usage/usage-catalog.generated.json")
writeFileSync(target, `${JSON.stringify(clientCatalog(), null, 2)}\n`)
process.stdout.write(`catálogo gravado em ${target}\n`)
