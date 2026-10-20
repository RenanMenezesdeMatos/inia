import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { createConditionResolver } from "./condition-resolvers.js"

const subject = { organizationId: "org-1", personId: "p-1", policyIndicatorCode: "TMA", subjectKey: "INDICATOR:TMA", asOf: new Date("2026-10-17T12:00:00Z"), timeZone: "America/Sao_Paulo" }
const prior = { kind: "PRIOR_INTERVENTIONS", typeKeys: ["CONTINUITY_REVIEW"], statuses: ["ACTIVE", "COMPLETED", "CANCELLED"], withinDays: 365, comparator: "GTE", threshold: 1, sameSubject: false, operationalResults: [] } as never
const timeSince = { kind: "TIME_SINCE_INTERVENTION", event: "OPENED", typeKeys: [], days: 30, comparator: "GTE", whenNone: "MET", sameSubject: false } as never

describe("condições sobre intervenções anteriores — acesso de quem simula (auditoria 17/10/2026, SCOPE-02)", () => {
  it("histórico oculto: as duas condições ficam inconclusivas SEM ler as intervenções (nada de ids, tipos ou datas)", async () => {
    const db = { query: async () => { throw new Error("não deveria ler intervenções") } } as unknown as Database
    const resolver = createConditionResolver(db, { ...subject, interventionHistoryHidden: true })
    for (const condition of [prior, timeSince]) {
      const outcome = await resolver(condition)
      expect(outcome).toMatchObject({ status: "INCONCLUSIVE", reasonCode: "INTERVENTIONS_NOT_VISIBLE", facts: {}, references: [] })
    }
  })

  it("histórico visível (quem conduz/vê as intervenções): lê e devolve os fatos como antes", async () => {
    const rows = [{ id: "int-1", type_key: "CONTINUITY_REVIEW", status: "IN_PROGRESS", created_at: new Date("2026-09-01T12:00:00Z"), result: null }]
    const db = { query: async () => ({ rows }) } as unknown as Database
    const outcome = await createConditionResolver(db, subject)(prior)
    expect(outcome).toMatchObject({ status: "MET", facts: { count: 1 }, references: [{ kind: "INTERVENTION", ref: "int-1" }] })
  })
})
