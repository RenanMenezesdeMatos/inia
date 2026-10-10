import { describe, expect, it } from "vitest"
import { averageValid, consecutiveFromLatest, deltaPercentagePoints, trendFromDelta } from "./achievement-math.js"
import { buildAchievementInsights, buildStructureInsights } from "./deterministic-insights.js"
import { groupingOptionsBelow } from "./hierarchy-levels.js"
import { classifyMemberSituation } from "./member-situation.js"
import { previousReferencePeriod, referencePeriodWindow, shortPeriodLabel, parseReferencePeriod } from "./reference-period.js"
import { buildIndicatorViewCapabilities } from "./view-capabilities.js"
import { buildAnalyticsSubject } from "./analytics-subject.js"

describe("achievement-math — média só de valores válidos", () => {
  it("SEM DADOS fica fora da média e nunca vira zero", () => {
    expect(averageValid([100, null, 50, undefined])).toBe(75)
    expect(averageValid([null, null])).toBeNull()
    expect(averageValid([])).toBeNull()
  })

  it("variação é em pontos percentuais e null quando falta um lado", () => {
    expect(deltaPercentagePoints(96, 94)).toBe(2)
    expect(deltaPercentagePoints(96, null)).toBeNull()
    expect(trendFromDelta(0.4)).toBe("FLAT")
    expect(trendFromDelta(0.5)).toBe("UP")
    expect(trendFromDelta(-3)).toBe("DOWN")
    expect(trendFromDelta(null)).toBe("UNKNOWN")
  })

  it("sequência a partir da competência mais recente para no primeiro SEM DADOS", () => {
    expect(consecutiveFromLatest([90, 101, 102, 103], (value) => value >= 100)).toBe(3)
    expect(consecutiveFromLatest([101, null, 102], (value) => value >= 100)).toBe(1)
  })
})

describe("competência", () => {
  it("valida, anda meses e rotula", () => {
    expect(parseReferencePeriod("2026-09")).toBe("2026-09")
    expect(() => parseReferencePeriod("2026-13")).toThrowError(/Competência inválida/)
    expect(previousReferencePeriod("2026-01")).toBe("2025-12")
    expect(referencePeriodWindow("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"])
    expect(shortPeriodLabel("2026-09")).toBe("set/26")
  })
})

