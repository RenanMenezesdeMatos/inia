import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { findMeasurements, previewConditionForOperators } from "../../qa-lab/application/test-data-finders.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { resolvePopulationFilterOperatorIds, resolveScopeOperatorIds, resolveStructureAnchorOperatorIds } from "../../workflows/application/hierarchy-subjects.js"
import { postgresHierarchyReader, resolveStructureRecipient } from "../../workflows/application/organizational-recipient.js"
import { runEmployeeRanking } from "../../workflows/application/select-employees-executor.js"
import { validateWorkflowForPublish } from "../../workflows/application/validate-workflow-for-publish.js"
import { createIndicatorDefinition, deleteIndicatorDefinition, updateIndicatorDefinition } from "../application/indicator-definition-service.js"
import { loadIndicatorOperationalDefinition } from "../application/operational-measurement-resolver.js"

/**
 * PROVA ARQUITETURAL (Parte H/I do pedido): um indicador que NÃO existe no código-fonte —
 * criado pelo MESMO contrato do produto (serviço da rota admin) — precisa funcionar
 * imediatamente em Condition, Ranking (VALUE/CHANGE/Quartil operacional), QA Lab, Analytics e
 * publish, sem enum, sem switch, sem alteração de código. Idem pra um Grupo novo.
 *
 * Roda contra o banco de TESTE real (migrations aplicadas) quando `INIA_DB_PROOF=1`:
 *   INIA_DB_PROOF=1 npx vitest run dynamic-indicator-proof
 * Cria seus próprios dados com ids determinísticos `dd00…` e remove tudo ao final.
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
const TZ = "America/Fortaleza"
const SOURCE = "QA_PROOF_DYNAMIC"
const id = (n: number) => `dd000000-0000-4000-8000-${n.toString().padStart(12, "0")}`
const TEAM = id(1)
const SUBTEAM = id(2)
const MANAGER = id(10)
const SUPERVISOR = id(11)
const OPERATORS = [id(21), id(22), id(23), id(24), id(25), id(26)]
const [OP_A, OP_B, OP_C, OP_D, OP_E, OP_F] = OPERATORS as [string, string, string, string, string, string]
const WORKFLOW = id(90)
const NOW = new Date("2026-09-16T15:00:00-03:00")

/** Taxa diária por operador (numerador ÷ denominador × 100): janela atual (últimos 7 dias) e anterior. */
const RATE_CURRENT: Record<string, number> = { [OP_A]: 85, [OP_B]: 70, [OP_C]: 60, [OP_D]: 90, [OP_E]: 50, [OP_F]: 95 }
const RATE_PREVIOUS: Record<string, number> = { [OP_A]: 75, [OP_B]: 80, [OP_C]: 60, [OP_D]: 85, [OP_E]: 55, [OP_F]: 90 }
/** Backlog (snapshot) do operador A nos 3 últimos dias — o valor da semana é o ÚLTIMO, nunca a soma. */
const LATEST_SERIES = [40, 38, 35]

let pool: pg.Pool
let db: Database
let rateId = ""
let latestId = ""

function dayWindow(offsetDays: number): { start: string; end: string } {
  const start = new Date(NOW)
  start.setUTCDate(start.getUTCDate() - offsetDays)
  const local = new Date(`${start.toISOString().slice(0, 10)}T00:00:00-03:00`)
  const end = new Date(local.getTime() + 24 * 60 * 60 * 1000)
  return { start: local.toISOString(), end: end.toISOString() }
}

async function insertMeasurement(indicatorId: string, subjectId: string, window: { start: string; end: string }, components: { value: number; numerator?: number; denominator?: number }) {
  await db.query(
    `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator)
     values ($1, $2, 'PERSON', $3, $4, $5, $6, $7, 'DAILY', $8, $9)`,
    [ORG, indicatorId, subjectId, components.value, window.start, window.end, SOURCE, components.numerator ?? null, components.denominator ?? null],
  )
}

async function cleanup() {
  await db.query(`delete from indicator_measurements where source = $1`, [SOURCE])
  await db.query(`delete from employee_schedule_days where source = $1`, [SOURCE])
  await db.query(`delete from workflows where id = $1`, [WORKFLOW])
  for (const code of ["TEST_DYNAMIC_RATE", "TEST_DYNAMIC_LATEST"]) {
    const row = await db.query<{ id: string }>(`select id from indicator_definitions where code = $1 and organization_id = $2`, [code, ORG])
    if (row.rows[0]) await deleteIndicatorDefinition(db, ORG, row.rows[0].id)
  }
  await db.query(`delete from people where id = any($1::uuid[])`, [[...OPERATORS, SUPERVISOR, MANAGER]])
  await db.query(`delete from subteams where id = $1`, [SUBTEAM])
  await db.query(`delete from teams where id = $1`, [TEAM])
}

