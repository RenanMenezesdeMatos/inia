import { describe, expect, it } from "vitest"
import { buildEvolution, evolutionPlan, judgeEvolution, EVOLUTION_MAX_WINDOW_DAYS, type EvolutionInput, type EvolutionWindow } from "./evolution.js"
import { briefLead, buildLeaderBrief, clipText, BRIEF_MAX_FEEDBACKS, type BriefActionInput, type BriefFeedback } from "./leader-brief.js"

const window = (value: number | null, daysWithData: number): EvolutionWindow => ({ start: "2026-10-01T12:00:00.000Z", end: "2026-10-19T12:00:00.000Z", value, daysWithData, expectedDays: 22 })
const input = (extra: Partial<EvolutionInput> = {}): EvolutionInput => ({
  indicatorCode: "TMA",
  indicatorName: "Tempo Médio de Atendimento",
  unit: "SECONDS",
  direction: "LOWER",
  dailySupported: true,
  reference: { kind: "FEEDBACK", ref: "f1", label: "o feedback", at: "2026-10-19T12:00:00.000Z" },
  referenceDay: "2026-10-19",
  asOfDay: "2026-11-18",
  before: window(467, 18),
  after: window(455, 17),
  ...extra,
})

describe("evolução medida (antes × depois do feedback)", () => {
  it("janelas em dias civis, do mesmo tamanho, com o dia do feedback fora das duas; teto de dias; cedo demais não compara", () => {
    // 30 dias desde o feedback: antes = 19/09 a 18/10 (termina antes do dia 19); depois = 20/10 a 18/11.
    expect(evolutionPlan("2026-10-19", "2026-11-18")).toEqual({ daysSince: 30, windowDays: 30, before: { startDay: "2026-09-19", endDayExclusive: "2026-10-19" }, after: { startDay: "2026-10-20", endDay: "2026-11-18" } })
    // Feedback antigo: as duas janelas ficam no teto; a de depois é a mais recente.
    const old = evolutionPlan("2026-06-01", "2026-11-18")
    expect(old.windowDays).toBe(EVOLUTION_MAX_WINDOW_DAYS)
    expect(old.before).toEqual({ startDay: "2026-04-02", endDayExclusive: "2026-06-01" })
    expect(old.after).toEqual({ startDay: "2026-09-20", endDay: "2026-11-18" })
    expect(evolutionPlan("2026-11-15", "2026-11-18")).toEqual({ daysSince: 3, windowDays: null, before: null, after: null })
  })

  it("a direção do indicador diz se andou para o lado certo — e os números vão por extenso, sem limiar escondido", () => {
    const better = buildEvolution(input())
    expect(better.status).toBe("IMPROVED")
    expect(better.change).toEqual({ absolute: -12, percent: -2.57 })
    expect(better.statement).toBe("Desde o feedback de 19/10/2026, Tempo Médio de Atendimento foi de 467 s (30 dias antes, 18 dia(s) com medição de 22 esperado(s)) para 455 s (30 dias depois, 17 dia(s) com medição de 22 esperado(s)): melhorou 2,6%. O dia do feedback não entra em nenhum dos lados.")
    expect(buildEvolution(input({ after: window(480, 17) })).status).toBe("WORSENED")
    expect(buildEvolution(input({ direction: "HIGHER", after: window(480, 17) })).status).toBe("IMPROVED")
    expect(buildEvolution(input({ after: window(467, 17) })).statement).toContain("sem mudança")
    // "Bater uma meta específica" não tem lado certo: diz só que subiu ou caiu.
    const target = buildEvolution(input({ direction: "TARGET", after: window(480, 17) }))
    expect(target.status).toBe("CHANGED")
    expect(target.statement).toContain("subiu 2,8%")
  })

  it("dado ausente nunca é desempenho ruim: sem medição diária, marco recente ou poucos dias medidos não classifica", () => {
    expect(buildEvolution(input({ dailySupported: false })).status).toBe("NOT_AVAILABLE")
    const recent = buildEvolution(input({ referenceDay: "2026-11-15" }))
    expect(recent.status).toBe("TOO_RECENT")
    expect(recent.change).toBeNull()
    const few = buildEvolution(input({ after: window(455, 2) }))
    expect(few.status).toBe("INSUFFICIENT_DATA")
    expect(few.statement).toContain("Dado ausente não é desempenho ruim")
    expect(buildEvolution(input({ before: window(null, 0) })).status).toBe("INSUFFICIENT_DATA")
    expect(buildEvolution(input({ before: null, after: null })).status).toBe("INSUFFICIENT_DATA")
  })
})

