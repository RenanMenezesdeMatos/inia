import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { processNode, type EnrollmentRow, type WorkflowScope } from "../../workflows/application/node-handlers.js"
import { createFakeEffects } from "../../workflows/testing/fake-effect-sink.js"
import type { FlowGraph, FlowNode } from "../../workflows/domain/graph-schema.js"
import type { ConsolidatedStructure } from "../../workflows/domain/consolidated-structure-schema.js"
import { previewConditionForOperators } from "./test-data-finders.js"

/** Organização da sessão de quem testa no QA Lab. */
const QA_ORGANIZATION = "00000000-0000-4000-8000-000000000001"

/**
 * PARIDADE Prévia × execução (Parte 23/24 do pedido): pra uma mesma Condition + sujeito +
 * relógio + dados, `previewConditionForOperators` (massa de teste do QA Lab) e `processNode`
 * (motor real, usado em produção e na execução do QA Lab) precisam chegar ao MESMO ramo, com o
 * MESMO valor calculado, MESMA referência e MESMO motivo de Sem Dados. O banco fake abaixo
 * responde ao SQL real do evaluator a partir de uma massa em memória — nenhuma escrita, nenhuma
 * chamada de IA, nenhum qa_run.
 */
const WORKFLOW_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const TEAM = "11111111-1111-4111-8111-111111111111"
const SUBTEAM_A = "22222222-2222-4222-8222-222222222222"
const SUBTEAM_B = "33333333-3333-4333-8333-333333333333"
const SUPERVISOR = "55555555-5555-4555-8555-555555555555"
const JOAO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1"
const MARIA = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"
const PEDRO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3"
const NOW = new Date("2026-09-15T12:00:00.000Z")

type Person = { id: string; name: string; teamId: string; subteamId: string | null; reportsTo: string | null }
type Measurement = { subjectId: string; code: string; value: number; periodEnd: string }
type PerfRow = { personId: string; code: string; referencePeriod: string; value: number; achievement: number | null; weight: number | null; quartile: string | null }
type PrvRow = { personId: string; referencePeriod: string; achievement: number; quartile: string }

type Fixture = {
  people: Person[]
  measurements: Measurement[]
  goals: { subteam: Record<string, number>; team: Record<string, number> }
  indicatorPerf: PerfRow[]
  prvPerf: PrvRow[]
}

const PEOPLE: Person[] = [
  { id: JOAO, name: "João Silva", teamId: TEAM, subteamId: SUBTEAM_A, reportsTo: SUPERVISOR },
  { id: MARIA, name: "Maria Souza", teamId: TEAM, subteamId: SUBTEAM_B, reportsTo: SUPERVISOR },
  { id: PEDRO, name: "Pedro Lima", teamId: TEAM, subteamId: SUBTEAM_A, reportsTo: SUPERVISOR },
]

function avg(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
}
function min(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values)
}
function max(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values)
}
function str(value: number | null): string | null {
  return value === null ? null : String(value)
}

