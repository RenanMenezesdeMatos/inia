import type { Database } from "../../../infrastructure/database/pool.js"
import { findUseCase } from "../../../shared/application/model-routing/ai-use-cases.js"
import type { ManageableScopes } from "../../auth/application/manageable-scopes.js"
import { flowGraphSchema, type FlowGraph } from "../domain/graph-schema.js"
import {
  assemblePersonResult,
  DISPATCH_STATUS_SQL,
  normalizeDecimal,
  outputAlertDedupeKey,
  sumUsage,
  type AlertRow,
  type ArtifactRow,
  type CostByCurrency,
  type DispatchStatus,
  type EmissionRow,
  type EngineMessageRow,
  type EventRow,
  type LegacyFeedbackRow,
  type PersonEnrollmentRow,
  type PersonResult,
  type ResultAiCall,
  type ReviewRow,
  type SurfaceRow,
  type TriggerKind,
  type UsageGroupRow,
  type UsageTotals,
} from "../domain/workflow-results.js"
import { enrollmentSubjectScopeOf } from "./enrollment-visibility.js"

/**
 * V1.5.13 — leitura dos RESULTADOS do Workflow (aba "Resultados"). Três leituras, contagem fixa de consultas (nunca uma
 * por disparo/pessoa):
 *
 *   summary  → 1 consulta (a CTE dos disparos filtrados + agregados)
 *   list     → 1 consulta (a mesma CTE, paginada)
 *   detail   → cabeçalho (a mesma CTE, um disparo) + pessoas paginadas + ~9 cargas em lote para a página de pessoas
 *
 * ESCOPO: o Workflow já foi autorizado pela rota (workflows.manage no escopo dele). Além disso cada PESSOA só aparece — e
 * só entra nos contadores/tokens — se o colaborador estiver no escopo de gestão de quem pergunta (Grupo/Subgrupo). Um
 * disparo individual cuja pessoa está fora do escopo nem é listado. Uso da raiz de um Workflow Consolidado (ex.: síntese
 * pós-JOIN) é do Workflow e entra no disparo.
 */

export type ResultsFilters = {
  from: Date
  to: Date
  statuses?: DispatchStatus[] | undefined
  triggerKinds?: TriggerKind[] | undefined
  collaborator?: string | undefined
}

export type DispatchRow = {
  rootEnrollmentId: string
  createdAt: string
  status: DispatchStatus
  trigger: { kind: TriggerKind; label: string }
  version: { id: string; number: number; active: boolean }
  consolidated: boolean
  persons: number
  feedbacksProduced: number
  feedbacksSent: number
  awaitingQa: number
  blocked: number
  usage: UsageTotals
  durationMs: number | null
}

export type ResultsSummary = {
  period: { from: string; to: string }
  dispatches: number
  persons: number
  feedbacksProduced: number
  feedbacksSent: number
  awaitingQa: number
  blocked: number
  usage: UsageTotals
}

export type DispatchDetail = {
  dispatch: DispatchRow
  persons: { items: PersonResult[]; total: number; page: number; pageSize: number }
  /** Uso da própria raiz de um Workflow Consolidado (síntese/orquestração pós-JOIN) — não pertence a nenhuma pessoa. */
  rootUsage: { usage: UsageTotals; aiCalls: ResultAiCall[] } | null
}

// Mesmo escopo por pessoa das rotas de Execuções (enrollment-visibility.ts).
const scopeOf = (scopes: ManageableScopes) => enrollmentSubjectScopeOf(scopes)

const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

// Mesmas colunas de totais de uso em todo lugar (N/D = nenhuma chamada informou; incompleto = alguma concluída não informou).
const USAGE_COLUMNS = (u: string) => `
  count(${u}.id)::int calls,
  sum(${u}.input_tokens)::bigint input_tokens,
  sum(${u}.output_tokens)::bigint output_tokens,
  sum(${u}.total_tokens)::bigint total_tokens,
  coalesce(bool_or(${u}.status = 'SUCCESS' and ${u}.total_tokens is null), false) incomplete,
  (count(${u}.id) filter (where ${u}.status = 'SUCCESS' and ${u}.cost_status = 'UNKNOWN'))::int cost_unknown_calls`

type UsageSqlRow = { calls: number; input_tokens: string | null; output_tokens: string | null; total_tokens: string | null; incomplete: boolean; cost_unknown_calls: number; costs: CostByCurrency[] | null }
const num = (value: string | number | null | undefined) => (value === null || value === undefined ? null : Number(value))
const usageOf = (row: UsageSqlRow): UsageTotals => ({
  calls: row.calls ?? 0,
  inputTokens: num(row.input_tokens),
  outputTokens: num(row.output_tokens),
  totalTokens: num(row.total_tokens),
  incomplete: Boolean(row.incomplete),
  costs: (row.costs ?? []).filter((cost) => cost.currency && cost.amount !== null).map((cost) => ({ currency: cost.currency.trim(), amount: normalizeDecimal(String(cost.amount)) })),
  costUnknownCalls: row.cost_unknown_calls ?? 0,
})

