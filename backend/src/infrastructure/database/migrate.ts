import { pool } from "./pool.js"
import { runMigrations } from "./run-migrations.js"

// `npm run db:migrate` / `db:migrate:test` — ver run-migrations.ts (função reaproveitada pelo
// check do seed de demonstração num banco descartável).
const client = await pool.connect()
try {
  await runMigrations(client, (message) => process.stdout.write(`${message}\n`))
} finally {
  client.release()
  await pool.end()
}