/** Banco fake que "executa" o SQL do evaluator sobre a massa em memória. Só leitura. */
function fakeDatabase(fixture: Fixture, graph: FlowGraph, options: { structure?: ConsolidatedStructure | null } = {}) {
  const log: string[] = []
  async function query(sql: string, params: unknown[] = []) {
    const text = sql.replace(/\s+/g, " ").trim()
    log.push(text)
    if (/^(insert|update|delete)/i.test(text)) throw new Error(`escrita inesperada: ${text.slice(0, 40)}`)

    if (text.includes("from workflows w where w.id = $1")) {
      return {
        rows: [
          {
            id: WORKFLOW_ID,
            name: "W",
            scope_type: "TEAM",
            team_id: TEAM,
            subteam_id: null,
            trigger_config: { kind: "schedule", times: ["09:00"], intervalDays: 1 },
            consolidated_structure: options.structure ?? null,
            population_filter: null,
            active_version_id: "v",
            draft_graph: graph,
            published_graph: graph,
          },
        ],
        rowCount: 1,
      }
    }
    if (text.startsWith("select id from people where organization_id = $1 and role = 'OPERATOR' and active")) {
      return { rows: fixture.people.filter((p) => params[1] === "ALL_TEAMS" || p.teamId === params[2]).map((p) => ({ id: p.id })), rowCount: 0 }
    }
    if (text.startsWith("select id from people where reports_to_id = $1 and role = 'OPERATOR'")) {
      return { rows: fixture.people.filter((p) => p.reportsTo === params[0]).map((p) => ({ id: p.id })), rowCount: 0 }
    }
    if (text.includes("from people p left join teams t on t.id = p.team_id where p.id = any($1::uuid[]) order by p.name")) {
      const ids = params[0] as string[]
      return { rows: fixture.people.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, name: p.name, team_name: "FATURAS" })), rowCount: 0 }
    }
    if (text.startsWith("select name from people where id = $1")) return { rows: [{ name: "Carlos" }], rowCount: 1 }

    // ---- medições brutas ----
    const measurementsIn = (ids: string[], code: string, start: string, end: string) =>
      fixture.measurements.filter((m) => ids.includes(m.subjectId) && m.code === code && m.periodEnd >= start && m.periodEnd < end)
    // Todas as consultas de medição carregam o predicado canônico de elegibilidade (intervalos por
    // pessoa); a fixture não tem folga/afastamento, então todo dia é elegível — o fake só confere a forma.
    if (text.includes("indicator_measurements")) expect(text).toContain("eligible_days")
    if (text.includes("select m.value") && text.includes("from indicator_measurements m")) {
      return { rows: measurementsIn(params[1] as string[], params[0] as string, params[2] as string, params[3] as string).map((m) => ({ value: String(m.value) })), rowCount: 0 }
    }
    if (text.includes("select avg(m.value) filter (where m.eligible)::numeric avg_value") && !text.includes("with expected(")) {
      const values = measurementsIn(params[1] as string[], params[0] as string, params[2] as string, params[3] as string).map((m) => m.value)
      return { rows: [{ avg_value: str(avg(values)), min_value: str(min(values)), max_value: str(max(values)), sample_count: String(values.length) }], rowCount: 1 }
    }
    if (text.includes("with expected(month_start, month_end) as")) {
      const starts = params[2] as string[]
      const ends = params[3] as string[]
      const perMonth = starts.map((start, index) => {
        const values = measurementsIn(params[1] as string[], params[0] as string, start, ends[index]!).map((m) => m.value)
        return { monthStart: start, sampleCount: values.length, avgValue: str(avg(values)), values }
      })
      const all = perMonth.flatMap((m) => m.values)
      return {
        rows: [
          {
            missing_months: String(perMonth.filter((m) => m.sampleCount === 0).length),
            sample_count: String(all.length),
            avg_value: str(avg(all)),
            min_value: str(min(all)),
            max_value: str(max(all)),
            months: perMonth.map(({ monthStart, sampleCount, avgValue }) => ({ monthStart, sampleCount, avgValue })),
          },
        ],
        rowCount: 1,
      }
    }

    // ---- metas ----
    if (text.startsWith("with resolved as")) {
      const ids = params[2] as string[]
      return {
        rows: fixture.people
          .filter((p) => ids.includes(p.id))
          .map((p) => {
            const subteamGoal = p.subteamId !== null ? (fixture.goals.subteam[p.subteamId] ?? null) : null
            const teamGoal = fixture.goals.team[p.teamId] ?? null
            const effective = subteamGoal ?? teamGoal
            return { personId: p.id, effectiveGoal: effective === null ? null : String(effective), fromSubteam: subteamGoal !== null, subteamName: p.subteamId === SUBTEAM_A ? "Atendimento Premium" : "Retenção", teamName: "FATURAS" }
          }),
        rowCount: 0,
      }
    }

    // ---- performance (atingimento/quartil) ----
    const perfFor = (personIds: string[], code: string | undefined, upTo: string) =>
      fixture.indicatorPerf.filter((r) => personIds.includes(r.personId) && (code === undefined || r.code === code) && r.referencePeriod <= upTo).sort((a, b) => b.referencePeriod.localeCompare(a.referencePeriod))
    const prvFor = (personIds: string[], upTo: string) => fixture.prvPerf.filter((r) => personIds.includes(r.personId) && r.referencePeriod <= upTo).sort((a, b) => b.referencePeriod.localeCompare(a.referencePeriod))
    const perfRow = (r: PerfRow) => ({
      id: `${r.personId}-${r.referencePeriod}`,
      personId: r.personId,
      indicatorDefinitionId: "idef",
      indicatorCode: r.code,
      subteamId: null,
      referencePeriod: r.referencePeriod,
      value: r.value,
      targetValue: null,
      achievementPercent: r.achievement,
      weightPercent: r.weight,
      quartile: r.quartile,
      source: "SEED",
    })
    const prvRow = (r: PrvRow) => ({ id: `${r.personId}-${r.referencePeriod}`, personId: r.personId, subteamId: null, referencePeriod: r.referencePeriod, achievementPercent: r.achievement, quartile: r.quartile, source: "SEED" })
    if (text.includes("from employee_indicator_performance eip join indicator_definitions idef") && text.includes("where eip.person_id = $1 and idef.code = $2")) {
      const rows = perfFor([params[0] as string], params[1] as string, params[2] as string)
      const limit = text.endsWith("limit 1") ? 1 : Number(params[3])
      return { rows: rows.slice(0, limit).map(perfRow), rowCount: 0 }
    }
    if (text.includes("from employee_prv_performance where person_id = $1 and reference_period <= $2")) {
      const rows = prvFor([params[0] as string], params[1] as string)
      const limit = text.endsWith("limit 1") ? 1 : Number(params[2])
      return { rows: rows.slice(0, limit).map(prvRow), rowCount: 0 }
    }
    if (text.startsWith("with recent_periods as")) {
      const isPrv = text.includes("from employee_prv_performance")
      const ids = params[0] as string[]
      const upTo = params[1] as string
      const count = Number(params[2])
      const code = isPrv ? undefined : (params[3] as string)
      const rows = isPrv ? prvFor(ids, upTo).map((r) => ({ referencePeriod: r.referencePeriod, achievement: r.achievement })) : perfFor(ids, code, upTo).map((r) => ({ referencePeriod: r.referencePeriod, achievement: r.achievement ?? 0 }))
      const periods = [...new Set(rows.map((r) => r.referencePeriod))].sort().reverse().slice(0, count)
      const selected = rows.filter((r) => periods.includes(r.referencePeriod))
      const values = selected.map((r) => r.achievement)
      return {
        rows: [
          {
            avg_value: str(avg(values)),
            min_value: str(min(values)),
            max_value: str(max(values)),
            sample_count: String(values.length),
            total_closures: String(periods.length),
            periods: periods
              .slice()
              .sort()
              .map((period) => {
                const inPeriod = selected.filter((r) => r.referencePeriod === period).map((r) => r.achievement)
                return { referencePeriod: period, avgValue: str(avg(inPeriod)), sampleCount: inPeriod.length }
              }),
          },
        ],
        rowCount: 1,
      }
    }
    if (text.includes("avg(achievement_percent)::numeric avg_value") && text.includes("reference_period >= $2 and reference_period <= $3")) {
      const isPrv = text.includes("from employee_prv_performance")
      const ids = params[0] as string[]
      const values = isPrv
        ? fixture.prvPerf.filter((r) => ids.includes(r.personId) && r.referencePeriod >= (params[1] as string) && r.referencePeriod <= (params[2] as string)).map((r) => r.achievement)
        : fixture.indicatorPerf.filter((r) => ids.includes(r.personId) && r.code === params[3] && r.referencePeriod >= (params[1] as string) && r.referencePeriod <= (params[2] as string)).map((r) => r.achievement ?? 0)
      return { rows: [{ avg_value: str(avg(values)), min_value: str(min(values)), max_value: str(max(values)), sample_count: String(values.length) }], rowCount: 1 }
    }
    if (text.includes("operational_aggregation, daily_supported from indicator_definitions")) return { rows: [], rowCount: 0 }
    if (text.startsWith("select timezone from operations")) return { rows: [], rowCount: 0 }
    // Dias elegíveis (cobertura): sem hired_at = elegível na janela inteira.
    if (text.startsWith("select id, organization_id, hired_at::text hired_at, operational_capital_code from people")) return { rows: (params[0] as string[]).map((id) => ({ id, organization_id: "00000000-0000-4000-8000-000000000001", hired_at: null, operational_capital_code: null })), rowCount: 0 }
    if (text.includes("holiday_fallback_policy from organizations")) return { rows: [{ holiday_fallback_policy: "IGNORE" }], rowCount: 1 }
    // Situação funcional: ninguém de férias/afastado na fixture (dia sem período = ATIVO presumido).
    if (text.includes("from employee_status_periods")) return { rows: [], rowCount: 0 }
    // Escala: sem calendário, sem regime, sem feriado na fixture (fallback legado seg–sex).
    if (text.includes("from employee_schedule_days") || text.includes("from employee_work_shifts") || text.includes("from organization_holidays") || text.includes("from employee_schedule_exceptions") || text.includes("from holiday_catalog")) return { rows: [], rowCount: 0 }
    // Freshness da fonte de situação funcional: nenhum feed configurado na fixture (UNKNOWN — nada é degradado).
    if (text.includes("from data_feeds f join data_sources s")) return { rows: [], rowCount: 0 }
    // Evidência de atividade (PLANEJADO × OBSERVADO): nenhuma fonte na fixture — comportamento só planejado.
    if (text.includes("from interactions where organization_id")) return { rows: [{ present: false }], rowCount: 1 }
    if (text.includes("proves_work_activity order by code")) return { rows: [], rowCount: 0 }
    if (text.includes("f.availability_policy") || text.includes("availability_policy from indicator_definitions")) return { rows: [], rowCount: 0 }
    if (text.includes("from workday_classifications c")) return { rows: [], rowCount: 0 }
    throw new Error(`SQL não roteado no fake: ${text.slice(0, 120)}`)
  }
  return { db: { query, connect: async () => ({ query, release: () => {} }) } as unknown as Database, log }
}

