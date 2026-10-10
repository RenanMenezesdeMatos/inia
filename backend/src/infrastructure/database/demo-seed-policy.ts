/**
 * Política do seed de demonstração — separada do runner (seed-demo.ts) para ser testável sem
 * Postgres. MIGRATION = evolução estrutural obrigatória do banco; DEMO SEED = dados fictícios
 * de dev/teste/demo. Produção nunca recebe o seed por caminho automático: `npm run db:migrate`
 * não conhece a pasta seeds/, e este runner recusa NODE_ENV=production sem exceção.
 */
export type DemoSeedEnvironment = "development" | "test" | "production"

export function assertDemoSeedAllowed(nodeEnv: DemoSeedEnvironment): void {
  if (nodeEnv === "production") {
    throw new Error("Seed de demonstração recusado: NODE_ENV=production. Dados DEMO_SEED só existem em dev/test.")
  }
}

/** Todo insert de um seed precisa ser idempotente (`not exists`) — rodar duas vezes nunca
 * duplica linhas. Checado por teste sobre o conteúdo real dos arquivos. */
export function countUnguardedInserts(sql: string): number {
  const statements = sql
    .split(/;\s*(?:\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => /^insert\s+into/i.test(statement))
  return statements.filter((statement) => !/not\s+exists/i.test(statement) && !/on\s+conflict/i.test(statement)).length
}
