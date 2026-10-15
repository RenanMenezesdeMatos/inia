import { fileURLToPath } from "node:url"
import { ZodError } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { resolveEffectiveStructuredOutput, type StructuredOutputDefinition } from "../../assistant/domain/structured-output-definition.js"
import { emptyStrategyConfig } from "../../indicator-diagnosis/domain/diagnostic-strategy.js"
import type { OperationalAggregationKind } from "../../indicators/domain/operational-aggregation.js"
import { normalizeManualTrigger, validateScheduleTrigger, validateWorkflowForPublish, type PublishValidationRow } from "../application/validate-workflow-for-publish.js"
import type { ConsolidatedStructure } from "../domain/consolidated-structure-schema.js"
import type { PopulationFilter } from "../domain/population-filter-schema.js"
import { triggerConfigSchema, type TriggerConfig } from "../domain/trigger-config-schema.js"
import { inMemoryHierarchyReader } from "./in-memory-hierarchy-reader.js"

/**
 * Paridade entre a validação de publicação do BACKEND (`validateWorkflowForPublish` — a do botão Publicar e do dry-run
 * `POST /:id/validate` — mais `validateScheduleTrigger`, que o router aplica ao salvar o gatilho) e a validação LOCAL do
 * editor (`frontend/src/schemas/admin/workflow-validation.ts › validateWorkflowGraph`), sobre o MESMO Workflow.
 *
 * O backend para no primeiro problema; o editor lista todos. Por isso a comparação é por REGRA (código do backend), não por
 * texto: cada problema do editor declara o código da regra do backend que espelha. As regras que dependem de banco (agente
 * existe, destinatário resolve pela estrutura, estratégia publicada…) passam aqui por um banco falso PERMISSIVO — o que não
 * se configura num caso, existe e está ativo — e só falham quando o caso pede (`db`).
 */

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "0a7a0000-0000-4000-8000-000000000001"

/** Estrutura Consolidada padrão dos casos: a equipe da Supervisora — cada cargo de gestão resolve para exatamente uma
 * pessoa (cadeia completa). O Grupo `PARITY_TEAM_ID` tem dois Supervisores (destinatário "Supervisor" ambíguo). */
export const PARITY_SUPERVISOR_ID = "0a7a0000-0000-4000-8000-0000000000a5"
export const PARITY_TEAM_ID = "0a7a0000-0000-4000-8000-0000000000a6"
const PARITY_STRUCTURE: ConsolidatedStructure = { kind: "SUPERVISOR_TEAM", supervisorId: PARITY_SUPERVISOR_ID }
const PARITY_HIERARCHY = inMemoryHierarchyReader([
  { id: "director", name: "Diretora", role: "DIRECTOR", reportsToId: null },
  { id: "senior", name: "Gerente Sênior", role: "SENIOR_MANAGER", reportsToId: "director" },
  { id: "manager", name: "Gerente", role: "MANAGER", reportsToId: "senior" },
  { id: "coordinator", name: "Coordenadora", role: "COORDINATOR", reportsToId: "manager" },
  { id: PARITY_SUPERVISOR_ID, name: "Supervisora", role: "SUPERVISOR", reportsToId: "coordinator" },
  { id: "supervisor-2", name: "Supervisor 2", role: "SUPERVISOR", reportsToId: "coordinator" },
  { id: "operator-1", name: "Operador 1", role: "OPERATOR", reportsToId: PARITY_SUPERVISOR_ID, teamId: PARITY_TEAM_ID },
  { id: "operator-2", name: "Operador 2", role: "OPERATOR", reportsToId: "supervisor-2", teamId: PARITY_TEAM_ID },
])

type Row = Record<string, unknown>

