import { describe, expect, it } from "vitest"
import type { Database } from "../../../infrastructure/database/pool.js"
import { resolveWorkday, type WorkdayResolutionInput } from "../../people/domain/workday-resolution.js"
import type { DataDomain } from "./data-domains.js"
import { createDomainFactsLoader, workdayReading } from "./domain-facts-loader.js"

const PERSON = "41000000-0000-4000-8000-000000001001"
const planned = { scheduledToWork: true, basis: "EXPLICIT_SCHEDULE", holiday: false, exception: null } as unknown as WorkdayResolutionInput["planned"]
const day = (overrides: Partial<WorkdayResolutionInput>) => resolveWorkday({ date: "2026-10-12", hired: true, status: null, planned, evidence: null, evidenceEnabled: true, dayClosed: true, availability: "READY", classification: null, ...overrides })

/** Banco falso: guarda o SQL de cada consulta e não devolve linhas. */
function recordingDb() {
  const sql: string[] = []
  const db = { query: async (text: string) => (sql.push(text), { rows: [] }) } as unknown as Database
  return { db, sql }
}

describe("carregamento dos domínios de dado da liderança", () => {
  it("DL-01: férias, dia em curso, dado ainda não esperado e fonte atrasada nunca viram 'escalado sem produção'", () => {
    const vacation = day({ status: "FERIAS" as WorkdayResolutionInput["status"] })
    expect(vacation.state).toBe("NON_ELIGIBLE_EMPLOYMENT_STATUS")
    for (const resolved of [vacation, day({ dayClosed: false }), day({ availability: "WAITING_FOR_SOURCES" }), day({ availability: "DATA_SOURCE_DELAY" }), day({ hired: false })]) {
      expect(workdayReading(resolved)).toMatchObject({ produced: null, missing: null })
    }
    // Só o dia encerrado, com as fontes fechadas e nada observado, entra — como pendência a classificar.
    expect(workdayReading(day({}))).toMatchObject({ situation: "Sem produção · classificar", produced: 0, missing: 1 })
  })

  it("DL-01: a jornada sai do resolvedor único do dia (um registro por pessoa × dia resolvido)", async () => {
    const { db } = recordingDb()
    const windows: { start: Date; end: Date }[] = []
    const load = createDomainFactsLoader(db, "org", "America/Sao_Paulo", { resolveWorkdays: async (_ids, window) => (windows.push(window), new Map([[PERSON, [day({ status: "FERIAS" as WorkdayResolutionInput["status"] }), day({ date: "2026-10-13" })]]])) })
    const { facts } = await load("WORKDAY", [PERSON], "2026-10-12", "2026-10-14")
    expect(windows).toHaveLength(1)
    expect(facts.map((fact) => [fact.dims.DIA, fact.measures.SEM_PRODUCAO_NO_DIA_ESCALADO])).toEqual([["2026-10-12", null], ["2026-10-13", 1]])
  })

  it("DL-02/DL-04/DL-06: só comunicado no ar, só feedback publicado e visível, e toda leitura com ordem estável", async () => {
    const domains: DataDomain[] = ["INTERACTIONS", "MONITORING", "FEEDBACKS", "CASES", "SCHEDULE", "COMMUNICATIONS", "INIA_USAGE", "SUPPORT"]
    for (const domain of domains) {
      const { db, sql } = recordingDb()
      await createDomainFactsLoader(db, "org", "America/Sao_Paulo")(domain, [PERSON], "2026-10-01", "2026-11-01")
      const text = sql[sql.length - 1]!
      expect(text, domain).toMatch(/order by [^\n]*\n\s*limit/)
      if (domain === "COMMUNICATIONS") expect(text).toContain("c.status = 'PUBLISHED' and c.published_at <= now()")
      if (domain === "FEEDBACKS") {
        expect(text).toContain("f.status = 'PUBLISHED'")
        expect(text).toContain("feedback_follow_up_hides")
      }
    }
  })
})
