import pg from "pg"
import { env } from "../../src/config/env.js"
import { assertDemoSeedAllowed } from "../../src/infrastructure/database/demo-seed-policy.js"
import { loadDemoMass } from "../../src/infrastructure/database/demo-mass/seed-demo-mass.js"

/**
 * REPARO ÚNICO do drift de fechamento oficial introduzido pelo commit 6768fbf (2026-09-18): naquela
 * carga o seed reprocessou fechamentos/PRV pela ESTRUTURA ATUAL (coorte do quartil = Grupo atual;
 * catálogo = Grupo atual) e o "prune" apagou fechamentos do Grupo anterior dos 11 legados. O gerador
 * agora materializa snapshots pela posição VIGENTE na competência (`placementAt`) e a persistência é
 * insert-only — mas o que já estava reescrito no banco não volta sozinho.
 *
 * Este script compara cada linha que o gerador produz com a linha do banco de MESMO ID (só ids
 * determinísticos da massa; só `source = 'DEMO_SEED'`) e devolve as divergentes ao snapshot do gerador.
 * Linhas de qualquer outra origem (seed SQL 001, ingestão, QA) têm id aleatório e nunca entram.
 * Dry-run por padrão; `--apply` grava. Recusa produção. Idempotente (2ª rodada = 0 divergências).
 *
 *   npx tsx scripts/demo-mass/restore-official-snapshot.ts [--apply]         (banco de desenvolvimento)
 *   NODE_ENV=test npx tsx scripts/demo-mass/restore-official-snapshot.ts [--apply]
 */
assertDemoSeedAllowed(env.NODE_ENV)
const apply = process.argv.includes("--apply")
const pool = new pg.Pool({ connectionString: env.NODE_ENV === "test" ? env.TEST_DATABASE_URL : env.DATABASE_URL })
const client = await pool.connect()
try {
  const mass = await loadDemoMass(client)
  const num = (value: string | number | null) => (value === null ? null : Number(value))
  const indicatorIds = mass.performance.indicatorRows.map((row) => row.id)
  const dbIndicator = await client.query<{ id: string; value: string; target_value: string; achievement_percent: string; weight_percent: string; quartile: string; subteam_id: string | null }>(
    `select id, value, target_value, achievement_percent, weight_percent, quartile, subteam_id from employee_indicator_performance where id = any($1::uuid[]) and source = 'DEMO_SEED'`,
    [indicatorIds],
  )
  const byId = new Map(dbIndicator.rows.map((row) => [row.id, row]))
  const drift = { quartileOnly: 0, value: 0, subteam: 0, missing: 0 }
  const toFix: typeof mass.performance.indicatorRows = []
  for (const row of mass.performance.indicatorRows) {
    const current = byId.get(row.id)
    if (!current) {
      drift.missing += 1
      continue
    }
    const sameValues = num(current.value) === row.value && num(current.target_value) === row.targetValue && num(current.achievement_percent) === row.achievementPercent && num(current.weight_percent) === row.weightPercent
    const sameQuartile = current.quartile === row.quartile
    const sameSubteam = current.subteam_id === row.subteamId
    if (sameValues && sameQuartile && sameSubteam) continue
    if (!sameValues) drift.value += 1
    else if (!sameQuartile) drift.quartileOnly += 1
    else drift.subteam += 1
    toFix.push(row)
  }
  const prvIds = mass.performance.prvRows.map((row) => row.id)
  const dbPrv = await client.query<{ id: string; achievement_percent: string; quartile: string; subteam_id: string | null }>(`select id, achievement_percent, quartile, subteam_id from employee_prv_performance where id = any($1::uuid[]) and source = 'DEMO_SEED'`, [prvIds])
  const prvById = new Map(dbPrv.rows.map((row) => [row.id, row]))
  const prvDrift = { quartileOnly: 0, value: 0, subteam: 0, missing: 0 }
  const prvToFix: typeof mass.performance.prvRows = []
  for (const row of mass.performance.prvRows) {
    const current = prvById.get(row.id)
    if (!current) {
      prvDrift.missing += 1
      continue
    }
    const sameValue = num(current.achievement_percent) === row.achievementPercent
    if (sameValue && current.quartile === row.quartile && current.subteam_id === row.subteamId) continue
    if (!sameValue) prvDrift.value += 1
    else if (current.quartile !== row.quartile) prvDrift.quartileOnly += 1
    else prvDrift.subteam += 1
    prvToFix.push(row)
  }
  process.stdout.write(`fechamentos de indicador (ids do gerador, DEMO_SEED): ${dbIndicator.rows.length} no banco; divergentes ${toFix.length} (só quartil ${drift.quartileOnly}, valor/atingimento/peso ${drift.value}, só subteam ${drift.subteam}); ausentes no banco ${drift.missing} (o seed insert-only cria)\n`)
  process.stdout.write(`PRV (ids do gerador, DEMO_SEED): ${dbPrv.rows.length} no banco; divergentes ${prvToFix.length} (só quartil ${prvDrift.quartileOnly}, valor ${prvDrift.value}, só subteam ${prvDrift.subteam}); ausentes ${prvDrift.missing}\n`)
  if (!apply) {
    process.stdout.write("dry-run — nada gravado (use --apply para restaurar o snapshot do gerador nas linhas divergentes)\n")
  } else {
    await client.query("begin")
    try {
      for (const row of toFix) {
        await client.query(`update employee_indicator_performance set value = $2, target_value = $3, achievement_percent = $4, weight_percent = $5, quartile = $6, subteam_id = $7 where id = $1 and source = 'DEMO_SEED'`, [row.id, row.value, row.targetValue, row.achievementPercent, row.weightPercent, row.quartile, row.subteamId])
      }
      for (const row of prvToFix) {
        await client.query(`update employee_prv_performance set achievement_percent = $2, quartile = $3, subteam_id = $4 where id = $1 and source = 'DEMO_SEED'`, [row.id, row.achievementPercent, row.quartile, row.subteamId])
      }
      await client.query("commit")
      process.stdout.write(`restaurado: ${toFix.length} fechamento(s) de indicador e ${prvToFix.length} PRV devolvidos ao snapshot do gerador\n`)
    } catch (error) {
      await client.query("rollback")
      throw error
    }
  }
} finally {
  client.release()
  await pool.end()
}
