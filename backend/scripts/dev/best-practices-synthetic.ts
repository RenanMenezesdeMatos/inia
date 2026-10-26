/**
 * BASE DE BOAS PRÁTICAS — dataset SINTÉTICO de demonstração (BP_SINTETICO_V1) no banco de desenvolvimento.
 *
 * Os dados ficam SÓ em `best_practice_synthetic_datasets` (nenhuma linha em interactions/people/fechamentos) e tudo que nasce dele
 * é `data_origin = 'SYNTHETIC'`: nunca alimenta recomendação de produção. O pedido e o processamento passam pelos MESMOS serviços
 * da tela e do worker (`createAnalysis`, fila, `processAnalysis`).
 *
 *   npx tsx scripts/dev/best-practices-synthetic.ts load
 *   npx tsx scripts/dev/best-practices-synthetic.ts analyze [TMA|NOTA_URA|FCR] [--level REASON|SUB_REASON] [--model simulated|real]
 *   npx tsx scripts/dev/best-practices-synthetic.ts report
 *   npx tsx scripts/dev/best-practices-synthetic.ts process [--allow-real]   (drena a fila quando a API roda sem worker; IA real só com a flag)
 *   npx tsx scripts/dev/best-practices-synthetic.ts reset
 * Todos aceitam `--key CHAVE` (padrão BP_SINTETICO_V1) para trabalhar numa cópia do dataset com escopo próprio.
 *
 * `--model simulated` (padrão) = zero IA: respostas do gabarito, só validam o mecanismo. `--model real` chama o modelo de verdade
 * (Use Case BEST_PRACTICE_ANALYSIS; ~25 chamadas por análise, custo registrado no uso de IA da organização). Recusa NODE_ENV=production.
 */
import pg from "pg"
import { env } from "../../src/config/env.js"
import type { Database } from "../../src/infrastructure/database/pool.js"
import { registerAiRuntime } from "../../src/shared/application/model-routing/ai-runtime.js"
import { createAiRuntime } from "../../src/modules/ai-management/application/ai-runtime-service.js"
import { createAnalysis, processBestPracticeAnalyses } from "../../src/modules/best-practices/application/analysis-service.js"
import { removeSyntheticDataset, upsertSyntheticDataset } from "../../src/modules/best-practices/application/synthetic-datasets.js"
import { buildSyntheticDataset, SYNTHETIC_DATASET_KEY, SYNTHETIC_PERIOD } from "../../src/modules/best-practices/testing/synthetic-dataset.js"

if (process.env.NODE_ENV === "production") throw new Error("Dados sintéticos recusados em produção.")
const [mode, ...rest] = process.argv.slice(2)
const FLAGS_WITH_VALUE = new Set(["--level", "--model", "--key"])
const flag = (name: string) => {
  const index = rest.indexOf(name)
  return index >= 0 ? rest[index + 1] ?? null : null
}
/** Argumentos posicionais (o que não é flag nem valor de flag). */
const positional = rest.filter((item, index) => !item.startsWith("--") && !FLAGS_WITH_VALUE.has(rest[index - 1] ?? ""))
/** `--key` escolhe o dataset (padrão BP_SINTETICO_V1): uma cópia com outra chave tem escopo próprio — útil para validar a IA real sem os padrões do modelo simulado. */
const DATASET_KEY = flag("--key") ?? SYNTHETIC_DATASET_KEY
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 4 })
const db = pool as unknown as Database
const ORG = "00000000-0000-4000-8000-000000000001"

async function actor() {
  const row = (await db.query<{ account_id: string; person_id: string }>(
    `select ua.id account_id, ua.person_id from access_role_assignments a join user_accounts ua on ua.id = a.user_account_id
      where a.organization_id = $1 and a.role_code = 'ADMINISTRADOR_GERAL' and a.scope_type = 'ORGANIZATION' and ua.person_id is not null order by a.granted_at limit 1`,
    [ORG],
  )).rows[0]
  if (!row) throw new Error("Nenhum Administrador geral para registrar a autoria da análise.")
  return { organizationId: ORG, personId: row.person_id, accountId: row.account_id }
}

async function datasetId(): Promise<string> {
  const row = (await db.query<{ id: string }>(`select id from best_practice_synthetic_datasets where organization_id = $1 and dataset_key = $2`, [ORG, DATASET_KEY])).rows[0]
  if (!row) throw new Error("Dataset não carregado: rode `load` antes.")
  return row.id
}

