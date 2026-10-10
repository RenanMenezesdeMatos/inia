import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type pg from "pg"
import { resolveDemoPassword } from "./demo-mass/demo-constants.js"
import { formatReport, seedDemoMass } from "./demo-mass/seed-demo-mass.js"
import { assertDemoSeedAllowed, type DemoSeedEnvironment } from "./demo-seed-policy.js"

/**
 * Carga EXPLÍCITA dos dados de demonstração — função pura de runner (testável contra um banco
 * recém-migrado, sem depender de NODE_ENV do processo), em duas etapas:
 *   1. backend/seeds/demo/*.sql, em ordem — cada arquivo idempotente por construção (`not exists`)
 *      e AUTOSSUFICIENTE: só referencia pessoas/indicadores que existem no banco alvo (o seed legado
 *      001 faz `join people` — num banco limpo só carrega as 2 pessoas legadas que as migrations criam,
 *      em vez de estourar FK com as outras 9);
 *   2. a MASSA DEMO grande (demo-mass/), também idempotente (upsert por id determinístico).
 * Nada é registrado em schema_migrations: repetir a carga é seguro. Um erro em qualquer etapa
 * propaga (rollback do arquivo + throw) — nunca é engolido.
 * Produção é recusada antes de tocar o banco, sem exceção — e, fora dela, a senha das contas demo
 * (INIA_DEMO_PASSWORD) também é conferida antes, para nunca falhar no meio da carga.
 */
export type DemoSeedRunReport = { sqlFiles: { name: string; rowsAffected: number }[]; massReport: string }

export const DEMO_SEED_DIRECTORY = join(dirname(fileURLToPath(import.meta.url)), "../../../seeds/demo")

export async function runDemoSeed(client: pg.PoolClient, nodeEnv: DemoSeedEnvironment, log: (message: string) => void, directory = DEMO_SEED_DIRECTORY, demoPasswordValue = process.env.INIA_DEMO_PASSWORD): Promise<DemoSeedRunReport> {
  assertDemoSeedAllowed(nodeEnv)
  const demoPassword = resolveDemoPassword(demoPasswordValue)
  // Instalação real (npm run setup sem --demo) nunca recebe a massa demo, cujas contas compartilham uma senha só.
  const installation = await client.query<{ demo_data: boolean }>(`select demo_data from installation_info`).catch(() => ({ rows: [] as { demo_data: boolean }[] }))
  if (installation.rows[0] && !installation.rows[0].demo_data) {
    throw new Error("Seed de demonstração recusado: este banco é uma instalação da INIA sem dados de demonstração (installation_info.demo_data = false). Para avaliar com demo, faça uma instalação separada com npm run setup -- --demo.")
  }
  const files = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
  const sqlFiles: DemoSeedRunReport["sqlFiles"] = []
  for (const file of files) {
    await client.query("begin")
    try {
      const results = await client.query(await readFile(join(directory, file), "utf8"))
      // Multi-statement: pg devolve um array de resultados. Somamos rowCount pra dizer quantas
      // linhas o arquivo de fato inseriu (0 num banco sem as pessoas legadas — visível, nunca silencioso).
      const rowsAffected = (Array.isArray(results) ? results : [results]).reduce((sum, result) => sum + (result.rowCount ?? 0), 0)
      await client.query("commit")
      sqlFiles.push({ name: file, rowsAffected })
      log(`seeded ${file} (${rowsAffected} linha(s))`)
    } catch (error) {
      await client.query("rollback")
      throw new Error(`seed ${file} falhou: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
    }
  }
  const report = await seedDemoMass(client, log, demoPassword)
  const massReport = formatReport(report)
  log(massReport)
  return { sqlFiles, massReport }
}
