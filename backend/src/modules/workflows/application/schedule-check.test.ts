import { describe, expect, it, vi } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { runScheduleCheck } from "./schedule-check.js"

type QueryHandler = (sql: string, params?: unknown[]) => { rows: unknown[]; rowCount: number } | undefined

type WorkflowRow = {
  id: string
  active_version_id: string
  scope_type: string
  team_id: string | null
  trigger_config: Record<string, unknown>
}

/** Fake DB que simula o unique index `workflow_enrollments_schedule_slot_uk`
 * (workflow_id, scheduled_subject_id, scheduled_for) — permite testar idempotência de verdade
 * (2ª chamada com o mesmo slot não insere de novo) sem precisar de Postgres real. */
function fakeDb(workflow: WorkflowRow, extra: QueryHandler = () => undefined): { db: Database; insertedSlots: Set<string> } {
  const insertedSlots = new Set<string>()
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const extraResult = extra(sql, params)
      if (extraResult) return extraResult

      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }

      if (sql.includes("from workflows w") && sql.includes("trigger_config ->> 'kind' = 'schedule'")) {
        return {
          rows: [
            {
              id: workflow.id,
              version_id: workflow.active_version_id,
              scope_type: workflow.scope_type,
              team_id: workflow.team_id,
              times: workflow.trigger_config.times,
              interval_days: workflow.trigger_config.intervalDays ?? 1,
              anchor_date: workflow.trigger_config.anchorDate ?? null,
              frequency: workflow.trigger_config.frequency ?? null,
            },
          ],
          rowCount: 1,
        }
      }

      if (sql.includes("from people") && sql.includes("role = 'OPERATOR'")) {
        return { rows: [{ id: "operator-1" }], rowCount: 1 }
      }

      if (sql.includes("from workflow_versions")) {
        return { rows: [{ graph: { nodes: [{ id: "trigger", type: "trigger" }] } }], rowCount: 1 }
      }

      if (sql.trim().startsWith("insert into workflow_enrollments")) {
        const scheduledFor = params?.[4] as string
        const slot = `${workflow.id}:operator-1:${scheduledFor}`
        if (insertedSlots.has(slot)) return { rows: [], rowCount: 0 } // on conflict do nothing
        insertedSlots.add(slot)
        return { rows: [{ id: "enrollment-1" }], rowCount: 1 }
      }

      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return { db, insertedSlots }
}

const BASE_WORKFLOW: WorkflowRow = {
  id: "wf-1",
  active_version_id: "version-1",
  scope_type: "ALL_TEAMS",
  team_id: null,
  trigger_config: { times: ["09:00"] },
}

describe("runScheduleCheck — timezone real (Parte 9 do pedido)", () => {
  it("resolve o horário a partir de operations.timezone, não de UTC hardcoded", async () => {
    // 12:00 UTC == 09:00 em America/Fortaleza (UTC-3) — se o checador ainda usasse UTC puro,
    // "09:00" nunca bateria com esse instante.
    const { db, insertedSlots } = fakeDb(BASE_WORKFLOW)
    const result = await runScheduleCheck(db, new Date("2026-09-14T12:00:00.000Z"))
    expect(result.enrolled).toBe(1)
    expect(insertedSlots.size).toBe(1)
  })

  it("não matricula antes do horário local (11:00 UTC = 08:00 em Fortaleza, ainda não bateu 09:00)", async () => {
    const { db } = fakeDb(BASE_WORKFLOW)
    const result = await runScheduleCheck(db, new Date("2026-09-14T11:00:00.000Z"))
    expect(result.enrolled).toBe(0)
  })
})

describe("runScheduleCheck — catch-up dentro do mesmo dia (Parte 25 do pedido)", () => {
  it("recupera todos os horários já vencidos do dia quando o checador roda atrasado", async () => {
    const workflow: WorkflowRow = { ...BASE_WORKFLOW, trigger_config: { times: ["09:00", "12:00", "15:00"] } }
    const { db } = fakeDb(workflow)
    // 18:00 em Fortaleza — os 3 horários do dia já venceram, todos recuperados de uma vez.
    const result = await runScheduleCheck(db, new Date("2026-09-14T21:00:00.000Z"))
    expect(result.enrolled).toBe(3)
  })
})