/** O que o banco falso responde. Ausente = permissivo (existe, ativo, compatível). */
export type ParityDbFacts = {
  /** `null` = o agente não existe. */
  agent: (agentId: string) => Row | null
  /** `null` = o Orquestrador não existe. */
  orchestrator: (orchestratorId: string) => Row | null
  /** Linha de `indicator_definitions` (direção, ativo, fechamento oficial, semântica operacional); `null` = não existe. */
  indicator: (code: string) => Row | null
  /** Estratégia de diagnóstico publicada e ativa; `null` = nenhuma. */
  strategyConfig: Row | null
  /** Domínio de negócio do roteamento declarado; `null` = inexistente. */
  businessDomain: (domainId: string) => Row | null
  /** Pessoa fixa (destinatário/revisor "específico") ativa na organização; `null` = inexistente, inativa ou de outra organização. */
  person: (personId: string) => Row | null
  /** Política de acompanhamento do nó "Avaliar política"; `null` = não existe nesta organização. */
  interventionPolicy: (policyId: string) => Row | null
}

export type ParityVariable = { id: string; type: "BOOLEAN" | "NUMERIC" | "TEXT"; name: string }
export type ParityOrchestrator = { id: string; structuredOutput: StructuredOutputDefinition }

export type ParitySetup = {
  /** Gatilho como o backend o persiste (trigger-config-schema.ts). */
  trigger: TriggerConfig
  /** Tipo do valor da flag do gatilho por Flag: o backend lê de `channel_flags`; o editor recebe no detalhe do Workflow. */
  flagValueType?: "BOOLEAN" | "NUMERIC" | undefined
  consolidated: boolean
  /** Estrutura Consolidada quando `consolidated` (padrão: a equipe da Supervisora). */
  structure?: ConsolidatedStructure
  graph: unknown
  variables?: ParityVariable[]
  orchestrators?: ParityOrchestrator[]
  /** `indicator_definitions.operational_aggregation` por código (padrão: "WEIGHTED_AVERAGE"). */
  operationalAggregation?: Record<string, OperationalAggregationKind>
  db?: Partial<ParityDbFacts>
  /** Filtro Populacional do rascunho — só o backend o recebe (o editor valida o grafo; as rotas do rascunho recusam a combinação). */
  populationFilter?: PopulationFilter
  /** Abrangência do Workflow (padrão: todos os Grupos). */
  scope?: { scopeType: "ALL_TEAMS" | "TEAM" | "SUBTEAM"; teamId: string | null; subteamId: string | null }
}

/** O que o backend diz: o primeiro problema (código, nó quando a regra informa) ou `null` = publicável. */
export type BackendVerdict = { code: string; nodeId: string | null; message: string }
/** Um problema do editor. */
export type EditorIssue = { nodeId: string; code: string; message: string }

/** Esquema do rascunho: o router recusa salvar (`PUT /:id/draft`) um grafo que não passa no `flowGraphSchema` — 400 com este código. */
export const SCHEMA_ERROR_CODE = "VALIDATION_ERROR"

function defaultAgent(agentId: string): Row {
  // Kind PERFORMANCE + aceita resultado consolidado: vale antes e depois de "Consolidar resultados".
  return { id: agentId, name: "Agente", active: true, agent_type: "CALL_FEEDBACK", specialty: null, specialty_kind: "PERFORMANCE", domain: null, consolidated_input: true }
}