describe("evolução como condição (limiar explícito da regra)", () => {
  it("melhora é a variação para o lado certo; o mínimo exigido decide se conta como evolução", () => {
    // TMA (menor é melhor) foi de 467 para 455: melhorou 2,57%.
    const evolution = buildEvolution(input())
    expect(judgeEvolution(evolution, 0)).toEqual({ conclusive: true, improved: true, improvementPercent: 2.57 })
    expect(judgeEvolution(evolution, 5)).toEqual({ conclusive: true, improved: false, improvementPercent: 2.57 })
    // Piorou: nunca é evolução, nem com mínimo zero. Sem mudança também não.
    expect(judgeEvolution(buildEvolution(input({ after: window(480, 17) })), 0)).toMatchObject({ conclusive: true, improved: false, improvementPercent: -2.78 })
    expect(judgeEvolution(buildEvolution(input({ after: window(467, 17) })), 0)).toMatchObject({ conclusive: true, improved: false, improvementPercent: 0 })
    // Maior é melhor: subir é melhorar.
    expect(judgeEvolution(buildEvolution(input({ direction: "HIGHER", after: window(480, 17) })), 2)).toMatchObject({ conclusive: true, improved: true })
  })

  it("sem comparação possível é INCONCLUSIVO — nunca 'sem evolução'", () => {
    expect(judgeEvolution(buildEvolution(input({ referenceDay: "2026-11-15" })), 0)).toEqual({ conclusive: false, reasonCode: "EVOLUTION_TOO_RECENT" })
    expect(judgeEvolution(buildEvolution(input({ after: window(455, 1) })), 0)).toEqual({ conclusive: false, reasonCode: "EVOLUTION_INSUFFICIENT_DATA" })
    expect(judgeEvolution(buildEvolution(input({ dailySupported: false })), 0)).toEqual({ conclusive: false, reasonCode: "EVOLUTION_NOT_AVAILABLE" })
    expect(judgeEvolution(buildEvolution(input({ direction: "TARGET", after: window(480, 17) })), 0)).toEqual({ conclusive: false, reasonCode: "EVOLUTION_NO_DIRECTION" })
    expect(judgeEvolution(buildEvolution(input({ before: window(0, 18) })), 0)).toEqual({ conclusive: false, reasonCode: "EVOLUTION_NO_BASELINE" })
  })
})

const action = (extra: Partial<BriefActionInput> = {}): BriefActionInput => ({ handle: "A1", typeKey: "PLANO", typeName: "Plano de ação", sensitive: false, status: "CREATED", interventionId: "i1", responsible: { personId: "p1", name: "Daniela Rocha" }, approver: null, dueAt: "2026-12-18", ...extra })
const context = { personName: "Camila Barros", policyName: "Acompanhamento de TMA" }