describe("runScheduleCheck — idempotência (Parte 24 do pedido, via unique index já existente)", () => {
  it("rodar o checador duas vezes pro mesmo horário não duplica matrícula", async () => {
    const { db, insertedSlots } = fakeDb(BASE_WORKFLOW)
    const now = new Date("2026-09-14T12:00:00.000Z")
    const first = await runScheduleCheck(db, now)
    const second = await runScheduleCheck(db, now)
    expect(first.enrolled).toBe(1)
    expect(second.enrolled).toBe(0) // "on conflict do nothing" — mesmo slot, sem nova linha
    expect(insertedSlots.size).toBe(1)
  })
})

describe("runScheduleCheck — frequência (evolução do Trigger por agenda)", () => {
  it("MONTHLY só matricula no dia configurado", async () => {
    const workflow: WorkflowRow = { ...BASE_WORKFLOW, trigger_config: { times: ["09:00"], frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } } }
    const { db: dbOnDay } = fakeDb(workflow)
    const onDay = await runScheduleCheck(dbOnDay, new Date("2026-09-05T12:00:00.000Z"))
    expect(onDay.enrolled).toBe(1)

    const { db: dbOffDay } = fakeDb(workflow)
    const offDay = await runScheduleCheck(dbOffDay, new Date("2026-09-06T12:00:00.000Z"))
    expect(offDay.enrolled).toBe(0)
  })

  it("WEEKLY só matricula nos dias da semana configurados", async () => {
    const workflow: WorkflowRow = { ...BASE_WORKFLOW, trigger_config: { times: ["09:00"], frequency: { type: "WEEKLY", weekdays: ["MON"] } } }
    // 2026-09-14 é uma segunda-feira.
    const { db: dbMonday } = fakeDb(workflow)
    const monday = await runScheduleCheck(dbMonday, new Date("2026-09-14T12:00:00.000Z"))
    expect(monday.enrolled).toBe(1)

    const { db: dbTuesday } = fakeDb(workflow)
    const tuesday = await runScheduleCheck(dbTuesday, new Date("2026-09-15T12:00:00.000Z"))
    expect(tuesday.enrolled).toBe(0)
  })

  it("shape legado (frequency ausente, intervalDays > 1) continua funcionando sem migração", async () => {
    const workflow: WorkflowRow = { ...BASE_WORKFLOW, trigger_config: { times: ["09:00"], intervalDays: 3, anchorDate: "2026-09-14" } }
    const { db: dbOnCycle } = fakeDb(workflow)
    const onCycle = await runScheduleCheck(dbOnCycle, new Date("2026-09-17T12:00:00.000Z")) // diff 3
    expect(onCycle.enrolled).toBe(1)

    const { db: dbOffCycle } = fakeDb(workflow)
    const offCycle = await runScheduleCheck(dbOffCycle, new Date("2026-09-15T12:00:00.000Z")) // diff 1
    expect(offCycle.enrolled).toBe(0)
  })
})

type OperatorFixture = { id: string; shift?: { start_time: string; work_minutes: number } }

/** Mesma técnica de `fakeDb` acima, ampliada pra suportar múltiplos operadores (cada um com sua
 * própria jornada ou nenhuma) — necessário pra testar a Agenda relativa ao expediente, onde cada
 * colaborador pode ter um `scheduled_for` individual diferente. */
