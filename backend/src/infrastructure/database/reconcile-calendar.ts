import { runScheduleHorizonAlerts } from "../../modules/people/application/schedule-horizon-alert-service.js"
import { runWorkdayReconciliation } from "../../modules/people/application/workday-reconciliation-service.js"
import { systemClock } from "../../shared/domain/clock.js"
import { pool } from "./pool.js"

/**
 * `npm run calendar:reconcile` — roda UMA rodada da reconciliação do calendário operacional (a mesma
 * função do ticker do servidor), com o relógio do sistema, e imprime o relatório. Uso no UPGRADE de um
 * ambiente existente: depois de `db:migrate`, esta rodada reavalia pela regra ATUAL toda pendência
 * "Produção não identificada" ainda aberta (SLA D-1/D-2, saúde das fontes, RH, situação funcional,
 * evidência, classificação, plano) e encerra as que a regra atual não sustenta — com o motivo, sem
 * apagar nada. Idempotente: a segunda rodada não muda nada. O servidor faz o mesmo ao subir e a cada
 * 5 minutos; este comando existe para executar/registrar explicitamente na janela de upgrade.
 */
try {
  const first = await runWorkdayReconciliation(pool, systemClock)
  process.stdout.write(`reconciliação: ${JSON.stringify(first)}\n`)
  const horizon = await runScheduleHorizonAlerts(pool, systemClock)
  process.stdout.write(`horizonte: ${JSON.stringify(horizon)}\n`)
} finally {
  await pool.end()
}