describe("resumo da INIA para a liderança", () => {
  it("a fala muda com a decisão e com quem lê (responsável em 2ª pessoa)", () => {
    expect(briefLead(action(), context)).toEqual({
      toResponsible: "Criei um acompanhamento para você fazer com Camila Barros: “Plano de ação”, com prazo até 18/12/2026.",
      toOthers: "Criei um acompanhamento para Daniela Rocha fazer com Camila Barros: “Plano de ação”, com prazo até 18/12/2026.",
    })
    expect(briefLead(action({ status: "RECOMMENDED" }), context).toResponsible).toBe("Sugiro “Plano de ação” para Camila Barros. Você decide se aceita até 18/12/2026.")
    expect(briefLead(action({ status: "PENDING_APPROVAL", approver: { personId: "p2", name: "André Marques" } }), context).toOthers).toBe("Preparei “Plano de ação” para Daniela Rocha fazer com Camila Barros. Aguarda a aprovação de André Marques.")
  })

  it("avaliação de continuidade: texto FIXO, igual para qualquer leitor — a INIA só sugere e nada muda na situação funcional", () => {
    for (const status of ["PENDING_APPROVAL", "RECOMMENDED", "CREATED"] as const) {
      const lead = briefLead(action({ sensitive: true, typeName: "Solicitar avaliação de continuidade", status }), context)
      expect(lead.toResponsible).toBe(lead.toOthers)
      expect(lead.toOthers).toBe("Pela política “Acompanhamento de TMA”, sugiro a avaliação de continuidade de Camila Barros. É uma sugestão: a decisão é de quem está autorizado a decidir, com justificativa, e este aviso não muda a situação funcional de ninguém.")
    }
  })

  it("o resumo lista só os feedbacks mais recentes, com o texto cortado em palavra inteira, e não repete fatos", () => {
    const feedback = (index: number): BriefFeedback => ({ id: `f${index}`, kind: "INDICATOR", title: "Tempo Médio de Atendimento", publishedAt: `2026-10-${String(10 + index).padStart(2, "0")}T12:00:00.000Z`, acknowledgedAt: null, recommendation: "Avise o cliente antes de cada espera e use o roteiro de consulta rápida. ".repeat(12) })
    const brief = buildLeaderBrief({ ...context, situation: ["Q4 em 3 de 3 fechamentos", "Q4 em 3 de 3 fechamentos"], feedbacks: Array.from({ length: 8 }, (_, index) => feedback(index)), feedbackCount: 8, evolution: null, unknowns: ["Sem diagnóstico sustentado.", "Sem diagnóstico sustentado."], actions: [action()] })
    expect(brief.situation).toEqual(["Q4 em 3 de 3 fechamentos"])
    expect(brief.unknowns).toEqual(["Sem diagnóstico sustentado."])
    expect(brief.alreadyDone.feedbacks).toHaveLength(BRIEF_MAX_FEEDBACKS)
    expect(brief.alreadyDone.feedbackCount).toBe(8)
    const text = brief.alreadyDone.feedbacks[0]!.recommendation
    expect(text.length).toBeLessThanOrEqual(321)
    expect(text.endsWith("…")).toBe(true)
    expect(text).not.toMatch(/\s…$/)
    expect(brief.actions[0]).toMatchObject({ handle: "A1", interventionId: "i1", typeName: "Plano de ação" })
  })

  it("texto curto fica inteiro", () => {
    expect(clipText("  Avise o cliente \n antes da espera. ", 320)).toBe("Avise o cliente antes da espera.")
  })

  it("tira tabela e marcação Markdown sem mudar as palavras; nunca corta dentro de uma citação literal", () => {
    const markdown = ["**Ponto forte**", "", "Você confirmou o cadastro.", "", "| | TMA |", "|---|---|", "| Meta | 400 s |", "", "- Revise o checklist", "2. Use o roteiro"].join("\n")
    expect(clipText(markdown, 320)).toBe("Ponto forte Você confirmou o cadastro. • Revise o checklist • Use o roteiro")
    const quoted = `Ao encerrar, você disse “A Vivo agradece o contato. Tenha uma boa noite!”, sem checar a compreensão do cliente.`
    // O corte cairia no meio da citação: recua para antes dela.
    expect(clipText(quoted, 60)).toBe("Ao encerrar, você disse…")
    // Citação inteira dentro do limite continua inteira.
    expect(clipText(quoted, 90)).toBe("Ao encerrar, você disse “A Vivo agradece o contato. Tenha uma boa noite!”, sem checar a…")
  })
})
