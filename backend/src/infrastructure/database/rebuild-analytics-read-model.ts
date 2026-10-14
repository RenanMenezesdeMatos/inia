import { runAnalyticsRollup } from "../../modules/performance-analytics/application/analytics-rollup.js"
import { systemClock } from "../../shared/domain/clock.js"
import { pool } from "./pool.js"

/**
 * `npm run analytics:rollup` — reconstrói o read model operacional do analytics da liderança (migration 136) de TODAS as
 * organizações agora, com a mesma função da tarefa `analytics-rollup` do worker (que faz isso sozinha depois da meia-noite
 * local e a cada marca pendente). Uso: depois de `db:migrate`/carga de massa, para não esperar o worker. Idempotente.
 */
try {
  const startedAt = performance.now()
  const result = await runAnalyticsRollup(pool, { clock: systemClock, forceFull: true })
  process.stdout.write(`read model do analytics: ${JSON.stringify(result)} em ${((performance.now() - startedAt) / 1000).toFixed(1)} s\n`)
} finally {
  await pool.end()
}
