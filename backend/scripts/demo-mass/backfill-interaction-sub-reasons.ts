import pg from "pg"
import { env } from "../../src/config/env.js"
import { assertDemoSeedAllowed } from "../../src/infrastructure/database/demo-seed-policy.js"
import { DEMO_ORGANIZATION_ID } from "../../src/infrastructure/database/demo-mass/demo-constants.js"
import { loadDemoMass } from "../../src/infrastructure/database/demo-mass/seed-demo-mass.js"

/**
 * AJUSTE ÚNICO da massa demo já gravada ao MOTIVO × SUBMOTIVO (migration 145, 2026-10-16): o gerador passou a gravar o
 * motivo genérico do cenário em `reason` ("Fatura") e a frase específica de antes em `sub_reason` ("Segunda via de fatura").
 * Um banco que já tinha a massa não muda sozinho (o seed completo faz muito mais do que isso).
 *
 * Só linhas com o MESMO ID determinístico que o gerador produz, na organização demo, e só quando o banco ainda tem a frase
 * específica no motivo e nenhum submotivo (exatamente o estado anterior). Qualquer outra diferença é relatada e não tocada.
 * Subgrupo "Diagnóstico IA", transcrições canônicas e lote de diagnóstico ficam como estão (o gerador não dá submotivo a
 * eles — ver `interactionSubjectOf`). Dry-run por padrão; `--apply` grava. Recusa produção. Idempotente (2ª rodada = 0).
 * Desfazer: `update interactions set reason = sub_reason, sub_reason = null where id = any(<ids relatados>)`.
 *
 *   npx tsx scripts/demo-mass/backfill-interaction-sub-reasons.ts [--apply]         (banco de desenvolvimento)
 *   NODE_ENV=test npx tsx scripts/demo-mass/backfill-interaction-sub-reasons.ts [--apply]
 */
assertDemoSeedAllowed(env.NODE_ENV)
const apply = process.argv.includes("--apply")
const pool = new pg.Pool({ connectionString: env.NODE_ENV === "test" ? env.TEST_DATABASE_URL : env.DATABASE_URL })
const client = await pool.connect()
try {
  const mass = await loadDemoMass(client)
  const generated = mass.structure.people.filter((person) => person.role === "OPERATOR").flatMap((person) => mass.interactionsOf(person)).filter((row) => row.subReason !== null)
  const current = await client.query<{ id: string; reason: string; sub_reason: string | null }>(
    `select id, reason, sub_reason from interactions where organization_id = $1 and id = any($2::uuid[])`,
    [DEMO_ORGANIZATION_ID, generated.map((row) => row.id)],
  )
  const byId = new Map(current.rows.map((row) => [row.id, row]))
  const toFix: typeof generated = []
  const count = { alreadyDone: 0, missing: 0, divergent: 0 }
  for (const row of generated) {
    const stored = byId.get(row.id)
    if (!stored) count.missing += 1
    else if (stored.reason === row.reason && stored.sub_reason === row.subReason) count.alreadyDone += 1
    else if (stored.reason === row.subReason && stored.sub_reason === null) toFix.push(row)
    else count.divergent += 1
  }
  process.stdout.write(
    `interações geradas com submotivo: ${generated.length}; no banco ${current.rows.length}; a ajustar ${toFix.length}; já ajustadas ${count.alreadyDone}; ` +
      `divergentes (não tocadas) ${count.divergent}; ausentes no banco ${count.missing}\n`,
  )
  const motives = new Map<string, number>()
  for (const row of toFix) motives.set(row.reason, (motives.get(row.reason) ?? 0) + 1)
  if (motives.size > 0) process.stdout.write(`motivos: ${[...motives.entries()].sort((a, b) => b[1] - a[1]).map(([motive, n]) => `${motive} ${n}`).join(" · ")}\n`)
  if (!apply) {
    process.stdout.write("dry-run — nada gravado (use --apply para mover a frase específica para o submotivo)\n")
  } else {
    await client.query("begin")
    try {
      for (let index = 0; index < toFix.length; index += 1000) {
        const part = toFix.slice(index, index + 1000)
        await client.query(
          `update interactions i set reason = t.reason, sub_reason = t.sub_reason
             from unnest($2::uuid[], $3::text[], $4::text[]) as t(id, reason, sub_reason)
            where i.id = t.id and i.organization_id = $1 and i.reason = t.sub_reason and i.sub_reason is null`,
          [DEMO_ORGANIZATION_ID, part.map((row) => row.id), part.map((row) => row.reason), part.map((row) => row.subReason)],
        )
      }
      await client.query("commit")
      process.stdout.write(`ajustado: ${toFix.length} interação(ões) com motivo genérico + submotivo\n`)
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  }
} finally {
  client.release()
  await pool.end()
}
