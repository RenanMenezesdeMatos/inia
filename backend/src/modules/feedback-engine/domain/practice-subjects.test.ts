import { describe, expect, it } from "vitest"
import { practiceSubjectKeysOf } from "./indicator-brief.js"

/**
 * Assuntos das boas práticas no feedback de INDICADOR (`BEST_PRACTICE_SELECTION_V1`): onde a investigação localizou o problema;
 * sem localização, os que pioraram; sem isso, os três de maior volume. Só escolhe a seção de boas práticas; o texto não muda.
 */
const segment = (key: string, calls: number, changeDirection: "WORSE" | "BETTER" | "STABLE" | "UNKNOWN") => ({ key, label: key, previous: { value: 300, n: calls }, current: { value: 320, n: calls }, changeDirection, sufficient: true })
const investigation = (segments: ReturnType<typeof segment>[], focus: string[]) =>
  ({ localization: { proxy: { kind: "DURATION_SECONDS", description: "Duração média" }, segments, focus: focus.map((key) => ({ key })), windows: { previous: { label: "agosto" }, current: { label: "setembro" } } }, evidence: [] }) as never

describe("practiceSubjectKeysOf — assuntos para as boas práticas do feedback de indicador", () => {
  it("usa os assuntos em foco da investigação, na ordem dela", () => {
    expect(practiceSubjectKeysOf(investigation([segment("segunda_via", 40, "WORSE"), segment("contestacao", 30, "WORSE"), segment("reparo", 10, "BETTER")], ["contestacao"]))).toEqual(["contestacao"])
  })
  it("sem foco, os que pioraram; sem nenhum pior, os três de maior volume", () => {
    expect(practiceSubjectKeysOf(investigation([segment("segunda_via", 40, "STABLE"), segment("contestacao", 30, "WORSE")], []))).toEqual(["contestacao"])
    expect(practiceSubjectKeysOf(investigation([segment("a", 10, "STABLE"), segment("b", 40, "BETTER"), segment("c", 30, "STABLE"), segment("d", 20, "STABLE")], []))).toEqual(["b", "c", "d"])
  })
  it("sem localização por assunto, nenhuma chave (a seção usa os assuntos das chamadas no período)", () => {
    expect(practiceSubjectKeysOf(investigation([], []))).toEqual([])
  })
})
