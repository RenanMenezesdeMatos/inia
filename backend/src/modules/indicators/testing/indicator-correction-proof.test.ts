import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { fixedClock } from "../../../shared/domain/clock.js"
import { createDataHubContext } from "../../data-hub/application/data-hub-context.js"
import { previewMapping } from "../../data-hub/application/feed-service.js"
import { PgAnalyticsReadRepository } from "../../performance-analytics/application/analytics-read-repository.js"
import { runAnalyticsRollup } from "../../performance-analytics/application/analytics-rollup.js"
import { buildStructureOperationalSummary } from "../../performance-analytics/application/operational-trend.js"
import { loadAnalyticsVersion } from "../../performance-analytics/infrastructure/analytics-versions.js"
import { readStructureWindows } from "../../performance-analytics/infrastructure/operational-read-model.js"
import { evaluateDataCondition } from "../../workflows/application/condition-evaluator.js"
import { assertNodeMatchesIndicatorCatalog, assertPublishedWorkflowMatchesIndicatorCatalog } from "../../workflows/application/indicator-graph-guard.js"
import { resolvePreviousTimeWindow, resolveTimeWindow } from "../../workflows/application/time-window.js"
import { applyIndicatorCorrection, impactForViewer, previewIndicatorCorrection } from "../application/indicator-correction-service.js"
import { createIndicatorDefinition, findIndicatorDefinition, updateIndicatorDefinition } from "../application/indicator-definition-service.js"

/**
 * PROVA no banco de TESTE real: correção controlada de um indicador que já tem histórico. A regra é por ESTRATÉGIA: os códigos
 * `TEST_CORRECAO_*` são dados criados aqui pelo contrato do produto, e um caso garante que o código-fonte não os conhece.
 *  - Soma corrigida para Média ponderada: o valor do período muda como esperado em todas as leituras (cache, read model antes e
 *    depois do `analytics-rollup`, caminho original), sem tocar em medição, meta ou fechamento, com a auditoria gravada;
 *  - a carga recusa numerador e denominador em Soma na validação e passa a aceitar depois da correção;
 *  - os casos bloqueados são recusados, e Workflow publicado nunca quebra em silêncio.
 * Organização própria, gravada de verdade (são várias conexões), apagada no fim.
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run indicator-correction-proof --no-file-parallelism
 */
