import { describe, expect, it } from "vitest"
import { caseIndicatorSummary, formatRawMeasures } from "./case-indicator"

describe("indicador na tela do caso", () => {
  it("valor do Agent de indicador: número cru vira o formato do produto e a meta embutida sai como meta", () => {
    expect(caseIndicatorSummary({
      indicatorCode: "TMA",
      indicatorValue: "Mês anterior — Tempo Médio de Atendimento: 466.95238095238096 SECONDS (meta vigente: 400 SECONDS)",
      indicatorTarget: "Tempo Médio de Atendimento",
    })).toEqual({ value: "TMA · Mês anterior — Tempo Médio de Atendimento: 7m47s", target: "6m40s" })
  })

  it("sem meta cadastrada: o aviso fica no texto e não há linha de meta", () => {
    expect(caseIndicatorSummary({
      indicatorCode: "FCR",
      indicatorValue: "Resolução no primeiro contato: 81.25 PERCENT (sem meta cadastrada para o período)",
      indicatorTarget: "Resolução no primeiro contato",
    })).toEqual({ value: "FCR · Resolução no primeiro contato: 81,3% (sem meta cadastrada para o período)", target: null })
  })

  it("marcadores internos, nomes e condições de gatilho nunca aparecem como meta", () => {
    expect(caseIndicatorSummary({ indicatorCode: "MONITORIA", indicatorValue: "Reparo", indicatorTarget: "FEEDBACK_ENGINE_V1" }).target).toBeNull()
    expect(caseIndicatorSummary({ indicatorCode: "TMA", indicatorValue: "Fechamento de agosto de 2026", indicatorTarget: "RELIABLE_FEEDBACK_POLICY_AUTONOMOUS_V1" }).target).toBeNull()
    expect(caseIndicatorSummary({ indicatorCode: "rechamada", indicatorValue: "verdadeiro", indicatorTarget: "rechamada é igual a verdadeiro" }).target).toBeNull()
    expect(caseIndicatorSummary({ indicatorCode: "nota_ura", indicatorValue: "1", indicatorTarget: "nota_ura é menor que 3" }).target).toBeNull()
  })

  it("meta numérica da política de acompanhamento continua aparecendo; sem fatos, só o indicador", () => {
    expect(caseIndicatorSummary({ indicatorCode: "TMA", indicatorValue: "Q4 em 3 de 3 fechamentos", indicatorTarget: "—" })).toEqual({ value: "TMA · Q4 em 3 de 3 fechamentos", target: null })
    expect(caseIndicatorSummary({ indicatorCode: "TMA", indicatorValue: "512", indicatorTarget: "400" })).toEqual({ value: "TMA · 512", target: "400" })
    expect(caseIndicatorSummary({ indicatorCode: "TMA", indicatorValue: "—", indicatorTarget: "—" })).toEqual({ value: "TMA", target: null })
  })

  it("não repete o indicador quando o valor já começa por ele", () => {
    expect(caseIndicatorSummary({ indicatorCode: "Tempo Médio de Atendimento", indicatorValue: "Tempo Médio de Atendimento · setembro/2026", indicatorTarget: "FEEDBACK_ENGINE_V1" }))
      .toEqual({ value: "Tempo Médio de Atendimento · setembro/2026", target: null })
  })

  it("formata cada medição crua de um texto e preserva o resto; segundos arredondam pelo total", () => {
    expect(formatRawMeasures("Tempo Médio de Atendimento médio de 466.95 SECONDS no período (meta 400 SECONDS)"))
      .toBe("Tempo Médio de Atendimento médio de 7m47s no período (meta 6m40s)")
    expect(formatRawMeasures("479.6 SECONDS")).toBe("8m00s")
    expect(formatRawMeasures("Nota 4.5 STARS")).toBe("Nota 4,5 ★")
    expect(formatRawMeasures("O cliente pediu 2 segundas vias")).toBe("O cliente pediu 2 segundas vias")
  })
})