/**
 * CTE dos disparos (params $1 org, $2 workflow, $3..$5 escopo, depois o recorte: período OU um disparo). Devolve uma linha
 * por disparo visível com todos os agregados; resumo, lista e cabeçalho do detalhe leem a MESMA definição.
 *
 * ESCALA (14/10/2026): com 30 dias de monitoria (~30 mil disparos) a versão anterior levava mais de 1 minuto por consulta.
 *   - `keys` = o barato de cada disparo (status, gatilho, pessoas visíveis), por agregação — nunca subconsulta correlacionada
 *     sobre uma CTE (sem índice, ela relia a CTE inteira para cada disparo: trabalho quadrático);
 *   - `selection` escolhe os disparos (filtro, ordem e página) ANTES dos agregados pesados — uso de IA, feedbacks, artefatos e
 *     emissões só rodam para os escolhidos (a página da lista, ou todos os filtrados no resumo);
 *   - `node_outputs` (o JSON grande de cada execução) não atravessa as CTEs: só o ramo de feedback do Output legado o lê, e
 *     só dos disparos escolhidos.
 */
function dispatchCte(rootClause: string, selection = "select d.* from keys d", collaboratorPattern: string | null = null): string {
  return `
  roots as (
    select r.id, r.version_id, r.status, r.created_at, r.updated_at, r.interaction_id, r.indicator_measurement_id, r.scheduled_subject_id, r.matched_flag_name, r.parent_enrollment_id, r.manual_run_id
      from workflow_enrollments r
     where r.organization_id = $1 and r.workflow_id = $2 and r.parent_enrollment_id is null and ${rootClause}
  ),
  tree as (
    select r.id root_id, r.id, r.version_id, r.status, r.created_at, r.updated_at, r.interaction_id, r.indicator_measurement_id, r.scheduled_subject_id, r.parent_enrollment_id from roots r
    union all
    select c.parent_enrollment_id, c.id, c.version_id, c.status, c.created_at, c.updated_at, c.interaction_id, c.indicator_measurement_id, c.scheduled_subject_id, c.parent_enrollment_id
      from workflow_enrollments c join roots r on c.parent_enrollment_id = r.id
     where c.organization_id = $1
  ),
  wf as (select consolidated_structure is not null consolidated, active_version_id from workflows where id = $2 and organization_id = $1),
  persons as (
    select t.root_id, t.id enrollment_id, t.version_id, p.id person_id, p.name,
           ($3::boolean or p.team_id = any($4::uuid[]) or p.subteam_id = any($5::uuid[])) visible
      from tree t
      cross join wf
      -- Busca pela chave, uma por execução (LATERAL com limit: o planejador não a transforma de volta num join e não troca o
      -- índice por varrer as medições inteiras — 1,6 milhão de linhas no dev — com hash join).
      left join lateral (select i.operator_id from interactions i where i.id = t.interaction_id and i.organization_id = $1 limit 1) i on true
      left join lateral (select m.subject_id from indicator_measurements_all m where m.id = t.indicator_measurement_id and m.subject_type = 'PERSON' limit 1) m on true
      join people p on p.id = coalesce(t.scheduled_subject_id, i.operator_id, m.subject_id) and p.organization_id = $1
     where t.parent_enrollment_id is not null or not wf.consolidated
  ),
  visible_persons as (select * from persons where visible),
  persons_by_root as (select root_id, count(*)::int persons from visible_persons group by root_id),
  -- Filtro "colaborador" como coluna de \`keys\` (hash join), nunca como subconsulta por disparo: com IN/EXISTS o planejador
  -- chegou a reler o conjunto inteiro para cada disparo (28 mil × 15 mil linhas, 28 s).
  collaborator_roots as (${collaboratorPattern ? `select root_id from visible_persons where name ilike ${collaboratorPattern} group by root_id` : "select null::uuid root_id where false"}),
  tree_stats as (
    select root_id, ${DISPATCH_STATUS_SQL("status")} status,
           case when bool_or(status in ('active', 'waiting')) then null else extract(epoch from max(updated_at) - min(created_at)) * 1000 end duration_ms
      from tree group by root_id
  ),
  keys as (
    select r.id root_id, r.created_at, r.version_id, r.manual_run_id, r.interaction_id, r.indicator_measurement_id, r.matched_flag_name,
           ts.status, ts.duration_ms, wf.consolidated, wf.active_version_id, coalesce(pr.persons, 0) persons, (cr.root_id is not null) collaborator_match,
           case when r.manual_run_id is not null then 'MANUAL' when r.interaction_id is not null then 'FLAG' when r.indicator_measurement_id is not null then 'INDICATOR' else 'SCHEDULE' end trigger_kind
      from roots r
      cross join wf
      join tree_stats ts on ts.root_id = r.id
      left join persons_by_root pr on pr.root_id = r.id
      left join collaborator_roots cr on cr.root_id = r.id
     where wf.consolidated or pr.root_id is not null
  ),
  selected as (${selection}),
  selected_persons as (select vp.* from visible_persons vp join selected s on s.root_id = vp.root_id),
  -- Enrollments cujo consumo de IA entra no disparo: pessoas visíveis + a raiz de um Workflow Consolidado.
  usage_enrollments as (
    select root_id, enrollment_id from selected_persons
    union
    select s.root_id, s.root_id from selected s where s.consolidated
  ),
  usage_rows as (
    select ue.root_id, u.* from usage_enrollments ue
      join ai_usage_events u on u.organization_id = $1 and u.root_enrollment_id = ue.root_id and u.enrollment_id = ue.enrollment_id
  ),
  usage_stats as (select root_id, ${USAGE_COLUMNS("usage_rows")} from usage_rows group by root_id),
  usage_costs as (
    select root_id, json_agg(json_build_object('currency', currency, 'amount', amount::text) order by currency) costs
      from (select root_id, currency, sum(cost) amount from usage_rows where cost is not null and currency is not null group by root_id, currency) c
     group by root_id
  ),
  engine_stats as (
    select vp.root_id,
           (count(*) filter (where m.status = 'PUBLISHABLE'))::int produced,
           (count(*) filter (where m.status = 'ABSTAINED'))::int abstained
      from selected_persons vp join feedback_engine_messages m on m.organization_id = $1 and m.enrollment_id = vp.enrollment_id
     group by vp.root_id
  ),
  artifact_stats as (
    select vp.root_id,
           (count(*) filter (where a.status = 'COMPLETED' and a.disposition in ('READY', 'HOLD_FOR_QA', 'REJECTED')))::int produced,
           (count(*) filter (where a.status = 'COMPLETED' and a.disposition = 'HOLD_FOR_QA'))::int awaiting_qa,
           (count(*) filter (where a.status = 'COMPLETED' and a.disposition = 'BLOCKED'))::int blocked
      from selected_persons vp join reliable_feedback_artifacts a on a.organization_id = $1 and a.enrollment_id = vp.enrollment_id
     group by vp.root_id
  ),
  -- Feedback emitido ao colaborador: emissão do feedback confiável (efeito persistido) ou feedbackId do nó Output legado
  -- (a saída do nó é a única ligação ali). Sempre conferido contra o registro real em "feedbacks".
  emitted as (
    select vp.root_id, vp.person_id, e.feedback_id, true reliable
      from selected_persons vp join workflow_output_emissions e on e.enrollment_id = vp.enrollment_id and e.surface = 'FOLLOW_UP' and e.recipient_id = vp.person_id and e.feedback_id is not null
    union all
    select vp.root_id, vp.person_id, case when (we.node_outputs -> (n ->> 'id') ->> 'feedbackId') ~ '${UUID_RE}' then (we.node_outputs -> (n ->> 'id') ->> 'feedbackId')::uuid end, false
      from selected_persons vp
      join workflow_versions v on v.id = vp.version_id
      cross join lateral jsonb_array_elements(v.graph -> 'nodes') n
      join workflow_enrollments we on we.id = vp.enrollment_id
     where n ->> 'type' = 'output' and (we.node_outputs -> (n ->> 'id') ->> 'feedbackId') ~ '${UUID_RE}'
  ),
  feedback_stats as (
    select x.root_id,
           (count(*) filter (where f.status in ('PUBLISHED', 'ACKNOWLEDGED')))::int sent,
           (count(*) filter (where not x.reliable))::int legacy_produced
      from (select root_id, person_id, feedback_id, bool_or(reliable) reliable from emitted group by root_id, person_id, feedback_id) x
      join feedbacks f on f.id = x.feedback_id and f.organization_id = $1 and f.operator_id = x.person_id
     group by x.root_id
  ),
  -- Número da versão = quantas versões do Workflow foram criadas até ela (inclusive).
  version_numbers as (select id, count(*) over (order by created_at)::int version_number from workflow_versions where workflow_id = $2),
  dispatches as (
    select s.root_id, s.created_at, s.status, s.duration_ms, s.consolidated, s.trigger_kind,
           coalesce(case
             -- Disparo manual: quem executou (a origem manual continua visível mesmo com interação/medição associada).
             when s.manual_run_id is not null then mr.requested_by_label
             when s.interaction_id is not null then s.matched_flag_name
             when s.indicator_measurement_id is not null then idef.name
           end, '') trigger_detail,
           s.version_id, coalesce(vn.version_number, 0) version_number, (s.version_id = s.active_version_id) version_active,
           s.persons,
           coalesce(ast.produced, 0) + coalesce(es.produced, 0) + coalesce(fs.legacy_produced, 0) feedbacks_produced,
           coalesce(fs.sent, 0) feedbacks_sent,
           coalesce(ast.awaiting_qa, 0) awaiting_qa,
           coalesce(ast.blocked, 0) blocked,
           coalesce(us.calls, 0) calls, us.input_tokens, us.output_tokens, us.total_tokens, coalesce(us.incomplete, false) incomplete, coalesce(us.cost_unknown_calls, 0) cost_unknown_calls, uc.costs
      from selected s
      left join version_numbers vn on vn.id = s.version_id
      left join lateral (select 'por ' || rb.name requested_by_label from workflow_manual_runs wmr join people rb on rb.id = wmr.requested_by where wmr.id = s.manual_run_id) mr on true
      left join indicator_measurements_all im on im.id = s.indicator_measurement_id
      left join indicator_definitions_all idef on idef.id = im.indicator_definition_id
      left join artifact_stats ast on ast.root_id = s.root_id
      left join engine_stats es on es.root_id = s.root_id
      left join feedback_stats fs on fs.root_id = s.root_id
      left join usage_stats us on us.root_id = s.root_id
      left join usage_costs uc on uc.root_id = s.root_id
  )`
}