const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "7d000000-0000-4000-8000-000000000001"
const id = (n: number) => `7d000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const OPERATION = id(2)
const TEAM = id(3)
const MANAGER = id(10)
const OPERATORS = [id(21), id(22), id(23)] as const
const [OP_A, OP_B, OP_C] = OPERATORS
const WF_ACTIVE = id(40)
const WF_DRAFT = id(41)
const WF_DIRECTION = id(42)
const SOURCE = "QA_PROOF_CORRECTION"
const TZ = "America/Fortaleza"
const NOW = new Date("2026-09-16T15:00:00-03:00")
const COMPARISON = "ROLLING_7_DAYS" as const
const CODES = { time: "TEST_CORRECAO_TEMPO", noComponents: "TEST_CORRECAO_SEM_COMPONENTES", incoherent: "TEST_CORRECAO_INCOERENTE", range: "TEST_CORRECAO_FORA_FAIXA", workflow: "TEST_CORRECAO_WORKFLOW", direction: "TEST_CORRECAO_DIRECAO", zero: "TEST_CORRECAO_ZERO", load: "TEST_CORRECAO_CARGA" }
const SCOPES = { unrestricted: true } as const
const ACTOR = { personId: MANAGER, accountId: id(11) }
const REASON = "Cadastrado com a estratégia errada na implantação."

let pool: pg.Pool
let db: Database

/** Cinco dias, três pessoas: valor = numerador ÷ denominador. Soma do período 6.750; média simples 450; média ponderada 500. */
const DAILY = [
  { person: OP_A, value: 450, numerator: 9000, denominator: 20 },
  { person: OP_B, value: 300, numerator: 3000, denominator: 10 },
  { person: OP_C, value: 600, numerator: 18000, denominator: 30 },
]
const DAYS = [1, 2, 3, 4, 5]

function dayWindow(offsetDays: number): { start: string; end: string } {
  const local = new Date(`${new Date(NOW.getTime() - offsetDays * 86_400_000).toISOString().slice(0, 10)}T00:00:00-03:00`)
  return { start: local.toISOString(), end: new Date(local.getTime() + 86_400_000).toISOString() }
}

const insertMeasurement = (indicatorId: string, person: string, offset: number, row: { value: number; numerator?: number | null; denominator?: number | null }) =>
  db.query(
    `insert into indicator_measurements (organization_id, indicator_definition_id, subject_type, subject_id, value, period_start, period_end, source, granularity, numerator, denominator)
     values ($1, $2, 'PERSON', $3, $4, $5, $6, $7, 'DAILY', $8, $9)`,
    [ORG, indicatorId, person, row.value, dayWindow(offset).start, dayWindow(offset).end, SOURCE, row.numerator ?? null, row.denominator ?? null],
  )

const define = (code: string, overrides: Record<string, unknown> = {}) =>
  createIndicatorDefinition(db, ORG, { code, name: `Prova ${code}`, unit: "COUNT", desiredDirection: "HIGHER", dailySupported: true, operationalAggregation: "SUM", officialClosureSupported: true, ...overrides })

/** Tudo o que a correção NÃO pode alterar, em texto, para comparar antes e depois. */
async function historySnapshot(indicatorId: string) {
  const measurements = await db.query(`select subject_id, value, numerator, denominator, sample_count, period_start, period_end, source, granularity, created_at from indicator_measurements where indicator_definition_id = $1 order by subject_id, period_start`, [indicatorId])
  const goals = await db.query(`select subject_id, target_value, valid_from, valid_until from goals where indicator_definition_id = $1 order by subject_id`, [indicatorId])
  const closures = await db.query(`select person_id, reference_period, value, target_value, achievement_percent, weight_percent, quartile, numerator, denominator, source from employee_indicator_performance where indicator_definition_id = $1 order by person_id`, [indicatorId])
  return JSON.stringify({ measurements: measurements.rows, goals: goals.rows, closures: closures.rows })
}

const summaryOf = async (source: "read-model" | "raw") => {
  const observed: { source?: string; liveMembers?: number } = {}
  const summary = await buildStructureOperationalSummary(db, { organizationId: ORG, personIds: [...OPERATORS], now: NOW, timeZone: TZ, comparison: COMPARISON }, { source, observe: (value) => Object.assign(observed, value) })
  return { indicator: summary?.indicators.find((row) => row.code === CODES.time), observed }
}

const auditRows = (indicatorId: string) => db.query<{ actor_id: string; payload: Record<string, unknown> }>(`select actor_id, payload from audit_logs where organization_id = $1 and action = 'INDICATOR_DEFINITION_CORRECTED' and entity_id = $2`, [ORG, indicatorId])

function conditionNode(nodeId: string, indicatorCode: string, aggregation: string) {
  return { id: nodeId, type: "condition", label: "Acima do limite", position: { x: 0, y: 0 }, config: { comparator: "GTE", thresholdNumeric: 80, historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode, aggregation, source: "MEASUREMENT", period: { kind: "ROLLING_DAYS", days: 7 } } } }
}

async function insertWorkflow(workflowId: string, name: string, draftNode: unknown, publishedNode: unknown | null, active: boolean) {
  await db.query(`insert into workflows (id, organization_id, name, scope_type, team_id, trigger_config, draft_graph, active) values ($1, $2, $3, 'TEAM', $4, $5, $6, $7)`, [workflowId, ORG, name, TEAM, JSON.stringify({ kind: "schedule", mode: "CALENDAR", intervalDays: 1, times: ["08:00"], frequency: { type: "DAILY" } }), JSON.stringify({ nodes: [draftNode], edges: [] }), active])
  if (!publishedNode) return
  const version = await db.query<{ id: string }>(`insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id`, [workflowId, JSON.stringify({ nodes: [publishedNode], edges: [] })])
  await db.query(`update workflows set active_version_id = $1 where id = $2`, [version.rows[0]!.id, workflowId])
}

async function cleanup() {
  await pool.query(`delete from workflows where organization_id = $1`, [ORG])
  await pool.query(`delete from audit_logs where organization_id = $1`, [ORG])
  await pool.query(`delete from analytics_member_window_indicator where organization_id = $1`, [ORG])
  await pool.query(`delete from analytics_member_window where organization_id = $1`, [ORG])
  await pool.query(`delete from goals where organization_id = $1`, [ORG])
  await pool.query(`delete from employee_indicator_performance where organization_id = $1`, [ORG])
  await pool.query(`delete from indicator_measurements where organization_id = $1`, [ORG])
  await pool.query(`delete from employee_schedule_days where organization_id = $1`, [ORG])
  await pool.query(`delete from indicator_definitions where organization_id = $1`, [ORG])
  await pool.query(`delete from people where organization_id = $1`, [ORG])
  await pool.query(`delete from teams where organization_id = $1`, [ORG])
  await pool.query(`delete from analytics_operational_dirty where organization_id = $1`, [ORG])
  await pool.query(`delete from operations where organization_id = $1`, [ORG])
  await pool.query(`delete from organizations where id = $1`, [ORG])
}

function grepSource(dir: string, pattern: RegExp): string[] {
  const hits: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) hits.push(...grepSource(path, pattern))
    else if (/\.(ts|sql|json)$/.test(entry) && !/\.test\.ts$/.test(entry) && pattern.test(readFileSync(path, "utf8"))) hits.push(path)
  }
  return hits
}

describe.skipIf(!ENABLED)("correção controlada de indicador com histórico — prova Postgres", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 6 })
    db = pool
    await cleanup()
    await pool.query(`insert into organizations (id, name, slug) values ($1, 'Prova correção de indicador', 'prova-correcao-indicador')`, [ORG])
    await pool.query(`insert into operations (id, organization_id, name, timezone) values ($1, $2, 'Operação da prova', $3)`, [OPERATION, ORG, TZ])
    await pool.query(`insert into teams (id, organization_id, operation_id, name) values ($1, $2, $3, 'Grupo da prova')`, [TEAM, ORG, OPERATION])
    await pool.query(`insert into people (id, organization_id, team_id, name, role, hired_at) values ($1, $2, $3, 'Gestor da prova', 'SUPERVISOR', '2020-01-01')`, [MANAGER, ORG, TEAM])
    for (const [index, person] of OPERATORS.entries()) {
      await pool.query(`insert into people (id, organization_id, team_id, name, role, reports_to_id, hired_at, matricula) values ($1, $2, $3, $4, 'OPERATOR', $5, '2020-01-01', $6)`, [person, ORG, TEAM, `Operador ${index}`, MANAGER, `PC-${index}`])
      for (let offset = 0; offset < 21; offset += 1) {
        await pool.query(`insert into employee_schedule_days (organization_id, person_id, schedule_date, scheduled_to_work, source) values ($1, $2, ($3::timestamptz at time zone $4)::date, true, $5)`, [ORG, person, dayWindow(offset).start, TZ, SOURCE])
      }
    }
  }, 60_000)

  afterAll(async () => {
    if (!pool) return
    await cleanup()
    await pool.end()
  })

  it("o código-fonte não conhece os indicadores desta prova: a regra é por estratégia", () => {
    expect(grepSource(join(process.cwd(), "src"), /TEST_CORRECAO_/)).toEqual([])
  })

  it("Soma com medições → Média ponderada: prévia sem efeito, período muda de 6.750 para 500 em todas as leituras, histórico intacto, auditoria gravada", async () => {
    const definition = await define(CODES.time)
    for (const offset of DAYS) for (const row of DAILY) await insertMeasurement(definition.id, row.person, offset, row)
    await db.query(`insert into goals (organization_id, indicator_definition_id, subject_type, subject_id, target_value, valid_from) values ($1, $2, 'TEAM', $3, 300, '2026-01-01')`, [ORG, definition.id, TEAM])
    await db.query(`insert into employee_indicator_performance (organization_id, person_id, indicator_definition_id, reference_period, value, target_value, achievement_percent, source) values ($1, $2, $3, '2026-08', 6750, 300, 90, $4)`, [ORG, OP_A, definition.id, SOURCE])

    // Read model em dia: é por ele que a tela da liderança lê.
    await runAnalyticsRollup(db, { organizationId: ORG, clock: fixedClock(NOW), forceFull: true })
    const repository = new PgAnalyticsReadRepository(db)
    const fromCache = () => repository.loadStructureOperationalSummary(ORG, [...OPERATORS], NOW, COMPARISON).then((summary) => summary?.indicators.find((row) => row.code === CODES.time))
    const before = await summaryOf("read-model")
    expect(before.observed).toMatchObject({ source: "read-model", liveMembers: 0 })
    expect(before.indicator).toMatchObject({ aggregation: "SUM", currentValue: 6750, unit: "COUNT", direction: "HIGHER" })
    expect(await fromCache()).toMatchObject({ currentValue: 6750 })

    const snapshot = await historySnapshot(definition.id)
    const officialBefore = await loadAnalyticsVersion(db, ORG, "OFFICIAL")
    const fields = { unit: "SECONDS", desiredDirection: "LOWER", operationalAggregation: "WEIGHTED_AVERAGE" }

    const impact = await previewIndicatorCorrection(db, ORG, definition.id, fields)
    expect(impact).toMatchObject({
      canApply: true,
      blockers: [],
      history: { measurements: 15, goals: 1, officialClosures: 1, workflows: 0 },
      measurements: { missingComponents: 0, incoherentValues: 0, outOfUnitRange: 0, unusedComponents: 0 },
      calculation: { before: { label: "Soma do período" }, after: { label: "Tempo consolidado dos atendimentos" } },
    })
    expect(impact.changes.map((change) => [change.field, change.to])).toEqual([["unit", "Segundos (tempo)"], ["desiredDirection", "Menor é melhor"], ["operationalAggregation", "Média ponderada"]])
    // A prévia só lê: nada mudou, nenhuma marca nova, o read model segue valendo.
    expect(await findIndicatorDefinition(db, ORG, definition.id)).toMatchObject({ operationalAggregation: "SUM", unit: "COUNT" })
    expect(await readStructureWindows(db, { organizationId: ORG, personIds: [...OPERATORS], comparison: COMPARISON, window: resolveTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, TZ), previousWindow: resolvePreviousTimeWindow({ kind: "ROLLING_DAYS", days: 7 }, NOW, TZ), now: NOW, timeZone: TZ, indicatorCodes: [CODES.time] })).not.toBeNull()

    const { definition: corrected } = await applyIndicatorCorrection(db, ORG, definition.id, { ...fields, reason: REASON, confirmation: CODES.time.toLowerCase() }, ACTOR, SCOPES)
    expect(corrected).toMatchObject({ unit: "SECONDS", desiredDirection: "LOWER", operationalAggregation: "WEIGHTED_AVERAGE", code: CODES.time })

    // Efeito imediato, sem esperar a tarefa: o cache de 60 s não serve o número velho, porque a chave leva a marca da organização.
    expect(await fromCache()).toMatchObject({ currentValue: 500, aggregation: "WEIGHTED_AVERAGE", unit: "SECONDS", direction: "LOWER" })
    expect((await summaryOf("read-model")).observed).toMatchObject({ source: "raw" })
    // Camada oficial: a versão subiu, então o cache de 10 min não serve o derivado velho.
    expect(await loadAnalyticsVersion(db, ORG, "OFFICIAL")).not.toBe(officialBefore)
    // Depois da tarefa `analytics-rollup`: de volta ao read model, com o mesmo número do caminho original.
    await runAnalyticsRollup(db, { organizationId: ORG, clock: fixedClock(NOW) })
    const rebuilt = await summaryOf("read-model")
    expect(rebuilt.observed).toMatchObject({ source: "read-model", liveMembers: 0 })
    expect(rebuilt.indicator).toMatchObject({ currentValue: 500 })
    expect((await summaryOf("raw")).indicator).toEqual(rebuilt.indicator)
    // Direção nova vale nas comparações; o Workflow lê o mesmo número (Σ 150.000 ÷ Σ 300).
    const condition = await evaluateDataCondition(db, conditionNode("c", CODES.time, "WEIGHTED_AVERAGE").config as never, { operatorId: OP_A, subjectIds: [...OPERATORS] }, NOW, { organizationId: ORG, timeZone: TZ })
    expect(condition!.evaluation.value).toBe(500)

    // Nenhuma medição, meta ou fechamento mudou.
    expect(await historySnapshot(definition.id)).toBe(snapshot)

    const audit = await auditRows(definition.id)
    expect(audit.rows).toHaveLength(1)
    expect(audit.rows[0]!.actor_id).toBe(MANAGER)
    expect(audit.rows[0]!.payload).toMatchObject({
      reason: REASON,
      actorAccountId: ACTOR.accountId,
      before: { unit: "COUNT", desiredDirection: "HIGHER", operationalAggregation: "SUM" },
      after: { unit: "SECONDS", desiredDirection: "LOWER", operationalAggregation: "WEIGHTED_AVERAGE" },
      impact: { history: { measurements: 15, goals: 1, officialClosures: 1 } },
    })
  }, 60_000)

  it("carga: linha com numerador e denominador em Soma aparece recusada na validação, com a mensagem do fechamento; aceita depois da correção", async () => {
    const definition = await define(CODES.load)
    const ctx = createDataHubContext(db)
    const mapping = { fields: ["externalEmployeeId", "indicatorCode", "date", "value", "numerator", "denominator"].map((key) => ({ target: key, source: key, transforms: [] })) }
    const preview = () =>
      previewMapping(ctx, ORG, {
        source: { id: id(50), organizationId: ORG, sourceKey: "prova" } as never,
        feed: null,
        contractKey: "INDICATOR_MEASUREMENTS",
        mapping,
        sample: { columns: mapping.fields.map((field) => field.source), records: [{ externalEmployeeId: "PC-0", indicatorCode: CODES.load, date: "2026-09-15", value: "450", numerator: "8100", denominator: "18" }, { externalEmployeeId: "PC-1", indicatorCode: CODES.load, date: "2026-09-15", value: "450" }] },
      })
    const refused = await preview()
    expect(refused.rejected).toBe(1)
    expect(refused.rows[0]!.errors).toEqual([{ code: "DATA_CONTRACT_VIOLATION", field: "numerator", message: `A estratégia "Soma" do indicador "${CODES.load}" não define o valor por numerador e denominador. Envie a linha sem os componentes ou revise a estratégia no catálogo — nada foi gravado.` }])
    expect(refused.rows[1]!.valid).toBe(true)
    await applyIndicatorCorrection(db, ORG, definition.id, { unit: "SECONDS", operationalAggregation: "WEIGHTED_AVERAGE", reason: REASON, confirmation: CODES.load }, ACTOR, SCOPES)
    const accepted = await preview()
    expect(accepted.rows[0]!.valid).toBe(true)
    // A linha sem componentes agora é a recusada, pela regra de sempre da estratégia nova.
    expect(accepted.rows[1]!.errors.map((error) => [error.code, error.field])).toEqual([["DATA_COMPONENT_MISSING", "numerator"]])
  })

  it("bloqueia medições sem os componentes exigidos: recusa, nada muda, sem auditoria, e explica o caminho", async () => {
    const definition = await define(CODES.noComponents)
    await insertMeasurement(definition.id, OP_A, 1, { value: 10 })
    await insertMeasurement(definition.id, OP_A, 2, { value: 20, numerator: 20, denominator: 1 })
    const fields = { operationalAggregation: "WEIGHTED_AVERAGE" }
    const impact = await previewIndicatorCorrection(db, ORG, definition.id, fields)
    expect(impact.canApply).toBe(false)
    expect(impact.measurements.missingComponents).toBe(1)
    expect(impact.blockers.map((blocker) => blocker.code)).toEqual(["MISSING_COMPONENTS"])
    expect(impact.blockers[0]!.message).toMatch(/1 medição não tem numerador e denominador.*a carga recusa numerador e denominador/)
    expect(impact.measurements.examples[0]).toMatchObject({ issue: "MISSING_COMPONENTS", employeeLabel: "Operador 0 (PC-0)", value: 10, date: "2026-09-15" })
    await expect(applyIndicatorCorrection(db, ORG, definition.id, { ...fields, reason: REASON, confirmation: CODES.noComponents }, ACTOR, SCOPES)).rejects.toMatchObject({ code: "INDICATOR_CORRECTION_BLOCKED", statusCode: 409 })
    expect(await findIndicatorDefinition(db, ORG, definition.id)).toMatchObject({ operationalAggregation: "SUM" })
    expect((await auditRows(definition.id)).rows).toEqual([])
  })

  it("bloqueia valor incoerente com numerador ÷ denominador, com a mesma tolerância da carga", async () => {
    const definition = await define(CODES.incoherent)
    await insertMeasurement(definition.id, OP_A, 1, { value: 90, numerator: 9, denominator: 20 })
    await insertMeasurement(definition.id, OP_A, 2, { value: 2, numerator: 12, denominator: 5 }) // 2,4 informado sem casas: arredondamento, passa
    const impact = await previewIndicatorCorrection(db, ORG, definition.id, { operationalAggregation: "WEIGHTED_AVERAGE" })
    expect(impact.measurements).toMatchObject({ incoherentValues: 1, missingComponents: 0 })
    expect(impact.blockers.map((blocker) => blocker.code)).toEqual(["INCOHERENT_VALUES"])
    expect(impact.measurements.examples[0]).toMatchObject({ issue: "INCOHERENT_VALUE", value: 90, expected: 0.45 })
    await expect(applyIndicatorCorrection(db, ORG, definition.id, { operationalAggregation: "WEIGHTED_AVERAGE", reason: REASON, confirmation: CODES.incoherent }, ACTOR, SCOPES)).rejects.toMatchObject({ code: "INDICATOR_CORRECTION_BLOCKED" })
  })

  it("Taxa exige Percentual, e valor fora da faixa da unidade também bloqueia", async () => {
    const definition = await define(CODES.range)
    await insertMeasurement(definition.id, OP_A, 1, { value: 150, numerator: 150, denominator: 100 })
    const onlyStrategy = await previewIndicatorCorrection(db, ORG, definition.id, { operationalAggregation: "RATE" })
    expect(onlyStrategy.blockers.map((blocker) => blocker.code)).toEqual(["INVALID_CONFIGURATION"])
    expect(onlyStrategy.blockers[0]!.message).toMatch(/"Taxa" só é válida para Percentual/)
    const withUnit = await previewIndicatorCorrection(db, ORG, definition.id, { operationalAggregation: "RATE", unit: "PERCENT" })
    expect(withUnit.blockers.map((blocker) => blocker.code)).toEqual(["VALUES_OUTSIDE_UNIT"])
    await expect(applyIndicatorCorrection(db, ORG, definition.id, { operationalAggregation: "RATE", reason: REASON, confirmation: CODES.range }, ACTOR, SCOPES)).rejects.toMatchObject({ code: "INDICATOR_CORRECTION_BLOCKED" })
  })

  it("código, desligar a medição, sem motivo e confirmação errada são recusados; o PATCH comum continua travado e aponta o caminho", async () => {
    const definition = await findIndicatorDefinition(db, ORG, (await db.query<{ id: string }>(`select id from indicator_definitions where code = $1`, [CODES.range])).rows[0]!.id)
    const target = definition!.id
    const base = { unit: "SECONDS", reason: REASON, confirmation: CODES.range }
    await expect(applyIndicatorCorrection(db, ORG, target, { ...base, code: "OUTRO_CODIGO" }, ACTOR, SCOPES)).rejects.toThrow(/code/)
    await expect(applyIndicatorCorrection(db, ORG, target, { ...base, dailySupported: false }, ACTOR, SCOPES)).rejects.toThrow(/dailySupported/)
    await expect(applyIndicatorCorrection(db, ORG, target, { ...base, reason: "curto" }, ACTOR, SCOPES)).rejects.toThrow(/motivo/)
    await expect(applyIndicatorCorrection(db, ORG, target, { ...base, confirmation: "ERRADO" }, ACTOR, SCOPES)).rejects.toMatchObject({ code: "INDICATOR_CORRECTION_CONFIRMATION_MISMATCH" })
    await expect(applyIndicatorCorrection(db, ORG, target, { reason: REASON, confirmation: CODES.range }, ACTOR, SCOPES)).rejects.toMatchObject({ code: "INDICATOR_CORRECTION_BLOCKED" })
    await expect(updateIndicatorDefinition(db, ORG, target, { unit: "SECONDS" })).rejects.toThrow(/Corrigir unidade, direção ou cálculo/)
    await expect(updateIndicatorDefinition(db, ORG, target, { code: "OUTRO_CODIGO" })).rejects.toMatchObject({ code: "INDICATOR_SEMANTIC_LOCKED" })
    await expect(updateIndicatorDefinition(db, ORG, target, { dailySupported: false })).rejects.toMatchObject({ code: "INDICATOR_SEMANTIC_LOCKED" })
    expect(await findIndicatorDefinition(db, ORG, target)).toMatchObject({ code: CODES.range, unit: "COUNT", dailySupported: true, operationalAggregation: "SUM" })
  })

  it("Workflow com agregação incompatível: ativo bloqueia; pausado e rascunho aparecem; ativar recusa; a execução para com o motivo", async () => {
    const definition = await define(CODES.workflow)
    await insertMeasurement(definition.id, OP_A, 1, { value: 450, numerator: 9000, denominator: 20 })
    const sumNode = conditionNode("soma", CODES.workflow, "SUM")
    const countNode = conditionNode("contagem", CODES.workflow, "COUNT")
    await insertWorkflow(WF_ACTIVE, "Workflow ativo", sumNode, sumNode, true)
    await insertWorkflow(WF_DRAFT, "Só rascunho", sumNode, countNode, true)
    const fields = { operationalAggregation: "WEIGHTED_AVERAGE", unit: "SECONDS" }

    const blocked = await previewIndicatorCorrection(db, ORG, definition.id, fields)
    expect(blocked.blockers.map((blocker) => blocker.code)).toEqual(["ACTIVE_WORKFLOWS"])
    expect(blocked.workflows.activePublished.map((workflow) => [workflow.name, workflow.uses[0]!.aggregationLabel])).toEqual([["Workflow ativo", "Soma"]])
    expect(blocked.workflows.activePublished[0]!.uses[0]!.message).toMatch(/usa "Soma" .* agregações válidas: Média ponderada pelo volume, Mínimo, Máximo, Quantidade de ocorrências/)
    expect(blocked.workflows.drafts.map((workflow) => workflow.name)).toEqual(["Só rascunho"])
    expect(blocked.allowedAggregations).toEqual(["Média ponderada pelo volume", "Mínimo", "Máximo", "Quantidade de ocorrências"])
    await expect(applyIndicatorCorrection(db, ORG, definition.id, { ...fields, reason: REASON, confirmation: CODES.workflow }, ACTOR, SCOPES)).rejects.toMatchObject({ code: "INDICATOR_CORRECTION_BLOCKED" })

    // Quem não administra aquele Grupo vê a contagem, nunca o nome; a trava vale do mesmo jeito.
    const scoped = impactForViewer(blocked, { unrestricted: false, allTeams: false, teamIds: new Set(), subteamIds: new Set() })
    expect(scoped.workflows).toMatchObject({ activePublished: [], drafts: [], outOfScope: { activePublished: 1, drafts: 1 } })
    expect(scoped.canApply).toBe(false)

    await db.query(`update workflows set active = false where id = $1`, [WF_ACTIVE])
    const paused = await previewIndicatorCorrection(db, ORG, definition.id, fields)
    expect(paused.canApply).toBe(true)
    expect(paused.workflows.pausedPublished.map((workflow) => workflow.name)).toEqual(["Workflow ativo"])
    expect(paused.notices.join(" ")).toMatch(/1 Workflow pausado depende.*Ativar é recusado/)
    expect(paused.notices.join(" ")).toMatch(/1 rascunho de Workflow usa/)

    // Antes da correção a versão publicada ainda é válida; depois dela, ativar recusa e a execução em andamento para.
    await expect(assertPublishedWorkflowMatchesIndicatorCatalog(db, ORG, WF_ACTIVE)).resolves.toBeUndefined()
    await applyIndicatorCorrection(db, ORG, definition.id, { ...fields, reason: REASON, confirmation: CODES.workflow }, ACTOR, SCOPES)
    await expect(assertPublishedWorkflowMatchesIndicatorCatalog(db, ORG, WF_ACTIVE)).rejects.toMatchObject({ code: "WORKFLOW_INVALID_CONDITION", statusCode: 422 })
    await expect(assertNodeMatchesIndicatorCatalog(db, ORG, sumNode)).rejects.toThrow(/usa "Soma".*publique o Workflow de novo/)
    await expect(assertNodeMatchesIndicatorCatalog(db, ORG, countNode)).resolves.toBeUndefined()
    // Workflow cuja versão publicada usa Quantidade continua ativo e válido.
    await expect(assertPublishedWorkflowMatchesIndicatorCatalog(db, ORG, WF_DRAFT)).resolves.toBeUndefined()
    const audit = await auditRows(definition.id)
    expect(audit.rows[0]!.payload).toMatchObject({ impact: { workflows: { pausedPublished: [{ id: WF_ACTIVE }], drafts: [{ id: WF_DRAFT }] } } })
  })

  it("direção 'meta específica' bloqueia Workflow ativo com Melhores/Piores", async () => {
    const definition = await define(CODES.direction, { desiredDirection: "LOWER" })
    const ranking = { id: "rank", type: "select_employees", label: "Piores", position: { x: 0, y: 0 }, config: { selectionMode: "RANKING", ranking: { indicatorCode: CODES.direction, aggregation: "SUM", source: "MEASUREMENT", selection: "WORST", count: 2, rankingBasis: "VALUE", period: { kind: "ROLLING_DAYS", days: 7 } } } }
    await insertWorkflow(WF_DIRECTION, "Ranking dos piores", ranking, ranking, true)
    const impact = await previewIndicatorCorrection(db, ORG, definition.id, { desiredDirection: "TARGET" })
    expect(impact.blockers.map((blocker) => blocker.code)).toEqual(["ACTIVE_WORKFLOWS"])
    expect(impact.workflows.activePublished[0]!.uses[0]).toMatchObject({ problem: "DIRECTION", nodeLabel: "Piores" })
    expect((await previewIndicatorCorrection(db, ORG, definition.id, { desiredDirection: "HIGHER" })).canApply).toBe(true)
  })

  it("'Contribuição zero' que deixa de valer volta para 'Sem amostra', avisando e auditando", async () => {
    const definition = await define(CODES.zero, { unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" })
    await insertMeasurement(definition.id, OP_A, 1, { value: 450, numerator: 9000, denominator: 20 })
    const fields = { operationalAggregation: "WEIGHTED_AVERAGE", unit: "SECONDS" }
    const impact = await previewIndicatorCorrection(db, ORG, definition.id, fields)
    expect(impact).toMatchObject({ canApply: true, zeroContributionReset: true })
    expect(impact.notices.join(" ")).toMatch(/volta para "Sem amostra"/)
    const { definition: corrected } = await applyIndicatorCorrection(db, ORG, definition.id, { ...fields, reason: REASON, confirmation: CODES.zero }, ACTOR, SCOPES)
    expect(corrected.unjustifiedAbsencePolicy).toBe("NO_SAMPLE")
    expect((await auditRows(definition.id)).rows[0]!.payload).toMatchObject({ before: { unjustifiedAbsencePolicy: "ZERO_CONTRIBUTION" }, after: { unjustifiedAbsencePolicy: "NO_SAMPLE" } })
  })
})
