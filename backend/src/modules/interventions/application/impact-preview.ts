import type { Database } from "../../../infrastructure/database/pool.js"
import type { Queryable } from "../../people/application/schedule-exception-service.js"
import { compareImpact, summarizeImpact, INTERVENTION_IMPACT_PREVIEW_VERSION, type ImpactComparison, type ImpactEvaluation, type ImpactSummary } from "../domain/impact-preview.js"
import { isSensitiveType } from "../domain/intervention-type.js"
import type { PolicyHeader, PolicyVersion } from "./catalog.js"
import { evaluatePolicy, type PolicyEvaluation } from "./evaluate-policy.js"

/**
 * PRÉVIA DE IMPACTO de uma versão da política sobre várias pessoas — só leitura. Roda `evaluatePolicy` (a mesma avaliação do nó
 * do Workflow) para cada pessoa, como se a política rodasse agora aplicando as regras, e devolve a soma (`summarizeImpact`).
 *
 * Quem chama decide QUEM entra (a rota só passa pessoas que o usuário já enxerga) e se o histórico de intervenções de cada uma
 * pode ser lido. O trabalho tem um limite de tempo: passando dele, a prévia volta parcial e diz quantas pessoas avaliou — nunca
 * extrapola as que faltaram.
 */
type Db = Queryable | Database

export type ImpactPerson = { id: string; historyVisible: boolean }
export type ImpactPreview = {
  version: typeof INTERVENTION_IMPACT_PREVIEW_VERSION
  asOf: string
  policyVersion: { id: string; version: number }
  population: { requested: number; evaluated: number; truncated: boolean; historyHidden: number }
  summary: ImpactSummary
  comparison: (ImpactComparison & { baselineVersion: number }) | null
}

export const IMPACT_PREVIEW_BUDGET_MS = 25_000
export const IMPACT_PREVIEW_CONCURRENCY = 6

/** Pessoas ATIVAS da operação no escopo da política (Organização, Grupo ou Subgrupo), por nome — a mesma população da simulação. */
export async function loadImpactPopulation(db: Db, organizationId: string, policy: Pick<PolicyHeader, "scopeType" | "teamId" | "subteamId">): Promise<{ id: string; teamId: string | null; subteamId: string | null }[]> {
  const rows = await db.query<{ id: string; team_id: string | null; subteam_id: string | null }>(
    `select id, team_id, subteam_id from people
      where organization_id = $1 and active and role = 'OPERATOR'
        and ($2 = 'ORGANIZATION' or ($2 = 'GROUP' and team_id = $3::uuid) or ($2 = 'SUBGROUP' and subteam_id = $4::uuid))
      order by name, id`,
    [organizationId, policy.scopeType, policy.teamId, policy.subteamId],
  )
  return rows.rows.map((row) => ({ id: row.id, teamId: row.team_id, subteamId: row.subteam_id }))
}

export function toImpactEvaluation(evaluation: PolicyEvaluation): ImpactEvaluation {
  return {
    person: { id: evaluation.person.id, name: evaluation.person.name, teamName: evaluation.person.teamName },
    outcome: evaluation.outcome,
    rules: evaluation.rules.map((rule) => ({ key: rule.key, name: rule.name, priority: rule.priority, status: rule.status })),
    selected: evaluation.selection.selected.map((item) => ({ ruleKey: item.rule.key, mode: item.mode })),
    decisions: evaluation.decisions.map((decision) => {
      const type = evaluation.types.get(decision.typeKey)
      const assignment = evaluation.assignments.get(decision.typeKey)
      return { typeKey: decision.typeKey, typeName: decision.typeName, status: decision.status, sensitive: type ? isSensitiveType(type.definition) : false, responsible: assignment?.responsible ?? null, problem: assignment?.problem ?? null }
    }),
  }
}

export async function previewPolicyImpact(
  db: Db,
  input: { organizationId: string; policy: PolicyHeader; version: PolicyVersion; baseline: PolicyVersion | null; people: readonly ImpactPerson[]; asOf: Date; budgetMs?: number; concurrency?: number; clock?: () => number },
): Promise<ImpactPreview> {
  const clock = input.clock ?? Date.now
  const deadline = clock() + (input.budgetMs ?? IMPACT_PREVIEW_BUDGET_MS)
  const target: ImpactEvaluation[] = []
  const baseline: ImpactEvaluation[] = []
  let next = 0
  let historyHidden = 0
  // Inativa também entra na prévia: é assim que se confere antes de ligar (o mesmo critério da simulação).
  const policy = { ...input.policy, active: true }
  const evaluate = (person: ImpactPerson, version: PolicyVersion) =>
    evaluatePolicy(db, { organizationId: input.organizationId, policy, personId: person.id, asOf: input.asOf, recommendOnly: false, version, interventionHistory: person.historyVisible ? "VISIBLE" : "HIDDEN" })

  const worker = async () => {
    while (next < input.people.length && clock() < deadline) {
      const person = input.people[next++]!
      const evaluation = await evaluate(person, input.version)
      if (!evaluation) continue
      target.push(toImpactEvaluation(evaluation))
      if (!person.historyVisible) historyHidden += 1
      if (input.baseline) {
        const before = await evaluate(person, input.baseline)
        if (before) baseline.push(toImpactEvaluation(before))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(input.concurrency ?? IMPACT_PREVIEW_CONCURRENCY, input.people.length)) }, worker))

  return {
    version: INTERVENTION_IMPACT_PREVIEW_VERSION,
    asOf: input.asOf.toISOString(),
    policyVersion: { id: input.version.id, version: input.version.version },
    population: { requested: input.people.length, evaluated: target.length, truncated: next < input.people.length, historyHidden },
    summary: summarizeImpact(target),
    comparison: input.baseline ? { ...compareImpact(target, baseline), baselineVersion: input.baseline.version } : null,
  }
}
