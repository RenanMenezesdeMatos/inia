import type pg from "pg"
import type { DemoSeedEnvironment } from "./demo-seed-policy.js"
import { runDemoSeed, type DemoSeedRunReport } from "./run-demo-seed.js"
import { runMigrations } from "./run-migrations.js"
import { runReferenceSeed, type ReferenceSeedReport } from "./run-reference-seed.js"

/**
 * BOOTSTRAP OFICIAL DE AMBIENTE — a sequência que ninguém precisa lembrar de cabeça:
 *   migrations até HEAD → reference data (feriados; capitais vêm das migrations) → dados demo (só quando
 *   aplicável: dev/test, nunca produção — a política do runner continua valendo).
 * Idempotente de ponta a ponta: rodar de novo aplica zero migrations, insere zero feriados e o seed demo
 * faz upsert. `npm run db:bootstrap` (dev) / `db:bootstrap:test` (inia_test); em produção
 * (`NODE_ENV=production`) a etapa demo é pulada automaticamente, sem flag.
 */
export type BootstrapReport = { migrationsApplied: string[]; reference: ReferenceSeedReport; demo: DemoSeedRunReport | null; demoSkippedReason: string | null }

/** `demoPassword`: senha das contas demo; ausente = INIA_DEMO_PASSWORD do ambiente (backend/.env). */
export type BootstrapOptions = { nodeEnv: DemoSeedEnvironment; demo?: "AUTO" | "SKIP" | "REQUIRE"; demoPassword?: string }

export async function bootstrapEnvironment(client: pg.PoolClient, options: BootstrapOptions, log: (message: string) => void = () => {}): Promise<BootstrapReport> {
  const migrationsApplied = await runMigrations(client, log)
  log(`migrations: ${migrationsApplied.length} aplicada(s) — banco em HEAD`)
  const reference = await runReferenceSeed(client, log)
  if (reference.capitals !== 27) throw new Error(`bootstrap: esperadas exatamente 27 capitais em brazilian_capitals, encontradas ${reference.capitals}`)
  log(`reference data: ${reference.capitals} capitais · ${reference.holidays.total} feriados no catálogo (${reference.holidays.inserted} novos) · ${reference.gaps} lacuna(s) registrada(s)`)
  const mode = options.demo ?? "AUTO"
  if (mode === "SKIP" || (mode === "AUTO" && options.nodeEnv === "production")) {
    const reason = mode === "SKIP" ? "etapa demo desligada (demo: SKIP)" : "NODE_ENV=production: dados demo nunca entram em produção"
    log(`demo: pulado — ${reason}`)
    return { migrationsApplied, reference, demo: null, demoSkippedReason: reason }
  }
  const demo = await runDemoSeed(client, options.nodeEnv, log, undefined, options.demoPassword)
  return { migrationsApplied, reference, demo, demoSkippedReason: null }
}
