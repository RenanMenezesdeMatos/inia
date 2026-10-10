/** Conferência (somente leitura) do que o motor verá: chamadas e sinal por assunto da Larissa em agosto × setembro. */
import { pool } from "../../../../src/infrastructure/database/pool.js"
import { createPostgresIndicatorData } from "../../../../src/modules/feedback-engine/infrastructure/postgres-indicator-data.js"

const LARISSA = "de00ae6a-c8c9-490a-816b-e3cc8cf18986"
const org = (await pool.query<{ organization_id: string }>(`select organization_id from people where id = $1`, [LARISSA])).rows[0]!.organization_id
const data = createPostgresIndicatorData(pool)
const window = (start: string, end: string) => ({ start: new Date(`${start}T03:00:00Z`), end: new Date(`${end}T03:00:00Z`) })
for (const [label, signal] of [["nota_ura ≤ 2", { flagName: "nota_ura", condition: { operator: "LTE" as const, value: 2 } }], ["rechamada", { flagName: "rechamada", condition: null }]] as const) {
  const resolved = await data.resolveSignal(org, signal)
  for (const [month, w] of [["ago", window("2026-08-01", "2026-09-01")], ["set", window("2026-09-01", "2026-10-01")]] as const) {
    const rows = await data.segmentRows(org, [LARISSA], w, resolved)
    console.log(label, month, rows.filter((row) => row.n > 0).map((row) => `${row.key}:${row.signaled}/${row.n}`).join("  "))
  }
}
await pool.end()
