import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import request from "supertest"
import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DELETED_ITEMS } from "../domain/deleted-items.js"
import { explorerLimitsFrom } from "../domain/explorer-limits.js"
import { createDataExplorerRouter } from "../presentation/data-explorer-router.js"

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..")
const TABLES = "indicator_measurements|goals|employee_indicator_performance|employee_prv_performance"
const WORKFLOW_HISTORY_READERS = ["modules/assistant/application/conversation-monitoring.ts", "modules/interaction-feedback/application/qa-decision-audit.ts", "modules/workflows/application/usage-analytics-reader.ts", "modules/workflows/application/manual-run.ts", "modules/feedbacks/infrastructure/feedback-origins.ts", "modules/feedback-engine/application/legacy-holds.ts", "modules/interventions/application/intervention-service.ts", "modules/data-explorer/domain/explorer-datasets-generated.ts"]

function productionFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) return entry === "testing" || entry === "demo-mass" ? [] : productionFiles(path)
    return path.endsWith(".ts") && !path.endsWith(".test.ts") && !path.endsWith("seed-demo-from-scratch.ts") ? [path] : []
  })
}

const sources = productionFiles(SOURCE_ROOT).map((path) => ({ path: relative(SOURCE_ROOT, path), text: readFileSync(path, "utf8") }))

describe("guardas do código sobre registros cancelados", () => {
  it("a carga grava na tabela real: pela visão, o registro cancelado continuaria escondido", () => {
    const writers = sources.filter((source) => new RegExp(`insert into (${TABLES})[\\s(]`).test(source.text)).map((source) => source.path)
    expect(writers).toEqual([])
  })

  it("nenhum `update` nem `delete` de produção passa pela visão: não enxergariam o cancelado", () => {
    const pattern = new RegExp(`(update|delete from) (${TABLES})\\s`)
    expect(sources.filter((source) => pattern.test(source.text)).map((source) => source.path)).toEqual([])
  })

  it("leitura de histórico pelo id da medição usa a tabela real: a execução passada continua mostrando de quem era", () => {
    const pattern = /join indicator_measurements\s+\w+\s+on\s+\w+\.id\s*=\s*\w+\.indicator_measurement_id/
    expect(sources.filter((source) => pattern.test(source.text)).map((source) => source.path)).toEqual([])
  })

  // enrollment-visibility.ts lê de quem era a execução passada pelo id da medição (histórico), mesmo com a medição cancelada.
  it("só a Central, a consulta, a ingestão e as telas de histórico citam as tabelas reais", () => {
    const allowed = /^(modules\/workflows\/application\/enrollment-visibility\.ts$|modules\/data-explorer\/|modules\/data-hub\/application\/writers\/|modules\/ingestion\/presentation\/|modules\/indicators\/application\/indicator-dependencies\.ts$|modules\/(ai-management\/application\/ai-usage-ranking-service|assistant\/application\/conversation-monitoring|feedbacks\/infrastructure\/feedback-origins|indicator-diagnosis\/application\/diagnostic-strategy-service|interaction-feedback\/infrastructure\/postgres-feedback-review-reader|pending-actions\/application\/pending-actions-repository|workflows\/application\/(engine|manual-run|usage-analytics-reader|workflow-results-reader|workflow-retry))\.ts$)/
    const pattern = new RegExp(`\\b(${TABLES})_all\\b`)
    expect(sources.filter((source) => pattern.test(source.text) && !allowed.test(source.path)).map((source) => source.path)).toEqual([])
  })
})

/** Tabelas em que o nome sem sufixo é uma visão que esconde os excluídos (migrations 175 e 177). */
const LOGICAL_VIEWS = ["workflows", "workflow_variables", "agents", "assistant_orchestrators", "argument_scripts", "business_domains", "channel_flags", "prohibited_topics", "glossary_terms", "indicator_definitions", "inia_scenes", "organization_holidays", "product_catalog_nodes", "product_identification_criteria", "ai_connections", "ai_models", "ai_budgets"]
/** Já tinham exclusão lógica por coluna, sem visão. */
const ALREADY_LOGICAL = ["knowledge_documents", "data_sources", "data_feeds", "reports", "indicator_calculation_rules"]

