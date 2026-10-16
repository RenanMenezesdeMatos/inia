import { z } from "zod"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { comparatorMatches, evaluateDataCondition, isDataCondition, type ConditionBranch, type EvaluationOptions } from "../../workflows/application/condition-evaluator.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { resolveStructureAnchorOperatorIds } from "../../workflows/application/hierarchy-subjects.js"
import { consolidatedStructureAnchorId, consolidatedStructureSchema, type ConsolidatedStructure } from "../../workflows/domain/consolidated-structure-schema.js"
import { structureAnchorGroupRef } from "../../workflows/domain/structure-anchor-schema.js"
import { comparatorSchema, flowGraphSchema, type FlowNode } from "../../workflows/domain/graph-schema.js"
import { loadWorkflowForSimulation, resolveSimulationGraph, withSimulationConfiguration } from "./build-simulated-enrollment.js"
import { resolveEligibleOperatorIds } from "./interaction-evidence.js"


/**
 * Seletor inteligente de massa de teste (Parte 18/21/44) — consultas determinísticas, zero IA.
 * Objetivo: o admin achar rápido UMA chamada/medição/colaborador que leve a Condition pro
 * ramo TRUE, FALSE ou SEM DADOS, sem mexer em dado nenhum (Parte 19).
 */

export const findInteractionsSchema = z.object({
  channelFlagId: z.string().uuid(),
  comparator: comparatorSchema.optional(),
  thresholdNumeric: z.coerce.number().optional(),
  thresholdBoolean: z
    .union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")])
    .optional(),
  // Nega o filtro comparator/threshold: "mostrar quem NÃO atende".
  negate: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
  operatorId: z.string().uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  /** Identificador externo/protocolo (interactions.external_id) — único id de negócio persistido. */
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).optional(),
})
export type FindInteractionsInput = z.infer<typeof findInteractionsSchema>

export async function findInteractions(db: Database, organizationId: string, input: FindInteractionsInput) {
  const params: unknown[] = [organizationId, input.channelFlagId]
  const where: string[] = ["i.organization_id = $1", "f.channel_flag_id = $2"]
  if (input.operatorId) {
    params.push(input.operatorId)
    where.push(`i.operator_id = $${params.length}`)
  }
  if (input.from) {
    params.push(input.from)
    where.push(`i.started_at >= $${params.length}`)
  }
  if (input.to) {
    params.push(input.to)
    where.push(`i.started_at < $${params.length}`)
  }
  if (input.search) {
    params.push(`%${input.search}%`)
    where.push(`i.external_id ilike $${params.length}`)
  }
  params.push(input.limit)
  const limitIndex = params.length
  params.push(input.offset ?? 0)
  const result = await db.query<{
    id: string
    external_id: string
    reason: string
    sub_reason: string | null
    channel: string
    started_at: string
    ended_at: string
    operator_id: string
    operator_name: string
    team_name: string | null
    flag_name: string
    value_boolean: boolean | null
    value_numeric: string | null
    has_transcript: boolean
  }>(
    `select i.id, i.external_id, i.reason, i.sub_reason, i.channel, i.started_at, i.ended_at, i.operator_id, p.name operator_name, t.name team_name,
            cf.flag_name, f.value_boolean, f.value_numeric,
            exists(select 1 from transcripts tr where tr.interaction_id = i.id) has_transcript
     from interaction_flags f
     join interactions i on i.id = f.interaction_id
     join channel_flags cf on cf.id = f.channel_flag_id
     join people p on p.id = i.operator_id
     left join teams t on t.id = p.team_id
     where ${where.join(" and ")}
     order by i.started_at desc
     limit $${limitIndex} offset $${params.length}`,
    params,
  )
  const rows = result.rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    reason: row.reason,
    subReason: row.sub_reason,
    channel: row.channel,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationSeconds: Math.max(0, Math.round((new Date(row.ended_at).getTime() - new Date(row.started_at).getTime()) / 1000)),
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    teamName: row.team_name,
    flagName: row.flag_name,
    value: row.value_boolean ?? (row.value_numeric !== null ? Number(row.value_numeric) : null),
    hasTranscript: row.has_transcript,
    matches: null as boolean | null,
  }))
  if (!input.comparator) return rows
  // Filtro por comparador aplicado em memória (mesmo `comparatorMatches` do motor) — a lista
  // já vem limitada por flag/período; nunca reimplementa a regra em SQL.
  return rows
    .map((row) => {
      const isBoolean = typeof row.value === "boolean"
      const matches = row.value === null ? false : comparatorMatches(input.comparator!, isBoolean, row.value, input.thresholdBoolean ?? null, input.thresholdNumeric ?? null)
      return { ...row, matches }
    })
    .filter((row) => (input.negate ? !row.matches : row.matches))
}

