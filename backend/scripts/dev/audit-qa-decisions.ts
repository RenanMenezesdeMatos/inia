/**
 * V1.7.1g — AUDITORIA (somente leitura) das decisões de QA de feedback numa janela de tempo. Roda numa transação READ ONLY e
 * termina com ROLLBACK: não aprova, não rejeita, não reverte, não grava nada.
 *
 *   npx tsx scripts/dev/audit-qa-decisions.ts <organizationId> <de ISO> <até ISO>
 *   npx tsx scripts/dev/audit-qa-decisions.ts 00000000-0000-4000-8000-000000000001 2026-09-25T18:10:00-03:00 2026-09-25T18:12:00-03:00
 */
import { pool } from "../../src/infrastructure/database/pool.js"
import { loadQaDecisionAudit } from "../../src/modules/interaction-feedback/application/qa-decision-audit.js"

const [organizationId, from, to] = process.argv.slice(2)
if (!organizationId || !from || !to) throw new Error("uso: audit-qa-decisions.ts <organizationId> <de ISO> <até ISO>")
const client = await pool.connect()
try {
  await client.query("begin read only")
  const report = await loadQaDecisionAudit({ query: client.query.bind(client), connect: pool.connect.bind(pool) } as never, { organizationId, from: new Date(from), to: new Date(to) })
  console.log(JSON.stringify(report, null, 2))
} finally {
  await client.query("rollback")
  client.release()
  await pool.end()
}
