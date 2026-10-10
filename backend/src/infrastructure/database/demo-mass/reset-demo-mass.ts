import type pg from "pg"
import { DEMO_ORGANIZATION_ID, DEMO_SOURCE } from "./demo-constants.js"
import { demoId } from "./demo-ids.js"
import { DEMO_VOLUME_INDICATOR } from "./indicator-catalog.js"

import { DEMO_FLAGS, demoFlagId } from "./flag-catalog.js"
import { deleteDemoFollowUps, demoFollowUpIds, findDemoDerivedArtifacts, type DemoDerivedArtifacts } from "./demo-follow-ups.js"
import type { DemoMass } from "./build-demo-mass.js"
import { demoSubjectCatalogInput } from "./subject-catalog.js"

/**
 * Reset da massa demo: apaga SOMENTE o que o gerador produziu, por lista explícita de ids
 * (a massa é determinística, então regerar = saber exatamente o que apagar). Nunca TRUNCATE,
 * nunca `like 'de00%'`, nunca toca em dados fora da massa. Se algo FORA da massa passou a
 * referenciar uma pessoa/interação demo (caso aberto, feedback, alerta, matrícula em workflow…),
 * o reset PARA e lista o que bloqueia, em vez de apagar dado de domínio por tabela.
 *
 * Duas famílias de linhas contam como "da massa" além da lista de ids: (1) o que o seed cria por
 * id determinístico (`demoFollowUpIds`) e (2) o que o runtime DERIVOU da Pendência demo quando
 * alguém a decidiu de verdade — descoberto por lineage real (`findDemoDerivedArtifacts`), nunca por
 * padrão de texto. Tudo o mais que aponte para pessoa/interação/Grupo demo é bloqueio.
 */
type Client = pg.PoolClient

/** Tabelas que referenciam pessoas/interações/grupos da massa mas NÃO são produzidas por ela. */
const DOWNSTREAM_REFERENCES: { table: string; column: string; target: "people" | "interactions" | "teams" | "subteams" }[] = [
  // Configuração apontando para Grupos/Subgrupos demo (ex.: os Workflows-modelo oficiais com
  // Abrangência "B2C · Retenção") — sem isto o delete de `teams` estourava a FK no meio da transação.
  { table: "workflows", column: "team_id", target: "teams" },
  { table: "workflows", column: "subteam_id", target: "subteams" },
  { table: "agents", column: "team_id", target: "teams" },
  { table: "agents", column: "subteam_id", target: "subteams" },
  { table: "assistant_orchestrators", column: "team_id", target: "teams" },
  { table: "assistant_orchestrators", column: "subteam_id", target: "subteams" },
  { table: "supervision_cases", column: "operator_id", target: "people" },
  { table: "supervision_cases", column: "assignee_id", target: "people" },
  { table: "feedbacks", column: "operator_id", target: "people" },
  { table: "feedbacks", column: "author_id", target: "people" },
  { table: "alerts", column: "recipient_id", target: "people" },
  { table: "workflow_outputs", column: "recipient_id", target: "people" },
  { table: "workflow_enrollments", column: "scheduled_subject_id", target: "people" },
  { table: "workflow_enrollments", column: "interaction_id", target: "interactions" },
  { table: "development_plans", column: "operator_id", target: "people" },
  { table: "development_plans", column: "owner_id", target: "people" },
  { table: "performance_escalations", column: "operator_id", target: "people" },
  { table: "monitoring_evaluations", column: "interaction_id", target: "interactions" },
  { table: "monitoring_triggers", column: "interaction_id", target: "interactions" },
  { table: "operator_diagnostics", column: "interaction_id", target: "interactions" },
  { table: "assistant_interactions", column: "operator_id", target: "people" },
  { table: "assistant_conversations", column: "owner_person_id", target: "people" },
  { table: "qa_runs", column: "executed_by", target: "people" },
  { table: "workflows", column: "created_by", target: "people" },
  { table: "workflow_versions", column: "created_by", target: "people" },
  { table: "audit_logs", column: "actor_id", target: "people" },
  { table: "case_timeline_events", column: "actor_id", target: "people" },
  { table: "agent_history", column: "changed_by_person_id", target: "people" },
  { table: "assistant_orchestrators", column: "created_by", target: "people" },
  { table: "org_config_values", column: "updated_by", target: "people" },
]