export const findMeasurementsSchema = z.object({
  indicatorCode: z.string().trim().min(1),
  comparator: comparatorSchema.optional(),
  thresholdNumeric: z.coerce.number().optional(),
  negate: z.union([z.boolean(), z.enum(["true", "false"]).transform((value) => value === "true")]).optional(),
  operatorId: z.string().uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type FindMeasurementsInput = z.infer<typeof findMeasurementsSchema>

export async function findMeasurements(db: Database, organizationId: string, input: FindMeasurementsInput) {
  const params: unknown[] = [organizationId, input.indicatorCode]
  const where: string[] = ["m.organization_id = $1", "i.code = $2", "m.subject_type = 'PERSON'"]
  if (input.operatorId) {
    params.push(input.operatorId)
    where.push(`m.subject_id = $${params.length}`)
  }
  if (input.from) {
    params.push(input.from)
    where.push(`m.period_end >= $${params.length}`)
  }
  if (input.to) {
    params.push(input.to)
    where.push(`m.period_end < $${params.length}`)
  }
  params.push(input.limit)
  const result = await db.query<{
    id: string
    subject_id: string
    operator_name: string
    team_name: string | null
    value: string
    period_start: string
    period_end: string
    unit: string
    target: string | null
  }>(
    `select m.id, m.subject_id, p.name operator_name, t.name team_name, m.value, m.period_start, m.period_end, i.unit,
            (select g.target_value from goals g where g.indicator_definition_id = i.id and g.subject_type = 'TEAM' and g.subject_id = p.team_id
               and g.valid_from <= m.period_end::date and (g.valid_until is null or g.valid_until >= m.period_end::date)
             order by g.valid_from desc limit 1) target
     from indicator_measurements m
     join indicator_definitions i on i.id = m.indicator_definition_id
     join people p on p.id = m.subject_id
     left join teams t on t.id = p.team_id
     where ${where.join(" and ")}
     order by m.period_end desc
     limit $${params.length}`,
    params,
  )
  const rows = result.rows.map((row) => ({
    id: row.id,
    operatorId: row.subject_id,
    operatorName: row.operator_name,
    teamName: row.team_name,
    value: Number(row.value),
    unit: row.unit,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    targetValue: row.target !== null ? Number(row.target) : null,
    matches: null as boolean | null,
  }))
  if (!input.comparator) return rows
  return rows
    .map((row) => ({ ...row, matches: comparatorMatches(input.comparator!, false, row.value, null, input.thresholdNumeric ?? null) }))
    .filter((row) => (input.negate ? !row.matches : row.matches))
}

export const previewConditionSchema = z.object({
  workflowId: z.string().uuid(),
  nodeId: z.string().min(1),
  graphSource: z.enum(["PUBLISHED", "DRAFT"]).optional(),
  simulatedNow: z.iso.datetime().optional(),
  // Modo Consolidado: qual estrutura avaliar (ausente = a configurada no workflow). Ignorado em
  // modo Individual.
  consolidatedStructure: consolidatedStructureSchema.optional(),
})
export type PreviewConditionInput = z.infer<typeof previewConditionSchema>

export type ConditionPreviewRow = {
  /** EMPLOYEE (modo Individual — um colaborador) ou STRUCTURE (modo Consolidado — a estrutura
   * inteira como UMA unidade). Preparado pra coleções futuras sem hardcode de "operador". */
  subjectKind: "EMPLOYEE" | "STRUCTURE"
  subjectId: string
  label: string
  teamName: string | null
  /** Quantas pessoas compõem o sujeito (1 em EMPLOYEE). */
  memberCount: number
  branch: ConditionBranch
  /** Resumo curto do cálculo ("82 < meta 85", "2 de 3 fechamentos disponíveis") — Parte 16. */
  summary: string
  reason: string | null
  reasonText: string | null
  /** O MESMO payload de debug que a execução grava em `condition_evaluated` — por construção,
   * porque vem do mesmo evaluator. */
  evaluation: Record<string, unknown>
  /** Sujeito pronto pra virar a entrada de uma execução do QA Lab. */
  subject: { kind: "operator"; operatorId: string } | { kind: "unit"; consolidatedStructure: ConsolidatedStructure }
}

const COMPARATOR_TEXT: Record<string, string> = { EQUALS: "=", NOT_EQUALS: "≠", GT: ">", LT: "<", GTE: "≥", LTE: "≤" }

function fmt(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "number") return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)
  return String(value)
}

