import { describe, expect, it } from "vitest"
import { SYSTEM_ROLES } from "../../access/domain/roles.js"
import { describeExplorerDataset, EXPLORER_DATASETS, findExplorerColumn, findExplorerDataset } from "./explorer-catalog.js"
import { EXPLORER_COLUMN_TYPES, OPERATORS_BY_TYPE, ORGANIZATION_COLUMN } from "./explorer-catalog-types.js"
import { maskedEmploymentStatusSql, PROTECTED_LEAVE, RECORD_STATUS_COLUMN } from "./explorer-datasets-imported.js"

/** Tabelas que a consulta pode ler, com o motivo: uma tabela nova na lista passa por aqui de propósito, nunca por descoberta. */
const APPROVED_TABLES = new Set([
  "people", "teams", "subteams", "operations", "interactions", "transcripts", "interaction_flags", "channel_flags_all", "indicator_definitions_all", "indicator_measurements_all",
  "employee_indicator_performance_all", "employee_prv_performance_all", "goals_all", "data_record_cancellations", "employee_work_shifts", "employee_schedule_days", "employee_schedule_exceptions", "employee_status_periods",
  "supervision_cases", "feedbacks", "workflow_enrollments", "workflows_all", "agent_runs", "agents_all", "ai_usage_events", "data_ingestion_runs", "data_ingestion_rejections", "data_sources", "data_feeds",
])

/** Colunas que nunca podem aparecer em nenhuma expressão, ainda que a tabela seja aprovada. */
const FORBIDDEN_COLUMNS = [
  "password_hash", "email", "session_version", "temporary_password", "ciphertext", "auth_tag", "token_hash", "token_prefix", "secret", "connector_config", "config",
  // Dado pessoal ou conteúdo livre:
  "avatar_url", "bio", "strengths", "development_focus", "pending_custody", "raw_status", "legacy_status", "raw_reason", "source_reference", "content", "summary", "root_cause",
  "evidence_found", "observed_behavior", "related_procedure", "recommendation", "suggested_approach", "improvement_points", "best_practices", "context_snapshot",
  "input_context", "output_text", "error_message", "tool_trace", "tested_config", "node_outputs", "variables", "blocked_details", "blocked_reason", "retry_requested_by_name", "retry_confirmation",
  "requester_person_id", "stages", "checkpoint", "checkpoint_before", "checkpoint_after", "idempotency_key", "idempotency_body_sha256", "mapping",
  // Texto escrito pela IA ou que repete dado da fonte, inclusive o tipo de afastamento:
  "title", "impacted_indicator", "message", "source_record_key",
]

const expressionsOf = (dataset: (typeof EXPLORER_DATASETS)[number]) => [dataset.from, dataset.key.sql, ...dataset.columns.map((column) => column.sql)]

describe("lista permitida da consulta de dados", () => {
  it("só lê tabelas aprovadas", () => {
    for (const dataset of EXPLORER_DATASETS) {
      const tables = [...dataset.from.matchAll(/(?:^|\bjoin\s+)([a-z_]+)\s+[a-z]+/g)].map((match) => match[1])
      expect(tables.length, dataset.code).toBeGreaterThan(0)
      for (const table of tables) expect(APPROVED_TABLES.has(table!), `${dataset.code}: ${table}`).toBe(true)
    }
  })

  it("nenhuma expressão cita coluna proibida", () => {
    for (const dataset of EXPLORER_DATASETS) {
      for (const expression of expressionsOf(dataset)) {
        for (const forbidden of FORBIDDEN_COLUMNS) {
          // `char_length(t.content)` mostra só o tamanho da transcrição, nunca o texto.
          if (forbidden === "content" && expression === "char_length(t.content)") continue
          expect(new RegExp(`\\.${forbidden}\\b`).test(expression), `${dataset.code}: ${expression}`).toBe(false)
        }
      }
    }
  })

  it("nenhuma coluna é JSON livre nem `*`", () => {
    for (const dataset of EXPLORER_DATASETS) {
      for (const expression of expressionsOf(dataset)) expect(/\*|->>?|json/i.test(expression), `${dataset.code}: ${expression}`).toBe(false)
    }
  })

  it("toda junção confere a organização, e a tabela principal é `t`", () => {
    for (const dataset of EXPLORER_DATASETS) {
      expect(/^[a-z_]+ t\b/.test(dataset.from), dataset.code).toBe(true)
      const joins = dataset.from.split(/\bleft join\b/).slice(1)
      for (const join of joins) expect(/\.organization_id = t\.organization_id/.test(join), `${dataset.code}: ${join}`).toBe(true)
    }
    expect(ORGANIZATION_COLUMN).toBe("t.organization_id")
  })

  it("códigos e chaves são únicos e têm o formato aceito no pedido", () => {
    expect(new Set(EXPLORER_DATASETS.map((dataset) => dataset.code)).size).toBe(EXPLORER_DATASETS.length)
    for (const dataset of EXPLORER_DATASETS) {
      expect(dataset.code).toMatch(/^[a-z][a-z0-9_]{0,62}$/)
      expect(new Set(dataset.columns.map((column) => column.key)).size, dataset.code).toBe(dataset.columns.length)
      for (const column of dataset.columns) {
        expect(column.key).toMatch(/^[a-z][a-z0-9_]{0,62}$/)
        expect(EXPLORER_COLUMN_TYPES).toContain(column.type)
        if (column.type === "ENUM") expect(column.options?.length, `${dataset.code}.${column.key}`).toBeGreaterThan(0)
      }
    }
  })

  it("a ordenação padrão existe e é ordenável", () => {
    for (const dataset of EXPLORER_DATASETS) {
      const column = findExplorerColumn(dataset, dataset.defaultSort.column)
      expect(column?.sortable, dataset.code).toBe(true)
    }
  })

  it("conjunto grande: só ordena por coluna obrigatória da tabela principal e só busca por igualdade", () => {
    for (const dataset of EXPLORER_DATASETS.filter((candidate) => candidate.volume === "LARGE")) {
      for (const column of dataset.columns) {
        if (column.sortable) {
          expect(column.nullable, `${dataset.code}.${column.key}`).toBe(false)
          expect(column.sql, `${dataset.code}.${column.key}`).toMatch(/^t\.[a-z_]+$/)
        }
        if (column.search) expect(column.search, `${dataset.code}.${column.key}`).toBe("EXACT")
      }
    }
  })

  it("máscaras: afastamento sensível e atestado não aparecem como opção de filtro", () => {
    const values = (dataset: string, column: string) => findExplorerColumn(findExplorerDataset(dataset)!, column)!.options!.map((option) => option.value)
    for (const [dataset, column] of [["collaborators", "employment_status"], ["status_periods", "status"]] as const) {
      expect(values(dataset, column)).toContain(PROTECTED_LEAVE)
      for (const sensitive of ["INSS", "MATERNIDADE", "PATERNIDADE"]) expect(values(dataset, column)).not.toContain(sensitive)
    }
    expect(values("schedule_exceptions", "code")).not.toContain("ATESTADO")
    const sql = maskedEmploymentStatusSql("t.status")
    for (const sensitive of ["INSS", "MATERNIDADE", "PATERNIDADE"]) expect(sql).toContain(`'${sensitive}'`)
  })

  it("a descrição para a tela não leva SQL, tabela nem coluna do banco", () => {
    for (const dataset of EXPLORER_DATASETS) {
      const described = JSON.stringify(describeExplorerDataset(dataset))
      expect(described).not.toContain(dataset.from)
      expect(described, dataset.code).not.toMatch(/"sql"|"from"|\bt\.[a-z_]+|\bleft join\b/)
    }
  })

  it("operadores: vazio/preenchido só em coluna que aceita vazio; coluna sem filtro não oferece nenhum", () => {
    for (const dataset of EXPLORER_DATASETS) {
      const described = describeExplorerDataset(dataset)
      for (const column of described.columns) {
        const source = findExplorerColumn(dataset, column.key)!
        if (!source.filterable) expect(column.operators).toEqual([])
        if (!source.nullable) expect(column.operators).not.toContain("IS_EMPTY")
        for (const operator of column.operators) expect(OPERATORS_BY_TYPE[source.type]).toContain(operator)
      }
    }
  })
})

