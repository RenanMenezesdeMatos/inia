import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { createIndicatorDefinition } from "../../indicators/application/indicator-definition-service.js"
import { closeProofTransaction, createPerson, createTeam, enrollmentEvents, flowEdge, flowNode, insertEnrollment, insertLiveWorkflow, openProofTransaction, ORG, runEnrollmentOnce, type ProofClient } from "./p5-proof-helpers.js"

/**
 * Prova contra o banco de TESTE, com o motor de verdade: numa execução filha de "Aplicar individualmente", a Condição responde pela pessoa
 * da execução, e a execução principal continua respondendo pela estrutura.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run workflow-fan-out-condition-proof --no-file-parallelism
 * Roda numa transação desfeita no fim e não chama modelo.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const SOURCE = "QA_PROOF_FAN_OUT_CONDITION"
const CODE = "PROOF_FAN_OUT_CONDITION"

/** Resultado diário de cada pessoa nos últimos 7 dias: A é a melhor, E a pior; a média da equipe é 75. */
const RESULTS = { A: 90, B: 85, C: 70, D: 60, E: 50, F: 95 } as const
type Name = keyof typeof RESULTS

const dayWindow = (offsetDays: number) => {
  const day = new Date(Date.now() - offsetDays * 86_400_000).toISOString().slice(0, 10)
  const start = new Date(`${day}T00:00:00-03:00`)
  return { start: start.toISOString(), end: new Date(start.getTime() + 86_400_000).toISOString(), day }
}

