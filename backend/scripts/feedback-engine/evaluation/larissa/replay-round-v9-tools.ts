/**
 * Cenário C da rodada V9 — o que as ferramentas DETERMINÍSTICAS do catálogo devolvem para as perguntas do indicador (zero modelo,
 * banco somente leitura, só a Larissa). NÃO é investigação com planejador nem validação com modelo: mostra o dado que a consulta
 * recusada na rodada (segment_indicator sem dimensão) e a de dias (detect_anomalies) teriam trazido.
 *
 *   npx tsx scripts/feedback-engine/evaluation/larissa/replay-round-v9-tools.ts
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createReadOnlyDatabase } from "../../../../src/modules/qa-lab/application/read-only-database.js"
import { createCatalogToolRunner } from "../../../../src/modules/feedback-engine/infrastructure/catalog-tool-runner.js"

const here = dirname(fileURLToPath(import.meta.url))
globalThis.fetch = (async () => {
  throw new Error("REPLAY: nenhuma requisição externa.")
}) as typeof fetch
const ORG = "00000000-0000-4000-8000-000000000001"
const PERSON = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const run = createCatalogToolRunner(createReadOnlyDatabase(pool))
const scope = { organizationId: ORG, personId: PERSON, agentId: null, indicatorCode: "TMA", window: { start: new Date("2026-08-01T03:00:00Z"), end: new Date("2026-09-01T03:00:00Z"), label: "2026-08-01 a 2026-08-31" }, now: new Date("2026-10-02T12:00:00Z") }
const period = { from: "2026-08-01", to: "2026-08-31" }
const out: Record<string, unknown> = { kind: "ZERO_COST_DETERMINISTIC_TOOLS_NOT_AN_INVESTIGATION" }
try {
  for (const [key, call] of Object.entries({
    segmentBySubject: { tool: "segment_indicator" as const, args: { indicatorCode: "TMA", period, dimension: "SUBJECT" } },
    anomaliesByDay: { tool: "detect_anomalies" as const, args: { indicatorCode: "TMA", period } },
  })) {
    try {
      const result = await run(call, scope)
      out[key] = { quality: result.quality, provenance: result.provenance, data: result.data }
    } catch (error) {
      out[key] = { error: error instanceof Error ? error.message : String(error) }
    }
  }
} finally {
  await pool.end()
}
const target = join(here, "results", `replay-round-v9-tools-${new Date().toISOString().replace(/[:.]/g, "-")}.json`)
writeFileSync(target, JSON.stringify(out, null, 2))
console.log(JSON.stringify(out, null, 2).slice(0, 6000))
console.log(`\nArtefato: ${target}`)