/** Alertas gerados pelos jobs do calendário operacional (people/application/*-service.ts). */
const CALENDAR_ALERT_CLAUSE = `alert_type in ('WORKDAY_MISSING_PRODUCTION', 'WORKDAY_PRODUCTION_DIVERGENCE', 'WORKDAY_STATUS_INCONSISTENCY', 'WORKDAY_CLASSIFICATION_SUPERSEDED', 'WORK_SCHEDULE_HORIZON', 'DATA_SOURCE_AVAILABILITY_DELAYED')`
const CALENDAR_AUDIT_CLAUSE = `entity_type in ('employee_schedule_exception', 'workday_reconciliation', 'workday_classification')`

export type ResetReport = {
  deleted: Record<string, number>
  blockers: { table: string; column: string; count: number }[]
  /** O que foi reconhecido como DERIVADO da Pendência demo (lineage) — informativo no log. */
  derived: DemoDerivedArtifacts
}

function allInteractionIds(mass: DemoMass): string[] {
  // As 90 chamadas de diagnóstico do lote externo (diagnostic-calls.ts) são da massa: saem com ela, por id.
  return [...mass.structure.people.filter((person) => person.role === "OPERATOR").flatMap((operator) => mass.interactionsOf(operator).map((row) => row.id)), ...mass.diagnosticCalls.map((row) => row.id)]
}

/** Linhas dessas tabelas que a PRÓPRIA massa cria (Acompanhamento/Ciência/Pendência canônicos —
 * demo-follow-ups.ts): reconhecidas por id explícito, nunca por padrão de prefixo — o que não
 * estiver nesta lista continua sendo tratado como dado real e bloqueia o reset. */
function ownedRowsByTable(derived: DemoDerivedArtifacts): Record<string, string[]> {
  const ids = demoFollowUpIds()
  return {
    supervision_cases: [...ids.cases, ...derived.cases],
    feedbacks: [...ids.feedbacks, ...derived.feedbacks],
    alerts: [...ids.alerts, ...derived.alerts],
    workflow_enrollments: [...new Set([...ids.enrollments, ...derived.enrollments])],
    workflows: ids.workflows,
    workflow_versions: ids.versions,
  }
}

/** Pessoas que a massa CRIOU (as adotadas de legacy-adoption.ts já existiam: nunca entram em delete/bloqueio por pessoa). */
function ownedPeople(mass: DemoMass) {
  return mass.structure.people.filter((person) => !person.adopted)
}

export async function findResetBlockers(client: Client, mass: DemoMass, interactionIds: string[], derived: DemoDerivedArtifacts): Promise<ResetReport["blockers"]> {
  const personIds = ownedPeople(mass).map((person) => person.id)
  const owned = ownedRowsByTable(derived)
  const blockers: ResetReport["blockers"] = []
  const teamIds = mass.structure.teams.map((team) => team.id)
  const subteamIds = mass.structure.subteams.map((subteam) => subteam.id)
  for (const reference of DOWNSTREAM_REFERENCES) {
    const ids = reference.target === "people" ? personIds : reference.target === "interactions" ? interactionIds : reference.target === "teams" ? teamIds : subteamIds
    const ownedIds = owned[reference.table] ?? []
    // workflow_outputs não tem id na lista: é "da massa" quando pertence a uma matrícula da massa.
    // Alertas/auditoria do CALENDÁRIO OPERACIONAL (reconciliação de dias, horizonte da escala, exceções)
    // são derivados dos fatos da massa pelos jobs determinísticos — saem com ela, nunca bloqueiam.
    const ownershipClause = reference.table === "workflow_outputs" ? `not (enrollment_id = any($2::uuid[]))` : reference.table === "alerts" ? `not (id = any($2::uuid[])) and not (${CALENDAR_ALERT_CLAUSE})` : reference.table === "audit_logs" ? `not (id = any($2::uuid[])) and not (${CALENDAR_AUDIT_CLAUSE})` : `not (id = any($2::uuid[]))`
    const ownedForClause = reference.table === "workflow_outputs" ? owned.workflow_enrollments! : ownedIds
    const result = await client.query<{ count: string }>(
      `select count(*)::text from ${reference.table} where ${reference.column} = any($1::uuid[]) and ${ownershipClause}`,
      [ids, ownedForClause],
    )
    const count = Number(result.rows[0]!.count)
    if (count > 0) blockers.push({ table: reference.table, column: reference.column, count })
  }
  return blockers
}

