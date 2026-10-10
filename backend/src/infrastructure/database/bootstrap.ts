import { env } from "../../config/env.js"
import { bootstrapEnvironment } from "./bootstrap-environment.js"
import { pool } from "./pool.js"

/**
 * `npm run db:bootstrap` / `db:bootstrap:test` — migrations → reference data → demo (quando aplicável).
 * `INIA_BOOTSTRAP_DEMO=skip` pula a etapa demo em dev/test; produção nunca a executa.
 */
const demo = process.env.INIA_BOOTSTRAP_DEMO === "skip" ? "SKIP" : "AUTO"
const client = await pool.connect()
try {
  await bootstrapEnvironment(client, { nodeEnv: env.NODE_ENV, demo }, (message) => process.stdout.write(`${message}\n`))
} finally {
  client.release()
  await pool.end()
}