describe("hierarquia dinâmica → Agrupar por", () => {
  it("cada cargo agrupa só pelos cargos abaixo + Grupo/Subgrupo", () => {
    expect(groupingOptionsBelow("DIRECTOR")).toEqual(["SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
    expect(groupingOptionsBelow("SENIOR_MANAGER")).toEqual(["MANAGER", "COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
    expect(groupingOptionsBelow("MANAGER")).toEqual(["COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
    expect(groupingOptionsBelow("COORDINATOR")).toEqual(["SUPERVISOR", "TEAM", "SUBTEAM"])
    expect(groupingOptionsBelow("SUPERVISOR")).toEqual([])
  })
})

describe("capabilities centralizadas", () => {
  it("Operador: PRV sim, estrutura não, sem aba de pessoas", () => {
    expect(buildIndicatorViewCapabilities("OPERATOR", "EMPLOYEE")).toMatchObject({ mode: "EMPLOYEE", canSeePrv: true, canDrillDown: false, peopleTabLabel: null, tabs: ["FOLLOW_UP", "INDICATORS", "STRUCTURE"] })
  })

  it("Supervisor: aba Equipe, sem PRV na estrutura, sem agrupamento; Gerente+: aba Estrutura com agrupamentos", () => {
    expect(buildIndicatorViewCapabilities("SUPERVISOR", "SUPERVISOR_TEAM")).toMatchObject({ mode: "STRUCTURE", canSeePrv: false, groupingOptions: [], peopleTabLabel: "Equipe" })
    expect(buildIndicatorViewCapabilities("MANAGER", "MANAGER_STRUCTURE")).toMatchObject({ canSeePrv: false, groupingOptions: ["COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"], peopleTabLabel: "Estrutura" })
    expect(buildIndicatorViewCapabilities("DIRECTOR", "TEAM").groupingOptions).toEqual(["SENIOR_MANAGER", "MANAGER", "COORDINATOR", "SUPERVISOR", "TEAM", "SUBTEAM"])
  })

  it("um gestor olhando um colaborador (drill-down) vê a visão EMPLOYEE com PRV, mantendo a aba de pessoas do papel dele", () => {
    expect(buildIndicatorViewCapabilities("MANAGER", "EMPLOYEE")).toMatchObject({ mode: "EMPLOYEE", canSeePrv: true, peopleTabLabel: "Estrutura" })
  })

  it("abas Calendário da equipe e Pendências: para a cadeia hierárquica; Calendário também com calendar.manage; Operador nunca vê Calendário e só vê Pendências enquanto houver pendência real", () => {
    expect(buildIndicatorViewCapabilities("SUPERVISOR", "SUPERVISOR_TEAM").tabs).toEqual(["FOLLOW_UP", "INDICATORS", "PEOPLE", "CALENDAR", "PENDING", "STRUCTURE"])
    expect(buildIndicatorViewCapabilities("COORDINATOR", "COORDINATOR_STRUCTURE").tabs).toContain("PENDING")
    expect(buildIndicatorViewCapabilities("COORDINATOR", "COORDINATOR_STRUCTURE").tabs).toContain("CALENDAR")
    // V1.5.8: o nível legado "ADMIN" não abre aba nenhuma; Calendário vem da permission calendar.manage (papéis da conta).
    expect(buildIndicatorViewCapabilities("ADMIN", "EMPLOYEE").tabs).toEqual(["FOLLOW_UP", "INDICATORS", "STRUCTURE"])
    expect(buildIndicatorViewCapabilities("ADMIN", "EMPLOYEE", { canManageCalendar: true }).tabs).toEqual(["FOLLOW_UP", "INDICATORS", "CALENDAR", "STRUCTURE"])
    expect(buildIndicatorViewCapabilities("ADMIN", "EMPLOYEE", { hasPendingActions: true }).tabs).toEqual(["FOLLOW_UP", "INDICATORS", "PENDING", "STRUCTURE"])
    expect(buildIndicatorViewCapabilities("OPERATOR", "EMPLOYEE").tabs).toEqual(["FOLLOW_UP", "INDICATORS", "STRUCTURE"])
    expect(buildIndicatorViewCapabilities("OPERATOR", "EMPLOYEE", { hasPendingActions: true }).tabs).toEqual(["FOLLOW_UP", "INDICATORS", "PENDING", "STRUCTURE"])
  })
})

describe("sujeito de análise", () => {
  it("reconstrói a partir de kind + id e rejeita tipo desconhecido/ids inválidos", () => {
    expect(buildAnalyticsSubject("SUPERVISOR_TEAM", "10000000-0000-4000-8000-000000000006")).toEqual({ kind: "SUPERVISOR_TEAM", supervisorId: "10000000-0000-4000-8000-000000000006" })
    expect(() => buildAnalyticsSubject("BANANA", "10000000-0000-4000-8000-000000000006")).toThrowError(/desconhecido/)
    expect(() => buildAnalyticsSubject("TEAM", "nao-e-uuid")).toThrowError(/inválido/)
  })
})

describe("situação do colaborador (fatos, com prioridade)", () => {
  it("sem dados > abaixo da referência > em evolução > dentro da referência", () => {
    expect(classifyMemberSituation({ hasAnyData: false, indicatorsBelowTarget: 0, prvQuartile: null, deltaPp: null })).toBe("NO_DATA")
    expect(classifyMemberSituation({ hasAnyData: true, indicatorsBelowTarget: 1, prvQuartile: "Q1", deltaPp: 10 })).toBe("BELOW_REFERENCE")
    expect(classifyMemberSituation({ hasAnyData: true, indicatorsBelowTarget: 0, prvQuartile: "Q4", deltaPp: 10 })).toBe("BELOW_REFERENCE")
    expect(classifyMemberSituation({ hasAnyData: true, indicatorsBelowTarget: 0, prvQuartile: "Q2", deltaPp: 5 })).toBe("IMPROVING")
    expect(classifyMemberSituation({ hasAnyData: true, indicatorsBelowTarget: 0, prvQuartile: "Q2", deltaPp: 4.9 })).toBe("WITHIN_REFERENCE")
    expect(classifyMemberSituation({ hasAnyData: true, indicatorsBelowTarget: 0, prvQuartile: null, deltaPp: null })).toBe("WITHIN_REFERENCE")
  })
})

describe("insights determinísticos", () => {
  it("só afirma o que os dados suportam — sem atingimento, só o aviso de ausência", () => {
    const { positives, attentionPoints } = buildAchievementInsights({ label: "TMA", achievementPercent: null, quartile: null, deltaPp: null, history: [null], withinTarget: null })
    expect(positives).toEqual([])
    expect(attentionPoints.map((insight) => insight.text)).toEqual(["Sem dado oficial de atingimento de TMA neste período."])
  })

  it("queda relevante e sequência abaixo da meta", () => {
    const { attentionPoints } = buildAchievementInsights({ label: "URA", achievementPercent: 80, quartile: "Q3", deltaPp: -8, history: [95, 88, 80], withinTarget: false })
    expect(attentionPoints.map((insight) => insight.text)).toEqual([
      "Atingimento de 80% — faltam 20 p.p. para a meta.",
      "Caiu 8 p.p. em relação ao período anterior.",
      "Abaixo da meta há 3 períodos consecutivos.",
    ])
  })

  it("estrutura sem nenhum dado tem só o aviso de ausência", () => {
    const result = buildStructureInsights({ consolidatedAchievementPercent: null, deltaPp: null, memberCount: 3, membersWithData: 0, belowReferenceCount: 0, q4Count: 0, weakestIndicator: null, strongestIndicator: null })
    expect(result.positives).toEqual([])
    expect(result.attentionPoints).toHaveLength(1)
  })
})