type ConditionConfig = Extract<FlowNode, { type: "condition" }>["config"]

function graphWith(config: ConditionConfig): FlowGraph {
  return {
    nodes: [
      { id: "trigger", type: "trigger", label: "Gatilho", position: { x: 0, y: 0 }, config: {} },
      { id: "condition", type: "condition", label: "Condição", position: { x: 0, y: 1 }, config },
      { id: "end", type: "end", label: "Fim", position: { x: 0, y: 2 }, config: {} },
    ],
    edges: [
      { id: "e1", source: "trigger", sourceHandle: "always", target: "condition" },
      { id: "e2", source: "condition", sourceHandle: "true", target: "end" },
      { id: "e3", source: "condition", sourceHandle: "false", target: "end" },
      { id: "e4", source: "condition", sourceHandle: "no_data", target: "end" },
    ],
  }
}

function enrollmentFor(subjectId: string): EnrollmentRow {
  return {
    id: "enrollment-1",
    organization_id: "org",
    workflow_id: WORKFLOW_ID,
    version_id: "v",
    interaction_id: null,
    indicator_measurement_id: null,
    scheduled_subject_id: subjectId,
    scheduled_for: NOW.toISOString(),
    current_node_id: "condition",
    matched_flag_name: null,
    matched_value_boolean: null,
    matched_value_numeric: null,
    status: "active",
    attempts: 0,
    revision: 0,
    node_outputs: {},
    variables: {},
  }
}