/**
 * Resumo de uma linha ("82 < meta 85 → verdadeiro") a partir do payload de debug — texto
 * derivado, nunca uma segunda avaliação: o `branch` já veio decidido pelo evaluator.
 */
export function summarizeEvaluation(evaluation: Record<string, unknown>, branch: ConditionBranch): string {
  if (branch === "no_data") return typeof evaluation.reasonText === "string" ? evaluation.reasonText : "Sem dados."
  const verdict = branch === "true" ? "verdadeiro" : "falso"
  const op = COMPARATOR_TEXT[String(evaluation.comparator)] ?? String(evaluation.comparator ?? "?")
  switch (evaluation.kind) {
    case "historical_count":
      return `${fmt(evaluation.count)} ocorrência(s) ${op} ${fmt(evaluation.threshold)} → ${verdict}`
    case "historical_aggregate": {
      if (evaluation.changeMode === "PERCENT") {
        const change = typeof evaluation.percentChange === "number" ? `${evaluation.percentChange >= 0 ? "+" : ""}${fmt(evaluation.percentChange)}%` : "—"
        return `${fmt(evaluation.previousValue)} → ${fmt(evaluation.value)} (${change}) ${op} ${fmt(evaluation.reference)}% → ${verdict}`
      }
      const referenceLabel = evaluation.referenceKind === "GOAL" ? "meta " : evaluation.referenceKind === "PREVIOUS_PERIOD" ? "anterior " : ""
      return `${fmt(evaluation.value)} ${op} ${referenceLabel}${fmt(evaluation.reference)} → ${verdict}`
    }
    case "performance_recurrence":
      return `${String(evaluation.matchQuartile)} em ${fmt(evaluation.matchCount)} de ${fmt(evaluation.totalPeriods)} fechamentos ${op} ${fmt(evaluation.threshold)} → ${verdict}`
    case "performance":
      return `${fmt(evaluation.value)} ${op} ${fmt(evaluation.threshold)} → ${verdict}`
    case "operational_quartile":
      return `Quartil operacional ${String(evaluation.value)} (posição ${fmt(evaluation.position)} de ${fmt(evaluation.rankedCount)}, ${evaluation.windowLabel ?? "?"}) ${op} ${String(evaluation.threshold)} → ${verdict}`
    default:
      return verdict
  }
}

/**
 * "7 colaboradores possuem PRV abaixo de 80%" — classifica cada sujeito candidato no ramo que a
 * Condition escolhida tomaria pra ele (ATENDE / NÃO ATENDE / SEM DADOS) chamando o MESMO
 * `evaluateDataCondition` que `processNode` usa em produção e na execução do QA Lab
 * (condition-evaluator.ts). Nada é reimplementado aqui: só quem são os candidatos —
 * modo Individual: cada colaborador do Filtro Populacional/Abrangência (exatamente a população
 * que o checador de agenda matricularia); modo Consolidado: a estrutura inteira como UMA linha.
 * 100% determinístico, só leitura, zero IA, nunca cria qa_run.
 */
