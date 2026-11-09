import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import { inTransaction } from "../../../shared/infrastructure/database/transaction.js"
import { canManageScope, type ManageableScopes, type ScopedTarget } from "../../auth/application/manageable-scopes.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { graphCatalogProblems, type GraphCatalogProblem } from "../../workflows/domain/indicator-graph-compatibility.js"
import {
  allowedAggregationLabels,
  correctionBlockers,
  correctionNotices,
  emptyMeasurementScan,
  indicatorCorrectionFieldsSchema,
  indicatorCorrectionRequestSchema,
  scanMeasurement,
  type CorrectableValues,
  type CorrectionBlocker,
  type CorrectionWorkflow,
  type CorrectionWorkflows,
  type MeasurementIssue,
  type MeasurementScan,
} from "../domain/indicator-correction.js"
import {
  AGGREGATION_STRATEGY_METADATA,
  DESIRED_DIRECTION_LABELS,
  INDICATOR_UNIT_METADATA,
  componentsProblem,
  describeAggregationStrategy,
  normalizeIndicatorCode,
  validateIndicatorDefinition,
  type IndicatorDefinitionRecord,
} from "../domain/indicator-definition.js"
import { zeroContributionSupported } from "../domain/operational-aggregation.js"
import { findIndicatorDefinition } from "./indicator-definition-service.js"
import { loadIndicatorDependencies } from "./indicator-dependencies.js"

/**
 * Prévia e aplicação da correção controlada (regra em `domain/indicator-correction.ts`). `computeIndicatorCorrectionImpact` é a
 * ÚNICA função que mede o impacto: a prévia a chama fora de transação e o salvamento a chama de novo dentro da transação, com o
 * indicador travado. O que foi visto na tela nunca é confiado: se surgiu uma medição ou um Workflow ativo no meio, o salvamento recusa.
 *
 * Não existe recálculo a disparar: os componentes do read model não dependem da estratégia, e o UPDATE em `indicator_definitions`
 * já sobe a versão da camada oficial e marca a organização para o `analytics-rollup` (triggers das migrations 128 e 136).
 */
type Queryable = Pick<Database, "query">

const SCAN_BATCH_SIZE = 5_000

type WorkflowRow = ScopedTarget & { id: string; name: string; active: boolean; draftGraph: unknown; publishedGraph: unknown; inFlightEnrollments: number }
type ScopedWorkflow = CorrectionWorkflow & ScopedTarget

export type IndicatorCorrectionImpact = {
  indicator: { id: string; code: string; name: string }
  current: CorrectableValues
  next: CorrectableValues
  changes: { field: "unit" | "desiredDirection" | "operationalAggregation"; label: string; from: string; to: string }[]
  calculation: { before: { label: string; description: string }; after: { label: string; description: string } }
  history: { measurements: number; goals: number; officialClosures: number; workflows: number }
  measurements: {
    requiredComponents: string[]
    missingComponents: number
    incoherentValues: number
    outOfUnitRange: number
    unusedComponents: number
    examples: { issue: MeasurementIssue; employeeLabel: string; date: string; value: number; numerator: number | null; denominator: number | null; expected: number | null }[]
  }
  allowedAggregations: string[]
  workflows: { activePublished: ScopedWorkflow[]; pausedPublished: ScopedWorkflow[]; drafts: ScopedWorkflow[] }
  zeroContributionReset: boolean
  blockers: CorrectionBlocker[]
  notices: string[]
  canApply: boolean
}

export type IndicatorCorrectionViewerImpact = Omit<IndicatorCorrectionImpact, "workflows"> & { workflows: CorrectionWorkflows }

function currentValues(definition: IndicatorDefinitionRecord): CorrectableValues {
  return { unit: definition.unit, desiredDirection: definition.desiredDirection, operationalAggregation: definition.operationalAggregation }
}

async function scanMeasurements(db: Queryable, organizationId: string, indicatorId: string, next: CorrectableValues): Promise<MeasurementScan> {
  const scan = emptyMeasurementScan()
  let lastId: string | null = null
  for (;;) {
    // Em lotes pelo id: o indicador pode ter centenas de milhares de medições, e a regra precisa ser a mesma da carga (em TypeScript, não reescrita em SQL).
    const result: { rows: { id: string; subject_id: string; period_start: Date; value: string; numerator: string | null; denominator: string | null }[] } = await db.query(
      `select id, subject_id, period_start, value, numerator, denominator from indicator_measurements
        where organization_id = $1 and indicator_definition_id = $2 and ($3::uuid is null or id > $3::uuid)
        order by id limit $4`,
      [organizationId, indicatorId, lastId, SCAN_BATCH_SIZE],
    )
    for (const row of result.rows) {
      scanMeasurement(scan, { subjectId: row.subject_id, periodStart: row.period_start.toISOString(), value: Number(row.value), numerator: row.numerator === null ? null : Number(row.numerator), denominator: row.denominator === null ? null : Number(row.denominator) }, next)
    }
    if (result.rows.length < SCAN_BATCH_SIZE) return scan
    lastId = result.rows[result.rows.length - 1]!.id
  }
}