/** Roda a prévia e a execução real pro mesmo sujeito e devolve os dois lados pra comparação. */
async function parity(fixture: Fixture, config: ConditionConfig, structure: ConsolidatedStructure | null = null) {
  const graph = graphWith(config)
  const { db, log } = fakeDatabase(fixture, graph, { structure })
  const preview = await previewConditionForOperators(db, QA_ORGANIZATION, { workflowId: WORKFLOW_ID, nodeId: "condition", simulatedNow: NOW.toISOString(), ...(structure ? { consolidatedStructure: structure } : {}) })
  const workflow: WorkflowScope = { scopeType: "TEAM", teamId: TEAM, subteamId: null, consolidatedStructure: structure }
  const executed = new Map<string, { branch: string; evaluation: Record<string, unknown> }>()
  for (const row of preview.rows) {
    const subjectId = row.subjectKind === "STRUCTURE" ? SUPERVISOR : row.subjectId
    const outcome = await processNode({ db, graph, enrollment: enrollmentFor(subjectId), workflow, inputContext: "", now: NOW, effects: createFakeEffects() }, graph.nodes[1]!)
    if (outcome.kind !== "advance") throw new Error(`execução falhou: ${JSON.stringify(outcome)}`)
    executed.set(row.subjectId, { branch: String(outcome.eventPayload!.branch), evaluation: outcome.eventPayload!.evaluation as Record<string, unknown> })
  }
  expect(log.some((sql) => /^(insert|update|delete)/i.test(sql))).toBe(false)
  return { preview, executed }
}

function expectParity(result: Awaited<ReturnType<typeof parity>>) {
  for (const row of result.preview.rows) {
    const run = result.executed.get(row.subjectId)!
    expect(run.branch, `${row.label}: ramo`).toBe(row.branch)
    expect(run.evaluation.value, `${row.label}: valor`).toEqual(row.evaluation.value)
    expect(run.evaluation.reference, `${row.label}: referência`).toEqual(row.evaluation.reference)
    expect(run.evaluation.comparisonValue, `${row.label}: valor comparado`).toEqual(row.evaluation.comparisonValue)
    expect(run.evaluation.reason, `${row.label}: motivo`).toEqual(row.evaluation.reason)
    expect(run.evaluation.reasonText, `${row.label}: texto do motivo`).toEqual(row.evaluation.reasonText)
  }
}

const EMPTY: Fixture = { people: PEOPLE, measurements: [], goals: { subteam: {}, team: {} }, indicatorPerf: [], prvPerf: [] }

// Agosto/2026 (mês civil anterior a NOW) e julho/2026 (anterior ao anterior), em UTC-3 → ISO.
const AUG = "2026-08-15T12:00:00.000Z"
const JUL = "2026-07-15T12:00:00.000Z"
const JUN = "2026-06-15T12:00:00.000Z"
const AVERAGE_LAST_MONTH = { kind: "INDICATOR_THRESHOLD_COUNT" as const, indicatorCode: "QUALIDADE", aggregation: "AVERAGE" as const, period: { kind: "CALENDAR" as const, unit: "MONTH" as const } }