export async function previewConditionForOperators(db: Database, organizationId: string, input: PreviewConditionInput): Promise<{ node: FlowNode; rows: ConditionPreviewRow[] }> {
  const loaded = await loadWorkflowForSimulation(db, organizationId, input.workflowId)
  if (!loaded) throw new DomainError("Workflow não encontrado.", "WORKFLOW_NOT_FOUND", 404)
  const { graph, source } = resolveSimulationGraph(loaded, input.graphSource)
  const workflow = withSimulationConfiguration(loaded, source)
  const node = flowGraphSchema.parse(graph).nodes.find((candidate) => candidate.id === input.nodeId)
  if (!node || node.type !== "condition") throw new DomainError("Selecione um node de Condição.", "QA_NODE_NOT_CONDITION", 422)
  // Mesmo contexto organizacional (timezone IANA) que a execução real usa — a prévia nunca
  // resolve janela em fuso diferente do motor.
  const evaluationOptions: EvaluationOptions = { timeZone: await resolveOrganizationTimezone(db, organizationId), quartileCache: new Map() }
  if (!isDataCondition(node.config)) {
    throw new DomainError(
      "A prévia por colaborador só se aplica a Conditions de performance ou histórico do indicador — para Conditions sobre o valor do gatilho, use os filtros de chamadas/medições.",
      "QA_CONDITION_NOT_PREVIEWABLE",
      422,
    )
  }
  const now = input.simulatedNow ? new Date(input.simulatedNow) : new Date()
  const configuredStructure = workflow.consolidated_structure ? consolidatedStructureSchema.parse(workflow.consolidated_structure) : null
  if (configuredStructure) {
    const structure = input.consolidatedStructure ?? configuredStructure
    if (structure.kind !== configuredStructure.kind) {
      throw new DomainError(`A estrutura selecionada (${structure.kind}) não é do mesmo tipo configurado no workflow (${configuredStructure.kind}).`, "QA_UNIT_KIND_MISMATCH", 422)
    }
    const anchorId = consolidatedStructureAnchorId(structure)
    const memberIds = await resolveStructureAnchorOperatorIds(db, structure, anchorId)
    if (memberIds.length === 0) throw new DomainError("A estrutura selecionada não tem nenhum operador — nada a analisar.", "QA_UNIT_EMPTY", 422)
    // Mesmo "sujeito técnico" que schedule-check.ts usa como scheduled_subject_id (âncora ou
    // membro determinístico) — o evaluator agrega sobre TODOS os membros de qualquer forma.
    const operatorId = anchorId ?? [...memberIds].sort()[0]!
    // Quartil operacional é individual (posição de UM colaborador na população da estrutura):
    // a prévia lista cada membro, com a MESMA população (os membros) e uma resolução em lote.
    if (node.config.historicalQuery?.source === "OPERATIONAL_QUARTILE") {
      return { node, rows: await previewOperatorRows(db, node, memberIds, memberIds, now, evaluationOptions) }
    }
    const result = await evaluateDataCondition(db, node.config, { operatorId, subjectIds: memberIds }, now, evaluationOptions)
    if (!result) throw new DomainError("Condição sem consulta de dados avaliável.", "QA_CONDITION_NOT_PREVIEWABLE", 422)
    const label = await describeStructureLabel(db, structure)
    return {
      node,
      rows: [
        {
          subjectKind: "STRUCTURE",
          subjectId: anchorId ?? consolidatedStructureGroupId(structure),
          label,
          teamName: null,
          memberCount: memberIds.length,
          branch: result.branch,
          summary: summarizeEvaluation(result.evaluation, result.branch),
          reason: typeof result.evaluation.reason === "string" ? result.evaluation.reason : null,
          reasonText: typeof result.evaluation.reasonText === "string" ? result.evaluation.reasonText : null,
          evaluation: result.evaluation,
          subject: { kind: "unit", consolidatedStructure: structure },
        },
      ],
    }
  }

  const operatorIds = await resolveEligibleOperatorIds(db, organizationId, workflow)
  if (operatorIds.length === 0) return { node, rows: [] }
  // População do quartil operacional no modo Individual = Abrangência ∩ Filtro populacional (os
  // mesmos elegíveis listados) — igual ao motor (node-handlers.ts/resolveConditionPopulation).
  return { node, rows: await previewOperatorRows(db, node, operatorIds, operatorIds, now, evaluationOptions) }
}

async function previewOperatorRows(db: Database, node: FlowNode & { type: "condition" }, operatorIds: string[], populationIds: string[], now: Date, evaluationOptions: EvaluationOptions): Promise<ConditionPreviewRow[]> {
  const people = await db.query<{ id: string; name: string; team_name: string | null }>(
    `select p.id, p.name, t.name team_name from people p left join teams t on t.id = p.team_id where p.id = any($1::uuid[]) order by p.name`,
    [operatorIds],
  )
  const rows: ConditionPreviewRow[] = []
  for (const person of people.rows) {
    const result = await evaluateDataCondition(db, node.config, { operatorId: person.id, subjectIds: [person.id], populationIds }, now, evaluationOptions)
    if (!result) continue
    rows.push({
      subjectKind: "EMPLOYEE",
      subjectId: person.id,
      label: person.name,
      teamName: person.team_name,
      memberCount: 1,
      branch: result.branch,
      summary: summarizeEvaluation(result.evaluation, result.branch),
      reason: typeof result.evaluation.reason === "string" ? result.evaluation.reason : null,
      reasonText: typeof result.evaluation.reasonText === "string" ? result.evaluation.reasonText : null,
      evaluation: result.evaluation,
      subject: { kind: "operator", operatorId: person.id },
    })
  }
  return rows
}

