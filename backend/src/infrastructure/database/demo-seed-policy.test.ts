import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { assertDemoSeedAllowed, countUnguardedInserts } from "./demo-seed-policy.js"

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..")

async function sqlFiles(folder: string): Promise<{ name: string; sql: string }[]> {
  const directory = join(root, folder)
  const names = (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()
  return Promise.all(names.map(async (name) => ({ name, sql: await readFile(join(directory, name), "utf8") })))
}

describe("seed de demonstração — política de ambiente", () => {
  it("dev e test podem carregar o seed", () => {
    expect(() => assertDemoSeedAllowed("development")).not.toThrow()
    expect(() => assertDemoSeedAllowed("test")).not.toThrow()
  })

  it("produção é recusada sem exceção", () => {
    expect(() => assertDemoSeedAllowed("production")).toThrow(/NODE_ENV=production/)
  })
})

describe("seed de demonstração — separação de migrations", () => {
  it("nenhuma migration insere linhas DEMO_SEED (o caminho `db:migrate` nunca injeta demo de performance)", async () => {
    const migrations = await sqlFiles("migrations")
    const offenders = migrations.filter((file) => /insert[\s\S]*?'DEMO_SEED'/i.test(file.sql)).map((file) => file.name)
    expect(offenders).toEqual([])
  })

  it("a migration 050 continua existindo como no-op (histórico local preservado)", async () => {
    const migrations = await sqlFiles("migrations")
    const legacy = migrations.find((file) => file.name === "050_demo_operator_performance_seed.sql")
    expect(legacy).toBeDefined()
    expect(legacy!.sql).not.toMatch(/insert\s+into/i)
  })

  it("todo insert dos seeds de demo é idempotente (`not exists`/`on conflict`)", async () => {
    const seeds = await sqlFiles("seeds/demo")
    expect(seeds.length).toBeGreaterThan(0)
    for (const seed of seeds) expect(countUnguardedInserts(seed.sql), seed.name).toBe(0)
    // Todo arquivo marca o que é demo: origem 'DEMO_SEED' onde a tabela tem essa coluna, ou ids determinísticos de00… nas
    // tabelas de configuração (tipos, políticas, competências), que não têm coluna de origem.
    for (const seed of seeds) expect(seed.sql.includes("'DEMO_SEED'") || /'de00[0-9a-f]{4}-0000-4000-8000-[0-9a-f]{12}'/.test(seed.sql), seed.name).toBe(true)
  })
})

describe("massa demo — runners protegidos", () => {
  it("seed e reset recusam produção ANTES de tocar no pool (guarda no topo do arquivo)", async () => {
    for (const runner of ["seed-demo.ts", "reset-demo.ts"]) {
      const source = await readFile(join(root, "src/infrastructure/database", runner), "utf8")
      const guardAt = source.indexOf("assertDemoSeedAllowed(env.NODE_ENV)")
      const poolAt = source.indexOf("pool.connect()")
      expect(guardAt, runner).toBeGreaterThan(-1)
      expect(poolAt, runner).toBeGreaterThan(guardAt)
    }
  })

  it("o servidor nunca importa o gerador da massa demo", async () => {
    const server = await readFile(join(root, "src/main/app.ts"), "utf8")
    expect(server).not.toMatch(/demo-mass|seed-demo|reset-demo/)
  })
})

describe("countUnguardedInserts", () => {
  it("conta só inserts sem guarda", () => {
    expect(countUnguardedInserts("insert into t values (1);\ninsert into t select 1 where not exists (select 1);")).toBe(1)
    expect(countUnguardedInserts("insert into t values (1) on conflict do nothing;")).toBe(0)
  })
})