const WEEK = { kind: "ROLLING_DAYS", days: 7 }
const VALUE_AT_LEAST_80 = { comparator: "GTE", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "MEASUREMENT", indicatorCode: CODE, aggregation: "WEIGHTED_AVERAGE", period: WEEK } }
const PRV_BELOW_80 = { comparator: "LT", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" } } }
const PRV_Q4 = { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } }
const OPERATIONAL_Q4 = { comparator: "EQUALS", thresholdText: "Q4", historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", source: "OPERATIONAL_QUARTILE", indicatorCode: CODE, aggregation: "WEIGHTED_AVERAGE", period: WEEK } }

const graphWith = (config: unknown) => ({
  nodes: [
    flowNode("gatilho", "trigger", "Gatilho", {}),
    flowNode("selecionar", "select_employees", "Selecionar", { selectionMode: "RANKING", ranking: { source: "PRV_ACHIEVEMENT", aggregation: "AVERAGE", period: { kind: "CALENDAR", unit: "MONTH" }, selection: "BEST", count: 6 } }),
    flowNode("aplicar", "apply_individually", "Aplicar", {}),
    flowNode("condicao", "condition", "Condição", config),
    flowNode("consolidar", "consolidate_results", "Consolidar", {}),
    flowNode("fim", "end", "Fim", {}),
  ],
  edges: [
    flowEdge("gatilho", "always", "selecionar"),
    flowEdge("selecionar", "always", "aplicar"),
    flowEdge("aplicar", "always", "condicao"),
    flowEdge("condicao", "true", "consolidar"),
    flowEdge("condicao", "false", "consolidar"),
    flowEdge("condicao", "no_data", "consolidar"),
    flowEdge("consolidar", "always", "fim"),
  ],
})

describe.skipIf(!ENABLED)("Condição na execução filha de um Workflow consolidado", () => {
  let pool: Awaited<ReturnType<typeof openProofTransaction>>["pool"] | undefined
  let client: ProofClient | undefined
  let supervisorId = ""
  let people = {} as Record<Name, string>

  beforeEach(async () => {
    ;({ pool, client } = await openProofTransaction())
    const db = client!
    const teamId = await createTeam(db, "Grupo da prova de Condição")
    supervisorId = await createPerson(db, "Supervisão da prova", { role: "SUPERVISOR" })
    const indicator = await createIndicatorDefinition(db as never, ORG, { code: CODE, name: "Taxa da prova", unit: "PERCENT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "RATE", officialClosureSupported: true } as never)
    const previousMonth = new Date(Date.now())
    previousMonth.setUTCDate(1)
    previousMonth.setUTCMonth(previousMonth.getUTCMonth() - 1)
    people = {} as Record<Name, string>
    for (const name of Object.keys(RESULTS) as Name[]) {
      const personId = await createPerson(db, `Operação ${name}`, { reportsToId: supervisorId })
      people[name] = personId
      await db.query("update people set team_id = $2, hired_at = '2020-01-01' where id = $1", [personId, teamId])
      const result = RESULTS[name]
      await db.query("insert into employee_prv_performance (organization_id, person_id, reference_period, achievement_percent, quartile, source) values ($1, $2, $3, $4, $5, $6)", [ORG, personId, previousMonth.toISOString().slice(0, 7), result, result >= 80 ? "Q1" : result >= 70 ? "Q2" : result >= 60 ? "Q3" : "Q4", SOURCE])
      for (let offset = 0; offset < 7; offset += 1) {
        const window = dayWindow(offset)
        await db.query("insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, source) values ($1, $2, $3, true, $4) on conflict do nothing", [ORG, personId, window.day, SOURCE])
        await db.query("insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator) values ($1, $2, 'PERSON', $3, $4, $5, $6, $7, 'DAILY', $8, 100)", [ORG, indicator.id, personId, result, window.start, window.end, SOURCE, result])
      }
    }
  })

  afterEach(async () => {
    await closeProofTransaction(pool, client)
    pool = undefined
    client = undefined
  })

  async function consolidatedWorkflow(config: unknown) {
    const workflow = await insertLiveWorkflow(client!, "Prova de Condição", graphWith(config))
    await client!.query("update workflows set consolidated_structure = $2 where id = $1", [workflow.workflowId, JSON.stringify({ kind: "SUPERVISOR_TEAM", supervisorId })])
    const collection = { selecionar: { kind: "EMPLOYEE_COLLECTION", memberIds: Object.values(people) } }
    const principal = await insertEnrollment(client!, workflow, { nodeId: "condicao", subjectId: supervisorId, nodeOutputs: collection })
    return { workflow, principal }
  }

  async function branchFor(execution: { workflow: { workflowId: string; versionId: string }; principal: string }, name: Name) {
    const child = (await client!.query<{ id: string }>(
      `insert into workflow_enrollments (organization_id, workflow_id, version_id, current_node_id, status, next_eval_at, scheduled_subject_id, parent_enrollment_id, fan_out_node_id)
       values ($1, $2, $3, 'condicao', 'active', now(), $4, $5, 'aplicar') returning id`,
      [ORG, execution.workflow.workflowId, execution.workflow.versionId, people[name], execution.principal],
    )).rows[0]!.id
    return lastBranch(child)
  }

  async function lastBranch(enrollmentId: string) {
    await runEnrollmentOnce(client!, enrollmentId)
    const events = await enrollmentEvents(client!, enrollmentId)
    return events.find((event) => event.event_type === "condition_evaluated")?.payload.branch
  }

  it("Valor do indicador: cada pessoa pelo próprio resultado, não pela média da equipe", async () => {
    const execution = await consolidatedWorkflow(VALUE_AT_LEAST_80)
    expect(await branchFor(execution, "A")).toBe("true")
    expect(await branchFor(execution, "E")).toBe("false")
  })

  it("na execução principal, o mesmo Valor continua sendo o da estrutura (média 75)", async () => {
    const execution = await consolidatedWorkflow(VALUE_AT_LEAST_80)
    expect(await lastBranch(execution.principal)).toBe("false")
  })

  it("Atingimento do PRV: cada pessoa pelo próprio fechamento", async () => {
    const execution = await consolidatedWorkflow(PRV_BELOW_80)
    expect(await branchFor(execution, "A")).toBe("false")
    expect(await branchFor(execution, "E")).toBe("true")
  })

  it("Quartil do PRV: lê o quartil oficial da pessoa", async () => {
    const execution = await consolidatedWorkflow(PRV_Q4)
    expect(await branchFor(execution, "E")).toBe("true")
    expect(await branchFor(execution, "A")).toBe("false")
  })

  it("Quartil operacional: compara com a coleção da execução principal e deixa de responder sempre Sem dados", async () => {
    const execution = await consolidatedWorkflow(OPERATIONAL_Q4)
    expect(await branchFor(execution, "E")).toBe("true")
    expect(await branchFor(execution, "A")).toBe("false")
  })
})
