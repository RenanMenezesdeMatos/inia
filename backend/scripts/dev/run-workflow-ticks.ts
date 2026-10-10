/** Roda até 10 passadas do motor de Workflow neste processo e para quando não há mais nada vencido (diagnóstico local). */
import { pool } from "../../src/infrastructure/database/pool.js"
import { runWorkflowTick } from "../../src/modules/workflows/application/engine.js"

async function main() {
  for (let i = 0; i < 10; i++) {
    const { processed } = await runWorkflowTick(pool)
    console.log(`tick ${i + 1}: processed=${processed}`)
    if (processed === 0) break
  }
  await pool.end()
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