describe.skipIf(!ENABLED)("prova arquitetural — indicador e Grupo que o código desconhece", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL })
    db = pool
    await cleanup()

    // ---- Grupo Dinâmico QA (Parte I): Grupo + Subgrupo + Gerente → Supervisor → 6 operadores ----
    const operation = await db.query<{ id: string }>(`select id from operations where organization_id = $1 order by created_at limit 1`, [ORG])
    await db.query(`insert into teams (id, organization_id, operation_id, name) values ($1, $2, $3, 'Grupo Dinâmico QA')`, [TEAM, ORG, operation.rows[0]!.id])
    await db.query(`insert into subteams (id, organization_id, team_id, name) values ($1, $2, $3, 'Célula Dinâmica QA')`, [SUBTEAM, ORG, TEAM])
    await db.query(`insert into people (id, organization_id, team_id, name, role, hired_at) values ($1, $2, $3, 'Gerente Dinâmico QA', 'MANAGER', '2020-01-01')`, [MANAGER, ORG, TEAM])
    await db.query(`insert into people (id, organization_id, team_id, name, role, reports_to_id, hired_at) values ($1, $2, $3, 'Supervisor Dinâmico QA', 'SUPERVISOR', $4, '2020-01-01')`, [SUPERVISOR, ORG, TEAM, MANAGER])
    for (const [index, operatorId] of OPERATORS.entries()) {
      await db.query(`insert into people (id, organization_id, team_id, subteam_id, name, role, reports_to_id, hired_at) values ($1, $2, $3, $4, $5, 'OPERATOR', $6, '2020-01-01')`, [
        operatorId,
        ORG,
        TEAM,
        index < 3 ? SUBTEAM : null,
        `Operador Dinâmico ${String.fromCharCode(65 + index)}`,
        SUPERVISOR,
      ])
    }

    // ---- Indicadores criados pelo MESMO contrato do produto (serviço da rota admin) ----
    const rate = await createIndicatorDefinition(db, ORG, { code: "TEST_DYNAMIC_RATE", name: "Taxa Dinâmica de Teste", unit: "PERCENT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "RATE", officialClosureSupported: false })
    const latest = await createIndicatorDefinition(db, ORG, { code: "TEST_DYNAMIC_LATEST", name: "Fila Dinâmica de Teste", unit: "COUNT", desiredDirection: "LOWER", dailySupported: true, operationalAggregation: "LATEST", officialClosureSupported: false })
    rateId = rate.id
    latestId = latest.id

    // ---- Escala explícita (todos os 14 dias programados, inclusive fim de semana): a medição só conta em data ELEGÍVEL,
    // e sem escala o fallback seg–sex deixaria sábado/domingo de fora. Mesmo contrato de employee_schedule_days da Central. ----
    for (const operatorId of OPERATORS) {
      for (let offset = 0; offset < 14; offset += 1) {
        await db.query(`insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, source) values ($1, $2, ($3::timestamptz at time zone $4)::date, true, $5) on conflict (person_id, schedule_date) do nothing`, [ORG, operatorId, dayWindow(offset).start, TZ, SOURCE])
      }
    }

    // ---- Medições GENÉRICAS (mesmo contrato de indicator_measurements da ingestão) ----
    for (const operatorId of OPERATORS) {
      for (let offset = 0; offset < 7; offset += 1) await insertMeasurement(rateId, operatorId, dayWindow(offset), { value: RATE_CURRENT[operatorId]!, numerator: RATE_CURRENT[operatorId]!, denominator: 100 })
      for (let offset = 7; offset < 14; offset += 1) await insertMeasurement(rateId, operatorId, dayWindow(offset), { value: RATE_PREVIOUS[operatorId]!, numerator: RATE_PREVIOUS[operatorId]!, denominator: 100 })
    }
    for (const [index, value] of LATEST_SERIES.entries()) await insertMeasurement(latestId, OP_A, dayWindow(2 - index), { value })

    // ---- Workflow (rascunho) só pra prévia do QA Lab e validação de publicação ----
    await db.query(
      `insert into workflows (id, organization_id, name, scope_type, team_id, trigger_config, draft_graph)
       values ($1, $2, 'Prova dinâmica QA', 'TEAM', $3, $4, $5)`,
      [WORKFLOW, ORG, TEAM, JSON.stringify({ kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["08:00"], frequency: { type: "DAILY" } }), JSON.stringify(proofGraph("TEST_DYNAMIC_RATE", "WEIGHTED_AVERAGE"))],
    )
  })

  afterAll(async () => {
    if (!db) return
    await cleanup()
    await pool.end()
  })

  it("o código-fonte (fora de testes) NÃO conhece TEST_DYNAMIC_RATE, TEST_DYNAMIC_LATEST nem 'Grupo Dinâmico QA'", () => {
    expect(grepSource(join(process.cwd(), "src"), [/TEST_DYNAMIC_RATE|TEST_DYNAMIC_LATEST|Grupo Dinâmico QA/])).toEqual([])
  })

  it("o catálogo descreve o indicador novo pela metadata (unidade, direção, estratégia, capacidades)", async () => {
    const definition = await loadIndicatorOperationalDefinition(db, "TEST_DYNAMIC_RATE")
    expect(definition).toMatchObject({ code: "TEST_DYNAMIC_RATE", unit: "PERCENT", direction: "HIGHER", kind: "RATE", dailySupported: true })
    const analytics = await new PgAnalyticsReadRepository(db).loadIndicatorDefinitions(ORG)
    expect(analytics.find((row) => row.code === "TEST_DYNAMIC_RATE")).toMatchObject({ name: "Taxa Dinâmica de Teste", unit: "PERCENT", direction: "HIGHER", capabilities: { operationalEnabled: true, operationalAggregation: "RATE", officialClosureSupported: false } })
    expect(analytics.find((row) => row.code === "TEST_DYNAMIC_LATEST")).toMatchObject({ unit: "COUNT", direction: "LOWER", capabilities: { operationalAggregation: "LATEST" } })
  })

  it("Condition (RATE): Σ 595 ocorrências ÷ Σ 700 elegíveis × 100 = 85 — evidência de numerador/denominador no trace", async () => {
    const result = await evaluateDataCondition(db, conditionConfig("TEST_DYNAMIC_RATE", "WEIGHTED_AVERAGE", "GTE", 80), { operatorId: OP_A, subjectIds: [OP_A] }, NOW, { timeZone: TZ })
    expect(result).toMatchObject({ branch: "true", matched: true })
    expect(result!.evaluation.value).toBe(85)
    expect(result!.evaluation.evidence).toMatchObject({ aggregation: "WEIGHTED_AVERAGE", numerator: 595, denominator: 700, daysWithData: 7 })
    expect(String((result!.evaluation.evidence as { method: string }).method)).toMatch(/595 ocorrências ÷ Σ 700 elegíveis × 100/)
    const below = await evaluateDataCondition(db, conditionConfig("TEST_DYNAMIC_RATE", "WEIGHTED_AVERAGE", "GTE", 80), { operatorId: OP_E, subjectIds: [OP_E] }, NOW, { timeZone: TZ })
    expect(below).toMatchObject({ branch: "false" })
  })

  it("Condition (LATEST): o valor da janela é o ÚLTIMO snapshot (35), nunca a soma — trace por estratégia", async () => {
    const result = await evaluateDataCondition(db, conditionConfig("TEST_DYNAMIC_LATEST", "LATEST", "LTE", 36), { operatorId: OP_A, subjectIds: [OP_A] }, NOW, { timeZone: TZ })
    expect(result).toMatchObject({ branch: "true" })
    expect(result!.evaluation.value).toBe(35)
    expect(result!.evaluation.evidence).toMatchObject({ aggregation: "LATEST", method: "último valor da janela (snapshot)", daysWithData: 3 })
  })

  it("Ranking VALUE: 2 piores em TEST_DYNAMIC_RATE (direção HIGHER do catálogo) = E (50) e C (60)", async () => {
    const result = await runEmployeeRanking(db, ORG, rankingConfig({ selection: "WORST", count: 2, rankingBasis: "VALUE" }), OPERATORS, NOW, { timeZone: TZ })
    expect(result.direction).toBe("HIGHER")
    expect(result.memberIds).toEqual([OP_E, OP_C])
    expect(result.partitions[0]!.members.map((member) => [member.employeeId, (member as { value: number }).value])).toEqual([
      [OP_E, 50],
      [OP_C, 60],
    ])
  })

  it("Ranking CHANGE: maior queda vs. 7 dias anteriores = B (80 → 70, −12,5%)", async () => {
    const result = await runEmployeeRanking(db, ORG, rankingConfig({ selection: "DECLINED", count: 1, rankingBasis: "CHANGE" }), OPERATORS, NOW, { timeZone: TZ })
    expect(result.memberIds).toEqual([OP_B])
    const member = result.partitions[0]!.members[0] as { previousValue: number; currentValue: number; change: number }
    expect(member).toMatchObject({ previousValue: 80, currentValue: 70, change: -12.5 })
  })

  it("Quartil operacional: Q4 da população de 6 = os 25% piores (E e C); partição por Subgrupo do Grupo novo funciona sem lista", async () => {
    const q4 = await runEmployeeRanking(db, ORG, rankingConfig({ selection: "OPERATIONAL_QUARTILE", operationalQuartile: "Q4", count: 1, rankingBasis: "VALUE" }), OPERATORS, NOW, { timeZone: TZ })
    expect(q4.partitions[0]!.calculation?.quartileReason).toBe("OK")
    expect(new Set(q4.memberIds)).toEqual(new Set([OP_E, OP_C]))
    const partitioned = await runEmployeeRanking(db, ORG, rankingConfig({ selection: "WORST", count: 1, rankingBasis: "VALUE", partitionBy: "SUBTEAM" }), OPERATORS, NOW, { timeZone: TZ })
    expect(partitioned.partitions.map((partition) => [partition.name, partition.members[0]?.employeeId])).toEqual(
      expect.arrayContaining([
        ["Célula Dinâmica QA", OP_C],
        ["Sem subgrupo", OP_E],
      ]),
    )
  })

  it("QA Lab: prévia da Condition e busca de medições funcionam com o indicador novo", async () => {
    const preview = await previewConditionForOperators(db, ORG, { workflowId: WORKFLOW, nodeId: "cond", simulatedNow: NOW.toISOString() })
    expect(preview.rows).toHaveLength(6)
    const byId = new Map(preview.rows.map((row) => [row.subjectId, row]))
    expect(byId.get(OP_A)).toMatchObject({ branch: "true" })
    expect(byId.get(OP_E)).toMatchObject({ branch: "false" })
    expect(String(byId.get(OP_A)!.summary)).toMatch(/85/)
    const measurements = await findMeasurements(db, ORG, { indicatorCode: "TEST_DYNAMIC_RATE", limit: 5 } as Parameters<typeof findMeasurements>[2])
    expect(measurements.length).toBeGreaterThan(0)
    expect(measurements[0]).toMatchObject({ unit: "PERCENT" })
  })

  it("Publish: janela de 7 dias passa com o indicador operacional; agregação incompatível com LATEST e indicador desativado são rejeitados", async () => {
    const hierarchy = postgresHierarchyReader(db)
    const row = (graph: unknown) => ({ scopeType: "TEAM", teamId: TEAM, subteamId: null, draftGraph: graph, triggerConfig: { kind: "schedule" as const, mode: "CALENDAR" as const, intervalDays: 1, times: ["08:00"], frequency: { type: "DAILY" as const } }, consolidatedStructure: null })
    await expect(validateWorkflowForPublish(db, ORG, WORKFLOW, row(proofGraph("TEST_DYNAMIC_RATE", "WEIGHTED_AVERAGE")), { hierarchy })).resolves.toBeDefined()
    await expect(validateWorkflowForPublish(db, ORG, WORKFLOW, row(proofGraph("TEST_DYNAMIC_LATEST", "LATEST")), { hierarchy })).resolves.toBeDefined()
    await expect(validateWorkflowForPublish(db, ORG, WORKFLOW, row(proofGraph("TEST_DYNAMIC_LATEST", "WEIGHTED_AVERAGE")), { hierarchy })).rejects.toMatchObject({ code: "WORKFLOW_INVALID_CONDITION" })
    await updateIndicatorDefinition(db, ORG, latestId, { active: false })
    await expect(validateWorkflowForPublish(db, ORG, WORKFLOW, row(proofGraph("TEST_DYNAMIC_LATEST", "LATEST")), { hierarchy })).rejects.toMatchObject({ code: "WORKFLOW_INDICATOR_INACTIVE" })
    await updateIndicatorDefinition(db, ORG, latestId, { active: true })
  })

  it("proteção semântica com histórico real: unidade/estratégia bloqueadas, nome livre; exclusão orienta a desativar", async () => {
    await expect(updateIndicatorDefinition(db, ORG, rateId, { operationalAggregation: "LATEST" })).rejects.toMatchObject({ code: "INDICATOR_SEMANTIC_LOCKED" })
    await expect(updateIndicatorDefinition(db, ORG, rateId, { operationalAggregation: "LATEST" })).rejects.toThrow(/84 medições; 1 Workflow\(s\): Prova dinâmica QA/)
    const renamed = await updateIndicatorDefinition(db, ORG, rateId, { name: "Taxa Dinâmica de Teste (renomeada)", minimumSampleSize: 3 })
    expect(renamed.definition).toMatchObject({ name: "Taxa Dinâmica de Teste (renomeada)", minimumSampleSize: 3, operationalAggregation: "RATE" })
    await expect(deleteIndicatorDefinition(db, ORG, rateId)).rejects.toMatchObject({ code: "INDICATOR_HAS_DEPENDENTS" })
  })

  it("Grupo novo: Abrangência, Filtro populacional (Subgrupo/Supervisor) e destinatário pela estrutura resolvem sem alteração de engine", async () => {
    const scope = { scopeType: "TEAM", teamId: TEAM, subteamId: null }
    expect(new Set(await resolveScopeOperatorIds(db, ORG, scope))).toEqual(new Set(OPERATORS))
    expect(new Set(await resolvePopulationFilterOperatorIds(db, ORG, { kind: "SUBTEAM", subteamId: SUBTEAM }, scope))).toEqual(new Set([OP_A, OP_B, OP_C]))
    expect(new Set(await resolveStructureAnchorOperatorIds(db, { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR }, SUPERVISOR))).toEqual(new Set(OPERATORS))
    expect(new Set(await resolveStructureAnchorOperatorIds(db, { kind: "TEAM", teamId: TEAM }, null))).toEqual(new Set(OPERATORS))
    const recipient = await resolveStructureRecipient(postgresHierarchyReader(db), { kind: "TEAM", teamId: TEAM }, "MANAGER")
    expect(recipient).toMatchObject({ status: "RESOLVED", person: { id: MANAGER, name: "Gerente Dinâmico QA" } })
    const supervisor = await resolveStructureRecipient(postgresHierarchyReader(db), { kind: "SUBTEAM", subteamId: SUBTEAM }, "SUPERVISOR")
    expect(supervisor).toMatchObject({ status: "RESOLVED", person: { id: SUPERVISOR } })
  })
})

