import { describe, expect, it } from "vitest"
import { describeRecognitionFact, hasRecognitionGround, recognitionFactOf, recognitionSkippedOutput, targetStatusOf, type RecognitionFact } from "./recognition-fact.js"
import { NO_PARTITION_ID, type EmployeeCollectionOutput, type RankedMember, type RankingPartition } from "./select-employees-executor.js"

const partition = (overrides: Partial<RankingPartition> & { members: RankedMember[] }): RankingPartition => ({
  id: "subgrupo-voz",
  name: "Voz",
  evaluatedCount: 14,
  rankedCount: 12,
  noDataCount: 2,
  selectedCount: overrides.members.length,
  calculation: { source: "PRV_ACHIEVEMENT", indicatorCode: null, aggregation: "AVERAGE", periodLabel: "Mês anterior", windowLabel: null, previousWindowLabel: null, direction: "HIGHER", minimumCoverage: null },
  ...overrides,
})

const collection = (selection: string, partitions: RankingPartition[], partitionBy: "NONE" | "TEAM" | "SUBTEAM" = "SUBTEAM") =>
  ({
    kind: "EMPLOYEE_COLLECTION",
    mode: "RANKING",
    memberIds: partitions.flatMap((item) => item.members.map((member) => member.employeeId)),
    evaluatedCount: 14,
    selectedCount: 1,
    sourceKind: "STRUCTURE",
    sourceNodeId: null,
    selectedAt: "2026-11-02T12:00:00.000Z",
    ranking: { source: "PRV_ACHIEVEMENT", selection },
    direction: "HIGHER",
    partitionBy,
    requestedCountPerPartition: 1,
    rankedCount: 12,
    noDataCount: 2,
    partitions,
  }) as unknown as EmployeeCollectionOutput

const sentence = (input: EmployeeCollectionOutput, employeeId = "gabriel") => {
  const fact = recognitionFactOf(input, employeeId, "Atingimento do PRV")
  return fact ? describeRecognitionFact(fact) : null
}

describe("targetStatusOf: quem diz se a meta foi batida é o sistema", () => {
  it("o atingimento oficial decide quando existe", () => {
    expect(targetStatusOf({ achievementPercent: 100, value: 1, target: 999, direction: "HIGHER" })).toBe("MET")
    expect(targetStatusOf({ achievementPercent: 85, value: 999, target: 1, direction: "HIGHER" })).toBe("NOT_MET")
  })

  it("sem atingimento, compara valor e meta pela direção oficial", () => {
    expect(targetStatusOf({ achievementPercent: null, value: 350, target: 400, direction: "LOWER" })).toBe("MET")
    expect(targetStatusOf({ achievementPercent: null, value: 450, target: 400, direction: "LOWER" })).toBe("NOT_MET")
    expect(targetStatusOf({ achievementPercent: null, value: 72, target: 70, direction: "HIGHER" })).toBe("MET")
    expect(targetStatusOf({ achievementPercent: null, value: 62, target: 70, direction: "HIGHER" })).toBe("NOT_MET")
  })

  it("sem meta, ou com meta por faixa, nunca vira resultado ruim", () => {
    expect(targetStatusOf({ achievementPercent: null, value: 62, target: null, direction: "HIGHER" })).toBe("UNKNOWN")
    expect(targetStatusOf({ achievementPercent: null, value: 62, target: 70, direction: "TARGET" })).toBe("UNKNOWN")
  })
})