function fakeDb(setup: ParitySetup): Database {
  const facts = setup.db ?? {}
  const structuredById = new Map((setup.orchestrators ?? []).map((orchestrator) => [orchestrator.id, orchestrator.structuredOutput]))
  const agent = facts.agent ?? defaultAgent
  const orchestrator =
    facts.orchestrator ??
    ((orchestratorId: string): Row => ({
      id: orchestratorId,
      output_schema: null,
      structured_output: structuredById.get(orchestratorId) ?? null,
      output_instructions: null,
      scopeType: "ALL_TEAMS",
      teamId: null,
      subteamId: null,
      name: "Orquestrador",
      active: true,
      invocation_mode: "WORKFLOW",
    }))
  const indicator =
    facts.indicator ??
    ((code: string): Row => ({
      id: "0a7a0000-0000-4000-8000-0000000000d1",
      code,
      name: code,
      active: true,
      daily_supported: true,
      official_closure_supported: true,
      desired_direction: "HIGHER",
      operational_aggregation: setup.operationalAggregation?.[code] ?? "WEIGHTED_AVERAGE",
    }))
  const strategyConfig = facts.strategyConfig === undefined ? (emptyStrategyConfig() as unknown as Row) : facts.strategyConfig
  const businessDomain = facts.businessDomain ?? ((domainId: string): Row => ({ id: domainId, name: "Domínio", active: true, specialists: 1 }))
  const person = facts.person ?? ((personId: string): Row => ({ id: personId }))
  const interventionPolicy = facts.interventionPolicy ?? ((policyId: string): Row => ({ id: policyId, name: "Política", active: true, scope_type: "ORGANIZATION", team_id: null, subteam_id: null, subteam_team_id: null, published: 1 }))

  const present = (row: Row | null): Row[] => (row ? [row] : [])
  async function query(sql: string, params: unknown[] = []): Promise<{ rows: Row[]; rowCount: number }> {
    const rows = ((): Row[] => {
      if (sql.includes("from agents where id = any")) return (params[0] as string[]).flatMap((id) => present(agent(id)))
      if (sql.includes("business_domain_id from agents")) return [{ business_domain_id: null }]
      if (sql.includes("from assistant_orchestrators where id = any")) return (params[0] as string[]).flatMap((id) => present(orchestrator(id)))
      if (sql.includes("from indicator_diagnostic_strategy_versions")) return strategyConfig ? [{ id: "0a7a0000-0000-4000-8000-0000000000e1", version: 1, config: strategyConfig }] : []
      if (sql.includes("from indicator_definitions") && sql.includes("code = any(")) return (params[1] as string[]).flatMap((code) => present(indicator(code)))
      if (sql.includes("from indicator_definitions")) return present(indicator(String(params[0] ?? "")))
      if (sql.includes("from channel_flags")) return [{ value_type: setup.flagValueType ?? "NUMERIC" }]
      if (sql.includes("from workflow_variables")) return setup.variables ?? []
      if (sql.includes("from business_domains bd where bd.id = any")) return (params[0] as string[]).flatMap((id) => present(businessDomain(id)))
      if (sql.includes("from people where id = any")) return (params[0] as string[]).flatMap((id) => present(person(id)))
      if (sql.includes("from intervention_policies p")) return (params[1] as string[]).flatMap((id) => present(interventionPolicy(id)))
      throw new Error(`Consulta não prevista pelo banco falso da paridade: ${sql.trim().slice(0, 120)}`)
    })()
    return { rows, rowCount: rows.length }
  }
  return { query } as unknown as Database
}

function nodeIdOfSchemaError(error: ZodError, graph: unknown): string | null {
  const nodes = (graph as { nodes?: { id?: string }[] } | null)?.nodes ?? []
  for (const issue of error.issues) {
    if (issue.path[0] === "nodes" && typeof issue.path[1] === "number") return nodes[issue.path[1]]?.id ?? null
  }
  return null
}