/** Fechamento oficial nunca é recalculado: aqui só se conta, para avisar o que um novo envio com componentes vai encontrar. */
async function scanClosures(db: Queryable, organizationId: string, indicatorId: string, next: CorrectableValues): Promise<{ incoherent: number; unused: number }> {
  const counts = { incoherent: 0, unused: 0 }
  let lastId: string | null = null
  for (;;) {
    const result: { rows: { id: string; value: string; numerator: string; denominator: string }[] } = await db.query(
      `select id, value, numerator, denominator from employee_indicator_performance
        where organization_id = $1 and indicator_definition_id = $2 and numerator is not null and denominator is not null and ($3::uuid is null or id > $3::uuid)
        order by id limit $4`,
      [organizationId, indicatorId, lastId, SCAN_BATCH_SIZE],
    )
    for (const row of result.rows) {
      const problem = componentsProblem(next.operationalAggregation, Number(row.value), Number(row.numerator), Number(row.denominator))
      if (problem?.kind === "INCOHERENT") counts.incoherent += 1
      if (problem?.kind === "NOT_DEFINED_BY_COMPONENTS") counts.unused += 1
    }
    if (result.rows.length < SCAN_BATCH_SIZE) return counts
    lastId = result.rows[result.rows.length - 1]!.id
  }
}

async function loadWorkflowsCiting(db: Queryable, organizationId: string, code: string): Promise<WorkflowRow[]> {
  const result = await db.query<WorkflowRow>(
    `select w.id, w.name, w.active, w.scope_type "scopeType", w.team_id "teamId", w.subteam_id "subteamId", w.draft_graph "draftGraph", v.graph "publishedGraph",
            (select count(*) from workflow_enrollments e where e.workflow_id = w.id and e.status in ('active', 'waiting'))::int "inFlightEnrollments"
       from workflows w
       left join workflow_versions v on v.id = w.active_version_id
      where w.organization_id = $1 and (
        jsonb_path_exists(w.draft_graph, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', $2::text))
        or (v.graph is not null and jsonb_path_exists(v.graph, '$.** ? (@.indicatorCode == $code)', jsonb_build_object('code', $2::text)))
      )
      order by w.name, w.id`,
    [organizationId, code],
  )
  return result.rows
}

function classifyWorkflows(rows: readonly WorkflowRow[], code: string, next: CorrectableValues): IndicatorCorrectionImpact["workflows"] {
  const catalog = (candidate: string) => (candidate === code ? { kind: next.operationalAggregation, direction: next.desiredDirection } : undefined)
  const toEntry = (row: WorkflowRow, problems: GraphCatalogProblem[]): ScopedWorkflow => ({
    id: row.id,
    name: row.name,
    scopeType: row.scopeType,
    teamId: row.teamId,
    subteamId: row.subteamId,
    inFlightEnrollments: row.inFlightEnrollments,
    uses: problems.map(({ nodeLabel, problem, aggregationLabel, message }) => ({ nodeLabel, problem, aggregationLabel, message })),
  })
  const workflows: IndicatorCorrectionImpact["workflows"] = { activePublished: [], pausedPublished: [], drafts: [] }
  for (const row of rows) {
    const published = row.publishedGraph ? graphCatalogProblems(row.publishedGraph, catalog) : []
    if (published.length > 0) {
      // Quem já está na lista do publicado não repete como rascunho: ajustar o nó e publicar resolve os dois.
      ;(row.active ? workflows.activePublished : workflows.pausedPublished).push(toEntry(row, published))
      continue
    }
    const draft = graphCatalogProblems(row.draftGraph, catalog)
    if (draft.length > 0) workflows.drafts.push(toEntry(row, draft))
  }
  return workflows
}

async function employeeLabels(db: Queryable, organizationId: string, personIds: readonly string[]): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map()
  const people = await db.query<{ id: string; name: string; matricula: string | null }>(`select id, name, matricula from people where organization_id = $1 and id = any($2::uuid[])`, [organizationId, personIds])
  return new Map(people.rows.map((person) => [person.id, person.matricula ? `${person.name} (${person.matricula})` : person.name]))
}