export async function resetDemoMass(client: Client, mass: DemoMass): Promise<ResetReport> {
  const personIds = ownedPeople(mass).map((person) => person.id)
  const operatorIds = ownedPeople(mass).filter((person) => person.role === "OPERATOR").map((person) => person.id)
  const adopted = mass.structure.people.filter((person) => person.adopted)
  const adoptedOperators = adopted.filter((person) => person.role === "OPERATOR")
  const adoptedIds = adopted.map((person) => person.id)
  const interactionIds = allInteractionIds(mass)
  const derived = await findDemoDerivedArtifacts(client)
  const blockers = await findResetBlockers(client, mass, interactionIds, derived)
  if (blockers.length > 0) return { deleted: {}, blockers, derived }

  const deleted: Record<string, number> = {}
  const run = async (label: string, sql: string, params: unknown[]) => {
    const result = await client.query(sql, params)
    deleted[label] = (deleted[label] ?? 0) + (result.rowCount ?? 0)
  }

  await client.query("begin")
  try {
    // Primeiro o que referencia pessoas: Acompanhamento/Ciência/Pendência canônicos (por id).
    await deleteDemoFollowUps(client, run, derived)
    // Calendário operacional: reconciliações, alertas e auditoria derivados dos fatos da massa (exceções caem em cascata com people).
    await run("workday_reconciliations", `update workday_reconciliations set classification_id = null where person_id = any($1::uuid[])`, [personIds])
    await run("workday_classifications", `delete from workday_classifications where person_id = any($1::uuid[])`, [personIds])
    await run("workday_reconciliations", `delete from workday_reconciliations where person_id = any($1::uuid[])`, [personIds])
    await run("alerts", `delete from alerts where recipient_id = any($1::uuid[]) and ${CALENDAR_ALERT_CLAUSE}`, [personIds])
    await run("audit_logs", `delete from audit_logs where actor_id = any($1::uuid[]) and ${CALENDAR_AUDIT_CLAUSE}`, [personIds])
    // Fixtures da Central de Dados (seeds/demo/002_data_hub.sql): feeds, runs, rejeições e lineage caem em cascata.
    await run("data_sources", `delete from data_sources where id = any($1::uuid[])`, [["de00da7a-0000-4000-8000-000000000001", "de00da7a-0000-4000-8000-000000000002"]])
    // interaction_flags e transcripts caem em cascata (FK on delete cascade).
    await run("interactions", `delete from interactions where id = any($1::uuid[])`, [interactionIds])
    await run("indicator_measurements", `delete from indicator_measurements where subject_type = 'PERSON' and subject_id = any($1::uuid[]) and source = $2`, [operatorIds, DEMO_SOURCE])
    await run("employee_indicator_performance", `delete from employee_indicator_performance where person_id = any($1::uuid[]) and source = $2`, [operatorIds, DEMO_SOURCE])
    await run("employee_prv_performance", `delete from employee_prv_performance where person_id = any($1::uuid[]) and source = $2`, [operatorIds, DEMO_SOURCE])
    await run("employee_work_shifts", `delete from employee_work_shifts where person_id = any($1::uuid[])`, [operatorIds])
    // Adotados: só o que a massa gerou PRA ELES, por id determinístico — fechamento/medição/jornada
    // que já existiam (seed SQL antigo, chamadas reais, QA) ficam; a pessoa volta ao Grupo legado.
    if (adoptedOperators.length > 0) {
      const adoptedOperatorIds = new Set(adoptedOperators.map((person) => person.id))
      await run("indicator_measurements", `delete from indicator_measurements where id = any($1::uuid[])`, [adoptedOperators.flatMap((operator) => mass.dailyMeasurementsOf(operator).map((row) => row.id))])
      await run("employee_indicator_performance", `delete from employee_indicator_performance where id = any($1::uuid[])`, [mass.performance.indicatorRows.filter((row) => adoptedOperatorIds.has(row.personId)).map((row) => row.id)])
      await run("employee_prv_performance", `delete from employee_prv_performance where id = any($1::uuid[])`, [mass.performance.prvRows.filter((row) => adoptedOperatorIds.has(row.personId)).map((row) => row.id)])
      await run("employee_work_shifts", `delete from employee_work_shifts where id = any($1::uuid[])`, [adoptedOperators.map((person) => demoId(`shift:${person.key}`))])
    }
    if (adopted.length > 0) {
      await run("employee_status_periods", `delete from employee_status_periods where person_id = any($1::uuid[]) and source = $2`, [adoptedIds, DEMO_SOURCE])
      await run("employee_schedule_days", `delete from employee_schedule_days where person_id = any($1::uuid[]) and source = $2`, [adoptedIds, DEMO_SOURCE])
      await run("user_accounts", `delete from user_accounts where person_id = any($1::uuid[]) and id = any($2::uuid[])`, [adoptedIds, adopted.map((person) => demoId(`user:${person.key}`))])
      for (const person of adopted) {
        const reportsTo = person.reportsToKey ? mass.structure.byKey.get(person.reportsToKey)! : null
        const legacyTeamCode = person.adopted!.legacyTeamExternalCode
        await client.query(
          `update people set reports_to_id = $2, subteam_id = null,
             team_id = (select id from teams where organization_id = $4 and external_code = $3 limit 1)
           where id = $1`,
          [person.id, reportsTo && reportsTo.adopted ? reportsTo.id : null, legacyTeamCode, DEMO_ORGANIZATION_ID],
        )
      }
    }
    await run("employee_status_periods", `delete from employee_status_periods where person_id = any($1::uuid[])`, [personIds])
    await run("employee_schedule_days", `delete from employee_schedule_days where person_id = any($1::uuid[])`, [personIds])
    await run("goals", `delete from goals where id = any($1::uuid[])`, [mass.performance.goals.map((goal) => goal.id)])
    // Papéis de acesso (V1.5.7) saem junto com as contas demo (histórico só existe para contas que continuam).
    await run("access_role_assignments", `delete from access_role_assignments where user_account_id in (select id from user_accounts where person_id = any($1::uuid[]))`, [personIds])
    await run("user_accounts", `delete from user_accounts where person_id = any($1::uuid[])`, [personIds])
    await run("user_role_assignments", `delete from user_role_assignments where person_id = any($1::uuid[])`, [personIds])
    // Quebra a cadeia reports_to antes de apagar (auto-referência).
    await client.query(`update people set reports_to_id = null where id = any($1::uuid[])`, [personIds])
    await run("people", `delete from people where id = any($1::uuid[])`, [personIds])
    // Indicador de volume criado pela massa: sai só se nada fora da massa o referencia (medição real, meta, fechamento, Workflow ficam de fora — nunca cascade).
    await run(
      "indicator_definitions",
      `delete from indicator_definitions d where d.id = $1
         and not exists (select 1 from indicator_measurements m where m.indicator_definition_id = d.id)
         and not exists (select 1 from employee_indicator_performance p where p.indicator_definition_id = d.id)
         and not exists (select 1 from goals g where g.indicator_definition_id = d.id)`,
      [demoId(`indicator:${DEMO_VOLUME_INDICATOR.code}`)],
    )
    // Catálogo demo de assuntos canônicos (migration 075): só as definições/aliases que a massa criou, por id.
    const subjectCatalog = demoSubjectCatalogInput()
    await run("interaction_subject_aliases", `delete from interaction_subject_aliases where id = any($1::uuid[])`, [subjectCatalog.aliases.map((alias) => alias.id)])
    await run("interaction_subject_definitions", `delete from interaction_subject_definitions d where d.id = any($1::uuid[]) and not exists (select 1 from interaction_subject_aliases a where a.subject_definition_id = d.id)`, [subjectCatalog.definitions.map((definition) => definition.id)])
    await run("subteams", `delete from subteams where id = any($1::uuid[])`, [mass.structure.subteams.map((subteam) => subteam.id)])
    await run("teams", `delete from teams where id = any($1::uuid[])`, [mass.structure.teams.map((team) => team.id)])
    await run("operations", `delete from operations where id = any($1::uuid[])`, [mass.structure.operations.filter((operation) => !operation.existing).map((operation) => operation.id)])
    // Flags de canal criadas pelo seed (só as não pré-existentes, e só se ninguém mais as usa).
    const demoFlagIds = DEMO_FLAGS.filter((flag) => !flag.existing).map((flag) => demoFlagId(flag.name))
    await run("channel_flags", `delete from channel_flags cf where cf.id = any($1::uuid[]) and cf.organization_id = $2 and not exists (select 1 from interaction_flags f where f.channel_flag_id = cf.id)`, [demoFlagIds, DEMO_ORGANIZATION_ID])
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  }
  return { deleted, blockers: [], derived }
}

