/**
 * PROVA DE IGUALDADE no banco de DEV (massa demo grande) do read model do analytics da liderança — caminho antigo × novo,
 * com o mesmo código da prova no banco de teste (`performance-analytics/testing/read-model-equality.ts`). Só lê.
 *
 *   npx tsx scripts/dev/analytics-read-model-equality.ts [--organization <id>] [--only scope]
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { compareAiMonthSpend, compareInteractionDayCounts, compareOfficialViews, compareStructureSummaries, compareViewerScopes, scopeSubjects, structureSubjectCases, type EqualityMismatch } from "../../src/modules/performance-analytics/testing/read-model-equality.js"

const args = process.argv.slice(2)
const option = (name: string) => { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined }
const organizationId = option("organization") ?? "00000000-0000-4000-8000-000000000001"
const only = option("only")
const db = pool as unknown as Database

function report(label: string, result: { compared: number; mismatches: EqualityMismatch[] }, startedAt: number) {
  console.log(`${label}: ${result.compared} comparações, ${result.mismatches.length} diferenças (${((performance.now() - startedAt) / 1000).toFixed(1)} s)`)
  for (const mismatch of result.mismatches.slice(0, 10)) console.log(`  ✗ ${mismatch.check} ${mismatch.key}: ${mismatch.detail}`)
  return result.mismatches.length
}

let failures = 0
try {
  if (!only || only === "scope") {
    const started = performance.now()
    const subjects = await scopeSubjects(db, organizationId)
    failures += report("Escopo do viewer (todas as pessoas × 3 permissões)", await compareViewerScopes(db, organizationId, subjects, ["indicators.view", "calendar.manage", "structure.metrics.view"]), started)
  }
  if (!only || only === "activity") {
    const started = performance.now()
    failures += report("Interações por pessoa × dia (tabela inteira + leitura da evidência, 2025-10-01..2026-12-31)", await compareInteractionDayCounts(db, organizationId, { firstDate: "2025-10-01", lastDate: "2026-12-31" }), started)
  }
  if (!only || only === "operational") {
    const started = performance.now()
    const now = new Date()
    const cases = await structureSubjectCases(db, organizationId)
    const comparisons = option("comparisons")?.split(",") as never[] | undefined
    const result = await compareStructureSummaries(db, organizationId, now, cases, comparisons)
    console.log(`  estruturas: ${cases.length} (líderes, Grupos e Subgrupos); read model usado ${result.readModelUsed}×, caminho original ${result.fallbacks}×, membros calculados na hora ${result.liveMembers}`)
    console.log(`  tempo total: original ${(result.rawMs / 1000).toFixed(1)} s × read model ${(result.readModelMs / 1000).toFixed(1)} s`)
    for (const slow of result.slowest) console.log(`  ${slow.label} · ${slow.comparison}: original ${slow.rawMs} ms × read model ${slow.readModelMs} ms`)
    failures += report("Resumo operacional da estrutura (original × read model)", result, started)
  }
  if (!only || only === "official") {
    const started = performance.now()
    const cases = await structureSubjectCases(db, organizationId)
    const result = await compareOfficialViews(db, organizationId, new Date(), cases)
    console.log(`  tempo: sem cache ${(result.uncachedMs / 1000).toFixed(1)} s × com cache (cálculo + acerto) ${(result.cachedMs / 1000).toFixed(1)} s`)
    failures += report("Camada oficial — Equipe, Indicadores, membros, Agrupar por (sem cache × com cache)", result, started)
  }
  if (!only || only === "ai") {
    const started = performance.now()
    // Cada evento (o instante dele, 1 ms antes e 1 h depois) + agora: o gasto do mês do resumo diário = o da soma original.
    const events = await db.query<{ occurred_at: Date }>(`select occurred_at from ai_usage_events where organization_id = $1 order by occurred_at`, [organizationId])
    const instants = [new Date(), ...events.rows.flatMap((row) => [row.occurred_at, new Date(row.occurred_at.getTime() - 1), new Date(row.occurred_at.getTime() + 3_600_000)])]
    failures += report("Gasto do mês de IA (resumo diário × soma original)", await compareAiMonthSpend(db, organizationId, instants), started)
  }
} finally {
  await pool.end()
}
process.exit(failures === 0 ? 0 : 1)
