import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { DomainError } from "../../../shared/domain/domain-error.js"
import type { WorkflowConfiguration } from "../domain/workflow-configuration.js"
import { assertGoLiveConfirmed, computeGoLiveImpact, confirmationReasons, GO_LIVE_CONFIRMATION_POPULATION } from "./go-live-impact.js"

const ORG = "00000000-0000-4000-8000-000000000001"

function operators(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`)
}

/** Dublê mínimo: fuso da organização (America/Fortaleza, UTC-3), operadores elegíveis e matrículas de agenda já existentes. */
function fakeDb(input: { operatorIds: string[]; existing?: { subjectId: string; scheduledFor: string }[] }): Database {
  return {
    query: async (sql: string) => {
      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
      if (sql.includes("from people") && sql.includes("role = 'OPERATOR'")) return { rows: input.operatorIds.map((id) => ({ id })), rowCount: input.operatorIds.length }
      if (sql.includes("from workflow_enrollments")) {
        const rows = (input.existing ?? []).map((slot) => ({ subject_id: slot.subjectId, scheduled_for: slot.scheduledFor }))
        return { rows, rowCount: rows.length }
      }
      return { rows: [], rowCount: 0 }
    },
    connect: async () => {
      throw new Error("sem transação aqui")
    },
  } as unknown as Database
}

const MANUAL: WorkflowConfiguration = { triggerConfig: { kind: "manual", context: "COLLABORATOR" }, scopeType: "ALL_TEAMS", teamId: null, subteamId: null, consolidatedStructure: null, populationFilter: null }
/** O gatilho do incidente: todo dia 5 às 18:30, para todos os colaboradores. */
const MONTHLY_DAY_5: WorkflowConfiguration = {
  ...MANUAL,
  triggerConfig: { kind: "schedule", mode: "CALENDAR", times: ["18:30"], intervalDays: 1, frequency: { type: "MONTHLY", mode: "DAY_OF_MONTH", day: 5 } },
}
// 2026-10-05 18:45 em America/Fortaleza — 15 minutos depois do horário do dia.
const NOW_AFTER = new Date("2026-10-05T21:45:00.000Z")
const TODAY_1830 = "2026-10-05T21:30:00.000Z"

describe("confirmationReasons — regra pura", () => {
  const base = { reason: "PUBLISH" as const, goesLive: true, isSchedule: true, firstPublication: false, changes: [], population: 10, immediateEnrollments: 0 }

  it("catch-up imediato sempre exige confirmação", () => {
    expect(confirmationReasons({ ...base, immediateEnrollments: 1 })).toEqual(["IMMEDIATE_CATCH_UP"])
  })

  it("população grande só exige quando a configuração é nova para o runtime", () => {
    const large = { ...base, population: GO_LIVE_CONFIRMATION_POPULATION + 1 }
    expect(confirmationReasons(large)).toEqual([]) // republicar só o grafo de uma Agenda que já roda
    expect(confirmationReasons({ ...large, changes: ["TRIGGER"] })).toEqual(["LARGE_POPULATION"])
    expect(confirmationReasons({ ...large, firstPublication: true })).toEqual(["LARGE_POPULATION"])
    expect(confirmationReasons({ ...large, reason: "ACTIVATE" })).toEqual(["LARGE_POPULATION"])
    expect(confirmationReasons({ ...base, population: GO_LIVE_CONFIRMATION_POPULATION, changes: ["TRIGGER"] })).toEqual([]) // limite é "mais de"
  })

  it("Workflow inativo ou gatilho que não é Agenda nunca pede confirmação", () => {
    expect(confirmationReasons({ ...base, goesLive: false, immediateEnrollments: 9 })).toEqual([])
    expect(confirmationReasons({ ...base, isSchedule: false, immediateEnrollments: 9 })).toEqual([])
  })
})

describe("computeGoLiveImpact — o incidente de 2026-10-05", () => {
  it("Manual → Agenda mensal dia 5 às 18:30, publicada às 18:45 do dia 5 para 2.264 pessoas: catch-up imediato visível e confirmação exigida", async () => {
    const ids = operators(2264)
    const impact = await computeGoLiveImpact(fakeDb({ operatorIds: ids }), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: MONTHLY_DAY_5, published: MANUAL, active: true, now: NOW_AFTER })
    expect(impact.configurationChanges).toEqual(["TRIGGER"])
    expect(impact.schedule).toMatchObject({
      mode: "CALENDAR",
      evaluation: "INDIVIDUAL",
      population: 2264,
      enrollmentsPerOccurrence: 2264,
      immediate: { enrollments: 2264, alreadyEnrolled: 0, scheduledFor: [TODAY_1830] },
      firstFireAt: TODAY_1830,
      firesImmediately: true,
      timezone: "America/Fortaleza",
    })
    expect(impact.requiresConfirmation).toBe(true)
    expect(impact.reasons).toEqual(["IMMEDIATE_CATCH_UP", "LARGE_POPULATION"])

    // Sem o fingerprint: 409 com o impacto para a tela mostrar; com ele, passa.
    let refused: DomainError | null = null
    try {
      assertGoLiveConfirmed(impact, undefined)
    } catch (error) {
      refused = error as DomainError
    }
    expect(refused?.code).toBe("WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED")
    expect(refused?.statusCode).toBe(409)
    expect((refused?.details as { impact: { fingerprint: string } }).impact.fingerprint).toBe(impact.fingerprint)
    expect(() => assertGoLiveConfirmed(impact, impact.fingerprint)).not.toThrow()
    expect(() => assertGoLiveConfirmed(impact, "outro-impacto")).toThrow(/mudou desde a confirmação/)
  })

  it("antes do horário de hoje: nada dispara agora, primeiro disparo = hoje às 18:30, e a população pequena não pede confirmação", async () => {
    const impact = await computeGoLiveImpact(fakeDb({ operatorIds: operators(3) }), ORG, {
      workflowId: "wf",
      reason: "PUBLISH",
      configuration: MONTHLY_DAY_5,
      published: MANUAL,
      active: true,
      now: new Date("2026-10-05T20:00:00.000Z"), // 17:00 local
    })
    expect(impact.schedule).toMatchObject({ immediate: { enrollments: 0, scheduledFor: [] }, firstFireAt: TODAY_1830, firesImmediately: false })
    expect(impact.requiresConfirmation).toBe(false)
  })

  it("slots já matriculados hoje não contam como catch-up (o índice único nunca duplica)", async () => {
    const ids = operators(4)
    const impact = await computeGoLiveImpact(fakeDb({ operatorIds: ids, existing: ids.map((subjectId) => ({ subjectId, scheduledFor: "2026-10-05 18:30:00-03" })) }), ORG, {
      workflowId: "wf",
      reason: "PUBLISH",
      configuration: MONTHLY_DAY_5,
      published: MONTHLY_DAY_5,
      active: true,
      now: NOW_AFTER,
    })
    expect(impact.schedule?.immediate).toEqual({ enrollments: 0, alreadyEnrolled: 4, scheduledFor: [] })
    expect(impact.schedule?.firstFireAt).toBe("2026-11-05T21:30:00.000Z") // próxima ocorrência: 5 de novembro
    expect(impact.requiresConfirmation).toBe(false)
  })

  it("Workflow inativo: publicar não põe a Agenda no ar (o impacto é pedido de novo ao ativar)", async () => {
    const impact = await computeGoLiveImpact(fakeDb({ operatorIds: operators(2264) }), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: MONTHLY_DAY_5, published: MANUAL, active: false, now: NOW_AFTER })
    expect(impact.schedule).toBeNull()
    expect(impact.requiresConfirmation).toBe(false)

    const activation = await computeGoLiveImpact(fakeDb({ operatorIds: operators(2264) }), ORG, { workflowId: "wf", reason: "ACTIVATE", configuration: MONTHLY_DAY_5, published: MONTHLY_DAY_5, active: true, now: NOW_AFTER })
    expect(activation.reasons).toEqual(["IMMEDIATE_CATCH_UP", "LARGE_POPULATION"])
    expect(() => assertGoLiveConfirmed(activation, undefined)).toThrow(expect.objectContaining({ code: "WORKFLOW_ACTIVATION_CONFIRMATION_REQUIRED" }))
  })

  it("Flag/Indicador/Manual não criam matrícula ao entrar no ar — sem impacto de agenda", async () => {
    const impact = await computeGoLiveImpact(fakeDb({ operatorIds: operators(2264) }), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: MANUAL, published: MONTHLY_DAY_5, active: true, now: NOW_AFTER })
    expect(impact.schedule).toBeNull()
    expect(impact.configurationChanges).toEqual(["TRIGGER"])
    expect(impact.requiresConfirmation).toBe(false)
  })

  it("o fingerprint muda quando o impacto muda (outra população, outro catch-up)", async () => {
    const input = { workflowId: "wf", reason: "PUBLISH" as const, configuration: MONTHLY_DAY_5, published: MANUAL, active: true, now: NOW_AFTER }
    const a = await computeGoLiveImpact(fakeDb({ operatorIds: operators(60) }), ORG, input)
    const b = await computeGoLiveImpact(fakeDb({ operatorIds: operators(60) }), ORG, input)
    const c = await computeGoLiveImpact(fakeDb({ operatorIds: operators(61) }), ORG, input)
    expect(a.fingerprint).toBe(b.fingerprint)
    expect(c.fingerprint).not.toBe(a.fingerprint)
  })
})