function fakeDbRelative(workflow: WorkflowRow, operators: OperatorFixture[], extra: QueryHandler = () => undefined): { db: Database; insertedSlots: Set<string> } {
  const insertedSlots = new Set<string>()
  const db = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      const extraResult = extra(sql, params)
      if (extraResult) return extraResult

      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }

      if (sql.includes("from workflows w") && sql.includes("trigger_config ->> 'kind' = 'schedule'")) {
        return {
          rows: [
            {
              id: workflow.id,
              version_id: workflow.active_version_id,
              scope_type: workflow.scope_type,
              team_id: workflow.team_id,
              mode: workflow.trigger_config.mode ?? null,
              times: workflow.trigger_config.times ?? [],
              interval_days: workflow.trigger_config.intervalDays ?? 1,
              anchor_date: workflow.trigger_config.anchorDate ?? null,
              frequency: workflow.trigger_config.frequency ?? null,
              relative: workflow.trigger_config.relative ?? null,
            },
          ],
          rowCount: 1,
        }
      }

      if (sql.includes("from people") && sql.includes("role = 'OPERATOR'")) {
        return { rows: operators.map((operator) => ({ id: operator.id })), rowCount: operators.length }
      }

      if (sql.includes("from employee_work_shifts")) {
        const rows = operators.filter((operator) => operator.shift).map((operator) => ({ person_id: operator.id, ...operator.shift }))
        return { rows, rowCount: rows.length }
      }

      if (sql.includes("from workflow_versions")) {
        return { rows: [{ graph: { nodes: [{ id: "trigger", type: "trigger" }] } }], rowCount: 1 }
      }

      if (sql.trim().startsWith("insert into workflow_enrollments")) {
        const operatorId = params?.[3] as string
        const scheduledFor = params?.[4] as string
        const slot = `${workflow.id}:${operatorId}:${scheduledFor}`
        if (insertedSlots.has(slot)) return { rows: [], rowCount: 0 }
        insertedSlots.add(slot)
        return { rows: [{ id: "enrollment-1" }], rowCount: 1 }
      }

      return { rows: [], rowCount: 0 }
    }),
  } as unknown as Database
  return { db, insertedSlots }
}

describe("runScheduleCheck — Agenda relativa ao expediente (evolução do Trigger por agenda)", () => {
  // 2026-09-14 é uma segunda-feira (dia de trabalho assumido).
  const RELATIVE_WORKFLOW: WorkflowRow = {
    id: "wf-relative",
    active_version_id: "version-1",
    scope_type: "ALL_TEAMS",
    team_id: null,
    trigger_config: { mode: "RELATIVE_TO_SHIFT", relative: { anchor: "START", offsetMinutes: 15 } },
  }

  it("colaboradores com jornadas diferentes disparam em horários (scheduled_for) diferentes", async () => {
    const operators: OperatorFixture[] = [
      { id: "joao", shift: { start_time: "08:00", work_minutes: 480 } },
      { id: "maria", shift: { start_time: "09:00", work_minutes: 480 } },
    ]
    const { db, insertedSlots } = fakeDbRelative(RELATIVE_WORKFLOW, operators)
    // 20:00 em Fortaleza — bem depois dos dois horários individuais (08:15/09:15).
    const result = await runScheduleCheck(db, new Date("2026-09-14T23:00:00.000Z"))
    expect(result.enrolled).toBe(2)
    expect([...insertedSlots]).toEqual(
      expect.arrayContaining([`wf-relative:joao:2026-09-14T11:15:00.000Z`, `wf-relative:maria:2026-09-14T12:15:00.000Z`]),
    )
  })

  it("colaborador sem jornada configurada nunca é matriculado — nunca inventa horário (Parte 29)", async () => {
    const operators: OperatorFixture[] = [{ id: "joao", shift: { start_time: "08:00", work_minutes: 480 } }, { id: "sem-jornada" }]
    const { db } = fakeDbRelative(RELATIVE_WORKFLOW, operators)
    const result = await runScheduleCheck(db, new Date("2026-09-14T23:00:00.000Z"))
    expect(result.enrolled).toBe(1)
  })

  it("nunca dispara antes do horário individual calculado", async () => {
    const operators: OperatorFixture[] = [{ id: "joao", shift: { start_time: "08:00", work_minutes: 480 } }]
    const { db } = fakeDbRelative(RELATIVE_WORKFLOW, operators)
    // 11:00 UTC = 08:00 em Fortaleza — a regra é "15 min após o início", ainda não venceu.
    const result = await runScheduleCheck(db, new Date("2026-09-14T11:00:00.000Z"))
    expect(result.enrolled).toBe(0)
  })

  it("fim de semana nunca dispara Agenda relativa (dia de trabalho assumido — Parte 16)", async () => {
    const operators: OperatorFixture[] = [{ id: "joao", shift: { start_time: "08:00", work_minutes: 480 } }]
    const { db } = fakeDbRelative(RELATIVE_WORKFLOW, operators)
    // 2026-09-19 é um sábado.
    const result = await runScheduleCheck(db, new Date("2026-09-19T23:00:00.000Z"))
    expect(result.enrolled).toBe(0)
  })

  it("idempotência: rodar o checador duas vezes não duplica matrícula relativa", async () => {
    const operators: OperatorFixture[] = [{ id: "joao", shift: { start_time: "08:00", work_minutes: 480 } }]
    const { db, insertedSlots } = fakeDbRelative(RELATIVE_WORKFLOW, operators)
    const now = new Date("2026-09-14T23:00:00.000Z")
    const first = await runScheduleCheck(db, now)
    const second = await runScheduleCheck(db, now)
    expect(first.enrolled).toBe(1)
    expect(second.enrolled).toBe(0)
    expect(insertedSlots.size).toBe(1)
  })

  it("mudança de jornada: o próximo tick já calcula o horário novo (lê a jornada vigente sempre fresca — Parte 28)", async () => {
    const before: OperatorFixture[] = [{ id: "joao", shift: { start_time: "08:00", work_minutes: 480 } }]
    const { db: dbBefore, insertedSlots: slotsBefore } = fakeDbRelative(RELATIVE_WORKFLOW, before)
    await runScheduleCheck(dbBefore, new Date("2026-09-14T11:30:00.000Z")) // 08:30 -03:00, já bateu 08:15
    expect([...slotsBefore]).toEqual(["wf-relative:joao:2026-09-14T11:15:00.000Z"])

    // Jornada mudou pra entrada 09:00 antes do próximo tick — nenhum job "órfão" das 08:15, o
    // motor nunca precisou de invalidação explícita porque sempre lê a jornada vigente do zero.
    const after: OperatorFixture[] = [{ id: "joao", shift: { start_time: "09:00", work_minutes: 480 } }]
    const { db: dbAfter, insertedSlots: slotsAfter } = fakeDbRelative(RELATIVE_WORKFLOW, after)
    await runScheduleCheck(dbAfter, new Date("2026-09-14T12:30:00.000Z")) // 09:30 -03:00, já bateu 09:15
    expect([...slotsAfter]).toEqual(["wf-relative:joao:2026-09-14T12:15:00.000Z"])
  })
})

