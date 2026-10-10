import { env } from "../../config/env.js"
import { resetDemoMassSeed } from "./demo-mass/seed-demo-mass.js"
import { assertDemoSeedAllowed } from "./demo-seed-policy.js"
import { pool } from "./pool.js"

// Remove SOMENTE a massa demo gerada por demo-mass/ (por lista explícita de ids). Não toca nos
// seeds SQL de seeds/demo nem em qualquer dado fora da massa; se algo fora dela referencia
// pessoas/interações demo, aborta e lista os bloqueios. Recusa produção como o seed.
assertDemoSeedAllowed(env.NODE_ENV)

const client = await pool.connect()
const log = (message: string) => process.stdout.write(`${message}\n`)

try {
  const report = await resetDemoMassSeed(client, log)
  if (report.blockers.length === 0) {
    log("=== Massa demo — reset concluído ===")
    for (const [table, count] of Object.entries(report.deleted)) log(`${table.padEnd(32)} ${count}`)
  } else {
    process.exitCode = 1
  }
} finally {
  client.release()
  await pool.end()
}