async function describeStructureLabel(db: Database, structure: ConsolidatedStructure): Promise<string> {
  const anchorId = consolidatedStructureAnchorId(structure)
  if (anchorId) {
    const person = await db.query<{ name: string }>(`select name from people where id = $1`, [anchorId])
    return `${STRUCTURE_LABELS[structure.kind]} — ${person.rows[0]?.name ?? "?"}`
  }
  const groupId = consolidatedStructureGroupId(structure)
  const table = structure.kind === "SUBTEAM" ? "subteams" : "teams"
  const group = await db.query<{ name: string }>(`select name from ${table} where id = $1`, [groupId])
  return `${STRUCTURE_LABELS[structure.kind]} — ${group.rows[0]?.name ?? "?"}`
}

function consolidatedStructureGroupId(structure: ConsolidatedStructure): string {
  const ref = structureAnchorGroupRef(structure)
  return ref?.subteamId ?? ref?.teamId ?? ""
}

const STRUCTURE_LABELS: Record<ConsolidatedStructure["kind"], string> = {
  SUPERVISOR_TEAM: "Equipe de Supervisor",
  SUBTEAM: "Subgrupo",
  TEAM: "Grupo",
  COORDINATOR_STRUCTURE: "Estrutura de Coordenador",
  MANAGER_STRUCTURE: "Estrutura de Gerente",
  SENIOR_MANAGER_STRUCTURE: "Estrutura de Gerente Sênior",
  DIRECTOR_STRUCTURE: "Estrutura de Diretor",
}

export const listOperatorsSchema = z.object({
  /** Presente = só colaboradores elegíveis pra este Workflow (Abrangência + Filtro Populacional) —
   * o seletor de colaborador nunca oferece alguém fora da população do Workflow (Parte 24/25). */
  workflowId: z.string().uuid().optional(),
  scopeType: z.enum(["ALL_TEAMS", "TEAM", "SUBTEAM"]).optional(),
  teamId: z.string().uuid().optional(),
  subteamId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  role: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
export type ListOperatorsInput = z.infer<typeof listOperatorsSchema>

/** Pessoas (operadores por padrão, ou outro cargo — ex.: supervisores pra Unidade de Análise)
 * dentro de um escopo — usado pelos seletores de colaborador/unidade do QA Lab. */
export async function listPeople(db: Database, organizationId: string, input: ListOperatorsInput) {
  const params: unknown[] = [organizationId, input.role ?? "OPERATOR"]
  const where = ["p.organization_id = $1", "p.role = $2", "p.active"]
  if (input.workflowId) {
    const workflow = await loadWorkflowForSimulation(db, organizationId, input.workflowId)
    if (!workflow) throw new DomainError("Workflow não encontrado.", "WORKFLOW_NOT_FOUND", 404)
    params.push(await resolveEligibleOperatorIds(db, organizationId, workflow))
    where.push(`p.id = any($${params.length}::uuid[])`)
  }
  if (input.scopeType === "TEAM" && input.teamId) {
    params.push(input.teamId)
    where.push(`p.team_id = $${params.length}`)
  }
  if (input.scopeType === "SUBTEAM" && input.subteamId) {
    params.push(input.subteamId)
    where.push(`p.subteam_id = $${params.length}`)
  }
  if (input.search) {
    params.push(`%${input.search}%`)
    where.push(`p.name ilike $${params.length}`)
  }
  params.push(input.limit)
  const result = await db.query<{ id: string; name: string; role: string; team_id: string | null; team_name: string | null; subteam_id: string | null; subteam_name: string | null; has_shift: boolean }>(
    `select p.id, p.name, p.role, p.team_id, t.name team_name, p.subteam_id, st.name subteam_name,
            exists(select 1 from employee_work_shifts s where s.person_id = p.id and s.effective_from <= current_date and (s.effective_to is null or s.effective_to >= current_date)) has_shift
     from people p left join teams t on t.id = p.team_id left join subteams st on st.id = p.subteam_id
     where ${where.join(" and ")} order by p.name limit $${params.length}`,
    params,
  )
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    teamId: row.team_id,
    teamName: row.team_name,
    subteamId: row.subteam_id,
    subteamName: row.subteam_name,
    hasShift: row.has_shift,
  }))
}
