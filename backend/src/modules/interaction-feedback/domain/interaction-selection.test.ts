import { describe, expect, it } from "vitest"
import { selectInteractions, selectionSeedOf, workflowGenerationKeyOf } from "./interaction-selection.js"

const candidates = Array.from({ length: 30 }, (_, index) => ({ id: `int-${String(index).padStart(2, "0")}`, startedAt: new Date(Date.UTC(2026, 2, 1 + index, 12)) }))
const window = { start: new Date("2026-03-01T03:00:00Z"), end: new Date("2026-04-01T03:00:00Z") }

describe("V1.5.10 — seleção reproduzível das interações", () => {
  it("mesma execução + mesma janela + mesmos candidatos → mesma amostra (em qualquer ordem de chegada); nunca Math.random", () => {
    const seed = selectionSeedOf({ enrollmentId: "enr-1", collaboratorId: "op-1", window })
    const first = selectInteractions(candidates, { strategy: "DETERMINISTIC_SAMPLE", size: 5, seed })
    expect(first).toHaveLength(5)
    expect(selectInteractions([...candidates].reverse(), { strategy: "DETERMINISTIC_SAMPLE", size: 5, seed })).toEqual(first)
    expect(selectInteractions(candidates, { strategy: "DETERMINISTIC_SAMPLE", size: 5, seed })).toEqual(first)
  })
  it("execução NOVA (outra matrícula) → outra semente → a amostra pode mudar; sem viés de recência", () => {
    const a = selectInteractions(candidates, { strategy: "DETERMINISTIC_SAMPLE", size: 5, seed: selectionSeedOf({ enrollmentId: "enr-1", collaboratorId: "op-1", window }) })
    const b = selectInteractions(candidates, { strategy: "DETERMINISTIC_SAMPLE", size: 5, seed: selectionSeedOf({ enrollmentId: "enr-2", collaboratorId: "op-1", window }) })
    expect(a).not.toEqual(b)
    expect(a).not.toEqual(candidates.slice(-5).map((candidate) => candidate.id).reverse())
  })
  it("MOST_RECENT = as mais recentes, desempate estável por id; teto de 10; nenhum candidato repetido", () => {
    expect(selectInteractions(candidates, { strategy: "MOST_RECENT", size: 3, seed: "x" })).toEqual(["int-29", "int-28", "int-27"])
    expect(selectInteractions(candidates, { strategy: "MOST_RECENT", size: 50, seed: "x" })).toHaveLength(10)
    const tie = [{ id: "b", startedAt: new Date(0) }, { id: "a", startedAt: new Date(0) }, { id: "a", startedAt: new Date(0) }]
    expect(selectInteractions(tie, { strategy: "MOST_RECENT", size: 5, seed: "x" })).toEqual(["a", "b"])
  })
  it("chave de idempotência: workflow + nó + interação + contrato (a versão publicada e a matrícula NÃO entram)", () => {
    expect(workflowGenerationKeyOf({ workflowId: "wf", nodeId: "gerar", interactionId: "int" })).toBe("WORKFLOW_ACTION:wf:gerar:int:INTERACTION_FEEDBACK_V1")
    expect(workflowGenerationKeyOf({ workflowId: "wf", nodeId: "outro-no", interactionId: "int" })).not.toBe(workflowGenerationKeyOf({ workflowId: "wf", nodeId: "gerar", interactionId: "int" }))
    expect(workflowGenerationKeyOf({ workflowId: "wf", nodeId: "gerar", interactionId: "int", contractVersion: "INTERACTION_FEEDBACK_V2" })).toContain("V2")
  })
})
