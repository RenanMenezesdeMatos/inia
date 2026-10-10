import { pool } from "./pool.js"
import { runReferenceSeed } from "./run-reference-seed.js"

/** `npm run db:seed:reference` / `db:seed:reference:test` — ver run-reference-seed.ts (idempotente; vale em produção). */
const client = await pool.connect()
try {
  await runReferenceSeed(client, (message) => process.stdout.write(`${message}\n`))
} finally {
  client.release()
  await pool.end()
}