describe("guardas do código sobre exclusão lógica", () => {
  it("nada em produção apaga de verdade um objeto com exclusão lógica", () => {
    const pattern = new RegExp(`delete from (${[...LOGICAL_VIEWS, ...ALREADY_LOGICAL].join("|")})(_all)?[\\s\`]`)
    expect(sources.filter((source) => pattern.test(source.text)).map((source) => source.path)).toEqual([])
  })

  it("todo objeto com exclusão lógica aparece nos itens excluídos", () => {
    const covered = DELETED_ITEMS.map((item) => item.table)
    expect([...LOGICAL_VIEWS.map((view) => `${view}_all`), ...ALREADY_LOGICAL].filter((table) => !covered.includes(table))).toEqual([])
  })

  it("upsert vai na tabela real, com a condição do índice parcial", () => {
    const pattern = new RegExp(`insert into (${LOGICAL_VIEWS.join("|")})\\s[^\`]*on conflict`)
    expect(sources.filter((source) => pattern.test(source.text)).map((source) => source.path)).toEqual([])
  })

  it("histórico lê a tabela real: item excluído continua com o nome no que já aconteceu", () => {
    const history: Record<string, RegExp> = {
      "modules/agents/application/agent-context-records.ts": /join agents\s/,
      "modules/assistant/presentation/conversation-monitoring-router.ts": /join (agents|assistant_orchestrators)\s/,
      "modules/governance/presentation/governance-router.ts": /join agents\s/,
      "modules/assistant/application/orchestrator-versions.ts": /join agents\s/,
      "modules/workflows/application/workflow-results-reader.ts": /from (agents|assistant_orchestrators)\s|join indicator_definitions\s/,
      "modules/workflows/presentation/workflow-router/enrollment-routes.ts": /join agents\s/,
      "modules/feedbacks/infrastructure/feedback-origins.ts": /from channel_flags\s|join indicator_definitions\s/,
      "modules/best-practices/application/pattern-service.ts": /join (indicator_definitions|channel_flags)\s/,
      "modules/feedback-engine/application/leadership-diagnostics.ts": /join argument_scripts\s/,
      "modules/feedback-engine/infrastructure/postgres-feedback-memory-store.ts": /join argument_scripts\s/,
      "modules/data-explorer/domain/explorer-datasets-imported.ts": /join (indicator_definitions|channel_flags)\s/,
      "modules/data-explorer/domain/explorer-datasets-generated.ts": /join agents\s/,
    }
    const offenders = Object.entries(history).filter(([path, pattern]) => {
      const source = sources.find((candidate) => candidate.path === path)
      if (!source) throw new Error(`arquivo não encontrado: ${path}`)
      return pattern.test(source.text)
    })
    expect(offenders.map(([path]) => path)).toEqual([])
  })

  it("visão não tem chave primária: agrupar só pelo id falha ao executar", () => {
    const offenders = sources.flatMap((source) =>
      LOGICAL_VIEWS.flatMap((view) => [...source.text.matchAll(new RegExp(`(?:from|join)\\s+${view}\\s+(\\w+)`, "g"))].filter((match) => new RegExp(`group by ${match[1]}\\.id\\s*[\\n\`)]`).test(source.text)).map(() => `${source.path}: ${view}`)),
    )
    expect(offenders).toEqual([])
  })
})