type DispatchSqlRow = UsageSqlRow & {
  root_id: string
  created_at: Date
  status: DispatchStatus
  duration_ms: string | null
  consolidated: boolean
  trigger_kind: TriggerKind
  trigger_detail: string
  version_id: string
  version_number: number
  version_active: boolean
  persons: number
  feedbacks_produced: number
  feedbacks_sent: number
  awaiting_qa: number
  blocked: number
}

const TRIGGER_LABEL: Record<TriggerKind, string> = { FLAG: "Flag", INDICATOR: "Indicador", SCHEDULE: "Agenda", MANUAL: "Manual" }

function dispatchOf(row: DispatchSqlRow): DispatchRow {
  return {
    rootEnrollmentId: row.root_id,
    createdAt: new Date(row.created_at).toISOString(),
    status: row.status,
    trigger: { kind: row.trigger_kind, label: row.trigger_detail ? `${TRIGGER_LABEL[row.trigger_kind]}: ${row.trigger_detail}` : TRIGGER_LABEL[row.trigger_kind] },
    version: { id: row.version_id, number: row.version_number, active: row.version_active },
    consolidated: row.consolidated,
    persons: row.persons,
    feedbacksProduced: Number(row.feedbacks_produced),
    feedbacksSent: row.feedbacks_sent,
    awaitingQa: row.awaiting_qa,
    blocked: row.blocked,
    usage: usageOf(row),
    durationMs: row.duration_ms === null ? null : Math.round(Number(row.duration_ms)),
  }
}

