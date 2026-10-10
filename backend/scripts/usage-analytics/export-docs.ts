// Gera docs/dev/monitoria-usabilidade-catalogo.md a partir do código (dicionário de métricas, eventos, telas, elementos, funis
// e sinais). Rodar depois de mudar qualquer definição — o teste `usage-docs.test.ts` falha se o arquivo estiver desatualizado.
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { renderUsageCatalogMarkdown } from "../../src/modules/usage-analytics/domain/usage-docs.js"

const target = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/dev/monitoria-usabilidade-catalogo.md")
writeFileSync(target, renderUsageCatalogMarkdown())
process.stdout.write(`catálogo documentado em ${target}\n`)