describe("guardas do código sobre Workflow excluído", () => {
  it("só a exclusão, a consulta, a entrega de recado e as leituras de histórico citam a tabela real", () => {
    const allowed = new Set([...WORKFLOW_HISTORY_READERS, "modules/workflows/application/logical-workflow-deletion.ts", "modules/data-explorer/application/record-cancellation-service.ts", "modules/conversational-delivery/application/avatar-delivery-service.ts", "modules/data-explorer/domain/deleted-items.ts"])
    expect(sources.filter((source) => /\bworkflows_all\b/.test(source.text) && !allowed.has(source.path)).map((source) => source.path)).toEqual([])
  })

  it("leitura pelo id da execução usa a tabela real: o passado continua mostrando o nome do Workflow", () => {
    // Estas leem o que ainda vale: execução que vai rodar, tentativa, aviso e pendência. Depois da exclusão, nada disso existe para o Workflow.
    const liveOnly = new Set(["modules/workflows/application/workflow-node-references.ts", "modules/workflows/application/engine.ts", "modules/workflows/application/workflow-retry.ts", "modules/notifications/application/notifications-repository.ts", "modules/pending-actions/application/pending-actions-repository.ts", "modules/agents/application/agent-deletion.ts"])
    const pattern = /join workflows\s+\w+\s+on\s+\w+\.id\s*=\s*\w+\.workflow_id/
    expect(sources.filter((source) => pattern.test(source.text) && !liveOnly.has(source.path)).map((source) => source.path)).toEqual([])
  })

  it("nada em produção apaga Workflow de verdade", () => {
    expect(sources.filter((source) => /delete from workflows/.test(source.text)).map((source) => source.path)).toEqual([])
  })
})

describe("a permissão de cancelar é separada da de consultar", () => {
  const limits = explorerLimitsFrom({ DATA_EXPLORER_DEFAULT_PAGE_SIZE: 25, DATA_EXPLORER_MAX_PAGE_SIZE: 100, DATA_EXPLORER_QUERY_TIMEOUT_MS: 5_000, DATA_EXPLORER_CANCEL_MAX_ROWS: 10_000, DATA_EXPLORER_COUNT_CAP: 10_000, DATA_EXPLORER_EXPORT_MAX_ROWS: 20_000, DATA_EXPLORER_EXPORT_MAX_BYTES: 20_971_520, DATA_EXPLORER_EXPORT_MAX_DURATION_MS: 60_000 })
  /** Qualquer acesso ao banco aqui seria falha: quem só consulta não pode chegar ao serviço. O único comando aceito é o registro da negação. */
  const queries: string[] = []
  const database = { query: async (sql: string) => (queries.push(sql), { rows: [], rowCount: 0 }), connect: async () => { throw new Error("não deveria abrir conexão") } } as unknown as Database

  function appWithRole(roleCode: string) {
    const app = express()
    app.use(express.json())
    app.use((incoming, _response, next) => {
      const organizationId = "00000000-0000-4000-8000-000000000001"
      Object.assign(incoming, {
        user: { sub: "00000000-0000-4000-8000-000000000002", organizationId, personId: "00000000-0000-4000-8000-000000000003" },
        access: { organizationId, accountId: "00000000-0000-4000-8000-000000000002", personId: "00000000-0000-4000-8000-000000000003", assignments: [{ roleCode, scope: { type: "ORGANIZATION" } }] },
      })
      next()
    })
    app.use(createDataExplorerRouter(database, limits))
    return app
  }

  it.each([
    ["get", "/cancellations?dataset=goals"],
    ["post", "/cancellations/preview"],
    ["post", "/cancellations"],
    ["get", "/cancellations/00000000-0000-4000-8000-000000000009/reactivation"],
    ["post", "/cancellations/00000000-0000-4000-8000-000000000009/reactivation"],
  ] as const)("%s %s: 403 para quem não tem `data_hub.cancel_records`", async (method, path) => {
    queries.length = 0
    const response = await request(appWithRole("QA_DE_FEEDBACK"))[method](path).send({})
    expect(response.status).toBe(403)
    expect(queries.every((sql) => sql.includes("DATA_HUB_EXPLORER_DENIED"))).toBe(true)
  })
})
