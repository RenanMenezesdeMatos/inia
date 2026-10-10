import { env } from "../../config/env.js"
import { assertDemoSeedAllowed } from "./demo-seed-policy.js"
import { pool } from "./pool.js"
import { runDemoSeed } from "./run-demo-seed.js"

// `npm run db:seed:demo` (dev) / `db:seed:demo:test` (inia_test) — ver run-demo-seed.ts.
// Produção é recusada ANTES de abrir conexão (o runner repete a checagem, por construção).
assertDemoSeedAllowed(env.NODE_ENV)

const client = await pool.connect()
try {
  await runDemoSeed(client, env.NODE_ENV, (message) => process.stdout.write(`${message}\n`))
} finally {
  client.release()
  await pool.end()
}
