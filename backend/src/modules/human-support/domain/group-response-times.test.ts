import { describe, expect, it } from "vitest"
import type { ResponseTimes } from "./catalogs.js"
import { planGroupResponseTimes, type GroupTimesRow } from "./group-response-times.js"

const ORG: ResponseTimes = { operatorRequeueMinutes: 15, operatorCloseMinutes: 20, anjoRequeueMinutes: 15 }
const MINE: ResponseTimes = { operatorRequeueMinutes: 30, operatorCloseMinutes: 40, anjoRequeueMinutes: 20 }
const OTHER: ResponseTimes = { operatorRequeueMinutes: 10, operatorCloseMinutes: 30, anjoRequeueMinutes: 10 }

/** Aplica o plano como o serviço faz no banco (a linha nunca é apagada). */
function apply(row: GroupTimesRow | null, input: { times: ResponseTimes | null; version: number }): GroupTimesRow | null | "CONFLICT" {
  const plan = planGroupResponseTimes(row, input, ORG)
  if (plan.kind === "CONFLICT") return "CONFLICT"
  if (plan.kind === "NONE") return row
  if (plan.kind === "USE_DEFAULT") return { ...row!, custom: false, version: plan.nextVersion }
  return { custom: true, version: plan.nextVersion, times: plan.times }
}

describe("tempos de resposta por Grupo — versão otimista (auditoria B4)", () => {
  it("'Usar o padrão' mantém a versão subindo: quem abriu antes da volta ao padrão recebe conflito", () => {
    const created = apply(null, { times: MINE, version: 0 }) as GroupTimesRow
    expect(created).toEqual({ custom: true, version: 1, times: MINE })
    // Duas telas abertas com a versão 1. A primeira volta ao padrão e grava tempos novos de novo.
    const reset = apply(created, { times: null, version: 1 }) as GroupTimesRow
    expect(reset).toMatchObject({ custom: false, version: 2 })
    const again = apply(reset, { times: OTHER, version: 2 }) as GroupTimesRow
    expect(again).toEqual({ custom: true, version: 3, times: OTHER })
    // A segunda tela ainda tem a versão 1: antes (linha apagada e recriada com versão 1) passava por cima sem 409.
    expect(apply(again, { times: MINE, version: 1 })).toBe("CONFLICT")
  })

  it("quem viu o Grupo sem tempos próprios (versão 0) não passa depois de criar e voltar ao padrão", () => {
    const reset = apply(apply(null, { times: MINE, version: 0 }) as GroupTimesRow, { times: null, version: 1 })
    expect(apply(reset as GroupTimesRow, { times: OTHER, version: 0 })).toBe("CONFLICT")
  })

  it("o conflito devolve o que vale agora (o padrão da organização quando a linha não é própria)", () => {
    expect(planGroupResponseTimes({ custom: false, version: 2, times: MINE }, { times: OTHER, version: 1 }, ORG)).toEqual({ kind: "CONFLICT", current: { custom: false, times: ORG, version: 2 } })
  })

  it("sem mudança não grava: voltar ao padrão quem já usa o padrão, ou os mesmos tempos próprios", () => {
    expect(planGroupResponseTimes(null, { times: null, version: 0 }, ORG)).toEqual({ kind: "NONE" })
    expect(planGroupResponseTimes({ custom: false, version: 2, times: MINE }, { times: null, version: 2 }, ORG)).toEqual({ kind: "NONE" })
    expect(planGroupResponseTimes({ custom: true, version: 3, times: MINE }, { times: MINE, version: 3 }, ORG)).toEqual({ kind: "NONE" })
  })

  it("a mudança registrada parte do que valia: os tempos próprios, ou o padrão quando a linha não é própria", () => {
    expect(planGroupResponseTimes({ custom: false, version: 2, times: MINE }, { times: OTHER, version: 2 }, ORG)).toEqual({ kind: "SET", from: ORG, times: OTHER, nextVersion: 3 })
    expect(planGroupResponseTimes({ custom: true, version: 3, times: MINE }, { times: null, version: 3 }, ORG)).toEqual({ kind: "USE_DEFAULT", from: MINE, nextVersion: 4 })
  })
})