describe("recognitionFactOf e a frase do motivo", () => {
  it("o melhor do Subgrupo, com a posição e quantos tinham dados", () => {
    expect(sentence(collection("BEST", [partition({ members: [{ employeeId: "gabriel", value: 85, position: 1 }] })]))).toBe("Melhor resultado em Atingimento do PRV no Subgrupo Voz (mês anterior): posição 1 entre 12 pessoas com dados.")
  })

  it("ser escolhido em outra posição não vira \"o melhor\"", () => {
    expect(sentence(collection("BEST", [partition({ members: [{ employeeId: "outra", value: 90, position: 1 }, { employeeId: "gabriel", value: 85, position: 2 }] })]))).toBe("Entre os melhores resultados em Atingimento do PRV no Subgrupo Voz (mês anterior): posição 2 entre 12 pessoas com dados.")
  })

  it("evolução mostra de onde para onde", () => {
    expect(sentence(collection("IMPROVED", [partition({ members: [{ employeeId: "gabriel", previousValue: 80, currentValue: 92.456, change: 12.456, performanceChange: 12.456, position: 1 }] })]))).toBe("Maior evolução em Atingimento do PRV no Subgrupo Voz (mês anterior), de 80% para 92.46%: posição 1 entre 12 pessoas com dados.")
  })

  it("sozinho no recorte: a frase não finge uma disputa", () => {
    expect(sentence(collection("BEST", [partition({ rankedCount: 1, members: [{ employeeId: "gabriel", value: 85, position: 1 }] })]))).toBe("Único resultado com dados em Atingimento do PRV no Subgrupo Voz (mês anterior): não houve comparação com outras pessoas.")
  })

  it("diz onde a posição vale: Grupo, sem separação e quem está sem Subgrupo", () => {
    const member: RankedMember = { employeeId: "gabriel", value: 85, position: 1 }
    expect(sentence(collection("BEST", [partition({ name: "B2C", members: [member] })], "TEAM"))).toContain("no Grupo B2C")
    expect(sentence(collection("BEST", [partition({ id: null, name: null, members: [member] })], "NONE"))).toContain("na estrutura avaliada")
    expect(sentence(collection("BEST", [partition({ id: NO_PARTITION_ID, name: "Sem subgrupo", members: [member] })]))).toContain('entre quem está em "Sem subgrupo"')
  })

  it("evolução de quem está sozinho no recorte continua sendo evolução, sem sugerir disputa", () => {
    expect(sentence(collection("IMPROVED", [partition({ rankedCount: 1, members: [{ employeeId: "gabriel", previousValue: 70, currentValue: 81, change: 11, performanceChange: 11, position: 1 }] })]))).toBe("Evolução em Atingimento do PRV no Subgrupo Voz (mês anterior), de 70% para 81%: não houve comparação com outras pessoas.")
  })

  it("quem não está na coleção não tem motivo", () => {
    expect(sentence(collection("BEST", [partition({ members: [{ employeeId: "outra", value: 90, position: 1 }] })]))).toBeNull()
  })

  it("ranking que não é de reconhecimento não produz motivo, nem seleção por critério", () => {
    const member: RankedMember = { employeeId: "gabriel", value: 85, position: 1 }
    for (const selection of ["WORST", "HIGHEST", "LOWEST", "DECLINED"]) expect(sentence(collection(selection, [partition({ members: [member] })]))).toBeNull()
    expect(sentence({ kind: "EMPLOYEE_COLLECTION", mode: "CONDITION", memberIds: ["gabriel"] } as unknown as EmployeeCollectionOutput)).toBeNull()
  })
})

describe("hasRecognitionGround: reconhecer exige um motivo", () => {
  const fact = (overrides: Partial<RecognitionFact> = {}): RecognitionFact => ({ contractVersion: "RECOGNITION_FEEDBACK_V1", basis: "BEST", subject: "Atingimento do PRV", indicatorCode: null, periodLabel: "Mês anterior", scope: "no Subgrupo Crédito", position: 1, rankedCount: 1, previousValue: null, currentValue: null, valueSuffix: "%", ...overrides })

  it("havendo comparação, ser o melhor basta, mesmo fora da meta", () => {
    expect(hasRecognitionGround(fact({ rankedCount: 2 }), "NOT_MET")).toBe(true)
  })

  it("sozinho, a meta batida é motivo", () => {
    expect(hasRecognitionGround(fact(), "MET")).toBe(true)
  })

  it("sozinho, a evolução é motivo, mesmo fora da meta", () => {
    expect(hasRecognitionGround(fact({ basis: "IMPROVED", previousValue: 70, currentValue: 81 }), "NOT_MET")).toBe(true)
  })

  it("sozinho e fora da meta, ou sem leitura de meta, não há motivo", () => {
    expect(hasRecognitionGround(fact(), "NOT_MET")).toBe(false)
    expect(hasRecognitionGround(fact(), "UNKNOWN")).toBe(false)
  })

  it("a saída do nó diz o motivo, sem tratar a falta de dado como resultado ruim", () => {
    expect(recognitionSkippedOutput(fact(), "noa", "NOT_MET").text).toBe("Sem reconhecimento: único resultado com dados em Atingimento do PRV no Subgrupo Crédito (mês anterior), fora da meta. Não houve comparação com outras pessoas nem meta batida.")
    expect(recognitionSkippedOutput(fact(), "noa", "UNKNOWN").text).toContain("sem leitura de meta")
  })
})