export async function backendVerdict(setup: ParitySetup): Promise<BackendVerdict | null> {
  try {
    // O router valida e normaliza o gatilho ao SALVAR (esquema + validateScheduleTrigger); a publicação lê o já salvo.
    const trigger = normalizeManualTrigger(triggerConfigSchema.parse(setup.trigger))
    validateScheduleTrigger(trigger)
    const row: PublishValidationRow = {
      scopeType: setup.scope?.scopeType ?? "ALL_TEAMS",
      teamId: setup.scope?.teamId ?? null,
      subteamId: setup.scope?.subteamId ?? null,
      draftGraph: setup.graph,
      triggerConfig: trigger,
      consolidatedStructure: setup.consolidated ? (setup.structure ?? PARITY_STRUCTURE) : null,
      populationFilter: setup.populationFilter ?? null,
    }
    await validateWorkflowForPublish(fakeDb(setup), ORGANIZATION_ID, WORKFLOW_ID, row, { hierarchy: PARITY_HIERARCHY })
    return null
  } catch (error) {
    if (error instanceof DomainError) {
      const nodeId = (error.details as { nodeId?: string } | undefined)?.nodeId ?? null
      return { code: error.code, nodeId, message: error.message }
    }
    if (error instanceof ZodError) return { code: SCHEMA_ERROR_CODE, nodeId: nodeIdOfSchemaError(error, setup.graph), message: error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") }
    throw error
  }
}

// ---------------------------------------------------------------------------------------------
// Editor (frontend) — carregado do código-fonte do frontend, pelo caminho, sem cópia.
// ---------------------------------------------------------------------------------------------

type EditorValidator = (graph: unknown, trigger: unknown, orchestratorsById: Map<string, unknown>, variablesById: Map<string, unknown>, isConsolidatedMode: boolean) => EditorIssue[]
type EditorGraphParser = { parse: (graph: unknown) => unknown }

const EDITOR_VALIDATION_URL = new URL("../../../../../frontend/src/schemas/admin/workflow-validation.ts", import.meta.url)
const EDITOR_GRAPH_SCHEMA_URL = new URL("../../../../../frontend/src/schemas/admin/workflow-graph.schema.ts", import.meta.url)
export const EDITOR_VALIDATION_PATH = fileURLToPath(EDITOR_VALIDATION_URL)

let editorModules: Promise<{ validateWorkflowGraph: EditorValidator; flowGraphSchema: EditorGraphParser }> | null = null
function loadEditor() {
  editorModules ??= Promise.all([import(EDITOR_VALIDATION_URL.href), import(EDITOR_GRAPH_SCHEMA_URL.href)]).then(([validation, graphSchema]) => ({
    validateWorkflowGraph: validation.validateWorkflowGraph as EditorValidator,
    flowGraphSchema: graphSchema.flowGraphSchema as EditorGraphParser,
  }))
  return editorModules
}

/** O detalhe do Workflow no editor enriquece o gatilho com nome/canal/tipo do valor — o validador só lê o que muda regra. */
function editorTrigger(setup: ParitySetup): unknown {
  const trigger = setup.trigger
  if (trigger.kind === "channel_flag") return { kind: "channel_flag", channelFlagId: trigger.channelFlagId, channel: "VOICE", flagName: "flag", valueType: setup.flagValueType ?? "NUMERIC" }
  if (trigger.kind === "indicator") return { kind: "indicator", indicatorCode: trigger.indicatorCode, indicatorName: trigger.indicatorCode, unit: "", valueType: "NUMERIC" }
  if (trigger.kind === "schedule") return { ...trigger, intervalDays: trigger.intervalDays ?? 1 }
  return { ...trigger }
}

export async function editorIssues(setup: ParitySetup): Promise<EditorIssue[]> {
  const editor = await loadEditor()
  // O editor já parte do grafo parseado pelo schema do frontend (é o que o detalhe do Workflow devolve).
  const graph = editor.flowGraphSchema.parse(setup.graph)
  const orchestratorsById = new Map(
    (setup.orchestrators ?? []).map((orchestrator) => {
      const fields = resolveEffectiveStructuredOutput({ structured_output: orchestrator.structuredOutput, output_schema: null, output_instructions: null }).fields
      return [orchestrator.id, { id: orchestrator.id, structuredOutputFields: fields ?? [], outputSchema: null }]
    }),
  )
  const variablesById = new Map((setup.variables ?? []).map((variable) => [variable.id, { type: variable.type, name: variable.name }]))
  return editor.validateWorkflowGraph(graph, editorTrigger(setup), orchestratorsById, variablesById, setup.consolidated)
}
