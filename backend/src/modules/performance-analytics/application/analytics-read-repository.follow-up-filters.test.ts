import { describe, expect, it } from "vitest"
import { followUpAudienceSql, followUpTypeSql } from "./analytics-read-repository.js"

/**
 * ARQ-16 — as duas funções puras que montam o SQL dos filtros do feed ("Tipo" e "Para quem") a partir de enum. Texto fixo por
 * combinação; o comportamento contra o Postgres fica em `follow-up-feed-proof` (só com `INIA_DB_PROOF=1`).
 */
const NONE = "and false"
const OPEN = { feedback: "", alert: "", report: "", notice: "" }

describe("followUpTypeSql", () => {
  it("sem filtro (null ou vazio): nenhum ramo é restringido", () => {
    expect(followUpTypeSql(null)).toEqual(OPEN)
    expect(followUpTypeSql([])).toEqual(OPEN)
  })

  it("um tipo de feedback: só o ramo de feedback, pelo `feedback_kind`", () => {
    expect(followUpTypeSql(["MONITORING"])).toEqual({ feedback: "and f.feedback_kind in ('MONITORING')", alert: NONE, report: NONE, notice: NONE })
    expect(followUpTypeSql(["INDICATOR", "MONITORING"]).feedback).toBe("and f.feedback_kind in ('MONITORING', 'INDICATOR')")
  })

  it("avisos de workflow pelo `alert_type`; intervenção pela família; OTHER = fora das duas", () => {
    expect(followUpTypeSql(["HUMAN_REVIEW", "ESCALATION"])).toEqual({ feedback: NONE, alert: "and (a.alert_type in ('WORKFLOW_HUMAN_REVIEW', 'WORKFLOW_ESCALATION'))", report: NONE, notice: NONE })
    expect(followUpTypeSql(["INTERVENTION"]).alert).toBe("and (left(a.alert_type, 13) = 'INTERVENTION_')")
    expect(followUpTypeSql(["OTHER"]).alert).toBe("and ((a.alert_type not in ('WORKFLOW_OUTPUT', 'WORKFLOW_HUMAN_REVIEW', 'WORKFLOW_ESCALATION') and left(a.alert_type, 13) <> 'INTERVENTION_'))")
    expect(followUpTypeSql(["WORKFLOW_OUTPUT", "INTERVENTION"]).alert).toBe("and (a.alert_type in ('WORKFLOW_OUTPUT') or left(a.alert_type, 13) = 'INTERVENTION_')")
  })

  it("report e comunicado abrem o ramo inteiro; vários tipos somam os ramos", () => {
    expect(followUpTypeSql(["REPORT"])).toEqual({ feedback: NONE, alert: NONE, report: "", notice: NONE })
    expect(followUpTypeSql(["NOTICE", "INDICATOR"])).toEqual({ feedback: "and f.feedback_kind in ('INDICATOR')", alert: NONE, report: NONE, notice: "" })
  })

  it("só ALIGNMENT: os quatro ramos do SQL fecham (o alinhamento entra por ramo próprio)", () => {
    expect(followUpTypeSql(["ALIGNMENT"])).toEqual({ feedback: NONE, alert: NONE, report: NONE, notice: NONE })
  })
})

describe("followUpAudienceSql", () => {
  it("ausente = sem filtro", () => {
    expect(followUpAudienceSql(null)).toEqual(OPEN)
  })

  it("MINE: sem feedbacks; avisos e reports de quem lê; comunicado que ele recebeu", () => {
    expect(followUpAudienceSql("MINE")).toEqual({ feedback: NONE, alert: "", report: "", notice: "and n.author_person_id <> $4" })
  })

  it("TEAM: feedbacks dos liderados e comunicado que ele publicou; avisos e reports saem", () => {
    expect(followUpAudienceSql("TEAM")).toEqual({ feedback: "", alert: NONE, report: NONE, notice: "and n.author_person_id = $4" })
  })
})