describe("Paridade Prévia × processNode — mesma Condition, mesmo sujeito, mesmo relógio, mesmos dados", () => {
  it("Valor fixo: Nota URA média 2,8 < 3,3 → ATENDE nos dois lados", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "NOTA_URA", value: 2.8, periodEnd: AUG }, { subjectId: MARIA, code: "NOTA_URA", value: 3.6, periodEnd: AUG }] }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 3.3, historicalQuery: { ...AVERAGE_LAST_MONTH, indicatorCode: "NOTA_URA" } })
    expectParity(result)
    expect(result.preview.rows.map((row) => `${row.label}:${row.branch}`)).toEqual(["João Silva:true", "Maria Souza:false", "Pedro Lima:no_data"])
    expect(result.preview.rows[0]!.summary).toBe("2,8 < 3,3 → verdadeiro")
    expect(result.preview.rows[2]!.reasonText).toBe("Não há medições no período.")
  })

  it("Meta: valor < meta real do Subgrupo (João 82 < 85 ATENDE; Maria 92 < 90 NÃO ATENDE) — nunca threshold fixo", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      measurements: [
        { subjectId: JOAO, code: "QUALIDADE", value: 82, periodEnd: AUG },
        { subjectId: MARIA, code: "QUALIDADE", value: 92, periodEnd: AUG },
      ],
      goals: { subteam: { [SUBTEAM_A]: 85, [SUBTEAM_B]: 90 }, team: { [TEAM]: 80 } },
    }
    // thresholdNumeric 999 de propósito: se a prévia usasse o threshold fixo, todo mundo "atenderia".
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 999, historicalQuery: { ...AVERAGE_LAST_MONTH, compareTo: { kind: "GOAL" } } })
    expectParity(result)
    const joao = result.preview.rows.find((row) => row.subjectId === JOAO)!
    const maria = result.preview.rows.find((row) => row.subjectId === MARIA)!
    expect(joao).toMatchObject({ branch: "true", summary: "82 < meta 85 → verdadeiro", evaluation: { reference: 85, referenceKind: "GOAL", goalSource: { kind: "SUBTEAM", name: "Atendimento Premium" } } })
    expect(maria).toMatchObject({ branch: "false", summary: "92 < meta 90 → falso", evaluation: { reference: 90, goalSource: { kind: "SUBTEAM", name: "Retenção" } } })
  })

  it("Meta com fallback pro Time quando o Subgrupo não tem meta", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "QUALIDADE", value: 78, periodEnd: AUG }], goals: { subteam: {}, team: { [TEAM]: 80 } } }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 0, historicalQuery: { ...AVERAGE_LAST_MONTH, compareTo: { kind: "GOAL" } } })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "true", evaluation: { reference: 80, goalSource: { kind: "TEAM", name: "FATURAS" } } })
  })

  it("Sem meta cadastrada → SEM DADOS com motivo NO_GOAL", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "QUALIDADE", value: 78, periodEnd: AUG }] }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 0, historicalQuery: { ...AVERAGE_LAST_MONTH, compareTo: { kind: "GOAL" } } })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "no_data", reason: "NO_GOAL", reasonText: "Não há meta vigente cadastrada para o indicador." })
  })

  it("Estrutura consolidada com metas diferentes entre Subgrupos → SEM DADOS INCOMPATIBLE_GOALS, igual nos dois lados", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      measurements: [
        { subjectId: JOAO, code: "QUALIDADE", value: 82, periodEnd: AUG },
        { subjectId: MARIA, code: "QUALIDADE", value: 92, periodEnd: AUG },
      ],
      goals: { subteam: { [SUBTEAM_A]: 85, [SUBTEAM_B]: 90 }, team: {} },
    }
    const structure: ConsolidatedStructure = { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 0, historicalQuery: { ...AVERAGE_LAST_MONTH, compareTo: { kind: "GOAL" } } }, structure)
    expectParity(result)
    expect(result.preview.rows).toHaveLength(1)
    expect(result.preview.rows[0]).toMatchObject({
      subjectKind: "STRUCTURE",
      label: "Equipe de Supervisor — Carlos",
      memberCount: 3,
      branch: "no_data",
      reason: "INCOMPATIBLE_GOALS",
      reasonText: "A estrutura possui metas diferentes entre os Subgrupos/Times.",
    })
  })

  it("Estrutura consolidada com a MESMA meta em todos os membros compara a média do conjunto", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      measurements: [
        { subjectId: JOAO, code: "QUALIDADE", value: 80, periodEnd: AUG },
        { subjectId: MARIA, code: "QUALIDADE", value: 90, periodEnd: AUG },
      ],
      goals: { subteam: {}, team: { [TEAM]: 88 } },
    }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 0, historicalQuery: { ...AVERAGE_LAST_MONTH, compareTo: { kind: "GOAL" } } }, { kind: "SUPERVISOR_TEAM", supervisorId: SUPERVISOR })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "true", summary: "85 < meta 88 → verdadeiro", evaluation: { value: 85, reference: 88, goalSource: { kind: "TEAM", name: "FATURAS" } } })
  })

  it("Período anterior: TMA 468 > anterior 420 → ATENDE ('aumentou'), com valor anterior real", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "TMA", value: 468, periodEnd: AUG }, { subjectId: JOAO, code: "TMA", value: 420, periodEnd: JUL }] }
    const result = await parity(fixture, { comparator: "GT", thresholdNumeric: 0, historicalQuery: { ...AVERAGE_LAST_MONTH, indicatorCode: "TMA", compareTo: { kind: "PREVIOUS_PERIOD" } } })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "true", summary: "468 > anterior 420 → verdadeiro", evaluation: { value: 468, reference: 420, previousValue: 420, referenceKind: "PREVIOUS_PERIOD" } })
  })

  it("Sem período anterior → SEM DADOS NO_PREVIOUS_PERIOD", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "TMA", value: 468, periodEnd: AUG }] }
    const result = await parity(fixture, { comparator: "GT", thresholdNumeric: 0, historicalQuery: { ...AVERAGE_LAST_MONTH, indicatorCode: "TMA", compareTo: { kind: "PREVIOUS_PERIOD" } } })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "no_data", reason: "NO_PREVIOUS_PERIOD", reasonText: "Não existe período anterior disponível." })
  })

  it("Variação percentual: 420 → 468 = +11,43% ≥ 10% → ATENDE, valores idênticos nos dois lados", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "TMA", value: 468, periodEnd: AUG }, { subjectId: JOAO, code: "TMA", value: 420, periodEnd: JUL }] }
    const result = await parity(fixture, { comparator: "GTE", thresholdNumeric: 10, historicalQuery: { ...AVERAGE_LAST_MONTH, indicatorCode: "TMA", compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" } } })
    expectParity(result)
    const row = result.preview.rows[0]!
    expect(row.branch).toBe("true")
    expect(row.evaluation.percentChange).toBeCloseTo(11.4286, 3)
    expect(row.summary).toBe("420 → 468 (+11,43%) ≥ 10% → verdadeiro")
  })

  it("Divisão por zero: período anterior = 0 → SEM DADOS PREVIOUS_PERIOD_ZERO (nunca Infinity/NaN)", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "TMA", value: 468, periodEnd: AUG }, { subjectId: JOAO, code: "TMA", value: 0, periodEnd: JUL }] }
    const result = await parity(fixture, { comparator: "GTE", thresholdNumeric: 10, historicalQuery: { ...AVERAGE_LAST_MONTH, indicatorCode: "TMA", compareTo: { kind: "PREVIOUS_PERIOD", changeMode: "PERCENT" } } })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "no_data", reason: "PREVIOUS_PERIOD_ZERO", reasonText: "O período anterior é zero — variação percentual indefinida." })
    expect(Number.isFinite(Number(result.preview.rows[0]!.evaluation.percentChange ?? 0))).toBe(true)
  })

  it("Atingimento (performance mais recente): 78% < 80% ATENDE; sem registro → SEM DADOS", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      indicatorPerf: [
        { personId: JOAO, code: "QUALIDADE", referencePeriod: "2026-08", value: 78, achievement: 78, weight: 10, quartile: "Q3" },
        { personId: MARIA, code: "QUALIDADE", referencePeriod: "2026-08", value: 91, achievement: 91, weight: 10, quartile: "Q1" },
      ],
    }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "INDICATOR_ACHIEVEMENT", indicatorCode: "QUALIDADE" } })
    expectParity(result)
    expect(result.preview.rows.map((row) => `${row.label}:${row.branch}`)).toEqual(["João Silva:true", "Maria Souza:false", "Pedro Lima:no_data"])
    expect(result.preview.rows[0]!.summary).toBe("78 < 80 → verdadeiro")
    expect(result.preview.rows[2]!.reasonText).toBe("Não há registro de performance para este colaborador.")
  })

  it("Atingimento comparado com período anterior (histórico de atingimento): 78 → 82 aumentou", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      indicatorPerf: [
        { personId: JOAO, code: "QUALIDADE", referencePeriod: "2026-08", value: 82, achievement: 82, weight: 10, quartile: "Q2" },
        { personId: JOAO, code: "QUALIDADE", referencePeriod: "2026-07", value: 78, achievement: 78, weight: 10, quartile: "Q3" },
      ],
    }
    const result = await parity(fixture, {
      comparator: "GT",
      thresholdNumeric: 0,
      historicalQuery: { ...AVERAGE_LAST_MONTH, source: "INDICATOR_ACHIEVEMENT", compareTo: { kind: "PREVIOUS_PERIOD" } },
    })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "true", evaluation: { value: 82, reference: 78 } })
  })

  it("PRV: atingimento oficial persistido, 78% < 80% ATENDE", async () => {
    const fixture: Fixture = { ...EMPTY, prvPerf: [{ personId: JOAO, referencePeriod: "2026-08", achievement: 78, quartile: "Q3" }, { personId: MARIA, referencePeriod: "2026-08", achievement: 95, quartile: "Q1" }] }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 80, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_ACHIEVEMENT" } })
    expectParity(result)
    expect(result.preview.rows.map((row) => `${row.label}:${row.branch}`)).toEqual(["João Silva:true", "Maria Souza:false", "Pedro Lima:no_data"])
  })

  it("Quartil: 'está em Q4' (texto) — ATENDE só pra quem está em Q4", async () => {
    const fixture: Fixture = { ...EMPTY, prvPerf: [{ personId: JOAO, referencePeriod: "2026-08", achievement: 60, quartile: "Q4" }, { personId: MARIA, referencePeriod: "2026-08", achievement: 95, quartile: "Q1" }] }
    const result = await parity(fixture, { comparator: "EQUALS", thresholdText: "Q4", performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE" } })
    expectParity(result)
    expect(result.preview.rows.map((row) => `${row.label}:${row.branch}`)).toEqual(["João Silva:true", "Maria Souza:false", "Pedro Lima:no_data"])
    expect(result.preview.rows[0]!.summary).toBe("Q4 = Q4 → verdadeiro")
  })

  it("Recorrência de quartil: Q4 em 3 dos últimos 3 fechamentos ATENDE; só 2 fechamentos → SEM DADOS (nunca parcial)", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      prvPerf: [
        { personId: JOAO, referencePeriod: "2026-06", achievement: 60, quartile: "Q4" },
        { personId: JOAO, referencePeriod: "2026-07", achievement: 62, quartile: "Q4" },
        { personId: JOAO, referencePeriod: "2026-08", achievement: 58, quartile: "Q4" },
        { personId: MARIA, referencePeriod: "2026-07", achievement: 62, quartile: "Q4" },
        { personId: MARIA, referencePeriod: "2026-08", achievement: 58, quartile: "Q4" },
      ],
    }
    const result = await parity(fixture, { comparator: "GTE", thresholdNumeric: 3, performanceQuery: { kind: "EMPLOYEE_PERFORMANCE", metric: "PRV_QUARTILE", recurrence: { periods: 3, matchQuartile: "Q4" } } })
    expectParity(result)
    const joao = result.preview.rows.find((row) => row.subjectId === JOAO)!
    const maria = result.preview.rows.find((row) => row.subjectId === MARIA)!
    expect(joao).toMatchObject({ branch: "true", summary: "Q4 em 3 de 3 fechamentos ≥ 3 → verdadeiro" })
    expect(maria).toMatchObject({ branch: "no_data", reason: "INSUFFICIENT_RECURRENCE", reasonText: "Existem apenas 2 dos 3 fechamentos necessários." })
  })

  it("Últimos 3 meses fechados (Valor bruto): média de jun/jul/ago = 3,0 < 3,3 ATENDE, com o valor de cada mês no debug", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      measurements: [
        { subjectId: JOAO, code: "NOTA_URA", value: 3.2, periodEnd: JUN },
        { subjectId: JOAO, code: "NOTA_URA", value: 3.0, periodEnd: JUL },
        { subjectId: JOAO, code: "NOTA_URA", value: 2.8, periodEnd: AUG },
        // Mês corrente (setembro) NUNCA entra, mesmo com medição.
        { subjectId: JOAO, code: "NOTA_URA", value: 9.9, periodEnd: "2026-09-10T12:00:00.000Z" },
      ],
    }
    const result = await parity(fixture, {
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expectParity(result)
    const joao = result.preview.rows.find((row) => row.subjectId === JOAO)!
    expect(joao.branch).toBe("true")
    expect(joao.evaluation.value).toBeCloseTo(3.0, 6)
    expect(joao.evaluation.closures).toEqual([
      { label: "junho/2026", value: 3.2, sampleCount: 1 },
      { label: "julho/2026", value: 3, sampleCount: 1 },
      { label: "agosto/2026", value: 2.8, sampleCount: 1 },
    ])
  })

  it("Competência ausente nos meses fechados → SEM DADOS INSUFFICIENT_CLOSED_MONTHS (nunca busca mês mais antigo)", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      measurements: [
        { subjectId: JOAO, code: "NOTA_URA", value: 3.2, periodEnd: JUN },
        // julho ausente
        { subjectId: JOAO, code: "NOTA_URA", value: 2.8, periodEnd: AUG },
        { subjectId: JOAO, code: "NOTA_URA", value: 1.0, periodEnd: "2026-05-15T12:00:00.000Z" }, // maio existe, mas não pode substituir julho
      ],
    }
    const result = await parity(fixture, {
      comparator: "LT",
      thresholdNumeric: 3.3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "AVERAGE", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expectParity(result)
    const joao = result.preview.rows.find((row) => row.subjectId === JOAO)!
    expect(joao).toMatchObject({ branch: "no_data", reason: "INSUFFICIENT_CLOSED_MONTHS", reasonText: "Existem medições em apenas 2 dos 3 meses fechados necessários." })
  })

  it("Últimos 3 fechamentos de atingimento: com 2 fechamentos → SEM DADOS INSUFFICIENT_CLOSURES", async () => {
    const fixture: Fixture = {
      ...EMPTY,
      indicatorPerf: [
        { personId: JOAO, code: "QUALIDADE", referencePeriod: "2026-08", value: 82, achievement: 82, weight: 10, quartile: "Q2" },
        { personId: JOAO, code: "QUALIDADE", referencePeriod: "2026-07", value: 78, achievement: 78, weight: 10, quartile: "Q3" },
      ],
    }
    const result = await parity(fixture, {
      comparator: "LT",
      thresholdNumeric: 90,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "QUALIDADE", aggregation: "AVERAGE", source: "INDICATOR_ACHIEVEMENT", period: { kind: "CLOSURES", unit: "MONTH", count: 3 } },
    })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "no_data", reason: "INSUFFICIENT_CLOSURES", reasonText: "Existem apenas 2 dos 3 fechamentos necessários." })
  })

  it("Dados insuficientes (minimumSampleSize): 1 medição com mínimo 2 → SEM DADOS BELOW_MINIMUM_SAMPLE", async () => {
    const fixture: Fixture = { ...EMPTY, measurements: [{ subjectId: JOAO, code: "QUALIDADE", value: 82, periodEnd: AUG }] }
    const result = await parity(fixture, { comparator: "LT", thresholdNumeric: 90, historicalQuery: { ...AVERAGE_LAST_MONTH, minimumSampleSize: 2 } })
    expectParity(result)
    expect(result.preview.rows[0]).toMatchObject({ branch: "no_data", reason: "BELOW_MINIMUM_SAMPLE", reasonText: "Não há medições suficientes (1 de 2 mínimas)." })
  })

  it("Reincidência (COUNT): 3 ou mais notas < 3 nos últimos 7 dias", async () => {
    const recent = (day: number) => `2026-09-${String(day).padStart(2, "0")}T12:00:00.000Z`
    const fixture: Fixture = {
      ...EMPTY,
      measurements: [
        { subjectId: JOAO, code: "NOTA_URA", value: 1, periodEnd: recent(10) },
        { subjectId: JOAO, code: "NOTA_URA", value: 2, periodEnd: recent(11) },
        { subjectId: JOAO, code: "NOTA_URA", value: 2.5, periodEnd: recent(12) },
        { subjectId: JOAO, code: "NOTA_URA", value: 4, periodEnd: recent(13) },
        { subjectId: MARIA, code: "NOTA_URA", value: 1, periodEnd: recent(12) },
      ],
    }
    const result = await parity(fixture, {
      comparator: "GTE",
      thresholdNumeric: 3,
      historicalQuery: { kind: "INDICATOR_THRESHOLD_COUNT", indicatorCode: "NOTA_URA", aggregation: "COUNT", comparator: "LT", indicatorThreshold: 3, period: { kind: "ROLLING_DAYS", days: 7 } },
    })
    expectParity(result)
    expect(result.preview.rows.map((row) => `${row.label}:${row.branch}:${row.summary}`)).toEqual([
      "João Silva:true:3 ocorrência(s) ≥ 3 → verdadeiro",
      "Maria Souza:false:1 ocorrência(s) ≥ 3 → falso",
      "Pedro Lima:false:0 ocorrência(s) ≥ 3 → falso",
    ])
  })
})
