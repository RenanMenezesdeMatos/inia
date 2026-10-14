import type { Database } from "../../../infrastructure/database/pool.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { resolveOrganizationTimezone } from "../../workflows/application/organization-timezone.js"
import { localDateOf } from "../../workflows/application/time-window.js"
import { resolveByRoleChain } from "../../workflows/application/enrollment-subject.js"
import { rolesWithPermission } from "../../access/domain/roles.js"
import { aggregateOutcome, buildJustification, evaluateGroup, planDecisions, selectRules, type EvaluationOutcome, type PlannedDecision, type RuleSelection, type RuleTrace } from "../domain/policy-evaluation.js"
import { isSensitiveType } from "../domain/intervention-type.js"
import type { ReportPerson, ReportPriorIntervention } from "../domain/intelligence-report.js"
import { createConditionResolver, loadSustainedDiagnoses, type SustainedDiagnosis } from "./condition-resolvers.js"
import { resolveResponsibleId, unresolvedResponsibleMessage } from "./responsible.js"
import { loadPublishedTypes, personInPolicyScope, policyVersionInForceAt, type PolicyHeader, type PolicyVersion, type PublishedType } from "./catalog.js"

/**
 * AVALIAÇÃO de uma política para UMA pessoa — só leitura (nada é gravado aqui; quem grava é `applyEvaluation`). É a mesma
 * função para o nó do Workflow, a simulação do administrador, a simulação no painel do nó e o QA Lab: só muda quem consome.
 */
type Db = Queryable | Database
const DAY_MS = 86_400_000

export type EvaluationPerson = { id: string; name: string; teamId: string | null; subteamId: string | null; teamName: string | null; active: boolean; role: string }

export type Assignment = {
  responsible: ReportPerson | null
  approver: ReportPerson | null
  /** Para quem a aprovação/decisão é endereçada (Pendências). Decisão sensível: só quem tem a permissão sensível no escopo. */
  approvalRecipientIds: string[]
  dueAt: string
  /** Responsável (ou aprovador) não encontrado na cadeia do colaborador — impede abrir, nunca escolhe "alguém". */
  problem: string | null
}

export type PolicyEvaluation = {
  organizationId: string
  policy: PolicyHeader
  version: PolicyVersion | null
  person: EvaluationPerson
  asOf: Date
  timeZone: string
  subjectKey: string
  indicatorCode: string | null
  indicatorName: string | null
  notApplicableReason: "POLICY_INACTIVE" | "NO_VERSION_IN_FORCE" | "OUT_OF_SCOPE" | "PERSON_INACTIVE" | null
  rules: RuleTrace[]
  selection: RuleSelection
  decisions: PlannedDecision[]
  outcome: EvaluationOutcome
  justification: string
  types: Map<string, PublishedType>
  assignments: Map<string, Assignment>
  priorInterventions: ReportPriorIntervention[]
  diagnoses: SustainedDiagnosis[]
  recommendOnly: boolean
}

export const subjectKeyOf = (policy: Pick<PolicyHeader, "key">, version: PolicyVersion | null) => (version?.definition.indicatorCode ? `INDICATOR:${version.definition.indicatorCode}` : `POLICY:${policy.key}`)

async function loadPerson(db: Db, organizationId: string, personId: string): Promise<EvaluationPerson | null> {
  const row = (await db.query<{ id: string; name: string; team_id: string | null; subteam_id: string | null; team_name: string | null; active: boolean; role: string }>(
    `select p.id, p.name, p.team_id, p.subteam_id, t.name team_name, p.active, p.role from people p left join teams t on t.id = p.team_id where p.id = $1 and p.organization_id = $2`,
    [personId, organizationId],
  )).rows[0]
  return row ? { id: row.id, name: row.name, teamId: row.team_id, subteamId: row.subteam_id, teamName: row.team_name, active: row.active, role: row.role } : null
}

/** Pessoas que podem tomar a decisão SENSÍVEL sobre o colaborador: conta ativa com a permissão num escopo que o alcança. */
export async function sensitiveDecisionHolders(db: Db, organizationId: string, person: Pick<EvaluationPerson, "id" | "teamId" | "subteamId">): Promise<string[]> {
  const rows = await db.query<{ id: string }>(
    `select distinct p.id from access_role_assignments a
       join user_accounts ua on ua.id = a.user_account_id and ua.organization_id = a.organization_id and ua.active
       join people p on p.id = ua.person_id and p.active
      where a.organization_id = $1 and a.revoked_at is null and a.role_code = any($2::text[]) and p.id <> $3
        and (a.scope_type = 'ORGANIZATION' or (a.scope_type = 'GROUP' and a.team_id = $4) or (a.scope_type = 'SUBGROUP' and a.subteam_id = $5)
             or (a.scope_type = 'MY_STRUCTURE' and exists (
               with recursive chain as (select reports_to_id id from people where id = $3 union select x.reports_to_id from people x join chain c on x.id = c.id where x.reports_to_id is not null)
               select 1 from chain where chain.id = p.id)))
      order by p.id`,
    [organizationId, rolesWithPermission("interventions.sensitive_decide"), person.id, person.teamId, person.subteamId],
  )
  return rows.rows.map((row) => row.id)
}