function conditionConfig(indicatorCode: string, aggregation: "WEIGHTED_AVERAGE" | "LATEST", comparator: "GTE" | "LTE", threshold: number) {
  return { comparator, thresholdNumeric: threshold, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode, aggregation, source: "MEASUREMENT" as const, period: { kind: "ROLLING_DAYS" as const, days: 7 } } }
}

function rankingConfig(overrides: Record<string, unknown>) {
  return { indicatorCode: "TEST_DYNAMIC_RATE", aggregation: "WEIGHTED_AVERAGE", source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 7 }, ...overrides } as Parameters<typeof runEmployeeRanking>[2]
}

function proofGraph(indicatorCode: string, aggregation: "WEIGHTED_AVERAGE" | "LATEST") {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "cond", type: "condition", label: "Acima de 80", position: { x: 0, y: 1 }, config: conditionConfig(indicatorCode, aggregation, "GTE", 80) },
      { id: "end-t", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
      { id: "end-f", type: "end", label: "Fim", position: { x: 1, y: 2 }, config: {} },
      { id: "end-n", type: "end", label: "Fim", position: { x: 2, y: 2 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "cond" },
      { id: "e2", source: "cond", sourceHandle: "true", target: "end-t" },
      { id: "e3", source: "cond", sourceHandle: "false", target: "end-f" },
      { id: "e4", source: "cond", sourceHandle: "no_data", target: "end-n" },
    ],
  }
}

function grepSource(dir: string, patterns: RegExp[]): string[] {
  const hits: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) hits.push(...grepSource(path, patterns))
    else if (/\.(ts|sql|json)$/.test(entry) && !/\.test\.ts$/.test(entry) && patterns.some((pattern) => pattern.test(readFileSync(path, "utf8")))) hits.push(path)
  }
  return hits
}