/** Mede o impacto de trocar unidade, direção ou estratégia. Só lê: prévia e salvamento passam por aqui. */
export async function computeIndicatorCorrectionImpact(db: Queryable, organizationId: string, definition: IndicatorDefinitionRecord, rawFields: unknown): Promise<IndicatorCorrectionImpact> {
  const fields = indicatorCorrectionFieldsSchema.parse(rawFields)
  const current = currentValues(definition)
  const next: CorrectableValues = { unit: fields.unit ?? current.unit, desiredDirection: fields.desiredDirection ?? current.desiredDirection, operationalAggregation: fields.operationalAggregation ?? current.operationalAggregation }

  const zeroContributionReset = definition.unjustifiedAbsencePolicy === "ZERO_CONTRIBUTION" && !zeroContributionSupported(next.operationalAggregation, next.unit)
  let configurationError: string | null = null
  try {
    validateIndicatorDefinition({ ...definition, ...next, unjustifiedAbsencePolicy: zeroContributionReset ? "NO_SAMPLE" : definition.unjustifiedAbsencePolicy })
  } catch (error) {
    if (!(error instanceof DomainError)) throw error
    configurationError = error.message
  }

  // Em sequência: na aplicação tudo roda no mesmo cliente de transação.
  const scan = await scanMeasurements(db, organizationId, definition.id, next)
  const closures = await scanClosures(db, organizationId, definition.id, next)
  const dependencies = await loadIndicatorDependencies(db, organizationId, definition)
  const workflows = classifyWorkflows(await loadWorkflowsCiting(db, organizationId, definition.code), definition.code, next)
  const facts = {
    current,
    next,
    configurationError,
    scan,
    goals: dependencies.goals,
    closuresWithIncoherentComponents: closures.incoherent,
    closuresWithUnusedComponents: closures.unused,
    zeroContributionReset,
    workflows: { ...workflows, outOfScope: { activePublished: 0, pausedPublished: 0, drafts: 0 } },
  }
  const blockers = correctionBlockers(facts)

  const timeZone = scan.examples.length > 0 ? await resolveOrganizationTimezone(db, organizationId) : null
  const labels = await employeeLabels(db, organizationId, [...new Set(scan.examples.map((example) => example.subjectId))])
  const strategyLabel = (kind: CorrectableValues["operationalAggregation"]) => AGGREGATION_STRATEGY_METADATA[kind].label
  const changes: IndicatorCorrectionImpact["changes"] = []
  if (current.unit !== next.unit) changes.push({ field: "unit", label: "Unidade", from: INDICATOR_UNIT_METADATA[current.unit].label, to: INDICATOR_UNIT_METADATA[next.unit].label })
  if (current.desiredDirection !== next.desiredDirection) changes.push({ field: "desiredDirection", label: "Direção desejada", from: DESIRED_DIRECTION_LABELS[current.desiredDirection], to: DESIRED_DIRECTION_LABELS[next.desiredDirection] })
  if (current.operationalAggregation !== next.operationalAggregation) changes.push({ field: "operationalAggregation", label: "Estratégia de consolidação", from: strategyLabel(current.operationalAggregation), to: strategyLabel(next.operationalAggregation) })

  return {
    indicator: { id: definition.id, code: definition.code, name: definition.name },
    current,
    next,
    changes,
    calculation: { before: describeAggregationStrategy(current.operationalAggregation, current.unit), after: describeAggregationStrategy(next.operationalAggregation, next.unit) },
    history: { measurements: scan.total, goals: dependencies.goals, officialClosures: dependencies.officialClosures, workflows: dependencies.workflows.length },
    measurements: {
      requiredComponents: AGGREGATION_STRATEGY_METADATA[next.operationalAggregation].requiredComponents,
      missingComponents: scan.missingComponents,
      incoherentValues: scan.incoherentValues,
      outOfUnitRange: scan.outOfUnitRange,
      unusedComponents: scan.unusedComponents,
      examples: scan.examples.map((example) => ({ issue: example.issue, employeeLabel: labels.get(example.subjectId) ?? "Colaborador não encontrado", date: localDateOf(new Date(example.periodStart), timeZone!), value: example.value, numerator: example.numerator, denominator: example.denominator, expected: example.expected })),
    },
    allowedAggregations: allowedAggregationLabels(next.operationalAggregation),
    workflows,
    zeroContributionReset,
    blockers,
    notices: correctionNotices(facts),
    canApply: blockers.length === 0,
  }
}