async function personName(db: Db, id: string): Promise<ReportPerson> {
  const row = (await db.query<{ name: string }>(`select name from people where id = $1`, [id])).rows[0]
  return { personId: id, name: row?.name ?? "—" }
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Responsável, aprovador e prazo de cada decisão que abriria uma intervenção — pela cadeia do colaborador (reports_to). */
export async function resolveAssignments(db: Db, organizationId: string, person: EvaluationPerson, decisions: readonly PlannedDecision[], types: ReadonlyMap<string, PublishedType>, today: string): Promise<Map<string, Assignment>> {
  const assignments = new Map<string, Assignment>()
  for (const decision of decisions) {
    if (!["CREATED", "PENDING_APPROVAL", "RECOMMENDED"].includes(decision.status)) continue
    const type = types.get(decision.typeKey)
    if (!type) continue
    const dueAt = addDays(today, decision.action.dueInDays ?? type.definition.defaultDueDays)
    const responsibleId = await resolveResponsibleId(db, person.id, type.definition.responsibleRole)
    let problem: string | null = responsibleId ? null : unresolvedResponsibleMessage(type.definition.responsibleRole, person.name, type.definition.name, "ser responsável por")
    let approver: ReportPerson | null = null
    let approvalRecipientIds: string[] = []
    if (type.definition.approval.required) {
      const approverId = (await resolveByRoleChain(db as Database, person.id, [type.definition.approval.approverRole]))[0]?.id ?? null
      if (isSensitiveType(type.definition)) {
        // Decisão sensível: endereçada a quem tem a permissão (o aprovador designado só entra se também a tiver).
        const holders = await sensitiveDecisionHolders(db, organizationId, person)
        approvalRecipientIds = holders
        approver = approverId && holders.includes(approverId) ? await personName(db, approverId) : null
        if (holders.length === 0) problem ??= `Ninguém tem a permissão de decisão sensível no escopo de ${person.name}: a solicitação não pode ser aberta.`
      } else {
        if (!approverId) problem ??= unresolvedResponsibleMessage(type.definition.approval.approverRole, person.name, type.definition.name, "aprovar")
        if (approverId) {
          approver = await personName(db, approverId)
          approvalRecipientIds = [approverId]
        }
      }
    }
    assignments.set(decision.typeKey, { responsible: responsibleId ? await personName(db, responsibleId) : null, approver, approvalRecipientIds, dueAt, problem })
  }
  return assignments
}

async function loadInterventionState(db: Db, organizationId: string, personId: string, asOf: Date) {
  const rows = await db.query<{ id: string; type_key: string; subject_key: string; status: string; created_at: Date; closed_at: Date | null; operational: string | null; learning: string | null }>(
    `select id, type_key, subject_key, status, created_at, coalesce(completed_at, cancelled_at) closed_at, outcome->'operational'->>'result' operational, outcome->'learning'->>'result' learning
       from interventions where organization_id = $1 and person_id = $2 and created_at <= $3 order by created_at desc limit 200`,
    [organizationId, personId, asOf],
  )
  return rows.rows
}

export type EvaluatePolicyInput = {
  organizationId: string
  policy: PolicyHeader
  personId: string
  asOf: Date
  recommendOnly: boolean
  /** Versão FIXADA (retries/retomadas/reavaliação); ausente = a em vigor em `versionAt` (padrão: `asOf`). */
  version?: PolicyVersion | null
  versionAt?: Date
}

export async function evaluatePolicy(db: Db, input: EvaluatePolicyInput): Promise<PolicyEvaluation | null> {
  const person = await loadPerson(db, input.organizationId, input.personId)
  if (!person) return null
  const timeZone = await resolveOrganizationTimezone(db as Database, input.organizationId)
  const version = input.version !== undefined ? input.version : await policyVersionInForceAt(db, input.organizationId, input.policy.id, input.versionAt ?? input.asOf)
  const subjectKey = subjectKeyOf(input.policy, version)
  const indicatorCode = version?.definition.indicatorCode ?? null
  const indicatorName = indicatorCode ? ((await db.query<{ name: string }>(`select name from indicator_definitions where organization_id = $1 and code = $2`, [input.organizationId, indicatorCode])).rows[0]?.name ?? indicatorCode) : null
  const empty: RuleSelection = { selected: [], status: "NO_MATCH", blockedBy: null, inconclusiveRules: [] }
  const base = { organizationId: input.organizationId, policy: input.policy, version, person, asOf: input.asOf, timeZone, subjectKey, indicatorCode, indicatorName, recommendOnly: input.recommendOnly }

  const notApplicable: PolicyEvaluation["notApplicableReason"] = !input.policy.active ? "POLICY_INACTIVE" : !version ? "NO_VERSION_IN_FORCE" : !person.active ? "PERSON_INACTIVE" : !personInPolicyScope(input.policy, person) ? "OUT_OF_SCOPE" : null
  if (notApplicable) {
    const reasonText = { POLICY_INACTIVE: "a política está inativa", NO_VERSION_IN_FORCE: "não há versão publicada em vigor", PERSON_INACTIVE: "o colaborador está inativo no cadastro", OUT_OF_SCOPE: "o colaborador está fora do escopo da política" }[notApplicable]
    return { ...base, notApplicableReason: notApplicable, rules: [], selection: empty, decisions: [], outcome: "NOT_APPLICABLE", justification: `Política "${input.policy.name}": não aplicável — ${reasonText}.`, types: new Map(), assignments: new Map(), priorInterventions: [], diagnoses: [] }
  }

  const definition = version!.definition
  const resolver = createConditionResolver(db, { organizationId: input.organizationId, personId: person.id, policyIndicatorCode: indicatorCode, subjectKey, asOf: input.asOf, timeZone })
  const rules: RuleTrace[] = []
  for (const rule of definition.rules) {
    const trace = await evaluateGroup(rule.when, resolver)
    rules.push({ key: rule.key, name: rule.name, priority: rule.priority, status: trace.status, trace })
  }
  const selection = selectRules(definition, rules)
  const allTypes = await loadPublishedTypes(db, input.organizationId)
  // Só tipos ATIVOS decidem; um tipo inativado depois da publicação vira conflito explícito (nunca é aberto em silêncio).
  const types = new Map([...allTypes].filter(([, type]) => type.active))
  const history = await loadInterventionState(db, input.organizationId, person.id, input.asOf)
  const decisions = planDecisions({
    selection,
    subjectKey,
    types,
    active: history.filter((row) => ["PROPOSED", "AWAITING_APPROVAL", "IN_PROGRESS"].includes(row.status)).map((row) => ({ id: row.id, typeKey: row.type_key, subjectKey: row.subject_key, status: row.status })),
    closed: history.filter((row) => row.closed_at).map((row) => ({ id: row.id, typeKey: row.type_key, subjectKey: row.subject_key, closedAt: row.closed_at!.toISOString() })),
    now: input.asOf,
    recommendOnly: input.recommendOnly,
  })
  const outcome = aggregateOutcome(selection, decisions)
  const justification = buildJustification({ policyName: input.policy.name, policyVersion: version!.version, matchStrategy: definition.matchStrategy, rules, selection, decisions, outcome, definition })
  const today = localDateOf(input.asOf, timeZone)
  const assignments = await resolveAssignments(db, input.organizationId, person, decisions, types, today)
  const since = new Date(input.asOf.getTime() - 180 * DAY_MS)
  const priorInterventions: ReportPriorIntervention[] = history
    .filter((row) => row.created_at.getTime() >= since.getTime())
    .slice(0, 20)
    .map((row) => ({ id: row.id, typeKey: row.type_key, typeName: allTypes.get(row.type_key)?.definition.name ?? row.type_key, status: row.status, openedAt: row.created_at.toISOString(), closedAt: row.closed_at?.toISOString() ?? null, operationalResult: row.operational, learningResult: row.learning }))
  const diagnoses = decisions.length > 0 ? await loadSustainedDiagnoses(db, { organizationId: input.organizationId, personId: person.id, indicatorCode, since: new Date(input.asOf.getTime() - 90 * DAY_MS), until: input.asOf }) : []
  return { ...base, notApplicableReason: null, rules, selection, decisions, outcome, justification, types, assignments, priorInterventions, diagnoses }
}

/** Projeção serializável da avaliação (o que se grava em `facts/rules/decisions` e o que a simulação mostra). */
export function serializeEvaluation(evaluation: PolicyEvaluation) {
  return {
    policy: { id: evaluation.policy.id, key: evaluation.policy.key, name: evaluation.policy.name, versionId: evaluation.version?.id ?? null, version: evaluation.version?.version ?? null, effectiveFrom: evaluation.version?.effectiveFrom ?? null },
    person: { id: evaluation.person.id, name: evaluation.person.name, teamName: evaluation.person.teamName },
    asOf: evaluation.asOf.toISOString(),
    timeZone: evaluation.timeZone,
    subjectKey: evaluation.subjectKey,
    indicatorCode: evaluation.indicatorCode,
    notApplicableReason: evaluation.notApplicableReason,
    outcome: evaluation.outcome,
    recommendOnly: evaluation.recommendOnly,
    selection: { status: evaluation.selection.status, blockedBy: evaluation.selection.blockedBy, inconclusiveRules: evaluation.selection.inconclusiveRules, selected: evaluation.selection.selected.map((item) => ({ ruleKey: item.rule.key, mode: item.mode })) },
    rules: evaluation.rules,
    decisions: evaluation.decisions.map((decision) => ({ ...decision, assignment: evaluation.assignments.get(decision.typeKey) ?? null, typeVersion: evaluation.types.get(decision.typeKey)?.version ?? null })),
    justification: evaluation.justification,
  }
}
export type SerializedEvaluation = ReturnType<typeof serializeEvaluation>