describe("conjuntos com cancelamento de registros", () => {
  const cancellable = EXPLORER_DATASETS.filter((dataset) => dataset.cancellation)

  it("só os quatro aprovados: histórico, pessoas e situação funcional nunca são canceláveis", () => {
    expect(cancellable.map((dataset) => dataset.code).sort()).toEqual(["goals", "indicator_measurements", "official_closures", "prv_closures"])
  })

  it("a tabela é a real, a mesma que o conjunto lê, e a situação do registro está na seleção inicial", () => {
    for (const dataset of cancellable) {
      expect(dataset.cancellation!.table, dataset.code).toMatch(/^[a-z_]+_all$/)
      expect(dataset.from.startsWith(`${dataset.cancellation!.table} t `), dataset.code).toBe(true)
      expect(findExplorerColumn(dataset, RECORD_STATUS_COLUMN)?.hiddenByDefault, dataset.code).toBeUndefined()
      expect(findExplorerColumn(dataset, "cancel_reason")?.personal, dataset.code).toBe(true)
    }
  })

  it("a descrição para a tela não leva a tabela real nem o contrato", () => {
    for (const dataset of cancellable) {
      const described = JSON.stringify(describeExplorerDataset(dataset))
      expect(described).not.toContain(dataset.cancellation!.table)
      expect(described).not.toContain(dataset.cancellation!.contractKey)
    }
  })
})

describe("papéis com a consulta de dados", () => {
  it("exatamente Administrador geral e Administrador de dados, só com escopo de organização", () => {
    for (const permission of ["data_hub.explore", "data_hub.cancel_records"] as const) {
      const roles = SYSTEM_ROLES.filter((role) => role.permissions.includes(permission))
      expect(roles.map((role) => role.code).sort(), permission).toEqual(["ADMINISTRADOR_DE_DADOS", "ADMINISTRADOR_GERAL"])
      for (const role of roles) expect(role.allowedScopes, permission).toEqual(["ORGANIZATION"])
    }
  })

  it("área com permissão própria não se abre pela consulta: o Administrador de dados não vê IA nem caso e feedback por pessoa", () => {
    const role = SYSTEM_ROLES.find((candidate) => candidate.code === "ADMINISTRADOR_DE_DADOS")!
    expect(role.permissions).toEqual(["data_hub.manage", "data_hub.explore", "data_hub.cancel_records"])
    expect(findExplorerDataset("ai_usage")?.requiresPermission).toBe("ai.view")
    expect(findExplorerDataset("supervision_cases")?.requiresPermission).toBe("indicators.view")
    expect(findExplorerDataset("feedbacks")?.requiresPermission).toBe("indicators.view")
    const general = SYSTEM_ROLES.find((candidate) => candidate.code === "ADMINISTRADOR_GERAL")!
    for (const dataset of EXPLORER_DATASETS) if (dataset.requiresPermission) expect(general.permissions).toContain(dataset.requiresPermission)
  })
})