class Params {
  readonly values: unknown[]
  constructor(initial: unknown[]) {
    this.values = [...initial]
  }
  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

function baseParams(organizationId: string, workflowId: string, scopes: ManageableScopes): Params {
  const scope = scopeOf(scopes)
  return new Params([organizationId, workflowId, scope.allTeams, scope.teamIds, scope.subteamIds])
}

/** WHERE sobre `keys` (status/tipo do gatilho/colaborador) — tudo no banco, para total e páginas baterem. O padrão do
 * colaborador vai para a CTE (`collaborator_roots`), que marca `collaborator_match` em cada disparo. */
function dispatchWhere(params: Params, filters: ResultsFilters): { where: string; collaboratorPattern: string | null } {
  const clauses: string[] = []
  if (filters.statuses?.length) clauses.push(`d.status = any(${params.add(filters.statuses)}::text[])`)
  if (filters.triggerKinds?.length) clauses.push(`d.trigger_kind = any(${params.add(filters.triggerKinds)}::text[])`)
  let collaboratorPattern: string | null = null
  if (filters.collaborator) {
    collaboratorPattern = params.add(`%${filters.collaborator.replace(/[\\%_]/g, (char) => `\\${char}`)}%`)
    clauses.push("d.collaborator_match")
  }
  return { where: clauses.length ? `where ${clauses.join(" and ")}` : "", collaboratorPattern }
}

export async function loadResultsSummary(db: Database, organizationId: string, workflowId: string, scopes: ManageableScopes, filters: ResultsFilters): Promise<ResultsSummary> {
  const params = baseParams(organizationId, workflowId, scopes)
  const periodClause = `r.created_at >= ${params.add(filters.from)} and r.created_at < ${params.add(filters.to)}`
  const { where, collaboratorPattern } = dispatchWhere(params, filters)
  const result = await db.query<UsageSqlRow & { dispatches: number; persons: number; produced: number; sent: number; awaiting_qa: number; blocked: number }>(
    `with ${dispatchCte(periodClause, `select d.* from keys d ${where}`, collaboratorPattern)},
     filtered as (select d.* from dispatches d)
     select count(*)::int dispatches,
            coalesce(sum(persons), 0)::int persons,
            coalesce(sum(feedbacks_produced), 0)::int produced,
            coalesce(sum(feedbacks_sent), 0)::int sent,
            coalesce(sum(awaiting_qa), 0)::int awaiting_qa,
            coalesce(sum(blocked), 0)::int blocked,
            coalesce(sum(calls), 0)::int calls,
            sum(input_tokens)::bigint input_tokens, sum(output_tokens)::bigint output_tokens, sum(total_tokens)::bigint total_tokens,
            coalesce(bool_or(incomplete), false) incomplete, coalesce(sum(cost_unknown_calls), 0)::int cost_unknown_calls,
            (select json_agg(json_build_object('currency', currency, 'amount', amount::text) order by currency)
               from (select ur.currency, sum(ur.cost) amount from usage_rows ur join filtered f on f.root_id = ur.root_id
                      where ur.cost is not null and ur.currency is not null group by ur.currency) c) costs
       from filtered`,
    params.values,
  )
  const row = result.rows[0]!
  return {
    period: { from: filters.from.toISOString(), to: filters.to.toISOString() },
    dispatches: row.dispatches,
    persons: row.persons,
    feedbacksProduced: row.produced,
    feedbacksSent: row.sent,
    awaitingQa: row.awaiting_qa,
    blocked: row.blocked,
    usage: usageOf(row),
  }
}

export async function loadResultsPage(
  db: Database,
  organizationId: string,
  workflowId: string,
  scopes: ManageableScopes,
  filters: ResultsFilters,
  page: number,
  pageSize: number,
): Promise<{ items: DispatchRow[]; total: number; page: number; pageSize: number }> {
  const params = baseParams(organizationId, workflowId, scopes)
  const periodClause = `r.created_at >= ${params.add(filters.from)} and r.created_at < ${params.add(filters.to)}`
  const { where, collaboratorPattern } = dispatchWhere(params, filters)
  const limit = params.add(pageSize)
  const offset = params.add((page - 1) * pageSize)
  const result = await db.query<DispatchSqlRow & { total: number }>(
    `with ${dispatchCte(periodClause, `select d.* from keys d ${where} order by d.created_at desc, d.root_id limit ${limit} offset ${offset}`, collaboratorPattern)}
     select d.*, (select count(*) from keys d ${where})::int total from dispatches d
      order by d.created_at desc, d.root_id`,
    params.values,
  )
  return { items: result.rows.map(dispatchOf), total: result.rows[0]?.total ?? (page > 1 ? await countDispatches(db, organizationId, workflowId, scopes, filters) : 0), page, pageSize }
}

async function countDispatches(db: Database, organizationId: string, workflowId: string, scopes: ManageableScopes, filters: ResultsFilters): Promise<number> {
  const params = baseParams(organizationId, workflowId, scopes)
  const periodClause = `r.created_at >= ${params.add(filters.from)} and r.created_at < ${params.add(filters.to)}`
  const { where, collaboratorPattern } = dispatchWhere(params, filters)
  const result = await db.query<{ total: number }>(`with ${dispatchCte(periodClause, undefined, collaboratorPattern)} select count(*)::int total from keys d ${where}`, params.values)
  return result.rows[0]?.total ?? 0
}

// ---------------------------------------------------------------------------------------------
// DETALHE DE UM DISPARO
// ---------------------------------------------------------------------------------------------

type UsageGroupSqlRow = UsageSqlRow & { enrollment_id: string; workflow_node_id: string | null; use_case: string; provider_key: string; model_name: string }

async function loadUsageGroups(db: Database, organizationId: string, rootId: string, enrollmentIds: string[]): Promise<UsageGroupRow[]> {
  if (enrollmentIds.length === 0) return []
  const result = await db.query<UsageGroupSqlRow>(
    `select g.*, (select json_agg(json_build_object('currency', currency, 'amount', amount::text) order by currency)
                    from (select u2.currency, sum(u2.cost) amount from ai_usage_events u2
                           where u2.organization_id = $1 and u2.root_enrollment_id = $2 and u2.enrollment_id = g.enrollment_id
                             and u2.workflow_node_id is not distinct from g.workflow_node_id and u2.use_case = g.use_case
                             and u2.provider_key = g.provider_key and u2.model_name = g.model_name
                             and u2.cost is not null and u2.currency is not null
                           group by u2.currency) c) costs
       from (select u.enrollment_id, u.workflow_node_id, u.use_case, u.provider_key, u.model_name, ${USAGE_COLUMNS("u")}, min(u.occurred_at) first_at
               from ai_usage_events u
              where u.organization_id = $1 and u.root_enrollment_id = $2 and u.enrollment_id = any($3::uuid[])
              group by u.enrollment_id, u.workflow_node_id, u.use_case, u.provider_key, u.model_name) g
      order by g.first_at`,
    [organizationId, rootId, enrollmentIds],
  )
  return result.rows.map((row) => ({
    enrollmentId: row.enrollment_id,
    nodeId: row.workflow_node_id,
    useCase: row.use_case,
    useCaseLabel: findUseCase(row.use_case)?.label ?? row.use_case,
    providerKey: row.provider_key,
    modelName: row.model_name,
    usage: usageOf(row),
  }))
}

export async function loadDispatchDetail(
  db: Database,
  organizationId: string,
  workflowId: string,
  scopes: ManageableScopes,
  rootEnrollmentId: string,
  page: number,
  pageSize: number,
): Promise<DispatchDetail | null> {
  const params = baseParams(organizationId, workflowId, scopes)
  const rootClause = `r.id = ${params.add(rootEnrollmentId)}`
  const limit = params.add(pageSize)
  const offset = params.add((page - 1) * pageSize)
  const header = await db.query<DispatchSqlRow & { persons_page: PersonEnrollmentRow[] | null }>(
    `with ${dispatchCte(rootClause)}
     select d.*,
            (select json_agg(x order by x."subjectName", x."enrollmentId") from (
               select vp.enrollment_id "enrollmentId", e.version_id "versionId", e.status, e.current_node_id "currentNodeId",
                      e.created_at "createdAt", e.updated_at "updatedAt", vp.person_id "subjectId", vp.name "subjectName",
                      t.name "teamName", st.name "subteamName"
                 from visible_persons vp
                 join workflow_enrollments e on e.id = vp.enrollment_id
                 join people p on p.id = vp.person_id
                 left join teams t on t.id = p.team_id
                 left join subteams st on st.id = p.subteam_id
                order by vp.name, vp.enrollment_id limit ${limit} offset ${offset}) x) persons_page
       from dispatches d`,
    params.values,
  )
  const row = header.rows[0]
  if (!row) return null
  const dispatch = dispatchOf(row)
  const people = row.persons_page ?? []
  const personIds = people.map((person) => person.enrollmentId)
  const enrollmentIds = dispatch.consolidated ? [...personIds, rootEnrollmentId] : personIds

  const [events, artifacts, emissions, surfaceRows, graphs, usage, engineMessages] = await Promise.all([
    enrollmentIds.length === 0
      ? Promise.resolve({ rows: [] as EventRow[] })
      : db.query<EventRow>(
          `select e.enrollment_id "enrollmentId", e.node_id "nodeId", e.event_type "eventType", e.payload ->> 'actionType' "actionType",
                  case when jsonb_typeof(e.payload -> 'surfaces') = 'array' then array(select jsonb_array_elements_text(e.payload -> 'surfaces')) end surfaces,
                  case when jsonb_typeof(e.payload -> 'recipients') = 'array' then (select json_agg(json_build_object('id', r ->> 'id', 'name', r ->> 'name')) from jsonb_array_elements(e.payload -> 'recipients') r) end recipients,
                  e.payload ->> 'message' message, e.payload ->> 'routingMode' "routingMode", e.payload ->> 'synthesisMode' "synthesisMode",
                  case when e.event_type in ('node_failed', 'flow_dead') then jsonb_build_object('attempts', e.payload -> 'attempts', 'errorCategory', e.payload -> 'errorCategory', 'errorCategoryLabel', e.payload -> 'errorCategoryLabel', 'errorCode', e.payload -> 'errorCode', 'willRetry', e.payload -> 'willRetry', 'retryReason', e.payload -> 'retryReason', 'nextRetryAt', e.payload -> 'nextRetryAt', 'repairAttempt', e.payload -> 'repairAttempt', 'contract', e.payload -> 'contract', 'model', e.payload -> 'model', 'agentRunId', e.payload -> 'agentRunId') end failure,
                  e.created_at "createdAt"
             from workflow_enrollment_events e where e.enrollment_id = any($1::uuid[]) order by e.created_at, e.id`,
          [enrollmentIds],
        ),
    personIds.length === 0
      ? Promise.resolve({ rows: [] as ArtifactRow[] })
      : db.query<ArtifactRow>(
          `select id, enrollment_id "enrollmentId", node_id "nodeId", domain, status, disposition, artifact, last_error "lastError", completed_at "completedAt"
             from reliable_feedback_artifacts where organization_id = $1 and enrollment_id = any($2::uuid[]) order by created_at, id`,
          [organizationId, personIds],
        ),
    enrollmentIds.length === 0
      ? Promise.resolve({ rows: [] as EmissionRow[] })
      : db.query<EmissionRow>(
          `select enrollment_id "enrollmentId", node_id "nodeId", surface, recipient_id "recipientId", artifact_id "artifactId", engine_message_id "engineMessageId", feedback_id "feedbackId", created_at "createdAt"
             from workflow_output_emissions where organization_id = $1 and enrollment_id = any($2::uuid[])`,
          [organizationId, enrollmentIds],
        ),
    enrollmentIds.length === 0
      ? Promise.resolve({ rows: [] as SurfaceRow[] })
      : db.query<SurfaceRow>(
          `select enrollment_id "enrollmentId", node_id "nodeId", surface, recipient_id "recipientId", delivered_at "deliveredAt", created_at "createdAt"
             from workflow_outputs where organization_id = $1 and enrollment_id = any($2::uuid[])`,
          [organizationId, enrollmentIds],
        ),
    db.query<{ id: string; graph: unknown }>(
      `select v.id, v.graph from workflow_versions v where v.workflow_id = $1 and v.id in (select version_id from workflow_enrollments where id = any($2::uuid[]) or id = $3)`,
      [workflowId, enrollmentIds, rootEnrollmentId],
    ),
    loadUsageGroups(db, organizationId, rootEnrollmentId, enrollmentIds),
    personIds.length === 0
      ? Promise.resolve({ rows: [] as EngineMessageRow[] })
      : db.query<EngineMessageRow>(
          `select id, enrollment_id "enrollmentId", node_id "nodeId", domain, status, abstain_reason "abstainReason", brief ->> 'label' label,
                  message ->> 'card' card, case when jsonb_typeof(message -> 'paragraphs') = 'array' then array(select jsonb_array_elements_text(message -> 'paragraphs')) end paragraphs,
                  brief ->> 'tone' tone, coalesce(jsonb_array_length(case when jsonb_typeof(brief -> 'developments') = 'array' then brief -> 'developments' end), 0)::int developments,
                  coalesce(jsonb_array_length(case when jsonb_typeof(brief -> 'strengths') = 'array' then brief -> 'strengths' end), 0)::int strengths, error
             from feedback_engine_messages where organization_id = $1 and enrollment_id = any($2::uuid[]) order by created_at, id`,
          [organizationId, personIds],
        ),
  ])

  const graphMap = new Map<string, FlowGraph>()
  for (const graphRow of graphs.rows) {
    const parsed = flowGraphSchema.safeParse(graphRow.graph)
    if (parsed.success) graphMap.set(graphRow.id, parsed.data)
  }
  const agentIds = new Set<string>()
  const orchestratorIds = new Set<string>()
  for (const graph of graphMap.values()) {
    for (const node of graph.nodes) {
      const config = node.config as { actionType?: string; agentId?: string; orchestratorId?: string }
      if (node.type === "action" && config.actionType === "CALL_AGENT" && config.agentId) agentIds.add(config.agentId)
      if (node.type === "orchestrator" && config.orchestratorId) orchestratorIds.add(config.orchestratorId)
    }
  }
  const artifactIds = artifacts.rows.map((artifact) => artifact.id)
  const outputEvents = events.rows.filter((event) => event.eventType === "output_dispatched")
  const alertKeys = outputEvents.flatMap((event) => (event.recipients ?? []).map((recipient) => outputAlertDedupeKey(event.enrollmentId, event.nodeId, recipient.id)))

  const [reviews, alerts, agents, orchestrators, legacyFeedbacks] = await Promise.all([
    artifactIds.length === 0
      ? Promise.resolve({ rows: [] as ReviewRow[] })
      : db.query<ReviewRow>(
          `select artifact_id "artifactId", item_index "itemIndex", review_status status, final_wording "finalWording"
             from reliable_feedback_item_reviews where organization_id = $1 and artifact_id = any($2::uuid[])`,
          [organizationId, artifactIds],
        ),
    alertKeys.length === 0
      ? Promise.resolve({ rows: [] as AlertRow[] })
      : db.query<AlertRow>(`select dedupe_key "dedupeKey", created_at "createdAt" from alerts where organization_id = $1 and dedupe_key = any($2::text[])`, [organizationId, alertKeys]),
    agentIds.size === 0 ? Promise.resolve({ rows: [] as { id: string; name: string }[] }) : db.query<{ id: string; name: string }>(`select id, name from agents_all where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...agentIds]]),
    orchestratorIds.size === 0
      ? Promise.resolve({ rows: [] as { id: string; name: string }[] })
      : db.query<{ id: string; name: string }>(`select id, name from assistant_orchestrators_all where organization_id = $1 and id = any($2::uuid[])`, [organizationId, [...orchestratorIds]]),
    // Feedback publicado por um Output legado (Agent/Orquestrador → Output direto): o feedbackId que o próprio nó Output
    // gravou na saída dele — conferido contra "feedbacks" (mesma organização, destinatário = o colaborador da matrícula).
    people.length === 0
      ? Promise.resolve({ rows: [] as LegacyFeedbackRow[] })
      : db.query<LegacyFeedbackRow>(
          `select we.id "enrollmentId", n ->> 'id' "nodeId", f.id "feedbackId", f.status::text status, f.impacted_indicator "impactedIndicator",
                  f.observed_behavior "observedBehavior", f.recommendation, f.evidence_found "evidenceFound", f.published_at "publishedAt"
             from unnest($2::uuid[], $3::uuid[]) s(enrollment_id, subject_id)
             join workflow_enrollments we on we.id = s.enrollment_id
             join workflow_versions v on v.id = we.version_id
             cross join lateral jsonb_array_elements(v.graph -> 'nodes') n
             join feedbacks f on f.organization_id = $1 and f.operator_id = s.subject_id
                             and f.id = case when (we.node_outputs -> (n ->> 'id') ->> 'feedbackId') ~ '${UUID_RE}' then (we.node_outputs -> (n ->> 'id') ->> 'feedbackId')::uuid end
            where n ->> 'type' = 'output'`,
          [organizationId, people.map((person) => person.enrollmentId), people.map((person) => person.subjectId)],
        ),
  ])

  const inputs = {
    graphs: graphMap,
    names: { agents: new Map(agents.rows.map((agent) => [agent.id, agent.name])), orchestrators: new Map(orchestrators.rows.map((orchestrator) => [orchestrator.id, orchestrator.name])) },
    events: events.rows.map((event) => ({ ...event, createdAt: new Date(event.createdAt).toISOString() })),
    artifacts: artifacts.rows,
    reviews: reviews.rows,
    emissions: emissions.rows.map((emission) => ({ ...emission, createdAt: new Date(emission.createdAt).toISOString() })),
    alerts: alerts.rows.map((alert) => ({ ...alert, createdAt: new Date(alert.createdAt).toISOString() })),
    surfaceRows: surfaceRows.rows.map((surface) => ({ ...surface, deliveredAt: surface.deliveredAt ? new Date(surface.deliveredAt).toISOString() : null, createdAt: new Date(surface.createdAt).toISOString() })),
    legacyFeedbacks: legacyFeedbacks.rows.map((feedback) => ({ ...feedback, publishedAt: feedback.publishedAt ? new Date(feedback.publishedAt).toISOString() : null })),
    engineMessages: engineMessages.rows,
    usage,
  }
  const items = people.map((person) => assemblePersonResult(person, inputs))

  let rootUsage: DispatchDetail["rootUsage"] = null
  if (dispatch.consolidated) {
    const rootRows = usage.filter((entry) => entry.enrollmentId === rootEnrollmentId)
    const graph = graphMap.get(dispatch.version.id)
    const rootCalls: ResultAiCall[] = rootRows.map((entry) => ({ nodeId: entry.nodeId, nodeLabel: entry.nodeId ? (graph?.nodes.find((node) => node.id === entry.nodeId)?.label ?? entry.nodeId) : null, actor: null, useCase: entry.useCase, useCaseLabel: entry.useCaseLabel, providerKey: entry.providerKey, modelName: entry.modelName, usage: entry.usage }))
    rootUsage = rootRows.length > 0 ? { usage: sumUsage(rootRows.map((entry) => entry.usage)), aiCalls: rootCalls } : null
  }
  return { dispatch, persons: { items, total: dispatch.persons, page, pageSize }, rootUsage }
}
