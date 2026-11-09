import { describe, expect, it } from "vitest"
import { canResumeInterruptedRun, RUN_TRIGGER_KINDS, retryDelayMs, type RunStage, type RunTriggerKind } from "./run-status.js"

const MINUTE = 60_000

/** Espera depois de cada tentativa, em minutos, até acabarem as tentativas. */
function chainInMinutes(trigger: RunTriggerKind): number[] {
  const waits: number[] = []
  for (let attempt = 1; ; attempt += 1) {
    const delay = retryDelayMs(trigger, attempt)
    if (delay === null) return waits
    waits.push(delay / MINUTE)
  }
}

const stage = (interrupted?: boolean): RunStage => ({ stage: "APPLYING", startedAt: "2026-11-05T10:00:00.000Z", finishedAt: "2026-11-05T10:01:00.000Z", detail: null, ...(interrupted ? { interrupted } : {}) })

describe("retryDelayMs", () => {
  it.each<RunTriggerKind>(["SCHEDULE", "CONTINUATION"])("%s: sem ninguém esperando, insiste por quase 3 horas em 7 tentativas", (trigger) => {
    const waits = chainInMinutes(trigger)
    expect(waits).toEqual([1, 5, 15, 30, 60, 60])
    expect(waits.reduce((total, minutes) => total + minutes, 0)).toBe(171)
  })

  it.each(RUN_TRIGGER_KINDS.filter((trigger) => trigger !== "SCHEDULE" && trigger !== "CONTINUATION"))("%s: com alguém esperando, responde em minutos, em 3 tentativas", (trigger) => {
    expect(chainInMinutes(trigger)).toEqual([1, 5])
  })

  it("tentativa além do limite (carga retomada depois de queda) não ganha nova espera", () => {
    expect(retryDelayMs("SCHEDULE", 8)).toBeNull()
    expect(retryDelayMs("MANUAL", 4)).toBeNull()
  })
})

describe("canResumeInterruptedRun", () => {
  it("volta para a fila na 1ª e na 2ª queda; a 3ª encerra a carga", () => {
    expect(canResumeInterruptedRun([])).toBe(true)
    expect(canResumeInterruptedRun([stage(), stage(true)])).toBe(true)
    expect(canResumeInterruptedRun([stage(true), stage(), stage(true)])).toBe(false)
  })

  it("etapas de tentativas que falharam por erro da origem não contam como queda", () => {
    expect(canResumeInterruptedRun(Array.from({ length: 30 }, () => stage()))).toBe(true)
  })
})
