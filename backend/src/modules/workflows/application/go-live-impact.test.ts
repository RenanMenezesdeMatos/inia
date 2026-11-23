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
function fakeDb(input: { operatorIds: string[]; existing?: { subjectId: string; scheduledFor: string }[]; /** Quem tem conta de acesso ativa (ausente = todos). */ withAccessIds?: string[] }): Database {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from operations")) return { rows: [{ timezone: "America/Fortaleza" }], rowCount: 1 }
      if (sql.includes("from people") && sql.includes("role = 'OPERATOR'")) {
        // $6 = "Somente quem tem acesso ativo à INIA" (hierarchy-subjects.ts › resolveScopeOperatorIds).
        const ids = params[5] === true && input.withAccessIds ? input.operatorIds.filter((id) => input.withAccessIds!.includes(id)) : input.operatorIds
        return { rows: ids.map((id) => ({ id })), rowCount: ids.length }
      }
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

const MANUAL: WorkflowConfiguration = { triggerConfig: { kind: "manual", context: "COLLABORATOR" }, scopeType: "ALL_TEAMS", scopeLinks: [], teamId: null, subteamId: null, consolidatedStructure: null, populationFilter: null, operatingUniverse: null }
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

  it("desligar 'Somente quem tem acesso ativo' com gente sem acesso exige confirmação em QUALQUER gatilho — só ao publicar", () => {
    const flag = { ...base, isSchedule: false, changes: ["ANALYSIS" as const] }
    expect(confirmationReasons({ ...flag, accessRequirementRemovedFor: 285 })).toEqual(["ACCESS_REQUIREMENT_REMOVED"])
    expect(confirmationReasons({ ...flag, accessRequirementRemovedFor: 0 })).toEqual([])
    expect(confirmationReasons({ ...flag, reason: "ACTIVATE", accessRequirementRemovedFor: 285 })).toEqual([])
    expect(confirmationReasons({ ...flag, goesLive: false, accessRequirementRemovedFor: 285 })).toEqual([])
    // Em Agenda soma-se às razões de sempre.
    expect(confirmationReasons({ ...base, changes: ["ANALYSIS"], population: 300, accessRequirementRemovedFor: 285 })).toEqual(["LARGE_POPULATION", "ACCESS_REQUIREMENT_REMOVED"])
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

describe('computeGoLiveImpact — "Somente quem tem acesso ativo à INIA"', () => {
  /** Piloto: Subgrupo de 300 pessoas, 15 com conta de acesso ativa. Gatilho por Flag (monitoria): o Filtro Populacional não existe aqui. */
  const everyone = operators(300)
  const pilot = everyone.slice(0, 15)
  const FLAG: WorkflowConfiguration = { ...MANUAL, triggerConfig: { kind: "channel_flag", channelFlagId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } as WorkflowConfiguration["triggerConfig"], scopeType: "SUBTEAM", subteamId: "22222222-2222-4222-8222-222222222221" }
  const FLAG_ONLY_ACCESS: WorkflowConfiguration = { ...FLAG, requireActiveAccess: true }
  const db = () => fakeDb({ operatorIds: everyone, withAccessIds: pilot })

  it("opção ligada: o impacto diz quantos entram hoje (15 de 300), em qualquer gatilho, sem exigir confirmação", async () => {
    const impact = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: FLAG_ONLY_ACCESS, published: null, active: true, now: NOW_AFTER })
    expect(impact.schedule).toBeNull()
    expect(impact.access).toEqual({ required: true, removed: false, population: 300, withAccess: 15, withoutAccess: 285 })
    expect(impact.requiresConfirmation).toBe(false)
  })

  it("opção nunca usada: nenhum cálculo extra e o mesmo fingerprint de antes da opção existir", async () => {
    const impact = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: FLAG, published: FLAG, active: true, now: NOW_AFTER })
    expect(impact.access).toBeNull()
    expect(impact.requiresConfirmation).toBe(false)
    const explicitOff = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: { ...FLAG, requireActiveAccess: false }, published: FLAG, active: true, now: NOW_AFTER })
    expect(explicitOff.access).toBeNull()
  })

  it("desligar a opção num Workflow no ar: 285 pessoas sem acesso passam a entrar — exige confirmação com o fingerprint visto", async () => {
    const impact = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: FLAG, published: FLAG_ONLY_ACCESS, active: true, now: NOW_AFTER })
    expect(impact.configurationChanges).toEqual(["ANALYSIS"])
    expect(impact.access).toEqual({ required: false, removed: true, population: 300, withAccess: 15, withoutAccess: 285 })
    expect(impact.reasons).toEqual(["ACCESS_REQUIREMENT_REMOVED"])
    expect(() => assertGoLiveConfirmed(impact, undefined)).toThrow(expect.objectContaining({ code: "WORKFLOW_PUBLISH_CONFIRMATION_REQUIRED", message: expect.stringContaining("285 pessoa(s) sem acesso ativo") }))
    expect(() => assertGoLiveConfirmed(impact, impact.fingerprint)).not.toThrow()
    // O número mudou entre a prévia e o clique (alguém recebeu acesso): o fingerprint antigo não vale mais.
    const later = await computeGoLiveImpact(fakeDb({ operatorIds: everyone, withAccessIds: everyone.slice(0, 16) }), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: FLAG, published: FLAG_ONLY_ACCESS, active: true, now: NOW_AFTER })
    expect(later.fingerprint).not.toBe(impact.fingerprint)
  })

  it("desligar a opção quando todos já têm acesso, ou com o Workflow inativo, não pede confirmação", async () => {
    const allWithAccess = await computeGoLiveImpact(fakeDb({ operatorIds: pilot, withAccessIds: pilot }), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: FLAG, published: FLAG_ONLY_ACCESS, active: true, now: NOW_AFTER })
    expect(allWithAccess.access).toMatchObject({ removed: true, withoutAccess: 0 })
    expect(allWithAccess.requiresConfirmation).toBe(false)
    const inactive = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: FLAG, published: FLAG_ONLY_ACCESS, active: false, now: NOW_AFTER })
    expect(inactive.requiresConfirmation).toBe(false)
  })

  it("Agenda com a opção ligada: a população da ocorrência e o catch-up contam só quem tem acesso", async () => {
    const impact = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: { ...MONTHLY_DAY_5, requireActiveAccess: true }, published: MANUAL, active: true, now: NOW_AFTER })
    expect(impact.schedule).toMatchObject({ population: 15, enrollmentsPerOccurrence: 15, immediate: { enrollments: 15 } })
    expect(impact.access).toMatchObject({ required: true, population: 300, withAccess: 15 })
    // 15 por ocorrência fica abaixo do limite de população grande; só o catch-up de hoje pede confirmação.
    expect(impact.reasons).toEqual(["IMMEDIATE_CATCH_UP"])
  })

  it("modo Consolidado não tem a opção: nada é calculado", async () => {
    const consolidated: WorkflowConfiguration = { ...MONTHLY_DAY_5, consolidatedStructure: { kind: "SUBTEAM", subteamId: "22222222-2222-4222-8222-222222222221" }, requireActiveAccess: true }
    const impact = await computeGoLiveImpact(db(), ORG, { workflowId: "wf", reason: "PUBLISH", configuration: consolidated, published: null, active: true, now: NOW_AFTER })
    expect(impact.access).toBeNull()
  })
})
