/**
 * PROVA contra o banco de TESTE real: o checador de agenda nasce as matrículas EM LOTE (um insert por workflow e horário) e
 * continua idempotente pelo índice único (workflow, sujeito, horário) — rodar de novo no mesmo minuto não cria nada.
 * Cobre os três modos: Individual (calendário), Relativo ao expediente e Consolidado. Só operador ativo da Abrangência nasce.
 * Dados commitados e apagados no fim, pelos ids criados (o checador só vê workflows de agenda ATIVOS — nenhum outro existe
 * no banco de teste; se um dia existir, ele também seria avaliado nesta rodada).
 *   INIA_DB_PROOF=1 NODE_ENV=test npx vitest run schedule-check-proof
 */
import pg from "pg"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { env } from "../../../config/env.js"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveOrganizationTimezone } from "../application/organization-timezone.js"
import { runScheduleCheck } from "../application/schedule-check.js"
import { localDateParts, zonedTimeToIso } from "../application/schedule-recurrence.js"

const ENABLED = process.env.INIA_DB_PROOF === "1"
const ORG = "00000000-0000-4000-8000-000000000001"
let pool: pg.Pool
const created = { people: [] as string[], teams: [] as string[], workflows: [] as string[] }
const GRAPH = { nodes: [{ id: "trigger", type: "trigger", label: "Agenda", position: { x: 0, y: 0 }, config: {} }], edges: [] }

describe.skipIf(!ENABLED)("Checador de agenda — prova Postgres (inserção em lote)", () => {
  beforeAll(() => { pool = new pg.Pool({ connectionString: env.TEST_DATABASE_URL, max: 4 }) })
  afterAll(async () => {
    if (!pool) return
    await pool.query("delete from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("update workflows set active_version_id = null where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflow_versions where workflow_id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from workflows where id = any($1::uuid[])", [created.workflows])
    await pool.query("delete from employee_work_shifts where person_id = any($1::uuid[])", [created.people])
    await pool.query("delete from people where id = any($1::uuid[])", [created.people])
    await pool.query("delete from teams where id = any($1::uuid[])", [created.teams])
    await pool.end()
  })

  it("Individual, Relativo e Consolidado: um lote por disparo, nada duplicado na segunda rodada", async () => {
    const operation = (await pool.query<{ id: string }>("select id from operations where organization_id = $1 limit 1", [ORG])).rows[0]!.id
    const team = (await pool.query<{ id: string }>("insert into teams (organization_id, operation_id, name) values ($1, $2, 'Proof Agenda Lote') returning id", [ORG, operation])).rows[0]!.id
    created.teams.push(team)
    const person = async (name: string, options: { role?: string; active?: boolean } = {}) => {
      const id = (await pool.query<{ id: string }>("insert into people (organization_id, name, role, team_id, active) values ($1, $2, $3, $4, $5) returning id", [ORG, name, options.role ?? "OPERATOR", team, options.active ?? true])).rows[0]!.id
      created.people.push(id)
      return id
    }
    const operators = [await person("Proof Agenda A"), await person("Proof Agenda B"), await person("Proof Agenda C")]
    await person("Proof Agenda Inativo", { active: false })
    await person("Proof Agenda Supervisora", { role: "SUPERVISOR" })
    // Expediente 08:00 + 8h para A e B; C sem jornada (nunca recebe horário inventado).
    for (const operator of operators.slice(0, 2)) await pool.query("insert into employee_work_shifts (organization_id, person_id, start_time, work_minutes, effective_from) values ($1, $2, '08:00', 480, '2026-01-01')", [ORG, operator])

    const workflow = async (name: string, triggerConfig: object, consolidated: object | null = null) => {
      const id = (await pool.query<{ id: string }>("insert into workflows (organization_id, name, scope_type, team_id, trigger_config, consolidated_structure) values ($1, $2, 'TEAM', $3, $4, $5) returning id", [ORG, name, team, JSON.stringify(triggerConfig), consolidated ? JSON.stringify(consolidated) : null])).rows[0]!.id
      created.workflows.push(id)
      const version = (await pool.query<{ id: string }>("insert into workflow_versions (workflow_id, graph) values ($1, $2) returning id", [id, JSON.stringify(GRAPH)])).rows[0]!.id
      await pool.query("update workflows set active_version_id = $2 where id = $1", [id, version])
      return id
    }
    const individual = await workflow("Proof Agenda Individual", { kind: "schedule", mode: "CALENDAR", times: ["08:00", "12:00", "18:00"] })
    const relative = await workflow("Proof Agenda Relativa", { kind: "schedule", mode: "RELATIVE_TO_SHIFT", relative: { anchor: "START", offsetMinutes: 60 } })
    const consolidated = await workflow("Proof Agenda Consolidada", { kind: "schedule", mode: "CALENDAR", times: ["08:00", "12:00"] }, { kind: "TEAM", teamId: team })

    // Uma quarta-feira às 13:00 no fuso da organização: 08:00 e 12:00 venceram, 18:00 ainda não; o expediente das 08:00 + 60 min também.
    const timezone = await resolveOrganizationTimezone(pool as unknown as Database, ORG)
    const now = new Date(zonedTimeToIso("2026-10-14", "13:00", timezone))
    expect(localDateParts(now, timezone)).toMatchObject({ date: "2026-10-14", time: "13:00" })

    const first = await runScheduleCheck(pool as unknown as Database, now)
    // Individual: 3 operadores × 2 horários; Relativo: A e B (C sem jornada); Consolidado: 1 sujeito × 2 horários.
    expect(first.enrolled).toBe(6 + 2 + 2)
    const rows = (await pool.query<{ workflow_id: string; scheduled_subject_id: string; scheduled_for: Date }>(
      "select workflow_id, scheduled_subject_id, scheduled_for from workflow_enrollments where workflow_id = any($1::uuid[]) order by workflow_id, scheduled_for, scheduled_subject_id", [created.workflows],
    )).rows
    const of = (workflowId: string) => rows.filter((row) => row.workflow_id === workflowId)
    expect(of(individual).map((row) => row.scheduled_subject_id).sort()).toEqual([...operators, ...operators].sort())
    expect(new Set(of(individual).map((row) => row.scheduled_for.toISOString()))).toEqual(new Set([zonedTimeToIso("2026-10-14", "08:00", timezone), zonedTimeToIso("2026-10-14", "12:00", timezone)].map((iso) => new Date(iso).toISOString())))
    expect(of(relative).map((row) => row.scheduled_subject_id).sort()).toEqual(operators.slice(0, 2).sort())
    expect(of(relative).every((row) => row.scheduled_for.toISOString() === new Date(zonedTimeToIso("2026-10-14", "09:00", timezone)).toISOString())).toBe(true)
    expect(of(consolidated)).toHaveLength(2)
    expect(new Set(of(consolidated).map((row) => row.scheduled_subject_id)).size).toBe(1)

    // Segunda rodada no mesmo minuto: o índice único absorve tudo.
    expect((await runScheduleCheck(pool as unknown as Database, now)).enrolled).toBe(0)
    // Horário seguinte vence: só ele nasce.
    expect((await runScheduleCheck(pool as unknown as Database, new Date(zonedTimeToIso("2026-10-14", "18:05", timezone)))).enrolled).toBe(3)
    expect((await pool.query("select count(*)::int n from workflow_enrollments where workflow_id = any($1::uuid[])", [created.workflows])).rows[0].n).toBe(13)
  })
})
