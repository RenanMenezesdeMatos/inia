import pg from "pg"
import { env } from "../../src/config/env.js"
import { computeDiagnosticDatasetFingerprint } from "../../src/infrastructure/database/demo-mass/diagnostic-dataset.js"

// Imprime versão + fingerprint do dataset de diagnóstico do banco (dev; NODE_ENV=test para o de teste).
//   npx tsx scripts/demo-mass/diagnostic-dataset-fingerprint.ts
const pool = new pg.Pool({ connectionString: env.NODE_ENV === "test" ? env.TEST_DATABASE_URL : env.DATABASE_URL })
const client = await pool.connect()
try {
  process.stdout.write(`${JSON.stringify(await computeDiagnosticDatasetFingerprint(client), null, 2)}\n`)
} finally {
  client.release()
  await pool.end()
}