// Modo de Avaliação (refatoração de "Unidade de Análise" em Individual/Consolidado + Filtro
// Populacional/Estrutura Consolidada). Fake DB dedicado: diferencia a query de "todo operador da
// Abrangência" (ALL) da query de "equipe direta de um Supervisor" (SUPERVISOR_TEAM), pra provar
// que o Filtro Populacional realmente restringe o conjunto — nunca vira uma análise agregada.
describe("runScheduleCheck — Modo de Avaliação (Individual com Filtro Populacional x Consolidado)", () => {
  const SCOPE_OPERATORS = ["op-1", "op-2", "op-3", "op-4", "op-5"] // toda a Abrangência
  const CARLOS_TEAM = ["op-1", "op-2"] // só a equipe direta do Supervisor Carlos

  function fakeDbAnalysisMode(workflow: {
    id: string
    consolidated_structure?: unknown
    population_filter?: unknown
  }) {
    const insertedSlots = new Set<string>()
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("trigger_config ->> 'kind' = 'schedule'")) {
          return {
            rows: [
              {
                id: workflow.id,
                version_id: "version-1",
                scope_type: "ALL_TEAMS",
                team_id: null,
                times: ["09:00"],
                interval_days: 1,
                anchor_date: null,
                frequency: null,
                consolidated_structure: workflow.consolidated_structure ?? null,
                population_filter: workflow.population_filter ?? null,
              },
            ],
            rowCount: 1,
          }
        }
        // Equipe DIRETA do Supervisor Carlos — query mais específica, checada ANTES da genérica.
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) {
          return { rows: CARLOS_TEAM.map((id) => ({ id })), rowCount: CARLOS_TEAM.length }
        }
        // Todo operador ativo da Abrangência (Filtro ALL, ou ausente).
        if (sql.includes("from people") && sql.includes("role = 'OPERATOR' and active")) {
          return { rows: SCOPE_OPERATORS.map((id) => ({ id })), rowCount: SCOPE_OPERATORS.length }
        }
        if (sql.includes("from workflow_versions")) {
          return { rows: [{ graph: { nodes: [{ id: "trigger", type: "trigger" }] } }], rowCount: 1 }
        }
        if (sql.trim().startsWith("insert into workflow_enrollments")) {
          const operatorId = params?.[3] as string
          const scheduledFor = params?.[4] as string
          const slot = `${workflow.id}:${operatorId}:${scheduledFor}`
          if (insertedSlots.has(slot)) return { rows: [], rowCount: 0 }
          insertedSlots.add(slot)
          return { rows: [{ id: "enrollment-1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    return { db, insertedSlots }
  }

  it("Individual sem filtro (ausente = ALL): uma matrícula por operador de TODA a Abrangência", async () => {
    const { db, insertedSlots } = fakeDbAnalysisMode({ id: "wf-individual-all" })
    const result = await runScheduleCheck(db, new Date("2026-09-14T12:00:00.000Z"))
    expect(result.enrolled).toBe(SCOPE_OPERATORS.length)
    expect(insertedSlots.size).toBe(5)
  })

  it("Individual com Filtro Populacional (Equipe de Supervisor Carlos): uma matrícula por operador do FILTRO, nunca da Abrangência inteira", async () => {
    const { db, insertedSlots } = fakeDbAnalysisMode({
      id: "wf-individual-filtered",
      population_filter: { kind: "SUPERVISOR_TEAM", supervisorId: "carlos" },
    })
    const result = await runScheduleCheck(db, new Date("2026-09-14T12:00:00.000Z"))
    expect(result.enrolled).toBe(2)
    expect([...insertedSlots].map((slot) => slot.split(":")[1])).toEqual(expect.arrayContaining(CARLOS_TEAM))
  })

  it("Consolidado (Equipe de Supervisor Carlos): UMA ÚNICA matrícula, sujeito Carlos — nunca uma por operador da equipe (sem fan-out)", async () => {
    const { db, insertedSlots } = fakeDbAnalysisMode({
      id: "wf-consolidated",
      consolidated_structure: { kind: "SUPERVISOR_TEAM", supervisorId: "carlos" },
    })
    const result = await runScheduleCheck(db, new Date("2026-09-14T12:00:00.000Z"))
    expect(result.enrolled).toBe(1)
    expect([...insertedSlots]).toEqual(["wf-consolidated:carlos:2026-09-14T12:00:00.000Z"])
  })

  it("Agenda relativa ao expediente também aplica o Filtro Populacional (lacuna real — antes desta refatoração sempre usava todo operador da Abrangência)", async () => {
    const insertedSlots = new Set<string>()
    const shiftsByPerson: Record<string, { start_time: string; work_minutes: number }> = {
      "op-1": { start_time: "08:00", work_minutes: 480 },
      "op-2": { start_time: "08:00", work_minutes: 480 },
      "op-3": { start_time: "08:00", work_minutes: 480 },
    }
    const db = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("trigger_config ->> 'kind' = 'schedule'")) {
          return {
            rows: [
              {
                id: "wf-relative-filtered",
                version_id: "version-1",
                scope_type: "ALL_TEAMS",
                team_id: null,
                mode: "RELATIVE_TO_SHIFT",
                relative: { anchor: "START", offsetMinutes: 15 },
                times: [],
                interval_days: 1,
                anchor_date: null,
                frequency: null,
                consolidated_structure: null,
                population_filter: { kind: "SUPERVISOR_TEAM", supervisorId: "carlos" },
              },
            ],
            rowCount: 1,
          }
        }
        // Equipe DIRETA do Supervisor Carlos — só op-1 e op-2 (nunca op-3, que está no restante
        // da Abrangência mas fora do filtro).
        if (sql.includes("reports_to_id = $1 and role = 'OPERATOR'")) return { rows: [{ id: "op-1" }, { id: "op-2" }], rowCount: 2 }
        // Abrangência (Abrangência E filtro — workflow-eligibility.ts): op-1..op-3 estão na Abrangência.
        if (sql.includes("role = 'OPERATOR' and active")) return { rows: [{ id: "op-1" }, { id: "op-2" }, { id: "op-3" }], rowCount: 3 }
        if (sql.includes("from employee_work_shifts")) {
          const ids = params?.[0] as string[]
          return { rows: ids.filter((id) => shiftsByPerson[id]).map((id) => ({ person_id: id, ...shiftsByPerson[id] })), rowCount: ids.length }
        }
        if (sql.includes("from workflow_versions")) return { rows: [{ graph: { nodes: [{ id: "trigger", type: "trigger" }] } }], rowCount: 1 }
        if (sql.trim().startsWith("insert into workflow_enrollments")) {
          const operatorId = params?.[3] as string
          const scheduledFor = params?.[4] as string
          const slot = `${operatorId}:${scheduledFor}`
          insertedSlots.add(slot)
          return { rows: [{ id: "enrollment-1" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database
    // 2026-09-14 é segunda-feira; 20:00 em Fortaleza é bem depois de 08:15.
    const result = await runScheduleCheck(db, new Date("2026-09-14T23:00:00.000Z"))
    expect(result.enrolled).toBe(2)
    expect([...insertedSlots].map((slot) => slot.split(":")[0])).toEqual(expect.arrayContaining(["op-1", "op-2"]))
    expect([...insertedSlots].some((slot) => slot.startsWith("op-3"))).toBe(false)
  })
})

describe("runScheduleCheck — organização de cada Workflow (nunca uma organização fixa)", () => {
  it("cada Workflow é resolvido no fuso e na população da PRÓPRIA organização, e a matrícula nasce nela", async () => {
    const ORG_A = "00000000-0000-4000-8000-0000000000aa"
    const ORG_B = "00000000-0000-4000-8000-0000000000bb"
    const timezones: Record<string, string> = { [ORG_A]: "America/Fortaleza", [ORG_B]: "America/Rio_Branco" }
    const operatorsOf: Record<string, string> = { [ORG_A]: "op-a", [ORG_B]: "op-b" }
    const populationLookups: unknown[] = []
    const inserts: unknown[][] = []
    const db = {
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes("from operations")) return { rows: [{ timezone: timezones[params[0] as string] }], rowCount: 1 }
        if (sql.includes("from workflows w") && sql.includes("trigger_config ->> 'kind' = 'schedule'")) {
          const row = (organizationId: string, id: string) => ({ organization_id: organizationId, id, version_id: `${id}-v1`, scope_type: "ALL_TEAMS", team_id: null, subteam_id: null, times: ["09:00"], interval_days: 1, anchor_date: null, frequency: null })
          return { rows: [row(ORG_A, "wf-a"), row(ORG_B, "wf-b")], rowCount: 2 }
        }
        if (sql.includes("from workflow_versions")) return { rows: [{ graph: { nodes: [{ id: "trigger", type: "trigger" }] } }], rowCount: 1 }
        if (sql.includes("from people") && sql.includes("role = 'OPERATOR'")) {
          populationLookups.push(params[0])
          return { rows: [{ id: operatorsOf[params[0] as string] }], rowCount: 1 }
        }
        if (sql.trim().startsWith("insert into workflow_enrollments")) {
          inserts.push(params)
          return { rows: [{ id: "enrollment" }], rowCount: 1 }
        }
        return { rows: [], rowCount: 0 }
      }),
    } as unknown as Database

    // 12:30 UTC = 09:30 em Fortaleza (UTC-3, horário vencido) e 07:30 em Rio Branco (UTC-5, ainda não).
    const result = await runScheduleCheck(db, new Date("2026-09-14T12:30:00.000Z"))
    expect(result.enrolled).toBe(1)
    expect(inserts).toEqual([[ORG_A, "wf-a", "wf-a-v1", "op-a", "2026-09-14T12:00:00.000Z", "trigger"]])
    expect(populationLookups).toEqual([ORG_A])

    // 14:30 UTC = 09:30 em Rio Branco: agora o Workflow da organização B matricula a população DELA, com a organização DELA.
    inserts.length = 0
    populationLookups.length = 0
    await runScheduleCheck(db, new Date("2026-09-14T14:30:00.000Z"))
    expect(inserts).toEqual(expect.arrayContaining([[ORG_B, "wf-b", "wf-b-v1", "op-b", "2026-09-14T14:00:00.000Z", "trigger"]]))
    expect(inserts.every((params) => params[0] === (params[1] === "wf-a" ? ORG_A : ORG_B))).toBe(true)
    expect(populationLookups).toEqual(expect.arrayContaining([ORG_A, ORG_B]))
  })
})