async function main() {
  if (mode === "load") {
    const dataset = buildSyntheticDataset()
    const copy = DATASET_KEY !== SYNTHETIC_DATASET_KEY
    const result = await upsertSyntheticDataset(db, ORG, { ...dataset, key: DATASET_KEY, label: copy ? `${dataset.label} · cópia ${DATASET_KEY}` : dataset.label })
    console.log(`${result.created ? "Carregado" : "Atualizado"}: ${DATASET_KEY} (${result.id})`)
    return
  }
  if (mode === "analyze") {
    const code = positional[0] ?? "TMA"
    const level = flag("--level") === "SUB_REASON" ? "SUB_REASON" : "REASON"
    const real = flag("--model") === "real"
    if (real) registerAiRuntime(createAiRuntime(pool))
    const indicator = (await db.query<{ id: string }>(`select id from indicator_definitions where organization_id = $1 and code = $2`, [ORG, code])).rows[0]
    if (!indicator) throw new Error(`Indicador ${code} não existe na organização.`)
    const created = await createAnalysis(db, await actor(), { unrestricted: true }, { origin: "SYNTHETIC", syntheticDatasetId: await datasetId(), indicatorDefinitionId: indicator.id, referencePeriods: [SYNTHETIC_PERIOD], contextLevel: level, modelMode: real ? "REAL" : "SIMULATED_ANSWER_KEY" })
    console.log(`Análise ${created.id} na fila (${code}, ${level}, modelo ${real ? "REAL" : "simulado"}). Processando…`)
    while ((await db.query(`select 1 from best_practice_analyses where id = $1 and status in ('QUEUED', 'RUNNING')`, [created.id])).rowCount) await processBestPracticeAnalyses(db)
    await report(created.id)
    return
  }
  if (mode === "report") return report(null)
  if (mode === "process") {
    // Análise com IA real na fila só é processada com `--allow-real` (custo); sem ele, nada é processado.
    const realQueued = (await db.query(`select 1 from best_practice_analyses where organization_id = $1 and status in ('QUEUED', 'RUNNING') and model_mode = 'REAL'`, [ORG])).rowCount
    if (realQueued && !rest.includes("--allow-real")) throw new Error("Há análise com IA REAL na fila: rode `process --allow-real` para processá-la (custo de IA registrado).")
    if (realQueued) registerAiRuntime(createAiRuntime(pool))
    let processed = 0
    while ((await processBestPracticeAnalyses(db)) > 0) processed += 1
    console.log(`${processed} análise(s) processada(s).`)
    return report(null)
  }
  if (mode === "reset") {
    console.log((await removeSyntheticDataset(db, ORG, DATASET_KEY)) ? "Dataset e tudo que nasceu dele removidos." : "Nada a remover.")
    return
  }
  throw new Error("Use: load | analyze [TMA|NOTA_URA|FCR] [--level REASON|SUB_REASON] [--model simulated|real] | process | report | reset")
}

async function report(analysisId: string | null) {
  const rows = (await db.query<{ id: string; status: string; outcome: string | null; report: { summary?: string; candidates?: { name: string; decision: string; contexts: { label: string; assessment: { outcome: string } }[]; obligation: { status: string } | null }[]; usage?: { calls: number; costUsd: number; costUnknownCalls?: number } } | null; error_message: string | null; indicator: string }>(
    `select a.id, a.status, a.outcome, a.report, a.error_message, i.code indicator from best_practice_analyses a join indicator_definitions i on i.id = a.indicator_definition_id
      where a.organization_id = $1 and a.data_origin = 'SYNTHETIC' and ($2::uuid is null or a.id = $2)
        and ($3::text is null or exists (select 1 from best_practice_synthetic_datasets d where d.id = a.synthetic_dataset_id and d.dataset_key = $3))
      order by a.created_at desc limit 5`,
    [ORG, analysisId, flag("--key")],
  )).rows
  for (const row of rows) {
    console.log(`\n${row.indicator} · ${row.id} · ${row.status}${row.outcome ? ` · ${row.outcome}` : ""}${row.error_message ? ` · ${row.error_message}` : ""}`)
    if (row.report?.summary) console.log(`  ${row.report.summary}`)
    for (const candidate of row.report?.candidates ?? []) console.log(`  - ${candidate.decision.padEnd(20)} ${candidate.name} · ${candidate.contexts.map((context) => `${context.label}: ${context.assessment.outcome}`).join(" | ")}${candidate.obligation ? ` · obrigação: ${candidate.obligation.status}` : ""}`)
    if (row.report?.usage) console.log(`  modelo: ${row.report.usage.calls} chamada(s), US$ ${row.report.usage.costUsd}${row.report.usage.costUnknownCalls ? ` (+${row.report.usage.costUnknownCalls} sem preço na resposta: custo real no uso de IA)` : ""}`)
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => pool.end())
