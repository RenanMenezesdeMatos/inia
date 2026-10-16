import pg from "pg"
import { env } from "../../src/config/env.js"
import { DEMO_ORGANIZATION_ID, DEMO_SOURCE } from "../../src/infrastructure/database/demo-mass/demo-constants.js"
import { fillDemoClosureComponents } from "../../src/infrastructure/database/demo-mass/closure-components.js"
import { assertDemoSeedAllowed } from "../../src/infrastructure/database/demo-seed-policy.js"
import { checkComponentCoherence, componentValueScale } from "../../src/modules/indicators/domain/indicator-definition.js"
import type { OperationalAggregationKind } from "../../src/modules/indicators/domain/operational-aggregation.js"

/**
 * Numerador e denominador nos fechamentos oficiais DEMO de um banco já populado (migration 147, contrato
 * OFFICIAL_INDICATOR_PERFORMANCE@2). Só `source = 'DEMO_SEED'` da organização demo, só linhas ainda sem
 * componentes e só estratégias que os definem (Taxa, Média ponderada); valor, meta, atingimento, peso e
 * quartil nunca mudam, e linha de outra origem nunca é lida. Mesmo cálculo do gerador e do `db:seed:demo`
 * (demo-mass/closure-components.ts). Dry-run por padrão; `--apply` grava numa transação. Recusa produção.
 * Idempotente: a segunda rodada não encontra pendência. No fim confere TODOS os fechamentos demo com
 * componentes pela regra do contrato (incoerentes = 0).
 *
 *   npx tsx scripts/demo-mass/backfill-official-closure-components.ts [--apply]         (banco de desenvolvimento)
 *   NODE_ENV=test npx tsx scripts/demo-mass/backfill-official-closure-components.ts [--apply]
 */
assertDemoSeedAllowed(env.NODE_ENV)
const apply = process.argv.includes("--apply")
const pool = new pg.Pool({ connectionString: env.NODE_ENV === "test" ? env.TEST_DATABASE_URL : env.DATABASE_URL })
const client = await pool.connect()
try {
  await client.query("begin")
  const report = await fillDemoClosureComponents(client, { apply })
  await client.query("commit")
  console.log(`${apply ? "APLICADO" : "DRY-RUN"} (${env.NODE_ENV === "test" ? "banco de teste" : "banco de desenvolvimento"}): ${report.pending} fechamento(s) demo sem componentes de estratégia que os define; ${report.filled} preenchido(s); ${report.withoutComponents} de estratégia sem componentes (ficam nulos).`)

  const rows = await client.query<{ code: string; kind: OperationalAggregationKind; value: string; numerator: string | null; denominator: string | null }>(
    `select idef.code, idef.operational_aggregation kind, eip.value::text value, eip.numerator::text numerator, eip.denominator::text denominator
       from employee_indicator_performance eip join indicator_definitions idef on idef.id = eip.indicator_definition_id
      where eip.organization_id = $1 and eip.source = $2`,
    [DEMO_ORGANIZATION_ID, DEMO_SOURCE],
  )
  const summary = { total: rows.rows.length, withComponents: 0, missing: 0, incoherent: 0, unexpected: 0 }
  for (const row of rows.rows) {
    const usesComponents = componentValueScale(row.kind) !== null
    if (row.numerator === null || row.denominator === null) {
      if (usesComponents) summary.missing += 1
      continue
    }
    summary.withComponents += 1
    if (!usesComponents) summary.unexpected += 1
    else if (!checkComponentCoherence(row.kind, Number(row.value), Number(row.numerator), Number(row.denominator))?.coherent) summary.incoherent += 1
  }
  console.log(`conferência: ${summary.total} fechamento(s) demo; ${summary.withComponents} com numerador/denominador; ${summary.missing} de Taxa/Média ponderada ainda sem componentes; ${summary.incoherent} incoerente(s); ${summary.unexpected} com componentes em estratégia que não os usa.`)
} catch (error) {
  await client.query("rollback")
  throw error
} finally {
  client.release()
  await pool.end()
}
