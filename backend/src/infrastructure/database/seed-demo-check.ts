import { seedDemoFromScratch } from "./seed-demo-from-scratch.js"

// `npm run db:seed:demo:check` — prova o seed do zero num banco descartável (nunca em inia/inia_test).
const adminUrl = process.env.POSTGRES_ADMIN_URL ?? "postgresql://localhost:5432/postgres"
const result = await seedDemoFromScratch(adminUrl, (message) => process.stdout.write(`${message}\n`))
process.stdout.write(`${JSON.stringify({ database: result.database, migrationsApplied: result.migrationsApplied, sqlFiles: result.first.sqlFiles, counts: result.counts }, null, 2)}\n`)
if (result.counts.officialRowsCurrentMonth > 0) {
  process.stderr.write("FALHA: fechamento oficial no mês corrente após o seed.\n")
  process.exit(1)
}