/** Quem consulta vê pelo nome só os Workflows que abriria na lista dele; os outros entram na contagem (a trava vale para todos). */
export function impactForViewer(impact: IndicatorCorrectionImpact, scopes: ManageableScopes): IndicatorCorrectionViewerImpact {
  const split = (workflows: readonly ScopedWorkflow[]) => {
    const visible = workflows.filter((workflow) => canManageScope(scopes, workflow))
    return { visible: visible.map(({ id, name, inFlightEnrollments, uses }) => ({ id, name, inFlightEnrollments, uses })), hidden: workflows.length - visible.length }
  }
  const active = split(impact.workflows.activePublished)
  const paused = split(impact.workflows.pausedPublished)
  const drafts = split(impact.workflows.drafts)
  return { ...impact, workflows: { activePublished: active.visible, pausedPublished: paused.visible, drafts: drafts.visible, outOfScope: { activePublished: active.hidden, pausedPublished: paused.hidden, drafts: drafts.hidden } } }
}

async function requireDefinition(db: Queryable, organizationId: string, id: string): Promise<IndicatorDefinitionRecord> {
  const definition = await findIndicatorDefinition(db, organizationId, id)
  if (!definition) throw new DomainError("Indicador não encontrado.", "INDICATOR_NOT_FOUND", 404)
  return definition
}

export async function previewIndicatorCorrection(db: Queryable, organizationId: string, id: string, rawFields: unknown): Promise<IndicatorCorrectionImpact> {
  return computeIndicatorCorrectionImpact(db, organizationId, await requireDefinition(db, organizationId, id), rawFields)
}

export type IndicatorCorrectionActor = { personId: string | null; accountId: string }

/** Aplica a correção: mede de novo com o indicador travado, recusa se houver bloqueio, grava e audita na mesma transação. */
export async function applyIndicatorCorrection(db: Database, organizationId: string, id: string, rawInput: unknown, actor: IndicatorCorrectionActor, scopes: ManageableScopes): Promise<{ definition: IndicatorDefinitionRecord; impact: IndicatorCorrectionViewerImpact }> {
  const { reason, confirmation, ...fields } = indicatorCorrectionRequestSchema.parse(rawInput)
  return inTransaction(db, async (client) => {
    // FOR UPDATE conflita com a checagem de FK de quem grava medição: a carga deste indicador espera, e a medição não muda no meio da conta.
    const locked = await client.query(`select id from indicator_definitions where id = $1 and organization_id = $2 for update`, [id, organizationId])
    if (!locked.rows[0]) throw new DomainError("Indicador não encontrado.", "INDICATOR_NOT_FOUND", 404)
    const definition = await requireDefinition(client, organizationId, id)
    if (normalizeIndicatorCode(confirmation) !== definition.code) {
      throw new DomainError(`Para confirmar, digite o código do indicador: ${definition.code}.`, "INDICATOR_CORRECTION_CONFIRMATION_MISMATCH", 422)
    }
    const impact = await computeIndicatorCorrectionImpact(client, organizationId, definition, fields)
    const viewer = impactForViewer(impact, scopes)
    if (!impact.canApply) {
      throw new DomainError(`Não foi possível corrigir "${definition.name}". ${impact.blockers.map((blocker) => blocker.message).join(" ")}`, "INDICATOR_CORRECTION_BLOCKED", 409, { blockers: impact.blockers, impact: viewer })
    }
    const unjustifiedAbsencePolicy = impact.zeroContributionReset ? "NO_SAMPLE" : definition.unjustifiedAbsencePolicy
    await client.query(
      `update indicator_definitions set unit = $1, desired_direction = $2, operational_aggregation = $3, unjustified_absence_policy = $4 where id = $5 and organization_id = $6`,
      [impact.next.unit, impact.next.desiredDirection, impact.next.operationalAggregation, unjustifiedAbsencePolicy, id, organizationId],
    )
    await client.query(`insert into audit_logs (organization_id, actor_id, action, entity_type, entity_id, payload) values ($1, $2, 'INDICATOR_DEFINITION_CORRECTED', 'indicator_definition', $3, $4)`, [
      organizationId,
      actor.personId,
      id,
      JSON.stringify({
        code: definition.code,
        name: definition.name,
        reason,
        actorAccountId: actor.accountId,
        before: { ...impact.current, unjustifiedAbsencePolicy: definition.unjustifiedAbsencePolicy },
        after: { ...impact.next, unjustifiedAbsencePolicy },
        impact: {
          history: impact.history,
          unusedComponents: impact.measurements.unusedComponents,
          notices: impact.notices,
          workflows: {
            pausedPublished: impact.workflows.pausedPublished.map(({ id: workflowId, name }) => ({ id: workflowId, name })),
            drafts: impact.workflows.drafts.map(({ id: workflowId, name }) => ({ id: workflowId, name })),
          },
        },
      }),
    ])
    const updated = await requireDefinition(client, organizationId, id)
    return { definition: updated, impact: viewer }
  })
}
