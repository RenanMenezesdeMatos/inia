import { describe, expect, it } from "vitest"
import type { QueryTableCard } from "../../leadership-analytics/domain/view-models.js"
import { toToolCall } from "../domain/report-definition.js"
import { classifyReply, draftFromToolCall } from "./report-proposals.js"

const OWN = { kind: "SUPERVISOR_TEAM", supervisorId: "00000000-0000-4000-8000-000000000001" }
const OTHER = { kind: "SUPERVISOR_TEAM", supervisorId: "00000000-0000-4000-8000-000000000002" }

function card(subject: Record<string, string>, extra: Partial<QueryTableCard> = {}): QueryTableCard {
  return { type: "QUERY_TABLE", generatedAt: "", structure: { subject: subject as never, label: subject === OWN ? "Minha equipe" : "Equipe da Ana", description: null }, source: "OFFICIAL", title: "TOP 3 — Reincidência", scopeNote: "", period: "2026-09", indicatorCode: "REINC", columns: [{ key: "person", label: "Pessoa", numeric: false }, { key: "achievement", label: "Atingimento", numeric: true }], rows: [{ cells: { person: "Ana", achievement: "110%" }, subject: null, personId: null }], totalRows: 1, highlights: [], methods: [], limitations: [], ...extra }
}

const context = { ownSubject: OWN, lastClosedPeriod: "2026-09", question: "Quem são os TOP 3 em Reincidência do meu time?", indicatorCode: (text: string) => (/reinc/i.test(text) ? "REINC" : /tma/i.test(text) ? "TMA" : null) }

describe("rascunho a partir da consulta do chat — preserva a intenção", () => {
  it("TOP 3 em Reincidência do meu time: ordenação, limite, agrupamento; 'meu time' = relativo; indicador pelo CÓDIGO", () => {
    const draft = draftFromToolCall("leadership_indicator_query", { indicadores: ["Reincidência em até 7 Dias"], agrupar_por: "PESSOA", ordenar_por: "ATINGIMENTO", ordem: "DESC", limite: 3, competencia: "2026-09" }, card(OWN), context)!
    expect(draft.definition).toMatchObject({ tool: "INDICATOR_QUERY", structure: { mode: "RECIPIENT" }, period: { mode: "LAST_CLOSED" }, indicators: ["REINC"], groupBy: "PESSOA", sortBy: "ATINGIMENTO", order: "DESC", limit: 3 })
    expect(draft.description).toBe("Quem são os TOP 3 em Reincidência do meu time?")
    expect(toToolCall(draft.definition).args).toEqual({ indicadores: ["REINC"], agrupar_por: "PESSOA", ordenar_por: "ATINGIMENTO", ordem: "DESC", limite: 3 })
  })

  it("estrutura de outra pessoa vira FIXA; mês antigo explícito fica fixo; últimas N viram janela relativa", () => {
    const fixed = draftFromToolCall("leadership_indicator_query", { indicadores: ["TMA"], competencia: "2026-03" }, card(OTHER), context)!
    expect(fixed.definition.structure).toEqual({ mode: "FIXED", subjectKind: "SUPERVISOR_TEAM", subjectId: OTHER.supervisorId, label: "Equipe da Ana" })
    expect(fixed.definition.period).toEqual({ mode: "FIXED_MONTH", month: "2026-03" })
    const lastN = draftFromToolCall("leadership_indicator_query", { indicadores: ["TMA"], ultimas_competencias: 3, periodos_como: "POR_MES" }, card(OWN), context)!
    expect(lastN.definition.period).toEqual({ mode: "LAST_N_CLOSED", months: 3, display: "POR_MES" })
  })

  it("quartil geral (Q4 de PRV), medição do mês em curso, força de trabalho e diagnóstico", () => {
    expect(draftFromToolCall("leadership_indicator_query", { indicadores: ["PRV"], agrupar_por: "PESSOA", quartis: ["Q4"] }, card(OWN), context)!.definition).toMatchObject({ indicators: ["PRV"], quartiles: ["Q4"] })
    expect(draftFromToolCall("leadership_indicator_query", { indicadores: ["TMA"], fonte: "OPERACIONAL", janela: "MES_CORRENTE" }, card(OWN), context)!.definition.period).toEqual({ mode: "CURRENT", window: "MES_CORRENTE" })
    expect(draftFromToolCall("leadership_workforce", { situacoes: ["FERIAS"], agrupar_por: "SUPERVISOR" }, card(OWN), context)!.definition).toMatchObject({ tool: "WORKFORCE", period: { mode: "TODAY" }, statuses: ["FERIAS"], groupBy: "SUPERVISOR" })
    expect(draftFromToolCall("leadership_indicator_diagnosis", { indicador: "TMA" }, card(OWN), context)!.definition).toMatchObject({ tool: "INDICATOR_DIAGNOSIS", indicators: ["TMA"], period: { mode: "LAST_CLOSED" } })
  })

  it("indicador citado pelo apelido: usa o código que a ferramenta resolveu (cartão)", () => {
    const draft = draftFromToolCall("leadership_indicator_query", { indicadores: ["Rechamada do cliente"], agrupar_por: "PESSOA" }, card(OWN), { ...context, indicatorCode: () => null })!
    expect(draft.definition.indicators).toEqual(["REINC"])
  })

  it("não reproduzível = sem proposta (prioridades, indicador desconhecido, janela não suportada, consulta de uma pessoa)", () => {
    expect(draftFromToolCall("leadership_priorities", {}, card(OWN), context)).toBeNull()
    expect(draftFromToolCall("leadership_indicator_query", { indicadores: ["XYZ", "ABC"] }, card(OWN, { indicatorCode: null }), context)).toBeNull()
    expect(draftFromToolCall("leadership_indicator_query", { indicadores: ["TMA"], fonte: "OPERACIONAL", janela: "TRIMESTRE" }, card(OWN), context)).toBeNull()
    expect(draftFromToolCall("leadership_indicator_query", {}, card({ kind: "EMPLOYEE", employeeId: "x" }), context)).toBeNull()
  })
})

describe("resposta à oferta", () => {
  it("'sim' curto aceita; 'não' dispensa; uma pergunta nova nunca vira aceite", () => {
    expect(classifyReply("Sim")).toBe("ACCEPT")
    expect(classifyReply("sim, pode criar o report")).toBe("ACCEPT")
    expect(classifyReply("Quero!")).toBe("ACCEPT")
    expect(classifyReply("não precisa")).toBe("DISMISS")
    expect(classifyReply("Agora não")).toBe("DISMISS")
    expect(classifyReply("Quem está no Q4 de PRV?")).toBeNull()
    expect(classifyReply("sim, mas antes me diga quais supervisores têm mais pessoas fora da meta em TMA neste mês")).toBeNull()
  })
})
